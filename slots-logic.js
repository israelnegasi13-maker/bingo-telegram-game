// slots-logic.js - Server-side Slots Galaxy game logic
// Integrates with existing User, Transaction, Stats, AgentCommission models

const crypto = require('crypto');

class SlotsGame {
  constructor() {
    this.io = null;
    this.models = null;

    // in‑memory stats (also persisted daily in Stats model)
    this.stats = {
      totalGames: 0,
      totalWagered: 0,
      totalPayouts: 0
    };

    // Paylines definition for 3x3 grid (indices 0‑8)
    // 0 1 2
    // 3 4 5
    // 6 7 8
    this.paylines = [
      [0,1,2], // top row
      [3,4,5], // middle row
      [6,7,8], // bottom row
      [0,4,8], // diagonal top‑left to bottom‑right
      [2,4,6]  // diagonal top‑right to bottom‑left
    ];

    // Symbol pay multipliers (for 3 in a line)
    // order matches SYMBOLS array in frontend: 🌌,🌠,🪐,👽,🚀,🌟,☄️,👾
    this.symbolPayouts = [5, 10, 15, 20, 30, 40, 50, 100];
  }

  initialize(io, models) {
    this.io = io;
    this.models = models;
    console.log('✅ Slots Galaxy initialized');
  }

  // Called when a client connects (attach event listeners)
  handleSlotsConnection(socket) {
    socket.on('slots:spin', async (data) => {
      await this.handleSpin(socket, data);
    });

    socket.on('slots:getStats', async () => {
      await this.sendStats(socket);
    });
  }

  // Called on disconnect (nothing needed now)
  handleSlotsDisconnect(socket) {}

  // ---------- Core spin logic ----------
  async handleSpin(socket, { userId, bet }) {
    try {
      // 1. validate bet
      const allowedBets = [5, 10, 20, 50, 100];
      if (!allowedBets.includes(bet)) {
        return socket.emit('slots:error', 'Invalid bet amount');
      }

      // 2. get user
      const User = this.models.User;
      const user = await User.findOne({ userId });
      if (!user) {
        return socket.emit('slots:error', 'User not found');
      }

      // 3. check balance
      if (user.balance < bet) {
        return socket.emit('slots:error', 'Insufficient balance');
      }

      // 4. deduct bet
      user.balance -= bet;
      user.totalWagered = (user.totalWagered || 0) + bet;
      await user.save();

      // 5. generate random symbols (9 symbols)
      const symbols = this.generateRandomSymbols(9);
      const winAmount = this.calculateWin(symbols, bet);

      // 6. update user balance with win
      let netWin = 0;
      if (winAmount > 0) {
        user.balance += winAmount;
        netWin = winAmount - bet; // net profit (could be negative if win < bet, but winAmount already includes bet? We treat winAmount as total payout)
        await user.save();

        // update user stats
        user.totalWins = (user.totalWins || 0) + winAmount;
        await user.save();
      }

      // 7. create transaction record
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

      // 8. update daily stats
      await this.updateDailyStats(bet, winAmount);

      // 9. if netWin > 0, handle agent commission (10% of net win)
      if (netWin > 0 && user.agentId) {
        await this.recordAgentCommission(user, netWin, bet, winAmount);
      }

      // 10. send result back to client
      socket.emit('slots:spinResult', {
        symbols,
        winAmount,
        multiplier: winAmount / bet,
        newBalance: user.balance
      });

      // 11. broadcast balance update to all client tabs
      this.io.to(socket.id).emit('balanceUpdate', user.balance);

      // 12. update in‑memory stats
      this.stats.totalGames++;
      this.stats.totalWagered += bet;
      this.stats.totalPayouts += winAmount;

    } catch (error) {
      console.error('Slots spin error:', error);
      socket.emit('slots:error', 'Internal error');
    }
  }

  // Generate array of random symbol indices (0‑7)
  generateRandomSymbols(count) {
    const symbols = [];
    for (let i = 0; i < count; i++) {
      symbols.push(Math.floor(Math.random() * 8));
    }
    return symbols;
  }

  // Calculate total win based on paylines
  calculateWin(symbols, bet) {
    let totalWin = 0;
    const lines = this.paylines.length;

    // For each payline, check if all three symbols are identical
    for (let line of this.paylines) {
      const [a, b, c] = line;
      if (symbols[a] === symbols[b] && symbols[b] === symbols[c]) {
        const symbolIdx = symbols[a];
        const multiplier = this.symbolPayouts[symbolIdx];
        // win per line = bet per line * multiplier
        // we distribute bet evenly across lines (bet / lines)
        const lineBet = bet / lines;
        totalWin += lineBet * multiplier;
      }
    }

    // Round to 2 decimals to avoid floating issues
    return Math.round(totalWin * 100) / 100;
  }

  // Update daily stats in MongoDB
  async updateDailyStats(bet, win) {
    try {
      const Stats = this.models.Stats;
      const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

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

  // Record agent commission (10% of net win)
  async recordAgentCommission(user, netWin, bet, winAmount) {
    try {
      const AgentCommission = this.models.AgentCommission;
      const Agent = this.models.Agent;
      const Referral = this.models.Referral;

      // find agent through referral (user.agentId)
      if (!user.agentId) return;

      const agent = await Agent.findById(user.agentId);
      if (!agent || !agent.isActive) return;

      const commissionAmount = netWin * 0.10; // 10% of net profit

      // create a unique transaction key to prevent duplicates
      const txKey = `slots_${user.userId}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

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

      // update agent totals
      agent.totalEarnings = (agent.totalEarnings || 0) + commissionAmount;
      agent.lastCommissionDate = new Date();
      await agent.save();

      // update user's commission earned field
      user.agentCommissionEarned = (user.agentCommissionEarned || 0) + commissionAmount;
      await user.save();

      console.log(`💰 Agent ${agent.username} earned ${commissionAmount} ETB from slots user ${user.userName}`);
    } catch (err) {
      console.error('Error recording agent commission for slots:', err);
    }
  }

  // Send aggregated stats to client (for stats modal)
  async sendStats(socket) {
    try {
      const Stats = this.models.Stats;
      const today = new Date().toISOString().split('T')[0];
      const stats = await Stats.findOne({ date: today });

      const totalGames = stats?.totalSlotsGames || 0;
      const totalWagered = stats?.totalSlotsWagered || 0;
      const totalPayouts = stats?.totalSlotsPayouts || 0;

      socket.emit('slots:stats', {
        totalGames,
        totalWagered,
        totalPayouts
      });
    } catch (err) {
      console.error('Error sending slots stats:', err);
      socket.emit('slots:stats', { totalGames:0, totalWagered:0, totalPayouts:0 });
    }
  }

  // For admin panel – get current stats
  getSlotsGameStats() {
    return {
      totalGames: this.stats.totalGames,
      totalWagered: this.stats.totalWagered,
      totalPayouts: this.stats.totalPayouts
    };
  }

  // Admin: reset earnings (clear in‑memory stats, optionally also DB)
  async resetSlotsEarnings() {
    this.stats = { totalGames:0, totalWagered:0, totalPayouts:0 };
    // You could also reset today's DB stats if desired, but that's optional.
    return this.stats;
  }
}

module.exports = new SlotsGame();