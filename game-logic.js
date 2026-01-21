// game-logic.js - BINGO ELITE GAME LOGIC MODULE

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
  TELEBIRR_NUMBER: process.env.TELEBIRR_NUMBER || "0962577855",
  MIN_WITHDRAWAL: 50,
  MAX_WITHDRAWAL: 10000
};

// ========== GLOBAL STATE ==========
let io;
let models;
let socketToUser = new Map();
let adminSockets = new Set();
let activityLog = [];
let roomTimers = new Map();
let connectedSockets = new Set();
let roomSubscriptions = new Map();
let processingClaims = new Map();
let telebirrNumber = CONFIG.TELEBIRR_NUMBER; // Mutable Telebirr number

// ========== INITIALIZATION FUNCTION ==========
async function initialize(socketIo, dbModels) {
  io = socketIo;
  models = dbModels;
  
  // Load Telebirr number from database on startup
  await loadTelebirrNumberFromDB();
  
  // Set up Socket.IO event handlers
  setupSocketHandlers();
  
  // Start periodic tasks
  startPeriodicTasks();
  
  console.log('✅ Game logic initialized');
  console.log(`📱 Telebirr number loaded: ${telebirrNumber}`);
}

// ========== TELEBIRR NUMBER DATABASE PERSISTENCE ==========
async function loadTelebirrNumberFromDB() {
  try {
    // Check if we have a Config model (for storing settings)
    if (models.Config) {
      const config = await models.Config.findOne({ key: 'telebirr_number' });
      if (config) {
        telebirrNumber = config.value;
        console.log(`📱 Loaded Telebirr number from database: ${telebirrNumber}`);
      } else {
        // Save default to database
        const newConfig = new models.Config({
          key: 'telebirr_number',
          value: telebirrNumber,
          updatedAt: new Date()
        });
        await newConfig.save();
        console.log(`📱 Saved default Telebirr number to database: ${telebirrNumber}`);
      }
    } else {
      // If no Config model, create one
      const configSchema = new mongoose.Schema({
        key: { type: String, required: true, unique: true },
        value: { type: String, required: true },
        updatedAt: { type: Date, default: Date.now }
      });
      
      models.Config = mongoose.model('Config', configSchema);
      
      // Try to load again
      const config = await models.Config.findOne({ key: 'telebirr_number' });
      if (config) {
        telebirrNumber = config.value;
      } else {
        const newConfig = new models.Config({
          key: 'telebirr_number',
          value: telebirrNumber,
          updatedAt: new Date()
        });
        await newConfig.save();
      }
    }
  } catch (error) {
    console.error('❌ Error loading Telebirr number from database:', error);
    // Keep using default from CONFIG
    telebirrNumber = CONFIG.TELEBIRR_NUMBER;
  }
}

async function saveTelebirrNumberToDB() {
  try {
    if (models.Config) {
      await models.Config.findOneAndUpdate(
        { key: 'telebirr_number' },
        { 
          value: telebirrNumber,
          updatedAt: new Date()
        },
        { upsert: true, new: true }
      );
      console.log(`📱 Saved Telebirr number to database: ${telebirrNumber}`);
      return true;
    }
  } catch (error) {
    console.error('❌ Error saving Telebirr number to database:', error);
    return false;
  }
}

// ========== REAL-TIME BOX TRACKING FUNCTIONS ==========
function broadcastTakenBoxes(roomStake, takenBoxes, newBox = null, playerName = null) {
  if (!io) return;
  
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

// Clear stale processing claims
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

// ========== TELEBIRR NUMBER MANAGEMENT ==========
function getTelebirrNumber() {
  return telebirrNumber;
}

async function updateTelebirrNumber(newNumber, adminSocketId) {
  const oldNumber = telebirrNumber;
  telebirrNumber = newNumber;
  
  // Save to database
  const saved = await saveTelebirrNumberToDB();
  
  if (saved) {
    console.log(`📱 Telebirr number updated: ${oldNumber} -> ${newNumber} by admin ${adminSocketId}`);
    
    // Broadcast to all admin panels
    adminSockets.forEach(socketId => {
      const socket = io.sockets.sockets.get(socketId);
      if (socket) {
        socket.emit('admin:telebirrNumberUpdated', { 
          telebirrNumber: newNumber,
          updatedBy: adminSocketId,
          timestamp: new Date().toISOString()
        });
      }
    });
    
    // Broadcast to all players
    io.emit('telebirrNumberUpdate', {
      telebirrNumber: newNumber,
      timestamp: new Date().toISOString()
    });
    
    logActivity('TELEBIRR_NUMBER_UPDATE', { 
      adminSocketId: adminSocketId,
      oldNumber: oldNumber,
      newNumber: newNumber
    }, adminSocketId);
    
    return {
      success: true,
      message: `Telebirr number updated from ${oldNumber} to ${newNumber}`,
      oldNumber: oldNumber,
      newNumber: newNumber
    };
  } else {
    // Revert if save failed
    telebirrNumber = oldNumber;
    return {
      success: false,
      message: 'Failed to save Telebirr number to database',
      oldNumber: oldNumber,
      newNumber: oldNumber
    };
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
    let user = await models.User.findOne({ userId: userId });
    
    if (!user) {
      user = new models.User({
        userId: userId,
        userName: userName || 'Guest',
        balance: CONFIG.INITIAL_BALANCE,
        referralCode: generateReferralCode(userId),
        telegramId: userId.startsWith('tg_') ? userId.replace('tg_', '') : null
      });
      await user.save();
      
      // Record first transaction
      const transaction = new models.Transaction({
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
    let room = await models.Room.findOne({ stake: stake, status: { $in: ['waiting', 'starting', 'playing'] } });
    
    if (!room) {
      room = new models.Room({
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
  
  // Get from socketToUser map
  socketToUser.forEach((userId, socketId) => {
    const socket = io.sockets.sockets.get(socketId);
    if (socket && socket.connected) {
      connectedUsers.add(userId);
    }
  });
  
  // Also check ALL connected sockets
  io.sockets.sockets.forEach((socket) => {
    if (socket && socket.connected && socket.userId && socket.userId !== 'pending') {
      connectedUsers.add(socket.userId);
    }
  });
  
  return Array.from(connectedUsers);
}

// Function to get online players in a specific room
async function getOnlinePlayersInRoom(roomStake) {
  try {
    const room = await models.Room.findOne({ stake: roomStake });
    if (!room) return [];
    
    const onlinePlayers = [];
    const connectedUserIds = getConnectedUsers();
    
    // Check each player in the room
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
    const rooms = await models.Room.find({ status: { $in: ['waiting', 'starting', 'playing'] } });
    const roomStatus = {};
    
    for (const room of rooms) {
      const onlinePlayers = await getOnlinePlayersInRoom(room.stake);
      const commissionPerPlayer = CONFIG.HOUSE_COMMISSION[room.stake] || 0;
      const contributionPerPlayer = room.stake - commissionPerPlayer;
      const potentialPrize = contributionPerPlayer * onlinePlayers.length;
      const houseFee = commissionPerPlayer * onlinePlayers.length;
      const potentialPrizeWithBonus = potentialPrize + CONFIG.FOUR_CORNERS_BONUS;
      
      // Mark room as locked if game is playing
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
    const activeGames = await models.Room.countDocuments({ status: 'playing' });
    
    // Get all users
    const users = await models.User.find({}).sort({ balance: -1 }).limit(100);
    
    // Get connected user IDs for real-time status
    const connectedUserIds = getConnectedUsers();
    
    // Count sockets per user
    const userSocketCount = {};
    socketToUser.forEach((userId, socketId) => {
      const socket = io.sockets.sockets.get(socketId);
      if (socket && socket.connected) {
        userSocketCount[userId] = (userSocketCount[userId] || 0) + 1;
      }
    });
    
    // Also count from all connected sockets
    io.sockets.sockets.forEach((socket) => {
      if (socket && socket.connected && socket.userId && socket.userId !== 'pending') {
        const userId = socket.userId;
        userSocketCount[userId] = (userSocketCount[userId] || 0) + 1;
      }
    });
    
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
        isOnline: isOnline,
        socketCount: userSocketCount[user.userId] || 0,
        totalWagered: user.totalWagered || 0,
        totalWins: user.totalWins || 0,
        totalBingos: user.totalBingos || 0,
        lastSeen: user.lastSeen,
        telegramId: user.telegramId || '',
        phoneNumber: user.phoneNumber || '',
        joinedAt: user.joinedAt,
        sessionCount: user.sessionCount || 1
      };
    });
    
    // Get room data
    const roomsData = {};
    const rooms = await models.Room.find({ status: { $in: ['waiting', 'starting', 'playing'] } });
    
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
    
    // Calculate house earnings (only from HOUSE_EARNINGS transactions)
    const houseEarnings = await models.Transaction.aggregate([
      { $match: { type: 'HOUSE_EARNINGS' } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]).then(result => result[0]?.total || 0);
    
    // Calculate total wagered (all negative transactions except ADMIN_ADD and HOUSE_EARNINGS)
    const totalWagered = await models.Transaction.aggregate([
      { $match: { 
        type: { $nin: ['NEW_USER', 'ADMIN_ADD', 'HOUSE_EARNINGS'] },
        amount: { $lt: 0 }
      } },
      { $group: { _id: null, total: { $sum: { $abs: '$amount' } } } }
    ]).then(result => result[0]?.total || 0);
    
    // Calculate total wins (all positive transactions except ADMIN_ADD)
    const totalWins = await models.Transaction.aggregate([
      { $match: { 
        type: { $nin: ['ADMIN_ADD', 'HOUSE_EARNINGS'] },
        amount: { $gt: 0 }
      } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]).then(result => result[0]?.total || 0);
    
    // Calculate total bingos
    const totalBingos = await models.Transaction.countDocuments({ 
      type: { $in: ['WIN', 'WIN_FOUR_CORNERS'] } 
    });
    
    // Get real-time connected sockets count
    const connectedSocketsCount = connectedSockets.size;
    
    // Count users with multiple sockets
    const multiSocketUsers = Object.values(userSocketCount).filter(count => count > 1).length;
    
    // Send to all admin sockets
    const adminData = {
      totalPlayers: connectedPlayers,
      activeGames: activeGames,
      totalUsers: users.length,
      connectedSockets: connectedSocketsCount,
      houseEarnings: houseEarnings,
      totalWagered: totalWagered,
      totalWins: totalWins,
      totalBingos: totalBingos,
      timestamp: new Date().toISOString(),
      serverUptime: process.uptime(),
      gameTimeoutMinutes: CONFIG.GAME_TIMEOUT_MINUTES,
      multiSocketUsers: multiSocketUsers,
      telebirrNumber: telebirrNumber // ADDED: Include Telebirr number
    };
    
    adminSockets.forEach(socketId => {
      const socket = io.sockets.sockets.get(socketId);
      if (socket) {
        socket.emit('admin:update', adminData);
        socket.emit('admin:players', userArray);
        socket.emit('admin:rooms', roomsData);
        
        // Send recent transactions
        models.Transaction.find().sort({ createdAt: -1 }).limit(50)
          .then(transactions => {
            socket.emit('admin:transactions', transactions);
          })
          .catch(err => console.error('Error fetching transactions:', err));
      }
    });
    
    console.log(`📊 Admin Panel Updated: ${connectedPlayers} players online, ${activeGames} active games, House Earnings: ${houseEarnings} ETB, Telebirr: ${telebirrNumber}`);
    
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

// ========== AUTO-CLEAR LONG RUNNING GAMES (7 MINUTES) ==========
async function cleanupLongRunningGames() {
  try {
    const sevenMinutesAgo = new Date(Date.now() - CONFIG.GAME_TIMEOUT_MINUTES * 60 * 1000);
    const longRunningRooms = await models.Room.find({
      status: 'playing',
      startTime: { $lt: sevenMinutesAgo }
    });
    
    for (const room of longRunningRooms) {
      console.log(`⏰ Room ${room.stake} has been playing for ${CONFIG.GAME_TIMEOUT_MINUTES}+ minutes. Auto-ending...`);
      
      // Clear game timer
      cleanupRoomTimer(room.stake);
      
      // Store players list
      const playersInRoom = [...room.players];
      
      // Return funds to all players
      for (const userId of playersInRoom) {
        const user = await models.User.findOne({ userId: userId });
        if (user) {
          const oldBalance = user.balance;
          user.balance += room.stake;
          user.currentRoom = null;
          user.box = null;
          await user.save();
          
          console.log(`💰 Auto-refunded ${room.stake} ETB to ${user.userName} after ${CONFIG.GAME_TIMEOUT_MINUTES}min timeout`);
          
          // Record transaction
          const transaction = new models.Transaction({
            type: 'TIMEOUT_REFUND',
            userId: userId,
            userName: user.userName,
            amount: room.stake,
            room: room.stake,
            description: `Game auto-ended after ${CONFIG.GAME_TIMEOUT_MINUTES} minutes - stake refunded`
          });
          await transaction.save();
          
          // Notify player if online
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
      
      // Clear room data
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
      
      console.log(`✅ Auto-cleared room ${room.stake} after ${CONFIG.GAME_TIMEOUT_MINUTES} minutes`);
    }
  } catch (error) {
    console.error('❌ Error in cleanupLongRunningGames:', error);
  }
}

// ========== FIXED GAME TIMER FUNCTION ==========
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
      const currentRoom = await models.Room.findById(room._id);
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
      
      // Send to ALL players in the room
      console.log(`📤 Broadcasting ball ${letter}-${ball} to ${currentRoom.players.length} players in room ${room.stake}`);
      
      // Send to all players in the room
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
  }, CONFIG.GAME_TIMER * 1000);
  
  roomTimers.set(room.stake, timer);
  console.log(`✅ Game timer started for room ${room.stake}, interval: ${CONFIG.GAME_TIMER}s`);
}

// ✅✅✅ FIXED: Check if a player has bingo
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
      
      // Handle FREE space
      if (cellValue === 'FREE') {
        const hasFree = markedNumbers.includes('FREE') || markedNumbers.some(m => m === 'FREE');
        return hasFree;
      }
      
      // Check if the number is in markedNumbers
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
      const user = await models.User.findOne({ userId: userId });
      if (user) {
        const oldBalance = user.balance;
        user.balance += room.stake;
        user.currentRoom = null;
        user.box = null;
        await user.save();
        
        console.log(`💰 Refunded ${room.stake} ETB to ${user.userName}, balance: ${oldBalance} → ${user.balance}`);
        
        // Record transaction
        const transaction = new models.Transaction({
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

// ========== FIXED COUNTDOWN FUNCTION - AUTO STARTS GAME ==========
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
    room.countdownStartedWith = room.players.length;
    await room.save();
    
    let countdown = CONFIG.COUNTDOWN_TIMER;
    const countdownInterval = setInterval(async () => {
      try {
        // Get fresh room data
        const currentRoom = await models.Room.findById(room._id);
        if (!currentRoom || currentRoom.status !== 'starting') {
          console.log(`⏹️ Countdown stopped: Room ${room.stake} status changed to ${currentRoom?.status || 'deleted'}`);
          clearInterval(countdownInterval);
          roomTimers.delete(countdownKey);
          return;
        }
        
        // Get online players
        const onlinePlayers = await getOnlinePlayersInRoom(room.stake);
        
        // Send countdown to ALL players in room AND subscribed sockets
        console.log(`⏱️ Room ${room.stake}: Countdown ${countdown}s, ${onlinePlayers.length} online players`);
        
        // Send to ALL players in the room AND subscribed sockets
        const socketsToSend = new Set();
        
        // Add sockets of players in the room
        currentRoom.players.forEach(userId => {
          for (const [socketId, uId] of socketToUser.entries()) {
            if (uId === userId) {
              if (io.sockets.sockets.get(socketId)?.connected) {
                socketsToSend.add(socketId);
              }
            }
          }
        });
        
        // Add subscribed sockets (for discovery overlay)
        const subscribedSockets = roomSubscriptions.get(room.stake) || new Set();
        subscribedSockets.forEach(socketId => {
          if (io.sockets.sockets.get(socketId)?.connected) {
            socketsToSend.add(socketId);
          }
        });
        
        // Send to all collected sockets
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
          const finalRoom = await models.Room.findById(room._id);
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
            
            // Notify ALL players in the room AND subscribed sockets
            const finalSocketsToSend = new Set();
            
            // Add sockets of players in the room
            finalRoom.players.forEach(userId => {
              for (const [socketId, uId] of socketToUser.entries()) {
                if (uId === userId) {
                  if (io.sockets.sockets.get(socketId)?.connected) {
                    finalSocketsToSend.add(socketId);
                  }
                }
              }
            });
            
            // Add subscribed sockets
            const finalSubscribedSockets = roomSubscriptions.get(room.stake) || new Set();
            finalSubscribedSockets.forEach(socketId => {
              if (io.sockets.sockets.get(socketId)?.connected) {
                finalSocketsToSend.add(socketId);
              }
            });
            
            // Send game started event
            finalSocketsToSend.forEach(socketId => {
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
            const resetSocketsToSend = new Set();
            
            // Add sockets of players in the room
            finalRoom.players.forEach(userId => {
              for (const [socketId, uId] of socketToUser.entries()) {
                if (uId === userId) {
                  if (io.sockets.sockets.get(socketId)?.connected) {
                    resetSocketsToSend.add(socketId);
                  }
                }
              }
            });
            
            // Add subscribed sockets
            const resetSubscribedSockets = roomSubscriptions.get(room.stake) || new Set();
            resetSubscribedSockets.forEach(socketId => {
              if (io.sockets.sockets.get(socketId)?.connected) {
                resetSocketsToSend.add(socketId);
              }
            });
            
            // Send reset notifications
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

// ========== CLEANUP STUCK COUNTDOWNS ==========
async function cleanupStuckCountdowns() {
  try {
    const now = new Date();
    const rooms = await models.Room.find({ status: 'starting' });
    
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
          
          // Notify all subscribed sockets and players
          const socketsToSend = new Set();
          
          // Add sockets of players in the room
          room.players.forEach(userId => {
            for (const [socketId, uId] of socketToUser.entries()) {
              if (uId === userId) {
                if (io.sockets.sockets.get(socketId)?.connected) {
                  socketsToSend.add(socketId);
                }
              }
            }
          });
          
          // Add subscribed sockets
          const subscribedSockets = roomSubscriptions.get(room.stake) || new Set();
          subscribedSockets.forEach(socketId => {
            if (io.sockets.sockets.get(socketId)?.connected) {
              socketsToSend.add(socketId);
            }
          });
          
          // Send notifications
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

// ========== ROOM CLEANUP FUNCTION ==========
async function cleanupStaleRooms() {
  try {
    const oneHourAgo = new Date(Date.now() - 3600000);
    
    const staleRooms = await models.Room.find({
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
        await models.Room.deleteOne({ _id: room._id });
        console.log(`🗑️ Deleted stale room from database: ${room.stake} ETB`);
      }
    }
    
    // Also clean up rooms with status 'playing' but no players for a while
    const emptyPlayingRooms = await models.Room.find({
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

// ========== CONNECTION CLEANUP FUNCTION ==========
async function cleanupStaleConnections() {
  console.log('🧹 Running connection cleanup...');
  
  const now = new Date();
  const thirtySecondsAgo = new Date(now.getTime() - 30000);
  
  try {
    // Update users who haven't been seen in 30 seconds
    await models.User.updateMany(
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

// ========== NEW: RESET HOUSE EARNINGS FUNCTION ==========
async function resetHouseEarnings(adminSocketId) {
  try {
    console.log('💰 Attempting to reset house earnings...');
    
    // Calculate current house earnings
    const currentEarnings = await models.Transaction.aggregate([
      { $match: { type: 'HOUSE_EARNINGS' } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]).then(result => result[0]?.total || 0);
    
    if (currentEarnings === 0) {
      return {
        success: false,
        message: 'House earnings are already at zero'
      };
    }
    
    // Create a reset transaction that negates the current earnings
    const resetTransaction = new models.Transaction({
      type: 'HOUSE_EARNINGS_RESET',
      userId: 'ADMIN',
      userName: 'Admin',
      amount: -currentEarnings,
      description: `House earnings reset by admin (was ${currentEarnings.toFixed(2)} ETB)`,
      adminSocketId: adminSocketId,
      timestamp: new Date()
    });
    
    await resetTransaction.save();
    
    console.log(`✅ House earnings reset from ${currentEarnings.toFixed(2)} to 0 ETB`);
    
    // Notify admin
    const adminSocket = io.sockets.sockets.get(adminSocketId);
    if (adminSocket) {
      adminSocket.emit('admin:houseEarningsReset', {
        previousAmount: currentEarnings.toFixed(2),
        newAmount: 0,
        timestamp: new Date().toISOString()
      });
    }
    
    // Update admin panel
    updateAdminPanel();
    
    logActivity('HOUSE_EARNINGS_RESET', { 
      adminSocketId: adminSocketId,
      previousAmount: currentEarnings.toFixed(2),
      newAmount: 0
    }, adminSocketId);
    
    return {
      success: true,
      message: `House earnings reset from ${currentEarnings.toFixed(2)} to 0 ETB`,
      previousAmount: currentEarnings
    };
    
  } catch (error) {
    console.error('❌ Error resetting house earnings:', error);
    
    // Notify admin of error
    const adminSocket = io.sockets.sockets.get(adminSocketId);
    if (adminSocket) {
      adminSocket.emit('admin:houseEarningsResetError', error.message);
    }
    
    return {
      success: false,
      message: 'Failed to reset house earnings: ' + error.message
    };
  }
}

// ========== NEW: DISCONNECT USER FUNCTION ==========
async function disconnectUser(userId, adminSocketId) {
  try {
    console.log(`🔌 Disconnecting all sockets for user ${userId}`);
    
    let disconnectedCount = 0;
    
    // Find all sockets for this user from socketToUser map
    socketToUser.forEach((uId, socketId) => {
      if (uId === userId) {
        const socket = io.sockets.sockets.get(socketId);
        if (socket && socket.connected) {
          socket.disconnect();
          disconnectedCount++;
          console.log(`🔌 Disconnected socket ${socketId} for user ${userId}`);
        }
      }
    });
    
    // Also check all connected sockets
    io.sockets.sockets.forEach((socket) => {
      if (socket && socket.connected && socket.userId === userId) {
        socket.disconnect();
        disconnectedCount++;
        console.log(`🔌 Disconnected socket ${socket.id} for user ${userId}`);
      }
    });
    
    logActivity('ADMIN_DISCONNECT_USER', { 
      adminSocketId: adminSocketId,
      userId: userId,
      disconnectedSockets: disconnectedCount
    }, adminSocketId);
    
    return {
      success: true,
      message: `Disconnected ${disconnectedCount} socket(s) for user ${userId}`,
      disconnectedCount: disconnectedCount
    };
    
  } catch (error) {
    console.error('❌ Error disconnecting user:', error);
    return {
      success: false,
      message: 'Failed to disconnect user: ' + error.message
    };
  }
}

// ========== SOCKET.IO EVENT HANDLERS ==========
function setupSocketHandlers() {
  io.on('connection', (socket) => {
    console.log(`✅ Socket.IO Connected: ${socket.id} - User: ${socket.handshake.query?.userId || 'Unknown'}`);
    connectedSockets.add(socket.id);
    
    // Enhanced connection tracking
    const query = socket.handshake.query;
    if (query.userId) {
      console.log(`👤 User connected via query: ${query.userId}`);
      socket.userId = query.userId;
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
    
    // ========== NEW: TELEBIRR NUMBER MANAGEMENT ==========
    socket.on('admin:getTelebirrNumber', () => {
      if (!adminSockets.has(socket.id)) {
        socket.emit('admin:error', 'Unauthorized');
        return;
      }
      
      socket.emit('admin:telebirrNumber', telebirrNumber);
      console.log(`📱 Sent Telebirr number to admin ${socket.id}: ${telebirrNumber}`);
    });
    
    socket.on('admin:updateTelebirrNumber', async (newNumber) => {
      if (!adminSockets.has(socket.id)) {
        socket.emit('admin:error', 'Unauthorized');
        return;
      }
      
      if (!newNumber || newNumber.trim() === '') {
        socket.emit('admin:error', 'Telebirr number cannot be empty');
        return;
      }
      
      // Validate Ethiopian phone number format
      const ethPhoneRegex = /^(09[0-9]{8})$/;
      if (!ethPhoneRegex.test(newNumber)) {
        socket.emit('admin:warning', 'Phone number should be in Ethiopian format (09xxxxxxxx)');
        // Continue anyway, just warn
      }
      
      const result = await updateTelebirrNumber(newNumber.trim(), socket.id);
      
      if (!result.success) {
        socket.emit('admin:error', result.message);
      } else {
        socket.emit('admin:success', result.message);
      }
    });
    
    // ========== HOUSE EARNINGS RESET ==========
    socket.on('admin:resetHouseEarnings', async () => {
      if (!adminSockets.has(socket.id)) {
        socket.emit('admin:error', 'Unauthorized');
        return;
      }
      
      const result = await resetHouseEarnings(socket.id);
      
      if (!result.success) {
        socket.emit('admin:error', result.message);
      } else {
        socket.emit('admin:success', result.message);
      }
    });
    
    // ========== DISCONNECT USER ==========
    socket.on('admin:disconnectUser', async (userId) => {
      if (!adminSockets.has(socket.id)) {
        socket.emit('admin:error', 'Unauthorized');
        return;
      }
      
      const result = await disconnectUser(userId, socket.id);
      
      if (!result.success) {
        socket.emit('admin:error', result.message);
      } else {
        socket.emit('admin:success', result.message);
      }
      
      // Update admin panel after disconnecting
      updateAdminPanel();
    });
    
    socket.on('admin:addFunds', async ({ userId, amount }) => {
      if (!adminSockets.has(socket.id)) {
        socket.emit('admin:error', 'Unauthorized');
        return;
      }
      
      const user = await models.User.findOne({ userId: userId });
      if (!user) {
        socket.emit('admin:error', 'User not found');
        return;
      }
      
      const oldBalance = user.balance;
      user.balance += parseFloat(amount);
      await user.save();
      
      // Record transaction
      const transaction = new models.Transaction({
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
    
    socket.on('admin:approveDeposit', async (transactionId) => {
      if (!adminSockets.has(socket.id)) {
        socket.emit('admin:error', 'Unauthorized');
        return;
      }
      
      try {
        const transaction = await models.Transaction.findOne({ _id: transactionId, type: 'DEPOSIT_REQUEST', status: 'pending' });
        if (!transaction) {
          socket.emit('admin:error', 'Transaction not found or already processed');
          return;
        }
        
        const user = await models.User.findOne({ userId: transaction.userId });
        if (!user) {
          socket.emit('admin:error', 'User not found');
          return;
        }
        
        // Update user balance
        const oldBalance = user.balance;
        user.balance += transaction.amount;
        await user.save();
        
        // Update transaction status
        transaction.status = 'approved';
        transaction.approvedBy = socket.id;
        transaction.approvedAt = new Date();
        transaction.description = `Deposit approved by admin - Receipt: ${transaction.receiptNumber}`;
        await transaction.save();
        
        // Notify user
        for (const [sId, uId] of socketToUser.entries()) {
          if (uId === transaction.userId) {
            const playerSocket = io.sockets.sockets.get(sId);
            if (playerSocket) {
              playerSocket.emit('balanceUpdate', user.balance);
              playerSocket.emit('wallet:depositApproved', {
                amount: transaction.amount,
                newBalance: user.balance,
                message: `Deposit of ${transaction.amount} ETB approved by admin`
              });
            }
          }
        }
        
        socket.emit('admin:success', `Approved deposit of ${transaction.amount} ETB for ${user.userName}`);
        updateAdminPanel();
        
        logActivity('ADMIN_APPROVE_DEPOSIT', { 
          adminSocket: socket.id, 
          userId: user.userId, 
          amount: transaction.amount,
          receiptNumber: transaction.receiptNumber 
        }, socket.id);
        
      } catch (error) {
        console.error('Error approving deposit:', error);
        socket.emit('admin:error', 'Error approving deposit: ' + error.message);
      }
    });
    
    socket.on('admin:approveWithdrawal', async (transactionId) => {
      if (!adminSockets.has(socket.id)) {
        socket.emit('admin:error', 'Unauthorized');
        return;
      }
      
      try {
        const transaction = await models.Transaction.findOne({ _id: transactionId, type: 'WITHDRAW_REQUEST', status: 'pending' });
        if (!transaction) {
          socket.emit('admin:error', 'Transaction not found or already processed');
          return;
        }
        
        const user = await models.User.findOne({ userId: transaction.userId });
        if (!user) {
          socket.emit('admin:error', 'User not found');
          return;
        }
        
        // Check if user has enough balance (should be already checked, but double-check)
        if (user.balance < Math.abs(transaction.amount)) {
          socket.emit('admin:error', 'User has insufficient balance');
          return;
        }
        
        // Update user balance (amount is negative for withdrawal)
        const oldBalance = user.balance;
        user.balance += transaction.amount; // Add negative amount
        await user.save();
        
        // Update user phone number if not set
        if (!user.phoneNumber && transaction.phoneNumber) {
          user.phoneNumber = transaction.phoneNumber;
          await user.save();
        }
        
        // Update transaction status
        transaction.status = 'approved';
        transaction.approvedBy = socket.id;
        transaction.approvedAt = new Date();
        transaction.description = `Withdrawal approved by admin - Sent to: ${transaction.phoneNumber}`;
        await transaction.save();
        
        // Create a separate transaction for the actual withdrawal
        const withdrawalTransaction = new models.Transaction({
          type: 'WITHDRAWAL',
          userId: transaction.userId,
          userName: transaction.userName,
          amount: transaction.amount, // Negative
          phoneNumber: transaction.phoneNumber,
          description: `Withdrawal of ${Math.abs(transaction.amount)} ETB sent to ${transaction.phoneNumber}`
        });
        await withdrawalTransaction.save();
        
        // Notify user
        for (const [sId, uId] of socketToUser.entries()) {
          if (uId === transaction.userId) {
            const playerSocket = io.sockets.sockets.get(sId);
            if (playerSocket) {
              playerSocket.emit('balanceUpdate', user.balance);
              playerSocket.emit('wallet:withdrawalApproved', {
                amount: Math.abs(transaction.amount),
                phoneNumber: transaction.phoneNumber,
                newBalance: user.balance,
                message: `Withdrawal of ${Math.abs(transaction.amount)} ETB approved and sent to ${transaction.phoneNumber}`
              });
            }
          }
        }
        
        socket.emit('admin:success', `Approved withdrawal of ${Math.abs(transaction.amount)} ETB for ${user.userName} to ${transaction.phoneNumber}`);
        updateAdminPanel();
        
        logActivity('ADMIN_APPROVE_WITHDRAWAL', { 
          adminSocket: socket.id, 
          userId: user.userId, 
          amount: Math.abs(transaction.amount),
          phoneNumber: transaction.phoneNumber 
        }, socket.id);
        
      } catch (error) {
        console.error('Error approving withdrawal:', error);
        socket.emit('admin:error', 'Error approving withdrawal: ' + error.message);
      }
    });
    
    socket.on('admin:rejectTransaction', async (transactionId) => {
      if (!adminSockets.has(socket.id)) {
        socket.emit('admin:error', 'Unauthorized');
        return;
      }
      
      try {
        const transaction = await models.Transaction.findOne({ _id: transactionId, status: 'pending' });
        if (!transaction) {
          socket.emit('admin:error', 'Transaction not found or already processed');
          return;
        }
        
        // Update transaction status
        transaction.status = 'rejected';
        transaction.approvedBy = socket.id;
        transaction.approvedAt = new Date();
        transaction.description = `${transaction.description} - Rejected by admin`;
        await transaction.save();
        
        // Notify user if online
        for (const [sId, uId] of socketToUser.entries()) {
          if (uId === transaction.userId) {
            const playerSocket = io.sockets.sockets.get(sId);
            if (playerSocket) {
              if (transaction.type === 'DEPOSIT_REQUEST') {
                playerSocket.emit('wallet:depositRejected', {
                  amount: transaction.amount,
                  message: 'Deposit request rejected by admin. Please contact support.'
                });
              } else if (transaction.type === 'WITHDRAW_REQUEST') {
                playerSocket.emit('wallet:withdrawalRejected', {
                  amount: Math.abs(transaction.amount),
                  message: 'Withdrawal request rejected by admin. Please contact support.'
                });
              }
            }
          }
        }
        
        socket.emit('admin:success', `Rejected ${transaction.type} for ${transaction.userName}`);
        updateAdminPanel();
        
        logActivity('ADMIN_REJECT_TRANSACTION', { 
          adminSocket: socket.id, 
          userId: transaction.userId, 
          transactionId: transactionId,
          type: transaction.type 
        }, socket.id);
        
      } catch (error) {
        console.error('Error rejecting transaction:', error);
        socket.emit('admin:error', 'Error rejecting transaction: ' + error.message);
      }
    });
    
    socket.on('admin:getPendingTransactions', async () => {
      if (!adminSockets.has(socket.id)) {
        socket.emit('admin:error', 'Unauthorized');
        return;
      }
      
      try {
        const pendingTransactions = await models.Transaction.find({ 
          status: 'pending',
          type: { $in: ['DEPOSIT_REQUEST', 'WITHDRAW_REQUEST'] }
        }).sort({ createdAt: -1 });
        
        socket.emit('admin:pendingTransactions', pendingTransactions);
      } catch (error) {
        console.error('Error getting pending transactions:', error);
        socket.emit('admin:error', 'Error getting pending transactions');
      }
    });
    
    socket.on('admin:forceDraw', async (roomStake) => {
      if (!adminSockets.has(socket.id)) {
        socket.emit('admin:error', 'Unauthorized');
        return;
      }
      
      const room = await models.Room.findOne({ stake: parseInt(roomStake), status: 'playing' });
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
      
      const user = await models.User.findOne({ userId: userId });
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
      
      const room = await models.Room.findOne({ stake: parseInt(roomStake) });
      if (room) {
        // Force start game immediately
        room.status = 'playing';
        room.startTime = new Date();
        await room.save();
        
        // Start game timer
        await startGameTimer(room);
        
        // Notify all players in room AND subscribed sockets
        const socketsToSend = new Set();
        
        // Add sockets of players in the room
        room.players.forEach(userId => {
          for (const [sId, uId] of socketToUser.entries()) {
            if (uId === userId) {
              if (io.sockets.sockets.get(sId)?.connected) {
                socketsToSend.add(sId);
              }
            }
          }
        });
        
        // Add subscribed sockets
        const subscribedSockets = roomSubscriptions.get(room.stake) || new Set();
        subscribedSockets.forEach(socketId => {
          if (io.sockets.sockets.get(socketId)?.connected) {
            socketsToSend.add(socketId);
          }
        });
        
        // Send game started event
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
      
      const room = await models.Room.findOne({ stake: parseInt(roomStake) });
      if (room) {
        // Clear game timer
        cleanupRoomTimer(roomStake);
        
        // Store players list before clearing
        const playersInRoom = [...room.players];
        
        // Return funds to all players
        for (const userId of playersInRoom) {
          const user = await models.User.findOne({ userId: userId });
          if (user) {
            user.balance += roomStake;
            user.currentRoom = null;
            user.box = null;
            await user.save();
            
            const transaction = new models.Transaction({
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
        room.lastBoxUpdate = new Date();
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
      
      const room = await models.Room.findOne({ stake: parseInt(roomStake) });
      if (!room) {
        socket.emit('admin:error', 'Room not found');
        return;
      }
      
      // Store players list before clearing
      const playersInRoom = [...room.players];
      
      // Refund all players
      for (const userId of playersInRoom) {
        const user = await models.User.findOne({ userId: userId });
        if (user) {
          user.balance += roomStake;
          user.currentRoom = null;
          user.box = null;
          await user.save();
          
          const transaction = new models.Transaction({
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
      room.lastBoxUpdate = new Date();
      await room.save();
      
      // Broadcast cleared boxes
      broadcastTakenBoxes(roomStake, []);
      socket.emit('admin:success', `Cleared all boxes in ${roomStake} ETB room`);
      
      logActivity('ADMIN_CLEAR_BOXES', { adminSocket: socket.id, roomStake }, socket.id);
    });
    
    // Admin debugging for countdown
    socket.on('admin:debugCountdown', async (roomStake) => {
      if (!adminSockets.has(socket.id)) {
        socket.emit('admin:error', 'Unauthorized');
        return;
      }
      
      const room = await models.Room.findOne({ stake: parseInt(roomStake) });
      if (room) {
        const onlinePlayers = await getOnlinePlayersInRoom(room.stake);
        
        socket.emit('admin:success', `Room ${roomStake}: ${room.status}, ${onlinePlayers.length} online, ${room.players.length} total, countdown active: ${roomTimers.has(`countdown_${roomStake}`)}`);
      }
    });
    
    // ========== WALLET EVENT HANDLERS ==========
    socket.on('wallet:depositRequest', async (data) => {
      try {
        const { receiptNumber, amount, userId, userName } = data;
        
        console.log(`💰 Deposit request from ${userName} (${userId}): ${amount} ETB, Receipt: ${receiptNumber}`);
        
        // Create a transaction record
        const transaction = new models.Transaction({
          type: 'DEPOSIT_REQUEST',
          userId: userId,
          userName: userName,
          amount: parseFloat(amount),
          receiptNumber: receiptNumber,
          description: `Deposit request - Receipt: ${receiptNumber}, Amount: ${amount} ETB`,
          status: 'pending'
        });
        await transaction.save();
        
        // Notify the user
        socket.emit('wallet:depositRequestSuccess', {
          message: 'Deposit request submitted successfully. Admin will process it soon.',
          telebirrNumber: telebirrNumber // Include current Telebirr number
        });
        
        // Notify admin
        adminSockets.forEach(socketId => {
          const adminSocket = io.sockets.sockets.get(socketId);
          if (adminSocket) {
            adminSocket.emit('admin:newDepositRequest', {
              userId,
              userName,
              amount: parseFloat(amount),
              receiptNumber,
              transactionId: transaction._id,
              timestamp: new Date()
            });
          }
        });
        
        logActivity('DEPOSIT_REQUEST', { userId, userName, amount, receiptNumber }, socket.id);
        
      } catch (error) {
        console.error('Error processing deposit request:', error);
        socket.emit('wallet:error', 'Failed to submit deposit request');
      }
    });
    
    socket.on('wallet:withdrawRequest', async (data) => {
      try {
        const { amount, phoneNumber, userId, userName } = data;
        
        console.log(`💰 Withdrawal request from ${userName} (${userId}): ${amount} ETB to ${phoneNumber}`);
        
        // Check if user has sufficient balance
        const user = await models.User.findOne({ userId: userId });
        if (!user) {
          socket.emit('wallet:error', 'User not found');
          return;
        }
        
        if (user.balance < amount) {
          socket.emit('wallet:error', 'Insufficient balance for withdrawal');
          return;
        }
        
        // Check minimum withdrawal amount
        if (amount < CONFIG.MIN_WITHDRAWAL) {
          socket.emit('wallet:error', `Minimum withdrawal amount is ${CONFIG.MIN_WITHDRAWAL} ETB`);
          return;
        }
        
        // Check maximum withdrawal amount
        if (amount > CONFIG.MAX_WITHDRAWAL) {
          socket.emit('wallet:error', `Maximum withdrawal amount is ${CONFIG.MAX_WITHDRAWAL} ETB`);
          return;
        }
        
        // Create a transaction record
        const transaction = new models.Transaction({
          type: 'WITHDRAW_REQUEST',
          userId: userId,
          userName: userName,
          amount: -parseFloat(amount), // Negative for withdrawal
          phoneNumber: phoneNumber,
          description: `Withdrawal request to phone: ${phoneNumber}, Amount: ${amount} ETB`,
          status: 'pending'
        });
        await transaction.save();
        
        // Update user phone number if not set
        if (!user.phoneNumber) {
          user.phoneNumber = phoneNumber;
          await user.save();
        }
        
        // Notify the user
        socket.emit('wallet:withdrawRequestSuccess', {
          message: 'Withdrawal request submitted successfully. Admin will process it soon.'
        });
        
        // Notify admin
        adminSockets.forEach(socketId => {
          const adminSocket = io.sockets.sockets.get(socketId);
          if (adminSocket) {
            adminSocket.emit('admin:newWithdrawRequest', {
              userId,
              userName,
              amount: parseFloat(amount),
              phoneNumber,
              transactionId: transaction._id,
              timestamp: new Date()
            });
          }
        });
        
        logActivity('WITHDRAW_REQUEST', { userId, userName, amount, phoneNumber }, socket.id);
        
      } catch (error) {
        console.error('Error processing withdrawal request:', error);
        socket.emit('wallet:error', 'Failed to submit withdrawal request');
      }
    });
    
    // ========== TELEBIRR NUMBER FOR PLAYERS ==========
    socket.on('getTelebirrNumber', (callback) => {
      if (callback) {
        callback({ telebirrNumber: telebirrNumber });
      }
    });
    
    // Player events
    socket.on('init', async (data, callback) => {
      try {
        const { userId, userName } = data;
        
        console.log(`📱 User init: ${userName} (${userId}) via socket ${socket.id}`);
        
        // Store userId on socket for tracking
        socket.userId = userId;
        
        const user = await getUser(userId, userName);
        
        if (user) {
          // Store in socketToUser map
          socketToUser.set(socket.id, userId);
          
          // Also update user's lastSeen immediately
          await models.User.findOneAndUpdate(
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
            referralCode: user.referralCode,
            phoneNumber: user.phoneNumber || ''
          });
          
          // Send Telebirr number to player
          socket.emit('telebirrNumber', telebirrNumber);
          
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
        const user = await models.User.findOne({ userId: userId });
        if (user) {
          socket.emit('balanceUpdate', user.balance);
          socket.emit('balanceRefreshed', user.balance);
        }
      }
    });
    
    // Get room countdown status for discovery overlay
    socket.on('getRoomCountdown', async ({ room }, callback) => {
      try {
        const roomData = await models.Room.findOne({ stake: parseInt(room) });
        
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
    
    // FIXED: Get taken boxes from ALL rooms
    socket.on('getTakenBoxes', async ({ room }, callback) => {
      try {
        const roomData = await models.Room.findOne({ 
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
        models.Room.findOne({ stake: data.room })
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
    
    // UPDATED: Improved joinRoom function with timer synchronization
    socket.on('joinRoom', async (data, callback) => {
      try {
        const { room, box, userName } = data;
        const userId = socketToUser.get(socket.id) || socket.userId;
        
        if (!userId) {
          socket.emit('error', 'Player not initialized');
          if (callback) callback({ success: false, message: 'Player not initialized' });
          return;
        }
        
        const user = await models.User.findOne({ userId: userId });
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
        let roomData = await models.Room.findOne({ 
          stake: room, 
          status: { $in: ['waiting', 'starting', 'playing'] } 
        });
        
        if (!roomData) {
          // Create a new active room if none exists
          roomData = new models.Room({
            stake: room,
            players: [],
            takenBoxes: [],
            status: 'waiting',
            lastBoxUpdate: new Date()
          });
          await roomData.save();
        }
        
        // Check if room is locked (game is playing)
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
        
        // Update user balance and room info
        user.balance -= room;
        user.totalWagered = (user.totalWagered || 0) + room;
        user.currentRoom = room;
        user.box = box;
        await user.save();
        
        // Record transaction
        const transaction = new models.Transaction({
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
        
        // Send immediate countdown update if room is starting
        if (roomData.status === 'starting' && roomData.countdownStartTime) {
          const elapsed = Date.now() - roomData.countdownStartTime;
          const secondsRemaining = Math.max(0, CONFIG.COUNTDOWN_TIMER - Math.floor(elapsed / 1000));
          
          // Send immediate countdown update to the joining player
          socket.emit('gameCountdown', {
            room: room,
            timer: secondsRemaining,
            onlinePlayers: onlinePlayers.length
          });
        }
        
        // FIXED: Start countdown if we have at least 1 online player
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
    
    // ========== FIXED CLAIM BINGO LOGIC WITH DOUBLE CLAIM PROTECTION ==========
    socket.on('claimBingo', async (data, callback) => {
      try {
        const { room, grid, marked } = data;
        const userId = socketToUser.get(socket.id) || socket.userId;
        
        if (!userId) {
          socket.emit('error', 'Player not initialized');
          if (callback) callback({ success: false, message: 'Player not initialized' });
          return;
        }
        
        const user = await models.User.findOne({ userId: userId });
        if (!user) {
          socket.emit('error', 'User not found');
          if (callback) callback({ success: false, message: 'User not found' });
          return;
        }
        
        const roomStake = parseInt(room);
        
        // CHECK IF CLAIM IS ALREADY BEING PROCESSED FOR THIS ROOM
        if (processingClaims.has(roomStake)) {
          console.log(`🚨 DOUBLE CLAIM PREVENTED: Room ${roomStake} already has a claim being processed`);
          socket.emit('error', 'A bingo claim is already being processed for this room');
          if (callback) callback({ 
            success: false, 
            message: 'A bingo claim is already being processed. Please wait.' 
          });
          return;
        }
        
        // LOCK THE ROOM FOR CLAIM PROCESSING
        processingClaims.set(roomStake, Date.now());
        console.log(`🔒 Locked room ${roomStake} for claim processing by ${user.userName}`);
        
        const roomData = await models.Room.findOne({ stake: roomStake, status: 'playing' });
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
        
        // Convert marked numbers properly for comparison
        const markedNumbers = marked.map(item => {
          if (item === 'FREE') return 'FREE';
          return Number(item);
        }).filter(item => !isNaN(item) || item === 'FREE');
        
        // Check if bingo is valid
        const bingoCheck = checkBingo(markedNumbers, grid);
        if (!bingoCheck.isBingo) {
          processingClaims.delete(roomStake);
          console.log('❌ Invalid bingo claim - no winning pattern found');
          socket.emit('error', 'Invalid bingo claim');
          if (callback) callback({ success: false, message: 'Invalid bingo claim - no winning pattern' });
          return;
        }
        
        const isFourCornersWin = bingoCheck.isFourCorners;
        
        // Calculate total prize correctly
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
        
        // Calculate house earnings
        const houseEarnings = commissionPerPlayer * totalPlayers;
        
        console.log(`🎰 WIN CALCULATION for ${room} ETB room:`);
        console.log(`   Total players: ${totalPlayers}`);
        console.log(`   Total prize: ${totalPrize} ETB`);
        console.log(`   Is four corners: ${isFourCornersWin}`);
        console.log(`   Bonus: ${bonus} ETB`);
        console.log(`   House earnings: ${houseEarnings} ETB`);
        
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
        const transaction = new models.Transaction({
          type: transactionType,
          userId: userId,
          userName: user.userName,
          amount: totalPrize,
          room: room,
          description: `Bingo win in ${room} ETB room with ${totalPlayers} players${isFourCornersWin ? ' (Four Corners Bonus)' : ''}`
        });
        await transaction.save();
        
        // Record house earnings
        const houseTransaction = new models.Transaction({
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
        
        // FIXED: Clear game timer FIRST
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
        roomData.status = 'waiting';
        roomData.calledNumbers = [];
        roomData.currentBall = null;
        roomData.ballsDrawn = 0;
        roomData.startTime = null;
        roomData.endTime = new Date();
        roomData.lastBoxUpdate = new Date();
        await roomData.save();
        
        // RELEASE THE PROCESSING LOCK
        processingClaims.delete(roomStake);
        console.log(`🔓 Released processing lock for room ${roomStake}`);
        
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
            const losingUser = await models.User.findOne({ userId: playerId });
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
                  const losingUser = await models.User.findOne({ userId: playerId });
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
        // RELEASE LOCK ON ERROR TOO
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
          await models.User.findOneAndUpdate(
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
        
        const user = await models.User.findOne({ userId: userId });
        if (!user || !user.currentRoom) {
          socket.emit('leftRoom', { message: 'Not in a room' });
          return;
        }
        
        const roomStake = user.currentRoom;
        const room = await models.Room.findOne({ stake: roomStake });
        
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
        
        // Don't stop countdown when player leaves
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
          const transaction = new models.Transaction({
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
        
        const roomData = await models.Room.findOne({ stake: parseInt(room) });
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
        await models.User.findOneAndUpdate(
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
          const user = await models.User.findOne({ userId: userId });
          if (user && user.currentRoom) {
            const roomStake = user.currentRoom;
            const room = await models.Room.findOne({ stake: roomStake });
            
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
            await models.User.findOneAndUpdate(
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
}

// ========== PERIODIC TASKS ==========
function startPeriodicTasks() {
  // Run cleanup every 10 seconds
  setInterval(cleanupProcessingClaims, 10000);
  
  // Room status updates
  setInterval(() => {
    broadcastRoomStatus();
  }, CONFIG.ROOM_STATUS_UPDATE_INTERVAL);
  
  // Update admin panel every 2 seconds for real-time tracking
  setInterval(() => {
    updateAdminPanel();
  }, 2000);
  
  // Run 7-minute game timeout check every 30 seconds
  setInterval(cleanupLongRunningGames, 30000);
  
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
  
  // Run cleanup every 30 seconds
  setInterval(cleanupStaleConnections, 30000);
  
  // Run every 10 seconds
  setInterval(cleanupStuckCountdowns, 10000);
  
  // Run every 5 minutes
  setInterval(cleanupStaleRooms, 300000);
  
  // Health check
  setInterval(async () => {
    try {
      const now = Date.now();
      const fiveMinutesAgo = new Date(now - 300000);
      
      // Update users who haven't been active
      await models.User.updateMany(
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
      const abandonedRooms = await models.Room.find({
        status: 'playing',
        players: { $size: 0 },
        startTime: { $lt: fiveMinutesAgo }
      });
      
      for (const room of abandonedRooms) {
        console.log(`⚠️ Cleaning up abandoned room: ${room.stake} ETB`);
        cleanupRoomTimer(room.stake);
        await models.Room.deleteOne({ _id: room._id });
      }
      
    } catch (error) {
      console.error('Error in health check:', error);
    }
  }, 60000);
}

// ========== EXPORT FUNCTIONS AND STATE ==========
module.exports = {
  // Configuration
  CONFIG,
  
  // Initialization
  initialize,
  
  // Helper functions
  getConnectedUsers,
  getOnlinePlayersInRoom,
  broadcastRoomStatus,
  updateAdminPanel,
  broadcastTakenBoxes,
  getUser,
  getRoom,
  
  // NEW FUNCTIONS FOR ADMIN PANEL
  resetHouseEarnings,
  disconnectUser,
  getTelebirrNumber,
  updateTelebirrNumber,
  
  // State getters for server.js
  getSocketToUser: () => socketToUser,
  getAdminSockets: () => adminSockets,
  getProcessingClaims: () => processingClaims,
  getConnectedSockets: () => connectedSockets,
  getActivityLog: () => activityLog,
  getRoomSubscriptions: () => roomSubscriptions,
  getRoomTimers: () => roomTimers,
  
  // Game logic functions
  getBingoLetter,
  generateReferralCode,
  checkBingo,
  startCountdownForRoom,
  startGameTimer,
  cleanupRoomTimer,
  cleanupLongRunningGames,
  endGameWithNoWinner
};
