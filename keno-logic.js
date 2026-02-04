// keno-logic.js - KENO GAME LOGIC MODULE
module.exports = {
    // Game configuration - UPDATED for 1-5 numbers
    CONFIG: {
        KENO_GAME_TIMER: 30, // seconds between rounds
        KENO_MIN_BET: 5,     // Minimum bet amount
        KENO_MAX_BET: 100,   // Maximum bet amount
        KENO_MIN_SELECTIONS: 1,  // Minimum numbers to select (CHANGED from 5)
        KENO_MAX_SELECTIONS: 5,  // Maximum numbers to select
        KENO_TOTAL_NUMBERS: 80,
        KENO_DRAW_COUNT: 20,
        NUMBER_POP_INTERVAL: 3000, // 3 seconds between number pops
        // UPDATED PAYOUT TABLE:
        PAYOUT_TABLE: {
            1: {1: 3, 0: 0},                    // Pick 1: Match 1 = 3x
            2: {2: 10, 1: 0, 0: 0},            // Pick 2: Match 2 = 10x
            3: {3: 15, 2: 1, 1: 0, 0: 0},      // Pick 3: Match 3 = 15x, Match 2 = 1x
            4: {4: 50, 3: 0, 2: 0, 1: 0, 0: 0}, // Pick 4: Match 4 = 50x
            5: {5: 200, 4: 50, 3: 15, 2: 1, 1: 0, 0: 0} // Pick 5: Match 5 = 200x, Match 4 = 50x, Match 3 = 15x, Match 2 = 1x
        },
        COMMISSION_PERCENTAGE: 5, // 5% house commission
        ALLOW_PRE_SELECTION: true,
        // Wallet settings
        MIN_DEPOSIT: 100,
        MAX_DEPOSIT: 10000,
        MIN_WITHDRAWAL: 100,
        WITHDRAWAL_FEE_PERCENTAGE: 5,
        ALLOWED_BETS: [5, 10, 20, 50, 100], // Only these bet amounts allowed
        // Reconnection settings
        RECONNECT_TIMEOUT: 30000, // 30 seconds to allow reconnection
        AUTO_RECONNECT: true,
        MAX_RECONNECT_ATTEMPTS: 3,
        RECONNECT_BACKOFF: 2000 // Start with 2 seconds
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
        this.minimumPlayers = 1; // Game stops if no players
        this.isRoundScheduled = false; // Prevent multiple round scheduling
        this.isDrawing = false; // Track if we're currently in draw phase
        this.roundTransitionTimeout = null; // Track round transition timeout
        this.disconnectedPlayers = new Map(); // Track recently disconnected players for reconnection
        this.playerReconnectTokens = new Map(); // Store reconnect tokens
        this.playerReconnectAttempts = new Map(); // Track reconnect attempts per player
        
        console.log('✅ Keno game logic initialized - 1-5 numbers allowed, bets: 5,10,20,50,100');
        console.log('🎰 NEW payout table loaded:');
        console.log('   5 Numbers: 5 hits = 200x, 4 hits = 50x, 3 hits = 15x, 2 hits = 1x');
        console.log('   4 Numbers: 4 hits = 50x');
        console.log('   3 Numbers: 3 hits = 15x, 2 hits = 1x');
        console.log('   2 Numbers: 2 hits = 10x');
        console.log('   1 Number:  1 hit = 3x');
        console.log('💰 Wallet system integrated');
        console.log('🔄 Reconnection system enabled');
        
        // Load existing stats
        this.loadKenoStats();
        
        // Clean up old data periodically
        setInterval(() => {
            this.cleanupOldKenoData();
        }, 3600000); // Every hour
        
        // Check game status periodically
        setInterval(() => {
            this.checkGameStatus();
        }, 5000);
        
        // Start game if we have players
        this.startGameIfReady();
        
        // Start health check system
        this.startGameHealthCheck();
        
        // Start reconnection cleanup
        this.startReconnectionCleanup();
    },

    // Start reconnection cleanup
    startReconnectionCleanup: function() {
        const self = this;
        
        // Clean up disconnected players every minute
        setInterval(() => {
            const now = Date.now();
            const maxReconnectTime = self.CONFIG.RECONNECT_TIMEOUT;
            
            for (const [userId, disconnectTime] of self.disconnectedPlayers) {
                if (now - disconnectTime > maxReconnectTime) {
                    self.disconnectedPlayers.delete(userId);
                    self.playerReconnectAttempts.delete(userId);
                    console.log(`🧹 Removed expired reconnection for player ${userId}`);
                    
                    // Clear player's pending selections
                    const player = self.kenoPlayers.get(userId);
                    if (player) {
                        player.pendingSelections = [];
                        player.pendingBet = null;
                        player.hasPlacedBet = false;
                        self.kenoPlayers.set(userId, player);
                    }
                }
            }
        }, 60000); // Every minute
    },

    // Start game health check system
    startGameHealthCheck: function() {
        const self = this;
        
        // Run health check every 30 seconds
        setInterval(() => {
            const activeGame = self.getActiveKenoGame();
            const onlinePlayers = self.getOnlinePlayersCount();
            
            console.log('🩺 Keno Health Check:');
            console.log('  Round Active:', self.isKenoRoundActive);
            console.log('  Drawing:', self.isDrawing);
            console.log('  Online Players:', onlinePlayers);
            console.log('  Game Status:', activeGame.status);
            console.log('  Countdown:', self.kenoCountdown);
            console.log('  Round Number:', self.kenoRoundNumber);
            console.log('  Total Bets:', activeGame.totalBets);
            console.log('  Disconnected Players:', self.disconnectedPlayers.size);
            
            // Detect stuck state: Round active but no players for too long
            if (self.isKenoRoundActive && onlinePlayers === 0 && activeGame.totalBets === 0) {
                const now = new Date();
                const gameStartTime = activeGame.startTime || now;
                const timeElapsed = (now - gameStartTime) / 1000; // in seconds
                
                // If round has been active for more than 60 seconds with no players
                if (timeElapsed > 60) {
                    console.log('🩺 Health Check: Detected stuck round, resetting...');
                    self.resetStuckKenoGame();
                }
            }
            
            // Detect stuck in drawing state with no activity
            if (self.isDrawing && onlinePlayers === 0) {
                console.log('🩺 Health Check: Detected stuck drawing state, resetting...');
                self.resetStuckKenoGame();
            }
            
            // Detect stuck countdown
            if (self.kenoCountdown <= 0 && !self.isDrawing && !self.isKenoRoundActive) {
                console.log('🩺 Health Check: Detected stuck countdown, resetting...');
                self.kenoCountdown = self.CONFIG.KENO_GAME_TIMER;
            }
        }, 30000); // Check every 30 seconds
    },

    // Reset stuck Keno game
    resetStuckKenoGame: function() {
        const self = this;
        
        console.log('🔄 Resetting stuck Keno game...');
        
        // Clear all intervals and timeouts
        if (self.kenoCountdownInterval) {
            clearInterval(self.kenoCountdownInterval);
            self.kenoCountdownInterval = null;
        }
        
        if (self.roundTransitionTimeout) {
            clearTimeout(self.roundTransitionTimeout);
            self.roundTransitionTimeout = null;
        }
        
        // Reset game state
        self.isKenoRoundActive = false;
        self.isDrawing = false;
        self.isRoundScheduled = false;
        self.kenoCountdown = self.CONFIG.KENO_GAME_TIMER;
        
        // Reset active game
        const activeGame = self.getActiveKenoGame();
        activeGame.status = 'waiting';
        activeGame.players = [];
        activeGame.bets = {};
        activeGame.drawnNumbers = [];
        activeGame.drawnNumbersOriginalOrder = [];
        activeGame.winners = [];
        activeGame.totalBets = 0;
        activeGame.totalBetAmount = 0;
        activeGame.totalPayout = 0;
        activeGame.commissionCollected = 0;
        activeGame.drawComplete = false;
        activeGame.processedResults = false;
        
        // Clear all pending selections for offline players
        for (const [userId, player] of self.kenoPlayers) {
            if (!player.isOnline) {
                player.hasPlacedBet = false;
                player.currentBet = null;
                player.selectedNumbers = [];
                player.isNewInCurrentRound = false;
                player.pendingSelections = [];
                player.pendingBet = null;
                self.kenoPlayers.set(userId, player);
            }
        }
        
        // Clear disconnected players
        self.disconnectedPlayers.clear();
        
        // Broadcast reset
        self.io.to('keno').emit('keno:game_reset', {
            message: 'Game reset. Waiting for players...',
            round: self.kenoRoundNumber
        });
        
        console.log('✅ Keno game reset successfully');
        
        // Try to restart if we have players
        setTimeout(() => {
            self.startGameIfReady();
        }, 3000);
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
                    totalWalletTransactions: 0
                });
                await stats.save();
            }
            
            this.totalKenoEarnings = stats.totalKenoEarnings || 0;
            console.log(`📊 Keno stats loaded: ${this.totalKenoEarnings.toFixed(2)} ETB earnings`);
            
        } catch (error) {
            console.error('Error loading Keno stats:', error);
        }
    },

    // Handle Keno socket connection - IMPROVED RECONNECTION LOGIC
    handleKenoConnection: function(socket) {
        const self = this;
        
        console.log(`🎰 Keno connection: ${socket.id}`);
        
        // Store socket for keno
        self.kenoSockets.set(socket.id, socket);
        
        // Handle ping/pong for connection health
        socket.on('ping', (data) => {
            socket.emit('pong', { timestamp: data?.timestamp || Date.now() });
        });
        
        // Keno authentication with reconnection support - SIMPLIFIED
        socket.on('keno:auth', async (data) => {
            try {
                const { userId, userName, reconnectToken, isReconnect } = data;
                
                // Find user in database
                const user = await self.User.findOne({ userId: userId });
                
                if (!user) {
                    socket.emit('keno:error', 'User not found');
                    return;
                }
                
                // Check if this is a reconnection
                const wasDisconnected = self.disconnectedPlayers.has(userId);
                const existingPlayer = self.kenoPlayers.get(userId);
                
                // Get current game state
                const activeGame = self.getActiveKenoGame();
                const currentDrawnNumbers = activeGame.drawnNumbers || [];
                const currentRoundNumber = self.kenoRoundNumber;
                const isRoundActive = self.isKenoRoundActive;
                const countdown = self.kenoCountdown;
                const currentRoundBets = activeGame.bets || {};
                const playerHasBetInCurrentRound = !!currentRoundBets[userId];
                
                // Generate new reconnect token
                const newReconnectToken = Date.now() + '-' + Math.random().toString(36).substr(2, 9);
                
                // Store player info
                socket.userId = userId;
                socket.userName = userName;
                socket.kenoPlayer = true;
                socket.reconnectToken = newReconnectToken;
                
                let player;
                let isNewConnection = true;
                
                if (existingPlayer) {
                    // Existing player - update socket
                    player = existingPlayer;
                    player.socketId = socket.id;
                    player.isOnline = true;
                    player.lastSeen = new Date();
                    player.balance = user.balance;
                    player.reconnectedAt = new Date();
                    isNewConnection = false;
                    
                    // Remove from disconnected players if they were there
                    if (self.disconnectedPlayers.has(userId)) {
                        self.disconnectedPlayers.delete(userId);
                        console.log(`🔄 Player reconnected: ${userName} (${userId})`);
                        
                        // Clear reconnect attempts
                        self.playerReconnectAttempts.delete(userId);
                    } else {
                        console.log(`🎰 Player connected (existing): ${userName} (${userId})`);
                    }
                    
                    // IMPORTANT: Only restore pending selections if player hasn't placed bet AND round is active
                    if (player.pendingSelections && 
                        player.pendingSelections.length > 0 && 
                        !player.hasPlacedBet && 
                        isRoundActive) {
                        // Restore pending selections
                        player.selectedNumbers = player.pendingSelections;
                        player.currentBet = player.pendingBet || 5;
                        
                        // Clear pending after restore
                        player.pendingSelections = [];
                        player.pendingBet = null;
                    }
                    
                } else {
                    // New player
                    player = {
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
                        preSelectedNumbers: [],
                        isReadyForNextRound: false,
                        sessionStart: new Date(),
                        totalDeposits: user.totalDeposits || 0,
                        totalWithdrawals: user.totalWithdrawals || 0,
                        // Reconnection fields
                        pendingSelections: [],
                        pendingBet: null,
                        disconnectTime: null,
                        reconnectedAt: null,
                        // Mark as "new" only if they don't have a bet and join during draw
                        isNewInCurrentRound: !playerHasBetInCurrentRound && currentDrawnNumbers.length > 0
                    };
                    console.log(`🎰 New player connected: ${userName} (${userId})`);
                }
                
                // Update player in map
                self.kenoPlayers.set(userId, player);
                
                // Store reconnect token
                self.playerReconnectTokens.set(userId, {
                    token: newReconnectToken,
                    expires: Date.now() + 300000 // 5 minutes
                });
                
                // Update user online status
                user.isOnline = true;
                user.lastSeen = new Date();
                user.sessionCount = (user.sessionCount || 0) + 1;
                await user.save();
                
                // Join Keno room
                socket.join('keno');
                
                // Calculate potential winnings for feedback
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
                
                // Prepare welcome data - SIMPLIFIED
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
                    // Send current drawn numbers if any exist
                    currentDrawnNumbers: currentDrawnNumbers,
                    isDrawComplete: activeGame.drawComplete || false,
                    hasBetInCurrentRound: playerHasBetInCurrentRound,
                    isDrawing: activeGame.status === 'drawing',
                    // Reconnection info
                    reconnectToken: newReconnectToken,
                    // Send player's current state
                    selectedNumbers: player.selectedNumbers,
                    currentBet: player.currentBet,
                    hasPlacedBet: player.hasPlacedBet,
                    isNewConnection: isNewConnection,
                    config: {
                        minBet: self.CONFIG.KENO_MIN_BET,
                        maxBet: self.CONFIG.KENO_MAX_BET,
                        minSelections: self.CONFIG.KENO_MIN_SELECTIONS,
                        maxSelections: self.CONFIG.KENO_MAX_SELECTIONS,
                        totalNumbers: self.CONFIG.KENO_TOTAL_NUMBERS,
                        drawCount: self.CONFIG.KENO_DRAW_COUNT,
                        gameTimer: self.CONFIG.KENO_GAME_TIMER,
                        allowPreSelection: self.CONFIG.ALLOW_PRE_SELECTION,
                        allowedBets: self.CONFIG.ALLOWED_BETS,
                        reconnectTimeout: self.CONFIG.RECONNECT_TIMEOUT
                    },
                    potentialWinnings: potentialWinnings
                };
                
                socket.emit('keno:welcome', welcomeData);
                
                // If this was a reconnection, send specific reconnection event
                if (!isNewConnection && wasDisconnected) {
                    socket.emit('keno:reconnected', {
                        message: 'Successfully reconnected!',
                        restoredState: player.selectedNumbers.length > 0,
                        restoredSelections: player.selectedNumbers,
                        round: currentRoundNumber,
                        roundActive: isRoundActive,
                        hasBet: playerHasBetInCurrentRound
                    });
                }
                
                // If draw is already in progress or complete, handle it properly
                if (currentDrawnNumbers.length > 0) {
                    if (activeGame.drawComplete) {
                        // Draw is complete, show all numbers immediately
                        socket.emit('keno:round_results', {
                            round: currentRoundNumber,
                            drawnNumbers: currentDrawnNumbers,
                            playersCount: activeGame.players.length,
                            totalBets: activeGame.totalBets,
                            isDrawComplete: true,
                            message: `Round ${currentRoundNumber} results!`,
                            totalDrawn: currentDrawnNumbers.length
                        });
                        
                        // If player had a bet in this round, send their result
                        if (playerHasBetInCurrentRound && activeGame.processedResults) {
                            setTimeout(() => {
                                self.sendPlayerRoundResult(socket, userId, activeGame);
                            }, 1000);
                        }
                    } else if (activeGame.status === 'drawing') {
                        // Draw is in progress
                        const drawState = {
                            round: currentRoundNumber,
                            currentBall: currentDrawnNumbers.length,
                            totalBalls: self.CONFIG.KENO_DRAW_COUNT,
                            playersCount: activeGame.players.length,
                            totalBets: activeGame.totalBets,
                            message: 'Draw in progress. Watching live...',
                            hasBet: playerHasBetInCurrentRound,
                            isReconnecting: !isNewConnection
                        };
                        
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
                    
                    // Schedule round start but don't start immediately
                    setTimeout(() => {
                        self.startGameIfReady();
                    }, 3000);
                }
                
            } catch (error) {
                console.error('Keno auth error:', error);
                socket.emit('keno:error', 'Authentication failed');
            }
        });
        
        // Reconnect request - for when client knows it's reconnecting
        socket.on('keno:reconnect', async (data) => {
            try {
                const { userId, reconnectToken } = data;
                
                if (!userId) {
                    socket.emit('keno:error', 'User ID required');
                    return;
                }
                
                const player = self.kenoPlayers.get(userId);
                const tokenData = self.playerReconnectTokens.get(userId);
                
                // Check reconnect attempts
                const attempts = self.playerReconnectAttempts.get(userId) || 0;
                if (attempts > self.CONFIG.MAX_RECONNECT_ATTEMPTS) {
                    socket.emit('keno:reconnect_failed', {
                        message: 'Too many reconnection attempts. Please refresh the page.'
                    });
                    return;
                }
                
                if (!player || !tokenData || tokenData.token !== reconnectToken) {
                    self.playerReconnectAttempts.set(userId, attempts + 1);
                    socket.emit('keno:reconnect_failed', {
                        message: 'Invalid reconnect token or player not found'
                    });
                    return;
                }
                
                // Token expired
                if (Date.now() > tokenData.expires) {
                    self.playerReconnectTokens.delete(userId);
                    socket.emit('keno:reconnect_failed', {
                        message: 'Reconnect token expired'
                    });
                    return;
                }
                
                // Valid reconnection
                socket.userId = userId;
                socket.userName = player.userName;
                socket.kenoPlayer = true;
                
                // Update player socket
                player.socketId = socket.id;
                player.isOnline = true;
                player.lastSeen = new Date();
                self.kenoPlayers.set(userId, player);
                
                // Remove from disconnected
                self.disconnectedPlayers.delete(userId);
                self.playerReconnectAttempts.delete(userId);
                
                // Send successful reconnection
                socket.emit('keno:reconnect_success', {
                    message: 'Successfully reconnected',
                    userId: userId,
                    userName: player.userName,
                    balance: player.balance
                });
                
                console.log(`🔄 Manual reconnection successful: ${player.userName}`);
                
            } catch (error) {
                console.error('Reconnect error:', error);
                socket.emit('keno:error', 'Reconnection failed');
            }
        });
        
        // Save player state for reconnection
        socket.on('keno:saveState', (data) => {
            try {
                const { userId, selectedNumbers, betAmount, roundNumber } = data;
                
                if (!userId || !socket.userId || socket.userId !== userId) {
                    return;
                }
                
                const player = self.kenoPlayers.get(userId);
                if (player && self.isKenoRoundActive && !player.hasPlacedBet) {
                    // Only save pending selections if round is active and player hasn't placed bet
                    player.pendingSelections = selectedNumbers || [];
                    player.pendingBet = betAmount || 5;
                    self.kenoPlayers.set(userId, player);
                    
                    console.log(`💾 Saved state for player ${player.userName}: ${selectedNumbers?.length || 0} numbers`);
                }
            } catch (error) {
                console.error('Save state error:', error);
            }
        });
        
        // Clear reconnection state
        socket.on('keno:clearReconnectionState', (data) => {
            try {
                const { userId } = data;
                
                if (!userId || !socket.userId || socket.userId !== userId) {
                    return;
                }
                
                // Clear all reconnection data
                self.disconnectedPlayers.delete(userId);
                self.playerReconnectTokens.delete(userId);
                self.playerReconnectAttempts.delete(userId);
                
                const player = self.kenoPlayers.get(userId);
                if (player) {
                    player.pendingSelections = [];
                    player.pendingBet = null;
                    self.kenoPlayers.set(userId, player);
                }
                
                console.log(`🧹 Cleared reconnection state for player ${userId}`);
                
            } catch (error) {
                console.error('Clear reconnection state error:', error);
            }
        });
        
        // Place bet in Keno - UPDATED for 1-5 numbers
        socket.on('keno:placeBet', async (data) => {
            try {
                const { numbers, betAmount } = data;
                
                if (!socket.userId) {
                    socket.emit('keno:error', 'Not authenticated');
                    return;
                }
                
                const player = self.kenoPlayers.get(socket.userId);
                if (!player) {
                    socket.emit('keno:error', 'Player not found');
                    return;
                }
                
                // Check if round is active
                if (!self.isKenoRoundActive) {
                    socket.emit('keno:error', 'Round not active. Please wait for next round.');
                    return;
                }
                
                // Check if already placed bet in this round
                if (player.hasPlacedBet) {
                    socket.emit('keno:error', 'You have already placed a bet this round');
                    return;
                }
                
                // Validate bet amount - ONLY allowed bets
                const bet = parseFloat(betAmount);
                if (isNaN(bet) || !self.CONFIG.ALLOWED_BETS.includes(bet)) {
                    socket.emit('keno:error', `Bet amount must be one of: ${self.CONFIG.ALLOWED_BETS.join(', ')} ETB`);
                    return;
                }
                
                // Validate numbers - CAN be 1-5 numbers (CHANGED from exactly 5)
                if (!Array.isArray(numbers) || 
                    numbers.length < self.CONFIG.KENO_MIN_SELECTIONS || 
                    numbers.length > self.CONFIG.KENO_MAX_SELECTIONS) {
                    socket.emit('keno:error', `You must select ${self.CONFIG.KENO_MIN_SELECTIONS}-${self.CONFIG.KENO_MAX_SELECTIONS} numbers`);
                    return;
                }
                
                // Check unique numbers
                const uniqueNumbers = [...new Set(numbers)];
                if (uniqueNumbers.length !== numbers.length) {
                    socket.emit('keno:error', 'Duplicate numbers not allowed');
                    return;
                }
                
                // Check number range
                for (const num of numbers) {
                    const n = parseInt(num);
                    if (isNaN(n) || n < 1 || n > self.CONFIG.KENO_TOTAL_NUMBERS) {
                        socket.emit('keno:error', `Numbers must be between 1 and ${self.CONFIG.KENO_TOTAL_NUMBERS}`);
                        return;
                    }
                }
                
                // Sort numbers
                const sortedNumbers = [...numbers].sort((a, b) => a - b);
                
                // Check balance
                const user = await self.User.findOne({ userId: socket.userId });
                if (!user || user.balance < bet) {
                    socket.emit('keno:error', 'Insufficient balance');
                    return;
                }
                
                // Calculate potential winnings for feedback
                const selectionCount = sortedNumbers.length;
                let potentialWinnings = 0;
                
                // Calculate maximum potential win (if all numbers match)
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
                await user.save();
                
                // Update player state
                player.balance = user.balance;
                player.selectedNumbers = sortedNumbers;
                player.currentBet = bet;
                player.hasPlacedBet = true;
                player.totalWagered += bet;
                player.isReadyForNextRound = false;
                player.isNewInCurrentRound = false; // Now they're participating
                player.pendingSelections = []; // Clear pending selections
                player.pendingBet = null;
                self.kenoPlayers.set(socket.userId, player);
                
                // Add to active game
                const activeGame = self.getActiveKenoGame();
                if (!activeGame.players.includes(socket.userId)) {
                    activeGame.players.push(socket.userId);
                }
                
                // Add bet
                activeGame.bets[socket.userId] = {
                    numbers: sortedNumbers,
                    amount: bet,
                    selectionCount: sortedNumbers.length, // Store how many numbers selected
                    placedAt: new Date(),
                    userName: player.userName,
                    potentialWinnings: potentialWinnings,
                    playerSocketId: socket.id
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
                        socketId: socket.id
                    }
                });
                await transaction.save();
                
                // Update stats
                await self.updateKenoStats(bet, 0, 0, 0, 1);
                
                // Emit confirmation with potential winnings
                socket.emit('keno:betConfirmed', {
                    success: true,
                    balance: user.balance,
                    betAmount: bet,
                    numbers: sortedNumbers,
                    selectionCount: sortedNumbers.length,
                    potentialWinnings: potentialWinnings,
                    message: `Bet placed: ${bet} ETB on ${sortedNumbers.length} numbers`,
                    payoutTable: self.CONFIG.PAYOUT_TABLE[selectionCount],
                    round: activeGame.roundNumber
                });
                
                // Clear any reconnection state since bet is placed
                self.disconnectedPlayers.delete(socket.userId);
                self.playerReconnectAttempts.delete(socket.userId);
                
                // Broadcast updated player count
                self.broadcastKenoPlayersUpdate();
                
                console.log(`🎰 Bet placed: ${player.userName} - ${bet} ETB on ${sortedNumbers.length} numbers, Potential win: ${potentialWinnings} ETB`);
                
            } catch (error) {
                console.error('Keno place bet error:', error);
                socket.emit('keno:error', 'Failed to place bet');
            }
        });
        
        // Pre-select numbers for next round
        socket.on('keno:preselect', async (data) => {
            try {
                const { numbers } = data;
                
                if (!socket.userId) {
                    socket.emit('keno:error', 'Not authenticated');
                    return;
                }
                
                const player = self.kenoPlayers.get(socket.userId);
                if (!player) {
                    socket.emit('keno:error', 'Player not found');
                    return;
                }
                
                // Validate numbers - CAN be 1-5 numbers
                if (!Array.isArray(numbers) || 
                    numbers.length < self.CONFIG.KENO_MIN_SELECTIONS || 
                    numbers.length > self.CONFIG.KENO_MAX_SELECTIONS) {
                    socket.emit('keno:error', `You must select ${self.CONFIG.KENO_MIN_SELECTIONS}-${self.CONFIG.KENO_MAX_SELECTIONS} numbers`);
                    return;
                }
                
                // Check unique numbers
                const uniqueNumbers = [...new Set(numbers)];
                if (uniqueNumbers.length !== numbers.length) {
                    socket.emit('keno:error', 'Duplicate numbers not allowed');
                    return;
                }
                
                // Check number range
                for (const num of numbers) {
                    const n = parseInt(num);
                    if (isNaN(n) || n < 1 || n > self.CONFIG.KENO_TOTAL_NUMBERS) {
                        socket.emit('keno:error', `Numbers must be between 1 and ${self.CONFIG.KENO_TOTAL_NUMBERS}`);
                        return;
                    }
                }
                
                // Sort numbers
                const sortedNumbers = [...numbers].sort((a, b) => a - b);
                
                // Update player state
                player.preSelectedNumbers = sortedNumbers;
                player.isReadyForNextRound = true;
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
                socket.emit('keno:error', 'Failed to pre-select numbers');
            }
        });
        
        // Quick pick numbers - Returns 1-5 numbers based on current selection or max
        socket.on('keno:quickPick', (data) => {
            try {
                if (!socket.userId) {
                    socket.emit('keno:error', 'Not authenticated');
                    return;
                }
                
                const player = self.kenoPlayers.get(socket.userId);
                if (!player) {
                    socket.emit('keno:error', 'Player not found');
                    return;
                }
                
                // Determine how many numbers to generate
                let count = self.CONFIG.KENO_MAX_SELECTIONS; // Default to max
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
                socket.emit('keno:error', 'Failed to generate quick pick');
            }
        });
        
        // Get current game state
        socket.on('keno:getState', () => {
            try {
                if (!socket.userId) {
                    socket.emit('keno:error', 'Not authenticated');
                    return;
                }
                
                const player = self.kenoPlayers.get(socket.userId);
                if (!player) {
                    socket.emit('keno:error', 'Player not found');
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
                    payoutTable: self.CONFIG.PAYOUT_TABLE[player.selectedNumbers.length] || {},
                    // Reconnection info
                    canReconnect: self.disconnectedPlayers.has(socket.userId),
                    reconnectToken: self.playerReconnectTokens.get(socket.userId)?.token,
                    reconnectAttempts: self.playerReconnectAttempts.get(socket.userId) || 0,
                    maxReconnectAttempts: self.CONFIG.MAX_RECONNECT_ATTEMPTS
                });
                
            } catch (error) {
                console.error('Keno get state error:', error);
                socket.emit('keno:error', 'Failed to get game state');
            }
        });
        
        // Get user balance
        socket.on('keno:getBalance', async () => {
            try {
                if (!socket.userId) {
                    socket.emit('keno:error', 'Not authenticated');
                    return;
                }
                
                const user = await self.User.findOne({ userId: socket.userId });
                if (!user) {
                    socket.emit('keno:error', 'User not found');
                    return;
                }
                
                // Update player state
                const player = self.kenoPlayers.get(socket.userId);
                if (player) {
                    player.balance = user.balance;
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
                socket.emit('keno:error', 'Failed to get balance');
            }
        });
        
        // Clear current selection
        socket.on('keno:clearSelection', () => {
            try {
                if (!socket.userId) {
                    socket.emit('keno:error', 'Not authenticated');
                    return;
                }
                
                const player = self.kenoPlayers.get(socket.userId);
                if (!player) {
                    socket.emit('keno:error', 'Player not found');
                    return;
                }
                
                // Only allow clearing if haven't placed bet yet in active round
                if (!player.hasPlacedBet || !self.isKenoRoundActive) {
                    player.selectedNumbers = [];
                    player.currentBet = null;
                    // Also clear pending selections
                    player.pendingSelections = [];
                    player.pendingBet = null;
                    self.kenoPlayers.set(socket.userId, player);
                    
                    socket.emit('keno:selectionCleared', {
                        success: true,
                        message: 'Selection cleared'
                    });
                } else {
                    socket.emit('keno:error', 'Cannot clear after placing bet in active round');
                }
                
            } catch (error) {
                console.error('Keno clear selection error:', error);
                socket.emit('keno:error', 'Failed to clear selection');
            }
        });
        
        // Clear pre-selection
        socket.on('keno:clearPreselection', () => {
            try {
                if (!socket.userId) {
                    socket.emit('keno:error', 'Not authenticated');
                    return;
                }
                
                const player = self.kenoPlayers.get(socket.userId);
                if (!player) {
                    socket.emit('keno:error', 'Player not found');
                    return;
                }
                
                player.preSelectedNumbers = [];
                player.isReadyForNextRound = false;
                self.kenoPlayers.set(socket.userId, player);
                
                socket.emit('keno:preselectionCleared', {
                    success: true,
                    message: 'Pre-selection cleared'
                });
                
            } catch (error) {
                console.error('Keno clear pre-selection error:', error);
                socket.emit('keno:error', 'Failed to clear pre-selection');
            }
        });
        
        // Get potential winnings for current selection
        socket.on('keno:getPotentialWinnings', (data) => {
            try {
                if (!socket.userId) {
                    socket.emit('keno:error', 'Not authenticated');
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
                socket.emit('keno:error', 'Failed to calculate potential winnings');
            }
        });
        
        // Draw state event (when player joins during draw)
        socket.on('keno:getDrawState', () => {
            try {
                if (!socket.userId) {
                    socket.emit('keno:error', 'Not authenticated');
                    return;
                }
                
                const activeGame = self.getActiveKenoGame();
                const playerHasBet = !!activeGame.bets[socket.userId];
                
                if (activeGame.status === 'drawing' && activeGame.drawnNumbers.length > 0) {
                    // For players requesting draw state, only send limited info if they don't have a bet
                    const drawState = {
                        round: activeGame.roundNumber,
                        currentBall: activeGame.drawnNumbers.length,
                        totalBalls: self.CONFIG.KENO_DRAW_COUNT,
                        playersCount: activeGame.players.length,
                        totalBets: activeGame.totalBets,
                        message: 'Draw in progress. Watching live...',
                        hasBet: playerHasBet
                    };
                    
                    // Only send drawn numbers if player has a bet in this round
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
        
        // ==================== WALLET FUNCTIONALITY ====================
        
        // Get wallet transactions
        socket.on('wallet:getTransactions', async (data) => {
            try {
                if (!socket.userId) {
                    socket.emit('wallet:error', 'Not authenticated');
                    return;
                }
                
                const { userId } = data;
                
                // Verify user
                if (userId !== socket.userId) {
                    socket.emit('wallet:error', 'Unauthorized');
                    return;
                }
                
                // Get recent transactions (last 20)
                const transactions = await self.WalletTransaction.find({ 
                    userId: userId 
                })
                .sort({ timestamp: -1 })
                .limit(20);
                
                socket.emit('wallet:transactions', {
                    success: true,
                    transactions: transactions,
                    count: transactions.length
                });
                
            } catch (error) {
                console.error('Wallet get transactions error:', error);
                socket.emit('wallet:error', 'Failed to get transactions');
            }
        });
        
        // Request deposit
        socket.on('wallet:requestDeposit', async (data) => {
            try {
                if (!socket.userId) {
                    socket.emit('wallet:error', 'Not authenticated');
                    return;
                }
                
                const { userId, amount, userName } = data;
                
                // Verify user
                if (userId !== socket.userId) {
                    socket.emit('wallet:error', 'Unauthorized');
                    return;
                }
                
                // Validate amount
                const depositAmount = parseFloat(amount);
                if (isNaN(depositAmount) || 
                    depositAmount < self.CONFIG.MIN_DEPOSIT || 
                    depositAmount > self.CONFIG.MAX_DEPOSIT) {
                    socket.emit('wallet:error', `Deposit amount must be between ${self.CONFIG.MIN_DEPOSIT} and ${self.CONFIG.MAX_DEPOSIT} ETB`);
                    return;
                }
                
                // Get user
                const user = await self.User.findOne({ userId: userId });
                if (!user) {
                    socket.emit('wallet:error', 'User not found');
                    return;
                }
                
                // Create deposit request
                const depositTransaction = new self.WalletTransaction({
                    type: 'DEPOSIT_REQUEST',
                    userId: userId,
                    userName: userName,
                    amount: depositAmount,
                    status: 'pending',
                    description: `Deposit request: ${depositAmount} ETB`,
                    details: {
                        processedBy: 'system',
                        notes: 'Awaiting admin approval'
                    }
                });
                await depositTransaction.save();
                
                // Update user stats
                user.totalDepositRequests = (user.totalDepositRequests || 0) + 1;
                user.totalDepositAmount = (user.totalDepositAmount || 0) + depositAmount;
                await user.save();
                
                // Update player state
                const player = self.kenoPlayers.get(userId);
                if (player) {
                    player.totalDeposits = (player.totalDeposits || 0) + depositAmount;
                    self.kenoPlayers.set(userId, player);
                }
                
                // Update global stats
                await self.updateKenoStats(0, 0, depositAmount, 0, 0);
                
                // Create admin notification transaction
                const adminNotification = new self.Transaction({
                    type: 'DEPOSIT_REQUEST',
                    userId: userId,
                    userName: userName,
                    amount: depositAmount,
                    description: `Deposit request from ${userName}: ${depositAmount} ETB`,
                    status: 'pending',
                    admin: true
                });
                await adminNotification.save();
                
                socket.emit('wallet:depositRequested', {
                    success: true,
                    amount: depositAmount,
                    transactionId: depositTransaction._id,
                    message: `Deposit request of ${depositAmount} ETB submitted. Admin will process shortly.`
                });
                
                console.log(`💰 Deposit request: ${userName} - ${depositAmount} ETB`);
                
            } catch (error) {
                console.error('Wallet deposit request error:', error);
                socket.emit('wallet:error', 'Failed to process deposit request');
            }
        });
        
        // Request withdrawal
        socket.on('wallet:requestWithdrawal', async (data) => {
            try {
                if (!socket.userId) {
                    socket.emit('wallet:error', 'Not authenticated');
                    return;
                }
                
                const { userId, amount, accountInfo, userName } = data;
                
                // Verify user
                if (userId !== socket.userId) {
                    socket.emit('wallet:error', 'Unauthorized');
                    return;
                }
                
                // Validate amount
                const withdrawalAmount = parseFloat(amount);
                if (isNaN(withdrawalAmount) || withdrawalAmount < self.CONFIG.MIN_WITHDRAWAL) {
                    socket.emit('wallet:error', `Minimum withdrawal is ${self.CONFIG.MIN_WITHDRAWAL} ETB`);
                    return;
                }
                
                // Validate account info
                if (!accountInfo || accountInfo.trim() === '') {
                    socket.emit('wallet:error', 'Account information is required');
                    return;
                }
                
                // Get user
                const user = await self.User.findOne({ userId: userId });
                if (!user) {
                    socket.emit('wallet:error', 'User not found');
                    return;
                }
                
                // Check balance
                if (user.balance < withdrawalAmount) {
                    socket.emit('wallet:error', 'Insufficient balance');
                    return;
                }
                
                // Calculate fee and net amount
                const fee = (withdrawalAmount * self.CONFIG.WITHDRAWAL_FEE_PERCENTAGE) / 100;
                const netAmount = withdrawalAmount - fee;
                
                // Create withdrawal request
                const withdrawalTransaction = new self.WalletTransaction({
                    type: 'WITHDRAWAL_REQUEST',
                    userId: userId,
                    userName: userName,
                    amount: -withdrawalAmount,
                    status: 'pending',
                    description: `Withdrawal request: ${withdrawalAmount} ETB (Net: ${netAmount} ETB after ${fee.toFixed(2)} ETB fee)`,
                    details: {
                        accountInfo: accountInfo,
                        netAmount: netAmount,
                        fee: fee,
                        processedBy: 'system',
                        notes: 'Awaiting admin processing'
                    }
                });
                await withdrawalTransaction.save();
                
                // Update user stats
                user.totalWithdrawalRequests = (user.totalWithdrawalRequests || 0) + 1;
                user.totalWithdrawalAmount = (user.totalWithdrawalAmount || 0) + withdrawalAmount;
                await user.save();
                
                // Update player state
                const player = self.kenoPlayers.get(userId);
                if (player) {
                    player.totalWithdrawals = (player.totalWithdrawals || 0) + withdrawalAmount;
                    self.kenoPlayers.set(userId, player);
                }
                
                // Update global stats
                await self.updateKenoStats(0, 0, 0, withdrawalAmount, 0);
                
                // Create admin notification transaction
                const adminNotification = new self.Transaction({
                    type: 'WITHDRAWAL_REQUEST',
                    userId: userId,
                    userName: userName,
                    amount: -withdrawalAmount,
                    description: `Withdrawal request from ${userName}: ${withdrawalAmount} ETB to ${accountInfo}`,
                    status: 'pending',
                    admin: true,
                    details: {
                        accountInfo: accountInfo,
                        netAmount: netAmount,
                        fee: fee
                    }
                });
                await adminNotification.save();
                
                socket.emit('wallet:withdrawalRequested', {
                    success: true,
                    amount: withdrawalAmount,
                    netAmount: netAmount,
                    fee: fee,
                    transactionId: withdrawalTransaction._id,
                    message: `Withdrawal request of ${withdrawalAmount} ETB submitted. Will be processed within 24 hours.`
                });
                
                console.log(`💰 Withdrawal request: ${userName} - ${withdrawalAmount} ETB to ${accountInfo}`);
                
            } catch (error) {
                console.error('Wallet withdrawal request error:', error);
                socket.emit('wallet:error', 'Failed to process withdrawal request');
            }
        });
        
        // Process deposit (Admin only - triggered via separate admin interface)
        socket.on('wallet:processDeposit', async (data) => {
            try {
                // Admin authentication would go here
                // For now, we'll implement the logic
                
                const { transactionId, action, adminNotes } = data;
                
                const transaction = await self.WalletTransaction.findById(transactionId);
                if (!transaction || transaction.type !== 'DEPOSIT_REQUEST') {
                    socket.emit('wallet:error', 'Transaction not found or invalid type');
                    return;
                }
                
                if (transaction.status !== 'pending') {
                    socket.emit('wallet:error', 'Transaction already processed');
                    return;
                }
                
                if (action === 'approve') {
                    // Get user
                    const user = await self.User.findOne({ userId: transaction.userId });
                    if (!user) {
                        socket.emit('wallet:error', 'User not found');
                        return;
                    }
                    
                    // Update user balance
                    user.balance += transaction.amount;
                    user.totalDeposits = (user.totalDeposits || 0) + transaction.amount;
                    user.lastDeposit = new Date();
                    await user.save();
                    
                    // Update transaction
                    transaction.status = 'completed';
                    transaction.details.processedBy = socket.userId || 'admin';
                    transaction.details.notes = adminNotes || 'Approved by admin';
                    transaction.processedAt = new Date();
                    await transaction.save();
                    
                    // Create completed transaction record
                    const completedTransaction = new self.WalletTransaction({
                        type: 'DEPOSIT',
                        userId: transaction.userId,
                        userName: transaction.userName,
                        amount: transaction.amount,
                        status: 'completed',
                        description: `Deposit completed: ${transaction.amount} ETB`,
                        details: {
                            originalTransactionId: transactionId,
                            processedBy: socket.userId || 'admin'
                        }
                    });
                    await completedTransaction.save();
                    
                    // Update player state
                    const player = self.kenoPlayers.get(transaction.userId);
                    if (player) {
                        player.balance = user.balance;
                        self.kenoPlayers.set(transaction.userId, player);
                        
                        // Notify player
                        const playerSocket = self.getKenoSocketByUserId(transaction.userId);
                        if (playerSocket) {
                            playerSocket.emit('wallet:balanceUpdated', {
                                balance: user.balance,
                                amount: transaction.amount,
                                type: 'deposit',
                                message: `Deposit of ${transaction.amount} ETB completed`
                            });
                        }
                    }
                    
                    socket.emit('wallet:depositProcessed', {
                        success: true,
                        transactionId: transaction._id,
                        userId: transaction.userId,
                        amount: transaction.amount,
                        message: `Deposit approved for ${transaction.userName}`
                    });
                    
                    console.log(`💰 Deposit approved: ${transaction.userName} - ${transaction.amount} ETB`);
                    
                } else if (action === 'reject') {
                    // Update transaction
                    transaction.status = 'rejected';
                    transaction.details.processedBy = socket.userId || 'admin';
                    transaction.details.notes = adminNotes || 'Rejected by admin';
                    transaction.processedAt = new Date();
                    await transaction.save();
                    
                    socket.emit('wallet:depositProcessed', {
                        success: true,
                        transactionId: transaction._id,
                        userId: transaction.userId,
                        amount: transaction.amount,
                        message: `Deposit rejected for ${transaction.userName}`
                    });
                    
                    console.log(`💰 Deposit rejected: ${transaction.userName} - ${transaction.amount} ETB`);
                }
                
            } catch (error) {
                console.error('Process deposit error:', error);
                socket.emit('wallet:error', 'Failed to process deposit');
            }
        });
        
        // Process withdrawal (Admin only)
        socket.on('wallet:processWithdrawal', async (data) => {
            try {
                const { transactionId, action, adminNotes } = data;
                
                const transaction = await self.WalletTransaction.findById(transactionId);
                if (!transaction || transaction.type !== 'WITHDRAWAL_REQUEST') {
                    socket.emit('wallet:error', 'Transaction not found or invalid type');
                    return;
                }
                
                if (transaction.status !== 'pending') {
                    socket.emit('wallet:error', 'Transaction already processed');
                    return;
                }
                
                if (action === 'approve') {
                    // Get user
                    const user = await self.User.findOne({ userId: transaction.userId });
                    if (!user) {
                    socket.emit('wallet:error', 'User not found');
                        return;
                    }
                    
                    // Check balance again
                    if (user.balance < Math.abs(transaction.amount)) {
                        socket.emit('wallet:error', 'User has insufficient balance');
                        return;
                    }
                    
                    // Update user balance
                    user.balance += transaction.amount; // Amount is negative
                    user.totalWithdrawals = (user.totalWithdrawals || 0) + Math.abs(transaction.amount);
                    user.lastWithdrawal = new Date();
                    await user.save();
                    
                    // Update transaction
                    transaction.status = 'completed';
                    transaction.details.processedBy = socket.userId || 'admin';
                    transaction.details.notes = adminNotes || 'Approved by admin';
                    transaction.processedAt = new Date();
                    await transaction.save();
                    
                    // Create completed transaction record
                    const completedTransaction = new self.WalletTransaction({
                        type: 'WITHDRAWAL',
                        userId: transaction.userId,
                        userName: transaction.userName,
                        amount: transaction.amount,
                        status: 'completed',
                        description: `Withdrawal completed: ${Math.abs(transaction.amount)} ETB`,
                        details: {
                            originalTransactionId: transactionId,
                            processedBy: socket.userId || 'admin',
                            accountInfo: transaction.details.accountInfo,
                            netAmount: transaction.details.netAmount,
                            fee: transaction.details.fee
                        }
                    });
                    await completedTransaction.save();
                    
                    // Update player state
                    const player = self.kenoPlayers.get(transaction.userId);
                    if (player) {
                        player.balance = user.balance;
                        self.kenoPlayers.set(transaction.userId, player);
                        
                        // Notify player
                        const playerSocket = self.getKenoSocketByUserId(transaction.userId);
                        if (playerSocket) {
                            playerSocket.emit('wallet:balanceUpdated', {
                                balance: user.balance,
                                amount: transaction.amount,
                                type: 'withdrawal',
                                message: `Withdrawal of ${Math.abs(transaction.amount)} ETB completed`
                            });
                        }
                    }
                    
                    socket.emit('wallet:withdrawalProcessed', {
                        success: true,
                        transactionId: transaction._id,
                        userId: transaction.userId,
                        amount: Math.abs(transaction.amount),
                        message: `Withdrawal approved for ${transaction.userName}`
                    });
                    
                    console.log(`💰 Withdrawal approved: ${transaction.userName} - ${Math.abs(transaction.amount)} ETB`);
                    
                } else if (action === 'reject') {
                    // Update transaction
                    transaction.status = 'rejected';
                    transaction.details.processedBy = socket.userId || 'admin';
                    transaction.details.notes = adminNotes || 'Rejected by admin';
                    transaction.processedAt = new Date();
                    await transaction.save();
                    
                    socket.emit('wallet:withdrawalProcessed', {
                        success: true,
                        transactionId: transaction._id,
                        userId: transaction.userId,
                        amount: Math.abs(transaction.amount),
                        message: `Withdrawal rejected for ${transaction.userName}`
                    });
                    
                    console.log(`💰 Withdrawal rejected: ${transaction.userName} - ${Math.abs(transaction.amount)} ETB`);
                }
                
            } catch (error) {
                console.error('Process withdrawal error:', error);
                socket.emit('wallet:error', 'Failed to process withdrawal');
            }
        });
        
        // Join Keno room
        socket.on('keno:join', () => {
            socket.join('keno');
            console.log(`🎰 Player joined Keno room: ${socket.id}`);
        });
        
        // Handle disconnection
        socket.on('disconnect', () => {
            self.handleKenoDisconnect(socket);
        });
    },
    
    // Handle Keno disconnection - IMPROVED
    handleKenoDisconnect: function(socket) {
        const self = this;
        
        console.log(`🎰 Keno disconnected: ${socket.id}`);
        
        // Track disconnection time for reconnection
        if (socket.userId) {
            const player = self.kenoPlayers.get(socket.userId);
            if (player) {
                // Mark as offline but keep player data
                player.isOnline = false;
                player.lastSeen = new Date();
                player.disconnectTime = Date.now();
                
                // Save pending selections for reconnection
                // ONLY if round is active, player hasn't placed bet, and has selections
                if (self.isKenoRoundActive && 
                    !player.hasPlacedBet && 
                    player.selectedNumbers.length > 0) {
                    player.pendingSelections = [...player.selectedNumbers];
                    player.pendingBet = player.currentBet;
                    console.log(`💾 Saved pending selections for ${player.userName}: ${player.selectedNumbers.length} numbers`);
                }
                
                self.kenoPlayers.set(socket.userId, player);
                
                // Add to disconnected players map for reconnection tracking
                // Only if they were online and actively playing
                if (player.socketId && player.isOnline) {
                    self.disconnectedPlayers.set(socket.userId, Date.now());
                    console.log(`📝 Added ${player.userName} to disconnected players`);
                }
                
                // Remove player from active game if they haven't placed a bet
                const activeGame = self.getActiveKenoGame();
                if (activeGame && activeGame.players) {
                    const playerIndex = activeGame.players.indexOf(socket.userId);
                    if (playerIndex > -1 && !player.hasPlacedBet) {
                        activeGame.players.splice(playerIndex, 1);
                        console.log(`🎰 Removed disconnected player ${player.userName} from active game`);
                    }
                }
                
                // Update in database
                self.User.findOneAndUpdate(
                    { userId: socket.userId },
                    { 
                        isOnline: false,
                        lastSeen: new Date()
                    }
                ).catch(err => console.error('Error updating user status:', err));
            }
        }
        
        // Remove from keno sockets
        self.kenoSockets.delete(socket.id);
        
        // Broadcast updated player count
        self.broadcastKenoPlayersUpdate();
        
        // Check if we need to pause the game (no players left)
        const onlinePlayers = self.getOnlinePlayersCount();
        
        // FIX: Check if round is active but no players with bets
        const activeGame = self.getActiveKenoGame();
        const hasActiveBets = activeGame && activeGame.totalBets > 0;
        
        if (onlinePlayers === 0 && self.isKenoRoundActive && !hasActiveBets) {
            console.log('🎰 No players online and no active bets, resetting game...');
            self.resetStuckKenoGame();
        } else if (onlinePlayers === 0 && self.isKenoRoundActive) {
            console.log('🎰 No players online, pausing game...');
            self.pauseKenoGame();
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
        
        // FIX: Check if we actually have online players
        const onlinePlayers = self.getOnlinePlayersCount();
        if (onlinePlayers < self.minimumPlayers) {
            console.log('🎰 Not enough players to start round. Cancelling...');
            // Don't start round, just wait
            self.isKenoRoundActive = false;
            
            // Broadcast waiting status
            self.io.to('keno').emit('keno:waiting', {
                message: 'Waiting for players...',
                playersNeeded: self.minimumPlayers
            });
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
            drawnNumbersOriginalOrder: [], // Store original random order
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
            drawCount: self.CONFIG.KENO_DRAW_COUNT,
            willBeRandomOrder: true
        });
        
        // Reset all players' bet status (but keep pre-selected numbers)
        for (const [userId, player] of self.kenoPlayers) {
            // Only reset bet status for online players
            if (player.isOnline) {
                player.hasPlacedBet = false;
                player.currentBet = null;
                
                // Clear any pending selections (new round starts fresh)
                player.pendingSelections = [];
                player.pendingBet = null;
                
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
                    // Don't clear selected numbers - let players keep their selection
                    if (self.CONFIG.ALLOW_PRE_SELECTION) {
                        // Keep existing selectedNumbers if they have 1-5 numbers
                        if (player.selectedNumbers.length < self.CONFIG.KENO_MIN_SELECTIONS || 
                            player.selectedNumbers.length > self.CONFIG.KENO_MAX_SELECTIONS) {
                            player.selectedNumbers = [];
                        }
                    } else {
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
        
        console.log('🎰 startGameIfReady called. Current state:');
        console.log('  isKenoRoundActive:', self.isKenoRoundActive);
        console.log('  isDrawing:', self.isDrawing);
        console.log('  gameStatus:', gameStatus);
        console.log('  isRoundScheduled:', self.isRoundScheduled);
        console.log('  onlinePlayers:', self.getOnlinePlayersCount());
        console.log('  minimumPlayers:', self.minimumPlayers);
        console.log('  disconnectedPlayers:', self.disconnectedPlayers.size);
        
        // Only start a new round if:
        // 1. No round is active
        // 2. Not currently drawing
        // 3. Game status is 'waiting' (not 'betting', 'drawing', or 'completed')
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
        } else if (self.isKenoRoundActive) {
            console.log('🎰 Game already active, continuing...');
        } else if (self.isDrawing) {
            console.log('🎰 Currently drawing, cannot start new round');
        } else if (self.isRoundScheduled) {
            console.log('🎰 Round already scheduled, waiting...');
        } else {
            console.log('🎰 Waiting for players to start game... Status:', gameStatus);
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
            
            // FIX: Check if we lost all players during countdown
            const onlinePlayers = self.getOnlinePlayersCount();
            if (onlinePlayers === 0) {
                clearInterval(self.kenoCountdownInterval);
                self.kenoCountdownInterval = null;
                console.log('🎰 All players left during countdown, cancelling round...');
                self.resetStuckKenoGame();
                return;
            }
            
            self.kenoCountdown--;
            
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
    
    // Draw Keno numbers - UPDATED with ball counter and random order drawing
    drawKenoNumbers: async function() {
        const self = this;
        const activeGame = self.getActiveKenoGame();
        
        if (!activeGame || activeGame.status !== 'betting') return;
        
        console.log('🎰 Drawing Keno numbers...');
        
        // IMPORTANT: Set game status to drawing
        activeGame.status = 'drawing';
        self.isKenoRoundActive = false;
        self.isDrawing = true;
        
        // Broadcast draw start
        self.io.to('keno').emit('keno:draw_start', {
            round: activeGame.roundNumber,
            message: 'Drawing numbers...',
            popInterval: self.CONFIG.NUMBER_POP_INTERVAL,
            totalBalls: self.CONFIG.KENO_DRAW_COUNT,
            willBeRandomOrder: true // Inform clients numbers will come in random order
        });
        
        // Wait 2 seconds for dramatic effect
        setTimeout(async () => {
            // Generate 20 random unique numbers - DO NOT SORT THEM
            const drawnNumbers = [];
            while (drawnNumbers.length < self.CONFIG.KENO_DRAW_COUNT) {
                const num = Math.floor(Math.random() * self.CONFIG.KENO_TOTAL_NUMBERS) + 1;
                if (!drawnNumbers.includes(num)) {
                    drawnNumbers.push(num);
                }
            }
            
            // Store in original random order
            activeGame.drawnNumbersOriginalOrder = [...drawnNumbers];
            activeGame.drawnNumbers = drawnNumbers;
            
            console.log(`🎰 Numbers to draw (random order): ${drawnNumbers.join(', ')}`);
            
            // Draw numbers one by one in RANDOM ORDER (as they were generated)
            for (let i = 0; i < drawnNumbers.length; i++) {
                setTimeout(() => {
                    self.io.to('keno').emit('keno:number_drawn', {
                        number: drawnNumbers[i], // This is the random number at position i
                        index: i,
                        total: drawnNumbers.length,
                        drawnCount: i + 1, // Current ball number (1/20, 2/20, etc.)
                        round: activeGame.roundNumber,
                        isRandomOrder: true
                    });
                }, i * self.CONFIG.NUMBER_POP_INTERVAL);
            }
            
            // After all numbers are drawn, send complete results IN SORTED ORDER for display
            setTimeout(() => {
                // For the final display, we sort them for better readability
                const sortedForDisplay = [...drawnNumbers].sort((a, b) => a - b);
                
                self.io.to('keno').emit('keno:round_results', {
                    round: activeGame.roundNumber,
                    drawnNumbers: sortedForDisplay, // Send sorted for final display
                    originalOrder: drawnNumbers, // Keep original random order too
                    playersCount: activeGame.players.length,
                    totalBets: activeGame.totalBets,
                    popInterval: self.CONFIG.NUMBER_POP_INTERVAL,
                    message: `Round ${activeGame.roundNumber} results!`,
                    totalDrawn: drawnNumbers.length,
                    isDrawComplete: true,
                    wasRandomOrder: true
                });
                
                // Mark draw as complete
                activeGame.drawComplete = true;
                activeGame.status = 'completed';
                self.isDrawing = false;
                
                // Process results after numbers are shown
                setTimeout(async () => {
                    await self.processKenoResults(activeGame);
                }, 1000);
                
            }, (drawnNumbers.length * self.CONFIG.NUMBER_POP_INTERVAL) + 1000);
            
        }, 2000);
    },
    
    // Send player round result
    sendPlayerRoundResult: function(socket, userId, activeGame) {
        const self = this;
        const bet = activeGame.bets[userId];
        
        if (!bet) return;
        
        // Count matches
        const matches = bet.numbers.filter(num => 
            activeGame.drawnNumbers.includes(num)
        ).length;
        
        // Calculate winnings
        let winnings = 0;
        const selectionCount = bet.selectionCount || bet.numbers.length;
        
        if (self.CONFIG.PAYOUT_TABLE[selectionCount]) {
            const payout = self.CONFIG.PAYOUT_TABLE[selectionCount][matches];
            if (payout !== undefined && payout > 0) {
                winnings = bet.amount * payout;
            }
        }
        
        // Send result
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
    
    // Process Keno results - UPDATED for 1-5 numbers with new payout table
    processKenoResults: async function(activeGame) {
        const self = this;
        
        console.log('🎰 Processing Keno results...');
        
        // Calculate winnings for each player
        for (const [playerId, bet] of Object.entries(activeGame.bets)) {
            try {
                // Count matches
                const matches = bet.numbers.filter(num => 
                    activeGame.drawnNumbers.includes(num)
                ).length;
                
                // Calculate winnings based on number of selections
                let winnings = 0;
                const selectionCount = bet.selectionCount || bet.numbers.length;
                
                if (self.CONFIG.PAYOUT_TABLE[selectionCount]) {
                    const payout = self.CONFIG.PAYOUT_TABLE[selectionCount][matches];
                    if (payout !== undefined && payout > 0) {
                        winnings = bet.amount * payout;
                        console.log(`   ${bet.userName}: ${selectionCount} numbers, ${matches} matches, ${payout}x, ${bet.amount} ETB bet = ${winnings} ETB win`);
                    }
                }
                
                if (winnings > 0) {
                    // Update user balance
                    const user = await self.User.findOne({ userId: playerId });
                    if (user) {
                        user.balance += winnings;
                        user.totalWins += winnings;
                        user.kenoWins = (user.kenoWins || 0) + 1;
                        await user.save();
                        
                        // Create win transaction
                        const transaction = new self.Transaction({
                            type: 'KENO_WIN',
                            userId: playerId,
                            userName: user.userName,
                            amount: winnings,
                            description: `Keno win: ${winnings} ETB (bet ${bet.amount} ETB on ${selectionCount} numbers, matched ${matches})`,
                            game: 'keno',
                            status: 'completed',
                            details: {
                                numbers: bet.numbers,
                                drawnNumbers: activeGame.drawnNumbers,
                                matches: matches,
                                selectionCount: selectionCount,
                                round: activeGame.roundNumber,
                                payoutMultiplier: winnings / bet.amount
                            }
                        });
                        await transaction.save();
                        
                        // Add to winners list
                        activeGame.winners.push({
                            playerId: playerId,
                            playerName: user.userName,
                            betAmount: bet.amount,
                            numbers: bet.numbers,
                            selectionCount: selectionCount,
                            matches: matches,
                            winnings: winnings,
                            payoutMultiplier: winnings / bet.amount
                        });
                        
                        activeGame.totalPayout += winnings;
                        
                        // Update player state
                        const player = self.kenoPlayers.get(playerId);
                        if (player) {
                            player.balance = user.balance;
                            player.totalWins += winnings;
                            player.hasPlacedBet = false;
                            player.currentBet = null;
                            // Keep selected numbers if player wants to use them again
                            // Only clear if they're not pre-selected
                            if (!player.isReadyForNextRound) {
                                player.selectedNumbers = [];
                            }
                            // Clear pending selections
                            player.pendingSelections = [];
                            player.pendingBet = null;
                            self.kenoPlayers.set(playerId, player);
                        }
                        
                        // Send personal result
                        const playerSocket = self.getKenoSocketByUserId(playerId);
                        if (playerSocket) {
                            playerSocket.emit('keno:round_result', {
                                round: activeGame.roundNumber,
                                drawnNumbers: activeGame.drawnNumbers,
                                yourNumbers: bet.numbers,
                                selectionCount: selectionCount,
                                matches: matches,
                                winnings: winnings,
                                newBalance: user.balance,
                                bet: bet.amount,
                                message: `You won ${winnings} ETB! Matched ${matches} of ${selectionCount} numbers.`
                            });
                        }
                        
                        console.log(`🎰 Winner: ${user.userName} won ${winnings} ETB (matched ${matches}/${selectionCount} numbers, ${winnings/bet.amount}x)`);
                    }
                } else {
                    // Send loss result
                    const playerSocket = self.getKenoSocketByUserId(playerId);
                    if (playerSocket) {
                        playerSocket.emit('keno:round_result', {
                            round: activeGame.roundNumber,
                            drawnNumbers: activeGame.drawnNumbers,
                            yourNumbers: bet.numbers,
                            selectionCount: selectionCount,
                            matches: matches,
                            winnings: 0,
                            newBalance: await self.getUserBalance(playerId),
                            bet: bet.amount,
                            message: `Matched ${matches} of ${selectionCount} numbers. Better luck next round!`
                        });
                    }
                    
                    // Update player state
                    const player = self.kenoPlayers.get(playerId);
                    if (player) {
                        player.hasPlacedBet = false;
                        player.currentBet = null;
                        // Keep selected numbers if player wants to use them again
                        // Only clear if they're not pre-selected
                        if (!player.isReadyForNextRound) {
                            player.selectedNumbers = [];
                        }
                        // Clear pending selections
                        player.pendingSelections = [];
                        player.pendingBet = null;
                        self.kenoPlayers.set(playerId, player);
                    }
                }
            } catch (error) {
                console.error(`Error processing result for player ${playerId}:`, error);
            }
        }
        
        // Mark results as processed
        activeGame.processedResults = true;
        
        // Calculate house commission
        const totalWagered = activeGame.totalBetAmount;
        const commission = (totalWagered * self.CONFIG.COMMISSION_PERCENTAGE) / 100;
        activeGame.commissionCollected = commission;
        self.totalKenoEarnings += commission;
        
        // Update game stats
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
        
        console.log(`🎰 Round ${activeGame.roundNumber} completed. Preparing for next round...`);
        
        // Clear all disconnected players and pending states after round completion
        self.disconnectedPlayers.clear();
        self.playerReconnectAttempts.clear();
        
        // Reset the current game to waiting state after a delay
        setTimeout(() => {
            // IMPORTANT: Set game back to waiting state for next round
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
            
            console.log(`🎰 Players online after round: ${onlinePlayers}`);
            
            if (onlinePlayers >= self.minimumPlayers) {
                // Start next round after 5 seconds
                console.log('🎰 Scheduling next round in 5 seconds...');
                
                // Clear any existing timeout
                if (self.roundTransitionTimeout) {
                    clearTimeout(self.roundTransitionTimeout);
                    self.roundTransitionTimeout = null;
                }
                
                self.roundTransitionTimeout = setTimeout(() => {
                    console.log('🎰 Starting next round now...');
                    self.startGameIfReady();
                }, 5000);
            } else {
                console.log('🎰 No players online. Game will wait for players.');
                // Broadcast waiting message
                self.io.to('keno').emit('keno:waiting', {
                    message: 'Waiting for players to start next round...',
                    playersNeeded: self.minimumPlayers
                });
            }
        }, 3000);
    },
    
    // Update Keno stats in database - UPDATED for wallet
    updateKenoStats: async function(wagered, payout, depositAmount, withdrawalAmount, games) {
        try {
            const today = new Date().toISOString().split('T')[0];
            
            const updateData = {
                $inc: {
                    totalWagered: wagered || 0,
                    totalEarnings: wagered - payout || 0,
                    totalGames: games || 0,
                    totalUsers: 0,
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
    
    // Helper methods
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
            totalBetAmount: activeGame.totalBetAmount,
            disconnectedPlayers: this.disconnectedPlayers.size
        });
    },
    
    getUserBalance: async function(userId) {
        const user = await this.User.findOne({ userId: userId });
        return user ? user.balance : 0;
    },
    
    // Start Keno server
    startKenoServer: function() {
        const self = this;
        
        console.log('🎰 Starting Keno game server...');
        
        // Start first round if we have players
        const onlinePlayers = self.getOnlinePlayersCount();
        
        if (onlinePlayers >= self.minimumPlayers) {
            setTimeout(() => {
                self.startGameIfReady();
            }, 5000);
        } else {
            console.log('🎰 Waiting for players to start first round...');
        }
    },
    
    // Get Keno players count
    getKenoPlayersCount: function() {
        return this.kenoPlayers.size;
    },
    
    // Get online players count
    getOnlinePlayersCount: function() {
        return Array.from(this.kenoPlayers.values()).filter(p => p.isOnline).length;
    },
    
    // Get all Keno players
    getAllKenoPlayers: function() {
        return Array.from(this.kenoPlayers.values());
    },
    
    // Force start Keno round (admin)
    forceStartKenoRound: function() {
        const onlinePlayers = this.getOnlinePlayersCount();
        if (onlinePlayers >= this.minimumPlayers) {
            this.startKenoRound();
            return true;
        }
        return false;
    },
    
    // Get Keno game stats
    getKenoGameStats: function() {
        const activeGame = this.getActiveKenoGame();
        const onlinePlayers = this.getOnlinePlayersCount();
        
        // Calculate average selection count
        let avgSelectionCount = 0;
        if (activeGame && activeGame.bets) {
            const bets = Object.values(activeGame.bets);
            if (bets.length > 0) {
                const totalSelections = bets.reduce((sum, bet) => sum + (bet.selectionCount || bet.numbers.length), 0);
                avgSelectionCount = totalSelections / bets.length;
            }
        }
        
        return {
            roundNumber: this.kenoRoundNumber,
            isRoundActive: this.isKenoRoundActive,
            isDrawing: this.isDrawing,
            countdown: this.kenoCountdown,
            playersCount: this.kenoPlayers.size,
            onlinePlayers: onlinePlayers,
            totalEarnings: this.totalKenoEarnings,
            activeGame: activeGame ? {
                players: activeGame.players.length,
                totalBets: activeGame.totalBets,
                totalBetAmount: activeGame.totalBetAmount,
                status: activeGame.status,
                drawnNumbers: activeGame.drawnNumbers,
                drawnNumbersOriginalOrder: activeGame.drawnNumbersOriginalOrder,
                drawComplete: activeGame.drawComplete,
                averageSelectionCount: avgSelectionCount.toFixed(2)
            } : null,
            historyCount: this.kenoRoundHistory.length,
            minimumPlayers: this.minimumPlayers,
            allowPreSelection: this.CONFIG.ALLOW_PRE_SELECTION,
            disconnectedPlayers: this.disconnectedPlayers.size,
            reconnectAttempts: this.playerReconnectAttempts.size,
            config: {
                minSelections: this.CONFIG.KENO_MIN_SELECTIONS,
                maxSelections: this.CONFIG.KENO_MAX_SELECTIONS,
                allowedBets: this.CONFIG.ALLOWED_BETS,
                reconnectTimeout: this.CONFIG.RECONNECT_TIMEOUT
            }
        };
    },
    
    // Get detailed Keno stats for admin
    getKenoDetailedStats: function() {
        const stats = this.getKenoGameStats();
        const recentHistory = this.kenoRoundHistory.slice(0, 5);
        
        // Count ready players
        const readyPlayers = Array.from(this.kenoPlayers.values()).filter(p => p.isReadyForNextRound).length;
        
        // Calculate wallet stats
        const totalDeposits = Array.from(this.kenoPlayers.values()).reduce((sum, p) => sum + (p.totalDeposits || 0), 0);
        const totalWithdrawals = Array.from(this.kenoPlayers.values()).reduce((sum, p) => sum + (p.totalWithdrawals || 0), 0);
        
        // Get disconnected players info
        const disconnectedPlayers = Array.from(this.disconnectedPlayers.entries()).map(([userId, time]) => {
            const player = this.kenoPlayers.get(userId);
            return {
                userId,
                userName: player?.userName || 'Unknown',
                disconnectTime: new Date(time).toISOString(),
                timeAgo: Math.floor((Date.now() - time) / 1000) + ' seconds',
                reconnectAttempts: this.playerReconnectAttempts.get(userId) || 0,
                hasPendingSelections: player?.pendingSelections?.length > 0 || false
            };
        });
        
        return {
            ...stats,
            recentHistory: recentHistory,
            totalPlayers: this.kenoPlayers.size,
            connectedSockets: this.kenoSockets.size,
            readyPlayers: readyPlayers,
            totalDeposits: totalDeposits,
            totalWithdrawals: totalWithdrawals,
            netWalletFlow: totalDeposits - totalWithdrawals,
            disconnectedPlayers: disconnectedPlayers,
            reconnectTokens: this.playerReconnectTokens.size,
            config: this.CONFIG
        };
    },
    
    // Admin: Reset Keno earnings
    resetKenoEarnings: async function() {
        try {
            const previousAmount = this.totalKenoEarnings;
            this.totalKenoEarnings = 0;
            
            // Create reset transaction
            const transaction = new this.Transaction({
                type: 'KENO_EARNINGS_RESET',
                userId: 'system',
                userName: 'System',
                amount: -previousAmount,
                description: `Keno earnings reset from ${previousAmount.toFixed(2)} to 0 ETB`,
                admin: true,
                status: 'completed'
            });
            await transaction.save();
            
            console.log(`🔄 Keno earnings reset from ${previousAmount.toFixed(2)} to 0 ETB`);
            return { success: true, previousAmount, newAmount: 0 };
            
        } catch (error) {
            console.error('Error resetting Keno earnings:', error);
            return { success: false, error: error.message };
        }
    },
    
    // Admin: Get Keno player list
    getKenoPlayerList: function() {
        const players = [];
        for (const [userId, player] of this.kenoPlayers) {
            players.push({
                userId: player.userId,
                userName: player.userName,
                balance: player.balance,
                isOnline: player.isOnline,
                lastSeen: player.lastSeen,
                totalWagered: player.totalWagered,
                totalWins: player.totalWins,
                hasPlacedBet: player.hasPlacedBet,
                selectedNumbers: player.selectedNumbers,
                selectionCount: player.selectedNumbers.length,
                preSelectedNumbers: player.preSelectedNumbers,
                preSelectionCount: player.preSelectedNumbers.length,
                isReadyForNextRound: player.isReadyForNextRound,
                isNewInCurrentRound: player.isNewInCurrentRound || false,
                totalDeposits: player.totalDeposits || 0,
                totalWithdrawals: player.totalWithdrawals || 0,
                sessionStart: player.sessionStart,
                // Reconnection info
                pendingSelections: player.pendingSelections || [],
                pendingBet: player.pendingBet,
                disconnectTime: player.disconnectTime,
                reconnectedAt: player.reconnectedAt,
                socketId: player.socketId
            });
        }
        return players;
    },
    
    // Clean up old data
    cleanupOldKenoData: function() {
        // Remove players who haven't been online for more than 24 hours
        const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
        let removedCount = 0;
        
        for (const [userId, player] of this.kenoPlayers) {
            if (player.lastSeen < twentyFourHoursAgo && !player.isOnline) {
                this.kenoPlayers.delete(userId);
                this.disconnectedPlayers.delete(userId);
                this.playerReconnectTokens.delete(userId);
                this.playerReconnectAttempts.delete(userId);
                removedCount++;
            }
        }
        
        // Clean up expired reconnect tokens
        const now = Date.now();
        for (const [userId, tokenData] of this.playerReconnectTokens) {
            if (now > tokenData.expires) {
                this.playerReconnectTokens.delete(userId);
                this.playerReconnectAttempts.delete(userId);
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
        
        // FIX: Detect if game is stuck in active state with no players
        if (this.isKenoRoundActive && onlinePlayers === 0) {
            console.log('🎰 Stuck game detected: Round active but no players online');
            const hasBets = activeGame && activeGame.totalBets > 0;
            
            if (!hasBets) {
                console.log('🎰 No bets placed, resetting game...');
                this.resetStuckKenoGame();
                return;
            }
        }
        
        // FIX: Detect if countdown is stuck
        if (this.kenoCountdown <= 0 && !this.isDrawing && !this.isKenoRoundActive) {
            console.log('🎰 Stuck countdown detected, resetting...');
            this.kenoCountdown = this.CONFIG.KENO_GAME_TIMER;
        }
        
        if (onlinePlayers === 0 && this.isKenoRoundActive) {
            console.log('🎰 No players online, pausing game...');
            this.pauseKenoGame();
        } else if (onlinePlayers >= this.minimumPlayers && 
                   !this.isKenoRoundActive && 
                   !this.isDrawing &&
                   gameStatus === 'waiting' && 
                   !this.isRoundScheduled) {
            // Check if no active game, start one
            console.log('🎰 Auto-starting game from checkGameStatus...');
            this.startGameIfReady();
        }
    },
    
    // Get player's ready status
    getPlayerReadyStatus: function(userId) {
        const player = this.kenoPlayers.get(userId);
        if (player) {
            return {
                isReadyForNextRound: player.isReadyForNextRound,
                preSelectedNumbers: player.preSelectedNumbers,
                selectedNumbers: player.selectedNumbers,
                selectionCount: player.selectedNumbers.length,
                preSelectionCount: player.preSelectedNumbers.length,
                isNewInCurrentRound: player.isNewInCurrentRound || false,
                hasPendingSelections: (player.pendingSelections && player.pendingSelections.length > 0) || false,
                isOnline: player.isOnline
            };
        }
        return null;
    },
    
    // Force player ready status (admin)
    forcePlayerReady: function(userId, numbers) {
        const player = this.kenoPlayers.get(userId);
        if (player) {
            player.preSelectedNumbers = numbers || player.selectedNumbers;
            player.isReadyForNextRound = true;
            this.kenoPlayers.set(userId, player);
            
            // Notify player
            const playerSocket = this.getKenoSocketByUserId(userId);
            if (playerSocket) {
                playerSocket.emit('keno:forceReady', {
                    numbers: player.preSelectedNumbers,
                    message: 'Admin has marked you as ready for next round'
                });
            }
            
            return { success: true, message: `Player ${player.userName} marked as ready` };
        }
        return { success: false, message: 'Player not found' };
    },
    
    // Toggle pre-selection feature
    togglePreSelectionFeature: function(enabled) {
        this.CONFIG.ALLOW_PRE_SELECTION = enabled;
        
        // Broadcast to all players
        this.io.to('keno').emit('keno:featureUpdate', {
            feature: 'preSelection',
            enabled: enabled,
            message: enabled ? 
                'Number pre-selection is now enabled!' : 
                'Number pre-selection is now disabled.'
        });
        
        return { success: true, enabled: enabled };
    },
    
    // Get pending wallet transactions for admin
    getPendingWalletTransactions: async function() {
        try {
            const pendingDeposits = await this.WalletTransaction.find({
                type: 'DEPOSIT_REQUEST',
                status: 'pending'
            }).sort({ timestamp: -1 }).limit(50);
            
            const pendingWithdrawals = await this.WalletTransaction.find({
                type: 'WITHDRAWAL_REQUEST',
                status: 'pending'
            }).sort({ timestamp: -1 }).limit(50);
            
            return {
                deposits: pendingDeposits,
                withdrawals: pendingWithdrawals,
                total: pendingDeposits.length + pendingWithdrawals.length
            };
        } catch (error) {
            console.error('Error getting pending transactions:', error);
            return { deposits: [], withdrawals: [], total: 0 };
        }
    },
    
    // Get wallet stats
    getWalletStats: async function() {
        try {
            const today = new Date().toISOString().split('T')[0];
            
            // Today's transactions
            const todayTransactions = await this.WalletTransaction.find({
                timestamp: { $gte: new Date(today) },
                status: 'completed'
            });
            
            const todayDeposits = todayTransactions.filter(t => t.amount > 0).reduce((sum, t) => sum + t.amount, 0);
            const todayWithdrawals = todayTransactions.filter(t => t.amount < 0).reduce((sum, t) => sum + Math.abs(t.amount), 0);
            
            // Total transactions
            const totalDeposits = await this.WalletTransaction.aggregate([
                { $match: { type: 'DEPOSIT', status: 'completed' } },
                { $group: { _id: null, total: { $sum: '$amount' } } }
            ]);
            
            const totalWithdrawals = await this.WalletTransaction.aggregate([
                { $match: { type: 'WITHDRAWAL', status: 'completed' } },
                { $group: { _id: null, total: { $sum: { $abs: '$amount' } } } }
            ]);
            
            return {
                today: {
                    deposits: todayDeposits,
                    withdrawals: todayWithdrawals,
                    transactions: todayTransactions.length
                },
                total: {
                    deposits: totalDeposits[0]?.total || 0,
                    withdrawals: totalWithdrawals[0]?.total || 0,
                    netFlow: (totalDeposits[0]?.total || 0) - (totalWithdrawals[0]?.total || 0)
                }
            };
        } catch (error) {
            console.error('Error getting wallet stats:', error);
            return { today: { deposits: 0, withdrawals: 0, transactions: 0 }, total: { deposits: 0, withdrawals: 0, netFlow: 0 } };
        }
    },
    
    // Manual balance adjustment (admin)
    adjustUserBalance: async function(userId, amount, reason, adminId) {
        try {
            const user = await this.User.findOne({ userId: userId });
            if (!user) {
                return { success: false, message: 'User not found' };
            }
            
            const oldBalance = user.balance;
            user.balance += amount;
            
            if (amount > 0) {
                user.totalDeposits = (user.totalDeposits || 0) + amount;
            } else {
                user.totalWithdrawals = (user.totalWithdrawals || 0) + Math.abs(amount);
            }
            
            await user.save();
            
            // Create transaction record
            const transaction = new this.WalletTransaction({
                type: amount > 0 ? 'MANUAL_DEPOSIT' : 'MANUAL_WITHDRAWAL',
                userId: userId,
                userName: user.userName,
                amount: amount,
                status: 'completed',
                description: reason || `Manual balance adjustment by admin ${adminId || 'system'}`,
                details: {
                    oldBalance: oldBalance,
                    newBalance: user.balance,
                    adjustment: amount,
                    adminId: adminId,
                    reason: reason
                }
            });
            await transaction.save();
            
            // Update player state if online
            const player = this.kenoPlayers.get(userId);
            if (player) {
                player.balance = user.balance;
                if (amount > 0) {
                    player.totalDeposits = (player.totalDeposits || 0) + amount;
                } else {
                    player.totalWithdrawals = (player.totalWithdrawals || 0) + Math.abs(amount);
                }
                this.kenoPlayers.set(userId, player);
                
                // Notify player
                const playerSocket = this.getKenoSocketByUserId(userId);
                if (playerSocket) {
                    playerSocket.emit('wallet:balanceUpdated', {
                        balance: user.balance,
                        amount: amount,
                        type: amount > 0 ? 'manual_deposit' : 'manual_withdrawal',
                        message: `Balance adjusted by admin: ${amount > 0 ? '+' : ''}${amount} ETB`
                    });
                }
            }
            
            // Update stats
            await this.updateKenoStats(0, 0, amount > 0 ? amount : 0, amount < 0 ? Math.abs(amount) : 0, 0);
            
            console.log(`💰 Manual balance adjustment: ${user.userName} ${amount > 0 ? '+' : ''}${amount} ETB (${oldBalance} → ${user.balance})`);
            
            return { 
                success: true, 
                oldBalance, 
                newBalance: user.balance,
                adjustment: amount,
                userName: user.userName 
            };
            
        } catch (error) {
            console.error('Error adjusting user balance:', error);
            return { success: false, error: error.message };
        }
    },
    
    // Admin: Force player reconnection
    forcePlayerReconnect: function(userId) {
        const player = this.kenoPlayers.get(userId);
        if (!player) {
            return { success: false, message: 'Player not found' };
        }
        
        // Remove from disconnected players
        this.disconnectedPlayers.delete(userId);
        
        // Clear reconnect token and attempts
        this.playerReconnectTokens.delete(userId);
        this.playerReconnectAttempts.delete(userId);
        
        console.log(`🔄 Admin forced reconnection cleanup for player ${player.userName}`);
        
        return { success: true, message: `Reconnection state cleared for ${player.userName}` };
    },
    
    // Get disconnected players for admin
    getDisconnectedPlayers: function() {
        const disconnected = [];
        for (const [userId, disconnectTime] of this.disconnectedPlayers) {
            const player = this.kenoPlayers.get(userId);
            if (player) {
                disconnected.push({
                    userId: player.userId,
                    userName: player.userName,
                    disconnectTime: new Date(disconnectTime).toISOString(),
                    timeAgo: Math.floor((Date.now() - disconnectTime) / 1000) + ' seconds',
                    balance: player.balance,
                    hasPendingSelections: (player.pendingSelections && player.pendingSelections.length > 0) || false,
                    pendingSelectionsCount: player.pendingSelections?.length || 0,
                    reconnectAttempts: this.playerReconnectAttempts.get(userId) || 0
                });
            }
        }
        
        return disconnected;
    },
    
    // Clear all reconnection data for a player
    clearPlayerReconnectionData: function(userId) {
        this.disconnectedPlayers.delete(userId);
        this.playerReconnectTokens.delete(userId);
        this.playerReconnectAttempts.delete(userId);
        
        const player = this.kenoPlayers.get(userId);
        if (player) {
            player.pendingSelections = [];
            player.pendingBet = null;
            this.kenoPlayers.set(userId, player);
        }
        
        return { success: true, message: `Reconnection data cleared for ${userId}` };
    }
};
