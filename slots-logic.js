// slots-logic.js - Server-side Slots Galaxy game logic
// Fully integrated with agent system (10% commission on total win)

class SlotsGame {
  constructor() {
    this.io = null;
    this.models = null;
    this.agentSystem = null;  // will be set from server.js

    this.stats = {
      totalGames: 0,
      totalWagered: 0,
      totalPayouts: 0
    };

    // Single payline (all three reels)
    this.paylines = [[0, 1, 2]];
  }

  initialize(io, models) {
    this.io = io;
    this.models = models;
    console.log('✅ Slots Galaxy initialized (10 symbols, pair wins 2×, agent commission 10% on total win)');
  }

  // Called from server.js to give access to the agent system
  setAgentSystem(agentSystem) {
    this.agentSystem = agentSystem;
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

      // Generate 3 random symbols (0‑9) ensuring they are NOT all identical
      const symbols = this.generateRandomSymbolsNoTriplets();
      const winAmount = this.calculateWin(symbols, bet); // total win (2× bet)

      if (winAmount > 0) {
        user.balance += winAmount;
        user.totalWins = (user.totalWins || 0) + winAmount;
      }

      // --- Save user (balance already updated) ---
      await user.save();

      // --- Create transaction record ---
      const Transaction = this.models.Transaction;
      const transaction = new Transaction({
        type: winAmount > 0 ? 'SLOTS_WIN' : 'SLOTS_LOSS',
        userId: user.userId,
        userName: user.userName,
        amount: winAmount > 0 ? winAmount : -bet,
        stake: bet,                                 // store stake for agent commission
        agentId: user.agentId,                      // agent at win time
        description: `Slots spin: bet ${bet} ETB, won ${winAmount} ETB`,
        status: 'completed'
      });
      await transaction.save();

      // --- If it's a win and the user has an agent, process commission immediately ---
      if (winAmount > 0 && user.agentId && this.agentSystem) {
        // The agent system's processGameTransaction will call recordCommission
        // using the transaction's agentId, stake and total win amount.
        // Commission = total win * (agent's slots rate / 100) – by default 10%.
        this.agentSystem.processGameTransaction(transaction)
          .catch(err => console.error('Error processing agent commission for slots:', err));
      }

      // --- Update daily stats ---
      await this.updateDailyStats(bet, winAmount);

      // --- Update internal stats ---
      this.stats.totalGames++;
      this.stats.totalWagered += bet;
      this.stats.totalPayouts += winAmount;

      // --- Send result to client ---
      socket.emit('slots:spinResult', {
        symbols,
        winAmount,
        multiplier: winAmount / bet,
        newBalance: user.balance
      });

    } catch (error) {
      console.error('Slots spin error:', error);
      socket.emit('slots:error', 'Internal error');
    }
  }

  // Generate three symbols (0‑9) with the guarantee that they are NOT all the same
  generateRandomSymbolsNoTriplets() {
    let a, b, c;
    do {
      a = Math.floor(Math.random() * 10);
      b = Math.floor(Math.random() * 10);
      c = Math.floor(Math.random() * 10);
    } while (a === b && b === c);
    return [a, b, c];
  }

  // Win if any two symbols match → 2× bet
  calculateWin(symbols, bet) {
    const [a, b, c] = symbols;
    if (a === b || a === c || b === c) {
      return Math.round(bet * 2 * 100) / 100; // 2×, rounded to 2 decimals
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
