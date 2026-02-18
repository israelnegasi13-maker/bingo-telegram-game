// server.js - BINGO ELITE + KENO ULTRA + CRASH GAME + AGENT SYSTEM - TELEGRAM MINI APP - MAIN SERVER FILE
require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const mongoose = require('mongoose');
const fetch = require('node-fetch');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const fs = require('fs');
const crypto = require('crypto');  // added for generating app user IDs

// Import game logic modules
const gameLogic = require('./game-logic');
const kenoLogic = require('./keno-logic');
// ========== NEW: Import Crash Game ==========
const crashLogic = require('./crash-logic');

// Import Agent System
const AgentSystem = require('./agent-logic');

// Rate limiting for API endpoints
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.'
});

// ========== MONGODB CONNECTION WITH RETRY LOGIC ==========
const MAX_RETRIES = 5;
const RETRY_DELAY = 5000; // 5 seconds

async function connectWithRetry(retries = MAX_RETRIES) {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/bingo', {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
      maxPoolSize: 50,
      minPoolSize: 10,
      family: 4 // Use IPv4, skip trying IPv6
    });
    console.log('✅ MongoDB Connected');
    await initializeTelebirrNumber();
  } catch (err) {
    console.error('❌ MongoDB Connection Error:', err.message);
    
    if (retries > 0) {
      console.log(`🔄 Retrying connection in ${RETRY_DELAY/1000} seconds... (${retries} retries left)`);
      setTimeout(() => connectWithRetry(retries - 1), RETRY_DELAY);
    } else {
      console.error('❌ Failed to connect to MongoDB after multiple attempts');
      // Don't exit in production, let the server run in degraded mode
    }
  }
}

connectWithRetry();

// ========== CREATE REQUIRED DIRECTORIES AND FILES ==========
const requiredDirs = ['public', 'assets/images', 'assets/sounds']; // added assets subfolders
const requiredFiles = {
  'public/index.html': `<!DOCTYPE html>
<html>
<head>
  <title>Bingo Elite + Keno Ultra + Crash + Agent System</title>
  <style>
    body { font-family: Arial, sans-serif; padding: 40px; text-align: center; background: #0f172a; color: #f8fafc; }
    .container { max-width: 800px; margin: 0 auto; }
    .btn { display: inline-block; padding: 12px 24px; margin: 10px; background: #3b82f6; color: white; text-decoration: none; border-radius: 8px; font-weight: bold; }
  </style>
</head>
<body>
  <div class="container">
    <h1>🎮 Bingo Elite + Keno Ultra + Crash + Agent System</h1>
    <p>Server is running successfully!</p>
    <div>
      <a href="/admin" class="btn" style="background: #ef4444;">🔒 Admin Panel</a>
      <a href="/agent" class="btn" style="background: #f59e0b;">👑 Agent Portal</a>
      <a href="/telegram" class="btn" style="background: #8b5cf6;">🤖 Telegram Entry</a>
      <a href="/game" class="btn" style="background: #10b981;">🎮 Play Bingo</a>
      <a href="/keno" class="btn" style="background: #8b5cf6;">🎰 Play Keno</a>
      <a href="/crash" class="btn" style="background: #f97316;">✈️ Play Crash</a>
    </div>
  </div>
</body>
</html>`,
  'public/game.html': `<!DOCTYPE html>
<html>
<head>
  <title>Bingo Elite</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { margin: 0; padding: 0; font-family: Arial; background: #0f172a; color: white; }
    .container { padding: 20px; text-align: center; }
  </style>
</head>
<body>
  <div class="container">
    <h1>🎱 Bingo Elite</h1>
    <p>Loading game...</p>
    <p><a href="/" style="color: #3b82f6;">← Back to Home</a></p>
  </div>
  <script src="/socket.io/socket.io.js"></script>
  <script>
    const socket = io();
    // Read userId and name from URL (passed from /telegram or /app)
    const urlParams = new URLSearchParams(window.location.search);
    const userId = urlParams.get('userId');
    const name = urlParams.get('name') || 'Player';

    if (userId) {
      socket.emit('init', { userId, userName: name });
      console.log('Sent init for', userId);
    } else {
      console.warn('No userId in URL – please log in via /telegram or /app');
    }

    socket.on('initSuccess', (data) => {
      console.log('User initialized:', data);
      document.querySelector('h1').textContent = 'Welcome, ' + data.userName;
    });

    socket.on('error', (err) => {
      console.error('Socket error:', err);
    });
  </script>
</body>
</html>`,
  'public/keno.html': `<!DOCTYPE html>
<html>
<head>
  <title>Keno Ultra</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { margin: 0; padding: 0; font-family: Arial; background: #0f172a; color: white; }
    .container { padding: 20px; text-align: center; }
  </style>
</head>
<body>
  <div class="container">
    <h1>🎰 Keno Ultra</h1>
    <p>Loading game...</p>
    <p><a href="/" style="color: #3b82f6;">← Back to Home</a></p>
  </div>
  <script src="/socket.io/socket.io.js"></script>
  <script>
    const socket = io();
    const urlParams = new URLSearchParams(window.location.search);
    const userId = urlParams.get('userId');
    const name = urlParams.get('name') || 'Player';

    if (userId) {
      socket.emit('init', { userId, userName: name });
      console.log('Sent init for', userId);
    }

    socket.on('initSuccess', (data) => {
      console.log('User initialized:', data);
      document.querySelector('h1').textContent = 'Welcome, ' + data.userName;
    });
  </script>
</body>
</html>`,
  'public/admin.html': `<!DOCTYPE html>
<html>
<head>
  <title>Admin Panel</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { margin: 0; padding: 0; font-family: Arial; background: #0f172a; color: white; }
    .container { padding: 20px; text-align: center; }
  </style>
</head>
<body>
  <div class="container">
    <h1>🔒 Admin Panel</h1>
    <p>Loading admin panel...</p>
    <p><a href="/" style="color: #3b82f6;">← Back to Home</a></p>
  </div>
  <script src="/socket.io/socket.io.js"></script>
  <script>
    const socket = io();
    console.log('Admin panel loading...');
  </script>
</body>
</html>`
};

// Create directories and files if they don't exist
requiredDirs.forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`✅ Created directory: ${dir}`);
  }
});

Object.entries(requiredFiles).forEach(([filePath, content]) => {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, content);
    console.log(`✅ Created missing file: ${filePath}`);
  }
});

// ========== MONGODB MODELS ==========
// User Schema
const userSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true },
  userName: { type: String, required: true },
  password: { type: String, select: false }, // Added for app login (hashed)
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
  phoneNumber: { type: String },
  // Agent System fields
  agentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Agent', default: null },
  agentReferredAt: { type: Date, default: null },
  referredBy: { type: String, default: null }, // 'telegram_link', 'manual', 'bulk_manual', 'admin_assigned'
  agentCommissionEarned: { type: Number, default: 0 }
});

// Room Schema
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
    basePrize: Number,
    agentCommission: { type: Number, default: 0 } // Agent commission from this game
  }],
  lastBoxUpdate: { type: Date, default: Date.now },
  countdownStartTime: { type: Date, default: null },
  countdownStartedWith: { type: Number, default: 0 }
});

// Transaction Schema
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
  createdAt: { type: Date, default: Date.now },
  // Agent System fields
  agentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Agent', default: null },
  agentCommission: { type: Number, default: 0 },
  commissionProcessed: { type: Boolean, default: false }
});

// Stats Schema
const statsSchema = new mongoose.Schema({
  date: { type: String, required: true, unique: true },
  totalWagered: { type: Number, default: 0 },
  totalEarnings: { type: Number, default: 0 },
  totalGames: { type: Number, default: 0 },
  totalUsers: { type: Number, default: 0 },
  newUsers: { type: Number, default: 0 },
  totalBingos: { type: Number, default: 0 },
  totalFourCorners: { type: Number, default: 0 },
  totalKenoWagered: { type: Number, default: 0 },
  totalKenoEarnings: { type: Number, default: 0 },
  totalKenoGames: { type: Number, default: 0 },
  totalKenoWins: { type: Number, default: 0 },
  // Crash Game stats
  totalCrashWagered: { type: Number, default: 0 },
  totalCrashPayouts: { type: Number, default: 0 },
  totalCrashGames: { type: Number, default: 0 },
  totalCrashPlayers: { type: Number, default: 0 },
  // Agent System stats
  agentCommissions: { type: Number, default: 0 },
  agentReferrals: { type: Number, default: 0 },
  activeAgents: { type: Number, default: 0 }
});

// Setting model for storing Telebirr number and other settings
const settingSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  value: { type: mongoose.Schema.Types.Mixed, required: true },
  updatedAt: { type: Date, default: Date.now }
});

// ========== AGENT SYSTEM MODELS ==========
// Agent Schema
const agentSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true, lowercase: true },
  password: { type: String, required: true },
  name: { type: String, required: true },
  phoneNumber: { type: String },
  commissionRateBingo: { type: Number, default: 40 }, // 40% commission
  commissionRateKeno: { type: Number, default: 10 }, // 10% commission
  commissionRateCrash: { type: Number, default: 10 }, // 10% commission for Crash
  totalEarnings: { type: Number, default: 0 },
  totalReferrals: { type: Number, default: 0 },
  activeReferrals: { type: Number, default: 0 },
  referralCode: { type: String, unique: true },
  isActive: { type: Boolean, default: true },
  isSuperAdmin: { type: Boolean, default: false },
  lastLogin: { type: Date },
  lastCommissionDate: { type: Date },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// Agent Commission Schema
const agentCommissionSchema = new mongoose.Schema({
  agentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Agent', required: true },
  userId: { type: String, required: true },
  // 🛠️ FIXED: Added transactionKey with unique sparse index to prevent duplicate commissions
  transactionKey: { type: String, sparse: true, unique: true },
  userName: { type: String },
  telegramUsername: { type: String },
  gameType: { type: String, enum: ['BINGO', 'KENO', 'CRASH'], required: true }, // added CRASH
  stake: { type: Number, required: true },
  winningAmount: { type: Number, required: true },
  commissionRate: { type: Number, required: true },
  commissionAmount: { type: Number, required: true },
  status: { type: String, enum: ['pending', 'completed', 'failed'], default: 'completed' },
  createdAt: { type: Date, default: Date.now }
});

// 🛠️ FIXED: Ensure unique index on transactionKey (already defined with unique:true, but explicit index is safer)
agentCommissionSchema.index({ transactionKey: 1 }, { unique: true, sparse: true });

// Agent Transaction Schema
const agentTransactionSchema = new mongoose.Schema({
  agentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Agent', required: true },
  type: { type: String, enum: ['COMMISSION', 'WITHDRAWAL', 'BONUS'], required: true },
  amount: { type: Number, required: true },
  description: { type: String },
  status: { type: String, enum: ['pending', 'completed', 'failed'], default: 'pending' },
  createdAt: { type: Date, default: Date.now },
  // 🛠️ FIXED: Added fields for withdrawal audit trail
  processedAt: { type: Date },
  processedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Agent' }
});

// Referral Schema (for tracking referral methods)
const referralSchema = new mongoose.Schema({
  agentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Agent', required: true },
  userId: { type: String, required: true },
  userName: { type: String },
  referralMethod: { 
    type: String, 
    enum: ['telegram_link', 'manual', 'bulk_manual', 'admin_assigned'], 
    required: true 
  },
  referralCode: { type: String },
  status: { type: String, enum: ['active', 'inactive'], default: 'active' },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// Create indexes for faster queries
referralSchema.index({ agentId: 1, createdAt: -1 });
referralSchema.index({ userId: 1 }, { unique: true });
referralSchema.index({ referralCode: 1 });

// Create all models
const User = mongoose.model('User', userSchema);
const Room = mongoose.model('Room', roomSchema);
const Transaction = mongoose.model('Transaction', transactionSchema);
const Stats = mongoose.model('Stats', statsSchema);
const Setting = mongoose.model('Setting', settingSchema);
const Agent = mongoose.model('Agent', agentSchema);
const AgentCommission = mongoose.model('AgentCommission', agentCommissionSchema);
const AgentTransaction = mongoose.model('AgentTransaction', agentTransactionSchema);
const Referral = mongoose.model('Referral', referralSchema);

// ========== TELEBIRR NUMBER DATABASE FUNCTIONS ==========
async function getTelebirrNumber() {
  try {
    const setting = await Setting.findOne({ key: 'telebirrNumber' });
    if (!setting) {
      // Initialize if not exists
      await initializeTelebirrNumber();
      const newSetting = await Setting.findOne({ key: 'telebirrNumber' });
      return newSetting ? newSetting.value : '0962577855';
    }
    return setting.value;
  } catch (err) {
    console.error('❌ Error getting Telebirr number:', err);
    return '0962577855';
  }
}

async function updateTelebirrNumber(newNumber) {
  try {
    // Validate Ethiopian phone number format
    if (!/^09[0-9]{8}$/.test(newNumber)) {
      throw new Error('Invalid phone number format. Must be 09xxxxxxxx (10 digits)');
    }
    
    const result = await Setting.findOneAndUpdate(
      { key: 'telebirrNumber' },
      { 
        value: newNumber, 
        updatedAt: new Date() 
      },
      { 
        upsert: true, 
        new: true,
        setDefaultsOnInsert: true 
      }
    );
    
    console.log(`✅ Telebirr number updated to: ${newNumber}`);
    
    // Update game logic
    if (gameLogic && gameLogic.setTelebirrNumber) {
      gameLogic.setTelebirrNumber(newNumber);
    }
    
    return result;
  } catch (err) {
    console.error('❌ Error updating Telebirr number:', err);
    throw err;
  }
}

async function initializeTelebirrNumber() {
  try {
    const exists = await Setting.findOne({ key: 'telebirrNumber' });
    if (!exists) {
      await Setting.create({
        key: 'telebirrNumber',
        value: '0962577855',
        updatedAt: new Date()
      });
      console.log('✅ Default Telebirr number initialized: 0962577855');
      
      // Update game logic with initial value
      if (gameLogic && gameLogic.setTelebirrNumber) {
        gameLogic.setTelebirrNumber('0962577855');
      }
    } else {
      console.log(`✅ Telebirr number loaded from DB: ${exists.value}`);
      
      // Update game logic with loaded value
      if (gameLogic && gameLogic.setTelebirrNumber) {
        gameLogic.setTelebirrNumber(exists.value);
      }
    }
  } catch (err) {
    console.error('❌ Error initializing Telebirr number:', err);
  }
}

const app = express();
const server = http.createServer(app);

// ========== SOCKET.IO CONFIGURATION ==========
const io = socketIo(server, {
  cors: {
    origin: process.env.NODE_ENV === 'production' 
      ? ["https://*.telegram.org", "https://web.telegram.org", "https://bingo-telegram-game.onrender.com"]
      : "*",
    methods: ["GET", "POST"],
    credentials: true
  },
  transports: ['websocket', 'polling'],
  pingTimeout: 60000,
  pingInterval: 25000,
  allowEIO3: true,
  cookie: false,
  maxHttpBufferSize: 1e7
});

// Handle Socket.IO connection errors
io.engine.on("connection_error", (err) => {
  console.log('Socket.IO connection error:', err.req, err.code, err.message, err.context);
});

// ========== MIDDLEWARE ==========
app.use(cors({
  origin: process.env.NODE_ENV === 'production'
    ? ["https://*.telegram.org", "https://web.telegram.org", "https://bingo-telegram-game.onrender.com"]
    : "*",
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  credentials: true,
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://telegram.org"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://telegram.org", "https://*.telegram.org"],
      connectSrc: ["'self'", "wss://*.telegram.org", "https://*.telegram.org", "https://api.telegram.org"],
      frameSrc: ["'self'", "https://*.telegram.org"],
      imgSrc: ["'self'", "data:", "https://*.telegram.org", "https://api.qrserver.com"]
    }
  },
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Static files with proper caching
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: process.env.NODE_ENV === 'production' ? '1d' : 0,
  setHeaders: (res, path) => {
    if (path.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
  }
}));

// ========== NEW: Serve assets folder for images and sounds ==========
app.use('/assets', express.static(path.join(__dirname, 'assets')));

// Security headers for Telegram
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Content-Security-Policy', "frame-ancestors 'self' https://*.telegram.org https://web.telegram.org");
  res.header('X-Frame-Options', 'ALLOW-FROM https://telegram.org');
  res.header('X-Content-Type-Options', 'nosniff');
  res.header('X-XSS-Protection', '1; mode=block');
  
  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  next();
});

// Apply rate limiting to API routes
app.use('/api/', apiLimiter);

// ========== INITIALIZE GAME LOGIC ==========
// Prepare models object for game logic
const models = {
  User,
  Room,
  Transaction,
  Stats,
  Setting,
  Agent,
  AgentCommission,
  AgentTransaction,
  Referral
};

// Ensure MIN_DEPOSIT is set in game logic
if (gameLogic && gameLogic.CONFIG) {
  gameLogic.CONFIG.MIN_DEPOSIT = gameLogic.CONFIG.MIN_DEPOSIT || 10;
}

// Pass database models and Telebirr number functions to game logic
if (gameLogic && gameLogic.initialize) {
  gameLogic.initialize(io, { 
    ...models,
    getTelebirrNumber, // Pass the function
    updateTelebirrNumber // Pass the function
  });
}

// Initialize Keno logic
if (kenoLogic && kenoLogic.initialize) {
  kenoLogic.initialize(io, {
    User,
    Transaction,
    Stats,
    Agent,
    AgentCommission,
    Referral
  });
}

// ========== NEW: Initialize Crash Game ==========
if (crashLogic && crashLogic.initialize) {
  crashLogic.initialize(io, models);
}

// Initialize Agent System
const agentSystem = new AgentSystem(io, models);
if (agentSystem && agentSystem.initialize) {
  agentSystem.initialize();
}

// Set game logic references in agent system
if (agentSystem && agentSystem.setGameLogic) {
  agentSystem.setGameLogic(gameLogic);
}

if (agentSystem && agentSystem.setKenoLogic) {
  agentSystem.setKenoLogic(kenoLogic);
}

// Load initial Telebirr number into game logic
(async () => {
  const telebirrNumber = await getTelebirrNumber();
  console.log(`📱 Initial Telebirr number loaded: ${telebirrNumber}`);
})();

// ========== SOCKET.IO EVENT HANDLERS ==========
io.on('connection', (socket) => {
  console.log(`🔌 New connection: ${socket.id}`);
  
  // Set timeout for authentication
  const authTimeout = setTimeout(() => {
    if (!socket.admin && !socket.agentId && !socket.userId) {
      console.log(`⏰ Authentication timeout for socket ${socket.id}`);
      socket.disconnect();
    }
  }, 30000); // 30 seconds timeout
  
  // Clear timeout on successful auth
  socket.once('admin:authSuccess', () => {
    clearTimeout(authTimeout);
  });
  
  socket.once('agent:loginSuccess', () => {
    clearTimeout(authTimeout);
  });
  
  socket.once('authenticated', () => {
    clearTimeout(authTimeout);
  });
  
  // ========== INIT EVENT FOR APP/TELEGRAM USERS ==========
  socket.on('init', async (data) => {
    const { userId, userName } = data;
    if (!userId) {
      console.log('Init without userId, disconnecting');
      socket.disconnect();
      return;
    }

    try {
      // Find or create user
      let user = await User.findOne({ userId });
      if (!user) {
        // Create new user (should normally exist from registration, but just in case)
        user = new User({
          userId,
          userName: userName || 'AppUser',
          balance: 0,
          referralCode: `APP${Date.now()}`,
          joinedAt: new Date(),
          lastSeen: new Date()
        });
        await user.save();
        console.log(`✅ New app user created: ${userName} (${userId})`);
      } else {
        // Update existing user
        user.lastSeen = new Date();
        user.isOnline = true;
        if (userName) user.userName = userName; // update display name if changed
        await user.save();
      }

      // Associate socket with user
      socket.userId = userId;
      // Optionally add to game logic's user tracking
      if (gameLogic && gameLogic.addUserSocket) {
        gameLogic.addUserSocket(socket, userId);
      }

      // Send current balance and data back
      socket.emit('initSuccess', {
        userId: user.userId,
        userName: user.userName,
        balance: user.balance,
        message: 'User initialized'
      });

      // Also broadcast to admin that user came online
      io.emit('userOnline', { userId, userName: user.userName });
    } catch (error) {
      console.error('Error in init:', error);
      socket.emit('error', 'Failed to initialize user');
    }
  });
  
  // ========== ADMIN AUTHENTICATION ==========
  socket.on('admin:auth', async (password) => {
    if (password === (gameLogic.CONFIG ? gameLogic.CONFIG.ADMIN_PASSWORD : 'admin123')) {
      socket.admin = true;
      // 👇 FIX #1: Give admin super‑admin privileges in agent system
      socket.agentData = { isSuperAdmin: true, username: 'admin' };
      socket.emit('admin:authSuccess');
      
      // Send current Telebirr number on successful auth
      const telebirrNumber = await getTelebirrNumber();
      socket.emit('admin:telebirrNumber', telebirrNumber);
      
      // Send Keno stats
      if (kenoLogic && kenoLogic.getKenoGameStats) {
        const kenoStats = kenoLogic.getKenoGameStats();
        socket.emit('admin:kenoStats', kenoStats);
      }
      
      // Send Crash stats
      if (crashLogic && crashLogic.getCrashGameStats) {
        const crashStats = crashLogic.getCrashGameStats();
        socket.emit('admin:crashStats', crashStats);
      }
      
      // Send Agent stats
      if (agentSystem && agentSystem.getAgentStatistics) {
        const agentStats = await agentSystem.getAgentStatistics();
        socket.emit('admin:agentStats', agentStats);
      }
      
      console.log(`🔑 Admin authenticated: ${socket.id}`);
    } else {
      socket.emit('admin:authError', 'Invalid password');
    }
  });
  
  // ========== WALLET EVENT HANDLERS FOR TELEGRAM ENTRY PAGE ==========
  // Handle wallet events from Telegram entry page
  socket.on('wallet:depositRequest', async (data) => {
    try {
      console.log(`💰 Deposit request from ${data.userName} (${data.userId}): ${data.amount} ETB, Receipt: ${data.receiptNumber}`);
      
      // Create a transaction record
      const transaction = new models.Transaction({
        type: 'DEPOSIT_REQUEST',
        userId: data.userId,
        userName: data.userName,
        amount: parseFloat(data.amount),
        receiptNumber: data.receiptNumber,
        description: `Deposit request - Receipt: ${data.receiptNumber}, Amount: ${data.amount} ETB`,
        status: 'pending'
      });
      await transaction.save();
      
      // Get Telebirr number for response
      const telebirrNumber = await getTelebirrNumber();
      
      // Notify the user
      socket.emit('wallet:depositRequestSuccess', {
        message: 'Deposit request submitted successfully. Admin will process it soon.',
        telebirrNumber: telebirrNumber
      });
      
      // Notify admin
      io.emit('admin:newDepositRequest', {
        userId: data.userId,
        userName: data.userName,
        amount: parseFloat(data.amount),
        receiptNumber: data.receiptNumber,
        transactionId: transaction._id,
        timestamp: new Date()
      });
      
      console.log(`✅ Deposit request saved for ${data.userName}`);
      
    } catch (error) {
      console.error('Error processing deposit request:', error);
      socket.emit('wallet:error', 'Failed to submit deposit request');
    }
  });
  
  socket.on('wallet:withdrawRequest', async (data) => {
    try {
      console.log(`💰 Withdrawal request from ${data.userName} (${data.userId}): ${data.amount} ETB to ${data.phoneNumber}`);
      
      // Check if user has sufficient balance
      const user = await models.User.findOne({ userId: data.userId });
      if (!user) {
        socket.emit('wallet:error', 'User not found');
        return;
      }
      
      if (user.balance < data.amount) {
        socket.emit('wallet:error', 'Insufficient balance for withdrawal');
        return;
      }
      
      const MIN_WITHDRAWAL = gameLogic.CONFIG ? gameLogic.CONFIG.MIN_WITHDRAWAL : 50;
      const MAX_WITHDRAWAL = gameLogic.CONFIG ? gameLogic.CONFIG.MAX_WITHDRAWAL : 10000;
      
      // Check minimum withdrawal amount
      if (data.amount < MIN_WITHDRAWAL) {
        socket.emit('wallet:error', `Minimum withdrawal amount is ${MIN_WITHDRAWAL} ETB`);
        return;
      }
      
      // Check maximum withdrawal amount
      if (data.amount > MAX_WITHDRAWAL) {
        socket.emit('wallet:error', `Maximum withdrawal amount is ${MAX_WITHDRAWAL} ETB`);
        return;
      }
      
      // Create a transaction record
      const transaction = new models.Transaction({
        type: 'WITHDRAW_REQUEST',
        userId: data.userId,
        userName: data.userName,
        amount: -parseFloat(data.amount), // Negative for withdrawal
        phoneNumber: data.phoneNumber,
        description: `Withdrawal request to phone: ${data.phoneNumber}, Amount: ${data.amount} ETB`,
        status: 'pending'
      });
      await transaction.save();
      
      // Update user phone number if not set
      if (!user.phoneNumber) {
        user.phoneNumber = data.phoneNumber;
        await user.save();
      }
      
      // Notify the user
      socket.emit('wallet:withdrawRequestSuccess', {
        message: 'Withdrawal request submitted successfully. Admin will process it soon.'
      });
      
      // Notify admin
      io.emit('admin:newWithdrawRequest', {
        userId: data.userId,
        userName: data.userName,
        amount: parseFloat(data.amount),
        phoneNumber: data.phoneNumber,
        transactionId: transaction._id,
        timestamp: new Date()
      });
      
      console.log(`✅ Withdrawal request saved for ${data.userName}`);
      
    } catch (error) {
      console.error('Error processing withdrawal request:', error);
      socket.emit('wallet:error', 'Failed to submit withdrawal request');
    }
  });
  
  // ========== AGENT SYSTEM SOCKET EVENTS ==========
  // Agent login
  socket.on('agent:login', (data) => {
    if (agentSystem && agentSystem.handleAgentLogin) {
      agentSystem.handleAgentLogin(socket, data);
    }
  });
  
  // Agent verify token for auto login
  socket.on('agent:verifyToken', (data) => {
    if (agentSystem && agentSystem.handleVerifyAgentToken) {
      agentSystem.handleVerifyAgentToken(socket, data);
    }
  });
  
  // Agent dashboard data
  socket.on('agent:dashboard', () => {
    if (agentSystem && agentSystem.handleAgentDashboard) {
      agentSystem.handleAgentDashboard(socket);
    }
  });

  // Agent get dashboard data
  socket.on('agent:getDashboard', () => {
    if (agentSystem && agentSystem.handleAgentDashboard) {
      agentSystem.handleAgentDashboard(socket);
    }
  });
  
  // Generate referral link
  socket.on('agent:generateReferralLink', () => {
    if (agentSystem && agentSystem.handleGenerateReferralLink) {
      agentSystem.handleGenerateReferralLink(socket);
    }
  });
  
  // Manual referral assignment by agent
  socket.on('agent:manualReferralAssignment', (data) => {
    if (agentSystem && agentSystem.handleManualReferralAssignmentByAgent) {
      agentSystem.handleManualReferralAssignmentByAgent(socket, data);
    }
  });
  
  // Bulk manual referral assignment
  socket.on('agent:bulkManualReferral', (data) => {
    if (agentSystem && agentSystem.handleBulkManualReferral) {
      agentSystem.handleBulkManualReferral(socket, data);
    }
  });
  
  // Search users for assignment
  socket.on('agent:searchUsers', (data) => {
    if (agentSystem && agentSystem.handleSearchUsers) {
      agentSystem.handleSearchUsers(socket, data);
    }
  });
  
  // Get user suggestions
  socket.on('agent:getUserSuggestions', () => {
    if (agentSystem && agentSystem.handleGetUserSuggestions) {
      agentSystem.handleGetUserSuggestions(socket);
    }
  });
  
  // Get agent report
  socket.on('agent:report', (data) => {
    if (agentSystem && agentSystem.handleAgentReport) {
      agentSystem.handleAgentReport(socket, data);
    }
  });

  // Get agent report (alternative name)
  socket.on('agent:getReport', (data) => {
    if (agentSystem && agentSystem.handleAgentReport) {
      agentSystem.handleAgentReport(socket, data);
    }
  });
  
  // Agent withdrawal request
  socket.on('agent:withdrawRequest', (data) => {
    if (agentSystem && agentSystem.handleAgentWithdrawRequest) {
      agentSystem.handleAgentWithdrawRequest(socket, data);
    }
  });
  
  // Get agent withdrawal history
  socket.on('agent:withdrawalHistory', () => {
    if (agentSystem && agentSystem.handleGetWithdrawalHistory) {
      agentSystem.handleGetWithdrawalHistory(socket);
    }
  });

  // Get agent withdrawal history (alternative name)
  socket.on('agent:getWithdrawalHistory', () => {
    if (agentSystem && agentSystem.handleGetWithdrawalHistory) {
      agentSystem.handleGetWithdrawalHistory(socket);
    }
  });
  
  // Test user database
  socket.on('agent:testUserDatabase', () => {
    if (agentSystem && agentSystem.testUserDatabase) {
      agentSystem.testUserDatabase(socket);
    }
  });
  
  // Get agent referral tree
  socket.on('agent:getReferralTree', (data) => {
    if (agentSystem && agentSystem.getAgentReferralTree) {
      const agentId = data.agentId || socket.agentId;
      agentSystem.getAgentReferralTree(agentId, data.depth || 2)
        .then(tree => socket.emit('agent:referralTree', tree))
        .catch(err => socket.emit('agent:error', err.message));
    }
  });
  
  // Get agent leaderboard
  socket.on('agent:getLeaderboard', (data) => {
    if (agentSystem && agentSystem.getAgentLeaderboard) {
      const limit = data.limit || 10;
      const period = data.period || 'month';
      agentSystem.getAgentLeaderboard(limit, period)
        .then(leaderboard => socket.emit('agent:leaderboard', leaderboard))
        .catch(err => socket.emit('agent:error', err.message));
    }
  });
  
  // Get agent performance metrics
  socket.on('agent:getPerformanceMetrics', (data) => {
    if (agentSystem && agentSystem.getAgentPerformanceMetrics) {
      const agentId = data.agentId || socket.agentId;
      agentSystem.getAgentPerformanceMetrics(agentId)
        .then(metrics => socket.emit('agent:performanceMetrics', metrics))
        .catch(err => socket.emit('agent:error', err.message));
    }
  });
  
  // Get agent statistics
  socket.on('agent:getAgentStatistics', () => {
    if (agentSystem && agentSystem.getAgentStatistics) {
      agentSystem.getAgentStatistics()
        .then(stats => socket.emit('agent:statistics', stats))
        .catch(err => socket.emit('agent:error', err.message));
    }
  });
  
  // Get agent system status
  socket.on('agent:getSystemStatus', () => {
    if (agentSystem && agentSystem.getSystemStatus) {
      const status = agentSystem.getSystemStatus();
      socket.emit('agent:systemStatus', status);
    }
  });
  
  // ========== SUPER ADMIN AGENT EVENTS ==========
  // Get all agents (super admin only)
  socket.on('admin:getAllAgents', () => {
    if (socket.admin && agentSystem && agentSystem.handleGetAllAgents) {
      agentSystem.handleGetAllAgents(socket);
    }
  });

  // Get all agents (for agent admin panel) - FIXED: Admin bypass added
  socket.on('agent:getAllAgents', async () => {
    if (socket.admin) {
      try {
        const agents = await Agent.find().sort({ createdAt: -1 });
        socket.emit('agent:allAgents', agents);
      } catch (error) {
        console.error('Error fetching agents:', error);
        socket.emit('agent:error', 'Failed to fetch agents');
      }
    } else if (agentSystem && agentSystem.handleGetAllAgents) {
      agentSystem.handleGetAllAgents(socket);
    } else {
      socket.emit('agent:error', 'Unauthorized');
    }
  });
  
  // Create new agent (super admin only)
  socket.on('admin:createAgent', (data) => {
    if (socket.admin && agentSystem && agentSystem.handleCreateAgent) {
      agentSystem.handleCreateAgent(socket, data);
    }
  });

  // Create new agent (for agent admin panel)
  socket.on('agent:createAgent', (data) => {
    if (socket.admin && agentSystem && agentSystem.handleCreateAgent) {
      agentSystem.handleCreateAgent(socket, data);
    }
  });
  
  // Update agent (super admin only)
  socket.on('admin:updateAgent', (data) => {
    if (socket.admin && agentSystem && agentSystem.handleUpdateAgent) {
      agentSystem.handleUpdateAgent(socket, data);
    }
  });
  
  // Delete agent (super admin only)
  socket.on('admin:deleteAgent', (agentId) => {
    if (socket.admin && agentSystem && agentSystem.handleDeleteAgent) {
      agentSystem.handleDeleteAgent(socket, agentId);
    }
  });

  // Delete agent (for agent admin panel)
  socket.on('agent:deleteAgent', (agentId) => {
    if (socket.admin && agentSystem && agentSystem.handleDeleteAgent) {
      agentSystem.handleDeleteAgent(socket, agentId);
    }
  });
  
  // Get agent system status (admin)
  socket.on('admin:getAgentSystemStatus', () => {
    if (socket.admin && agentSystem && agentSystem.getSystemStatus) {
      const status = agentSystem.getSystemStatus();
      socket.emit('admin:agentSystemStatus', status);
    }
  });
  
  // Manual referral assignment by admin
  socket.on('admin:manualReferralAssignment', (data) => {
    if (socket.admin && agentSystem && agentSystem.handleManualReferralAssignment) {
      agentSystem.handleManualReferralAssignment(socket, data);
    }
  });
  
  // Get agent leaderboard (super admin only)
  socket.on('admin:getAgentLeaderboard', async (data) => {
    if (socket.admin && agentSystem && agentSystem.getAgentLeaderboard) {
      try {
        const limit = data.limit || 10;
        const period = data.period || 'month';
        const leaderboard = await agentSystem.getAgentLeaderboard(limit, period);
        socket.emit('admin:agentLeaderboard', leaderboard);
      } catch (error) {
        console.error('Error getting agent leaderboard:', error);
        socket.emit('admin:error', 'Failed to get agent leaderboard');
      }
    }
  });

  // 🛠️ FIXED: Added admin events for agent withdrawal approval
  // ========== AGENT WITHDRAWAL APPROVAL (ADMIN) ==========
  socket.on('admin:getPendingAgentWithdrawals', async () => {
    if (!socket.admin) {
      socket.emit('admin:error', 'Unauthorized');
      return;
    }
    if (agentSystem && typeof agentSystem.getPendingAgentWithdrawals === 'function') {
      try {
        const withdrawals = await agentSystem.getPendingAgentWithdrawals();
        socket.emit('admin:pendingAgentWithdrawals', withdrawals);
      } catch (error) {
        console.error('Error getting pending agent withdrawals:', error);
        socket.emit('admin:error', 'Failed to get pending withdrawals');
      }
    } else {
      // Fallback if method not yet implemented in agent-logic.js
      socket.emit('admin:error', 'Agent withdrawal system not fully implemented');
    }
  });

  socket.on('admin:approveAgentWithdrawal', async (transactionId) => {
    if (!socket.admin) {
      socket.emit('admin:error', 'Unauthorized');
      return;
    }
    if (agentSystem && typeof agentSystem.approveAgentWithdrawal === 'function') {
      try {
        const result = await agentSystem.approveAgentWithdrawal(transactionId, socket.agentData?._id);
        socket.emit('admin:agentWithdrawalApproved', result);
        // Optionally refresh agent dashboard for the affected agent
        if (result.agentId) {
          agentSystem.forceRefreshAgentDashboard(result.agentId).catch(console.error);
        }
      } catch (error) {
        console.error('Error approving agent withdrawal:', error);
        socket.emit('admin:error', error.message || 'Failed to approve withdrawal');
      }
    } else {
      socket.emit('admin:error', 'Approve method not available – please update agent-logic.js');
    }
  });

  socket.on('admin:rejectAgentWithdrawal', async (transactionId) => {
    if (!socket.admin) {
      socket.emit('admin:error', 'Unauthorized');
      return;
    }
    if (agentSystem && typeof agentSystem.rejectAgentWithdrawal === 'function') {
      try {
        const result = await agentSystem.rejectAgentWithdrawal(transactionId, socket.agentData?._id);
        socket.emit('admin:agentWithdrawalRejected', result);
      } catch (error) {
        console.error('Error rejecting agent withdrawal:', error);
        socket.emit('admin:error', error.message || 'Failed to reject withdrawal');
      }
    } else {
      socket.emit('admin:error', 'Reject method not available – please update agent-logic.js');
    }
  });
  
  // ========== ADDITIONAL AGENT SYSTEM EVENTS (FIXED) ==========
  // 🛠️ FIXED: Added missing agent event handlers for full connectivity
  // Agent logout
  socket.on('agent:logout', () => {
    if (agentSystem && agentSystem.handleAgentLogout) {
      agentSystem.handleAgentLogout(socket);
    }
  });

  // Refresh dashboard
  socket.on('agent:refreshDashboard', () => {
    if (agentSystem && agentSystem.handleRefreshDashboard) {
      agentSystem.handleRefreshDashboard(socket);
    }
  });

  // Check referral status
  socket.on('agent:checkReferralStatus', (data) => {
    if (agentSystem && agentSystem.handleCheckReferralStatus) {
      agentSystem.handleCheckReferralStatus(socket, data);
    }
  });

  // Test commission (debug)
  socket.on('agent:testCommission', (data) => {
    if (agentSystem && agentSystem.handleTestCommission) {
      agentSystem.handleTestCommission(socket, data);
    }
  });

  // Check commission status (debug)
  socket.on('agent:checkCommissionStatus', (data) => {
    if (agentSystem && agentSystem.checkCommissionStatus) {
      agentSystem.checkCommissionStatus(socket, data);
    }
  });

  // Emergency sync
  socket.on('agent:emergencySync', () => {
    if (agentSystem && agentSystem.handleEmergencySync) {
      agentSystem.handleEmergencySync(socket);
    }
  });

  // Heartbeat acknowledgement
  socket.on('agent:heartbeat_ack', (data) => {
    if (agentSystem && agentSystem.handleHeartbeatAck) {
      agentSystem.handleHeartbeatAck(socket, data);
    }
  });
  
  // ========== TELEBIRR NUMBER EVENTS ==========
  // Get Telebirr number (admin only)
  socket.on('admin:getTelebirrNumber', async () => {
    if (socket.admin) {
      const number = await getTelebirrNumber();
      socket.emit('admin:telebirrNumber', number);
    }
  });
  
  // Update Telebirr number (admin only)
  socket.on('admin:updateTelebirrNumber', async (newNumber) => {
    if (socket.admin) {
      try {
        const result = await updateTelebirrNumber(newNumber);
        const updatedNumber = result.value;
        
        // Broadcast to all admin sockets
        io.emit('admin:telebirrNumberUpdated', { 
          telebirrNumber: updatedNumber,
          updatedAt: result.updatedAt
        });
        
        // Broadcast to all players
        io.emit('telebirrNumberUpdate', {
          telebirrNumber: updatedNumber,
          timestamp: new Date().toISOString()
        });
        
        socket.emit('admin:success', `Telebirr number updated to ${updatedNumber}`);
        console.log(`📱 Telebirr number updated by admin to: ${updatedNumber}`);
        
        // Log the transaction
        const adminTransaction = new Transaction({
          type: 'TELEBIRR_UPDATE',
          userId: 'admin',
          userName: 'Admin',
          amount: 0,
          admin: true,
          description: `Telebirr number updated to ${updatedNumber}`
        });
        await adminTransaction.save();
        
      } catch (error) {
        console.error('❌ Error updating Telebirr number:', error);
        socket.emit('admin:error', error.message || 'Failed to update Telebirr number');
      }
    }
  });
  
  // ========== KENO EVENTS ==========
  // Admin: Get Keno stats
  socket.on('admin:getKenoStats', () => {
    if (socket.admin && kenoLogic && kenoLogic.getKenoGameStats) {
      const stats = kenoLogic.getKenoGameStats();
      socket.emit('admin:kenoStats', stats);
    }
  });
  
  // Admin: Get detailed Keno stats
  socket.on('admin:getKenoDetailedStats', () => {
    if (socket.admin && kenoLogic && kenoLogic.getKenoDetailedStats) {
      const stats = kenoLogic.getKenoDetailedStats();
      socket.emit('admin:kenoDetailedStats', stats);
    }
  });
  
  // Admin: Get Keno player list
  socket.on('admin:getKenoPlayers', () => {
    if (socket.admin && kenoLogic && kenoLogic.getKenoPlayerList) {
      const players = kenoLogic.getKenoPlayerList();
      socket.emit('admin:kenoPlayers', players);
    }
  });
  
  // Admin: Reset Keno earnings
  socket.on('admin:resetKenoEarnings', async () => {
    if (socket.admin && kenoLogic && kenoLogic.resetKenoEarnings) {
      try {
        const result = await kenoLogic.resetKenoEarnings();
        socket.emit('admin:kenoEarningsReset', result);
      } catch (error) {
        socket.emit('admin:error', error.message || 'Failed to reset Keno earnings');
      }
    }
  });
  
  // Admin: Force start Keno round
  socket.on('admin:forceStartKenoRound', () => {
    if (socket.admin && kenoLogic && kenoLogic.forceStartKenoRound) {
      const success = kenoLogic.forceStartKenoRound();
      socket.emit('admin:kenoRoundForced', { success });
    }
  });
  
  // ========== CRASH GAME SOCKET EVENTS ==========
  // Handle Crash socket connection
  if (crashLogic && crashLogic.handleCrashConnection) {
    crashLogic.handleCrashConnection(socket);
  }
  
  // Admin: Get Crash stats
  socket.on('admin:getCrashStats', () => {
    if (socket.admin && crashLogic && crashLogic.getCrashGameStats) {
      const stats = crashLogic.getCrashGameStats();
      socket.emit('admin:crashStats', stats);
    }
  });

  // Admin: Force crash round
  socket.on('admin:forceCrashRound', () => {
    if (socket.admin && crashLogic && crashLogic.forceCrashRound) {
      const success = crashLogic.forceCrashRound();
      socket.emit('admin:crashRoundForced', { success });
    }
  });

  // Admin: Reset crash earnings
  socket.on('admin:resetCrashEarnings', async () => {
    if (socket.admin && crashLogic && crashLogic.resetCrashEarnings) {
      const stats = await crashLogic.resetCrashEarnings();
      socket.emit('admin:crashEarningsReset', stats);
    }
  });

  // Admin: Get crash player list
  socket.on('admin:getCrashPlayers', () => {
    if (socket.admin && crashLogic && crashLogic.getCrashPlayerList) {
      const players = crashLogic.getCrashPlayerList();
      socket.emit('admin:crashPlayers', players);
    }
  });
  
  // ========== HOUSE EARNINGS ==========
  // 👇 FIX #2: Completely rewritten reset handler
  socket.on('admin:resetHouseEarnings', async () => {
    if (!socket.admin) return;

    try {
      // 1. Calculate current total house earnings
      const houseEarningsTransactions = await Transaction.find({ type: 'HOUSE_EARNINGS' });
      const currentTotal = houseEarningsTransactions.reduce((sum, t) => sum + t.amount, 0);

      if (currentTotal === 0) {
        socket.emit('admin:houseEarningsReset', {
          previousAmount: 0,
          message: 'House earnings are already zero.'
        });
        return;
      }

      // 2. Create a negative HOUSE_EARNINGS transaction to zero out
      const resetTransaction = new Transaction({
        type: 'HOUSE_EARNINGS',               // 👈 Keep the same type
        userId: 'system',
        userName: 'System',
        amount: -currentTotal,                 // 👈 Negative amount
        admin: true,
        description: `House earnings reset from ${currentTotal.toFixed(2)} to 0 ETB`
      });
      await resetTransaction.save();

      // 3. Notify the requesting admin
      socket.emit('admin:houseEarningsReset', {
        previousAmount: currentTotal,
        resetAmount: 0,
        message: `House earnings reset from ${currentTotal.toFixed(2)} to 0 ETB`
      });

      // 4. Immediately refresh stats for all admin sockets
      if (gameLogic && gameLogic.handleAdminGetData) {
        io.sockets.sockets.forEach(s => {
          if (s.admin) gameLogic.handleAdminGetData(s);
        });
      }

      console.log(`🔄 House earnings reset from ${currentTotal.toFixed(2)} to 0 ETB`);
    } catch (error) {
      console.error('Error resetting house earnings:', error);
      socket.emit('admin:houseEarningsResetError', error.message);
    }
  });
  
  // ========== EXISTING ADMIN EVENTS (DELEGATED TO GAME LOGIC) ==========
  socket.on('admin:getData', () => {
    if (socket.admin && gameLogic && gameLogic.handleAdminGetData) {
      gameLogic.handleAdminGetData(socket);
    }
  });
  
  socket.on('admin:addFunds', (data) => {
    if (socket.admin && gameLogic && gameLogic.handleAdminAddFunds) {
      gameLogic.handleAdminAddFunds(socket, data);
    }
  });
  
  socket.on('admin:banPlayer', (userId) => {
    if (socket.admin && gameLogic && gameLogic.handleAdminBanPlayer) {
      gameLogic.handleAdminBanPlayer(socket, userId);
    }
  });
  
  socket.on('admin:kickPlayer', (userId) => {
    if (socket.admin && gameLogic && gameLogic.handleAdminKickPlayer) {
      gameLogic.handleAdminKickPlayer(socket, userId);
    }
  });
  
  socket.on('admin:disconnectUser', (userId) => {
    if (socket.admin && gameLogic && gameLogic.handleAdminDisconnectUser) {
      gameLogic.handleAdminDisconnectUser(socket, userId);
    }
  });
  
  socket.on('admin:forceStartGame', (stake) => {
    if (socket.admin && gameLogic && gameLogic.handleAdminForceStartGame) {
      gameLogic.handleAdminForceStartGame(socket, stake);
    }
  });
  
  socket.on('admin:forceDraw', (stake) => {
    if (socket.admin && gameLogic && gameLogic.handleAdminForceDraw) {
      gameLogic.handleAdminForceDraw(socket, stake);
    }
  });
  
  socket.on('admin:forceEndGame', (stake) => {
    if (socket.admin && gameLogic && gameLogic.handleAdminForceEndGame) {
      gameLogic.handleAdminForceEndGame(socket, stake);
    }
  });
  
  socket.on('admin:getPendingTransactions', async () => {
    if (socket.admin && gameLogic && gameLogic.handleAdminGetPendingTransactions) {
      await gameLogic.handleAdminGetPendingTransactions(socket);
    }
  });
  
  socket.on('admin:approveDeposit', (transactionId) => {
    if (socket.admin && gameLogic && gameLogic.handleAdminApproveDeposit) {
      gameLogic.handleAdminApproveDeposit(socket, transactionId);
    }
  });
  
  socket.on('admin:approveWithdrawal', (transactionId) => {
    if (socket.admin && gameLogic && gameLogic.handleAdminApproveWithdrawal) {
      gameLogic.handleAdminApproveWithdrawal(socket, transactionId);
    }
  });
  
  socket.on('admin:rejectTransaction', (transactionId) => {
    if (socket.admin && gameLogic && gameLogic.handleAdminRejectTransaction) {
      gameLogic.handleAdminRejectTransaction(socket, transactionId);
    }
  });
  
  // ========== KENO GAME SOCKET EVENTS ==========
  // Handle Keno socket connection
  if (kenoLogic && kenoLogic.handleKenoConnection) {
    kenoLogic.handleKenoConnection(socket);
  }
  
  // ========== DISCONNECT HANDLER ==========
  socket.on('disconnect', () => {
    console.log(`🔌 Disconnected: ${socket.id}`);
    clearTimeout(authTimeout);
    
    if (socket.admin) {
      console.log(`🔑 Admin disconnected: ${socket.id}`);
    }
    
    // Handle player disconnect in game logic
    if (gameLogic && gameLogic.handleDisconnect) {
      gameLogic.handleDisconnect(socket);
    }
    
    // Handle Keno disconnection
    if (kenoLogic && kenoLogic.handleKenoDisconnect) {
      kenoLogic.handleKenoDisconnect(socket);
    }
    
    // Handle Crash disconnection
    if (crashLogic && crashLogic.handleCrashDisconnect) {
      crashLogic.handleCrashDisconnect(socket);
    }
    
    // Handle Agent disconnection
    if (agentSystem && agentSystem.handleAgentDisconnect) {
      agentSystem.handleAgentDisconnect(socket);
    }
  });
  
  // ========== GAME EVENTS (FORWARDED TO GAME LOGIC) ==========
  socket.on('join', (data) => {
    // 🛠️ FIXED: Added .catch() to handle promise rejection
    if (data.referralCode && agentSystem && agentSystem.processReferral) {
      agentSystem.processReferral(data.userId, data.referralCode).catch(err => {
        console.error('❌ Error processing referral:', err);
      });
    }
    
    if (gameLogic && gameLogic.handleJoin) {
      gameLogic.handleJoin(socket, data);
    }
  });
  
  socket.on('selectBox', (data) => {
    if (gameLogic && gameLogic.handleSelectBox) {
      gameLogic.handleSelectBox(socket, data);
    }
  });
  
  socket.on('claimBingo', (data) => {
    if (gameLogic && gameLogic.handleClaimBingo) {
      gameLogic.handleClaimBingo(socket, data);
    }
  });
  
  socket.on('markNumber', (data) => {
    if (gameLogic && gameLogic.handleMarkNumber) {
      gameLogic.handleMarkNumber(socket, data);
    }
  });
  
  socket.on('depositRequest', (data) => {
    // Forward to wallet handler
    socket.emit('wallet:depositRequest', data);
  });
  
  socket.on('withdrawRequest', (data) => {
    // Forward to wallet handler
    socket.emit('wallet:withdrawRequest', data);
  });
  
  socket.on('getUserData', (data) => {
    if (gameLogic && gameLogic.handleGetUserData) {
      gameLogic.handleGetUserData(socket, data);
    }
  });
  
  // ========== TELEBIRR NUMBER REQUEST ==========
  socket.on('getTelebirrNumber', async (callback) => {
    try {
      const telebirrNumber = await getTelebirrNumber();
      if (callback) {
        callback({ telebirrNumber });
      } else {
        socket.emit('telebirrNumber', telebirrNumber);
      }
    } catch (error) {
      console.error('Error getting Telebirr number for player:', error);
      if (callback) {
        callback({ telebirrNumber: '0962577855' });
      }
    }
  });
  
  // ========== AGENT PORTAL REQUEST ==========
  socket.on('getAgentPortal', async () => {
    try {
      // Send agent portal HTML
      socket.emit('agent:portal', `
        <html>
          <head>
            <title>Agent Portal - ETHIO GAMES</title>
            <style>
              body { font-family: Arial, sans-serif; background: #0f172a; color: white; padding: 20px; }
              .container { max-width: 800px; margin: 0 auto; }
              .login-form, .agent-dashboard { background: #1e293b; padding: 20px; border-radius: 10px; margin: 20px 0; }
              input, button { padding: 10px; margin: 5px; border-radius: 5px; }
              button { background: #3b82f6; color: white; border: none; cursor: pointer; }
            </style>
          </head>
          <body>
            <div class="container">
              <h1>👑 Agent Portal</h1>
              <div id="loginForm" class="login-form">
                <h2>Agent Login</h2>
                <input type="text" id="username" placeholder="Username">
                <input type="password" id="password" placeholder="Password">
                <button onclick="agentLogin()">Login</button>
              </div>
              <div id="agentDashboard" class="agent-dashboard" style="display:none;">
                <h2>Welcome, <span id="agentName"></span></h2>
                <div id="agentStats"></div>
              </div>
            </div>
            <script>
              const socket = io();
              function agentLogin() {
                const username = document.getElementById('username').value;
                const password = document.getElementById('password').value;
                socket.emit('agent:login', { username, password });
              }
              
              socket.on('agent:loginSuccess', (data) => {
                document.getElementById('loginForm').style.display = 'none';
                document.getElementById('agentDashboard').style.display = 'block';
                document.getElementById('agentName').textContent = data.name;
              });
              
              socket.on('agent:loginError', (error) => {
                alert('Login failed: ' + error);
              });
            </script>
          </body>
        </html>
      `);
    } catch (error) {
      console.error('Error sending agent portal:', error);
    }
  });
  
  // Handle socket errors
  socket.on('error', (error) => {
    console.error(`Socket error for ${socket.id}:`, error);
  });
});

// ========== EXPRESS ROUTES ==========
app.get('/', async (req, res) => {
  try {
    const connectedSockets = gameLogic && gameLogic.getConnectedSockets ? gameLogic.getConnectedSockets().size : 0;
    const socketToUser = gameLogic && gameLogic.getSocketToUser ? gameLogic.getSocketToUser().size : 0;
    const adminSockets = gameLogic && gameLogic.getAdminSockets ? gameLogic.getAdminSockets().size : 0;
    const processingClaims = gameLogic && gameLogic.getProcessingClaims ? gameLogic.getProcessingClaims().size : 0;
    const roomWinners = gameLogic && gameLogic.getRoomWinners ? gameLogic.getRoomWinners().size : 0;
    const kenoPlayers = kenoLogic && kenoLogic.getKenoPlayersCount ? kenoLogic.getKenoPlayersCount() : 0;
    const kenoOnline = kenoLogic && kenoLogic.getOnlinePlayersCount ? kenoLogic.getOnlinePlayersCount() : 0;
    // ========== NEW: Crash stats ==========
    const crashStats = crashLogic && crashLogic.getCrashGameStats ? crashLogic.getCrashGameStats() : { 
      currentRound: { totalPlayers: 0, totalBets: 0 },
      totalGames: 0,
      totalWagered: 0
    };
    const telebirrNumber = await getTelebirrNumber();
    
    // Get agent statistics
    const agentStats = agentSystem && agentSystem.getAgentStatistics ? await agentSystem.getAgentStatistics() : { 
      totalAgents: 0, 
      activeAgents: 0, 
      totalCommissions: 0,
      totalReferrals: 0,
      todayCommissions: 0,
      pendingWithdrawals: 0 
    };
    
    // Get referral statistics
    const totalUsers = await User.countDocuments();
    const usersWithAgents = await User.countDocuments({ agentId: { $exists: true, $ne: null } });
    const usersWithoutAgents = totalUsers - usersWithAgents;
    
    // Get referral methods breakdown
    const telegramReferrals = await Referral.countDocuments({ referralMethod: 'telegram_link' });
    const manualReferrals = await Referral.countDocuments({ referralMethod: { $in: ['manual', 'bulk_manual'] } });
    const adminReferrals = await Referral.countDocuments({ referralMethod: 'admin_assigned' });
    
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Bingo Elite + Keno Ultra + Crash + Agent System - Telegram Mini App</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 40px; text-align: center; background: #0f172a; color: #f8fafc; }
          .container { max-width: 1000px; margin: 0 auto; }
          .status { padding: 30px; background: #1e293b; border-radius: 20px; margin: 30px auto; border: 1px solid #334155; }
          .stats-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; margin: 30px 0; }
          .stat { background: rgba(255,255,255,0.05); padding: 20px; border-radius: 12px; }
          .stat-value { font-size: 2.5rem; font-weight: 900; margin: 10px 0; }
          .stat-label { font-size: 0.9rem; color: #94a3b8; text-transform: uppercase; letter-spacing: 1px; }
          .btn { display: inline-block; padding: 12px 24px; background: #3b82f6; color: white; text-decoration: none; border-radius: 8px; margin: 10px; font-weight: bold; }
          .btn-admin { background: #ef4444; }
          .btn-admin:hover { background: #dc2626; }
          .btn-game { background: #10b981; }
          .btn-game:hover { background: #059669; }
          .btn-agent { background: #f59e0b; }
          .btn-agent:hover { background: #d97706; }
          .btn-crash { background: #f97316; }
          .btn-crash:hover { background: #ea580c; }
          .telebirr-info { background: rgba(59, 130, 246, 0.1); padding: 15px; border-radius: 12px; margin: 20px 0; border: 1px solid rgba(59, 130, 246, 0.3); }
          .telebirr-number { font-size: 1.5rem; font-weight: bold; color: #60a5fa; margin: 10px 0; }
          .fix-highlight { background: rgba(16, 185, 129, 0.1); padding: 15px; border-radius: 12px; margin: 20px 0; border: 1px solid rgba(16, 185, 129, 0.3); }
          .game-section { background: rgba(139, 92, 246, 0.1); padding: 15px; border-radius: 12px; margin: 20px 0; border: 1px solid rgba(139, 92, 246, 0.3); }
          .crash-section { background: rgba(249, 115, 22, 0.1); padding: 15px; border-radius: 12px; margin: 20px 0; border: 1px solid rgba(249, 115, 22, 0.3); }
          .agent-section { background: rgba(245, 158, 11, 0.1); padding: 15px; border-radius: 12px; margin: 20px 0; border: 1px solid rgba(245, 158, 11, 0.3); }
          .referral-stats { background: rgba(245, 158, 11, 0.05); padding: 15px; border-radius: 12px; margin: 20px 0; border: 1px solid rgba(245, 158, 11, 0.2); }
          .referral-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; margin: 15px 0; }
          .referral-item { background: rgba(255,255,255,0.03); padding: 12px; border-radius: 8px; }
          .referral-method { font-size: 0.8rem; color: #f59e0b; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1 style="font-size: 3rem; margin-bottom: 20px;">🎮 Bingo Elite + Keno Ultra + Crash + Agent System</h1>
          <p style="color: #94a3b8; font-size: 1.2rem;">Multi-game Telegram Mini App with Agent/Referral System</p>
          
          <div class="status">
            <h2 style="color: #10b981;">🚀 Server Status: RUNNING</h2>
            <div class="stats-grid">
              <div class="stat">
                <div class="stat-label">Connected Players</div>
                <div class="stat-value" id="playerCount">${connectedSockets}</div>
              </div>
              <div class="stat">
                <div class="stat-label">Keno Players</div>
                <div class="stat-value" style="color: #8b5cf6;">${kenoOnline}/${kenoPlayers}</div>
              </div>
              <div class="stat">
                <div class="stat-label">Crash Players</div>
                <div class="stat-value" style="color: #f97316;">${crashStats.currentRound.totalPlayers}</div>
              </div>
              <div class="stat">
                <div class="stat-label">Agents Active</div>
                <div class="stat-value" style="color: #f59e0b;">${agentStats.activeAgents || 0}/${agentStats.totalAgents || 0}</div>
              </div>
              <div class="stat">
                <div class="stat-label">Agent Commissions</div>
                <div class="stat-value" style="color: #f59e0b;">${(agentStats.totalCommissions || 0).toFixed(2)} ETB</div>
              </div>
              <div class="stat">
                <div class="stat-label">Database Status</div>
                <div class="stat-value" style="color: #10b981;">✅ Online</div>
              </div>
              <div class="stat">
                <div class="stat-label">Active Games</div>
                <div class="stat-value">${roomWinners}</div>
              </div>
            </div>
            
            <div class="telebirr-info">
              <div class="stat-label">📱 TELEBIRR PAYMENT NUMBER</div>
              <div class="telebirr-number">${telebirrNumber}</div>
              <p style="color: #94a3b8; font-size: 0.9rem;">Persisted in database - Will survive server restarts</p>
            </div>
            
            <div class="referral-stats">
              <h3 style="color: #f59e0b;">📊 REFERRAL SYSTEM STATISTICS</h3>
              <div class="referral-grid">
                <div class="referral-item">
                  <div class="stat-label">Total Users with Agents</div>
                  <div class="stat-value" style="font-size: 1.8rem;">${usersWithAgents} / ${totalUsers}</div>
                </div>
                <div class="referral-item">
                  <div class="stat-label">Agent Referrals</div>
                  <div class="stat-value" style="font-size: 1.8rem;">${agentStats.totalReferrals || 0}</div>
                </div>
              </div>
              
              <div style="background: rgba(255,255,255,0.03); padding: 15px; border-radius: 10px; margin: 10px 0;">
                <h4 style="color: #fbbf24; margin-bottom: 10px;">Referral Methods Breakdown</h4>
                <div style="display: flex; justify-content: space-between; font-size: 0.9rem;">
                  <div><span class="referral-method">🤖 Telegram Links:</span> ${telegramReferrals}</div>
                  <div><span class="referral-method">👤 Manual Assignments:</span> ${manualReferrals}</div>
                  <div><span class="referral-method">🔧 Admin Assignments:</span> ${adminReferrals || 0}</div>
                </div>
              </div>
            </div>
            
            <div class="agent-section">
              <h3 style="color: #f59e0b;">👑 AGENT/REFERRAL SYSTEM - NOW ACTIVE</h3>
              <p style="color: #94a3b8;">
                <strong>New Agent Features:</strong><br>
                1. ✅ Agent registration and login system<br>
                2. ✅ 40% commission from Bingo wins<br>
                3. ✅ 10% commission from Keno wins<br>
                4. ✅ 10% commission from Crash wins<br>
                5. ✅ Real-time commission tracking<br>
                6. ✅ Agent dashboard with stats<br>
                7. ✅ Referral link generation<br>
                8. ✅ Agent withdrawal requests<br>
                9. ✅ Super admin panel for agent management<br>
                10. ✅ Agent leaderboard<br>
                11. ✅ Referral tracking and reporting<br>
              </p>
            </div>
            
            <div class="game-section">
              <h3 style="color: #8b5cf6;">🎰 KENO ULTRA - NOW ACTIVE</h3>
              <p style="color: #94a3b8;">
                <strong>Features:</strong><br>
                1. ✅ Fast-paced number game<br>
                2. ✅ Select 5 numbers from 1-80<br>
                3. ✅ 20 numbers drawn per round<br>
                4. ✅ Bet amounts: 5, 10, 20, 50, 100 ETB only<br>
                5. ✅ 30-second rounds<br>
                6. ✅ Payouts: Match 3-5 numbers<br>
                7. ✅ Real-time multiplayer<br>
                8. ✅ Automatic game rounds<br>
              </p>
            </div>
            
            <div class="crash-section">
              <h3 style="color: #f97316;">✈️ CRASH GAME - NOW ACTIVE</h3>
              <p style="color: #94a3b8;">
                <strong>Features:</strong><br>
                1. ✅ Multiplier increases until crash<br>
                2. ✅ Cash out anytime before crash<br>
                3. ✅ Bet amounts: 5-5000 ETB<br>
                4. ✅ Auto cashout option<br>
                5. ✅ Real‑time canvas animation<br>
                6. ✅ Sound effects (optional)<br>
                7. ✅ 10% agent commission on net wins<br>
                8. ✅ Admin stats and controls<br>
              </p>
            </div>
            
            <div class="fix-highlight">
              <h3 style="color: #10b981;">✅ DOUBLE PRIZE BUG FIXED</h3>
              <p style="color: #94a3b8;">
                <strong>Multiple layers of protection:</strong><br>
                1. ✅ Room winner tracking (memory cache)<br>
                2. ✅ Processing claims lock per user per room<br>
                3. ✅ Atomic room status updates<br>
                4. ✅ Database transaction checks<br>
                5. ✅ Room lock for concurrent claims<br>
                6. ✅ Auto-cleanup of stale locks<br>
                7. ✅ Enhanced error handling<br>
              </p>
              <p style="color: #fbbf24;">
                <strong>Processing Claims:</strong> ${processingClaims}<br>
                <strong>Recent Room Winners:</strong> ${roomWinners}
              </p>
            </div>
            
            <p style="margin-top: 20px; color: #f59e0b; font-weight: bold;">👑 Agent Commissions: Bingo 40%, Keno 10%, Crash 10%!</p>
            <p style="color: #f59e0b; margin-top: 10px; font-weight: bold;">💰 Agent Withdrawals: Processed within 24 hours</p>
            <p style="color: #8b5cf6; margin-top: 10px; font-weight: bold;">🎰 Keno Payouts: 3 matches = 1x, 4 matches = 5x, 5 matches = 50x</p>
            <p style="color: #f97316; margin-top: 10px; font-weight: bold;">✈️ Crash: Cash out before it crashes!</p>
            <p style="color: #64748b; margin-top: 10px;">Server Time: ${new Date().toLocaleString()}</p>
            <p style="color: #10b981;">✅ Telegram Mini App Ready</p>
            <p style="color: #3b82f6; margin-top: 10px;">📦 Real-time Box Tracking: ✅ ACTIVE</p>
            <p style="color: #10b981; margin-top: 10px;">💰 Wallet System: ✅ ACTIVE</p>
            <p style="color: #f59e0b; margin-top: 10px;">👑 Agent System: ✅ ACTIVE</p>
            <p style="color: #f97316; margin-top: 10px;">✈️ Crash Game: ✅ ACTIVE</p>
            <p style="color: #8b5cf6; margin-top: 10px; font-weight: bold;">🎮 More Games Coming Soon: Lottery & Slots!</p>
          </div>
          
          <div style="margin-top: 40px;">
            <h3>Access Points:</h3>
            <div>
              <a href="/admin" class="btn btn-admin" target="_blank">🔒 Admin Panel</a>
              <a href="/agent" class="btn btn-agent" target="_blank">👑 Agent Portal</a>
              <a href="/telegram" class="btn" style="background: #8b5cf6;" target="_blank">🤖 Telegram Entry</a>
              <a href="/game" class="btn btn-game" target="_blank">🎮 Bingo Game</a>
              <a href="/keno" class="btn" style="background: #8b5cf6;" target="_blank">🎰 Keno Game</a>
              <a href="/crash" class="btn btn-crash" target="_blank">✈️ Crash Game</a>
            </div>
            <div style="margin-top: 20px;">
              <a href="/health" class="btn" style="background: #64748b;" target="_blank">📊 Health Check</a>
              <a href="/telegram" class="btn" style="background: #8b5cf6;" target="_blank">🤖 Telegram Entry</a>
            </div>
            <div style="margin-top: 20px;">
              <a href="/debug-connections" class="btn" style="background: #f59e0b;" target="_blank">🔍 Debug Connections</a>
              <a href="/debug-agents" class="btn" style="background: #f59e0b;" target="_blank">👑 Debug Agents</a>
              <a href="/debug-telebirr" class="btn" style="background: #f59e0b;" target="_blank">📱 Debug Telebirr</a>
              <a href="/debug/referrals" class="btn" style="background: #f59e0b;" target="_blank">📊 Debug Referrals</a>
            </div>
          </div>
          
          <div style="margin-top: 40px; padding: 20px; background: rgba(255,255,255,0.03); border-radius: 12px;">
            <h4>Telegram Mini App Information</h4>
            <p style="color: #94a3b8; font-size: 0.9rem;">
              Version: 5.0.0 (BINGO + KENO + CRASH + AGENT SYSTEM) | Database: MongoDB Atlas<br>
              Socket.IO: ✅ Connected Sockets: ${connectedSockets}<br>
              Keno Players: ${kenoOnline} online / ${kenoPlayers} total<br>
              Crash Players: ${crashStats.currentRound.totalPlayers} in current round<br>
              Agents: ${agentStats.activeAgents || 0} active / ${agentStats.totalAgents || 0} total<br>
              Agent Commissions: ${(agentStats.totalCommissions || 0).toFixed(2)} ETB<br>
              Agent Referrals: ${agentStats.totalReferrals || 0} total referrals<br>
              Telegram Integration: ✅ Ready<br>
              Game Timer: ${gameLogic.CONFIG ? gameLogic.CONFIG.GAME_TIMER : 3}s between balls<br>
              Keno Timer: ${kenoLogic.CONFIG ? kenoLogic.CONFIG.KENO_GAME_TIMER : 30}s rounds<br>
              Bot Username: @Ethio_elite_games_bot<br>
              Real-time Box Updates: ✅ ACTIVE<br>
              Wallet System: ✅ ACTIVE (Deposit/Withdraw)<br>
              Agent System: ✅ ACTIVE (40% Bingo, 10% Keno, 10% Crash commissions)<br>
              Referral System: ✅ ACTIVE (${usersWithAgents} users with agents)<br>
              <strong>Telebirr Number: ${telebirrNumber} (PERSISTED IN DATABASE)</strong><br>
              Min Withdrawal: ${gameLogic.CONFIG ? gameLogic.CONFIG.MIN_WITHDRAWAL : 50} ETB<br>
              Min Deposit: ${gameLogic.CONFIG ? (gameLogic.CONFIG.MIN_DEPOSIT || 10) : 10} ETB<br>
              <strong>🎯 AGENT SYSTEM FEATURES:</strong><br>
              • 40% commission from Bingo wins<br>
              • 10% commission from Keno wins<br>
              • 10% commission from Crash wins<br>
              • Real-time commission tracking<br>
              • Agent dashboard with statistics<br>
              • Referral link generation<br>
              • Agent withdrawal system<br>
              • Super admin management panel<br>
              • Agent leaderboard<br>
              • Multi-level referral tracking<br>
              • CSV export for commissions<br>
              • Telegram bot integration for agents<br>
              <strong>🎮 NEW GAMES COMING SOON:</strong><br>
              • ETHIO LOTTERY - Daily draws with massive jackpots<br>
              • SLOTS GALAXY - Exciting slot machines with bonuses<br>
            </p>
          </div>
        </div>
        
        <script src="/socket.io/socket.io.js"></script>
        <script>
          const socket = io();
          socket.on('connect', () => {
            document.getElementById('playerCount').textContent = 'Connected';
          });
        </script>
      </body>
      </html>
    `);
  } catch (error) {
    res.status(500).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Error</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 40px; text-align: center; background: #0f172a; color: #f8fafc; }
        </style>
      </head>
      <body>
        <h1 style="color: #ef4444;">❌ Server Error</h1>
        <p>${error.message}</p>
        <a href="/" style="color: #3b82f6;">← Try Again</a>
      </body>
      </html>
    `);
  }
});

// ========== MOBILE APP LOGIN PAGE ==========
app.get('/app', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
      <title>ETHIO GAMES · App Login</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          background: #0a0c10;
          color: #f0f4fa;
          display: flex;
          align-items: center;
          justify-content: center;
          min-height: 100vh;
          padding: 20px;
        }
        .container {
          background: #13171c;
          border: 1px solid #262d36;
          border-radius: 32px;
          padding: 32px 24px;
          width: 100%;
          max-width: 360px;
        }
        .logo {
          font-size: 28px;
          font-weight: 700;
          margin-bottom: 24px;
          text-align: center;
        }
        .logo span { color: #8b5cf6; }
        .tab-bar {
          display: flex;
          gap: 16px;
          margin-bottom: 24px;
          border-bottom: 1px solid #262d36;
        }
        .tab {
          flex: 1;
          text-align: center;
          padding: 8px 0;
          color: #8e9aaf;
          cursor: pointer;
          font-weight: 500;
        }
        .tab.active {
          color: #3b82f6;
          border-bottom: 2px solid #3b82f6;
        }
        .form {
          display: none;
        }
        .form.active {
          display: block;
        }
        .form-group {
          margin-bottom: 20px;
        }
        label {
          display: block;
          font-size: 13px;
          color: #8e9aaf;
          margin-bottom: 6px;
        }
        input {
          width: 100%;
          padding: 14px;
          background: #0a0c10;
          border: 1px solid #262d36;
          border-radius: 16px;
          color: white;
          font-size: 16px;
          outline: none;
        }
        input:focus {
          border-color: #3b82f6;
        }
        .btn {
          width: 100%;
          padding: 14px;
          background: #3b82f6;
          border: none;
          border-radius: 40px;
          color: white;
          font-weight: 600;
          font-size: 16px;
          margin-top: 8px;
          cursor: pointer;
        }
        .btn:active { background: #2563eb; }
        .error {
          color: #ef4444;
          font-size: 13px;
          margin-top: 8px;
          display: none;
        }
        .success {
          color: #10b981;
          font-size: 13px;
          margin-top: 8px;
          display: none;
        }
        .info {
          color: #8e9aaf;
          font-size: 12px;
          margin-top: 24px;
          text-align: center;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="logo">ETHIO<span>GAMES</span></div>

        <div class="tab-bar">
          <div class="tab active" onclick="switchTab('login')">Login</div>
          <div class="tab" onclick="switchTab('register')">Register</div>
        </div>

        <!-- Login Form -->
        <div id="loginForm" class="form active">
          <div class="form-group">
            <label>Username</label>
            <input type="text" id="loginUsername" placeholder="Enter username">
          </div>
          <div class="form-group">
            <label>Password</label>
            <input type="password" id="loginPassword" placeholder="Enter password">
          </div>
          <div class="error" id="loginError"></div>
          <button class="btn" onclick="login()">Login</button>
        </div>

        <!-- Register Form -->
        <div id="registerForm" class="form">
          <div class="form-group">
            <label>Username</label>
            <input type="text" id="regUsername" placeholder="Choose a username (min 3 chars)">
          </div>
          <div class="form-group">
            <label>Password</label>
            <input type="password" id="regPassword" placeholder="Min 6 characters">
          </div>
          <div class="form-group">
            <label>Referral Code (optional)</label>
            <input type="text" id="regReferral" placeholder="Enter agent referral code">
          </div>
          <div class="error" id="regError"></div>
          <div class="success" id="regSuccess"></div>
          <button class="btn" onclick="register()">Register</button>
        </div>

        <div class="info">
          Create an account to play Bingo, Keno and Crash.
        </div>
      </div>

      <script>
        // --- Auto‑redirect if already logged in ---
        (function() {
          const storedUserId = localStorage.getItem('appUserId');
          const storedUserName = localStorage.getItem('appUserName');
          if (storedUserId && storedUserName) {
            window.location.href = '/telegram?userId=' + encodeURIComponent(storedUserId) + '&name=' + encodeURIComponent(storedUserName);
          }
        })();

        function switchTab(tab) {
          document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
          document.querySelectorAll('.form').forEach(f => f.classList.remove('active'));
          if (tab === 'login') {
            document.querySelector('.tab[onclick="switchTab(\\'login\\')"]').classList.add('active');
            document.getElementById('loginForm').classList.add('active');
          } else {
            document.querySelector('.tab[onclick="switchTab(\\'register\\')"]').classList.add('active');
            document.getElementById('registerForm').classList.add('active');
          }
        }

        async function login() {
          console.log('Login clicked');
          const username = document.getElementById('loginUsername').value.trim();
          const password = document.getElementById('loginPassword').value;
          const errorDiv = document.getElementById('loginError');
          const btn = document.querySelector('#loginForm .btn');

          if (!username || !password) {
            errorDiv.textContent = 'Username and password required';
            errorDiv.style.display = 'block';
            return;
          }

          errorDiv.style.display = 'none';
          btn.disabled = true;
          btn.textContent = 'Logging in...';

          try {
            const res = await fetch('/api/login', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ username, password })
            });
            const data = await res.json();
            if (!res.ok) {
              errorDiv.textContent = data.error || 'Login failed';
              errorDiv.style.display = 'block';
              btn.disabled = false;
              btn.textContent = 'Login';
            } else {
              // Store credentials for auto‑login
              localStorage.setItem('appUserId', data.userId);
              localStorage.setItem('appUserName', data.userName);
              window.location.href = '/telegram?userId=' + encodeURIComponent(data.userId) + '&name=' + encodeURIComponent(data.userName);
            }
          } catch (err) {
            console.error('Login fetch error:', err);
            errorDiv.textContent = err.message || 'Network error – check your connection';
            errorDiv.style.display = 'block';
            btn.disabled = false;
            btn.textContent = 'Login';
          }
        }

        async function register() {
          console.log('Register clicked');
          const username = document.getElementById('regUsername').value.trim();
          const password = document.getElementById('regPassword').value;
          const referral = document.getElementById('regReferral').value.trim();
          const errorDiv = document.getElementById('regError');
          const successDiv = document.getElementById('regSuccess');
          const btn = document.querySelector('#registerForm .btn');

          // Clear previous messages
          errorDiv.style.display = 'none';
          successDiv.style.display = 'none';

          // Validation
          if (!username || !password) {
            errorDiv.textContent = 'Username and password required';
            errorDiv.style.display = 'block';
            return;
          }
          if (username.length < 3) {
            errorDiv.textContent = 'Username must be at least 3 characters';
            errorDiv.style.display = 'block';
            return;
          }
          if (password.length < 6) {
            errorDiv.textContent = 'Password must be at least 6 characters';
            errorDiv.style.display = 'block';
            return;
          }

          btn.disabled = true;
          btn.textContent = 'Registering...';

          try {
            const res = await fetch('/api/register', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ username, password, referralCode: referral })
            });
            const data = await res.json();
            console.log('Registration response:', data);
            if (!res.ok) {
              errorDiv.textContent = data.error || 'Registration failed';
              errorDiv.style.display = 'block';
              btn.disabled = false;
              btn.textContent = 'Register';
            } else {
              successDiv.textContent = 'Registration successful! Redirecting...';
              successDiv.style.display = 'block';

              // Store credentials for auto‑login
              localStorage.setItem('appUserId', data.userId);
              localStorage.setItem('appUserName', data.userName);

              setTimeout(() => {
                window.location.href = '/telegram?userId=' + encodeURIComponent(data.userId) + '&name=' + encodeURIComponent(data.userName);
              }, 1500);
            }
          } catch (err) {
            console.error('Registration fetch error:', err);
            errorDiv.textContent = err.message || 'Network error – please try again';
            errorDiv.style.display = 'block';
            btn.disabled = false;
            btn.textContent = 'Register';
          }
        }
      </script>
    </body>
    </html>
  `);
});

// ========== HEALTH CHECK ENDPOINTS ==========
app.get('/health', async (req, res) => {
  try {
    const health = {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
      memory: process.memoryUsage(),
      nodeVersion: process.version,
      platform: process.platform
    };
    
    res.json(health);
  } catch (error) {
    res.status(500).json({ 
      status: 'error',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

app.get('/ready', async (req, res) => {
  try {
    // Check MongoDB connection
    await mongoose.connection.db.admin().ping();
    
    res.json({
      status: 'ready',
      database: 'connected',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(503).json({
      status: 'not_ready',
      database: 'disconnected',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

app.get('/status', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Server Status</title>
      <style>
        body { font-family: Arial, sans-serif; padding: 20px; background: #0f172a; color: white; }
        .status { padding: 20px; background: #1e293b; border-radius: 10px; margin: 20px 0; }
        .ok { color: #10b981; }
        .error { color: #ef4444; }
      </style>
    </head>
    <body>
      <h1>Server Status</h1>
      <div class="status">
        <p><strong>Status:</strong> <span class="ok">✅ Running</span></p>
        <p><strong>Uptime:</strong> ${Math.floor(process.uptime())} seconds</p>
        <p><strong>Database:</strong> ${mongoose.connection.readyState === 1 ? '<span class="ok">✅ Connected</span>' : '<span class="error">❌ Disconnected</span>'}</p>
        <p><strong>Memory Usage:</strong> ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)} MB</p>
        <p><strong>Node Version:</strong> ${process.version}</p>
        <p><strong>Environment:</strong> ${process.env.NODE_ENV || 'development'}</p>
      </div>
      <a href="/" style="color: #3b82f6;">← Back to Home</a>
    </body>
    </html>
  `);
});

// ========== AGENT PORTAL PAGE ==========
app.get('/agent', (req, res) => {
  // Serve the agent-dashboard.html file
  res.sendFile(path.join(__dirname, 'agent-dashboard.html'), (err) => {
    if (err) {
      console.error('Error serving agent dashboard:', err);
      // Fallback to a simple HTML page
      res.send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Agent Portal - Bingo Elite</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 40px; text-align: center; background: #0f172a; color: #f8fafc; }
            .container { max-width: 800px; margin: 0 auto; }
            .login-form { background: #1e293b; padding: 30px; border-radius: 15px; margin: 30px auto; max-width: 400px; }
            input, button { width: 100%; padding: 12px; margin: 10px 0; border-radius: 8px; border: 1px solid #334155; background: #0f172a; color: white; }
            button { background: #f59e0b; color: white; font-weight: bold; cursor: pointer; }
            .btn { display: inline-block; padding: 12px 24px; background: #3b82f6; color: white; text-decoration: none; border-radius: 8px; margin: 10px; font-weight: bold; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1 style="font-size: 2.5rem; margin-bottom: 10px;">👑 Agent Portal</h1>
            <p style="color: #f59e0b; margin-bottom: 30px;">Bingo Elite - Commission Management System</p>
            
            <div class="login-form">
              <h2>Agent Login</h2>
              <input type="text" id="username" placeholder="Username">
              <input type="password" id="password" placeholder="Password">
              <button onclick="login()">Login</button>
              <div id="loginError" style="color: #ef4444; margin-top: 10px; display: none;"></div>
            </div>
            
            <div style="margin-top: 30px; padding: 20px; background: rgba(245, 158, 11, 0.1); border-radius: 12px;">
              <h3>Agent System Features:</h3>
              <p style="text-align: left; color: #94a3b8;">
                • 40% commission from Bingo wins<br>
                • 10% commission from Keno wins<br>
                • 10% commission from Crash wins<br>
                • Real-time commission tracking<br>
                • Agent dashboard with statistics<br>
                • Referral link generation<br>
                • Withdrawal requests<br>
                • Admin panel for agent management<br>
              </p>
            </div>
            
            <div style="margin-top: 30px;">
              <a href="/" class="btn" style="background: #3b82f6;">← Back to Home</a>
              <a href="/telegram" class="btn" style="background: #8b5cf6;">🤖 Telegram Entry</a>
            </div>
          </div>
          
          <script src="/socket.io/socket.io.js"></script>
          <script>
            const socket = io();
            
            function login() {
              const username = document.getElementById('username').value;
              const password = document.getElementById('password').value;
              
              socket.emit('agent:login', { username, password });
            }
            
            socket.on('agent:loginSuccess', (data) => {
              // Redirect to full agent dashboard
              window.location.href = '/agent-dashboard.html';
            });
            
            socket.on('agent:loginError', (message) => {
              const errorDiv = document.getElementById('loginError');
              errorDiv.textContent = message;
              errorDiv.style.display = 'block';
            });
          </script>
        </body>
        </html>
      `);
    }
  });
});

// Serve Agent Portal HTML (fallback if file doesn't exist)
app.get('/agent-dashboard.html', (req, res) => {
  res.redirect('/agent');
});

// ========== REDESIGNED TELEGRAM ENTRY PAGE - WITH FALLBACK FOR TELEGRAM USERS ==========
app.get('/telegram', async (req, res) => {
  try {
    const telebirrNumber = await getTelebirrNumber();
    const minWithdrawal = gameLogic.CONFIG ? gameLogic.CONFIG.MIN_WITHDRAWAL : 50;
    const minDeposit = gameLogic.CONFIG ? (gameLogic.CONFIG.MIN_DEPOSIT || 10) : 10;

    // Load custom icons if present
    let bingoIconBase64 = '', kenoIconBase64 = '', crashIconBase64 = '';
    try {
      const bingoPath = path.join(__dirname, 'bingo-icon.png.jpg');
      const bingoBuffer = fs.readFileSync(bingoPath);
      bingoIconBase64 = bingoBuffer.toString('base64');
    } catch (e) {}
    try {
      const kenoPath = path.join(__dirname, 'keno-icon.png.jpg');
      const kenoBuffer = fs.readFileSync(kenoPath);
      kenoIconBase64 = kenoBuffer.toString('base64');
    } catch (e) {}
    // Optional crash icon (not required, uses fallback)
    
    res.send(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
        <title>ETHIO GAMES · Telegram Mini App</title>
        <script src="https://telegram.org/js/telegram-web-app.js"></script>
        <style>
          /* Clean, minimal dark theme */
          * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
            -webkit-tap-highlight-color: transparent;
          }

          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, sans-serif;
            background: #0a0c10;
            color: #f0f4fa;
            line-height: 1.4;
          }

          .container {
            max-width: 400px;
            margin: 0 auto;
            padding: 16px;
            display: flex;
            flex-direction: column;
            gap: 24px;
          }

          .header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding-bottom: 8px;
            border-bottom: 1px solid #20262e;
          }

          .logo-text {
            font-size: 20px;
            font-weight: 600;
            letter-spacing: -0.5px;
            color: #ffffff;
          }
          .logo-text span {
            color: #8b5cf6;
          }

          .user-greeting {
            font-size: 14px;
            color: #8e9aaf;
          }

          .wallet-card {
            background: #13171c;
            border-radius: 24px;
            padding: 20px;
            border: 1px solid #262d36;
            display: flex;
            flex-direction: column;
            gap: 16px;
          }

          .wallet-label {
            display: flex;
            align-items: center;
            gap: 6px;
            color: #8e9aaf;
            font-size: 13px;
            font-weight: 500;
            text-transform: uppercase;
            letter-spacing: 0.4px;
          }

          .balance {
            font-size: 36px;
            font-weight: 700;
            line-height: 1;
          }
          .balance small {
            font-size: 16px;
            font-weight: 400;
            color: #8e9aaf;
            margin-left: 6px;
          }

          .wallet-actions {
            display: flex;
            gap: 12px;
          }

          .btn {
            flex: 1;
            padding: 12px;
            border-radius: 40px;
            border: none;
            font-weight: 600;
            font-size: 14px;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 6px;
            background: #20262e;
            color: white;
            transition: background 0.2s;
            cursor: pointer;
          }
          .btn-primary {
            background: #3b82f6;
          }
          .btn-primary:active { background: #2563eb; }
          .btn:active { background: #2d343e; }

          .section-title {
            font-size: 16px;
            font-weight: 600;
            margin-bottom: 16px;
            display: flex;
            align-items: center;
            gap: 8px;
            color: #f0f4fa;
          }

          .games-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 16px;
          }

          .game-card {
            background: #13171c;
            border: 1px solid #262d36;
            border-radius: 24px;
            padding: 20px 16px;
            display: flex;
            flex-direction: column;
            align-items: center;
            text-align: center;
            transition: transform 0.1s;
          }
          .game-card:active {
            background: #1a1f26;
          }

          .game-icon {
            width: 80px;
            height: 80px;
            border-radius: 18px;
            margin-bottom: 12px;
            object-fit: cover;
            border: 1px solid #3b82f6;
          }
          .keno-icon {
            border-color: #8b5cf6;
          }
          .crash-icon {
            border-color: #f97316;
          }

          /* Fallback CSS icons (if image missing) */
          .bingo-icon-fallback {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            width: 80px;
            height: 80px;
            background: #1e293b;
            border-radius: 18px;
            border: 1px solid #3b82f6;
            box-shadow: 0 0 0 1px rgba(59,130,246,0.3);
          }
          .bingo-numbers-row {
            display: flex;
            gap: 6px;
            margin-bottom: 6px;
          }
          .bingo-number {
            background: #0f172a;
            color: #60a5fa;
            width: 24px;
            height: 24px;
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: 6px;
            font-size: 12px;
            font-weight: 600;
          }
          .bingo-word {
            font-size: 16px;
            font-weight: 800;
            letter-spacing: 2px;
            color: #fbbf24;
            margin-top: 2px;
          }
          .keno-icon-fallback {
            display: flex;
            align-items: center;
            justify-content: center;
            width: 80px;
            height: 80px;
            background: linear-gradient(145deg, #2d2b55, #1e1a3a);
            border-radius: 18px;
            border: 1px solid #8b5cf6;
          }
          .keno-word {
            font-size: 24px;
            font-weight: 800;
            color: white;
            text-shadow: 0 2px 0 #5b21b6;
            letter-spacing: 4px;
          }
          .crash-icon-fallback {
            display: flex;
            align-items: center;
            justify-content: center;
            width: 80px;
            height: 80px;
            background: linear-gradient(145deg, #3b2a1a, #251a0f);
            border-radius: 18px;
            border: 1px solid #f97316;
          }
          .crash-word {
            font-size: 28px;
            font-weight: 800;
            color: #fdba74;
            text-shadow: 0 2px 0 #b45309;
            letter-spacing: 2px;
          }

          .game-title {
            font-size: 18px;
            font-weight: 700;
            margin-bottom: 4px;
          }

          .game-desc {
            font-size: 12px;
            color: #8e9aaf;
            margin-bottom: 16px;
          }

          .play-btn {
            background: transparent;
            border: 1px solid #3b82f6;
            color: #3b82f6;
            padding: 8px 20px;
            border-radius: 40px;
            font-size: 13px;
            font-weight: 600;
            width: 100%;
            transition: all 0.2s;
            cursor: pointer;
          }
          .play-btn.keno {
            border-color: #8b5cf6;
            color: #c4b5fd;
          }
          .play-btn.crash {
            border-color: #f97316;
            color: #fdba74;
          }
          .play-btn:active {
            background: rgba(59,130,246,0.1);
          }

          .coming-soon {
            opacity: 0.6;
            pointer-events: none;
          }
          .coming-soon .play-btn {
            border-color: #5a6573;
            color: #8e9aaf;
          }

          .footer {
            margin-top: 24px;
            padding-top: 16px;
            border-top: 1px solid #20262e;
            display: flex;
            justify-content: center;
            gap: 24px;
            font-size: 12px;
            color: #5a6573;
          }
          .footer a {
            color: #8e9aaf;
            text-decoration: none;
          }
          .footer a:active { color: white; }

          .modal {
            display: none;
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0,0,0,0.8);
            backdrop-filter: blur(4px);
            align-items: center;
            justify-content: center;
            padding: 16px;
          }
          .modal-content {
            background: #13171c;
            border: 1px solid #262d36;
            border-radius: 32px;
            padding: 24px;
            width: 100%;
            max-width: 360px;
          }
          .modal-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 20px;
          }
          .modal-title {
            font-size: 20px;
            font-weight: 700;
          }
          .close-btn {
            background: none;
            border: none;
            color: #8e9aaf;
            font-size: 24px;
            cursor: pointer;
          }
          .form-group {
            margin-bottom: 16px;
          }
          .form-label {
            display: block;
            font-size: 13px;
            color: #8e9aaf;
            margin-bottom: 6px;
          }
          .form-input {
            width: 100%;
            padding: 14px;
            background: #0a0c10;
            border: 1px solid #262d36;
            border-radius: 16px;
            color: white;
            font-size: 16px;
          }
          .telebirr-info {
            background: #0f172a;
            padding: 16px;
            border-radius: 16px;
            margin-bottom: 20px;
            text-align: center;
            border: 1px solid #3b82f6;
          }
          .telebirr-number {
            font-size: 20px;
            font-weight: 700;
            color: #60a5fa;
          }
          .submit-btn {
            width: 100%;
            padding: 14px;
            background: #3b82f6;
            border: none;
            border-radius: 40px;
            color: white;
            font-weight: 600;
            font-size: 16px;
            margin-top: 8px;
            cursor: pointer;
          }
          .message {
            margin-top: 12px;
            text-align: center;
            font-size: 13px;
            display: none;
          }

          /* Fallback banner */
          .fallback-banner {
            background: #1e293b;
            border: 1px solid #f59e0b;
            border-radius: 12px;
            padding: 12px;
            margin-bottom: 16px;
            text-align: center;
            font-size: 14px;
          }
          .fallback-banner a {
            color: #f59e0b;
            font-weight: bold;
            text-decoration: none;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <!-- Header -->
          <div class="header">
            <div class="logo-text">ETHIO<span>GAMES</span></div>
            <div class="user-greeting" id="userGreeting" style="display: none;">
              👋 <span id="userName">User</span>
            </div>
          </div>

          <!-- Fallback message (hidden by default) -->
          <div id="fallbackMessage" class="fallback-banner" style="display: none;">
            ⚠️ Could not detect Telegram user. <a href="/app" style="color:#f59e0b;">Click here to login via mobile app</a>
          </div>

          <!-- Wallet Card -->
          <div class="wallet-card">
            <div class="wallet-label"><span>💰</span> YOUR WALLET</div>
            <div class="balance"><span id="walletBalance">0.00</span><small>ETB</small></div>
            <div class="wallet-actions">
              <button class="btn" onclick="openDepositModal()">💳 Deposit</button>
              <button class="btn btn-primary" onclick="openWithdrawModal()">💸 Withdraw</button>
            </div>
          </div>

          <!-- Active Games -->
          <div>
            <div class="section-title"><span>🎮 PLAY NOW</span></div>
            <div class="games-grid">
              <!-- BINGO card -->
              <div class="game-card" onclick="launchGame('bingo')">
                ${bingoIconBase64 
                  ? `<img src="data:image/png;base64,${bingoIconBase64}" class="game-icon" alt="Bingo">`
                  : `<div class="bingo-icon-fallback">
                       <div class="bingo-numbers-row">
                         <span class="bingo-number">12</span>
                         <span class="bingo-number">28</span>
                         <span class="bingo-number">45</span>
                         <span class="bingo-number">60</span>
                         <span class="bingo-number">77</span>
                       </div>
                       <div class="bingo-word">BINGO</div>
                     </div>`
                }
                <div class="game-title">Bingo Elite</div>
                <div class="game-desc">Real‑time multiplayer</div>
                <button class="play-btn">Play</button>
              </div>

              <!-- KENO card -->
              <div class="game-card" onclick="launchGame('keno')">
                ${kenoIconBase64 
                  ? `<img src="data:image/png;base64,${kenoIconBase64}" class="game-icon keno-icon" alt="Keno">`
                  : `<div class="keno-icon-fallback">
                       <div class="keno-word">KENO</div>
                     </div>`
                }
                <div class="game-title">Keno Ultra</div>
                <div class="game-desc">Fast number draws</div>
                <button class="play-btn keno">Play</button>
              </div>

              <!-- CRASH card -->
              <div class="game-card" onclick="launchGame('crash')">
                <div class="crash-icon-fallback">
                  <div class="crash-word">✈️</div>
                </div>
                <div class="game-title">Crash</div>
                <div class="game-desc">Cash out before it crashes</div>
                <button class="play-btn crash">Play</button>
              </div>

              <!-- COMING SOON: Lottery -->
              <div class="game-card coming-soon">
                <div style="width:80px;height:80px;background:#20262e;border-radius:18px;margin-bottom:12px;display:flex;align-items:center;justify-content:center;font-size:32px;">🎫</div>
                <div class="game-title">Ethio Lottery</div>
                <div class="game-desc">Daily jackpots</div>
                <button class="play-btn" disabled>Soon</button>
              </div>
            </div>
          </div>

          <!-- Footer Links -->
          <div class="footer">
            <a href="#" onclick="showHelp()">Help</a>
            <a href="#" onclick="showAgentInfo()">Agent</a>
            <a href="#" onclick="showTerms()">Terms</a>
          </div>
        </div>

        <!-- Deposit Modal -->
        <div class="modal" id="depositModal">
          <div class="modal-content">
            <div class="modal-header">
              <div class="modal-title">💳 Deposit</div>
              <button class="close-btn" onclick="closeDepositModal()">×</button>
            </div>
            <div class="telebirr-info">
              <div style="color:#8e9aaf; margin-bottom:8px;">Send money to</div>
              <div class="telebirr-number">${telebirrNumber}</div>
              <div style="color:#8e9aaf; margin-top:8px;">Min: ${minDeposit} ETB</div>
            </div>
            <div class="form-group">
              <label class="form-label">Receipt number</label>
              <input type="text" class="form-input" id="depositReceipt" placeholder="e.g. RT123456789">
            </div>
            <div class="form-group">
              <label class="form-label">Amount (ETB)</label>
              <input type="number" class="form-input" id="depositAmount" placeholder="0.00" min="${minDeposit}" max="10000">
            </div>
            <div class="message" id="depositMessage"></div>
            <button class="submit-btn" onclick="submitDeposit()">Submit deposit</button>
          </div>
        </div>

        <!-- Withdraw Modal -->
        <div class="modal" id="withdrawModal">
          <div class="modal-content">
            <div class="modal-header">
              <div class="modal-title">💸 Withdraw</div>
              <button class="close-btn" onclick="closeWithdrawModal()">×</button>
            </div>
            <div class="form-group">
              <label class="form-label">Amount (ETB)</label>
              <input type="number" class="form-input" id="withdrawAmount" placeholder="0.00" min="${minWithdrawal}" max="5000">
            </div>
            <div class="form-group">
              <label class="form-label">Telebirr number</label>
              <input type="tel" class="form-input" id="withdrawPhone" placeholder="09XXXXXXXX">
            </div>
            <div class="message" id="withdrawMessage"></div>
            <button class="submit-btn" onclick="submitWithdraw()">Request withdrawal</button>
          </div>
        </div>

        <script src="/socket.io/socket.io.js"></script>
        <script>
          // --- Telegram WebApp init ---
          const tg = window.Telegram?.WebApp;
          const socket = io();
          let currentUserId = null;
          let currentBalance = 0;
          let fallbackTimer = null;

          // Try to get user from URL first (app login)
          const urlParams = new URLSearchParams(window.location.search);
          const appUserId = urlParams.get('userId');
          const appUserName = urlParams.get('name');

          if (appUserId && appUserName) {
            // Mobile app user – skip Telegram
            currentUserId = appUserId;
            document.getElementById('userGreeting').style.display = 'flex';
            document.getElementById('userName').textContent = appUserName;
            sessionStorage.setItem('appUserId', appUserId);
            sessionStorage.setItem('appUserName', appUserName);
            startApp();
          } else {
            // Try Telegram user
            if (tg) {
              tg.ready(); // Tell Telegram we are ready
              const user = tg.initDataUnsafe?.user;
              if (user) {
                currentUserId = 'tg_' + user.id;
                document.getElementById('userGreeting').style.display = 'flex';
                document.getElementById('userName').textContent = user.first_name || 'User';
                localStorage.setItem('telegramUser', JSON.stringify(user));
                startApp();
              } else {
                // No user data yet – wait a bit, then show fallback
                fallbackTimer = setTimeout(() => {
                  document.getElementById('fallbackMessage').style.display = 'block';
                }, 2000);
              }
            } else {
              // No Telegram object at all – show fallback immediately
              document.getElementById('fallbackMessage').style.display = 'block';
            }
          }

          function startApp() {
            if (fallbackTimer) clearTimeout(fallbackTimer);
            if (currentUserId) {
              socket.emit('init', { userId: currentUserId, userName: appUserName || (tg?.initDataUnsafe?.user?.first_name) || 'User' });
              loadBalance();
            }
          }

          // --- Balance ---
          async function loadBalance() {
            if (!currentUserId) return;
            try {
              const res = await fetch('/api/user/' + currentUserId + '/balance');
              const data = await res.json();
              currentBalance = data.balance || 0;
              document.getElementById('walletBalance').textContent = currentBalance.toFixed(2);
            } catch (e) {
              socket.emit('refreshBalance');
            }
          }

          socket.on('balanceUpdate', (bal) => {
            currentBalance = bal;
            document.getElementById('walletBalance').textContent = bal.toFixed(2);
          });

          // ========== MODIFIED: launchGame includes userId and name in URL ==========
          function launchGame(game) {
            tg?.HapticFeedback?.impactOccurred('light');
            const userId = encodeURIComponent(currentUserId);
            const name = encodeURIComponent(appUserName || tg?.initDataUnsafe?.user?.first_name || 'User');
            if (game === 'bingo') window.location.href = '/game?userId=' + userId + '&name=' + name;
            if (game === 'keno') window.location.href = '/keno?userId=' + userId + '&name=' + name;
            if (game === 'crash') window.location.href = '/crash?userId=' + userId + '&name=' + name;
          }

          // --- Modals ---
          function openDepositModal() {
            document.getElementById('depositModal').style.display = 'flex';
          }
          function closeDepositModal() {
            document.getElementById('depositModal').style.display = 'none';
          }
          function openWithdrawModal() {
            if (currentBalance < ${minWithdrawal}) {
              alert('Minimum withdrawal: ' + ${minWithdrawal} + ' ETB');
              return;
            }
            document.getElementById('withdrawModal').style.display = 'flex';
          }
          function closeWithdrawModal() {
            document.getElementById('withdrawModal').style.display = 'none';
          }

          // --- Deposit submission ---
          function submitDeposit() {
            const receipt = document.getElementById('depositReceipt').value.trim();
            const amount = parseFloat(document.getElementById('depositAmount').value);
            if (!receipt) return showMessage('depositMessage', 'Enter receipt number');
            if (amount < ${minDeposit} || amount > 10000) return showMessage('depositMessage', 'Amount must be between ${minDeposit} and 10000 ETB');

            const btn = document.querySelector('#depositModal .submit-btn');
            btn.disabled = true; btn.textContent = 'Sending...';

            socket.emit('wallet:depositRequest', {
              receiptNumber: receipt,
              amount: amount,
              userId: currentUserId,
              userName: appUserName || tg?.initDataUnsafe?.user?.first_name || 'User'
            });

            socket.once('wallet:depositRequestSuccess', (resp) => {
              showMessage('depositMessage', resp.message || 'Submitted! Admin will approve soon.', 'success');
              setTimeout(closeDepositModal, 2000);
              btn.disabled = false; btn.textContent = 'Submit deposit';
              loadBalance();
            });
            socket.once('wallet:error', (err) => {
              showMessage('depositMessage', err || 'Request failed', 'error');
              btn.disabled = false; btn.textContent = 'Submit deposit';
            });
          }

          // --- Withdrawal submission ---
          function submitWithdraw() {
            const amount = parseFloat(document.getElementById('withdrawAmount').value);
            const phone = document.getElementById('withdrawPhone').value.trim();
            if (!amount || amount < ${minWithdrawal} || amount > 5000) return showMessage('withdrawMessage', 'Invalid amount');
            if (!/^09[0-9]{8}$/.test(phone)) return showMessage('withdrawMessage', 'Enter valid 09XXXXXXXX');

            const btn = document.querySelector('#withdrawModal .submit-btn');
            btn.disabled = true; btn.textContent = 'Processing...';

            socket.emit('wallet:withdrawRequest', {
              amount: amount,
              phoneNumber: phone,
              userId: currentUserId,
              userName: appUserName || tg?.initDataUnsafe?.user?.first_name || 'User'
            });

            socket.once('wallet:withdrawRequestSuccess', (resp) => {
              showMessage('withdrawMessage', resp.message || 'Withdrawal requested!', 'success');
              setTimeout(closeWithdrawModal, 2000);
              btn.disabled = false; btn.textContent = 'Request withdrawal';
              loadBalance();
            });
            socket.once('wallet:error', (err) => {
              showMessage('withdrawMessage', err || 'Request failed', 'error');
              btn.disabled = false; btn.textContent = 'Request withdrawal';
            });
          }

          function showMessage(elId, text, type = 'error') {
            const el = document.getElementById(elId);
            el.textContent = text;
            el.style.display = 'block';
            el.style.color = type === 'success' ? '#10b981' : '#ef4444';
          }

          // --- Helper popups ---
          function showHelp() {
            tg?.showPopup({ title: 'How to play', message: 'BINGO: select ticket → mark numbers → claim BINGO.\\nKENO: pick 5 numbers → win on matches.\\nCRASH: place bet, cash out before plane crashes.\\nDeposit: send to ${telebirrNumber}, enter receipt.' });
          }
          function showAgentInfo() {
            tg?.showPopup({ title: 'Agent System', message: '👑 Earn 40% Bingo, 10% Keno, 10% Crash commissions.\\nOpen /agent portal or contact @Ethio_elite_games_bot' });
          }
          function showTerms() {
            tg?.showPopup({ title: 'Terms', message: 'Play responsibly. 18+. Admin decisions final.' });
          }

          // --- Close modal on outside click ---
          window.onclick = (e) => {
            if (e.target === document.getElementById('depositModal')) closeDepositModal();
            if (e.target === document.getElementById('withdrawModal')) closeWithdrawModal();
          };

          // --- Auto refresh balance ---
          setInterval(loadBalance, 30000);
        </script>
      </body>
      </html>
    `);
  } catch (error) {
    console.error('Error serving Telegram page:', error);
    res.status(500).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Error</title>
      </head>
      <body>
        <h1>Error loading Telegram page</h1>
        <p>${error.message}</p>
        <a href="/">← Back to Home</a>
      </body>
      </html>
    `);
  }
});

// ========== NEW: Serve Crash HTML page ==========
app.get('/crash', (req, res) => {
  const crashPath = path.join(__dirname, 'public', 'crash.html');
  if (fs.existsSync(crashPath)) {
    res.sendFile(crashPath);
  } else {
    // If crash.html doesn't exist, serve a placeholder (you should create the full crash.html file)
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Crash Game - ETHIO GAMES</title>
        <style>
          body { font-family: Arial; padding: 40px; text-align: center; background: #0f172a; color: white; }
          h1 { color: #f97316; }
        </style>
      </head>
      <body>
        <h1>✈️ Crash Game</h1>
        <p>Loading game... (ensure crash.html is in public folder)</p>
        <a href="/">Back to Home</a>
        <script src="/socket.io/socket.io.js"></script>
        <script>
          const socket = io();
          const urlParams = new URLSearchParams(window.location.search);
          const userId = urlParams.get('userId');
          const name = urlParams.get('name') || 'Player';
          if (userId) socket.emit('init', { userId, userName: name });
        </script>
      </body>
      </html>
    `);
  }
});

// Serve Keno HTML page
app.get('/keno', (req, res) => {
  if (fs.existsSync(path.join(__dirname, 'keno.html'))) {
    res.sendFile(path.join(__dirname, 'keno.html'));
  } else if (fs.existsSync(path.join(__dirname, 'public/keno.html'))) {
    res.sendFile(path.join(__dirname, 'public/keno.html'));
  } else {
    res.redirect('/');
  }
});

// Serve Bingo HTML page
app.get('/game', (req, res) => {
  if (fs.existsSync(path.join(__dirname, 'game.html'))) {
    res.sendFile(path.join(__dirname, 'game.html'));
  } else if (fs.existsSync(path.join(__dirname, 'public/game.html'))) {
    res.sendFile(path.join(__dirname, 'public/game.html'));
  } else {
    res.redirect('/');
  }
});

// Serve Admin HTML page
app.get('/admin', (req, res) => {
  if (fs.existsSync(path.join(__dirname, 'admin.html'))) {
    res.sendFile(path.join(__dirname, 'admin.html'));
  } else if (fs.existsSync(path.join(__dirname, 'public/admin.html'))) {
    res.sendFile(path.join(__dirname, 'public/admin.html'));
  } else {
    res.redirect('/');
  }
});

// ========== API ENDPOINTS ==========
// API endpoint to get user balance
app.get('/api/user/:userId', async (req, res) => {
  try {
    const user = await User.findOne({ userId: req.params.userId });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json({
      userId: user.userId,
      userName: user.userName,
      balance: user.balance,
      isOnline: user.isOnline,
      lastSeen: user.lastSeen,
      telegramId: user.telegramId,
      phoneNumber: user.phoneNumber || '',
      agentId: user.agentId || null,
      referredBy: user.referredBy || null,
      agentReferredAt: user.agentReferredAt || null,
      agentCommissionEarned: user.agentCommissionEarned || 0
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API endpoint to get user balance (simple version for Telegram entry page)
app.get('/api/user/:userId/balance', async (req, res) => {
  try {
    const user = await User.findOne({ userId: req.params.userId });
    if (!user) {
      return res.json({ balance: 0 });
    }
    res.json({ 
      balance: user.balance,
      userName: user.userName 
    });
  } catch (error) {
    res.json({ balance: 0, error: error.message });
  }
});

// API endpoint to get Telebirr number
app.get('/api/telebirr-number', async (req, res) => {
  try {
    const telebirrNumber = await getTelebirrNumber();
    res.json({ telebirrNumber });
  } catch (error) {
    console.error('Error getting Telebirr number:', error);
    res.status(500).json({ error: error.message, telebirrNumber: '0962577855' });
  }
});

// API endpoint to add funds (for admin)
app.post('/api/add-funds', async (req, res) => {
  try {
    const { userId, amount, adminPassword } = req.body;
    
    if (adminPassword !== (gameLogic.CONFIG ? gameLogic.CONFIG.ADMIN_PASSWORD : 'admin123')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    const user = await User.findOne({ userId: userId });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    user.balance += parseFloat(amount);
    await user.save();
    
    const transaction = new Transaction({
      type: 'ADMIN_ADD',
      userId: userId,
      userName: user.userName,
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

// API endpoint to get agent by referral code
app.get('/api/agent/:referralCode', async (req, res) => {
  try {
    const agent = await Agent.findOne({ 
      referralCode: req.params.referralCode,
      isActive: true 
    }).select('name username referralCode commissionRateBingo commissionRateKeno commissionRateCrash');
    
    if (!agent) {
      return res.status(404).json({ error: 'Agent not found or inactive' });
    }
    
    res.json({
      success: true,
      agent: {
        id: agent._id,
        name: agent.name,
        username: agent.username,
        referralCode: agent.referralCode,
        commissionRateBingo: agent.commissionRateBingo,
        commissionRateKeno: agent.commissionRateKeno,
        commissionRateCrash: agent.commissionRateCrash
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API endpoint to get referral statistics
app.get('/api/referral-stats', async (req, res) => {
  try {
    const totalUsers = await User.countDocuments();
    const usersWithAgents = await User.countDocuments({ agentId: { $exists: true, $ne: null } });
    const usersWithoutAgents = totalUsers - usersWithAgents;
    
    // Get referral methods breakdown
    const telegramReferrals = await Referral.countDocuments({ referralMethod: 'telegram_link' });
    const manualReferrals = await Referral.countDocuments({ referralMethod: { $in: ['manual', 'bulk_manual'] } });
    const adminReferrals = await Referral.countDocuments({ referralMethod: 'admin_assigned' });
    
    res.json({
      success: true,
      stats: {
        totalUsers,
        usersWithAgents,
        usersWithoutAgents,
        referralMethods: {
          telegramLinks: telegramReferrals,
          manualAssignments: manualReferrals,
          adminAssignments: adminReferrals || 0
        }
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ========== MOBILE APP REGISTRATION & LOGIN API ==========
function generateAppUserId(username) {
  const randomPart = crypto.randomBytes(4).toString('hex'); // 8 random hex chars
  return `app_${username}_${randomPart}`;
}

// Registration endpoint (improved)
app.post('/api/register', async (req, res) => {
  try {
    const { username, password, referralCode } = req.body;

    // Basic validation
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }
    if (username.length < 3) {
      return res.status(400).json({ error: 'Username must be at least 3 characters' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    // Check if username already exists (case‑insensitive)
    const existingUser = await User.findOne({ userName: { $regex: new RegExp(`^${username}$`, 'i') } });
    if (existingUser) {
      return res.status(409).json({ error: 'Username already taken' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create a unique userId for this app user
    const userId = generateAppUserId(username);

    // Generate a truly unique referral code for the new user (optional, but used for referral tracking)
    const userReferralCode = 'APP' + crypto.randomBytes(4).toString('hex').toUpperCase();

    // Create the user document
    const newUser = new User({
      userId,
      userName: username,
      password: hashedPassword,
      balance: 0,
      referralCode: userReferralCode,
      joinedAt: new Date(),
      lastSeen: new Date()
    });

    await newUser.save();
    console.log(`✅ New app user registered: ${username} (${userId})`);

    // If a referral code was provided, process it (optional) – run in background
    if (referralCode && agentSystem && typeof agentSystem.processReferral === 'function') {
      agentSystem.processReferral(userId, referralCode).catch(err => {
        console.error('❌ Error processing referral during registration:', err);
      });
    }

    res.json({
      success: true,
      message: 'Registration successful',
      userId,
      userName: username
    });
  } catch (error) {
    console.error('Registration error details:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Login endpoint
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }

    // Find user (case‑insensitive)
    const user = await User.findOne({ userName: { $regex: new RegExp(`^${username}$`, 'i') } }).select('+password');
    if (!user) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    // If the user doesn't have a password field (old users), you may need to handle that
    if (!user.password) {
      return res.status(401).json({ error: 'Account not set up for app login' });
    }

    // Compare password
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    // Update last seen
    user.lastSeen = new Date();
    await user.save();

    res.json({
      success: true,
      message: 'Login successful',
      userId: user.userId,
      userName: user.userName,
      balance: user.balance
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ========== TELEGRAM BOT INTEGRATION ==========
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN || 'YOUR_BOT_TOKEN_HERE'; // Set your new bot token here

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
      
      const telebirrNumber = await getTelebirrNumber();
      const minWithdrawal = gameLogic.CONFIG ? gameLogic.CONFIG.MIN_WITHDRAWAL : 50;
      const minDeposit = gameLogic.CONFIG ? (gameLogic.CONFIG.MIN_DEPOSIT || 10) : 10;
      
      // Check for referral parameter in start command
      const referralMatch = text.match(/\/start ref_(\w+)/);
      const referralCode = referralMatch ? referralMatch[1] : null;
      
      if (text.startsWith('/start') || text === '/play') {
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
          
          // Process referral if present
          if (referralCode && agentSystem && agentSystem.handleTelegramReferral) {
            await agentSystem.handleTelegramReferral(user.userId, referralCode);
          }
        }
        
        await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: `🎮 *Welcome to ETHIO GAMES, ${userName}!*\n\n` +
                  `💰 Your balance: *${user.balance.toFixed(2)} ETB*\n\n` +
                  `🎯 *Games Available:*\n` +
                  `• 🎱 **BINGO ELITE** - Real-time multiplayer bingo\n` +
                  `• 🎰 **KENO ULTRA** - Fast number selection game\n` +
                  `• ✈️ **CRASH GAME** - Cash out before it crashes\n` +
                  `• 🎫 **ETHIO LOTTERY** - Coming soon!\n` +
                  `• 🎰 **SLOTS GALAXY** - Coming soon!\n\n` +
                  `💳 *Wallet Instructions:*\n` +
                  `1. Send money to Telebirr: *${telebirrNumber}*\n` +
                  `2. Min deposit: ${minDeposit} ETB\n` +
                  `3. Enter receipt number in game wallet\n` +
                  `4. Admin will approve within 24 hours\n` +
                  `5. Min withdrawal: ${minWithdrawal} ETB\n\n` +
                  `_Need help? Contact admin_`,
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [[
                {
                  text: '🎮 Play Games',
                  web_app: { url: 'https://bingo-telegram-game.onrender.com/telegram' }
                },
                {
                  text: '💰 Check Balance',
                  callback_data: 'check_balance'
                }
              ]]
            }
          })
        });
      }
      else if (text === '/balance' || text === 'check_balance') {
        const user = await User.findOne({ telegramId: userId });
        const balance = user ? user.balance : 0;
        
        await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: `💰 *Your Balance:* ${balance.toFixed(2)} ETB\n\n` +
                  `💳 *Deposit to:* ${telebirrNumber}\n` +
                  `🎮 Play: @Ethio_elite_games_bot\n` +
                  `👑 Admin: Contact for funds\n` +
                  `🆔 Your ID: \`${userId}\``,
            parse_mode: 'Markdown'
          })
        });
      }
      else if (text === '/wallet') {
        await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: `💳 *ETHIO GAMES Wallet*\n\n` +
                  `*How to Deposit:*\n` +
                  `1. Send money to Telebirr: *${telebirrNumber}*\n` +
                  `2. Open game and go to Wallet (💰 button)\n` +
                  `3. Enter receipt number and amount\n` +
                  `4. Admin will approve within 24 hours\n\n` +
                  `*How to Withdraw:*\n` +
                  `1. Minimum withdrawal: ${minWithdrawal} ETB\n` +
                  `2. Open game Wallet\n` +
                  `3. Select amount and enter phone number\n` +
                  `4. Admin will send money within 24 hours\n\n` +
                  `🎮 *Play Now:* @Ethio_elite_games_bot`,
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [[
                {
                  text: '🎮 Open Games',
                  web_app: { url: 'https://bingo-telegram-game.onrender.com/telegram' }
                }
              ]]
            }
          })
        });
      }
      else if (text === '/agent' || text === '/referral') {
        await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: `👑 *ETHIO GAMES Agent System*\n\n` +
                  `*Agent Portal:* https://bingo-telegram-game.onrender.com/agent\n\n` +
                  `*How it works:*\n` +
                  `1. Become an agent and get referral link\n` +
                  `2. Share link with friends\n` +
                  `3. Friends join using your link\n` +
                  `4. You earn commission from their wins\n\n` +
                  `*Commission Rates:*\n` +
                  `• 🎱 Bingo wins: *40% commission*\n` +
                  `• 🎰 Keno wins: *10% commission*\n` +
                  `• ✈️ Crash wins: *10% commission*\n\n` +
                  `*How to become agent:*\n` +
                  `Contact admin @Ethio_elite_games_bot`,
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [[
                {
                  text: '👑 Open Agent Portal',
                  url: 'https://bingo-telegram-game.onrender.com/agent'
                }
              ]]
            }
          })
        });
      }
      else if (text === '/help') {
        await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: `🎮 *ETHIO GAMES Help*\n\n` +
                  `*Games Available:*\n` +
                  `• 🎱 **BINGO ELITE** - Real-time multiplayer bingo\n` +
                  `• 🎰 **KENO ULTRA** - Fast number selection game\n` +
                  `• ✈️ **CRASH GAME** - Cash out before it crashes\n` +
                  `• 🎫 **ETHIO LOTTERY** - Coming soon!\n` +
                  `• 🎰 **SLOTS GALAXY** - Coming soon!\n\n` +
                  `*Commands:*\n` +
                  `/start - Start the bot\n` +
                  `/play - Play games\n` +
                  `/balance - Check balance\n` +
                  `/wallet - Wallet instructions\n` +
                  `/agent - Agent system info\n` +
                  `/help - This message\n\n` +
                  `💳 *Wallet:*\n` +
                  `Deposit to Telebirr: *${telebirrNumber}*\n` +
                  `Min withdrawal: ${minWithdrawal} ETB\n` +
                  `Min deposit: ${minDeposit} ETB\n\n` +
                  `_Need help? Contact admin_`,
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

// Setup endpoint for Telegram bot
app.get('/setup-telegram', async (req, res) => {
  try {
    const telebirrNumber = await getTelebirrNumber();
    const minWithdrawal = gameLogic.CONFIG ? gameLogic.CONFIG.MIN_WITHDRAWAL : 50;
    const minDeposit = gameLogic.CONFIG ? (gameLogic.CONFIG.MIN_DEPOSIT || 10) : 10;
    const agentStats = agentSystem && agentSystem.getAgentStatistics ? await agentSystem.getAgentStatistics() : { 
      totalAgents: 0, 
      activeAgents: 0, 
      totalCommissions: 0 
    };
    
    const webhookResponse = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/setWebhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: 'https://bingo-telegram-game.onrender.com/telegram-webhook',
        drop_pending_updates: true
      })
    });
    
    const webhookResult = await webhookResponse.json();
    
    await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/setChatMenuButton`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        menu_button: {
          type: 'web_app',
          text: '🎮 Play Games',
          web_app: { url: 'https://bingo-telegram-game.onrender.com/telegram' }
        }
      })
    });
    
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Telegram Bot Setup Complete</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 40px; text-align: center; background: #0f172a; color: #f8fafc; }
          .container { max-width: 600px; margin: 0 auto; }
          .success { color: #10b981; font-size: 2rem; margin: 20px 0; }
          .info-box { background: #1e293b; padding: 20px; border-radius: 12px; margin: 20px 0; text-align: left; }
          .btn { display: inline-block; padding: 12px 24px; background: #3b82f6; color: white; text-decoration: none; border-radius: 8px; margin: 10px; font-weight: bold; }
          .telebirr-highlight { background: rgba(59, 130, 246, 0.1); padding: 15px; border-radius: 12px; margin: 20px 0; border: 1px solid rgba(59, 130, 246, 0.3); }
          .telebirr-number { font-size: 1.5rem; font-weight: bold; color: #60a5fa; margin: 10px 0; }
          .agent-highlight { background: rgba(245, 158, 11, 0.1); padding: 15px; border-radius: 12px; margin: 20px 0; border: 1px solid rgba(245, 158, 11, 0.3); }
          .game-highlight { background: rgba(139, 92, 246, 0.1); padding: 15px; border-radius: 12px; margin: 20px 0; border: 1px solid rgba(139, 92, 246, 0.3); }
          .crash-highlight { background: rgba(249, 115, 22, 0.1); padding: 15px; border-radius: 12px; margin: 20px 0; border: 1px solid rgba(249, 115, 22, 0.3); }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>✅ Telegram Bot Setup Complete!</h1>
          <div class="success">✓ Webhook Configured</div>
          <div class="success">✓ Menu Button Set</div>
          <div class="success">✓ Agent System Active</div>
          
          <div class="telebirr-highlight">
            <h3>📱 TELEBIRR PAYMENT NUMBER (DATABASE PERSISTED)</h3>
            <div class="telebirr-number">${telebirrNumber}</div>
            <p>This number is stored in MongoDB and will survive server restarts.</p>
            <p>Admin can update it in Admin Panel → Settings</p>
          </div>
          
          <div class="agent-highlight">
            <h3>👑 AGENT SYSTEM - NOW AVAILABLE</h3>
            <p><strong>Agent Portal:</strong> https://bingo-telegram-game.onrender.com/agent</p>
            <p><strong>Agent Statistics:</strong></p>
            <p>• Total Agents: ${agentStats.totalAgents || 0}</p>
            <p>• Active Agents: ${agentStats.activeAgents || 0}</p>
            <p>• Total Commissions: ${(agentStats.totalCommissions || 0).toFixed(2)} ETB</p>
            <p><strong>Commission Rates:</strong></p>
            <p>• Bingo wins: 40% commission</p>
            <p>• Keno wins: 10% commission</p>
            <p>• Crash wins: 10% commission</p>
            <p><strong>Agent Features:</strong></p>
            <p>• Real-time commission tracking</p>
            <p>• Agent dashboard with statistics</p>
            <p>• Referral link generation</p>
            <p>• Agent withdrawal system</p>
            <p>• Super admin management panel</p>
            <p>• Agent leaderboard</p>
          </div>
          
          <div class="game-highlight">
            <h3>🎮 ALL GAMES - NOW AVAILABLE</h3>
            <p><strong>Active Games:</strong></p>
            <p>• 🎱 <strong>BINGO ELITE:</strong> Real-time multiplayer bingo</p>
            <p>• 🎰 <strong>KENO ULTRA:</strong> Fast number selection game</p>
            <p>• ✈️ <strong>CRASH GAME:</strong> Cash out before it crashes</p>
            <p><strong>Coming Soon:</strong></p>
            <p>• 🎫 <strong>ETHIO LOTTERY:</strong> Daily draws with massive jackpots</p>
            <p>• 🎰 <strong>SLOTS GALAXY:</strong> Exciting slot machines with bonuses</p>
            <p><strong>Wallet Features:</strong></p>
            <p>• Telebirr Number: ${telebirrNumber} <strong>(DATABASE PERSISTED)</strong></p>
            <p>• Minimum Deposit: ${minDeposit} ETB</p>
            <p>• Minimum Withdrawal: ${minWithdrawal} ETB</p>
            <p>• Admin approval for all transactions</p>
          </div>
          
          <div class="crash-highlight">
            <h3>✈️ CRASH GAME - NEW!</h3>
            <p>• Multiplier increases until crash</p>
            <p>• Cash out anytime before crash</p>
            <p>• Auto cashout option</p>
            <p>• Real‑time canvas animation</p>
            <p>• 10% agent commission on net wins</p>
            <p>• Play at <a href="/crash" style="color:#f97316;">/crash</a></p>
          </div>
          
          <div class="info-box">
            <h3>Bot Information:</h3>
            <p><strong>Bot:</strong> @Ethio_elite_games_bot</p>
            <p><strong>Game Entry:</strong> https://bingo-telegram-game.onrender.com/telegram</p>
            <p><strong>Agent Portal:</strong> https://bingo-telegram-game.onrender.com/agent</p>
            <p><strong>Bingo Game:</strong> https://bingo-telegram-game.onrender.com/game</p>
            <p><strong>Keno Game:</strong> https://bingo-telegram-game.onrender.com/keno</p>
            <p><strong>Crash Game:</strong> https://bingo-telegram-game.onrender.com/crash</p>
            <p><strong>Admin Panel:</strong> https://bingo-telegram-game.onrender.com/admin</p>
            <p><strong>Admin Password:</strong> ${gameLogic.CONFIG ? gameLogic.CONFIG.ADMIN_PASSWORD : 'admin123'}</p>
          </div>
          
          <div>
            <a href="https://t.me/Ethio_elite_games_bot" class="btn" target="_blank">Open Bot in Telegram</a>
            <a href="/admin" class="btn" style="background: #ef4444;" target="_blank">Open Admin Panel</a>
            <a href="/agent" class="btn" style="background: #f59e0b;" target="_blank">Test Agent Portal</a>
            <a href="/telegram" class="btn" style="background: #8b5cf6;" target="_blank">Test Telegram Entry</a>
          </div>
          
          <div style="margin-top: 30px; text-align: left;">
            <h4>Next Steps:</h4>
            <ol>
              <li>Open @Ethio_elite_games_bot in Telegram</li>
              <li>Click "Start"</li>
              <li>Click menu button (bottom left)</li>
              <li>Choose between Bingo, Keno, or Crash!</li>
              <li>Check your wallet balance on the main screen</li>
            </ol>
            
            <h4>Agent System Instructions:</h4>
            <ol>
              <li>Open Agent Portal (/agent)</li>
              <li>Login with agent credentials (contact admin)</li>
              <li>Generate referral link</li>
              <li>Share link with friends</li>
              <li>Earn 40% from Bingo, 10% from Keno, 10% from Crash wins</li>
              <li>Request withdrawal when you have earnings</li>
            </ol>
            
            <h4>Default Admin Agent:</h4>
            <ul>
              <li>Username: admin</li>
              <li>Password: admin123</li>
              <li>Referral Code: ADMIN001</li>
              <li>Can create new agents in admin panel</li>
            </ul>
          </div>
        </div>
      </body>
      </html>
    `);
  } catch (error) {
    res.send(`
      <h1 style="color: #ef4444;">❌ Setup Error</h1>
      <p>${error.message}</p>
      <p>Make sure your bot token is correct: ${TELEGRAM_TOKEN}</p>
    `);
  }
});

// ========== DEBUG ENDPOINTS ==========
app.get('/debug-connections', (req, res) => {
  try {
    const connectedSockets = gameLogic && gameLogic.getConnectedSockets ? gameLogic.getConnectedSockets().size : 0;
    const socketToUser = gameLogic && gameLogic.getSocketToUser ? gameLogic.getSocketToUser().size : 0;
    const adminSockets = gameLogic && gameLogic.getAdminSockets ? gameLogic.getAdminSockets().size : 0;
    const processingClaims = gameLogic && gameLogic.getProcessingClaims ? gameLogic.getProcessingClaims().size : 0;
    const roomWinners = gameLogic && gameLogic.getRoomWinners ? gameLogic.getRoomWinners().size : 0;
    
    res.json({
      connectedSockets: connectedSockets,
      socketToUser: socketToUser,
      adminSockets: adminSockets,
      processingClaims: processingClaims,
      roomWinners: roomWinners,
      serverTime: new Date().toISOString(),
      agentSockets: agentSystem && agentSystem.agentSockets ? agentSystem.agentSockets.size : 0
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/debug-users', async (req, res) => {
  try {
    const users = await User.find().sort({ lastSeen: -1 }).limit(50);
    const onlineUsers = users.filter(u => u.isOnline);
    
    res.json({
      totalUsers: users.length,
      onlineUsers: onlineUsers.length,
      users: users.map(u => ({
        userId: u.userId,
        userName: u.userName,
        balance: u.balance,
        isOnline: u.isOnline,
        currentRoom: u.currentRoom,
        box: u.box,
        lastSeen: u.lastSeen,
        telegramId: u.telegramId,
        agentId: u.agentId || null,
        referredBy: u.referredBy || null,
        agentReferredAt: u.agentReferredAt || null,
        agentCommissionEarned: u.agentCommissionEarned || 0
      }))
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Debug Agents endpoint
app.get('/debug-agents', async (req, res) => {
  try {
    const agents = await Agent.find().sort({ createdAt: -1 }).limit(50);
    const activeAgents = agents.filter(a => a.isActive);
    
    res.json({
      totalAgents: agents.length,
      activeAgents: activeAgents.length,
      agents: agents.map(a => ({
        id: a._id,
        username: a.username,
        name: a.name,
        referralCode: a.referralCode,
        commissionRateBingo: a.commissionRateBingo,
        commissionRateKeno: a.commissionRateKeno,
        commissionRateCrash: a.commissionRateCrash,
        totalEarnings: a.totalEarnings,
        totalReferrals: a.totalReferrals,
        activeReferrals: a.activeReferrals,
        isActive: a.isActive,
        isSuperAdmin: a.isSuperAdmin,
        createdAt: a.createdAt,
        lastLogin: a.lastLogin
      }))
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Debug Telebirr number endpoint
app.get('/debug/telebirr', async (req, res) => {
  try {
    const setting = await Setting.findOne({ key: 'telebirrNumber' });
    const telebirrNumber = await getTelebirrNumber();
    
    res.json({
      databaseSetting: setting,
      currentNumber: telebirrNumber,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Debug Referrals endpoint
app.get('/debug/referrals', async (req, res) => {
  try {
    const referrals = await Referral.find().sort({ createdAt: -1 }).limit(50);
    const usersWithAgents = await User.find({ 
      agentId: { $exists: true, $ne: null } 
    }).sort({ agentReferredAt: -1 }).limit(50);
    
    res.json({
      totalReferrals: await Referral.countDocuments(),
      totalUsersWithAgents: await User.countDocuments({ agentId: { $exists: true, $ne: null } }),
      referralRecords: referrals.map(r => ({
        id: r._id,
        agentId: r.agentId,
        userId: r.userId,
        userName: r.userName,
        referralMethod: r.referralMethod,
        referralCode: r.referralCode,
        status: r.status,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt
      })),
      usersWithAgents: usersWithAgents.map(u => ({
        userId: u.userId,
        userName: u.userName,
        agentId: u.agentId,
        referredBy: u.referredBy,
        agentReferredAt: u.agentReferredAt,
        agentCommissionEarned: u.agentCommissionEarned || 0,
        isOnline: u.isOnline,
        totalWins: u.totalWins || 0,
        totalBingos: u.totalBingos || 0,
        totalWagered: u.totalWagered || 0
      }))
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 404 handler
app.use((req, res) => {
  res.status(404).send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>404 - Page Not Found</title>
      <style>
        body { font-family: Arial, sans-serif; padding: 40px; text-align: center; background: #0f172a; color: #f8fafc; }
        .container { max-width: 600px; margin: 0 auto; }
        h1 { color: #ef4444; font-size: 3rem; }
        .btn { display: inline-block; padding: 12px 24px; background: #3b82f6; color: white; text-decoration: none; border-radius: 8px; margin: 10px; font-weight: bold; }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>404 - Page Not Found</h1>
        <p style="margin: 20px 0; color: #94a3b8;">The page you're looking for doesn't exist.</p>
        <div>
          <a href="/" class="btn">🏠 Go Home</a>
          <a href="/telegram" class="btn" style="background: #8b5cf6;">🤖 Telegram Entry</a>
          <a href="/agent" class="btn" style="background: #f59e0b;">👑 Agent Portal</a>
          <a href="/game" class="btn" style="background: #10b981;">🎮 Play Bingo</a>
          <a href="/keno" class="btn" style="background: #8b5cf6;">🎰 Play Keno</a>
          <a href="/crash" class="btn" style="background: #f97316;">✈️ Play Crash</a>
        </div>
      </div>
    </body>
    </html>
  `);
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ 
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'production' ? 'Something went wrong' : err.message
  });
});

// ========== START SERVER WITH GRACEFUL SHUTDOWN ==========
const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0'; // Important for Render

const httpServer = server.listen(PORT, HOST, async () => {
  const telebirrNumber = await getTelebirrNumber();
  console.log(`
╔══════════════════════════════════════════════════════════════════════════════╗
║   🤖 BINGO ELITE + KENO ULTRA + CRASH GAME + AGENT SYSTEM - DEPLOYED ON RENDER ║
╠══════════════════════════════════════════════════════════════════════════════╣
║  Server:       http://${HOST}:${PORT}                                       ║
║  Health:       /health                                                      ║
║  Status:       /status                                                      ║
║  Ready:        /ready                                                       ║
║  Node:         ${process.version}                                           ║
║  Environment:  ${process.env.NODE_ENV || 'development'}                     ║
║  Bot Username: @Ethio_elite_games_bot                                       ║
║  Telegram entry: /telegram                                                   ║
║  Mobile app:   /app                                                          ║
║  Crash game:   /crash                                                        ║
╚══════════════════════════════════════════════════════════════════════════════╝
  `);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server');
  httpServer.close(() => {
    console.log('HTTP server closed');
    mongoose.connection.close(false, () => {
      console.log('MongoDB connection closed');
      process.exit(0);
    });
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT signal received: closing HTTP server');
  httpServer.close(() => {
    console.log('HTTP server closed');
    mongoose.connection.close(false, () => {
      console.log('MongoDB connection closed');
      process.exit(0);
    });
  });
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  // Don't exit in production, try to recover
  if (process.env.NODE_ENV === 'production') {
    // Log the error and continue
  } else {
    process.exit(1);
  }
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});
