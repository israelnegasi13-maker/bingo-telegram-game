// keno-logic.js - KENO GAME LOGIC MODULE

// ========== KENO CONFIGURATION ==========
const KENO_CONFIG = {
  GAME_TYPE: 'KENO',
  MAX_NUMBERS: 80,
  SELECTABLE_NUMBERS: 10,
  ROUND_DURATION: 60, // seconds
  DRAW_COUNT: 20, // 20 numbers drawn per round
  BET_AMOUNTS: [1, 5, 10, 25, 50, 100],
  PAYOUT_TABLE: {
    0: 0,
    1: 0,
    2: 0,
    3: 0.5,
    4: 1,
    5: 2,
    6: 10,
    7: 50,
    8: 100,
    9: 500,
    10: 1000
  },
  AUTO_DRAW_INTERVAL: 1000, // 1 second between drawn numbers
  WAITING_PERIOD: 30, // seconds between rounds
  MIN_PLAYERS: 1, // Start with 1 player
  HOUSE_COMMISSION: 0.10, // 10% house commission
  MAX_ROUNDS_STORED: 50
};

// ========== KENO GLOBAL STATE ==========
let kenoRooms = new Map(); // Map<stake, KenoRoom>
let kenoRoundTimers = new Map(); // Map<stake, timer>
let kenoDrawTimers = new Map(); // Map<stake, drawTimer>
let kenoWaitingTimers = new Map(); // Map<stake, waitingTimer>
let kenoBets = new Map(); // Map<playerId, KenoBet>
let kenoPlayerSelections = new Map(); // Map<playerId, selectedNumbers>
let kenoGameHistory = [];
let io = null;
let models = null;

// ========== KENO ROOM CLASS ==========
class KenoRoom {
  constructor(stake) {
    this.stake = stake;
    this.players = new Set(); // playerIds
    this.status = 'waiting'; // waiting, betting, drawing, calculating, ended
    this.roundNumber = 1;
    this.roundStartTime = null;
    this.countdown = KENO_CONFIG.ROUND_DURATION;
    this.drawnNumbers = [];
    this.currentDraw = 0;
    this.totalPrizePool = 0;
    this.houseEarnings = 0;
    this.winners = [];
    this.createdAt = new Date();
    this.bettingEndTime = null;
  }
}

// ========== KENO BET CLASS ==========
class KenoBet {
  constructor(playerId, userName, stake, selectedNumbers, betAmount) {
    this.playerId = playerId;
    this.userName = userName;
    this.stake = stake;
    this.selectedNumbers = selectedNumbers;
    this.betAmount = betAmount;
    this.placedAt = new Date();
    this.matches = 0;
    this.winnings = 0;
    this.isWinner = false;
  }
}

// ========== INITIALIZATION FUNCTION ==========
async function initializeKeno(socketIo, dbModels) {
  io = socketIo;
  models = dbModels;
  
  console.log('✅ Keno game logic initialized');
  
  // Initialize Keno rooms for each stake amount
  initializeKenoRooms();
  
  // Setup Keno-specific Socket.IO handlers
  setupKenoSocketHandlers();
  
  // Start periodic tasks
  startKenoPeriodicTasks();
  
  return {
    KENO_CONFIG,
    getKenoRooms: () => kenoRooms,
    getKenoBets: () => kenoBets,
    getKenoGameHistory: () => kenoGameHistory,
    broadcastKenoStatus,
    processKenoBet,
    handleKenoQuickPick,
    calculateKenoWinnings
  };
}

// Initialize Keno rooms for each stake amount
function initializeKenoRooms() {
  KENO_CONFIG.BET_AMOUNTS.forEach(stake => {
    if (!kenoRooms.has(stake)) {
      kenoRooms.set(stake, new KenoRoom(stake));
      console.log(`✅ Keno room initialized for stake: ${stake} ETB`);
    }
  });
}

// ========== KENO SOCKET.IO EVENT HANDLERS ==========
function setupKenoSocketHandlers() {
  io.on('connection', (socket) => {
    console.log(`✅ Keno Socket Connected: ${socket.id}`);
    
    // ========== KENO GAME EVENTS ==========
    socket.on('keno:init', async (data) => {
      try {
        const { userId, userName } = data;
        
        console.log(`🎰 Keno init from ${userName} (${userId})`);
        
        const user = await models.User.findOne({ userId: userId });
        if (!user) {
          socket.emit('keno:error', { message: 'User not found' });
          return;
        }
        
        // Store userId on socket for tracking
        socket.userId = userId;
        socket.userName = userName;
        
        // Send current balance
        socket.emit('keno:balanceUpdate', user.balance);
        
        // Send Keno rooms status
        broadcastKenoStatusToPlayer(socket.id);
        
        // Send welcome message
        socket.emit('keno:welcome', {
          message: 'Welcome to Keno Premium!',
          balance: user.balance,
          maxNumbers: KENO_CONFIG.MAX_NUMBERS,
          selectableNumbers: KENO_CONFIG.SELECTABLE_NUMBERS,
          betAmounts: KENO_CONFIG.BET_AMOUNTS,
          payoutTable: KENO_CONFIG.PAYOUT_TABLE
        });
        
        console.log(`✅ Keno player initialized: ${userName}`);
        
      } catch (error) {
        console.error('Error in keno:init:', error);
        socket.emit('keno:error', { message: 'Server error during initialization' });
      }
    });
    
    socket.on('keno:joinRoom', async (data) => {
      try {
        const { stake } = data;
        const userId = socket.userId;
        const userName = socket.userName;
        
        if (!userId || !userName) {
          socket.emit('keno:error', { message: 'User not initialized' });
          return;
        }
        
        console.log(`🎰 ${userName} joining Keno room ${stake} ETB`);
        
        const user = await models.User.findOne({ userId: userId });
        if (!user) {
          socket.emit('keno:error', { message: 'User not found' });
          return;
        }
        
        // Get or create Keno room
        let kenoRoom = kenoRooms.get(parseInt(stake));
        if (!kenoRoom) {
          kenoRoom = new KenoRoom(parseInt(stake));
          kenoRooms.set(parseInt(stake), kenoRoom);
        }
        
        // Check if user has enough balance
        if (user.balance < stake) {
          socket.emit('keno:insufficientBalance', { required: stake, current: user.balance });
          return;
        }
        
        // Add player to room
        kenoRoom.players.add(userId);
        
        // Send room info to player
        socket.emit('keno:roomJoined', {
          stake: stake,
          playersCount: kenoRoom.players.size,
          status: kenoRoom.status,
          countdown: kenoRoom.countdown,
          roundNumber: kenoRoom.roundNumber
        });
        
        // Start round if we have enough players and room is waiting
        if (kenoRoom.status === 'waiting' && kenoRoom.players.size >= KENO_CONFIG.MIN_PLAYERS) {
          startKenoRound(kenoRoom);
        }
        
        // Broadcast updated room status
        broadcastKenoStatus();
        
        console.log(`✅ ${userName} joined Keno room ${stake} ETB`);
        
      } catch (error) {
        console.error('Error in keno:joinRoom:', error);
        socket.emit('keno:error', { message: 'Server error joining room' });
      }
    });
    
    socket.on('keno:placeBet', async (data) => {
      try {
        const { stake, selectedNumbers, betAmount } = data;
        const userId = socket.userId;
        const userName = socket.userName;
        
        if (!userId || !userName) {
          socket.emit('keno:error', { message: 'User not initialized' });
          return;
        }
        
        console.log(`🎰 ${userName} placing Keno bet: ${betAmount} ETB on ${selectedNumbers.length} numbers`);
        
        const user = await models.User.findOne({ userId: userId });
        if (!user) {
          socket.emit('keno:error', { message: 'User not found' });
          return;
        }
        
        // Get Keno room
        const kenoRoom = kenoRooms.get(parseInt(stake));
        if (!kenoRoom || kenoRoom.status !== 'betting') {
          socket.emit('keno:error', { message: 'Keno room not active or not in betting phase' });
          return;
        }
        
        // Validate selection
        if (selectedNumbers.length < 1 || selectedNumbers.length > KENO_CONFIG.SELECTABLE_NUMBERS) {
          socket.emit('keno:error', { 
            message: `Select between 1 and ${KENO_CONFIG.SELECTABLE_NUMBERS} numbers` 
          });
          return;
        }
        
        // Check for duplicate numbers
        const uniqueNumbers = [...new Set(selectedNumbers)];
        if (uniqueNumbers.length !== selectedNumbers.length) {
          socket.emit('keno:error', { message: 'Duplicate numbers selected' });
          return;
        }
        
        // Validate number range
        const invalidNumbers = selectedNumbers.filter(n => n < 1 || n > KENO_CONFIG.MAX_NUMBERS);
        if (invalidNumbers.length > 0) {
          socket.emit('keno:error', { 
            message: `Numbers must be between 1 and ${KENO_CONFIG.MAX_NUMBERS}` 
          });
          return;
        }
        
        // Check if user has enough balance
        const totalBet = betAmount * selectedNumbers.length;
        if (user.balance < totalBet) {
          socket.emit('keno:insufficientBalance', { 
            required: totalBet, 
            current: user.balance 
          });
          return;
        }
        
        // Deduct balance
        const oldBalance = user.balance;
        user.balance -= totalBet;
        await user.save();
        
        // Create bet record
        const betId = `${userId}_${stake}_${Date.now()}`;
        const bet = new KenoBet(userId, userName, stake, selectedNumbers, betAmount);
        kenoBets.set(betId, bet);
        kenoPlayerSelections.set(userId, selectedNumbers);
        
        // Update prize pool
        kenoRoom.totalPrizePool += totalBet;
        kenoRoom.houseEarnings += totalBet * KENO_CONFIG.HOUSE_COMMISSION;
        
        // Record transaction
        const transaction = new models.Transaction({
          type: 'KENO_BET',
          userId: userId,
          userName: userName,
          amount: -totalBet,
          room: stake,
          description: `Keno bet: ${selectedNumbers.length} numbers @ ${betAmount} ETB each`,
          gameType: 'KENO',
          betDetails: {
            stake: stake,
            selectedNumbers: selectedNumbers,
            betAmount: betAmount,
            totalBet: totalBet
          }
        });
        await transaction.save();
        
        // Send confirmation to player
        socket.emit('keno:betConfirmed', {
          betId: betId,
          totalBet: totalBet,
          newBalance: user.balance,
          selectedNumbers: selectedNumbers,
          countdown: kenoRoom.countdown
        });
        
        // Update room status
        broadcastKenoStatus();
        
        console.log(`✅ ${userName} placed Keno bet: ${totalBet} ETB`);
        
      } catch (error) {
        console.error('Error in keno:placeBet:', error);
        socket.emit('keno:error', { message: 'Server error placing bet' });
      }
    });
    
    socket.on('keno:quickPick', async (data) => {
      try {
        const { stake, count } = data;
        const userId = socket.userId;
        
        if (!userId) {
          socket.emit('keno:error', { message: 'User not initialized' });
          return;
        }
        
        // Generate random numbers
        const numbers = generateQuickPickNumbers(count || KENO_CONFIG.SELECTABLE_NUMBERS);
        
        socket.emit('keno:quickPickResult', {
          numbers: numbers,
          count: numbers.length
        });
        
        console.log(`🎰 Quick pick generated for ${userId}: ${numbers.length} numbers`);
        
      } catch (error) {
        console.error('Error in keno:quickPick:', error);
        socket.emit('keno:error', { message: 'Server error generating quick pick' });
      }
    });
    
    socket.on('keno:leaveRoom', async (data) => {
      try {
        const { stake } = data;
        const userId = socket.userId;
        
        if (!userId) return;
        
        const kenoRoom = kenoRooms.get(parseInt(stake));
        if (kenoRoom) {
          kenoRoom.players.delete(userId);
          
          // Remove player's bets
          for (const [betId, bet] of kenoBets.entries()) {
            if (bet.playerId === userId && bet.stake === stake) {
              kenoBets.delete(betId);
            }
          }
          
          kenoPlayerSelections.delete(userId);
          
          socket.emit('keno:roomLeft', { stake: stake });
          
          // Update room status
          broadcastKenoStatus();
          
          console.log(`✅ Player ${userId} left Keno room ${stake} ETB`);
        }
        
      } catch (error) {
        console.error('Error in keno:leaveRoom:', error);
      }
    });
    
    socket.on('keno:refreshBalance', async () => {
      try {
        const userId = socket.userId;
        if (!userId) return;
        
        const user = await models.User.findOne({ userId: userId });
        if (user) {
          socket.emit('keno:balanceUpdate', user.balance);
        }
      } catch (error) {
        console.error('Error in keno:refreshBalance:', error);
      }
    });
    
    socket.on('keno:getStatus', () => {
      broadcastKenoStatusToPlayer(socket.id);
    });
    
    // Handle disconnection
    socket.on('disconnect', () => {
      const userId = socket.userId;
      if (userId) {
        // Remove player from all Keno rooms
        kenoRooms.forEach((room, stake) => {
          if (room.players.has(userId)) {
            room.players.delete(userId);
            console.log(`👤 Player ${userId} removed from Keno room ${stake} due to disconnect`);
          }
        });
        
        // Clean up player data after delay
        setTimeout(() => {
          kenoPlayerSelections.delete(userId);
        }, 5000);
      }
    });
  });
}

// ========== KENO GAME LOGIC FUNCTIONS ==========
function startKenoRound(kenoRoom) {
  console.log(`🎰 Starting Keno round for room ${kenoRoom.stake} ETB`);
  
  kenoRoom.status = 'betting';
  kenoRoom.roundStartTime = new Date();
  kenoRoom.countdown = KENO_CONFIG.ROUND_DURATION;
  kenoRoom.drawnNumbers = [];
  kenoRoom.currentDraw = 0;
  kenoRoom.totalPrizePool = 0;
  kenoRoom.houseEarnings = 0;
  kenoRoom.winners = [];
  kenoRoom.bettingEndTime = new Date(Date.now() + (KENO_CONFIG.ROUND_DURATION * 1000));
  
  // Clear existing bets for this room
  for (const [betId, bet] of kenoBets.entries()) {
    if (bet.stake === kenoRoom.stake) {
      kenoBets.delete(betId);
    }
  }
  
  // Broadcast round start
  broadcastToKenoRoom(kenoRoom.stake, 'keno:roundStart', {
    stake: kenoRoom.stake,
    roundNumber: kenoRoom.roundNumber,
    duration: KENO_CONFIG.ROUND_DURATION,
    playersCount: kenoRoom.players.size,
    bettingEndTime: kenoRoom.bettingEndTime
  });
  
  // Start countdown timer
  startKenoCountdown(kenoRoom);
  
  broadcastKenoStatus();
  
  console.log(`✅ Keno round ${kenoRoom.roundNumber} started for room ${kenoRoom.stake} ETB`);
}

function startKenoCountdown(kenoRoom) {
  // Clear existing timer
  if (kenoRoundTimers.has(kenoRoom.stake)) {
    clearInterval(kenoRoundTimers.get(kenoRoom.stake));
  }
  
  const timer = setInterval(() => {
    if (kenoRoom.status !== 'betting') {
      clearInterval(timer);
      kenoRoundTimers.delete(kenoRoom.stake);
      return;
    }
    
    kenoRoom.countdown--;
    
    // Broadcast countdown update
    broadcastToKenoRoom(kenoRoom.stake, 'keno:countdownUpdate', {
      stake: kenoRoom.stake,
      countdown: kenoRoom.countdown,
      status: kenoRoom.status
    });
    
    // End betting period
    if (kenoRoom.countdown <= 0) {
      clearInterval(timer);
      kenoRoundTimers.delete(kenoRoom.stake);
      endKenoBettingPeriod(kenoRoom);
    }
  }, 1000);
  
  kenoRoundTimers.set(kenoRoom.stake, timer);
}

function endKenoBettingPeriod(kenoRoom) {
  console.log(`🎰 Ending betting period for Keno room ${kenoRoom.stake} ETB`);
  
  kenoRoom.status = 'drawing';
  
  // Broadcast draw start
  broadcastToKenoRoom(kenoRoom.stake, 'keno:drawStart', {
    stake: kenoRoom.stake,
    roundNumber: kenoRoom.roundNumber,
    totalBets: Array.from(kenoBets.values()).filter(b => b.stake === kenoRoom.stake).length,
    prizePool: kenoRoom.totalPrizePool
  });
  
  // Start drawing numbers
  startKenoDrawing(kenoRoom);
}

function startKenoDrawing(kenoRoom) {
  // Clear existing draw timer
  if (kenoDrawTimers.has(kenoRoom.stake)) {
    clearInterval(kenoDrawTimers.get(kenoRoom.stake));
  }
  
  kenoRoom.drawnNumbers = [];
  kenoRoom.currentDraw = 0;
  
  const drawInterval = setInterval(() => {
    if (kenoRoom.status !== 'drawing' || kenoRoom.currentDraw >= KENO_CONFIG.DRAW_COUNT) {
      clearInterval(drawInterval);
      kenoDrawTimers.delete(kenoRoom.stake);
      
      if (kenoRoom.currentDraw >= KENO_CONFIG.DRAW_COUNT) {
        endKenoDrawing(kenoRoom);
      }
      return;
    }
    
    // Generate unique random number
    let number;
    do {
      number = Math.floor(Math.random() * KENO_CONFIG.MAX_NUMBERS) + 1;
    } while (kenoRoom.drawnNumbers.includes(number));
    
    kenoRoom.drawnNumbers.push(number);
    kenoRoom.currentDraw++;
    
    console.log(`🎰 Room ${kenoRoom.stake}: Drawn number ${number} (${kenoRoom.currentDraw}/${KENO_CONFIG.DRAW_COUNT})`);
    
    // Broadcast drawn number
    broadcastToKenoRoom(kenoRoom.stake, 'keno:numberDrawn', {
      stake: kenoRoom.stake,
      number: number,
      drawNumber: kenoRoom.currentDraw,
      totalDraws: KENO_CONFIG.DRAW_COUNT,
      drawnNumbers: kenoRoom.drawnNumbers
    });
    
  }, KENO_CONFIG.AUTO_DRAW_INTERVAL);
  
  kenoDrawTimers.set(kenoRoom.stake, drawInterval);
}

function endKenoDrawing(kenoRoom) {
  console.log(`🎰 Drawing completed for Keno room ${kenoRoom.stake} ETB`);
  
  kenoRoom.status = 'calculating';
  
  // Calculate winnings for all bets
  calculateKenoWinningsForRoom(kenoRoom);
  
  // Broadcast draw complete
  broadcastToKenoRoom(kenoRoom.stake, 'keno:drawComplete', {
    stake: kenoRoom.stake,
    roundNumber: kenoRoom.roundNumber,
    drawnNumbers: kenoRoom.drawnNumbers,
    totalDraws: KENO_CONFIG.DRAW_COUNT
  });
  
  // Distribute winnings after a short delay
  setTimeout(() => {
    distributeKenoWinnings(kenoRoom);
  }, 2000);
}

async function calculateKenoWinningsForRoom(kenoRoom) {
  console.log(`💰 Calculating Keno winnings for room ${kenoRoom.stake} ETB`);
  
  kenoRoom.winners = [];
  
  // Get all bets for this room
  const roomBets = Array.from(kenoBets.values()).filter(bet => bet.stake === kenoRoom.stake);
  
  for (const bet of roomBets) {
    // Count matches
    const matches = bet.selectedNumbers.filter(num => kenoRoom.drawnNumbers.includes(num)).length;
    bet.matches = matches;
    
    // Calculate winnings based on payout table
    const payoutMultiplier = KENO_CONFIG.PAYOUT_TABLE[matches] || 0;
    const baseWinnings = bet.betAmount * bet.selectedNumbers.length * payoutMultiplier;
    
    // Apply house commission
    const commission = baseWinnings * KENO_CONFIG.HOUSE_COMMISSION;
    bet.winnings = Math.max(0, baseWinnings - commission);
    bet.isWinner = bet.winnings > 0;
    
    if (bet.isWinner) {
      kenoRoom.winners.push({
        playerId: bet.playerId,
        userName: bet.userName,
        matches: matches,
        winnings: bet.winnings,
        selectedNumbers: bet.selectedNumbers
      });
    }
    
    console.log(`💰 ${bet.userName}: ${matches} matches = ${bet.winnings} ETB`);
  }
}

async function distributeKenoWinnings(kenoRoom) {
  console.log(`💰 Distributing Keno winnings for room ${kenoRoom.stake} ETB`);
  
  kenoRoom.status = 'ended';
  
  // Update winners' balances
  for (const winner of kenoRoom.winners) {
    try {
      const user = await models.User.findOne({ userId: winner.playerId });
      if (user) {
        const oldBalance = user.balance;
        user.balance += winner.winnings;
        await user.save();
        
        // Record winning transaction
        const transaction = new models.Transaction({
          type: 'KENO_WIN',
          userId: winner.playerId,
          userName: winner.userName,
          amount: winner.winnings,
          room: kenoRoom.stake,
          description: `Keno win: ${winner.matches} matches out of ${KENO_CONFIG.DRAW_COUNT}`,
          gameType: 'KENO',
          winDetails: {
            stake: kenoRoom.stake,
            matches: winner.matches,
            winnings: winner.winnings,
            drawnNumbers: kenoRoom.drawnNumbers,
            selectedNumbers: winner.selectedNumbers
          }
        });
        await transaction.save();
        
        // Notify winner
        io.emit('keno:playerWin', {
          playerId: winner.playerId,
          userName: winner.userName,
          stake: kenoRoom.stake,
          matches: winner.matches,
          winnings: winner.winnings,
          newBalance: user.balance,
          drawnNumbers: kenoRoom.drawnNumbers
        });
        
        console.log(`💰 Awarded ${winner.winnings} ETB to ${winner.userName}`);
      }
    } catch (error) {
      console.error(`❌ Error awarding winnings to ${winner.userName}:`, error);
    }
  }
  
  // Record house earnings
  if (kenoRoom.houseEarnings > 0) {
    const houseTransaction = new models.Transaction({
      type: 'KENO_HOUSE_EARNINGS',
      userId: 'HOUSE',
      userName: 'House',
      amount: kenoRoom.houseEarnings,
      room: kenoRoom.stake,
      description: `Keno house earnings from ${kenoRoom.players.size} players`,
      gameType: 'KENO'
    });
    await houseTransaction.save();
  }
  
  // Add to game history
  const gameRecord = {
    stake: kenoRoom.stake,
    roundNumber: kenoRoom.roundNumber,
    drawnNumbers: kenoRoom.drawnNumbers,
    winners: kenoRoom.winners,
    totalPrizePool: kenoRoom.totalPrizePool,
    houseEarnings: kenoRoom.houseEarnings,
    playersCount: kenoRoom.players.size,
    endTime: new Date()
  };
  
  kenoGameHistory.unshift(gameRecord);
  
  // Keep only recent history
  if (kenoGameHistory.length > KENO_CONFIG.MAX_ROUNDS_STORED) {
    kenoGameHistory = kenoGameHistory.slice(0, KENO_CONFIG.MAX_ROUNDS_STORED);
  }
  
  // Broadcast results
  broadcastToKenoRoom(kenoRoom.stake, 'keno:roundResults', {
    stake: kenoRoom.stake,
    roundNumber: kenoRoom.roundNumber,
    drawnNumbers: kenoRoom.drawnNumbers,
    winners: kenoRoom.winners,
    totalPrizePool: kenoRoom.totalPrizePool,
    houseEarnings: kenoRoom.houseEarnings
  });
  
  // Start waiting period for next round
  startKenoWaitingPeriod(kenoRoom);
}

function startKenoWaitingPeriod(kenoRoom) {
  console.log(`⏱️ Starting waiting period for Keno room ${kenoRoom.stake} ETB`);
  
  let waitingTime = KENO_CONFIG.WAITING_PERIOD;
  
  // Clear existing waiting timer
  if (kenoWaitingTimers.has(kenoRoom.stake)) {
    clearInterval(kenoWaitingTimers.get(kenoRoom.stake));
  }
  
  // Broadcast waiting period start
  broadcastToKenoRoom(kenoRoom.stake, 'keno:waitingPeriod', {
    stake: kenoRoom.stake,
    duration: waitingTime,
    nextRound: kenoRoom.roundNumber + 1
  });
  
  const waitingTimer = setInterval(() => {
    waitingTime--;
    
    // Broadcast waiting time update
    broadcastToKenoRoom(kenoRoom.stake, 'keno:waitingUpdate', {
      stake: kenoRoom.stake,
      timeLeft: waitingTime
    });
    
    if (waitingTime <= 0) {
      clearInterval(waitingTimer);
      kenoWaitingTimers.delete(kenoRoom.stake);
      
      // Reset room for next round
      resetKenoRoomForNextRound(kenoRoom);
    }
  }, 1000);
  
  kenoWaitingTimers.set(kenoRoom.stake, waitingTimer);
}

function resetKenoRoomForNextRound(kenoRoom) {
  console.log(`🔄 Resetting Keno room ${kenoRoom.stake} for next round`);
  
  kenoRoom.status = 'waiting';
  kenoRoom.roundNumber++;
  kenoRoom.drawnNumbers = [];
  kenoRoom.currentDraw = 0;
  kenoRoom.totalPrizePool = 0;
  kenoRoom.houseEarnings = 0;
  kenoRoom.winners = [];
  kenoRoom.roundStartTime = null;
  kenoRoom.bettingEndTime = null;
  kenoRoom.countdown = KENO_CONFIG.ROUND_DURATION;
  
  // Clear player selections for this room
  for (const playerId of kenoRoom.players) {
    kenoPlayerSelections.delete(playerId);
  }
  
  // Clear bets for this room
  for (const [betId, bet] of kenoBets.entries()) {
    if (bet.stake === kenoRoom.stake) {
      kenoBets.delete(betId);
    }
  }
  
  // Broadcast room reset
  broadcastToKenoRoom(kenoRoom.stake, 'keno:roomReset', {
    stake: kenoRoom.stake,
    roundNumber: kenoRoom.roundNumber,
    status: kenoRoom.status
  });
  
  // Start next round if we have players
  if (kenoRoom.players.size >= KENO_CONFIG.MIN_PLAYERS) {
    setTimeout(() => {
      startKenoRound(kenoRoom);
    }, 3000);
  }
  
  broadcastKenoStatus();
}

// ========== HELPER FUNCTIONS ==========
function broadcastToKenoRoom(stake, event, data) {
  if (!io) return;
  
  const kenoRoom = kenoRooms.get(parseInt(stake));
  if (!kenoRoom) return;
  
  // Send to all players in the room
  kenoRoom.players.forEach(playerId => {
    io.emit(event, { ...data, playerId: playerId });
  });
  
  // Also broadcast to admin panel
  broadcastKenoStatus();
}

function broadcastKenoStatus() {
  if (!io) return;
  
  const kenoStatus = {};
  
  kenoRooms.forEach((room, stake) => {
    kenoStatus[stake] = {
      stake: stake,
      playersCount: room.players.size,
      status: room.status,
      roundNumber: room.roundNumber,
      countdown: room.countdown,
      drawnNumbers: room.drawnNumbers,
      currentDraw: room.currentDraw,
      totalDraws: KENO_CONFIG.DRAW_COUNT,
      totalPrizePool: room.totalPrizePool,
      houseEarnings: room.houseEarnings,
      winners: room.winners,
      bettingEndTime: room.bettingEndTime,
      selectableNumbers: KENO_CONFIG.SELECTABLE_NUMBERS,
      maxNumbers: KENO_CONFIG.MAX_NUMBERS,
      betAmounts: KENO_CONFIG.BET_AMOUNTS,
      payoutTable: KENO_CONFIG.PAYOUT_TABLE
    };
  });
  
  // Broadcast to all Keno clients
  io.emit('keno:statusUpdate', kenoStatus);
  
  // Also update admin panel
  updateKenoAdminPanel();
}

function broadcastKenoStatusToPlayer(socketId) {
  if (!io) return;
  
  const socket = io.sockets.sockets.get(socketId);
  if (!socket) return;
  
  const kenoStatus = {};
  
  kenoRooms.forEach((room, stake) => {
    kenoStatus[stake] = {
      stake: stake,
      playersCount: room.players.size,
      status: room.status,
      roundNumber: room.roundNumber,
      countdown: room.countdown,
      drawnNumbers: room.drawnNumbers,
      currentDraw: room.currentDraw,
      totalDraws: KENO_CONFIG.DRAW_COUNT
    };
  });
  
  socket.emit('keno:roomStatus', kenoStatus);
}

function updateKenoAdminPanel() {
  if (!io) return;
  
  const adminData = {
    kenoRooms: Array.from(kenoRooms.entries()).map(([stake, room]) => ({
      stake: stake,
      players: Array.from(room.players),
      playersCount: room.players.size,
      status: room.status,
      roundNumber: room.roundNumber,
      countdown: room.countdown,
      drawnNumbers: room.drawnNumbers,
      totalPrizePool: room.totalPrizePool,
      houseEarnings: room.houseEarnings,
      winners: room.winners,
      createdAt: room.createdAt
    })),
    kenoBets: Array.from(kenoBets.values()).map(bet => ({
      playerId: bet.playerId,
      userName: bet.userName,
      stake: bet.stake,
      selectedNumbers: bet.selectedNumbers,
      betAmount: bet.betAmount,
      totalBet: bet.betAmount * bet.selectedNumbers.length,
      placedAt: bet.placedAt,
      matches: bet.matches,
      winnings: bet.winnings,
      isWinner: bet.isWinner
    })),
    kenoGameHistory: kenoGameHistory.slice(0, 20),
    timestamp: new Date().toISOString()
  };
  
  // Send to admin sockets (assuming adminSockets is available from game-logic.js)
  // This would need to be integrated with your existing admin panel
  console.log('📊 Keno Admin Panel Updated');
}

function generateQuickPickNumbers(count) {
  const numbers = new Set();
  while (numbers.size < count) {
    numbers.add(Math.floor(Math.random() * KENO_CONFIG.MAX_NUMBERS) + 1);
  }
  return Array.from(numbers);
}

function processKenoBet(userId, userName, stake, selectedNumbers, betAmount) {
  // This is a wrapper function for external use
  const totalBet = betAmount * selectedNumbers.length;
  const betId = `${userId}_${stake}_${Date.now()}`;
  const bet = new KenoBet(userId, userName, stake, selectedNumbers, betAmount);
  
  kenoBets.set(betId, bet);
  kenoPlayerSelections.set(userId, selectedNumbers);
  
  return { betId, totalBet, bet };
}

function handleKenoQuickPick(userId, count) {
  const numbers = generateQuickPickNumbers(count || KENO_CONFIG.SELECTABLE_NUMBERS);
  return { numbers, count: numbers.length };
}

function calculateKenoWinnings(selectedNumbers, drawnNumbers, betAmount) {
  const matches = selectedNumbers.filter(num => drawnNumbers.includes(num)).length;
  const payoutMultiplier = KENO_CONFIG.PAYOUT_TABLE[matches] || 0;
  const baseWinnings = betAmount * selectedNumbers.length * payoutMultiplier;
  const commission = baseWinnings * KENO_CONFIG.HOUSE_COMMISSION;
  const winnings = Math.max(0, baseWinnings - commission);
  
  return {
    matches,
    payoutMultiplier,
    baseWinnings,
    commission,
    winnings,
    isWinner: winnings > 0
  };
}

// ========== PERIODIC TASKS ==========
function startKenoPeriodicTasks() {
  // Clean up stale Keno rooms every 5 minutes
  setInterval(() => {
    cleanupStaleKenoRooms();
  }, 300000);
  
  // Auto-start Keno rounds for rooms with players every 10 seconds
  setInterval(() => {
    autoStartKenoRounds();
  }, 10000);
  
  // Broadcast Keno status every 5 seconds
  setInterval(() => {
    broadcastKenoStatus();
  }, 5000);
}

function cleanupStaleKenoRooms() {
  const now = Date.now();
  const oneHourAgo = now - 3600000;
  
  kenoRooms.forEach((room, stake) => {
    if (room.players.size === 0 && room.createdAt.getTime() < oneHourAgo) {
      console.log(`🧹 Cleaning up stale Keno room: ${stake} ETB`);
      kenoRooms.delete(stake);
      
      // Clear timers
      if (kenoRoundTimers.has(stake)) {
        clearInterval(kenoRoundTimers.get(stake));
        kenoRoundTimers.delete(stake);
      }
      if (kenoDrawTimers.has(stake)) {
        clearInterval(kenoDrawTimers.get(stake));
        kenoDrawTimers.delete(stake);
      }
      if (kenoWaitingTimers.has(stake)) {
        clearInterval(kenoWaitingTimers.get(stake));
        kenoWaitingTimers.delete(stake);
      }
    }
  });
}

function autoStartKenoRounds() {
  kenoRooms.forEach((room, stake) => {
    if (room.status === 'waiting' && room.players.size >= KENO_CONFIG.MIN_PLAYERS) {
      startKenoRound(room);
    }
  });
}

// ========== ADMIN FUNCTIONS ==========
function adminForceStartKenoRound(stake) {
  const kenoRoom = kenoRooms.get(parseInt(stake));
  if (kenoRoom && kenoRoom.status === 'waiting') {
    startKenoRound(kenoRoom);
    return { success: true, message: `Keno round forced to start for stake ${stake}` };
  }
  return { success: false, message: `Cannot start Keno round for stake ${stake}` };
}

function adminForceDrawKenoNumber(stake) {
  const kenoRoom = kenoRooms.get(parseInt(stake));
  if (kenoRoom && kenoRoom.status === 'drawing') {
    // Draw a number immediately
    let number;
    do {
      number = Math.floor(Math.random() * KENO_CONFIG.MAX_NUMBERS) + 1;
    } while (kenoRoom.drawnNumbers.includes(number));
    
    kenoRoom.drawnNumbers.push(number);
    kenoRoom.currentDraw++;
    
    // Broadcast drawn number
    broadcastToKenoRoom(kenoRoom.stake, 'keno:numberDrawn', {
      stake: kenoRoom.stake,
      number: number,
      drawNumber: kenoRoom.currentDraw,
      totalDraws: KENO_CONFIG.DRAW_COUNT,
      drawnNumbers: kenoRoom.drawnNumbers
    });
    
    // Check if drawing is complete
    if (kenoRoom.currentDraw >= KENO_CONFIG.DRAW_COUNT) {
      endKenoDrawing(kenoRoom);
    }
    
    return { success: true, message: `Number ${number} drawn for Keno room ${stake}` };
  }
  return { success: false, message: `Keno room ${stake} not in drawing phase` };
}

function adminForceEndKenoRound(stake) {
  const kenoRoom = kenoRooms.get(parseInt(stake));
  if (kenoRoom) {
    // Clear all timers
    if (kenoRoundTimers.has(stake)) {
      clearInterval(kenoRoundTimers.get(stake));
      kenoRoundTimers.delete(stake);
    }
    if (kenoDrawTimers.has(stake)) {
      clearInterval(kenoDrawTimers.get(stake));
      kenoDrawTimers.delete(stake);
    }
    if (kenoWaitingTimers.has(stake)) {
      clearInterval(kenoWaitingTimers.get(stake));
      kenoWaitingTimers.delete(stake);
    }
    
    // Reset room
    resetKenoRoomForNextRound(kenoRoom);
    
    return { success: true, message: `Keno round ended for stake ${stake}` };
  }
  return { success: false, message: `Keno room not found for stake ${stake}` };
}

// ========== EXPORT FUNCTIONS ==========
module.exports = {
  // Configuration
  KENO_CONFIG,
  
  // Initialization
  initializeKeno,
  
  // Game state getters
  getKenoRooms: () => kenoRooms,
  getKenoBets: () => kenoBets,
  getKenoGameHistory: () => kenoGameHistory,
  getKenoPlayerSelections: () => kenoPlayerSelections,
  
  // Game functions
  broadcastKenoStatus,
  processKenoBet,
  handleKenoQuickPick,
  calculateKenoWinnings,
  
  // Admin functions
  adminForceStartKenoRound,
  adminForceDrawKenoNumber,
  adminForceEndKenoRound,
  
  // Helper functions
  generateQuickPickNumbers,
  
  // Game logic functions
  startKenoRound,
  endKenoBettingPeriod,
  startKenoDrawing,
  endKenoDrawing,
  distributeKenoWinnings,
  resetKenoRoomForNextRound
};