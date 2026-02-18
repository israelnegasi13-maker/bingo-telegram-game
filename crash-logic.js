// crash-logic.js - Professional Crash Game (Aviator style) for ETHIO GAMES
const CONFIG = {
  MIN_BET: 5,
  MAX_BET: 5000,
  COUNTDOWN_SECONDS: 5,
  ROUND_DURATION: 30 * 1000,          // 30 seconds total (including countdown)
  MULTIPLIER_UPDATE_INTERVAL: 100,     // 100ms updates
  HOUSE_EDGE: 0.05,                    // 5% house edge
  MAX_MULTIPLIER: 1000,                 // safety cap
  COMMISSION_RATE: 0.10,                // 10% agent commission (same as Keno)
  ROUND_HISTORY_LIMIT: 10
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
      crashPoint: null,
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
    console.log('✅ Crash Game initialized');
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
      crashPoint: this.currentRound.crashPoint, // for debugging only – remove in production
      history: this.currentRound.history,
      totalBets: this.currentRound.totalBets,
      totalPlayers: this.currentRound.totalPlayers
    });

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

  generateCrashPoint() {
    // Random crash point with house edge: 1 / (random * (1 - edge))
    // Example: edge 0.05 => average multiplier ~ 1.0526
    const r = Math.random();
    // Ensure crash point is at least 1.00
    return Math.max(1.00, 1 / (r * (1 - CONFIG.HOUSE_EDGE)));
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
    const crashPoint = this.generateCrashPoint();

    this.currentRound = {
      id: roundId,
      status: 'countdown',
      countdown: CONFIG.COUNTDOWN_SECONDS,
      multiplier: 1.00,
      crashPoint,
      startTime: Date.now(),
      endTime: null,
      bets: new Map(),
      totalBets: 0,
      totalPlayers: 0,
      history: this.currentRound.history || []
    };

    // Broadcast countdown start to crash room
    this.io.to('crash').emit('crash:roundCountdown', {
      roundId,
      countdown: this.currentRound.countdown,
      crashPoint // only for debugging – remove in production
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
    this.io.to('crash').emit('crash:roundStarted', {
      roundId: this.currentRound.id,
      multiplier: 1.00
    });

    // Start multiplier increase
    this.multiplierInterval = setInterval(() => {
      if (this.currentRound.status !== 'running') return;

      // Increase multiplier (simple linear – you can use easing for smoother feel)
      this.currentRound.multiplier = Math.min(
        this.currentRound.multiplier + 0.01,
        CONFIG.MAX_MULTIPLIER
      );

      // Check for crash
      if (this.currentRound.multiplier >= this.currentRound.crashPoint) {
        this.crashRound('normal');
        return;
      }

      // Broadcast multiplier to all players in crash room
      this.io.to('crash').emit('crash:multiplierUpdate', {
        multiplier: this.currentRound.multiplier
      });
    }, CONFIG.MULTIPLIER_UPDATE_INTERVAL);
  }

  crashRound(reason) {
    clearInterval(this.multiplierInterval);
    this.currentRound.status = 'crashed';
    this.currentRound.endTime = Date.now();

    // Process all uncashed bets as losses
    for (let [userId, bet] of this.currentRound.bets.entries()) {
      if (!bet.cashedOutAt) {
        // Bet lost – mark transaction as lost
        this.recordLoss(userId, bet);
      }
    }

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

    // Emit crash event to all players
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

    // Validate round state
    if (this.currentRound.status !== 'countdown' && this.currentRound.status !== 'waiting') {
      return socket.emit('crash:error', 'Cannot bet at this time');
    }

    const { amount, autoCashout = null } = data;
    if (amount < CONFIG.MIN_BET || amount > CONFIG.MAX_BET) {
      return socket.emit('crash:error', `Bet must be between ${CONFIG.MIN_BET} and ${CONFIG.MAX_BET} ETB`);
    }

    // Check if user already has a bet this round
    if (this.currentRound.bets.has(userId)) {
      return socket.emit('crash:error', 'You already placed a bet this round');
    }

    // Check user balance
    const user = await this.models.User.findOne({ userId });
    if (!user || user.balance < amount) {
      return socket.emit('crash:error', 'Insufficient balance');
    }

    // Deduct balance immediately
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

    // Record transaction (pending)
    const transaction = new this.models.Transaction({
      type: 'CRASH_BET',
      userId,
      userName: user.userName,
      amount: -amount,
      description: `Crash game bet – round ${this.currentRound.id}`,
      status: 'pending'   // will be updated on win/loss
    });
    await transaction.save();

    // Notify player
    socket.emit('crash:betPlaced', { roundId: this.currentRound.id, amount });

    // Broadcast updated total bets to all
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

    // Calculate payout
    const multiplier = this.currentRound.multiplier;
    const payout = bet.amount * multiplier;
    bet.cashedOutAt = multiplier;
    bet.payout = payout;

    // Update user balance
    const user = await this.models.User.findOne({ userId });
    if (user) {
      user.balance += payout;
      await user.save();

      // Record win transaction
      const transaction = new this.models.Transaction({
        type: 'CRASH_WIN',
        userId,
        userName: user.userName,
        amount: payout,
        description: `Crash game win – round ${this.currentRound.id} at ${multiplier.toFixed(2)}x`,
        status: 'completed'
      });
      await transaction.save();

      // Update stats
      this.stats.totalPayouts += payout;

      // **Agent Commission** (10% of net win)
      const netWin = payout - bet.amount;
      if (netWin > 0 && user.agentId) {
        await this.processAgentCommission(user, netWin, this.currentRound.id);
      }

      // Notify player
      socket.emit('crash:cashOutSuccess', { multiplier, payout });
      this.io.to('crash').emit('crash:playerCashedOut', { userId, multiplier }); // optional

      // Update total bets display (decrease total bets? not necessary)
    }
  }

  async recordLoss(userId, bet) {
    // Update transaction status to lost
    await this.models.Transaction.updateMany(
      { userId, type: 'CRASH_BET', status: 'pending' },
      { status: 'lost', description: `Crash game loss – round ${this.currentRound.id}` }
    );
    // No balance change (already deducted)
  }

  async processAgentCommission(user, netWin, roundId) {
    try {
      const agent = await this.models.Agent.findById(user.agentId);
      if (!agent || !agent.isActive) return;

      const commission = netWin * CONFIG.COMMISSION_RATE;
      if (commission <= 0) return;

      // Create commission record
      const commissionRecord = new this.models.AgentCommission({
        agentId: agent._id,
        userId: user.userId,
        userName: user.userName,
        telegramUsername: user.telegramUsername,
        gameType: 'CRASH',
        stake: netWin, // net win is the basis for commission? Actually commission on net win.
        winningAmount: netWin,
        commissionRate: CONFIG.COMMISSION_RATE,
        commissionAmount: commission,
        status: 'completed'
      });
      await commissionRecord.save();

      // Update agent totals
      agent.totalEarnings += commission;
      agent.lastCommissionDate = new Date();
      await agent.save();

      // Update user's agent commission earned
      user.agentCommissionEarned = (user.agentCommissionEarned || 0) + commission;
      await user.save();

      console.log(`💰 Agent ${agent.username} earned ${commission} ETB from crash game (user ${user.userName})`);
    } catch (err) {
      console.error('Error processing crash agent commission:', err);
    }
  }

  sendHistory(socket) {
    socket.emit('crash:history', this.currentRound.history);
  }
}

// Export a singleton instance
const crashGame = new CrashGame();
module.exports = crashGame;