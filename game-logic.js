// game-logic.js - BINGO ELITE GAME LOGIC MODULE (PERFORMANCE OPTIMIZED)
// ========== FULLY UPDATED – 20 BOTS, ONLY 10 ETB ROOM, LEAVE STUCK ROOMS ==========
// FIX: Orphaned boxes cleanup in bot syncState
// FIX: Block joins during 'ended' state, bots wait for room reset
// NEW: Random bot participation – at least 10, random additional bots
// NEW: Bot management panel support – active flag, add funds, rename, create new bots
// ENHANCED: Bot actions now emit errors and success messages to admin client

// ========== GAME CONFIGURATION ==========
const CONFIG = {
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || "admin1234",
  INITIAL_BALANCE: 0.00,
  ROOM_STAKES: [10, 20, 50, 100],
  MAX_PLAYERS_PER_ROOM: 100,
  GAME_TIMER: 3,
  MIN_PLAYERS_TO_START: 1,
  HOUSE_COMMISSION: {
    10: 2,
    20: 4,
    50: 10,
    100: 20
  },
  FOUR_CORNERS_BONUS: 50,
  COUNTDOWN_TIMER: 30,
  ROOM_STATUS_UPDATE_INTERVAL: 3000,
  MAX_TRANSACTIONS: 1000,
  AUTO_SAVE_INTERVAL: 60000,
  SESSION_TIMEOUT: 86400000,
  GAME_TIMEOUT_MINUTES: 7,
  TELEBIRR_NUMBER: "0962577855", // Default, will be updated from server.js
  MIN_WITHDRAWAL: 50,
  MAX_WITHDRAWAL: 10000,
  BOT_WAIT_TIMEOUT: 60000 // 60 seconds before leaving a room that never starts
};

// ========== GLOBAL STATE ==========
let io;
let models;
let socketToUser = new Map();
let adminSockets = new Set();
let activityLog = [];
let roomTimers = new Map();
let connectedSockets = new Set();
let roomSubscriptions = new Map();
let processingClaims = new Map(); // For preventing double prize bug
let roomWinners = new Map(); // Track room winners
let telebirrNumber = CONFIG.TELEBIRR_NUMBER;

// ========== PERFORMANCE CACHES ==========
let roomsCache = new Map();
let onlinePlayersCache = new Map();
let roomStatusCache = new Map();
let lastRoomStatusBroadcast = 0;
let lastAdminUpdate = 0;

// ========== RATE LIMITING ==========
let playerRateLimit = new Map();
const RATE_LIMIT_WINDOW = 1000; // 1 second
const MAX_EVENTS_PER_WINDOW = 10;

// ========== ETHIOPIAN BOT NAMES ==========
// First 10 full names (first + last)
const ETHIOPIAN_FULL_NAMES = [
  "Abebe Kebede", "Almaz Tesfaye", "Ayele Mengistu", "Berhanu Demeke", "Chaltu Dibaba",
  "Desta Fikre", "Etetu Gemeda", "Fikre Lemma", "Genet Bekele", "Hailu Gebre"
];
// Next 10 only first names
const ETHIOPIAN_FIRST_NAMES = [
  "Kebede", "Lemlem", "Mekdes", "Negasi", "Selam",
  "Tigist", "Wondimu", "Yonas", "Zeritu", "Abebech"
];

// ========== BOT MANAGEMENT ==========
let bots = [];               // in‑memory bot objects (Bot instances)
let botSockets = new Map();  // botId -> virtual socket object
const BOT_COUNT = 20;

// Helper to get a socket (real or bot) by its ID
function getEndpoint(socketId) {
  // First try real socket
  const realSocket = io?.sockets?.sockets?.get(socketId);
  if (realSocket) return realSocket;
  // Then try bot socket
  return botSockets.get(socketId);
}

// ========== ENHANCED BOT CLASS ==========
class Bot {
  constructor(id, name, serverContext) {
    this.userId = `bot_${id}`;
    this.userName = name;
    this.server = serverContext;          // reference to game-logic exports
    this.socket = this._createSocket();
    this.currentRoom = null;
    this.box = null;
    this.grid = [];
    this.markedNumbers = new Set(['FREE']);
    this.calledNumbers = new Set();
    this.balance = 5000;                   // starting balance
    this.isInGame = false;
    this.claimTimeout = null;
    this.waitTimeout = null;                // timeout for waiting to start
    this.retryTimer = null;                  // timer for next action attempt
    this.getRoomWithCache = serverContext.getRoomWithCache; // for smarter fallback
    this.active = true;                      // will be updated from DB
  }

  _createSocket() {
    const bot = this;
    return {
      id: bot.userId,
      emit: (event, data) => bot._handleEvent(event, data),
      on: () => {},                        // not used for bots
      disconnect: () => {},                 // stub
    };
  }

  _handleEvent(event, data) {
    switch (event) {
      case 'ballDrawn':
        this._onBallDrawn(data);
        break;
      case 'gameStarted':
        this._onGameStarted(data);
        break;
      case 'gameOver':
        this._onGameOver(data);
        break;
      case 'balanceUpdate':
        this.balance = data;
        break;
      case 'boxTaken':
      case 'roomLocked':
      case 'error':
        console.log(`🤖 Bot ${this.userName} received ${event}: ${data?.message || ''}`);
        if (!this.isInGame) {
          this._scheduleRetry(3000 + Math.random() * 5000);
        }
        break;
    }
  }

  _onBallDrawn({ room, num, letter }) {
    if (!this.active) return;
    if (room !== this.currentRoom) return;
    this.calledNumbers.add(num);
    if (this.grid.includes(num) || (num === 'FREE' && this.grid.includes('FREE'))) {
      this.markedNumbers.add(num);
    }
    if (this._checkBingo()) {
      const delay = 500 + Math.random() * 2000;
      this.claimTimeout = setTimeout(() => this._claimBingo(), delay);
    }
  }

  _onGameStarted({ room }) {
    if (!this.active) return;
    if (room !== this.currentRoom) return;
    console.log(`🤖 Bot ${this.userName} game started in room ${room}`);
    this.isInGame = true;
    if (this.waitTimeout) {
      clearTimeout(this.waitTimeout);
      this.waitTimeout = null;
    }
    this.grid = generateTraditionalBingoCard(this.box);
    this.markedNumbers = new Set(['FREE']);
    this.calledNumbers.clear();
  }

  _onGameOver({ room }) {
    if (!this.active) return;
    if (room !== this.currentRoom) return;
    console.log(`🤖 Bot ${this.userName} game over in room ${room}`);
    this.isInGame = false;
    this.currentRoom = null;
    this.box = null;
    if (this.claimTimeout) clearTimeout(this.claimTimeout);
    if (this.waitTimeout) {
      clearTimeout(this.waitTimeout);
      this.waitTimeout = null;
    }
    this._scheduleRetry(2000 + Math.random() * 3000);
  }

  _checkBingo() {
    const markedArray = Array.from(this.markedNumbers);
    return checkBingo(markedArray, this.grid).isBingo;
  }

  _claimBingo() {
    if (!this.isInGame || !this.active) return;
    processBingoClaim(
      `${this.currentRoom}_${this.userId}_${Date.now()}`,
      this.userId,
      this.userName,
      this.currentRoom,
      this.grid,
      Array.from(this.markedNumbers)
    ).catch(() => {});
  }

  async syncState() {
    try {
      const user = await models.User.findOne({ userId: this.userId });
      if (!user) return;

      const dbRoom = user.currentRoom;
      const dbBox = user.box;

      this.active = user.botActive !== false;

      if (dbRoom) {
        const room = await this.getRoomWithCache(dbRoom);
        const stillInRoom = room && room.players.includes(this.userId);

        if (stillInRoom) {
          this.currentRoom = dbRoom;
          this.box = dbBox;
          if (this.retryTimer) {
            clearTimeout(this.retryTimer);
            this.retryTimer = null;
          }
          if (room.status === 'waiting' || room.status === 'starting') {
            if (!this.waitTimeout) {
              this.waitTimeout = setTimeout(() => this._leaveRoom(), CONFIG.BOT_WAIT_TIMEOUT);
            }
          }
        } else {
          console.log(`🧹 Bot ${this.userName} clearing stale room ${dbRoom}`);
          await models.User.updateOne(
            { userId: this.userId },
            { currentRoom: null, box: null }
          );
          this.currentRoom = null;
          this.box = null;

          if (room && dbBox && room.takenBoxes.includes(dbBox)) {
            const boxIndex = room.takenBoxes.indexOf(dbBox);
            if (boxIndex > -1) {
              room.takenBoxes.splice(boxIndex, 1);
              await room.save();
              updateRoomCache(room.stake, room);
              console.log(`🧹 Removed orphaned box ${dbBox} from room ${dbRoom}`);
            }
          }
          if (room && room.players.includes(this.userId)) {
            const index = room.players.indexOf(this.userId);
            if (index > -1) {
              room.players.splice(index, 1);
              await room.save();
              updateRoomCache(room.stake, room);
            }
          }
        }
      } else {
        this.currentRoom = null;
        this.box = null;
      }
    } catch (error) {
      console.error(`❌ Error syncing bot ${this.userName} state:`, error);
    }
  }

  async _decideNextAction() {
    if (!this.active) {
      console.log(`🤖 Bot ${this.userName} is inactive, sleeping.`);
      this._scheduleRetry(30000);
      return;
    }

    await this.syncState();

    if (this.currentRoom) {
      console.log(`🤖 Bot ${this.userName} already in room ${this.currentRoom}, skipping action`);
      return;
    }

    const stake = 10;
    console.log(`🤖 Bot ${this.userName} attempting to join room ${stake} ETB`);

    const roomStatus = getRoomStatus(stake);
    let room = null;

    if (roomStatus) {
      if (roomStatus.locked || roomStatus.status === 'ended') {
        console.log(`🤖 Bot ${this.userName}: room ${stake} not available (${roomStatus.status}), retrying later`);
        this._scheduleRetry(5000 + Math.random() * 5000);
        return;
      }
      if (roomStatus.playerCount >= 100) {
        console.log(`🤖 Bot ${this.userName}: room ${stake} is full, retrying later`);
        this._scheduleRetry(5000 + Math.random() * 5000);
        return;
      }

      const currentPlayers = roomStatus.playerCount;
      if (currentPlayers >= 10) {
        if (Math.random() < 0.5) {
          console.log(`🤖 Bot ${this.userName} joining (count ${currentPlayers} >=10, random yes)`);
        } else {
          console.log(`🤖 Bot ${this.userName} skipping this game (count ${currentPlayers} >=10, random no)`);
          this._scheduleRetry(60000 + Math.random() * 60000);
          return;
        }
      } else {
        console.log(`🤖 Bot ${this.userName} joining (count ${currentPlayers} <10)`);
      }

      try {
        room = await this.getRoomWithCache(stake);
      } catch (e) {
        console.error(`Bot ${this.userName} error fetching room:`, e);
        this._scheduleRetry(5000);
        return;
      }
    } else {
      try {
        room = await this.getRoomWithCache(stake);
      } catch (e) {
        console.error(`Bot ${this.userName} error fetching room:`, e);
        this._scheduleRetry(5000);
        return;
      }
    }

    if (!room) {
      const box = Math.floor(Math.random() * 100) + 1;
      console.log(`🤖 Bot ${this.userName} attempting to take box ${box} in room ${stake} (new room)`);
      const fakeData = { room: stake, box, userName: this.userName };
      socketHandlers.joinRoom.call(this.socket, fakeData, null);
      return;
    }

    const taken = room.takenBoxes || [];
    const available = [];
    for (let i = 1; i <= 100; i++) {
      if (!taken.includes(i)) available.push(i);
    }

    if (available.length === 0) {
      console.log(`🤖 Bot ${this.userName}: room ${stake} is full, retrying later`);
      this._scheduleRetry(5000 + Math.random() * 5000);
      return;
    }

    const box = available[Math.floor(Math.random() * available.length)];
    console.log(`🤖 Bot ${this.userName} attempting to take box ${box} in room ${stake}`);
    const fakeData = { room: stake, box, userName: this.userName };
    socketHandlers.joinRoom.call(this.socket, fakeData, null);
  }

  onJoinedRoom(room, box) {
    console.log(`🤖 Bot ${this.userName} successfully joined room ${room} box ${box}`);
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.currentRoom = room;
    this.box = box;
    this.waitTimeout = setTimeout(() => {
      console.log(`⏰ Bot ${this.userName} leaving room ${room} – game didn't start in time`);
      this._leaveRoom();
    }, CONFIG.BOT_WAIT_TIMEOUT);
  }

  _leaveRoom() {
    if (!this.currentRoom) return;
    console.log(`🤖 Bot ${this.userName} leaving room ${this.currentRoom}`);
    socketHandlers.leaveRoom.call(this.socket, {});
    this.currentRoom = null;
    this.box = null;
    if (this.waitTimeout) {
      clearTimeout(this.waitTimeout);
      this.waitTimeout = null;
    }
    if (this.claimTimeout) {
      clearTimeout(this.claimTimeout);
      this.claimTimeout = null;
    }
    this._scheduleRetry(3000 + Math.random() * 5000);
  }

  _scheduleRetry(delay) {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    const retryDelay = delay || (5000 + Math.random() * 5000);
    console.log(`🤖 Bot ${this.userName} scheduling retry in ${Math.round(retryDelay/1000)}s`);
    this.retryTimer = setTimeout(async () => {
      this.retryTimer = null;
      try {
        await this._decideNextAction();
      } catch (error) {
        console.error(`❌ Bot ${this.userName} error in retry:`, error);
        this._scheduleRetry(5000);
      }
    }, retryDelay);
  }
}

// ========== SERVER‑SIDE BINGO CARD GENERATOR ==========
function generateTraditionalBingoCard(seed) {
  const letters = ['B', 'I', 'N', 'G', 'O'];
  const ranges = {
    'B': { min: 1, max: 15, count: 15 },
    'I': { min: 16, max: 30, count: 15 },
    'N': { min: 31, max: 45, count: 15 },
    'G': { min: 46, max: 60, count: 15 },
    'O': { min: 61, max: 75, count: 15 }
  };

  function seededRandom(s) {
    var mask = 0xffffffff;
    var m_w = (123456789 + s) & mask;
    var m_z = (987654321 - s) & mask;

    return function() {
      m_z = (36969 * (m_z & 65535) + (m_z >> 16)) & mask;
      m_w = (18000 * (m_w & 65535) + (m_w >> 16)) & mask;
      var result = ((m_z << 16) + (m_w & 65535)) >>> 0;
      return result / 4294967296;
    }
  }

  const safeSeed = parseInt(seed) || 1;
  const random = seededRandom(safeSeed * 777);
  const grid = [];

  const availableNumbers = {};

  for (const letter of letters) {
    const range = ranges[letter];
    availableNumbers[letter] = [];
    for (let i = range.min; i <= range.max; i++) {
      availableNumbers[letter].push(i);
    }

    for (let i = availableNumbers[letter].length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [availableNumbers[letter][i], availableNumbers[letter][j]] = [availableNumbers[letter][j], availableNumbers[letter][i]];
    }
  }

  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 5; col++) {
      const index = row * 5 + col;
      const letter = letters[col];

      if (col === 2 && row === 2) {
        grid[index] = 'FREE';
        continue;
      }

      const available = availableNumbers[letter];

      if (available.length > 0) {
        const selectedNumber = available.shift();
        grid[index] = selectedNumber;
      } else {
        const range = ranges[letter];
        grid[index] = Math.floor(random() * (range.max - range.min + 1)) + range.min;
      }
    }
  }

  return grid;
}

// Helper to get room status for bots
function getRoomStatus(stake) {
  const cached = roomStatusCache.get('all');
  return cached ? cached.data[stake] : null;
}

// ========== STORE SOCKET HANDLERS FOR BOTS ==========
const socketHandlers = {};

// ========== INITIALIZATION FUNCTION ==========
async function initialize(socketIo, dbModels) {
  io = socketIo;
  models = dbModels;

  console.log('✅ Game logic initialized with performance optimizations');

  // Set up Socket.IO event handlers
  setupSocketHandlers();

  // Start periodic tasks
  startPeriodicTasks();

  // Initialize bots
  await initializeBots();
}

// ========== INITIALIZE BOTS ==========
async function initializeBots() {
  console.log('🤖 Initializing 20 Ethiopian bots...');
  for (let i = 0; i < BOT_COUNT; i++) {
    let name;
    if (i < 10) {
      name = ETHIOPIAN_FULL_NAMES[i % ETHIOPIAN_FULL_NAMES.length];
    } else {
      name = ETHIOPIAN_FIRST_NAMES[(i - 10) % ETHIOPIAN_FIRST_NAMES.length];
    }

    const bot = new Bot(i, name, {
      generateTraditionalBingoCard,
      checkBingo,
      processBingoClaim,
      getRoomStatus,
      getRoomWithCache,
    });

    try {
      let user = await models.User.findOne({ userId: bot.userId });
      if (!user) {
        user = new models.User({
          userId: bot.userId,
          userName: bot.userName,
          balance: bot.balance,
          referralCode: generateReferralCode(bot.userId),
          isBot: true,
          botActive: true
        });
        await user.save();
      } else {
        bot.balance = Number(user.balance) || 5000;
        bot.active = user.botActive !== false;
      }

      if (user.currentRoom) {
        console.log(`🧹 Bot ${bot.userName} clearing stale room ${user.currentRoom} on init`);
        user.currentRoom = null;
        user.box = null;
        await user.save();
      }

      bots.push(bot);
      botSockets.set(bot.userId, bot.socket);
      socketToUser.set(bot.userId, bot.userId);

      await models.User.updateOne(
        { userId: bot.userId },
        { isOnline: true, lastSeen: new Date() }
      );

      if (bot.active) {
        bot._scheduleRetry(5000 + Math.random() * 10000);
      }
    } catch (err) {
      console.error(`❌ Failed to initialize bot ${i}:`, err);
    }
  }
  console.log(`🤖 ${bots.length} bots initialized.`);
}

// ========== TELEBIRR NUMBER FUNCTIONS ==========
function getTelebirrNumber() {
  return telebirrNumber;
}

function setTelebirrNumber(newNumber) {
  telebirrNumber = newNumber;
  console.log(`📱 Telebirr number updated in game logic: ${telebirrNumber}`);
  if (io) {
    io.emit('telebirrNumber', telebirrNumber);
  }
}

// ========== CACHE MANAGEMENT ==========
async function getRoomWithCache(stake) {
  const cacheKey = `room_${stake}`;

  if (roomsCache.has(cacheKey)) {
    const cached = roomsCache.get(cacheKey);
    if (Date.now() - cached.timestamp < 2000) {
      return cached.data;
    }
  }

  const room = await models.Room.findOne({ stake: stake });
  if (room) {
    roomsCache.set(cacheKey, {
      data: room,
      timestamp: Date.now()
    });
  }

  return room;
}

function updateRoomCache(stake, roomData) {
  const cacheKey = `room_${stake}`;
  roomsCache.set(cacheKey, {
    data: roomData,
    timestamp: Date.now()
  });
}

async function getOnlinePlayersInRoomWithCache(roomStake) {
  const cacheKey = `online_${roomStake}`;

  if (onlinePlayersCache.has(cacheKey)) {
    const cached = onlinePlayersCache.get(cacheKey);
    if (Date.now() - cached.timestamp < 2000) {
      return cached.data;
    }
  }

  const onlinePlayers = await getOnlinePlayersInRoom(roomStake);
  onlinePlayersCache.set(cacheKey, {
    data: onlinePlayers,
    timestamp: Date.now()
  });

  return onlinePlayers;
}

// ========== RATE LIMITING FUNCTIONS ==========
function checkRateLimit(userId, eventType) {
  const key = `${userId}_${eventType}`;
  const now = Date.now();

  if (!playerRateLimit.has(key)) {
    playerRateLimit.set(key, { count: 1, windowStart: now });
    return true;
  }

  const limit = playerRateLimit.get(key);

  if (now - limit.windowStart > RATE_LIMIT_WINDOW) {
    limit.count = 1;
    limit.windowStart = now;
    return true;
  }

  if (limit.count >= MAX_EVENTS_PER_WINDOW) {
    console.log(`⚠️ Rate limit exceeded for ${userId} - ${eventType}`);
    return false;
  }

  limit.count++;
  return true;
}

// ========== OPTIMIZED REAL-TIME BOX TRACKING ==========
function broadcastTakenBoxes(roomStake, takenBoxes, newBox = null, playerName = null) {
  if (!io) return;

  const updateData = {
    room: roomStake,
    takenBoxes: takenBoxes,
    playerCount: takenBoxes.length,
    timestamp: Date.now()
  };

  if (newBox && playerName) {
    updateData.newBox = newBox;
    updateData.playerName = playerName;
    updateData.message = `${playerName} selected box ${newBox}!`;
  }

  const cacheKey = `room_${roomStake}`;
  const roomData = roomsCache.get(cacheKey);

  if (roomData) {
    roomData.data.players.forEach(userId => {
      for (const [socketId, uId] of socketToUser.entries()) {
        if (uId === userId) {
          const socket = getEndpoint(socketId);
          if (socket && socket.connected !== false) {
            socket.emit('boxesTakenUpdate', updateData);
          }
        }
      }
    });
  }

  const subscribedSockets = roomSubscriptions.get(roomStake) || new Set();
  subscribedSockets.forEach(socketId => {
    const socket = getEndpoint(socketId);
    if (socket && socket.connected !== false) {
      socket.emit('boxesTakenUpdate', updateData);
    }
  });

  adminSockets.forEach(socketId => {
    const socket = getEndpoint(socketId);
    if (socket && socket.connected !== false) {
      socket.emit('admin:boxesUpdate', {
        room: roomStake,
        takenBoxes: takenBoxes,
        playerCount: takenBoxes.length,
        timestamp: new Date().toISOString(),
        newBox: newBox,
        playerName: playerName
      });
    }
  });

  console.log(`📦 Real-time box update for room ${roomStake}: ${takenBoxes.length} boxes taken${newBox ? `, new box ${newBox} by ${playerName}` : ''}`);
}

function cleanupRoomTimer(stake) {
  if (roomTimers.has(stake)) {
    clearInterval(roomTimers.get(stake));
    roomTimers.delete(stake);
    console.log(`🧹 Cleaned up timer for room ${stake}`);
  }
}

function cleanupProcessingClaims() {
  const now = Date.now();
  const tenSecondsAgo = now - 10000;

  processingClaims.forEach((timestamp, key) => {
    if (timestamp < tenSecondsAgo) {
      processingClaims.delete(key);
      console.log(`🧹 Cleaned up stale processing claim: ${key}`);
    }
  });
}

function cleanupRoomWinners() {
  const now = Date.now();
  const oneMinuteAgo = now - 60000;

  roomWinners.forEach((timestamp, roomStake) => {
    if (timestamp < oneMinuteAgo) {
      roomWinners.delete(roomStake);
      console.log(`🧹 Cleaned up stale room winner for room ${roomStake}`);
    }
  });
}

// ========== IMPROVED HELPER FUNCTIONS ==========
function getBingoLetter(number) {
  if (number >= 1 && number <= 15) return 'B';
  if (number >= 16 && number <= 30) return 'I';
  if (number >= 31 && number <= 45) return 'N';
  if (number >= 46 && number <= 60) return 'G';
  if (number >= 61 && number <= 75) return 'O';
  return '';
}

function generateReferralCode(userId) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code + userId.slice(-4);
}

async function getUser(userId, userName) {
  try {
    let user = await models.User.findOne({ userId: userId });

    if (!user) {
      user = new models.User({
        userId: userId,
        userName: userName || 'Guest',
        balance: CONFIG.INITIAL_BALANCE,
        referralCode: generateReferralCode(userId),
        telegramId: userId.startsWith('tg_') ? userId.replace('tg_', '') : null
      });
      await user.save();

      const transaction = new models.Transaction({
        type: 'NEW_USER',
        userId: userId,
        userName: userName || 'Guest',
        amount: 0,
        description: 'New user registered'
      });
      await transaction.save();
    } else {
      user.lastSeen = new Date();
      user.sessionCount = (user.sessionCount || 0) + 1;
      user.isOnline = true;

      if (userName && user.userName !== userName) {
        user.userName = userName;
      }

      await user.save();
    }

    return user;
  } catch (error) {
    console.error('Error getting user:', error);
    return null;
  }
}

async function getRoom(stake) {
  try {
    let room = await models.Room.findOne({ stake: stake, status: { $in: ['waiting', 'starting', 'playing'] } });

    if (!room) {
      room = new models.Room({
        stake: stake,
        players: [],
        takenBoxes: [],
        status: 'waiting',
        lastBoxUpdate: new Date()
      });
      await room.save();
    }

    updateRoomCache(stake, room);

    return room;
  } catch (error) {
    console.error('Error getting room:', error);
    return null;
  }
}

function getConnectedUsers() {
  const connectedUsers = new Set();

  socketToUser.forEach((userId, socketId) => {
    const socket = getEndpoint(socketId);
    if (socket && socket.connected !== false) {
      connectedUsers.add(userId);
    }
  });

  return Array.from(connectedUsers);
}

async function getOnlinePlayersInRoom(roomStake) {
  try {
    const room = await getRoomWithCache(roomStake);
    if (!room) return [];

    const connectedUserIds = new Set(getConnectedUsers());
    const onlinePlayers = room.players.filter(playerId =>
      connectedUserIds.has(playerId)
    );

    return onlinePlayers;
  } catch (error) {
    console.error('Error getting online players in room:', error);
    return [];
  }
}

async function broadcastRoomStatus() {
  try {
    const now = Date.now();
    if (now - lastRoomStatusBroadcast < 2000) {
      return;
    }
    lastRoomStatusBroadcast = now;

    const rooms = await models.Room.find({ status: { $in: ['waiting', 'starting', 'playing', 'ended'] } });
    const roomStatus = {};

    await Promise.all(rooms.map(async (room) => {
      const onlinePlayers = await getOnlinePlayersInRoomWithCache(room.stake);
      const commissionPerPlayer = CONFIG.HOUSE_COMMISSION[room.stake] || 0;
      const contributionPerPlayer = room.stake - commissionPerPlayer;
      const potentialPrize = contributionPerPlayer * onlinePlayers.length;
      const houseFee = commissionPerPlayer * onlinePlayers.length;
      const potentialPrizeWithBonus = potentialPrize + CONFIG.FOUR_CORNERS_BONUS;

      const isLocked = room.status === 'playing' || room.status === 'ended';

      roomStatus[room.stake] = {
        stake: room.stake,
        playerCount: onlinePlayers.length,
        totalPlayers: room.players.length,
        status: room.status,
        locked: isLocked,
        takenBoxes: room.takenBoxes.length,
        commissionPerPlayer: commissionPerPlayer,
        contributionPerPlayer: contributionPerPlayer,
        potentialPrize: potentialPrize,
        potentialPrizeWithBonus: potentialPrizeWithBonus,
        houseFee: houseFee,
        currentBall: room.currentBall,
        ballsDrawn: room.ballsDrawn,
        minPlayers: CONFIG.MIN_PLAYERS_TO_START,
        fourCornersBonus: CONFIG.FOUR_CORNERS_BONUS
      };
    }));

    roomStatusCache.set('all', {
      data: roomStatus,
      timestamp: now
    });

    io.emit('roomStatus', roomStatus);

    if (adminSockets.size > 0) {
      updateAdminPanel();
    }

  } catch (error) {
    console.error('Error broadcasting room status:', error);
  }
}

async function updateAdminPanel() {
  try {
    const now = Date.now();
    if (now - lastAdminUpdate < 3000) {
      return;
    }
    lastAdminUpdate = now;

    const connectedPlayers = getConnectedUsers().length;
    const activeGames = await models.Room.countDocuments({ status: 'playing' });

    const users = await models.User.find({}).sort({ balance: -1 }).limit(100);

    const connectedUserIds = new Set(getConnectedUsers());

    const userSocketCount = {};
    socketToUser.forEach((userId, socketId) => {
      const socket = getEndpoint(socketId);
      if (socket && socket.connected !== false) {
        userSocketCount[userId] = (userSocketCount[userId] || 0) + 1;
      }
    });

    const userArray = users.map(user => {
      let isOnline = false;

      if (connectedUserIds.has(user.userId)) {
        isOnline = true;
      }
      else if (user.lastSeen) {
        const lastSeenTime = new Date(user.lastSeen);
        const now = new Date();
        const secondsSinceLastSeen = (now - lastSeenTime) / 1000;

        if (secondsSinceLastSeen < 30) {
          isOnline = true;
        }
      }

      return {
        userId: user.userId,
        userName: user.userName,
        balance: user.balance,
        currentRoom: user.currentRoom,
        box: user.box,
        isOnline: isOnline,
        socketCount: userSocketCount[user.userId] || 0,
        totalWagered: user.totalWagered || 0,
        totalWins: user.totalWins || 0,
        totalBingos: user.totalBingos || 0,
        lastSeen: user.lastSeen,
        telegramId: user.telegramId || '',
        phoneNumber: user.phoneNumber || '',
        joinedAt: user.joinedAt,
        sessionCount: user.sessionCount || 1,
        isBot: user.isBot || false,
        botActive: user.botActive !== false
      };
    });

    const roomsData = {};
    const rooms = await models.Room.find({ status: { $in: ['waiting', 'starting', 'playing', 'ended'] } });

    for (const room of rooms) {
      const onlinePlayers = await getOnlinePlayersInRoomWithCache(room.stake);
      const commissionPerPlayer = CONFIG.HOUSE_COMMISSION[room.stake] || 0;
      const contributionPerPlayer = room.stake - commissionPerPlayer;
      const potentialPrize = contributionPerPlayer * onlinePlayers.length;
      const houseFee = commissionPerPlayer * onlinePlayers.length;

      roomsData[room.stake] = {
        stake: room.stake,
        playerCount: onlinePlayers.length,
        totalPlayers: room.players.length,
        takenBoxes: room.takenBoxes,
        status: room.status,
        locked: room.status === 'playing' || room.status === 'ended',
        currentBall: room.currentBall,
        ballsDrawn: room.ballsDrawn,
        commissionPerPlayer: commissionPerPlayer,
        contributionPerPlayer: contributionPerPlayer,
        potentialPrize: potentialPrize,
        houseFee: houseFee,
        players: room.players,
        onlinePlayers: onlinePlayers,
        startTime: room.startTime,
        gameDuration: room.startTime ? Math.floor((Date.now() - room.startTime) / 1000 / 60) : 0
      };
    }

    const houseEarnings = await models.Transaction.aggregate([
      { $match: { type: 'HOUSE_EARNINGS' } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]).then(result => result[0]?.total || 0);

    const totalWagered = await models.Transaction.aggregate([
      { $match: {
        type: { $nin: ['NEW_USER', 'ADMIN_ADD', 'HOUSE_EARNINGS'] },
        amount: { $lt: 0 }
      } },
      { $group: { _id: null, total: { $sum: { $abs: '$amount' } } } }
    ]).then(result => result[0]?.total || 0);

    const totalWins = await models.Transaction.aggregate([
      { $match: {
        type: { $nin: ['ADMIN_ADD', 'HOUSE_EARNINGS'] },
        amount: { $gt: 0 }
      } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]).then(result => result[0]?.total || 0);

    const totalBingos = await models.Transaction.countDocuments({
      type: { $in: ['WIN', 'WIN_FOUR_CORNERS'] }
    });

    const connectedSocketsCount = connectedSockets.size;

    const multiSocketUsers = Object.values(userSocketCount).filter(count => count > 1).length;

    const adminData = {
      totalPlayers: connectedPlayers,
      activeGames: activeGames,
      totalUsers: users.length,
      connectedSockets: connectedSocketsCount,
      houseEarnings: houseEarnings,
      totalWagered: totalWagered,
      totalWins: totalWins,
      totalBingos: totalBingos,
      timestamp: new Date().toISOString(),
      serverUptime: process.uptime(),
      gameTimeoutMinutes: CONFIG.GAME_TIMEOUT_MINUTES,
      multiSocketUsers: multiSocketUsers,
      telebirrNumber: telebirrNumber
    };

    adminSockets.forEach(socketId => {
      const socket = getEndpoint(socketId);
      if (socket && socket.connected !== false) {
        socket.emit('admin:update', adminData);
        socket.emit('admin:players', userArray);
        socket.emit('admin:rooms', roomsData);

        models.Transaction.find().sort({ createdAt: -1 }).limit(50)
          .then(transactions => {
            socket.emit('admin:transactions', transactions);
          })
          .catch(err => console.error('Error fetching transactions:', err));
      }
    });

  } catch (error) {
    console.error('Error updating admin panel:', error);
  }
}

function logActivity(type, details, adminSocketId = null) {
  try {
    const activity = {
      id: Date.now().toString(),
      timestamp: new Date().toISOString(),
      type: type,
      details: details,
      adminSocketId: adminSocketId
    };
    activityLog.unshift(activity);

    if (activityLog.length > 200) {
      activityLog = activityLog.slice(0, 200);
    }

    adminSockets.forEach(socketId => {
      const socket = getEndpoint(socketId);
      if (socket && socket.connected !== false) {
        socket.emit('admin:activity', activity);
      }
    });
  } catch (err) {
    console.error('Error in logActivity:', err);
  }
}

async function cleanupLongRunningGames() {
  try {
    const sevenMinutesAgo = new Date(Date.now() - CONFIG.GAME_TIMEOUT_MINUTES * 60 * 1000);
    const longRunningRooms = await models.Room.find({
      status: 'playing',
      startTime: { $lt: sevenMinutesAgo }
    });

    for (const room of longRunningRooms) {
      console.log(`⏰ Room ${room.stake} has been playing for ${CONFIG.GAME_TIMEOUT_MINUTES}+ minutes. Auto-ending...`);

      cleanupRoomTimer(room.stake);

      const playersInRoom = [...room.players];

      for (const userId of playersInRoom) {
        const user = await models.User.findOne({ userId: userId });
        if (user) {
          const oldBalance = user.balance;
          user.balance += room.stake;
          user.currentRoom = null;
          user.box = null;
          await user.save();

          console.log(`💰 Auto-refunded ${room.stake} ETB to ${user.userName} after ${CONFIG.GAME_TIMEOUT_MINUTES}min timeout`);

          const transaction = new models.Transaction({
            type: 'TIMEOUT_REFUND',
            userId: userId,
            userName: user.userName,
            amount: room.stake,
            room: room.stake,
            description: `Game auto-ended after ${CONFIG.GAME_TIMEOUT_MINUTES} minutes - stake refunded`
          });
          await transaction.save();

          for (const [socketId, uId] of socketToUser.entries()) {
            if (uId === userId) {
              const socket = getEndpoint(socketId);
              if (socket && socket.connected !== false) {
                socket.emit('gameTimeout', {
                  room: room.stake,
                  reason: `Game auto-ended after ${CONFIG.GAME_TIMEOUT_MINUTES} minutes`,
                  refunded: room.stake
                });
                socket.emit('balanceUpdate', user.balance);
                socket.emit('boxesCleared', {
                  room: room.stake,
                  reason: 'game_timeout'
                });
              }
            }
          }
        }
      }

      room.players = [];
      room.takenBoxes = [];
      room.status = 'waiting';
      room.calledNumbers = [];
      room.currentBall = null;
      room.ballsDrawn = 0;
      room.startTime = null;
      room.endTime = new Date();
      room.lastBoxUpdate = new Date();
      await room.save();

      updateRoomCache(room.stake, room);

      broadcastTakenBoxes(room.stake, []);

      console.log(`✅ Auto-cleared room ${room.stake} after ${CONFIG.GAME_TIMEOUT_MINUTES} minutes`);
    }
  } catch (error) {
    console.error('❌ Error in cleanupLongRunningGames:', error);
  }
}

async function startGameTimer(room) {
  console.log(`🎲 STARTING GAME TIMER for room ${room.stake} with ${room.players.length} players`);

  cleanupRoomTimer(room.stake);

  room.calledNumbers = [];
  room.currentBall = null;
  room.ballsDrawn = 0;
  room.startTime = new Date();
  await room.save();
  updateRoomCache(room.stake, room);

  const timer = setInterval(async () => {
    try {
      const currentRoom = await getRoomWithCache(room.stake);
      if (!currentRoom || currentRoom.status !== 'playing') {
        console.log(`⚠️ Game timer stopped: Room ${room.stake} status is ${currentRoom?.status || 'not found'}`);
        clearInterval(timer);
        roomTimers.delete(room.stake);
        return;
      }

      if (currentRoom.ballsDrawn >= 75) {
        console.log(`⏰ Game timeout for room ${room.stake}: 75 balls drawn`);
        clearInterval(timer);
        roomTimers.delete(room.stake);
        await endGameWithNoWinner(currentRoom);
        return;
      }

      let ball, letter;
      let attempts = 0;
      do {
        ball = Math.floor(Math.random() * 75) + 1;
        letter = getBingoLetter(ball);
        attempts++;
        if (attempts > 100) {
          for (let i = 1; i <= 75; i++) {
            if (!currentRoom.calledNumbers.includes(i)) {
              ball = i;
              letter = getBingoLetter(i);
              break;
            }
          }
          break;
        }
      } while (currentRoom.calledNumbers.includes(ball));

      console.log(`🎱 Drawing ball ${letter}-${ball} for room ${room.stake} (Ball #${currentRoom.ballsDrawn + 1})`);

      currentRoom.calledNumbers.push(ball);
      currentRoom.currentBall = ball;
      currentRoom.ballsDrawn += 1;
      currentRoom.lastBoxUpdate = new Date();
      await currentRoom.save();
      updateRoomCache(room.stake, currentRoom);

      const ballData = {
        room: currentRoom.stake,
        num: ball,
        letter: letter,
        ballsDrawn: currentRoom.ballsDrawn
      };

      const playersInRoom = currentRoom.players;

      playersInRoom.forEach(playerId => {
        const socketIds = [];
        socketToUser.forEach((uid, sid) => {
          if (uid === playerId) socketIds.push(sid);
        });

        socketIds.forEach(sid => {
          const socket = getEndpoint(sid);
          if (socket && socket.connected !== false) {
            socket.emit('ballDrawn', ballData);
            if (currentRoom.ballsDrawn % 3 === 0) {
              socket.emit('enableBingo');
            }
          }
        });
      });

      adminSockets.forEach(socketId => {
        const socket = getEndpoint(socketId);
        if (socket && socket.connected !== false) {
          socket.emit('admin:ballDrawn', {
            room: room.stake,
            ball: ball,
            letter: letter,
            ballsDrawn: currentRoom.ballsDrawn
          });
        }
      });

      broadcastRoomStatus();

    } catch (error) {
      console.error('❌ Error in game timer:', error);
      clearInterval(timer);
      roomTimers.delete(room.stake);
    }
  }, CONFIG.GAME_TIMER * 1000);

  roomTimers.set(room.stake, timer);
  console.log(`✅ Game timer started for room ${room.stake}, interval: ${CONFIG.GAME_TIMER}s`);
}

function checkBingo(markedNumbers, grid) {
  const patterns = [
    { pattern: [0,1,2,3,4], name: 'Top Row', type: 'row', row: 0 },
    { pattern: [5,6,7,8,9], name: 'Second Row', type: 'row', row: 1 },
    { pattern: [10,11,12,13,14], name: 'Third Row', type: 'row', row: 2 },
    { pattern: [15,16,17,18,19], name: 'Fourth Row', type: 'row', row: 3 },
    { pattern: [20,21,22,23,24], name: 'Bottom Row', type: 'row', row: 4 },

    { pattern: [0,5,10,15,20], name: 'B Column', type: 'column', column: 0 },
    { pattern: [1,6,11,16,21], name: 'I Column', type: 'column', column: 1 },
    { pattern: [2,7,12,17,22], name: 'N Column', type: 'column', column: 2 },
    { pattern: [3,8,13,18,23], name: 'G Column', type: 'column', column: 3 },
    { pattern: [4,9,14,19,24], name: 'O Column', type: 'column', column: 4 },

    { pattern: [0,6,12,18,24], name: 'Diagonal ↘️', type: 'diagonal', diagonal: 'main' },
    { pattern: [4,8,12,16,20], name: 'Diagonal ↙️', type: 'diagonal', diagonal: 'anti' },

    { pattern: [0,4,20,24], name: 'Four Corners ★', type: 'corners' }
  ];

  for (const patternData of patterns) {
    const isBingo = patternData.pattern.every(index => {
      const cellValue = grid[index];

      if (cellValue === 'FREE') {
        const hasFree = markedNumbers.includes('FREE') || markedNumbers.some(m => m === 'FREE');
        return hasFree;
      }

      const cellValueNum = Number(cellValue);
      const isMarked = markedNumbers.some(marked => {
        if (marked === 'FREE') return false;
        const markedNum = Number(marked);
        return markedNum === cellValueNum;
      });

      return isMarked;
    });

    if (isBingo) {
      return {
        isBingo: true,
        pattern: patternData.pattern,
        patternName: patternData.name,
        patternType: patternData.type,
        isFourCorners: patternData.pattern.length === 4 && patternData.pattern[0] === 0 && patternData.pattern[1] === 4 && patternData.pattern[2] === 20 && patternData.pattern[3] === 24
      };
    }
  }

  return { isBingo: false };
}

async function endGameWithNoWinner(room) {
  try {
    console.log(`🎮 Ending game with no winner for room ${room.stake}`);

    cleanupRoomTimer(room.stake);

    const playersInRoom = [...room.players];

    for (const userId of playersInRoom) {
      const user = await models.User.findOne({ userId: userId });
      if (user) {
        const oldBalance = user.balance;
        user.balance += room.stake;
        user.currentRoom = null;
        user.box = null;
        await user.save();

        console.log(`💰 Refunded ${room.stake} ETB to ${user.userName}, balance: ${oldBalance} → ${user.balance}`);

        const transaction = new models.Transaction({
          type: 'REFUND',
          userId: userId,
          userName: user.userName,
          amount: room.stake,
          room: room.stake,
          description: `Game ended with no winner - stake refunded`
        });
        await transaction.save();

        for (const [socketId, uId] of socketToUser.entries()) {
          if (uId === userId) {
            const socket = getEndpoint(socketId);
            if (socket && socket.connected !== false) {
              socket.emit('gameOver', {
                room: room.stake,
                winnerId: 'HOUSE',
                winnerName: 'House',
                prize: 0,
                basePrize: 0,
                bonus: 0,
                playersCount: playersInRoom.length,
                isFourCornersWin: false,
                gameEnded: true,
                reason: 'no_winner',
                commissionPerPlayer: CONFIG.HOUSE_COMMISSION[room.stake] || 0
              });
              socket.emit('balanceUpdate', user.balance);
            }
          }
        }
      }
    }

    room.players = [];
    room.takenBoxes = [];
    room.status = 'waiting';
    room.calledNumbers = [];
    room.currentBall = null;
    room.ballsDrawn = 0;
    room.startTime = null;
    room.endTime = new Date();
    room.lastBoxUpdate = new Date();
    await room.save();

    updateRoomCache(room.stake, room);

    broadcastTakenBoxes(room.stake, []);
    io.emit('boxesCleared', { room: room.stake, reason: 'game_ended_no_winner' });

    console.log(`✅ Game ended with no winner for room ${room.stake}. Boxes cleared for next game.`);

    broadcastRoomStatus();
    updateAdminPanel();

  } catch (error) {
    console.error('❌ Error ending game with no winner:', error);
  }
}

async function startCountdownForRoom(room) {
  try {
    console.log(`⏱️ STARTING COUNTDOWN for room ${room.stake} at ${new Date().toISOString()}`);

    const countdownKey = `countdown_${room.stake}`;
    if (roomTimers.has(countdownKey)) {
      clearInterval(roomTimers.get(countdownKey));
      roomTimers.delete(countdownKey);
    }

    room.status = 'starting';
    room.countdownStartTime = new Date();
    room.countdownStartedWith = room.players.length;
    await room.save();

    updateRoomCache(room.stake, room);

    let countdown = CONFIG.COUNTDOWN_TIMER;
    const countdownInterval = setInterval(async () => {
      try {
        const currentRoom = await getRoomWithCache(room.stake);
        if (!currentRoom || currentRoom.status !== 'starting') {
          console.log(`⏹️ Countdown stopped: Room ${room.stake} status changed to ${currentRoom?.status || 'deleted'}`);
          clearInterval(countdownInterval);
          roomTimers.delete(countdownKey);
          return;
        }

        const onlinePlayers = await getOnlinePlayersInRoomWithCache(room.stake);

        console.log(`⏱️ Room ${room.stake}: Countdown ${countdown}s, ${onlinePlayers.length} online players`);

        const socketsToSend = new Set();

        currentRoom.players.forEach(userId => {
          for (const [socketId, uId] of socketToUser.entries()) {
            if (uId === userId) {
              if (getEndpoint(socketId)?.connected !== false) {
                socketsToSend.add(socketId);
              }
            }
          }
        });

        const subscribedSockets = roomSubscriptions.get(room.stake) || new Set();
        subscribedSockets.forEach(socketId => {
          if (getEndpoint(socketId)?.connected !== false) {
            socketsToSend.add(socketId);
          }
        });

        const countdownData = {
          room: room.stake,
          timer: countdown,
          onlinePlayers: onlinePlayers.length
        };

        socketsToSend.forEach(socketId => {
          const socket = getEndpoint(socketId);
          if (socket && socket.connected !== false) {
            socket.emit('gameCountdown', countdownData);
            socket.emit('lobbyUpdate', {
              room: room.stake,
              count: onlinePlayers.length
            });
          }
        });

        adminSockets.forEach(socketId => {
          const socket = getEndpoint(socketId);
          if (socket && socket.connected !== false) {
            socket.emit('admin:countdownUpdate', {
              room: room.stake,
              timer: countdown,
              onlinePlayers: onlinePlayers.length
            });
          }
        });

        countdown--;

        if (countdown < 0) {
          clearInterval(countdownInterval);
          roomTimers.delete(countdownKey);

          console.log(`🎮 Countdown finished for room ${room.stake} - AUTO STARTING GAME`);

          const finalRoom = await getRoomWithCache(room.stake);
          if (!finalRoom || finalRoom.status !== 'starting') {
            console.log(`⚠️ Countdown finished but room ${room.stake} is no longer in starting status`);
            return;
          }

          const finalOnlinePlayers = await getOnlinePlayersInRoomWithCache(room.stake);

          if (finalOnlinePlayers.length >= 1) {
            console.log(`🎮 AUTO STARTING game for room ${room.stake} with ${finalOnlinePlayers.length} online player(s)`);

            finalRoom.status = 'playing';
            finalRoom.startTime = new Date();
            finalRoom.countdownStartTime = null;
            finalRoom.countdownStartedWith = 0;
            await finalRoom.save();

            updateRoomCache(room.stake, finalRoom);

            const finalSocketsToSend = new Set();

            finalRoom.players.forEach(userId => {
              for (const [socketId, uId] of socketToUser.entries()) {
                if (uId === userId) {
                  if (getEndpoint(socketId)?.connected !== false) {
                    finalSocketsToSend.add(socketId);
                  }
                }
              }
            });

            const finalSubscribedSockets = roomSubscriptions.get(room.stake) || new Set();
            finalSubscribedSockets.forEach(socketId => {
              if (getEndpoint(socketId)?.connected !== false) {
                finalSocketsToSend.add(socketId);
              }
            });

            finalSocketsToSend.forEach(socketId => {
              const socket = getEndpoint(socketId);
              if (socket && socket.connected !== false) {
                socket.emit('gameStarted', {
                  room: room.stake,
                  players: finalOnlinePlayers.length
                });

                socket.emit('gameCountdown', {
                  room: room.stake,
                  timer: 0,
                  gameStarting: true
                });
              }
            });

            await startGameTimer(finalRoom);

            broadcastRoomStatus();

            console.log(`✅ Game AUTO STARTED for room ${room.stake}, timer active`);
          } else {
            console.log(`⚠️ Game start aborted for room ${room.stake}: no online players`);
            finalRoom.status = 'waiting';
            finalRoom.countdownStartTime = null;
            finalRoom.countdownStartedWith = 0;
            await finalRoom.save();

            updateRoomCache(room.stake, finalRoom);

            const resetSocketsToSend = new Set();

            finalRoom.players.forEach(userId => {
              for (const [socketId, uId] of socketToUser.entries()) {
                if (uId === userId) {
                  if (getEndpoint(socketId)?.connected !== false) {
                    resetSocketsToSend.add(socketId);
                  }
                }
              }
            });

            const resetSubscribedSockets = roomSubscriptions.get(room.stake) || new Set();
            resetSubscribedSockets.forEach(socketId => {
              if (getEndpoint(socketId)?.connected !== false) {
                resetSocketsToSend.add(socketId);
              }
            });

            resetSocketsToSend.forEach(socketId => {
              const socket = getEndpoint(socketId);
              if (socket && socket.connected !== false) {
                socket.emit('countdownStopped', {
                  room: room.stake,
                  reason: 'no_players_online'
                });
                socket.emit('lobbyUpdate', {
                  room: room.stake,
                  count: 0,
                  reason: 'not_enough_players'
                });
              }
            });

            broadcastRoomStatus();
          }
        }
      } catch (error) {
        console.error('❌ Error in countdown interval:', error);
        clearInterval(countdownInterval);
        roomTimers.delete(countdownKey);
      }
    }, 1000);

    roomTimers.set(countdownKey, countdownInterval);
    console.log(`✅ Countdown timer started for room ${room.stake}`);

  } catch (error) {
    console.error('❌ Error starting countdown:', error);
  }
}

function notifyPlayer(userId, data) {
  socketToUser.forEach((uId, socketId) => {
    if (uId === userId) {
      const socket = getEndpoint(socketId);
      if (socket && socket.connected !== false) {
        socket.emit('claimResult', data);
      }
    }
  });
}

function broadcastGameOver(roomStake, playerIds, gameOverData) {
  playerIds.forEach(playerId => {
    socketToUser.forEach((uId, socketId) => {
      if (uId === playerId) {
        const socket = getEndpoint(socketId);
        if (socket && socket.connected !== false) {
          socket.emit('gameOver', gameOverData);

          if (uId === gameOverData.winnerId) {
            socket.emit('balanceUpdate', gameOverData.prize);
          }
        }
      }
    });
  });

  adminSockets.forEach(socketId => {
    const socket = getEndpoint(socketId);
    if (socket && socket.connected !== false) {
      socket.emit('admin:gameOver', {
        room: roomStake,
        winnerId: gameOverData.winnerId,
        winnerName: gameOverData.winnerName,
        prize: gameOverData.prize,
        players: playerIds.length,
        timestamp: new Date().toISOString()
      });
    }
  });
}

async function resetRoomForNextGame(roomStake) {
  try {
    const room = await models.Room.findOne({ stake: roomStake });
    if (room) {
      room.players = [];
      room.takenBoxes = [];
      room.status = 'waiting';
      room.calledNumbers = [];
      room.currentBall = null;
      room.ballsDrawn = 0;
      room.startTime = null;
      room.endTime = null;
      room.lastBoxUpdate = new Date();
      await room.save();

      updateRoomCache(roomStake, room);
      onlinePlayersCache.delete(`online_${roomStake}`);

      broadcastTakenBoxes(roomStake, []);
      io.emit('boxesCleared', { room: roomStake, reason: 'game_ended_bingo_win' });

      console.log(`🔄 Room ${roomStake} reset for next game`);
    }
  } catch (error) {
    console.error(`❌ Error resetting room ${roomStake}:`, error);
  }
}

async function processBingoClaim(claimId, userId, userName, roomStake, grid, marked) {
  try {
    const markedNumbers = marked.map(item => {
      if (item === 'FREE') return 'FREE';
      return Number(item);
    }).filter(item => !isNaN(item) || item === 'FREE');

    const bingoCheck = checkBingo(markedNumbers, grid);
    if (!bingoCheck.isBingo) {
      console.log(`❌ Invalid bingo from ${userName} - No winning pattern`);

      notifyPlayer(userId, {
        type: 'invalidBingo',
        message: 'Invalid bingo claim - no winning pattern',
        claimId: claimId
      });
      return { success: false, reason: 'invalid_pattern' };
    }

    if (roomWinners.has(roomStake)) {
      const winnerTime = roomWinners.get(roomStake);
      const timeSinceWin = Date.now() - winnerTime;

      if (timeSinceWin < 5000) {
        console.log(`🚨 Room ${roomStake} already has a winner (${timeSinceWin}ms ago)`);

        notifyPlayer(userId, {
          type: 'alreadyWon',
          message: 'Someone already won this game!',
          claimId: claimId
        });
        return { success: false, reason: 'already_won' };
      }
    }

    const roomLockKey = `room_lock_${roomStake}`;
    if (processingClaims.has(roomLockKey)) {
      console.log(`⏸️ Room ${roomStake} is processing another claim`);

      notifyPlayer(userId, {
        type: 'processing',
        message: 'Another claim is being processed. Please wait...',
        claimId: claimId
      });
      return { success: false, reason: 'processing' };
    }

    processingClaims.set(roomLockKey, Date.now());

    try {
      const roomData = await Promise.race([
        getRoomWithCache(roomStake),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Room timeout')), 2000)
        )
      ]);

      if (!roomData) {
        console.log(`❌ Room ${roomStake} not found`);
        return { success: false, reason: 'room_not_found' };
      }

      if (!roomData.players.includes(userId)) {
        console.log(`❌ User ${userName} not in room ${roomStake}`);
        return { success: false, reason: 'not_in_room' };
      }

      const recentWin = await models.Transaction.findOne({
        room: roomStake,
        type: { $in: ['WIN', 'WIN_FOUR_CORNERS'] },
        createdAt: { $gt: new Date(Date.now() - 10000) }
      }).lean();

      if (recentWin) {
        console.log(`⚠️ Room ${roomStake} already won by ${recentWin.userName}`);
        return { success: false, reason: 'recent_winner' };
      }

      const commissionPerPlayer = CONFIG.HOUSE_COMMISSION[roomStake] || 0;
      const contributionPerPlayer = roomStake - commissionPerPlayer;
      const totalPlayers = roomData.players.length;
      const basePrize = contributionPerPlayer * totalPlayers;
      const isFourCornersWin = bingoCheck.isFourCorners;
      const bonus = isFourCornersWin ? CONFIG.FOUR_CORNERS_BONUS : 0;
      const totalPrize = basePrize + bonus;
      const houseEarnings = commissionPerPlayer * totalPlayers;

      console.log(`💰 ${userName} wins ${totalPrize} ETB in room ${roomStake} (${totalPlayers} players)`);

      const updatedRoom = await models.Room.findOneAndUpdate(
        { _id: roomData._id, status: 'playing' },
        {
          status: 'ended',
          endTime: new Date(),
          lastBoxUpdate: new Date(),
          $push: {
            gameHistory: {
              timestamp: new Date(),
              winner: userId,
              winnerName: userName,
              prize: totalPrize,
              bonus: bonus,
              basePrize: basePrize,
              players: totalPlayers,
              ballsDrawn: roomData.ballsDrawn,
              isFourCorners: isFourCornersWin,
              commissionCollected: houseEarnings,
              winningPattern: bingoCheck.pattern,
              winningPatternName: bingoCheck.patternName,
              winningPatternType: bingoCheck.patternType
            }
          }
        },
        { new: true }
      );

      if (!updatedRoom) {
        console.log(`⚠️ Room ${roomStake} update failed - already ended?`);
        return { success: false, reason: 'update_failed' };
      }

      updateRoomCache(roomStake, updatedRoom);

      const updatedUser = await models.User.findOneAndUpdate(
        { userId: userId },
        {
          $inc: {
            balance: totalPrize,
            totalWins: 1,
            totalBingos: 1,
            totalWagered: roomStake
          },
          $set: {
            currentRoom: null,
            box: null
          }
        },
        { new: true }
      );

      if (!updatedUser) {
        console.log(`❌ User ${userId} update failed`);
        return { success: false, reason: 'user_update_failed' };
      }

      if (updatedUser.agentId) {
        const commissionRate = 40;
        const commissionAmount = totalPrize * commissionRate / 100;
        const transactionKey = `BINGO_${roomData._id}_${userId}`;

        try {
          await models.AgentCommission.create({
            agentId: updatedUser.agentId,
            userId: userId,
            transactionKey: transactionKey,
            userName: userName,
            gameType: 'BINGO',
            stake: roomStake,
            winningAmount: totalPrize,
            commissionRate: commissionRate,
            commissionAmount: commissionAmount,
            status: 'completed'
          });

          await models.Agent.findByIdAndUpdate(
            updatedUser.agentId,
            { $inc: { totalEarnings: commissionAmount } }
          );

          console.log(`👑 Agent commission recorded: ${commissionAmount} ETB for agent ${updatedUser.agentId} from player ${userName}`);
        } catch (err) {
          if (err.code === 11000) {
            console.log('Agent commission already recorded, skipping');
          } else {
            console.error('Error recording agent commission:', err);
          }
        }
      }

      const transactions = [
        {
          type: isFourCornersWin ? 'WIN_FOUR_CORNERS' : 'WIN',
          userId: userId,
          userName: userName,
          amount: totalPrize,
          room: roomStake,
          description: `Bingo win in ${roomStake} ETB room${isFourCornersWin ? ' (Four Corners Bonus)' : ''}`,
          winningPattern: bingoCheck.pattern,
          winningPatternName: bingoCheck.patternName,
          winningPatternType: bingoCheck.patternType
        },
        {
          type: 'HOUSE_EARNINGS',
          userId: 'HOUSE',
          userName: 'House',
          amount: houseEarnings,
          room: roomStake,
          description: `Commission from ${totalPlayers} players in ${roomStake} ETB room`
        }
      ];

      await models.Transaction.insertMany(transactions);

      roomWinners.set(roomStake, Date.now());

      cleanupRoomTimer(roomStake);

      const gameOverData = {
        room: roomStake,
        winnerId: userId,
        winnerName: userName,
        prize: totalPrize,
        basePrize: basePrize,
        bonus: bonus,
        playersCount: totalPlayers,
        isFourCornersWin: isFourCornersWin,
        gameEnded: true,
        reason: 'bingo_win',
        commissionPerPlayer: commissionPerPlayer,
        contributionPerPlayer: contributionPerPlayer,
        houseEarnings: houseEarnings,

        winnerGrid: grid,
        winningPattern: bingoCheck.pattern,
        winningPatternName: bingoCheck.patternName,
        winningPatternType: bingoCheck.patternType,
        markedNumbers: markedNumbers,
        calledNumbers: roomData.calledNumbers || []
      };

      const playersInRoom = [...roomData.players];

      const resetPromises = playersInRoom
        .filter(playerId => playerId !== userId)
        .map(playerId =>
          models.User.findOneAndUpdate(
            { userId: playerId },
            { currentRoom: null, box: null }
          )
        );

      await Promise.all(resetPromises);

      broadcastGameOver(roomStake, playersInRoom, gameOverData);

      setTimeout(() => {
        resetRoomForNextGame(roomStake);
      }, 3000);

      console.log(`✅ BINGO processed successfully for ${userName} in ${roomStake} ETB room`);

      return {
        success: true,
        prize: totalPrize,
        players: totalPlayers,
        claimId: claimId
      };

    } finally {
      processingClaims.delete(roomLockKey);
      console.log(`🔓 Released room lock for ${roomStake}`);
    }

  } catch (error) {
    console.error(`❌ Error processing bingo claim ${claimId}:`, error);

    notifyPlayer(userId, {
      type: 'error',
      message: 'Error processing bingo claim: ' + (error.message || 'Unknown error'),
      claimId: claimId
    });

    return { success: false, reason: 'processing_error', error: error.message };
  }
}

async function cleanupStuckCountdowns() {
  try {
    const now = new Date();
    const rooms = await models.Room.find({ status: 'starting' });

    for (const room of rooms) {
      if (room.countdownStartTime) {
        const timeSinceStart = now - new Date(room.countdownStartTime);
        if (timeSinceStart > 45000) {
          console.log(`⚠️ Cleaning up stuck countdown for room ${room.stake} (${timeSinceStart/1000}s)`);

          const countdownKey = `countdown_${room.stake}`;
          if (roomTimers.has(countdownKey)) {
            clearInterval(roomTimers.get(countdownKey));
            roomTimers.delete(countdownKey);
          }

          room.status = 'waiting';
          room.countdownStartTime = null;
          room.countdownStartedWith = 0;
          await room.save();

          updateRoomCache(room.stake, room);

          const socketsToSend = new Set();

          room.players.forEach(userId => {
            for (const [socketId, uId] of socketToUser.entries()) {
              if (uId === userId) {
                if (getEndpoint(socketId)?.connected !== false) {
                  socketsToSend.add(socketId);
                }
              }
            }
          });

          const subscribedSockets = roomSubscriptions.get(room.stake) || new Set();
          subscribedSockets.forEach(socketId => {
            if (getEndpoint(socketId)?.connected !== false) {
              socketsToSend.add(socketId);
            }
          });

          const onlinePlayers = await getOnlinePlayersInRoomWithCache(room.stake);
          socketsToSend.forEach(socketId => {
            const socket = getEndpoint(socketId);
            if (socket && socket.connected !== false) {
              socket.emit('gameCountdown', {
                room: room.stake,
                timer: 0
              });
              socket.emit('lobbyUpdate', {
                room: room.stake,
                count: onlinePlayers.length
              });
            }
          });

          console.log(`✅ Reset stuck room ${room.stake} back to waiting`);
        }
      }
    }
  } catch (error) {
    console.error('Error in cleanupStuckCountdowns:', error);
  }
}

async function cleanupStaleRooms() {
  try {
    const oneHourAgo = new Date(Date.now() - 3600000);

    const staleRooms = await models.Room.find({
      status: 'ended',
      endTime: { $lt: oneHourAgo }
    });

    for (const room of staleRooms) {
      console.log(`🧹 Cleaning up stale room: ${room.stake} ETB`);

      if (room.takenBoxes.length > 0 || room.players.length > 0) {
        console.log(`⚠️ Room ${room.stake} still has ${room.takenBoxes.length} taken boxes and ${room.players.length} players. Clearing...`);
        room.players = [];
        room.takenBoxes = [];
        room.status = 'waiting';
        room.lastBoxUpdate = new Date();
        await room.save();

        updateRoomCache(room.stake, room);
        onlinePlayersCache.delete(`online_${room.stake}`);

        broadcastTakenBoxes(room.stake, []);
        io.emit('boxesCleared', { room: room.stake, reason: 'stale_room_cleanup' });
      }

      const oneDayAgo = new Date(Date.now() - 86400000);
      if (room.endTime && room.endTime < oneDayAgo) {
        await models.Room.deleteOne({ _id: room._id });
        console.log(`🗑️ Deleted stale room from database: ${room.stake} ETB`);
      }
    }

    const emptyPlayingRooms = await models.Room.find({
      status: 'playing',
      players: { $size: 0 }
    });

    for (const room of emptyPlayingRooms) {
      console.log(`🧹 Cleaning up empty playing room: ${room.stake} ETB`);
      cleanupRoomTimer(room.stake);

      room.players = [];
      room.takenBoxes = [];
      room.status = 'waiting';
      room.calledNumbers = [];
      room.currentBall = null;
      room.ballsDrawn = 0;
      room.startTime = null;
      room.lastBoxUpdate = new Date();
      await room.save();

      updateRoomCache(room.stake, room);
      onlinePlayersCache.delete(`online_${room.stake}`);

      broadcastTakenBoxes(room.stake, []);
      io.emit('boxesCleared', { room: room.stake, reason: 'empty_room_cleanup' });
    }

  } catch (error) {
    console.error('Error in cleanupStaleRooms:', error);
  }
}

function cleanupMemory() {
  console.log('🧹 Running memory cleanup...');

  socketToUser.forEach((userId, socketId) => {
    const socket = getEndpoint(socketId);
    if (!socket || socket.connected === false) {
      socketToUser.delete(socketId);
    }
  });

  const now = Date.now();
  roomsCache.forEach((value, key) => {
    if (now - value.timestamp > 30000) {
      roomsCache.delete(key);
    }
  });

  onlinePlayersCache.forEach((value, key) => {
    if (now - value.timestamp > 30000) {
      onlinePlayersCache.delete(key);
    }
  });

  cleanupProcessingClaims();
  cleanupRoomWinners();

  console.log(`🧹 Memory cleanup complete. Cache sizes: Rooms=${roomsCache.size}, Online=${onlinePlayersCache.size}`);
}

async function cleanupStaleConnections() {
  console.log('🧹 Running connection cleanup...');

  const now = new Date();
  const thirtySecondsAgo = new Date(now.getTime() - 30000);

  try {
    await models.User.updateMany(
      {
        lastSeen: { $lt: thirtySecondsAgo },
        isOnline: true
      },
      {
        isOnline: false
      }
    );

    socketToUser.forEach((userId, socketId) => {
      const socket = getEndpoint(socketId);
      if (!socket || socket.connected === false) {
        socketToUser.delete(socketId);
      }
    });

  } catch (error) {
    console.error('Error in cleanupStaleConnections:', error);
  }
}

async function resetHouseEarnings(adminSocketId) {
  try {
    console.log('💰 Attempting to reset house earnings...');

    const currentEarnings = await models.Transaction.aggregate([
      { $match: { type: 'HOUSE_EARNINGS' } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]).then(result => result[0]?.total || 0);

    if (currentEarnings === 0) {
      return {
        success: false,
        message: 'House earnings are already at zero'
      };
    }

    const resetTransaction = new models.Transaction({
      type: 'HOUSE_EARNINGS_RESET',
      userId: 'ADMIN',
      userName: 'Admin',
      amount: -currentEarnings,
      description: `House earnings reset by admin (was ${currentEarnings.toFixed(2)} ETB)`,
      adminSocketId: adminSocketId,
      timestamp: new Date()
    });

    await resetTransaction.save();

    console.log(`✅ House earnings reset from ${currentEarnings.toFixed(2)} to 0 ETB`);

    const adminSocket = getEndpoint(adminSocketId);
    if (adminSocket) {
      adminSocket.emit('admin:houseEarningsReset', {
        previousAmount: currentEarnings.toFixed(2),
        newAmount: 0,
        timestamp: new Date().toISOString()
      });
    }

    updateAdminPanel();

    logActivity('HOUSE_EARNINGS_RESET', {
      adminSocketId: adminSocketId,
      previousAmount: currentEarnings.toFixed(2),
      newAmount: 0
    }, adminSocketId);

    return {
      success: true,
      message: `House earnings reset from ${currentEarnings.toFixed(2)} to 0 ETB`,
      previousAmount: currentEarnings
    };

  } catch (error) {
    console.error('❌ Error resetting house earnings:', error);

    const adminSocket = getEndpoint(adminSocketId);
    if (adminSocket) {
      adminSocket.emit('admin:houseEarningsResetError', error.message);
    }

    return {
      success: false,
      message: 'Failed to reset house earnings: ' + error.message
    };
  }
}

async function disconnectUser(userId, adminSocketId) {
  try {
    console.log(`🔌 Disconnecting all sockets for user ${userId}`);

    let disconnectedCount = 0;

    socketToUser.forEach((uId, socketId) => {
      if (uId === userId) {
        const socket = getEndpoint(socketId);
        if (socket && socket.connected !== false) {
          socket.disconnect();
          disconnectedCount++;
        }
      }
    });

    io.sockets.sockets.forEach((socket) => {
      if (socket && socket.connected && socket.userId === userId) {
        socket.disconnect();
        disconnectedCount++;
      }
    });

    logActivity('ADMIN_DISCONNECT_USER', {
      adminSocketId: adminSocketId,
      userId: userId,
      disconnectedSockets: disconnectedCount
    }, adminSocketId);

    return {
      success: true,
      message: `Disconnected ${disconnectedCount} socket(s) for user ${userId}`,
      disconnectedCount: disconnectedCount
    };

  } catch (error) {
    console.error('❌ Error disconnecting user:', error);
    return {
      success: false,
      message: 'Failed to disconnect user: ' + error.message
    };
  }
}

// ========== BOT MANAGEMENT API (ENHANCED) ==========
async function getBotsList() {
  // Fetch fresh from database to ensure up‑to‑date info
  const dbBots = await models.User.find({ isBot: true }).lean();
  return dbBots.map(b => ({
    userId: b.userId,
    userName: b.userName,
    balance: Number(b.balance).toFixed(2),
    active: b.botActive !== false,
    currentRoom: b.currentRoom,
    box: b.box
  }));
}

async function addBotFunds(botId, amount) {
  const bot = bots.find(b => b.userId === botId);
  if (!bot) throw new Error('Bot not found');
  bot.balance += amount;
  await models.User.findOneAndUpdate(
    { userId: botId },
    { $inc: { balance: amount } }
  );
  return { success: true, newBalance: bot.balance };
}

async function renameBot(botId, newName) {
  console.log(`[renameBot] called with botId=${botId}, newName=${newName}`);
  const bot = bots.find(b => b.userId === botId);
  if (!bot) {
    console.error(`[renameBot] Bot not found: ${botId}`);
    throw new Error('Bot not found');
  }
  bot.userName = newName;
  await models.User.findOneAndUpdate(
    { userId: botId },
    { userName: newName }
  );
  console.log(`[renameBot] Success: ${botId} renamed to ${newName}`);
  return { success: true };
}

async function setBotActive(botId, active) {
  console.log(`[setBotActive] botId=${botId}, active=${active}`);
  const bot = bots.find(b => b.userId === botId);
  if (!bot) throw new Error('Bot not found');
  bot.active = active;
  await models.User.findOneAndUpdate(
    { userId: botId },
    { botActive: active }
  );
  if (!active) {
    if (bot.retryTimer) {
      clearTimeout(bot.retryTimer);
      bot.retryTimer = null;
    }
    if (bot.waitTimeout) {
      clearTimeout(bot.waitTimeout);
      bot.waitTimeout = null;
    }
    if (bot.claimTimeout) {
      clearTimeout(bot.claimTimeout);
      bot.claimTimeout = null;
    }
    if (bot.currentRoom) {
      bot._leaveRoom();
    }
  } else {
    bot._scheduleRetry(5000);
  }
  console.log(`[setBotActive] success`);
  return { success: true };
}

async function addNewBot(name) {
  const newId = bots.length;
  const botName = name || `Bot${newId+1}`;
  const bot = new Bot(newId, botName, {
    generateTraditionalBingoCard,
    checkBingo,
    processBingoClaim,
    getRoomStatus,
    getRoomWithCache
  });
  const user = new models.User({
    userId: bot.userId,
    userName: bot.userName,
    balance: bot.balance,
    referralCode: generateReferralCode(bot.userId),
    isBot: true,
    botActive: true
  });
  await user.save();
  bots.push(bot);
  botSockets.set(bot.userId, bot.socket);
  socketToUser.set(bot.userId, bot.userId);
  if (bot.active) {
    bot._scheduleRetry(5000);
  }
  return { success: true, bot: bot.userId };
}

// ========== SOCKET.IO EVENT HANDLERS ==========
function setupSocketHandlers() {
  io.on('connection', (socket) => {
    console.log(`✅ Socket.IO Connected: ${socket.id} - User: ${socket.handshake.query?.userId || 'Unknown'}`);
    connectedSockets.add(socket.id);

    const query = socket.handshake.query;
    if (query.userId) {
      socket.userId = query.userId;
    }

    socket.emit('connectionTest', {
      status: 'connected',
      serverTime: new Date().toISOString(),
      socketId: socket.id,
      server: 'Bingo Elite Telegram',
      userId: query.userId || 'unknown'
    });

    // ========== ADMIN AUTHENTICATION (PASSWORDLESS) ==========
    socket.on('admin:auth', (password) => {
      adminSockets.add(socket.id);
      socket.emit('admin:authSuccess');
      console.log(`✅ Admin socket added: ${socket.id}, total adminSockets: ${adminSockets.size}`);
      updateAdminPanel();
      socket.emit('admin:telebirrNumber', telebirrNumber);
      logActivity('ADMIN_LOGIN', { socketId: socket.id }, socket.id);
    });

    socket.on('admin:getData', () => {
      if (!adminSockets.has(socket.id)) {
        socket.emit('admin:error', 'Unauthorized - Please authenticate first');
        return;
      }
      updateAdminPanel();
    });

    socket.on('admin:resetHouseEarnings', async () => {
      if (!adminSockets.has(socket.id)) {
        socket.emit('admin:error', 'Unauthorized');
        return;
      }
      const result = await resetHouseEarnings(socket.id);
      if (!result.success) {
        socket.emit('admin:error', result.message);
      } else {
        socket.emit('admin:success', result.message);
      }
    });

    socket.on('admin:disconnectUser', async (userId) => {
      if (!adminSockets.has(socket.id)) {
        socket.emit('admin:error', 'Unauthorized');
        return;
      }
      const result = await disconnectUser(userId, socket.id);
      if (!result.success) {
        socket.emit('admin:error', result.message);
      } else {
        socket.emit('admin:success', result.message);
      }
      updateAdminPanel();
    });

    socket.on('admin:addFunds', async ({ userId, amount }) => {
      if (!adminSockets.has(socket.id)) {
        socket.emit('admin:error', 'Unauthorized');
        return;
      }
      const user = await models.User.findOne({ userId: userId });
      if (!user) {
        socket.emit('admin:error', 'User not found');
        return;
      }
      const oldBalance = user.balance;
      user.balance += parseFloat(amount);
      await user.save();

      const transaction = new models.Transaction({
        type: 'ADMIN_ADD',
        userId: userId,
        userName: user.userName,
        amount: amount,
        admin: true,
        description: `Admin added ${amount} ETB`
      });
      await transaction.save();

      for (const [sId, uId] of socketToUser.entries()) {
        if (uId === userId) {
          const playerSocket = getEndpoint(sId);
          if (playerSocket && playerSocket.connected !== false) {
            playerSocket.emit('balanceUpdate', user.balance);
            playerSocket.emit('fundsAdded', {
              amount: amount,
              newBalance: user.balance
            });
          }
        }
      }

      socket.emit('admin:success', `Added ${amount} ETB to ${user.userName}`);
      updateAdminPanel();
      logActivity('ADMIN_ADD_FUNDS', { adminSocket: socket.id, userId, amount }, socket.id);
    });

    socket.on('admin:approveDeposit', async (transactionId) => {
      if (!adminSockets.has(socket.id)) {
        socket.emit('admin:error', 'Unauthorized');
        return;
      }
      try {
        const transaction = await models.Transaction.findOne({ _id: transactionId, type: 'DEPOSIT_REQUEST', status: 'pending' });
        if (!transaction) {
          socket.emit('admin:error', 'Transaction not found or already processed');
          return;
        }
        const user = await models.User.findOne({ userId: transaction.userId });
        if (!user) {
          socket.emit('admin:error', 'User not found');
          return;
        }
        user.balance += transaction.amount;
        await user.save();

        transaction.status = 'approved';
        transaction.approvedBy = socket.id;
        transaction.approvedAt = new Date();
        transaction.description = `Deposit approved by admin - Receipt: ${transaction.receiptNumber}`;
        await transaction.save();

        for (const [sId, uId] of socketToUser.entries()) {
          if (uId === transaction.userId) {
            const playerSocket = getEndpoint(sId);
            if (playerSocket && playerSocket.connected !== false) {
              playerSocket.emit('balanceUpdate', user.balance);
              playerSocket.emit('wallet:depositApproved', {
                amount: transaction.amount,
                newBalance: user.balance,
                message: `Deposit of ${transaction.amount} ETB approved by admin`
              });
            }
          }
        }

        socket.emit('admin:success', `Approved deposit of ${transaction.amount} ETB for ${user.userName}`);
        updateAdminPanel();
        logActivity('ADMIN_APPROVE_DEPOSIT', { adminSocket: socket.id, userId: user.userId, amount: transaction.amount, receiptNumber: transaction.receiptNumber }, socket.id);
      } catch (error) {
        console.error('Error approving deposit:', error);
        socket.emit('admin:error', 'Error approving deposit: ' + error.message);
      }
    });

    socket.on('admin:approveWithdrawal', async (transactionId) => {
      if (!adminSockets.has(socket.id)) {
        socket.emit('admin:error', 'Unauthorized');
        return;
      }
      try {
        const transaction = await models.Transaction.findOne({ _id: transactionId, type: 'WITHDRAW_REQUEST', status: 'pending' });
        if (!transaction) {
          socket.emit('admin:error', 'Transaction not found or already processed');
          return;
        }
        const user = await models.User.findOne({ userId: transaction.userId });
        if (!user) {
          socket.emit('admin:error', 'User not found');
          return;
        }
        if (user.balance < Math.abs(transaction.amount)) {
          socket.emit('admin:error', 'User has insufficient balance');
          return;
        }

        user.balance += transaction.amount;
        await user.save();

        if (!user.phoneNumber && transaction.phoneNumber) {
          user.phoneNumber = transaction.phoneNumber;
          await user.save();
        }

        transaction.status = 'approved';
        transaction.approvedBy = socket.id;
        transaction.approvedAt = new Date();
        transaction.description = `Withdrawal approved by admin - Sent to: ${transaction.phoneNumber}`;
        await transaction.save();

        const withdrawalTransaction = new models.Transaction({
          type: 'WITHDRAWAL',
          userId: transaction.userId,
          userName: transaction.userName,
          amount: transaction.amount,
          phoneNumber: transaction.phoneNumber,
          description: `Withdrawal of ${Math.abs(transaction.amount)} ETB sent to ${transaction.phoneNumber}`
        });
        await withdrawalTransaction.save();

        for (const [sId, uId] of socketToUser.entries()) {
          if (uId === transaction.userId) {
            const playerSocket = getEndpoint(sId);
            if (playerSocket && playerSocket.connected !== false) {
              playerSocket.emit('balanceUpdate', user.balance);
              playerSocket.emit('wallet:withdrawalApproved', {
                amount: Math.abs(transaction.amount),
                phoneNumber: transaction.phoneNumber,
                newBalance: user.balance,
                message: `Withdrawal of ${Math.abs(transaction.amount)} ETB approved and sent to ${transaction.phoneNumber}`
              });
            }
          }
        }

        socket.emit('admin:success', `Approved withdrawal of ${Math.abs(transaction.amount)} ETB for ${user.userName} to ${transaction.phoneNumber}`);
        updateAdminPanel();
        logActivity('ADMIN_APPROVE_WITHDRAWAL', { adminSocket: socket.id, userId: user.userId, amount: Math.abs(transaction.amount), phoneNumber: transaction.phoneNumber }, socket.id);
      } catch (error) {
        console.error('Error approving withdrawal:', error);
        socket.emit('admin:error', 'Error approving withdrawal: ' + error.message);
      }
    });

    socket.on('admin:rejectTransaction', async (transactionId) => {
      if (!adminSockets.has(socket.id)) {
        socket.emit('admin:error', 'Unauthorized');
        return;
      }
      try {
        const transaction = await models.Transaction.findOne({ _id: transactionId, status: 'pending' });
        if (!transaction) {
          socket.emit('admin:error', 'Transaction not found or already processed');
          return;
        }
        transaction.status = 'rejected';
        transaction.approvedBy = socket.id;
        transaction.approvedAt = new Date();
        transaction.description = `${transaction.description} - Rejected by admin`;
        await transaction.save();

        for (const [sId, uId] of socketToUser.entries()) {
          if (uId === transaction.userId) {
            const playerSocket = getEndpoint(sId);
            if (playerSocket && playerSocket.connected !== false) {
              if (transaction.type === 'DEPOSIT_REQUEST') {
                playerSocket.emit('wallet:depositRejected', {
                  amount: transaction.amount,
                  message: 'Deposit request rejected by admin. Please contact support.'
                });
              } else if (transaction.type === 'WITHDRAW_REQUEST') {
                playerSocket.emit('wallet:withdrawalRejected', {
                  amount: Math.abs(transaction.amount),
                  message: 'Withdrawal request rejected by admin. Please contact support.'
                });
              }
            }
          }
        }

        socket.emit('admin:success', `Rejected ${transaction.type} for ${transaction.userName}`);
        updateAdminPanel();
        logActivity('ADMIN_REJECT_TRANSACTION', { adminSocket: socket.id, userId: transaction.userId, transactionId, type: transaction.type }, socket.id);
      } catch (error) {
        console.error('Error rejecting transaction:', error);
        socket.emit('admin:error', 'Error rejecting transaction: ' + error.message);
      }
    });

    socket.on('admin:getPendingTransactions', async () => {
      if (!adminSockets.has(socket.id)) {
        socket.emit('admin:error', 'Unauthorized');
        return;
      }
      try {
        const pendingTransactions = await models.Transaction.find({
          status: 'pending',
          type: { $in: ['DEPOSIT_REQUEST', 'WITHDRAW_REQUEST'] }
        }).sort({ createdAt: -1 });
        socket.emit('admin:pendingTransactions', pendingTransactions);
      } catch (error) {
        console.error('Error getting pending transactions:', error);
        socket.emit('admin:error', 'Error getting pending transactions');
      }
    });

    socket.on('admin:forceDraw', async (roomStake) => {
      if (!adminSockets.has(socket.id)) {
        socket.emit('admin:error', 'Unauthorized');
        return;
      }
      const room = await models.Room.findOne({ stake: parseInt(roomStake), status: 'playing' });
      if (room) {
        let ball;
        let letter;
        do {
          ball = Math.floor(Math.random() * 75) + 1;
          letter = getBingoLetter(ball);
        } while (room.calledNumbers.includes(ball));

        room.calledNumbers.push(ball);
        room.currentBall = ball;
        room.ballsDrawn += 1;
        room.lastBoxUpdate = new Date();
        await room.save();

        const ballData = { room: room.stake, num: ball, letter };

        room.players.forEach(userId => {
          for (const [sId, uId] of socketToUser.entries()) {
            if (uId === userId) {
              const s = getEndpoint(sId);
              if (s && s.connected !== false) {
                s.emit('ballDrawn', ballData);
              }
            }
          }
        });

        socket.emit('admin:success', `Ball ${letter}-${ball} drawn in ${roomStake} ETB room`);
        broadcastRoomStatus();
        logActivity('ADMIN_FORCE_DRAW', { adminSocket: socket.id, roomStake, ball, letter }, socket.id);
      }
    });

    socket.on('admin:banPlayer', async (userId) => {
      if (!adminSockets.has(socket.id)) {
        socket.emit('admin:error', 'Unauthorized');
        return;
      }
      const user = await models.User.findOne({ userId: userId });
      if (!user) {
        socket.emit('admin:error', 'User not found');
        return;
      }
      for (const [sId, uId] of socketToUser.entries()) {
        if (uId === userId) {
          const playerSocket = getEndpoint(sId);
          if (playerSocket && playerSocket.connected !== false) {
            playerSocket.emit('banned');
            playerSocket.disconnect();
          }
        }
      }
      socket.emit('admin:success', `Banned user ${user.userName}`);
      updateAdminPanel();
      logActivity('ADMIN_BAN', { adminSocket: socket.id, userId }, socket.id);
    });

    socket.on('admin:forceStartGame', async (roomStake) => {
      if (!adminSockets.has(socket.id)) {
        socket.emit('admin:error', 'Unauthorized');
        return;
      }
      const room = await models.Room.findOne({ stake: parseInt(roomStake) });
      if (room) {
        room.status = 'playing';
        room.startTime = new Date();
        await room.save();
        await startGameTimer(room);

        const socketsToSend = new Set();
        room.players.forEach(userId => {
          for (const [sId, uId] of socketToUser.entries()) {
            if (uId === userId) {
              if (getEndpoint(sId)?.connected !== false) {
                socketsToSend.add(sId);
              }
            }
          }
        });

        const subscribedSockets = roomSubscriptions.get(room.stake) || new Set();
        subscribedSockets.forEach(socketId => {
          if (getEndpoint(socketId)?.connected !== false) {
            socketsToSend.add(socketId);
          }
        });

        socketsToSend.forEach(socketId => {
          const s = getEndpoint(socketId);
          if (s && s.connected !== false) {
            s.emit('gameStarted', {
              room: roomStake,
              players: room.players.length
            });
          }
        });

        socket.emit('admin:success', `Force started ${roomStake} ETB room`);
        broadcastRoomStatus();
        logActivity('ADMIN_FORCE_START', { adminSocket: socket.id, roomStake }, socket.id);
      }
    });

    socket.on('admin:forceEndGame', async (roomStake) => {
      if (!adminSockets.has(socket.id)) {
        socket.emit('admin:error', 'Unauthorized');
        return;
      }
      const room = await models.Room.findOne({ stake: parseInt(roomStake) });
      if (room) {
        cleanupRoomTimer(roomStake);
        const playersInRoom = [...room.players];
        for (const userId of playersInRoom) {
          const user = await models.User.findOne({ userId: userId });
          if (user) {
            user.balance += roomStake;
            user.currentRoom = null;
            user.box = null;
            await user.save();

            const transaction = new models.Transaction({
              type: 'REFUND',
              userId: userId,
              userName: user.userName,
              amount: roomStake,
              room: roomStake,
              description: `Game force ended by admin - stake refunded`
            });
            await transaction.save();

            for (const [sId, uId] of socketToUser.entries()) {
              if (uId === userId) {
                const s = getEndpoint(sId);
                if (s && s.connected !== false) {
                  s.emit('gameOver', {
                    room: roomStake,
                    winnerId: 'ADMIN',
                    winnerName: 'Admin',
                    prize: 0,
                    basePrize: 0,
                    bonus: 0,
                    playersCount: playersInRoom.length,
                    isFourCornersWin: false,
                    gameEnded: true,
                    reason: 'admin_ended',
                    commissionPerPlayer: CONFIG.HOUSE_COMMISSION[roomStake] || 0
                  });
                  s.emit('balanceUpdate', user.balance);
                }
              }
            }
          }
        }

        room.players = [];
        room.takenBoxes = [];
        room.status = 'ended';
        room.endTime = new Date();
        room.lastBoxUpdate = new Date();
        await room.save();

        updateRoomCache(roomStake, room);
        broadcastTakenBoxes(roomStake, []);
        socket.emit('admin:success', `Force ended ${roomStake} ETB game`);
        broadcastRoomStatus();
        logActivity('ADMIN_FORCE_END', { adminSocket: socket.id, roomStake }, socket.id);
      }
    });

    socket.on('admin:clearBoxes', async (roomStake) => {
      if (!adminSockets.has(socket.id)) {
        socket.emit('admin:error', 'Unauthorized');
        return;
      }
      const room = await models.Room.findOne({ stake: parseInt(roomStake) });
      if (!room) {
        socket.emit('admin:error', 'Room not found');
        return;
      }
      const playersInRoom = [...room.players];
      for (const userId of playersInRoom) {
        const user = await models.User.findOne({ userId: userId });
        if (user) {
          user.balance += roomStake;
          user.currentRoom = null;
          user.box = null;
          await user.save();

          const transaction = new models.Transaction({
            type: 'REFUND',
            userId: userId,
            userName: user.userName,
            amount: roomStake,
            room: roomStake,
            description: `Boxes cleared by admin - stake refunded`
          });
          await transaction.save();

          for (const [sId, uId] of socketToUser.entries()) {
            if (uId === userId) {
              const s = getEndpoint(sId);
              if (s && s.connected !== false) {
                s.emit('boxesCleared', { room: roomStake, adminCleared: true, reason: 'admin_cleared' });
                s.emit('balanceUpdate', user.balance);
                s.emit('lobbyUpdate', { room: roomStake, count: 0 });
              }
            }
          }
        }
      }

      room.players = [];
      room.takenBoxes = [];
      room.status = 'waiting';
      room.lastBoxUpdate = new Date();
      await room.save();

      updateRoomCache(roomStake, room);
      broadcastTakenBoxes(roomStake, []);
      socket.emit('admin:success', `Cleared all boxes in ${roomStake} ETB room`);
      logActivity('ADMIN_CLEAR_BOXES', { adminSocket: socket.id, roomStake }, socket.id);
    });

    socket.on('admin:debugCountdown', async (roomStake) => {
      if (!adminSockets.has(socket.id)) {
        socket.emit('admin:error', 'Unauthorized');
        return;
      }
      const room = await models.Room.findOne({ stake: parseInt(roomStake) });
      if (room) {
        const onlinePlayers = await getOnlinePlayersInRoomWithCache(room.stake);
        socket.emit('admin:success', `Room ${roomStake}: ${room.status}, ${onlinePlayers.length} online, ${room.players.length} total, countdown active: ${roomTimers.has(`countdown_${roomStake}`)}`);
      }
    });

    // ========== BOT MANAGEMENT EVENTS (ADMIN ONLY) ==========
    socket.on('admin:getBotsList', async () => {
      if (!adminSockets.has(socket.id)) {
        socket.emit('admin:error', 'Unauthorized');
        return;
      }
      try {
        const list = await getBotsList();
        socket.emit('admin:botsList', list);
      } catch (err) {
        console.error('Error fetching bots list:', err);
        socket.emit('admin:error', 'Failed to fetch bots list');
      }
    });

    socket.on('admin:addBotFunds', async ({ botId, amount }) => {
      if (!adminSockets.has(socket.id)) {
        socket.emit('admin:error', 'Unauthorized');
        return;
      }
      try {
        const result = await addBotFunds(botId, parseFloat(amount));
        socket.emit('admin:botFundsAdded', result);
        // Refresh list for all admins
        const list = await getBotsList();
        adminSockets.forEach(sid => {
          const s = getEndpoint(sid);
          if (s && s.connected !== false) s.emit('admin:botsList', list);
        });
      } catch (err) {
        socket.emit('admin:error', err.message);
      }
    });

    socket.on('admin:renameBot', async ({ botId, newName }) => {
      if (!adminSockets.has(socket.id)) {
        socket.emit('admin:error', 'Unauthorized');
        return;
      }
      try {
        await renameBot(botId, newName);
        const list = await getBotsList();
        adminSockets.forEach(sid => {
          const s = getEndpoint(sid);
          if (s && s.connected !== false) s.emit('admin:botsList', list);
        });
        socket.emit('admin:success', 'Bot renamed');
      } catch (err) {
        socket.emit('admin:error', err.message);
      }
    });

    socket.on('admin:setBotActive', async ({ botId, active }) => {
      if (!adminSockets.has(socket.id)) {
        socket.emit('admin:error', 'Unauthorized');
        return;
      }
      try {
        await setBotActive(botId, active);
        const list = await getBotsList();
        adminSockets.forEach(sid => {
          const s = getEndpoint(sid);
          if (s && s.connected !== false) s.emit('admin:botsList', list);
        });
        socket.emit('admin:success', `Bot ${active ? 'activated' : 'deactivated'}`);
      } catch (err) {
        socket.emit('admin:error', err.message);
      }
    });

    socket.on('admin:addNewBot', async ({ name }) => {
      if (!adminSockets.has(socket.id)) {
        socket.emit('admin:error', 'Unauthorized');
        return;
      }
      try {
        await addNewBot(name);
        const list = await getBotsList();
        adminSockets.forEach(sid => {
          const s = getEndpoint(sid);
          if (s && s.connected !== false) s.emit('admin:botsList', list);
        });
        socket.emit('admin:success', 'New bot added');
      } catch (err) {
        socket.emit('admin:error', err.message);
      }
    });

    // ========== WALLET EVENT HANDLERS ==========
    socket.on('wallet:depositRequest', async (data) => {
      try {
        const { receiptNumber, amount, userId, userName } = data;

        console.log(`💰 Deposit request from ${userName} (${userId}): ${amount} ETB, Receipt: ${receiptNumber}`);

        const transaction = new models.Transaction({
          type: 'DEPOSIT_REQUEST',
          userId: userId,
          userName: userName,
          amount: parseFloat(amount),
          receiptNumber: receiptNumber,
          description: `Deposit request - Receipt: ${receiptNumber}, Amount: ${amount} ETB`,
          status: 'pending'
        });
        await transaction.save();

        socket.emit('wallet:depositRequestSuccess', {
          message: 'Deposit request submitted successfully. Admin will process it soon.',
          telebirrNumber: telebirrNumber
        });

        adminSockets.forEach(socketId => {
          const adminSocket = getEndpoint(socketId);
          if (adminSocket && adminSocket.connected !== false) {
            adminSocket.emit('admin:newDepositRequest', {
              userId,
              userName,
              amount: parseFloat(amount),
              receiptNumber,
              transactionId: transaction._id,
              timestamp: new Date()
            });
          }
        });

        logActivity('DEPOSIT_REQUEST', { userId, userName, amount, receiptNumber }, socket.id);
      } catch (error) {
        console.error('Error processing deposit request:', error);
        socket.emit('wallet:error', 'Failed to submit deposit request');
      }
    });

    socket.on('wallet:withdrawRequest', async (data) => {
      try {
        const { amount, phoneNumber, userId, userName } = data;

        console.log(`💰 Withdrawal request from ${userName} (${userId}): ${amount} ETB to ${phoneNumber}`);

        const user = await models.User.findOne({ userId: userId });
        if (!user) {
          socket.emit('wallet:error', 'User not found');
          return;
        }
        if (user.balance < amount) {
          socket.emit('wallet:error', 'Insufficient balance for withdrawal');
          return;
        }
        if (amount < CONFIG.MIN_WITHDRAWAL) {
          socket.emit('wallet:error', `Minimum withdrawal amount is ${CONFIG.MIN_WITHDRAWAL} ETB`);
          return;
        }
        if (amount > CONFIG.MAX_WITHDRAWAL) {
          socket.emit('wallet:error', `Maximum withdrawal amount is ${CONFIG.MAX_WITHDRAWAL} ETB`);
          return;
        }

        const transaction = new models.Transaction({
          type: 'WITHDRAW_REQUEST',
          userId: userId,
          userName: userName,
          amount: -parseFloat(amount),
          phoneNumber: phoneNumber,
          description: `Withdrawal request to phone: ${phoneNumber}, Amount: ${amount} ETB`,
          status: 'pending'
        });
        await transaction.save();

        if (!user.phoneNumber) {
          user.phoneNumber = phoneNumber;
          await user.save();
        }

        socket.emit('wallet:withdrawRequestSuccess', {
          message: 'Withdrawal request submitted successfully. Admin will process it soon.'
        });

        adminSockets.forEach(socketId => {
          const adminSocket = getEndpoint(socketId);
          if (adminSocket && adminSocket.connected !== false) {
            adminSocket.emit('admin:newWithdrawRequest', {
              userId,
              userName,
              amount: parseFloat(amount),
              phoneNumber,
              transactionId: transaction._id,
              timestamp: new Date()
            });
          }
        });

        logActivity('WITHDRAW_REQUEST', { userId, userName, amount, phoneNumber }, socket.id);
      } catch (error) {
        console.error('Error processing withdrawal request:', error);
        socket.emit('wallet:error', 'Failed to submit withdrawal request');
      }
    });

    socket.on('getTelebirrNumber', (callback) => {
      if (callback) {
        callback({ telebirrNumber: telebirrNumber });
      } else {
        socket.emit('telebirrNumber', telebirrNumber);
      }
    });

    // ========== PLAYER EVENTS ==========
    socket.on('init', async (data, callback) => {
      try {
        const { userId, userName } = data;

        console.log(`📱 User init: ${userName} (${userId}) via socket ${socket.id}`);

        socket.userId = userId;

        const user = await getUser(userId, userName);

        if (user) {
          if (user.currentRoom) {
            try {
              const room = await getRoomWithCache(user.currentRoom);
              if (!room || !room.players.includes(user.userId)) {
                console.log(`🧹 Cleaning stale room status for ${user.userName} (${user.userId}) on init`);
                user.currentRoom = null;
                user.box = null;
                await user.save();
              }
            } catch (error) {
              console.error('Error validating room on init:', error);
              user.currentRoom = null;
              user.box = null;
              await user.save();
            }
          }

          socketToUser.set(socket.id, userId);

          await models.User.findOneAndUpdate(
            { userId: userId },
            {
              isOnline: true,
              lastSeen: new Date(),
              sessionCount: (user.sessionCount || 0) + 1
            }
          );

          socket.emit('balanceUpdate', user.balance);
          socket.emit('userData', {
            userId: userId,
            userName: user.userName,
            balance: user.balance,
            referralCode: user.referralCode,
            phoneNumber: user.phoneNumber || '',
            currentRoom: user.currentRoom,
            box: user.box
          });

          socket.emit('telebirrNumber', telebirrNumber);
          socket.emit('connected', { message: 'Successfully connected to Bingo Elite' });

          if (callback) {
            callback({ success: true, message: 'User initialized successfully' });
          }

          console.log(`✅ User connected successfully: ${userName} (${userId})`);

          updateAdminPanel();
          broadcastRoomStatus();
          logActivity('USER_CONNECTED', { userId, userName, socketId: socket.id });
        } else {
          if (callback) {
            callback({ success: false, message: 'Failed to initialize user' });
          }
        }
      } catch (error) {
        console.error('Error in init:', error);
        if (callback) {
          callback({ success: false, message: 'Server error during initialization' });
        }
      }
    });

    socket.on('refreshBalance', async () => {
      const userId = socketToUser.get(socket.id) || socket.userId;
      if (userId) {
        const user = await models.User.findOne({ userId: userId });
        if (user) {
          socket.emit('balanceUpdate', user.balance);
          socket.emit('balanceRefreshed', user.balance);
        }
      }
    });

    socket.on('getRoomCountdown', async ({ room }, callback) => {
      try {
        const roomData = await getRoomWithCache(parseInt(room));

        if (!roomData) {
          if (callback) callback({ countdownActive: false });
          return;
        }

        if (roomData.status === 'starting' && roomData.countdownStartTime) {
          const elapsed = Date.now() - roomData.countdownStartTime;
          const secondsRemaining = Math.max(0, CONFIG.COUNTDOWN_TIMER - Math.floor(elapsed / 1000));
          const onlinePlayers = await getOnlinePlayersInRoomWithCache(room);

          if (callback) {
            callback({
              countdownActive: true,
              seconds: secondsRemaining,
              onlinePlayers: onlinePlayers.length,
              totalPlayers: roomData.players.length
            });
          }
        } else {
          if (callback) callback({ countdownActive: false });
        }
      } catch (error) {
        console.error('Error in getRoomCountdown:', error);
        if (callback) callback({ countdownActive: false });
      }
    });

    socket.on('getRoomDetails', async ({ room }) => {
      const userId = socketToUser.get(socket.id) || socket.userId;
      if (!userId) {
        socket.emit('roomDetails', { success: false, message: 'User not identified' });
        return;
      }

      try {
        const roomData = await getRoomWithCache(parseInt(room));
        if (!roomData) {
          socket.emit('roomDetails', { success: false, message: 'Room not found' });
          return;
        }

        if (!roomData.players.includes(userId)) {
          socket.emit('roomDetails', { success: false, message: 'User not in this room' });
          return;
        }

        const user = await models.User.findOne({ userId });
        if (!user) {
          socket.emit('roomDetails', { success: false, message: 'User not found' });
          return;
        }

        const onlinePlayers = await getOnlinePlayersInRoomWithCache(room);
        const countdownRemaining = roomData.status === 'starting' && roomData.countdownStartTime
          ? Math.max(0, CONFIG.COUNTDOWN_TIMER - Math.floor((Date.now() - roomData.countdownStartTime) / 1000))
          : 0;

        const response = {
          success: true,
          status: roomData.status,
          players: roomData.players.length,
          onlinePlayers: onlinePlayers.length,
          takenBoxes: roomData.takenBoxes || [],
          calledNumbers: roomData.calledNumbers || [],
          currentBall: roomData.currentBall,
          ballsDrawn: roomData.ballsDrawn,
          startTime: roomData.startTime,
          countdownStartTime: roomData.countdownStartTime,
          countdownRemaining,
          playerBox: user.box
        };

        socket.emit('roomDetails', response);
        console.log(`📤 Room details sent to ${user.userName} for room ${room}: ${roomData.status}`);
      } catch (error) {
        console.error('Error in getRoomDetails:', error);
        socket.emit('roomDetails', { success: false, message: error.message });
      }
    });

    socket.on('getTakenBoxes', async ({ room }, callback) => {
      try {
        const roomData = await getRoomWithCache(parseInt(room));

        if (roomData) {
          console.log(`📦 Getting taken boxes for room ${room}: ${roomData.takenBoxes.length} boxes`);
          callback(roomData.takenBoxes || []);
        } else {
          console.log(`📦 No room found for ${room}, creating new one`);
          callback([]);
        }
      } catch (error) {
        console.error('Error getting taken boxes:', error);
        callback([]);
      }
    });

    socket.on('subscribeToRoom', (data) => {
      const userId = socketToUser.get(socket.id) || socket.userId;
      if (userId && data.room) {
        console.log(`👤 User ${userId} subscribed to room ${data.room} updates`);

        if (!roomSubscriptions.has(data.room)) {
          roomSubscriptions.set(data.room, new Set());
        }
        roomSubscriptions.get(data.room).add(socket.id);

        getRoomWithCache(data.room)
          .then(room => {
            if (room) {
              socket.emit('boxesTakenUpdate', {
                room: data.room,
                takenBoxes: room.takenBoxes || [],
                playerCount: room.players.length,
                timestamp: Date.now()
              });
            } else {
              socket.emit('boxesTakenUpdate', {
                room: data.room,
                takenBoxes: [],
                playerCount: 0,
                timestamp: Date.now()
              });
            }
          })
          .catch(console.error);
      }
    });

    socket.on('unsubscribeFromRoom', (data) => {
      const roomStake = data.room;
      if (roomSubscriptions.has(roomStake)) {
        roomSubscriptions.get(roomStake).delete(socket.id);
      }
    });

    socketHandlers.joinRoom = async function(data, callback) {
      try {
        const { room, box, userName } = data;
        const userId = socketToUser.get(this.id) || this.userId;

        if (!userId) {
          this.emit('error', 'Player not initialized');
          if (callback) callback({ success: false, message: 'Player not initialized' });
          return;
        }

        if (!checkRateLimit(userId, 'joinRoom')) {
          this.emit('error', 'Too many join requests. Please wait.');
          if (callback) callback({ success: false, message: 'Too many requests' });
          return;
        }

        const user = await models.User.findOne({ userId: userId });
        if (!user) {
          this.emit('error', 'User not found');
          if (callback) callback({ success: false, message: 'User not found' });
          return;
        }

        if (user.balance < room) {
          this.emit('insufficientFunds');
          if (callback) callback({ success: false, message: 'Insufficient funds' });
          return;
        }

        let roomData = await getRoomWithCache(room);

        if (!roomData) {
          roomData = new models.Room({
            stake: room,
            players: [],
            takenBoxes: [],
            status: 'waiting',
            lastBoxUpdate: new Date()
          });
          await roomData.save();
          updateRoomCache(room, roomData);
        }

        if (roomData.status === 'playing' || roomData.status === 'ended') {
          this.emit('roomLocked', {
            room: room,
            message: roomData.status === 'ended'
              ? 'Game has ended – please wait for the room to reset.'
              : 'Game is in progress. Please wait for the current game to finish.'
          });
          if (callback) callback({ success: false, message: `Room is locked (${roomData.status})` });
          return;
        }

        if (box < 1 || box > 100) {
          this.emit('error', 'Invalid box number. Must be between 1 and 100');
          if (callback) callback({ success: false, message: 'Invalid box number' });
          return;
        }

        if (roomData.takenBoxes.includes(box)) {
          this.emit('boxTaken');
          if (callback) callback({ success: false, message: 'Box already taken' });
          return;
        }

        if (user.currentRoom) {
          if (user.currentRoom === room) {
            if (roomData.players.includes(userId)) {
              this.emit('joinedRoom');
              if (callback) callback({ success: true, message: 'Already in room' });
              return;
            } else {
              console.log(`🧹 Repairing stale room status for ${user.userName} in joinRoom`);
              user.currentRoom = null;
              user.box = null;
              await user.save();
            }
          } else {
            this.emit('error', 'Already in a different room');
            if (callback) callback({ success: false, message: 'Already in different room' });
            return;
          }
        }

        user.balance -= room;
        user.totalWagered = (user.totalWagered || 0) + room;
        user.currentRoom = room;
        user.box = box;
        await user.save();

        const transaction = new models.Transaction({
          type: 'STAKE',
          userId: user.userId,
          userName: user.userName,
          amount: -room,
          room: room,
          description: `Joined ${room} ETB room with ticket ${box}`
        });
        await transaction.save();

        roomData.players.push(user.userId);
        roomData.takenBoxes.push(box);
        roomData.lastBoxUpdate = new Date();

        const onlinePlayers = await getOnlinePlayersInRoomWithCache(room);

        console.log(`🚀 joinRoom - Room ${room}:`);
        console.log(`   Players in room: ${roomData.players.length}`);
        console.log(`   Online players: ${onlinePlayers.length}`);
        console.log(`   Room status: ${roomData.status}`);

        await roomData.save();

        updateRoomCache(room, roomData);
        onlinePlayersCache.delete(`online_${room}`);

        broadcastTakenBoxes(room, roomData.takenBoxes, box, user.userName);

        this.emit('joinedRoom');
        this.emit('balanceUpdate', user.balance);

        const playersInRoom = roomData.players;
        playersInRoom.forEach(playerUserId => {
          for (const [sId, uId] of socketToUser.entries()) {
            if (uId === playerUserId) {
              const s = getEndpoint(sId);
              if (s && s.connected !== false) {
                s.emit('lobbyUpdate', {
                  room: room,
                  count: onlinePlayers.length
                });
              }
            }
          }
        });

        if (roomData.status === 'starting' && roomData.countdownStartTime) {
          const elapsed = Date.now() - roomData.countdownStartTime;
          const secondsRemaining = Math.max(0, CONFIG.COUNTDOWN_TIMER - Math.floor(elapsed / 1000));
          this.emit('gameCountdown', {
            room: room,
            timer: secondsRemaining,
            onlinePlayers: onlinePlayers.length
          });
        }

        if (onlinePlayers.length >= CONFIG.MIN_PLAYERS_TO_START && roomData.status === 'waiting') {
          console.log(`🚀 STARTING COUNTDOWN for room ${room} with ${onlinePlayers.length} online player(s)!`);
          await startCountdownForRoom(roomData);
        } else {
          console.log(`⏸️ NOT starting countdown:`);
          console.log(`   Online players: ${onlinePlayers.length} (need ${CONFIG.MIN_PLAYERS_TO_START})`);
          console.log(`   Room status: ${roomData.status} (need 'waiting')`);
        }

        this.emit('boxesTakenUpdate', {
          room: room,
          takenBoxes: roomData.takenBoxes,
          personalBox: box,
          message: `You selected box ${box}! Waiting for players...`
        });

        broadcastRoomStatus();
        updateAdminPanel();

        logActivity('BOX_TAKEN', {
          userId: user.userId,
          userName: user.userName,
          room,
          box,
          takenBoxes: roomData.takenBoxes.length,
          playerCount: roomData.players.length,
          onlinePlayers: onlinePlayers.length
        });

        if (callback) {
          callback({
            success: true,
            message: 'Joined room successfully',
            onlinePlayers: onlinePlayers.length
          });
        }

        if (this.id && this.id.startsWith('bot_')) {
          const bot = bots.find(b => b.userId === this.id);
          if (bot) bot.onJoinedRoom(room, box);
        }

      } catch (error) {
        console.error('Error joining room:', error);
        this.emit('error', 'Server error while joining room');
        if (callback) callback({ success: false, message: 'Server error' });
      }
    };

    socket.on('joinRoom', socketHandlers.joinRoom);

    socket.on('claimBingo', async (data, callback) => {
      const { room, grid, marked } = data;
      const userId = socketToUser.get(socket.id) || socket.userId;

      if (!userId) {
        if (callback) callback({ success: false, message: 'Player not initialized' });
        return;
      }

      if (!checkRateLimit(userId, 'claimBingo')) {
        if (callback) callback({
          success: false,
          message: 'Too many claims. Please wait.'
        });
        return;
      }

      const user = await models.User.findOne({ userId: userId }).lean();
      if (!user) {
        if (callback) callback({ success: false, message: 'User not found' });
        return;
      }

      const roomStake = parseInt(room);
      const claimId = `${roomStake}_${userId}_${Date.now()}`;

      console.log(`⚡ FAST BINGO CLAIM from ${user.userName} in room ${roomStake} (ID: ${claimId})`);

      if (callback) {
        callback({
          success: true,
          message: 'BINGO claim received! Processing...',
          claimId: claimId
        });
      }

      const playerSocket = getEndpoint(socket.id);
      if (playerSocket && playerSocket.connected !== false) {
        playerSocket.emit('claimProcessing', { claimId });
      }

      processBingoClaim(claimId, userId, user.userName, roomStake, grid, marked)
        .then(result => {
          console.log(`✅ BINGO processing completed for ${user.userName}:`, result);
        })
        .catch(error => {
          console.error(`❌ BINGO processing error for ${user.userName}:`, error);
        });
    });

    socket.on('player:activity', async (data) => {
      const userId = socketToUser.get(socket.id) || socket.userId;
      if (userId) {
        try {
          await models.User.findOneAndUpdate(
            { userId: userId },
            { lastSeen: new Date() }
          );
        } catch (error) {
          console.error('Error updating player activity:', error);
        }
      }
    });

    socketHandlers.leaveRoom = async function(data) {
      try {
        const userId = socketToUser.get(this.id) || this.userId;
        if (!userId) {
          this.emit('error', 'User not found');
          return;
        }

        console.log(`👤 Player ${userId} requesting to leave room`);

        const user = await models.User.findOne({ userId: userId });
        if (!user || !user.currentRoom) {
          this.emit('leftRoom', { message: 'Not in a room' });
          return;
        }

        const roomStake = user.currentRoom;
        const room = await getRoomWithCache(roomStake);

        if (!room) {
          user.currentRoom = null;
          user.box = null;
          await user.save();
          this.emit('leftRoom', { message: 'Left room (room not found)' });
          return;
        }

        if (room.status === 'playing') {
          console.log(`❌ Player ${user.userName} tried to leave during active game in room ${roomStake}`);
          this.emit('error', 'Cannot leave room during active game! Wait for game to end.');
          return;
        }

        const playerIndex = room.players.indexOf(userId);
        const boxIndex = room.takenBoxes.indexOf(user.box);

        if (playerIndex > -1) {
          room.players.splice(playerIndex, 1);
        }

        if (boxIndex > -1) {
          room.takenBoxes.splice(boxIndex, 1);
        }

        room.lastBoxUpdate = new Date();

        const onlinePlayers = await getOnlinePlayersInRoomWithCache(roomStake);

        await room.save();

        updateRoomCache(roomStake, room);
        onlinePlayersCache.delete(`online_${roomStake}`);

        user.currentRoom = null;
        user.box = null;

        if (room.status === 'waiting') {
          const oldBalance = user.balance;
          user.balance += roomStake;

          console.log(`💰 Refunded ${roomStake} ETB to ${user.userName} (room was waiting), new balance: ${user.balance}`);

          const transaction = new models.Transaction({
            type: 'REFUND',
            userId: userId,
            userName: user.userName,
            amount: roomStake,
            room: roomStake,
            description: `Left room before countdown started - stake refunded`
          });
          await transaction.save();

          this.emit('balanceUpdate', user.balance);
        } else if (room.status === 'starting') {
          console.log(`⚠️ Player ${user.userName} left during countdown - NO REFUND given`);
          const transaction = new models.Transaction({
            type: 'STAKE',
            userId: userId,
            userName: user.userName,
            amount: -roomStake,
            room: roomStake,
            description: `Left room during countdown - stake forfeited`
          });
          await transaction.save();
        }

        await user.save();

        broadcastTakenBoxes(roomStake, room.takenBoxes);

        this.emit('leftRoom', {
          message: room.status === 'starting'
            ? 'Left room successfully - No refund (countdown in progress)'
            : 'Left room successfully',
          refunded: room.status === 'waiting'
        });

        onlinePlayers.forEach(playerUserId => {
          for (const [sId, uId] of socketToUser.entries()) {
            if (uId === playerUserId) {
              const s = getEndpoint(sId);
              if (s && s.connected !== false) {
                s.emit('lobbyUpdate', {
                  room: roomStake,
                  count: onlinePlayers.length
                });
              }
            }
          }
        });

        console.log(`✅ User ${user.userName} left room ${roomStake} during ${room.status} phase, ${room.takenBoxes.length} boxes remain, ${onlinePlayers.length} online players`);

        broadcastRoomStatus();
        updateAdminPanel();

        logActivity('PLAYER_LEFT_ROOM', {
          userId,
          userName: user.userName,
          room: roomStake,
          remainingPlayers: room.players.length,
          onlinePlayers: onlinePlayers.length,
          remainingBoxes: room.takenBoxes.length,
          status: room.status,
          refunded: room.status === 'waiting'
        });

      } catch (error) {
        console.error('❌ Error in player:leaveRoom:', error);
        this.emit('error', 'Failed to leave room: ' + error.message);
      }
    };

    socket.on('player:leaveRoom', socketHandlers.leaveRoom);

    socket.on('getRoomInfo', async (data) => {
      try {
        const { room } = data;
        const userId = socketToUser.get(socket.id) || socket.userId;

        const roomData = await getRoomWithCache(parseInt(room));
        if (roomData) {
          const onlinePlayers = await getOnlinePlayersInRoomWithCache(room);

          socket.emit('lobbyUpdate', {
            room: room,
            count: onlinePlayers.length
          });

          if (roomData.status === 'starting') {
            socket.emit('gameCountdown', {
              room: room,
              timer: Math.max(0, CONFIG.COUNTDOWN_TIMER - Math.floor((Date.now() - roomData.countdownStartTime) / 1000))
            });
          }
        }
      } catch (error) {
        console.error('Error getting room info:', error);
      }
    });

    socket.on('game:ready', async (data) => {
      const userId = socketToUser.get(socket.id) || socket.userId;
      if (userId) {
        console.log(`🎮 Player ${userId} is ready for game`);
        await models.User.findOneAndUpdate(
          { userId: userId },
          { lastSeen: new Date() }
        );
      }
    });

    socket.on('game:started', async (data) => {
      const userId = socketToUser.get(socket.id) || socket.userId;
      if (userId) {
        console.log(`✅ Player ${userId} confirmed game started`);
      }
    });

    socket.on('disconnect', async () => {
      console.log(`❌ Socket disconnected: ${socket.id}`);
      connectedSockets.delete(socket.id);
      adminSockets.delete(socket.id);

      roomSubscriptions.forEach((sockets, room) => {
        sockets.delete(socket.id);
      });

      const userId = socketToUser.get(socket.id) || socket.userId;
      if (userId) {
        console.log(`👤 User ${userId} disconnected`);

        try {
          const user = await models.User.findOne({ userId: userId });
          if (user && user.currentRoom) {
            const roomStake = user.currentRoom;
            const room = await getRoomWithCache(roomStake);

            if (room) {
              if (room.status !== 'playing') {
                const playerIndex = room.players.indexOf(userId);
                const boxIndex = room.takenBoxes.indexOf(user.box);

                if (playerIndex > -1) {
                  room.players.splice(playerIndex, 1);
                }

                if (boxIndex > -1) {
                  room.takenBoxes.splice(boxIndex, 1);
                }

                room.lastBoxUpdate = new Date();

                await room.save();

                updateRoomCache(roomStake, room);
                onlinePlayersCache.delete(`online_${roomStake}`);

                user.currentRoom = null;
                user.box = null;
                await user.save();

                broadcastTakenBoxes(roomStake, room.takenBoxes);

                console.log(`👤 User ${user.userName} removed from room ${roomStake} due to disconnect and user state cleared`);
              } else {
                console.log(`⚠️ User ${user.userName} disconnected during gameplay in room ${roomStake}, keeping in game`);
                user.isOnline = false;
                user.lastSeen = new Date();
                await user.save();
              }
            } else {
              user.isOnline = false;
              user.lastSeen = new Date();
              await user.save();
            }
          } else {
            await models.User.findOneAndUpdate(
              { userId: userId },
              {
                isOnline: false,
                lastSeen: new Date()
              }
            );
          }
        } catch (error) {
          console.error('❌ Error handling disconnect cleanup:', error);
        }

        socketToUser.delete(socket.id);
      }

      setTimeout(() => {
        updateAdminPanel();
        broadcastRoomStatus();
      }, 1000);
    });

    socket.on('ping', () => {
      socket.emit('pong', { time: Date.now() });
    });
  });
}

// ========== OPTIMIZED PERIODIC TASKS ==========
function startPeriodicTasks() {
  console.log('🔄 Starting optimized periodic tasks');

  setInterval(broadcastRoomStatus, CONFIG.ROOM_STATUS_UPDATE_INTERVAL);
  setInterval(updateAdminPanel, 3000);
  setInterval(cleanupMemory, 30000);
  setInterval(cleanupLongRunningGames, 30000);
  setInterval(cleanupStuckCountdowns, 10000);
  setInterval(cleanupStaleConnections, 60000);
  setInterval(cleanupStaleRooms, 300000);
  setInterval(() => {
    playerRateLimit.clear();
    console.log('🧹 Cleared rate limit cache');
  }, 60000);

  setInterval(async () => {
    try {
      const now = Date.now();
      const fiveMinutesAgo = new Date(now - 300000);

      await models.User.updateMany(
        {
          lastSeen: { $lt: fiveMinutesAgo },
          isOnline: true
        },
        {
          isOnline: false,
          currentRoom: null,
          box: null
        }
      );

    } catch (error) {
      console.error('Error in health check:', error);
    }
  }, 60000);

  console.log('✅ Optimized periodic tasks started');
}

// ========== EXPORT FUNCTIONS AND STATE ==========
module.exports = {
  CONFIG,
  initialize,
  getConnectedUsers,
  getOnlinePlayersInRoom,
  getOnlinePlayersInRoomWithCache,
  broadcastRoomStatus,
  updateAdminPanel,
  broadcastTakenBoxes,
  getUser,
  getRoom,
  getRoomWithCache,
  updateRoomCache,
  resetHouseEarnings,
  disconnectUser,
  getTelebirrNumber,
  setTelebirrNumber,
  getSocketToUser: () => socketToUser,
  getAdminSockets: () => adminSockets,
  getProcessingClaims: () => processingClaims,
  getConnectedSockets: () => connectedSockets,
  getActivityLog: () => activityLog,
  getRoomSubscriptions: () => roomSubscriptions,
  getRoomTimers: () => roomTimers,
  getRoomWinners: () => roomWinners,
  getBingoLetter,
  generateReferralCode,
  checkBingo,
  startCountdownForRoom,
  startGameTimer,
  cleanupRoomTimer,
  cleanupLongRunningGames,
  endGameWithNoWinner,
  generateTraditionalBingoCard,
  processBingoClaim,
  getRoomStatus,
  // ========== BOT MANAGEMENT API ==========
  getBotsList,
  addBotFunds,
  renameBot,
  setBotActive,
  addNewBot,
  bots: () => bots
};
