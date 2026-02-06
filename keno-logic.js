// keno-logic.js - KENO GAME LOGIC MODULE WITH BALANCED PROFIT CONTROL
module.exports = {
    // Game configuration - UPDATED for better player experience
    CONFIG: {
        KENO_GAME_TIMER: 30, // seconds between rounds
        KENO_MIN_BET: 5,     // Minimum bet amount
        KENO_MAX_BET: 100,   // Maximum bet amount
        KENO_MIN_SELECTIONS: 1,  // Minimum numbers to select
        KENO_MAX_SELECTIONS: 5,  // Maximum numbers to select
        KENO_TOTAL_NUMBERS: 80,
        KENO_DRAW_COUNT: 20,
        NUMBER_POP_INTERVAL: 3000, // 3 seconds between number pops
        // UPDATED PAYOUT TABLE - More player-friendly:
        PAYOUT_TABLE: {
            1: {1: 3, 0: 0},                     // Pick 1: Match 1 = 3x
            2: {2: 10, 1: 0, 0: 0},             // Pick 2: Match 2 = 10x
            3: {3: 20, 2: 2, 1: 0, 0: 0},       // Pick 3: Match 3 = 20x (↑), Match 2 = 2x (↑)
            4: {4: 60, 3: 2, 2: 1, 1: 0, 0: 0}, // Pick 4: Match 4 = 60x (↑), Match 3 = 2x, Match 2 = 1x
            5: {5: 200, 4: 50, 3: 20, 2: 1, 1: 0, 0: 0} // Pick 5: Match 5 = 200x, Match 4 = 50x, Match 3 = 20x (↑), Match 2 = 1x
        },
        COMMISSION_PERCENTAGE: 0, // Reduced from 5% to 0% - profit is built into odds
        ALLOW_PRE_SELECTION: true,
        // Wallet settings
        MIN_DEPOSIT: 100,
        MAX_DEPOSIT: 10000,
        MIN_WITHDRAWAL: 100,
        WITHDRAWAL_FEE_PERCENTAGE: 5,
        ALLOWED_BETS: [5, 10, 20, 50, 100],
        // Reconnection settings
        RECONNECT_TIMEOUT: 30000,
        AUTO_RECONNECT: true,
        MAX_RECONNECT_ATTEMPTS: 3,
        RECONNECT_BACKOFF: 2000,
    },

    // ==================== BALANCED PROFIT CONTROL SYSTEM ====================
    PROFIT_CONTROL: {
        ENABLED: true,
        SIMULATION_COUNT: 1000,
        TARGET_HOUSE_KEEP_PERCENTAGE: 25, // House keeps 25% of all bets (pays out 75%)
        MIN_HOUSE_KEEP_PERCENTAGE: 15,    // Minimum house keep percentage
        MAX_HOUSE_KEEP_PERCENTAGE: 35,    // Maximum house keep percentage
        VARIANCE_PERCENTAGE: 15,          // Allow 15% variance in target
        RANDOMNESS_CHANCE: 0.20,          // 20% chance to pick truly random draw (more fair)
        // Player-friendly patterns
        PATTERN_AVOIDANCE: {
            ENABLED: true,
            MAX_CONSECUTIVE_HIGH_PROFIT: 2,
            AVOID_REPEATING_NUMBERS: true,
            NUMBER_COOLDOWN: 2,           // Reduced from 3 to 2 (more number variety)
            NUMBER_FREQUENCY_CAP: 0.30,   // Increased from 0.25 to 0.30
            DIVERSITY_REQUIREMENT: 12,    // Reduced from 15 to 12
        },
        // Dynamic adjustment based on game conditions
        DYNAMIC_ADJUSTMENT: {
            ENABLED: true,
            LOW_PLAYER_ADJUSTMENT: 1.05,  // Reduced from 1.1 to 1.05 (only 5% more profit when <3 players)
            HIGH_BET_ADJUSTMENT: 0.95,    // 5% less profit when big bets detected
            JACKPOT_PROTECTION: true,
            BALANCE_PROTECTION: true,
            // NEW: Player retention features
            NEW_PLAYER_BONUS: 0.90,       // New players get 10% better odds for first 5 rounds
            LOSING_STREAK_BOOST: 0.85,    // Players on losing streak get 15% better odds
            MINIMUM_WIN_RATE: 0.40,       // At least 40% of players should win something each round
            MINIMUM_WIN_FREQUENCY: 0.70,  // At least 70% of rounds should have winners
        }
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
        this.disconnectedPlayers = new Map();
        this.playerReconnectTokens = new Map();
        this.playerReconnectAttempts = new Map();
        
        // Player tracking for dynamic adjustments
        this.playerSessionData = new Map(); // Stores player-specific data
        this.roundWinStatistics = {
            totalRounds: 0,
            roundsWithWinners: 0,
            playerWins: 0,
            playerBets: 0
        };
        
        // Profit Control System Tracking
        this.profitControlHistory = [];
        this.consecutiveHighProfitRounds = 0;
        this.recentNumbersFrequency = new Map();
        this.lastSelectedNumbers = [];
        
        console.log('✅ Keno game logic initialized - Balanced Profit Control');
        console.log('🎰 UPDATED payout table loaded:');
        console.log('   5 Numbers: 5 hits = 200x, 4 hits = 50x, 3 hits = 20x, 2 hits = 1x');
        console.log('   4 Numbers: 4 hits = 60x, 3 hits = 2x, 2 hits = 1x');
        console.log('   3 Numbers: 3 hits = 20x, 2 hits = 2x');
        console.log('   2 Numbers: 2 hits = 10x');
        console.log('   1 Number:  1 hit = 3x');
        console.log('💰 House target: 25% profit (balanced for player retention)');
        console.log('🎯 RANDOMNESS: 20% truly random draws');
        
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
        
        // Start game if we have players
        this.startGameIfReady();
        
        // Start health check system
        this.startGameHealthCheck();
        
        // Start reconnection cleanup
        this.startReconnectionCleanup();
        
        // Initialize profit control tracking
        this.initializeProfitControl();
        
        // Initialize player session tracking
        this.initializePlayerTracking();
    },

    // Initialize Player Tracking System
    initializePlayerTracking: function() {
        const self = this;
        
        // Reset player session data every hour
        setInterval(() => {
            const now = Date.now();
            const oneHourAgo = now - 3600000;
            
            for (const [userId, data] of self.playerSessionData) {
                if (data.sessionStart < oneHourAgo) {
                    // Archive old session data
                    if (data.totalBets > 0) {
                        console.log(`📊 Session ended for ${userId}: ${data.totalBets} bets, ${data.totalWins} wins, RTP: ${((data.totalWins / data.totalWagered) * 100).toFixed(1)}%`);
                    }
                    self.playerSessionData.delete(userId);
                }
            }
        }, 300000); // Check every 5 minutes
    },

    // Initialize Profit Control System
    initializeProfitControl: function() {
        const self = this;
        
        // Reset tracking
        this.profitControlHistory = [];
        this.consecutiveHighProfitRounds = 0;
        this.recentNumbersFrequency.clear();
        this.lastSelectedNumbers = [];
        
        console.log('🎯 Balanced Profit Control System initialized');
        
        // Clean up old profit history every hour
        setInterval(() => {
            const twentyFourHoursAgo = Date.now() - 24 * 60 * 60 * 1000;
            self.profitControlHistory = self.profitControlHistory.filter(
                h => h.timestamp > twentyFourHoursAgo
            );
        }, 3600000);
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
        }, 60000);
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
                const timeElapsed = (now - gameStartTime) / 1000;
                
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
        }, 30000);
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

    // Handle Keno socket connection
    handleKenoConnection: function(socket) {
        const self = this;
        
        console.log(`🎰 Keno connection: ${socket.id}`);
        
        // Store socket for keno
        self.kenoSockets.set(socket.id, socket);
        
        // Handle ping/pong for connection health
        socket.on('ping', (data) => {
            socket.emit('pong', { timestamp: data?.timestamp || Date.now() });
        });
        
        // Keno authentication with reconnection support
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
                        // Player tracking for dynamic adjustments
                        sessionBets: 0,
                        sessionWins: 0,
                        sessionWagered: 0,
                        consecutiveLosses: 0,
                        lastWinRound: 0,
                        isNewPlayer: true,
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
                
                // Initialize player session data if not exists
                if (!self.playerSessionData.has(userId)) {
                    self.playerSessionData.set(userId, {
                        userId: userId,
                        userName: userName,
                        sessionStart: new Date(),
                        totalBets: 0,
                        totalWins: 0,
                        totalWagered: 0,
                        firstDeposit: user.firstDeposit || null,
                        isNewPlayer: true,
                        roundsPlayed: 0,
                        winStreak: 0,
                        loseStreak: 0,
                        lastWinAmount: 0
                    });
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
                
                // Prepare welcome data
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
        
        // Place bet in Keno
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
                player.isNewInCurrentRound = false;
                player.pendingSelections = [];
                player.pendingBet = null;
                
                // Update session tracking
                const sessionData = self.playerSessionData.get(socket.userId);
                if (sessionData) {
                    sessionData.totalBets++;
                    sessionData.totalWagered += bet;
                    sessionData.roundsPlayed++;
                    if (sessionData.isNewPlayer && sessionData.totalBets <= 5) {
                        console.log(`🎁 New player bonus active for ${player.userName} (bet ${sessionData.totalBets}/5)`);
                    }
                }
                
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
                    selectionCount: sortedNumbers.length,
                    placedAt: new Date(),
                    userName: player.userName,
                    potentialWinnings: potentialWinnings,
                    playerSocketId: socket.id,
                    playerId: socket.userId,
                    // Add player session info for dynamic adjustments
                    isNewPlayer: sessionData?.isNewPlayer || false,
                    consecutiveLosses: player.consecutiveLosses || 0,
                    sessionWagered: sessionData?.totalWagered || 0
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
                self.roundWinStatistics.playerBets++;
                
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
        
        // Process deposit (Admin only)
        socket.on('wallet:processDeposit', async (data) => {
            try {
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
                    user.balance += transaction.amount;
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
    
    // Handle Keno disconnection
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
                if (self.isKenoRoundActive && 
                    !player.hasPlacedBet && 
                    player.selectedNumbers.length > 0) {
                    player.pendingSelections = [...player.selectedNumbers];
                    player.pendingBet = player.currentBet;
                    console.log(`💾 Saved pending selections for ${player.userName}: ${player.selectedNumbers.length} numbers`);
                }
                
                self.kenoPlayers.set(socket.userId, player);
                
                // Add to disconnected players map for reconnection tracking
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
        
        // Check if round is active but no players with bets
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
        
        // Clear any existing timeout and intervals FIRST
        if (self.roundTransitionTimeout) {
            clearTimeout(self.roundTransitionTimeout);
            self.roundTransitionTimeout = null;
        }
        
        // Clear countdown interval if exists
        if (self.kenoCountdownInterval) {
            clearInterval(self.kenoCountdownInterval);
            self.kenoCountdownInterval = null;
        }
        
        // Check if we actually have online players
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
            
            // Reset countdown
            self.kenoCountdown = self.CONFIG.KENO_GAME_TIMER;
            return;
        }
        
        console.log('🎰 Starting new Keno round...');
        
        // Set states BEFORE creating any timers
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
        
        // Broadcast round start with updated countdown
        self.io.to('keno').emit('keno:round_start', {
            round: activeGame.roundNumber,
            duration: self.CONFIG.KENO_GAME_TIMER,
            countdown: self.kenoCountdown,
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
        
        // Start countdown with fresh interval after a small delay
        setTimeout(() => {
            self.startKenoCountdown();
        }, 100);
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
            
            // Clear any existing countdown interval
            if (self.kenoCountdownInterval) {
                clearInterval(self.kenoCountdownInterval);
                self.kenoCountdownInterval = null;
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
        
        // Clear any existing interval FIRST
        if (self.kenoCountdownInterval) {
            clearInterval(self.kenoCountdownInterval);
            self.kenoCountdownInterval = null;
        }
        
        self.kenoCountdown = self.CONFIG.KENO_GAME_TIMER;
        
        // Broadcast initial countdown
        self.io.to('keno').emit('keno:countdown_update', {
            countdown: self.kenoCountdown
        });
        
        // Create new interval
        self.kenoCountdownInterval = setInterval(() => {
            // Check if round is still active
            if (!self.isKenoRoundActive) {
                clearInterval(self.kenoCountdownInterval);
                self.kenoCountdownInterval = null;
                return;
            }
            
            // Check if we lost all players during countdown
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
    
    // ==================== BALANCED PROFIT CONTROL FUNCTIONS ====================
    
    // Generate a random draw
    generateRandomDraw: function() {
        const draw = [];
        while (draw.length < this.CONFIG.KENO_DRAW_COUNT) {
            const num = Math.floor(Math.random() * this.CONFIG.KENO_TOTAL_NUMBERS) + 1;
            if (!draw.includes(num)) {
                draw.push(num);
            }
        }
        return draw;
    },
    
    // Check if draw is valid considering pattern avoidance
    isDrawValid: function(draw, recentDraws, recentNumbers) {
        const pc = this.PROFIT_CONTROL.PATTERN_AVOIDANCE;
        
        if (!pc.ENABLED) return true;
        
        // Check if any number is in cooldown (appeared in last N rounds)
        if (pc.AVOID_REPEATING_NUMBERS && recentDraws.length > 0) {
            const lastDraws = recentDraws.slice(0, pc.NUMBER_COOLDOWN);
            const numbersInCooldown = new Set();
            lastDraws.forEach(d => d.forEach(n => numbersInCooldown.add(n)));
            
            const overlappingNumbers = draw.filter(n => numbersInCooldown.has(n));
            if (overlappingNumbers.length > 6) {
                return false;
            }
        }
        
        // Check number frequency cap
        if (pc.NUMBER_FREQUENCY_CAP && recentNumbers.length > 0) {
            const numberCounts = new Map();
            recentNumbers.forEach(n => {
                numberCounts.set(n, (numberCounts.get(n) || 0) + 1);
            });
            
            const maxAllowed = Math.ceil(recentDraws.length * pc.NUMBER_FREQUENCY_CAP);
            for (const num of draw) {
                const count = numberCounts.get(num) || 0;
                if (count >= maxAllowed) {
                    return false;
                }
            }
        }
        
        return true;
    },
    
    // Calculate dynamic odds adjustment for a player
    calculatePlayerOddsAdjustment: function(playerId, sessionData) {
        const self = this;
        const pc = self.PROFIT_CONTROL.DYNAMIC_ADJUSTMENT;
        let adjustment = 1.0;
        
        if (!pc.ENABLED) return adjustment;
        
        const player = self.kenoPlayers.get(playerId);
        if (!player) return adjustment;
        
        // New player bonus (first 5 bets)
        if (sessionData?.isNewPlayer && sessionData.totalBets <= 5) {
            adjustment *= pc.NEW_PLAYER_BONUS; // 10% better odds
            console.log(`🎁 Applying new player bonus for ${player.userName}: ${adjustment.toFixed(2)}x odds`);
        }
        
        // Losing streak boost
        if (player.consecutiveLosses >= 3) {
            adjustment *= pc.LOSING_STREAK_BOOST; // 15% better odds
            console.log(`🎁 Applying losing streak boost for ${player.userName} (${player.consecutiveLosses} losses): ${adjustment.toFixed(2)}x odds`);
        }
        
        // High wager bonus (wagered a lot recently)
        if (sessionData?.totalWagered > 1000) {
            adjustment *= 0.95; // 5% better odds for high rollers
        }
        
        return Math.max(0.7, Math.min(1.3, adjustment)); // Clamp between 0.7x and 1.3x
    },
    
    // Update player session data after round
    updatePlayerSessionData: function(userId, won, winAmount, betAmount) {
        const self = this;
        const sessionData = self.playerSessionData.get(userId);
        
        if (!sessionData) return;
        
        if (won) {
            sessionData.totalWins++;
            sessionData.lastWinAmount = winAmount;
            sessionData.winStreak++;
            sessionData.loseStreak = 0;
            
            // Mark player as no longer "new" after first win
            if (sessionData.isNewPlayer) {
                sessionData.isNewPlayer = false;
                console.log(`🎉 Player ${sessionData.userName} is no longer a new player (got first win)`);
            }
        } else {
            sessionData.winStreak = 0;
            sessionData.loseStreak++;
        }
        
        // Update consecutive losses in player object
        const player = self.kenoPlayers.get(userId);
        if (player) {
            player.consecutiveLosses = won ? 0 : (player.consecutiveLosses || 0) + 1;
            if (won) {
                player.lastWinRound = self.kenoRoundNumber;
                player.sessionWins = (player.sessionWins || 0) + 1;
            }
            player.sessionWagered += betAmount;
            self.kenoPlayers.set(userId, player);
        }
        
        self.playerSessionData.set(userId, sessionData);
    },
    
    // Check if round needs to have winners (based on minimum win rate)
    needsWinnersThisRound: function() {
        const self = this;
        const pc = self.PROFIT_CONTROL.DYNAMIC_ADJUSTMENT;
        
        if (!pc.ENABLED) return false;
        
        // Check if we're below minimum win frequency
        if (self.roundWinStatistics.totalRounds > 0) {
            const winRate = self.roundWinStatistics.roundsWithWinners / self.roundWinStatistics.totalRounds;
            if (winRate < pc.MINIMUM_WIN_FREQUENCY) {
                console.log(`🎯 Need winners this round (win frequency ${winRate.toFixed(2)} < ${pc.MINIMUM_WIN_FREQUENCY})`);
                return true;
            }
        }
        
        // Check if we're below minimum player win rate
        if (self.roundWinStatistics.playerBets > 0) {
            const playerWinRate = self.roundWinStatistics.playerWins / self.roundWinStatistics.playerBets;
            if (playerWinRate < pc.MINIMUM_WIN_RATE) {
                console.log(`🎯 Need winners this round (player win rate ${playerWinRate.toFixed(2)} < ${pc.MINIMUM_WIN_RATE})`);
                return true;
            }
        }
        
        return false;
    },
    
    // Update round win statistics
    updateRoundWinStatistics: function(hadWinners, playerWinsCount) {
        const self = this;
        
        self.roundWinStatistics.totalRounds++;
        if (hadWinners) {
            self.roundWinStatistics.roundsWithWinners++;
        }
        self.roundWinStatistics.playerWins += playerWinsCount || 0;
        
        // Reset counters every 100 rounds
        if (self.roundWinStatistics.totalRounds >= 100) {
            const winRate = self.roundWinStatistics.roundsWithWinners / self.roundWinStatistics.totalRounds;
            const playerWinRate = self.roundWinStatistics.playerWins / Math.max(1, self.roundWinStatistics.playerBets);
            
            console.log(`📊 100-round stats: Round win rate: ${(winRate * 100).toFixed(1)}%, Player win rate: ${(playerWinRate * 100).toFixed(1)}%`);
            
            // Reset for next 100 rounds
            self.roundWinStatistics = {
                totalRounds: 0,
                roundsWithWinners: 0,
                playerWins: 0,
                playerBets: 0
            };
        }
    },
    
    // Calculate pattern score for a draw (lower is better)
    calculatePatternScore: function(draw, recentDraws, recentNumbers) {
        const pc = this.PROFIT_CONTROL.PATTERN_AVOIDANCE;
        let score = 0;
        
        if (!pc.ENABLED) return score;
        
        // Penalize for numbers that appeared recently (but less penalty than before)
        if (recentDraws.length > 0) {
            const lastDraw = recentDraws[0] || [];
            const overlap = draw.filter(n => lastDraw.includes(n)).length;
            score += overlap * 5; // Reduced penalty (was 10)
        }
        
        // Check for consecutive high numbers or low numbers patterns
        const sortedDraw = [...draw].sort((a, b) => a - b);
        let consecutiveCount = 0;
        for (let i = 1; i < sortedDraw.length; i++) {
            if (sortedDraw[i] === sortedDraw[i-1] + 1) {
                consecutiveCount++;
            }
        }
        if (consecutiveCount > 4) {
            score += consecutiveCount * 3; // Reduced penalty (was 5)
        }
        
        return score;
    },
    
    // Update draw history for pattern tracking
    updateDrawHistory: function(draw) {
        const self = this;
        
        // Add to recent numbers frequency
        draw.forEach(num => {
            const count = self.recentNumbersFrequency.get(num) || 0;
            self.recentNumbersFrequency.set(num, count + 1);
        });
        
        // Keep only last 100 numbers in frequency tracking
        if (self.recentNumbersFrequency.size > 100) {
            const entries = Array.from(self.recentNumbersFrequency.entries())
                .sort((a, b) => b[1] - a[1])
                .slice(0, 100);
            self.recentNumbersFrequency = new Map(entries);
        }
        
        // Update last selected numbers
        self.lastSelectedNumbers = draw;
    },
    
    // Count matches between player numbers and drawn numbers
    countMatches: function(playerNumbers, drawnNumbers) {
        return playerNumbers.filter(num => drawnNumbers.includes(num)).length;
    },
    
    // Log profit control results
    logProfitControlResults: function(selected, totalWagered, type) {
        const houseKeepPercentage = ((totalWagered - selected.totalPayout) / totalWagered) * 100;
        const payoutPercentage = 100 - houseKeepPercentage;
        
        console.log(`🎯 PROFIT CONTROL (${type}):`);
        console.log(`   Total Wagered: ${totalWagered} ETB`);
        console.log(`   Total Payout: ${selected.totalPayout.toFixed(2)} ETB`);
        console.log(`   House Keep: ${(totalWagered - selected.totalPayout).toFixed(2)} ETB`);
        console.log(`   House Keep %: ${houseKeepPercentage.toFixed(2)}%`);
        console.log(`   Payout %: ${payoutPercentage.toFixed(2)}%`);
        console.log(`   Winners: ${selected.winnerCount} players`);
        console.log(`   Big Wins: ${selected.bigWinsCount}`);
        console.log(`   Max Individual Win: ${selected.maxIndividualWin} ETB`);
        
        // Add to history
        this.profitControlHistory.push({
            timestamp: Date.now(),
            type: type,
            totalWagered: totalWagered,
            totalPayout: selected.totalPayout,
            houseKeepPercentage: houseKeepPercentage,
            winnerCount: selected.winnerCount,
            bigWinsCount: selected.bigWinsCount,
            round: this.kenoRoundNumber
        });
        
        // Track consecutive high profit rounds
        if (houseKeepPercentage > 35) {
            this.consecutiveHighProfitRounds++;
            console.log(`⚠️  Consecutive High Profit Rounds: ${this.consecutiveHighProfitRounds}`);
            
            // If too many consecutive high profits, force a lower profit round next time
            if (this.consecutiveHighProfitRounds >= this.PROFIT_CONTROL.PATTERN_AVOIDANCE.MAX_CONSECUTIVE_HIGH_PROFIT) {
                console.log('⚠️  Too many consecutive high profit rounds, will adjust next round');
            }
        } else {
            this.consecutiveHighProfitRounds = 0;
        }
    },
    
    // Simulate multiple draws and select optimal one using balanced profit control
    simulateAndSelectDraw: function(bets, totalBetAmount) {
        const self = this;
        const pc = self.PROFIT_CONTROL;
        
        if (!pc.ENABLED || Object.keys(bets).length === 0) {
            return self.generateRandomDraw();
        }
        
        console.log('🎯 Balanced Profit Control: Simulating draws...');
        
        // Convert bets to array for easier processing
        const betsArray = Object.values(bets).map(bet => ({
            numbers: bet.numbers,
            amount: bet.amount,
            selectionCount: bet.selectionCount || bet.numbers.length,
            playerId: bet.playerId || null,
            isNewPlayer: bet.isNewPlayer || false,
            consecutiveLosses: bet.consecutiveLosses || 0,
            sessionWagered: bet.sessionWagered || 0
        }));
        
        const totalPlayers = betsArray.length;
        const totalWagered = totalBetAmount;
        
        // Dynamic target adjustment based on game conditions
        let targetHouseKeep = pc.TARGET_HOUSE_KEEP_PERCENTAGE;
        
        // Adjust based on number of players
        if (pc.DYNAMIC_ADJUSTMENT.ENABLED) {
            if (totalPlayers < 3) {
                targetHouseKeep *= pc.DYNAMIC_ADJUSTMENT.LOW_PLAYER_ADJUSTMENT;
                console.log(`🎯 Low player count (${totalPlayers}), increasing house keep to ${targetHouseKeep.toFixed(1)}%`);
            }
            
            // Check for big bets (risk management)
            const averageBet = totalWagered / totalPlayers;
            const bigBetThreshold = 50;
            const hasBigBets = betsArray.some(bet => bet.amount >= bigBetThreshold);
            
            if (hasBigBets && pc.DYNAMIC_ADJUSTMENT.JACKPOT_PROTECTION) {
                targetHouseKeep *= pc.DYNAMIC_ADJUSTMENT.HIGH_BET_ADJUSTMENT;
                console.log(`🎯 Big bets detected, reducing risk, house keep: ${targetHouseKeep.toFixed(1)}%`);
            }
            
            // If we've had too many consecutive high profit rounds, adjust down
            if (self.consecutiveHighProfitRounds >= pc.PATTERN_AVOIDANCE.MAX_CONSECUTIVE_HIGH_PROFIT) {
                targetHouseKeep *= 0.8;
                console.log(`🎯 Too many consecutive high profits, reducing target to ${targetHouseKeep.toFixed(1)}%`);
            }
            
            // Check if we need winners this round
            const needsWinners = self.needsWinnersThisRound();
            if (needsWinners) {
                targetHouseKeep *= 0.7; // Reduce house keep to increase chance of winners
                console.log(`🎯 Need winners this round, reducing target to ${targetHouseKeep.toFixed(1)}%`);
            }
        }
        
        // Clamp target between min and max
        targetHouseKeep = Math.max(pc.MIN_HOUSE_KEEP_PERCENTAGE, 
                                  Math.min(pc.MAX_HOUSE_KEEP_PERCENTAGE, targetHouseKeep));
        
        // Calculate target payout
        const targetPayout = totalWagered * ((100 - targetHouseKeep) / 100);
        const variance = totalWagered * (pc.VARIANCE_PERCENTAGE / 100);
        
        console.log(`🎯 Profit Control: Total wagered: ${totalWagered} ETB, Target payout: ${targetPayout.toFixed(2)} ETB (${(100-targetHouseKeep).toFixed(1)}%)`);
        
        // Get recent draw history for pattern avoidance
        const recentDraws = self.kenoRoundHistory.slice(0, 20).map(r => r.drawnNumbers);
        const recentNumbers = recentDraws.flat();
        
        // Simulate multiple draws
        const simulations = [];
        const startTime = Date.now();
        
        for (let i = 0; i < pc.SIMULATION_COUNT; i++) {
            // Generate random draw
            let candidateDraw;
            let isValid = false;
            let attempts = 0;
            
            while (!isValid && attempts < 100) {
                candidateDraw = self.generateRandomDraw();
                isValid = self.isDrawValid(candidateDraw, recentDraws, recentNumbers);
                attempts++;
            }
            
            if (!isValid) {
                candidateDraw = self.generateRandomDraw();
            }
            
            // Calculate total payout for this draw with player adjustments
            let totalPayout = 0;
            let playerPayouts = [];
            let maxIndividualWin = 0;
            let bigWinsCount = 0;
            let winnerCount = 0;
            
            for (const bet of betsArray) {
                const matches = self.countMatches(bet.numbers, candidateDraw);
                const payoutMultiplier = self.CONFIG.PAYOUT_TABLE[bet.selectionCount]?.[matches] || 0;
                
                // Apply player-specific odds adjustment
                const sessionData = self.playerSessionData.get(bet.playerId);
                const oddsAdjustment = self.calculatePlayerOddsAdjustment(bet.playerId, sessionData);
                const adjustedMultiplier = payoutMultiplier * oddsAdjustment;
                
                const winAmount = bet.amount * adjustedMultiplier;
                
                totalPayout += winAmount;
                
                if (winAmount > 0) {
                    winnerCount++;
                    playerPayouts.push({
                        playerId: bet.playerId,
                        winAmount,
                        betAmount: bet.amount,
                        matches,
                        selectionCount: bet.selectionCount,
                        oddsAdjustment: oddsAdjustment.toFixed(2)
                    });
                    
                    // Track big wins
                    if (winAmount > bet.amount * 10) {
                        bigWinsCount++;
                    }
                    
                    if (winAmount > maxIndividualWin) {
                        maxIndividualWin = winAmount;
                    }
                }
            }
            
            // Calculate house profit percentage
            const houseKeep = totalWagered - totalPayout;
            const houseKeepPercentage = (houseKeep / totalWagered) * 100;
            
            // Score this simulation (lower is better for matching target)
            let score = Math.abs(totalPayout - targetPayout);
            
            // Penalize if payout is too high (house loses money)
            if (totalPayout > totalWagered) {
                score += (totalPayout - totalWagered) * 5; // Reduced penalty (was 10)
            }
            
            // Penalize if too many big wins in one round
            if (bigWinsCount > 3) {
                score += bigWinsCount * 500; // Reduced penalty (was 1000)
            }
            
            // Bonus for being within variance range
            if (Math.abs(totalPayout - targetPayout) <= variance) {
                score *= 0.5;
            }
            
            // Bonus for having some winners (keeps players engaged)
            if (winnerCount === 0) {
                score += 200; // Penalize no winners (but less than before)
            } else if (winnerCount > 0 && winnerCount < totalPlayers * 0.4) {
                score *= 0.7; // Prefer some but not too many winners
            }
            
            // Pattern avoidance scoring
            if (pc.PATTERN_AVOIDANCE.ENABLED) {
                score += self.calculatePatternScore(candidateDraw, recentDraws, recentNumbers);
            }
            
            simulations.push({
                draw: candidateDraw,
                totalPayout,
                houseKeep,
                houseKeepPercentage,
                score,
                playerPayouts,
                bigWinsCount,
                maxIndividualWin,
                winnerCount
            });
        }
        
        const simulationTime = Date.now() - startTime;
        console.log(`🎯 Simulated ${simulations.length} draws in ${simulationTime}ms`);
        
        // 20% chance to pick truly random draw
        if (Math.random() < pc.RANDOMNESS_CHANCE) {
            console.log('🎯 RANDOM MODE: Picking truly random draw (20% chance)');
            const randomIndex = Math.floor(Math.random() * simulations.length);
            const selected = simulations[randomIndex];
            self.logProfitControlResults(selected, totalWagered, 'RANDOM');
            return selected.draw;
        }
        
        // Sort by score (lower is better)
        simulations.sort((a, b) => a.score - b.score);
        
        // Take top 15 candidates and pick randomly from them
        const topCandidates = simulations.slice(0, 15);
        const selected = topCandidates[Math.floor(Math.random() * topCandidates.length)];
        
        // Log results
        self.logProfitControlResults(selected, totalWagered, 'BALANCED');
        
        // Update recent draws tracking
        self.updateDrawHistory(selected.draw);
        
        // Update round win statistics
        self.updateRoundWinStatistics(selected.winnerCount > 0, selected.winnerCount);
        
        return selected.draw;
    },
    
    // Draw Keno numbers - UPDATED with Balanced Profit Control
    drawKenoNumbers: async function() {
        const self = this;
        const activeGame = self.getActiveKenoGame();
        
        if (!activeGame || activeGame.status !== 'betting') return;
        
        console.log('🎰 Drawing Keno numbers with Balanced Profit Control...');
        
        // Clear all intervals and timeouts first
        if (self.kenoCountdownInterval) {
            clearInterval(self.kenoCountdownInterval);
            self.kenoCountdownInterval = null;
        }
        
        if (self.roundTransitionTimeout) {
            clearTimeout(self.roundTransitionTimeout);
            self.roundTransitionTimeout = null;
        }
        
        // Set game status to drawing
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
            // Generate the draw using BALANCED PROFIT CONTROL
            let drawnNumbers;
            if (activeGame.totalBets > 0 && self.PROFIT_CONTROL.ENABLED) {
                drawnNumbers = self.simulateAndSelectDraw(activeGame.bets, activeGame.totalBetAmount);
            } else {
                drawnNumbers = self.generateRandomDraw();
            }
            
            // Store in original random order
            activeGame.drawnNumbersOriginalOrder = [...drawnNumbers];
            activeGame.drawnNumbers = drawnNumbers;
            
            console.log(`🎰 Numbers to draw (random order): ${drawnNumbers.join(', ')}`);
            
            // Draw numbers one by one in RANDOM ORDER
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
            
            // After all numbers are drawn, send complete results IN SORTED ORDER for display
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
    
    // Process Keno results with balanced profit control
    processKenoResults: async function(activeGame) {
        const self = this;
        
        console.log('🎰 Processing Keno results...');
        
        // Clear any existing timeout to prevent conflicts
        if (self.roundTransitionTimeout) {
            clearTimeout(self.roundTransitionTimeout);
            self.roundTransitionTimeout = null;
        }
        
        let totalWinners = 0;
        
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
                    totalWinners++;
                    
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
                            if (!player.isReadyForNextRound) {
                                player.selectedNumbers = [];
                            }
                            // Clear pending selections
                            player.pendingSelections = [];
                            player.pendingBet = null;
                            self.kenoPlayers.set(playerId, player);
                        }
                        
                        // Update player session data
                        self.updatePlayerSessionData(playerId, true, winnings, bet.amount);
                        
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
                        if (!player.isReadyForNextRound) {
                            player.selectedNumbers = [];
                        }
                        // Clear pending selections
                        player.pendingSelections = [];
                        player.pendingBet = null;
                        self.kenoPlayers.set(playerId, player);
                    }
                    
                    // Update player session data
                    self.updatePlayerSessionData(playerId, false, 0, bet.amount);
                }
            } catch (error) {
                console.error(`Error processing result for player ${playerId}:`, error);
            }
        }
        
        // Mark results as processed
        activeGame.processedResults = true;
        
        // Calculate house commission (0% now, profit built into odds)
        const totalWagered = activeGame.totalBetAmount;
        const commission = (totalWagered * self.CONFIG.COMMISSION_PERCENTAGE) / 100;
        activeGame.commissionCollected = commission;
        self.totalKenoEarnings += (totalWagered - activeGame.totalPayout); // Total profit, not just commission
        
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
            winners: totalWinners,
            timestamp: new Date(),
            averageSelectionCount: activeGame.players.length > 0 ? 
                Object.values(activeGame.bets).reduce((sum, bet) => sum + (bet.selectionCount || bet.numbers.length), 0) / activeGame.players.length : 0,
            houseProfitPercentage: ((totalWagered - activeGame.totalPayout) / totalWagered) * 100
        });
        
        // Keep only last 20 rounds in history
        if (self.kenoRoundHistory.length > 20) {
            self.kenoRoundHistory = self.kenoRoundHistory.slice(0, 20);
        }
        
        // Update database stats
        await self.updateKenoStats(totalWagered, activeGame.totalPayout, 0, 0, 1);
        
        // Increment round number
        self.kenoRoundNumber++;
        
        console.log(`🎰 Round ${activeGame.roundNumber-1} completed. Total wagered: ${totalWagered} ETB, Total payout: ${activeGame.totalPayout} ETB, House profit: ${totalWagered - activeGame.totalPayout} ETB (${((totalWagered - activeGame.totalPayout) / totalWagered * 100).toFixed(1)}%)`);
        
        // Clear all disconnected players and pending states after round completion
        self.disconnectedPlayers.clear();
        self.playerReconnectAttempts.clear();
        
        // Reset the current game to waiting state after a delay
        self.roundTransitionTimeout = setTimeout(() => {
            // Set game back to waiting state for next round
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
    
    // Update Keno stats in database
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
        
        // Calculate house profit percentage from last round
        let lastRoundProfit = 0;
        if (this.kenoRoundHistory.length > 0) {
            const lastRound = this.kenoRoundHistory[0];
            lastRoundProfit = lastRound.houseProfitPercentage || 0;
        }
        
        return {
            roundNumber: this.kenoRoundNumber,
            isRoundActive: this.isKenoRoundActive,
            isDrawing: this.isDrawing,
            countdown: this.kenoCountdown,
            playersCount: this.kenoPlayers.size,
            onlinePlayers: onlinePlayers,
            totalEarnings: this.totalKenoEarnings,
            lastRoundProfit: lastRoundProfit.toFixed(1),
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
            playerSessionData: this.playerSessionData.size,
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
        
        // Calculate average house profit from last 10 rounds
        const last10Rounds = this.kenoRoundHistory.slice(0, 10);
        const avgHouseProfit = last10Rounds.length > 0 
            ? last10Rounds.reduce((sum, r) => sum + (r.houseProfitPercentage || 0), 0) / last10Rounds.length
            : 0;
        
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
            avgHouseProfitLast10Rounds: avgHouseProfit.toFixed(1),
            roundWinStatistics: this.roundWinStatistics,
            config: this.CONFIG
        };
    },
    
    // Get Profit Control System stats
    getProfitControlStats: function() {
        const recentHistory = this.profitControlHistory.slice(0, 10);
        const averageHouseKeep = recentHistory.length > 0 ? 
            recentHistory.reduce((sum, h) => sum + h.houseKeepPercentage, 0) / recentHistory.length : 0;
        
        // Calculate player win rates
        const playerSessions = Array.from(this.playerSessionData.values());
        const activePlayers = playerSessions.filter(p => p.totalBets > 0);
        const avgPlayerWinRate = activePlayers.length > 0 
            ? (activePlayers.reduce((sum, p) => sum + (p.totalWins / Math.max(1, p.totalWagered)), 0) / activePlayers.length) * 100
            : 0;
        
        return {
            enabled: this.PROFIT_CONTROL.ENABLED,
            targetHouseKeep: this.PROFIT_CONTROL.TARGET_HOUSE_KEEP_PERCENTAGE,
            consecutiveHighProfitRounds: this.consecutiveHighProfitRounds,
            recentHistory: recentHistory,
            averageHouseKeep: averageHouseKeep.toFixed(2),
            averagePlayerWinRate: avgPlayerWinRate.toFixed(1),
            simulationCount: this.PROFIT_CONTROL.SIMULATION_COUNT,
            recentNumbersFrequency: Array.from(this.recentNumbersFrequency.entries())
                .sort((a, b) => b[1] - a[1])
                .slice(0, 10)
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
            const sessionData = this.playerSessionData.get(userId) || {};
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
                // Session tracking data
                consecutiveLosses: player.consecutiveLosses || 0,
                sessionWins: player.sessionWins || 0,
                sessionWagered: player.sessionWagered || 0,
                // Session data
                totalSessionBets: sessionData.totalBets || 0,
                totalSessionWins: sessionData.totalWins || 0,
                winRate: sessionData.totalBets > 0 ? ((sessionData.totalWins || 0) / sessionData.totalBets * 100).toFixed(1) : '0.0',
                isNewPlayer: sessionData.isNewPlayer || false,
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
                this.playerSessionData.delete(userId);
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
        
        // Detect if countdown is stuck (not changing)
        if (this.kenoCountdownInterval && this.kenoCountdown <= 0 && !this.isDrawing && this.isKenoRoundActive) {
            console.log('🎰 Stuck countdown detected, forcing draw...');
            clearInterval(this.kenoCountdownInterval);
            this.kenoCountdownInterval = null;
            this.drawKenoNumbers();
            return;
        }
        
        // Detect if game is stuck in active state with no players
        if (this.isKenoRoundActive && onlinePlayers === 0) {
            console.log('🎰 Stuck game detected: Round active but no players online');
            const hasBets = activeGame && activeGame.totalBets > 0;
            
            if (!hasBets) {
                console.log('🎰 No bets placed, resetting game...');
                this.resetStuckKenoGame();
                return;
            }
        }
        
        // Detect if countdown is stuck at zero but not progressing
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
                isOnline: player.isOnline,
                consecutiveLosses: player.consecutiveLosses || 0,
                sessionWins: player.sessionWins || 0,
                sessionWagered: player.sessionWagered || 0
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
    
    // Toggle Profit Control System (admin)
    toggleProfitControl: function(enabled) {
        this.PROFIT_CONTROL.ENABLED = enabled;
        
        console.log(`🎯 Balanced Profit Control System ${enabled ? 'ENABLED' : 'DISABLED'}`);
        
        return { 
            success: true, 
            enabled: enabled,
            message: `Profit Control System ${enabled ? 'enabled' : 'disabled'}`
        };
    },
    
    // Adjust Profit Control settings (admin)
    adjustProfitControlSettings: function(settings) {
        Object.keys(settings).forEach(key => {
            if (this.PROFIT_CONTROL[key] !== undefined) {
                this.PROFIT_CONTROL[key] = settings[key];
            }
        });
        
        console.log('🎯 Profit Control settings updated:', settings);
        
        return { 
            success: true, 
            settings: this.PROFIT_CONTROL,
            message: 'Profit Control settings updated'
        };
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
