// bot-manager.js – 20 human‑like bots for Bingo Elite
const { io } = require('socket.io-client');
// Optional: const { v4: uuidv4 } = require('uuid');

// Ethiopian names (8 male, 2 female) – same as in bot-squad.html
const NAMES = [
  'Abel', 'Addis', 'Akili', 'Alemu', 'Aman', 'Amare', 'Ashenafi', 'Bereket',  // male
  'Betty', 'Bilen'                                                             // female
];

// Default starting balance for each bot (ETB)
const START_BALANCE = 5000;

// Bot personalities – affect reaction time, activity level
const PERSONALITIES = [
  { claimDelay: [1000, 3000],   activity: 0.9, name: 'eager' },   // quick to claim
  { claimDelay: [3000, 7000],   activity: 0.6, name: 'casual' },  // normal
  { claimDelay: [5000, 10000],  activity: 0.3, name: 'slow' }     // slow, sometimes inactive
];

class BotManager {
  constructor(serverUrl, models) {
    this.serverUrl = serverUrl;
    this.models = models;
    this.bots = [];               // array of bot objects
    this.activeBots = new Set();  // currently connected bot indices
    this.running = false;
    this.interval = null;
  }

  async initialize() {
    console.log('🤖 BotManager initializing...');
    // Create or fetch bot users from DB
    for (let i = 0; i < 20; i++) {
      const name = NAMES[i % NAMES.length] + (Math.floor(i / NAMES.length) || '');
      const userId = `bot_${name}_${i}`;
      let user = await this.models.User.findOne({ userId });
      if (!user) {
        user = new this.models.User({
          userId,
          userName: name,
          balance: START_BALANCE,
          referralCode: `BOT${i}${Date.now()}`,
          isBot: true  // optional flag
        });
        await user.save();
        console.log(`✅ Created bot user: ${name} (${userId})`);
      } else {
        // Ensure bot has enough balance to play
        if (user.balance < 100) {
          user.balance = START_BALANCE;
          await user.save();
          console.log(`💰 Refilled balance for bot ${name} to ${START_BALANCE} ETB`);
        } else {
          console.log(`✅ Found existing bot: ${name} (${userId}) balance: ${user.balance}`);
        }
      }
      this.bots.push({
        index: i,
        name,
        userId,
        personality: PERSONALITIES[i % PERSONALITIES.length],
        socket: null,
        connected: false,
        currentRoom: null,
        currentBox: null,
        grid: null,                // will be set when game starts
        markedNumbers: [],
        inGame: false,
        lastAction: 0
      });
    }
    console.log(`🤖 BotManager ready with ${this.bots.length} bots`);
  }

  start() {
    if (this.running) return;
    this.running = true;
    console.log('▶️ Starting bot manager – bots will join games like humans');

    // Connect bots gradually (max 3 at a time to avoid flooding)
    this.connectNextBatch(0, 3);

    // Main decision loop – every 10 seconds bots decide to join/leave
    this.interval = setInterval(() => this.botDecisions(), 10000);
  }

  stop() {
    this.running = false;
    clearInterval(this.interval);
    this.bots.forEach(bot => {
      if (bot.socket) bot.socket.disconnect();
    });
    console.log('⏹️ Bot manager stopped');
  }

  // Connect a batch of bots (maxConcurrent at a time)
  connectNextBatch(startIndex, maxConcurrent) {
    if (!this.running) return;
    let connected = 0;
    for (let i = startIndex; i < this.bots.length && connected < maxConcurrent; i++) {
      if (!this.bots[i].connected) {
        this.connectBot(i);
        connected++;
      }
    }
    // After all bots attempted, schedule reconnection for disconnected ones
    if (startIndex + maxConcurrent < this.bots.length) {
      setTimeout(() => this.connectNextBatch(startIndex + maxConcurrent, maxConcurrent), 2000);
    } else {
      // Re‑check disconnected bots every minute
      setTimeout(() => this.reconnectDisconnected(), 60000);
    }
  }

  connectBot(index) {
    const bot = this.bots[index];
    if (bot.connected) return;

    console.log(`🔌 Connecting bot ${bot.name} (${bot.userId}) – attempt`);
    const socket = io(this.serverUrl, {
      transports: ['websocket'],
      reconnection: false, // we handle reconnection manually
      query: { userId: bot.userId, isBot: 'true' }
    });

    bot.socket = socket;
    bot.connected = false; // will be set true after init

    socket.on('connect', () => {
      console.log(`✅ Bot ${bot.name} socket connected, emitting init...`);
      socket.emit('init', { userId: bot.userId, userName: bot.name }, (resp) => {
        console.log(`📩 Bot ${bot.name} init response:`, resp);
        if (resp && resp.success) {
          bot.connected = true;
          this.activeBots.add(index);
          console.log(`🎮 Bot ${bot.name} initialized successfully`);
        } else {
          console.log(`❌ Bot ${bot.name} init failed – disconnecting`);
          socket.disconnect();
        }
      });
    });

    socket.on('connect_error', (err) => {
      console.log(`⚠️ Bot ${bot.name} connection error: ${err.message}`);
    });

    socket.on('disconnect', (reason) => {
      console.log(`🔌 Bot ${bot.name} disconnected (${reason})`);
      bot.connected = false;
      bot.currentRoom = null;
      bot.currentBox = null;
      bot.inGame = false;
      this.activeBots.delete(index);
    });

    // Game event listeners
    socket.on('balanceUpdate', (balance) => {
      bot.balance = balance;
    });

    socket.on('gameStarted', (data) => {
      if (data.room && bot.currentRoom === data.room) {
        bot.inGame = true;
        // Generate a bingo grid for this game (or reuse stored)
        bot.grid = this.generateBingoGrid();
        bot.markedNumbers = ['FREE'];  // FREE is always marked
        console.log(`🎲 Bot ${bot.name} game started in room ${data.room}`);
      }
    });

    socket.on('ballDrawn', (data) => {
      if (!bot.inGame || data.room !== bot.currentRoom) return;
      const num = data.num;
      // Check if number is in bot's grid
      if (bot.grid.includes(num) && !bot.markedNumbers.includes(num)) {
        bot.markedNumbers.push(num);
        // Check if bot now has bingo
        if (this.checkBingo(bot.grid, bot.markedNumbers)) {
          // Simulate human reaction delay
          const delay = this.getClaimDelay(bot);
          console.log(`⚡ Bot ${bot.name} has BINGO! Claiming in ${delay}ms`);
          setTimeout(() => {
            if (bot.inGame && bot.currentRoom === data.room) {
              this.claimBingo(bot, data.room);
            }
          }, delay);
        }
      }
    });

    socket.on('gameOver', (data) => {
      if (data.room === bot.currentRoom) {
        console.log(`🏁 Bot ${bot.name} game over in room ${data.room}`);
        bot.inGame = false;
        bot.currentRoom = null;
        bot.currentBox = null;
        // Bot may decide to rejoin later
      }
    });

    socket.on('boxesCleared', (data) => {
      if (data.room === bot.currentRoom) {
        console.log(`🧹 Bot ${bot.name} boxes cleared for room ${data.room}`);
        bot.currentRoom = null;
        bot.currentBox = null;
        bot.inGame = false;
      }
    });

    // Error handling
    socket.on('error', (err) => {
      console.log(`⚠️ Bot ${bot.name} socket error:`, err);
    });
  }

  // Called periodically to make bots decide to join or leave rooms
  botDecisions() {
    if (!this.running) return;
    this.bots.forEach((bot, index) => {
      if (!bot.connected) return;

      // Skip bots that are in a game (they are already playing)
      if (bot.inGame) return;

      // Decide randomly based on personality activity
      const rand = Math.random();
      if (rand > bot.personality.activity) return; // bot is inactive now

      // If bot is already in a waiting room, maybe leave?
      if (bot.currentRoom) {
        // 20% chance to leave waiting room
        if (Math.random() < 0.2) {
          this.leaveRoom(bot);
        }
        return;
      }

      // Bot is idle – decide to join a room (mostly 10 ETB)
      const stake = this.chooseStake(); // 10, 20, 50, 100
      this.joinRoom(bot, stake);
    });
  }

  chooseStake() {
    const r = Math.random();
    if (r < 0.7) return 10;      // 70% chance for 10 ETB
    if (r < 0.85) return 20;     // 15% for 20 ETB
    if (r < 0.95) return 50;     // 10% for 50 ETB
    return 100;                   // 5% for 100 ETB
  }

  joinRoom(bot, stake) {
    if (!bot.socket || !bot.connected) return;
    // Get taken boxes for this room
    bot.socket.emit('getTakenBoxes', { room: stake }, (taken) => {
      if (!Array.isArray(taken)) taken = [];
      // Find an available box (1–100 not in taken)
      let available = null;
      for (let attempt = 0; attempt < 50; attempt++) {
        const box = Math.floor(Math.random() * 100) + 1;
        if (!taken.includes(box)) {
          available = box;
          break;
        }
      }
      if (!available) {
        console.log(`⚠️ Bot ${bot.name} – no free box in ${stake} ETB room, trying later`);
        return;
      }

      bot.socket.emit('joinRoom', { room: stake, box: available, userName: bot.name }, (resp) => {
        if (resp && resp.success) {
          bot.currentRoom = stake;
          bot.currentBox = available;
          console.log(`🎯 Bot ${bot.name} joined ${stake} ETB room, box ${available}`);
        } else {
          console.log(`❌ Bot ${bot.name} failed to join room:`, resp?.message || 'unknown error');
        }
      });
    });
  }

  leaveRoom(bot) {
    if (!bot.socket || !bot.connected || !bot.currentRoom) return;
    bot.socket.emit('player:leaveRoom', {}, (resp) => {
      if (resp && resp.success) {
        console.log(`🚪 Bot ${bot.name} left room ${bot.currentRoom}`);
        bot.currentRoom = null;
        bot.currentBox = null;
      }
    });
  }

  claimBingo(bot, room) {
    if (!bot.socket || !bot.connected || !bot.inGame) return;
    bot.socket.emit('claimBingo', {
      room: room,
      grid: bot.grid,
      marked: bot.markedNumbers
    }, (resp) => {
      if (resp && resp.success) {
        console.log(`🏆 Bot ${bot.name} claimed BINGO in room ${room}!`);
      } else {
        // claim failed – maybe someone else won first
        console.log(`❌ Bot ${bot.name} BINGO claim rejected:`, resp?.message || 'unknown');
      }
    });
  }

  getClaimDelay(bot) {
    const [min, max] = bot.personality.claimDelay;
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  // Reconnect bots that are disconnected
  reconnectDisconnected() {
    this.bots.forEach((bot, idx) => {
      if (!bot.connected && this.running) {
        console.log(`♻️ Reconnecting bot ${bot.name}`);
        this.connectBot(idx);
      }
    });
  }

  // Bingo helper: generate a random 5x5 grid
  generateBingoGrid() {
    const grid = [];
    const cols = [
      { letter: 'B', min: 1, max: 15 },
      { letter: 'I', min: 16, max: 30 },
      { letter: 'N', min: 31, max: 45 },
      { letter: 'G', min: 46, max: 60 },
      { letter: 'O', min: 61, max: 75 }
    ];
    for (let col = 0; col < 5; col++) {
      const { min, max } = cols[col];
      const numbers = [];
      while (numbers.length < 5) {
        const n = Math.floor(Math.random() * (max - min + 1)) + min;
        if (!numbers.includes(n)) numbers.push(n);
      }
      for (let row = 0; row < 5; row++) {
        const index = row * 5 + col;
        grid[index] = numbers[row];
      }
    }
    // FREE space at center
    grid[12] = 'FREE';
    return grid;
  }

  checkBingo(grid, marked) {
    // Standard bingo patterns: rows, columns, diagonals
    const patterns = [
      [0,1,2,3,4], [5,6,7,8,9], [10,11,12,13,14], [15,16,17,18,19], [20,21,22,23,24], // rows
      [0,5,10,15,20], [1,6,11,16,21], [2,7,12,17,22], [3,8,13,18,23], [4,9,14,19,24], // columns
      [0,6,12,18,24], [4,8,12,16,20] // diagonals
    ];
    for (const pat of patterns) {
      if (pat.every(idx => {
        const val = grid[idx];
        if (val === 'FREE') return true;
        return marked.includes(val);
      })) {
        return true;
      }
    }
    return false;
  }
}

module.exports = BotManager;
