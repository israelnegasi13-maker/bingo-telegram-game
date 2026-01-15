// server.js - BINGO ELITE - TELEGRAM MINI APP - FULLY FIXED VERSION WITH WALLET SUPPORT
require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const mongoose = require('mongoose');
const fetch = require('node-fetch');

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/bingo', {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => console.log('✅ MongoDB Connected'))
.catch(err => {
  console.error('❌ MongoDB Connection Error:', err);
  process.exit(1);
});

// MongoDB Models
const userSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true },
  userName: { type: String, required: true },
  balance: { type: Number, default: 0.00 },
  referralCode: { type: String, unique: true },
  currentRoom: { type: Number, default: null },
  box: { type: Number, default: null },
  totalWagered: { type: Number, default: 0 },
  totalWins: { type: Number, default: 0 },
  totalBingos: { type: Number, default: 0 },
  joinedAt: { type: Date, default: Date.now },
  lastSeen: { type: Date, default: Date.now },
  isOnline: { type: Boolean, default: false },
  sessionCount: { type: Number, default: 0 },
  telegramId: { type: String, unique: true, sparse: true },
  telegramUsername: { type: String },
  languageCode: { type: String, default: 'en' },
  phoneNumber: { type: String }
});

const roomSchema = new mongoose.Schema({
  stake: { type: Number, required: true },
  players: [String],
  takenBoxes: [Number],
  status: { type: String, default: 'waiting' },
  calledNumbers: [Number],
  currentBall: { type: Number, default: null },
  ballsDrawn: { type: Number, default: 0 },
  startTime: { type: Date, default: null },
  endTime: { type: Date, default: null },
  gameHistory: [{
    timestamp: Date,
    winner: String,
    winnerName: String,
    prize: Number,
    bonus: Number,
    players: Number,
    ballsDrawn: Number,
    isFourCorners: Boolean,
    commissionCollected: Number,
    basePrize: Number
  }],
  lastBoxUpdate: { type: Date, default: Date.now },
  countdownStartTime: { type: Date, default: null },
  countdownStartedWith: { type: Number, default: 0 }
});

const transactionSchema = new mongoose.Schema({
  type: { type: String, required: true },
  userId: { type: String, required: true },
  userName: { type: String, required: true },
  amount: { type: Number, required: true },
  room: { type: Number, default: null },
  admin: { type: Boolean, default: false },
  description: { type: String, required: true },
  receiptNumber: { type: String },
  phoneNumber: { type: String },
  status: { type: String, default: 'pending' },
  approvedBy: { type: String },
  approvedAt: { type: Date },
  createdAt: { type: Date, default: Date.now }
});

const statsSchema = new mongoose.Schema({
  date: { type: String, required: true, unique: true },
  totalWagered: { type: Number, default: 0 },
  totalEarnings: { type: Number, default: 0 },
  totalGames: { type: Number, default: 0 },
  totalUsers: { type: Number, default: 0 },
  newUsers: { type: Number, default: 0 },
  totalBingos: { type: Number, default: 0 },
  totalFourCorners: { type: Number, default: 0 }
});

const User = mongoose.model('User', userSchema);
const Room = mongoose.model('Room', roomSchema);
const Transaction = mongoose.model('Transaction', transactionSchema);
const Stats = mongoose.model('Stats', statsSchema);

const app = express();
const server = http.createServer(app);

// ========== SOCKET.IO CONFIGURATION ==========
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    credentials: true
  },
  transports: ['websocket', 'polling'],
  allowEIO3: true,
  pingTimeout: 60000,
  pingInterval: 25000,
  cookie: false,
  maxHttpBufferSize: 1e8
});

// ========== MIDDLEWARE ==========
app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  credentials: true
}));

app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Custom headers for WebSocket and Telegram
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', '*');
  res.header('Access-Control-Allow-Methods', '*');
  res.header('Content-Security-Policy', "frame-ancestors 'self' https://*.telegram.org https://web.telegram.org");
  res.header('X-Frame-Options', 'ALLOW-FROM https://*.telegram.org');
  next();
});

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
  TELEBIRR_NUMBER: "0962577855",
  MIN_WITHDRAWAL: 50,
  MAX_WITHDRAWAL: 10000
};

// ========== GLOBAL STATE ==========
let socketToUser = new Map();
let adminSockets = new Set();
let activityLog = [];
let roomTimers = new Map();
let connectedSockets = new Set();
let roomSubscriptions = new Map();
let processingClaims = new Map();

// ========== REAL-TIME BOX TRACKING FUNCTIONS ==========
function broadcastTakenBoxes(roomStake, takenBoxes, newBox = null, playerName = null) {
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
  
  // Broadcast to all connected sockets
  io.emit('boxesTakenUpdate', updateData);
  
  // Also update all admin panels
  adminSockets.forEach(socketId => {
    const socket = io.sockets.sockets.get(socketId);
    if (socket) {
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

// Clear stale processing claims
function cleanupProcessingClaims() {
  const now = Date.now();
  const tenSecondsAgo = now - 10000;
  
  processingClaims.forEach((timestamp, roomStake) => {
    if (timestamp < tenSecondsAgo) {
      processingClaims.delete(roomStake);
      console.log(`🧹 Cleaned up stale processing claim for room ${roomStake}`);
    }
  });
}

// Run cleanup every 10 seconds
setInterval(cleanupProcessingClaims, 10000);

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
    let user = await User.findOne({ userId: userId });
    
    if (!user) {
      user = new User({
        userId: userId,
        userName: userName || 'Guest',
        balance: CONFIG.INITIAL_BALANCE,
        referralCode: generateReferralCode(userId),
        telegramId: userId.startsWith('tg_') ? userId.replace('tg_', '') : null
      });
      await user.save();
      
      // Record first transaction
      const transaction = new Transaction({
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
    let room = await Room.findOne({ stake: stake, status: { $in: ['waiting', 'starting', 'playing'] } });
    
    if (!room) {
      room = new Room({
        stake: stake,
        players: [],
        takenBoxes: [],
        status: 'waiting',
        lastBoxUpdate: new Date()
      });
      await room.save();
    }
    
    return room;
  } catch (error) {
    console.error('Error getting room:', error);
    return null;
  }
}

// ========== FIXED: getConnectedUsers - PROPERLY TRACKS ALL CONNECTED USERS ==========
function getConnectedUsers() {
  const connectedUsers = new Set();
  
  // Get from socketToUser map
  socketToUser.forEach((userId, socketId) => {
    const socket = io.sockets.sockets.get(socketId);
    if (socket && socket.connected) {
      connectedUsers.add(userId);
    }
  });
  
  // Also check ALL connected sockets
  io.sockets.sockets.forEach((socket) => {
    if (socket && socket.connected && socket.userId && socket.userId !== 'pending') {
      connectedUsers.add(socket.userId);
    }
  });
  
  return Array.from(connectedUsers);
}

// Function to get online players in a specific room
async function getOnlinePlayersInRoom(roomStake) {
  try {
    const room = await Room.findOne({ stake: roomStake });
    if (!room) return [];
    
    const onlinePlayers = [];
    const connectedUserIds = getConnectedUsers();
    
    // Check each player in the room
    for (const playerId of room.players) {
      if (connectedUserIds.includes(playerId)) {
        onlinePlayers.push(playerId);
      }
    }
    
    return onlinePlayers;
  } catch (error) {
    console.error('Error getting online players in room:', error);
    return [];
  }
}

// ========== BROADCAST FUNCTIONS ==========
async function broadcastRoomStatus() {
  try {
    const rooms = await Room.find({ status: { $in: ['waiting', 'starting', 'playing'] } });
    const roomStatus = {};
    
    for (const room of rooms) {
      const onlinePlayers = await getOnlinePlayersInRoom(room.stake);
      const commissionPerPlayer = CONFIG.HOUSE_COMMISSION[room.stake] || 0;
      const contributionPerPlayer = room.stake - commissionPerPlayer;
      const potentialPrize = contributionPerPlayer * onlinePlayers.length;
      const houseFee = commissionPerPlayer * onlinePlayers.length;
      const potentialPrizeWithBonus = potentialPrize + CONFIG.FOUR_CORNERS_BONUS;
      
      // Mark room as locked if game is playing
      const isLocked = room.status === 'playing';
      
      roomStatus[room.stake] = {
        stake: room.stake,
        playerCount: onlinePlayers.length,
        totalPlayers: room.players.length,
        status: isLocked ? 'locked' : room.status,
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
    }
    
    // Broadcast to all connected sockets
    io.emit('roomStatus', roomStatus);
    
    // Also update admin panel
    updateAdminPanel();
    
  } catch (error) {
    console.error('Error broadcasting room status:', error);
  }
}

async function updateAdminPanel() {
  try {
    const connectedPlayers = getConnectedUsers().length;
    const activeGames = await Room.countDocuments({ status: 'playing' });
    
    // Get all users
    const users = await User.find({}).sort({ balance: -1 }).limit(100);
    
    // Get connected user IDs for real-time status
    const connectedUserIds = getConnectedUsers();
    
    const userArray = users.map(user => {
      let isOnline = false;
      
      if (connectedUserIds.includes(user.userId)) {
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
        totalWagered: user.totalWagered || 0,
        totalWins: user.totalWins || 0,
        lastSeen: user.lastSeen,
        telegramId: user.telegramId || '',
        phoneNumber: user.phoneNumber || '',
        joinedAt: user.joinedAt
      };
    });
    
    // Get room data
    const roomsData = {};
    const rooms = await Room.find({ status: { $in: ['waiting', 'starting', 'playing'] } });
    
    for (const room of rooms) {
      const onlinePlayers = await getOnlinePlayersInRoom(room.stake);
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
        locked: room.status === 'playing',
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
    
    // Calculate total house balance
    const houseBalance = await Transaction.aggregate([
      { $match: { type: { $in: ['HOUSE_EARNINGS', 'ADMIN_ADD'] } } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]).then(result => result[0]?.total || 0);
    
    // Get real-time connected sockets count
    const connectedSocketsCount = connectedSockets.size;
    
    // Send to all admin sockets
    const adminData = {
      totalPlayers: connectedPlayers,
      activeGames: activeGames,
      totalUsers: users.length,
      connectedSockets: connectedSocketsCount,
      houseBalance: houseBalance,
      timestamp: new Date().toISOString(),
      serverUptime: process.uptime(),
      gameTimeoutMinutes: CONFIG.GAME_TIMEOUT_MINUTES
    };
    
    adminSockets.forEach(socketId => {
      const socket = io.sockets.sockets.get(socketId);
      if (socket) {
        socket.emit('admin:update', adminData);
        socket.emit('admin:players', userArray);
        socket.emit('admin:rooms', roomsData);
        
        // Send recent transactions
        Transaction.find().sort({ createdAt: -1 }).limit(50)
          .then(transactions => {
            socket.emit('admin:transactions', transactions);
          })
          .catch(err => console.error('Error fetching transactions:', err));
      }
    });
    
    console.log(`📊 Admin Panel Updated: ${connectedPlayers} players online, ${activeGames} active games`);
    
  } catch (error) {
    console.error('Error updating admin panel:', error);
  }
}

function logActivity(type, details, adminSocketId = null) {
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
  
  // Send to admin panels
  adminSockets.forEach(socketId => {
    const socket = io.sockets.sockets.get(socketId);
    if (socket) {
      socket.emit('admin:activity', activity);
    }
  });
}

// ========== AUTO-CLEAR LONG RUNNING GAMES (7 MINUTES) ==========
async function cleanupLongRunningGames() {
  try {
    const sevenMinutesAgo = new Date(Date.now() - CONFIG.GAME_TIMEOUT_MINUTES * 60 * 1000);
    const longRunningRooms = await Room.find({
      status: 'playing',
      startTime: { $lt: sevenMinutesAgo }
    });
    
    for (const room of longRunningRooms) {
      console.log(`⏰ Room ${room.stake} has been playing for ${CONFIG.GAME_TIMEOUT_MINUTES}+ minutes. Auto-ending...`);
      
      // Clear game timer
      cleanupRoomTimer(room.stake);
      
      // Store players list
      const playersInRoom = [...room.players];
      
      // Return funds to all players
      for (const userId of playersInRoom) {
        const user = await User.findOne({ userId: userId });
        if (user) {
          const oldBalance = user.balance;
          user.balance += room.stake;
          user.currentRoom = null;
          user.box = null;
          await user.save();
          
          console.log(`💰 Auto-refunded ${room.stake} ETB to ${user.userName} after ${CONFIG.GAME_TIMEOUT_MINUTES}min timeout`);
          
          // Record transaction
          const transaction = new Transaction({
            type: 'TIMEOUT_REFUND',
            userId: userId,
            userName: user.userName,
            amount: room.stake,
            room: room.stake,
            description: `Game auto-ended after ${CONFIG.GAME_TIMEOUT_MINUTES} minutes - stake refunded`
          });
          await transaction.save();
          
          // Notify player if online
          for (const [socketId, uId] of socketToUser.entries()) {
            if (uId === userId) {
              const socket = io.sockets.sockets.get(socketId);
              if (socket) {
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
      
      // Clear room data
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
      
      // Broadcast empty boxes
      broadcastTakenBoxes(room.stake, []);
      
      console.log(`✅ Auto-cleared room ${room.stake} after ${CONFIG.GAME_TIMEOUT_MINUTES} minutes`);
    }
  } catch (error) {
    console.error('❌ Error in cleanupLongRunningGames:', error);
  }
}

// ========== FIXED GAME TIMER FUNCTION ==========
async function startGameTimer(room) {
  console.log(`🎲 STARTING GAME TIMER for room ${room.stake} with ${room.players.length} players`);
  
  // Clear any existing timer first
  cleanupRoomTimer(room.stake);
  
  // Reset called numbers
  room.calledNumbers = [];
  room.currentBall = null;
  room.ballsDrawn = 0;
  room.startTime = new Date();
  await room.save();
  
  console.log(`✅ Room ${room.stake} set to playing, starting ball timer...`);
  
  const timer = setInterval(async () => {
    try {
      // Get fresh room data
      const currentRoom = await Room.findById(room._id);
      if (!currentRoom || currentRoom.status !== 'playing') {
        console.log(`⚠️ Game timer stopped: Room ${room.stake} status is ${currentRoom?.status || 'not found'}`);
        clearInterval(timer);
        roomTimers.delete(room.stake);
        return;
      }
      
      // Check if 75 balls have been drawn
      if (currentRoom.ballsDrawn >= 75) {
        console.log(`⏰ Game timeout for room ${room.stake}: 75 balls drawn`);
        clearInterval(timer);
        roomTimers.delete(room.stake);
        await endGameWithNoWinner(currentRoom);
        return;
      }
      
      // Generate a ball that hasn't been called
      let ball;
      let letter;
      let attempts = 0;
      
      do {
        ball = Math.floor(Math.random() * 75) + 1;
        letter = getBingoLetter(ball);
        attempts++;
        
        if (attempts > 150) {
          // If we can't find a unique ball, use the first available
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
      
      // Update room
      currentRoom.calledNumbers.push(ball);
      currentRoom.currentBall = ball;
      currentRoom.ballsDrawn += 1;
      currentRoom.lastBoxUpdate = new Date();
      await currentRoom.save();
      
      const ballData = {
        room: currentRoom.stake,
        num: ball,
        letter: letter,
        ballsDrawn: currentRoom.ballsDrawn
      };
      
      // Send to ALL players in the room
      console.log(`📤 Broadcasting ball ${letter}-${ball} to ${currentRoom.players.length} players in room ${room.stake}`);
      
      // Send to all players in the room
      currentRoom.players.forEach(userId => {
        for (const [socketId, uId] of socketToUser.entries()) {
          if (uId === userId) {
            const socket = io.sockets.sockets.get(socketId);
            if (socket && socket.connected) {
              socket.emit('ballDrawn', ballData);
              socket.emit('enableBingo');
            }
          }
        }
      });
      
      // Also send to admin panels
      adminSockets.forEach(socketId => {
        const socket = io.sockets.sockets.get(socketId);
        if (socket) {
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

// ✅✅✅ FIXED: Check if a player has bingo
function checkBingo(markedNumbers, grid) {
  const patterns = [
    // Rows
    [0,1,2,3,4],
    [5,6,7,8,9],
    [10,11,12,13,14],
    [15,16,17,18,19],
    [20,21,22,23,24],
    
    // Columns
    [0,5,10,15,20],
    [1,6,11,16,21],
    [2,7,12,17,22],
    [3,8,13,18,23],
    [4,9,14,19,24],
    
    // Diagonals
    [0,6,12,18,24],
    [4,8,12,16,20],
    
    // Four corners
    [0,4,20,24]
  ];
  
  for (const pattern of patterns) {
    const isBingo = pattern.every(index => {
      const cellValue = grid[index];
      
      // Handle FREE space
      if (cellValue === 'FREE') {
        const hasFree = markedNumbers.includes('FREE') || markedNumbers.some(m => m === 'FREE');
        return hasFree;
      }
      
      // Check if the number is in markedNumbers
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
        pattern: pattern,
        isFourCorners: pattern.length === 4 && pattern[0] === 0 && pattern[1] === 4 && pattern[2] === 20 && pattern[3] === 24
      };
    }
  }
  
  return { isBingo: false };
}

// ========== FIXED END GAME WITH NO WINNER ==========
async function endGameWithNoWinner(room) {
  try {
    console.log(`🎮 Ending game with no winner for room ${room.stake}`);
    
    // Clear game timer FIRST
    cleanupRoomTimer(room.stake);
    
    // Store players list before clearing
    const playersInRoom = [...room.players];
    
    // Return funds to all players
    for (const userId of playersInRoom) {
      const user = await User.findOne({ userId: userId });
      if (user) {
        const oldBalance = user.balance;
        user.balance += room.stake;
        user.currentRoom = null;
        user.box = null;
        await user.save();
        
        console.log(`💰 Refunded ${room.stake} ETB to ${user.userName}, balance: ${oldBalance} → ${user.balance}`);
        
        // Record transaction
        const transaction = new Transaction({
          type: 'REFUND',
          userId: userId,
          userName: user.userName,
          amount: room.stake,
          room: room.stake,
          description: `Game ended with no winner - stake refunded`
        });
        await transaction.save();
        
        // Notify player if online
        for (const [socketId, uId] of socketToUser.entries()) {
          if (uId === userId) {
            const socket = io.sockets.sockets.get(socketId);
            if (socket) {
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
    
    // Reset room for next game
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
    
    // Broadcast empty boxes
    broadcastTakenBoxes(room.stake, []);
    io.emit('boxesCleared', { room: room.stake, reason: 'game_ended_no_winner' });
    
    console.log(`✅ Game ended with no winner for room ${room.stake}. Boxes cleared for next game.`);
    
    // Update displays
    broadcastRoomStatus();
    updateAdminPanel();
    
  } catch (error) {
    console.error('❌ Error ending game with no winner:', error);
  }
}

// ========== FIXED COUNTDOWN FUNCTION - AUTO STARTS GAME ==========
async function startCountdownForRoom(room) {
  try {
    console.log(`⏱️ STARTING COUNTDOWN for room ${room.stake} at ${new Date().toISOString()}`);
    
    // Stop any existing countdown first
    const countdownKey = `countdown_${room.stake}`;
    if (roomTimers.has(countdownKey)) {
      clearInterval(roomTimers.get(countdownKey));
      roomTimers.delete(countdownKey);
    }
    
    // Update room status
    room.status = 'starting';
    room.countdownStartTime = new Date();
    room.countdownStartedWith = room.players.length;
    await room.save();
    
    let countdown = CONFIG.COUNTDOWN_TIMER;
    const countdownInterval = setInterval(async () => {
      try {
        // Get fresh room data
        const currentRoom = await Room.findById(room._id);
        if (!currentRoom || currentRoom.status !== 'starting') {
          console.log(`⏹️ Countdown stopped: Room ${room.stake} status changed to ${currentRoom?.status || 'deleted'}`);
          clearInterval(countdownInterval);
          roomTimers.delete(countdownKey);
          return;
        }
        
        // Get online players
        const onlinePlayers = await getOnlinePlayersInRoom(room.stake);
        
        // Send countdown to ALL players in room AND subscribed sockets
        console.log(`⏱️ Room ${room.stake}: Countdown ${countdown}s, ${onlinePlayers.length} online players`);
        
        // Send to ALL players in the room AND subscribed sockets
        const socketsToSend = new Set();
        
        // Add sockets of players in the room
        currentRoom.players.forEach(userId => {
          for (const [socketId, uId] of socketToUser.entries()) {
            if (uId === userId) {
              if (io.sockets.sockets.get(socketId)?.connected) {
                socketsToSend.add(socketId);
              }
            }
          }
        });
        
        // Add subscribed sockets (for discovery overlay)
        const subscribedSockets = roomSubscriptions.get(room.stake) || new Set();
        subscribedSockets.forEach(socketId => {
          if (io.sockets.sockets.get(socketId)?.connected) {
            socketsToSend.add(socketId);
          }
        });
        
        // Send to all collected sockets
        socketsToSend.forEach(socketId => {
          const socket = io.sockets.sockets.get(socketId);
          if (socket && socket.connected) {
            socket.emit('gameCountdown', {
              room: room.stake,
              timer: countdown,
              onlinePlayers: onlinePlayers.length
            });
            socket.emit('lobbyUpdate', {
              room: room.stake,
              count: onlinePlayers.length
            });
          }
        });
        
        // Broadcast to admin
        adminSockets.forEach(socketId => {
          const socket = io.sockets.sockets.get(socketId);
          if (socket) {
            socket.emit('admin:countdownUpdate', {
              room: room.stake,
              timer: countdown,
              onlinePlayers: onlinePlayers.length
            });
          }
        });
        
        countdown--;
        
        // Countdown finished - AUTO START GAME
        if (countdown < 0) {
          clearInterval(countdownInterval);
          roomTimers.delete(countdownKey);
          
          console.log(`🎮 Countdown finished for room ${room.stake} - AUTO STARTING GAME`);
          
          // Get final room data
          const finalRoom = await Room.findById(room._id);
          if (!finalRoom || finalRoom.status !== 'starting') {
            console.log(`⚠️ Countdown finished but room ${room.stake} is no longer in starting status`);
            return;
          }
          
          const finalOnlinePlayers = await getOnlinePlayersInRoom(room.stake);
          
          // ✅ AUTO START GAME with any players remaining
          if (finalOnlinePlayers.length >= 1) {
            console.log(`🎮 AUTO STARTING game for room ${room.stake} with ${finalOnlinePlayers.length} online player(s)`);
            
            // Update room to playing
            finalRoom.status = 'playing';
            finalRoom.startTime = new Date();
            finalRoom.countdownStartTime = null;
            finalRoom.countdownStartedWith = 0;
            await finalRoom.save();
            
            // Notify ALL players in the room AND subscribed sockets
            const finalSocketsToSend = new Set();
            
            // Add sockets of players in the room
            finalRoom.players.forEach(userId => {
              for (const [socketId, uId] of socketToUser.entries()) {
                if (uId === userId) {
                  if (io.sockets.sockets.get(socketId)?.connected) {
                    finalSocketsToSend.add(socketId);
                  }
                }
              }
            });
            
            // Add subscribed sockets
            const finalSubscribedSockets = roomSubscriptions.get(room.stake) || new Set();
            finalSubscribedSockets.forEach(socketId => {
              if (io.sockets.sockets.get(socketId)?.connected) {
                finalSocketsToSend.add(socketId);
              }
            });
            
            // Send game started event
            finalSocketsToSend.forEach(socketId => {
              const socket = io.sockets.sockets.get(socketId);
              if (socket && socket.connected) {
                socket.emit('gameStarted', { 
                  room: room.stake,
                  players: finalOnlinePlayers.length
                });
                
                // Send final countdown message
                socket.emit('gameCountdown', {
                  room: room.stake,
                  timer: 0,
                  gameStarting: true
                });
              }
            });
            
            // Start the game timer IMMEDIATELY
            await startGameTimer(finalRoom);
            
            // Broadcast room status update
            broadcastRoomStatus();
            
            console.log(`✅ Game AUTO STARTED for room ${room.stake}, timer active`);
          } else {
            // No players - reset room
            console.log(`⚠️ Game start aborted for room ${room.stake}: no online players`);
            finalRoom.status = 'waiting';
            finalRoom.countdownStartTime = null;
            finalRoom.countdownStartedWith = 0;
            await finalRoom.save();
            
            // Notify players about reset
            const resetSocketsToSend = new Set();
            
            // Add sockets of players in the room
            finalRoom.players.forEach(userId => {
              for (const [socketId, uId] of socketToUser.entries()) {
                if (uId === userId) {
                  if (io.sockets.sockets.get(socketId)?.connected) {
                    resetSocketsToSend.add(socketId);
                  }
                }
              }
            });
            
            // Add subscribed sockets
            const resetSubscribedSockets = roomSubscriptions.get(room.stake) || new Set();
            resetSubscribedSockets.forEach(socketId => {
              if (io.sockets.sockets.get(socketId)?.connected) {
                resetSocketsToSend.add(socketId);
              }
            });
            
            // Send reset notifications
            resetSocketsToSend.forEach(socketId => {
              const socket = io.sockets.sockets.get(socketId);
              if (socket && socket.connected) {
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

// ========== IMPROVED SOCKET.IO EVENT HANDLERS ==========
io.on('connection', (socket) => {
  console.log(`✅ Socket.IO Connected: ${socket.id} - User: ${socket.handshake.query?.userId || 'Unknown'}`);
  connectedSockets.add(socket.id);
  
  // Enhanced connection tracking
  const query = socket.handshake.query;
  if (query.userId) {
    console.log(`👤 User connected via query: ${query.userId}`);
    socket.userId = query.userId;
  }
  
  // Send connection test immediately
  socket.emit('connectionTest', { 
    status: 'connected', 
    serverTime: new Date().toISOString(),
    socketId: socket.id,
    server: 'Bingo Elite Telegram',
    userId: query.userId || 'unknown'
  });
  
  // ========== ADMIN AUTHENTICATION ==========
  socket.on('admin:auth', (password) => {
    console.log(`🔐 Admin authentication attempt from socket ${socket.id}`);
    
    if (password === CONFIG.ADMIN_PASSWORD) {
      adminSockets.add(socket.id);
      socket.emit('admin:authSuccess');
      updateAdminPanel();
      
      logActivity('ADMIN_LOGIN', { socketId: socket.id }, socket.id);
      console.log(`✅ Admin authenticated: ${socket.id}`);
    } else {
      console.log(`❌ Admin auth failed for socket ${socket.id}`);
      socket.emit('admin:authError', 'Invalid password');
    }
  });
  
  socket.on('admin:getData', () => {
    if (!adminSockets.has(socket.id)) {
      socket.emit('admin:error', 'Unauthorized - Please authenticate first');
      return;
    }
    updateAdminPanel();
  });
  
  socket.on('admin:addFunds', async ({ userId, amount }) => {
    if (!adminSockets.has(socket.id)) {
      socket.emit('admin:error', 'Unauthorized');
      return;
    }
    
    const user = await User.findOne({ userId: userId });
    if (!user) {
      socket.emit('admin:error', 'User not found');
      return;
    }
    
    const oldBalance = user.balance;
    user.balance += parseFloat(amount);
    await user.save();
    
    // Record transaction
    const transaction = new Transaction({
      type: 'ADMIN_ADD',
      userId: userId,
      userName: user.userName,
      amount: amount,
      admin: true,
      description: `Admin added ${amount} ETB`
    });
    await transaction.save();
    
    // Notify player if online
    for (const [sId, uId] of socketToUser.entries()) {
      if (uId === userId) {
        const playerSocket = io.sockets.sockets.get(sId);
        if (playerSocket) {
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
      const transaction = await Transaction.findOne({ _id: transactionId, type: 'DEPOSIT_REQUEST', status: 'pending' });
      if (!transaction) {
        socket.emit('admin:error', 'Transaction not found or already processed');
        return;
      }
      
      const user = await User.findOne({ userId: transaction.userId });
      if (!user) {
        socket.emit('admin:error', 'User not found');
        return;
      }
      
      // Update user balance
      const oldBalance = user.balance;
      user.balance += transaction.amount;
      await user.save();
      
      // Update transaction status
      transaction.status = 'approved';
      transaction.approvedBy = socket.id;
      transaction.approvedAt = new Date();
      transaction.description = `Deposit approved by admin - Receipt: ${transaction.receiptNumber}`;
      await transaction.save();
      
      // Notify user
      for (const [sId, uId] of socketToUser.entries()) {
        if (uId === transaction.userId) {
          const playerSocket = io.sockets.sockets.get(sId);
          if (playerSocket) {
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
      
      logActivity('ADMIN_APPROVE_DEPOSIT', { 
        adminSocket: socket.id, 
        userId: user.userId, 
        amount: transaction.amount,
        receiptNumber: transaction.receiptNumber 
      }, socket.id);
      
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
      const transaction = await Transaction.findOne({ _id: transactionId, type: 'WITHDRAW_REQUEST', status: 'pending' });
      if (!transaction) {
        socket.emit('admin:error', 'Transaction not found or already processed');
        return;
      }
      
      const user = await User.findOne({ userId: transaction.userId });
      if (!user) {
        socket.emit('admin:error', 'User not found');
        return;
      }
      
      // Check if user has enough balance (should be already checked, but double-check)
      if (user.balance < Math.abs(transaction.amount)) {
        socket.emit('admin:error', 'User has insufficient balance');
        return;
      }
      
      // Update user balance (amount is negative for withdrawal)
      const oldBalance = user.balance;
      user.balance += transaction.amount; // Add negative amount
      await user.save();
      
      // Update user phone number if not set
      if (!user.phoneNumber && transaction.phoneNumber) {
        user.phoneNumber = transaction.phoneNumber;
        await user.save();
      }
      
      // Update transaction status
      transaction.status = 'approved';
      transaction.approvedBy = socket.id;
      transaction.approvedAt = new Date();
      transaction.description = `Withdrawal approved by admin - Sent to: ${transaction.phoneNumber}`;
      await transaction.save();
      
      // Create a separate transaction for the actual withdrawal
      const withdrawalTransaction = new Transaction({
        type: 'WITHDRAWAL',
        userId: transaction.userId,
        userName: transaction.userName,
        amount: transaction.amount, // Negative
        phoneNumber: transaction.phoneNumber,
        description: `Withdrawal of ${Math.abs(transaction.amount)} ETB sent to ${transaction.phoneNumber}`
      });
      await withdrawalTransaction.save();
      
      // Notify user
      for (const [sId, uId] of socketToUser.entries()) {
        if (uId === transaction.userId) {
          const playerSocket = io.sockets.sockets.get(sId);
          if (playerSocket) {
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
      
      logActivity('ADMIN_APPROVE_WITHDRAWAL', { 
        adminSocket: socket.id, 
        userId: user.userId, 
        amount: Math.abs(transaction.amount),
        phoneNumber: transaction.phoneNumber 
      }, socket.id);
      
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
      const transaction = await Transaction.findOne({ _id: transactionId, status: 'pending' });
      if (!transaction) {
        socket.emit('admin:error', 'Transaction not found or already processed');
        return;
      }
      
      // Update transaction status
      transaction.status = 'rejected';
      transaction.approvedBy = socket.id;
      transaction.approvedAt = new Date();
      transaction.description = `${transaction.description} - Rejected by admin`;
      await transaction.save();
      
      // Notify user if online
      for (const [sId, uId] of socketToUser.entries()) {
        if (uId === transaction.userId) {
          const playerSocket = io.sockets.sockets.get(sId);
          if (playerSocket) {
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
      
      logActivity('ADMIN_REJECT_TRANSACTION', { 
        adminSocket: socket.id, 
        userId: transaction.userId, 
        transactionId: transactionId,
        type: transaction.type 
      }, socket.id);
      
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
      const pendingTransactions = await Transaction.find({ 
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
    
    const room = await Room.findOne({ stake: parseInt(roomStake), status: 'playing' });
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
      
      const ballData = {
        room: room.stake,
        num: ball,
        letter: letter
      };
      
      room.players.forEach(userId => {
        for (const [sId, uId] of socketToUser.entries()) {
          if (uId === userId) {
            const s = io.sockets.sockets.get(sId);
            if (s) {
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
    
    const user = await User.findOne({ userId: userId });
    if (!user) {
      socket.emit('admin:error', 'User not found');
      return;
    }
    
    // Notify the user if online
    for (const [sId, uId] of socketToUser.entries()) {
      if (uId === userId) {
        const playerSocket = io.sockets.sockets.get(sId);
        if (playerSocket) {
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
    
    const room = await Room.findOne({ stake: parseInt(roomStake) });
    if (room) {
      // Force start game immediately
      room.status = 'playing';
      room.startTime = new Date();
      await room.save();
      
      // Start game timer
      await startGameTimer(room);
      
      // Notify all players in room AND subscribed sockets
      const socketsToSend = new Set();
      
      // Add sockets of players in the room
      room.players.forEach(userId => {
        for (const [sId, uId] of socketToUser.entries()) {
          if (uId === userId) {
            if (io.sockets.sockets.get(sId)?.connected) {
              socketsToSend.add(sId);
            }
          }
        }
      });
      
      // Add subscribed sockets
      const subscribedSockets = roomSubscriptions.get(room.stake) || new Set();
      subscribedSockets.forEach(socketId => {
        if (io.sockets.sockets.get(socketId)?.connected) {
          socketsToSend.add(socketId);
        }
      });
      
      // Send game started event
      socketsToSend.forEach(socketId => {
        const s = io.sockets.sockets.get(socketId);
        if (s) {
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
    
    const room = await Room.findOne({ stake: parseInt(roomStake) });
    if (room) {
      // Clear game timer
      cleanupRoomTimer(roomStake);
      
      // Store players list before clearing
      const playersInRoom = [...room.players];
      
      // Return funds to all players
      for (const userId of playersInRoom) {
        const user = await User.findOne({ userId: userId });
        if (user) {
          user.balance += roomStake;
          user.currentRoom = null;
          user.box = null;
          await user.save();
          
          const transaction = new Transaction({
            type: 'REFUND',
            userId: userId,
            userName: user.userName,
            amount: roomStake,
            room: roomStake,
            description: `Game force ended by admin - stake refunded`
          });
          await transaction.save();
          
          // Notify player
          for (const [sId, uId] of socketToUser.entries()) {
            if (uId === userId) {
              const s = io.sockets.sockets.get(sId);
              if (s) {
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
      
      // Clear room data
      room.players = [];
      room.takenBoxes = [];
      room.status = 'ended';
      room.endTime = new Date();
      room.lastBoxUpdate = new Date();
      await room.save();
      
      // Broadcast empty boxes
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
    
    const room = await Room.findOne({ stake: parseInt(roomStake) });
    if (!room) {
      socket.emit('admin:error', 'Room not found');
      return;
    }
    
    // Store players list before clearing
    const playersInRoom = [...room.players];
    
    // Refund all players
    for (const userId of playersInRoom) {
      const user = await User.findOne({ userId: userId });
      if (user) {
        user.balance += roomStake;
        user.currentRoom = null;
        user.box = null;
        await user.save();
        
        const transaction = new Transaction({
          type: 'REFUND',
          userId: userId,
          userName: user.userName,
          amount: roomStake,
          room: roomStake,
          description: `Boxes cleared by admin - stake refunded`
        });
        await transaction.save();
        
        // Notify player
        for (const [sId, uId] of socketToUser.entries()) {
          if (uId === userId) {
            const s = io.sockets.sockets.get(sId);
            if (s) {
              s.emit('boxesCleared', { room: roomStake, adminCleared: true, reason: 'admin_cleared' });
              s.emit('balanceUpdate', user.balance);
              s.emit('lobbyUpdate', { room: roomStake, count: 0 });
            }
          }
        }
      }
    }
    
    // Clear room
    room.players = [];
    room.takenBoxes = [];
    room.status = 'waiting';
    room.lastBoxUpdate = new Date();
    await room.save();
    
    // Broadcast cleared boxes
    broadcastTakenBoxes(roomStake, []);
    socket.emit('admin:success', `Cleared all boxes in ${roomStake} ETB room`);
    
    logActivity('ADMIN_CLEAR_BOXES', { adminSocket: socket.id, roomStake }, socket.id);
  });
  
  // Admin debugging for countdown
  socket.on('admin:debugCountdown', async (roomStake) => {
    if (!adminSockets.has(socket.id)) {
      socket.emit('admin:error', 'Unauthorized');
      return;
    }
    
    const room = await Room.findOne({ stake: parseInt(roomStake) });
    if (room) {
      const onlinePlayers = await getOnlinePlayersInRoom(room.stake);
      
      socket.emit('admin:success', `Room ${roomStake}: ${room.status}, ${onlinePlayers.length} online, ${room.players.length} total, countdown active: ${roomTimers.has(`countdown_${roomStake}`)}`);
    }
  });
  
  // ========== WALLET EVENT HANDLERS ==========
  socket.on('wallet:depositRequest', async (data) => {
    try {
      const { receiptNumber, amount, userId, userName } = data;
      
      console.log(`💰 Deposit request from ${userName} (${userId}): ${amount} ETB, Receipt: ${receiptNumber}`);
      
      // Create a transaction record
      const transaction = new Transaction({
        type: 'DEPOSIT_REQUEST',
        userId: userId,
        userName: userName,
        amount: parseFloat(amount),
        receiptNumber: receiptNumber,
        description: `Deposit request - Receipt: ${receiptNumber}, Amount: ${amount} ETB`,
        status: 'pending'
      });
      await transaction.save();
      
      // Notify the user
      socket.emit('wallet:depositRequestSuccess', {
        message: 'Deposit request submitted successfully. Admin will process it soon.'
      });
      
      // Notify admin
      adminSockets.forEach(socketId => {
        const adminSocket = io.sockets.sockets.get(socketId);
        if (adminSocket) {
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
      
      // Check if user has sufficient balance
      const user = await User.findOne({ userId: userId });
      if (!user) {
        socket.emit('wallet:error', 'User not found');
        return;
      }
      
      if (user.balance < amount) {
        socket.emit('wallet:error', 'Insufficient balance for withdrawal');
        return;
      }
      
      // Check minimum withdrawal amount
      if (amount < CONFIG.MIN_WITHDRAWAL) {
        socket.emit('wallet:error', `Minimum withdrawal amount is ${CONFIG.MIN_WITHDRAWAL} ETB`);
        return;
      }
      
      // Check maximum withdrawal amount
      if (amount > CONFIG.MAX_WITHDRAWAL) {
        socket.emit('wallet:error', `Maximum withdrawal amount is ${CONFIG.MAX_WITHDRAWAL} ETB`);
        return;
      }
      
      // Create a transaction record
      const transaction = new Transaction({
        type: 'WITHDRAW_REQUEST',
        userId: userId,
        userName: userName,
        amount: -parseFloat(amount), // Negative for withdrawal
        phoneNumber: phoneNumber,
        description: `Withdrawal request to phone: ${phoneNumber}, Amount: ${amount} ETB`,
        status: 'pending'
      });
      await transaction.save();
      
      // Update user phone number if not set
      if (!user.phoneNumber) {
        user.phoneNumber = phoneNumber;
        await user.save();
      }
      
      // Notify the user
      socket.emit('wallet:withdrawRequestSuccess', {
        message: 'Withdrawal request submitted successfully. Admin will process it soon.'
      });
      
      // Notify admin
      adminSockets.forEach(socketId => {
        const adminSocket = io.sockets.sockets.get(socketId);
        if (adminSocket) {
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
  
  // Player events
  socket.on('init', async (data, callback) => {
    try {
      const { userId, userName } = data;
      
      console.log(`📱 User init: ${userName} (${userId}) via socket ${socket.id}`);
      
      // Store userId on socket for tracking
      socket.userId = userId;
      
      const user = await getUser(userId, userName);
      
      if (user) {
        // Store in socketToUser map
        socketToUser.set(socket.id, userId);
        
        // Also update user's lastSeen immediately
        await User.findOneAndUpdate(
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
          phoneNumber: user.phoneNumber || ''
        });
        
        socket.emit('connected', { message: 'Successfully connected to Bingo Elite' });
        
        // Send callback response
        if (callback) {
          callback({ success: true, message: 'User initialized successfully' });
        }
        
        // Log the successful connection
        console.log(`✅ User connected successfully: ${userName} (${userId})`);
        
        // Update admin panel with new connection IN REAL-TIME
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
    const userId = socketToUser.get(socket.id);
    if (userId) {
      const user = await User.findOne({ userId: userId });
      if (user) {
        socket.emit('balanceUpdate', user.balance);
        socket.emit('balanceRefreshed', user.balance);
      }
    }
  });
  
  // Get room countdown status for discovery overlay
  socket.on('getRoomCountdown', async ({ room }, callback) => {
    try {
      const roomData = await Room.findOne({ stake: parseInt(room) });
      
      if (!roomData) {
        if (callback) callback({ countdownActive: false });
        return;
      }
      
      if (roomData.status === 'starting' && roomData.countdownStartTime) {
        const elapsed = Date.now() - roomData.countdownStartTime;
        const secondsRemaining = Math.max(0, CONFIG.COUNTDOWN_TIMER - Math.floor(elapsed / 1000));
        const onlinePlayers = await getOnlinePlayersInRoom(room);
        
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
  
  // FIXED: Get taken boxes from ALL rooms
  socket.on('getTakenBoxes', async ({ room }, callback) => {
    try {
      const roomData = await Room.findOne({ 
        stake: parseInt(room)
      });
      
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
      
      // Store subscription
      if (!roomSubscriptions.has(data.room)) {
        roomSubscriptions.set(data.room, new Set());
      }
      roomSubscriptions.get(data.room).add(socket.id);
      
      // Send current taken boxes immediately
      Room.findOne({ stake: data.room })
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
  
  // UPDATED: Improved joinRoom function with timer synchronization
  socket.on('joinRoom', async (data, callback) => {
    try {
      const { room, box, userName } = data;
      const userId = socketToUser.get(socket.id) || socket.userId;
      
      if (!userId) {
        socket.emit('error', 'Player not initialized');
        if (callback) callback({ success: false, message: 'Player not initialized' });
        return;
      }
      
      const user = await User.findOne({ userId: userId });
      if (!user) {
        socket.emit('error', 'User not found');
        if (callback) callback({ success: false, message: 'User not found' });
        return;
      }
      
      if (user.balance < room) {
        socket.emit('insufficientFunds');
        if (callback) callback({ success: false, message: 'Insufficient funds' });
        return;
      }
      
      // Get or create room
      let roomData = await Room.findOne({ 
        stake: room, 
        status: { $in: ['waiting', 'starting', 'playing'] } 
      });
      
      if (!roomData) {
        // Create a new active room if none exists
        roomData = new Room({
          stake: room,
          players: [],
          takenBoxes: [],
          status: 'waiting',
          lastBoxUpdate = new Date();
        });
        await roomData.save();
      }
      
      // Check if room is locked (game is playing)
      if (roomData.status === 'playing') {
        socket.emit('roomLocked', { 
          room: room, 
          message: 'Game is in progress. Please wait for the current game to finish.' 
        });
        if (callback) callback({ success: false, message: 'Room is locked - game in progress' });
        return;
      }
      
      if (box < 1 || box > 100) {
        socket.emit('error', 'Invalid box number. Must be between 1 and 100');
        if (callback) callback({ success: false, message: 'Invalid box number' });
        return;
      }
      
      if (roomData.takenBoxes.includes(box)) {
        socket.emit('boxTaken');
        if (callback) callback({ success: false, message: 'Box already taken' });
        return;
      }
      
      if (user.currentRoom) {
        if (user.currentRoom === room) {
          socket.emit('joinedRoom');
          if (callback) callback({ success: true, message: 'Already in room' });
          return;
        }
        socket.emit('error', 'Already in a different room');
        if (callback) callback({ success: false, message: 'Already in different room' });
        return;
      }
      
      // Update user balance and room info
      user.balance -= room;
      user.totalWagered = (user.totalWagered || 0) + room;
      user.currentRoom = room;
      user.box = box;
      await user.save();
      
      // Record transaction
      const transaction = new Transaction({
        type: 'STAKE',
        userId: user.userId,
        userName: user.userName,
        amount: -room,
        room: room,
        description: `Joined ${room} ETB room with ticket ${box}`
      });
      await transaction.save();
      
      // Update room
      roomData.players.push(user.userId);
      roomData.takenBoxes.push(box);
      roomData.lastBoxUpdate = new Date();
      
      const onlinePlayers = await getOnlinePlayersInRoom(room);
      
      console.log(`🚀 joinRoom - Room ${room}:`);
      console.log(`   Players in room: ${roomData.players.length}`);
      console.log(`   Online players: ${onlinePlayers.length}`);
      console.log(`   Room status: ${roomData.status}`);
      
      // 🚨 CRITICAL: BROADCAST REAL-TIME BOX UPDATE
      broadcastTakenBoxes(room, roomData.takenBoxes, box, user.userName);
      
      await roomData.save();
      
      // Send success to joining player
      socket.emit('joinedRoom');
      socket.emit('balanceUpdate', user.balance);
      
      // Send lobby update to ALL players in the room
      const playersInRoom = roomData.players;
      playersInRoom.forEach(playerUserId => {
        for (const [sId, uId] of socketToUser.entries()) {
          if (uId === playerUserId) {
            const s = io.sockets.sockets.get(sId);
            if (s) {
              s.emit('lobbyUpdate', {
                room: room,
                count: onlinePlayers.length
              });
            }
          }
        }
      });
      
      // Send immediate countdown update if room is starting
      if (roomData.status === 'starting' && roomData.countdownStartTime) {
        const elapsed = Date.now() - roomData.countdownStartTime;
        const secondsRemaining = Math.max(0, CONFIG.COUNTDOWN_TIMER - Math.floor(elapsed / 1000));
        
        // Send immediate countdown update to the joining player
        socket.emit('gameCountdown', {
          room: room,
          timer: secondsRemaining,
          onlinePlayers: onlinePlayers.length
        });
      }
      
      // FIXED: Start countdown if we have at least 1 online player
      if (onlinePlayers.length >= CONFIG.MIN_PLAYERS_TO_START && roomData.status === 'waiting') {
        console.log(`🚀 STARTING COUNTDOWN for room ${room} with ${onlinePlayers.length} online player(s)!`);
        await startCountdownForRoom(roomData);
      } else {
        console.log(`⏸️ NOT starting countdown:`);
        console.log(`   Online players: ${onlinePlayers.length} (need ${CONFIG.MIN_PLAYERS_TO_START})`);
        console.log(`   Room status: ${roomData.status} (need 'waiting')`);
      }
      
      // Send personal confirmation
      socket.emit('boxesTakenUpdate', {
        room: room,
        takenBoxes: roomData.takenBoxes,
        personalBox: box,
        message: `You selected box ${box}! Waiting for players...`
      });
      
      // Broadcast updates
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
      
    } catch (error) {
      console.error('Error joining room:', error);
      socket.emit('error', 'Server error while joining room');
      if (callback) callback({ success: false, message: 'Server error' });
    }
  });
  
  // ========== FIXED CLAIM BINGO LOGIC WITH DOUBLE CLAIM PROTECTION ==========
  socket.on('claimBingo', async (data, callback) => {
    try {
      const { room, grid, marked } = data;
      const userId = socketToUser.get(socket.id) || socket.userId;
      
      if (!userId) {
        socket.emit('error', 'Player not initialized');
        if (callback) callback({ success: false, message: 'Player not initialized' });
        return;
      }
      
      const user = await User.findOne({ userId: userId });
      if (!user) {
        socket.emit('error', 'User not found');
        if (callback) callback({ success: false, message: 'User not found' });
        return;
      }
      
      const roomStake = parseInt(room);
      
      // CHECK IF CLAIM IS ALREADY BEING PROCESSED FOR THIS ROOM
      if (processingClaims.has(roomStake)) {
        console.log(`🚨 DOUBLE CLAIM PREVENTED: Room ${roomStake} already has a claim being processed`);
        socket.emit('error', 'A bingo claim is already being processed for this room');
        if (callback) callback({ 
          success: false, 
          message: 'A bingo claim is already being processed. Please wait.' 
        });
        return;
      }
      
      // LOCK THE ROOM FOR CLAIM PROCESSING
      processingClaims.set(roomStake, Date.now());
      console.log(`🔒 Locked room ${roomStake} for claim processing by ${user.userName}`);
      
      const roomData = await Room.findOne({ stake: roomStake, status: 'playing' });
      if (!roomData) {
        processingClaims.delete(roomStake);
        socket.emit('error', 'Game not found or not in progress');
        if (callback) callback({ success: false, message: 'Game not found or not in progress' });
        return;
      }
      
      if (!roomData.players.includes(userId)) {
        processingClaims.delete(roomStake);
        socket.emit('error', 'You are not in this game');
        if (callback) callback({ success: false, message: 'You are not in this game' });
        return;
      }
      
      console.log('🎯 BINGO CLAIM RECEIVED:');
      console.log('   User:', user.userName);
      console.log('   Room:', room);
      console.log('   Processing lock active:', processingClaims.has(roomStake));
      
      // Convert marked numbers properly for comparison
      const markedNumbers = marked.map(item => {
        if (item === 'FREE') return 'FREE';
        return Number(item);
      }).filter(item => !isNaN(item) || item === 'FREE');
      
      // Check if bingo is valid
      const bingoCheck = checkBingo(markedNumbers, grid);
      if (!bingoCheck.isBingo) {
        processingClaims.delete(roomStake);
        console.log('❌ Invalid bingo claim - no winning pattern found');
        socket.emit('error', 'Invalid bingo claim');
        if (callback) callback({ success: false, message: 'Invalid bingo claim - no winning pattern' });
        return;
      }
      
      const isFourCornersWin = bingoCheck.isFourCorners;
      
      // Calculate total prize correctly
      const commissionPerPlayer = CONFIG.HOUSE_COMMISSION[room] || 0;
      const contributionPerPlayer = room - commissionPerPlayer;
      const totalPlayers = roomData.players.length;
      
      // Base prize is total contributions from ALL players
      const basePrize = contributionPerPlayer * totalPlayers;
      
      // Four corners bonus
      let bonus = 0;
      if (isFourCornersWin) {
        bonus = CONFIG.FOUR_CORNERS_BONUS;
      }
      
      const totalPrize = basePrize + bonus;
      
      console.log(`🎰 WIN CALCULATION for ${room} ETB room:`);
      console.log(`   Total players: ${totalPlayers}`);
      console.log(`   Total prize: ${totalPrize} ETB`);
      console.log(`   Is four corners: ${isFourCornersWin}`);
      console.log(`   Bonus: ${bonus} ETB`);
      
      // Update user balance
      const oldBalance = user.balance;
      user.balance += totalPrize;
      user.totalWins = (user.totalWins || 0) + 1;
      user.totalBingos = (user.totalBingos || 0) + 1;
      user.currentRoom = null;
      user.box = null;
      await user.save();
      
      console.log(`💰 User ${user.userName} won ${totalPrize} ETB (was ${oldBalance}, now ${user.balance})`);
      
      // Record transaction
      const transactionType = isFourCornersWin ? 'WIN_FOUR_CORNERS' : 'WIN';
      const transaction = new Transaction({
        type: transactionType,
        userId: userId,
        userName: user.userName,
        amount: totalPrize,
        room: room,
        description: `Bingo win in ${room} ETB room with ${totalPlayers} players${isFourCornersWin ? ' (Four Corners Bonus)' : ''}`
      });
      await transaction.save();
      
      // Record house earnings
      const houseEarnings = commissionPerPlayer * totalPlayers;
      const houseTransaction = new Transaction({
        type: 'HOUSE_EARNINGS',
        userId: 'HOUSE',
        userName: 'House',
        amount: houseEarnings,
        room: room,
        description: `Commission from ${totalPlayers} players in ${room} ETB room`
      });
      await houseTransaction.save();
      
      // Store players list BEFORE clearing
      const playersInRoom = [...roomData.players];
      
      // FIXED: Clear game timer FIRST
      cleanupRoomTimer(room);
      
      // Update room status
      roomData.status = 'ended';
      roomData.endTime = new Date();
      roomData.lastBoxUpdate = new Date();
      roomData.gameHistory.push({
        timestamp: new Date(),
        winner: userId,
        winnerName: user.userName,
        prize: totalPrize,
        bonus: bonus,
        basePrize: basePrize,
        players: playersInRoom.length,
        ballsDrawn: roomData.ballsDrawn,
        isFourCorners: isFourCornersWin,
        commissionCollected: houseEarnings
      });
      
      // ✅ CRITICAL FIX: Now clear room data
      roomData.players = [];
      roomData.takenBoxes = [];
      roomData.status = 'waiting';
      roomData.calledNumbers = [];
      roomData.currentBall = null;
      roomData.ballsDrawn = 0;
      roomData.startTime = null;
      roomData.endTime = new Date();
      roomData.lastBoxUpdate = new Date();
      await roomData.save();
      
      // RELEASE THE PROCESSING LOCK
      processingClaims.delete(roomStake);
      console.log(`🔓 Released processing lock for room ${roomStake}`);
      
      // Create game over data
      const gameOverData = {
        room: room,
        winnerId: userId,
        winnerName: user.userName,
        prize: totalPrize,
        basePrize: basePrize,
        bonus: bonus,
        playersCount: playersInRoom.length,
        isFourCornersWin: isFourCornersWin,
        gameEnded: true,
        reason: 'bingo_win',
        commissionPerPlayer: commissionPerPlayer,
        contributionPerPlayer: contributionPerPlayer,
        houseEarnings: houseEarnings
      };
      
      // Send immediate callback response to the winner
      if (callback) {
        callback({ 
          success: true, 
          message: 'BINGO claim received and being processed',
          isFourCornersWin: isFourCornersWin
        });
      }
      
      // Update all other players and notify everyone
      for (const playerId of playersInRoom) {
        if (playerId !== userId) {
          const losingUser = await User.findOne({ userId: playerId });
          if (losingUser) {
            losingUser.currentRoom = null;
            losingUser.box = null;
            await losingUser.save();
          }
        }
        
        // Notify each player
        for (const [sId, uId] of socketToUser.entries()) {
          if (uId === playerId) {
            const s = io.sockets.sockets.get(sId);
            if (s) {
              if (uId === userId) {
                // Winner
                s.emit('gameOver', gameOverData);
                s.emit('balanceUpdate', user.balance);
              } else {
                // Loser
                const losingUser = await User.findOne({ userId: playerId });
                s.emit('gameOver', gameOverData);
                if (losingUser) {
                  s.emit('balanceUpdate', losingUser.balance);
                }
              }
            }
          }
        }
      }
      
      // ✅ BROADCAST EMPTY BOXES and send boxesCleared event
      broadcastTakenBoxes(room, []);
      io.emit('boxesCleared', { room: room, reason: 'game_ended_bingo_win' });
      
      console.log(`🎮 Game ended with bingo win for room ${room}. Boxes cleared for next game.`);
      
      broadcastRoomStatus();
      updateAdminPanel();
      
      logActivity('BINGO_WIN', { 
        userId, 
        userName: user.userName, 
        room, 
        prize: totalPrize, 
        bonus, 
        basePrize: basePrize,
        isFourCorners: isFourCornersWin,
        players: playersInRoom.length,
        commissionCollected: houseEarnings
      });
      
    } catch (error) {
      // RELEASE LOCK ON ERROR TOO
      const roomStake = parseInt(data?.room);
      if (roomStake && processingClaims.has(roomStake)) {
        processingClaims.delete(roomStake);
        console.log(`🔓 Released processing lock for room ${roomStake} due to error`);
      }
      
      console.error('Error in claimBingo:', error);
      socket.emit('error', 'Server error processing bingo claim');
      if (callback) {
        callback({ 
          success: false, 
          message: 'Server error processing bingo claim'
        });
      }
    }
  });
  
  socket.on('player:activity', async (data) => {
    const userId = socketToUser.get(socket.id) || socket.userId;
    if (userId) {
      try {
        await User.findOneAndUpdate(
          { userId: userId },
          { lastSeen: new Date() }
        );
        
        // Update admin panel with activity
        updateAdminPanel();
      } catch (error) {
        console.error('Error updating player activity:', error);
      }
    }
  });
  
  // ========== FIXED: player:leaveRoom - Proper cleanup and refund ==========
  socket.on('player:leaveRoom', async (data) => {
    try {
      const userId = socketToUser.get(socket.id) || socket.userId;
      if (!userId) {
        socket.emit('error', 'User not found');
        return;
      }
      
      console.log(`👤 Player ${userId} requesting to leave room`);
      
      const user = await User.findOne({ userId: userId });
      if (!user || !user.currentRoom) {
        socket.emit('leftRoom', { message: 'Not in a room' });
        return;
      }
      
      const roomStake = user.currentRoom;
      const room = await Room.findOne({ stake: roomStake });
      
      if (!room) {
        // Clean up user if room doesn't exist
        user.currentRoom = null;
        user.box = null;
        await user.save();
        socket.emit('leftRoom', { message: 'Left room (room not found)' });
        return;
      }
      
      // Prevent leaving if game is already playing
      if (room.status === 'playing') {
        console.log(`❌ Player ${user.userName} tried to leave during active game in room ${roomStake}`);
        socket.emit('error', 'Cannot leave room during active game! Wait for game to end.');
        return;
      }
      
      // Remove user from room
      const playerIndex = room.players.indexOf(userId);
      const boxIndex = room.takenBoxes.indexOf(user.box);
      
      if (playerIndex > -1) {
        room.players.splice(playerIndex, 1);
      }
      
      if (boxIndex > -1) {
        room.takenBoxes.splice(boxIndex, 1);
      }
      
      room.lastBoxUpdate = new Date();
      
      // Get online players after removal
      const onlinePlayers = await getOnlinePlayersInRoom(roomStake);
      
      // Don't stop countdown when player leaves
      await room.save();
      
      // Reset user
      user.currentRoom = null;
      user.box = null;
      
      // Refund stake if game hasn't started
      if (room.status !== 'playing') {
        const oldBalance = user.balance;
        user.balance += roomStake;
        
        console.log(`💰 Refunded ${roomStake} ETB to ${user.userName}, new balance: ${user.balance}`);
        
        // Record transaction
        const transaction = new Transaction({
          type: 'REFUND',
          userId: userId,
          userName: user.userName,
          amount: roomStake,
          room: roomStake,
          description: `Left room before game start - stake refunded`
        });
        await transaction.save();
        
        socket.emit('balanceUpdate', user.balance);
      }
      
      await user.save();
      
      // Broadcast updated boxes
      broadcastTakenBoxes(roomStake, room.takenBoxes);
      
      // Send success message
      socket.emit('leftRoom', { 
        message: 'Left room successfully',
        refunded: room.status !== 'playing'
      });
      
      // Update lobby for remaining players
      onlinePlayers.forEach(playerUserId => {
        for (const [sId, uId] of socketToUser.entries()) {
          if (uId === playerUserId) {
            const s = io.sockets.sockets.get(sId);
            if (s) {
              s.emit('lobbyUpdate', {
                room: roomStake,
                count: onlinePlayers.length
              });
            }
          }
        }
      });
      
      console.log(`✅ User ${user.userName} left room ${roomStake}, ${room.takenBoxes.length} boxes remain, ${onlinePlayers.length} online players`);
      
      // Update admin panel
      broadcastRoomStatus();
      updateAdminPanel();
      
      logActivity('PLAYER_LEFT_ROOM', { 
        userId, 
        userName: user.userName, 
        room: roomStake,
        remainingPlayers: room.players.length,
        onlinePlayers: onlinePlayers.length,
        remainingBoxes: room.takenBoxes.length,
        status: room.status
      });
      
    } catch (error) {
      console.error('❌ Error in player:leaveRoom:', error);
      socket.emit('error', 'Failed to leave room: ' + error.message);
    }
  });
  
  // Add new event for getting room info
  socket.on('getRoomInfo', async (data) => {
    try {
      const { room } = data;
      const userId = socketToUser.get(socket.id) || socket.userId;
      
      const roomData = await Room.findOne({ stake: parseInt(room) });
      if (roomData) {
        const onlinePlayers = await getOnlinePlayersInRoom(room);
        
        socket.emit('lobbyUpdate', {
          room: room,
          count: onlinePlayers.length
        });
        
        // Also send countdown status if room is starting
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
      await User.findOneAndUpdate(
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
  
  // ========== FIXED: disconnect event - Proper cleanup on disconnect ==========
  socket.on('disconnect', async () => {
    console.log(`❌ Socket disconnected: ${socket.id}`);
    connectedSockets.delete(socket.id);
    adminSockets.delete(socket.id);
    
    // Remove from room subscriptions
    roomSubscriptions.forEach((sockets, room) => {
      sockets.delete(socket.id);
    });
    
    const userId = socketToUser.get(socket.id) || socket.userId;
    if (userId) {
      console.log(`👤 User ${userId} disconnected`);
      
      try {
        // Find user
        const user = await User.findOne({ userId: userId });
        if (user && user.currentRoom) {
          const roomStake = user.currentRoom;
          const room = await Room.findOne({ stake: roomStake });
          
          if (room) {
            // Only remove from room if game is NOT playing
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
              
              // Countdown continues even if players disconnect
              await room.save();
              
              // Broadcast updated boxes
              broadcastTakenBoxes(roomStake, room.takenBoxes);
              
              console.log(`👤 User ${user.userName} removed from room ${roomStake} due to disconnect`);
            } else {
              console.log(`⚠️ User ${user.userName} disconnected during gameplay in room ${roomStake}, keeping in game`);
            }
          }
          
          // Update user status
          user.isOnline = false;
          user.lastSeen = new Date();
          await user.save();
        } else {
          // Just update last seen
          await User.findOneAndUpdate(
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
      
      // Remove from socketToUser map
      socketToUser.delete(socket.id);
    }
    
    // Update admin panel
    setTimeout(() => {
      updateAdminPanel();
      broadcastRoomStatus();
    }, 1000);
  });
  
  // Heartbeat for connection monitoring
  socket.on('ping', () => {
    socket.emit('pong', { time: Date.now() });
  });
});

// ========== PERIODIC TASKS ==========
setInterval(() => {
  broadcastRoomStatus();
}, CONFIG.ROOM_STATUS_UPDATE_INTERVAL);

// Update admin panel every 2 seconds for real-time tracking
setInterval(() => {
  updateAdminPanel();
}, 2000);

// Run 7-minute game timeout check every 30 seconds
setInterval(cleanupLongRunningGames, 30000);

// Clean up disconnected sockets periodically
setInterval(() => {
  socketToUser.forEach((userId, socketId) => {
    const socket = io.sockets.sockets.get(socketId);
    if (!socket || !socket.connected) {
      socketToUser.delete(socketId);
      console.log(`🧹 Cleaned up disconnected socket: ${socketId} (user: ${userId})`);
    }
  });
}, 10000);

// ========== CONNECTION CLEANUP FUNCTION ==========
async function cleanupStaleConnections() {
  console.log('🧹 Running connection cleanup...');
  
  const now = new Date();
  const thirtySecondsAgo = new Date(now.getTime() - 30000);
  
  try {
    // Update users who haven't been seen in 30 seconds
    await User.updateMany(
      { 
        lastSeen: { $lt: thirtySecondsAgo },
        isOnline: true 
      },
      { 
        isOnline: false 
      }
    );
    
    // Clean up socketToUser map
    socketToUser.forEach((userId, socketId) => {
      const socket = io.sockets.sockets.get(socketId);
      if (!socket || !socket.connected) {
        socketToUser.delete(socketId);
        console.log(`🧹 Removed stale socket from socketToUser: ${socketId} (user: ${userId})`);
      }
    });
    
  } catch (error) {
    console.error('Error in cleanupStaleConnections:', error);
  }
}

// Run cleanup every 30 seconds
setInterval(cleanupStaleConnections, 30000);

// ========== CLEANUP STUCK COUNTDOWNS ==========
async function cleanupStuckCountdowns() {
  try {
    const now = new Date();
    const rooms = await Room.find({ status: 'starting' });
    
    for (const room of rooms) {
      if (room.countdownStartTime) {
        const timeSinceStart = now - new Date(room.countdownStartTime);
        // If countdown has been "starting" for more than 45 seconds (should be 30), something's wrong
        if (timeSinceStart > 45000) {
          console.log(`⚠️ Cleaning up stuck countdown for room ${room.stake} (${timeSinceStart/1000}s)`);
          
          // Stop countdown
          const countdownKey = `countdown_${room.stake}`;
          if (roomTimers.has(countdownKey)) {
            clearInterval(roomTimers.get(countdownKey));
            roomTimers.delete(countdownKey);
          }
          
          // Reset room status
          room.status = 'waiting';
          room.countdownStartTime = null;
          room.countdownStartedWith = 0;
          await room.save();
          
          // Notify all subscribed sockets and players
          const socketsToSend = new Set();
          
          // Add sockets of players in the room
          room.players.forEach(userId => {
            for (const [socketId, uId] of socketToUser.entries()) {
              if (uId === userId) {
                if (io.sockets.sockets.get(socketId)?.connected) {
                  socketsToSend.add(socketId);
                }
              }
            }
          });
          
          // Add subscribed sockets
          const subscribedSockets = roomSubscriptions.get(room.stake) || new Set();
          subscribedSockets.forEach(socketId => {
            if (io.sockets.sockets.get(socketId)?.connected) {
              socketsToSend.add(socketId);
            }
          });
          
          // Send notifications
          const onlinePlayers = await getOnlinePlayersInRoom(room.stake);
          socketsToSend.forEach(socketId => {
            const socket = io.sockets.sockets.get(socketId);
            if (socket) {
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

// Run every 10 seconds
setInterval(cleanupStuckCountdowns, 10000);

// ========== ROOM CLEANUP FUNCTION ==========
async function cleanupStaleRooms() {
  try {
    const oneHourAgo = new Date(Date.now() - 3600000);
    
    const staleRooms = await Room.find({
      status: 'ended',
      endTime: { $lt: oneHourAgo }
    });
    
    for (const room of staleRooms) {
      console.log(`🧹 Cleaning up stale room: ${room.stake} ETB`);
      
      // Clear all boxes and reset room
      if (room.takenBoxes.length > 0 || room.players.length > 0) {
        console.log(`⚠️ Room ${room.stake} still has ${room.takenBoxes.length} taken boxes and ${room.players.length} players. Clearing...`);
        room.players = [];
        room.takenBoxes = [];
        room.status = 'waiting';
        room.lastBoxUpdate = new Date();
        await room.save();
        
        // Broadcast that boxes are cleared
        broadcastTakenBoxes(room.stake, []);
        io.emit('boxesCleared', { room: room.stake, reason: 'stale_room_cleanup' });
      }
      
      // Delete only very old rooms (1 day)
      const oneDayAgo = new Date(Date.now() - 86400000);
      if (room.endTime && room.endTime < oneDayAgo) {
        await Room.deleteOne({ _id: room._id });
        console.log(`🗑️ Deleted stale room from database: ${room.stake} ETB`);
      }
    }
    
    // Also clean up rooms with status 'playing' but no players for a while
    const emptyPlayingRooms = await Room.find({
      status: 'playing',
      players: { $size: 0 }
    });
    
    for (const room of emptyPlayingRooms) {
      console.log(`🧹 Cleaning up empty playing room: ${room.stake} ETB`);
      cleanupRoomTimer(room.stake);
      
      // Reset room
      room.players = [];
      room.takenBoxes = [];
      room.status = 'waiting';
      room.calledNumbers = [];
      room.currentBall = null;
      room.ballsDrawn = 0;
      room.startTime = null;
      room.lastBoxUpdate = new Date();
      await room.save();
      
      // Broadcast cleared boxes
      broadcastTakenBoxes(room.stake, []);
      io.emit('boxesCleared', { room: room.stake, reason: 'empty_room_cleanup' });
    }
    
  } catch (error) {
    console.error('Error in cleanupStaleRooms:', error);
  }
}

// Run every 5 minutes
setInterval(cleanupStaleRooms, 300000);

// ========== HEALTH CHECK FUNCTION ==========
setInterval(async () => {
  try {
    const now = Date.now();
    const fiveMinutesAgo = new Date(now - 300000);
    
    // Update users who haven't been active
    await User.updateMany(
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
    
    // Clean up ONLY abandoned rooms with no players
    const abandonedRooms = await Room.find({
      status: 'playing',
      players: { $size: 0 },
      startTime: { $lt: fiveMinutesAgo }
    });
    
    for (const room of abandonedRooms) {
      console.log(`⚠️ Cleaning up abandoned room: ${room.stake} ETB`);
      cleanupRoomTimer(room.stake);
      await Room.deleteOne({ _id: room._id });
    }
    
  } catch (error) {
    console.error('Error in health check:', error);
  }
}, 60000);

// ========== EXPRESS ROUTES ==========
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Bingo Elite - Telegram Mini App</title>
      <style>
        body { font-family: Arial, sans-serif; padding: 40px; text-align: center; background: #0f172a; color: #f8fafc; }
        .container { max-width: 800px; margin: 0 auto; }
        .status { padding: 30px; background: #1e293b; border-radius: 20px; margin: 30px auto; border: 1px solid #334155; }
        .stats-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 20px; margin: 30px 0; }
        .stat { background: rgba(255,255,255,0.05); padding: 20px; border-radius: 12px; }
        .stat-value { font-size: 2.5rem; font-weight: 900; margin: 10px 0; }
        .stat-label { font-size: 0.9rem; color: #94a3b8; text-transform: uppercase; letter-spacing: 1px; }
        .btn { display: inline-block; padding: 12px 24px; background: #3b82f6; color: white; text-decoration: none; border-radius: 8px; margin: 10px; font-weight: bold; }
        .btn:hover { background: #2563eb; transform: translateY(-2px); }
        .btn-admin { background: #ef4444; }
        .btn-admin:hover { background: #dc2626; }
        .btn-game { background: #10b981; }
        .btn-game:hover { background: #059669; }
      </style>
    </head>
    <body>
      <div class="container">
        <h1 style="font-size: 3rem; margin-bottom: 20px;">🎮 Bingo Elite Telegram Mini App</h1>
        <p style="color: #94a3b8; font-size: 1.2rem;">Real-time multiplayer Bingo - Ready for Telegram</p>
        
        <div class="status">
          <h2 style="color: #10b981;">🚀 Server Status: RUNNING</h2>
          <div class="stats-grid">
            <div class="stat">
              <div class="stat-label">Connected Players</div>
              <div class="stat-value" id="playerCount">${connectedSockets.size}</div>
            </div>
            <div class="stat">
              <div class="stat-label">Database Status</div>
              <div class="stat-value" style="color: #10b981;">✅ Online</div>
            </div>
          </div>
          <p style="margin-top: 20px; color: #f59e0b; font-weight: bold;">🎯 Four Corners Bonus: ${CONFIG.FOUR_CORNERS_BONUS} ETB!</p>
          <p style="color: #64748b; margin-top: 10px;">Server Time: ${new Date().toLocaleString()}</p>
          <p style="color: #10b981;">✅ Telegram Mini App Ready</p>
          <p style="color: #3b82f6; margin-top: 10px;">📦 Real-time Box Tracking: ✅ ACTIVE</p>
          <p style="color: #10b981; margin-top: 10px;">💰 Wallet System: ✅ ACTIVE</p>
          <p style="color: #10b981;">🔒 NEW: Room lock when game is playing</p>
          <p style="color: #10b981;">⏰ NEW: 7-minute game timeout auto-clear</p>
          <p style="color: #10b981;">⏱️ NEW: Timer on box selection interface</p>
          <p style="color: #10b981; margin-top: 10px;">✅ FIXED: Game timer and ball drawing issues resolved</p>
          <p style="color: #10b981;">🎱 Balls pop every 3 seconds: ✅ WORKING</p>
          <p style="color: #10b981;">⏱️ 30-second countdown: ✅ WORKING</p>
          <p style="color: #10b981; font-weight: bold; margin-top: 10px;">✅✅✅ FIXED: Claim Bingo now properly checks numbers!</p>
          <p style="color: #10b981; font-weight: bold;">✅✅ All players return to lobby after game ends</p>
          <p style="color: #10b981; font-weight: bold; margin-top: 10px;">🔒 NEW: DOUBLE PRIZE BUG FIXED</p>
          <p style="color: #10b981;">✅ Claim lock prevents double prize payouts</p>
          <p style="color: #10b981;">⏱️ Timer sync between discovery and waiting rooms</p>
        </div>
        
        <div style="margin-top: 40px;">
          <h3>Access Points:</h3>
          <div>
            <a href="/admin" class="btn btn-admin" target="_blank">🔒 Admin Panel</a>
            <a href="/game" class="btn btn-game" target="_blank">🎮 Game Client</a>
          </div>
          <div style="margin-top: 20px;">
            <a href="/health" class="btn" style="background: #64748b;" target="_blank">📊 Health Check</a>
            <a href="/telegram" class="btn" style="background: #8b5cf6;" target="_blank">🤖 Telegram Entry</a>
          </div>
          <div style="margin-top: 20px;">
            <a href="/debug-connections" class="btn" style="background: #f59e0b;" target="_blank">🔍 Debug Connections</a>
            <a href="/debug-users" class="btn" style="background: #f59e0b;" target="_blank">👥 Debug Users</a>
            <a href="/debug-calculations/10/5" class="btn" style="background: #f59e0b;" target="_blank">🧮 Debug Calculations</a>
            <a href="/debug-room/10" class="btn" style="background: #f59e0b;" target="_blank">🏠 Debug Room 10</a>
          </div>
          <div style="margin-top: 20px;">
            <a href="/test-connections" class="btn" style="background: #f59e0b;" target="_blank">🔌 Test Connections</a>
            <a href="/force-start/10" class="btn" style="background: #10b981;" target="_blank">🚀 Force Start Room 10</a>
          </div>
        </div>
        
        <div style="margin-top: 40px; padding: 20px; background: rgba(255,255,255,0.03); border-radius: 12px;">
          <h4>Telegram Mini App Information</h4>
          <p style="color: #94a3b8; font-size: 0.9rem;">
            Version: 2.9.0 (WITH WALLET SYSTEM) | Database: MongoDB Atlas<br>
            Socket.IO: ✅ Connected Sockets: ${connectedSockets.size}<br>
            SocketToUser: ${socketToUser.size} | Admin Sockets: ${adminSockets.size}<br>
            Processing Claims: ${processingClaims.size} active<br>
            Telegram Integration: ✅ Ready<br>
            Game Timer: ${CONFIG.GAME_TIMER}s between balls<br>
            Game Timeout: ${CONFIG.GAME_TIMEOUT_MINUTES} minutes auto-clear<br>
            Bot Username: @ethio_games1_bot<br>
            Real-time Box Updates: ✅ ACTIVE<br>
            Wallet System: ✅ ACTIVE (Deposit/Withdraw)<br>
            Telebirr Number: ${CONFIG.TELEBIRR_NUMBER}<br>
            Min Withdrawal: ${CONFIG.MIN_WITHDRAWAL} ETB<br>
            Room Lock: ✅ IMPLEMENTED (games lock when playing)<br>
            Auto-Clear: ✅ ${CONFIG.GAME_TIMEOUT_MINUTES} minute timeout<br>
            Box Selection Timer: ✅ SYNCED WITH WAITING ROOM<br>
            Fixed Issues: ✅ Double prize bug fixed, ✅ Claim lock implemented<br>
            ✅ Timer synchronization fixed, ✅ Game timer working<br>
            ✅ Ball popping every 3s, ✅ 30-second countdown working<br>
            ✅ Players properly removed when leaving, ✅ Countdown stuck issue resolved<br>
            ✅ Balls drawn correctly, ✅ BINGO checking working<br>
            ✅✅ COUNTDOWN CONTINUES WHEN PLAYERS LEAVE<br>
            ✅✅ GAME STARTS WITH 1 PLAYER AFTER 30 SECONDS<br>
            ✅✅✅✅ CLAIM BINGO NOW PROPERLY CHECKS NUMBERS (STRING/NUMBER FIX)<br>
            ✅✅✅ ALL PLAYERS RETURN TO LOBBY AFTER GAME ENDS
          </p>
        </div>
      </div>
      
      <script>
        const socket = io();
        socket.on('connect', () => {
          document.getElementById('playerCount').textContent = 'Connected';
        });
      </script>
    </body>
    </html>
  `);
});

// Telegram Mini App entry point - UPDATED WITH ANIMATED PROFILES AND COMPACT DESIGN
app.get('/telegram', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
        <title>ETHIO GAMES - Telegram Mini App</title>
        <script src="https://telegram.org/js/telegram-web-app.js"></script>
        <style>
            :root {
                --primary-color: #3b82f6;
                --secondary-color: #8b5cf6;
                --accent-color: #fbbf24;
                --dark-bg: #0f172a;
                --card-bg: rgba(30, 41, 59, 0.85);
                --text-primary: #f8fafc;
                --text-secondary: #94a3b8;
                --success-color: #10b981;
                --danger-color: #ef4444;
                --glass-border: rgba(255, 255, 255, 0.1);
                --glass-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
            }
            
            * {
                margin: 0;
                padding: 0;
                box-sizing: border-box;
                -webkit-tap-highlight-color: transparent;
            }
            
            body {
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
                background: var(--dark-bg);
                color: var(--text-primary);
                height: 100vh;
                overflow: hidden;
                padding: 0;
                margin: 0;
                position: relative;
                background-image: 
                    radial-gradient(at 0% 0%, rgba(59, 130, 246, 0.15) 0, transparent 50%),
                    radial-gradient(at 100% 100%, rgba(139, 92, 246, 0.15) 0, transparent 50%);
            }
            
            .container {
                width: 100%;
                height: 100%;
                display: flex;
                flex-direction: column;
                padding: 16px;
                max-width: 500px;
                margin: 0 auto;
            }
            
            /* Animated Background Elements */
            .floating-balls {
                position: fixed;
                width: 100%;
                height: 100%;
                z-index: -1;
                overflow: hidden;
            }
            
            .floating-ball {
                position: absolute;
                border-radius: 50%;
                background: linear-gradient(135deg, var(--primary-color), var(--secondary-color));
                opacity: 0.1;
                animation: float 15s infinite ease-in-out;
            }
            
            .floating-ball:nth-child(1) {
                width: 100px;
                height: 100px;
                top: 10%;
                left: 10%;
                animation-delay: 0s;
            }
            
            .floating-ball:nth-child(2) {
                width: 150px;
                height: 150px;
                top: 60%;
                right: 10%;
                animation-delay: 5s;
            }
            
            .floating-ball:nth-child(3) {
                width: 80px;
                height: 80px;
                bottom: 20%;
                left: 20%;
                animation-delay: 10s;
            }
            
            @keyframes float {
                0%, 100% { transform: translateY(0) rotate(0deg); }
                50% { transform: translateY(-20px) rotate(180deg); }
            }
            
            /* Header Styles */
            .app-header {
                text-align: center;
                padding: 16px 0 24px 0;
                position: relative;
            }
            
            .logo-container {
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 12px;
                margin-bottom: 8px;
            }
            
            .animated-logo {
                font-size: 2.5rem;
                background: linear-gradient(135deg, var(--primary-color), var(--secondary-color));
                -webkit-background-clip: text;
                -webkit-text-fill-color: transparent;
                animation: logoPulse 2s infinite alternate;
            }
            
            @keyframes logoPulse {
                0% { transform: scale(1); }
                100% { transform: scale(1.1); }
            }
            
            .app-title {
                font-size: 2.2rem;
                font-weight: 900;
                background: linear-gradient(to right, var(--primary-color), var(--accent-color));
                -webkit-background-clip: text;
                -webkit-text-fill-color: transparent;
                margin-bottom: 4px;
            }
            
            .app-subtitle {
                font-size: 0.9rem;
                color: var(--text-secondary);
                font-weight: 500;
            }
            
            /* User Profile */
            .user-profile {
                position: absolute;
                top: 16px;
                right: 16px;
                display: flex;
                align-items: center;
                gap: 8px;
                z-index: 10;
            }
            
            .profile-avatar {
                width: 36px;
                height: 36px;
                background: linear-gradient(135deg, var(--primary-color), var(--secondary-color));
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
                font-weight: 700;
                color: white;
                font-size: 0.9rem;
                border: 2px solid rgba(255, 255, 255, 0.2);
                animation: avatarGlow 3s infinite;
            }
            
            @keyframes avatarGlow {
                0%, 100% { box-shadow: 0 0 10px rgba(59, 130, 246, 0.5); }
                50% { box-shadow: 0 0 20px rgba(59, 130, 246, 0.8); }
            }
            
            .balance-display {
                background: rgba(251, 191, 36, 0.15);
                padding: 6px 12px;
                border-radius: 20px;
                border: 1.5px solid rgba(251, 191, 36, 0.3);
                font-weight: 700;
                color: var(--accent-color);
                font-size: 0.8rem;
                display: flex;
                align-items: center;
                gap: 4px;
                backdrop-filter: blur(10px);
            }
            
            /* Games Container - Compact Grid */
            .games-container {
                flex: 1;
                overflow-y: auto;
                padding: 8px 0;
                scrollbar-width: none;
                -ms-overflow-style: none;
            }
            
            .games-container::-webkit-scrollbar {
                display: none;
            }
            
            .games-grid {
                display: grid;
                grid-template-columns: 1fr;
                gap: 12px;
                max-width: 400px;
                margin: 0 auto;
            }
            
            /* Game Card - Compact Version */
            .game-card {
                background: var(--card-bg);
                backdrop-filter: blur(10px);
                border-radius: 16px;
                padding: 16px;
                border: 1px solid var(--glass-border);
                box-shadow: var(--glass-shadow);
                transition: all 0.3s ease;
                position: relative;
                overflow: hidden;
                cursor: pointer;
            }
            
            .game-card::before {
                content: '';
                position: absolute;
                top: 0;
                left: 0;
                right: 0;
                height: 3px;
                background: linear-gradient(to right, var(--primary-color), var(--secondary-color));
            }
            
            .game-card:hover {
                transform: translateY(-4px);
                box-shadow: 0 12px 40px rgba(0, 0, 0, 0.4);
                border-color: rgba(59, 130, 246, 0.3);
            }
            
            .game-card:active {
                transform: translateY(-2px);
            }
            
            .game-header {
                display: flex;
                align-items: center;
                gap: 12px;
                margin-bottom: 12px;
            }
            
            .game-icon {
                width: 48px;
                height: 48px;
                border-radius: 12px;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 1.8rem;
                position: relative;
                animation: iconFloat 3s infinite ease-in-out;
            }
            
            .bingo-icon {
                background: linear-gradient(135deg, var(--primary-color), #1d4ed8);
                color: white;
            }
            
            .keno-icon {
                background: linear-gradient(135deg, var(--secondary-color), #7c3aed);
                color: white;
            }
            
            @keyframes iconFloat {
                0%, 100% { transform: translateY(0); }
                50% { transform: translateY(-5px); }
            }
            
            .game-title {
                flex: 1;
            }
            
            .game-name {
                font-size: 1.2rem;
                font-weight: 900;
                color: white;
                margin-bottom: 2px;
            }
            
            .game-status {
                font-size: 0.7rem;
                font-weight: 700;
                padding: 2px 8px;
                border-radius: 10px;
                display: inline-block;
            }
            
            .status-live {
                background: rgba(16, 185, 129, 0.2);
                color: var(--success-color);
                border: 1px solid rgba(16, 185, 129, 0.4);
                animation: statusPulse 2s infinite;
            }
            
            .status-soon {
                background: rgba(100, 116, 139, 0.2);
                color: var(--text-secondary);
                border: 1px solid rgba(100, 116, 139, 0.4);
            }
            
            @keyframes statusPulse {
                0%, 100% { opacity: 1; }
                50% { opacity: 0.7; }
            }
            
            .game-features {
                display: flex;
                flex-wrap: wrap;
                gap: 6px;
                margin: 12px 0;
            }
            
            .feature-tag {
                font-size: 0.65rem;
                padding: 3px 8px;
                border-radius: 10px;
                font-weight: 600;
                display: flex;
                align-items: center;
                gap: 3px;
            }
            
            .feature-tag.highlight {
                background: rgba(251, 191, 36, 0.15);
                color: var(--accent-color);
                border: 1px solid rgba(251, 191, 36, 0.3);
            }
            
            .feature-tag.normal {
                background: rgba(59, 130, 246, 0.1);
                color: var(--primary-color);
                border: 1px solid rgba(59, 130, 246, 0.2);
            }
            
            .game-stats {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-top: 12px;
                padding-top: 12px;
                border-top: 1px solid rgba(255, 255, 255, 0.05);
                font-size: 0.75rem;
                color: var(--text-secondary);
            }
            
            .stat-item {
                display: flex;
                align-items: center;
                gap: 4px;
            }
            
            .stat-icon {
                font-size: 0.8rem;
            }
            
            .stat-value {
                color: white;
                font-weight: 700;
            }
            
            .play-btn {
                width: 100%;
                padding: 10px;
                background: linear-gradient(90deg, var(--primary-color), var(--secondary-color));
                color: white;
                border: none;
                border-radius: 12px;
                font-weight: 900;
                font-size: 0.9rem;
                cursor: pointer;
                margin-top: 12px;
                transition: all 0.2s;
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 6px;
            }
            
            .play-btn:hover {
                transform: scale(1.02);
                box-shadow: 0 4px 20px rgba(59, 130, 246, 0.4);
            }
            
            .play-btn:active {
                transform: scale(0.98);
            }
            
            .play-btn.coming-soon {
                background: linear-gradient(90deg, #64748b, #475569);
                cursor: not-allowed;
                opacity: 0.7;
            }
            
            .play-btn.coming-soon:hover {
                transform: none;
                box-shadow: none;
            }
            
            /* Footer */
            .app-footer {
                padding: 16px 0;
                text-align: center;
                border-top: 1px solid rgba(255, 255, 255, 0.05);
                margin-top: 8px;
            }
            
            .footer-info {
                font-size: 0.7rem;
                color: var(--text-secondary);
                line-height: 1.4;
                margin-bottom: 8px;
            }
            
            .footer-highlight {
                color: var(--accent-color);
                font-weight: 700;
            }
            
            .wallet-pill {
                display: inline-flex;
                align-items: center;
                gap: 6px;
                background: rgba(59, 130, 246, 0.15);
                padding: 6px 12px;
                border-radius: 20px;
                border: 1px solid rgba(59, 130, 246, 0.3);
                font-size: 0.75rem;
                font-weight: 700;
                color: var(--primary-color);
                margin-top: 8px;
                cursor: pointer;
                transition: all 0.2s;
            }
            
            .wallet-pill:hover {
                background: rgba(59, 130, 246, 0.2);
                transform: translateY(-2px);
            }
            
            /* Animation for new feature */
            @keyframes slideIn {
                from { opacity: 0; transform: translateY(20px); }
                to { opacity: 1; transform: translateY(0); }
            }
            
            .game-card {
                animation: slideIn 0.5s ease-out;
            }
            
            .game-card:nth-child(1) {
                animation-delay: 0.1s;
            }
            
            .game-card:nth-child(2) {
                animation-delay: 0.2s;
            }
            
            /* Mobile Responsive */
            @media (max-width: 480px) {
                .container {
                    padding: 12px;
                }
                
                .app-title {
                    font-size: 1.8rem;
                }
                
                .app-subtitle {
                    font-size: 0.8rem;
                }
                
                .game-card {
                    padding: 14px;
                }
                
                .game-icon {
                    width: 44px;
                    height: 44px;
                    font-size: 1.6rem;
                }
                
                .game-name {
                    font-size: 1.1rem;
                }
                
                .feature-tag {
                    font-size: 0.6rem;
                    padding: 2px 6px;
                }
                
                .play-btn {
                    padding: 8px;
                    font-size: 0.85rem;
                }
                
                .user-profile {
                    top: 12px;
                    right: 12px;
                }
                
                .profile-avatar {
                    width: 32px;
                    height: 32px;
                    font-size: 0.8rem;
                }
                
                .balance-display {
                    padding: 5px 10px;
                    font-size: 0.75rem;
                }
            }
            
            @media (max-width: 380px) {
                .app-title {
                    font-size: 1.6rem;
                }
                
                .games-grid {
                    gap: 10px;
                }
                
                .game-card {
                    padding: 12px;
                }
                
                .game-header {
                    gap: 10px;
                }
                
                .game-icon {
                    width: 40px;
                    height: 40px;
                    font-size: 1.4rem;
                }
                
                .game-features {
                    gap: 4px;
                }
            }
            
            /* Active players indicator */
            .active-players {
                position: absolute;
                top: -6px;
                right: -6px;
                background: var(--danger-color);
                color: white;
                font-size: 0.6rem;
                font-weight: 900;
                padding: 2px 6px;
                border-radius: 10px;
                border: 2px solid var(--dark-bg);
                animation: playerPulse 2s infinite;
            }
            
            @keyframes playerPulse {
                0%, 100% { transform: scale(1); }
                50% { transform: scale(1.1); }
            }
            
            /* Loading animation */
            .loading-shimmer {
                background: linear-gradient(90deg, 
                    rgba(255,255,255,0.05) 25%, 
                    rgba(255,255,255,0.1) 50%, 
                    rgba(255,255,255,0.05) 75%);
                background-size: 200% 100%;
                animation: shimmer 1.5s infinite;
                border-radius: 8px;
            }
            
            @keyframes shimmer {
                0% { background-position: -200% 0; }
                100% { background-position: 200% 0; }
            }
        </style>
    </head>
    <body>
        <!-- Animated Background -->
        <div class="floating-balls">
            <div class="floating-ball"></div>
            <div class="floating-ball"></div>
            <div class="floating-ball"></div>
        </div>
        
        <div class="container">
            <!-- Header -->
            <div class="app-header">
                <div class="logo-container">
                    <div class="animated-logo">🎮</div>
                </div>
                <h1 class="app-title">ETHIO GAMES</h1>
                <p class="app-subtitle">Premium Gaming Experience</p>
                
                <!-- User Profile -->
                <div id="userProfile" class="user-profile" style="display: none;">
                    <div class="profile-avatar" id="userAvatar">U</div>
                    <div class="balance-display">
                        <span>💰</span>
                        <span id="userBalance">0.00 ETB</span>
                    </div>
                </div>
            </div>
            
            <!-- Games Grid -->
            <div class="games-container">
                <div class="games-grid">
                    <!-- Bingo Elite Card -->
                    <div class="game-card" onclick="launchGame('bingo')">
                        <div class="game-header">
                            <div class="game-icon bingo-icon">
                                🎱
                                <div class="active-players" id="bingoPlayers">0</div>
                            </div>
                            <div class="game-title">
                                <h2 class="game-name">BINGO ELITE</h2>
                                <span class="game-status status-live">LIVE</span>
                            </div>
                        </div>
                        
                        <div class="game-features">
                            <div class="feature-tag highlight">
                                ⭐ 50 ETB Bonus
                            </div>
                            <div class="feature-tag normal">
                                🎯 4 Corners
                            </div>
                            <div class="feature-tag normal">
                                💰 Real Money
                            </div>
                            <div class="feature-tag normal">
                                ⚡ Real-time
                            </div>
                            <div class="feature-tag normal">
                                🔒 Room Lock
                            </div>
                            <div class="feature-tag normal">
                                💳 Wallet
                            </div>
                        </div>
                        
                        <div class="game-stats">
                            <div class="stat-item">
                                <span class="stat-icon">👥</span>
                                <span class="stat-value" id="bingoOnline">0</span> online
                            </div>
                            <div class="stat-item">
                                <span class="stat-icon">🏆</span>
                                <span class="stat-value" id="bingoPrize">0</span> ETB prize
                            </div>
                            <div class="stat-item">
                                <span class="stat-icon">🎮</span>
                                <span class="stat-value">1-100</span> players
                            </div>
                        </div>
                        
                        <button class="play-btn" id="bingoBtn">
                            🎮 PLAY NOW
                        </button>
                    </div>
                    
                    <!-- Keno Ultra Card -->
                    <div class="game-card" onclick="launchGame('keno')">
                        <div class="game-header">
                            <div class="game-icon keno-icon">
                                🎲
                            </div>
                            <div class="game-title">
                                <h2 class="game-name">KENO ULTRA</h2>
                                <span class="game-status status-soon">COMING SOON</span>
                            </div>
                        </div>
                        
                        <div class="game-features">
                            <div class="feature-tag highlight">
                                ⚡ Fast Gameplay
                            </div>
                            <div class="feature-tag normal">
                                🎰 Instant Wins
                            </div>
                            <div class="feature-tag normal">
                                💰 High Payouts
                            </div>
                            <div class="feature-tag normal">
                                🎯 Multiple Bets
                            </div>
                            <div class="feature-tag normal">
                                🔢 1-80 Numbers
                            </div>
                            <div class="feature-tag normal">
                                📊 Live Stats
                            </div>
                        </div>
                        
                        <div class="game-stats">
                            <div class="stat-item">
                                <span class="stat-icon">⏱️</span>
                                <span class="stat-value">Fast</span> rounds
                            </div>
                            <div class="stat-item">
                                <span class="stat-icon">💰</span>
                                <span class="stat-value">High</span> payouts
                            </div>
                            <div class="stat-item">
                                <span class="stat-icon">🎯</span>
                                <span class="stat-value">1-20</span> numbers
                            </div>
                        </div>
                        
                        <button class="play-btn coming-soon" id="kenoBtn" disabled>
                            🎯 COMING SOON
                        </button>
                    </div>
                </div>
            </div>
            
            <!-- Footer -->
            <div class="app-footer">
                <p class="footer-info">
                    Powered by <span class="footer-highlight">Telegram</span> • Play responsibly
                </p>
                <div class="wallet-pill" onclick="showWalletInfo()">
                    <span>💳</span>
                    <span>Deposit: ${CONFIG.TELEBIRR_NUMBER}</span>
                </div>
            </div>
        </div>
        
        <script>
            const tg = window.Telegram.WebApp;
            
            // Initialize Telegram Web App
            tg.ready();
            tg.expand();
            tg.setHeaderColor('#3b82f6');
            tg.setBackgroundColor('#0f172a');
            
            const user = tg.initDataUnsafe?.user;
            
            function getFirstLetter(name) {
                return name ? name.charAt(0).toUpperCase() : 'U';
            }
            
            if (user) {
                document.getElementById('userProfile').style.display = 'flex';
                document.getElementById('userAvatar').textContent = getFirstLetter(user.first_name);
                
                localStorage.setItem('telegramUser', JSON.stringify({
                    id: user.id,
                    firstName: user.first_name,
                    username: user.username,
                    languageCode: user.language_code
                }));
            }
            
            function launchGame(game) {
                if (tg && tg.HapticFeedback) {
                    tg.HapticFeedback.impactOccurred('light');
                }
                
                if (game === 'bingo') {
                    window.location.href = '/game';
                } else if (game === 'keno') {
                    tg.showPopup({
                        title: 'Coming Soon',
                        message: 'KENO ULTRA is under development and will be available soon!',
                        buttons: [{ type: 'ok' }]
                    });
                }
            }
            
            function showWalletInfo() {
                tg.showPopup({
                    title: '💰 Wallet Information',
                    message: 'Deposit to Telebirr: ${CONFIG.TELEBIRR_NUMBER}\\nMin withdrawal: ${CONFIG.MIN_WITHDRAWAL} ETB\\n\\nSend money to the number above and submit receipt in game wallet.',
                    buttons: [{ type: 'ok' }]
                });
            }
            
            // Set up Telegram Main Button
            if (tg.MainButton) {
                tg.MainButton.setText('🎮 PLAY BINGO');
                tg.MainButton.show();
                tg.MainButton.onClick(() => launchGame('bingo'));
            }
            
            // Update game stats from server (mock data for now)
            setTimeout(() => {
                document.getElementById('bingoOnline').textContent = '${getConnectedUsers().length}';
                document.getElementById('bingoPlayers').textContent = '${connectedSockets.size}';
                document.getElementById('bingoPrize').textContent = '${Object.values(CONFIG.ROOM_STAKES).reduce((a, b) => a + b, 0) * 10}';
            }, 1000);
            
            // Add click animations
            document.querySelectorAll('.game-card').forEach((card, index) => {
                card.style.animationDelay = (index * 0.1) + 's';
            });
        </script>
    </body>
    </html>
  `);
});

// ========== START SERVER ==========
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════════════════════════╗
║             🤖 BINGO ELITE - TELEGRAM READY                   ║
╠════════════════════════════════════════════════════════════════╣
║  URL:          https://bingo-telegram-game.onrender.com       ║
║  Port:         ${PORT}                                        ║
║  Game:         /game                                          ║
║  Admin:        /admin (password: admin1234)                   ║
║  Telegram:     /telegram                                      ║
║  Bot Setup:    /setup-telegram                                ║
║  Real-Time:    /real-time-status                              ║
║  Debug:        /debug-connections                             ║
║  Debug Users:  /debug-users                                   ║
║  Debug Room:   /debug-room/:stake                             ║
║  Force Start:  /force-start/:stake                            ║
║  Test:         /test-connections                              ║
╠════════════════════════════════════════════════════════════════╣
║  🔑 Admin Password: ${process.env.ADMIN_PASSWORD || 'admin1234'} ║
║  🤖 Telegram Bot: @ethio_games1_bot                           ║
║  📡 WebSocket: ✅ Ready for Telegram connections              ║
║  🎮 Four Corners Bonus: ${CONFIG.FOUR_CORNERS_BONUS} ETB       ║
║  📦 Real-time Box Tracking: ✅ ACTIVE                         ║
║  💳 Wallet System: ✅ ACTIVE                                  ║
║  💰 Telebirr Number: ${CONFIG.TELEBIRR_NUMBER}                ║
║  💸 Min Withdrawal: ${CONFIG.MIN_WITHDRAWAL} ETB              ║
║  🆕 NEW FEATURES:                                              ║
║  🎨 Animated game profiles with compact design                ║
║  🎯 Professional game selection screen                        ║
║  🎮 Float animations and glowing effects                      ║
║  📱 Mobile-optimized compact layout                           ║
║  ⭐ Feature tags and live stats                               ║
║  🎭 Glassmorphism design with blur effects                    ║
║  🚀 All game functionality preserved                          ║
╚════════════════════════════════════════════════════════════════╝
✅ Server ready with ANIMATED PROFILES and COMPACT DESIGN
  `);
  
  // Initial broadcast
  setTimeout(() => {
    broadcastRoomStatus();
  }, 1000);
});
