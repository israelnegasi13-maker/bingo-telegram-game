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

// ========== NEW MODELS FOR DEPOSIT/WITHDRAWAL ==========
const depositRequestSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  userName: { type: String, required: true },
  amount: { type: Number, required: true },
  phoneNumber: { type: String, required: true }, // Admin's phone number
  receiptText: { type: String, required: true }, // Receipt text/code from Telebirr
  status: { 
    type: String, 
    enum: ['pending', 'approved', 'rejected', 'cancelled'],
    default: 'pending'
  },
  processedBy: { type: String, default: null }, // Admin who processed
  processedAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now },
  notes: { type: String, default: '' }
});

const withdrawalRequestSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  userName: { type: String, required: true },
  amount: { type: Number, required: true },
  phoneNumber: { type: String, required: true }, // Player's Telebirr number
  status: { 
    type: String, 
    enum: ['pending', 'paid', 'rejected', 'cancelled'],
    default: 'pending'
  },
  processedBy: { type: String, default: null },
  processedAt: { type: Date, default: null },
  transactionId: { type: String, default: '' }, // Telebirr transaction ID
  createdAt: { type: Date, default: Date.now },
  notes: { type: String, default: '' }
});

const settingsSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  value: { type: mongoose.Schema.Types.Mixed },
  description: { type: String },
  updatedAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);
const Room = mongoose.model('Room', roomSchema);
const Transaction = mongoose.model('Transaction', transactionSchema);
const Stats = mongoose.model('Stats', statsSchema);
const DepositRequest = mongoose.model('DepositRequest', depositRequestSchema);
const WithdrawalRequest = mongoose.model('WithdrawalRequest', withdrawalRequestSchema);
const Settings = mongoose.model('Settings', settingsSchema);

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
  
  // ========== NEW: DEPOSIT/WITHDRAWAL CONFIG ==========
  ADMIN_PHONE_NUMBER: process.env.ADMIN_PHONE || '+251912345678',
  MIN_DEPOSIT_AMOUNT: 10,
  MAX_DEPOSIT_AMOUNT: 10000,
  MIN_WITHDRAWAL_AMOUNT: 50,
  MAX_WITHDRAWAL_AMOUNT: 5000,
  WITHDRAWAL_FEE_PERCENT: 0,
  AUTO_APPROVE_DEPOSITS: false,
  DEPOSIT_TIMEOUT_MINUTES: 30
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

// ========== DEPOSIT/WITHDRAWAL HELPER FUNCTIONS ==========
async function approveDeposit(depositId, adminId = 'ADMIN', notes = '') {
  try {
    const deposit = await DepositRequest.findById(depositId);
    if (!deposit) return false;
    
    const user = await User.findOne({ userId: deposit.userId });
    if (!user) return false;
    
    // Add funds to user
    const oldBalance = user.balance;
    user.balance += deposit.amount;
    await user.save();
    
    // Update deposit status
    deposit.status = 'approved';
    deposit.processedBy = adminId;
    deposit.processedAt = new Date();
    deposit.notes = notes;
    await deposit.save();
    
    // Record transaction
    const transaction = new Transaction({
      type: 'DEPOSIT_APPROVED',
      userId: deposit.userId,
      userName: deposit.userName,
      amount: deposit.amount,
      admin: true,
      description: `Deposit approved - Receipt: ${deposit.receiptText.substring(0, 20)}...`
    });
    await transaction.save();
    
    // Notify user if online
    for (const [socketId, userId] of socketToUser.entries()) {
      if (userId === deposit.userId) {
        const socket = io.sockets.sockets.get(socketId);
        if (socket) {
          socket.emit('depositApproved', {
            amount: deposit.amount,
            newBalance: user.balance,
            depositId: deposit._id
          });
          socket.emit('balanceUpdate', user.balance);
        }
      }
    }
    
    // Notify admin panel
    adminSockets.forEach(socketId => {
      const socket = io.sockets.sockets.get(socketId);
      if (socket) {
        socket.emit('admin:depositApproved', {
          depositId: deposit._id,
          userId: deposit.userId,
          userName: deposit.userName,
          amount: deposit.amount,
          processedBy: adminId
        });
      }
    });
    
    logActivity('DEPOSIT_APPROVED', { 
      depositId: deposit._id,
      userId: deposit.userId,
      userName: deposit.userName,
      amount: deposit.amount,
      processedBy: adminId 
    });
    
    return true;
  } catch (error) {
    console.error('Error approving deposit:', error);
    return false;
  }
}

async function approveWithdrawal(withdrawalId, adminId = 'ADMIN', transactionId = '', notes = '') {
  try {
    const withdrawal = await WithdrawalRequest.findById(withdrawalId);
    if (!withdrawal) return false;
    
    // Update withdrawal status
    withdrawal.status = 'paid';
    withdrawal.processedBy = adminId;
    withdrawal.processedAt = new Date();
    withdrawal.transactionId = transactionId;
    withdrawal.notes = notes;
    await withdrawal.save();
    
    // Record transaction
    const transaction = new Transaction({
      type: 'WITHDRAWAL_PAID',
      userId: withdrawal.userId,
      userName: withdrawal.userName,
      amount: -withdrawal.amount,
      description: `Withdrawal paid to ${withdrawal.phoneNumber} - Transaction: ${transactionId}`
    });
    await transaction.save();
    
    // Notify user if online
    for (const [socketId, userId] of socketToUser.entries()) {
      if (userId === withdrawal.userId) {
        const socket = io.sockets.sockets.get(socketId);
        if (socket) {
          socket.emit('withdrawalApproved', {
            amount: withdrawal.amount,
            phoneNumber: withdrawal.phoneNumber,
            transactionId: transactionId,
            withdrawalId: withdrawal._id
          });
        }
      }
    }
    
    // Notify admin panel
    adminSockets.forEach(socketId => {
      const socket = io.sockets.sockets.get(socketId);
      if (socket) {
        socket.emit('admin:withdrawalApproved', {
          withdrawalId: withdrawal._id,
          userId: withdrawal.userId,
          userName: withdrawal.userName,
          amount: withdrawal.amount,
          phoneNumber: withdrawal.phoneNumber,
          transactionId: transactionId,
          processedBy: adminId
        });
      }
    });
    
    logActivity('WITHDRAWAL_PAID', { 
      withdrawalId: withdrawal._id,
      userId: withdrawal.userId,
      userName: withdrawal.userName,
      amount: withdrawal.amount,
      phoneNumber: withdrawal.phoneNumber,
      processedBy: adminId 
    });
    
    return true;
  } catch (error) {
    console.error('Error approving withdrawal:', error);
    return false;
  }
}

async function rejectWithdrawal(withdrawalId, adminId = 'ADMIN', reason = '') {
  try {
    const withdrawal = await WithdrawalRequest.findById(withdrawalId);
    if (!withdrawal) return false;
    
    // Return funds to user
    const user = await User.findOne({ userId: withdrawal.userId });
    if (user) {
      user.balance += withdrawal.amount;
      await user.save();
      
      // Record transaction for refund
      const transaction = new Transaction({
        type: 'WITHDRAWAL_REFUND',
        userId: withdrawal.userId,
        userName: withdrawal.userName,
        amount: withdrawal.amount,
        description: `Withdrawal rejected - ${reason}`
      });
      await transaction.save();
      
      // Notify user
      for (const [socketId, userId] of socketToUser.entries()) {
        if (userId === withdrawal.userId) {
          const socket = io.sockets.sockets.get(socketId);
          if (socket) {
            socket.emit('withdrawalRejected', {
              amount: withdrawal.amount,
              reason: reason,
              newBalance: user.balance
            });
            socket.emit('balanceUpdate', user.balance);
          }
        }
      }
    }
    
    // Update withdrawal status
    withdrawal.status = 'rejected';
    withdrawal.processedBy = adminId;
    withdrawal.processedAt = new Date();
    withdrawal.notes = reason;
    await withdrawal.save();
    
    logActivity('WITHDRAWAL_REJECTED', { 
      withdrawalId: withdrawal._id,
      userId: withdrawal.userId,
      userName: withdrawal.userName,
      amount: withdrawal.amount,
      reason: reason,
      processedBy: adminId 
    });
    
    return true;
  } catch (error) {
    console.error('Error rejecting withdrawal:', error);
    return false;
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
    
    // Get all users
    const users = await User.find({}).sort({ balance: -1 }).limit(100);
    
    // Get connected user IDs for real-time status
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
    
    // Get pending deposit/withdrawal counts
    const pendingDepositsCount = await DepositRequest.countDocuments({ status: 'pending' });
    const pendingWithdrawalsCount = await WithdrawalRequest.countDocuments({ status: 'pending' });
    
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
      pendingDeposits: pendingDepositsCount,
      pendingWithdrawals: pendingWithdrawalsCount,
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
  
  adminSockets.forEach(socketId => {
    const socket = io.sockets.sockets.get(socketId);
    if (socket) {
      socket.emit('admin:activity', activity);
    }
  });
}

// ========== GAME TIMER FUNCTIONS ==========
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
  
  // ========== DEPOSIT/WITHDRAWAL ADMIN EVENTS ==========
  socket.on('admin:getDeposits', async (data) => {
    if (!adminSockets.has(socket.id)) {
      socket.emit('admin:error', 'Unauthorized');
      return;
    }
    
    try {
      const { status, page = 1, limit = 20 } = data || {};
      
      let query = {};
      if (status && status !== 'all') {
        query.status = status;
      }
      
      const deposits = await DepositRequest.find(query)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(parseInt(limit));
      
      const total = await DepositRequest.countDocuments(query);
      
      socket.emit('admin:deposits', {
        deposits,
        total,
        page: parseInt(page),
        totalPages: Math.ceil(total / limit)
      });
    } catch (error) {
      socket.emit('admin:error', 'Error fetching deposits: ' + error.message);
    }
  });
  
  socket.on('admin:getWithdrawals', async (data) => {
    if (!adminSockets.has(socket.id)) {
      socket.emit('admin:error', 'Unauthorized');
      return;
    }
    
    try {
      const { status, page = 1, limit = 20 } = data || {};
      
      let query = {};
      if (status && status !== 'all') {
        query.status = status;
      }
      
      const withdrawals = await WithdrawalRequest.find(query)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(parseInt(limit));
      
      const total = await WithdrawalRequest.countDocuments(query);
      
      socket.emit('admin:withdrawals', {
        withdrawals,
        total,
        page: parseInt(page),
        totalPages: Math.ceil(total / limit)
      });
    } catch (error) {
      socket.emit('admin:error', 'Error fetching withdrawals: ' + error.message);
    }
  });
  
  socket.on('admin:approveDeposit', async (data) => {
    if (!adminSockets.has(socket.id)) {
      socket.emit('admin:error', 'Unauthorized');
      return;
    }
    
    try {
      const { depositId, adminId, notes } = data;
      
      const success = await approveDeposit(depositId, adminId || 'ADMIN', notes || '');
      
      if (success) {
        socket.emit('admin:success', `Deposit approved successfully`);
      } else {
        socket.emit('admin:error', 'Failed to approve deposit');
      }
    } catch (error) {
      socket.emit('admin:error', 'Error approving deposit: ' + error.message);
    }
  });
  
  socket.on('admin:rejectDeposit', async (data) => {
    if (!adminSockets.has(socket.id)) {
      socket.emit('admin:error', 'Unauthorized');
      return;
    }
    
    try {
      const { depositId, adminId, reason } = data;
      
      const deposit = await DepositRequest.findById(depositId);
      if (!deposit) {
        socket.emit('admin:error', 'Deposit not found');
        return;
      }
      
      deposit.status = 'rejected';
      deposit.processedBy = adminId || 'ADMIN';
      deposit.processedAt = new Date();
      deposit.notes = reason || 'No reason provided';
      await deposit.save();
      
      // Notify user if online
      for (const [sId, userId] of socketToUser.entries()) {
        if (userId === deposit.userId) {
          const playerSocket = io.sockets.sockets.get(sId);
          if (playerSocket) {
            playerSocket.emit('depositRejected', {
              amount: deposit.amount,
              reason: reason || 'Deposit rejected',
              depositId: deposit._id
            });
          }
        }
      }
      
      socket.emit('admin:success', `Deposit rejected`);
      
      logActivity('DEPOSIT_REJECTED', { 
        depositId: deposit._id,
        userId: deposit.userId,
        userName: deposit.userName,
        amount: deposit.amount,
        reason: reason,
        processedBy: adminId 
      });
      
    } catch (error) {
      socket.emit('admin:error', 'Error rejecting deposit: ' + error.message);
    }
  });
  
  socket.on('admin:approveWithdrawal', async (data) => {
    if (!adminSockets.has(socket.id)) {
      socket.emit('admin:error', 'Unauthorized');
      return;
    }
    
    try {
      const { withdrawalId, adminId, transactionId, notes } = data;
      
      const success = await approveWithdrawal(withdrawalId, adminId || 'ADMIN', transactionId || '', notes || '');
      
      if (success) {
        socket.emit('admin:success', `Withdrawal approved successfully`);
      } else {
        socket.emit('admin:error', 'Failed to approve withdrawal');
      }
    } catch (error) {
      socket.emit('admin:error', 'Error approving withdrawal: ' + error.message);
    }
  });
  
  socket.on('admin:rejectWithdrawal', async (data) => {
    if (!adminSockets.has(socket.id)) {
      socket.emit('admin:error', 'Unauthorized');
      return;
    }
    
    try {
      const { withdrawalId, adminId, reason } = data;
      
      const success = await rejectWithdrawal(withdrawalId, adminId || 'ADMIN', reason || '');
      
      if (success) {
        socket.emit('admin:success', `Withdrawal rejected`);
      } else {
        socket.emit('admin:error', 'Failed to reject withdrawal');
      }
    } catch (error) {
      socket.emit('admin:error', 'Error rejecting withdrawal: ' + error.message);
    }
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
  
  // ========== DEPOSIT/WITHDRAWAL USER EVENTS ==========
  socket.on('user:getPaymentInfo', async (callback) => {
    try {
      const phoneSetting = await Settings.findOne({ key: 'admin_phone_number' });
      const adminPhone = phoneSetting ? phoneSetting.value : CONFIG.ADMIN_PHONE_NUMBER;
      
      if (callback) {
        callback({
          success: true,
          adminPhone: adminPhone,
          minDeposit: CONFIG.MIN_DEPOSIT_AMOUNT,
          maxDeposit: CONFIG.MAX_DEPOSIT_AMOUNT,
          minWithdrawal: CONFIG.MIN_WITHDRAWAL_AMOUNT,
          maxWithdrawal: CONFIG.MAX_WITHDRAWAL_AMOUNT,
          instructions: `1. Send money to ${adminPhone} via Telebirr\n2. Copy the receipt message\n3. Paste receipt in the form below\n4. Wait for admin approval`
        });
      }
    } catch (error) {
      if (callback) {
        callback({ success: false, error: error.message });
      }
    }
  });
  
  socket.on('user:submitDeposit', async (data, callback) => {
    try {
      const { userId, userName, amount, receiptText } = data;
      
      if (!userId || !userName || !amount || !receiptText) {
        if (callback) callback({ success: false, error: 'Missing required fields' });
        return;
      }
      
      const amountNum = parseFloat(amount);
      if (amountNum < CONFIG.MIN_DEPOSIT_AMOUNT) {
        if (callback) callback({ 
          success: false, 
          error: `Minimum deposit is ${CONFIG.MIN_DEPOSIT_AMOUNT} ETB` 
        });
        return;
      }
      
      if (amountNum > CONFIG.MAX_DEPOSIT_AMOUNT) {
        if (callback) callback({ 
          success: false, 
          error: `Maximum deposit is ${CONFIG.MAX_DEPOSIT_AMOUNT} ETB` 
        });
        return;
      }
      
      const phoneSetting = await Settings.findOne({ key: 'admin_phone_number' });
      const adminPhone = phoneSetting ? phoneSetting.value : CONFIG.ADMIN_PHONE_NUMBER;
      
      const existingDeposit = await DepositRequest.findOne({ 
        receiptText: receiptText,
        status: 'pending'
      });
      
      if (existingDeposit) {
        if (callback) callback({ 
          success: false, 
          error: 'This receipt has already been submitted' 
        });
        return;
      }
      
      const deposit = new DepositRequest({
        userId,
        userName,
        amount: amountNum,
        phoneNumber: adminPhone,
        receiptText,
        status: 'pending'
      });
      
      await deposit.save();
      
      if (CONFIG.AUTO_APPROVE_DEPOSITS) {
        await approveDeposit(deposit._id, 'SYSTEM_AUTO', 'Auto-approved');
      }
      
      adminSockets.forEach(socketId => {
        const adminSocket = io.sockets.sockets.get(socketId);
        if (adminSocket) {
          adminSocket.emit('admin:newDeposit', {
            depositId: deposit._id,
            userId,
            userName,
            amount: amountNum,
            receiptText,
            createdAt: deposit.createdAt
          });
        }
      });
      
      logActivity('DEPOSIT_REQUEST', { 
        userId, 
        userName, 
        amount: amountNum,
        depositId: deposit._id 
      });
      
      if (callback) {
        callback({
          success: true,
          message: 'Deposit request submitted. Admin will process it shortly.',
          depositId: deposit._id,
          status: CONFIG.AUTO_APPROVE_DEPOSITS ? 'auto-approved' : 'pending'
        });
      }
      
    } catch (error) {
      console.error('Error submitting deposit:', error);
      if (callback) {
        callback({ success: false, error: error.message });
      }
    }
  });
  
  socket.on('user:submitWithdrawal', async (data, callback) => {
    try {
      const { userId, userName, amount, phoneNumber } = data;
      
      if (!userId || !userName || !amount || !phoneNumber) {
        if (callback) callback({ success: false, error: 'Missing required fields' });
        return;
      }
      
      const amountNum = parseFloat(amount);
      
      const user = await User.findOne({ userId: userId });
      if (!user) {
        if (callback) callback({ success: false, error: 'User not found' });
        return;
      }
      
      if (user.balance < amountNum) {
        if (callback) callback({ 
          success: false, 
          error: `Insufficient balance. Your balance: ${user.balance} ETB` 
        });
        return;
      }
      
      if (amountNum < CONFIG.MIN_WITHDRAWAL_AMOUNT) {
        if (callback) callback({ 
          success: false, 
          error: `Minimum withdrawal is ${CONFIG.MIN_WITHDRAWAL_AMOUNT} ETB` 
        });
        return;
      }
      
      if (amountNum > CONFIG.MAX_WITHDRAWAL_AMOUNT) {
        if (callback) callback({ 
          success: false, 
          error: `Maximum withdrawal is ${CONFIG.MAX_WITHDRAWAL_AMOUNT} ETB` 
        });
        return;
      }
      
      const pendingWithdrawal = await WithdrawalRequest.findOne({ 
        userId: userId,
        status: 'pending'
      });
      
      if (pendingWithdrawal) {
        if (callback) callback({ 
          success: false, 
          error: 'You already have a pending withdrawal request' 
        });
        return;
      }
      
      const withdrawal = new WithdrawalRequest({
        userId,
        userName,
        amount: amountNum,
        phoneNumber,
        status: 'pending'
      });
      
      await withdrawal.save();
      
      const oldBalance = user.balance;
      user.balance -= amountNum;
      await user.save();
      
      const transaction = new Transaction({
        type: 'WITHDRAWAL_PENDING',
        userId: userId,
        userName: userName,
        amount: -amountNum,
        description: `Withdrawal request to ${phoneNumber} - PENDING`
      });
      await transaction.save();
      
      adminSockets.forEach(socketId => {
        const adminSocket = io.sockets.sockets.get(socketId);
        if (adminSocket) {
          adminSocket.emit('admin:newWithdrawal', {
            withdrawalId: withdrawal._id,
            userId,
            userName,
            amount: amountNum,
            phoneNumber,
            userBalance: user.balance,
            createdAt: withdrawal.createdAt
          });
        }
      });
      
      logActivity('WITHDRAWAL_REQUEST', { 
        userId, 
        userName, 
        amount: amountNum,
        phoneNumber,
        withdrawalId: withdrawal._id 
      });
      
      if (callback) {
        callback({
          success: true,
          message: 'Withdrawal request submitted. Admin will process it shortly.',
          withdrawalId: withdrawal._id,
          newBalance: user.balance
        });
      }
      
    } catch (error) {
      console.error('Error submitting withdrawal:', error);
      if (callback) {
        callback({ success: false, error: error.message });
      }
    }
  });
  
  socket.on('user:getDepositHistory', async (data, callback) => {
    try {
      const { userId } = data;
      
      if (!userId) {
        if (callback) callback({ success: false, error: 'User ID required' });
        return;
      }
      
      const deposits = await DepositRequest.find({ userId: userId })
        .sort({ createdAt: -1 })
        .limit(20);
      
      if (callback) {
        callback({
          success: true,
          deposits: deposits
        });
      }
    } catch (error) {
      if (callback) {
        callback({ success: false, error: error.message });
      }
    }
  });
  
  socket.on('user:getWithdrawalHistory', async (data, callback) => {
    try {
      const { userId } = data;
      
      if (!userId) {
        if (callback) callback({ success: false, error: 'User ID required' });
        return;
      }
      
      const withdrawals = await WithdrawalRequest.find({ userId: userId })
        .sort({ createdAt: -1 })
        .limit(20);
      
      if (callback) {
        callback({
          success: true,
          withdrawals: withdrawals
        });
      }
    } catch (error) {
      if (callback) {
        callback({ success: false, error: error.message });
      }
    }
  });
  
  // ========== EXISTING GAME EVENTS (KEPT AS IS) ==========
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
  
  // Player events
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
          referralCode: user.referralCode
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
          <p style="color: #10b981; margin-top: 10px;">🔒 NEW: Room lock when game is playing</p>
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
          <p style="color: #10b981; font-weight: bold; margin-top: 10px;">💰 NEW: Deposit/Withdrawal System Added!</p>
          <p style="color: #10b981;">✅ Players can deposit via Telebirr</p>
          <p style="color: #10b981;">✅ Admin approval for deposits/withdrawals</p>
          <p style="color: #10b981;">✅ Real-time notifications for admin</p>
          <p style="color: #10b981;">✅ Admin panel for managing requests</p>
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
          <div style="margin-top: 20px;">
            <a href="/payment-info" class="btn" style="background: #10b981;" target="_blank">💰 Payment Info</a>
            <a href="/admin-deposits" class="btn" style="background: #f59e0b;" target="_blank">📥 Deposit Requests</a>
            <a href="/admin-withdrawals" class="btn" style="background: #f59e0b;" target="_blank">📤 Withdrawal Requests</a>
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
            ✅✅✅ ALL PLAYERS RETURN TO LOBBY AFTER GAME ENDS<br>
            ✅✅✅✅ NEW: DEPOSIT/WITHDRAWAL SYSTEM ADDED<br>
            ✅✅✅ Admin panel for managing requests<br>
            ✅✅✅ Telebirr integration for payments<br>
            ✅✅✅ Real-time notifications for admin<br>
            ✅✅✅ User history for deposits/withdrawals
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

// ========== DEPOSIT/WITHDRAWAL API ROUTES ==========
app.get('/payment-info', async (req, res) => {
  try {
    const phoneSetting = await Settings.findOne({ key: 'admin_phone_number' });
    const adminPhone = phoneSetting ? phoneSetting.value : CONFIG.ADMIN_PHONE_NUMBER;
    
    res.json({
      success: true,
      adminPhone: adminPhone,
      minDeposit: CONFIG.MIN_DEPOSIT_AMOUNT,
      maxDeposit: CONFIG.MAX_DEPOSIT_AMOUNT,
      minWithdrawal: CONFIG.MIN_WITHDRAWAL_AMOUNT,
      maxWithdrawal: CONFIG.MAX_WITHDRAWAL_AMOUNT,
      instructions: `1. Send money to ${adminPhone} via Telebirr\n2. Copy the receipt message\n3. Paste receipt in the form below\n4. Wait for admin approval (usually within 5 minutes)`
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/deposit-request', async (req, res) => {
  try {
    const { userId, userName, amount, receiptText } = req.body;
    
    if (!userId || !userName || !amount || !receiptText) {
      return res.status(400).json({ success: false, error: 'Missing required fields' });
    }
    
    const amountNum = parseFloat(amount);
    if (amountNum < CONFIG.MIN_DEPOSIT_AMOUNT) {
      return res.status(400).json({ 
        success: false, 
        error: `Minimum deposit is ${CONFIG.MIN_DEPOSIT_AMOUNT} ETB` 
      });
    }
    
    if (amountNum > CONFIG.MAX_DEPOSIT_AMOUNT) {
      return res.status(400).json({ 
        success: false, 
        error: `Maximum deposit is ${CONFIG.MAX_DEPOSIT_AMOUNT} ETB` 
      });
    }
    
    const phoneSetting = await Settings.findOne({ key: 'admin_phone_number' });
    const adminPhone = phoneSetting ? phoneSetting.value : CONFIG.ADMIN_PHONE_NUMBER;
    
    const existingDeposit = await DepositRequest.findOne({ 
      receiptText: receiptText,
      status: 'pending'
    });
    
    if (existingDeposit) {
      return res.status(400).json({ 
        success: false, 
        error: 'This receipt has already been submitted' 
      });
    }
    
    const deposit = new DepositRequest({
      userId,
      userName,
      amount: amountNum,
      phoneNumber: adminPhone,
      receiptText,
      status: 'pending'
    });
    
    await deposit.save();
    
    if (CONFIG.AUTO_APPROVE_DEPOSITS) {
      await approveDeposit(deposit._id, 'SYSTEM_AUTO', 'Auto-approved');
    }
    
    adminSockets.forEach(socketId => {
      const socket = io.sockets.sockets.get(socketId);
      if (socket) {
        socket.emit('admin:newDeposit', {
          depositId: deposit._id,
          userId,
          userName,
          amount: amountNum,
          receiptText,
          createdAt: deposit.createdAt
        });
      }
    });
    
    logActivity('DEPOSIT_REQUEST', { 
      userId, 
      userName, 
      amount: amountNum,
      depositId: deposit._id 
    });
    
    res.json({
      success: true,
      message: 'Deposit request submitted. Admin will process it shortly.',
      depositId: deposit._id,
      status: CONFIG.AUTO_APPROVE_DEPOSITS ? 'auto-approved' : 'pending'
    });
    
  } catch (error) {
    console.error('Error submitting deposit:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/withdrawal-request', async (req, res) => {
  try {
    const { userId, userName, amount, phoneNumber } = req.body;
    
    if (!userId || !userName || !amount || !phoneNumber) {
      return res.status(400).json({ success: false, error: 'Missing required fields' });
    }
    
    const amountNum = parseFloat(amount);
    
    const user = await User.findOne({ userId: userId });
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }
    
    if (user.balance < amountNum) {
      return res.status(400).json({ 
        success: false, 
        error: `Insufficient balance. Your balance: ${user.balance} ETB` 
      });
    }
    
    if (amountNum < CONFIG.MIN_WITHDRAWAL_AMOUNT) {
      return res.status(400).json({ 
        success: false, 
        error: `Minimum withdrawal is ${CONFIG.MIN_WITHDRAWAL_AMOUNT} ETB` 
      });
    }
    
    if (amountNum > CONFIG.MAX_WITHDRAWAL_AMOUNT) {
      return res.status(400).json({ 
        success: false, 
        error: `Maximum withdrawal is ${CONFIG.MAX_WITHDRAWAL_AMOUNT} ETB` 
      });
    }
    
    const pendingWithdrawal = await WithdrawalRequest.findOne({ 
      userId: userId,
      status: 'pending'
    });
    
    if (pendingWithdrawal) {
      return res.status(400).json({ 
        success: false, 
        error: 'You already have a pending withdrawal request' 
      });
    }
    
    const withdrawal = new WithdrawalRequest({
      userId,
      userName,
      amount: amountNum,
      phoneNumber,
      status: 'pending'
    });
    
    await withdrawal.save();
    
    const oldBalance = user.balance;
    user.balance -= amountNum;
    await user.save();
    
    const transaction = new Transaction({
      type: 'WITHDRAWAL_PENDING',
      userId: userId,
      userName: userName,
      amount: -amountNum,
      description: `Withdrawal request to ${phoneNumber} - PENDING`
    });
    await transaction.save();
    
    adminSockets.forEach(socketId => {
      const socket = io.sockets.sockets.get(socketId);
      if (socket) {
        socket.emit('admin:newWithdrawal', {
          withdrawalId: withdrawal._id,
          userId,
          userName,
          amount: amountNum,
          phoneNumber,
          userBalance: user.balance,
          createdAt: withdrawal.createdAt
        });
      }
    });
    
    logActivity('WITHDRAWAL_REQUEST', { 
      userId, 
      userName, 
      amount: amountNum,
      phoneNumber,
      withdrawalId: withdrawal._id 
    });
    
    res.json({
      success: true,
      message: 'Withdrawal request submitted. Admin will process it shortly.',
      withdrawalId: withdrawal._id,
      newBalance: user.balance
    });
    
  } catch (error) {
    console.error('Error submitting withdrawal:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/admin/deposits', async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    
    let query = {};
    if (status && status !== 'all') {
      query.status = status;
    }
    
    const deposits = await DepositRequest.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));
    
    const total = await DepositRequest.countDocuments(query);
    
    res.json({
      success: true,
      deposits,
      total,
      page: parseInt(page),
      totalPages: Math.ceil(total / limit)
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/admin/withdrawals', async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    
    let query = {};
    if (status && status !== 'all') {
      query.status = status;
    }
    
    const withdrawals = await WithdrawalRequest.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));
    
    const total = await WithdrawalRequest.countDocuments(query);
    
    res.json({
      success: true,
      withdrawals,
      total,
      page: parseInt(page),
      totalPages: Math.ceil(total / limit)
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/admin/approve-deposit/:depositId', async (req, res) => {
  try {
    const { depositId } = req.params;
    const { adminId, notes } = req.body;
    
    const success = await approveDeposit(depositId, adminId || 'ADMIN', notes || '');
    
    if (success) {
      res.json({
        success: true,
        message: 'Deposit approved successfully'
      });
    } else {
      res.status(400).json({ success: false, error: 'Failed to approve deposit' });
    }
    
  } catch (error) {
    console.error('Error approving deposit:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/admin/reject-deposit/:depositId', async (req, res) => {
  try {
    const { depositId } = req.params;
    const { adminId, reason } = req.body;
    
    const deposit = await DepositRequest.findById(depositId);
    if (!deposit) {
      return res.status(404).json({ success: false, error: 'Deposit not found' });
    }
    
    deposit.status = 'rejected';
    deposit.processedBy = adminId || 'ADMIN';
    deposit.processedAt = new Date();
    deposit.notes = reason || 'No reason provided';
    await deposit.save();
    
    res.json({
      success: true,
      message: 'Deposit rejected successfully'
    });
    
  } catch (error) {
    console.error('Error rejecting deposit:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/admin/approve-withdrawal/:withdrawalId', async (req, res) => {
  try {
    const { withdrawalId } = req.params;
    const { adminId, transactionId, notes } = req.body;
    
    const success = await approveWithdrawal(withdrawalId, adminId || 'ADMIN', transactionId || '', notes || '');
    
    if (success) {
      res.json({
        success: true,
        message: 'Withdrawal approved successfully'
      });
    } else {
      res.status(400).json({ success: false, error: 'Failed to approve withdrawal' });
    }
    
  } catch (error) {
    console.error('Error approving withdrawal:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/admin/reject-withdrawal/:withdrawalId', async (req, res) => {
  try {
    const { withdrawalId } = req.params;
    const { adminId, reason } = req.body;
    
    const success = await rejectWithdrawal(withdrawalId, adminId || 'ADMIN', reason || '');
    
    if (success) {
      res.json({
        success: true,
        message: 'Withdrawal rejected successfully'
      });
    } else {
      res.status(400).json({ success: false, error: 'Failed to reject withdrawal' });
    }
    
  } catch (error) {
    console.error('Error rejecting withdrawal:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/user/:userId/deposits', async (req, res) => {
  try {
    const { userId } = req.params;
    
    const deposits = await DepositRequest.find({ userId: userId })
      .sort({ createdAt: -1 })
      .limit(20);
    
    res.json({
      success: true,
      deposits: deposits
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/user/:userId/withdrawals', async (req, res) => {
  try {
    const { userId } = req.params;
    
    const withdrawals = await WithdrawalRequest.find({ userId: userId })
      .sort({ createdAt: -1 })
      .limit(20);
    
    res.json({
      success: true,
      withdrawals: withdrawals
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Admin settings management
app.get('/api/admin/settings', async (req, res) => {
  try {
    const settings = await Settings.find({});
    
    res.json({
      success: true,
      settings: settings
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/admin/settings', async (req, res) => {
  try {
    const { key, value, description } = req.body;
    
    if (!key) {
      return res.status(400).json({ success: false, error: 'Key is required' });
    }
    
    const setting = await Settings.findOneAndUpdate(
      { key: key },
      { 
        value: value,
        description: description || '',
        updatedAt: new Date()
      },
      { upsert: true, new: true }
    );
    
    res.json({
      success: true,
      message: 'Setting updated successfully',
      setting: setting
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ========== EXISTING ROUTES (KEPT AS IS) ==========
app.get('/socket-test', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Socket.IO Connection Test</title>
      <script src="https://cdn.socket.io/4.7.2/socket.io.min.js"></script>
      <style>
        body { font-family: Arial, sans-serif; padding: 20px; max-width: 800px; margin: 0 auto; }
        .status { padding: 20px; margin: 10px 0; border-radius: 10px; font-weight: bold; }
        .connected { background: #d1fae5; color: #065f46; border: 2px solid #10b981; }
        .disconnected { background: #fee2e2; color: #991b1b; border: 2px solid #ef4444; }
        .log { background: #1e293b; color: #cbd5e1; padding: 15px; border-radius: 10px; font-family: monospace; height: 300px; overflow-y: auto; margin-top: 20px; }
        .log-entry { margin: 5px 0; padding: 5px; border-bottom: 1px solid #334155; }
        .success { color: #10b981; }
        .error { color: #ef4444; }
        .info { color: #3b82f6; }
      </style>
    </head>
    <body>
      <h1>🔌 Socket.IO Connection Test</h1>
      <div id="status" class="status disconnected">Connecting to server...</div>
      
      <h3>Test Actions:</h3>
      <div>
        <button onclick="testConnection()" style="padding: 10px 20px; margin: 5px; background: #3b82f6; color: white; border: none; border-radius: 5px; cursor: pointer;">
          Test Connection
        </button>
        <button onclick="testInit()" style="padding: 10px 20px; margin: 5px; background: #10b981; color: white; border: none; border-radius: 5px; cursor: pointer;">
          Test User Init
        </button>
        <button onclick="testRoomStatus()" style="padding: 10px 20px; margin: 5px; background: #8b5cf6; color: white; border: none; border-radius: 5px; cursor: pointer;">
          Test Room Status
        </button>
      </div>
      
      <h3>Connection Log:</h3>
      <div id="log" class="log"></div>
      
      <script>
        const log = document.getElementById('log');
        const status = document.getElementById('status');
        
        function addLog(message, type = 'info') {
          const entry = document.createElement('div');
          entry.className = 'log-entry ' + type;
          entry.textContent = new Date().toLocaleTimeString() + ' - ' + message;
          log.appendChild(entry);
          log.scrollTop = log.scrollHeight;
        }
        
        const socket = io({
          reconnection: true,
          reconnectionAttempts: Infinity,
          reconnectionDelay: 1000,
          reconnectionDelayMax: 5000,
          timeout: 20000,
          transports: ['websocket', 'polling'],
          forceNew: true,
          autoConnect: true
        });
        
        socket.on('connect', () => {
          status.className = 'status connected';
          status.textContent = '✅ Connected - Socket ID: ' + socket.id;
          addLog('Connected to server with ID: ' + socket.id, 'success');
        });
        
        socket.on('disconnect', (reason) => {
          status.className = 'status disconnected';
          status.textContent = '❌ Disconnected: ' + reason;
          addLog('Disconnected: ' + reason, 'error');
        });
        
        socket.on('connect_error', (error) => {
          addLog('Connection error: ' + error.message, 'error');
        });
        
        socket.on('connectionTest', (data) => {
          addLog('Server connection test: ' + JSON.stringify(data), 'success');
        });
        
        socket.on('connected', (data) => {
          addLog('Server connected message: ' + JSON.stringify(data), 'success');
        });
        
        socket.on('balanceUpdate', (data) => {
          addLog('Balance update: ' + data, 'info');
        });
        
        socket.on('roomStatus', (data) => {
          addLog('Room status received: ' + Object.keys(data).length + ' rooms', 'info');
        });
        
        socket.on('boxesTakenUpdate', (data) => {
          addLog('Boxes update: ' + data.takenBoxes.length + ' boxes taken in room ' + data.room, 'info');
        });
        
        socket.on('boxesCleared', (data) => {
          addLog('Boxes cleared for room ' + data.room + ': ' + data.reason, 'info');
        });
        
        function testConnection() {
          addLog('Testing connection...', 'info');
          socket.emit('ping');
        }
        
        function testInit() {
          addLog('Testing user initialization...', 'info');
          socket.emit('init', {
            userId: 'test-' + Date.now(),
            userName: 'Test Player'
          });
        }
        
        function testRoomStatus() {
          addLog('Requesting room status...', 'info');
          socket.emit('getTakenBoxes', { room: 10 }, (boxes) => {
            addLog('Taken boxes for room 10: ' + boxes.length + ' boxes', 'info');
          });
        }
        
        setTimeout(() => {
          testConnection();
        }, 1000);
      </script>
    </body>
    </html>
  `);
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

app.get('/game', (req, res) => {
  res.sendFile(path.join(__dirname, 'game.html'));
});

app.get('/admin-deposits', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Deposit Requests - Bingo Elite Admin</title>
      <style>
        body { font-family: Arial, sans-serif; padding: 20px; background: #0f172a; color: #f8fafc; }
        .container { max-width: 1200px; margin: 0 auto; }
        .header { margin-bottom: 30px; text-align: center; }
        .btn { padding: 10px 20px; background: #3b82f6; color: white; border: none; border-radius: 5px; cursor: pointer; margin: 5px; }
        .btn:hover { background: #2563eb; }
        .btn-success { background: #10b981; }
        .btn-success:hover { background: #059669; }
        .btn-danger { background: #ef4444; }
        .btn-danger:hover { background: #dc2626; }
        .table { width: 100%; border-collapse: collapse; margin-top: 20px; }
        .table th { background: #1e293b; padding: 15px; text-align: left; border-bottom: 2px solid #334155; }
        .table td { padding: 15px; border-bottom: 1px solid #334155; }
        .table tr:hover { background: #1e293b; }
        .status-pending { color: #f59e0b; }
        .status-approved { color: #10b981; }
        .status-rejected { color: #ef4444; }
        .search-box { margin: 20px 0; padding: 10px; width: 300px; background: #1e293b; border: 1px solid #334155; color: white; border-radius: 5px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>📥 Deposit Requests - Bingo Elite Admin</h1>
          <p>Manage deposit requests from players</p>
          <a href="/admin" class="btn">Back to Admin Panel</a>
        </div>
        
        <div>
          <input type="text" id="search" class="search-box" placeholder="Search by user ID or name..." onkeyup="searchTable()">
          <select id="statusFilter" onchange="filterTable()">
            <option value="all">All Status</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
          </select>
        </div>
        
        <table class="table" id="depositsTable">
          <thead>
            <tr>
              <th>ID</th>
              <th>User</th>
              <th>Amount</th>
              <th>Receipt</th>
              <th>Status</th>
              <th>Date</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody id="depositsBody">
            <!-- Deposits will be loaded by JavaScript -->
          </tbody>
        </table>
        
        <div id="loading">Loading deposit requests...</div>
        
        <div style="margin-top: 30px;">
          <button class="btn" onclick="refreshDeposits()">Refresh</button>
          <button class="btn btn-success" onclick="exportDeposits()">Export to CSV</button>
        </div>
      </div>
      
      <script>
        let deposits = [];
        
        async function loadDeposits() {
          document.getElementById('loading').style.display = 'block';
          try {
            const response = await fetch('/api/admin/deposits?status=all&limit=100');
            const data = await response.json();
            
            if (data.success) {
              deposits = data.deposits;
              renderDeposits(deposits);
            }
          } catch (error) {
            console.error('Error loading deposits:', error);
            document.getElementById('depositsBody').innerHTML = '<tr><td colspan="7" style="text-align: center; color: #ef4444;">Error loading deposits</td></tr>';
          } finally {
            document.getElementById('loading').style.display = 'none';
          }
        }
        
        function renderDeposits(depositsToShow) {
          const tbody = document.getElementById('depositsBody');
          tbody.innerHTML = '';
          
          if (depositsToShow.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" style="text-align: center;">No deposit requests found</td></tr>';
            return;
          }
          
          depositsToShow.forEach(deposit => {
            const row = document.createElement('tr');
            
            const date = new Date(deposit.createdAt).toLocaleString();
            const statusClass = `status-${deposit.status}`;
            
            row.innerHTML = \`
              <td>\${deposit._id.substring(0, 8)}...</td>
              <td>
                <strong>\${deposit.userName}</strong><br>
                <small style="color: #94a3b8;">\${deposit.userId}</small>
              </td>
              <td style="font-weight: bold; color: #10b981;">\${deposit.amount.toFixed(2)} ETB</td>
              <td>
                <div style="max-width: 200px; word-wrap: break-word; font-family: monospace; font-size: 0.8rem;">
                  \${deposit.receiptText.substring(0, 50)}\${deposit.receiptText.length > 50 ? '...' : ''}
                </div>
              </td>
              <td class="\${statusClass}">
                <strong>\${deposit.status.toUpperCase()}</strong>
                \${deposit.processedBy ? \`<br><small>By: \${deposit.processedBy}</small>\` : ''}
              </td>
              <td>\${date}</td>
              <td>
                \${deposit.status === 'pending' ? \`
                  <button class="btn btn-success" onclick="approveDeposit('\${deposit._id}')">Approve</button>
                  <button class="btn btn-danger" onclick="rejectDeposit('\${deposit._id}')">Reject</button>
                \` : \`
                  <button class="btn" onclick="viewDeposit('\${deposit._id}')">View</button>
                \`}
              </td>
            \`;
            
            tbody.appendChild(row);
          });
        }
        
        async function approveDeposit(depositId) {
          if (!confirm('Approve this deposit request?')) return;
          
          try {
            const response = await fetch(\`/api/admin/approve-deposit/\${depositId}\`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ adminId: 'WEB_ADMIN' })
            });
            
            const data = await response.json();
            
            if (data.success) {
              alert('Deposit approved successfully');
              loadDeposits();
            } else {
              alert('Error: ' + data.error);
            }
          } catch (error) {
            alert('Error approving deposit: ' + error.message);
          }
        }
        
        async function rejectDeposit(depositId) {
          const reason = prompt('Enter reason for rejection:', 'No reason provided');
          if (reason === null) return;
          
          try {
            const response = await fetch(\`/api/admin/reject-deposit/\${depositId}\`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ adminId: 'WEB_ADMIN', reason: reason })
            });
            
            const data = await response.json();
            
            if (data.success) {
              alert('Deposit rejected');
              loadDeposits();
            } else {
              alert('Error: ' + data.error);
            }
          } catch (error) {
            alert('Error rejecting deposit: ' + error.message);
          }
        }
        
        function viewDeposit(depositId) {
          const deposit = deposits.find(d => d._id === depositId);
          if (deposit) {
            alert(\`Deposit Details:\\n\\nUser: \${deposit.userName} (\${deposit.userId})\\nAmount: \${deposit.amount} ETB\\nReceipt: \${deposit.receiptText}\\nStatus: \${deposit.status}\\nDate: \${new Date(deposit.createdAt).toLocaleString()}\${deposit.notes ? \`\\nNotes: \${deposit.notes}\` : ''}\`);
          }
        }
        
        function searchTable() {
          const searchTerm = document.getElementById('search').value.toLowerCase();
          const filtered = deposits.filter(deposit => 
            deposit.userId.toLowerCase().includes(searchTerm) ||
            deposit.userName.toLowerCase().includes(searchTerm) ||
            deposit.receiptText.toLowerCase().includes(searchTerm)
          );
          renderDeposits(filtered);
        }
        
        function filterTable() {
          const status = document.getElementById('statusFilter').value;
          const filtered = status === 'all' ? deposits : deposits.filter(d => d.status === status);
          renderDeposits(filtered);
        }
        
        function refreshDeposits() {
          loadDeposits();
        }
        
        function exportDeposits() {
          const csv = [
            ['Deposit ID', 'User ID', 'User Name', 'Amount', 'Receipt Text', 'Status', 'Processed By', 'Date'],
            ...deposits.map(d => [
              d._id,
              d.userId,
              d.userName,
              d.amount,
              d.receiptText,
              d.status,
              d.processedBy || '',
              new Date(d.createdAt).toISOString()
            ])
          ].map(row => row.join(',')).join('\\n');
          
          const blob = new Blob([csv], { type: 'text/csv' });
          const url = window.URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = \`deposits_\${new Date().toISOString().split('T')[0]}.csv\`;
          a.click();
        }
        
        // Load deposits on page load
        loadDeposits();
        
        // Auto-refresh every 30 seconds
        setInterval(loadDeposits, 30000);
      </script>
    </body>
    </html>
  `);
});

app.get('/admin-withdrawals', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Withdrawal Requests - Bingo Elite Admin</title>
      <style>
        body { font-family: Arial, sans-serif; padding: 20px; background: #0f172a; color: #f8fafc; }
        .container { max-width: 1200px; margin: 0 auto; }
        .header { margin-bottom: 30px; text-align: center; }
        .btn { padding: 10px 20px; background: #3b82f6; color: white; border: none; border-radius: 5px; cursor: pointer; margin: 5px; }
        .btn:hover { background: #2563eb; }
        .btn-success { background: #10b981; }
        .btn-success:hover { background: #059669; }
        .btn-danger { background: #ef4444; }
        .btn-danger:hover { background: #dc2626; }
        .table { width: 100%; border-collapse: collapse; margin-top: 20px; }
        .table th { background: #1e293b; padding: 15px; text-align: left; border-bottom: 2px solid #334155; }
        .table td { padding: 15px; border-bottom: 1px solid #334155; }
        .table tr:hover { background: #1e293b; }
        .status-pending { color: #f59e0b; }
        .status-paid { color: #10b981; }
        .status-rejected { color: #ef4444; }
        .search-box { margin: 20px 0; padding: 10px; width: 300px; background: #1e293b; border: 1px solid #334155; color: white; border-radius: 5px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>📤 Withdrawal Requests - Bingo Elite Admin</h1>
          <p>Manage withdrawal requests from players</p>
          <a href="/admin" class="btn">Back to Admin Panel</a>
        </div>
        
        <div>
          <input type="text" id="search" class="search-box" placeholder="Search by user ID or name..." onkeyup="searchTable()">
          <select id="statusFilter" onchange="filterTable()">
            <option value="all">All Status</option>
            <option value="pending">Pending</option>
            <option value="paid">Paid</option>
            <option value="rejected">Rejected</option>
          </select>
        </div>
        
        <table class="table" id="withdrawalsTable">
          <thead>
            <tr>
              <th>ID</th>
              <th>User</th>
              <th>Amount</th>
              <th>Phone Number</th>
              <th>Status</th>
              <th>Date</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody id="withdrawalsBody">
            <!-- Withdrawals will be loaded by JavaScript -->
          </tbody>
        </table>
        
        <div id="loading">Loading withdrawal requests...</div>
        
        <div style="margin-top: 30px;">
          <button class="btn" onclick="refreshWithdrawals()">Refresh</button>
          <button class="btn btn-success" onclick="exportWithdrawals()">Export to CSV</button>
        </div>
      </div>
      
      <script>
        let withdrawals = [];
        
        async function loadWithdrawals() {
          document.getElementById('loading').style.display = 'block';
          try {
            const response = await fetch('/api/admin/withdrawals?status=all&limit=100');
            const data = await response.json();
            
            if (data.success) {
              withdrawals = data.withdrawals;
              renderWithdrawals(withdrawals);
            }
          } catch (error) {
            console.error('Error loading withdrawals:', error);
            document.getElementById('withdrawalsBody').innerHTML = '<tr><td colspan="7" style="text-align: center; color: #ef4444;">Error loading withdrawals</td></tr>';
          } finally {
            document.getElementById('loading').style.display = 'none';
          }
        }
        
        function renderWithdrawals(withdrawalsToShow) {
          const tbody = document.getElementById('withdrawalsBody');
          tbody.innerHTML = '';
          
          if (withdrawalsToShow.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" style="text-align: center;">No withdrawal requests found</td></tr>';
            return;
          }
          
          withdrawalsToShow.forEach(withdrawal => {
            const row = document.createElement('tr');
            
            const date = new Date(withdrawal.createdAt).toLocaleString();
            const statusClass = \`status-\${withdrawal.status}\`;
            
            row.innerHTML = \`
              <td>\${withdrawal._id.substring(0, 8)}...</td>
              <td>
                <strong>\${withdrawal.userName}</strong><br>
                <small style="color: #94a3b8;">\${withdrawal.userId}</small>
              </td>
              <td style="font-weight: bold; color: #ef4444;">\${withdrawal.amount.toFixed(2)} ETB</td>
              <td>\${withdrawal.phoneNumber}</td>
              <td class="\${statusClass}">
                <strong>\${withdrawal.status.toUpperCase()}</strong>
                \${withdrawal.processedBy ? \`<br><small>By: \${withdrawal.processedBy}</small>\` : ''}
                \${withdrawal.transactionId ? \`<br><small>TX: \${withdrawal.transactionId}</small>\` : ''}
              </td>
              <td>\${date}</td>
              <td>
                \${withdrawal.status === 'pending' ? \`
                  <button class="btn btn-success" onclick="approveWithdrawal('\${withdrawal._id}')">Approve</button>
                  <button class="btn btn-danger" onclick="rejectWithdrawal('\${withdrawal._id}')">Reject</button>
                \` : \`
                  <button class="btn" onclick="viewWithdrawal('\${withdrawal._id}')">View</button>
                \`}
              </td>
            \`;
            
            tbody.appendChild(row);
          });
        }
        
        async function approveWithdrawal(withdrawalId) {
          const transactionId = prompt('Enter Telebirr transaction ID (optional):', '');
          const notes = prompt('Enter notes (optional):', '');
          
          try {
            const response = await fetch(\`/api/admin/approve-withdrawal/\${withdrawalId}\`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ 
                adminId: 'WEB_ADMIN',
                transactionId: transactionId || '',
                notes: notes || ''
              })
            });
            
            const data = await response.json();
            
            if (data.success) {
              alert('Withdrawal approved successfully');
              loadWithdrawals();
            } else {
              alert('Error: ' + data.error);
            }
          } catch (error) {
            alert('Error approving withdrawal: ' + error.message);
          }
        }
        
        async function rejectWithdrawal(withdrawalId) {
          const reason = prompt('Enter reason for rejection:', 'No reason provided');
          if (reason === null) return;
          
          try {
            const response = await fetch(\`/api/admin/reject-withdrawal/\${withdrawalId}\`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ adminId: 'WEB_ADMIN', reason: reason })
            });
            
            const data = await response.json();
            
            if (data.success) {
              alert('Withdrawal rejected');
              loadWithdrawals();
            } else {
              alert('Error: ' + data.error);
            }
          } catch (error) {
            alert('Error rejecting withdrawal: ' + error.message);
          }
        }
        
        function viewWithdrawal(withdrawalId) {
          const withdrawal = withdrawals.find(w => w._id === withdrawalId);
          if (withdrawal) {
            alert(\`Withdrawal Details:\\n\\nUser: \${withdrawal.userName} (\${withdrawal.userId})\\nAmount: \${withdrawal.amount} ETB\\nPhone: \${withdrawal.phoneNumber}\\nStatus: \${withdrawal.status}\\nDate: \${new Date(withdrawal.createdAt).toLocaleString()}\${withdrawal.notes ? \`\\nNotes: \${withdrawal.notes}\` : ''}\${withdrawal.transactionId ? \`\\nTransaction ID: \${withdrawal.transactionId}\` : ''}\`);
          }
        }
        
        function searchTable() {
          const searchTerm = document.getElementById('search').value.toLowerCase();
          const filtered = withdrawals.filter(withdrawal => 
            withdrawal.userId.toLowerCase().includes(searchTerm) ||
            withdrawal.userName.toLowerCase().includes(searchTerm) ||
            withdrawal.phoneNumber.toLowerCase().includes(searchTerm)
          );
          renderWithdrawals(filtered);
        }
        
        function filterTable() {
          const status = document.getElementById('statusFilter').value;
          const filtered = status === 'all' ? withdrawals : withdrawals.filter(w => w.status === status);
          renderWithdrawals(filtered);
        }
        
        function refreshWithdrawals() {
          loadWithdrawals();
        }
        
        function exportWithdrawals() {
          const csv = [
            ['Withdrawal ID', 'User ID', 'User Name', 'Amount', 'Phone Number', 'Status', 'Transaction ID', 'Processed By', 'Date'],
            ...withdrawals.map(w => [
              w._id,
              w.userId,
              w.userName,
              w.amount,
              w.phoneNumber,
              w.status,
              w.transactionId || '',
              w.processedBy || '',
              new Date(w.createdAt).toISOString()
            ])
          ].map(row => row.join(',')).join('\\n');
          
          const blob = new Blob([csv], { type: 'text/csv' });
          const url = window.URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = \`withdrawals_\${new Date().toISOString().split('T')[0]}.csv\`;
          a.click();
        }
        
        // Load withdrawals on page load
        loadWithdrawals();
        
        // Auto-refresh every 30 seconds
        setInterval(loadWithdrawals, 30000);
      </script>
    </body>
    </html>
  `);
});

// ========== TELEGRAM BOT INTEGRATION ==========
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN || '8281813355:AAElz32khbZ9cnX23CeJQn7gwkAypHuJ9E4';

app.post('/telegram-webhook', express.json(), async (req, res) => {
  try {
    const { message } = req.body;
    
    if (message) {
      const chatId = message.chat.id;
      const text = message.text || '';
      const userId = message.from.id.toString();
      const userName = message.from.first_name || 'Player';
      const username = message.from.username || '';
      
      if (text === '/start' || text === '/play') {
        let user = await User.findOne({ telegramId: userId });
        
        if (!user) {
          user = new User({
            userId: `tg_${userId}`,
            userName: userName,
            telegramId: userId,
            telegramUsername: username,
            balance: 0.00,
            referralCode: `TG${userId}`
          });
          await user.save();
          
          console.log(`👤 New Telegram user: ${userName} (@${username})`);
        }
        
        await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: `🎮 *Welcome to Bingo Elite, ${userName}!*\n\n` +
                  `💰 Your balance: *${user.balance.toFixed(2)} ETB*\n\n` +
                  `🎯 *New Features:*\n` +
                  `• 🔒 DOUBLE PRIZE BUG FIXED - Claim lock implemented\n` +
                  `• ⏱️ Timer sync between discovery and waiting rooms\n` +
                  `• 🔒 Room lock when game is playing\n` +
                  `• ⏰ Auto-clear after ${CONFIG.GAME_TIMEOUT_MINUTES} minutes\n` +
                  `• ⏱️ Timer shows on box selection screen\n` +
                  `• 💰 NEW: Deposit/Withdrawal system\n` +
                  `• 💳 Telebirr payments (send to admin)\n` +
                  `• 📥 Admin approval for all transactions\n` +
                  `• 10/20/50/100 ETB rooms\n` +
                  `• Four Corners Bonus: 50 ETB\n` +
                  `• Real-time multiplayer\n` +
                  `• Real-time box tracking\n` +
                  `• Telegram login\n` +
                  `• Game starts automatically when 1 player joins\n` +
                  `• Timer continues even if players leave\n` +
                  `• Random BINGO card numbers\n` +
                  `• ✅✅✅ Fixed: Double prize bug eliminated\n` +
                  `• ✅✅✅ Fixed: Claim Bingo now properly checks numbers\n` +
                  `• ✅ Fixed: All players return to lobby after game ends\n` +
                  `• ✅ Fixed: Game starts with 1 player after 30 seconds\n` +
                  `• ✅ Fixed: Game starts properly now!\n\n` +
                  `_Need funds? Contact admin or use deposit feature_\n` +
                  `_To deposit: Send money via Telebirr and submit receipt_`,
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [[
                {
                  text: '🎮 Play Bingo Now',
                  web_app: { url: 'https://bingo-telegram-game.onrender.com/telegram' }
                }
              ]]
            }
          })
        });
      }
      else if (text === '/balance') {
        const user = await User.findOne({ telegramId: userId });
        const balance = user ? user.balance : 0;
        
        await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: `💰 *Your Balance:* ${balance.toFixed(2)} ETB\n\n` +
                  `🎮 Play: @ethio_games1_bot\n` +
                  `👑 Admin: Contact for funds\n` +
                  `💳 Deposit: Use deposit feature in game\n` +
                  `🆔 Your ID: \`${userId}\``,
            parse_mode: 'Markdown'
          })
        });
      }
      else if (text === '/deposit') {
        const phoneSetting = await Settings.findOne({ key: 'admin_phone_number' });
        const adminPhone = phoneSetting ? phoneSetting.value : CONFIG.ADMIN_PHONE_NUMBER;
        
        await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: `💳 *How to Deposit:*\n\n` +
                  `1. Send money to *${adminPhone}* via Telebirr\n` +
                  `2. Copy the receipt message\n` +
                  `3. Open the game and go to Deposit section\n` +
                  `4. Paste the receipt and submit\n` +
                  `5. Admin will approve within 5 minutes\n\n` +
                  `*Minimum Deposit:* ${CONFIG.MIN_DEPOSIT_AMOUNT} ETB\n` +
                  `*Maximum Deposit:* ${CONFIG.MAX_DEPOSIT_AMOUNT} ETB`,
            parse_mode: 'Markdown'
          })
        });
      }
      else if (text === '/withdraw') {
        await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: `💸 *How to Withdraw:*\n\n` +
                  `1. Open the game and go to Withdraw section\n` +
                  `2. Enter your Telebirr phone number\n` +
                  `3. Enter amount to withdraw\n` +
                  `4. Submit request\n` +
                  `5. Admin will send money within 24 hours\n\n` +
                  `*Minimum Withdrawal:* ${CONFIG.MIN_WITHDRAWAL_AMOUNT} ETB\n` +
                  `*Maximum Withdrawal:* ${CONFIG.MAX_WITHDRAWAL_AMOUNT} ETB`,
            parse_mode: 'Markdown'
          })
        });
      }
      else if (text === '/help') {
        await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: `🎮 *Bingo Elite Help*\n\n` +
                  `*New Features:*\n` +
                  `• 🔒 DOUBLE PRIZE BUG FIXED\n` +
                  `• ⏱️ Timer sync\n` +
                  `• 🔒 Room lock when playing\n` +
                  `• ⏰ Games auto-clear after ${CONFIG.GAME_TIMEOUT_MINUTES} minutes\n` +
                  `• 💰 NEW: Deposit/Withdrawal system\n` +
                  `• 💳 Telebirr payments\n\n` +
                  `*Commands:*\n` +
                  `/start - Start the bot\n` +
                  `/play - Play game\n` +
                  `/balance - Check balance\n` +
                  `/deposit - How to deposit\n` +
                  `/withdraw - How to withdraw\n` +
                  `/help - This message\n\n` +
                  `*Need help? Contact admin @ethio_games1_bot*`,
            parse_mode: 'Markdown'
          })
        });
      }
    }
    
    res.sendStatus(200);
  } catch (error) {
    console.error('Telegram webhook error:', error);
    res.sendStatus(200);
  }
});

// ========== START SERVER ==========
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════════════╗
║   🤖 BINGO ELITE - WITH DEPOSIT/WITHDRAWAL SYSTEM   ║
╠══════════════════════════════════════════════════════╣
║  URL:          https://bingo-telegram-game.onrender.com ║
║  Port:         ${PORT}                                ║
║  Game:         /game                                 ║
║  Admin:        /admin (password: admin1234)         ║
║  Telegram:     /telegram                             ║
║  Deposits:     /admin-deposits                       ║
║  Withdrawals:  /admin-withdrawals                    ║
║  Payment Info: /payment-info                         ║
╠══════════════════════════════════════════════════════╣
║  🔑 Admin Password: ${process.env.ADMIN_PASSWORD || 'admin1234'} ║
║  🤖 Telegram Bot: @ethio_games1_bot                 ║
║  📡 WebSocket: ✅ Ready for Telegram connections    ║
║  🎮 Four Corners Bonus: ${CONFIG.FOUR_CORNERS_BONUS} ETB       ║
║  💰 NEW: Deposit/Withdrawal System Added            ║
║  💳 Payment Method: Telebirr                        ║
║  📞 Admin Phone: ${CONFIG.ADMIN_PHONE_NUMBER}           ║
║  💵 Min Deposit: ${CONFIG.MIN_DEPOSIT_AMOUNT} ETB             ║
║  💵 Min Withdrawal: ${CONFIG.MIN_WITHDRAWAL_AMOUNT} ETB       ║
║  ⏱️ Game Timer: ${CONFIG.GAME_TIMER}s between balls ║
║  ⏰ Game Timeout: ${CONFIG.GAME_TIMEOUT_MINUTES} minutes      ║
╚══════════════════════════════════════════════════════╝
✅ Server ready with Deposit/Withdrawal System!
  `);
  
  setTimeout(() => {
    broadcastRoomStatus();
  }, 1000);
  
  setTimeout(async () => {
    try {
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
