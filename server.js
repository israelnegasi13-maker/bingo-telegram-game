// server.js - BINGO ELITE - TELEGRAM MINI APP - WITH DEPOSIT/WITHDRAWAL SYSTEM
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
  languageCode: { type: String, default: 'en' },
  // Wallet fields
  telebirrPhone: { type: String, default: '' },
  totalDeposited: { type: Number, default: 0 },
  totalWithdrawn: { type: Number, default: 0 },
  depositCount: { type: Number, default: 0 },
  withdrawalCount: { type: Number, default: 0 },
  isVerified: { type: Boolean, default: false },
  verificationLevel: { type: String, enum: ['basic', 'verified', 'premium'], default: 'basic' },
  lastDeposit: { type: Date, default: null },
  lastWithdrawal: { type: Date, default: null },
  depositLimit: { type: Number, default: 10000 },
  withdrawalLimit: { type: Number, default: 10000 }
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

// Deposit/Withdrawal Models
const depositSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  userName: { type: String, required: true },
  amount: { type: Number, required: true },
  phoneNumber: { type: String, required: true },
  transactionId: { type: String, required: true, unique: true },
  screenshot: { type: String },
  receiptText: { type: String, required: true },
  status: { 
    type: String, 
    enum: ['pending', 'approved', 'rejected', 'cancelled'],
    default: 'pending'
  },
  adminNotes: { type: String, default: '' },
  processedBy: { type: String, default: null },
  processedAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

const withdrawalSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  userName: { type: String, required: true },
  amount: { type: Number, required: true },
  phoneNumber: { type: String, required: true },
  status: { 
    type: String, 
    enum: ['pending', 'approved', 'rejected', 'processing', 'completed'],
    default: 'pending'
  },
  adminNotes: { type: String, default: '' },
  processedBy: { type: String, default: null },
  processedAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

const adminPaymentInfoSchema = new mongoose.Schema({
  phoneNumber: { type: String, required: true, unique: true },
  provider: { type: String, default: 'Telebirr' },
  isActive: { type: Boolean, default: true },
  notes: { type: String, default: 'Send money via Telebirr and paste receipt below' },
  minDeposit: { type: Number, default: 10 },
  maxDeposit: { type: Number, default: 10000 },
  minWithdrawal: { type: Number, default: 50 },
  maxWithdrawal: { type: Number, default: 10000 },
  createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);
const Room = mongoose.model('Room', roomSchema);
const Transaction = mongoose.model('Transaction', transactionSchema);
const Stats = mongoose.model('Stats', statsSchema);
const Deposit = mongoose.model('Deposit', depositSchema);
const Withdrawal = mongoose.model('Withdrawal', withdrawalSchema);
const AdminPaymentInfo = mongoose.model('AdminPaymentInfo', adminPaymentInfoSchema);

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

app.use(express.json({ limit: '10mb' }));
app.use(express.static(__dirname));  // CHANGED: Serve from current directory

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
  // Wallet Configuration
  MIN_DEPOSIT: 10,
  MAX_DEPOSIT: 10000,
  MIN_WITHDRAWAL: 50,
  MAX_WITHDRAWAL: 10000,
  ADMIN_PHONE_NUMBER: process.env.ADMIN_PHONE || "+251912345678",
  AUTO_APPROVE_DEPOSITS: false,
  AUTO_APPROVE_WITHDRAWALS: false
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
  
  io.emit('boxesTakenUpdate', updateData);
  
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

setInterval(cleanupProcessingClaims, 10000);

// ========== WALLET HELPER FUNCTIONS ==========
async function initializePaymentInfo() {
  try {
    const existing = await AdminPaymentInfo.findOne({ isActive: true });
    if (!existing) {
      const paymentInfo = new AdminPaymentInfo({
        phoneNumber: CONFIG.ADMIN_PHONE_NUMBER,
        provider: 'Telebirr',
        notes: 'Send money via Telebirr and paste receipt from SMS below',
        minDeposit: CONFIG.MIN_DEPOSIT,
        maxDeposit: CONFIG.MAX_DEPOSIT,
        minWithdrawal: CONFIG.MIN_WITHDRAWAL,
        maxWithdrawal: CONFIG.MAX_WITHDRAWAL
      });
      await paymentInfo.save();
      console.log('✅ Created default admin payment info');
    }
  } catch (error) {
    console.error('❌ Error initializing payment info:', error);
  }
}

async function getPaymentInfo() {
  try {
    const paymentInfo = await AdminPaymentInfo.findOne({ isActive: true });
    if (!paymentInfo) {
      await initializePaymentInfo();
      return await AdminPaymentInfo.findOne({ isActive: true });
    }
    return paymentInfo;
  } catch (error) {
    console.error('Error getting payment info:', error);
    return null;
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

function getConnectedUsers() {
  const connectedUsers = new Set();
  
  socketToUser.forEach((userId, socketId) => {
    const socket = io.sockets.sockets.get(socketId);
    if (socket && socket.connected) {
      connectedUsers.add(userId);
    }
  });
  
  io.sockets.sockets.forEach((socket) => {
    if (socket && socket.connected && socket.userId && socket.userId !== 'pending') {
      connectedUsers.add(socket.userId);
    }
  });
  
  return Array.from(connectedUsers);
}

async function getOnlinePlayersInRoom(roomStake) {
  try {
    const room = await Room.findOne({ stake: roomStake });
    if (!room) return [];
    
    const onlinePlayers = [];
    const connectedUserIds = getConnectedUsers();
    
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
    
    io.emit('roomStatus', roomStatus);
    updateAdminPanel();
    
  } catch (error) {
    console.error('Error broadcasting room status:', error);
  }
}

async function updateAdminPanel() {
  try {
    const connectedPlayers = getConnectedUsers().length;
    const activeGames = await Room.countDocuments({ status: 'playing' });
    
    const users = await User.find({}).sort({ balance: -1 }).limit(100);
    const connectedUserIds = getConnectedUsers();
    
    const userArray = users.map(user => {
      let isOnline = false;
      
      if (connectedUserIds.includes(user.userId)) {
        isOnline = true;
      } else if (user.lastSeen) {
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
        joinedAt: user.joinedAt,
        telebirrPhone: user.telebirrPhone || '',
        totalDeposited: user.totalDeposited || 0,
        totalWithdrawn: user.totalWithdrawn || 0,
        depositCount: user.depositCount || 0,
        withdrawalCount: user.withdrawalCount || 0
      };
    });
    
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
    
    const houseBalance = await Transaction.aggregate([
      { $match: { type: { $in: ['HOUSE_EARNINGS', 'ADMIN_ADD'] } } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]).then(result => result[0]?.total || 0);
    
    const pendingDeposits = await Deposit.countDocuments({ status: 'pending' });
    const pendingWithdrawals = await Withdrawal.countDocuments({ status: 'pending' });
    
    const connectedSocketsCount = connectedSockets.size;
    
    const adminData = {
      totalPlayers: connectedPlayers,
      activeGames: activeGames,
      totalUsers: users.length,
      connectedSockets: connectedSocketsCount,
      houseBalance: houseBalance,
      pendingDeposits: pendingDeposits,
      pendingWithdrawals: pendingWithdrawals,
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
        
        Transaction.find().sort({ createdAt: -1 }).limit(50)
          .then(transactions => {
            socket.emit('admin:transactions', transactions);
          })
          .catch(err => console.error('Error fetching transactions:', err));
        
        Deposit.find({ status: 'pending' }).sort({ createdAt: -1 })
          .then(deposits => {
            socket.emit('admin:pendingDeposits', deposits);
          })
          .catch(err => console.error('Error fetching deposits:', err));
        
        Withdrawal.find({ status: 'pending' }).sort({ createdAt: -1 })
          .then(withdrawals => {
            socket.emit('admin:pendingWithdrawals', withdrawals);
          })
          .catch(err => console.error('Error fetching withdrawals:', err));
      }
    });
    
    console.log(`📊 Admin Panel Updated: ${connectedPlayers} players online, ${activeGames} active games, ${pendingDeposits} pending deposits, ${pendingWithdrawals} pending withdrawals`);
    
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

// ========== AUTO-CLEAR LONG RUNNING GAMES ==========
async function cleanupLongRunningGames() {
  try {
    const sevenMinutesAgo = new Date(Date.now() - CONFIG.GAME_TIMEOUT_MINUTES * 60 * 1000);
    const longRunningRooms = await Room.find({
      status: 'playing',
      startTime: { $lt: sevenMinutesAgo }
    });
    
    for (const room of longRunningRooms) {
      console.log(`⏰ Room ${room.stake} has been playing for ${CONFIG.GAME_TIMEOUT_MINUTES}+ minutes. Auto-ending...`);
      
      cleanupRoomTimer(room.stake);
      
      const playersInRoom = [...room.players];
      
      for (const userId of playersInRoom) {
        const user = await User.findOne({ userId: userId });
        if (user) {
          const oldBalance = user.balance;
          user.balance += room.stake;
          user.currentRoom = null;
          user.box = null;
          await user.save();
          
          console.log(`💰 Auto-refunded ${room.stake} ETB to ${user.userName} after ${CONFIG.GAME_TIMEOUT_MINUTES}min timeout`);
          
          const transaction = new Transaction({
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
      
      broadcastTakenBoxes(room.stake, []);
      
      console.log(`✅ Auto-cleared room ${room.stake} after ${CONFIG.GAME_TIMEOUT_MINUTES} minutes`);
    }
  } catch (error) {
    console.error('❌ Error in cleanupLongRunningGames:', error);
  }
}

// ========== GAME TIMER FUNCTION ==========
async function startGameTimer(room) {
  console.log(`🎲 STARTING GAME TIMER for room ${room.stake} with ${room.players.length} players`);
  
  cleanupRoomTimer(room.stake);
  
  room.calledNumbers = [];
  room.currentBall = null;
  room.ballsDrawn = 0;
  room.startTime = new Date();
  await room.save();
  
  console.log(`✅ Room ${room.stake} set to playing, starting ball timer...`);
  
  const timer = setInterval(async () => {
    try {
      const currentRoom = await Room.findById(room._id);
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
      
      let ball;
      let letter;
      let attempts = 0;
      
      do {
        ball = Math.floor(Math.random() * 75) + 1;
        letter = getBingoLetter(ball);
        attempts++;
        
        if (attempts > 150) {
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
      
      const ballData = {
        room: currentRoom.stake,
        num: ball,
        letter: letter,
        ballsDrawn: currentRoom.ballsDrawn
      };
      
      console.log(`📤 Broadcasting ball ${letter}-${ball} to ${currentRoom.players.length} players in room ${room.stake}`);
      
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

// ========== CHECK BINGO FUNCTION ==========
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
        pattern: pattern,
        isFourCorners: pattern.length === 4 && pattern[0] === 0 && pattern[1] === 4 && pattern[2] === 20 && pattern[3] === 24
      };
    }
  }
  
  return { isBingo: false };
}

// ========== END GAME WITH NO WINNER ==========
async function endGameWithNoWinner(room) {
  try {
    console.log(`🎮 Ending game with no winner for room ${room.stake}`);
    
    cleanupRoomTimer(room.stake);
    
    const playersInRoom = [...room.players];
    
    for (const userId of playersInRoom) {
      const user = await User.findOne({ userId: userId });
      if (user) {
        const oldBalance = user.balance;
        user.balance += room.stake;
        user.currentRoom = null;
        user.box = null;
        await user.save();
        
        console.log(`💰 Refunded ${room.stake} ETB to ${user.userName}, balance: ${oldBalance} → ${user.balance}`);
        
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
    room.status = 'waiting';
    room.calledNumbers = [];
    room.currentBall = null;
    room.ballsDrawn = 0;
    room.startTime = null;
    room.endTime = new Date();
    room.lastBoxUpdate = new Date();
    await room.save();
    
    broadcastTakenBoxes(room.stake, []);
    io.emit('boxesCleared', { room: room.stake, reason: 'game_ended_no_winner' });
    
    console.log(`✅ Game ended with no winner for room ${room.stake}. Boxes cleared for next game.`);
    
    broadcastRoomStatus();
    updateAdminPanel();
    
  } catch (error) {
    console.error('❌ Error ending game with no winner:', error);
  }
}

// ========== COUNTDOWN FUNCTION ==========
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
    
    let countdown = CONFIG.COUNTDOWN_TIMER;
    const countdownInterval = setInterval(async () => {
      try {
        const currentRoom = await Room.findById(room._id);
        if (!currentRoom || currentRoom.status !== 'starting') {
          console.log(`⏹️ Countdown stopped: Room ${room.stake} status changed to ${currentRoom?.status || 'deleted'}`);
          clearInterval(countdownInterval);
          roomTimers.delete(countdownKey);
          return;
        }
        
        const onlinePlayers = await getOnlinePlayersInRoom(room.stake);
        
        console.log(`⏱️ Room ${room.stake}: Countdown ${countdown}s, ${onlinePlayers.length} online players`);
        
        const socketsToSend = new Set();
        
        currentRoom.players.forEach(userId => {
          for (const [socketId, uId] of socketToUser.entries()) {
            if (uId === userId) {
              if (io.sockets.sockets.get(socketId)?.connected) {
                socketsToSend.add(socketId);
              }
            }
          }
        });
        
        const subscribedSockets = roomSubscriptions.get(room.stake) || new Set();
        subscribedSockets.forEach(socketId => {
          if (io.sockets.sockets.get(socketId)?.connected) {
            socketsToSend.add(socketId);
          }
        });
        
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
        
        if (countdown < 0) {
          clearInterval(countdownInterval);
          roomTimers.delete(countdownKey);
          
          console.log(`🎮 Countdown finished for room ${room.stake} - AUTO STARTING GAME`);
          
          const finalRoom = await Room.findById(room._id);
          if (!finalRoom || finalRoom.status !== 'starting') {
            console.log(`⚠️ Countdown finished but room ${room.stake} is no longer in starting status`);
            return;
          }
          
          const finalOnlinePlayers = await getOnlinePlayersInRoom(room.stake);
          
          if (finalOnlinePlayers.length >= 1) {
            console.log(`🎮 AUTO STARTING game for room ${room.stake} with ${finalOnlinePlayers.length} online player(s)`);
            
            finalRoom.status = 'playing';
            finalRoom.startTime = new Date();
            finalRoom.countdownStartTime = null;
            finalRoom.countdownStartedWith = 0;
            await finalRoom.save();
            
            const finalSocketsToSend = new Set();
            
            finalRoom.players.forEach(userId => {
              for (const [socketId, uId] of socketToUser.entries()) {
                if (uId === userId) {
                  if (io.sockets.sockets.get(socketId)?.connected) {
                    finalSocketsToSend.add(socketId);
                  }
                }
              }
            });
            
            const finalSubscribedSockets = roomSubscriptions.get(room.stake) || new Set();
            finalSubscribedSockets.forEach(socketId => {
              if (io.sockets.sockets.get(socketId)?.connected) {
                finalSocketsToSend.add(socketId);
              }
            });
            
            finalSocketsToSend.forEach(socketId => {
              const socket = io.sockets.sockets.get(socketId);
              if (socket && socket.connected) {
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
            
            const resetSocketsToSend = new Set();
            
            finalRoom.players.forEach(userId => {
              for (const [socketId, uId] of socketToUser.entries()) {
                if (uId === userId) {
                  if (io.sockets.sockets.get(socketId)?.connected) {
                    resetSocketsToSend.add(socketId);
                  }
                }
              }
            });
            
            const resetSubscribedSockets = roomSubscriptions.get(room.stake) || new Set();
            resetSubscribedSockets.forEach(socketId => {
              if (io.sockets.sockets.get(socketId)?.connected) {
                resetSocketsToSend.add(socketId);
              }
            });
            
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

// ========== SOCKET.IO EVENT HANDLERS ==========
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
      room.status = 'playing';
      room.startTime = new Date();
      await room.save();
      
      await startGameTimer(room);
      
      const socketsToSend = new Set();
      
      room.players.forEach(userId => {
        for (const [sId, uId] of socketToUser.entries()) {
          if (uId === userId) {
            if (io.sockets.sockets.get(sId)?.connected) {
              socketsToSend.add(sId);
            }
          }
        }
      });
      
      const subscribedSockets = roomSubscriptions.get(room.stake) || new Set();
      subscribedSockets.forEach(socketId => {
        if (io.sockets.sockets.get(socketId)?.connected) {
          socketsToSend.add(socketId);
        }
      });
      
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
    
    broadcastTakenBoxes(roomStake, []);
    socket.emit('admin:success', `Cleared all boxes in ${roomStake} ETB room`);
    
    logActivity('ADMIN_CLEAR_BOXES', { adminSocket: socket.id, roomStake }, socket.id);
  });
  
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
  
  // ========== ADMIN WALLET MANAGEMENT ==========
  socket.on('admin:getPendingTransactions', async () => {
    if (!adminSockets.has(socket.id)) {
      socket.emit('admin:error', 'Unauthorized');
      return;
    }
    
    try {
      const pendingDeposits = await Deposit.find({ status: 'pending' }).sort({ createdAt: -1 });
      const pendingWithdrawals = await Withdrawal.find({ status: 'pending' }).sort({ createdAt: -1 });
      
      socket.emit('admin:pendingDeposits', pendingDeposits);
      socket.emit('admin:pendingWithdrawals', pendingWithdrawals);
    } catch (error) {
      console.error('Error getting pending transactions:', error);
      socket.emit('admin:error', 'Failed to load transactions');
    }
  });
  
  socket.on('admin:approveDeposit', async ({ depositId, notes }) => {
    if (!adminSockets.has(socket.id)) {
      socket.emit('admin:error', 'Unauthorized');
      return;
    }
    
    try {
      const deposit = await Deposit.findById(depositId);
      if (!deposit) {
        socket.emit('admin:error', 'Deposit not found');
        return;
      }
      
      if (deposit.status !== 'pending') {
        socket.emit('admin:error', `Deposit is already ${deposit.status}`);
        return;
      }
      
      deposit.status = 'approved';
      deposit.adminNotes = notes || '';
      deposit.processedBy = socket.id;
      deposit.processedAt = new Date();
      deposit.updatedAt = new Date();
      await deposit.save();
      
      const user = await User.findOne({ userId: deposit.userId });
      if (user) {
        const oldBalance = user.balance;
        user.balance += deposit.amount;
        user.totalDeposited += deposit.amount;
        user.depositCount += 1;
        user.lastDeposit = new Date();
        
        if (!user.telebirrPhone && deposit.phoneNumber) {
          user.telebirrPhone = deposit.phoneNumber;
        }
        
        await user.save();
        
        const transaction = new Transaction({
          type: 'DEPOSIT_APPROVED',
          userId: user.userId,
          userName: user.userName,
          amount: deposit.amount,
          description: `Deposit approved via Telebirr (Transaction: ${deposit.transactionId})`
        });
        await transaction.save();
        
        for (const [sId, uId] of socketToUser.entries()) {
          if (uId === user.userId) {
            const playerSocket = io.sockets.sockets.get(sId);
            if (playerSocket) {
              playerSocket.emit('balanceUpdate', user.balance);
              playerSocket.emit('depositApproved', {
                amount: deposit.amount,
                newBalance: user.balance,
                depositId: deposit._id
              });
            }
          }
        }
        
        socket.emit('admin:success', `Approved deposit of ${deposit.amount} ETB for ${user.userName}`);
        console.log(`✅ Admin approved deposit ${depositId} for ${user.userName}: ${deposit.amount} ETB`);
        
        logActivity('ADMIN_APPROVE_DEPOSIT', { 
          adminSocket: socket.id, 
          userId: user.userId, 
          userName: user.userName,
          amount: deposit.amount,
          depositId: depositId
        }, socket.id);
      } else {
        socket.emit('admin:error', 'User not found');
      }
      
      updateAdminPanel();
      
    } catch (error) {
      console.error('Error approving deposit:', error);
      socket.emit('admin:error', 'Failed to approve deposit');
    }
  });
  
  socket.on('admin:rejectDeposit', async ({ depositId, notes }) => {
    if (!adminSockets.has(socket.id)) {
      socket.emit('admin:error', 'Unauthorized');
      return;
    }
    
    try {
      const deposit = await Deposit.findById(depositId);
      if (!deposit) {
        socket.emit('admin:error', 'Deposit not found');
        return;
      }
      
      if (deposit.status !== 'pending') {
        socket.emit('admin:error', `Deposit is already ${deposit.status}`);
        return;
      }
      
      deposit.status = 'rejected';
      deposit.adminNotes = notes || 'Deposit rejected by admin';
      deposit.processedBy = socket.id;
      deposit.processedAt = new Date();
      deposit.updatedAt = new Date();
      await deposit.save();
      
      const user = await User.findOne({ userId: deposit.userId });
      if (user) {
        for (const [sId, uId] of socketToUser.entries()) {
          if (uId === user.userId) {
            const playerSocket = io.sockets.sockets.get(sId);
            if (playerSocket) {
              playerSocket.emit('depositRejected', {
                amount: deposit.amount,
                reason: notes || 'Deposit rejected by admin',
                depositId: deposit._id
              });
            }
          }
        }
        
        socket.emit('admin:success', `Rejected deposit of ${deposit.amount} ETB for ${user.userName}`);
        console.log(`❌ Admin rejected deposit ${depositId} for ${user.userName}: ${deposit.amount} ETB`);
        
        logActivity('ADMIN_REJECT_DEPOSIT', { 
          adminSocket: socket.id, 
          userId: user.userId, 
          userName: user.userName,
          amount: deposit.amount,
          depositId: depositId,
          reason: notes
        }, socket.id);
      }
      
      updateAdminPanel();
      
    } catch (error) {
      console.error('Error rejecting deposit:', error);
      socket.emit('admin:error', 'Failed to reject deposit');
    }
  });
  
  socket.on('admin:approveWithdrawal', async ({ withdrawalId, notes }) => {
    if (!adminSockets.has(socket.id)) {
      socket.emit('admin:error', 'Unauthorized');
      return;
    }
    
    try {
      const withdrawal = await Withdrawal.findById(withdrawalId);
      if (!withdrawal) {
        socket.emit('admin:error', 'Withdrawal not found');
        return;
      }
      
      if (withdrawal.status !== 'pending') {
        socket.emit('admin:error', `Withdrawal is already ${withdrawal.status}`);
        return;
      }
      
      withdrawal.status = 'completed';
      withdrawal.adminNotes = notes || 'Withdrawal completed';
      withdrawal.processedBy = socket.id;
      withdrawal.processedAt = new Date();
      withdrawal.updatedAt = new Date();
      await withdrawal.save();
      
      const user = await User.findOne({ userId: withdrawal.userId });
      if (user) {
        user.totalWithdrawn += withdrawal.amount;
        user.withdrawalCount += 1;
        user.lastWithdrawal = new Date();
        await user.save();
        
        const transaction = new Transaction({
          type: 'WITHDRAWAL_COMPLETED',
          userId: user.userId,
          userName: user.userName,
          amount: -withdrawal.amount,
          description: `Withdrawal to ${withdrawal.phoneNumber} (Admin approved)`
        });
        await transaction.save();
        
        for (const [sId, uId] of socketToUser.entries()) {
          if (uId === user.userId) {
            const playerSocket = io.sockets.sockets.get(sId);
            if (playerSocket) {
              playerSocket.emit('withdrawalApproved', {
                amount: withdrawal.amount,
                phoneNumber: withdrawal.phoneNumber,
                withdrawalId: withdrawal._id
              });
            }
          }
        }
        
        socket.emit('admin:success', `Approved withdrawal of ${withdrawal.amount} ETB for ${user.userName}`);
        console.log(`✅ Admin approved withdrawal ${withdrawalId} for ${user.userName}: ${withdrawal.amount} ETB to ${withdrawal.phoneNumber}`);
        
        logActivity('ADMIN_APPROVE_WITHDRAWAL', { 
          adminSocket: socket.id, 
          userId: user.userId, 
          userName: user.userName,
          amount: withdrawal.amount,
          phoneNumber: withdrawal.phoneNumber,
          withdrawalId: withdrawalId
        }, socket.id);
      }
      
      updateAdminPanel();
      
    } catch (error) {
      console.error('Error approving withdrawal:', error);
      socket.emit('admin:error', 'Failed to approve withdrawal');
    }
  });
  
  socket.on('admin:rejectWithdrawal', async ({ withdrawalId, notes }) => {
    if (!adminSockets.has(socket.id)) {
      socket.emit('admin:error', 'Unauthorized');
      return;
    }
    
    try {
      const withdrawal = await Withdrawal.findById(withdrawalId);
      if (!withdrawal) {
        socket.emit('admin:error', 'Withdrawal not found');
        return;
      }
      
      if (withdrawal.status !== 'pending') {
        socket.emit('admin:error', `Withdrawal is already ${withdrawal.status}`);
        return;
      }
      
      withdrawal.status = 'rejected';
      withdrawal.adminNotes = notes || 'Withdrawal rejected';
      withdrawal.processedBy = socket.id;
      withdrawal.processedAt = new Date();
      withdrawal.updatedAt = new Date();
      await withdrawal.save();
      
      const user = await User.findOne({ userId: withdrawal.userId });
      if (user) {
        user.balance += withdrawal.amount;
        await user.save();
        
        const transaction = new Transaction({
          type: 'WITHDRAWAL_REJECTED_REFUND',
          userId: user.userId,
          userName: user.userName,
          amount: withdrawal.amount,
          description: `Withdrawal rejected - funds returned`
        });
        await transaction.save();
        
        for (const [sId, uId] of socketToUser.entries()) {
          if (uId === user.userId) {
            const playerSocket = io.sockets.sockets.get(sId);
            if (playerSocket) {
              playerSocket.emit('balanceUpdate', user.balance);
              playerSocket.emit('withdrawalRejected', {
                amount: withdrawal.amount,
                reason: notes || 'Withdrawal rejected by admin',
                withdrawalId: withdrawal._id
              });
            }
          }
        }
        
        socket.emit('admin:success', `Rejected withdrawal of ${withdrawal.amount} ETB for ${user.userName}`);
        console.log(`❌ Admin rejected withdrawal ${withdrawalId} for ${user.userName}: ${withdrawal.amount} ETB`);
        
        logActivity('ADMIN_REJECT_WITHDRAWAL', { 
          adminSocket: socket.id, 
          userId: user.userId, 
          userName: user.userName,
          amount: withdrawal.amount,
          withdrawalId: withdrawalId,
          reason: notes
        }, socket.id);
      }
      
      updateAdminPanel();
      
    } catch (error) {
      console.error('Error rejecting withdrawal:', error);
      socket.emit('admin:error', 'Failed to reject withdrawal');
    }
  });
  
  socket.on('admin:updatePaymentInfo', async ({ phoneNumber, notes, minDeposit, maxDeposit, minWithdrawal, maxWithdrawal }) => {
    if (!adminSockets.has(socket.id)) {
      socket.emit('admin:error', 'Unauthorized');
      return;
    }
    
    try {
      let paymentInfo = await AdminPaymentInfo.findOne({ isActive: true });
      
      if (!paymentInfo) {
        paymentInfo = new AdminPaymentInfo({
          phoneNumber: phoneNumber || CONFIG.ADMIN_PHONE_NUMBER,
          notes: notes || '',
          minDeposit: minDeposit || CONFIG.MIN_DEPOSIT,
          maxDeposit: maxDeposit || CONFIG.MAX_DEPOSIT,
          minWithdrawal: minWithdrawal || CONFIG.MIN_WITHDRAWAL,
          maxWithdrawal: maxWithdrawal || CONFIG.MAX_WITHDRAWAL
        });
      } else {
        paymentInfo.phoneNumber = phoneNumber || paymentInfo.phoneNumber;
        paymentInfo.notes = notes || paymentInfo.notes;
        paymentInfo.minDeposit = minDeposit || paymentInfo.minDeposit;
        paymentInfo.maxDeposit = maxDeposit || paymentInfo.maxDeposit;
        paymentInfo.minWithdrawal = minWithdrawal || paymentInfo.minWithdrawal;
        paymentInfo.maxWithdrawal = maxWithdrawal || paymentInfo.maxWithdrawal;
        paymentInfo.updatedAt = new Date();
      }
      
      await paymentInfo.save();
      
      socket.emit('admin:success', 'Payment info updated successfully');
      console.log(`✅ Admin updated payment info: ${phoneNumber}`);
      
      logActivity('ADMIN_UPDATE_PAYMENT_INFO', { 
        adminSocket: socket.id,
        phoneNumber: phoneNumber
      }, socket.id);
      
    } catch (error) {
      console.error('Error updating payment info:', error);
      socket.emit('admin:error', 'Failed to update payment info');
    }
  });
  
  // ========== PLAYER WALLET EVENTS ==========
  socket.on('wallet:getPaymentInfo', async (callback) => {
    try {
      const paymentInfo = await getPaymentInfo();
      if (!paymentInfo) {
        if (callback) callback({ error: 'Payment info not available' });
        return;
      }
      
      if (callback) callback({
        phoneNumber: paymentInfo.phoneNumber,
        provider: paymentInfo.provider,
        notes: paymentInfo.notes,
        minDeposit: paymentInfo.minDeposit,
        maxDeposit: paymentInfo.maxDeposit,
        minWithdrawal: paymentInfo.minWithdrawal,
        maxWithdrawal: paymentInfo.maxWithdrawal
      });
    } catch (error) {
      console.error('Error getting payment info:', error);
      if (callback) callback({ error: 'Failed to get payment info' });
    }
  });
  
  socket.on('wallet:submitDeposit', async (data, callback) => {
    try {
      const { userId, amount, phoneNumber, transactionId, receiptText } = data;
      
      if (!userId || !amount || !phoneNumber || !transactionId || !receiptText) {
        if (callback) callback({ success: false, message: 'All fields are required' });
        return;
      }
      
      const paymentInfo = await getPaymentInfo();
      if (!paymentInfo) {
        if (callback) callback({ success: false, message: 'Payment system not available' });
        return;
      }
      
      if (amount < paymentInfo.minDeposit) {
        if (callback) callback({ 
          success: false, 
          message: `Minimum deposit is ${paymentInfo.minDeposit} ETB` 
        });
        return;
      }
      
      if (amount > paymentInfo.maxDeposit) {
        if (callback) callback({ 
          success: false, 
          message: `Maximum deposit is ${paymentInfo.maxDeposit} ETB` 
        });
        return;
      }
      
      const user = await User.findOne({ userId: userId });
      if (!user) {
        if (callback) callback({ success: false, message: 'User not found' });
        return;
      }
      
      const existingDeposit = await Deposit.findOne({ 
        transactionId: transactionId,
        status: { $ne: 'rejected' }
      });
      
      if (existingDeposit) {
        if (callback) callback({ success: false, message: 'Transaction ID already exists' });
        return;
      }
      
      const deposit = new Deposit({
        userId: userId,
        userName: user.userName,
        amount: amount,
        phoneNumber: phoneNumber,
        transactionId: transactionId,
        receiptText: receiptText,
        status: 'pending'
      });
      
      await deposit.save();
      
      if (!user.telebirrPhone) {
        user.telebirrPhone = phoneNumber;
        await user.save();
      }
      
      adminSockets.forEach(socketId => {
        const adminSocket = io.sockets.sockets.get(socketId);
        if (adminSocket) {
          adminSocket.emit('admin:newDeposit', {
            depositId: deposit._id,
            userId: userId,
            userName: user.userName,
            amount: amount,
            phoneNumber: phoneNumber,
            transactionId: transactionId,
            receiptText: receiptText.substring(0, 100) + '...',
            createdAt: deposit.createdAt
          });
        }
      });
      
      if (callback) {
        callback({ 
          success: true, 
          message: 'Deposit request submitted successfully',
          depositId: deposit._id
        });
      }
      
      console.log(`💰 Deposit request submitted by ${user.userName}: ${amount} ETB (Transaction: ${transactionId})`);
      
      logActivity('DEPOSIT_REQUEST', { 
        userId, 
        userName: user.userName, 
        amount, 
        phoneNumber,
        transactionId 
      });
      
      updateAdminPanel();
      
    } catch (error) {
      console.error('Deposit request error:', error);
      if (callback) {
        callback({ 
          success: false, 
          message: 'Server error: ' + error.message 
        });
      }
    }
  });
  
  socket.on('wallet:submitWithdrawal', async (data, callback) => {
    try {
      const { userId, amount, phoneNumber } = data;
      
      if (!userId || !amount || !phoneNumber) {
        if (callback) callback({ success: false, message: 'All fields are required' });
        return;
      }
      
      const paymentInfo = await getPaymentInfo();
      if (!paymentInfo) {
        if (callback) callback({ success: false, message: 'Payment system not available' });
        return;
      }
      
      if (amount < paymentInfo.minWithdrawal) {
        if (callback) callback({ 
          success: false, 
          message: `Minimum withdrawal is ${paymentInfo.minWithdrawal} ETB` 
        });
        return;
      }
      
      if (amount > paymentInfo.maxWithdrawal) {
        if (callback) callback({ 
          success: false, 
          message: `Maximum withdrawal is ${paymentInfo.maxWithdrawal} ETB` 
        });
        return;
      }
      
      const user = await User.findOne({ userId: userId });
      if (!user) {
        if (callback) callback({ success: false, message: 'User not found' });
        return;
      }
      
      if (user.balance < amount) {
        if (callback) callback({ success: false, message: 'Insufficient balance' });
        return;
      }
      
      const pendingWithdrawal = await Withdrawal.findOne({ 
        userId: userId,
        status: 'pending'
      });
      
      if (pendingWithdrawal) {
        if (callback) callback({ 
          success: false, 
          message: 'You already have a pending withdrawal request' 
        });
        return;
      }
      
      const withdrawal = new Withdrawal({
        userId: userId,
        userName: user.userName,
        amount: amount,
        phoneNumber: phoneNumber,
        status: 'pending'
      });
      
      await withdrawal.save();
      
      const oldBalance = user.balance;
      user.balance -= amount;
      await user.save();
      
      const transaction = new Transaction({
        type: 'WITHDRAWAL_PENDING',
        userId: userId,
        userName: user.userName,
        amount: -amount,
        description: `Withdrawal request of ${amount} ETB to ${phoneNumber}`
      });
      await transaction.save();
      
      adminSockets.forEach(socketId => {
        const adminSocket = io.sockets.sockets.get(socketId);
        if (adminSocket) {
          adminSocket.emit('admin:newWithdrawal', {
            withdrawalId: withdrawal._id,
            userId: userId,
            userName: user.userName,
            amount: amount,
            phoneNumber: phoneNumber,
            userBalance: user.balance,
            oldBalance: oldBalance,
            createdAt: withdrawal.createdAt
          });
        }
      });
      
      if (callback) {
        callback({ 
          success: true, 
          message: 'Withdrawal request submitted successfully',
          withdrawalId: withdrawal._id,
          newBalance: user.balance
        });
      }
      
      socket.emit('balanceUpdate', user.balance);
      
      console.log(`💸 Withdrawal request submitted by ${user.userName}: ${amount} ETB to ${phoneNumber}`);
      
      logActivity('WITHDRAWAL_REQUEST', { 
        userId, 
        userName: user.userName, 
        amount, 
        phoneNumber,
        oldBalance: oldBalance,
        newBalance: user.balance
      });
      
      updateAdminPanel();
      
    } catch (error) {
      console.error('Withdrawal request error:', error);
      if (callback) {
        callback({ 
          success: false, 
          message: 'Server error: ' + error.message 
        });
      }
    }
  });
  
  socket.on('wallet:getTransactionHistory', async (data, callback) => {
    try {
      const { userId, type, limit = 20, skip = 0 } = data;
      
      if (!userId) {
        if (callback) callback({ success: false, message: 'User ID required' });
        return;
      }
      
      let deposits = [];
      let withdrawals = [];
      let gameTransactions = [];
      
      const depositQuery = { userId: userId };
      if (type === 'deposits' || type === 'all') {
        deposits = await Deposit.find(depositQuery)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .lean();
      }
      
      const withdrawalQuery = { userId: userId };
      if (type === 'withdrawals' || type === 'all') {
        withdrawals = await Withdrawal.find(withdrawalQuery)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .lean();
      }
      
      const transactionQuery = { userId: userId };
      if (type === 'games' || type === 'all') {
        gameTransactions = await Transaction.find(transactionQuery)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .lean();
      }
      
      const user = await User.findOne({ userId: userId });
      
      if (callback) {
        callback({
          success: true,
          deposits: deposits,
          withdrawals: withdrawals,
          gameTransactions: gameTransactions,
          balance: user ? user.balance : 0,
          totalDeposited: user ? user.totalDeposited : 0,
          totalWithdrawn: user ? user.totalWithdrawn : 0,
          depositCount: user ? user.depositCount : 0,
          withdrawalCount: user ? user.withdrawalCount : 0
        });
      }
      
    } catch (error) {
      console.error('Error getting transaction history:', error);
      if (callback) {
        callback({ success: false, message: 'Failed to get transaction history' });
      }
    }
  });
  
  socket.on('wallet:getBalance', async (userId, callback) => {
    try {
      const user = await User.findOne({ userId: userId });
      if (!user) {
        if (callback) callback({ success: false, message: 'User not found' });
        return;
      }
      
      if (callback) {
        callback({
          success: true,
          balance: user.balance,
          totalDeposited: user.totalDeposited || 0,
          totalWithdrawn: user.totalWithdrawn || 0,
          telebirrPhone: user.telebirrPhone || ''
        });
      }
    } catch (error) {
      console.error('Error getting balance:', error);
      if (callback) callback({ success: false, message: 'Failed to get balance' });
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
          referralCode: user.referralCode,
          telebirrPhone: user.telebirrPhone || '',
          totalDeposited: user.totalDeposited || 0,
          totalWithdrawn: user.totalWithdrawn || 0
        });
        
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
    const userId = socketToUser.get(socket.id);
    if (userId) {
      const user = await User.findOne({ userId: userId });
      if (user) {
        socket.emit('balanceUpdate', user.balance);
        socket.emit('balanceRefreshed', user.balance);
      }
    }
  });
  
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
      
      if (!roomSubscriptions.has(data.room)) {
        roomSubscriptions.set(data.room, new Set());
      }
      roomSubscriptions.get(data.room).add(socket.id);
      
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
      
      let roomData = await Room.findOne({ 
        stake: room, 
        status: { $in: ['waiting', 'starting', 'playing'] } 
      });
      
      if (!roomData) {
        roomData = new Room({
          stake: room,
          players: [],
          takenBoxes: [],
          status: 'waiting',
          lastBoxUpdate: new Date()
        });
        await roomData.save();
      }
      
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
      
      console.log(`🚀 joinRoom - Room ${room}:`);
      console.log(`   Players in room: ${roomData.players.length}`);
      console.log(`   Online players: ${onlinePlayers.length}`);
      console.log(`   Room status: ${roomData.status}`);
      
      broadcastTakenBoxes(room, roomData.takenBoxes, box, user.userName);
      
      await roomData.save();
      
      socket.emit('joinedRoom');
      socket.emit('balanceUpdate', user.balance);
      
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
      
      if (roomData.status === 'starting' && roomData.countdownStartTime) {
        const elapsed = Date.now() - roomData.countdownStartTime;
        const secondsRemaining = Math.max(0, CONFIG.COUNTDOWN_TIMER - Math.floor(elapsed / 1000));
        
        socket.emit('gameCountdown', {
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
      
      if (processingClaims.has(roomStake)) {
        console.log(`🚨 DOUBLE CLAIM PREVENTED: Room ${roomStake} already has a claim being processed`);
        socket.emit('error', 'A bingo claim is already being processed for this room');
        if (callback) callback({ 
          success: false, 
          message: 'A bingo claim is already being processed. Please wait.' 
        });
        return;
      }
      
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
      
      const markedNumbers = marked.map(item => {
        if (item === 'FREE') return 'FREE';
        return Number(item);
      }).filter(item => !isNaN(item) || item === 'FREE');
      
      const bingoCheck = checkBingo(markedNumbers, grid);
      if (!bingoCheck.isBingo) {
        processingClaims.delete(roomStake);
        console.log('❌ Invalid bingo claim - no winning pattern found');
        socket.emit('error', 'Invalid bingo claim');
        if (callback) callback({ success: false, message: 'Invalid bingo claim - no winning pattern' });
        return;
      }
      
      const isFourCornersWin = bingoCheck.isFourCorners;
      
      const commissionPerPlayer = CONFIG.HOUSE_COMMISSION[room] || 0;
      const contributionPerPlayer = room - commissionPerPlayer;
      const totalPlayers = roomData.players.length;
      
      const basePrize = contributionPerPlayer * totalPlayers;
      
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
        description: `Bingo win in ${room} ETB room with ${totalPlayers} players${isFourCornersWin ? ' (Four Corners Bonus)' : ''}`
      });
      await transaction.save();
      
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
      
      const playersInRoom = [...roomData.players];
      
      cleanupRoomTimer(room);
      
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
      
      processingClaims.delete(roomStake);
      console.log(`🔓 Released processing lock for room ${roomStake}`);
      
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
      
      if (callback) {
        callback({ 
          success: true, 
          message: 'BINGO claim received and being processed',
          isFourCornersWin: isFourCornersWin
        });
      }
      
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
                s.emit('gameOver', gameOverData);
                s.emit('balanceUpdate', user.balance);
              } else {
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
        
        updateAdminPanel();
      } catch (error) {
        console.error('Error updating player activity:', error);
      }
    }
  });
  
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
        user.currentRoom = null;
        user.box = null;
        await user.save();
        socket.emit('leftRoom', { message: 'Left room (room not found)' });
        return;
      }
      
      if (room.status === 'playing') {
        console.log(`❌ Player ${user.userName} tried to leave during active game in room ${roomStake}`);
        socket.emit('error', 'Cannot leave room during active game! Wait for game to end.');
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
      
      const onlinePlayers = await getOnlinePlayersInRoom(roomStake);
      
      await room.save();
      
      user.currentRoom = null;
      user.box = null;
      
      if (room.status !== 'playing') {
        const oldBalance = user.balance;
        user.balance += roomStake;
        
        console.log(`💰 Refunded ${roomStake} ETB to ${user.userName}, new balance: ${user.balance}`);
        
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
      
      broadcastTakenBoxes(roomStake, room.takenBoxes);
      
      socket.emit('leftRoom', { 
        message: 'Left room successfully',
        refunded: room.status !== 'playing'
      });
      
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
        const user = await User.findOne({ userId: userId });
        if (user && user.currentRoom) {
          const roomStake = user.currentRoom;
          const room = await Room.findOne({ stake: roomStake });
          
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
              
              broadcastTakenBoxes(roomStake, room.takenBoxes);
              
              console.log(`👤 User ${user.userName} removed from room ${roomStake} due to disconnect`);
            } else {
              console.log(`⚠️ User ${user.userName} disconnected during gameplay in room ${roomStake}, keeping in game`);
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

// ========== PERIODIC TASKS ==========
setInterval(() => {
  broadcastRoomStatus();
}, CONFIG.ROOM_STATUS_UPDATE_INTERVAL);

setInterval(() => {
  updateAdminPanel();
}, 2000);

setInterval(cleanupLongRunningGames, 30000);

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

// ========== CLEANUP STUCK COUNTDOWNS ==========
async function cleanupStuckCountdowns() {
  try {
    const now = new Date();
    const rooms = await Room.find({ status: 'starting' });
    
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
          
          const socketsToSend = new Set();
          
          room.players.forEach(userId => {
            for (const [socketId, uId] of socketToUser.entries()) {
              if (uId === userId) {
                if (io.sockets.sockets.get(socketId)?.connected) {
                  socketsToSend.add(socketId);
                }
              }
            }
          });
          
          const subscribedSockets = roomSubscriptions.get(room.stake) || new Set();
          subscribedSockets.forEach(socketId => {
            if (io.sockets.sockets.get(socketId)?.connected) {
              socketsToSend.add(socketId);
            }
          });
          
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
      
      if (room.takenBoxes.length > 0 || room.players.length > 0) {
        console.log(`⚠️ Room ${room.stake} still has ${room.takenBoxes.length} taken boxes and ${room.players.length} players. Clearing...`);
        room.players = [];
        room.takenBoxes = [];
        room.status = 'waiting';
        room.lastBoxUpdate = new Date();
        await room.save();
        
        broadcastTakenBoxes(room.stake, []);
        io.emit('boxesCleared', { room: room.stake, reason: 'stale_room_cleanup' });
      }
      
      const oneDayAgo = new Date(Date.now() - 86400000);
      if (room.endTime && room.endTime < oneDayAgo) {
        await Room.deleteOne({ _id: room._id });
        console.log(`🗑️ Deleted stale room from database: ${room.stake} ETB`);
      }
    }
    
    const emptyPlayingRooms = await Room.find({
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
      
      broadcastTakenBoxes(room.stake, []);
      io.emit('boxesCleared', { room: room.stake, reason: 'empty_room_cleanup' });
    }
    
  } catch (error) {
    console.error('Error in cleanupStaleRooms:', error);
  }
}

setInterval(cleanupStaleRooms, 300000);

// ========== HEALTH CHECK FUNCTION ==========
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
          <p style="color: #10b981; margin-top: 10px;">💰 Wallet System: ✅ DEPOSIT/WITHDRAWAL ENABLED</p>
          <p style="color: #10b981;">📱 Telebirr Payment: ✅ ${CONFIG.ADMIN_PHONE_NUMBER}</p>
          <p style="color: #10b981;">🔒 Admin Approval Required for Deposits</p>
          <p style="color: #10b981; font-weight: bold; margin-top: 10px;">✅✅✅ Deposit/Withdrawal System Fully Integrated</p>
          <p style="color: #10b981;">✅ Admin panel shows pending transactions</p>
          <p style="color: #10b981;">✅ Real-time notifications for admin</p>
          <p style="color: #10b981;">✅ Players can check transaction history</p>
        </div>
        
        <div style="margin-top: 40px;">
          <h3>Access Points:</h3>
          <div>
            <a href="/admin" class="btn btn-admin" target="_blank">🔒 Admin Panel</a>
            <a href="/game.html" class="btn btn-game" target="_blank">🎮 Game Client</a>
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
            Version: 3.0.0 (WITH DEPOSIT/WITHDRAWAL) | Database: MongoDB Atlas<br>
            Socket.IO: ✅ Connected Sockets: ${connectedSockets.size}<br>
            SocketToUser: ${socketToUser.size} | Admin Sockets: ${adminSockets.size}<br>
            Processing Claims: ${processingClaims.size} active<br>
            Telegram Integration: ✅ Ready<br>
            Game Timer: ${CONFIG.GAME_TIMER}s between balls<br>
            Game Timeout: ${CONFIG.GAME_TIMEOUT_MINUTES} minutes auto-clear<br>
            Bot Username: @ethio_games1_bot<br>
            Real-time Box Updates: ✅ ACTIVE<br>
            Wallet System: ✅ Telebirr Deposit/Withdrawal<br>
            Admin Phone: ${CONFIG.ADMIN_PHONE_NUMBER}<br>
            Min Deposit: ${CONFIG.MIN_DEPOSIT} ETB | Max Deposit: ${CONFIG.MAX_DEPOSIT} ETB<br>
            Min Withdrawal: ${CONFIG.MIN_WITHDRAWAL} ETB | Max Withdrawal: ${CONFIG.MAX_WITHDRAWAL} ETB<br>
            Admin Approval: Required for all transactions<br>
            Transaction History: Available for all players<br>
            Real-time Admin Notifications: ✅ Active
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

// Add specific route for /game to serve game.html
app.get('/game', (req, res) => {
  res.sendFile(path.join(__dirname, 'game.html'));
});

// ========== TELEGRAM ROUTES ==========
app.get('/telegram', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Bingo Elite - Telegram Mini App</title>
      <meta property="og:title" content="Bingo Elite">
      <meta property="og:description" content="Play real-time multiplayer Bingo with Four Corners Bonus!">
      <meta property="og:image" content="https://bingo-telegram-game.onrender.com/bingo-preview.jpg">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        body { font-family: Arial, sans-serif; padding: 40px; text-align: center; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; }
        .container { max-width: 600px; margin: 0 auto; background: rgba(255,255,255,0.1); padding: 40px; border-radius: 20px; backdrop-filter: blur(10px); }
        .btn { display: inline-block; padding: 15px 30px; background: #3b82f6; color: white; text-decoration: none; border-radius: 10px; margin: 20px; font-weight: bold; font-size: 1.2rem; }
        .btn:hover { background: #2563eb; transform: translateY(-2px); }
        .instructions { background: rgba(0,0,0,0.2); padding: 20px; border-radius: 10px; margin: 30px 0; text-align: left; }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>🎮 Bingo Elite</h1>
        <p style="font-size: 1.2rem;">Real-time multiplayer Bingo game with Four Corners Bonus!</p>
        
        <div class="instructions">
          <h3>🎯 How to Play:</h3>
          <p>1. Select a room (10, 20, 50, or 100 ETB)</p>
          <p>2. Choose your ticket number (1-100)</p>
          <p>3. Mark numbers as they're called</p>
          <p>4. Win with BINGO pattern!</p>
          <p>💰 <strong>Four Corners Bonus:</strong> Win with B1, B5, O1, O5 for +50 ETB!</p>
        </div>
        
        <p style="margin: 30px 0;">
          <a href="/game.html" class="btn">🎮 LAUNCH GAME</a>
        </p>
        
        <p style="color: rgba(255,255,255,0.8);">
          Open in Telegram for the best experience:<br>
          <small>@ethio_games1_bot</small>
        </p>
      </div>
    </body>
    </html>
  `);
});

app.get('/socket-test', (req, res) => {
  res.sendFile(path.join(__dirname, 'socket-test.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    connectedPlayers: connectedSockets.size,
    socketToUser: socketToUser.size,
    adminSockets: adminSockets.size,
    processingClaims: processingClaims.size,
    memoryUsage: process.memoryUsage(),
    nodeVersion: process.version
  });
});

app.get('/api/user/:userId', async (req, res) => {
  try {
    const user = await User.findOne({ userId: req.params.userId });
    if (user) {
      res.json({
        success: true,
        user: {
          userId: user.userId,
          userName: user.userName,
          balance: user.balance,
          totalWagered: user.totalWagered || 0,
          totalWins: user.totalWins || 0,
          totalBingos: user.totalBingos || 0,
          currentRoom: user.currentRoom,
          box: user.box,
          isOnline: user.isOnline,
          lastSeen: user.lastSeen,
          joinedAt: user.joinedAt,
          telebirrPhone: user.telebirrPhone || '',
          totalDeposited: user.totalDeposited || 0,
          totalWithdrawn: user.totalWithdrawn || 0
        }
      });
    } else {
      res.status(404).json({ success: false, message: 'User not found' });
    }
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ========== WALLET API ENDPOINTS ==========
app.get('/api/payment-info', async (req, res) => {
  try {
    const paymentInfo = await getPaymentInfo();
    if (!paymentInfo) {
      return res.status(404).json({ error: 'Payment info not configured' });
    }
    
    res.json({
      phoneNumber: paymentInfo.phoneNumber,
      provider: paymentInfo.provider,
      notes: paymentInfo.notes,
      minDeposit: paymentInfo.minDeposit,
      maxDeposit: paymentInfo.maxDeposit,
      minWithdrawal: paymentInfo.minWithdrawal,
      maxWithdrawal: paymentInfo.maxWithdrawal
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/deposit/request', async (req, res) => {
  try {
    const { userId, amount, phoneNumber, transactionId, receiptText } = req.body;
    
    if (!userId || !amount || !phoneNumber || !transactionId || !receiptText) {
      return res.status(400).json({ error: 'All fields are required' });
    }
    
    const paymentInfo = await getPaymentInfo();
    if (!paymentInfo) {
      return res.status(400).json({ error: 'Payment system not available' });
    }
    
    if (amount < paymentInfo.minDeposit) {
      return res.status(400).json({ 
        error: `Minimum deposit is ${paymentInfo.minDeposit} ETB` 
      });
    }
    
    if (amount > paymentInfo.maxDeposit) {
      return res.status(400).json({ 
        error: `Maximum deposit is ${paymentInfo.maxDeposit} ETB` 
      });
    }
    
    const user = await User.findOne({ userId: userId });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const existingDeposit = await Deposit.findOne({ 
      transactionId: transactionId,
      status: { $ne: 'rejected' }
    });
    
    if (existingDeposit) {
      return res.status(400).json({ error: 'Transaction ID already exists' });
    }
    
    const deposit = new Deposit({
      userId: userId,
      userName: user.userName,
      amount: amount,
      phoneNumber: phoneNumber,
      transactionId: transactionId,
      receiptText: receiptText,
      status: 'pending'
    });
    
    await deposit.save();
    
    if (!user.telebirrPhone) {
      user.telebirrPhone = phoneNumber;
      await user.save();
    }
    
    adminSockets.forEach(socketId => {
      const socket = io.sockets.sockets.get(socketId);
      if (socket) {
        socket.emit('admin:newDeposit', {
          depositId: deposit._id,
          userId: userId,
          userName: user.userName,
          amount: amount,
          phoneNumber: phoneNumber,
          transactionId: transactionId,
          receiptText: receiptText.substring(0, 100) + '...',
          createdAt: deposit.createdAt
        });
      }
    });
    
    res.json({ 
      success: true, 
      message: 'Deposit request submitted successfully',
      depositId: deposit._id
    });
    
    console.log(`💰 API Deposit request: ${user.userName}: ${amount} ETB`);
    
    logActivity('API_DEPOSIT_REQUEST', { 
      userId, 
      userName: user.userName, 
      amount, 
      phoneNumber,
      transactionId 
    });
    
    updateAdminPanel();
    
  } catch (error) {
    console.error('API Deposit request error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/withdraw/request', async (req, res) => {
  try {
    const { userId, amount, phoneNumber } = req.body;
    
    if (!userId || !amount || !phoneNumber) {
      return res.status(400).json({ error: 'All fields are required' });
    }
    
    const paymentInfo = await getPaymentInfo();
    if (!paymentInfo) {
      return res.status(400).json({ error: 'Payment system not available' });
    }
    
    if (amount < paymentInfo.minWithdrawal) {
      return res.status(400).json({ 
        error: `Minimum withdrawal is ${paymentInfo.minWithdrawal} ETB` 
      });
    }
    
    if (amount > paymentInfo.maxWithdrawal) {
      return res.status(400).json({ 
        error: `Maximum withdrawal is ${paymentInfo.maxWithdrawal} ETB` 
      });
    }
    
    const user = await User.findOne({ userId: userId });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    if (user.balance < amount) {
      return res.status(400).json({ error: 'Insufficient balance' });
    }
    
    const pendingWithdrawal = await Withdrawal.findOne({ 
      userId: userId,
      status: 'pending'
    });
    
    if (pendingWithdrawal) {
      return res.status(400).json({ 
        error: 'You already have a pending withdrawal request' 
      });
    }
    
    const withdrawal = new Withdrawal({
      userId: userId,
      userName: user.userName,
      amount: amount,
      phoneNumber: phoneNumber,
      status: 'pending'
    });
    
    await withdrawal.save();
    
    const oldBalance = user.balance;
    user.balance -= amount;
    await user.save();
    
    const transaction = new Transaction({
      type: 'WITHDRAWAL_PENDING',
      userId: userId,
      userName: user.userName,
      amount: -amount,
      description: `Withdrawal request of ${amount} ETB to ${phoneNumber}`
    });
    await transaction.save();
    
    adminSockets.forEach(socketId => {
      const socket = io.sockets.sockets.get(socketId);
      if (socket) {
        socket.emit('admin:newWithdrawal', {
          withdrawalId: withdrawal._id,
          userId: userId,
          userName: user.userName,
          amount: amount,
          phoneNumber: phoneNumber,
          userBalance: user.balance,
          oldBalance: oldBalance,
          createdAt: withdrawal.createdAt
        });
      }
    });
    
    res.json({ 
      success: true, 
      message: 'Withdrawal request submitted successfully',
      withdrawalId: withdrawal._id,
      newBalance: user.balance
    });
    
    console.log(`💸 API Withdrawal request: ${user.userName}: ${amount} ETB to ${phoneNumber}`);
    
    logActivity('API_WITHDRAWAL_REQUEST', { 
      userId, 
      userName: user.userName, 
      amount, 
      phoneNumber,
      oldBalance: oldBalance,
      newBalance: user.balance
    });
    
    updateAdminPanel();
    
  } catch (error) {
    console.error('API Withdrawal request error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/transactions/:userId', async (req, res) => {
  try {
    const userId = req.params.userId;
    const type = req.query.type || 'all';
    const limit = parseInt(req.query.limit) || 20;
    const skip = parseInt(req.query.skip) || 0;
    
    let deposits = [];
    let withdrawals = [];
    let gameTransactions = [];
    
    const depositQuery = { userId: userId };
    if (type === 'deposits' || type === 'all') {
      deposits = await Deposit.find(depositQuery)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean();
    }
    
    const withdrawalQuery = { userId: userId };
    if (type === 'withdrawals' || type === 'all') {
      withdrawals = await Withdrawal.find(withdrawalQuery)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean();
    }
    
    const transactionQuery = { userId: userId };
    if (type === 'games' || type === 'all') {
      gameTransactions = await Transaction.find(transactionQuery)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean();
    }
    
    const user = await User.findOne({ userId: userId });
    
    res.json({
      success: true,
      deposits: deposits,
      withdrawals: withdrawals,
      gameTransactions: gameTransactions,
      balance: user ? user.balance : 0,
      totalDeposited: user ? user.totalDeposited : 0,
      totalWithdrawn: user ? user.totalWithdrawn : 0,
      depositCount: user ? user.depositCount : 0,
      withdrawalCount: user ? user.withdrawalCount : 0
    });
    
  } catch (error) {
    console.error('Error getting transaction history:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/deposit/approve', async (req, res) => {
  try {
    const { depositId, adminPassword, notes } = req.body;
    
    if (adminPassword !== CONFIG.ADMIN_PASSWORD) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    const deposit = await Deposit.findById(depositId);
    if (!deposit) {
      return res.status(404).json({ error: 'Deposit not found' });
    }
    
    if (deposit.status !== 'pending') {
      return res.status(400).json({ error: `Deposit is already ${deposit.status}` });
    }
    
    deposit.status = 'approved';
    deposit.adminNotes = notes || '';
    deposit.processedAt = new Date();
    deposit.updatedAt = new Date();
    await deposit.save();
    
    const user = await User.findOne({ userId: deposit.userId });
    if (user) {
      user.balance += deposit.amount;
      user.totalDeposited += deposit.amount;
      user.depositCount += 1;
      user.lastDeposit = new Date();
      
      if (!user.telebirrPhone && deposit.phoneNumber) {
        user.telebirrPhone = deposit.phoneNumber;
      }
      
      await user.save();
      
      const transaction = new Transaction({
        type: 'DEPOSIT_APPROVED',
        userId: user.userId,
        userName: user.userName,
        amount: deposit.amount,
        description: `Deposit approved via Telebirr (Transaction: ${deposit.transactionId})`
      });
      await transaction.save();
      
      for (const [sId, uId] of socketToUser.entries()) {
        if (uId === user.userId) {
          const playerSocket = io.sockets.sockets.get(sId);
          if (playerSocket) {
            playerSocket.emit('balanceUpdate', user.balance);
            playerSocket.emit('depositApproved', {
              amount: deposit.amount,
              newBalance: user.balance,
              depositId: deposit._id
            });
          }
        }
      }
      
      res.json({ 
        success: true, 
        message: `Approved deposit of ${deposit.amount} ETB for ${user.userName}`,
        newBalance: user.balance
      });
      
      console.log(`✅ API Approved deposit ${depositId} for ${user.userName}: ${deposit.amount} ETB`);
      
      logActivity('API_APPROVE_DEPOSIT', { 
        userId: user.userId, 
        userName: user.userName,
        amount: deposit.amount,
        depositId: depositId
      });
      
      updateAdminPanel();
      
    } else {
      res.status(404).json({ error: 'User not found' });
    }
    
  } catch (error) {
    console.error('Error approving deposit:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/real-time-status', (req, res) => {
  res.json({
    connectedSockets: connectedSockets.size,
    socketToUser: Array.from(socketToUser.entries()).map(([socketId, userId]) => ({ socketId, userId })),
    adminSockets: Array.from(adminSockets),
    roomTimers: Array.from(roomTimers.keys()),
    processingClaims: Array.from(processingClaims.entries()),
    activityLog: activityLog.slice(0, 10)
  });
});

app.get('/test-connections', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Socket.IO Connection Test</title>
      <script src="/socket.io/socket.io.js"></script>
      <style>
        body { font-family: monospace; padding: 20px; background: #1a1a1a; color: #00ff00; }
        .connected { color: #00ff00; }
        .disconnected { color: #ff0000; }
      </style>
    </head>
    <body>
      <h1>Socket.IO Connection Test</h1>
      <div id="status">Testing connection...</div>
      <div id="messages"></div>
      
      <script>
        const socket = io();
        const status = document.getElementById('status');
        const messages = document.getElementById('messages');
        
        socket.on('connect', () => {
          status.innerHTML = '<span class="connected">✅ CONNECTED</span>';
          log('Connected to server with ID: ' + socket.id);
          socket.emit('connectionTest', { test: true });
        });
        
        socket.on('connectionTest', (data) => {
          log('Server responded: ' + JSON.stringify(data));
        });
        
        socket.on('disconnect', () => {
          status.innerHTML = '<span class="disconnected">❌ DISCONNECTED</span>';
          log('Disconnected from server');
        });
        
        socket.on('connect_error', (error) => {
          status.innerHTML = '<span class="disconnected">❌ CONNECTION ERROR</span>';
          log('Connection error: ' + error.message);
        });
        
        function log(msg) {
          const div = document.createElement('div');
          div.textContent = '[' + new Date().toLocaleTimeString() + '] ' + msg;
          messages.appendChild(div);
        }
      </script>
    </body>
    </html>
  `);
});

app.get('/debug-connections', (req, res) => {
  res.json({
    connectedSockets: connectedSockets.size,
    socketToUserSize: socketToUser.size,
    adminSocketsSize: adminSockets.size,
    roomSubscriptions: Object.fromEntries(
      Array.from(roomSubscriptions.entries()).map(([room, sockets]) => [room, Array.from(sockets)])
    ),
    connectedUsers: getConnectedUsers(),
    timestamp: new Date().toISOString()
  });
});

app.get('/debug-users', async (req, res) => {
  try {
    const users = await User.find({}).sort({ balance: -1 }).limit(50);
    const onlineUsers = users.filter(user => user.isOnline);
    
    res.json({
      totalUsers: users.length,
      onlineUsers: onlineUsers.length,
      users: users.map(user => ({
        userId: user.userId,
        userName: user.userName,
        balance: user.balance,
        currentRoom: user.currentRoom,
        box: user.box,
        isOnline: user.isOnline,
        lastSeen: user.lastSeen,
        totalWagered: user.totalWagered,
        totalWins: user.totalWins
      }))
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/debug-room/:stake', async (req, res) => {
  try {
    const stake = parseInt(req.params.stake);
    const room = await Room.findOne({ stake: stake });
    
    if (!room) {
      return res.json({ 
        stake: stake, 
        exists: false,
        message: 'Room not found'
      });
    }
    
    const onlinePlayers = await getOnlinePlayersInRoom(stake);
    
    res.json({
      stake: room.stake,
      exists: true,
      players: room.players.length,
      onlinePlayers: onlinePlayers.length,
      takenBoxes: room.takenBoxes.length,
      status: room.status,
      startTime: room.startTime,
      endTime: room.endTime,
      calledNumbers: room.calledNumbers.length,
      currentBall: room.currentBall,
      ballsDrawn: room.ballsDrawn,
      countdownStartTime: room.countdownStartTime,
      countdownStartedWith: room.countdownStartedWith,
      playersList: room.players,
      onlinePlayersList: onlinePlayers,
      takenBoxesList: room.takenBoxes
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/force-start/:stake', async (req, res) => {
  try {
    const stake = parseInt(req.params.stake);
    const room = await Room.findOne({ stake: stake });
    
    if (!room) {
      return res.json({ success: false, message: 'Room not found' });
    }
    
    if (room.status === 'playing') {
      return res.json({ success: false, message: 'Room already playing' });
    }
    
    room.status = 'playing';
    room.startTime = new Date();
    await room.save();
    
    await startGameTimer(room);
    
    res.json({ 
      success: true, 
      message: `Room ${stake} force started`,
      players: room.players.length
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/debug-calculations/:stake/:players', (req, res) => {
  const stake = parseInt(req.params.stake);
  const players = parseInt(req.params.players);
  
  const commissionPerPlayer = CONFIG.HOUSE_COMMISSION[stake] || 0;
  const contributionPerPlayer = stake - commissionPerPlayer;
  const totalPrize = contributionPerPlayer * players;
  const houseFee = commissionPerPlayer * players;
  const totalPrizeWithBonus = totalPrize + CONFIG.FOUR_CORNERS_BONUS;
  
  res.json({
    stake: stake,
    players: players,
    commissionPerPlayer: commissionPerPlayer,
    contributionPerPlayer: contributionPerPlayer,
    totalPrize: totalPrize,
    houseFee: houseFee,
    totalPrizeWithBonus: totalPrizeWithBonus,
    fourCornersBonus: CONFIG.FOUR_CORNERS_BONUS
  });
});

app.get('/setup-telegram', (req, res) => {
  const webhookUrl = `https://${req.headers.host}/telegram-webhook`;
  const token = process.env.TELEGRAM_TOKEN || 'YOUR_BOT_TOKEN_HERE';
  
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Telegram Bot Setup</title>
      <style>
        body { font-family: Arial, sans-serif; padding: 40px; background: #0f172a; color: white; }
        .container { max-width: 800px; margin: 0 auto; }
        .code { background: #1e293b; padding: 20px; border-radius: 10px; font-family: monospace; margin: 20px 0; }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>🤖 Telegram Bot Setup</h1>
        
        <h3>1. Create a Telegram Bot via @BotFather</h3>
        <div class="code">
          /newbot<br>
          Name: Bingo Elite<br>
          Username: your_bot_username<br>
          Copy the token: ${token ? '✅ Token already set' : '❌ Token not set'}
        </div>
        
        <h3>2. Set Webhook URL</h3>
        <div class="code">
          curl -X POST https://api.telegram.org/bot${token}/setWebhook \<br>
          -H "Content-Type: application/json" \<br>
          -d '{"url": "${webhookUrl}", "drop_pending_updates": true}'
        </div>
        
        <h3>3. Create Mini App</h3>
        <div class="code">
          Open @BotFather → /mybots → Edit Bot → Edit Mini App<br>
          Mini App URL: https://${req.headers.host}/game.html<br>
          Public: Yes
        </div>
        
        <h3>4. Test Your Bot</h3>
        <p>Open Telegram and search for your bot, then click "Launch Game"</p>
        
        <h3>Current Status:</h3>
        <p>✅ Server: Running at ${req.headers.host}</p>
        <p>✅ Game URL: https://${req.headers.host}/game.html</p>
        <p>${token ? '✅ Bot Token: Configured' : '❌ Bot Token: Not configured'}</p>
        <p>✅ Webhook URL: ${webhookUrl}</p>
      </div>
    </body>
    </html>
  `);
});

// ========== START SERVER ==========
const PORT = process.env.PORT || 3000;
server.listen(PORT, async () => {
  console.log(`
╔══════════════════════════════════════════════════════╗
║             🤖 BINGO ELITE - TELEGRAM READY         ║
╠══════════════════════════════════════════════════════╣
║  URL:          https://bingo-telegram-game.onrender.com ║
║  Port:         ${PORT}                                ║
║  Game:         /game                                 ║
║  Admin:        /admin (password: admin1234)         ║
║  Telegram:     /telegram                             ║
║  Wallet:       ✅ DEPOSIT/WITHDRAWAL ENABLED        ║
║  Admin Phone:  ${CONFIG.ADMIN_PHONE_NUMBER}          ║
╠══════════════════════════════════════════════════════╣
║  🔑 Admin Password: ${process.env.ADMIN_PASSWORD || 'admin1234'} ║
║  🤖 Telegram Bot: @ethio_games1_bot                 ║
║  📡 WebSocket: ✅ Ready for Telegram connections    ║
║  💰 Wallet System: ✅ Telebirr Deposit/Withdrawal   ║
║  🎮 Four Corners Bonus: ${CONFIG.FOUR_CORNERS_BONUS} ETB       ║
║  📦 Real-time Box Tracking: ✅ ACTIVE               ║
║  🆕 NEW FEATURES:                                   ║
║  💰 Deposit/Withdrawal System: ✅ COMPLETE          ║
║  📱 Telebirr Integration: ✅ READY                  ║
║  👑 Admin Approval: ✅ REQUIRED                     ║
║  📊 Transaction History: ✅ AVAILABLE               ║
║  🔔 Real-time Admin Notifications: ✅ ACTIVE        ║
╚══════════════════════════════════════════════════════╝
✅ Server ready with DEPOSIT/WITHDRAWAL SYSTEM
  `);
  
  await initializePaymentInfo();
  
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
