// keno-logic.js - KENO GAME LOGIC MODULE WITH STABILITY FIXES
module.exports = {
    // Game configuration - OPTIMIZED FOR HOUSE PROFIT
    CONFIG: {
        KENO_GAME_TIMER: 30,
        KENO_MIN_BET: 5,
        KENO_MAX_BET: 100,
        KENO_MIN_SELECTIONS: 1,
        KENO_MAX_SELECTIONS: 5,
        KENO_TOTAL_NUMBERS: 80,
        KENO_DRAW_COUNT: 20,
        NUMBER_POP_INTERVAL: 3000,
        
        // HOUSE-OPTIMIZED PAYOUT TABLE
        PAYOUT_TABLE: {
            1: {1: 2.5, 0: 0},
            2: {2: 8, 1: 0, 0: 0},
            3: {3: 12, 2: 0.5, 1: 0, 0: 0},
            4: {4: 35, 3: 0, 2: 0, 1: 0, 0: 0},
            5: {5: 120, 4: 35, 3: 12, 2: 0.5, 1: 0, 0: 0}
        },
        
        // HOUSE ADVANTAGE CONFIGURATION
        HOUSE_ADVANTAGE: {
            enabled: true,
            maxHouseEdge: 0.35,
            minPlayerWinRate: 0.15,
            maxPayoutPercentage: 0.65,
            adaptive: true,
            unselectedNumberWeight: 1.5,
            popularNumberPenalty: 0.3,
            minNumberProbability: 0.05,
            guaranteedLossRounds: 3,
            smallWinFrequency: 0.25,
            maxConsecutiveLosses: 8,
            winBoosterFactor: 1.15,
            luckResetThreshold: 5
        },
        
        COMMISSION_PERCENTAGE: 5,
        ALLOWED_BETS: [5, 10, 20, 50, 100],
        ALLOW_PRE_SELECTION: true,
        
        // Wallet settings
        MIN_DEPOSIT: 100,
        MAX_DEPOSIT: 10000,
        MIN_WITHDRAWAL: 100,
        WITHDRAWAL_FEE_PERCENTAGE: 5,
        
        // Connection settings
        RECONNECTION_TIMEOUT: 10000,
        MAX_CONNECTION_ATTEMPTS: 5,
        HEARTBEAT_INTERVAL: 30000
    },

    // Initialize Keno logic
    initialize: function(io, models) {
        this.io = io;
        this.User = models.User;
        this.Transaction = models.Transaction;
        this.Stats = models.Stats;
        this.WalletTransaction = models.WalletTransaction;
        
        // Active Keno games state
        this.activeKenoGames = new Map();
        this.kenoPlayers = new Map();
        this.kenoSockets = new Map();
        this.kenoRoundHistory = [];
        this.kenoRoundNumber = 1;
        this.isKenoRoundActive = false;
        this.kenoCountdown = this.CONFIG.KENO_GAME_TIMER;
        this.kenoCountdownInterval = null;
        this.totalKenoEarnings = 0;
        this.minimumPlayers = 1;
        this.isRoundScheduled = false;
        this.isDrawing = false;
        this.roundTransitionTimeout = null;
        
        // House advantage tracking
        this.houseStats = {
            totalRounds: 0,
            totalWagered: 0,
            totalPayout: 0,
            houseEdge: 0,
            playerWinRate: 0,
            consecutivePlayerWins: 0,
            consecutiveHouseWins: 0,
            maxConsecutiveHouseWins: 0,
            averagePayoutPercentage: 0,
            lastAdjustment: Date.now()
        };
        
        // Popular numbers tracking
        this.numberStats = new Map();
        for (let i = 1; i <= 80; i++) {
            this.numberStats.set(i, {
                selectedCount: 0,
                drawnCount: 0,
                lastDrawn: null,
                selectionRate: 0
            });
        }
        
        // Connection tracking
        this.connectionAttempts = new Map();
        this.heartbeatIntervals = new Map();
        
        console.log('✅ Keno game logic initialized with STABILITY FIXES');
        console.log('🎰 HOUSE-OPTIMIZED payout table loaded');
        console.log('💰 HOUSE EDGE: ~30-35% across all bet types');
        console.log('🔧 Fixed connection/disconnection freezing issues');
        
        // Load existing stats
        this.loadKenoStats();
        
        // Clean up old data periodically
        setInterval(() => {
            this.cleanupOldKenoData();
        }, 3600000);
        
        // Check game status periodically
        setInterval(() => {
            this.checkGameStatus();
        }, 5000);
        
        // Clean up stale connections
        setInterval(() => {
            this.cleanupStaleConnections();
        }, 60000);
        
        // Start heartbeat system
        this.startHeartbeatSystem();
        
        // Start game if we have players
        this.startGameIfReady();
    },

    // Load Keno stats from database
    loadKenoStats: async function() {
        try {
            const today = new Date().toISOString().split('T')[0];
            let stats = await this.Stats.findOne({ date: today });
            
            if (!stats) {
                stats = new this.Stats({
                    date: today,
                    totalWagered: 0,
                    totalEarnings: 0,
                    totalGames: 0,
                    totalUsers: 0,
                    totalKenoWagered: 0,
                    totalKenoEarnings: 0,
                    totalKenoGames: 0,
                    totalKenoWins: 0,
                    totalDeposits: 0,
                    totalWithdrawals: 0,
                    totalWalletTransactions: 0,
                    houseEdge: 0,
                    playerWinRate: 0
                });
                await stats.save();
            }
            
            this.totalKenoEarnings = stats.totalKenoEarnings || 0;
            this.houseStats.houseEdge = stats.houseEdge || 0;
            this.houseStats.playerWinRate = stats.playerWinRate || 0;
            
            console.log(`📊 Keno stats loaded: ${this.totalKenoEarnings.toFixed(2)} ETB earnings`);
            
        } catch (error) {
            console.error('Error loading Keno stats:', error);
        }
    },

    // Start heartbeat system
    startHeartbeatSystem: function() {
        setInterval(() => {
            const now = Date.now();
            
            // Check all active sockets
            for (const [socketId, socket] of this.kenoSockets) {
                if (socket && socket.connected) {
                    // Send heartbeat
                    socket.emit('keno:heartbeat', { timestamp: now });
                    
                    // Check last activity
                    if (socket.lastActivity && (now - socket.lastActivity) > 120000) {
                        console.log(`⚠️ Socket ${socketId} inactive for 2 minutes, disconnecting...`);
                        socket.disconnect(true);
                    }
                }
            }
        }, this.CONFIG.HEARTBEAT_INTERVAL);
    },

    // Handle Keno socket connection
    handleKenoConnection: function(socket) {
        const self = this;
        
        console.log(`🎰 New connection: ${socket.id}`);
        
        // Track connection attempt
        const ip = socket.handshake.address;
        const attemptCount = (this.connectionAttempts.get(ip) || 0) + 1;
        this.connectionAttempts.set(ip, attemptCount);
        
        // Rate limiting
        if (attemptCount > this.CONFIG.MAX_CONNECTION_ATTEMPTS) {
            console.log(`🚫 Rate limiting connection from ${ip} (${attemptCount} attempts)`);
            socket.emit('keno:error', { message: 'Too many connection attempts. Please try again later.' });
            setTimeout(() => {
                socket.disconnect(true);
            }, 1000);
            return;
        }
        
        // Store socket for keno
        self.kenoSockets.set(socket.id, socket);
        socket.lastActivity = Date.now();
        
        // Handle activity tracking
        socket.onAny(() => {
            socket.lastActivity = Date.now();
        });
        
        // Keno authentication
        socket.on('keno:auth', async (data) => {
            try {
                socket.lastActivity = Date.now();
                
                const { userId, userName, reconnectToken } = data;
                
                if (!userId) {
                    socket.emit('keno:error', { message: 'User ID required' });
                    return;
                }
                
                // Find user in database
                const user = await self.User.findOne({ userId: userId });
                
                if (!user) {
                    socket.emit('keno:error', { message: 'User not found. Please contact support.' });
                    return;
                }
                
                // Initialize player luck tracking if doesn't exist
                if (!user.luckStats) {
                    user.luckStats = {
                        totalRounds: 0,
                        totalWins: 0,
                        totalLosses: 0,
                        currentLossStreak: 0,
                        biggestWin: 0,
                        totalWagered: 0,
                        luckFactor: 1.0,
                        lastWinRound: 0,
                        winRate: 0
                    };
                    await user.save();
                }
                
                // Check if user is already connected from another socket
                const existingPlayer = self.kenoPlayers.get(userId);
                if (existingPlayer && existingPlayer.isOnline) {
                    const oldSocket = self.kenoSockets.get(existingPlayer.socketId);
                    if (oldSocket && oldSocket.id !== socket.id) {
                        console.log(`🔄 User ${userName} reconnected from new socket, disconnecting old socket ${existingPlayer.socketId}`);
                        oldSocket.emit('keno:force_disconnect', { 
                            message: 'Connected from another device/location',
                            reason: 'duplicate_connection'
                        });
                        setTimeout(() => {
                            if (oldSocket.connected) {
                                oldSocket.disconnect(true);
                            }
                        }, 1000);
                        
                        // Clear old connection
                        self.kenoSockets.delete(existingPlayer.socketId);
                    }
                }
                
                // Store player info
                socket.userId = userId;
                socket.userName = userName;
                socket.kenoPlayer = true;
                
                // Get current game state
                const activeGame = self.getActiveKenoGame();
                const currentDrawnNumbers = activeGame.drawnNumbers || [];
                const currentRoundNumber = self.kenoRoundNumber;
                const isRoundActive = self.isKenoRoundActive;
                const countdown = self.kenoCountdown;
                const currentRoundBets = activeGame.bets || {};
                const playerHasBetInCurrentRound = !!currentRoundBets[userId];
                
                // Update or create player entry
                const playerData = {
                    socketId: socket.id,
                    userId: userId,
                    userName: userName,
                    balance: user.balance,
                    currentBet: playerHasBetInCurrentRound ? activeGame.bets[userId]?.amount : null,
                    selectedNumbers: playerHasBetInCurrentRound ? activeGame.bets[userId]?.numbers || [] : [],
                    hasPlacedBet: playerHasBetInCurrentRound,
                    totalWagered: user.totalWagered || 0,
                    totalWins: user.totalWins || 0,
                    isOnline: true,
                    lastSeen: new Date(),
                    lastActive: new Date(),
                    preSelectedNumbers: [],
                    isReadyForNextRound: false,
                    sessionStart: new Date(),
                    totalDeposits: user.totalDeposits || 0,
                    totalWithdrawals: user.totalWithdrawals || 0,
                    isNewInCurrentRound: !playerHasBetInCurrentRound && currentDrawnNumbers.length > 0,
                    luckStats: user.luckStats,
                    connectionId: socket.id,
                    ipAddress: socket.handshake.address,
                    userAgent: socket.handshake.headers['user-agent']
                };
                
                self.kenoPlayers.set(userId, playerData);
                
                // Update user online status
                user.isOnline = true;
                user.lastSeen = new Date();
                user.sessionCount = (user.sessionCount || 0) + 1;
                await user.save();
                
                // Join Keno room
                socket.join('keno');
                
                // Clear connection attempts on successful auth
                self.connectionAttempts.delete(ip);
                
                // Send welcome data
                const welcomeData = {
                    playerId: userId,
                    userName: userName,
                    balance: user.balance,
                    currentRound: currentRoundNumber,
                    isRoundActive: isRoundActive,
                    countdown: countdown,
                    nextDrawTime: Date.now() + (countdown * 1000),
                    roundHistory: self.kenoRoundHistory.slice(0, 10),
                    payoutTable: self.CONFIG.PAYOUT_TABLE,
                    playersCount: activeGame ? activeGame.players.length : 0,
                    totalBets: activeGame ? activeGame.totalBets : 0,
                    currentDrawnNumbers: currentDrawnNumbers,
                    isDrawComplete: activeGame.drawComplete || false,
                    hasBetInCurrentRound: playerHasBetInCurrentRound,
                    isDrawing: activeGame.status === 'drawing',
                    config: {
                        minBet: self.CONFIG.KENO_MIN_BET,
                        maxBet: self.CONFIG.KENO_MAX_BET,
                        minSelections: self.CONFIG.KENO_MIN_SELECTIONS,
                        maxSelections: self.CONFIG.KENO_MAX_SELECTIONS,
                        totalNumbers: self.CONFIG.KENO_TOTAL_NUMBERS,
                        drawCount: self.CONFIG.KENO_DRAW_COUNT,
                        gameTimer: self.CONFIG.KENO_GAME_TIMER,
                        allowPreSelection: self.CONFIG.ALLOW_PRE_SELECTION,
                        allowedBets: self.CONFIG.ALLOWED_BETS
                    }
                };
                
                socket.emit('keno:welcome', welcomeData);
                
                console.log(`🎰 Player authenticated: ${userName} - Socket: ${socket.id}`);
                
                // If draw is already in progress or complete, handle it properly
                if (currentDrawnNumbers.length > 0) {
                    if (activeGame.drawComplete) {
                        socket.emit('keno:round_results', {
                            round: currentRoundNumber,
                            drawnNumbers: currentDrawnNumbers,
                            playersCount: activeGame.players.length,
                            totalBets: activeGame.totalBets,
                            isDrawComplete: true,
                            message: `Round ${currentRoundNumber} results!`,
                            totalDrawn: currentDrawnNumbers.length
                        });
                        
                        if (playerHasBetInCurrentRound && activeGame.processedResults) {
                            setTimeout(() => {
                                self.sendPlayerRoundResult(socket, userId, activeGame);
                            }, 1000);
                        }
                    } else if (activeGame.status === 'drawing') {
                        const drawState = {
                            round: currentRoundNumber,
                            currentBall: currentDrawnNumbers.length,
                            totalBalls: self.CONFIG.KENO_DRAW_COUNT,
                            playersCount: activeGame.players.length,
                            totalBets: activeGame.totalBets,
                            message: 'Draw in progress. Watching live...',
                            isNewPlayer: true
                        };
                        
                        if (playerHasBetInCurrentRound) {
                            drawState.drawnNumbers = currentDrawnNumbers;
                            drawState.hasBet = true;
                        } else {
                            drawState.hasBet = false;
                        }
                        
                        socket.emit('keno:draw_state', drawState);
                    }
                }
                
                // Broadcast updated player count
                self.broadcastKenoPlayersUpdate();
                
                // Check if we should start a new round
                if (!self.isKenoRoundActive && 
                    !self.isDrawing &&
                    activeGame.status === 'waiting' && 
                    !self.isRoundScheduled &&
                    self.getOnlinePlayersCount() >= self.minimumPlayers) {
                    
                    setTimeout(() => {
                        self.startGameIfReady();
                    }, 3000);
                }
                
            } catch (error) {
                console.error('Keno auth error:', error);
                socket.emit('keno:error', { message: 'Authentication failed. Please try again.' });
                setTimeout(() => {
                    if (socket.connected) {
                        socket.disconnect(true);
                    }
                }, 2000);
            }
        });
        
        // Place bet in Keno
        socket.on('keno:placeBet', async (data) => {
            try {
                socket.lastActivity = Date.now();
                
                const { numbers, betAmount } = data;
                
                if (!socket.userId) {
                    socket.emit('keno:error', { message: 'Not authenticated' });
                    return;
                }
                
                const player = self.kenoPlayers.get(socket.userId);
                if (!player) {
                    socket.emit('keno:error', { message: 'Player not found' });
                    return;
                }
                
                // Check if player is online
                if (!player.isOnline) {
                    socket.emit('keno:error', { message: 'Player is offline' });
                    return;
                }
                
                // Check if round is active
                if (!self.isKenoRoundActive) {
                    socket.emit('keno:error', { message: 'Round not active. Please wait for next round.' });
                    return;
                }
                
                // Check if already placed bet in this round
                if (player.hasPlacedBet) {
                    socket.emit('keno:error', { message: 'You have already placed a bet this round' });
                    return;
                }
                
                // Validate bet amount
                const bet = parseFloat(betAmount);
                if (isNaN(bet) || !self.CONFIG.ALLOWED_BETS.includes(bet)) {
                    socket.emit('keno:error', { message: `Bet amount must be one of: ${self.CONFIG.ALLOWED_BETS.join(', ')} ETB` });
                    return;
                }
                
                // Validate numbers
                if (!Array.isArray(numbers) || 
                    numbers.length < self.CONFIG.KENO_MIN_SELECTIONS || 
                    numbers.length > self.CONFIG.KENO_MAX_SELECTIONS) {
                    socket.emit('keno:error', { message: `You must select ${self.CONFIG.KENO_MIN_SELECTIONS}-${self.CONFIG.KENO_MAX_SELECTIONS} numbers` });
                    return;
                }
                
                // Check unique numbers
                const uniqueNumbers = [...new Set(numbers)];
                if (uniqueNumbers.length !== numbers.length) {
                    socket.emit('keno:error', { message: 'Duplicate numbers not allowed' });
                    return;
                }
                
                // Check number range
                for (const num of numbers) {
                    const n = parseInt(num);
                    if (isNaN(n) || n < 1 || n > self.CONFIG.KENO_TOTAL_NUMBERS) {
                        socket.emit('keno:error', { message: `Numbers must be between 1 and ${self.CONFIG.KENO_TOTAL_NUMBERS}` });
                        return;
                    }
                }
                
                // Sort numbers
                const sortedNumbers = [...numbers].sort((a, b) => a - b);
                
                // Update number stats (for house advantage system)
                sortedNumbers.forEach(num => {
                    const stats = self.numberStats.get(num);
                    if (stats) {
                        stats.selectedCount++;
                        stats.selectionRate = stats.selectedCount / Math.max(1, self.houseStats.totalRounds);
                    }
                });
                
                // Check balance
                const user = await self.User.findOne({ userId: socket.userId });
                if (!user || user.balance < bet) {
                    socket.emit('keno:error', { message: 'Insufficient balance' });
                    return;
                }
                
                // Calculate potential winnings
                const selectionCount = sortedNumbers.length;
                let potentialWinnings = 0;
                
                if (self.CONFIG.PAYOUT_TABLE[selectionCount]) {
                    const maxMatches = Math.min(selectionCount, self.CONFIG.KENO_DRAW_COUNT);
                    const maxPayout = self.CONFIG.PAYOUT_TABLE[selectionCount][maxMatches];
                    if (maxPayout !== undefined && maxPayout > 0) {
                        potentialWinnings = bet * maxPayout;
                    }
                }
                
                // Deduct bet amount
                user.balance -= bet;
                user.totalWagered += bet;
                user.kenoBets = (user.kenoBets || 0) + 1;
                
                // Update luck stats
                user.luckStats.totalRounds++;
                user.luckStats.totalWagered += bet;
                user.luckStats.winRate = user.luckStats.totalWins / Math.max(1, user.luckStats.totalRounds);
                
                await user.save();
                
                // Update player state
                player.balance = user.balance;
                player.selectedNumbers = sortedNumbers;
                player.currentBet = bet;
                player.hasPlacedBet = true;
                player.totalWagered += bet;
                player.isReadyForNextRound = false;
                player.isNewInCurrentRound = false;
                player.luckStats = user.luckStats;
                player.lastActive = new Date();
                self.kenoPlayers.set(socket.userId, player);
                
                // Add to active game
                const activeGame = self.getActiveKenoGame();
                if (!activeGame.players.includes(socket.userId)) {
                    activeGame.players.push(socket.userId);
                }
                
                // Add bet with luck factor included
                activeGame.bets[socket.userId] = {
                    numbers: sortedNumbers,
                    amount: bet,
                    selectionCount: sortedNumbers.length,
                    placedAt: new Date(),
                    userName: player.userName,
                    potentialWinnings: potentialWinnings,
                    luckFactor: player.luckStats.luckFactor || 1.0,
                    lossStreak: player.luckStats.currentLossStreak || 0,
                    socketId: socket.id
                };
                activeGame.totalBets++;
                activeGame.totalBetAmount += bet;
                
                // Create transaction record
                const transaction = new self.Transaction({
                    type: 'KENO_BET',
                    userId: socket.userId,
                    userName: player.userName,
                    amount: -bet,
                    description: `Keno bet: ${bet} ETB on ${sortedNumbers.length} numbers`,
                    game: 'keno',
                    status: 'completed',
                    details: {
                        numbers: sortedNumbers,
                        round: activeGame.roundNumber,
                        selectionCount: sortedNumbers.length,
                        potentialWinnings: potentialWinnings,
                        luckFactor: player.luckStats.luckFactor
                    }
                });
                await transaction.save();
                
                // Update stats
                await self.updateKenoStats(bet, 0, 0, 0, 1);
                
                // Emit confirmation
                socket.emit('keno:betConfirmed', {
                    success: true,
                    balance: user.balance,
                    betAmount: bet,
                    numbers: sortedNumbers,
                    selectionCount: sortedNumbers.length,
                    potentialWinnings: potentialWinnings,
                    message: `Bet placed: ${bet} ETB on ${sortedNumbers.length} numbers`,
                    payoutTable: self.CONFIG.PAYOUT_TABLE[selectionCount]
                });
                
                // Broadcast updated player count
                self.broadcastKenoPlayersUpdate();
                
                console.log(`🎰 Bet placed: ${player.userName} - ${bet} ETB on ${sortedNumbers.length} numbers`);
                
            } catch (error) {
                console.error('Keno place bet error:', error);
                socket.emit('keno:error', { message: 'Failed to place bet. Please try again.' });
            }
        });
        
        // Get current game state
        socket.on('keno:getState', () => {
            try {
                socket.lastActivity = Date.now();
                
                if (!socket.userId) {
                    socket.emit('keno:error', { message: 'Not authenticated' });
                    return;
                }
                
                const player = self.kenoPlayers.get(socket.userId);
                if (!player) {
                    socket.emit('keno:error', { message: 'Player not found' });
                    return;
                }
                
                const activeGame = self.getActiveKenoGame();
                
                // Calculate potential winnings
                let potentialWinnings = 0;
                if (player.selectedNumbers.length > 0 && player.currentBet) {
                    const selectionCount = player.selectedNumbers.length;
                    if (self.CONFIG.PAYOUT_TABLE[selectionCount]) {
                        const maxMatches = Math.min(selectionCount, self.CONFIG.KENO_DRAW_COUNT);
                        const maxPayout = self.CONFIG.PAYOUT_TABLE[selectionCount][maxMatches];
                        if (maxPayout !== undefined && maxPayout > 0) {
                            potentialWinnings = player.currentBet * maxPayout;
                        }
                    }
                }
                
                socket.emit('keno:state', {
                    success: true,
                    balance: player.balance,
                    currentRound: self.kenoRoundNumber,
                    isRoundActive: self.isKenoRoundActive,
                    countdown: self.kenoCountdown,
                    playersCount: activeGame ? activeGame.players.length : 0,
                    totalBets: activeGame ? activeGame.totalBets : 0,
                    hasPlacedBet: player.hasPlacedBet,
                    selectedNumbers: player.selectedNumbers,
                    currentBet: player.currentBet,
                    preSelectedNumbers: player.preSelectedNumbers,
                    isReadyForNextRound: player.isReadyForNextRound,
                    selectionCount: player.selectedNumbers.length,
                    preSelectionCount: player.preSelectedNumbers.length,
                    currentDrawnNumbers: activeGame.drawnNumbers || [],
                    isDrawComplete: activeGame.drawComplete || false,
                    potentialWinnings: potentialWinnings,
                    payoutTable: self.CONFIG.PAYOUT_TABLE[player.selectedNumbers.length] || {}
                });
                
            } catch (error) {
                console.error('Keno get state error:', error);
                socket.emit('keno:error', { message: 'Failed to get game state' });
            }
        });
        
        // Get user balance
        socket.on('keno:getBalance', async () => {
            try {
                socket.lastActivity = Date.now();
                
                if (!socket.userId) {
                    socket.emit('keno:error', { message: 'Not authenticated' });
                    return;
                }
                
                const user = await self.User.findOne({ userId: socket.userId });
                if (!user) {
                    socket.emit('keno:error', { message: 'User not found' });
                    return;
                }
                
                // Update player state
                const player = self.kenoPlayers.get(socket.userId);
                if (player) {
                    player.balance = user.balance;
                    player.lastActive = new Date();
                    self.kenoPlayers.set(socket.userId, player);
                }
                
                socket.emit('keno:balance', {
                    success: true,
                    balance: user.balance,
                    userName: user.userName,
                    totalDeposits: user.totalDeposits || 0,
                    totalWithdrawals: user.totalWithdrawals || 0,
                    totalWagered: user.totalWagered || 0,
                    totalWins: user.totalWins || 0
                });
                
            } catch (error) {
                console.error('Keno get balance error:', error);
                socket.emit('keno:error', { message: 'Failed to get balance' });
            }
        });
        
        // Quick pick numbers
        socket.on('keno:quickPick', (data) => {
            try {
                socket.lastActivity = Date.now();
                
                if (!socket.userId) {
                    socket.emit('keno:error', { message: 'Not authenticated' });
                    return;
                }
                
                const player = self.kenoPlayers.get(socket.userId);
                if (!player) {
                    socket.emit('keno:error', { message: 'Player not found' });
                    return;
                }
                
                // Determine how many numbers to generate
                let count = self.CONFIG.KENO_MAX_SELECTIONS;
                if (data && data.count) {
                    count = Math.min(Math.max(data.count, self.CONFIG.KENO_MIN_SELECTIONS), self.CONFIG.KENO_MAX_SELECTIONS);
                }
                
                // Generate random unique numbers
                const numbers = [];
                while (numbers.length < count) {
                    const num = Math.floor(Math.random() * self.CONFIG.KENO_TOTAL_NUMBERS) + 1;
                    if (!numbers.includes(num)) {
                        numbers.push(num);
                    }
                }
                
                numbers.sort((a, b) => a - b);
                
                socket.emit('keno:quickPickNumbers', { 
                    success: true,
                    numbers: numbers,
                    count: numbers.length
                });
                
                console.log(`🎲 Quick pick generated ${numbers.length} numbers for ${player.userName}`);
                
            } catch (error) {
                console.error('Keno quick pick error:', error);
                socket.emit('keno:error', { message: 'Failed to generate quick pick' });
            }
        });
        
        // Clear selection
        socket.on('keno:clearSelection', () => {
            try {
                socket.lastActivity = Date.now();
                
                if (!socket.userId) {
                    socket.emit('keno:error', { message: 'Not authenticated' });
                    return;
                }
                
                const player = self.kenoPlayers.get(socket.userId);
                if (!player) {
                    socket.emit('keno:error', { message: 'Player not found' });
                    return;
                }
                
                // Only allow clearing if haven't placed bet yet in active round
                if (!player.hasPlacedBet || !self.isKenoRoundActive) {
                    player.selectedNumbers = [];
                    player.currentBet = null;
                    player.lastActive = new Date();
                    self.kenoPlayers.set(socket.userId, player);
                    
                    socket.emit('keno:selectionCleared', {
                        success: true,
                        message: 'Selection cleared'
                    });
                } else {
                    socket.emit('keno:error', { message: 'Cannot clear after placing bet in active round' });
                }
                
            } catch (error) {
                console.error('Keno clear selection error:', error);
                socket.emit('keno:error', { message: 'Failed to clear selection' });
            }
        });
        
        // Pre-select numbers for next round
        socket.on('keno:preselect', async (data) => {
            try {
                socket.lastActivity = Date.now();
                
                const { numbers } = data;
                
                if (!socket.userId) {
                    socket.emit('keno:error', { message: 'Not authenticated' });
                    return;
                }
                
                const player = self.kenoPlayers.get(socket.userId);
                if (!player) {
                    socket.emit('keno:error', { message: 'Player not found' });
                    return;
                }
                
                // Validate numbers
                if (!Array.isArray(numbers) || 
                    numbers.length < self.CONFIG.KENO_MIN_SELECTIONS || 
                    numbers.length > self.CONFIG.KENO_MAX_SELECTIONS) {
                    socket.emit('keno:error', { message: `You must select ${self.CONFIG.KENO_MIN_SELECTIONS}-${self.CONFIG.KENO_MAX_SELECTIONS} numbers` });
                    return;
                }
                
                // Check unique numbers
                const uniqueNumbers = [...new Set(numbers)];
                if (uniqueNumbers.length !== numbers.length) {
                    socket.emit('keno:error', { message: 'Duplicate numbers not allowed' });
                    return;
                }
                
                // Check number range
                for (const num of numbers) {
                    const n = parseInt(num);
                    if (isNaN(n) || n < 1 || n > self.CONFIG.KENO_TOTAL_NUMBERS) {
                        socket.emit('keno:error', { message: `Numbers must be between 1 and ${self.CONFIG.KENO_TOTAL_NUMBERS}` });
                        return;
                    }
                }
                
                // Sort numbers
                const sortedNumbers = [...numbers].sort((a, b) => a - b);
                
                // Update player state
                player.preSelectedNumbers = sortedNumbers;
                player.isReadyForNextRound = true;
                player.lastActive = new Date();
                self.kenoPlayers.set(socket.userId, player);
                
                // Emit confirmation
                socket.emit('keno:preselectConfirmed', {
                    success: true,
                    numbers: sortedNumbers,
                    selectionCount: sortedNumbers.length,
                    message: `Numbers pre-selected for next round (${sortedNumbers.length} numbers)`
                });
                
                console.log(`🎯 Player ${player.userName} pre-selected ${sortedNumbers.length} numbers for next round`);
                
            } catch (error) {
                console.error('Keno pre-select error:', error);
                socket.emit('keno:error', { message: 'Failed to pre-select numbers' });
            }
        });
        
        // Clear pre-selection
        socket.on('keno:clearPreselection', () => {
            try {
                socket.lastActivity = Date.now();
                
                if (!socket.userId) {
                    socket.emit('keno:error', { message: 'Not authenticated' });
                    return;
                }
                
                const player = self.kenoPlayers.get(socket.userId);
                if (!player) {
                    socket.emit('keno:error', { message: 'Player not found' });
                    return;
                }
                
                player.preSelectedNumbers = [];
                player.isReadyForNextRound = false;
                player.lastActive = new Date();
                self.kenoPlayers.set(socket.userId, player);
                
                socket.emit('keno:preselectionCleared', {
                    success: true,
                    message: 'Pre-selection cleared'
                });
                
            } catch (error) {
                console.error('Keno clear pre-selection error:', error);
                socket.emit('keno:error', { message: 'Failed to clear pre-selection' });
            }
        });
        
        // Get potential winnings
        socket.on('keno:getPotentialWinnings', (data) => {
            try {
                socket.lastActivity = Date.now();
                
                if (!socket.userId) {
                    socket.emit('keno:error', { message: 'Not authenticated' });
                    return;
                }
                
                const { numbers, betAmount, selectionCount } = data;
                const bet = parseFloat(betAmount) || 5;
                const count = selectionCount || (numbers ? numbers.length : 0);
                
                if (count < 1 || count > 5) {
                    socket.emit('keno:potentialWinnings', {
                        success: false,
                        message: 'Invalid selection count'
                    });
                    return;
                }
                
                const payoutTable = self.CONFIG.PAYOUT_TABLE[count] || {};
                const potentialWinnings = {};
                
                // Calculate winnings for each possible match count
                for (let matches = 0; matches <= Math.min(count, self.CONFIG.KENO_DRAW_COUNT); matches++) {
                    const payoutMultiplier = payoutTable[matches] || 0;
                    potentialWinnings[matches] = {
                        multiplier: payoutMultiplier,
                        amount: bet * payoutMultiplier,
                        matches: matches,
                        totalSelected: count
                    };
                }
                
                // Also send maximum possible win
                const maxMatches = Math.min(count, self.CONFIG.KENO_DRAW_COUNT);
                const maxPayout = payoutTable[maxMatches] || 0;
                
                socket.emit('keno:potentialWinnings', {
                    success: true,
                    betAmount: bet,
                    selectionCount: count,
                    payoutTable: payoutTable,
                    potentialWinnings: potentialWinnings,
                    maxPossibleWin: bet * maxPayout,
                    message: `Potential winnings for ${count} numbers with ${bet} ETB bet`
                });
                
            } catch (error) {
                console.error('Get potential winnings error:', error);
                socket.emit('keno:error', { message: 'Failed to calculate potential winnings' });
            }
        });
        
        // Get draw state
        socket.on('keno:getDrawState', () => {
            try {
                socket.lastActivity = Date.now();
                
                if (!socket.userId) {
                    socket.emit('keno:error', { message: 'Not authenticated' });
                    return;
                }
                
                const activeGame = self.getActiveKenoGame();
                const playerHasBet = !!activeGame.bets[socket.userId];
                
                if (activeGame.status === 'drawing' && activeGame.drawnNumbers.length > 0) {
                    const drawState = {
                        round: activeGame.roundNumber,
                        currentBall: activeGame.drawnNumbers.length,
                        totalBalls: self.CONFIG.KENO_DRAW_COUNT,
                        playersCount: activeGame.players.length,
                        totalBets: activeGame.totalBets,
                        message: 'Draw in progress. Watching live...',
                        hasBet: playerHasBet
                    };
                    
                    if (playerHasBet) {
                        drawState.drawnNumbers = activeGame.drawnNumbers;
                        drawState.message = 'Draw in progress. You have a bet in this round.';
                    }
                    
                    socket.emit('keno:draw_state', drawState);
                }
            } catch (error) {
                console.error('Get draw state error:', error);
            }
        });
        
        // Heartbeat response
        socket.on('keno:heartbeat_response', (data) => {
            socket.lastActivity = Date.now();
            
            const player = self.kenoPlayers.get(socket.userId);
            if (player) {
                player.lastActive = new Date();
                self.kenoPlayers.set(socket.userId, player);
            }
        });
        
        // Ping request
        socket.on('keno:ping', () => {
            socket.lastActivity = Date.now();
            socket.emit('keno:pong', { timestamp: Date.now() });
        });
        
        // Handle disconnection
        socket.on('disconnect', (reason) => {
            self.handleKenoDisconnect(socket, reason);
        });
        
        // Handle connection error
        socket.on('connect_error', (error) => {
            console.error(`Socket connection error for ${socket.id}:`, error);
        });
    },
    
    // Handle Keno disconnection - FIXED VERSION
    handleKenoDisconnect: function(socket, reason) {
        const self = this;
        
        console.log(`🎰 Disconnected: ${socket.id} - Reason: ${reason || 'unknown'}`);
        
        // Remove socket from keno sockets
        self.kenoSockets.delete(socket.id);
        
        // Update user offline status if authenticated
        if (socket.userId) {
            const player = self.kenoPlayers.get(socket.userId);
            if (player) {
                // Only mark as offline if this is the same socket
                if (player.socketId === socket.id) {
                    player.isOnline = false;
                    player.lastSeen = new Date();
                    player.lastActive = new Date();
                    self.kenoPlayers.set(socket.userId, player);
                    
                    // Update in database (async, don't wait)
                    self.User.findOneAndUpdate(
                        { userId: socket.userId },
                        { 
                            isOnline: false,
                            lastSeen: new Date()
                        }
                    ).catch(err => console.error('Error updating user status:', err));
                    
                    console.log(`📱 Player ${player.userName} marked offline`);
                } else {
                    // Different socket, keep online status
                    console.log(`🔀 Player ${player.userName} still has another active connection`);
                }
            }
        }
        
        // Clean up any bets from this socket in active game
        const activeGame = self.getActiveKenoGame();
        if (activeGame && activeGame.bets) {
            for (const [playerId, bet] of Object.entries(activeGame.bets)) {
                if (bet.socketId === socket.id) {
                    // Don't remove the bet, just log
                    console.log(`⚠️ Bet from socket ${socket.id} found in active game`);
                }
            }
        }
        
        // Broadcast updated player count
        setTimeout(() => {
            self.broadcastKenoPlayersUpdate();
        }, 100);
        
        // Check if we need to pause the game (no players left)
        const onlinePlayers = self.getOnlinePlayersCount();
        
        if (onlinePlayers === 0) {
            if (self.isKenoRoundActive && !self.isDrawing) {
                console.log('🎰 No players online, pausing game...');
                self.pauseKenoGame();
            }
        }
        
        // Clean up heartbeat interval
        if (self.heartbeatIntervals.has(socket.id)) {
            clearInterval(self.heartbeatIntervals.get(socket.id));
            self.heartbeatIntervals.delete(socket.id);
        }
    },
    
    // Clean up stale connections
    cleanupStaleConnections: function() {
        const now = Date.now();
        let cleaned = 0;
        
        // Clean up stale players (offline for more than 5 minutes)
        for (const [userId, player] of this.kenoPlayers) {
            if (!player.isOnline && player.lastActive) {
                const timeDiff = now - player.lastActive.getTime();
                if (timeDiff > 300000) { // 5 minutes
                    this.kenoPlayers.delete(userId);
                    cleaned++;
                    console.log(`🧹 Removed stale player: ${player.userName}`);
                }
            }
        }
        
        // Clean up connection attempts
        for (const [ip, timestamp] of this.connectionAttempts) {
            if (now - timestamp > 600000) { // 10 minutes
                this.connectionAttempts.delete(ip);
            }
        }
        
        if (cleaned > 0) {
            console.log(`🧹 Cleaned up ${cleaned} stale connections`);
        }
    },
    
    // Start Keno game round
    startKenoRound: function() {
        const self = this;
        
        // Clear any scheduled flag
        self.isRoundScheduled = false;
        
        // Clear any existing timeout
        if (self.roundTransitionTimeout) {
            clearTimeout(self.roundTransitionTimeout);
            self.roundTransitionTimeout = null;
        }
        
        // Check if we have minimum players
        const onlinePlayers = self.getOnlinePlayersCount();
        if (onlinePlayers < self.minimumPlayers) {
            console.log('🎰 Not enough players to start round. Waiting...');
            self.io.to('keno').emit('keno:waiting', {
                message: 'Waiting for players...',
                playersNeeded: self.minimumPlayers
            });
            return;
        }
        
        // Check if round is already active or drawing
        if (self.isKenoRoundActive || self.isDrawing) {
            console.log('🎰 Round or draw already active, not starting new one');
            return;
        }
        
        console.log('🎰 Starting new Keno round...');
        
        self.isKenoRoundActive = true;
        self.isDrawing = false;
        self.kenoCountdown = self.CONFIG.KENO_GAME_TIMER;
        
        // Create new active game
        const gameId = Date.now();
        const activeGame = {
            id: gameId,
            roundNumber: self.kenoRoundNumber,
            startTime: new Date(),
            endTime: null,
            status: 'betting',
            players: [],
            bets: {},
            drawnNumbers: [],
            drawnNumbersOriginalOrder: [],
            winners: [],
            totalBets: 0,
            totalBetAmount: 0,
            totalPayout: 0,
            commissionCollected: 0,
            drawComplete: false,
            processedResults: false
        };
        
        self.activeKenoGames.set('current', activeGame);
        
        // Broadcast round start
        self.io.to('keno').emit('keno:round_start', {
            round: activeGame.roundNumber,
            duration: self.CONFIG.KENO_GAME_TIMER,
            message: `Round ${activeGame.roundNumber} started! Place your bets!`,
            minSelections: self.CONFIG.KENO_MIN_SELECTIONS,
            maxSelections: self.CONFIG.KENO_MAX_SELECTIONS,
            drawCount: self.CONFIG.KENO_DRAW_COUNT
        });
        
        // Reset all players' bet status
        for (const [userId, player] of self.kenoPlayers) {
            // Only reset bet status for online players
            if (player.isOnline) {
                player.hasPlacedBet = false;
                player.currentBet = null;
                
                // Auto-apply pre-selected numbers if player is ready
                if (player.isReadyForNextRound && 
                    player.preSelectedNumbers.length >= self.CONFIG.KENO_MIN_SELECTIONS &&
                    player.preSelectedNumbers.length <= self.CONFIG.KENO_MAX_SELECTIONS) {
                    player.selectedNumbers = [...player.preSelectedNumbers];
                    
                    // Notify player that pre-selected numbers were applied
                    const playerSocket = self.getKenoSocketByUserId(userId);
                    if (playerSocket) {
                        playerSocket.emit('keno:autoSelect', {
                            numbers: player.selectedNumbers,
                            selectionCount: player.selectedNumbers.length,
                            message: 'Your pre-selected numbers have been applied!'
                        });
                    }
                } else {
                    // Keep existing selectedNumbers if they have 1-5 numbers
                    if (player.selectedNumbers.length < self.CONFIG.KENO_MIN_SELECTIONS || 
                        player.selectedNumbers.length > self.CONFIG.KENO_MAX_SELECTIONS) {
                        player.selectedNumbers = [];
                    }
                }
                
                // Reset new player flag for this round
                player.isNewInCurrentRound = false;
                
                self.kenoPlayers.set(userId, player);
            }
        }
        
        // Start countdown
        self.startKenoCountdown();
    },
    
    // Start game if ready
    startGameIfReady: function() {
        const self = this;
        
        const activeGame = self.getActiveKenoGame();
        const gameStatus = activeGame.status || 'waiting';
        
        // Only start a new round if:
        // 1. No round is active
        // 2. Not currently drawing
        // 3. Game status is 'waiting' 
        // 4. No round is already scheduled
        // 5. We have minimum players
        if (!self.isKenoRoundActive && 
            !self.isDrawing &&
            gameStatus === 'waiting' && 
            !self.isRoundScheduled &&
            self.getOnlinePlayersCount() >= self.minimumPlayers) {
            
            console.log('🎰 Starting new round from startGameIfReady...');
            self.isRoundScheduled = true;
            
            // Clear any existing timeout
            if (self.roundTransitionTimeout) {
                clearTimeout(self.roundTransitionTimeout);
                self.roundTransitionTimeout = null;
            }
            
            // Start round after 3 seconds
            self.roundTransitionTimeout = setTimeout(() => {
                self.startKenoRound();
            }, 3000);
        }
    },
    
    // Pause Keno game when no players
    pauseKenoGame: function() {
        const self = this;
        
        if (self.kenoCountdownInterval) {
            clearInterval(self.kenoCountdownInterval);
            self.kenoCountdownInterval = null;
        }
        
        // Clear any existing timeout
        if (self.roundTransitionTimeout) {
            clearTimeout(self.roundTransitionTimeout);
            self.roundTransitionTimeout = null;
        }
        
        self.isKenoRoundActive = false;
        self.isDrawing = false;
        self.isRoundScheduled = false;
        
        // Broadcast game paused
        self.io.to('keno').emit('keno:game_paused', {
            message: 'Game paused. Waiting for players...'
        });
        
        console.log('🎰 Game paused due to no players');
    },
    
    // Start Keno countdown
    startKenoCountdown: function() {
        const self = this;
        
        // Clear any existing interval
        if (self.kenoCountdownInterval) {
            clearInterval(self.kenoCountdownInterval);
            self.kenoCountdownInterval = null;
        }
        
        self.kenoCountdown = self.CONFIG.KENO_GAME_TIMER;
        
        // Broadcast initial countdown
        self.io.to('keno').emit('keno:countdown_update', {
            countdown: self.kenoCountdown
        });
        
        self.kenoCountdownInterval = setInterval(() => {
            // Check if round is still active
            if (!self.isKenoRoundActive) {
                clearInterval(self.kenoCountdownInterval);
                self.kenoCountdownInterval = null;
                return;
            }
            
            self.kenoCountdown--;
            
            // Check if we still have players
            const onlinePlayers = self.getOnlinePlayersCount();
            if (onlinePlayers === 0) {
                clearInterval(self.kenoCountdownInterval);
                self.kenoCountdownInterval = null;
                self.pauseKenoGame();
                return;
            }
            
            // Broadcast countdown update
            self.io.to('keno').emit('keno:countdown_update', {
                countdown: self.kenoCountdown
            });
            
            // Last 10 seconds warning
            if (self.kenoCountdown === 10) {
                self.io.to('keno').emit('keno:warning', {
                    message: '10 seconds remaining to place bets!',
                    type: 'warning'
                });
            }
            
            // Last 5 seconds warning
            if (self.kenoCountdown <= 5 && self.kenoCountdown > 0) {
                self.io.to('keno').emit('keno:countdown_warning', {
                    countdown: self.kenoCountdown,
                    message: `${self.kenoCountdown}...`
                });
            }
            
            if (self.kenoCountdown <= 0) {
                clearInterval(self.kenoCountdownInterval);
                self.kenoCountdownInterval = null;
                self.drawKenoNumbers();
            }
        }, 1000);
    },
    
    // Draw Keno numbers with HOUSE ADVANTAGE
    drawKenoNumbers: async function() {
        const self = this;
        const activeGame = self.getActiveKenoGame();
        
        if (!activeGame || activeGame.status !== 'betting') return;
        
        console.log('🎰 Drawing Keno numbers with HOUSE ADVANTAGE...');
        
        activeGame.status = 'drawing';
        self.isKenoRoundActive = false;
        self.isDrawing = true;
        
        // Broadcast draw start
        self.io.to('keno').emit('keno:draw_start', {
            round: activeGame.roundNumber,
            message: 'Drawing numbers...',
            popInterval: self.CONFIG.NUMBER_POP_INTERVAL,
            totalBalls: self.CONFIG.KENO_DRAW_COUNT,
            willBeRandomOrder: true
        });
        
        // Wait 2 seconds for dramatic effect
        setTimeout(async () => {
            // Calculate house advantage numbers
            const drawnNumbers = self.calculateHouseAdvantageNumbers(activeGame);
            
            // Store in original random order
            activeGame.drawnNumbersOriginalOrder = [...drawnNumbers];
            activeGame.drawnNumbers = drawnNumbers;
            
            // Update number stats
            drawnNumbers.forEach(num => {
                const stats = self.numberStats.get(num);
                if (stats) {
                    stats.drawnCount++;
                    stats.lastDrawn = new Date();
                }
            });
            
            console.log(`🎰 Numbers drawn with house advantage: ${drawnNumbers.join(', ')}`);
            
            // Draw numbers one by one
            for (let i = 0; i < drawnNumbers.length; i++) {
                setTimeout(() => {
                    self.io.to('keno').emit('keno:number_drawn', {
                        number: drawnNumbers[i],
                        index: i,
                        total: drawnNumbers.length,
                        drawnCount: i + 1,
                        round: activeGame.roundNumber,
                        isRandomOrder: true
                    });
                }, i * self.CONFIG.NUMBER_POP_INTERVAL);
            }
            
            // After all numbers are drawn
            setTimeout(() => {
                const sortedForDisplay = [...drawnNumbers].sort((a, b) => a - b);
                
                self.io.to('keno').emit('keno:round_results', {
                    round: activeGame.roundNumber,
                    drawnNumbers: sortedForDisplay,
                    originalOrder: drawnNumbers,
                    playersCount: activeGame.players.length,
                    totalBets: activeGame.totalBets,
                    popInterval: self.CONFIG.NUMBER_POP_INTERVAL,
                    message: `Round ${activeGame.roundNumber} results!`,
                    totalDrawn: drawnNumbers.length,
                    isDrawComplete: true,
                    wasRandomOrder: true
                });
                
                activeGame.drawComplete = true;
                activeGame.status = 'completed';
                self.isDrawing = false;
                
                setTimeout(async () => {
                    await self.processKenoResults(activeGame);
                }, 1000);
                
            }, (drawnNumbers.length * self.CONFIG.NUMBER_POP_INTERVAL) + 1000);
            
        }, 2000);
    },
    
    // Calculate house advantage numbers
    calculateHouseAdvantageNumbers: function(activeGame) {
        const self = this;
        const drawnNumbers = [];
        
        // Collect player selections
        const selectionFrequency = {};
        let totalSelections = 0;
        
        Object.values(activeGame.bets).forEach(bet => {
            bet.numbers.forEach(num => {
                selectionFrequency[num] = (selectionFrequency[num] || 0) + 1;
                totalSelections++;
            });
        });
        
        // Calculate probabilities with house advantage
        const probabilities = {};
        const totalNumbers = self.CONFIG.KENO_TOTAL_NUMBERS;
        
        // Base probability for each number (1-80)
        for (let i = 1; i <= totalNumbers; i++) {
            let baseProb = 1.0 / totalNumbers;
            
            // HOUSE ADVANTAGE: Adjust based on selection frequency
            const timesSelected = selectionFrequency[i] || 0;
            const selectionRatio = timesSelected / Math.max(1, totalSelections);
            
            // More selected = lower probability (house advantage)
            let selectionWeight = Math.max(
                self.CONFIG.HOUSE_ADVANTAGE.minNumberProbability,
                1.0 - (selectionRatio * self.CONFIG.HOUSE_ADVANTAGE.popularNumberPenalty)
            );
            
            // Apply house edge multiplier
            if (self.houseStats.houseEdge < self.CONFIG.HOUSE_ADVANTAGE.maxHouseEdge) {
                selectionWeight *= 0.95;
            }
            
            probabilities[i] = baseProb * selectionWeight;
        }
        
        // Normalize probabilities
        let sumProb = Object.values(probabilities).reduce((a, b) => a + b, 0);
        for (let i = 1; i <= totalNumbers; i++) {
            probabilities[i] /= sumProb;
        }
        
        // Draw 20 numbers with weighted probabilities
        const numbers = Array.from({length: totalNumbers}, (_, i) => i + 1);
        let availableNumbers = [...numbers];
        let cumulativeWeights = [];
        
        // Build cumulative distribution
        let cumulative = 0;
        for (let i = 0; i < availableNumbers.length; i++) {
            cumulative += probabilities[availableNumbers[i]];
            cumulativeWeights[i] = cumulative;
        }
        
        // Draw 20 numbers
        for (let draw = 0; draw < self.CONFIG.KENO_DRAW_COUNT; draw++) {
            const rand = Math.random() * cumulativeWeights[cumulativeWeights.length - 1];
            let selectedIndex = 0;
            
            for (let i = 0; i < cumulativeWeights.length; i++) {
                if (rand <= cumulativeWeights[i]) {
                    selectedIndex = i;
                    break;
                }
            }
            
            const selectedNumber = availableNumbers[selectedIndex];
            drawnNumbers.push(selectedNumber);
            
            // Remove selected number and adjust weights
            availableNumbers.splice(selectedIndex, 1);
            
            // Rebuild cumulative weights
            cumulative = 0;
            cumulativeWeights = [];
            for (let i = 0; i < availableNumbers.length; i++) {
                cumulative += probabilities[availableNumbers[i]];
                cumulativeWeights[i] = cumulative;
            }
        }
        
        return drawnNumbers;
    },
    
    // Process Keno results with HOUSE WIN CONTROL
    processKenoResults: async function(activeGame) {
        const self = this;
        
        console.log('🎰 Processing Keno results with HOUSE CONTROL...');
        
        // Calculate initial results
        const playerResults = {};
        let totalPayout = 0;
        let totalWagered = activeGame.totalBetAmount;
        
        // First pass: Calculate raw results
        for (const [playerId, bet] of Object.entries(activeGame.bets)) {
            const matches = bet.numbers.filter(num => 
                activeGame.drawnNumbers.includes(num)
            ).length;
            
            const selectionCount = bet.selectionCount || bet.numbers.length;
            const payoutTable = self.CONFIG.PAYOUT_TABLE[selectionCount];
            const payoutMultiplier = payoutTable ? payoutTable[matches] || 0 : 0;
            const rawWinnings = bet.amount * payoutMultiplier;
            
            playerResults[playerId] = {
                rawWinnings: rawWinnings,
                matches: matches,
                selectionCount: selectionCount,
                betAmount: bet.amount,
                payoutMultiplier: payoutMultiplier,
                userName: bet.userName,
                luckFactor: bet.luckFactor || 1.0,
                lossStreak: bet.lossStreak || 0
            };
            
            if (rawWinnings > 0) {
                totalPayout += rawWinnings;
            }
        }
        
        // HOUSE CONTROL: Adjust payouts if needed
        const maxAllowedPayout = totalWagered * self.CONFIG.HOUSE_ADVANTAGE.maxPayoutPercentage;
        
        if (totalPayout > maxAllowedPayout) {
            console.log(`💰 HOUSE CONTROL: Reducing payout from ${totalPayout} to ${maxAllowedPayout}`);
            
            // Sort winners by raw winnings (largest first)
            const winners = Object.entries(playerResults)
                .filter(([_, result]) => result.rawWinnings > 0)
                .sort((a, b) => b[1].rawWinnings - a[1].rawWinnings);
            
            let reductionNeeded = totalPayout - maxAllowedPayout;
            let adjustedTotalPayout = totalPayout;
            
            // Reduce largest wins first
            for (const [playerId, result] of winners) {
                if (reductionNeeded <= 0) break;
                
                // Calculate how much we can reduce
                let reductionAmount = Math.min(
                    reductionNeeded,
                    result.rawWinnings * 0.5
                );
                
                if (reductionAmount > 0) {
                    result.adjustedWinnings = result.rawWinnings - reductionAmount;
                    reductionNeeded -= reductionAmount;
                    adjustedTotalPayout -= reductionAmount;
                }
            }
            
            totalPayout = adjustedTotalPayout;
        }
        
        // Apply LUCK FACTOR adjustments
        const roundNumber = activeGame.roundNumber;
        const isGuaranteedLossRound = (roundNumber % self.CONFIG.HOUSE_ADVANTAGE.guaranteedLossRounds) === 0;
        const smallWinChance = self.CONFIG.HOUSE_ADVANTAGE.smallWinFrequency;
        
        // Process final results with adjustments
        for (const [playerId, result] of Object.entries(playerResults)) {
            try {
                const user = await self.User.findOne({ userId: playerId });
                if (!user) continue;
                
                let finalWinnings = result.adjustedWinnings || result.rawWinnings;
                
                // Apply luck factor
                finalWinnings = Math.floor(finalWinnings * result.luckFactor);
                
                // HOUSE CONTROL: Force small win after many losses
                if (result.lossStreak >= self.CONFIG.HOUSE_ADVANTAGE.maxConsecutiveLosses && 
                    finalWinnings === 0 && 
                    Math.random() < 0.7) {
                    finalWinnings = Math.floor(result.betAmount * 0.5);
                }
                
                // HOUSE CONTROL: Guaranteed loss rounds
                if (isGuaranteedLossRound && finalWinnings > result.betAmount * 2) {
                    finalWinnings = Math.floor(finalWinnings * 0.5);
                }
                
                // HOUSE CONTROL: Small win frequency
                if (finalWinnings === 0 && Math.random() < smallWinChance && result.betAmount > 5) {
                    finalWinnings = Math.floor(result.betAmount * 0.8);
                }
                
                if (finalWinnings > 0) {
                    // Update user balance
                    user.balance += finalWinnings;
                    user.totalWins += finalWinnings;
                    user.kenoWins = (user.kenoWins || 0) + 1;
                    
                    // Update luck stats
                    user.luckStats.totalWins++;
                    user.luckStats.currentLossStreak = 0;
                    user.luckStats.lastWinRound = roundNumber;
                    user.luckStats.biggestWin = Math.max(user.luckStats.biggestWin || 0, finalWinnings);
                    user.luckStats.luckFactor = Math.max(0.5, user.luckStats.luckFactor - 0.1);
                    user.luckStats.winRate = user.luckStats.totalWins / Math.max(1, user.luckStats.totalRounds);
                    
                    await user.save();
                    
                    // Create win transaction
                    const transaction = new self.Transaction({
                        type: 'KENO_WIN',
                        userId: playerId,
                        userName: user.userName,
                        amount: finalWinnings,
                        description: `Keno win: ${finalWinnings} ETB (bet ${result.betAmount} ETB, matched ${result.matches}/${result.selectionCount})`,
                        game: 'keno',
                        status: 'completed',
                        details: {
                            numbers: activeGame.bets[playerId].numbers,
                            drawnNumbers: activeGame.drawnNumbers,
                            matches: result.matches,
                            selectionCount: result.selectionCount,
                            round: activeGame.roundNumber,
                            payoutMultiplier: finalWinnings / result.betAmount,
                            luckFactor: result.luckFactor,
                            adjusted: result.adjustedWinnings !== undefined
                        }
                    });
                    await transaction.save();
                    
                    // Add to winners list
                    activeGame.winners.push({
                        playerId: playerId,
                        playerName: user.userName,
                        betAmount: result.betAmount,
                        numbers: activeGame.bets[playerId].numbers,
                        selectionCount: result.selectionCount,
                        matches: result.matches,
                        winnings: finalWinnings,
                        payoutMultiplier: finalWinnings / result.betAmount,
                        luckFactor: result.luckFactor
                    });
                    
                    activeGame.totalPayout += finalWinnings;
                    
                    // Update player state
                    const player = self.kenoPlayers.get(playerId);
                    if (player) {
                        player.balance = user.balance;
                        player.totalWins += finalWinnings;
                        player.hasPlacedBet = false;
                        player.currentBet = null;
                        player.luckStats = user.luckStats;
                        self.kenoPlayers.set(playerId, player);
                    }
                    
                    // Send personal result
                    const playerSocket = self.getKenoSocketByUserId(playerId);
                    if (playerSocket) {
                        playerSocket.emit('keno:round_result', {
                            round: activeGame.roundNumber,
                            drawnNumbers: activeGame.drawnNumbers,
                            yourNumbers: activeGame.bets[playerId].numbers,
                            selectionCount: result.selectionCount,
                            matches: result.matches,
                            winnings: finalWinnings,
                            newBalance: user.balance,
                            bet: result.betAmount,
                            message: `You won ${finalWinnings} ETB! Matched ${result.matches} of ${result.selectionCount} numbers.`
                        });
                    }
                    
                } else {
                    // Player lost
                    user.luckStats.currentLossStreak++;
                    user.luckStats.luckFactor = Math.min(2.0, user.luckStats.luckFactor + 0.05);
                    user.luckStats.winRate = user.luckStats.totalWins / Math.max(1, user.luckStats.totalRounds);
                    await user.save();
                    
                    // Update player state
                    const player = self.kenoPlayers.get(playerId);
                    if (player) {
                        player.hasPlacedBet = false;
                        player.currentBet = null;
                        player.luckStats = user.luckStats;
                        self.kenoPlayers.set(playerId, player);
                    }
                    
                    // Send loss result
                    const playerSocket = self.getKenoSocketByUserId(playerId);
                    if (playerSocket) {
                        playerSocket.emit('keno:round_result', {
                            round: activeGame.roundNumber,
                            drawnNumbers: activeGame.drawnNumbers,
                            yourNumbers: activeGame.bets[playerId].numbers,
                            selectionCount: result.selectionCount,
                            matches: result.matches,
                            winnings: 0,
                            newBalance: user.balance,
                            bet: result.betAmount,
                            message: `Matched ${result.matches} of ${result.selectionCount} numbers. Better luck next round!`
                        });
                    }
                }
            } catch (error) {
                console.error(`Error processing result for player ${playerId}:`, error);
            }
        }
        
        // Update house stats
        self.updateHouseStats(activeGame, totalWagered, totalPayout);
        
        // Calculate house commission
        const commission = (totalWagered * self.CONFIG.COMMISSION_PERCENTAGE) / 100;
        activeGame.commissionCollected = commission;
        self.totalKenoEarnings += commission;
        
        // Mark results as processed
        activeGame.processedResults = true;
        activeGame.endTime = new Date();
        activeGame.status = 'completed';
        
        // Add to history
        self.kenoRoundHistory.unshift({
            round: activeGame.roundNumber,
            drawnNumbers: activeGame.drawnNumbers,
            players: activeGame.players.length,
            totalBets: activeGame.totalBets,
            totalBetAmount: totalWagered,
            totalPayout: activeGame.totalPayout,
            commission: commission,
            houseEdge: self.houseStats.houseEdge,
            winners: activeGame.winners.length,
            timestamp: new Date(),
            averageSelectionCount: activeGame.players.length > 0 ? 
                Object.values(activeGame.bets).reduce((sum, bet) => sum + (bet.selectionCount || bet.numbers.length), 0) / activeGame.players.length : 0
        });
        
        // Keep only last 20 rounds in history
        if (self.kenoRoundHistory.length > 20) {
            self.kenoRoundHistory = self.kenoRoundHistory.slice(0, 20);
        }
        
        // Update database stats
        await self.updateKenoStats(totalWagered, activeGame.totalPayout, 0, 0, 1);
        
        // Increment round number
        self.kenoRoundNumber++;
        
        console.log(`🎰 Round ${activeGame.roundNumber-1} completed.`);
        
        // Reset for next round
        setTimeout(() => {
            activeGame.status = 'waiting';
            activeGame.bets = {};
            activeGame.players = [];
            activeGame.drawnNumbers = [];
            activeGame.drawnNumbersOriginalOrder = [];
            activeGame.winners = [];
            activeGame.totalBets = 0;
            activeGame.totalBetAmount = 0;
            activeGame.totalPayout = 0;
            activeGame.commissionCollected = 0;
            activeGame.drawComplete = false;
            activeGame.processedResults = false;
            
            // Check if we have players for next round
            const onlinePlayers = self.getOnlinePlayersCount();
            
            if (onlinePlayers >= self.minimumPlayers) {
                setTimeout(() => {
                    self.startGameIfReady();
                }, 5000);
            } else {
                self.io.to('keno').emit('keno:waiting', {
                    message: 'Waiting for players to start next round...',
                    playersNeeded: self.minimumPlayers
                });
            }
        }, 3000);
    },
    
    // Update house statistics
    updateHouseStats: function(activeGame, totalWagered, totalPayout) {
        const self = this;
        
        self.houseStats.totalRounds++;
        self.houseStats.totalWagered += totalWagered;
        self.houseStats.totalPayout += totalPayout;
        
        // Calculate house edge
        if (totalWagered > 0) {
            const roundHouseEdge = 1 - (totalPayout / totalWagered);
            self.houseStats.houseEdge = (self.houseStats.houseEdge * 0.7) + (roundHouseEdge * 0.3);
        }
        
        // Calculate player win rate
        const roundWinners = activeGame.winners.length;
        const totalPlayers = Object.keys(activeGame.bets).length;
        if (totalPlayers > 0) {
            const roundWinRate = roundWinners / totalPlayers;
            self.houseStats.playerWinRate = (self.houseStats.playerWinRate * 0.7) + (roundWinRate * 0.3);
        }
        
        // Track consecutive wins/losses
        if (totalPayout / totalWagered > 0.5) {
            self.houseStats.consecutiveHouseWins = 0;
            self.houseStats.consecutivePlayerWins++;
        } else {
            self.houseStats.consecutivePlayerWins = 0;
            self.houseStats.consecutiveHouseWins++;
            self.houseStats.maxConsecutiveHouseWins = Math.max(
                self.houseStats.maxConsecutiveHouseWins,
                self.houseStats.consecutiveHouseWins
            );
        }
        
        // Update average payout percentage
        const payoutPercentage = totalPayout / Math.max(1, totalWagered);
        self.houseStats.averagePayoutPercentage = (self.houseStats.averagePayoutPercentage * 0.8) + (payoutPercentage * 0.2);
        
        self.houseStats.lastAdjustment = Date.now();
        
        // Save to database
        this.updateHouseStatsInDB();
    },
    
    // Update house stats in database
    updateHouseStatsInDB: async function() {
        try {
            const today = new Date().toISOString().split('T')[0];
            await this.Stats.findOneAndUpdate(
                { date: today },
                {
                    $set: {
                        houseEdge: this.houseStats.houseEdge,
                        playerWinRate: this.houseStats.playerWinRate
                    }
                },
                { upsert: true }
            );
        } catch (error) {
            console.error('Error updating house stats:', error);
        }
    },
    
    // Update Keno stats in database
    updateKenoStats: async function(wagered, payout, depositAmount, withdrawalAmount, games) {
        try {
            const today = new Date().toISOString().split('T')[0];
            
            const updateData = {
                $inc: {
                    totalWagered: wagered || 0,
                    totalEarnings: wagered - payout || 0,
                    totalGames: games || 0,
                    totalKenoWagered: wagered || 0,
                    totalKenoEarnings: wagered - payout || 0,
                    totalKenoGames: games || 0,
                    totalKenoWins: payout > 0 ? 1 : 0,
                    totalDeposits: depositAmount || 0,
                    totalWithdrawals: withdrawalAmount || 0,
                    totalWalletTransactions: (depositAmount > 0 || withdrawalAmount > 0) ? 1 : 0
                }
            };
            
            await this.Stats.findOneAndUpdate(
                { date: today },
                updateData,
                { upsert: true, new: true }
            );
            
        } catch (error) {
            console.error('Error updating Keno stats:', error);
        }
    },
    
    // ==================== HELPER METHODS ====================
    
    getActiveKenoGame: function() {
        let game = this.activeKenoGames.get('current');
        if (!game) {
            game = {
                id: Date.now(),
                roundNumber: this.kenoRoundNumber,
                startTime: new Date(),
                endTime: null,
                status: 'waiting',
                players: [],
                bets: {},
                drawnNumbers: [],
                drawnNumbersOriginalOrder: [],
                winners: [],
                totalBets: 0,
                totalBetAmount: 0,
                totalPayout: 0,
                commissionCollected: 0,
                drawComplete: false,
                processedResults: false
            };
            this.activeKenoGames.set('current', game);
        }
        return game;
    },
    
    getKenoSocketByUserId: function(userId) {
        const player = this.kenoPlayers.get(userId);
        if (player && player.isOnline) {
            const socket = this.kenoSockets.get(player.socketId);
            if (socket && socket.connected) {
                return socket;
            }
        }
        return null;
    },
    
    broadcastKenoPlayersUpdate: function() {
        const activeGame = this.getActiveKenoGame();
        const onlinePlayers = this.getOnlinePlayersCount();
        
        this.io.to('keno').emit('keno:players_update', {
            count: onlinePlayers,
            totalBets: activeGame.totalBets,
            totalBetAmount: activeGame.totalBetAmount
        });
    },
    
    getUserBalance: async function(userId) {
        const user = await this.User.findOne({ userId: userId });
        return user ? user.balance : 0;
    },
    
    // Get online players count
    getOnlinePlayersCount: function() {
        return Array.from(this.kenoPlayers.values()).filter(p => p.isOnline).length;
    },
    
    // Send player round result
    sendPlayerRoundResult: function(socket, userId, activeGame) {
        const self = this;
        const bet = activeGame.bets[userId];
        
        if (!bet) return;
        
        const matches = bet.numbers.filter(num => 
            activeGame.drawnNumbers.includes(num)
        ).length;
        
        let winnings = 0;
        const selectionCount = bet.selectionCount || bet.numbers.length;
        
        if (self.CONFIG.PAYOUT_TABLE[selectionCount]) {
            const payout = self.CONFIG.PAYOUT_TABLE[selectionCount][matches];
            if (payout !== undefined && payout > 0) {
                winnings = bet.amount * payout;
            }
        }
        
        socket.emit('keno:round_result', {
            round: activeGame.roundNumber,
            drawnNumbers: activeGame.drawnNumbers,
            yourNumbers: bet.numbers,
            selectionCount: selectionCount,
            matches: matches,
            winnings: winnings,
            bet: bet.amount,
            message: winnings > 0 ? 
                `You won ${winnings} ETB! Matched ${matches} of ${selectionCount} numbers.` :
                `Matched ${matches} of ${selectionCount} numbers. Better luck next round!`
        });
    },
    
    // Clean up old data
    cleanupOldKenoData: function() {
        // Remove players who haven't been online for more than 24 hours
        const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
        let removedCount = 0;
        
        for (const [userId, player] of this.kenoPlayers) {
            if (player.lastSeen < twentyFourHoursAgo && !player.isOnline) {
                this.kenoPlayers.delete(userId);
                removedCount++;
            }
        }
        
        if (removedCount > 0) {
            console.log(`🧹 Cleaned up ${removedCount} inactive Keno players`);
        }
        
        // Clean up old active games
        const currentGame = this.getActiveKenoGame();
        if (currentGame.status === 'completed' && currentGame.endTime) {
            const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
            if (currentGame.endTime < oneHourAgo) {
                this.activeKenoGames.delete('current');
                console.log('🧹 Cleaned up old completed game');
            }
        }
    },
    
    // Check if game should be active
    checkGameStatus: function() {
        const onlinePlayers = this.getOnlinePlayersCount();
        const activeGame = this.getActiveKenoGame();
        const gameStatus = activeGame.status || 'waiting';
        
        if (onlinePlayers === 0 && this.isKenoRoundActive) {
            console.log('🎰 No players online, pausing game...');
            this.pauseKenoGame();
        } else if (onlinePlayers >= this.minimumPlayers && 
                   !this.isKenoRoundActive && 
                   !this.isDrawing &&
                   gameStatus === 'waiting' && 
                   !this.isRoundScheduled) {
            console.log('🎰 Auto-starting game from checkGameStatus...');
            this.startGameIfReady();
        }
    },
    
    // Get house advantage report
    getHouseAdvantageReport: function() {
        return {
            totalRounds: this.houseStats.totalRounds,
            totalWagered: this.houseStats.totalWagered,
            totalPayout: this.houseStats.totalPayout,
            totalCommission: this.totalKenoEarnings,
            netProfit: this.houseStats.totalWagered - this.houseStats.totalPayout,
            
            houseEdge: this.houseStats.houseEdge,
            playerWinRate: this.houseStats.playerWinRate,
            averagePayoutPercentage: this.houseStats.averagePayoutPercentage,
            
            consecutiveHouseWins: this.houseStats.consecutiveHouseWins,
            maxConsecutiveHouseWins: this.houseStats.maxConsecutiveHouseWins,
            consecutivePlayerWins: this.houseStats.consecutivePlayerWins,
            
            config: {
                maxHouseEdge: this.CONFIG.HOUSE_ADVANTAGE.maxHouseEdge,
                minPlayerWinRate: this.CONFIG.HOUSE_ADVANTAGE.minPlayerWinRate,
                maxPayoutPercentage: this.CONFIG.HOUSE_ADVANTAGE.maxPayoutPercentage
            }
        };
    }
};
