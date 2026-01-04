// server.js - BINGO ELITE - TELEGRAM MINI APP VERSION - UPDATED WITH AGGRESSIVE OFFLINE PLAYER CLEANUP
require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const mongoose = require('mongoose');

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
  languageCode: { type: String, default: 'en' }
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
  countdownStartTime: { type: Date, default: null }
});

const transactionSchema = new mongoose.Schema({
  type: { type: String, required: true },
  userId: { type: String, required: true },
  userName: { type: String, required: true },
  amount: { type: Number, required: true },
  room: { type: Number, default: null },
  admin: { type: Boolean, default: false },
  description: { type: String, required: true },
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
  MIN_PLAYERS_TO_START: 2,
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
  SESSION_TIMEOUT: 86400000
};

const BINGO_LETTERS = {
  'B': { min: 1, max: 15, color: '#3b82f6' },
  'I': { min: 16, max: 30, color: '#8b5cf6' },
  'N': { min: 31, max: 45, color: '#10b981' },
  'G': { min: 46, max: 60, color: '#f59e0b' },
  'O': { min: 61, max: 75, color: '#ef4444' }
};

// ========== GLOBAL STATE ==========
let socketToUser = new Map(); // socket.id -> userId
let adminSockets = new Set();
let activityLog = [];
let roomTimers = new Map();
let connectedSockets = new Set();
let roomSubscriptions = new Map();

// 🚨 NEW: Track last seen timestamps for each user
let userLastSeen = new Map(); // userId -> timestamp

// ========== REAL-TIME BOX TRACKING FUNCTIONS ==========
async function broadcastTakenBoxes(roomStake, newBox = null, playerName = null) {
  try {
    const room = await Room.findOne({ stake: roomStake });
    if (!room) return;
    
    const updateData = {
      room: roomStake,
      takenBoxes: room.takenBoxes, // Send ALL taken boxes
      playerCount: room.players.length, // Send ALL players
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
          takenBoxes: room.takenBoxes,
          playerCount: room.players.length,
          timestamp: new Date().toISOString(),
          newBox: newBox,
          playerName: playerName
        });
      }
    });
    
    console.log(`📦 Real-time box update for room ${roomStake}: ${room.takenBoxes.length} boxes taken${newBox ? `, new box ${newBox} by ${playerName}` : ''}`);
  } catch (error) {
    console.error('Error in broadcastTakenBoxes:', error);
  }
}

function cleanupRoomTimer(stake) {
  if (roomTimers.has(stake)) {
    clearInterval(roomTimers.get(stake));
    roomTimers.delete(stake);
    console.log(`🧹 Cleaned up timer for room ${stake}`);
  }
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
    
    // Update last seen timestamp
    userLastSeen.set(userId, Date.now());
    
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

// ========== FIXED REAL-TIME TRACKING FUNCTIONS ==========
function getConnectedUsers() {
  const connectedUsers = [];
  
  // Get from socketToUser map (direct WebSocket connections)
  socketToUser.forEach((userId, socketId) => {
    // Check if socket is still connected
    const socket = io.sockets.sockets.get(socketId);
    if (socket && socket.connected) {
      connectedUsers.push(userId);
    }
  });
  
  // Also check all connected sockets for any users not in socketToUser
  connectedSockets.forEach(socketId => {
    const socket = io.sockets.sockets.get(socketId);
    if (socket && socket.connected && socket.userId) {
      if (!connectedUsers.includes(socket.userId)) {
        connectedUsers.push(socket.userId);
      }
    }
  });
  
  return [...new Set(connectedUsers)];
}

// 🚨 UPDATED: Function to get online players in a specific room
async function getOnlinePlayersInRoom(roomStake) {
  try {
    const room = await Room.findOne({ stake: roomStake });
    if (!room) return [];
    
    const onlinePlayers = [];
    const connectedUserIds = getConnectedUsers();
    
    // Check each player in room
    room.players.forEach(playerId => {
      // Player is online if they have an active socket
      if (connectedUserIds.includes(playerId)) {
        onlinePlayers.push(playerId);
      }
    });
    
    return onlinePlayers;
  } catch (error) {
    console.error('Error getting online players in room:', error);
    return [];
  }
}

// 🚨 NEW: Function to remove offline players from ALL rooms
async function removeOfflinePlayersFromRoom(roomStake) {
  try {
    const room = await Room.findOne({ stake: roomStake });
    if (!room) return;
    
    const connectedUserIds = getConnectedUsers();
    const originalPlayerCount = room.players.length;
    
    // Filter out offline players
    room.players = room.players.filter(playerId => connectedUserIds.includes(playerId));
    
    // Remove boxes of offline players
    const newTakenBoxes = [];
    for (const playerId of room.players) {
      const user = await User.findOne({ userId: playerId });
      if (user && user.box) {
        newTakenBoxes.push(user.box);
      }
    }
    room.takenBoxes = newTakenBoxes;
    
    if (originalPlayerCount !== room.players.length) {
      console.log(`🧹 Removed ${originalPlayerCount - room.players.length} offline players from room ${roomStake}`);
      await room.save();
      broadcastTakenBoxes(roomStake);
    }
  } catch (error) {
    console.error('Error removing offline players from room:', error);
  }
}

// ========== BROADCAST FUNCTIONS ==========
async function broadcastRoomStatus() {
  try {
    const rooms = await Room.find({ status: { $in: ['waiting', 'starting', 'playing'] } });
    const roomStatus = {};
    
    for (const room of rooms) {
      // 🚨 FIXED: Get ONLY online players
      const onlinePlayers = await getOnlinePlayersInRoom(room.stake);
      
      // 🚨 CRITICAL: If no online players, clear the room entirely
      if (onlinePlayers.length === 0 && room.status !== 'playing') {
        console.log(`🧹 Clearing room ${room.stake} because no online players`);
        room.players = [];
        room.takenBoxes = [];
        room.status = 'waiting';
        await room.save();
      }
      
      const commissionPerPlayer = CONFIG.HOUSE_COMMISSION[room.stake] || 0;
      const contributionPerPlayer = room.stake - commissionPerPlayer;
      const potentialPrize = contributionPerPlayer * onlinePlayers.length;
      const houseFee = commissionPerPlayer * onlinePlayers.length;
      const potentialPrizeWithBonus = potentialPrize + CONFIG.FOUR_CORNERS_BONUS;
      
      roomStatus[room.stake] = {
        stake: room.stake,
        playerCount: onlinePlayers.length, // Use online players count
        totalPlayers: room.players.length, // Total players (including offline)
        status: room.status,
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
      const isOnline = connectedUserIds.includes(user.userId);
      
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
        joinedAt: user.joinedAt
      };
    });
    
    // Get room data
    const roomsData = {};
    const rooms = await Room.find({ status: { $in: ['waiting', 'starting', 'playing'] } });
    
    for (const room of rooms) {
      // 🚨 FIXED: Get ONLY online players for this room
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
        currentBall: room.currentBall,
        ballsDrawn: room.ballsDrawn,
        commissionPerPlayer: commissionPerPlayer,
        contributionPerPlayer: contributionPerPlayer,
        potentialPrize: potentialPrize,
        houseFee: houseFee,
        players: room.players,
        onlinePlayers: onlinePlayers
      };
    }
    
    // Calculate total house balance
    const houseBalance = await Transaction.aggregate([
      { $match: { type: { $in: ['HOUSE_EARNINGS', 'ADMIN_ADD'] } } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]).then(result => result[0]?.total || 0);
    
    // Send to all admin sockets
    const adminData = {
      totalPlayers: connectedPlayers,
      activeGames: activeGames,
      totalUsers: users.length,
      connectedSockets: connectedSockets.size,
      houseBalance: houseBalance,
      timestamp: new Date().toISOString(),
      serverUptime: process.uptime()
    };
    
    adminSockets.forEach(socketId => {
      const socket = io.sockets.sockets.get(socketId);
      if (socket) {
        socket.emit('admin:update', adminData);
        socket.emit('admin:players', userArray);
        socket.emit('admin:rooms', roomsData);
        
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
  
  adminSockets.forEach(socketId => {
    const socket = io.sockets.sockets.get(socketId);
    if (socket) {
      socket.emit('admin:activity', activity);
    }
  });
}

// ========== GAME LOGIC FUNCTIONS ==========
async function startGameTimer(room) {
  if (roomTimers.has(room.stake)) {
    clearInterval(roomTimers.get(room.stake));
  }
  
  const timer = setInterval(async () => {
    try {
      const currentRoom = await Room.findById(room._id);
      if (!currentRoom || currentRoom.status !== 'playing') {
        clearInterval(timer);
        roomTimers.delete(room.stake);
        return;
      }
      
      if (currentRoom.ballsDrawn >= 75) {
        clearInterval(timer);
        roomTimers.delete(room.stake);
        endGameWithNoWinner(currentRoom);
        return;
      }
      
      let ball;
      let letter;
      do {
        ball = Math.floor(Math.random() * 75) + 1;
        letter = getBingoLetter(ball);
      } while (currentRoom.calledNumbers.includes(ball));
      
      currentRoom.calledNumbers.push(ball);
      currentRoom.currentBall = ball;
      currentRoom.ballsDrawn += 1;
      currentRoom.lastBoxUpdate = new Date();
      await currentRoom.save();
      
      const ballData = {
        room: currentRoom.stake,
        num: ball,
        letter: letter
      };
      
      currentRoom.players.forEach(userId => {
        for (const [socketId, uId] of socketToUser.entries()) {
          if (uId === userId) {
            const socket = io.sockets.sockets.get(socketId);
            if (socket) {
              socket.emit('ballDrawn', ballData);
              socket.emit('enableBingo');
            }
          }
        }
      });
      
      broadcastRoomStatus();
      
    } catch (error) {
      console.error('Error in game timer:', error);
      clearInterval(timer);
      roomTimers.delete(room.stake);
    }
  }, CONFIG.GAME_TIMER * 1000);
  
  roomTimers.set(room.stake, timer);
}

function checkBingo(markedNumbers, grid) {
  const patterns = [
    [0,1,2,3,4],
    [5,6,7,8,9],
    [10,11,12,13,14],
    [15,16,17,18,19],
    [20,21,22,23,24],
    
    [0,5,10,15,20],
    [1,6,11,16,21],
    [2,7,12,17,22],
    [3,8,13,18,23],
    [4,9,14,19,24],
    
    [0,6,12,18,24],
    [4,8,12,16,20],
    
    [0,4,20,24]
  ];
  
  for (const pattern of patterns) {
    const isBingo = pattern.every(index => {
      const cellValue = grid[index];
      return markedNumbers.includes(cellValue) || cellValue === 'FREE';
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

async function endGameWithNoWinner(room) {
  try {
    const playersInRoom = [...room.players];
    
    cleanupRoomTimer(room.stake);
    
    for (const userId of playersInRoom) {
      const user = await User.findOne({ userId: userId });
      if (user) {
        user.balance += room.stake;
        user.currentRoom = null;
        user.box = null;
        await user.save();
        
        const transaction = new Transaction({
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
    
    room.players = [];
    room.takenBoxes = [];
    room.status = 'ended';
    room.endTime = new Date();
    room.lastBoxUpdate = new Date();
    await room.save();
    
    broadcastTakenBoxes(room.stake);
    broadcastRoomStatus();
    updateAdminPanel();
    
  } catch (error) {
    console.error('Error ending game with no winner:', error);
  }
}

// ========== IMPROVED COUNTDOWN MANAGEMENT ==========
function stopCountdownForRoom(roomStake) {
  const countdownKey = `countdown_${roomStake}`;
  if (roomTimers.has(countdownKey)) {
    clearInterval(roomTimers.get(countdownKey));
    roomTimers.delete(countdownKey);
    console.log(`⏹️ Stopped countdown for room ${roomStake}`);
  }
}

async function startCountdownForRoom(room) {
  try {
    stopCountdownForRoom(room.stake);
    
    room.status = 'starting';
    room.countdownStartTime = new Date();
    await room.save();
    
    let countdown = CONFIG.COUNTDOWN_TIMER;
    const countdownKey = `countdown_${room.stake}`;
    
    const countdownInterval = setInterval(async () => {
      try {
        const currentRoom = await Room.findById(room._id);
        if (!currentRoom || currentRoom.status !== 'starting') {
          console.log(`Countdown stopped: Room ${room.stake} status changed`);
          stopCountdownForRoom(room.stake);
          return;
        }
        
        const onlinePlayers = await getOnlinePlayersInRoom(room.stake);
        
        if (onlinePlayers.length < CONFIG.MIN_PLAYERS_TO_START) {
          console.log(`Countdown stopped: Not enough online players (${onlinePlayers.length}/${CONFIG.MIN_PLAYERS_TO_START})`);
          
          currentRoom.status = 'waiting';
          currentRoom.countdownStartTime = null;
          await currentRoom.save();
          
          stopCountdownForRoom(room.stake);
          
          onlinePlayers.forEach(userId => {
            for (const [socketId, uId] of socketToUser.entries()) {
              if (uId === userId) {
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
              }
            }
          });
          
          broadcastRoomStatus();
          return;
        }
        
        onlinePlayers.forEach(userId => {
          for (const [socketId, uId] of socketToUser.entries()) {
            if (uId === userId) {
              const socket = io.sockets.sockets.get(socketId);
              if (socket) {
                socket.emit('gameCountdown', {
                  room: room.stake,
                  timer: countdown
                });
              }
            }
          }
        });
        
        countdown--;
        
        if (countdown < 0) {
          clearInterval(countdownInterval);
          roomTimers.delete(countdownKey);
          
          const finalOnlinePlayers = await getOnlinePlayersInRoom(room.stake);
          if (finalOnlinePlayers.length >= CONFIG.MIN_PLAYERS_TO_START) {
            currentRoom.status = 'playing';
            currentRoom.startTime = new Date();
            currentRoom.lastBoxUpdate = new Date();
            currentRoom.countdownStartTime = null;
            await currentRoom.save();
            
            console.log(`🎮 Game started for room ${room.stake} with ${finalOnlinePlayers.length} online players`);
            startGameTimer(currentRoom);
            
            finalOnlinePlayers.forEach(userId => {
              for (const [socketId, uId] of socketToUser.entries()) {
                if (uId === userId) {
                  const socket = io.sockets.sockets.get(socketId);
                  if (socket) {
                    socket.emit('gameCountdown', {
                      room: room.stake,
                      timer: 0
                    });
                  }
                }
              }
            });
          } else {
            currentRoom.status = 'waiting';
            currentRoom.countdownStartTime = null;
            await currentRoom.save();
            
            console.log(`⚠️ Game start aborted for room ${room.stake}: not enough online players when countdown finished`);
            
            finalOnlinePlayers.forEach(userId => {
              for (const [socketId, uId] of socketToUser.entries()) {
                if (uId === userId) {
                  const socket = io.sockets.sockets.get(socketId);
                  if (socket) {
                    socket.emit('gameCountdown', {
                      room: room.stake,
                      timer: 0
                    });
                  }
                }
              }
            });
          }
          
          broadcastRoomStatus();
        }
      } catch (error) {
        console.error('Error in countdown interval:', error);
        clearInterval(countdownInterval);
        roomTimers.delete(`countdown_${room.stake}`);
      }
    }, 1000);
    
    roomTimers.set(countdownKey, countdownInterval);
    console.log(`⏱️ Started countdown for room ${room.stake} with ${(await getOnlinePlayersInRoom(room.stake)).length} online players`);
    
  } catch (error) {
    console.error('Error starting countdown:', error);
  }
}

// 🚨 NEW: Aggressive cleanup of all rooms
async function cleanupAllRoomsOfOfflinePlayers() {
  try {
    const rooms = await Room.find({ status: { $in: ['waiting', 'starting'] } });
    
    for (const room of rooms) {
      await removeOfflinePlayersFromRoom(room.stake);
    }
  } catch (error) {
    console.error('Error cleaning up offline players from all rooms:', error);
  }
}

// ========== IMPROVED SOCKET.IO EVENT HANDLERS ==========
io.on('connection', (socket) => {
  console.log(`✅ Socket.IO Connected: ${socket.id} - User: ${socket.handshake.query?.userId || 'Unknown'}`);
  connectedSockets.add(socket.id);
  
  const query = socket.handshake.query;
  if (query.userId) {
    console.log(`👤 User connected via query: ${query.userId}`);
    socket.userId = query.userId;
  }
  
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
    
    const transaction = new Transaction({
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
      room.status = 'starting';
      await room.save();
      
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
      cleanupRoomTimer(roomStake);
      
      const playersInRoom = [...room.players];
      
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
      
      room.players = [];
      room.takenBoxes = [];
      room.status = 'ended';
      room.endTime = new Date();
      room.lastBoxUpdate = new Date();
      await room.save();
      
      broadcastTakenBoxes(roomStake);
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
    
    const playersInRoom = [...room.players];
    
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
    
    room.players = [];
    room.takenBoxes = [];
    room.status = 'waiting';
    room.lastBoxUpdate = new Date();
    await room.save();
    
    broadcastTakenBoxes(roomStake);
    socket.emit('admin:success', `Cleared all boxes in ${roomStake} ETB room`);
    
    logActivity('ADMIN_CLEAR_BOXES', { adminSocket: socket.id, roomStake }, socket.id);
  });
  
  // Player events
  socket.on('init', async (data) => {
    try {
      const { userId, userName } = data;
      
      console.log(`📱 User init: ${userName} (${userId}) via socket ${socket.id}`);
      
      socket.userId = userId;
      
      const user = await getUser(userId, userName);
      
      if (user) {
        socketToUser.set(socket.id, userId);
        
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
          referralCode: user.referralCode
        });
        
        socket.emit('connected', { message: 'Successfully connected to Bingo Elite' });
        
        console.log(`✅ User connected successfully: ${userName} (${userId})`);
        
        updateAdminPanel();
        broadcastRoomStatus();
        
        logActivity('USER_CONNECTED', { userId, userName, socketId: socket.id });
      } else {
        socket.emit('error', 'Failed to initialize user');
      }
    } catch (error) {
      console.error('Error in init:', error);
      socket.emit('error', 'Server error during initialization');
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
  
  // 🚨 FIXED: Only show boxes from current room state
  socket.on('getTakenBoxes', async ({ room }, callback) => {
    try {
      const roomData = await Room.findOne({ 
        stake: parseInt(room), 
        status: { $in: ['waiting', 'starting', 'playing'] }
      });
      
      if (roomData) {
        console.log(`📦 Getting taken boxes for room ${room}: ${roomData.takenBoxes.length} boxes`);
        callback(roomData.takenBoxes || []);
      } else {
        console.log(`📦 No active room for ${room}, returning empty boxes`);
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
      
      Room.findOne({ 
        stake: data.room, 
        status: { $in: ['waiting', 'starting', 'playing'] }
      })
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
  
  socket.on('joinRoom', async (data) => {
    try {
      const { room, box, userName } = data;
      const userId = socketToUser.get(socket.id) || socket.userId;
      
      if (!userId) {
        socket.emit('error', 'Player not initialized');
        return;
      }
      
      const user = await User.findOne({ userId: userId });
      if (!user) {
        socket.emit('error', 'User not found');
        return;
      }
      
      if (user.balance < room) {
        socket.emit('insufficientFunds');
        return;
      }
      
      const roomData = await Room.findOne({ 
        stake: room, 
        status: { $in: ['waiting', 'starting', 'playing'] } 
      });
      
      if (!roomData) {
        const newRoom = new Room({
          stake: room,
          players: [],
          takenBoxes: [],
          status: 'waiting',
          lastBoxUpdate: new Date()
        });
        await newRoom.save();
        
        joinRoomWithData(user, newRoom, box, socket, room, userName);
        return;
      }
      
      if (box < 1 || box > 100) {
        socket.emit('error', 'Invalid box number. Must be between 1 and 100');
        return;
      }
      
      if (roomData.takenBoxes.includes(box)) {
        socket.emit('boxTaken');
        return;
      }
      
      if (user.currentRoom) {
        if (user.currentRoom === room) {
          socket.emit('joinedRoom');
          return;
        }
        socket.emit('error', 'Already in a different room');
        return;
      }
      
      joinRoomWithData(user, roomData, box, socket, room, userName);
      
    } catch (error) {
      console.error('Error joining room:', error);
      socket.emit('error', 'Server error while joining room');
    }
  });
  
  // Helper function for joining room
  async function joinRoomWithData(user, roomData, box, socket, room, userName) {
    user.balance -= room;
    user.totalWagered = (user.totalWagered || 0) + room;
    user.currentRoom = room;
    user.box = box;
    await user.save();
    
    const transaction = new Transaction({
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
    
    const onlinePlayers = await getOnlinePlayersInRoom(room);
    
    // Broadcast update
    broadcastTakenBoxes(room, box, user.userName);
    
    onlinePlayers.forEach(playerUserId => {
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
    
    if (onlinePlayers.length >= CONFIG.MIN_PLAYERS_TO_START && roomData.status === 'waiting') {
      await startCountdownForRoom(roomData);
    }
    
    await roomData.save();
    socket.emit('joinedRoom');
    socket.emit('balanceUpdate', user.balance);
    
    socket.emit('boxesTakenUpdate', {
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
  }
  
  socket.on('claimBingo', async (data) => {
    try {
      const { room, grid, marked } = data;
      const userId = socketToUser.get(socket.id) || socket.userId;
      
      if (!userId) {
        socket.emit('error', 'Player not initialized');
        return;
      }
      
      const user = await User.findOne({ userId: userId });
      if (!user) {
        socket.emit('error', 'User not found');
        return;
      }
      
      const roomData = await Room.findOne({ stake: parseInt(room), status: 'playing' });
      if (!roomData) {
        socket.emit('error', 'Game not found or not in progress');
        return;
      }
      
      if (!roomData.players.includes(userId)) {
        socket.emit('error', 'You are not in this game');
        return;
      }
      
      const bingoCheck = checkBingo(marked, grid);
      if (!bingoCheck.isBingo) {
        socket.emit('error', 'Invalid bingo claim');
        return;
      }
      
      const isFourCornersWin = bingoCheck.isFourCorners;
      
      const commissionPerPlayer = CONFIG.HOUSE_COMMISSION[room] || 0;
      const contributionPerPlayer = room - commissionPerPlayer;
      const totalContributions = contributionPerPlayer * roomData.players.length;
      
      let basePrize = totalContributions;
      let bonus = 0;
      
      if (isFourCornersWin) {
        bonus = CONFIG.FOUR_CORNERS_BONUS;
      }
      
      const totalPrize = basePrize + bonus;
      
      console.log(`🎰 Win Calculation for ${room} ETB room:`);
      console.log(`   Players: ${roomData.players.length}`);
      console.log(`   Commission per player: ${commissionPerPlayer}`);
      console.log(`   Contribution per player: ${contributionPerPlayer}`);
      console.log(`   Total contributions: ${totalContributions}`);
      console.log(`   Base prize: ${basePrize}`);
      console.log(`   Four corners bonus: ${bonus}`);
      console.log(`   Total prize: ${totalPrize}`);
      console.log(`   House earnings: ${commissionPerPlayer * roomData.players.length}`);
      
      const oldBalance = user.balance;
      user.balance += totalPrize;
      user.totalWins = (user.totalWins || 0) + 1;
      user.totalBingos = (user.totalBingos || 0) + 1;
      user.currentRoom = null;
      user.box = null;
      await user.save();
      
      console.log(`💰 User ${user.userName} won ${totalPrize} ETB (was ${oldBalance}, now ${user.balance})`);
      
      const transactionType = isFourCornersWin ? 'WIN_FOUR_CORNERS' : 'WIN';
      const transaction = new Transaction({
        type: transactionType,
        userId: userId,
        userName: user.userName,
        amount: totalPrize,
        room: room,
        description: `Bingo win in ${room} ETB room with ${roomData.players.length} players${isFourCornersWin ? ' (Four Corners Bonus)' : ''}`
      });
      await transaction.save();
      
      const houseEarnings = commissionPerPlayer * roomData.players.length;
      const houseTransaction = new Transaction({
        type: 'HOUSE_EARNINGS',
        userId: 'HOUSE',
        userName: 'House',
        amount: houseEarnings,
        room: room,
        description: `Commission from ${roomData.players.length} players in ${room} ETB room`
      });
      await houseTransaction.save();
      
      const playersInRoom = [...roomData.players];
      
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
      
      cleanupRoomTimer(room);
      
      for (const playerId of playersInRoom) {
        if (playerId !== userId) {
          const losingUser = await User.findOne({ userId: playerId });
          if (losingUser) {
            losingUser.currentRoom = null;
            losingUser.box = null;
            await losingUser.save();
          }
        }
        
        for (const [sId, uId] of socketToUser.entries()) {
          if (uId === playerId) {
            const s = io.sockets.sockets.get(sId);
            if (s) {
              if (uId === userId) {
                s.emit('gameOver', {
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
                });
                s.emit('balanceUpdate', user.balance);
              } else {
                const losingUser = await User.findOne({ userId: playerId });
                s.emit('gameOver', {
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
                });
                if (losingUser) {
                  s.emit('balanceUpdate', losingUser.balance);
                }
              }
            }
          }
        }
      }
      
      roomData.players = [];
      roomData.takenBoxes = [];
      await roomData.save();
      
      broadcastTakenBoxes(room);
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
      console.error('Error in claimBingo:', error);
      socket.emit('error', 'Server error processing bingo claim');
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
        
        // Update last seen timestamp
        userLastSeen.set(userId, Date.now());
        
        updateAdminPanel();
      } catch (error) {
        console.error('Error updating player activity:', error);
      }
    }
  });
  
  socket.on('player:leaveRoom', async (data) => {
    try {
      const userId = socketToUser.get(socket.id) || socket.userId;
      if (!userId) return;
      
      const user = await User.findOne({ userId: userId });
      if (!user || !user.currentRoom) return;
      
      const room = await Room.findOne({ stake: user.currentRoom });
      if (room) {
        if (room.status === 'playing') {
          socket.emit('error', 'Cannot leave room during active game!');
          return;
        }
        
        room.players = room.players.filter(id => id !== userId);
        room.takenBoxes = room.takenBoxes.filter(boxNum => boxNum !== user.box);
        room.lastBoxUpdate = new Date();
        
        const onlinePlayers = await getOnlinePlayersInRoom(room.stake);
        if (room.status === 'starting' && onlinePlayers.length < CONFIG.MIN_PLAYERS_TO_START) {
          room.status = 'waiting';
          room.countdownStartTime = null;
          
          stopCountdownForRoom(room.stake);
          
          onlinePlayers.forEach(playerUserId => {
            for (const [sId, uId] of socketToUser.entries()) {
              if (uId === playerUserId) {
                const s = io.sockets.sockets.get(sId);
                if (s) {
                  s.emit('gameCountdown', {
                    room: room.stake,
                    timer: 0
                  });
                  s.emit('lobbyUpdate', {
                    room: room.stake,
                    count: onlinePlayers.length
                  });
                }
              }
            }
          });
        }
        
        await room.save();
        
        broadcastTakenBoxes(user.currentRoom);
        
        user.currentRoom = null;
        user.box = null;
        await user.save();
        
        socket.emit('balanceUpdate', user.balance);
        socket.emit('leftRoom', { message: 'Left room successfully' });
        socket.emit('boxesTakenUpdate', {
          room: user.currentRoom,
          takenBoxes: room.takenBoxes,
          playerCount: onlinePlayers.length
        });
        
        console.log(`👤 User ${user.userName} left room ${room.stake}, now has ${room.takenBoxes.length} taken boxes, ${onlinePlayers.length} online players`);
        
        broadcastRoomStatus();
        updateAdminPanel();
        
        logActivity('PLAYER_LEFT_ROOM', { 
          userId, 
          userName: user.userName, 
          room: room.stake,
          remainingPlayers: room.players.length,
          onlinePlayers: onlinePlayers.length,
          remainingBoxes: room.takenBoxes.length
        });
      }
    } catch (error) {
      console.error('Error in player:leaveRoom:', error);
      socket.emit('error', 'Failed to leave room');
    }
  });
  
  socket.on('disconnect', () => {
    console.log(`❌ Socket.IO Disconnected: ${socket.id}`);
    connectedSockets.delete(socket.id);
    adminSockets.delete(socket.id);
    
    roomSubscriptions.forEach((sockets, room) => {
      sockets.delete(socket.id);
    });
    
    const userId = socketToUser.get(socket.id) || socket.userId;
    if (userId) {
      User.findOne({ userId: userId })
        .then(async user => {
          if (user && user.currentRoom) {
            const room = await Room.findOne({ stake: user.currentRoom });
            if (room) {
              if (room.status !== 'playing') {
                room.players = room.players.filter(id => id !== userId);
                room.takenBoxes = room.takenBoxes.filter(boxNum => boxNum !== user.box);
                room.lastBoxUpdate = new Date();
                
                const onlinePlayers = await getOnlinePlayersInRoom(room.stake);
                if (room.status === 'starting' && onlinePlayers.length < CONFIG.MIN_PLAYERS_TO_START) {
                  room.status = 'waiting';
                  room.countdownStartTime = null;
                  
                  stopCountdownForRoom(room.stake);
                }
                
                await room.save();
                
                broadcastTakenBoxes(user.currentRoom);
                console.log(`👤 User ${user.userName} disconnected from room ${room.stake}`);
              } else {
                console.log(`⚠️ User ${user.userName} disconnected during gameplay, keeping in room`);
              }
            }
            
            user.isOnline = false;
            user.lastSeen = new Date();
            await user.save();
          } else {
            await User.findOneAndUpdate(
              { userId: userId },
              { 
                isOnline: false,
                lastSeen: new Date() 
              }
            );
          }
        })
        .catch(console.error);
      
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

// ========== PERIODIC TASKS ==========
setInterval(() => {
  broadcastRoomStatus();
}, CONFIG.ROOM_STATUS_UPDATE_INTERVAL);

// Update admin panel every 2 seconds
setInterval(() => {
  updateAdminPanel();
}, 2000);

// 🚨 CRITICAL: Clean up ALL rooms of offline players every 10 seconds
setInterval(() => {
  cleanupAllRoomsOfOfflinePlayers();
}, 10000);

// Clean up disconnected sockets
setInterval(() => {
  socketToUser.forEach((userId, socketId) => {
    const socket = io.sockets.sockets.get(socketId);
    if (!socket || !socket.connected) {
      socketToUser.delete(socketId);
      console.log(`🧹 Cleaned up disconnected socket: ${socketId} (user: ${userId})`);
    }
  });
}, 10000);

// Clean up stale connections
async function cleanupStaleConnections() {
  console.log('🧹 Running connection cleanup...');
  
  const now = new Date();
  const thirtySecondsAgo = new Date(now.getTime() - 30000);
  
  try {
    await User.updateMany(
      { 
        lastSeen: { $lt: thirtySecondsAgo },
        isOnline: true 
      },
      { 
        isOnline: false 
      }
    );
    
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

setInterval(cleanupStaleConnections, 30000);

// Clean up stuck countdowns
async function cleanupStuckCountdowns() {
  try {
    const now = new Date();
    const rooms = await Room.find({ status: 'starting' });
    
    for (const room of rooms) {
      if (room.countdownStartTime) {
        const timeSinceStart = now - new Date(room.countdownStartTime);
        if (timeSinceStart > 45000) {
          console.log(`⚠️ Cleaning up stuck countdown for room ${room.stake} (${timeSinceStart/1000}s)`);
          
          stopCountdownForRoom(room.stake);
          
          room.status = 'waiting';
          room.countdownStartTime = null;
          await room.save();
          
          const onlinePlayers = await getOnlinePlayersInRoom(room.stake);
          onlinePlayers.forEach(userId => {
            for (const [socketId, uId] of socketToUser.entries()) {
              if (uId === userId) {
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
              }
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

setInterval(cleanupStuckCountdowns, 10000);

// Clean up stale rooms
async function cleanupStaleRooms() {
  try {
    const oneHourAgo = new Date(Date.now() - 3600000);
    
    const staleRooms = await Room.find({
      status: 'ended',
      endTime: { $lt: oneHourAgo }
    });
    
    for (const room of staleRooms) {
      console.log(`🧹 Cleaning up stale room: ${room.stake} ETB`);
      await Room.deleteOne({ _id: room._id });
    }
    
    const emptyPlayingRooms = await Room.find({
      status: 'playing',
      players: { $size: 0 }
    });
    
    for (const room of emptyPlayingRooms) {
      console.log(`🧹 Cleaning up empty playing room: ${room.stake} ETB`);
      cleanupRoomTimer(room.stake);
      await Room.deleteOne({ _id: room._id });
    }
    
  } catch (error) {
    console.error('Error in cleanupStaleRooms:', error);
  }
}

setInterval(cleanupStaleRooms, 300000);

// Health check
setInterval(async () => {
  try {
    const now = Date.now();
    const fiveMinutesAgo = new Date(now - 300000);
    
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
// ... (keep all your existing Express routes exactly as they were)
// The routes remain unchanged from your previous version

// ========== START SERVER ==========
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════════════╗
║             🤖 BINGO ELITE - TELEGRAM READY         ║
╠══════════════════════════════════════════════════════╣
║  URL:          https://bingo-telegram-game.onrender.com ║
║  Port:         ${PORT}                                ║
║  Game:         /game                                 ║
║  Admin:        /admin (password: admin1234)         ║
║  Telegram:     /telegram                             ║
║  Bot Setup:    /setup-telegram                       ║
║  Real-Time:    /real-time-status                     ║
║  Debug:        /debug-connections                    ║
║  Debug Users:  /debug-users                          ║
║  Debug Calc:   /debug-calculations/:stake/:players   ║
╠══════════════════════════════════════════════════════╣
║  🔑 Admin Password: ${process.env.ADMIN_PASSWORD || 'admin1234'} ║
║  🤖 Telegram Bot: @ethio_games1_bot                 ║
║  📡 WebSocket: ✅ Ready for Telegram connections    ║
║  🎮 Four Corners Bonus: ${CONFIG.FOUR_CORNERS_BONUS} ETB       ║
║  📦 Real-time Box Tracking: ✅ ACTIVE               ║
║  🚨 AGGRESSIVE FIXES APPLIED:                       ║
║     ✅ Players IMMEDIATELY removed on disconnect    ║
║     ✅ Rooms cleared when no online players         ║
║     ✅ All rooms cleaned every 10 seconds           ║
╚══════════════════════════════════════════════════════╝
✅ Server ready for REAL-TIME tracking and Telegram Mini App
  `);
  
  setTimeout(() => {
    broadcastRoomStatus();
  }, 1000);
  
  setTimeout(async () => {
    try {
      const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN || '8281813355:AAElz32khbZ9cnX23CeJQn7gwkAypHuJ9E4';
      if (TELEGRAM_TOKEN && TELEGRAM_TOKEN.length > 20) {
        const webhookUrl = `https://bingo-telegram-game.onrender.com/telegram-webhook`;
        
        const webhookResponse = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/setWebhook`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url: webhookUrl,
            drop_pending_updates: true
          })
        });
        
        const webhookResult = await webhookResponse.json();
        console.log('✅ Telegram Webhook Auto-Set:', webhookResult);
      }
    } catch (error) {
      console.log('⚠️ Telegram auto-setup skipped or failed');
    }
  }, 3000);
});
