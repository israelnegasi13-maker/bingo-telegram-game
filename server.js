// server.js - BINGO ELITE - TELEGRAM MINI APP - WITH WALLET SYSTEM
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
  telebirrNumber: { type: String, default: '' },
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
  type: { type: String, required: true }, // 'DEPOSIT', 'WITHDRAWAL', 'STAKE', 'WIN', 'REFUND', 'ADMIN_ADD', 'HOUSE_EARNINGS'
  userId: { type: String, required: true },
  userName: { type: String, required: true },
  amount: { type: Number, required: true },
  room: { type: Number, default: null },
  admin: { type: Boolean, default: false },
  description: { type: String, required: true },
  status: { type: String, default: 'pending' }, // 'pending', 'approved', 'rejected', 'completed'
  telebirrNumber: { type: String, default: '' },
  transactionId: { type: String, default: '' },
  note: { type: String, default: '' },
  adminNote: { type: String, default: '' },
  processedBy: { type: String, default: '' },
  processedAt: { type: Date, default: null },
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
  totalFourCorners: { type: Number, default: 0 },
  totalDeposits: { type: Number, default: 0 },
  totalWithdrawals: { type: Number, default: 0 }
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

// ========== GAME CONFIGURATION ==========
const CONFIG = {
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || "admin1234",
  ADMIN_TELEBIRR: "0962577855",
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
  AUTO_SAVE_INTERVAL: 60000,
  SESSION_TIMEOUT: 86400000,
  GAME_TIMEOUT_MINUTES: 7,
  MIN_DEPOSIT: 10,
  MIN_WITHDRAWAL: 50
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

// Run cleanup every 10 seconds
setInterval(cleanupProcessingClaims, 10000);

// ========== HELPER FUNCTIONS ==========
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
      
      // Update daily stats
      await updateDailyStats('newUsers', 1);
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

// ========== WALLET FUNCTIONS ==========
async function createDepositRequest(userId, userName, amount, transactionId, note) {
  try {
    const user = await User.findOne({ userId: userId });
    if (!user) return null;
    
    const transaction = new Transaction({
      type: 'DEPOSIT',
      userId: userId,
      userName: userName,
      amount: amount,
      telebirrNumber: CONFIG.ADMIN_TELEBIRR,
      transactionId: transactionId,
      note: note,
      description: `Deposit request via Telebirr (Transaction ID: ${transactionId})`,
      status: 'pending'
    });
    
    await transaction.save();
    
    // Update daily stats
    await updateDailyStats('totalDeposits', 1);
    
    // Notify admin
    notifyAdminDepositRequest(transaction);
    
    return transaction;
  } catch (error) {
    console.error('Error creating deposit request:', error);
    return null;
  }
}

async function createWithdrawalRequest(userId, userName, amount, telebirrNumber, note) {
  try {
    const user = await User.findOne({ userId: userId });
    if (!user) return null;
    
    // Check if user has sufficient balance
    if (user.balance < amount) {
      throw new Error('Insufficient balance');
    }
    
    const transaction = new Transaction({
      type: 'WITHDRAWAL',
      userId: userId,
      userName: userName,
      amount: -amount, // Negative for withdrawal
      telebirrNumber: telebirrNumber,
      note: note,
      description: `Withdrawal request to Telebirr ${telebirrNumber}`,
      status: 'pending'
    });
    
    await transaction.save();
    
    // Update user's telebirr number
    user.telebirrNumber = telebirrNumber;
    await user.save();
    
    // Update daily stats
    await updateDailyStats('totalWithdrawals', 1);
    
    // Notify admin
    notifyAdminWithdrawalRequest(transaction);
    
    return transaction;
  } catch (error) {
    console.error('Error creating withdrawal request:', error);
    throw error;
  }
}

async function approveDeposit(transactionId, adminId) {
  try {
    const transaction = await Transaction.findOne({ 
      _id: transactionId,
      type: 'DEPOSIT',
      status: 'pending'
    });
    
    if (!transaction) {
      throw new Error('Transaction not found or already processed');
    }
    
    const user = await User.findOne({ userId: transaction.userId });
    if (!user) {
      throw new Error('User not found');
    }
    
    // Update transaction
    transaction.status = 'approved';
    transaction.processedBy = adminId;
    transaction.processedAt = new Date();
    transaction.adminNote = `Approved by admin ${adminId}`;
    await transaction.save();
    
    // Update user balance
    const oldBalance = user.balance;
    user.balance += transaction.amount;
    await user.save();
    
    // Notify user
    notifyUserTransactionUpdate(transaction.userId, transaction);
    
    // Send balance update to user
    for (const [socketId, userId] of socketToUser.entries()) {
      if (userId === transaction.userId) {
        const socket = io.sockets.sockets.get(socketId);
        if (socket) {
          socket.emit('balanceUpdate', user.balance);
          socket.emit('wallet:depositApproved', {
            amount: transaction.amount,
            newBalance: user.balance,
            transactionId: transaction._id
          });
        }
      }
    }
    
    // Update admin panel
    updateAdminPanel();
    
    console.log(`✅ Deposit approved: ${transaction.amount} ETB added to ${user.userName}`);
    
    return { success: true, user: user, transaction: transaction };
  } catch (error) {
    console.error('Error approving deposit:', error);
    throw error;
  }
}

async function approveWithdrawal(transactionId, adminId) {
  try {
    const transaction = await Transaction.findOne({ 
      _id: transactionId,
      type: 'WITHDRAWAL',
      status: 'pending'
    });
    
    if (!transaction) {
      throw new Error('Transaction not found or already processed');
    }
    
    const user = await User.findOne({ userId: transaction.userId });
    if (!user) {
      throw new Error('User not found');
    }
    
    // Check if user still has sufficient balance
    if (user.balance < Math.abs(transaction.amount)) {
      // Reject the withdrawal
      transaction.status = 'rejected';
      transaction.processedBy = adminId;
      transaction.processedAt = new Date();
      transaction.adminNote = `Rejected: Insufficient balance (Balance: ${user.balance}, Requested: ${Math.abs(transaction.amount)})`;
      await transaction.save();
      
      // Notify user
      notifyUserTransactionUpdate(transaction.userId, transaction);
      
      throw new Error('User has insufficient balance for this withdrawal');
    }
    
    // Update transaction
    transaction.status = 'approved';
    transaction.processedBy = adminId;
    transaction.processedAt = new Date();
    transaction.adminNote = `Approved by admin ${adminId}`;
    await transaction.save();
    
    // Update user balance
    const oldBalance = user.balance;
    user.balance += transaction.amount; // transaction.amount is negative for withdrawal
    await user.save();
    
    // Notify user
    notifyUserTransactionUpdate(transaction.userId, transaction);
    
    // Send notification to user
    for (const [socketId, userId] of socketToUser.entries()) {
      if (userId === transaction.userId) {
        const socket = io.sockets.sockets.get(socketId);
        if (socket) {
          socket.emit('balanceUpdate', user.balance);
          socket.emit('wallet:withdrawProcessed', {
            status: 'approved',
            amount: Math.abs(transaction.amount),
            telebirrNumber: transaction.telebirrNumber,
            newBalance: user.balance,
            transactionId: transaction._id
          });
        }
      }
    }
    
    // Update admin panel
    updateAdminPanel();
    
    console.log(`✅ Withdrawal approved: ${Math.abs(transaction.amount)} ETB sent to ${transaction.telebirrNumber}`);
    
    return { success: true, user: user, transaction: transaction };
  } catch (error) {
    console.error('Error approving withdrawal:', error);
    throw error;
  }
}

async function rejectTransaction(transactionId, adminId, reason) {
  try {
    const transaction = await Transaction.findOne({ 
      _id: transactionId,
      status: 'pending'
    });
    
    if (!transaction) {
      throw new Error('Transaction not found or already processed');
    }
    
    // Update transaction
    transaction.status = 'rejected';
    transaction.processedBy = adminId;
    transaction.processedAt = new Date();
    transaction.adminNote = reason || `Rejected by admin ${adminId}`;
    await transaction.save();
    
    // Notify user
    notifyUserTransactionUpdate(transaction.userId, transaction);
    
    // Send notification to user
    for (const [socketId, userId] of socketToUser.entries()) {
      if (userId === transaction.userId) {
        const socket = io.sockets.sockets.get(socketId);
        if (socket) {
          socket.emit('wallet:withdrawProcessed', {
            status: 'rejected',
            amount: Math.abs(transaction.amount),
            telebirrNumber: transaction.telebirrNumber,
            reason: reason,
            transactionId: transaction._id
          });
        }
      }
    }
    
    // Update admin panel
    updateAdminPanel();
    
    console.log(`❌ Transaction rejected: ${transaction._id} - ${reason}`);
    
    return { success: true, transaction: transaction };
  } catch (error) {
    console.error('Error rejecting transaction:', error);
    throw error;
  }
}

async function getUserWalletHistory(userId) {
  try {
    const transactions = await Transaction.find({
      userId: userId,
      type: { $in: ['DEPOSIT', 'WITHDRAWAL', 'STAKE', 'WIN', 'REFUND', 'ADMIN_ADD'] }
    }).sort({ createdAt: -1 }).limit(50);
    
    // Format for client
    const formattedTransactions = transactions.map(t => ({
      id: t._id,
      type: t.type.toLowerCase(),
      amount: t.amount,
      status: t.status,
      description: t.description,
      date: t.createdAt,
      telebirrNumber: t.telebirrNumber,
      transactionId: t.transactionId,
      note: t.note
    }));
    
    return formattedTransactions;
  } catch (error) {
    console.error('Error getting user wallet history:', error);
    return [];
  }
}

function notifyUserTransactionUpdate(userId, transaction) {
  for (const [socketId, uId] of socketToUser.entries()) {
    if (uId === userId) {
      const socket = io.sockets.sockets.get(socketId);
      if (socket) {
        socket.emit('wallet:transactionUpdate', {
          id: transaction._id,
          type: transaction.type.toLowerCase(),
          amount: transaction.amount,
          status: transaction.status,
          description: transaction.description
        });
      }
    }
  }
}

function notifyAdminDepositRequest(transaction) {
  adminSockets.forEach(socketId => {
    const socket = io.sockets.sockets.get(socketId);
    if (socket) {
      socket.emit('admin:depositRequest', {
        transactionId: transaction._id,
        userId: transaction.userId,
        userName: transaction.userName,
        amount: transaction.amount,
        transactionId: transaction.transactionId,
        telebirrNumber: transaction.telebirrNumber,
        note: transaction.note,
        createdAt: transaction.createdAt
      });
    }
  });
}

function notifyAdminWithdrawalRequest(transaction) {
  adminSockets.forEach(socketId => {
    const socket = io.sockets.sockets.get(socketId);
    if (socket) {
      socket.emit('admin:withdrawalRequest', {
        transactionId: transaction._id,
        userId: transaction.userId,
        userName: transaction.userName,
        amount: Math.abs(transaction.amount),
        telebirrNumber: transaction.telebirrNumber,
        note: transaction.note,
        userBalance: 0, // Will be updated when admin panel fetches user data
        createdAt: transaction.createdAt
      });
    }
  });
}

async function updateDailyStats(field, increment = 1) {
  try {
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    
    await Stats.findOneAndUpdate(
      { date: today },
      { $inc: { [field]: increment } },
      { upsert: true, new: true }
    );
  } catch (error) {
    console.error('Error updating daily stats:', error);
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
        telebirrNumber: user.telebirrNumber || '',
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
    
    // Get pending transactions
    const pendingTransactions = await Transaction.find({
      status: 'pending',
      type: { $in: ['DEPOSIT', 'WITHDRAWAL'] }
    }).sort({ createdAt: -1 }).limit(50);
    
    // Calculate total house balance
    const houseBalance = await Transaction.aggregate([
      { $match: { type: { $in: ['HOUSE_EARNINGS', 'ADMIN_ADD'] } } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]).then(result => result[0]?.total || 0);
    
    const connectedSocketsCount = connectedSockets.size;
    
    // Get daily stats
    const today = new Date().toISOString().split('T')[0];
    const dailyStats = await Stats.findOne({ date: today }) || {
      totalDeposits: 0,
      totalWithdrawals: 0,
      totalWagered: 0,
      totalEarnings: 0
    };
    
    const adminData = {
      totalPlayers: connectedPlayers,
      activeGames: activeGames,
      totalUsers: users.length,
      connectedSockets: connectedSocketsCount,
      houseBalance: houseBalance,
      timestamp: new Date().toISOString(),
      serverUptime: process.uptime(),
      gameTimeoutMinutes: CONFIG.GAME_TIMEOUT_MINUTES,
      pendingTransactions: pendingTransactions.length,
      dailyStats: dailyStats
    };
    
    adminSockets.forEach(socketId => {
      const socket = io.sockets.sockets.get(socketId);
      if (socket) {
        socket.emit('admin:update', adminData);
        socket.emit('admin:players', userArray);
        socket.emit('admin:rooms', roomsData);
        socket.emit('admin:pendingTransactions', pendingTransactions);
        
        Transaction.find().sort({ createdAt: -1 }).limit(50)
          .then(transactions => {
            socket.emit('admin:transactions', transactions);
          })
          .catch(err => console.error('Error fetching transactions:', err));
      }
    });
    
    console.log(`📊 Admin Panel Updated: ${connectedPlayers} players online, ${activeGames} active games, ${pendingTransactions.length} pending transactions`);
    
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

// ========== GAME MANAGEMENT FUNCTIONS ==========
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

// ========== CLEANUP FUNCTIONS ==========
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
  
  // ========== WALLET ADMIN FUNCTIONS ==========
  socket.on('admin:approveDeposit', async ({ transactionId }) => {
    if (!adminSockets.has(socket.id)) {
      socket.emit('admin:error', 'Unauthorized');
      return;
    }
    
    try {
      const result = await approveDeposit(transactionId, socket.id);
      socket.emit('admin:success', `Deposit approved: ${result.transaction.amount} ETB added to ${result.user.userName}`);
      
      logActivity('ADMIN_APPROVE_DEPOSIT', { 
        adminSocket: socket.id, 
        transactionId, 
        userId: result.user.userId,
        userName: result.user.userName,
        amount: result.transaction.amount 
      }, socket.id);
      
    } catch (error) {
      socket.emit('admin:error', `Failed to approve deposit: ${error.message}`);
    }
  });
  
  socket.on('admin:approveWithdrawal', async ({ transactionId }) => {
    if (!adminSockets.has(socket.id)) {
      socket.emit('admin:error', 'Unauthorized');
      return;
    }
    
    try {
      const result = await approveWithdrawal(transactionId, socket.id);
      socket.emit('admin:success', `Withdrawal approved: ${Math.abs(result.transaction.amount)} ETB sent to ${result.transaction.telebirrNumber}`);
      
      logActivity('ADMIN_APPROVE_WITHDRAWAL', { 
        adminSocket: socket.id, 
        transactionId, 
        userId: result.user.userId,
        userName: result.user.userName,
        amount: Math.abs(result.transaction.amount),
        telebirrNumber: result.transaction.telebirrNumber
      }, socket.id);
      
    } catch (error) {
      socket.emit('admin:error', `Failed to approve withdrawal: ${error.message}`);
    }
  });
  
  socket.on('admin:rejectTransaction', async ({ transactionId, reason }) => {
    if (!adminSockets.has(socket.id)) {
      socket.emit('admin:error', 'Unauthorized');
      return;
    }
    
    try {
      const result = await rejectTransaction(transactionId, socket.id, reason);
      socket.emit('admin:success', `Transaction rejected: ${reason}`);
      
      logActivity('ADMIN_REJECT_TRANSACTION', { 
        adminSocket: socket.id, 
        transactionId, 
        reason 
      }, socket.id);
      
    } catch (error) {
      socket.emit('admin:error', `Failed to reject transaction: ${error.message}`);
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
        type: { $in: ['DEPOSIT', 'WITHDRAWAL'] }
      }).sort({ createdAt: -1 }).limit(50);
      
      socket.emit('admin:pendingTransactions', pendingTransactions);
    } catch (error) {
      socket.emit('admin:error', 'Failed to fetch pending transactions');
    }
  });
  
  // ========== PLAYER WALLET FUNCTIONS ==========
  socket.on('wallet:depositRequest', async (data, callback) => {
    try {
      const userId = socketToUser.get(socket.id) || socket.userId;
      
      if (!userId) {
        if (callback) callback({ success: false, message: 'User not authenticated' });
        return;
      }
      
      const { amount, transactionId, note } = data;
      
      if (!amount || amount < CONFIG.MIN_DEPOSIT) {
        if (callback) callback({ success: false, message: `Minimum deposit is ${CONFIG.MIN_DEPOSIT} ETB` });
        return;
      }
      
      if (!transactionId) {
        if (callback) callback({ success: false, message: 'Transaction ID is required' });
        return;
      }
      
      const user = await User.findOne({ userId: userId });
      if (!user) {
        if (callback) callback({ success: false, message: 'User not found' });
        return;
      }
      
      const transaction = await createDepositRequest(userId, user.userName, amount, transactionId, note);
      
      if (transaction) {
        if (callback) callback({ 
          success: true, 
          message: 'Deposit request submitted successfully. Admin will verify and add funds.',
          transactionId: transaction._id
        });
        
        socket.emit('wallet:transactionUpdate', {
          id: transaction._id,
          type: 'deposit',
          amount: transaction.amount,
          status: 'pending',
          description: transaction.description
        });
      } else {
        if (callback) callback({ success: false, message: 'Failed to create deposit request' });
      }
      
    } catch (error) {
      console.error('Error in wallet:depositRequest:', error);
      if (callback) callback({ success: false, message: 'Server error: ' + error.message });
    }
  });
  
  socket.on('wallet:withdrawRequest', async (data, callback) => {
    try {
      const userId = socketToUser.get(socket.id) || socket.userId;
      
      if (!userId) {
        if (callback) callback({ success: false, message: 'User not authenticated' });
        return;
      }
      
      const { amount, telebirrNumber, note } = data;
      
      if (!amount || amount < CONFIG.MIN_WITHDRAWAL) {
        if (callback) callback({ success: false, message: `Minimum withdrawal is ${CONFIG.MIN_WITHDRAWAL} ETB` });
        return;
      }
      
      if (!telebirrNumber || !/^09[0-9]{8}$/.test(telebirrNumber)) {
        if (callback) callback({ success: false, message: 'Valid Telebirr number required (10 digits starting with 09)' });
        return;
      }
      
      const user = await User.findOne({ userId: userId });
      if (!user) {
        if (callback) callback({ success: false, message: 'User not found' });
        return;
      }
      
      if (user.balance < amount) {
        if (callback) callback({ success: false, message: 'Insufficient balance for withdrawal' });
        return;
      }
      
      const transaction = await createWithdrawalRequest(userId, user.userName, amount, telebirrNumber, note);
      
      if (transaction) {
        if (callback) callback({ 
          success: true, 
          message: 'Withdrawal request submitted successfully. Admin will process it.',
          transactionId: transaction._id
        });
        
        socket.emit('wallet:transactionUpdate', {
          id: transaction._id,
          type: 'withdrawal',
          amount: -amount,
          status: 'pending',
          description: transaction.description
        });
      }
      
    } catch (error) {
      console.error('Error in wallet:withdrawRequest:', error);
      if (callback) callback({ success: false, message: 'Server error: ' + error.message });
    }
  });
  
  socket.on('wallet:getHistory', async (data, callback) => {
    try {
      const userId = socketToUser.get(socket.id) || socket.userId;
      
      if (!userId) {
        if (callback) callback({ success: false, message: 'User not authenticated', transactions: [] });
        return;
      }
      
      const transactions = await getUserWalletHistory(userId);
      
      if (callback) callback({ 
        success: true, 
        transactions: transactions 
      });
      
      socket.emit('wallet:history', transactions);
      
    } catch (error) {
      console.error('Error in wallet:getHistory:', error);
      if (callback) callback({ success: false, message: 'Failed to load wallet history', transactions: [] });
    }
  });
  
  // ========== EXISTING GAME EVENTS (unchanged) ==========
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
      
      await updateDailyStats('totalWagered', room);
      
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
      
      await updateDailyStats('totalBingos', 1);
      if (isFourCornersWin) {
        await updateDailyStats('totalFourCorners', 1);
      }
      
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
      
      await updateDailyStats('totalEarnings', houseEarnings);
      
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

// ========== EXPRESS ROUTES ==========
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

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', '*');
  res.header('Access-Control-Allow-Methods', '*');
  res.header('Content-Security-Policy', "frame-ancestors 'self' https://*.telegram.org https://web.telegram.org");
  res.header('X-Frame-Options', 'ALLOW-FROM https://*.telegram.org');
  next();
});

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
        <p style="color: #94a3b8; font-size: 1.2rem;">Real-time multiplayer Bingo - Now with Wallet System!</p>
        
        <div class="status">
          <h2 style="color: #10b981;">🚀 Server Status: RUNNING</h2>
          <div class="stats-grid">
            <div class="stat">
              <div class="stat-label">Connected Players</div>
              <div class="stat-value" id="playerCount">${connectedSockets.size}</div>
            </div>
            <div class="stat">
              <div class="stat-label">Wallet System</div>
              <div class="stat-value" style="color: #10b981;">✅ ACTIVE</div>
            </div>
          </div>
          <p style="margin-top: 20px; color: #f59e0b; font-weight: bold;">💰 Wallet Features:</p>
          <p style="color: #10b981;">✅ Deposit via Telebirr (0962577855)</p>
          <p style="color: #10b981;">✅ Withdrawal requests</p>
          <p style="color: #10b981;">✅ Admin approval system</p>
          <p style="color: #10b981;">✅ Real-time balance updates</p>
          <p style="color: #10b981;">✅ Transaction history</p>
          <p style="color: #3b82f6; margin-top: 10px;">📞 Admin Telebirr: 0962577855</p>
          <p style="color: #64748b; margin-top: 10px;">Server Time: ${new Date().toLocaleString()}</p>
        </div>
        
        <div style="margin-top: 40px;">
          <h3>Access Points:</h3>
          <div>
            <a href="/admin" class="btn btn-admin" target="_blank">🔒 Admin Panel</a>
            <a href="/game" class="btn btn-game" target="_blank">🎮 Game Client</a>
          </div>
          <div style="margin-top: 20px;">
            <a href="/wallet-info" class="btn" style="background: #10b981;" target="_blank">💰 Wallet Info</a>
            <a href="/telegram" class="btn" style="background: #8b5cf6;" target="_blank">🤖 Telegram Entry</a>
          </div>
        </div>
      </div>
    </body>
    </html>
  `);
});

app.get('/wallet-info', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Wallet Information - Bingo Elite</title>
      <style>
        body { font-family: Arial, sans-serif; padding: 40px; text-align: center; background: #0f172a; color: #f8fafc; }
        .container { max-width: 600px; margin: 0 auto; }
        .info-box { background: #1e293b; padding: 30px; border-radius: 20px; margin: 20px 0; border: 1px solid #334155; }
        .telebirr-number { background: rgba(59, 130, 246, 0.1); padding: 20px; border-radius: 16px; border: 1px solid rgba(59, 130, 246, 0.3); margin: 20px 0; }
        .number { font-size: 2.5rem; font-weight: 900; color: #3b82f6; letter-spacing: 3px; }
        .instruction { text-align: left; margin: 15px 0; padding: 15px; background: rgba(255,255,255,0.05); border-radius: 12px; }
        .step { display: flex; align-items: center; gap: 15px; margin: 10px 0; }
        .step-number { background: #3b82f6; color: white; width: 30px; height: 30px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: bold; }
      </style>
    </head>
    <body>
      <div class="container">
        <h1 style="color: #fbbf24;">💰 Wallet Deposit Information</h1>
        
        <div class="info-box">
          <h2 style="color: #10b981;">To Deposit Funds:</h2>
          
          <div class="telebirr-number">
            <div style="color: #94a3b8; margin-bottom: 10px;">Send money to this Telebirr number:</div>
            <div class="number">0962577855</div>
          </div>
          
          <h3 style="color: #fbbf24; margin-top: 30px;">📋 Step-by-Step Instructions:</h3>
          
          <div class="instruction">
            <div class="step">
              <div class="step-number">1</div>
              <div>Open your Telebirr app</div>
            </div>
            <div class="step">
              <div class="step-number">2</div>
              <div>Send money to: <strong>0962577855</strong></div>
            </div>
            <div class="step">
              <div class="step-number">3</div>
              <div>Open the game and click the wallet button (💰)</div>
            </div>
            <div class="step">
              <div class="step-number">4</div>
              <div>Go to "DEPOSIT" tab</div>
            </div>
            <div class="step">
              <div class="step-number">5</div>
              <div>Enter the amount you sent and the transaction ID</div>
            </div>
            <div class="step">
              <div class="step-number">6</div>
              <div>Click "SUBMIT DEPOSIT REQUEST"</div>
            </div>
            <div class="step">
              <div class="step-number">7</div>
              <div>Admin will verify and add funds to your account</div>
            </div>
          </div>
          
          <div style="margin-top: 30px; padding: 15px; background: rgba(251, 191, 36, 0.1); border-radius: 12px; border: 1px solid rgba(251, 191, 36, 0.3);">
            <h4 style="color: #fbbf24;">⚠️ IMPORTANT NOTES:</h4>
            <p style="color: #94a3b8; font-size: 0.9rem;">
              • Minimum deposit: 10 ETB<br>
              • Make sure to enter the exact amount you sent<br>
              • Include the correct transaction ID from Telebirr<br>
              • Funds are added manually by admin (usually within a few minutes)<br>
              • For issues, contact admin through Telegram
            </p>
          </div>
        </div>
        
        <div style="margin-top: 30px;">
          <a href="/game" class="btn" style="background: #3b82f6; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: bold;">🎮 Go to Game</a>
          <a href="/" class="btn" style="background: #64748b; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: bold; margin-left: 10px;">🏠 Home</a>
        </div>
      </div>
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

app.get('/telegram', (req, res) => {
  res.sendFile(path.join(__dirname, 'telegram.html'));
});

app.get('/health', async (req, res) => {
  try {
    const connectedPlayers = getConnectedUsers().length;
    const activeGames = await Room.countDocuments({ status: 'playing' });
    const totalUsers = await User.countDocuments();
    const rooms = await Room.countDocuments();
    const totalTransactions = await Transaction.countDocuments();
    
    const pendingDeposits = await Transaction.countDocuments({ type: 'DEPOSIT', status: 'pending' });
    const pendingWithdrawals = await Transaction.countDocuments({ type: 'WITHDRAWAL', status: 'pending' });
    
    const today = new Date().toISOString().split('T')[0];
    const dailyStats = await Stats.findOne({ date: today }) || {};
    
    res.json({
      status: 'ok',
      database: 'connected',
      connectedPlayers: connectedPlayers,
      connectedSockets: connectedSockets.size,
      totalUsers: totalUsers,
      activeGames: activeGames,
      totalRooms: rooms,
      totalTransactions: totalTransactions,
      walletSystem: 'active',
      pendingDeposits: pendingDeposits,
      pendingWithdrawals: pendingWithdrawals,
      adminTelebirr: CONFIG.ADMIN_TELEBIRR,
      minDeposit: CONFIG.MIN_DEPOSIT,
      minWithdrawal: CONFIG.MIN_WITHDRAWAL,
      dailyStats: dailyStats,
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      memoryUsage: process.memoryUsage()
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/process-deposit', async (req, res) => {
  try {
    const { transactionId, adminPassword, action } = req.body;
    
    if (adminPassword !== CONFIG.ADMIN_PASSWORD) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    const transaction = await Transaction.findOne({ _id: transactionId, type: 'DEPOSIT' });
    if (!transaction) {
      return res.status(404).json({ error: 'Transaction not found' });
    }
    
    if (action === 'approve') {
      const result = await approveDeposit(transactionId, 'API');
      res.json({ 
        success: true, 
        message: 'Deposit approved',
        user: result.user.userName,
        amount: result.transaction.amount,
        newBalance: result.user.balance
      });
    } else if (action === 'reject') {
      const result = await rejectTransaction(transactionId, 'API', 'Rejected via API');
      res.json({ 
        success: true, 
        message: 'Deposit rejected',
        transactionId: result.transaction._id
      });
    } else {
      res.status(400).json({ error: 'Invalid action' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/process-withdrawal', async (req, res) => {
  try {
    const { transactionId, adminPassword, action } = req.body;
    
    if (adminPassword !== CONFIG.ADMIN_PASSWORD) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    const transaction = await Transaction.findOne({ _id: transactionId, type: 'WITHDRAWAL' });
    if (!transaction) {
      return res.status(404).json({ error: 'Transaction not found' });
    }
    
    if (action === 'approve') {
      const result = await approveWithdrawal(transactionId, 'API');
      res.json({ 
        success: true, 
        message: 'Withdrawal approved',
        user: result.user.userName,
        amount: Math.abs(result.transaction.amount),
        telebirrNumber: result.transaction.telebirrNumber,
        newBalance: result.user.balance
      });
    } else if (action === 'reject') {
      const result = await rejectTransaction(transactionId, 'API', 'Rejected via API');
      res.json({ 
        success: true, 
        message: 'Withdrawal rejected',
        transactionId: result.transaction._id
      });
    } else {
      res.status(400).json({ error: 'Invalid action' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/user/:userId/transactions', async (req, res) => {
  try {
    const transactions = await Transaction.find({ userId: req.params.userId })
      .sort({ createdAt: -1 })
      .limit(50);
    
    res.json(transactions);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ========== START SERVER ==========
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════════════╗
║             🤖 BINGO ELITE - WALLET READY           ║
╠══════════════════════════════════════════════════════╣
║  URL:          https://bingo-telegram-game.onrender.com ║
║  Port:         ${PORT}                                ║
║  Game:         /game                                 ║
║  Admin:        /admin (password: ${CONFIG.ADMIN_PASSWORD})         ║
║  Wallet Info:  /wallet-info                          ║
║  Telegram:     /telegram                             ║
╠══════════════════════════════════════════════════════╣
║  💰 WALLET SYSTEM: ✅ ACTIVE                        ║
║  📞 Admin Telebirr: ${CONFIG.ADMIN_TELEBIRR}          ║
║  💵 Min Deposit: ${CONFIG.MIN_DEPOSIT} ETB           ║
║  💸 Min Withdrawal: ${CONFIG.MIN_WITHDRAWAL} ETB     ║
║  🎯 Four Corners Bonus: ${CONFIG.FOUR_CORNERS_BONUS} ETB       ║
║  ⏰ Game Timeout: ${CONFIG.GAME_TIMEOUT_MINUTES} minutes      ║
║  🤖 Bot: @ethio_games1_bot                          ║
╚══════════════════════════════════════════════════════╝
✅ Server ready with Wallet System and Telebirr Integration
  `);
  
  // Initial broadcast
  setTimeout(() => {
    broadcastRoomStatus();
  }, 1000);
});

// Update admin panel every 5 seconds
setInterval(updateAdminPanel, 5000);

// Clean up old transactions daily
setInterval(async () => {
  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    await Transaction.deleteMany({
      createdAt: { $lt: thirtyDaysAgo },
      status: { $in: ['approved', 'rejected'] }
    });
    console.log('🧹 Cleaned up old transactions');
  } catch (error) {
    console.error('Error cleaning up old transactions:', error);
  }
}, 24 * 60 * 60 * 1000); // Once per day
