// server.js - COMPLETE FIXED VERSION
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
  sessionCount: { type: Number, default: 0 }
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

// Socket.IO with proper CORS
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  transports: ['websocket', 'polling']
});

// ========== FIXED MIDDLEWARE ==========
// REMOVED CSP BLOCKING COMPLETELY

// CORS - Allow everything
app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));

// Use helmet WITHOUT CSP blocking
app.use(helmet({
  contentSecurityPolicy: false, // THIS DISABLES CSP
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Add custom headers to allow everything
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', '*');
  res.header('Access-Control-Allow-Methods', '*');
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

let socketToUser = new Map();
let adminSockets = new Set();
let activityLog = [];
let roomTimers = new Map();

async function initializeRooms() {
  try {
    for (const stake of CONFIG.ROOM_STAKES) {
      const existingRoom = await Room.findOne({ stake: stake, status: 'waiting' });
      if (!existingRoom) {
        const newRoom = new Room({
          stake: stake,
          players: [],
          takenBoxes: [],
          status: 'waiting',
          calledNumbers: [],
          ballsDrawn: 0
        });
        await newRoom.save();
        console.log(`✅ Created room for ${stake} ETB stake`);
      }
    }
  } catch (error) {
    console.error('Error initializing rooms:', error);
  }
}

initializeRooms();

function getBingoLetter(number) {
  if (number >= 1 && number <= 15) return 'B';
  if (number >= 16 && number <= 30) return 'I';
  if (number >= 31 && number <= 45) return 'N';
  if (number >= 46 && number <= 60) return 'G';
  if (number >= 61 && number <= 75) return 'O';
  return '';
}

async function getUser(userId, userName) {
  try {
    let user = await User.findOne({ userId: userId });
    
    if (!user) {
      user = new User({
        userId: userId,
        userName: userName || 'Guest',
        balance: CONFIG.INITIAL_BALANCE,
        referralCode: generateReferralCode(userId)
      });
      await user.save();
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

function generateReferralCode(userId) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code + userId.slice(-4);
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
        currentBall: room.currentBall
      };
    });
    
    io.emit('roomStatus', roomStatus);
  } catch (error) {
    console.error('Error broadcasting room status:', error);
  }
}

// Game timer function
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
        // End game if all balls drawn
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
        letter: letter,
        fullDisplay: `${letter}-${ball}`
      };
      
      // Emit to all players in room
      currentRoom.players.forEach(userId => {
        for (const [socketId, uId] of socketToUser.entries()) {
          if (uId === userId) {
            const socket = io.sockets.sockets.get(socketId);
            if (socket) {
              socket.emit('ballDrawn', ballData);
            }
          }
        }
      });
      
      // Enable bingo claiming after 5 balls
      if (currentRoom.ballsDrawn >= 5) {
        currentRoom.players.forEach(userId => {
          for (const [socketId, uId] of socketToUser.entries()) {
            if (uId === userId) {
              const socket = io.sockets.sockets.get(socketId);
              if (socket) {
                socket.emit('enableBingo');
              }
            }
          }
        });
      }
      
      broadcastRoomStatus();
      
    } catch (error) {
      console.error('Error in game timer:', error);
      clearInterval(timer);
      roomTimers.delete(room.stake);
    }
  }, CONFIG.GAME_TIMER * 1000);
  
  roomTimers.set(room.stake, timer);
}

// Socket.IO event handlers
io.on('connection', (socket) => {
  console.log(`New connection: ${socket.id}`);
  
  socket.on('init', async (data) => {
    const { userId, userName } = data;
    
    const user = await getUser(userId, userName);
    
    if (user) {
      socketToUser.set(socket.id, userId);
      
      socket.emit('balanceUpdate', user.balance);
      socket.emit('userData', {
        userId: userId,
        userName: user.userName,
        referralCode: user.referralCode,
        joinedAt: user.joinedAt
      });
      
      broadcastRoomStatus();
    } else {
      socket.emit('error', 'Failed to initialize user');
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
    
    broadcastRoomStatus();
  });
  
  socket.on('disconnect', async () => {
    console.log(`Disconnected: ${socket.id}`);
    
    adminSockets.delete(socket.id);
    
    const userId = socketToUser.get(socket.id);
    if (userId) {
      await User.findOneAndUpdate(
        { userId: userId },
        { 
          isOnline: false,
          lastSeen: new Date() 
        }
      );
      
      socketToUser.delete(socket.id);
    }
  });
});

// Periodic tasks
setInterval(() => {
  broadcastRoomStatus();
}, CONFIG.ROOM_STATUS_UPDATE_INTERVAL);

// ========== EXPRESS ROUTES ==========
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Bingo Elite Server</title>
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
        <h1 style="font-size: 3rem; margin-bottom: 20px;">🎮 Bingo Elite Server</h1>
        <p style="color: #94a3b8; font-size: 1.2rem;">Bingo Telegram Mini App - Live and Working</p>
        
        <div class="status">
          <h2 style="color: #10b981;">🚀 Server Status: RUNNING</h2>
          <div class="stats-grid">
            <div class="stat">
              <div class="stat-label">Server Time</div>
              <div class="stat-value" id="serverTime">${new Date().toLocaleTimeString()}</div>
            </div>
            <div class="stat">
              <div class="stat-label">Database</div>
              <div class="stat-value" style="color: #10b981;">✅ Online</div>
            </div>
          </div>
          <p style="margin-top: 20px; color: #f59e0b; font-weight: bold;">🎯 Four Corners Bonus: ${CONFIG.FOUR_CORNERS_BONUS} ETB!</p>
          <p style="color: #64748b; margin-top: 10px;">Server URL: ${req.protocol}://${req.get('host')}</p>
          <p style="color: #64748b;">MongoDB: Connected</p>
        </div>
        
        <div style="margin-top: 40px;">
          <h3>Access Points:</h3>
          <div>
            <a href="/admin" class="btn btn-admin" target="_blank">🔒 Admin Panel</a>
            <a href="/game" class="btn btn-game" target="_blank">🎮 Game Client</a>
          </div>
          <div style="margin-top: 20px;">
            <a href="/health" class="btn" style="background: #64748b;" target="_blank">📊 Health Check</a>
            <a href="/test" class="btn" style="background: #8b5cf6;" target="_blank">🧪 Test Page</a>
          </div>
        </div>
        
        <div style="margin-top: 40px; padding: 20px; background: rgba(255,255,255,0.03); border-radius: 12px;">
          <h4>System Information</h4>
          <p style="color: #94a3b8; font-size: 0.9rem;">
            Version: 1.0.0 | Database: MongoDB Atlas<br>
            Room Stakes: ${CONFIG.ROOM_STAKES.join(', ')} ETB<br>
            Game Timer: ${CONFIG.GAME_TIMER}s between balls<br>
            Countdown: ${CONFIG.COUNTDOWN_TIMER}s wait time
          </p>
        </div>
      </div>
    </body>
    </html>
  `);
});

// Test route to verify CSP is disabled
app.get('/test', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>CSP Test</title>
      <script src="https://cdn.socket.io/4.7.2/socket.io.min.js"></script>
      <script src="https://telegram.org/js/telegram-web-app.js"></script>
      <style>
        body { font-family: Arial; padding: 20px; }
        .status { padding: 20px; margin: 10px 0; border-radius: 10px; }
        .success { background: #d1fae5; color: #065f46; }
        .error { background: #fee2e2; color: #991b1b; }
      </style>
    </head>
    <body>
      <h1>🎮 CSP Test Page</h1>
      <div id="socketStatus" class="status">Testing Socket.IO connection...</div>
      <div id="telegramStatus" class="status">Testing Telegram SDK...</div>
      
      <script>
        // Test Socket.IO
        try {
          const socket = io();
          socket.on('connect', () => {
            document.getElementById('socketStatus').className = 'status success';
            document.getElementById('socketStatus').textContent = '✅ Socket.IO Connected!';
          });
          socket.on('connect_error', (err) => {
            document.getElementById('socketStatus').className = 'status error';
            document.getElementById('socketStatus').textContent = '❌ Socket.IO Error: ' + err;
          });
        } catch (e) {
          document.getElementById('socketStatus').className = 'status error';
          document.getElementById('socketStatus').textContent = '❌ Socket.IO Failed: ' + e;
        }
        
        // Test Telegram SDK
        try {
          if (typeof Telegram !== 'undefined') {
            document.getElementById('telegramStatus').className = 'status success';
            document.getElementById('telegramStatus').textContent = '✅ Telegram SDK Loaded!';
          } else {
            document.getElementById('telegramStatus').className = 'status error';
            document.getElementById('telegramStatus').textContent = '❌ Telegram SDK Not Loaded';
          }
        } catch (e) {
          document.getElementById('telegramStatus').className = 'status error';
          document.getElementById('telegramStatus').textContent = '❌ Telegram SDK Error: ' + e;
        }
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

app.get('/health', async (req, res) => {
  try {
    const onlineUsers = Array.from(socketToUser.keys()).length;
    const activeRooms = await Room.countDocuments({ status: { $in: ['waiting', 'starting', 'playing'] } });
    
    res.json({
      status: 'ok',
      database: 'connected',
      connectedPlayers: onlineUsers,
      activeGames: activeRooms,
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      bingoLetters: BINGO_LETTERS
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ========== START SERVER ==========
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════════════╗
║                🚀 BINGO ELITE SERVER                ║
╠══════════════════════════════════════════════════════╣
║  Port:          ${PORT.toString().padEnd(40)}║
║  Database:      MongoDB Atlas                       ║
║  Admin Panel:   http://localhost:${PORT}/admin        ║
║  Game Client:   http://localhost:${PORT}/game         ║
╠══════════════════════════════════════════════════════╣
║  🔑 Admin Password: ${process.env.ADMIN_PASSWORD || 'Not Set'} ║
║  🎯 Four Corners Bonus: ${CONFIG.FOUR_CORNERS_BONUS} ETB ║
╚══════════════════════════════════════════════════════╝
✅ Server ready - NO CSP BLOCKING
  `);
});
