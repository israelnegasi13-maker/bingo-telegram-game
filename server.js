// server.js - BINGO ELITE + KENO ULTRA + AGENT SYSTEM - TELEGRAM MINI APP - MAIN SERVER FILE
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

// Import game logic modules
const gameLogic = require('./game-logic');
const kenoLogic = require('./keno-logic');

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
const requiredDirs = ['public'];
const requiredFiles = {
  'public/index.html': `<!DOCTYPE html>
<html>
<head>
  <title>Bingo Elite + Keno Ultra + Agent System</title>
  <style>
    body { font-family: Arial, sans-serif; padding: 40px; text-align: center; background: #0f172a; color: #f8fafc; }
    .container { max-width: 800px; margin: 0 auto; }
    .btn { display: inline-block; padding: 12px 24px; margin: 10px; background: #3b82f6; color: white; text-decoration: none; border-radius: 8px; font-weight: bold; }
  </style>
</head>
<body>
  <div class="container">
    <h1>🎮 Bingo Elite + Keno Ultra + Agent System</h1>
    <p>Server is running successfully!</p>
    <div>
      <a href="/admin" class="btn" style="background: #ef4444;">🔒 Admin Panel</a>
      <a href="/agent" class="btn" style="background: #f59e0b;">👑 Agent Portal</a>
      <a href="/telegram" class="btn" style="background: #8b5cf6;">🤖 Telegram Entry</a>
      <a href="/game" class="btn" style="background: #10b981;">🎮 Play Bingo</a>
      <a href="/keno" class="btn" style="background: #8b5cf6;">🎰 Play Keno</a>
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
    console.log('Bingo game loading...');
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
    console.log('Keno game loading...');
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
  gameType: { type: String, enum: ['BINGO', 'KENO'], required: true },
  stake: { type: Number, required: true },
  winningAmount: { type: Number, required: true },
  commissionRate: { type: Number, required: true },
  commissionAmount: { type: Number, required: true },
  status: { type: String, enum: ['pending', 'completed', 'failed'], default: 'completed' },
  createdAt: { type: Date, default: Date.now }
});

// Agent Transaction Schema
const agentTransactionSchema = new mongoose.Schema({
  agentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Agent', required: true },
  type: { type: String, enum: ['COMMISSION', 'WITHDRAWAL', 'BONUS'], required: true },
  amount: { type: Number, required: true },
  description: { type: String },
  status: { type: String, enum: ['pending', 'completed', 'failed'], default: 'pending' },
  createdAt: { type: Date, default: Date.now }
});

// Create all models
const User = mongoose.model('User', userSchema);
const Room = mongoose.model('Room', roomSchema);
const Transaction = mongoose.model('Transaction', transactionSchema);
const Stats = mongoose.model('Stats', statsSchema);
const Setting = mongoose.model('Setting', settingSchema);
const Agent = mongoose.model('Agent', agentSchema);
const AgentCommission = mongoose.model('AgentCommission', agentCommissionSchema);
const AgentTransaction = mongoose.model('AgentTransaction', agentTransactionSchema);

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
  AgentTransaction
};

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
    AgentCommission
  });
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
  
  // ========== ADMIN AUTHENTICATION ==========
  socket.on('admin:auth', async (password) => {
    if (password === (gameLogic.CONFIG ? gameLogic.CONFIG.ADMIN_PASSWORD : 'admin123')) {
      socket.admin = true;
      socket.emit('admin:authSuccess');
      
      // Send current Telebirr number on successful auth
      const telebirrNumber = await getTelebirrNumber();
      socket.emit('admin:telebirrNumber', telebirrNumber);
      
      // Send Keno stats
      if (kenoLogic && kenoLogic.getKenoGameStats) {
        const kenoStats = kenoLogic.getKenoGameStats();
        socket.emit('admin:kenoStats', kenoStats);
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
  
  // ========== AGENT SYSTEM SOCKET EVENTS ==========
  // Agent login
  socket.on('agent:login', (data) => {
    if (agentSystem && agentSystem.handleAgentLogin) {
      agentSystem.handleAgentLogin(socket, data);
    }
  });
  
  // Agent dashboard data
  socket.on('agent:dashboard', () => {
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
  
  // Get agent report
  socket.on('agent:report', (data) => {
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
  
  // ========== SUPER ADMIN AGENT EVENTS ==========
  // Get all agents (super admin only)
  socket.on('admin:getAllAgents', () => {
    if (socket.admin && agentSystem && agentSystem.handleGetAllAgents) {
      agentSystem.handleGetAllAgents(socket);
    }
  });
  
  // Create new agent (super admin only)
  socket.on('admin:createAgent', (data) => {
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
  
  // Reset agent password (super admin only)
  socket.on('admin:resetAgentPassword', (data) => {
    if (socket.admin && agentSystem && agentSystem.handleResetAgentPassword) {
      agentSystem.handleResetAgentPassword(socket, data);
    }
  });
  
  // Export agent data (super admin only)
  socket.on('admin:exportAgentData', (data) => {
    if (socket.admin && agentSystem && agentSystem.handleExportAgentData) {
      agentSystem.handleExportAgentData(socket, data);
    }
  });
  
  // Get pending agent withdrawals (super admin only)
  socket.on('admin:getPendingAgentWithdrawals', () => {
    if (socket.admin && agentSystem && agentSystem.handleGetPendingWithdrawals) {
      agentSystem.handleGetPendingWithdrawals(socket);
    }
  });
  
  // Approve agent withdrawal (super admin only)
  socket.on('admin:approveAgentWithdrawal', (transactionId) => {
    if (socket.admin && agentSystem && agentSystem.handleApproveAgentWithdrawal) {
      agentSystem.handleApproveAgentWithdrawal(socket, transactionId);
    }
  });
  
  // Reject agent withdrawal (super admin only)
  socket.on('admin:rejectAgentWithdrawal', (transactionId) => {
    if (socket.admin && agentSystem && agentSystem.handleRejectAgentWithdrawal) {
      agentSystem.handleRejectAgentWithdrawal(socket, transactionId);
    }
  });
  
  // Update user agent assignment (super admin only)
  socket.on('admin:updateUserAgent', async (data) => {
    if (socket.admin && agentSystem && agentSystem.updateUserAgent) {
      const result = await agentSystem.updateUserAgent(data.userId, data.agentId);
      socket.emit('admin:userAgentUpdated', result);
    }
  });
  
  // Bulk assign users to agent (super admin only)
  socket.on('admin:bulkAssignUsers', async (data) => {
    if (socket.admin && agentSystem && agentSystem.bulkAssignUsersByPattern) {
      const result = await agentSystem.bulkAssignUsersByPattern(data.agentId, data.pattern);
      socket.emit('admin:bulkAssignComplete', result);
    }
  });
  
  // Get agent leaderboard (super admin only)
  socket.on('admin:getAgentLeaderboard', async (data) => {
    if (socket.admin && agentSystem && agentSystem.getAgentLeaderboard) {
      const limit = data.limit || 10;
      const period = data.period || 'month';
      const leaderboard = await agentSystem.getAgentLeaderboard(limit, period);
      socket.emit('admin:agentLeaderboard', leaderboard);
    }
  });
  
  // Reset agent statistics (super admin only)
  socket.on('admin:resetAgentStats', async (agentId) => {
    if (socket.admin && agentSystem && agentSystem.resetAgentStatistics) {
      const result = await agentSystem.resetAgentStatistics(agentId);
      socket.emit('admin:agentStatsReset', result);
    }
  });
  
  // ========== BACKWARD COMPATIBILITY FOR OLD ADMIN.HTML ==========
  // Handle old admin.html events that used 'agent:' prefix instead of 'admin:' prefix
  socket.on('agent:createAgent', (data) => {
    console.warn(`DEPRECATED: agent:createAgent event received from socket ${socket.id}. Frontend should use admin:createAgent`);
    if (socket.admin && agentSystem && agentSystem.handleCreateAgent) {
      agentSystem.handleCreateAgent(socket, data);
    } else {
      socket.emit('admin:error', 'Unauthorized or agent system not available');
    }
  });
  
  socket.on('agent:updateAgent', (data) => {
    console.warn(`DEPRECATED: agent:updateAgent event received from socket ${socket.id}. Frontend should use admin:updateAgent`);
    if (socket.admin && agentSystem && agentSystem.handleUpdateAgent) {
      agentSystem.handleUpdateAgent(socket, data);
    } else {
      socket.emit('admin:error', 'Unauthorized or agent system not available');
    }
  });
  
  socket.on('agent:deleteAgent', (agentId) => {
    console.warn(`DEPRECATED: agent:deleteAgent event received from socket ${socket.id}. Frontend should use admin:deleteAgent`);
    if (socket.admin && agentSystem && agentSystem.handleDeleteAgent) {
      agentSystem.handleDeleteAgent(socket, agentId);
    } else {
      socket.emit('admin:error', 'Unauthorized or agent system not available');
    }
  });
  
  socket.on('agent:resetAgentPassword', (data) => {
    console.warn(`DEPRECATED: agent:resetAgentPassword event received from socket ${socket.id}. Frontend should use admin:resetAgentPassword`);
    if (socket.admin && agentSystem && agentSystem.handleResetAgentPassword) {
      agentSystem.handleResetAgentPassword(socket, data);
    } else {
      socket.emit('admin:error', 'Unauthorized or agent system not available');
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
  
  // ========== HOUSE EARNINGS ==========
  // Reset house earnings (admin only)
  socket.on('admin:resetHouseEarnings', async () => {
    if (socket.admin) {
      try {
        // Get current total from all transactions
        const houseEarningsTransactions = await Transaction.find({ 
          type: 'HOUSE_EARNINGS' 
        });
        const previousAmount = houseEarningsTransactions.reduce((sum, t) => sum + t.amount, 0);
        
        // Create a reset transaction
        const resetTransaction = new Transaction({
          type: 'HOUSE_EARNINGS_RESET',
          userId: 'system',
          userName: 'System',
          amount: -previousAmount,
          admin: true,
          description: `House earnings reset from ${previousAmount.toFixed(2)} to 0 ETB`
        });
        await resetTransaction.save();
        
        socket.emit('admin:houseEarningsReset', { 
          previousAmount,
          resetAmount: 0,
          message: `House earnings reset from ${previousAmount.toFixed(2)} to 0 ETB`
        });
        
        console.log(`🔄 House earnings reset from ${previousAmount.toFixed(2)} to 0 ETB`);
      } catch (error) {
        console.error('Error resetting house earnings:', error);
        socket.emit('admin:houseEarningsResetError', error.message);
      }
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
    
    // Handle Agent disconnection
    if (agentSystem && agentSystem.handleAgentDisconnect) {
      agentSystem.handleAgentDisconnect(socket);
    }
  });
  
  // ========== GAME EVENTS (FORWARDED TO GAME LOGIC) ==========
  socket.on('join', (data) => {
    // Process referral if present
    if (data.referralCode && agentSystem && agentSystem.processReferral) {
      agentSystem.processReferral(data.userId, data.referralCode);
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
    if (gameLogic && gameLogic.handleDepositRequest) {
      gameLogic.handleDepositRequest(socket, data);
    }
  });
  
  socket.on('withdrawRequest', (data) => {
    if (gameLogic && gameLogic.handleWithdrawRequest) {
      gameLogic.handleWithdrawRequest(socket, data);
    }
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
    const telebirrNumber = await getTelebirrNumber();
    const agentStats = agentSystem && agentSystem.getAgentStatistics ? await agentSystem.getAgentStatistics() : { totalAgents: 0, activeAgents: 0, totalCommissions: 0 };
    
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Bingo Elite + Keno Ultra + Agent System - Telegram Mini App</title>
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
          .telebirr-info { background: rgba(59, 130, 246, 0.1); padding: 15px; border-radius: 12px; margin: 20px 0; border: 1px solid rgba(59, 130, 246, 0.3); }
          .telebirr-number { font-size: 1.5rem; font-weight: bold; color: #60a5fa; margin: 10px 0; }
          .fix-highlight { background: rgba(16, 185, 129, 0.1); padding: 15px; border-radius: 12px; margin: 20px 0; border: 1px solid rgba(16, 185, 129, 0.3); }
          .game-section { background: rgba(139, 92, 246, 0.1); padding: 15px; border-radius: 12px; margin: 20px 0; border: 1px solid rgba(139, 92, 246, 0.3); }
          .agent-section { background: rgba(245, 158, 11, 0.1); padding: 15px; border-radius: 12px; margin: 20px 0; border: 1px solid rgba(245, 158, 11, 0.3); }
        </style>
      </head>
      <body>
        <div class="container">
          <h1 style="font-size: 3rem; margin-bottom: 20px;">🎮 Bingo Elite + Keno Ultra + Agent System</h1>
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
            
            <div class="agent-section">
              <h3 style="color: #f59e0b;">👑 AGENT/REFERRAL SYSTEM - NOW ACTIVE</h3>
              <p style="color: #94a3b8;">
                <strong>New Agent Features:</strong><br>
                1. ✅ Agent registration and login system<br>
                2. ✅ 40% commission from Bingo wins<br>
                3. ✅ 10% commission from Keno wins<br>
                4. ✅ Real-time commission tracking<br>
                5. ✅ Agent dashboard with stats<br>
                6. ✅ Referral link generation<br>
                7. ✅ Agent withdrawal requests<br>
                8. ✅ Super admin panel for agent management<br>
                9. ✅ Agent leaderboard<br>
                10. ✅ Referral tracking and reporting<br>
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
            
            <p style="margin-top: 20px; color: #f59e0b; font-weight: bold;">👑 Agent Commissions: Bingo 40%, Keno 10%!</p>
            <p style="color: #f59e0b; margin-top: 10px; font-weight: bold;">💰 Agent Withdrawals: Processed within 24 hours</p>
            <p style="color: #8b5cf6; margin-top: 10px; font-weight: bold;">🎰 Keno Payouts: 3 matches = 1x, 4 matches = 5x, 5 matches = 50x</p>
            <p style="color: #64748b; margin-top: 10px;">Server Time: ${new Date().toLocaleString()}</p>
            <p style="color: #10b981;">✅ Telegram Mini App Ready</p>
            <p style="color: #3b82f6; margin-top: 10px;">📦 Real-time Box Tracking: ✅ ACTIVE</p>
            <p style="color: #10b981; margin-top: 10px;">💰 Wallet System: ✅ ACTIVE</p>
            <p style="color: #f59e0b; margin-top: 10px;">👑 Agent System: ✅ ACTIVE</p>
          </div>
          
          <div style="margin-top: 40px;">
            <h3>Access Points:</h3>
            <div>
              <a href="/admin" class="btn btn-admin" target="_blank">🔒 Admin Panel</a>
              <a href="/agent" class="btn btn-agent" target="_blank">👑 Agent Portal</a>
              <a href="/game" class="btn btn-game" target="_blank">🎮 Bingo Game</a>
              <a href="/keno" class="btn" style="background: #8b5cf6;" target="_blank">🎰 Keno Game</a>
            </div>
            <div style="margin-top: 20px;">
              <a href="/health" class="btn" style="background: #64748b;" target="_blank">📊 Health Check</a>
              <a href="/telegram" class="btn" style="background: #8b5cf6;" target="_blank">🤖 Telegram Entry</a>
            </div>
            <div style="margin-top: 20px;">
              <a href="/debug-connections" class="btn" style="background: #f59e0b;" target="_blank">🔍 Debug Connections</a>
              <a href="/debug-agents" class="btn" style="background: #f59e0b;" target="_blank">👑 Debug Agents</a>
              <a href="/debug-telebirr" class="btn" style="background: #f59e0b;" target="_blank">📱 Debug Telebirr</a>
            </div>
          </div>
          
          <div style="margin-top: 40px; padding: 20px; background: rgba(255,255,255,0.03); border-radius: 12px;">
            <h4>Telegram Mini App Information</h4>
            <p style="color: #94a3b8; font-size: 0.9rem;">
              Version: 4.0.0 (BINGO + KENO + AGENT SYSTEM) | Database: MongoDB Atlas<br>
              Socket.IO: ✅ Connected Sockets: ${connectedSockets}<br>
              Keno Players: ${kenoOnline} online / ${kenoPlayers} total<br>
              Agents: ${agentStats.activeAgents || 0} active / ${agentStats.totalAgents || 0} total<br>
              Agent Commissions: ${(agentStats.totalCommissions || 0).toFixed(2)} ETB<br>
              Telegram Integration: ✅ Ready<br>
              Game Timer: ${gameLogic.CONFIG ? gameLogic.CONFIG.GAME_TIMER : 3}s between balls<br>
              Keno Timer: ${kenoLogic.CONFIG ? kenoLogic.CONFIG.KENO_GAME_TIMER : 30}s rounds<br>
              Bot Username: @ethio_games1_bot<br>
              Real-time Box Updates: ✅ ACTIVE<br>
              Wallet System: ✅ ACTIVE (Deposit/Withdraw)<br>
              Agent System: ✅ ACTIVE (40% Bingo, 10% Keno commissions)<br>
              <strong>Telebirr Number: ${telebirrNumber} (PERSISTED IN DATABASE)</strong><br>
              Min Withdrawal: ${gameLogic.CONFIG ? gameLogic.CONFIG.MIN_WITHDRAWAL : 50} ETB<br>
              <strong>🎯 AGENT SYSTEM FEATURES:</strong><br>
              • 40% commission from Bingo wins<br>
              • 10% commission from Keno wins<br>
              • Real-time commission tracking<br>
              • Agent dashboard with statistics<br>
              • Referral link generation<br>
              • Agent withdrawal system<br>
              • Super admin management panel<br>
              • Agent leaderboard<br>
              • Multi-level referral tracking<br>
              • CSV export for commissions<br>
              • Telegram bot integration for agents<br>
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
  if (fs.existsSync(path.join(__dirname, 'agent-portal.html'))) {
    res.sendFile(path.join(__dirname, 'agent-portal.html'));
  } else {
    res.redirect('/');
  }
});

// Serve Agent Portal HTML (fallback if file doesn't exist)
app.get('/agent-portal.html', (req, res) => {
  res.redirect('/agent');
});

// ========== REDESIGNED TELEGRAM ENTRY PAGE ==========
app.get('/telegram', async (req, res) => {
  try {
    const telebirrNumber = await getTelebirrNumber();
    const minWithdrawal = gameLogic.CONFIG ? gameLogic.CONFIG.MIN_WITHDRAWAL : 50;
    
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
                  --primary-gradient: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                  --secondary-gradient: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
                  --accent-color: #fbbf24;
                  --dark-bg: #0f172a;
                  --card-bg: rgba(30, 41, 59, 0.8);
                  --card-border: rgba(255, 255, 255, 0.1);
                  --text-primary: #f8fafc;
                  --text-secondary: #94a3b8;
                  --success: #10b981;
                  --warning: #f59e0b;
                  --keno-color: #8b5cf6;
                  --glass-bg: rgba(15, 23, 42, 0.7);
                  --glass-border: rgba(255, 255, 255, 0.08);
              }
              
              * {
                  margin: 0;
                  padding: 0;
                  box-sizing: border-box;
                  -webkit-tap-highlight-color: transparent;
              }
              
              body {
                  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
                  background: var(--dark-bg);
                  color: var(--text-primary);
                  min-height: 100vh;
                  overflow-x: hidden;
                  background-image: 
                      radial-gradient(at 40% 20%, rgba(56, 189, 248, 0.1) 0px, transparent 50%),
                      radial-gradient(at 80% 0%, rgba(139, 92, 246, 0.1) 0px, transparent 50%),
                      radial-gradient(at 0% 50%, rgba(239, 68, 68, 0.1) 0px, transparent 50%),
                      radial-gradient(at 100% 100%, rgba(245, 158, 11, 0.1) 0px, transparent 50%);
                  backdrop-filter: blur(20px);
                  -webkit-backdrop-filter: blur(20px);
              }
              
              .container {
                  min-height: 100vh;
                  padding: 16px;
                  display: flex;
                  flex-direction: column;
                  align-items: center;
                  justify-content: space-between;
              }
              
              .header {
                  width: 100%;
                  text-align: center;
                  padding: 20px 0;
                  margin-bottom: 12px;
                  position: relative;
              }
              
              .logo-container {
                  margin-bottom: 12px;
                  position: relative;
              }
              
              .logo {
                  font-size: 2.2rem;
                  background: var(--primary-gradient);
                  -webkit-background-clip: text;
                  -webkit-text-fill-color: transparent;
                  background-clip: text;
                  filter: drop-shadow(0 4px 6px rgba(0, 0, 0, 0.3));
                  animation: float 6s ease-in-out infinite;
              }
              
              .welcome-text {
                  font-size: 1.4rem;
                  font-weight: 700;
                  margin-bottom: 4px;
                  background: var(--primary-gradient);
                  -webkit-background-clip: text;
                  -webkit-text-fill-color: transparent;
                  background-clip: text;
                  letter-spacing: -0.5px;
              }
              
              .subtitle {
                  color: var(--text-secondary);
                  font-size: 0.75rem;
                  font-weight: 400;
                  letter-spacing: 0.5px;
                  max-width: 280px;
                  margin: 0 auto;
                  line-height: 1.3;
              }
              
              .games-section {
                  width: 100%;
                  max-width: 360px;
                  margin: 0 auto 20px;
              }
              
              .section-label {
                  font-size: 0.85rem;
                  font-weight: 600;
                  color: var(--text-secondary);
                  text-transform: uppercase;
                  letter-spacing: 1px;
                  margin-bottom: 12px;
                  display: flex;
                  align-items: center;
                  gap: 8px;
              }
              
              .section-label::after {
                  content: '';
                  flex: 1;
                  height: 1px;
                  background: linear-gradient(90deg, transparent, var(--text-secondary), transparent);
              }
              
              .games-grid {
                  display: flex;
                  flex-direction: column;
                  gap: 12px;
                  margin-bottom: 20px;
              }
              
              .game-card {
                  background: var(--card-bg);
                  backdrop-filter: blur(10px);
                  -webkit-backdrop-filter: blur(10px);
                  border: 1px solid var(--card-border);
                  border-radius: 16px;
                  padding: 16px;
                  display: flex;
                  align-items: center;
                  gap: 14px;
                  cursor: pointer;
                  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                  position: relative;
                  overflow: hidden;
              }
              
              .game-card::before {
                  content: '';
                  position: absolute;
                  top: 0;
                  left: 0;
                  right: 0;
                  height: 1px;
                  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.1), transparent);
              }
              
              .game-card:hover {
                  transform: translateY(-2px);
                  border-color: rgba(139, 92, 246, 0.3);
                  box-shadow: 0 8px 25px rgba(0, 0, 0, 0.3);
              }
              
              .game-card:active {
                  transform: translateY(0);
              }
              
              .game-icon {
                  width: 42px;
                  height: 42px;
                  border-radius: 12px;
                  display: flex;
                  align-items: center;
                  justify-content: center;
                  font-size: 1.5rem;
                  flex-shrink: 0;
                  position: relative;
                  overflow: hidden;
              }
              
              .game-icon::before {
                  content: '';
                  position: absolute;
                  inset: 0;
                  background: inherit;
                  opacity: 0.2;
              }
              
              .bingo-icon {
                  background: linear-gradient(135deg, #3b82f6, #1d4ed8);
                  color: #60a5fa;
              }
              
              .keno-icon {
                  background: linear-gradient(135deg, #8b5cf6, #7c3aed);
                  color: #a78bfa;
              }
              
              .agent-icon {
                  background: linear-gradient(135deg, #f59e0b, #d97706);
                  color: #fbbf24;
              }
              
              .coming-soon-icon {
                  background: linear-gradient(135deg, #64748b, #475569);
                  color: #94a3b8;
              }
              
              .game-content {
                  flex: 1;
              }
              
              .game-title {
                  font-size: 1rem;
                  font-weight: 700;
                  margin-bottom: 2px;
                  display: flex;
                  align-items: center;
                  gap: 6px;
              }
              
              .game-description {
                  color: var(--text-secondary);
                  font-size: 0.7rem;
                  line-height: 1.2;
                  margin-bottom: 6px;
              }
              
              .game-features {
                  display: flex;
                  gap: 6px;
                  flex-wrap: wrap;
              }
              
              .feature-tag {
                  background: rgba(59, 130, 246, 0.1);
                  color: #60a5fa;
                  padding: 2px 6px;
                  border-radius: 8px;
                  font-size: 0.6rem;
                  font-weight: 500;
                  border: 1px solid rgba(59, 130, 246, 0.2);
              }
              
              .feature-tag.keno {
                  background: rgba(139, 92, 246, 0.1);
                  color: #a78bfa;
                  border-color: rgba(139, 92, 246, 0.2);
              }
              
              .feature-tag.agent {
                  background: rgba(245, 158, 11, 0.1);
                  color: #fbbf24;
                  border-color: rgba(245, 158, 11, 0.2);
              }
              
              .feature-tag.coming {
                  background: rgba(100, 116, 139, 0.1);
                  color: #94a3b8;
                  border-color: rgba(100, 116, 139, 0.2);
              }
              
              .game-action {
                  margin-left: auto;
              }
              
              .play-btn {
                  background: var(--primary-gradient);
                  color: white;
                  border: none;
                  padding: 8px 14px;
                  border-radius: 10px;
                  font-size: 0.75rem;
                  font-weight: 700;
                  cursor: pointer;
                  transition: all 0.2s;
                  box-shadow: 0 4px 12px rgba(59, 130, 246, 0.25);
                  white-space: nowrap;
              }
              
              .play-btn.keno {
                  background: linear-gradient(135deg, #8b5cf6, #7c3aed);
                  box-shadow: 0 4px 12px rgba(139, 92, 246, 0.25);
              }
              
              .play-btn.agent {
                  background: linear-gradient(135deg, #f59e0b, #d97706);
                  box-shadow: 0 4px 12px rgba(245, 158, 11, 0.25);
              }
              
              .play-btn:hover {
                  transform: scale(1.05);
                  box-shadow: 0 6px 16px rgba(59, 130, 246, 0.35);
              }
              
              .play-btn.keno:hover {
                  box-shadow: 0 6px 16px rgba(139, 92, 246, 0.35);
              }
              
              .play-btn.agent:hover {
                  box-shadow: 0 6px 16px rgba(245, 158, 11, 0.35);
              }
              
              .play-btn.coming-soon {
                  background: linear-gradient(135deg, #64748b, #475569);
                  cursor: not-allowed;
                  opacity: 0.7;
              }
              
              .play-btn.coming-soon:hover {
                  transform: none;
                  box-shadow: 0 4px 12px rgba(100, 116, 139, 0.25);
              }
              
              .features-highlight {
                  width: 100%;
                  max-width: 360px;
                  margin: 0 auto 20px;
                  background: var(--glass-bg);
                  backdrop-filter: blur(10px);
                  border: 1px solid var(--glass-border);
                  border-radius: 16px;
                  padding: 16px;
              }
              
              .features-title {
                  font-size: 0.9rem;
                  font-weight: 700;
                  margin-bottom: 10px;
                  color: var(--accent-color);
                  display: flex;
                  align-items: center;
                  gap: 6px;
              }
              
              .features-grid {
                  display: grid;
                  grid-template-columns: repeat(2, 1fr);
                  gap: 8px;
              }
              
              .feature-item {
                  display: flex;
                  align-items: center;
                  gap: 6px;
                  font-size: 0.7rem;
                  color: var(--text-secondary);
              }
              
              .feature-icon {
                  color: var(--success);
                  font-size: 0.8rem;
              }
              
              .footer {
                  width: 100%;
                  max-width: 360px;
                  text-align: center;
                  padding: 16px 0;
                  color: var(--text-secondary);
                  font-size: 0.7rem;
                  border-top: 1px solid rgba(255, 255, 255, 0.05);
                  margin-top: auto;
              }
              
              .footer-links {
                  display: flex;
                  justify-content: center;
                  gap: 16px;
                  margin-top: 8px;
              }
              
              .footer-link {
                  color: var(--text-secondary);
                  text-decoration: none;
                  font-size: 0.65rem;
                  transition: color 0.2s;
              }
              
              .footer-link:hover {
                  color: var(--text-primary);
              }
              
              .status-badge {
                  display: inline-flex;
                  align-items: center;
                  gap: 4px;
                  padding: 2px 8px;
                  background: rgba(16, 185, 129, 0.1);
                  color: var(--success);
                  border-radius: 20px;
                  font-size: 0.6rem;
                  font-weight: 600;
                  margin-left: 6px;
              }
              
              .status-badge.keno {
                  background: rgba(139, 92, 246, 0.1);
                  color: #a78bfa;
              }
              
              .status-badge.agent {
                  background: rgba(245, 158, 11, 0.1);
                  color: #fbbf24;
              }
              
              @keyframes float {
                  0%, 100% { transform: translateY(0px); }
                  50% { transform: translateY(-5px); }
              }
              
              @keyframes slideIn {
                  from { opacity: 0; transform: translateY(10px); }
                  to { opacity: 1; transform: translateY(0); }
              }
              
              @keyframes pulse {
                  0%, 100% { opacity: 1; }
                  50% { opacity: 0.7; }
              }
              
              .user-greeting {
                  position: absolute;
                  top: 16px;
                  right: 16px;
                  font-size: 0.75rem;
                  color: var(--text-secondary);
                  display: flex;
                  align-items: center;
                  gap: 4px;
              }
              
              .agent-highlight {
                  background: rgba(245, 158, 11, 0.1);
                  padding: 12px;
                  border-radius: 12px;
                  margin: 10px 0;
                  border: 1px solid rgba(245, 158, 11, 0.2);
              }
              
              @media (max-width: 360px) {
                  .container {
                      padding: 12px;
                  }
                  
                  .game-card {
                      padding: 12px;
                  }
                  
                  .features-grid {
                      grid-template-columns: 1fr;
                  }
              }
          </style>
      </head>
      <body>
          <div class="container">
              <div class="header">
                  <div class="user-greeting" id="userGreeting" style="display: none;">
                      👋 <span id="userName">User</span>
                  </div>
                  
                  <div class="logo-container">
                      <div class="logo">🎮</div>
                  </div>
                  
                  <h1 class="welcome-text">ETHIO GAMES</h1>
                  <p class="subtitle">Premium gaming experience on Telegram</p>
                  
                  <div class="agent-highlight">
                      <p style="font-size: 0.7rem; color: #fbbf24; margin: 0; text-align: center;">
                          👑 <strong>NEW:</strong> Become an agent! Earn 40% commission from Bingo, 10% from Keno!
                      </p>
                  </div>
              </div>
              
              <div class="games-section">
                  <div class="section-label">
                      <span>🎯 FEATURED GAMES</span>
                  </div>
                  
                  <div class="games-grid">
                      <div class="game-card" onclick="launchGame('bingo')">
                          <div class="game-icon bingo-icon">
                              🎱
                          </div>
                          <div class="game-content">
                              <h3 class="game-title">
                                  BINGO ELITE
                                  <span class="status-badge">🔥 HOT</span>
                              </h3>
                              <p class="game-description">
                                  Real-time multiplayer bingo with big wins
                              </p>
                              <div class="game-features">
                                  <span class="feature-tag">🎯 50 ETB Bonus</span>
                                  <span class="feature-tag">💰 Real Money</span>
                                  <span class="feature-tag">⚡ Fast</span>
                              </div>
                          </div>
                          <div class="game-action">
                              <button class="play-btn" id="bingoBtn">
                                  PLAY
                              </button>
                          </div>
                      </div>
                      
                      <div class="game-card" onclick="launchGame('keno')">
                          <div class="game-icon keno-icon">
                              🎲
                          </div>
                          <div class="game-content">
                              <h3 class="game-title">
                                  KENO ULTRA
                                  <span class="status-badge keno">NEW</span>
                              </h3>
                              <p class="game-description">
                                  Fast number selection with instant wins
                              </p>
                              <div class="game-features">
                                  <span class="feature-tag keno">🎰 5 Numbers</span>
                                  <span class="feature-tag keno">⚡ 30s Rounds</span>
                                  <span class="feature-tag keno">💰 50x Wins</span>
                              </div>
                          </div>
                          <div class="game-action">
                              <button class="play-btn keno" id="kenoBtn">
                                  PLAY
                              </button>
                          </div>
                      </div>
                      
                      <div class="game-card" onclick="launchGame('agent')">
                          <div class="game-icon agent-icon">
                              👑
                          </div>
                          <div class="game-content">
                              <h3 class="game-title">
                                  AGENT PORTAL
                                  <span class="status-badge agent">EARN</span>
                              </h3>
                              <p class="game-description">
                                  Become an agent and earn commissions
                              </p>
                              <div class="game-features">
                                  <span class="feature-tag agent">💰 40% Commission</span>
                                  <span class="feature-tag agent">👥 Refer Friends</span>
                                  <span class="feature-tag agent">💵 Earn Money</span>
                              </div>
                          </div>
                          <div class="game-action">
                              <button class="play-btn agent" id="agentBtn">
                                  EARN
                              </button>
                          </div>
                      </div>
                  </div>
              </div>
              
              <div class="features-highlight">
                  <div class="features-title">
                      ⭐ FEATURES
                  </div>
                  <div class="features-grid">
                      <div class="feature-item">
                          <span class="feature-icon">✓</span>
                          <span>Real-time Multiplayer</span>
                      </div>
                      <div class="feature-item">
                          <span class="feature-icon">✓</span>
                          <span>Four Corners Bonus</span>
                      </div>
                      <div class="feature-item">
                          <span class="feature-icon">✓</span>
                          <span>Agent System (40%)</span>
                      </div>
                      <div class="feature-item">
                          <span class="feature-icon">✓</span>
                          <span>Auto Start Games</span>
                      </div>
                  </div>
              </div>
              
              <div class="footer">
                  <p>Powered by Telegram • Play responsibly</p>
                  <div class="footer-links">
                      <a href="#" class="footer-link" onclick="showHelp()">Help</a>
                      <a href="#" class="footer-link" onclick="showWalletInfo()">Wallet</a>
                      <a href="#" class="footer-link" onclick="showTerms()">Terms</a>
                  </div>
              </div>
          </div>
          
          <script>
              const tg = window.Telegram.WebApp;
              
              if (tg) {
                  tg.ready();
                  tg.expand();
                  
                  tg.setHeaderColor('#3b82f6');
                  tg.setBackgroundColor('#0f172a');
                  
                  const user = tg.initDataUnsafe?.user;
                  
                  if (user) {
                      document.getElementById('userGreeting').style.display = 'flex';
                      document.getElementById('userName').textContent = user.first_name || 'User';
                      
                      localStorage.setItem('telegramUser', JSON.stringify({
                          id: user.id,
                          firstName: user.first_name,
                          username: user.username,
                          languageCode: user.language_code
                      }));
                  }
              }
              
              function launchGame(game) {
                  if (tg && tg.HapticFeedback) {
                      tg.HapticFeedback.impactOccurred('light');
                  }
                  
                  if (game === 'bingo') {
                      window.location.href = '/game';
                  } else if (game === 'keno') {
                      window.location.href = '/keno';
                  } else if (game === 'agent') {
                      window.location.href = '/agent';
                  }
              }
              
              function showHelp() {
                  if (tg) {
                      tg.showPopup({
                          title: 'How to Play',
                          message: 'BINGO:\\\\n1. Select room (10-100 ETB)\\\\n2. Choose an available ticket\\\\n3. Wait for countdown\\\\n4. Mark numbers as called\\\\n5. Claim BINGO to win!\\\\n\\\\nKENO:\\\\n1. Select 5 numbers from 1-80\\\\n2. Choose bet amount (5-100 ETB)\\\\n3. 20 numbers drawn per round\\\\n4. Match 3-5 numbers to win!\\\\n\\\\nAGENT:\\\\n1. Earn 40% commission from Bingo\\\\n2. Earn 10% commission from Keno\\\\n3. Refer friends using your link\\\\n4. Earn from their wins automatically',
                          buttons: [{ type: 'ok' }]
                      });
                  } else {
                      alert('How to Play\\\\n\\\\nBINGO:\\\\n1. Select room (10-100 ETB)\\\\n2. Choose an available ticket\\\\n3. Wait for countdown\\\\n4. Mark numbers as called\\\\n5. Claim BINGO to win!\\\\n\\\\nKENO:\\\\n1. Select 5 numbers from 1-80\\\\n2. Choose bet amount (5-100 ETB)\\\\n3. 20 numbers drawn per round\\\\n4. Match 3-5 numbers to win!\\\\n\\\\nAGENT:\\\\n1. Earn 40% commission from Bingo\\\\n2. Earn 10% commission from Keno\\\\n3. Refer friends using your link\\\\n4. Earn from their wins automatically');
                  }
              }
              
              function showWalletInfo() {
                  if (tg) {
                      tg.showPopup({
                          title: 'Wallet Information',
                          message: '💳 Deposit to: ${telebirrNumber}\\\\n💰 Min withdrawal: ${minWithdrawal} ETB\\\\n👑 Agent commissions: Bingo 40%, Keno 10%\\\\n🎮 Play: @ethio_games1_bot',
                          buttons: [{ type: 'ok' }]
                      });
                  } else {
                      alert('Wallet Information\\\\n\\\\n💳 Deposit to: ${telebirrNumber}\\\\n💰 Min withdrawal: ${minWithdrawal} ETB\\\\n👑 Agent commissions: Bingo 40%, Keno 10%\\\\n🎮 Play: @ethio_games1_bot');
                  }
              }
              
              function showTerms() {
                  if (tg) {
                      tg.showPopup({
                          title: 'Terms & Conditions',
                          message: '• Must be 18+ to play\\\\n• Play responsibly\\\\n• Agent commissions paid weekly\\\\n• Admin decisions are final\\\\n• Contact @ethio_games1_bot for support',
                          buttons: [{ type: 'ok' }]
                      });
                  } else {
                      alert('Terms & Conditions\\\\n\\\\n• Must be 18+ to play\\\\n• Play responsibly\\\\n• Agent commissions paid weekly\\\\n• Admin decisions are final\\\\n• Contact @ethio_games1_bot for support');
                  }
              }
              
              document.getElementById('bingoBtn').addEventListener('click', () => launchGame('bingo'));
              document.getElementById('kenoBtn').addEventListener('click', () => launchGame('keno'));
              document.getElementById('agentBtn').addEventListener('click', () => launchGame('agent'));
              
              if (tg && tg.MainButton) {
                  tg.MainButton.setText('🎮 PLAY GAMES');
                  tg.MainButton.show();
                  tg.MainButton.onClick(function() {
                      tg.showPopup({
                          title: 'Select Game',
                          message: 'Choose which game to play:',
                          buttons: [
                              { id: 'bingo', type: 'default', text: '🎱 Bingo Elite' },
                              { id: 'keno', type: 'default', text: '🎰 Keno Ultra' },
                              { id: 'agent', type: 'default', text: '👑 Agent Portal' },
                              { type: 'cancel' }
                          ]
                      });
                      
                      tg.onEvent('popupButtonClicked', function(e) {
                          if (e.buttonId === 'bingo') {
                              launchGame('bingo');
                          } else if (e.buttonId === 'keno') {
                              launchGame('keno');
                          } else if (e.buttonId === 'agent') {
                              launchGame('agent');
                          }
                      });
                  });
              }
              
              // Add entrance animations
              document.querySelectorAll('.game-card').forEach((card, index) => {
                  card.style.animation = \`slideIn 0.4s ease \${index * 0.1}s both\`;
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
      agentCommissionEarned: user.agentCommissionEarned || 0
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
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
    }).select('name username referralCode commissionRateBingo commissionRateKeno');
    
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
        commissionRateKeno: agent.commissionRateKeno
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ========== TELEGRAM BOT INTEGRATION ==========
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN || '8281813355:AAElz32khbZ9cnX23CeJQn7gwkAypHuJ9E4';

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
          if (referralCode && agentSystem && agentSystem.processReferral) {
            await agentSystem.processReferral(user.userId, referralCode);
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
                  `• 👑 **AGENT SYSTEM** - Earn 40% commission from referrals\n\n` +
                  `💳 *Wallet Instructions:*\n` +
                  `1. Send money to Telebirr: *${telebirrNumber}*\n` +
                  `2. Enter receipt number in game wallet\n` +
                  `3. Admin will approve within 24 hours\n\n` +
                  `_Need help? Contact admin_`,
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [[
                {
                  text: '🎱 Play Bingo',
                  web_app: { url: 'https://bingo-telegram-game.onrender.com/game' }
                },
                {
                  text: '🎰 Play Keno',
                  web_app: { url: 'https://bingo-telegram-game.onrender.com/keno' }
                }
              ], [
                {
                  text: '👑 Become Agent',
                  web_app: { url: 'https://bingo-telegram-game.onrender.com/agent' }
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
                  `💳 *Deposit to:* ${telebirrNumber}\n` +
                  `🎮 Play: @ethio_games1_bot\n` +
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
                  `👑 *Agent System:*\n` +
                  `• Earn 40% commission from Bingo wins\n` +
                  `• Earn 10% commission from Keno wins\n` +
                  `• Refer friends using your link\n` +
                  `• Earn from their wins automatically\n\n` +
                  `🎮 *Play Now:* @ethio_games1_bot`,
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [[
                {
                  text: '🎮 Open Games',
                  web_app: { url: 'https://bingo-telegram-game.onrender.com/telegram' }
                },
                {
                  text: '👑 Agent Portal',
                  web_app: { url: 'https://bingo-telegram-game.onrender.com/agent' }
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
                  `*How it works:*\n` +
                  `1. Become an agent and get referral link\n` +
                  `2. Share link with friends\n` +
                  `3. Friends join using your link\n` +
                  `4. You earn commission from their wins\n\n` +
                  `*Commission Rates:*\n` +
                  `• 🎱 Bingo wins: *40% commission*\n` +
                  `• 🎰 Keno wins: *10% commission*\n\n` +
                  `*Example:*\n` +
                  `If your referral wins 1000 ETB in Bingo:\n` +
                  `You earn: 1000 × 40% = *400 ETB*\n\n` +
                  `*How to become agent:*\n` +
                  `Contact admin @ethio_games1_bot\n\n` +
                  `*Already an agent?* Use the button below:`,
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [[
                {
                  text: '👑 Open Agent Portal',
                  web_app: { url: 'https://bingo-telegram-game.onrender.com/agent' }
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
                  `• 🎰 **KENO ULTRA** - Fast number selection (NEW)\n` +
                  `• 👑 **AGENT SYSTEM** - Earn commissions (NEW)\n\n` +
                  `*Agent System:*\n` +
                  `• 40% commission from Bingo wins\n` +
                  `• 10% commission from Keno wins\n` +
                  `• Real-time commission tracking\n` +
                  `• Weekly withdrawals\n` +
                  `• Referral link generation\n\n` +
                  `*Commands:*\n` +
                  `/start - Start the bot\n` +
                  `/play - Play games\n` +
                  `/balance - Check balance\n` +
                  `/wallet - Wallet instructions\n` +
                  `/agent - Agent system info\n` +
                  `/help - This message\n\n` +
                  `💳 *Wallet:*\n` +
                  `Deposit to Telebirr: *${telebirrNumber}*\n` +
                  `Min withdrawal: ${minWithdrawal} ETB\n\n` +
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
    const agentStats = agentSystem && agentSystem.getAgentStatistics ? await agentSystem.getAgentStatistics() : { totalAgents: 0, activeAgents: 0, totalCommissions: 0 };
    
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
            <p><strong>Agent Statistics:</strong></p>
            <p>• Total Agents: ${agentStats.totalAgents || 0}</p>
            <p>• Active Agents: ${agentStats.activeAgents || 0}</p>
            <p>• Total Commissions: ${(agentStats.totalCommissions || 0).toFixed(2)} ETB</p>
            <p><strong>Commission Rates:</strong></p>
            <p>• Bingo wins: 40% commission</p>
            <p>• Keno wins: 10% commission</p>
            <p><strong>Agent Features:</strong></p>
            <p>• Real-time commission tracking</p>
            <p>• Agent dashboard with statistics</p>
            <p>• Referral link generation</p>
            <p>• Agent withdrawal system</p>
            <p>• Super admin management panel</p>
            <p>• Agent leaderboard</p>
          </div>
          
          <div class="game-highlight">
            <h3>🎰 KENO ULTRA - NOW AVAILABLE</h3>
            <p><strong>Game Features:</strong></p>
            <p>• Select exactly 5 numbers from 1-80</p>
            <p>• Bet amounts: 5, 10, 20, 50, 100 ETB only</p>
            <p>• 20 numbers drawn per round</p>
            <p>• 30-second automatic rounds</p>
            <p>• Payouts: Match 3=1x, Match 4=5x, Match 5=50x</p>
            <p>• Real-time multiplayer with all players seeing same numbers</p>
            <p>• 5% house commission</p>
          </div>
          
          <div class="info-box">
            <h3>Bot Information:</h3>
            <p><strong>Bot:</strong> @ethio_games1_bot</p>
            <p><strong>Game Entry:</strong> https://bingo-telegram-game.onrender.com/telegram</p>
            <p><strong>Agent Portal:</strong> https://bingo-telegram-game.onrender.com/agent</p>
            <p><strong>Bingo Game:</strong> https://bingo-telegram-game.onrender.com/game</p>
            <p><strong>Keno Game:</strong> https://bingo-telegram-game.onrender.com/keno</p>
            <p><strong>Admin Panel:</strong> https://bingo-telegram-game.onrender.com/admin</p>
            <p><strong>Admin Password:</strong> ${gameLogic.CONFIG ? gameLogic.CONFIG.ADMIN_PASSWORD : 'admin123'}</p>
            <p><strong>Games Available:</strong></p>
            <p>1. 🎱 <strong>BINGO ELITE:</strong> Real-time multiplayer bingo</p>
            <p>2. 🎰 <strong>KENO ULTRA:</strong> Fast number selection game</p>
            <p>3. 👑 <strong>AGENT SYSTEM:</strong> Earn commissions from referrals</p>
            <p><strong>Wallet Features:</strong></p>
            <p>• Telebirr Number: ${telebirrNumber} <strong>(DATABASE PERSISTED)</strong></p>
            <p>• Minimum Withdrawal: ${minWithdrawal} ETB</p>
            <p>• Admin approval for all transactions</p>
            <p><strong>Agent Features:</strong></p>
            <p>• 40% commission from Bingo wins</p>
            <p>• 10% commission from Keno wins</p>
            <p>• Real-time commission tracking</p>
            <p>• Weekly withdrawal processing</p>
            <p>• Referral link with unique code</p>
          </div>
          
          <div>
            <a href="https://t.me/ethio_games1_bot" class="btn" target="_blank">Open Bot in Telegram</a>
            <a href="/admin" class="btn" style="background: #ef4444;" target="_blank">Open Admin Panel</a>
            <a href="/agent" class="btn" style="background: #f59e0b;" target="_blank">Test Agent Portal</a>
            <a href="/keno" class="btn" style="background: #8b5cf6;" target="_blank">Test Keno Game</a>
          </div>
          
          <div style="margin-top: 30px; text-align: left;">
            <h4>Next Steps:</h4>
            <ol>
              <li>Open @ethio_games1_bot in Telegram</li>
              <li>Click "Start"</li>
              <li>Click menu button (bottom left)</li>
              <li>Choose between Bingo, Keno, or Agent Portal!</li>
            </ol>
            
            <h4>Agent System Instructions:</h4>
            <ol>
              <li>Open Agent Portal (/agent)</li>
              <li>Login with agent credentials (contact admin)</li>
              <li>Generate referral link</li>
              <li>Share link with friends</li>
              <li>Earn 40% from Bingo, 10% from Keno wins</li>
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
║   🤖 BINGO ELITE + KENO ULTRA + AGENT SYSTEM - DEPLOYED ON RENDER           ║
╠══════════════════════════════════════════════════════════════════════════════╣
║  Server:       http://${HOST}:${PORT}                                       ║
║  Health:       /health                                                      ║
║  Status:       /status                                                      ║
║  Ready:        /ready                                                       ║
║  Node:         ${process.version}                                           ║
║  Environment:  ${process.env.NODE_ENV || 'development'}                     ║
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
