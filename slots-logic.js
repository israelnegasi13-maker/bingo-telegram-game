// slots-logic.js - Server-side Slots Galaxy game logic (3‑reel classic)
// Updated: 10 symbols, any pair wins 2x, three-of-a-kind multipliers up to 50x
// Overall RTP: 92.4% (house edge 7.6%)

const crypto = require('crypto');

class SlotsGame {
  constructor() {
    this.io = null;
    this.models = null;

    this.stats = {
      totalGames: 0,
      totalWagered: 0,
      totalPayouts: 0
    };

    // Single payline: indices 0,1,2 (the three reels)
    this.paylines = [[0, 1, 2]];

    // Payout multipliers for three of a kind (10 symbols, sum = 384)
    // Pair wins are always 2x
    this.symbolPayouts = [50, 37, 37, 37, 37, 37, 37, 37, 37, 38];
  }

  initialize(io, models) {
    this.io = io;
    this.models = models;
    console.log('✅ Slots Galaxy initialized (10 symbols, top multiplier 50x, 92.4% RTP)');
  }

  handleSlotsConnection(socket) {
    socket.on('slots:spin', async (data) => {
      await this.handleSpin(socket, data);
    });

    socket.on('slots:getStats', async () => {
      await this.sendStats(socket);
    });
  }

  handleSlotsDisconnect(socket) {}

  async handleSpin(socket, { userId, bet }) {
    try {
      const allowedBets = [5, 10, 20, 50, 100];
      if (!allowedBets.includes(bet)) {
        return socket.emit('slots:error', 'Invalid bet amount');
      }

      const User = this.models.User;
      const user = await User.findOne({ userId });
      if (!user) {
        return socket.emit('slots:error', 'User not found');
      }

      if (user.balance < bet) {
        return socket.emit('slots:error', 'Insufficient balance');
      }

      // --- Deduct bet & update wagered total ---
      user.balance -= bet;
      user.totalWagered = (user.totalWagered || 0) + bet;

      // Generate 3 random symbols (0‑9)
      const symbols = this.generateRandomSymbols(3);
      const winAmount = this.calculateWin(symbols, bet);

      let netWin = 0;
      if (winAmount > 0) {
        user.balance += winAmount;
        netWin = winAmount - bet;
        user.totalWins = (user.totalWins || 0) + winAmount;
      }

      // --- Single database save (all updates at once) ---
      await user.save();

      // Record transaction
      const Transaction = this.models.Transaction;
      const transaction = new Transaction({
        type: winAmount > 0 ? 'SLOTS_WIN' : 'SLOTS_LOSS',
        userId: user.userId,
        userName: user.userName,
        amount: winAmount > 0 ? winAmount : -bet,
        description: `Slots spin: bet ${bet} ETB, won ${winAmount} ETB`,
        status: 'completed'
      });
      await transaction.save();

      // Update daily stats
      await this.updateDailyStats(bet, winAmount);

      // Agent commission if applicable
      if (netWin > 0 && user.agentId) {
        await this.recordAgentCommission(user, netWin, bet, winAmount);
      }

      // Send result to client
      socket.emit('slots:spinResult', {
        symbols,          // e.g. [2,2,2]
        winAmount,
        multiplier: winAmount / bet,
        newBalance: user.balance
      });

      // Broadcast updated balance
      this.io.to(socket.id).emit('balanceUpdate', user.balance);

      // Update internal stats
      this.stats.totalGames++;
      this.stats.totalWagered += bet;
      this.stats.totalPayouts += winAmount;

    } catch (error) {
      console.error('Slots spin error:', error);
      socket.emit('slots:error', 'Internal error');
    }
  }

  generateRandomSymbols(count) {
    const symbols = [];
    for (let i = 0; i < count; i++) {
      symbols.push(Math.floor(Math.random() * 10)); // 0‑9
    }
    return symbols;
  }

  // Win if all three same (using symbolPayouts) OR any two same (2×)
  calculateWin(symbols, bet) {
    const [a, b, c] = symbols;
    // Three of a kind
    if (a === b && b === c) {
      const multiplier = this.symbolPayouts[a];
      return Math.round(bet * multiplier * 100) / 100;
    }
    // Two of a kind
    if (a === b || a === c || b === c) {
      return Math.round(bet * 2 * 100) / 100; // 2×
    }
    return 0;
  }

  async updateDailyStats(bet, win) {
    try {
      const Stats = this.models.Stats;
      const today = new Date().toISOString().split('T')[0];
      let stats = await Stats.findOne({ date: today });
      if (!stats) {
        stats = new Stats({ date: today });
      }
      stats.totalSlotsWagered = (stats.totalSlotsWagered || 0) + bet;
      stats.totalSlotsPayouts = (stats.totalSlotsPayouts || 0) + win;
      stats.totalSlotsGames = (stats.totalSlotsGames || 0) + 1;
      await stats.save();
    } catch (err) {
      console.error('Error updating slots daily stats:', err);
    }
  }

  async recordAgentCommission(user, netWin, bet, winAmount) {
    try {
      if (!user.agentId) return;
      const Agent = this.models.Agent;
      const agent = await Agent.findById(user.agentId);
      if (!agent || !agent.isActive) return;

      const commissionAmount = netWin * 0.10;  // 10% commission
      const txKey = `slots_${user.userId}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

      const AgentCommission = this.models.AgentCommission;
      const commission = new AgentCommission({
        agentId: agent._id,
        userId: user.userId,
        transactionKey: txKey,
        userName: user.userName,
        telegramUsername: user.telegramUsername,
        gameType: 'SLOTS',
        stake: bet,
        winningAmount: winAmount,
        commissionRate: 10,
        commissionAmount,
        status: 'completed'
      });
      await commission.save();

      agent.totalEarnings = (agent.totalEarnings || 0) + commissionAmount;
      agent.lastCommissionDate = new Date();
      await agent.save();

      user.agentCommissionEarned = (user.agentCommissionEarned || 0) + commissionAmount;
      await user.save();

      console.log(`💰 Agent ${agent.username} earned ${commissionAmount} ETB from slots user ${user.userName}`);
    } catch (err) {
      console.error('Error recording agent commission for slots:', err);
    }
  }

  async sendStats(socket) {
    try {
      const Stats = this.models.Stats;
      const today = new Date().toISOString().split('T')[0];
      const stats = await Stats.findOne({ date: today });
      socket.emit('slots:stats', {
        totalGames: stats?.totalSlotsGames || 0,
        totalWagered: stats?.totalSlotsWagered || 0,
        totalPayouts: stats?.totalSlotsPayouts || 0
      });
    } catch (err) {
      console.error('Error sending slots stats:', err);
      socket.emit('slots:stats', { totalGames:0, totalWagered:0, totalPayouts:0 });
    }
  }

  getSlotsGameStats() {
    return { ...this.stats };
  }

  async resetSlotsEarnings() {
    this.stats = { totalGames:0, totalWagered:0, totalPayouts:0 };
    return this.stats;
  }
}

module.exports = new SlotsGame();
