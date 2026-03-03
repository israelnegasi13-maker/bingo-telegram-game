// crash-logic.js - Professional Crash Game (Aviator style) for ETHIO GAMES
const CONFIG = {
  MIN_BET: 5,
  MAX_BET: 5000,
  COUNTDOWN_SECONDS: 15,                    // 15 seconds countdown
  ROUND_DURATION: 30 * 1000,                // 30 seconds total (including countdown)
  MULTIPLIER_UPDATE_INTERVAL: 100,           // 100ms updates
  MAX_MULTIPLIER: 100.0,                      // Hard cap at 100.0x
  COMMISSION_RATE: 0.10,                     // 10% agent commission (handled by agent system)
  ROUND_HISTORY_LIMIT: 10,
  // Base multiplier increment per step – actual increment becomes dynamic:
  // - below 2.0x: constant 0.005 (slow)
  // - above 2.0x: increases linearly, reaching ~0.1 at 100x (very fast)
  MULTIPLIER_INCREMENT: 0.005
};

class CrashGame {
  constructor() {
    this.io = null;
    this.models = null;
    this.currentRound = {
      id: null,
      status: 'waiting',          // waiting, countdown, running, crashed
      countdown: CONFIG.COUNTDOWN_SECONDS,
      multiplier: 1.00,
      crashPoint: null,            // will be set randomly after countdown
      startTime: null,
      endTime: null,
      bets: new Map(),             // userId -> { bet, autoCashout, cashedOutAt, payout }
      totalBets: 0,
      totalPlayers: 0,
      history: []                   // last rounds
    };
    this.roundInterval = null;
    this.multiplierInterval = null;
    this.playerSockets = new Map();   // socketId -> userId
    this.userSockets = new Map();      // userId -> Set of socketIds
    this.stats = {
      totalWagered: 0,
      totalPayouts: 0,
      totalGames: 0,
      totalPlayers: 0
    };
  }

  // ---------- Public API for server.js ----------
  initialize(io, models) {
    this.io = io;
    this.models = models;
    this.startNextRound();
    console.log('✅ Crash Game initialized (custom multiplier distribution: 30% 1.0x, 30% 1.1-1.5x, 30% 1.5-3.0x, 9% 3.0-15.0x, 1% 15.0-100.0x)');
  }

  handleCrashConnection(socket) {
    // Join crash room
    socket.join('crash');

    // Store socket reference
    this.playerSockets.set(socket.id, socket.userId);
    if (!this.userSockets.has(socket.userId)) {
      this.userSockets.set(socket.userId, new Set());
    }
    this.userSockets.get(socket.userId).add(socket.id);

    // Send current round state
    socket.emit('crash:roundState', {
      status: this.currentRound.status,
      roundId: this.currentRound.id,
      countdown: this.currentRound.countdown,
      multiplier: this.currentRound.multiplier,
      history: this.currentRound.history,
      totalBets: this.currentRound.totalBets,
      totalPlayers: this.currentRound.totalPlayers
    });

    // Send user's bet if exists (for page reload / reconnect)
    const userBet = this.currentRound.bets.get(socket.userId);
    if (userBet) {
      socket.emit('crash:userBet', {
        roundId: this.currentRound.id,
        amount: userBet.amount,
        autoCashout: userBet.autoCashout,
        cashedOutAt: userBet.cashedOutAt
      });
    }

    // Attach event handlers
    socket.on('crash:placeBet', (data) => this.placeBet(socket, data));
    socket.on('crash:cashOut', () => this.cashOut(socket));
    socket.on('crash:getHistory', () => this.sendHistory(socket));
  }

  handleCrashDisconnect(socket) {
    const userId = this.playerSockets.get(socket.id);
    if (userId) {
      const userSockets = this.userSockets.get(userId);
      if (userSockets) {
        userSockets.delete(socket.id);
        if (userSockets.size === 0) {
          this.userSockets.delete(userId);
        }
      }
      this.playerSockets.delete(socket.id);
    }
    socket.leave('crash');
  }

  getCrashGameStats() {
    return {
      ...this.stats,
      currentRound: {
        id: this.currentRound.id,
        status: this.currentRound.status,
        countdown: this.currentRound.countdown,
        multiplier: this.currentRound.multiplier,
        totalBets: this.currentRound.totalBets,
        totalPlayers: this.currentRound.totalPlayers
      },
      history: this.currentRound.history
    };
  }

  getCrashPlayerList() {
    const players = [];
    for (let [userId, sockets] of this.userSockets.entries()) {
      const bet = this.currentRound.bets.get(userId);
      players.push({
        userId,
        online: sockets.size > 0,
        hasBet: !!bet,
        betAmount: bet ? bet.amount : 0,
        cashedOutAt: bet ? bet.cashedOutAt : null
      });
    }
    return players;
  }

  forceCrashRound() {
    if (this.currentRound.status === 'running') {
      this.crashRound('admin_force');
      return true;
    }
    return false;
  }

  resetCrashEarnings() {
    this.stats.totalWagered = 0;
    this.stats.totalPayouts = 0;
    this.stats.totalGames = 0;
    this.stats.totalPlayers = 0;
    return this.stats;
  }

  // ---------- Core Game Loop ----------
  generateRoundId() {
    return `CRASH_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  }

  // Random crash point generator with custom distribution:
  // 30% 1.00x, 30% 1.1-1.5, 30% 1.5-3.0, 9% 3.0-15.0, 1% 15.0-100.0
  generateCrashPoint() {
    const r = Math.random(); // [0, 1)

    if (r < 0.3) {
      return 1.00;                           // 30% – instant crash
    } else if (r < 0.6) {                     // 30% – 1.1 to 1.5
      return 1.1 + Math.random() * 0.4;       // 1.1 ... 1.5
    } else if (r < 0.9) {                     // 30% – 1.5 to 3.0
      return 1.5 + Math.random() * 1.5;       // 1.5 ... 3.0
    } else if (r < 0.99) {                    // 9% – 3.0 to 15.0
      return 3.0 + Math.random() * 12.0;      // 3.0 ... 15.0
    } else {                                  // 1% – 15.0 to MAX_MULTIPLIER (100.0)
      return 15.0 + Math.random() * (CONFIG.MAX_MULTIPLIER - 15.0);
    }
  }

  startNextRound() {
    // Clear any intervals from previous round
    if (this.roundInterval) clearInterval(this.roundInterval);
    if (this.multiplierInterval) clearInterval(this.multiplierInterval);

    // End current round if still running
    if (this.currentRound.status === 'running') {
      this.crashRound('timeout');
    }

    const roundId = this.generateRoundId();
    // crashPoint is not generated yet – will be set in startRound
    this.currentRound = {
      id: roundId,
      status: 'countdown',
      countdown: CONFIG.COUNTDOWN_SECONDS,
      multiplier: 1.00,
      crashPoint: null,
      startTime: Date.now(),
      endTime: null,
      bets: new Map(),
      totalBets: 0,
      totalPlayers: 0,
      history: this.currentRound.history || []
    };

    // Broadcast countdown start
    this.io.to('crash').emit('crash:roundCountdown', {
      roundId,
      countdown: this.currentRound.countdown
    });

    // Countdown timer
    this.roundInterval = setInterval(() => {
      if (this.currentRound.status !== 'countdown') return;
      this.currentRound.countdown--;
      this.io.to('crash').emit('crash:countdownUpdate', { countdown: this.currentRound.countdown });
      if (this.currentRound.countdown <= 0) {
        clearInterval(this.roundInterval);
        this.startRound();
      }
    }, 1000);
  }

  startRound() {
    this.currentRound.status = 'running';
    this.currentRound.startTime = Date.now();

    // ***** CRASH POINT IS GENERATED HERE (RANDOM) *****
    this.currentRound.crashPoint = this.generateCrashPoint();

    this.io.to('crash').emit('crash:roundStarted', {
      roundId: this.currentRound.id,
      multiplier: 1.00
    });

    // Start multiplier increase – now with dynamic speed:
    // slow from 1.0 to 2.0, then progressively faster up to 100.0
    this.multiplierInterval = setInterval(() => {
      if (this.currentRound.status !== 'running') return;

      // --- Dynamic increment calculation ---
      let increment = CONFIG.MULTIPLIER_INCREMENT; // base 0.005 per step

      // If multiplier is above 2.0, increase increment linearly
      if (this.currentRound.multiplier > 2.0) {
        // Factor k chosen so that increment reaches ~0.1 at 100x (20x base speed)
        // formula: increment = base * (1 + k * (multiplier - 2.0))
        // solve for k: at multiplier=100, desired increment=0.1 => k = (0.1/0.005 - 1) / 98 ≈ 0.194
        const k = 0.194;
        increment = CONFIG.MULTIPLIER_INCREMENT * (1 + k * (this.currentRound.multiplier - 2.0));
        // Cap to avoid excessively large jumps
        increment = Math.min(increment, 0.2);
      }

      // Apply increment and clamp to max multiplier
      this.currentRound.multiplier = Math.min(
        this.currentRound.multiplier + increment,
        CONFIG.MAX_MULTIPLIER
      );

      // Check for crash using the randomly generated crashPoint
      if (this.currentRound.multiplier >= this.currentRound.crashPoint) {
        this.crashRound('normal');
        return;
      }

      // Server-side auto cashout
      for (let [userId, bet] of this.currentRound.bets.entries()) {
        if (!bet.cashedOutAt && bet.autoCashout && this.currentRound.multiplier >= bet.autoCashout) {
          this.autoCashoutUser(userId).catch(err => console.error('Auto cashout failed:', err));
        }
      }

      // Broadcast multiplier
      this.io.to('crash').emit('crash:multiplierUpdate', {
        multiplier: this.currentRound.multiplier
      });
    }, CONFIG.MULTIPLIER_UPDATE_INTERVAL);
  }

  crashRound(reason) {
    clearInterval(this.multiplierInterval);
    this.currentRound.status = 'crashed';
    this.currentRound.endTime = Date.now();

    // Process all uncashed bets as losses (async but don't block)
    const lossPromises = [];
    for (let [userId, bet] of this.currentRound.bets.entries()) {
      if (!bet.cashedOutAt) {
        lossPromises.push(this.recordLoss(userId, bet));
      }
    }
    Promise.all(lossPromises).catch(err => console.error('Error recording losses:', err));

    // Update stats
    this.stats.totalGames++;
    this.stats.totalWagered += this.currentRound.totalBets;

    // Save round to history
    const roundHistory = {
      roundId: this.currentRound.id,
      crashPoint: this.currentRound.crashPoint,
      totalBets: this.currentRound.totalBets,
      players: this.currentRound.totalPlayers,
      timestamp: new Date()
    };
    this.currentRound.history.unshift(roundHistory);
    if (this.currentRound.history.length > CONFIG.ROUND_HISTORY_LIMIT) {
      this.currentRound.history.pop();
    }

    // Emit crash event
    this.io.to('crash').emit('crash:roundCrashed', {
      roundId: this.currentRound.id,
      crashPoint: this.currentRound.crashPoint,
      history: this.currentRound.history
    });

    // Schedule next round after short pause (3 seconds)
    setTimeout(() => this.startNextRound(), 3000);
  }

  // ---------- Betting & Cashout ----------
  async placeBet(socket, data) {
    const userId = socket.userId;
    if (!userId) return socket.emit('crash:error', 'Not authenticated');

    if (this.currentRound.status !== 'countdown' && this.currentRound.status !== 'waiting') {
      return socket.emit('crash:error', 'Cannot bet at this time');
    }

    const { amount, autoCashout = null } = data;
    if (amount < CONFIG.MIN_BET || amount > CONFIG.MAX_BET) {
      return socket.emit('crash:error', `Bet must be between ${CONFIG.MIN_BET} and ${CONFIG.MAX_BET} ETB`);
    }

    if (this.currentRound.bets.has(userId)) {
      return socket.emit('crash:error', 'You already placed a bet this round');
    }

    const user = await this.models.User.findOne({ userId });
    if (!user || user.balance < amount) {
      return socket.emit('crash:error', 'Insufficient balance');
    }

    user.balance -= amount;
    await user.save();

    // Store bet
    this.currentRound.bets.set(userId, {
      amount,
      autoCashout: autoCashout ? parseFloat(autoCashout) : null,
      cashedOutAt: null,
      payout: 0
    });
    this.currentRound.totalBets += amount;
    this.currentRound.totalPlayers++;

    // Record transaction with roundId
    const transaction = new this.models.Transaction({
      type: 'CRASH_BET',
      userId,
      userName: user.userName,
      amount: -amount,
      description: `Crash game bet – round ${this.currentRound.id}`,
      roundId: this.currentRound.id,
      status: 'pending'
    });
    await transaction.save();

    socket.emit('crash:betPlaced', { roundId: this.currentRound.id, amount });
    this.io.to('crash').emit('crash:totalBets', { totalBets: this.currentRound.totalBets });
  }

  async cashOut(socket) {
    const userId = socket.userId;
    if (!userId) return socket.emit('crash:error', 'Not authenticated');

    if (this.currentRound.status !== 'running') {
      return socket.emit('crash:error', 'Round not running');
    }

    const bet = this.currentRound.bets.get(userId);
    if (!bet || bet.cashedOutAt) {
      return socket.emit('crash:error', 'No active bet or already cashed out');
    }

    const multiplier = this.currentRound.multiplier;
    const payout = bet.amount * multiplier;
    bet.cashedOutAt = multiplier;
    bet.payout = payout;

    const user = await this.models.User.findOne({ userId });
    if (user) {
      user.balance += payout;
      await user.save();

      // Create win transaction with stake and agentId for agent commission system
      const transaction = new this.models.Transaction({
        type: 'CRASH_WIN',
        userId,
        userName: user.userName,
        amount: payout,
        stake: bet.amount,                     // original bet amount
        agentId: user.agentId,                  // agent at win time
        description: `Crash game win – round ${this.currentRound.id} at ${multiplier.toFixed(2)}x`,
        roundId: this.currentRound.id,
        status: 'completed'
      });
      await transaction.save();

      this.stats.totalPayouts += payout;

      socket.emit('crash:cashOutSuccess', { multiplier, payout });
      this.io.to('crash').emit('crash:playerCashedOut', { userId, multiplier });
    }
  }

  async autoCashoutUser(userId) {
    const bet = this.currentRound.bets.get(userId);
    if (!bet || bet.cashedOutAt) return;

    const multiplier = this.currentRound.multiplier;
    const payout = bet.amount * multiplier;
    bet.cashedOutAt = multiplier;
    bet.payout = payout;

    const user = await this.models.User.findOne({ userId });
    if (user) {
      user.balance += payout;
      await user.save();

      // Create win transaction with stake and agentId for agent commission system
      await this.models.Transaction.create({
        type: 'CRASH_WIN',
        userId,
        userName: user.userName,
        amount: payout,
        stake: bet.amount,
        agentId: user.agentId,
        description: `Crash game win (auto) – round ${this.currentRound.id} at ${multiplier.toFixed(2)}x`,
        roundId: this.currentRound.id,
        status: 'completed'
      });

      this.stats.totalPayouts += payout;

      // Notify all clients
      this.io.to('crash').emit('crash:playerCashedOut', { userId, multiplier });
    }
  }

  async recordLoss(userId, bet) {
    // Update only the pending bet for this specific round
    await this.models.Transaction.updateMany(
      {
        userId,
        type: 'CRASH_BET',
        roundId: this.currentRound.id,
        status: 'pending'
      },
      {
        status: 'lost',
        description: `Crash game loss – round ${this.currentRound.id}`
      }
    );
    // No balance change (already deducted)
  }

  sendHistory(socket) {
    socket.emit('crash:history', this.currentRound.history);
  }
}

// Export a singleton instance
const crashGame = new CrashGame();
module.exports = crashGame;
