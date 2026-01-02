// server.js - BINGO ELITE - TELEGRAM MINI APP VERSION - WITH PHONE VERIFICATION
require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const mongoose = require('mongoose');
const axios = require('axios');

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
  phoneNumber: { type: String, unique: true, sparse: true },
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

const phoneVerificationSchema = new mongoose.Schema({
  phoneNumber: { type: String, required: true, unique: true },
  userId: { type: String, required: true, unique: true },
  verified: { type: Boolean, default: false },
  verificationCode: { type: String },
  codeExpires: { type: Date },
  verificationAttempts: { type: Number, default: 0 },
  lastVerificationAttempt: { type: Date },
  createdAt: { type: Date, default: Date.now }
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
    players: Number,
    ballsDrawn: Number,
    isFourCorners: Boolean
  }]
});

const transactionSchema = new mongoose.Schema({
  type: { type: String, required: true },
  userId: { type: String, required: true },
  userName: { type: String, required: true },
  phoneNumber: { type: String },
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
const PhoneVerification = mongoose.model('PhoneVerification', phoneVerificationSchema);
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
app.use(express.urlencoded({ extended: true }));
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
  SESSION_TIMEOUT: 86400000,
  VERIFICATION_CODE_EXPIRY: 10, // minutes
  MAX_VERIFICATION_ATTEMPTS: 5,
  SMS_API_KEY: process.env.SMS_API_KEY || '',
  SMS_API_URL: process.env.SMS_API_URL || '',
  COUNTRY_CODE: process.env.COUNTRY_CODE || '+251'
};

const BINGO_LETTERS = {
  'B': { min: 1, max: 15, color: '#3b82f6' },
  'I': { min: 16, max: 30, color: '#8b5cf6' },
  'N': { min: 31, max: 45, color: '#10b981' },
  'G': { min: 46, max: 60, color: '#f59e0b' },
  'O': { min: 61, max: 75, color: '#ef4444' }
};

// ========== GLOBAL STATE ==========
let socketToUser = new Map();
let adminSockets = new Set();
let activityLog = [];
let roomTimers = new Map();
let connectedSockets = new Set();

// ========== PHONE VERIFICATION FUNCTIONS ==========
function generateVerificationCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function normalizePhoneNumber(phoneNumber) {
  // Remove any non-digit characters except leading +
  let normalized = phoneNumber.replace(/\D/g, '');
  
  // If starts with country code, keep it
  if (phoneNumber.startsWith('+')) {
    normalized = '+' + normalized;
  }
  
  // Ensure it has country code
  if (!normalized.startsWith('+')) {
    normalized = CONFIG.COUNTRY_CODE + normalized;
  }
  
  return normalized;
}

async function sendVerificationCode(phoneNumber, code) {
  try {
    // In production, you would integrate with an SMS gateway
    if (CONFIG.SMS_API_KEY && CONFIG.SMS_API_URL) {
      const response = await axios.post(CONFIG.SMS_API_URL, {
        api_key: CONFIG.SMS_API_KEY,
        phone: phoneNumber,
        message: `Your Bingo Elite verification code is: ${code}. Valid for 10 minutes.`
      });
      return response.data.success;
    } else {
      // Development mode - log to console
      console.log(`📱 Verification code for ${phoneNumber}: ${code}`);
      return true;
    }
  } catch (error) {
    console.error('Error sending verification code:', error);
    // In development, still return true to allow testing
    console.log(`📱 (DEV) Verification code for ${phoneNumber}: ${code}`);
    return true;
  }
}

async function requestPhoneVerification(phoneNumber) {
  try {
    const normalizedPhone = normalizePhoneNumber(phoneNumber);
    
    // Check if phone number is already registered and verified
    const existingVerification = await PhoneVerification.findOne({ 
      phoneNumber: normalizedPhone,
      verified: true 
    });
    
    if (existingVerification) {
      return {
        success: true,
        message: 'Phone number already verified',
        userId: existingVerification.userId,
        alreadyVerified: true
      };
    }
    
    // Check rate limiting
    const recentAttempt = await PhoneVerification.findOne({ 
      phoneNumber: normalizedPhone,
      lastVerificationAttempt: { 
        $gt: new Date(Date.now() - 60 * 1000) // 1 minute ago
      }
    });
    
    if (recentAttempt) {
      return {
        success: false,
        message: 'Please wait 1 minute before requesting another code'
      };
    }
    
    // Generate verification code
    const verificationCode = generateVerificationCode();
    const codeExpires = new Date(Date.now() + CONFIG.VERIFICATION_CODE_EXPIRY * 60 * 1000);
    
    // Generate user ID
    const userId = `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // Update or create verification record
    await PhoneVerification.findOneAndUpdate(
      { phoneNumber: normalizedPhone },
      {
        userId,
        verificationCode,
        codeExpires,
        verificationAttempts: 0,
        lastVerificationAttempt: new Date(),
        verified: false
      },
      { upsert: true, new: true }
    );
    
    // Send SMS (in production)
    const smsSent = await sendVerificationCode(normalizedPhone, verificationCode);
    
    if (!smsSent) {
      return {
        success: false,
        message: 'Failed to send verification code'
      };
    }
    
    return {
      success: true,
      message: 'Verification code sent successfully',
      userId,
      alreadyVerified: false
    };
    
  } catch (error) {
    console.error('Error in requestPhoneVerification:', error);
    return {
      success: false,
      message: 'Server error'
    };
  }
}

async function verifyPhoneCode(phoneNumber, code) {
  try {
    const normalizedPhone = normalizePhoneNumber(phoneNumber);
    
    // Find verification record
    const verification = await PhoneVerification.findOne({ 
      phoneNumber: normalizedPhone 
    });
    
    if (!verification) {
      return {
        success: false,
        message: 'Phone number not found'
      };
    }
    
    // Check if code is expired
    if (verification.codeExpires < new Date()) {
      return {
        success: false,
        message: 'Verification code expired'
      };
    }
    
    // Check verification attempts
    if (verification.verificationAttempts >= CONFIG.MAX_VERIFICATION_ATTEMPTS) {
      return {
        success: false,
        message: 'Too many verification attempts'
      };
    }
    
    // Increment attempts
    verification.verificationAttempts += 1;
    verification.lastVerificationAttempt = new Date();
    
    // Verify code
    if (verification.verificationCode !== code) {
      await verification.save();
      return {
        success: false,
        message: 'Invalid verification code'
      };
    }
    
    // Mark as verified
    verification.verified = true;
    await verification.save();
    
    return {
      success: true,
      message: 'Phone verified successfully',
      userId: verification.userId
    };
    
  } catch (error) {
    console.error('Error in verifyPhoneCode:', error);
    return {
      success: false,
      message: 'Server error'
    };
  }
}

async function getUserByPhone(phoneNumber, userName = null) {
  try {
    const normalizedPhone = normalizePhoneNumber(phoneNumber);
    
    // Check if phone is verified
    const verification = await PhoneVerification.findOne({ 
      phoneNumber: normalizedPhone,
      verified: true 
    });
    
    if (!verification) {
      return null;
    }
    
    // Find or create user
    let user = await User.findOne({ userId: verification.userId });
    
    if (!user) {
      user = new User({
        userId: verification.userId,
        phoneNumber: normalizedPhone,
        userName: userName || `Player ${normalizedPhone.substring(normalizedPhone.length - 4)}`,
        balance: CONFIG.INITIAL_BALANCE,
        referralCode: generateReferralCode(verification.userId)
      });
      await user.save();
      
      // Record first transaction
      const transaction = new Transaction({
        type: 'NEW_USER',
        userId: verification.userId,
        userName: user.userName,
        phoneNumber: normalizedPhone,
        amount: 0,
        description: 'New user registered with phone'
      });
      await transaction.save();
    }
    
    return user;
    
  } catch (error) {
    console.error('Error in getUserByPhone:', error);
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

async function getUser(identifier, userName, isPhone = false) {
  try {
    let user;
    
    if (isPhone) {
      user = await getUserByPhone(identifier, userName);
    } else {
      // Telegram or other identifier
      user = await User.findOne({ userId: identifier });
      
      if (!user) {
        user = new User({
          userId: identifier,
          userName: userName || 'Guest',
          balance: CONFIG.INITIAL_BALANCE,
          referralCode: generateReferralCode(identifier),
          telegramId: identifier.startsWith('tg_') ? identifier.replace('tg_', '') : null
        });
        await user.save();
        
        // Record first transaction
        const transaction = new Transaction({
          type: 'NEW_USER',
          userId: identifier,
          userName: userName || 'Guest',
          amount: 0,
          description: 'New user registered'
        });
        await transaction.save();
      }
    }
    
    if (user) {
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
        status: 'waiting'
      });
      await room.save();
    }
    
    return room;
  } catch (error) {
    console.error('Error getting room:', error);
    return null;
  }
}

// ========== IMPROVED REAL-TIME TRACKING FUNCTIONS ==========
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
  
  // Also check all connected sockets for users
  connectedSockets.forEach(socketId => {
    const socket = io.sockets.sockets.get(socketId);
    if (socket && socket.connected && socket.handshake && socket.handshake.query) {
      // Check if this socket has a userId in query params
      const query = socket.handshake.query;
      if (query.userId) {
        connectedUsers.push(query.userId);
      }
    }
  });
  
  // Remove duplicates
  return [...new Set(connectedUsers)];
}

// ========== BROADCAST FUNCTIONS ==========
async function broadcastRoomStatus() {
  try {
    const rooms = await Room.find({ status: { $in: ['waiting', 'starting', 'playing'] } });
    const roomStatus = {};
    
    rooms.forEach(room => {
      const commissionPerPlayer = CONFIG.HOUSE_COMMISSION[room.stake] || 0;
      const contributionPerPlayer = room.stake - commissionPerPlayer;
      const potentialPrize = contributionPerPlayer * room.players.length;
      const houseFee = commissionPerPlayer * room.players.length;
      
      roomStatus[room.stake] = {
        stake: room.stake,
        playerCount: room.players.length,
        status: room.status,
        takenBoxes: room.takenBoxes.length,
        commissionPerPlayer: commissionPerPlayer,
        contributionPerPlayer: contributionPerPlayer,
        potentialPrize: potentialPrize,
        houseFee: houseFee,
        currentBall: room.currentBall,
        ballsDrawn: room.ballsDrawn
      };
    });
    
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
      // Better online detection - check multiple sources
      let isOnline = false;
      
      // Check socketToUser map
      if (connectedUserIds.includes(user.userId)) {
        isOnline = true;
      }
      // Also check if user has been active recently (within 30 seconds)
      else if (user.lastSeen) {
        const lastSeenTime = new Date(user.lastSeen);
        const now = new Date();
        const secondsSinceLastSeen = (now - lastSeenTime) / 1000;
        
        // If user was active in last 30 seconds, consider them online
        if (secondsSinceLastSeen < 30) {
          isOnline = true;
        }
      }
      
      return {
        userId: user.userId,
        userName: user.userName,
        phoneNumber: user.phoneNumber,
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
    
    rooms.forEach(room => {
      const commissionPerPlayer = CONFIG.HOUSE_COMMISSION[room.stake] || 0;
      const contributionPerPlayer = room.stake - commissionPerPlayer;
      const potentialPrize = contributionPerPlayer * room.players.length;
      const houseFee = commissionPerPlayer * room.players.length;
      
      roomsData[room.stake] = {
        stake: room.stake,
        playerCount: room.players.length,
        takenBoxes: room.takenBoxes,
        status: room.status,
        currentBall: room.currentBall,
        ballsDrawn: room.ballsDrawn,
        commissionPerPlayer: commissionPerPlayer,
        contributionPerPlayer: contributionPerPlayer,
        potentialPrize: potentialPrize,
        houseFee: houseFee,
        players: room.players // Include player IDs
      };
    });
    
    // Calculate total house balance
    const houseBalance = await Transaction.aggregate([
      { $match: { type: { $in: ['HOUSE_EARNINGS', 'ADMIN_ADD'] } } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]).then(result => result[0]?.total || 0);
    
    // Get real-time connected sockets count
    const connectedSocketsCount = connectedSockets.size;
    
    // Send to all admin sockets
    const adminData = {
      totalPlayers: connectedPlayers, // Real-time connected players
      activeGames: activeGames,
      totalUsers: users.length,
      connectedSockets: connectedSocketsCount,
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
        // Game timeout - no one won
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
      await currentRoom.save();
      
      const ballData = {
        room: currentRoom.stake,
        num: ball,
        letter: letter
      };
      
      // Emit to all players in room
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

// Check if a player has bingo
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
    // Return funds to all players
    for (const userId of room.players) {
      const user = await User.findOne({ userId: userId });
      if (user) {
        user.balance += room.stake; // Return their stake
        user.currentRoom = null;
        user.box = null;
        await user.save();
        
        // Record transaction
        const transaction = new Transaction({
          type: 'REFUND',
          userId: userId,
          userName: user.userName,
          phoneNumber: user.phoneNumber,
          amount: room.stake,
          room: room.stake,
          description: `Game ended with no winner - stake refunded`
        });
        await transaction.save();
        
        // Notify player
        for (const [socketId, uId] of socketToUser.entries()) {
          if (uId === userId) {
            const socket = io.sockets.sockets.get(socketId);
            if (socket) {
              socket.emit('gameOver', {
                room: room.stake,
                winnerId: 'HOUSE',
                winnerName: 'House',
                prize: 0,
                bonus: 0,
                isFourCornersWin: false
              });
              socket.emit('balanceUpdate', user.balance);
            }
          }
        }
      }
    }
    
    // Update room
    room.status = 'ended';
    room.endTime = new Date();
    await room.save();
    
    broadcastRoomStatus();
    updateAdminPanel();
    
  } catch (error) {
    console.error('Error ending game with no winner:', error);
  }
}

// ========== IMPROVED SOCKET.IO EVENT HANDLERS ==========
io.on('connection', (socket) => {
  console.log(`✅ Socket.IO Connected: ${socket.id}`);
  connectedSockets.add(socket.id);
  
  // Enhanced connection logging
  const query = socket.handshake.query;
  if (query.userId) {
    console.log(`👤 User connected via query: ${query.userId}`);
  }
  
  // Send connection test immediately
  socket.emit('connectionTest', { 
    status: 'connected', 
    serverTime: new Date().toISOString(),
    socketId: socket.id,
    server: 'Bingo Elite Phone Version',
    version: '2.0'
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
      phoneNumber: user.phoneNumber,
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
      // Clear game timer
      if (roomTimers.has(roomStake)) {
        clearInterval(roomTimers.get(roomStake));
        roomTimers.delete(roomStake);
      }
      
      // Return funds to all players
      for (const userId of room.players) {
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
            phoneNumber: user.phoneNumber,
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
                  bonus: 0,
                  isFourCornersWin: false
                });
                s.emit('balanceUpdate', user.balance);
              }
            }
          }
        }
      }
      
      room.status = 'ended';
      room.endTime = new Date();
      await room.save();
      
      socket.emit('admin:success', `Force ended ${roomStake} ETB game`);
      broadcastRoomStatus();
      
      logActivity('ADMIN_FORCE_END', { adminSocket: socket.id, roomStake }, socket.id);
    }
  });
  
  // ========== PHONE VERIFICATION VIA SOCKET ==========
  socket.on('phone:requestVerification', async (phoneNumber) => {
    try {
      const result = await requestPhoneVerification(phoneNumber);
      socket.emit('phone:verificationSent', result);
      
      if (result.success) {
        logActivity('PHONE_VERIFICATION_REQUESTED', { phoneNumber });
      }
    } catch (error) {
      console.error('Error in phone verification request:', error);
      socket.emit('phone:verificationSent', {
        success: false,
        message: 'Server error'
      });
    }
  });
  
  socket.on('phone:verifyCode', async ({ phoneNumber, code }) => {
    try {
      const result = await verifyPhoneCode(phoneNumber, code);
      socket.emit('phone:verificationResult', result);
      
      if (result.success) {
        logActivity('PHONE_VERIFIED', { phoneNumber, userId: result.userId });
      }
    } catch (error) {
      console.error('Error in phone code verification:', error);
      socket.emit('phone:verificationResult', {
        success: false,
        message: 'Server error'
      });
    }
  });
  
  // ========== PLAYER INITIALIZATION WITH PHONE ==========
  socket.on('init', async (data) => {
    try {
      const { userId, phoneNumber, userName, isPhone } = data;
      
      console.log(`📱 User init: ${userName || phoneNumber} (${userId}) via socket ${socket.id}, isPhone: ${isPhone}`);
      
      let user;
      
      if (isPhone && phoneNumber) {
        // Verify phone is registered and verified
        const verification = await PhoneVerification.findOne({ 
          phoneNumber: normalizePhoneNumber(phoneNumber),
          verified: true 
        });
        
        if (!verification) {
          socket.emit('error', 'Phone number not verified');
          return;
        }
        
        user = await getUserByPhone(phoneNumber, userName);
      } else {
        // Legacy support for Telegram users
        user = await getUser(userId, userName, false);
      }
      
      if (user) {
        socketToUser.set(socket.id, user.userId);
        
        // Update user's lastSeen
        await User.findOneAndUpdate(
          { userId: user.userId },
          { 
            isOnline: true,
            lastSeen: new Date(),
            sessionCount: (user.sessionCount || 0) + 1
          }
        );
        
        socket.emit('balanceUpdate', user.balance);
        socket.emit('userData', {
          userId: user.userId,
          userName: user.userName,
          phoneNumber: user.phoneNumber,
          balance: user.balance,
          referralCode: user.referralCode
        });
        
        socket.emit('connected', { message: 'Successfully connected to Bingo Elite' });
        
        // Log the successful connection
        console.log(`✅ User connected successfully: ${user.userName} (${user.userId})`);
        
        // Update admin panel with new connection IN REAL-TIME
        updateAdminPanel();
        broadcastRoomStatus();
        
        logActivity('USER_CONNECTED', { 
          userId: user.userId, 
          userName: user.userName, 
          phoneNumber: user.phoneNumber,
          socketId: socket.id 
        });
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
  
  socket.on('getTakenBoxes', async ({ room }, callback) => {
    try {
      const roomData = await Room.findOne({ stake: parseInt(room) });
      if (roomData) {
        callback(roomData.takenBoxes || []);
      } else {
        callback([]);
      }
    } catch (error) {
      console.error('Error getting taken boxes:', error);
      callback([]);
    }
  });
  
  socket.on('joinRoom', async (data) => {
    try {
      const { room, box, userName } = data;
      const userId = socketToUser.get(socket.id);
      
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
      
      const roomData = await getRoom(room);
      if (!roomData) {
        socket.emit('error', 'Invalid room');
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
      
      // Update user balance and room info
      user.balance -= room;
      user.totalWagered = (user.totalWagered || 0) + room;
      user.currentRoom = room;
      user.box = box;
      await user.save();
      
      // Record transaction
      const transaction = new Transaction({
        type: 'STAKE',
        userId: userId,
        userName: user.userName,
        phoneNumber: user.phoneNumber,
        amount: -room,
        room: room,
        description: `Joined ${room} ETB room with ticket ${box}`
      });
      await transaction.save();
      
      // Update room
      roomData.players.push(userId);
      roomData.takenBoxes.push(box);
      
      const playerCount = roomData.players.length;
      
      // Update all players in room about lobby count
      roomData.players.forEach(playerUserId => {
        for (const [sId, uId] of socketToUser.entries()) {
          if (uId === playerUserId) {
            const s = io.sockets.sockets.get(sId);
            if (s) {
              s.emit('lobbyUpdate', {
                room: room,
                count: playerCount
              });
            }
          }
        }
      });
      
      if (playerCount >= CONFIG.MIN_PLAYERS_TO_START && roomData.status === 'waiting') {
        roomData.status = 'starting';
        await roomData.save();
        
        let countdown = CONFIG.COUNTDOWN_TIMER;
        const countdownInterval = setInterval(async () => {
          try {
            const currentRoom = await Room.findById(roomData._id);
            if (!currentRoom || currentRoom.status !== 'starting') {
              clearInterval(countdownInterval);
              return;
            }
            
            currentRoom.players.forEach(playerUserId => {
              for (const [sId, uId] of socketToUser.entries()) {
                if (uId === playerUserId) {
                  const s = io.sockets.sockets.get(sId);
                  if (s) {
                    s.emit('gameCountdown', {
                      room: room,
                      timer: countdown
                    });
                  }
                }
              }
            });
            
            countdown--;
            
            if (countdown < 0) {
              clearInterval(countdownInterval);
              currentRoom.status = 'playing';
              currentRoom.startTime = new Date();
              await currentRoom.save();
              startGameTimer(currentRoom);
            }
          } catch (error) {
            console.error('Error in countdown:', error);
            clearInterval(countdownInterval);
          }
        }, 1000);
      }
      
      await roomData.save();
      socket.emit('joinedRoom');
      socket.emit('balanceUpdate', user.balance);
      
      // Broadcast updates
      broadcastRoomStatus();
      updateAdminPanel();
      
      logActivity('ROOM_JOIN', { 
        userId, 
        userName: user.userName, 
        phoneNumber: user.phoneNumber,
        room, 
        box 
      });
      
    } catch (error) {
      console.error('Error joining room:', error);
      socket.emit('error', 'Server error while joining room');
    }
  });
  
  socket.on('claimBingo', async (data) => {
    try {
      const { room, grid, marked } = data;
      const userId = socketToUser.get(socket.id);
      
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
      
      // Check if bingo is valid
      const bingoCheck = checkBingo(marked, grid);
      if (!bingoCheck.isBingo) {
        socket.emit('error', 'Invalid bingo claim');
        return;
      }
      
      const isFourCornersWin = bingoCheck.isFourCorners;
      const commission = CONFIG.HOUSE_COMMISSION[room] || 0;
      const contribution = room - commission;
      const prizePool = contribution * roomData.players.length;
      
      // Calculate winnings
      let prize = prizePool;
      let bonus = 0;
      
      if (isFourCornersWin) {
        bonus = CONFIG.FOUR_CORNERS_BONUS;
        prize += bonus;
      }
      
      // Update user balance
      user.balance += prize;
      user.totalWins = (user.totalWins || 0) + 1;
      user.totalBingos = (user.totalBingos || 0) + 1;
      user.currentRoom = null;
      user.box = null;
      await user.save();
      
      // Record transaction
      const transactionType = isFourCornersWin ? 'WIN_FOUR_CORNERS' : 'WIN';
      const transaction = new Transaction({
        type: transactionType,
        userId: userId,
        userName: user.userName,
        phoneNumber: user.phoneNumber,
        amount: prize,
        room: room,
        description: `Bingo win in ${room} ETB room${isFourCornersWin ? ' (Four Corners Bonus)' : ''}`
      });
      await transaction.save();
      
      // Record house earnings
      const houseEarnings = commission * roomData.players.length;
      const houseTransaction = new Transaction({
        type: 'HOUSE_EARNINGS',
        userId: 'HOUSE',
        userName: 'House',
        phoneNumber: 'SYSTEM',
        amount: houseEarnings,
        room: room,
        description: `Commission from ${roomData.players.length} players in ${room} ETB room`
      });
      await houseTransaction.save();
      
      // Update room
      roomData.status = 'ended';
      roomData.endTime = new Date();
      roomData.gameHistory.push({
        timestamp: new Date(),
        winner: userId,
        winnerName: user.userName,
        prize: prize,
        players: roomData.players.length,
        ballsDrawn: roomData.ballsDrawn,
        isFourCorners: isFourCornersWin
      });
      await roomData.save();
      
      // Clear game timer
      if (roomTimers.has(room)) {
        clearInterval(roomTimers.get(room));
        roomTimers.delete(room);
      }
      
      // Notify all players in the room
      roomData.players.forEach(playerUserId => {
        for (const [sId, uId] of socketToUser.entries()) {
          if (uId === playerUserId) {
            const s = io.sockets.sockets.get(sId);
            if (s) {
              if (uId === userId) {
                // Winner
                s.emit('gameOver', {
                  room: room,
                  winnerId: userId,
                  winnerName: user.userName,
                  prize: prize,
                  bonus: bonus,
                  isFourCornersWin: isFourCornersWin
                });
                s.emit('balanceUpdate', user.balance);
              } else {
                // Loser
                s.emit('gameOver', {
                  room: room,
                  winnerId: userId,
                  winnerName: user.userName,
                  prize: prize,
                  bonus: bonus,
                  isFourCornersWin: isFourCornersWin
                });
                
                // Reset their room status
                User.findOneAndUpdate(
                  { userId: uId },
                  { 
                    currentRoom: null,
                    box: null,
                    isOnline: true,
                    lastSeen: new Date()
                  }
                ).catch(console.error);
              }
            }
          }
        }
      });
      
      broadcastRoomStatus();
      updateAdminPanel();
      
      logActivity('BINGO_WIN', { 
        userId, 
        userName: user.userName, 
        phoneNumber: user.phoneNumber,
        room, 
        prize, 
        bonus, 
        isFourCorners: isFourCornersWin 
      });
      
    } catch (error) {
      console.error('Error in claimBingo:', error);
      socket.emit('error', 'Server error processing bingo claim');
    }
  });
  
  socket.on('player:activity', async (data) => {
    const userId = socketToUser.get(socket.id);
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
  
  socket.on('disconnect', () => {
    console.log(`❌ Socket.IO Disconnected: ${socket.id}`);
    connectedSockets.delete(socket.id);
    adminSockets.delete(socket.id);
    
    const userId = socketToUser.get(socket.id);
    if (userId) {
      User.findOneAndUpdate(
        { userId: userId },
        { 
          isOnline: false,
          lastSeen: new Date() 
        }
      ).then(() => {
        console.log(`👤 User went offline: ${userId}`);
      }).catch(console.error);
      
      socketToUser.delete(socket.id);
    }
    
    // Update admin panel on disconnect IN REAL-TIME
    updateAdminPanel();
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

// Clean up expired verification codes
setInterval(async () => {
  try {
    const expiredTime = new Date(Date.now() - CONFIG.VERIFICATION_CODE_EXPIRY * 60 * 1000);
    await PhoneVerification.deleteMany({
      verified: false,
      codeExpires: { $lt: expiredTime }
    });
    console.log('🧹 Cleaned up expired verification codes');
  } catch (error) {
    console.error('Error cleaning up verification codes:', error);
  }
}, 300000); // Every 5 minutes

// ========== EXPRESS ROUTES ==========
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Bingo Elite - Phone Verification Version</title>
      <style>
        body { font-family: Arial, sans-serif; padding: 40px; text-align: center; background: #0f172a; color: #f8fafc; }
        .container { max-width: 800px; margin: 0 auto; }
        .status { padding: 30px; background: #1e293b; border-radius: 20px; margin: 30px auto; border: 1px solid #334155; }
        .stats-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 20px; margin: 30px 0; }
        .stat { background: rgba(255,255,255,0.05); padding: 20px; border-radius: 12px; }
        .stat-value { font-size: 2.5rem; font-weight: 900; margin: 10px 0; }
        .stat-label { font-size: 0.9rem; color: #94a3b8; text-transform: uppercase; letter-spacing: 1px; }
        .btn { display: inline-block; padding: 15px 30px; margin: 10px; background: #3b82f6; color: white; text-decoration: none; border-radius: 12px; font-weight: bold; transition: all 0.3s; }
        .btn:hover { background: #2563eb; transform: translateY(-2px); }
        .btn-admin { background: #ef4444; }
        .btn-admin:hover { background: #dc2626; }
        .btn-game { background: #10b981; }
        .btn-game:hover { background: #059669; }
      </style>
    </head>
    <body>
      <div class="container">
        <h1 style="font-size: 3rem; margin-bottom: 20px;">📱 Bingo Elite Phone Version</h1>
        <p style="color: #94a3b8; font-size: 1.2rem;">Real-time multiplayer Bingo with Phone Verification</p>
        
        <div class="status">
          <h2 style="color: #10b981;">🚀 Server Status: RUNNING</h2>
          <div class="stats-grid">
            <div class="stat">
              <div class="stat-label">Connected Players</div>
              <div class="stat-value" id="playerCount">${connectedSockets.size}</div>
            </div>
            <div class="stat">
              <div class="stat-label">Phone Users</div>
              <div class="stat-value" style="color: #10b981;">✅ Active</div>
            </div>
          </div>
          <p style="margin-top: 20px; color: #f59e0b; font-weight: bold;">📱 Phone Verification Required to Play</p>
          <p style="color: #64748b; margin-top: 10px;">Server Time: ${new Date().toLocaleString()}</p>
          <p style="color: #10b981;">✅ Phone Verification System Ready</p>
        </div>
        
        <div style="margin-top: 40px;">
          <h3>Access Points:</h3>
          <div>
            <a href="/admin" class="btn btn-admin" target="_blank">🔒 Admin Panel</a>
            <a href="/game" class="btn btn-game" target="_blank">📱 Game Client</a>
          </div>
          <div style="margin-top: 20px;">
            <a href="/health" class="btn" style="background: #64748b;" target="_blank">📊 Health Check</a>
            <a href="/debug-connections" class="btn" style="background: #f59e0b;" target="_blank">🔍 Debug Connections</a>
          </div>
        </div>
        
        <div style="margin-top: 40px; padding: 20px; background: rgba(255,255,255,0.03); border-radius: 12px;">
          <h4>Phone Verification Information</h4>
          <p style="color: #94a3b8; font-size: 0.9rem;">
            Version: 2.0.0 (Phone Verification Required)<br>
            Database: MongoDB Atlas<br>
            Socket.IO: ✅ Connected Sockets: ${connectedSockets.size}<br>
            Phone Verification: ✅ Active<br>
            Default Country Code: ${CONFIG.COUNTRY_CODE}<br>
            Game Timer: ${CONFIG.GAME_TIMER}s between balls
          </p>
        </div>
      </div>
      
      <script>
        // Real-time player count update
        const socket = io();
        socket.on('connect', () => {
          document.getElementById('playerCount').textContent = 'Connected';
        });
      </script>
    </body>
    </html>
  `);
});

// Phone verification API endpoints
app.post('/api/request-verification', express.json(), async (req, res) => {
  try {
    const { phoneNumber } = req.body;
    
    if (!phoneNumber) {
      return res.status(400).json({ error: 'Phone number required' });
    }
    
    const result = await requestPhoneVerification(phoneNumber);
    
    if (result.success) {
      res.json({
        success: true,
        message: result.message,
        userId: result.userId,
        alreadyVerified: result.alreadyVerified
      });
    } else {
      res.status(400).json({ error: result.message });
    }
  } catch (error) {
    console.error('Error in request-verification:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/verify-phone', express.json(), async (req, res) => {
  try {
    const { phoneNumber, code } = req.body;
    
    if (!phoneNumber || !code) {
      return res.status(400).json({ error: 'Phone number and code required' });
    }
    
    const result = await verifyPhoneCode(phoneNumber, code);
    
    if (result.success) {
      res.json({
        success: true,
        message: result.message,
        userId: result.userId
      });
    } else {
      res.status(400).json({ error: result.message });
    }
  } catch (error) {
    console.error('Error in verify-phone:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Check if phone is verified
app.get('/api/check-phone/:phoneNumber', async (req, res) => {
  try {
    const normalizedPhone = normalizePhoneNumber(req.params.phoneNumber);
    
    const verification = await PhoneVerification.findOne({ 
      phoneNumber: normalizedPhone,
      verified: true 
    });
    
    if (verification) {
      const user = await User.findOne({ userId: verification.userId });
      res.json({
        verified: true,
        userId: verification.userId,
        userName: user ? user.userName : null,
        balance: user ? user.balance : 0
      });
    } else {
      res.json({ verified: false });
    }
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

app.get('/game', (req, res) => {
  res.sendFile(path.join(__dirname, 'game.html'));
});

app.get('/health', async (req, res) => {
  try {
    const connectedPlayers = getConnectedUsers().length;
    const activeGames = await Room.countDocuments({ status: 'playing' });
    const totalUsers = await User.countDocuments();
    const rooms = await Room.countDocuments();
    const totalTransactions = await Transaction.countDocuments();
    const phoneVerifications = await PhoneVerification.countDocuments({ verified: true });
    
    res.json({
      status: 'ok',
      database: 'connected',
      connectedPlayers: connectedPlayers,
      connectedSockets: connectedSockets.size,
      socketToUser: socketToUser.size,
      totalUsers: totalUsers,
      phoneUsers: phoneVerifications,
      activeGames: activeGames,
      totalRooms: rooms,
      totalTransactions: totalTransactions,
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      memoryUsage: process.memoryUsage(),
      nodeVersion: process.version,
      phoneVerification: true,
      serverUrl: 'https://bingo-telegram-game.onrender.com'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API endpoint to get user balance
app.get('/api/user/:userId', async (req, res) => {
  try {
    const user = await User.findOne({ userId: req.params.userId });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json({
      userId: user.userId,
      phoneNumber: user.phoneNumber,
      userName: user.userName,
      balance: user.balance,
      isOnline: user.isOnline,
      lastSeen: user.lastSeen,
      telegramId: user.telegramId
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API endpoint to add funds (for admin)
app.post('/api/add-funds', async (req, res) => {
  try {
    const { userId, amount, adminPassword } = req.body;
    
    if (adminPassword !== CONFIG.ADMIN_PASSWORD) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    const user = await User.findOne({ userId: userId });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    user.balance += parseFloat(amount);
    await user.save();
    
    // Record transaction
    const transaction = new Transaction({
      type: 'ADMIN_ADD',
      userId: userId,
      userName: user.userName,
      phoneNumber: user.phoneNumber,
      amount: amount,
      admin: true,
      description: `Admin added ${amount} ETB via API`
    });
    await transaction.save();
    
    res.json({
      success: true,
      message: `Added ${amount} ETB to ${user.userName}`,
      newBalance: user.balance
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Real-time tracking test endpoint
app.get('/real-time-status', async (req, res) => {
  try {
    const connectedPlayers = getConnectedUsers().length;
    const connectedSocketsCount = connectedSockets.size;
    const socketToUserSize = socketToUser.size;
    
    res.json({
      connectedPlayers: connectedPlayers,
      connectedSockets: connectedSocketsCount,
      socketToUserSize: socketToUserSize,
      socketToUser: Array.from(socketToUser.entries()),
      adminSockets: Array.from(adminSockets),
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.json({ error: error.message });
  }
});

// ========== DEBUG CONNECTION ENDPOINT ==========
app.get('/debug-connections', async (req, res) => {
  try {
    const connectedUserIds = getConnectedUsers();
    const socketToUserArray = Array.from(socketToUser.entries());
    const connectedSocketsArray = Array.from(connectedSockets);
    
    // Get user details
    const usersWithDetails = await Promise.all(
      connectedUserIds.map(async userId => {
        const user = await User.findOne({ userId });
        return user ? {
          userId: user.userId,
          phoneNumber: user.phoneNumber,
          userName: user.userName,
          balance: user.balance,
          isOnline: user.isOnline
        } : { userId, phoneNumber: null, userName: 'Unknown' };
      })
    );
    
    res.json({
      timestamp: new Date().toISOString(),
      totalConnectedUsers: connectedUserIds.length,
      connectedUsers: usersWithDetails,
      socketToUserCount: socketToUser.size,
      socketToUser: socketToUserArray.map(([socketId, userId]) => ({ socketId, userId })),
      connectedSocketsCount: connectedSockets.size,
      connectedSockets: connectedSocketsArray.map(socketId => {
        const socket = io.sockets.sockets.get(socketId);
        return {
          socketId,
          connected: socket?.connected || false,
          userId: socketToUser.get(socketId) || 'unknown',
          handshakeQuery: socket?.handshake?.query || {}
        };
      }),
      adminSocketsCount: adminSockets.size,
      adminSockets: Array.from(adminSockets)
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get all verified phone users
app.get('/api/phone-users', async (req, res) => {
  try {
    const users = await User.find({ phoneNumber: { $exists: true, $ne: null } })
      .sort({ balance: -1 })
      .limit(100);
    
    res.json(users.map(user => ({
      userId: user.userId,
      phoneNumber: user.phoneNumber,
      userName: user.userName,
      balance: user.balance,
      isOnline: user.isOnline,
      lastSeen: user.lastSeen,
      totalWagered: user.totalWagered,
      totalWins: user.totalWins
    })));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Test SMS sending
app.get('/test-sms/:phoneNumber', async (req, res) => {
  try {
    const phoneNumber = req.params.phoneNumber;
    const code = generateVerificationCode();
    
    const result = await sendVerificationCode(phoneNumber, code);
    
    res.json({
      success: result,
      phoneNumber: phoneNumber,
      code: code,
      message: result ? 'SMS sent successfully' : 'Failed to send SMS'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ========== TELEGRAM BOT INTEGRATION (Optional) ==========
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN || '';

if (TELEGRAM_TOKEN) {
  // Simple Telegram webhook
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
          // For Telegram users, we can still support them but require phone verification
          const responseText = `🎮 *Welcome to Bingo Elite, ${userName}!*\n\n` +
                              `📱 *Phone Verification Required*\n` +
                              `To play Bingo Elite, you need to verify your phone number.\n\n` +
                              `Please visit: https://bingo-telegram-game.onrender.com/game\n\n` +
                              `Enter your phone number to receive a verification code.`;
          
          // In production, you would send this via Telegram API
          console.log(`Telegram user ${userName} (@${username}) needs phone verification`);
        }
      }
      
      res.sendStatus(200);
    } catch (error) {
      console.error('Telegram webhook error:', error);
      res.sendStatus(200);
    }
  });
}

// ========== START SERVER ==========
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════════════╗
║        📱 BINGO ELITE - PHONE VERIFICATION          ║
╠══════════════════════════════════════════════════════╣
║  URL:          https://bingo-telegram-game.onrender.com ║
║  Port:         ${PORT}                                ║
║  Game:         /game                                 ║
║  Admin:        /admin (password: admin1234)         ║
║  Phone API:    /api/request-verification            ║
║  Health:       /health                              ║
║  Real-Time:    /real-time-status                    ║
║  Debug:        /debug-connections                   ║
╠══════════════════════════════════════════════════════╣
║  🔑 Admin Password: ${process.env.ADMIN_PASSWORD || 'admin1234'} ║
║  📱 Phone Verification: ✅ Required               ║
║  📡 WebSocket: ✅ Ready for phone connections     ║
║  🎮 Four Corners Bonus: ${CONFIG.FOUR_CORNERS_BONUS} ETB       ║
║  📞 Default Country: ${CONFIG.COUNTRY_CODE}                 ║
╚══════════════════════════════════════════════════════╝
✅ Server ready for PHONE-BASED player tracking
  `);
  
  // Initial broadcast
  setTimeout(() => {
    broadcastRoomStatus();
  }, 1000);
  
  // Log startup stats
  setTimeout(async () => {
    try {
      const totalUsers = await User.countDocuments();
      const phoneUsers = await PhoneVerification.countDocuments({ verified: true });
      console.log(`📊 Startup Stats: ${totalUsers} total users, ${phoneUsers} verified phone users`);
    } catch (error) {
      console.log('⚠️ Could not fetch startup stats');
    }
  }, 2000);
});
