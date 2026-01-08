// server.js - BINGO ELITE - TELEGRAM MINI APP - WITH GAME IMAGES
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
  countdownStartedWith: { type: Number, default: 0 } // NEW: Track how many players started countdown
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
  MIN_PLAYERS_TO_START: 1, // ⭐⭐ CHANGED FROM 2 TO 1
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
  
  // Broadcast to all connected sockets
  io.emit('boxesTakenUpdate', updateData);
  
  // Also update all admin panels
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
      
      // Record first transaction
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

// ========== FIXED: getConnectedUsers - PROPERLY TRACKS ALL CONNECTED USERS ==========
function getConnectedUsers() {
  const connectedUsers = new Set();
  
  // Get from socketToUser map (direct WebSocket connections that sent 'init')
  socketToUser.forEach((userId, socketId) => {
    const socket = io.sockets.sockets.get(socketId);
    if (socket && socket.connected) {
      connectedUsers.add(userId);
    }
  });
  
  // Also check ALL connected sockets for users who connected but haven't sent 'init' yet
  io.sockets.sockets.forEach((socket) => {
    if (socket && socket.connected && socket.userId && socket.userId !== 'pending') {
      // Check if socket has a userId property (set on connection via query)
      connectedUsers.add(socket.userId);
    }
  });
  
  return Array.from(connectedUsers);
}

// ⭐⭐ FIXED: Function to get online players in a specific room
async function getOnlinePlayersInRoom(roomStake) {
  try {
    const room = await Room.findOne({ stake: roomStake });
    if (!room) return [];
    
    const onlinePlayers = [];
    const connectedUserIds = getConnectedUsers();
    
    console.log(`🔍 Checking online players for room ${roomStake}:`);
    console.log(`   Total players in room: ${room.players.length}`);
    console.log(`   Connected users: ${connectedUserIds.length}`);
    
    // Check each player in the room
    for (const playerId of room.players) {
      // Check if player is in connected users
      if (connectedUserIds.includes(playerId)) {
        onlinePlayers.push(playerId);
        console.log(`   ✅ ${playerId} is ONLINE`);
      } else {
        console.log(`   ❌ ${playerId} is OFFLINE`);
      }
    }
    
    console.log(`   Online players found: ${onlinePlayers.length}`);
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
        playerCount: onlinePlayers.length, // Use online players count
        totalPlayers: room.players.length, // Total players (including offline)
        status: room.status,
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
        currentBall: room.currentBall,
        ballsDrawn: room.ballsDrawn,
        commissionPerPlayer: commissionPerPlayer,
        contributionPerPlayer: contributionPerPlayer,
        potentialPrize: potentialPrize,
        houseFee: houseFee,
        players: room.players, // Include player IDs
        onlinePlayers: onlinePlayers // Online player IDs
      };
    }
    
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

// ========== ⭐⭐ FIXED GAME TIMER FUNCTION - NOW WORKING ⭐⭐ ==========
async function startGameTimer(room) {
  console.log(`🎲 STARTING GAME TIMER for room ${room.stake} with ${room.players.length} players`);
  
  // Clear any existing timer first
  cleanupRoomTimer(room.stake);
  
  // Reset called numbers
  room.calledNumbers = [];
  room.currentBall = null;
  room.ballsDrawn = 0;
  room.startTime = new Date();
  await room.save();
  
  console.log(`✅ Room ${room.stake} set to playing, starting ball timer...`);
  
  const timer = setInterval(async () => {
    try {
      // Get fresh room data
      const currentRoom = await Room.findById(room._id);
      if (!currentRoom || currentRoom.status !== 'playing') {
        console.log(`⚠️ Game timer stopped: Room ${room.stake} status is ${currentRoom?.status || 'not found'}`);
        clearInterval(timer);
        roomTimers.delete(room.stake);
        return;
      }
      
      // Check if 75 balls have been drawn
      if (currentRoom.ballsDrawn >= 75) {
        console.log(`⏰ Game timeout for room ${room.stake}: 75 balls drawn`);
        clearInterval(timer);
        roomTimers.delete(room.stake);
        await endGameWithNoWinner(currentRoom);
        return;
      }
      
      // Generate a ball that hasn't been called
      let ball;
      let letter;
      let attempts = 0;
      
      do {
        ball = Math.floor(Math.random() * 75) + 1;
        letter = getBingoLetter(ball);
        attempts++;
        
        if (attempts > 150) {
          // If we can't find a unique ball, use the first available
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
      
      // Update room
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
      
      // Send to ALL players in the room (including offline)
      console.log(`📤 Broadcasting ball ${letter}-${ball} to ${currentRoom.players.length} players in room ${room.stake}`);
      
      // Send to all players in the room
      currentRoom.players.forEach(userId => {
        // Find all sockets for this user
        for (const [socketId, uId] of socketToUser.entries()) {
          if (uId === userId) {
            const socket = io.sockets.sockets.get(socketId);
            if (socket && socket.connected) {
              socket.emit('ballDrawn', ballData);
              socket.emit('enableBingo');
              console.log(`   → Sent to user ${userId} via socket ${socketId}`);
            }
          }
        }
      });
      
      // Also send to admin panels
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
  }, CONFIG.GAME_TIMER * 1000); // 3 seconds between balls
  
  roomTimers.set(room.stake, timer);
  console.log(`✅ Game timer started for room ${room.stake}, interval: ${CONFIG.GAME_TIMER}s`);
}

// ✅✅✅ FIXED: Check if a player has bingo - PROPERLY HANDLES NUMBER COMPARISON
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
  
  console.log('🔍 BINGO CHECK DETAILS:');
  console.log('   Marked numbers:', markedNumbers);
  console.log('   Grid:', grid);
  
  for (const pattern of patterns) {
    const isBingo = pattern.every(index => {
      const cellValue = grid[index];
      
      // Handle FREE space
      if (cellValue === 'FREE') {
        const hasFree = markedNumbers.includes('FREE') || markedNumbers.some(m => m === 'FREE');
        console.log(`   Cell ${index} (FREE): ${hasFree ? '✅ Marked' : '❌ Not marked'}`);
        return hasFree;
      }
      
      // Check if the number is in markedNumbers
      // Convert both to numbers for comparison since client might send strings
      const cellValueNum = Number(cellValue);
      const isMarked = markedNumbers.some(marked => {
        // Handle 'FREE' string
        if (marked === 'FREE') return false;
        // Convert marked to number and compare
        const markedNum = Number(marked);
        return markedNum === cellValueNum;
      });
      
      console.log(`   Cell ${index} (${cellValue}): ${isMarked ? '✅ Marked' : '❌ Not marked'}`);
      return isMarked;
    });
    
    if (isBingo) {
      console.log(`✅ BINGO FOUND with pattern: ${pattern.join(',')}`);
      console.log(`   Is four corners: ${pattern.length === 4 && pattern[0] === 0 && pattern[1] === 4 && pattern[2] === 20 && pattern[3] === 24}`);
      
      return {
        isBingo: true,
        pattern: pattern,
        isFourCorners: pattern.length === 4 && pattern[0] === 0 && pattern[1] === 4 && pattern[2] === 20 && pattern[3] === 24
      };
    }
  }
  
  console.log('❌ No BINGO pattern found');
  return { isBingo: false };
}

// ========== FIXED END GAME WITH NO WINNER ==========
async function endGameWithNoWinner(room) {
  try {
    console.log(`🎮 Ending game with no winner for room ${room.stake}`);
    
    // Clear game timer FIRST
    cleanupRoomTimer(room.stake);
    
    // Store players list before clearing
    const playersInRoom = [...room.players];
    
    // Return funds to all players
    for (const userId of playersInRoom) {
      const user = await User.findOne({ userId: userId });
      if (user) {
        const oldBalance = user.balance;
        user.balance += room.stake; // Return their stake
        user.currentRoom = null;
        user.box = null;
        await user.save();
        
        console.log(`💰 Refunded ${room.stake} ETB to ${user.userName}, balance: ${oldBalance} → ${user.balance}`);
        
        // Record transaction
        const transaction = new Transaction({
          type: 'REFUND',
          userId: userId,
          userName: user.userName,
          amount: room.stake,
          room: room.stake,
          description: `Game ended with no winner - stake refunded`
        });
        await transaction.save();
        
        // Notify player if online
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
    
    // Reset room for next game
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
    
    // Broadcast empty boxes
    broadcastTakenBoxes(room.stake, []);
    io.emit('boxesCleared', { room: room.stake, reason: 'game_ended_no_winner' });
    
    console.log(`✅ Game ended with no winner for room ${room.stake}. Boxes cleared for next game.`);
    
    // Update displays
    broadcastRoomStatus();
    updateAdminPanel();
    
  } catch (error) {
    console.error('❌ Error ending game with no winner:', error);
  }
}

// ========== ⭐⭐ FIXED COUNTDOWN FUNCTION - AUTO STARTS GAME ⭐⭐ ==========
async function startCountdownForRoom(room) {
  try {
    console.log(`⏱️ STARTING COUNTDOWN for room ${room.stake} at ${new Date().toISOString()}`);
    
    // Stop any existing countdown first
    const countdownKey = `countdown_${room.stake}`;
    if (roomTimers.has(countdownKey)) {
      clearInterval(roomTimers.get(countdownKey));
      roomTimers.delete(countdownKey);
    }
    
    // Update room status
    room.status = 'starting';
    room.countdownStartTime = new Date();
    room.countdownStartedWith = room.players.length; // Track how many players we started with
    await room.save();
    
    let countdown = CONFIG.COUNTDOWN_TIMER;
    const countdownInterval = setInterval(async () => {
      try {
        // Get fresh room data
        const currentRoom = await Room.findById(room._id);
        if (!currentRoom || currentRoom.status !== 'starting') {
          console.log(`⏹️ Countdown stopped: Room ${room.stake} status changed to ${currentRoom?.status || 'deleted'}`);
          clearInterval(countdownInterval);
          roomTimers.delete(countdownKey);
          return;
        }
        
        // Get online players
        const onlinePlayers = await getOnlinePlayersInRoom(room.stake);
        
        // Send countdown to ALL players in room
        console.log(`⏱️ Room ${room.stake}: Countdown ${countdown}s, ${onlinePlayers.length} online players (started with ${room.countdownStartedWith})`);
        
        // Send to ALL players in the room
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
        
        // Broadcast to admin
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
        
        // Countdown finished - AUTO START GAME
        if (countdown < 0) {
          clearInterval(countdownInterval);
          roomTimers.delete(countdownKey);
          
          console.log(`🎮 Countdown finished for room ${room.stake} - AUTO STARTING GAME`);
          
          // Get final room data
          const finalRoom = await Room.findById(room._id);
          if (!finalRoom || finalRoom.status !== 'starting') {
            console.log(`⚠️ Countdown finished but room ${room.stake} is no longer in starting status`);
            return;
          }
          
          const finalOnlinePlayers = await getOnlinePlayersInRoom(room.stake);
          
          // ✅ AUTO START GAME with any players remaining
          if (finalOnlinePlayers.length >= 1) {
            console.log(`🎮 AUTO STARTING game for room ${room.stake} with ${finalOnlinePlayers.length} online player(s)`);
            
            // Update room to playing
            finalRoom.status = 'playing';
            finalRoom.startTime = new Date();
            finalRoom.countdownStartTime = null;
            finalRoom.countdownStartedWith = 0;
            await finalRoom.save();
            
            // Notify ALL players in the room
            finalRoom.players.forEach(userId => {
              for (const [socketId, uId] of socketToUser.entries()) {
                if (uId === userId) {
                  const socket = io.sockets.sockets.get(socketId);
                  if (socket && socket.connected) {
                    socket.emit('gameStarted', { 
                      room: room.stake,
                      players: finalOnlinePlayers.length
                    });
                    
                    // Send final countdown message
                    socket.emit('gameCountdown', {
                      room: room.stake,
                      timer: 0,
                      gameStarting: true
                    });
                  }
                }
              }
            });
            
            // Start the game timer IMMEDIATELY
            await startGameTimer(finalRoom);
            
            // Broadcast room status update
            broadcastRoomStatus();
            
            console.log(`✅ Game AUTO STARTED for room ${room.stake}, timer active`);
          } else {
            // No players - reset room
            console.log(`⚠️ Game start aborted for room ${room.stake}: no online players`);
            finalRoom.status = 'waiting';
            finalRoom.countdownStartTime = null;
            finalRoom.countdownStartedWith = 0;
            await finalRoom.save();
            
            // Notify players about reset
            finalRoom.players.forEach(userId => {
              for (const [socketId, uId] of socketToUser.entries()) {
                if (uId === userId) {
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
                }
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
    }, 1000); // Every second
    
    roomTimers.set(countdownKey, countdownInterval);
    console.log(`✅ Countdown timer started for room ${room.stake}`);
    
  } catch (error) {
    console.error('❌ Error starting countdown:', error);
  }
}

// ========== IMPROVED SOCKET.IO EVENT HANDLERS ==========
io.on('connection', (socket) => {
  console.log(`✅ Socket.IO Connected: ${socket.id} - User: ${socket.handshake.query?.userId || 'Unknown'}`);
  connectedSockets.add(socket.id);
  
  // Enhanced connection tracking - store userId on socket if available in query
  const query = socket.handshake.query;
  if (query.userId) {
    console.log(`👤 User connected via query: ${query.userId}`);
    socket.userId = query.userId; // Store userId on socket for tracking
  }
  
  // Send connection test immediately
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
    
    // Record transaction
    const transaction = new Transaction({
      type: 'ADMIN_ADD',
      userId: userId,
      userName: user.userName,
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
      room.lastBoxUpdate = new Date(); // Update timestamp
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
      // Force start game immediately
      room.status = 'playing';
      room.startTime = new Date();
      await room.save();
      
      // Start game timer
      await startGameTimer(room);
      
      // Notify all players in room
      room.players.forEach(userId => {
        for (const [sId, uId] of socketToUser.entries()) {
          if (uId === userId) {
            const s = io.sockets.sockets.get(sId);
            if (s) {
              s.emit('gameStarted', { 
                room: roomStake,
                players: room.players.length
              });
            }
          }
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
      // Clear game timer
      cleanupRoomTimer(roomStake);
      
      // Store players list before clearing
      const playersInRoom = [...room.players];
      
      // Return funds to all players
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
      
      // Clear room data
      room.players = [];
      room.takenBoxes = [];
      room.status = 'ended';
      room.endTime = new Date();
      room.lastBoxUpdate = new Date(); // 🚨 Update timestamp
      await room.save();
      
      // Broadcast empty boxes
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
    
    // Store players list before clearing
    const playersInRoom = [...room.players];
    
    // Refund all players
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
        
        // Notify player
        for (const [sId, uId] of socketToUser.entries()) {
          if (uId === userId) {
            const s = io.sockets.sockets.get(sId);
            if (s) {
              // Send boxesCleared ONLY for admin clearing
              s.emit('boxesCleared', { room: roomStake, adminCleared: true, reason: 'admin_cleared' });
              s.emit('balanceUpdate', user.balance);
              s.emit('lobbyUpdate', { room: roomStake, count: 0 });
            }
          }
        }
      }
    }
    
    // Clear room
    room.players = [];
    room.takenBoxes = [];
    room.status = 'waiting';
    room.lastBoxUpdate = new Date(); // 🚨 Update timestamp
    await room.save();
    
    // Broadcast cleared boxes
    broadcastTakenBoxes(roomStake, []);
    socket.emit('admin:success', `Cleared all boxes in ${roomStake} ETB room`);
    
    logActivity('ADMIN_CLEAR_BOXES', { adminSocket: socket.id, roomStake }, socket.id);
  });
  
  // ⭐⭐ ADDED: Admin debugging for countdown
  socket.on('admin:debugCountdown', async (roomStake) => {
    if (!adminSockets.has(socket.id)) {
      socket.emit('admin:error', 'Unauthorized');
      return;
    }
    
    const room = await Room.findOne({ stake: parseInt(roomStake) });
    if (room) {
      const onlinePlayers = await getOnlinePlayersInRoom(room.stake);
      
      console.log(`🔍 Admin debugging countdown for room ${roomStake}`);
      console.log(`   Status: ${room.status}`);
      console.log(`   Players: ${room.players.length}`);
      console.log(`   Taken boxes: ${room.takenBoxes.length}`);
      console.log(`   Countdown start: ${room.countdownStartTime}`);
      console.log(`   Countdown started with: ${room.countdownStartedWith}`);
      console.log(`   Online players: ${onlinePlayers.length}`);
      console.log(`   Room timers active: ${roomTimers.has(`countdown_${roomStake}`)}`);
      
      socket.emit('admin:success', `Room ${roomStake}: ${room.status}, ${onlinePlayers.length} online, ${room.players.length} total, countdown active: ${roomTimers.has(`countdown_${roomStake}`)}`);
    }
  });
  
  // Player events
  socket.on('init', async (data, callback) => {
    try {
      const { userId, userName } = data;
      
      console.log(`📱 User init: ${userName} (${userId}) via socket ${socket.id}`);
      
      // Store userId on socket for tracking - ⭐⭐ CRITICAL FIX ADDED HERE ⭐⭐
      socket.userId = userId;
      
      const user = await getUser(userId, userName);
      
      if (user) {
        // Store in socketToUser map
        socketToUser.set(socket.id, userId);
        
        // Also update user's lastSeen immediately
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
        
        // Send callback response
        if (callback) {
          callback({ success: true, message: 'User initialized successfully' });
        }
        
        // Log the successful connection
        console.log(`✅ User connected successfully: ${userName} (${userId})`);
        
        // Update admin panel with new connection IN REAL-TIME
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
  
  // FIXED: Get taken boxes from ALL rooms
  socket.on('getTakenBoxes', async ({ room }, callback) => {
    try {
      // FIX: Get taken boxes from ALL rooms (not just waiting/starting)
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
      
      // Store subscription
      if (!roomSubscriptions.has(data.room)) {
        roomSubscriptions.set(data.room, new Set());
      }
      roomSubscriptions.get(data.room).add(socket.id);
      
      // Send current taken boxes immediately
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
  
  // ⭐⭐ FIXED: Improved joinRoom function with better countdown logic
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
      
      // Get or create room
      let roomData = await Room.findOne({ 
        stake: room, 
        status: { $in: ['waiting', 'starting', 'playing'] } 
      });
      
      if (!roomData) {
        // Create a new active room if none exists
        roomData = new Room({
          stake: room,
          players: [],
          takenBoxes: [],
          status: 'waiting',
          lastBoxUpdate: new Date()
        });
        await roomData.save();
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
      
      // Update user balance and room info
      user.balance -= room;
      user.totalWagered = (user.totalWagered || 0) + room;
      user.currentRoom = room;
      user.box = box;
      await user.save();
      
      // Record transaction
      const transaction = new Transaction({
        type: 'STAKE',
        userId: user.userId,
        userName: user.userName,
        amount: -room,
        room: room,
        description: `Joined ${room} ETB room with ticket ${box}`
      });
      await transaction.save();
      
      // Update room
      roomData.players.push(user.userId);
      roomData.takenBoxes.push(box);
      roomData.lastBoxUpdate = new Date();
      
      const onlinePlayers = await getOnlinePlayersInRoom(room);
      
      console.log(`🚀 joinRoom - Room ${room}:`);
      console.log(`   Players in room: ${roomData.players.length}`);
      console.log(`   Online players: ${onlinePlayers.length}`);
      console.log(`   Room status: ${roomData.status}`);
      console.log(`   Min players to start: ${CONFIG.MIN_PLAYERS_TO_START}`);
      
      // 🚨 CRITICAL: BROADCAST REAL-TIME BOX UPDATE
      broadcastTakenBoxes(room, roomData.takenBoxes, box, user.userName);
      
      await roomData.save();
      
      // Send success to joining player
      socket.emit('joinedRoom');
      socket.emit('balanceUpdate', user.balance);
      
      // Send lobby update to ALL players in the room
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
      
      // ⭐⭐ FIXED: Start countdown if we have at least 1 online player
      if (onlinePlayers.length >= CONFIG.MIN_PLAYERS_TO_START && roomData.status === 'waiting') {
        console.log(`🚀 STARTING COUNTDOWN for room ${room} with ${onlinePlayers.length} online player(s)!`);
        await startCountdownForRoom(roomData);
      } else {
        console.log(`⏸️ NOT starting countdown:`);
        console.log(`   Online players: ${onlinePlayers.length} (need ${CONFIG.MIN_PLAYERS_TO_START})`);
        console.log(`   Room status: ${roomData.status} (need 'waiting')`);
      }
      
      // Send personal confirmation
      socket.emit('boxesTakenUpdate', {
        room: room,
        takenBoxes: roomData.takenBoxes,
        personalBox: box,
        message: `You selected box ${box}! Waiting for players...`
      });
      
      // Broadcast updates
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
  
  // ========== ✅✅✅ FIXED CLAIM BINGO LOGIC - PROPERLY HANDLES NUMBER COMPARISON ==========
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
      
      const roomData = await Room.findOne({ stake: parseInt(room), status: 'playing' });
      if (!roomData) {
        socket.emit('error', 'Game not found or not in progress');
        if (callback) callback({ success: false, message: 'Game not found or not in progress' });
        return;
      }
      
      if (!roomData.players.includes(userId)) {
        socket.emit('error', 'You are not in this game');
        if (callback) callback({ success: false, message: 'You are not in this game' });
        return;
      }
      
      console.log('🎯 BINGO CLAIM RECEIVED:');
      console.log('   User:', user.userName);
      console.log('   Room:', room);
      console.log('   Grid:', grid);
      console.log('   Marked:', marked);
      
      // ✅ FIXED: Convert marked numbers properly for comparison
      // The client may send strings or numbers, so we need to handle both
      const markedNumbers = marked.map(item => {
        if (item === 'FREE') return 'FREE';
        return Number(item); // Convert to number for comparison
      }).filter(item => !isNaN(item) || item === 'FREE');
      
      console.log('   Marked (converted):', markedNumbers);
      
      // Check if bingo is valid
      const bingoCheck = checkBingo(markedNumbers, grid);
      if (!bingoCheck.isBingo) {
        console.log('❌ Invalid bingo claim - no winning pattern found');
        socket.emit('error', 'Invalid bingo claim');
        if (callback) callback({ success: false, message: 'Invalid bingo claim - no winning pattern' });
        return;
      }
      
      const isFourCornersWin = bingoCheck.isFourCorners;
      
      // ✅ FIXED CALCULATIONS: Calculate total prize correctly
      const commissionPerPlayer = CONFIG.HOUSE_COMMISSION[room] || 0;
      const contributionPerPlayer = room - commissionPerPlayer;
      const totalPlayers = roomData.players.length;
      
      // Base prize is total contributions from ALL players
      const basePrize = contributionPerPlayer * totalPlayers;
      
      // Four corners bonus
      let bonus = 0;
      if (isFourCornersWin) {
        bonus = CONFIG.FOUR_CORNERS_BONUS;
      }
      
      const totalPrize = basePrize + bonus;
      
      console.log(`🎰 WIN CALCULATION for ${room} ETB room:`);
      console.log(`   Total players: ${totalPlayers}`);
      console.log(`   Stake per player: ${room} ETB`);
      console.log(`   Commission per player: ${commissionPerPlayer} ETB`);
      console.log(`   Contribution per player: ${contributionPerPlayer} ETB`);
      console.log(`   Total contributions: ${basePrize} ETB`);
      console.log(`   Four corners bonus: ${bonus} ETB`);
      console.log(`   Total prize: ${totalPrize} ETB`);
      console.log(`   House earnings: ${commissionPerPlayer * totalPlayers} ETB`);
      
      // Update user balance
      const oldBalance = user.balance;
      user.balance += totalPrize;
      user.totalWins = (user.totalWins || 0) + 1;
      user.totalBingos = (user.totalBingos || 0) + 1;
      user.currentRoom = null;
      user.box = null;
      await user.save();
      
      console.log(`💰 User ${user.userName} won ${totalPrize} ETB (was ${oldBalance}, now ${user.balance})`);
      
      // Record transaction
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
      
      // Record house earnings
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
      
      // Store players list BEFORE clearing
      const playersInRoom = [...roomData.players];
      
      // ⭐⭐ FIXED: Clear game timer FIRST
      cleanupRoomTimer(room);
      
      // Update room status
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
      
      // ✅ CRITICAL FIX: Now clear room data
      roomData.players = [];
      roomData.takenBoxes = [];
      roomData.status = 'waiting'; // ✅ Reset to waiting for new game
      roomData.calledNumbers = [];
      roomData.currentBall = null;
      roomData.ballsDrawn = 0;
      roomData.startTime = null;
      roomData.endTime = new Date();
      roomData.lastBoxUpdate = new Date();
      await roomData.save();
      
      // Create game over data
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
      
      // Send immediate callback response to the winner
      if (callback) {
        callback({ 
          success: true, 
          message: 'BINGO claim received and being processed',
          isFourCornersWin: isFourCornersWin
        });
      }
      
      // Update all other players and notify everyone
      for (const playerId of playersInRoom) {
        if (playerId !== userId) {
          const losingUser = await User.findOne({ userId: playerId });
          if (losingUser) {
            losingUser.currentRoom = null;
            losingUser.box = null;
            await losingUser.save();
          }
        }
        
        // Notify each player
        for (const [sId, uId] of socketToUser.entries()) {
          if (uId === playerId) {
            const s = io.sockets.sockets.get(sId);
            if (s) {
              if (uId === userId) {
                // Winner
                s.emit('gameOver', gameOverData);
                s.emit('balanceUpdate', user.balance);
              } else {
                // Loser
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
      
      // ✅ BROADCAST EMPTY BOXES and send boxesCleared event
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
        
        // Update admin panel with activity
        updateAdminPanel();
      } catch (error) {
        console.error('Error updating player activity:', error);
      }
    }
  });
  
  // ========== FIXED: player:leaveRoom - Proper cleanup and refund ==========
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
        // Clean up user if room doesn't exist
        user.currentRoom = null;
        user.box = null;
        await user.save();
        socket.emit('leftRoom', { message: 'Left room (room not found)' });
        return;
      }
      
      // Prevent leaving if game is already playing
      if (room.status === 'playing') {
        console.log(`❌ Player ${user.userName} tried to leave during active game in room ${roomStake}`);
        socket.emit('error', 'Cannot leave room during active game! Wait for game to end.');
        return;
      }
      
      // Remove user from room
      const playerIndex = room.players.indexOf(userId);
      const boxIndex = room.takenBoxes.indexOf(user.box);
      
      if (playerIndex > -1) {
        room.players.splice(playerIndex, 1);
      }
      
      if (boxIndex > -1) {
        room.takenBoxes.splice(boxIndex, 1);
      }
      
      room.lastBoxUpdate = new Date();
      
      // Get online players after removal
      const onlinePlayers = await getOnlinePlayersInRoom(roomStake);
      
      // ⭐⭐ FIXED: DON'T stop countdown when player leaves
      // The countdown should continue even if players leave
      
      await room.save();
      
      // Reset user
      user.currentRoom = null;
      user.box = null;
      
      // Refund stake if game hasn't started
      if (room.status !== 'playing') {
        const oldBalance = user.balance;
        user.balance += roomStake;
        
        console.log(`💰 Refunded ${roomStake} ETB to ${user.userName}, new balance: ${user.balance}`);
        
        // Record transaction
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
      
      // Broadcast updated boxes
      broadcastTakenBoxes(roomStake, room.takenBoxes);
      
      // Send success message
      socket.emit('leftRoom', { 
        message: 'Left room successfully',
        refunded: room.status !== 'playing'
      });
      
      // Update lobby for remaining players
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
      
      // Update admin panel
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
  
  // Add new event for getting room info
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
        
        // Also send countdown status if room is starting
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
      // Update user activity
      await User.findOneAndUpdate(
        { userId: userId },
        { lastSeen: new Date() }
      );
    }
  });
  
  // Add new event handler for game started
  socket.on('game:started', async (data) => {
    const userId = socketToUser.get(socket.id) || socket.userId;
    if (userId) {
      console.log(`✅ Player ${userId} confirmed game started`);
    }
  });
  
  // ========== FIXED: disconnect event - Proper cleanup on disconnect ==========
  socket.on('disconnect', async () => {
    console.log(`❌ Socket disconnected: ${socket.id}`);
    connectedSockets.delete(socket.id);
    adminSockets.delete(socket.id);
    
    // Remove from room subscriptions
    roomSubscriptions.forEach((sockets, room) => {
      sockets.delete(socket.id);
    });
    
    const userId = socketToUser.get(socket.id) || socket.userId;
    if (userId) {
      console.log(`👤 User ${userId} disconnected`);
      
      try {
        // Find user
        const user = await User.findOne({ userId: userId });
        if (user && user.currentRoom) {
          const roomStake = user.currentRoom;
          const room = await Room.findOne({ stake: roomStake });
          
          if (room) {
            // Only remove from room if game is NOT playing
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
              
              // ⭐⭐ FIXED: DON'T stop countdown when player disconnects
              // Countdown continues even if players disconnect
              
              await room.save();
              
              // Broadcast updated boxes
              broadcastTakenBoxes(roomStake, room.takenBoxes);
              
              console.log(`👤 User ${user.userName} removed from room ${roomStake} due to disconnect`);
            } else {
              console.log(`⚠️ User ${user.userName} disconnected during gameplay in room ${roomStake}, keeping in game`);
            }
          }
          
          // Update user status
          user.isOnline = false;
          user.lastSeen = new Date();
          await user.save();
        } else {
          // Just update last seen
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
      
      // Remove from socketToUser map
      socketToUser.delete(socket.id);
    }
    
    // Update admin panel
    setTimeout(() => {
      updateAdminPanel();
      broadcastRoomStatus();
    }, 1000);
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

// ========== CONNECTION CLEANUP FUNCTION ==========
async function cleanupStaleConnections() {
  console.log('🧹 Running connection cleanup...');
  
  const now = new Date();
  const thirtySecondsAgo = new Date(now.getTime() - 30000);
  
  try {
    // Update users who haven't been seen in 30 seconds
    await User.updateMany(
      { 
        lastSeen: { $lt: thirtySecondsAgo },
        isOnline: true 
      },
      { 
        isOnline: false 
      }
    );
    
    // Clean up socketToUser map
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

// Run cleanup every 30 seconds
setInterval(cleanupStaleConnections, 30000);

// ========== CLEANUP STUCK COUNTDOWNS ==========
async function cleanupStuckCountdowns() {
  try {
    const now = new Date();
    const rooms = await Room.find({ status: 'starting' });
    
    for (const room of rooms) {
      if (room.countdownStartTime) {
        const timeSinceStart = now - new Date(room.countdownStartTime);
        // If countdown has been "starting" for more than 45 seconds (should be 30), something's wrong
        if (timeSinceStart > 45000) {
          console.log(`⚠️ Cleaning up stuck countdown for room ${room.stake} (${timeSinceStart/1000}s)`);
          
          // Stop countdown
          const countdownKey = `countdown_${room.stake}`;
          if (roomTimers.has(countdownKey)) {
            clearInterval(roomTimers.get(countdownKey));
            roomTimers.delete(countdownKey);
          }
          
          // Reset room status
          room.status = 'waiting';
          room.countdownStartTime = null;
          room.countdownStartedWith = 0;
          await room.save();
          
          // Get online players and notify them
          const onlinePlayers = await getOnlinePlayersInRoom(room.stake);
          onlinePlayers.forEach(userId => {
            for (const [socketId, uId] of socketToUser.entries()) {
              if (uId === userId) {
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
              }
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

// Run every 10 seconds
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
      
      // Clear all boxes and reset room
      if (room.takenBoxes.length > 0 || room.players.length > 0) {
        console.log(`⚠️ Room ${room.stake} still has ${room.takenBoxes.length} taken boxes and ${room.players.length} players. Clearing...`);
        room.players = [];
        room.takenBoxes = [];
        room.status = 'waiting';
        room.lastBoxUpdate = new Date();
        await room.save();
        
        // Broadcast that boxes are cleared
        broadcastTakenBoxes(room.stake, []);
        io.emit('boxesCleared', { room: room.stake, reason: 'stale_room_cleanup' });
      }
      
      // Delete only very old rooms (1 day)
      const oneDayAgo = new Date(Date.now() - 86400000);
      if (room.endTime && room.endTime < oneDayAgo) {
        await Room.deleteOne({ _id: room._id });
        console.log(`🗑️ Deleted stale room from database: ${room.stake} ETB`);
      }
    }
    
    // Also clean up rooms with status 'playing' but no players for a while
    const emptyPlayingRooms = await Room.find({
      status: 'playing',
      players: { $size: 0 }
    });
    
    for (const room of emptyPlayingRooms) {
      console.log(`🧹 Cleaning up empty playing room: ${room.stake} ETB`);
      cleanupRoomTimer(room.stake);
      
      // Reset room
      room.players = [];
      room.takenBoxes = [];
      room.status = 'waiting';
      room.calledNumbers = [];
      room.currentBall = null;
      room.ballsDrawn = 0;
      room.startTime = null;
      room.lastBoxUpdate = new Date();
      await room.save();
      
      // Broadcast cleared boxes
      broadcastTakenBoxes(room.stake, []);
      io.emit('boxesCleared', { room: room.stake, reason: 'empty_room_cleanup' });
    }
    
  } catch (error) {
    console.error('Error in cleanupStaleRooms:', error);
  }
}

// Run every 5 minutes
setInterval(cleanupStaleRooms, 300000);

// ========== HEALTH CHECK FUNCTION ==========
setInterval(async () => {
  try {
    const now = Date.now();
    const fiveMinutesAgo = new Date(now - 300000);
    
    // Update users who haven't been active
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
    
    // Clean up ONLY abandoned rooms with no players
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
          <p style="color: #10b981; margin-top: 10px;">🔄 FIXED: Timer doesn't reset when players leave</p>
          <p style="color: #10b981;">⏱️ FIXED: Game starts even with 1 player</p>
          <p style="color: #10b981;">🧹 FIXED: Boxes cleared after game ends</p>
          <p style="color: #10b981; margin-top: 10px;">✅ FIXED: Game timer and ball drawing issues resolved</p>
          <p style="color: #10b981;">🎱 Balls pop every 3 seconds: ✅ WORKING</p>
          <p style="color: #10b981;">⏱️ 30-second countdown: ✅ WORKING</p>
          <p style="color: #10b981; font-weight: bold; margin-top: 10px;">✅✅✅ FIXED: Claim Bingo now properly checks numbers!</p>
          <p style="color: #10b981; font-weight: bold;">✅✅ All players return to lobby after game ends</p>
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
            Version: 2.6.2 (BINGO FIXED) | Database: MongoDB Atlas<br>
            Socket.IO: ✅ Connected Sockets: ${connectedSockets.size}<br>
            SocketToUser: ${socketToUser.size} | Admin Sockets: ${adminSockets.size}<br>
            Telegram Integration: ✅ Ready<br>
            Game Timer: ${CONFIG.GAME_TIMER}s between balls<br>
            Bot Username: @ethio_games1_bot<br>
            Real-time Box Updates: ✅ ACTIVE<br>
            Fixed Issues: ✅ Game timer working, ✅ Ball popping every 3s, ✅ 30-second countdown working<br>
            ✅ Players properly removed when leaving, ✅ Countdown stuck issue resolved<br>
            ✅ Balls drawn correctly, ✅ BINGO checking working<br>
            ✅✅ COUNTDOWN CONTINUES WHEN PLAYERS LEAVE<br>
            ✅✅ GAME STARTS WITH 1 PLAYER AFTER 30 SECONDS<br>
            ✅✅ CONNECTION TRACKING FIXED - Game starts properly now!<br>
            ✅✅✅✅ CLAIM BINGO NOW PROPERLY CHECKS NUMBERS (STRING/NUMBER FIX)<br>
            ✅✅✅ ALL PLAYERS RETURN TO LOBBY AFTER GAME ENDS
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

// Telegram Mini App entry point with professional game selection interface
app.get('/telegram', (req, res) => {
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
                --primary-color: #3b82f6;
                --secondary-color: #8b5cf6;
                --accent-color: #fbbf24;
                --dark-bg: #0f172a;
                --card-bg: #1e293b;
                --text-primary: #f8fafc;
                --text-secondary: #94a3b8;
            }
            
            * {
                margin: 0;
                padding: 0;
                box-sizing: border-box;
                -webkit-tap-highlight-color: transparent;
            }
            
            body {
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
                background: var(--dark-bg);
                color: var(--text-primary);
                height: 100vh;
                overflow: hidden;
                padding: 0;
                margin: 0;
            }
            
            .container {
                width: 100%;
                height: 100%;
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: space-between;
                padding: 20px;
                max-width: 500px;
                margin: 0 auto;
            }
            
            .header {
                width: 100%;
                text-align: center;
                padding: 15px 0;
                position: relative;
            }
            
            .header::after {
                content: '';
                position: absolute;
                bottom: 0;
                left: 50%;
                transform: translateX(-50%);
                width: 60px;
                height: 4px;
                background: var(--accent-color);
                border-radius: 2px;
            }
            
            .logo {
                font-size: 2.5rem;
                margin-bottom: 10px;
                color: var(--accent-color);
            }
            
            .welcome-text {
                font-size: 1.8rem;
                font-weight: 700;
                margin-bottom: 5px;
                background: linear-gradient(90deg, var(--primary-color), var(--secondary-color));
                -webkit-background-clip: text;
                -webkit-text-fill-color: transparent;
            }
            
            .subtitle {
                color: var(--text-secondary);
                font-size: 0.9rem;
                margin-bottom: 20px;
            }
            
            .games-grid {
                width: 100%;
                display: grid;
                grid-template-columns: 1fr;
                gap: 20px;
                flex: 1;
                overflow-y: auto;
                padding: 10px 0;
            }
            
            .game-card {
                background: var(--card-bg);
                border-radius: 20px;
                padding: 25px;
                text-align: center;
                transition: all 0.3s ease;
                border: 2px solid transparent;
                position: relative;
                overflow: hidden;
                cursor: pointer;
            }
            
            .game-card::before {
                content: '';
                position: absolute;
                top: 0;
                left: 0;
                right: 0;
                height: 4px;
                background: linear-gradient(90deg, var(--primary-color), var(--secondary-color));
            }
            
            .game-card:hover {
                transform: translateY(-5px);
                border-color: rgba(59, 130, 246, 0.3);
                box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
            }
            
            .game-card:active {
                transform: translateY(-2px);
            }
            
            /* Game icon with image */
            .game-icon {
                width: 100px;
                height: 100px;
                margin-bottom: 15px;
                display: flex;
                align-items: center;
                justify-content: center;
                margin-left: auto;
                margin-right: auto;
            }
            
            .game-icon-img {
                width: 100%;
                height: 100%;
                object-fit: contain;
                border-radius: 15px;
                box-shadow: 0 5px 15px rgba(0, 0, 0, 0.2);
            }
            
            .bingo-icon {
                animation: pulse 2s infinite;
            }
            
            .game-title {
                font-size: 1.5rem;
                font-weight: 700;
                margin-bottom: 8px;
            }
            
            .game-description {
                color: var(--text-secondary);
                font-size: 0.85rem;
                line-height: 1.4;
                margin-bottom: 15px;
                min-height: 40px;
            }
            
            .features {
                display: flex;
                justify-content: center;
                gap: 8px;
                margin-bottom: 20px;
                flex-wrap: wrap;
            }
            
            .feature-tag {
                background: rgba(59, 130, 246, 0.1);
                color: #60a5fa;
                padding: 4px 10px;
                border-radius: 15px;
                font-size: 0.7rem;
                font-weight: 600;
                border: 1px solid rgba(59, 130, 246, 0.2);
            }
            
            .play-btn {
                background: linear-gradient(90deg, var(--primary-color), var(--secondary-color));
                color: white;
                border: none;
                padding: 14px 20px;
                border-radius: 12px;
                font-size: 1rem;
                font-weight: 700;
                width: 100%;
                cursor: pointer;
                transition: all 0.2s;
                box-shadow: 0 4px 15px rgba(59, 130, 246, 0.3);
            }
            
            .play-btn:hover {
                transform: scale(1.02);
                box-shadow: 0 6px 20px rgba(59, 130, 246, 0.4);
            }
            
            .play-btn:active {
                transform: scale(0.98);
            }
            
            .coming-soon {
                background: linear-gradient(90deg, #64748b, #475569);
                opacity: 0.7;
                cursor: not-allowed;
            }
            
            .coming-soon:hover {
                transform: none;
                box-shadow: 0 4px 15px rgba(100, 116, 139, 0.3);
            }
            
            .footer {
                width: 100%;
                text-align: center;
                padding: 15px 0;
                color: var(--text-secondary);
                font-size: 0.8rem;
                border-top: 1px solid rgba(255, 255, 255, 0.05);
            }
            
            .balance-pill {
                background: rgba(251, 191, 36, 0.1);
                padding: 8px 16px;
                border-radius: 50px;
                border: 1px solid rgba(251, 191, 36, 0.3);
                font-weight: 700;
                color: var(--accent-color);
                display: inline-flex;
                align-items: center;
                gap: 6px;
                margin-top: 10px;
            }
            
            @keyframes pulse {
                0% { transform: scale(1); }
                50% { transform: scale(1.05); }
                100% { transform: scale(1); }
            }
            
            @keyframes slideIn {
                from { opacity: 0; transform: translateY(20px); }
                to { opacity: 1; transform: translateY(0); }
            }
            
            @media (max-width: 480px) {
                .container {
                    padding: 15px;
                }
                
                .game-card {
                    padding: 20px;
                }
                
                .game-icon {
                    width: 80px;
                    height: 80px;
                }
                
                .welcome-text {
                    font-size: 1.5rem;
                }
            }
            
            @media (max-width: 380px) {
                .games-grid {
                    gap: 15px;
                }
                
                .game-card {
                    padding: 15px;
                }
                
                .game-icon {
                    width: 70px;
                    height: 70px;
                }
            }
            
            /* User info in top right */
            .user-info {
                position: absolute;
                top: 15px;
                right: 0;
                display: flex;
                align-items: center;
                gap: 8px;
                font-size: 0.8rem;
                color: var(--text-secondary);
            }
            
            .user-avatar {
                width: 32px;
                height: 32px;
                background: linear-gradient(135deg, var(--primary-color), var(--secondary-color));
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
                font-weight: 700;
                color: white;
            }
            
            /* Loading placeholder for images */
            .image-placeholder {
                width: 100%;
                height: 100%;
                background: linear-gradient(135deg, var(--primary-color), var(--secondary-color));
                border-radius: 15px;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 2rem;
                color: white;
            }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <div class="logo">🎮</div>
                <h1 class="welcome-text">ETHIO GAMES</h1>
                <p class="subtitle">Premium gaming experience on Telegram</p>
                
                <div id="userInfo" class="user-info" style="display: none;">
                    <div class="user-avatar" id="userAvatar">U</div>
                    <span id="userName">User</span>
                </div>
            </div>
            
            <div class="games-grid">
                <!-- BINGO CARD -->
                <div class="game-card" onclick="launchGame('bingo')">
                    <div class="game-icon bingo-icon">
                        <img src="https://images.unsplash.com/photo-1610447847416-40bac442fbe6?q=80&w=500&auto=format&fit=crop" 
                             alt="Bingo Game" 
                             class="game-icon-img"
                             onerror="this.onerror=null; this.src='https://via.placeholder.com/100x100/3b82f6/ffffff?text=BINGO';">
                        <div class="image-placeholder" style="display: none;">🎱</div>
                    </div>
                    <h2 class="game-title">BINGO ELITE</h2>
                    <p class="game-description">
                        Real-time multiplayer bingo with 10-100 ETB stakes. Win big with Four Corners bonus!
                    </p>
                    
                    <div class="features">
                        <span class="feature-tag">🎯 50 ETB Bonus</span>
                        <span class="feature-tag">👥 100 Players</span>
                        <span class="feature-tag">💰 Real Money</span>
                        <span class="feature-tag">⚡ Real-time</span>
                    </div>
                    
                    <button class="play-btn" id="bingoBtn">
                        🎮 PLAY BINGO
                    </button>
                </div>
                
                <!-- KENO CARD -->
                <div class="game-card" onclick="launchGame('keno')">
                    <div class="game-icon">
                        <img src="https://images.unsplash.com/photo-1560279966-8ff2d3edbc43?q=80&w=500&auto=format&fit=crop" 
                             alt="Keno Game" 
                             class="game-icon-img"
                             onerror="this.onerror=null; this.src='https://via.placeholder.com/100x100/8b5cf6/ffffff?text=KENO';">
                        <div class="image-placeholder" style="display: none;">🎲</div>
                    </div>
                    <h2 class="game-title">KENO ULTRA</h2>
                    <p class="game-description">
                        Fast-paced number selection game with instant wins. Coming soon!
                    </p>
                    
                    <div class="features">
                        <span class="feature-tag">🎰 Instant Wins</span>
                        <span class="feature-tag">⚡ Fast Gameplay</span>
                        <span class="feature-tag">💰 High Payouts</span>
                        <span class="feature-tag">🔜 Coming Soon</span>
                    </div>
                    
                    <button class="play-btn coming-soon" id="kenoBtn" disabled>
                        🎯 COMING SOON
                    </button>
                </div>
            </div>
            
            <div class="footer">
                <div class="balance-pill" id="balancePill" style="display: none;">
                    <span>💰 Balance: </span>
                    <span id="balanceAmount">0.00</span>
                    <span> ETB</span>
                </div>
                <p style="margin-top: 10px;">Powered by Telegram • Play responsibly</p>
                <p style="font-size: 0.7rem; color: #64748b; margin-top: 5px;">
                    Need funds? Contact admin @ethio_games1_bot
                </p>
            </div>
        </div>
        
        <script>
            // Initialize Telegram Web App
            const tg = window.Telegram.WebApp;
            
            // Expand the app to full height
            tg.ready();
            tg.expand();
            
            // Set Telegram theme colors
            tg.setHeaderColor('#3b82f6');
            tg.setBackgroundColor('#0f172a');
            
            // Get user info from Telegram
            const user = tg.initDataUnsafe?.user;
            let userBalance = 0.00;
            
            // Function to get first letter of name for avatar
            function getFirstLetter(name) {
                return name ? name.charAt(0).toUpperCase() : 'U';
            }
            
            if (user) {
                // Show user info
                document.getElementById('userInfo').style.display = 'flex';
                document.getElementById('userName').textContent = user.first_name || 'User';
                document.getElementById('userAvatar').textContent = getFirstLetter(user.first_name);
                
                // Store user info for game
                localStorage.setItem('telegramUser', JSON.stringify({
                    id: user.id,
                    firstName: user.first_name,
                    username: user.username,
                    languageCode: user.language_code
                }));
            }
            
            // Launch game function
            function launchGame(game) {
                // Haptic feedback
                if (tg && tg.HapticFeedback) {
                    tg.HapticFeedback.impactOccurred('light');
                }
                
                if (game === 'bingo') {
                    // Redirect to bingo game
                    window.location.href = '/game';
                } else if (game === 'keno') {
                    // Keno coming soon - show message
                    tg.showPopup({
                        title: 'Coming Soon',
                        message: 'KENO ULTRA is under development and will be available soon!',
                        buttons: [{ type: 'ok' }]
                    });
                }
            }
            
            // Add click handlers to game cards
            document.getElementById('bingoBtn').addEventListener('click', () => launchGame('bingo'));
            document.getElementById('kenoBtn').addEventListener('click', () => launchGame('keno'));
            
            // Add Telegram Main Button if available
            if (tg && tg.MainButton) {
                tg.MainButton.setText('🎮 PLAY BINGO');
                tg.MainButton.show();
                tg.MainButton.onClick(function() {
                    launchGame('bingo');
                });
            }
            
            // Handle image loading errors
            document.querySelectorAll('.game-icon-img').forEach(img => {
                img.addEventListener('error', function() {
                    this.style.display = 'none';
                    const placeholder = this.nextElementSibling;
                    if (placeholder && placeholder.classList.contains('image-placeholder')) {
                        placeholder.style.display = 'flex';
                    }
                });
            });
            
            // Preload images for better user experience
            window.addEventListener('load', function() {
                const imageUrls = [
                    'https://images.unsplash.com/photo-1610447847416-40bac442fbe6?q=80&w=500&auto=format&fit=crop',
                    'https://images.unsplash.com/photo-1560279966-8ff2d3edbc43?q=80&w=500&auto=format&fit=crop'
                ];
                
                imageUrls.forEach(url => {
                    const img = new Image();
                    img.src = url;
                });
            });
            
            // Add animation to game cards
            document.querySelectorAll('.game-card').forEach((card, index) => {
                card.style.animation = \`slideIn 0.5s ease \${index * 0.1}s forwards\`;
                card.style.opacity = '0';
            });
        </script>
    </body>
    </html>
  `);
});

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
        
        // Configure Socket.IO
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
        
        // Test functions
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
        
        // Auto-test on load
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

app.get('/health', async (req, res) => {
  try {
    const connectedPlayers = getConnectedUsers().length;
    const activeGames = await Room.countDocuments({ status: 'playing' });
    const totalUsers = await User.countDocuments();
    const rooms = await Room.countDocuments();
    const totalTransactions = await Transaction.countDocuments();
    
    // Get rooms with countdown status
    const startingRooms = await Room.find({ status: 'starting' });
    const roomDetails = await Promise.all(startingRooms.map(async (room) => {
      const onlinePlayers = await getOnlinePlayersInRoom(room.stake);
      return {
        stake: room.stake,
        onlinePlayers: onlinePlayers.length,
        totalPlayers: room.players.length,
        countdownStartTime: room.countdownStartTime,
        countdownStartedWith: room.countdownStartedWith
      };
    }));
    
    res.json({
      status: 'ok',
      database: 'connected',
      connectedPlayers: connectedPlayers,
      connectedSockets: connectedSockets.size,
      socketToUser: socketToUser.size,
      totalUsers: totalUsers,
      activeGames: activeGames,
      startingRooms: roomDetails,
      totalRooms: rooms,
      totalTransactions: totalTransactions,
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      memoryUsage: process.memoryUsage(),
      nodeVersion: process.version,
      telegramReady: true,
      botUsername: '@ethio_games1_bot',
      serverUrl: 'https://bingo-telegram-game.onrender.com',
      realTimeBoxUpdates: 'active',
      boxClearing: 'enabled',
      gameTimer: CONFIG.GAME_TIMER + ' seconds',
      countdownTimer: CONFIG.COUNTDOWN_TIMER + ' seconds',
      minPlayersToStart: CONFIG.MIN_PLAYERS_TO_START + ' player',
      fixedIssues: [
        'claim_bingo_properly_checks_numbers',
        'all_players_return_to_lobby_after_game_ends',
        'game_starts_with_1_player_after_30_seconds',
        'connection_tracking_fixed',
        'game_timer_fixed', 
        'ball_drawing_working', 
        'players_properly_removed_on_leave',
        'countdown_stuck_at_30_seconds_fixed',
        'balls_pop_every_3_seconds',
        '30_second_countdown_working',
        'countdown_continues_when_players_leave',
        'game_starts_with_any_players_at_countdown_0'
      ]
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

// ========== TEST CONNECTIONS ENDPOINT ==========
app.get('/test-connections', (req, res) => {
  const connections = [];
  
  io.sockets.sockets.forEach((socket) => {
    connections.push({
      socketId: socket.id,
      connected: socket.connected,
      userId: socket.userId || 'none',
      handshakeQuery: socket.handshake.query,
      inSocketToUser: socketToUser.has(socket.id)
    });
  });
  
  res.json({
    totalSockets: connections.length,
    connectedSockets: Array.from(connectedSockets).length,
    socketToUserSize: socketToUser.size,
    socketToUserEntries: Array.from(socketToUser.entries()),
    connections: connections,
    getConnectedUsersResult: getConnectedUsers()
  });
});

// ========== DEBUG CONNECTION ENDPOINT ==========
app.get('/debug-connections', async (req, res) => {
  try {
    const connectedUserIds = getConnectedUsers();
    const socketToUserArray = Array.from(socketToUser.entries());
    const connectedSocketsArray = Array.from(connectedSockets);
    
    res.json({
      timestamp: new Date().toISOString(),
      totalConnectedUsers: connectedUserIds.length,
      connectedUserIds: connectedUserIds,
      socketToUserCount: socketToUser.size,
      socketToUser: socketToUserArray.map(([socketId, userId]) => ({ socketId, userId })),
      connectedSocketsCount: connectedSockets.size,
      connectedSockets: connectedSocketsArray.map(socketId => {
        const socket = io.sockets.sockets.get(socketId);
        return {
          socketId,
          connected: socket?.connected || false,
          userId: socketToUser.get(socketId) || socket?.userId || 'unknown',
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

// ========== DEBUG USERS ENDPOINT ==========
app.get('/debug-users', async (req, res) => {
  try {
    const connectedUserIds = getConnectedUsers();
    const allUsers = await User.find({}).limit(100);
    
    const userStatus = allUsers.map(user => {
      const isOnline = connectedUserIds.includes(user.userId);
      const lastSeenTime = new Date(user.lastSeen);
      const now = new Date();
      const secondsSinceLastSeen = (now - lastSeenTime) / 1000;
      
      return {
        userId: user.userId,
        userName: user.userName,
        isOnline: isOnline,
        lastSeen: user.lastSeen,
        secondsSinceLastSeen: Math.floor(secondsSinceLastSeen),
        currentRoom: user.currentRoom,
        balance: user.balance,
        socketId: Array.from(socketToUser.entries())
          .find(([_, uid]) => uid === user.userId)?.[0] || 'none'
      };
    });
    
    res.json({
      timestamp: new Date().toISOString(),
      totalConnectedUsers: connectedUserIds.length,
      connectedUserIds: connectedUserIds,
      socketToUserSize: socketToUser.size,
      connectedSockets: connectedSockets.size,
      allUsers: userStatus
    });
  } catch (error) {
    res.json({ error: error.message });
  }
});

// ========== DEBUG ROOM ENDPOINT ==========
app.get('/debug-room/:stake', async (req, res) => {
  try {
    const stake = parseInt(req.params.stake);
    const room = await Room.findOne({ stake: stake });
    const onlinePlayers = await getOnlinePlayersInRoom(stake);
    
    res.json({
      stake: stake,
      roomExists: !!room,
      roomStatus: room?.status || 'not_found',
      playersInRoom: room?.players?.length || 0,
      onlinePlayers: onlinePlayers.length,
      takenBoxes: room?.takenBoxes?.length || 0,
      countdownActive: roomTimers.has(`countdown_${stake}`),
      gameTimerActive: roomTimers.has(stake),
      roomData: room,
      countdownStartedWith: room?.countdownStartedWith || 0,
      countdownStartTime: room?.countdownStartTime
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ========== DEBUG FORCE START ENDPOINT ==========
app.get('/force-start/:stake', async (req, res) => {
  try {
    const stake = parseInt(req.params.stake);
    const room = await Room.findOne({ stake: stake });
    
    if (room) {
      // Force start game
      room.status = 'playing';
      room.startTime = new Date();
      await room.save();
      
      // Start game timer
      await startGameTimer(room);
      
      // Notify all players
      room.players.forEach(userId => {
        for (const [socketId, uId] of socketToUser.entries()) {
          if (uId === userId) {
            const socket = io.sockets.sockets.get(socketId);
            if (socket) {
              socket.emit('gameStarted', { 
                room: stake,
                players: room.players.length
              });
            }
          }
        }
      });
      
      res.json({ 
        success: true, 
        message: `Forced game start for ${stake} ETB room`,
        players: room.players.length
      });
    } else {
      res.json({ success: false, message: 'Room not found' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ========== DEBUG CALCULATIONS ENDPOINT ==========
app.get('/debug-calculations/:stake/:players', (req, res) => {
  try {
    const stake = parseInt(req.params.stake);
    const players = parseInt(req.params.players);
    
    const commissionPerPlayer = CONFIG.HOUSE_COMMISSION[stake] || 0;
    const contributionPerPlayer = stake - commissionPerPlayer;
    const totalContributions = contributionPerPlayer * players;
    const houseFee = commissionPerPlayer * players;
    const totalCollected = stake * players;
    const potentialPrizeWithBonus = totalContributions + CONFIG.FOUR_CORNERS_BONUS;
    
    res.json({
      stake: stake,
      players: players,
      commissionPerPlayer: commissionPerPlayer,
      contributionPerPlayer: contributionPerPlayer,
      totalContributions: totalContributions,
      houseFee: houseFee,
      totalCollected: totalCollected,
      fourCornersBonus: CONFIG.FOUR_CORNERS_BONUS,
      potentialPrize: totalContributions,
      potentialPrizeWithBonus: potentialPrizeWithBonus,
      breakdown: {
        "Each player pays": stake + " ETB",
        "House commission per player": commissionPerPlayer + " ETB",
        "Contribution to prize pool per player": contributionPerPlayer + " ETB",
        "Total prize pool (base)": totalContributions + " ETB",
        "Four corners bonus": CONFIG.FOUR_CORNERS_BONUS + " ETB",
        "Maximum possible win (four corners)": potentialPrizeWithBonus + " ETB",
        "House earnings": houseFee + " ETB",
        "Total collected from all players": totalCollected + " ETB"
      },
      example_scenarios: [
        {
          scenario: "5 players, no four corners",
          prize: totalContributions,
          per_player_contribution: contributionPerPlayer,
          winner_gets: totalContributions + " ETB",
          house_gets: houseFee + " ETB"
        },
        {
          scenario: "5 players, with four corners",
          prize: totalContributions,
          bonus: CONFIG.FOUR_CORNERS_BONUS,
          total: potentialPrizeWithBonus,
          winner_gets: potentialPrizeWithBonus + " ETB",
          house_gets: houseFee + " ETB (plus pays bonus)"
        },
        {
          scenario: "10 players, no four corners",
          prize: contributionPerPlayer * 10,
          winner_gets: (contributionPerPlayer * 10) + " ETB",
          house_gets: (commissionPerPlayer * 10) + " ETB"
        }
      ]
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
      
      if (text === '/start' || text === '/play') {
        // Check if user exists, create if not
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
        
        // Send welcome message with game button
        await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: `🎮 *Welcome to Bingo Elite, ${userName}!*\n\n` +
                  `💰 Your balance: *${user.balance.toFixed(2)} ETB*\n\n` +
                  `🎯 *Features:*\n` +
                  `• 10/20/50/100 ETB rooms\n` +
                  `• Four Corners Bonus: 50 ETB\n` +
                  `• Real-time multiplayer\n` +
                  `• Real-time box tracking\n` +
                  `• Telegram login\n` +
                  `• Game starts automatically when 1 player joins\n` +
                  `• Timer continues even if players leave\n` +
                  `• Random BINGO card numbers\n` +
                  `• ✅✅✅ Fixed: Claim Bingo now properly checks numbers\n` +
                  `• ✅ Fixed: All players return to lobby after game ends\n` +
                  `• ✅ Fixed: Game starts with 1 player after 30 seconds\n` +
                  `• ✅ Fixed: Game starts properly now!\n\n` +
                  `_Need funds? Contact admin_`,
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
                  `🆔 Your ID: \`${userId}\``,
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
                  `*Commands:*\n` +
                  `/start - Start the bot\n` +
                  `/play - Play game\n` +
                  `/balance - Check balance\n` +
                  `/help - This message\n\n` +
                  `*How to Play:*\n` +
                  `1. Click "Play Now"\n` +
                  `2. Select room (10-100 ETB)\n` +
                  `3. Choose ticket (1-100) - See taken boxes in real-time!\n` +
                  `4. Game starts after 30 seconds with 1 player\n` +
                  `5. Timer continues even if players leave\n` +
                  `6. Mark numbers as called\n` +
                  `7. Claim BINGO! - Game ends and you get your money!\n` +
                  `8. ALL players return to lobby automatically\n\n` +
                  `*Four Corners Bonus:* 50 ETB!\n` +
                  `*Real-time Box Tracking:* See which boxes are taken instantly!\n` +
                  `*Auto Start:* Game starts when 1 online player joins\n` +
                  `*Timer Doesn't Reset:* Game continues even if players leave\n` +
                  `*Random BINGO Cards:* Each card has unique random numbers\n` +
                  `*✅✅✅ Fixed:* Claim Bingo now properly checks numbers\n` +
                  `*✅ Fixed:* All players return to lobby after game ends\n` +
                  `*✅ Fixed:* Game starts with 1 player after 30 seconds\n\n` +
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
    // Set webhook
    const webhookResponse = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/setWebhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: 'https://bingo-telegram-game.onrender.com/telegram-webhook',
        drop_pending_updates: true
      })
    });
    
    const webhookResult = await webhookResponse.json();
    
    // Set menu button
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
            <p><strong>Admin Password:</strong> admin1234</p>
            <p><strong>Real-time Features:</strong> Box tracking, Live updates</p>
            <p><strong>Fixed Issues:</strong> Claim Bingo now properly checks numbers, All players return to lobby, Game starts with 1 player</p>
            <p><strong>✅ 30-second countdown now working</strong></p>
            <p><strong>✅ Balls pop every 3 seconds</strong></p>
            <p><strong>✅ Countdown continues when players leave</strong></p>
            <p><strong>✅ Game starts with 1 player after 30 seconds</strong></p>
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
              <li>Play Bingo with real-time box tracking!</li>
            </ol>
            
            <h4>To Add Funds to Players:</h4>
            <ol>
              <li>Open Admin Panel (link above)</li>
              <li>Login with password: admin1234</li>
              <li>Find user by Telegram ID</li>
              <li>Click "Add Funds" button</li>
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

// ========== START SERVER ==========
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════════════╗
║             🤖 BINGO ELITE - TELEGRAM READY         ║
╠══════════════════════════════════════════════════════╣
║  URL:          https://bingo-telegram-game.onrender.com ║
║  Port:         ${PORT}                                ║
║  Game:         /game                                 ║
║  Admin:        /admin (password: admin1234)         ║
║  Telegram:     /telegram                             ║
║  Bot Setup:    /setup-telegram                       ║
║  Real-Time:    /real-time-status                     ║
║  Debug:        /debug-connections                    ║
║  Debug Users:  /debug-users                          ║
║  Debug Room:   /debug-room/:stake                    ║
║  Force Start:  /force-start/:stake                   ║
║  Test:         /test-connections                     ║
╠══════════════════════════════════════════════════════╣
║  🔑 Admin Password: ${process.env.ADMIN_PASSWORD || 'admin1234'} ║
║  🤖 Telegram Bot: @ethio_games1_bot                 ║
║  🤖 Bot Token: ${TELEGRAM_TOKEN.substring(0, 10)}... ║
║  📡 WebSocket: ✅ Ready for Telegram connections    ║
║  🎮 Four Corners Bonus: ${CONFIG.FOUR_CORNERS_BONUS} ETB       ║
║  📦 Real-time Box Tracking: ✅ ACTIVE               ║
║  🧹 Box Clearing After Game: ✅ IMPLEMENTED         ║
║  🚀 FIXES: ✅ Game timer working                    ║
║         ✅ Ball drawing fixed (every 3 seconds)     ║
║         ✅ Players properly removed when leaving    ║
║         ✅✅ 30-SECOND COUNTDOWN NOW WORKING        ║
║         ✅✅ BALLS POP EVERY 3 SECONDS WORKING      ║
║         ✅✅ COUNTDOWN CONTINUES WHEN PLAYERS LEAVE ║
║         ✅✅ GAME STARTS WITH 1 PLAYER AFTER 30 SECONDS ║
║         ✅✅✅✅ CLAIM BINGO NOW PROPERLY CHECKS NUMBERS ║
║         ✅✅✅ ALL PLAYERS RETURN TO LOBBY AFTER GAME ENDS ║
╚══════════════════════════════════════════════════════╝
✅ Server ready for REAL-TIME tracking and Telegram Mini App
  `);
  
  // Initial broadcast
  setTimeout(() => {
    broadcastRoomStatus();
  }, 1000);
  
  // Setup Telegram bot after server starts
  setTimeout(async () => {
    try {
      // Auto-setup Telegram webhook if token exists
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
