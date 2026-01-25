// server.js - BINGO ELITE - TELEGRAM MINI APP - MAIN SERVER FILE
// NOW WITH KENO INTEGRATION
require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const mongoose = require('mongoose');
const fetch = require('node-fetch');

// Import game logic modules
const gameLogic = require('./game-logic');
const kenoLogic = require('./keno-logic');

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
  totalKenoWagered: { type: Number, default: 0 },
  totalKenoWins: { type: Number, default: 0 },
  totalKenoGames: { type: Number, default: 0 },
  joinedAt: { type: Date, default: Date.now },
  lastSeen: { type: Date, default: Date.now },
  isOnline: { type: Boolean, default: false },
  sessionCount: { type: Number, default: 0 },
  telegramId: { type: String, unique: true, sparse: true },
  telegramUsername: { type: String },
  languageCode: { type: String, default: 'en' },
  phoneNumber: { type: String },
  preferredGame: { type: String, default: 'bingo' } // 'bingo' or 'keno'
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
  countdownStartedWith: { type: Number, default: 0 },
  gameType: { type: String, default: 'bingo' } // 'bingo' or 'keno'
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
  createdAt: { type: Date, default: Date.now },
  gameType: { type: String, default: 'bingo' } // 'bingo' or 'keno'
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
  totalKenoWagered: { type: Number, default: 0 },
  totalKenoEarnings: { type: Number, default: 0 },
  totalKenoGames: { type: Number, default: 0 },
  totalKenoWins: { type: Number, default: 0 }
});

// Setting model for storing Telebirr number and other settings
const settingSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  value: { type: mongoose.Schema.Types.Mixed, required: true },
  updatedAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);
const Room = mongoose.model('Room', roomSchema);
const Transaction = mongoose.model('Transaction', transactionSchema);
const Stats = mongoose.model('Stats', statsSchema);
const Setting = mongoose.model('Setting', settingSchema);

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
// Pass database models and Telebirr number functions to game logic
gameLogic.initialize(io, { 
  User, 
  Room, 
  Transaction, 
  Stats,
  Setting,
  getTelebirrNumber, // Pass the function
  updateTelebirrNumber // Pass the function
});

// Initialize Keno game logic
kenoLogic.initializeKeno(io, { 
  User, 
  Room, 
  Transaction, 
  Stats,
  Setting,
  getTelebirrNumber
});

// Load initial Telebirr number into game logic
(async () => {
  const telebirrNumber = await getTelebirrNumber();
  console.log(`📱 Initial Telebirr number loaded: ${telebirrNumber}`);
})();

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
  
  // KENO ADMIN FUNCTIONS
  socket.on('admin:forceStartKeno', (stake) => {
    if (socket.admin && kenoLogic.adminForceStartKenoRound) {
      const result = kenoLogic.adminForceStartKenoRound(stake);
      if (result.success) {
        socket.emit('admin:success', result.message);
      } else {
        socket.emit('admin:error', result.message);
      }
    }
  });
  
  socket.on('admin:forceDrawKeno', (stake) => {
    if (socket.admin && kenoLogic.adminForceDrawKenoNumber) {
      const result = kenoLogic.adminForceDrawKenoNumber(stake);
      if (result.success) {
        socket.emit('admin:success', result.message);
      } else {
        socket.emit('admin:error', result.message);
      }
    }
  });
  
  socket.on('admin:forceEndKeno', (stake) => {
    if (socket.admin && kenoLogic.adminForceEndKenoRound) {
      const result = kenoLogic.adminForceEndKenoRound(stake);
      if (result.success) {
        socket.emit('admin:success', result.message);
      } else {
        socket.emit('admin:error', result.message);
      }
    }
  });
  
  // Get Keno stats (admin only)
  socket.on('admin:getKenoStats', () => {
    if (!socket.admin) {
      socket.emit('admin:error', 'Unauthorized');
      return;
    }
    
    try {
      const kenoRooms = kenoLogic.getKenoRoums ? kenoLogic.getKenoRooms() : new Map();
      const kenoBets = kenoLogic.getKenoBets ? kenoLogic.getKenoBets() : new Map();
      const kenoHistory = kenoLogic.getKenoGameHistory ? kenoLogic.getKenoGameHistory() : [];
      
      const stats = {
        totalRooms: kenoRooms.size,
        totalBets: kenoBets.size,
        totalGames: kenoHistory.length,
        activeRooms: Array.from(kenoRooms.values()).filter(room => room.players.size > 0).length,
        totalPlayers: Array.from(kenoRooms.values()).reduce((sum, room) => sum + room.players.size, 0),
        recentHistory: kenoHistory.slice(0, 10),
        timestamp: new Date().toISOString()
      };
      
      socket.emit('admin:kenoStats', stats);
    } catch (error) {
      console.error('Error getting Keno stats:', error);
      socket.emit('admin:error', 'Error getting Keno stats');
    }
  });
  
  // Reset house earnings (admin only) - now includes Keno earnings
  socket.on('admin:resetHouseEarnings', async () => {
    if (socket.admin) {
      try {
        // Get current total from all transactions (Bingo + Keno)
        const houseEarningsTransactions = await Transaction.find({ 
          type: { $in: ['HOUSE_EARNINGS', 'KENO_HOUSE_EARNINGS'] } 
        });
        const previousAmount = houseEarningsTransactions.reduce((sum, t) => sum + t.amount, 0);
        
        // Create a reset transaction
        const resetTransaction = new Transaction({
          type: 'HOUSE_EARNINGS_RESET',
          userId: 'system',
          userName: 'System',
          amount: -previousAmount,
          admin: true,
          description: `House earnings reset from ${previousAmount.toFixed(2)} to 0 ETB (Bingo + Keno)`
        });
        await resetTransaction.save();
        
        socket.emit('admin:houseEarningsReset', { 
          previousAmount,
          resetAmount: 0,
          message: `House earnings reset from ${previousAmount.toFixed(2)} to 0 ETB`
        });
        
        console.log(`🔄 House earnings reset from ${previousAmount.toFixed(2)} to 0 ETB (includes Keno)`);
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
  
  // Telebirr number request from players
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
});

// ========== EXPRESS ROUTES ==========
app.get('/', async (req, res) => {
  const connectedSockets = gameLogic.getConnectedSockets ? gameLogic.getConnectedSockets().size : 0;
  const socketToUser = gameLogic.getSocketToUser ? gameLogic.getSocketToUser().size : 0;
  const adminSockets = gameLogic.getAdminSockets ? gameLogic.getAdminSockets().size : 0;
  const processingClaims = gameLogic.getProcessingClaims ? gameLogic.getProcessingClaims().size : 0;
  const roomWinners = gameLogic.getRoomWinners ? gameLogic.getRoomWinners().size : 0;
  const telebirrNumber = await getTelebirrNumber();
  
  // Get Keno stats
  const kenoRooms = kenoLogic.getKenoRooms ? kenoLogic.getKenoRooms().size : 0;
  const kenoBets = kenoLogic.getKenoBets ? kenoLogic.getKenoBets().size : 0;
  
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Bingo Elite & Keno - Telegram Mini App</title>
      <style>
        body { font-family: Arial, sans-serif; padding: 40px; text-align: center; background: #0f172a; color: #f8fafc; }
        .container { max-width: 800px; margin: 0 auto; }
        .status { padding: 30px; background: #1e293b; border-radius: 20px; margin: 30px auto; border: 1px solid #334155; }
        .stats-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 20px; margin: 30px 0; }
        .stat { background: rgba(255,255,255,0.05); padding: 20px; border-radius: 12px; }
        .stat-value { font-size: 2.5rem; font-weight: 900; margin: 10px 0; }
        .stat-label { font-size: 0.9rem; color: #94a3b8; text-transform: uppercase; letter-spacing: 1px; }
        .btn { display: inline-block; padding: 12px 24px; background: #3b82f6; color: white; text-decoration: none; border-radius: 8px; margin: 10px; font-weight: bold; }
        .btn-admin { background: #ef4444; }
        .btn-admin:hover { background: #dc2626; }
        .btn-game { background: #10b981; }
        .btn-game:hover { background: #059669; }
        .btn-keno { background: #8b5cf6; }
        .btn-keno:hover { background: #7c3aed; }
        .telebirr-info { background: rgba(59, 130, 246, 0.1); padding: 15px; border-radius: 12px; margin: 20px 0; border: 1px solid rgba(59, 130, 246, 0.3); }
        .telebirr-number { font-size: 1.5rem; font-weight: bold; color: #60a5fa; margin: 10px 0; }
        .fix-highlight { background: rgba(16, 185, 129, 0.1); padding: 15px; border-radius: 12px; margin: 20px 0; border: 1px solid rgba(16, 185, 129, 0.3); }
        .games-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 20px; margin: 30px 0; }
        .game-card { background: rgba(255,255,255,0.05); padding: 25px; border-radius: 15px; text-align: center; border: 1px solid rgba(255,255,255,0.1); transition: all 0.3s; }
        .game-card:hover { border-color: #3b82f6; transform: translateY(-5px); }
        .game-icon { font-size: 3rem; margin-bottom: 15px; }
        .game-title { font-size: 1.5rem; margin-bottom: 10px; color: #f8fafc; }
        .game-desc { color: #94a3b8; font-size: 0.9rem; margin-bottom: 20px; }
      </style>
    </head>
    <body>
      <div class="container">
        <h1 style="font-size: 3rem; margin-bottom: 20px;">🎮 BINGO ELITE & KENO</h1>
        <p style="color: #94a3b8; font-size: 1.2rem;">Multi-game platform - Ready for Telegram</p>
        
        <div class="status">
          <h2 style="color: #10b981;">🚀 Server Status: RUNNING</h2>
          
          <div class="games-grid">
            <div class="game-card">
              <div class="game-icon">🎱</div>
              <div class="game-title">BINGO ELITE</div>
              <div class="game-desc">Real-time multiplayer bingo with big wins</div>
              <a href="/telegram" class="btn btn-game">Play Bingo</a>
            </div>
            <div class="game-card">
              <div class="game-icon">🎰</div>
              <div class="game-title">KENO PREMIUM</div>
              <div class="game-desc">Fast number selection with instant wins</div>
              <a href="/keno" class="btn btn-keno">Play Keno</a>
            </div>
          </div>
          
          <div class="stats-grid">
            <div class="stat">
              <div class="stat-label">Connected Players</div>
              <div class="stat-value" id="playerCount">${connectedSockets}</div>
            </div>
            <div class="stat">
              <div class="stat-label">Database Status</div>
              <div class="stat-value" style="color: #10b981;">✅ Online</div>
            </div>
            <div class="stat">
              <div class="stat-label">Bingo Rooms</div>
              <div class="stat-value">4</div>
            </div>
            <div class="stat">
              <div class="stat-label">Keno Rooms</div>
              <div class="stat-value">${kenoRooms}</div>
            </div>
          </div>
          
          <div class="telebirr-info">
            <div class="stat-label">📱 TELEBIRR PAYMENT NUMBER</div>
            <div class="telebirr-number">${telebirrNumber}</div>
            <p style="color: #94a3b8; font-size: 0.9rem;">Persisted in database - Will survive server restarts</p>
          </div>
          
          <div class="fix-highlight">
            <h3 style="color: #10b981;">✅ MULTI-GAME PLATFORM</h3>
            <p style="color: #94a3b8;">
              <strong>Now featuring:</strong><br>
              1. ✅ BINGO ELITE - Real-time multiplayer bingo<br>
              2. ✅ KENO PREMIUM - Fast number selection game<br>
              3. ✅ SHARED BALANCE - Same wallet for both games<br>
              4. ✅ UNIFIED ADMIN PANEL - Manage both games<br>
              5. ✅ REAL-TIME UPDATES - Live game status<br>
              6. ✅ TELEGRAM INTEGRATION - Both games work on Telegram<br>
              7. ✅ DOUBLE PRIZE PROTECTION - For both games<br>
            </p>
          </div>
          
          <p style="margin-top: 20px; color: #f59e0b; font-weight: bold;">🎯 Four Corners Bonus: ${gameLogic.CONFIG ? gameLogic.CONFIG.FOUR_CORNERS_BONUS : 50} ETB!</p>
          <p style="color: #8b5cf6; font-weight: bold;">🎰 Keno Payouts up to 1000x!</p>
          <p style="color: #64748b; margin-top: 10px;">Server Time: ${new Date().toLocaleString()}</p>
          <p style="color: #10b981;">✅ Telegram Mini App Ready for both games</p>
          <p style="color: #3b82f6; margin-top: 10px;">📦 Real-time Box Tracking: ✅ ACTIVE</p>
          <p style="color: #10b981; margin-top: 10px;">💰 Unified Wallet System: ✅ ACTIVE</p>
          <p style="color: #10b981;">🔒 DOUBLE PRIZE BUG FIXED for both games</p>
          <p style="color: #10b981; margin-top: 10px;">✅✅✅ All games use the same user balance</p>
        </div>
        
        <div style="margin-top: 40px;">
          <h3>Access Points:</h3>
          <div>
            <a href="/admin" class="btn btn-admin" target="_blank">🔒 Admin Panel</a>
            <a href="/game" class="btn btn-game" target="_blank">🎮 Bingo Client</a>
            <a href="/keno" class="btn btn-keno" target="_blank">🎰 Keno Client</a>
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
          <h4>Multi-Game Platform Information</h4>
          <p style="color: #94a3b8; font-size: 0.9rem;">
            Version: 3.0.0 (WITH KENO INTEGRATION) | Database: MongoDB Atlas<br>
            Socket.IO: ✅ Connected Sockets: ${connectedSockets}<br>
            SocketToUser: ${socketToUser} | Admin Sockets: ${adminSockets}<br>
            Processing Claims: ${processingClaims} active | Room Winners: ${roomWinners}<br>
            Keno Bets: ${kenoBets} active | Keno Rooms: ${kenoRooms}<br>
            Telegram Integration: ✅ Ready for both games<br>
            Game Timer: ${gameLogic.CONFIG ? gameLogic.CONFIG.GAME_TIMER : 3}s between balls (Bingo)<br>
            Keno Draw Interval: ${kenoLogic.KENO_CONFIG ? kenoLogic.KENO_CONFIG.AUTO_DRAW_INTERVAL : 1000}ms (Keno)<br>
            Bot Username: @ethio_games1_bot<br>
            Real-time Box Updates: ✅ ACTIVE (Bingo)<br>
            Real-time Number Draws: ✅ ACTIVE (Keno)<br>
            Wallet System: ✅ ACTIVE (Deposit/Withdraw) - Shared balance<br>
            <strong>Telebirr Number: ${telebirrNumber} (PERSISTED IN DATABASE)</strong><br>
            Min Withdrawal: ${gameLogic.CONFIG ? gameLogic.CONFIG.MIN_WITHDRAWAL : 50} ETB<br>
            Room Lock: ✅ IMPLEMENTED for both games<br>
            Auto-Clear: ✅ ${gameLogic.CONFIG ? gameLogic.CONFIG.GAME_TIMEOUT_MINUTES : 7} minute timeout<br>
            <strong>✅✅✅ DOUBLE GAME PLATFORM:</strong><br>
            • BINGO: 10/20/50/100 ETB rooms, Four Corners Bonus<br>
            • KENO: 1/5/10/25/50/100 ETB bets, up to 1000x payouts<br>
            • SHARED BALANCE: Same wallet works for both games<br>
            • UNIFIED TRANSACTIONS: All in one Transaction model<br>
            • SAME USER MODEL: Single user account for both games<br>
            • DOUBLE PRIZE PROTECTION: For both games<br>
            ✅ Timer synchronization fixed, ✅ Game timer working<br>
            ✅ Balls pop every 3s (Bingo), ✅ Numbers draw every 1s (Keno)<br>
            ✅ 30-second countdown working for both games<br>
            ✅ Players properly removed when leaving, ✅ Countdown stuck issue resolved<br>
            ✅ Balls drawn correctly, ✅ BINGO checking working<br>
            ✅ Keno numbers drawn correctly, ✅ Keno payout calculations working<br>
            ✅✅ COUNTDOWN CONTINUES WHEN PLAYERS LEAVE<br>
            ✅✅ GAME STARTS WITH 1 PLAYER AFTER 30 SECONDS<br>
            ✅✅✅✅ CLAIM BINGO NOW PROPERLY CHECKS NUMBERS<br>
            ✅✅✅ ALL PLAYERS RETURN TO LOBBY AFTER GAME ENDS<br>
            ✅✅✅✅ ATOMIC ROOM UPDATES PREVENT DOUBLE WINNERS<br>
            ✅✅✅ SHARED BALANCE SYSTEM: Play both games with one wallet!
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

// ========== REDESIGNED TELEGRAM ENTRY PAGE - WITH KENO ==========
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
                --keno-gradient: linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%);
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
                background: var(--keno-gradient);
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
            
            .feature-tag.keno {
                background: rgba(139, 92, 246, 0.1);
                color: #a78bfa;
                border-color: rgba(139, 92, 246, 0.2);
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
                background: var(--keno-gradient);
                box-shadow: 0 4px 12px rgba(139, 92, 246, 0.25);
            }
            
            .play-btn:hover {
                transform: scale(1.05);
                box-shadow: 0 6px 16px rgba(59, 130, 246, 0.35);
            }
            
            .play-btn.keno:hover {
                box-shadow: 0 6px 16px rgba(139, 92, 246, 0.35);
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
                <p class="subtitle">Multi-game platform on Telegram</p>
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
                            🎰
                        </div>
                        <div class="game-content">
                            <h3 class="game-title">
                                KENO PREMIUM
                            </h3>
                            <p class="game-description">
                                Fast number selection with instant wins
                            </p>
                            <div class="game-features">
                                <span class="feature-tag keno">🎰 Instant Wins</span>
                                <span class="feature-tag keno">💰 Up to 1000x</span>
                                <span class="feature-tag keno">⚡ Fast Draws</span>
                            </div>
                        </div>
                        <div class="game-action">
                            <button class="play-btn keno" id="kenoBtn">
                                PLAY
                            </button>
                        </div>
                    </div>
                </div>
            </div>
            
            <div class="features-highlight">
                <div class="features-title">
                    ⭐ PLATFORM FEATURES
                </div>
                <div class="features-grid">
                    <div class="feature-item">
                        <span class="feature-icon">✓</span>
                        <span>Shared Wallet</span>
                    </div>
                    <div class="feature-item">
                        <span class="feature-icon">✓</span>
                        <span>Two Games</span>
                    </div>
                    <div class="feature-item">
                        <span class="feature-icon">✓</span>
                        <span>Real-time</span>
                    </div>
                    <div class="feature-item">
                        <span class="feature-icon">✓</span>
                        <span>Telegram Ready</span>
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
                    window.location.href = '/keno';
                }
            }
            
            function showHelp() {
                tg.showPopup({
                    title: 'How to Play',
                    message: '🎮 BINGO:\\n1. Select room (10-100 ETB)\\n2. Choose ticket\\n3. Wait for countdown\\n4. Mark numbers\\n5. Claim BINGO!\\n\\n🎰 KENO:\\n1. Select bet amount\\n2. Pick 1-10 numbers\\n3. Wait for draw\\n4. Match numbers to win!\\n\\n💰 Both games use the SAME wallet!',
                    buttons: [{ type: 'ok' }]
                });
            }
            
            function showWalletInfo() {
                tg.showPopup({
                    title: 'Wallet Information',
                    message: '💳 Deposit to: ${telebirrNumber}\\n💰 Min withdrawal: ${minWithdrawal} ETB\\n🎮 Play: @ethio_games1_bot\\n\\n💰 SAME BALANCE for Bingo & Keno!',
                    buttons: [{ type: 'ok' }]
                });
            }
            
            function showTerms() {
                tg.showPopup({
                    title: 'Terms & Conditions',
                    message: '• Must be 18+ to play\\n• Play responsibly\\n• Admin decisions are final\\n• Contact @ethio_games1_bot for support\\n• Same balance works for both games',
                    buttons: [{ type: 'ok' }]
                });
            }
            
            document.getElementById('bingoBtn').addEventListener('click', () => launchGame('bingo'));
            document.getElementById('kenoBtn').addEventListener('click', () => launchGame('keno'));
            
            if (tg && tg.MainButton) {
                tg.MainButton.setText('🎮 PLAY GAMES');
                tg.MainButton.show();
                tg.MainButton.onClick(function() {
                    tg.showPopup({
                        title: 'Choose Game',
                        message: 'Select which game to play:',
                        buttons: [
                            { id: 'bingo', type: 'default', text: '🎱 Bingo Elite' },
                            { id: 'keno', type: 'default', text: '🎰 Keno Premium' }
                        ]
                    });
                    
                    tg.onEvent('popupClosed', function(data) {
                        if (data.button_id === 'bingo') launchGame('bingo');
                        if (data.button_id === 'keno') launchGame('keno');
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
});

// ========== KENO GAME PAGE ==========
app.get('/keno', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/keno.html'));
});

// ========== BINGO GAME PAGE ==========
app.get('/game', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/game.html'));
});

// ========== ADMIN PANEL ==========
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/admin.html'));
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
      phoneNumber: user.phoneNumber || '',
      preferredGame: user.preferredGame || 'bingo',
      totalBingos: user.totalBingos || 0,
      totalKenoWins: user.totalKenoWins || 0
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

// API endpoint to get game statistics
app.get('/api/stats', async (req, res) => {
  try {
    const totalUsers = await User.countDocuments();
    const activeUsers = await User.countDocuments({ isOnline: true });
    const totalBingoWins = await Transaction.countDocuments({ type: { $in: ['WIN', 'WIN_FOUR_CORNERS'] } });
    const totalKenoWins = await Transaction.countDocuments({ type: 'KENO_WIN' });
    
    // Calculate total wagered
    const bingoWagered = await Transaction.aggregate([
      { $match: { 
        gameType: 'bingo',
        type: { $nin: ['NEW_USER', 'ADMIN_ADD', 'HOUSE_EARNINGS', 'KENO_HOUSE_EARNINGS'] },
        amount: { $lt: 0 }
      } },
      { $group: { _id: null, total: { $sum: { $abs: '$amount' } } } }
    ]).then(result => result[0]?.total || 0);
    
    const kenoWagered = await Transaction.aggregate([
      { $match: { 
        gameType: 'keno',
        type: { $nin: ['NEW_USER', 'ADMIN_ADD', 'HOUSE_EARNINGS', 'KENO_HOUSE_EARNINGS'] },
        amount: { $lt: 0 }
      } },
      { $group: { _id: null, total: { $sum: { $abs: '$amount' } } } }
    ]).then(result => result[0]?.total || 0);
    
    const totalWagered = bingoWagered + kenoWagered;
    
    // Calculate house earnings
    const houseEarnings = await Transaction.aggregate([
      { $match: { type: { $in: ['HOUSE_EARNINGS', 'KENO_HOUSE_EARNINGS'] } } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]).then(result => result[0]?.total || 0);
    
    // Get Keno specific stats
    const kenoRooms = kenoLogic.getKenoRooms ? kenoLogic.getKenoRooms().size : 0;
    const kenoActiveBets = kenoLogic.getKenoBets ? kenoLogic.getKenoBets().size : 0;
    
    res.json({
      totalUsers,
      activeUsers,
      totalWagered,
      bingoWagered,
      kenoWagered,
      houseEarnings,
      totalBingoWins,
      totalKenoWins,
      kenoRooms,
      kenoActiveBets,
      timestamp: new Date().toISOString()
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
            text: `🎮 *Welcome to ETHIO GAMES, ${userName}!*\n\n` +
                  `💰 Your balance: *${user.balance.toFixed(2)} ETB*\n\n` +
                  `🎯 *Now with TWO GAMES:*\n` +
                  `• 🎱 **BINGO ELITE** - Real-time multiplayer bingo\n` +
                  `• 🎰 **KENO PREMIUM** - Fast number selection with up to 1000x wins\n\n` +
                  `💡 *Features:*\n` +
                  `• 💳 **SHARED WALLET** - Same balance for both games!\n` +
                  `• 🔒 **DOUBLE PRIZE PROTECTION** - For both games\n` +
                  `• ⏱️ **Real-time multiplayer** - Play with others\n` +
                  `• 📱 **Telegram optimized** - Works perfectly in app\n\n` +
                  `🎱 *Bingo Features:*\n` +
                  `• 10/20/50/100 ETB rooms\n` +
                  `• Four Corners Bonus: 50 ETB\n` +
                  `• Real-time box tracking\n` +
                  `• Game starts with 1 player\n\n` +
                  `🎰 *Keno Features:*\n` +
                  `• 1/5/10/25/50/100 ETB bets\n` +
                  `• Pick 1-10 numbers from 1-80\n` +
                  `• 20 numbers drawn per round\n` +
                  `• Payouts up to 1000x!\n\n` +
                  `💳 *Deposit Instructions:*\n` +
                  `1. Send money to Telebirr: *${telebirrNumber}*\n` +
                  `2. Enter receipt number in game wallet\n` +
                  `3. Admin will approve within 24 hours\n\n` +
                  `🎮 *Play both games with the same balance!*\n` +
                  `_Need help? Contact admin_`,
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [[
                {
                  text: '🎮 Play Bingo Now',
                  web_app: { url: 'https://bingo-telegram-game.onrender.com/telegram' }
                }
              ], [
                {
                  text: '🎰 Play Keno Now',
                  web_app: { url: 'https://bingo-telegram-game.onrender.com/keno' }
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
                  `🎮 *Games Played:*\n` +
                  `• Bingo Wins: ${user?.totalBingos || 0}\n` +
                  `• Keno Wins: ${user?.totalKenoWins || 0}\n\n` +
                  `💳 *Deposit to:* ${telebirrNumber}\n` +
                  `🎮 Play both games: @ethio_games1_bot\n` +
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
                  `*Shared Balance for BOTH Games!*\n\n` +
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
                  `🎮 *Play Both Games:*\n` +
                  `• Bingo: @ethio_games1_bot\n` +
                  `• Keno: @ethio_games1_bot\n` +
                  `💰 Same balance works for both!`,
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
                  `*Two Games, One Wallet:*\n` +
                  `• 🎱 **BINGO ELITE** - Real-time multiplayer bingo\n` +
                  `• 🎰 **KENO PREMIUM** - Fast number selection game\n\n` +
                  `*Commands:*\n` +
                  `/start - Start the bot\n` +
                  `/play - Play games\n` +
                  `/balance - Check balance\n` +
                  `/wallet - Wallet instructions\n` +
                  `/help - This message\n\n` +
                  `*How to Play Bingo:*\n` +
                  `1. Click "Play Bingo"\n` +
                  `2. Select room (10-100 ETB)\n` +
                  `3. Choose ticket (1-100)\n` +
                  `4. Game starts after 30 seconds\n` +
                  `5. Mark numbers as called\n` +
                  `6. Claim BINGO!\n\n` +
                  `*How to Play Keno:*\n` +
                  `1. Click "Play Keno"\n` +
                  `2. Select bet amount (1-100 ETB)\n` +
                  `3. Pick 1-10 numbers from 1-80\n` +
                  `4. Wait for number draw\n` +
                  `5. Match numbers to win!\n\n` +
                  `*Shared Features:*\n` +
                  `• 💳 Same wallet for both games\n` +
                  `• 🔒 Double prize protection\n` +
                  `• ⏱️ Real-time multiplayer\n` +
                  `• 📱 Telegram optimized\n\n` +
                  `💳 *Wallet:*\n` +
                  `Deposit to Telebirr: *${telebirrNumber}*\n` +
                  `Min withdrawal: ${minWithdrawal} ETB\n\n` +
                  `_Need help? Contact admin_`,
            parse_mode: 'Markdown'
          })
        });
      }
      else if (text === '/keno') {
        await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: `🎰 *KENO PREMIUM*\n\n` +
                  `*Fast number selection game!*\n\n` +
                  `*How to Play:*\n` +
                  `1. Select bet amount (1-100 ETB)\n` +
                  `2. Pick 1-10 numbers from 1-80\n` +
                  `3. Wait for 20 numbers to be drawn\n` +
                  `4. Match numbers to win!\n\n` +
                  `*Payouts:*\n` +
                  `• 0-2 matches: 0x\n` +
                  `• 3 matches: 0.5x\n` +
                  `• 4 matches: 1x\n` +
                  `• 5 matches: 2x\n` +
                  `• 6 matches: 10x\n` +
                  `• 7 matches: 50x\n` +
                  `• 8 matches: 100x\n` +
                  `• 9 matches: 500x\n` +
                  `• 10 matches: 1000x!\n\n` +
                  `*Same balance as Bingo!*\n` +
                  `Play now:`,
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [[
                {
                  text: '🎰 Play Keno Now',
                  web_app: { url: 'https://bingo-telegram-game.onrender.com/keno' }
                }
              ]]
            }
          })
        });
      }
      else if (text === '/bingo') {
        await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: `🎱 *BINGO ELITE*\n\n` +
                  `*Real-time multiplayer bingo!*\n\n` +
                  `*How to Play:*\n` +
                  `1. Select room (10-100 ETB)\n` +
                  `2. Choose ticket number (1-100)\n` +
                  `3. Wait for game to start\n` +
                  `4. Mark numbers as called\n` +
                  `5. Claim BINGO to win!\n\n` +
                  `*Features:*\n` +
                  `• Four Corners Bonus: 50 ETB!\n` +
                  `• Real-time box tracking\n` +
                  `• Game starts with 1 player\n` +
                  `• 30-second countdown\n\n` +
                  `*Same balance as Keno!*\n` +
                  `Play now:`,
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [[
                {
                  text: '🎱 Play Bingo Now',
                  web_app: { url: 'https://bingo-telegram-game.onrender.com/game' }
                }
              ]]
            }
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
          text: '🎮 Play Games',
          web_app: { url: 'https://bingo-telegram-game.onrender.com/telegram' }
        }
      })
    });
    
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Telegram Bot Setup Complete - Now with Keno!</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 40px; text-align: center; background: #0f172a; color: #f8fafc; }
          .container { max-width: 600px; margin: 0 auto; }
          .success { color: #10b981; font-size: 2rem; margin: 20px 0; }
          .info-box { background: #1e293b; padding: 20px; border-radius: 12px; margin: 20px 0; text-align: left; }
          .btn { display: inline-block; padding: 12px 24px; background: #3b82f6; color: white; text-decoration: none; border-radius: 8px; margin: 10px; font-weight: bold; }
          .btn-keno { background: #8b5cf6; }
          .btn-keno:hover { background: #7c3aed; }
          .telebirr-highlight { background: rgba(59, 130, 246, 0.1); padding: 15px; border-radius: 12px; margin: 20px 0; border: 1px solid rgba(59, 130, 246, 0.3); }
          .telebirr-number { font-size: 1.5rem; font-weight: bold; color: #60a5fa; margin: 10px 0; }
          .fix-highlight { background: rgba(16, 185, 129, 0.1); padding: 15px; border-radius: 12px; margin: 20px 0; border: 1px solid rgba(16, 185, 129, 0.3); }
          .games-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 20px; margin: 30px 0; }
          .game-card { background: rgba(255,255,255,0.05); padding: 20px; border-radius: 15px; text-align: center; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>✅ Telegram Bot Setup Complete - Now with KENO!</h1>
          <div class="success">✓ Webhook Configured</div>
          <div class="success">✓ Menu Button Set</div>
          <div class="success">✓ Keno Game Added</div>
          
          <div class="games-grid">
            <div class="game-card">
              <h3>🎱 BINGO ELITE</h3>
              <p>Real-time multiplayer bingo</p>
              <p>Four Corners Bonus: 50 ETB</p>
              <p>10/20/50/100 ETB rooms</p>
            </div>
            <div class="game-card">
              <h3>🎰 KENO PREMIUM</h3>
              <p>Fast number selection game</p>
              <p>Payouts up to 1000x</p>
              <p>1/5/10/25/50/100 ETB bets</p>
            </div>
          </div>
          
          <div class="telebirr-highlight">
            <h3>📱 TELEBIRR PAYMENT NUMBER (DATABASE PERSISTED)</h3>
            <div class="telebirr-number">${telebirrNumber}</div>
            <p>This number is stored in MongoDB and will survive server restarts.</p>
            <p>Admin can update it in Admin Panel → Settings</p>
          </div>
          
          <div class="fix-highlight">
            <h3>✅ MULTI-GAME PLATFORM READY</h3>
            <p><strong>Key Features:</strong></p>
            <p>1. ✅ TWO GAMES: Bingo & Keno</p>
            <p>2. ✅ SHARED BALANCE: Same wallet for both games</p>
            <p>3. ✅ UNIFIED TRANSACTIONS: All in one system</p>
            <p>4. ✅ DOUBLE PRIZE PROTECTION: For both games</p>
            <p>5. ✅ REAL-TIME UPDATES: Live game status</p>
            <p>6. ✅ TELEGRAM INTEGRATION: Both games work on Telegram</p>
            <p><strong>Players can switch between games seamlessly!</strong></p>
          </div>
          
          <div class="info-box">
            <h3>Bot Information:</h3>
            <p><strong>Bot:</strong> @ethio_games1_bot</p>
            <p><strong>Game URLs:</strong></p>
            <p>- Bingo: https://bingo-telegram-game.onrender.com/game</p>
            <p>- Keno: https://bingo-telegram-game.onrender.com/keno</p>
            <p>- Entry Page: https://bingo-telegram-game.onrender.com/telegram</p>
            <p><strong>Admin Panel:</strong> https://bingo-telegram-game.onrender.com/admin</p>
            <p><strong>Admin Password:</strong> ${gameLogic.CONFIG.ADMIN_PASSWORD}</p>
            <p><strong>New Features Added:</strong></p>
            <p>1. 🎰 <strong>KENO GAME:</strong> Complete number selection game with up to 1000x payouts</p>
            <p>2. 💳 <strong>SHARED WALLET:</strong> Same balance works for both Bingo and Keno</p>
            <p>3. 🔄 <strong>UNIFIED SYSTEM:</strong> Single user account for both games</p>
            <p>4. 📊 <strong>COMBINED STATS:</strong> Track both games in admin panel</p>
            <p>5. 🎮 <strong>TWO GAME INTERFACES:</strong> Separate but connected</p>
            <p><strong>Telebirr Integration:</strong></p>
            <p>• Telebirr Number: ${telebirrNumber} <strong>(DATABASE PERSISTED)</strong></p>
            <p>• Minimum Withdrawal: ${minWithdrawal} ETB</p>
            <p>• Admin approval for all transactions</p>
            <p><strong>Real-time Features:</strong> Box tracking (Bingo), Number draws (Keno)</p>
            <p><strong>Double Game Platform:</strong> Players can enjoy both games with one account!</p>
          </div>
          
          <div>
            <a href="https://t.me/ethio_games1_bot" class="btn" target="_blank">Open Bot in Telegram</a>
            <a href="/admin" class="btn" style="background: #ef4444;" target="_blank">Open Admin Panel</a>
            <a href="/keno" class="btn btn-keno" target="_blank">Test Keno Game</a>
          </div>
          
          <div style="margin-top: 30px; text-align: left;">
            <h4>Next Steps:</h4>
            <ol>
              <li>Open @ethio_games1_bot in Telegram</li>
              <li>Click "Start"</li>
              <li>Click menu button (bottom left)</li>
              <li>Choose between Bingo or Keno</li>
              <li>Play both games with the same wallet!</li>
            </ol>
            
            <h4>To Update Telebirr Number:</h4>
            <ol>
              <li>Open Admin Panel (link above)</li>
              <li>Login with password: ${gameLogic.CONFIG.ADMIN_PASSWORD}</li>
              <li>Go to Settings or look for Telebirr number field</li>
              <li>Update to new number</li>
              <li>Number is saved to database and persists across restarts</li>
            </ol>
            
            <h4>Wallet Instructions for Players:</h4>
            <ol>
              <li>Send money to Telebirr: ${telebirrNumber} (persists in database)</li>
              <li>In either game, click Wallet (💰 button)</li>
              <li>Enter receipt number and amount</li>
              <li>Admin approves in Admin Panel</li>
              <li>Funds appear in player balance - works for BOTH games!</li>
            </ol>
            
            <h4>Multi-Game Platform Benefits:</h4>
            <ol>
              <li><strong>Player Retention:</strong> Players can switch between games when bored</li>
              <li><strong>Increased Engagement:</strong> Two different game experiences</li>
              <li><strong>Higher Revenue:</strong> More game options = more play time</li>
              <li><strong>Competitive Advantage:</strong> Fewer Telegram games offer multiple games</li>
              <li><strong>Shared Economy:</strong> One wallet simplifies everything</li>
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

// Health check endpoint
app.get('/health', async (req, res) => {
  try {
    const connectedPlayers = gameLogic.getConnectedUsers ? gameLogic.getConnectedUsers().length : 0;
    const activeGames = await Room.countDocuments({ status: 'playing', gameType: 'bingo' });
    const totalUsers = await User.countDocuments();
    const rooms = await Room.countDocuments();
    const totalTransactions = await Transaction.countDocuments();
    const pendingDeposits = await Transaction.countDocuments({ type: 'DEPOSIT_REQUEST', status: 'pending' });
    const pendingWithdrawals = await Transaction.countDocuments({ type: 'WITHDRAW_REQUEST', status: 'pending' });
    const telebirrNumber = await getTelebirrNumber();
    const processingClaims = gameLogic.getProcessingClaims ? gameLogic.getProcessingClaims().size : 0;
    const roomWinners = gameLogic.getRoomWinners ? gameLogic.getRoomWinners().size : 0;
    
    // Keno stats
    const kenoRooms = kenoLogic.getKenoRooms ? kenoLogic.getKenoRooms().size : 0;
    const kenoBets = kenoLogic.getKenoBets ? kenoLogic.getKenoBets().size : 0;
    const kenoHistory = kenoLogic.getKenoGameHistory ? kenoLogic.getKenoGameHistory().length : 0;
    
    res.json({
      status: 'ok',
      database: 'connected',
      connectedPlayers: connectedPlayers,
      totalUsers: totalUsers,
      activeGames: {
        bingo: activeGames,
        keno: kenoRooms
      },
      totalRooms: rooms,
      totalTransactions: totalTransactions,
      pendingDeposits: pendingDeposits,
      pendingWithdrawals: pendingWithdrawals,
      telebirrNumber: telebirrNumber,
      telebirrPersisted: true,
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      telegramReady: true,
      botUsername: '@ethio_games1_bot',
      realTimeBoxUpdates: 'active',
      walletSystem: 'active',
      multiGamePlatform: true,
      gamesAvailable: ['bingo', 'keno'],
      doublePrizeProtection: {
        enabled: true,
        processingClaims: processingClaims,
        roomWinners: roomWinners,
        layers: [
          'room_winner_tracking',
          'processing_locks',
          'atomic_updates',
          'database_checks',
          'auto_cleanup'
        ]
      },
      kenoStats: {
        rooms: kenoRooms,
        activeBets: kenoBets,
        totalGames: kenoHistory,
        status: 'running'
      }
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
    const roomWinners = gameLogic.getRoomWinners ? gameLogic.getRoomWinners().size : 0;
    
    // Keno debug
    const kenoRooms = kenoLogic.getKenoRooms ? kenoLogic.getKenoRooms().size : 0;
    const kenoBets = kenoLogic.getKenoBets ? kenoLogic.getKenoBets().size : 0;
    
    res.json({
      connectedSockets: connectedSockets,
      socketToUser: socketToUser,
      adminSockets: adminSockets,
      processingClaims: processingClaims,
      roomWinners: roomWinners,
      kenoRooms: kenoRooms,
      kenoBets: kenoBets,
      serverTime: new Date().toISOString(),
      doublePrizeProtection: {
        processingClaims: Array.from(gameLogic.getProcessingClaims ? gameLogic.getProcessingClaims().entries() : []),
        roomWinners: Array.from(gameLogic.getRoomWinners ? gameLogic.getRoomWinners().entries() : [])
      }
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
        preferredGame: u.preferredGame,
        totalBingos: u.totalBingos,
        totalKenoWins: u.totalKenoWins
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
      gameLogicNumber: gameLogic.getTelebirrNumber ? gameLogic.getTelebirrNumber() : 'N/A',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Debug Keno endpoint
app.get('/debug/keno', (req, res) => {
  try {
    const kenoRooms = kenoLogic.getKenoRooms ? kenoLogic.getKenoRooms() : new Map();
    const kenoBets = kenoLogic.getKenoBets ? kenoLogic.getKenoBets() : new Map();
    const kenoHistory = kenoLogic.getKenoGameHistory ? kenoLogic.getKenoGameHistory() : [];
    
    res.json({
      rooms: Array.from(kenoRooms.entries()).map(([stake, room]) => ({
        stake: stake,
        players: Array.from(room.players),
        playersCount: room.players.size,
        status: room.status,
        roundNumber: room.roundNumber,
        countdown: room.countdown,
        drawnNumbers: room.drawnNumbers,
        currentDraw: room.currentDraw,
        totalPrizePool: room.totalPrizePool,
        houseEarnings: room.houseEarnings,
        winners: room.winners
      })),
      bets: Array.from(kenoBets.entries()).slice(0, 10),
      recentHistory: kenoHistory.slice(0, 5),
      totalBets: kenoBets.size,
      totalRooms: kenoRooms.size,
      timestamp: new Date().toISOString()
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
╔══════════════════════════════════════════════════════════════════════════════╗
║             🤖 BINGO ELITE & KENO - MULTI-GAME PLATFORM                     ║
╠══════════════════════════════════════════════════════════════════════════════╣
║  URL:          https://bingo-telegram-game.onrender.com                     ║
║  Port:         ${PORT}                                                      ║
║  Bingo:        /game                                                        ║
║  Keno:         /keno                                                        ║
║  Admin:        /admin (password: ${gameLogic.CONFIG.ADMIN_PASSWORD})                 ║
║  Telegram:     /telegram                                                    ║
║  Bot Setup:    /setup-telegram                                              ║
╠══════════════════════════════════════════════════════════════════════════════╣
║  🔑 Admin Password: ${gameLogic.CONFIG.ADMIN_PASSWORD}                       ║
║  🤖 Telegram Bot: @ethio_games1_bot                                         ║
║  📡 WebSocket: ✅ Ready for Telegram connections                            ║
║  🎮 Two Games: Bingo & Keno                                                 ║
║  💰 Shared Wallet: ✅ ONE balance for BOTH games                            ║
║  🎱 Bingo Features: Four Corners Bonus, Real-time box tracking              ║
║  🎰 Keno Features: Up to 1000x payouts, Fast number draws                   ║
║  📱 TELEBIRR: ${telebirrNumber}                                             ║
║  💾 TELEBIRR PERSISTENCE: ✅ DATABASE SAVED                                ║
║  🔄 Will survive server restarts                                            ║
╠══════════════════════════════════════════════════════════════════════════════╣
║  🔒 DOUBLE PRIZE PROTECTION: ✅ FOR BOTH GAMES                             ║
║  ✅ Room winner tracking                                                    ║
║  ✅ Processing locks per user per room                                      ║
║  ✅ Atomic room status updates                                              ║
║  ✅ Database transaction checks                                             ║
║  ✅ Auto-cleanup of stale locks                                            ║
║  ✅ Enhanced error handling                                                 ║
╚══════════════════════════════════════════════════════════════════════════════╝
✅ Multi-game platform ready with database-persisted Telebirr number
📱 Telebirr number loaded from database: ${telebirrNumber}
🎮 TWO GAMES AVAILABLE: Bingo Elite & Keno Premium
💰 SHARED WALLET: Players use the same balance for both games
🔒 Double prize protection: ACTIVE for both games
  `);
});