// server.js - BINGO ELITE - TELEGRAM MINI APP - FIXED CLAIM & MANUAL MARKING
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

// ========== GLOBAL STATE ==========
let socketToUser = new Map();
let adminSockets = new Set();
let activityLog = [];
let roomTimers = new Map();
let connectedSockets = new Set();
let roomSubscriptions = new Map();

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
}

function cleanupRoomTimer(stake) {
  if (roomTimers.has(stake)) {
    clearInterval(roomTimers.get(stake));
    roomTimers.delete(stake);
    console.log(`🧹 Cleaned up timer for room ${stake}`);
  }
}

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
      
      roomStatus[room.stake] = {
        stake: room.stake,
        playerCount: onlinePlayers.length, 
        totalPlayers: room.players.length,
        status: room.status,
        takenBoxes: room.takenBoxes.length,
        potentialPrize: potentialPrize,
        potentialPrizeWithBonus: potentialPrizeWithBonus
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
      }
      else if (user.lastSeen) {
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
        isOnline: isOnline
      };
    });
    
    const houseBalance = await Transaction.aggregate([
      { $match: { type: { $in: ['HOUSE_EARNINGS', 'ADMIN_ADD'] } } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]).then(result => result[0]?.total || 0);
    
    const adminData = {
      totalPlayers: connectedPlayers,
      activeGames: activeGames,
      totalUsers: users.length,
      connectedSockets: connectedSockets.size,
      houseBalance: houseBalance,
      timestamp: new Date().toISOString()
    };
    
    adminSockets.forEach(socketId => {
      const socket = io.sockets.sockets.get(socketId);
      if (socket) {
        socket.emit('admin:update', adminData);
        socket.emit('admin:players', userArray);
      }
    });
    
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
  if (activityLog.length > 200) activityLog = activityLog.slice(0, 200);
  
  adminSockets.forEach(socketId => {
    const socket = io.sockets.sockets.get(socketId);
    if (socket) socket.emit('admin:activity', activity);
  });
}

// ========== GAME TIMER FUNCTION ==========
async function startGameTimer(room) {
  console.log(`🎲 STARTING GAME TIMER for room ${room.stake}`);
  cleanupRoomTimer(room.stake);
  
  room.calledNumbers = [];
  room.currentBall = null;
  room.ballsDrawn = 0;
  room.startTime = new Date();
  await room.save();
  
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
      
      console.log(`🎱 Drawing ball ${letter}-${ball} for room ${room.stake}`);
      
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
      
      broadcastRoomStatus();
      
    } catch (error) {
      console.error('❌ Error in game timer:', error);
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
    [0,1,2,3,4], [5,6,7,8,9], [10,11,12,13,14], [15,16,17,18,19], [20,21,22,23,24],
    // Columns
    [0,5,10,15,20], [1,6,11,16,21], [2,7,12,17,22], [3,8,13,18,23], [4,9,14,19,24],
    // Diagonals
    [0,6,12,18,24], [4,8,12,16,20],
    // Four corners
    [0,4,20,24]
  ];
  
  for (const pattern of patterns) {
    const isBingo = pattern.every(index => {
      const cellValue = grid[index];
      // Note: 'markedNumbers' here should already be validated against actual calls
      return markedNumbers.includes(cellValue) || cellValue === 'FREE';
    });
    
    if (isBingo) {
      return {
        isBingo: true,
        pattern: pattern,
        isFourCorners: pattern.length === 4 && pattern[0] === 0 && pattern[1] === 4
      };
    }
  }
  
  return { isBingo: false };
}

async function endGameWithNoWinner(room) {
  try {
    cleanupRoomTimer(room.stake);
    const playersInRoom = [...room.players];
    
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
                reason: 'no_winner'
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
    await room.save();
    
    broadcastTakenBoxes(room.stake, []);
    io.emit('boxesCleared', { room: room.stake, reason: 'game_ended_no_winner' });
    broadcastRoomStatus();
    updateAdminPanel();
    
  } catch (error) {
    console.error('❌ Error ending game with no winner:', error);
  }
}

// ========== COUNTDOWN FUNCTION ==========
async function startCountdownForRoom(room) {
  try {
    console.log(`⏱️ STARTING COUNTDOWN for room ${room.stake}`);
    
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
          clearInterval(countdownInterval);
          roomTimers.delete(countdownKey);
          return;
        }
        
        const onlinePlayers = await getOnlinePlayersInRoom(room.stake);
        
        currentRoom.players.forEach(userId => {
          for (const [socketId, uId] of socketToUser.entries()) {
            if (uId === userId) {
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
            }
          }
        });
        
        countdown--;
        
        if (countdown < 0) {
          clearInterval(countdownInterval);
          roomTimers.delete(countdownKey);
          
          const finalOnlinePlayers = await getOnlinePlayersInRoom(room.stake);
          
          // AUTO START: If players remain, start the game
          if (finalOnlinePlayers.length >= 1) {
            console.log(`🎮 Starting game for room ${room.stake}`);
            
            currentRoom.status = 'playing';
            currentRoom.startTime = new Date();
            currentRoom.countdownStartTime = null;
            await currentRoom.save();
            
            currentRoom.players.forEach(userId => {
              for (const [socketId, uId] of socketToUser.entries()) {
                if (uId === userId) {
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
                }
              }
            });
            
            await startGameTimer(currentRoom);
            broadcastRoomStatus();
          } else {
            console.log(`⚠️ Game start aborted for room ${room.stake}: no online players`);
            currentRoom.status = 'waiting';
            currentRoom.countdownStartTime = null;
            await currentRoom.save();
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
    
  } catch (error) {
    console.error('❌ Error starting countdown:', error);
  }
}

// ========== SOCKET.IO EVENT HANDLERS ==========
io.on('connection', (socket) => {
  connectedSockets.add(socket.id);
  const query = socket.handshake.query;
  if (query.userId) {
    socket.userId = query.userId;
  }
  
  socket.emit('connectionTest', { 
    status: 'connected', 
    server: 'Bingo Elite Telegram',
    userId: query.userId || 'unknown'
  });
  
  // Auth
  socket.on('admin:auth', (password) => {
    if (password === CONFIG.ADMIN_PASSWORD) {
      adminSockets.add(socket.id);
      socket.emit('admin:authSuccess');
      updateAdminPanel();
    }
  });

  // Admin: Force End Game (Backend tool)
  socket.on('admin:forceEndGame', async (roomStake) => {
      if (!adminSockets.has(socket.id)) return;
      
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
              description: `Game force ended by admin`
            });
            await transaction.save();
            
            for (const [sId, uId] of socketToUser.entries()) {
              if (uId === userId) {
                const s = io.sockets.sockets.get(sId);
                if (s) {
                  s.emit('gameOver', {
                    room: roomStake,
                    winnerId: 'ADMIN',
                    reason: 'admin_ended'
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
        await room.save();
        
        broadcastTakenBoxes(roomStake, []);
        socket.emit('admin:success', `Force ended ${roomStake} ETB game`);
        broadcastRoomStatus();
      }
  });
  
  // User Init
  socket.on('init', async (data, callback) => {
    try {
      const { userId, userName } = data;
      socket.userId = userId;
      const user = await getUser(userId, userName);
      
      if (user) {
        socketToUser.set(socket.id, userId);
        await User.findOneAndUpdate(
          { userId: userId },
          { isOnline: true, lastSeen: new Date(), sessionCount: (user.sessionCount || 0) + 1 }
        );
        
        socket.emit('balanceUpdate', user.balance);
        socket.emit('userData', {
          userId: userId,
          userName: user.userName,
          balance: user.balance,
          referralCode: user.referralCode
        });
        
        if (callback) callback({ success: true, message: 'User initialized successfully' });
        updateAdminPanel();
      }
    } catch (error) {
      console.error('Error in init:', error);
    }
  });
  
  socket.on('getTakenBoxes', async ({ room }, callback) => {
    try {
      const roomData = await Room.findOne({ stake: parseInt(room) });
      if (roomData) callback(roomData.takenBoxes || []);
      else callback([]);
    } catch (error) {
      callback([]);
    }
  });
  
  socket.on('subscribeToRoom', (data) => {
    const userId = socketToUser.get(socket.id) || socket.userId;
    if (userId && data.room) {
      if (!roomSubscriptions.has(data.room)) roomSubscriptions.set(data.room, new Set());
      roomSubscriptions.get(data.room).add(socket.id);
      
      Room.findOne({ stake: data.room }).then(room => {
        if (room) {
          socket.emit('boxesTakenUpdate', {
            room: data.room,
            takenBoxes: room.takenBoxes || []
          });
        }
      });
    }
  });
  
  socket.on('unsubscribeFromRoom', (data) => {
    if (roomSubscriptions.has(data.room)) {
      roomSubscriptions.get(data.room).delete(socket.id);
    }
  });
  
  // AUTO START LOGIC IS HERE
  socket.on('joinRoom', async (data, callback) => {
    try {
      const { room, box, userName } = data;
      const userId = socketToUser.get(socket.id) || socket.userId;
      
      if (!userId) return;
      const user = await User.findOne({ userId: userId });
      if (!user || user.balance < room) {
        socket.emit('insufficientFunds');
        return;
      }
      
      let roomData = await Room.findOne({ stake: room, status: { $in: ['waiting', 'starting', 'playing'] } });
      if (!roomData) {
        roomData = new Room({ stake: room, players: [], takenBoxes: [], status: 'waiting' });
        await roomData.save();
      }
      
      if (roomData.takenBoxes.includes(box)) {
        socket.emit('boxTaken');
        return;
      }
      if (user.currentRoom && user.currentRoom !== room) {
        socket.emit('error', 'Already in a different room');
        return;
      }
      
      user.balance -= room;
      user.currentRoom = room;
      user.box = box;
      await user.save();
      
      const transaction = new Transaction({
        type: 'STAKE',
        userId: user.userId,
        userName: user.userName,
        amount: -room,
        room: room,
        description: `Joined ${room} ETB room`
      });
      await transaction.save();
      
      roomData.players.push(user.userId);
      roomData.takenBoxes.push(box);
      roomData.lastBoxUpdate = new Date();
      
      const onlinePlayers = await getOnlinePlayersInRoom(room);
      broadcastTakenBoxes(room, roomData.takenBoxes, box, user.userName);
      await roomData.save();
      
      socket.emit('joinedRoom');
      socket.emit('balanceUpdate', user.balance);
      
      roomData.players.forEach(playerUserId => {
        for (const [sId, uId] of socketToUser.entries()) {
          if (uId === playerUserId) {
            const s = io.sockets.sockets.get(sId);
            if (s) s.emit('lobbyUpdate', { room: room, count: onlinePlayers.length });
          }
        }
      });
      
      // AUTO START TRIGGER
      if (onlinePlayers.length >= CONFIG.MIN_PLAYERS_TO_START && roomData.status === 'waiting') {
        console.log(`🚀 AUTO-STARTING COUNTDOWN for room ${room}`);
        await startCountdownForRoom(roomData);
      }
      
      broadcastRoomStatus();
      
    } catch (error) {
      console.error('Error joining room:', error);
    }
  });
  
  // 1. FIXED CLAIM BINGO LOGIC
  socket.on('claimBingo', async (data) => {
    try {
      const { room, grid, marked } = data;
      const userId = socketToUser.get(socket.id) || socket.userId;
      
      if (!userId) return;
      const user = await User.findOne({ userId: userId });
      
      const roomData = await Room.findOne({ stake: parseInt(room), status: 'playing' });
      if (!roomData || !roomData.players.includes(userId)) return;
      
      // --- CRITICAL FIX START ---
      // Validation: Ensure the 'marked' numbers sent by the client were actually called in this game
      const validMarked = marked.filter(num => 
        num === 'FREE' || roomData.calledNumbers.includes(parseInt(num))
      );
      
      // Use the validated list for the bingo check
      const bingoCheck = checkBingo(validMarked, grid);
      // --- CRITICAL FIX END ---

      if (!bingoCheck.isBingo) {
        socket.emit('error', 'Invalid bingo claim');
        return;
      }
      
      const isFourCornersWin = bingoCheck.isFourCorners;
      const commissionPerPlayer = CONFIG.HOUSE_COMMISSION[room] || 0;
      const contributionPerPlayer = room - commissionPerPlayer;
      const basePrize = contributionPerPlayer * roomData.players.length;
      let bonus = isFourCornersWin ? CONFIG.FOUR_CORNERS_BONUS : 0;
      const totalPrize = basePrize + bonus;
      
      user.balance += totalPrize;
      user.totalWins += 1;
      user.currentRoom = null;
      user.box = null;
      await user.save();
      
      const transaction = new Transaction({
        type: isFourCornersWin ? 'WIN_FOUR_CORNERS' : 'WIN',
        userId: userId,
        userName: user.userName,
        amount: totalPrize,
        room: room,
        description: `Bingo win in ${room} ETB room`
      });
      await transaction.save();
      
      const playersInRoom = [...roomData.players];
      cleanupRoomTimer(room);
      
      roomData.status = 'ended';
      roomData.endTime = new Date();
      
      // Notify everyone
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
              s.emit('gameOver', {
                room: room,
                winnerId: userId,
                winnerName: user.userName,
                prize: totalPrize,
                basePrize: basePrize,
                bonus: bonus,
                isFourCornersWin: isFourCornersWin,
                playersCount: playersInRoom.length
              });
              if (uId === userId) s.emit('balanceUpdate', user.balance);
            }
          }
        }
      }
      
      roomData.players = [];
      roomData.takenBoxes = [];
      roomData.status = 'waiting';
      roomData.calledNumbers = [];
      roomData.ballsDrawn = 0;
      roomData.startTime = null;
      await roomData.save();
      
      broadcastTakenBoxes(room, []);
      io.emit('boxesCleared', { room: room, reason: 'game_ended_bingo_win' });
      broadcastRoomStatus();
      
    } catch (error) {
      console.error('Error in claimBingo:', error);
    }
  });
  
  socket.on('player:leaveRoom', async (data) => {
    try {
      const userId = socketToUser.get(socket.id) || socket.userId;
      if (!userId) return;
      
      const user = await User.findOne({ userId: userId });
      if (!user || !user.currentRoom) {
        socket.emit('leftRoom', { message: 'Not in a room' });
        return;
      }
      
      const roomStake = user.currentRoom;
      const room = await Room.findOne({ stake: roomStake });
      
      if (!room || room.status === 'playing') {
        socket.emit('error', 'Cannot leave room during active game!');
        return;
      }
      
      const playerIndex = room.players.indexOf(userId);
      const boxIndex = room.takenBoxes.indexOf(user.box);
      
      if (playerIndex > -1) room.players.splice(playerIndex, 1);
      if (boxIndex > -1) room.takenBoxes.splice(boxIndex, 1);
      
      await room.save();
      
      user.currentRoom = null;
      user.box = null;
      user.balance += roomStake; // Refund
      await user.save();
      
      const transaction = new Transaction({
        type: 'REFUND',
        userId: userId,
        userName: user.userName,
        amount: roomStake,
        room: roomStake,
        description: `Left room before game start`
      });
      await transaction.save();
      
      broadcastTakenBoxes(roomStake, room.takenBoxes);
      socket.emit('leftRoom', { message: 'Left room successfully' });
      socket.emit('balanceUpdate', user.balance);
      
      const onlinePlayers = await getOnlinePlayersInRoom(roomStake);
      onlinePlayers.forEach(playerUserId => {
        for (const [sId, uId] of socketToUser.entries()) {
          if (uId === playerUserId) {
            const s = io.sockets.sockets.get(sId);
            if (s) s.emit('lobbyUpdate', { room: roomStake, count: onlinePlayers.length });
          }
        }
      });
      
      broadcastRoomStatus();
      
    } catch (error) {
      console.error('Error leaving room:', error);
    }
  });
  
  socket.on('player:activity', async () => {
    const userId = socketToUser.get(socket.id) || socket.userId;
    if (userId) {
      await User.findOneAndUpdate({ userId: userId }, { lastSeen: new Date() });
    }
  });
  
  socket.on('disconnect', async () => {
    connectedSockets.delete(socket.id);
    adminSockets.delete(socket.id);
    roomSubscriptions.forEach((sockets) => sockets.delete(socket.id));
    
    const userId = socketToUser.get(socket.id) || socket.userId;
    if (userId) {
      try {
        const user = await User.findOne({ userId: userId });
        if (user && user.currentRoom) {
          const room = await Room.findOne({ stake: user.currentRoom });
          if (room && room.status !== 'playing') {
             // Remove user from room if game not playing
             const idx = room.players.indexOf(userId);
             if (idx > -1) room.players.splice(idx, 1);
             const bIdx = room.takenBoxes.indexOf(user.box);
             if (bIdx > -1) room.takenBoxes.splice(bIdx, 1);
             await room.save();
             broadcastTakenBoxes(user.currentRoom, room.takenBoxes);
          }
          user.isOnline = false;
          await user.save();
        }
      } catch (e) { console.error(e); }
      socketToUser.delete(socket.id);
    }
    setTimeout(() => { updateAdminPanel(); broadcastRoomStatus(); }, 1000);
  });
  
  socket.on('ping', () => socket.emit('pong', { time: Date.now() }));
});

// Periodic Tasks
setInterval(broadcastRoomStatus, CONFIG.ROOM_STATUS_UPDATE_INTERVAL);
setInterval(updateAdminPanel, 2000);

// Routes
app.get('/', (req, res) => res.send('Bingo Elite Server Running'));
app.get('/game', (req, res) => res.sendFile(path.join(__dirname, 'game.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Bingo Elite Server running on port ${PORT}`);
});
