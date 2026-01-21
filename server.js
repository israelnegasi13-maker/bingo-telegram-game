// server.js - BINGO ELITE - TELEGRAM MINI APP - MAIN SERVER FILE
require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const mongoose = require('mongoose');
const fetch = require('node-fetch');

// Import game logic module
const gameLogic = require('./game-logic');

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/bingo', {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(async () => {
  console.log('✅ MongoDB Connected');
  await initializeTelebirrNumber(); // Initialize default Telebirr number
})
.catch(err => {
  console.error('❌ MongoDB Connection Error:', err);
  process.exit(1);
});

// MongoDB Models (keep these in main file for routes)
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

// NEW: Setting model for storing Telebirr number
const settingSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  value: { type: mongoose.Schema.Types.Mixed, required: true },
  updatedAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);
const Room = mongoose.model('Room', roomSchema);
const Transaction = mongoose.model('Transaction', transactionSchema);
const Stats = mongoose.model('Stats', statsSchema);
const Setting = mongoose.model('Setting', settingSchema); // NEW

// Telebirr number utility functions
async function getTelebirrNumber() {
  try {
    const setting = await Setting.findOne({ key: 'telebirrNumber' });
    return setting ? setting.value : '0962577855';
  } catch (err) {
    console.error('Error getting Telebirr number:', err);
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
      { value: newNumber, updatedAt: new Date() },
      { upsert: true, new: true }
    );
    console.log(`✅ Telebirr number updated to: ${newNumber}`);
    return result;
  } catch (err) {
    console.error('Error updating Telebirr number:', err);
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
    } else {
      console.log(`✅ Telebirr number loaded from DB: ${exists.value}`);
    }
  } catch (err) {
    console.error('Error initializing Telebirr number:', err);
  }
}

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

// ========== INITIALIZE GAME LOGIC ==========
gameLogic.initialize(io, { User, Room, Transaction, Stats });

// ========== SOCKET.IO EVENT HANDLERS ==========
io.on('connection', (socket) => {
  console.log(`🔌 New connection: ${socket.id}`);
  
  // Admin authentication
  socket.on('admin:auth', async (password) => {
    if (password === gameLogic.CONFIG.ADMIN_PASSWORD) {
      socket.admin = true;
      socket.emit('admin:authSuccess');
      
      // Send current Telebirr number on successful auth
      const telebirrNumber = await getTelebirrNumber();
      socket.emit('admin:telebirrNumber', telebirrNumber);
      
      console.log(`🔑 Admin authenticated: ${socket.id}`);
    } else {
      socket.emit('admin:authError', 'Invalid password');
    }
  });
  
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
        console.error('Error updating Telebirr number:', error);
        socket.emit('admin:error', error.message || 'Failed to update Telebirr number');
      }
    }
  });
  
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
  
  // Existing admin events (delegated to gameLogic)
  socket.on('admin:getData', () => {
    if (socket.admin && gameLogic.handleAdminGetData) {
      gameLogic.handleAdminGetData(socket);
    }
  });
  
  socket.on('admin:addFunds', (data) => {
    if (socket.admin && gameLogic.handleAdminAddFunds) {
      gameLogic.handleAdminAddFunds(socket, data);
    }
  });
  
  socket.on('admin:banPlayer', (userId) => {
    if (socket.admin && gameLogic.handleAdminBanPlayer) {
      gameLogic.handleAdminBanPlayer(socket, userId);
    }
  });
  
  socket.on('admin:kickPlayer', (userId) => {
    if (socket.admin && gameLogic.handleAdminKickPlayer) {
      gameLogic.handleAdminKickPlayer(socket, userId);
    }
  });
  
  socket.on('admin:disconnectUser', (userId) => {
    if (socket.admin && gameLogic.handleAdminDisconnectUser) {
      gameLogic.handleAdminDisconnectUser(socket, userId);
    }
  });
  
  socket.on('admin:forceStartGame', (stake) => {
    if (socket.admin && gameLogic.handleAdminForceStartGame) {
      gameLogic.handleAdminForceStartGame(socket, stake);
    }
  });
  
  socket.on('admin:forceDraw', (stake) => {
    if (socket.admin && gameLogic.handleAdminForceDraw) {
      gameLogic.handleAdminForceDraw(socket, stake);
    }
  });
  
  socket.on('admin:forceEndGame', (stake) => {
    if (socket.admin && gameLogic.handleAdminForceEndGame) {
      gameLogic.handleAdminForceEndGame(socket, stake);
    }
  });
  
  socket.on('admin:getPendingTransactions', async () => {
    if (socket.admin && gameLogic.handleAdminGetPendingTransactions) {
      await gameLogic.handleAdminGetPendingTransactions(socket);
    }
  });
  
  socket.on('admin:approveDeposit', (transactionId) => {
    if (socket.admin && gameLogic.handleAdminApproveDeposit) {
      gameLogic.handleAdminApproveDeposit(socket, transactionId);
    }
  });
  
  socket.on('admin:approveWithdrawal', (transactionId) => {
    if (socket.admin && gameLogic.handleAdminApproveWithdrawal) {
      gameLogic.handleAdminApproveWithdrawal(socket, transactionId);
    }
  });
  
  socket.on('admin:rejectTransaction', (transactionId) => {
    if (socket.admin && gameLogic.handleAdminRejectTransaction) {
      gameLogic.handleAdminRejectTransaction(socket, transactionId);
    }
  });
  
  // Disconnect handler
  socket.on('disconnect', () => {
    console.log(`🔌 Disconnected: ${socket.id}`);
    if (socket.admin) {
      console.log(`🔑 Admin disconnected: ${socket.id}`);
    }
    // Handle player disconnect in game logic
    if (gameLogic.handleDisconnect) {
      gameLogic.handleDisconnect(socket);
    }
  });
  
  // Forward game events to game logic
  socket.on('join', (data) => {
    if (gameLogic.handleJoin) {
      gameLogic.handleJoin(socket, data);
    }
  });
  
  socket.on('selectBox', (data) => {
    if (gameLogic.handleSelectBox) {
      gameLogic.handleSelectBox(socket, data);
    }
  });
  
  socket.on('claimBingo', (data) => {
    if (gameLogic.handleClaimBingo) {
      gameLogic.handleClaimBingo(socket, data);
    }
  });
  
  socket.on('markNumber', (data) => {
    if (gameLogic.handleMarkNumber) {
      gameLogic.handleMarkNumber(socket, data);
    }
  });
  
  socket.on('depositRequest', (data) => {
    if (gameLogic.handleDepositRequest) {
      gameLogic.handleDepositRequest(socket, data);
    }
  });
  
  socket.on('withdrawRequest', (data) => {
    if (gameLogic.handleWithdrawRequest) {
      gameLogic.handleWithdrawRequest(socket, data);
    }
  });
  
  socket.on('getUserData', (data) => {
    if (gameLogic.handleGetUserData) {
      gameLogic.handleGetUserData(socket, data);
    }
  });
});

// ========== EXPRESS ROUTES ==========
app.get('/', async (req, res) => {
  const connectedSockets = gameLogic.getConnectedSockets ? gameLogic.getConnectedSockets().size : 0;
  const socketToUser = gameLogic.getSocketToUser ? gameLogic.getSocketToUser().size : 0;
  const adminSockets = gameLogic.getAdminSockets ? gameLogic.getAdminSockets().size : 0;
  const processingClaims = gameLogic.getProcessingClaims ? gameLogic.getProcessingClaims().size : 0;
  const telebirrNumber = await getTelebirrNumber();
  
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
              <div class="stat-value" id="playerCount">${connectedSockets}</div>
            </div>
            <div class="stat">
              <div class="stat-label">Database Status</div>
              <div class="stat-value" style="color: #10b981;">✅ Online</div>
            </div>
          </div>
          <p style="margin-top: 20px; color: #f59e0b; font-weight: bold;">🎯 Four Corners Bonus: ${gameLogic.CONFIG ? gameLogic.CONFIG.FOUR_CORNERS_BONUS : 50} ETB!</p>
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
            Socket.IO: ✅ Connected Sockets: ${connectedSockets}<br>
            SocketToUser: ${socketToUser} | Admin Sockets: ${adminSockets}<br>
            Processing Claims: ${processingClaims} active<br>
            Telegram Integration: ✅ Ready<br>
            Game Timer: ${gameLogic.CONFIG ? gameLogic.CONFIG.GAME_TIMER : 3}s between balls<br>
            Game Timeout: ${gameLogic.CONFIG ? gameLogic.CONFIG.GAME_TIMEOUT_MINUTES : 7} minutes auto-clear<br>
            Bot Username: @ethio_games1_bot<br>
            Real-time Box Updates: ✅ ACTIVE<br>
            Wallet System: ✅ ACTIVE (Deposit/Withdraw)<br>
            Telebirr Number: ${telebirrNumber}<br>
            Min Withdrawal: ${gameLogic.CONFIG ? gameLogic.CONFIG.MIN_WITHDRAWAL : 50} ETB<br>
            Room Lock: ✅ IMPLEMENTED (games lock when playing)<br>
            Auto-Clear: ✅ ${gameLogic.CONFIG ? gameLogic.CONFIG.GAME_TIMEOUT_MINUTES : 7} minute timeout<br>
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
});

// ========== REDESIGNED TELEGRAM ENTRY PAGE - PROFESSIONAL UX ==========
app.get('/telegram', async (req, res) => {
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
                    radial-gradient(at 0% 50%, rgba(239, 68, 68, 0.1) 0px, transparent 50%);
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
            
            .play-btn:hover {
                transform: scale(1.05);
                box-shadow: 0 6px 16px rgba(59, 130, 246, 0.35);
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
                            </h3>
                            <p class="game-description">
                                Fast number selection with instant wins
                            </p>
                            <div class="game-features">
                                <span class="feature-tag coming">🎰 Instant Wins</span>
                                <span class="feature-tag coming">🔜 Coming Soon</span>
                            </div>
                        </div>
                        <div class="game-action">
                            <button class="play-btn coming-soon" id="kenoBtn" disabled>
                                SOON
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
                        <span>Wallet System</span>
                    </div>
                    <div class="feature-item">
                        <span class="feature-icon">✓</span>
                        <span>Auto Start</span>
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
            
            tg.ready();
            tg.expand();
            
            tg.setHeaderColor('#3b82f6');
            tg.setBackgroundColor('#0f172a');
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
            
            function showHelp() {
                tg.showPopup({
                    title: 'How to Play',
                    message: '1. Click PLAY on Bingo Elite\\n2. Select a room (10-100 ETB)\\n3. Choose an available ticket\\n4. Wait for countdown\\n5. Mark numbers as called\\n6. Claim BINGO to win!',
                    buttons: [{ type: 'ok' }]
                });
            }
            
            function showWalletInfo() {
                tg.showPopup({
                    title: 'Wallet Information',
                    message: '💳 Deposit to: ${telebirrNumber}\\n💰 Min withdrawal: ${minWithdrawal} ETB\\n🎮 Play: @ethio_games1_bot',
                    buttons: [{ type: 'ok' }]
                });
            }
            
            function showTerms() {
                tg.showPopup({
                    title: 'Terms & Conditions',
                    message: '• Must be 18+ to play\\n• Play responsibly\\n• Admin decisions are final\\n• Contact @ethio_games1_bot for support',
                    buttons: [{ type: 'ok' }]
                });
            }
            
            document.getElementById('bingoBtn').addEventListener('click', () => launchGame('bingo'));
            document.getElementById('kenoBtn').addEventListener('click', () => launchGame('keno'));
            
            if (tg && tg.MainButton) {
                tg.MainButton.setText('🎮 PLAY BINGO');
                tg.MainButton.show();
                tg.MainButton.onClick(function() {
                    launchGame('bingo');
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
      userName: user.userName,
      balance: user.balance,
      isOnline: user.isOnline,
      lastSeen: user.lastSeen,
      telegramId: user.telegramId,
      phoneNumber: user.phoneNumber || ''
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API endpoint to add funds (for admin)
app.post('/api/add-funds', async (req, res) => {
  try {
    const { userId, amount, adminPassword } = req.body;
    
    if (adminPassword !== gameLogic.CONFIG.ADMIN_PASSWORD) {
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
                  `🎯 *New Features & Fixes:*\n` +
                  `• 💳 **WALLET SYSTEM ADDED** - Deposit/Withdraw\n` +
                  `• 🔒 DOUBLE PRIZE BUG FIXED - Claim lock implemented\n` +
                  `• ⏱️ Timer sync between discovery and waiting rooms\n` +
                  `• 🔒 Room lock when game is playing\n` +
                  `• ⏰ Auto-clear after ${gameLogic.CONFIG.GAME_TIMEOUT_MINUTES} minutes\n` +
                  `• ⏱️ Timer shows on box selection screen\n` +
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
                  `💳 *Deposit Instructions:*\n` +
                  `1. Send money to Telebirr: *${telebirrNumber}*\n` +
                  `2. Enter receipt number in game wallet\n` +
                  `3. Admin will approve within 24 hours\n\n` +
                  `_Need help? Contact admin_`,
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
            text: `💳 *Bingo Elite Wallet*\n\n` +
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
                  `🎮 *Play Now:* @ethio_games1_bot`,
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [[
                {
                  text: '🎮 Open Game',
                  web_app: { url: 'https://bingo-telegram-game.onrender.com/telegram' }
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
            text: `🎮 *Bingo Elite Help*\n\n` +
                  `*New Features & Fixes:*\n` +
                  `• 💳 **WALLET SYSTEM** - Deposit/Withdraw funds\n` +
                  `• 🔒 DOUBLE PRIZE BUG FIXED - Claim lock prevents multiple payouts\n` +
                  `• ⏱️ Timer sync between discovery and waiting rooms\n` +
                  `• 🔒 Rooms lock when game is playing\n` +
                  `• ⏰ Games auto-clear after ${gameLogic.CONFIG.GAME_TIMEOUT_MINUTES} minutes\n` +
                  `• ⏱️ Timer shows on box selection screen\n\n` +
                  `*Commands:*\n` +
                  `/start - Start the bot\n` +
                  `/play - Play game\n` +
                  `/balance - Check balance\n` +
                  `/wallet - Wallet instructions\n` +
                  `/help - This message\n\n` +
                  `*How to Play:*\n` +
                  `1. Click "Play Now"\n` +
                  `2. Select room (10-100 ETB)\n` +
                  `3. Choose ticket (1-100) - See taken boxes in real-time!\n` +
                  `4. ⏱️ Timer shows countdown on box selection screen\n` +
                  `5. Game starts after 30 seconds with 1 player\n` +
                  `6. Timer continues even if players leave\n` +
                  `7. 🔒 Room locks when game starts\n` +
                  `8. Mark numbers as called\n` +
                  `9. Claim BINGO! - 🔒 Claim lock prevents double prizes\n` +
                  `10. ⏰ Game auto-ends after ${gameLogic.CONFIG.GAME_TIMEOUT_MINUTES} minutes if no winner\n` +
                  `11. ALL players return to lobby automatically\n\n` +
                  `*Four Corners Bonus:* 50 ETB!\n` +
                  `*Real-time Box Tracking:* See which boxes are taken instantly!\n` +
                  `*Auto Start:* Game starts when 1 online player joins\n` +
                  `*Timer Doesn't Reset:* Game continues even if players leave\n` +
                  `*Random BINGO Cards:* Each card has unique random numbers\n` +
                  `*🔒 DOUBLE PRIZE FIXED:* Claim lock prevents multiple payouts\n` +
                  `*✅✅✅ Fixed:* Claim Bingo now properly checks numbers\n` +
                  `*✅ Fixed:* All players return to lobby after game ends\n` +
                  `*✅ Fixed:* Game starts with 1 player after 30 seconds\n\n` +
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
          text: '🎮 Play Bingo',
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
        </style>
      </head>
      <body>
        <div class="container">
          <h1>✅ Telegram Bot Setup Complete!</h1>
          <div class="success">✓ Webhook Configured</div>
          <div class="success">✓ Menu Button Set</div>
          
          <div class="info-box">
            <h3>Bot Information:</h3>
            <p><strong>Bot:</strong> @ethio_games1_bot</p>
            <p><strong>Game URL:</strong> https://bingo-telegram-game.onrender.com/telegram</p>
            <p><strong>Admin Panel:</strong> https://bingo-telegram-game.onrender.com/admin</p>
            <p><strong>Admin Password:</strong> ${gameLogic.CONFIG.ADMIN_PASSWORD}</p>
            <p><strong>New Features & Fixes Added:</strong></p>
            <p>1. 💳 <strong>WALLET SYSTEM:</strong> Deposit/Withdraw with Telebirr integration</p>
            <p>2. 🔒 <strong>DOUBLE PRIZE BUG FIXED:</strong> Claim lock prevents multiple payouts</p>
            <p>3. ⏱️ <strong>Timer Synchronization:</strong> Discovery timer synced with waiting room</p>
            <p>4. 🔒 <strong>Room Lock:</strong> Rooms lock when game is playing</p>
            <p>5. ⏰ <strong>${gameLogic.CONFIG.GAME_TIMEOUT_MINUTES}-minute Auto-clear:</strong> Games auto-end after ${gameLogic.CONFIG.GAME_TIMEOUT_MINUTES} minutes</p>
            <p>6. ⏱️ <strong>Box Selection Timer:</strong> Countdown shows on box selection screen</p>
            <p><strong>Wallet Features:</strong></p>
            <p>• Telebirr Number: ${telebirrNumber}</p>
            <p>• Minimum Withdrawal: ${minWithdrawal} ETB</p>
            <p>• Admin approval for all transactions</p>
            <p><strong>Real-time Features:</strong> Box tracking, Live updates</p>
            <p><strong>Fixed Issues:</strong> Double prize bug eliminated, Claim Bingo now properly checks numbers, All players return to lobby, Game starts with 1 player</p>
            <p><strong>✅ 30-second countdown now working</strong></p>
            <p><strong>✅ Balls pop every 3 seconds</strong></p>
            <p><strong>✅ Countdown continues when players leave</strong></p>
            <p><strong>✅ Game starts with 1 player after 30 seconds</strong></p>
            <p><strong>✅✅✅ DOUBLE PRIZE BUG ELIMINATED WITH CLAIM LOCK</strong></p>
            <p><strong>✅✅✅ CLAIM BINGO NOW PROPERLY CHECKS NUMBERS</strong></p>
            <p><strong>✅✅ ALL PLAYERS RETURN TO LOBBY AFTER GAME ENDS</strong></p>
          </div>
          
          <div>
            <a href="https://t.me/ethio_games1_bot" class="btn" target="_blank">Open Bot in Telegram</a>
            <a href="/admin" class="btn" style="background: #ef4444;" target="_blank">Open Admin Panel</a>
          </div>
          
          <div style="margin-top: 30px; text-align: left;">
            <h4>Next Steps:</h4>
            <ol>
              <li>Open @ethio_games1_bot in Telegram</li>
              <li>Click "Start"</li>
              <li>Click menu button (bottom left)</li>
              <li>Play Bingo with new features!</li>
            </ol>
            
            <h4>To Add Funds to Players:</h4>
            <ol>
              <li>Open Admin Panel (link above)</li>
              <li>Login with password: ${gameLogic.CONFIG.ADMIN_PASSWORD}</li>
              <li>Find user by Telegram ID</li>
              <li>Click "Add Funds" button</li>
              <li>OR Approve pending deposit/withdrawal requests</li>
            </ol>
            
            <h4>Wallet Instructions for Players:</h4>
            <ol>
              <li>Send money to Telebirr: ${telebirrNumber}</li>
              <li>In game, click Wallet (💰 button)</li>
              <li>Enter receipt number and amount</li>
              <li>Admin approves in Admin Panel</li>
              <li>Funds appear in player balance</li>
            </ol>
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

// Serve static files
app.get('/game', (req, res) => {
  res.sendFile(path.join(__dirname, 'game.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

// Health check endpoint
app.get('/health', async (req, res) => {
  try {
    const connectedPlayers = gameLogic.getConnectedUsers ? gameLogic.getConnectedUsers().length : 0;
    const activeGames = await Room.countDocuments({ status: 'playing' });
    const totalUsers = await User.countDocuments();
    const rooms = await Room.countDocuments();
    const totalTransactions = await Transaction.countDocuments();
    const pendingDeposits = await Transaction.countDocuments({ type: 'DEPOSIT_REQUEST', status: 'pending' });
    const pendingWithdrawals = await Transaction.countDocuments({ type: 'WITHDRAW_REQUEST', status: 'pending' });
    const telebirrNumber = await getTelebirrNumber();
    
    res.json({
      status: 'ok',
      database: 'connected',
      connectedPlayers: connectedPlayers,
      totalUsers: totalUsers,
      activeGames: activeGames,
      totalRooms: rooms,
      totalTransactions: totalTransactions,
      pendingDeposits: pendingDeposits,
      pendingWithdrawals: pendingWithdrawals,
      telebirrNumber: telebirrNumber,
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      telegramReady: true,
      botUsername: '@ethio_games1_bot',
      realTimeBoxUpdates: 'active',
      walletSystem: 'active'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ========== DEBUG ENDPOINTS ==========
app.get('/debug-connections', (req, res) => {
  try {
    const connectedSockets = gameLogic.getConnectedSockets ? gameLogic.getConnectedSockets().size : 0;
    const socketToUser = gameLogic.getSocketToUser ? gameLogic.getSocketToUser().size : 0;
    const adminSockets = gameLogic.getAdminSockets ? gameLogic.getAdminSockets().size : 0;
    const processingClaims = gameLogic.getProcessingClaims ? gameLogic.getProcessingClaims().size : 0;
    
    res.json({
      connectedSockets: connectedSockets,
      socketToUser: socketToUser,
      adminSockets: adminSockets,
      processingClaims: processingClaims,
      serverTime: new Date().toISOString()
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
        telegramId: u.telegramId
      }))
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ========== START SERVER ==========
const PORT = process.env.PORT || 3000;
server.listen(PORT, async () => {
  const telebirrNumber = await getTelebirrNumber();
  console.log(`
╔════════════════════════════════════════════════════════════════╗
║             🤖 BINGO ELITE - TELEGRAM READY                   ║
╠════════════════════════════════════════════════════════════════╣
║  URL:          https://bingo-telegram-game.onrender.com       ║
║  Port:         ${PORT}                                        ║
║  Game:         /game                                          ║
║  Admin:        /admin (password: ${gameLogic.CONFIG.ADMIN_PASSWORD})  ║
║  Telegram:     /telegram                                      ║
║  Bot Setup:    /setup-telegram                                ║
╠════════════════════════════════════════════════════════════════╣
║  🔑 Admin Password: ${gameLogic.CONFIG.ADMIN_PASSWORD}          ║
║  🤖 Telegram Bot: @ethio_games1_bot                           ║
║  📡 WebSocket: ✅ Ready for Telegram connections              ║
║  🎮 Four Corners Bonus: ${gameLogic.CONFIG.FOUR_CORNERS_BONUS} ETB ║
║  📦 Real-time Box Tracking: ✅ ACTIVE                         ║
║  💳 Wallet System: ✅ ACTIVE                                  ║
║  📱 Telebirr: ${telebirrNumber}                               ║
║  💾 Telebirr Number: DATABASE PERSISTENCE ✅                 ║
╚════════════════════════════════════════════════════════════════╝
✅ Server ready with database-persisted Telebirr number
  `);
});
