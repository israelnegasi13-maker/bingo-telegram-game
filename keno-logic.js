// keno-logic.js - KENO GAME LOGIC MODULE WITH MAX WIN CAP 300 ETB (HARD CAP)
// ========== MODIFIED: max win = 300, if raw win >=300 → pay exactly 300 ==========
// ========== ADDED: fairness threshold – if total possible payout < 300 ETB, use purely random draw ==========
// ========== FIXES: round transition, draw safety timer, countdown stall detection, collision prevention, safe reset ==========

module.exports = {
    // Game configuration - same as original
    CONFIG: {
        KENO_GAME_TIMER: 30, // seconds between rounds
        KENO_MIN_BET: 5,     // Minimum bet amount
        KENO_MAX_BET: 100,   // Maximum bet amount
        KENO_MIN_SELECTIONS: 1,  // Minimum numbers to select
        KENO_MAX_SELECTIONS: 5,  // Maximum numbers to select
        KENO_TOTAL_NUMBERS: 80,
        KENO_DRAW_COUNT: 20,
        NUMBER_POP_INTERVAL: 3000, // 3 seconds between number pops
        // PAYOUT TABLE (unchanged) – but we will cap actual winnings
        PAYOUT_TABLE: {
            1: {1: 3, 0: 0},                     // Pick 1: Match 1 = 3x
            2: {2: 10, 1: 0, 0: 0},             // Pick 2: Match 2 = 10x
            3: {3: 20, 2: 2, 1: 0, 0: 0},       // Pick 3: Match 3 = 20x, Match 2 = 2x
            4: {4: 60, 3: 2, 2: 1, 1: 0, 0: 0}, // Pick 4: Match 4 = 60x, Match 3 = 2x, Match 2 = 1x
            5: {5: 200, 4: 50, 3: 20, 2: 1, 1: 0, 0: 0} // Pick 5: Match 5 = 200x, Match 4 = 50x, Match 3 = 20x, Match 2 = 1x
        },
        COMMISSION_PERCENTAGE: 0, // profit built into odds
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

    // ==================== PROFIT CONTROL + MAX WIN CAP + FAIRNESS THRESHOLD ====================
    PROFIT_CONTROL: {
        ENABLED: true,
        SIMULATION_COUNT: 1000,
        TARGET_HOUSE_KEEP_PERCENTAGE: 70,      // Aim to keep 70% (allow 30% payout)
        MIN_HOUSE_KEEP_PERCENTAGE: 50,          // Allow as low as 50% house keep
        MAX_HOUSE_KEEP_PERCENTAGE: 95,
        VARIANCE_PERCENTAGE: 5,                  // Acceptable variance
        RANDOMNESS_CHANCE: 0.05,                  // 5% random draws for plausibility
        // NEW: Maximum win per player per round (capped at 300 ETB) – hard cap
        MAX_WIN_PER_PLAYER: 300,
        // NEW: Fairness threshold – if total possible payout for round < this value, draw is purely random
        FAIRNESS_THRESHOLD: 300,                   // ETB
        // Player‑unfriendly pattern settings (disabled)
        PATTERN_AVOIDANCE: {
            ENABLED: false,
            MAX_CONSECUTIVE_HIGH_PROFIT: 10,
            AVOID_REPEATING_NUMBERS: false,
            NUMBER_COOLDOWN: 0,
            NUMBER_FREQUENCY_CAP: 1.0,
            DIVERSITY_REQUIREMENT: 0,
        },
        // Dynamic adjustment – now tuned to allow small wins
        DYNAMIC_ADJUSTMENT: {
            ENABLED: true,
            LOW_PLAYER_ADJUSTMENT: 1.02,          // Slightly increase house keep when few players
            HIGH_BET_ADJUSTMENT: 1.01,             // Slightly increase house keep on big bets
            LOW_SELECTION_ADJUSTMENT: 1.05,         // Adjust for 1‑number bets
            JACKPOT_PROTECTION: false,
            BALANCE_PROTECTION: true,
            NEW_PLAYER_BONUS: 1.0,
            LOSING_STREAK_BOOST: 1.0,
            MINIMUM_WIN_RATE: 0.0,
            MINIMUM_WIN_FREQUENCY: 0.0,
        }
    },

    // Initialize Keno logic
    initialize: function(io, models) {
        this.io = io;
        this.User = models.User;
        this.Transaction = models.Transaction;
        this.Stats = models.Stats;
        this.WalletTransaction = models.WalletTransaction;
        // ========== ADDED: Agent models ==========
        this.Agent = models.Agent;
        this.AgentCommission = models.AgentCommission;
        // =========================================
        
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
        this.minimumPlayers = 0; // Game runs even with zero players
        this.isRoundScheduled = false;
        this.isDrawing = false;
        this.roundTransitionTimeout = null;
        this.disconnectedPlayers = new Map();
        this.playerReconnectTokens = new Map();
        this.playerReconnectAttempts = new Map();
        
        // ========== ADDED: Countdown stall detection ==========
        this.lastCountdownUpdate = Date.now();
        
        // Player tracking for dynamic adjustments (kept but unused)
        this.playerSessionData = new Map(); // Stores player-specific data
        this.roundWinStatistics = {
            totalRounds: 0,
            roundsWithWinners: 0,
            playerWins: 0,
            playerBets: 0
        };
        
        // Profit Control System Tracking (simplified)
        this.profitControlHistory = [];
        this.consecutiveHighProfitRounds = 0;
        this.recentNumbersFrequency = new Map();
        this.lastSelectedNumbers = [];
        
        console.log('✅ Keno game logic initialized - MAX WIN CAP 300 ETB (HARD CAP)');
        console.log('🎰 UPDATED payout table loaded:');
        console.log('   5 Numbers: 5 hits = 200x, 4 hits = 50x, 3 hits = 20x, 2 hits = 1x');
        console.log('   4 Numbers: 4 hits = 60x, 3 hits = 2x, 2 hits = 1x');
        console.log('   3 Numbers: 3 hits = 20x, 2 hits = 2x');
        console.log('   2 Numbers: 2 hits = 10x');
        console.log('   1 Number:  1 hit = 3x');
        console.log('💰 House target: 70% profit, max win per player: 300 ETB');
        console.log('🎰 If raw win ≥300 ETB → payout capped at 300 ETB (no random amount)');
        console.log('🎯 RANDOMNESS: 5% truly random draws');
        console.log(`🎲 FAIRNESS THRESHOLD: if total possible payout < ${this.PROFIT_CONTROL.FAIRNESS_THRESHOLD} ETB, draw is purely random`);
        console.log('👑 Agent commission: 10% on Keno wins');
        
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
        
        // Start game if ready (will run regardless of players)
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

    // Initialize Player Tracking System (kept but unused for adjustments)
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
        
        console.log('🎯 Profit Control System (with max win cap) initialized');
        
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
            
            // ========== FIX: Only reset drawing if no bets AND no players ==========
            if (self.isDrawing && onlinePlayers === 0 && activeGame.totalBets === 0) {
                console.log('🩺 Health Check: Detected stuck drawing state with no bets, resetting...');
                self.resetStuckKenoGame();
                return;
            }
            
            // Detect stuck countdown (no update for 15 seconds)
            if (self.isKenoRoundActive && !self.isDrawing) {
                const now = Date.now();
                if (now - self.lastCountdownUpdate > 15000) { // 15 seconds without update
                    console.log('🩺 Health Check: Countdown stalled – restarting countdown');
                    if (self.kenoCountdownInterval) {
                        clearInterval(self.kenoCountdownInterval);
                        self.kenoCountdownInterval = null;
                    }
                    self.startKenoCountdown(); // restart from current value
                }
            }
            
            // Detect if countdown is stuck at 0 for more than 10 seconds while in betting state
            if (self.kenoCountdown === 0 && self.isKenoRoundActive && !self.isDrawing) {
                console.log('🩺 Health Check: Countdown stuck at 0, forcing draw...');
                clearInterval(self.kenoCountdownInterval);
                self.kenoCountdownInterval = null;
                self.drawKenoNumbers();
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
        self.isRoundScheduled = false; // Clear any scheduled flag
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
        // Clear any draw safety timer
        if (activeGame.drawSafetyTimer) {
            clearTimeout(activeGame.drawSafetyTimer);
            activeGame.drawSafetyTimer = null;
        }
        
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
        
        // ========== FIX: Directly start round after reset ==========
        self.roundTransitionTimeout = setTimeout(() => {
            console.log('🎰 Starting new round after reset...');
            self.startKenoRound();
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
                        // Player tracking for dynamic adjustments (unused now)
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
                    // Send current drawn numbers if any exist (incremental during draw)
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
                    !self.isRoundScheduled) {
                    
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
                
                // Update session tracking (unused but kept)
                const sessionData = self.playerSessionData.get(socket.userId);
                if (sessionData) {
                    sessionData.totalBets++;
                    sessionData.totalWagered += bet;
                    sessionData.roundsPlayed++;
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
                    // Add player session info (unused now)
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
            processedResults: false,
            // ========== ADDED: Draw safety timer reference ==========
            drawSafetyTimer: null
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
        console.log('  disconnectedPlayers:', self.disconnectedPlayers.size);
        
        // Only start a new round if:
        if (!self.isKenoRoundActive && 
            !self.isDrawing &&
            gameStatus === 'waiting' && 
            !self.isRoundScheduled) {
            
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
            console.log('🎰 Game will start automatically next cycle.');
        }
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
        // ========== ADDED: Record update time ==========
        self.lastCountdownUpdate = Date.now();
        
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
            
            self.kenoCountdown--;
            // ========== ADDED: Update timestamp ==========
            self.lastCountdownUpdate = Date.now();
            
            // Broadcast countdown update
            self.io.to('keno').emit('keno:countdown_update', {
                countdown: self.kenoCountdown
            });
            
            // Last 5 seconds warning only
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
    
    // ==================== UNBEATABLE PROFIT CONTROL FUNCTIONS ====================
    
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
    
    // isDrawValid – always returns true (pattern avoidance disabled)
    isDrawValid: function(draw, recentDraws, recentNumbers) {
        return true;
    },
    
    // calculatePlayerOddsAdjustment – always returns 1.0 (no player bonuses)
    calculatePlayerOddsAdjustment: function(playerId, sessionData) {
        return 1.0;
    },
    
    // calculatePayoutsForDraw – unchanged but not used for selection
    calculatePayoutsForDraw: function(draw, bets) {
        let maxWin = 0;
        const betsArray = Object.values(bets).map(bet => ({
            numbers: bet.numbers,
            amount: bet.amount,
            selectionCount: bet.selectionCount || bet.numbers.length,
            playerId: bet.playerId || null,
            isNewPlayer: bet.isNewPlayer || false,
            consecutiveLosses: bet.consecutiveLosses || 0,
            sessionWagered: bet.sessionWagered || 0
        }));

        for (const bet of betsArray) {
            const matches = this.countMatches(bet.numbers, draw);
            const payoutMultiplier = this.CONFIG.PAYOUT_TABLE[bet.selectionCount]?.[matches] || 0;
            // No player adjustments
            const winAmount = bet.amount * payoutMultiplier;
            if (winAmount > maxWin) maxWin = winAmount;
        }
        return maxWin;
    },
    
    // updatePlayerSessionData – no-op (unused)
    updatePlayerSessionData: function(userId, won, winAmount, betAmount) {
        // Do nothing
    },
    
    // needsWinnersThisRound – always false
    needsWinnersThisRound: function() {
        return false;
    },
    
    // updateRoundWinStatistics – no-op
    updateRoundWinStatistics: function(hadWinners, playerWinsCount) {
        // Do nothing
    },
    
    // calculatePatternScore – returns 0
    calculatePatternScore: function(draw, recentDraws, recentNumbers) {
        return 0;
    },
    
    // updateDrawHistory – no-op
    updateDrawHistory: function(draw) {
        // Do nothing
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
        console.log(`   Any Win Exceeds Cap: ${selected.anyExceedsCap ? 'YES' : 'NO'}`);
        
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
        } else {
            this.consecutiveHighProfitRounds = 0;
        }
    },
    
    // ==================== MODIFIED SIMULATION FUNCTION ====================
    simulateAndSelectDraw: function(bets, totalBetAmount) {
        const self = this;
        const pc = self.PROFIT_CONTROL;
        const MAX_WIN = pc.MAX_WIN_PER_PLAYER;          // 300 ETB
        const FAIRNESS_THRESHOLD = pc.FAIRNESS_THRESHOLD; // 300 ETB (configurable)

        // If no bets or profit control disabled, return random draw
        if (!pc.ENABLED || Object.keys(bets).length === 0) {
            return self.generateRandomDraw();
        }

        // Calculate total maximum possible payout (if every player hit the best multiplier for their selection count)
        let maxPossiblePayout = 0;
        for (const bet of Object.values(bets)) {
            const selectionCount = bet.selectionCount || bet.numbers.length;
            const maxMatches = Math.min(selectionCount, self.CONFIG.KENO_DRAW_COUNT);
            const maxMultiplier = self.CONFIG.PAYOUT_TABLE[selectionCount]?.[maxMatches] || 0;
            maxPossiblePayout += bet.amount * maxMultiplier;
        }

        console.log(`💰 Total maximum possible payout: ${maxPossiblePayout.toFixed(2)} ETB`);

        // If total possible payout is below threshold, use purely random draw (fair mode)
        if (maxPossiblePayout < FAIRNESS_THRESHOLD) {
            console.log(`🎲 Total possible payout < ${FAIRNESS_THRESHOLD} ETB – using purely random draw (fair mode)`);
            return self.generateRandomDraw();
        }

        console.log(`🎯 Total possible payout >= ${FAIRNESS_THRESHOLD} ETB – engaging profit control to limit payouts`);

        // ----- existing profit‑control simulation (unchanged) -----
        const betsArray = Object.values(bets).map(bet => ({
            numbers: bet.numbers,
            amount: bet.amount,
            selectionCount: bet.selectionCount || bet.numbers.length,
            playerId: bet.playerId || null
        }));

        const totalPlayers = betsArray.length;
        const totalWagered = totalBetAmount;

        // Adjust target house keep dynamically
        let targetHouseKeep = pc.TARGET_HOUSE_KEEP_PERCENTAGE;
        if (pc.DYNAMIC_ADJUSTMENT.ENABLED) {
            if (totalPlayers < 3) {
                targetHouseKeep *= pc.DYNAMIC_ADJUSTMENT.LOW_PLAYER_ADJUSTMENT;
            }
            const avgSelection = betsArray.reduce((sum, b) => sum + b.selectionCount, 0) / totalPlayers;
            if (avgSelection <= 2.0) {
                targetHouseKeep *= pc.DYNAMIC_ADJUSTMENT.LOW_SELECTION_ADJUSTMENT;
            }
            if (betsArray.some(b => b.amount >= 50)) {
                targetHouseKeep *= pc.DYNAMIC_ADJUSTMENT.HIGH_BET_ADJUSTMENT;
            }
        }
        targetHouseKeep = Math.max(pc.MIN_HOUSE_KEEP_PERCENTAGE, Math.min(pc.MAX_HOUSE_KEEP_PERCENTAGE, targetHouseKeep));
        const targetPayout = totalWagered * ((100 - targetHouseKeep) / 100);
        const variance = totalWagered * (pc.VARIANCE_PERCENTAGE / 100);

        console.log(`🎯 Target house keep: ${targetHouseKeep.toFixed(1)}%, target payout: ${targetPayout.toFixed(2)} ETB`);

        const simulations = [];
        const startTime = Date.now();

        for (let i = 0; i < pc.SIMULATION_COUNT; i++) {
            const candidateDraw = self.generateRandomDraw();

            let totalPayout = 0;
            let playerPayouts = [];
            let maxIndividualWin = 0;
            let bigWinsCount = 0;
            let winnerCount = 0;
            let anyExceedsCap = false;

            for (const bet of betsArray) {
                const matches = self.countMatches(bet.numbers, candidateDraw);
                const payoutMultiplier = self.CONFIG.PAYOUT_TABLE[bet.selectionCount]?.[matches] || 0;
                let winAmount = bet.amount * payoutMultiplier;

                if (winAmount > MAX_WIN) {
                    anyExceedsCap = true;
                }

                totalPayout += winAmount;

                if (winAmount > 0) {
                    winnerCount++;
                    playerPayouts.push({
                        playerId: bet.playerId,
                        winAmount,
                        betAmount: bet.amount,
                        matches,
                        selectionCount: bet.selectionCount
                    });
                    if (winAmount > bet.amount * 10) bigWinsCount++;
                    if (winAmount > maxIndividualWin) maxIndividualWin = winAmount;
                }
            }

            const houseKeep = totalWagered - totalPayout;
            const houseKeepPercentage = (houseKeep / totalWagered) * 100;

            let score = totalPayout;
            if (anyExceedsCap) score += totalPayout * 10000;          // huge penalty for exceeding cap
            score += winnerCount * 1000;                               // penalize too many winners
            if (totalPayout > targetPayout + variance) {
                score += (totalPayout - targetPayout) * 500;          // penalty for exceeding target
            }
            if (Math.abs(totalPayout - targetPayout) <= variance) {
                score *= 0.9;                                          // bonus for being within target
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
                winnerCount,
                anyExceedsCap
            });
        }

        const simulationTime = Date.now() - startTime;
        console.log(`🎯 Simulated ${simulations.length} draws in ${simulationTime}ms`);

        // Random chance for a truly random draw
        if (Math.random() < pc.RANDOMNESS_CHANCE) {
            console.log(`🎯 RANDOM MODE (${pc.RANDOMNESS_CHANCE*100}% chance): Picking truly random draw (may exceed cap)`);
            const randomIndex = Math.floor(Math.random() * simulations.length);
            const selected = simulations[randomIndex];
            self.logProfitControlResults(selected, totalWagered, 'RANDOM');
            return selected.draw;
        }

        // Sort by score (lower is better) and pick from top 15
        simulations.sort((a, b) => a.score - b.score);
        const topCandidates = simulations.slice(0, 15);
        const selected = topCandidates[Math.floor(Math.random() * topCandidates.length)];

        self.logProfitControlResults(selected, totalWagered, 'CAPPED');
        return selected.draw;
    },
    
    // Draw Keno numbers – now always uses profit‑controlled draw (except 5% random)
    drawKenoNumbers: async function() {
        const self = this;
        const activeGame = self.getActiveKenoGame();
        
        if (!activeGame || activeGame.status !== 'betting') return;
        
        console.log('🎰 Drawing Keno numbers with MAX WIN CAP (300 ETB)...');
        
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
            // Generate the draw using PROFIT CONTROL with cap
            let fullDraw;
            if (activeGame.totalBets > 0 && self.PROFIT_CONTROL.ENABLED) {
                fullDraw = self.simulateAndSelectDraw(activeGame.bets, activeGame.totalBetAmount);
                console.log('🎯 Using profit‑controlled draw with max win cap.');
            } else {
                fullDraw = self.generateRandomDraw();
                console.log('🎲 Profit control disabled or no bets – using random draw');
            }
            
            // Store the full draw for later use
            activeGame.fullDrawnNumbers = fullDraw; // optional, for completeness
            // Initialize incremental drawn numbers
            activeGame.drawnNumbers = [];
            
            console.log(`🎰 Numbers to draw (random order): ${fullDraw.join(', ')}`);
            
            // ========== ADDED: Draw safety timeout ==========
            const totalDrawTime = (fullDraw.length * self.CONFIG.NUMBER_POP_INTERVAL) + 3000; // 3s extra
            const safetyTimer = setTimeout(() => {
                if (!activeGame.drawComplete && self.isDrawing) {
                    console.log('⚠️ Draw safety timeout – forcing completion');
                    // Force final results
                    const sortedForDisplay = [...fullDraw].sort((a, b) => a - b);
                    activeGame.drawnNumbers = sortedForDisplay;
                    activeGame.drawComplete = true;
                    activeGame.status = 'completed';
                    self.isDrawing = false;
                    
                    self.io.to('keno').emit('keno:round_results', {
                        round: activeGame.roundNumber,
                        drawnNumbers: sortedForDisplay,
                        originalOrder: fullDraw,
                        playersCount: activeGame.players.length,
                        totalBets: activeGame.totalBets,
                        message: `Round ${activeGame.roundNumber} results!`,
                        totalDrawn: sortedForDisplay.length,
                        isDrawComplete: true,
                        wasRandomOrder: true
                    });
                    
                    // Process results
                    self.processKenoResults(activeGame);
                }
            }, totalDrawTime + 5000); // 5 seconds after expected end
            
            activeGame.drawSafetyTimer = safetyTimer;
            
            // Draw numbers one by one in RANDOM ORDER
            for (let i = 0; i < fullDraw.length; i++) {
                setTimeout(() => {
                    const number = fullDraw[i];
                    // Append to the incremental array
                    activeGame.drawnNumbers.push(number);
                    
                    self.io.to('keno').emit('keno:number_drawn', {
                        number: number,
                        index: i,
                        total: fullDraw.length,
                        drawnCount: activeGame.drawnNumbers.length,
                        round: activeGame.roundNumber,
                        isRandomOrder: true
                    });
                }, i * self.CONFIG.NUMBER_POP_INTERVAL);
            }
            
            // After all numbers are drawn, send complete results IN SORTED ORDER for display
            setTimeout(() => {
                const sortedForDisplay = [...fullDraw].sort((a, b) => a - b);
                
                // Clear safety timer if it's still pending
                if (activeGame.drawSafetyTimer) {
                    clearTimeout(activeGame.drawSafetyTimer);
                    activeGame.drawSafetyTimer = null;
                }
                
                // Replace drawnNumbers with the final sorted list
                activeGame.drawnNumbers = sortedForDisplay;
                activeGame.drawComplete = true;
                activeGame.status = 'completed';
                self.isDrawing = false;
                
                self.io.to('keno').emit('keno:round_results', {
                    round: activeGame.roundNumber,
                    drawnNumbers: sortedForDisplay,
                    originalOrder: fullDraw,
                    playersCount: activeGame.players.length,
                    totalBets: activeGame.totalBets,
                    message: `Round ${activeGame.roundNumber} results!`,
                    totalDrawn: sortedForDisplay.length,
                    isDrawComplete: true,
                    wasRandomOrder: true
                });
                
                // Process results after numbers are shown
                setTimeout(async () => {
                    await self.processKenoResults(activeGame);
                }, 1000);
                
            }, (fullDraw.length * self.CONFIG.NUMBER_POP_INTERVAL) + 1000);
            
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
    
    // ==================== MODIFIED RESULTS PROCESSING (HARD CAP 300) ====================
    // ========== FIX: prevent duplicate round scheduling by setting isRoundScheduled = true ==========
    processKenoResults: async function(activeGame) {
        const self = this;
        const MAX_WIN = self.PROFIT_CONTROL.MAX_WIN_PER_PLAYER; // 300 ETB

        console.log('🎰 Processing Keno results with max win cap 300 (hard cap)...');

        // === ADD: prevent startGameIfReady from interfering during result processing ===
        self.isRoundScheduled = true;

        try {
            // Clear any existing timeout
            if (self.roundTransitionTimeout) {
                clearTimeout(self.roundTransitionTimeout);
                self.roundTransitionTimeout = null;
            }

            let totalWinners = 0;

            // Calculate winnings for each player
            for (const [playerId, bet] of Object.entries(activeGame.bets)) {
                try {
                    const matches = bet.numbers.filter(num => 
                        activeGame.drawnNumbers.includes(num)
                    ).length;

                    let rawWinnings = 0;
                    const selectionCount = bet.selectionCount || bet.numbers.length;

                    if (self.CONFIG.PAYOUT_TABLE[selectionCount]) {
                        const payout = self.CONFIG.PAYOUT_TABLE[selectionCount][matches];
                        if (payout !== undefined && payout > 0) {
                            rawWinnings = bet.amount * payout;
                        }
                    }

                    let finalWinnings = 0;
                    if (rawWinnings > 0) {
                        if (rawWinnings < MAX_WIN) {
                            finalWinnings = rawWinnings;
                            console.log(`💰 ${bet.userName} wins ${finalWinnings} ETB (raw ${rawWinnings})`);
                        } else {
                            // ========== HARD CAP: if raw win >= 300, pay exactly 300 ==========
                            finalWinnings = MAX_WIN;
                            console.log(`💰 ${bet.userName} hits max cap! Raw ${rawWinnings} → capped at ${finalWinnings} ETB`);
                        }
                    }

                    if (finalWinnings > 0) {
                        totalWinners++;

                        // Update user balance
                        const user = await self.User.findOne({ userId: playerId });
                        if (user) {
                            user.balance += finalWinnings;
                            user.totalWins += finalWinnings;
                            user.kenoWins = (user.kenoWins || 0) + 1;
                            await user.save();

                            // Agent commission (10%)
                            if (user.agentId) {
                                const commissionRate = 10;
                                const commissionAmount = finalWinnings * commissionRate / 100;
                                const transactionKey = `KENO_${activeGame.roundNumber}_${playerId}`;

                                try {
                                    await self.AgentCommission.create({
                                        agentId: user.agentId,
                                        userId: playerId,
                                        transactionKey: transactionKey,
                                        userName: user.userName,
                                        gameType: 'KENO',
                                        stake: bet.amount,
                                        winningAmount: finalWinnings,
                                        commissionRate: commissionRate,
                                        commissionAmount: commissionAmount,
                                        status: 'completed'
                                    });
                                    await self.Agent.findByIdAndUpdate(
                                        user.agentId,
                                        { $inc: { totalEarnings: commissionAmount } }
                                    );
                                    console.log(`👑 Agent commission: ${commissionAmount} ETB`);
                                } catch (err) {
                                    if (err.code !== 11000) console.error('Agent commission error:', err);
                                }
                            }

                            // Create win transaction
                            const transaction = new self.Transaction({
                                type: 'KENO_WIN',
                                userId: playerId,
                                userName: user.userName,
                                amount: finalWinnings,
                                description: `Keno win: ${finalWinnings} ETB (bet ${bet.amount} ETB, matched ${matches}/${selectionCount})`,
                                game: 'keno',
                                status: 'completed',
                                details: {
                                    numbers: bet.numbers,
                                    drawnNumbers: activeGame.drawnNumbers,
                                    matches: matches,
                                    selectionCount: selectionCount,
                                    round: activeGame.roundNumber,
                                    payoutMultiplier: finalWinnings / bet.amount,
                                    rawWinnings: rawWinnings
                                }
                            });
                            await transaction.save();

                            activeGame.winners.push({
                                playerId: playerId,
                                playerName: user.userName,
                                betAmount: bet.amount,
                                numbers: bet.numbers,
                                selectionCount: selectionCount,
                                matches: matches,
                                winnings: finalWinnings,
                                payoutMultiplier: finalWinnings / bet.amount
                            });
                            activeGame.totalPayout += finalWinnings;

                            // Update player state
                            const player = self.kenoPlayers.get(playerId);
                            if (player) {
                                player.balance = user.balance;
                                player.totalWins += finalWinnings;
                                player.hasPlacedBet = false;
                                player.currentBet = null;
                                if (!player.isReadyForNextRound) player.selectedNumbers = [];
                                player.pendingSelections = [];
                                player.pendingBet = null;
                                self.kenoPlayers.set(playerId, player);
                            }

                            self.updatePlayerSessionData(playerId, true, finalWinnings, bet.amount);

                            const playerSocket = self.getKenoSocketByUserId(playerId);
                            if (playerSocket) {
                                playerSocket.emit('keno:round_result', {
                                    round: activeGame.roundNumber,
                                    drawnNumbers: activeGame.drawnNumbers,
                                    yourNumbers: bet.numbers,
                                    selectionCount: selectionCount,
                                    matches: matches,
                                    winnings: finalWinnings,
                                    newBalance: user.balance,
                                    bet: bet.amount,
                                    message: rawWinnings >= MAX_WIN
                                        ? `🎲 Max win! You won ${finalWinnings} ETB (capped)`
                                        : `You won ${finalWinnings} ETB! Matched ${matches} of ${selectionCount} numbers.`
                                });
                            }

                            console.log(`🎰 Winner: ${user.userName} won ${finalWinnings} ETB (raw ${rawWinnings})`);
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

                        const player = self.kenoPlayers.get(playerId);
                        if (player) {
                            player.hasPlacedBet = false;
                            player.currentBet = null;
                            if (!player.isReadyForNextRound) player.selectedNumbers = [];
                            player.pendingSelections = [];
                            player.pendingBet = null;
                            self.kenoPlayers.set(playerId, player);
                        }

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
            
            // ========== FIX: Schedule next round directly (bypass flag) ==========
            self.roundTransitionTimeout = setTimeout(() => {
                // Reset game state for next round
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
                // Clear any draw safety timer
                if (activeGame.drawSafetyTimer) {
                    clearTimeout(activeGame.drawSafetyTimer);
                    activeGame.drawSafetyTimer = null;
                }

                console.log('🎰 Starting next round in 5 seconds...');

                // Clear any existing timeout
                if (self.roundTransitionTimeout) {
                    clearTimeout(self.roundTransitionTimeout);
                    self.roundTransitionTimeout = null;
                }

                // Schedule the next round directly
                self.roundTransitionTimeout = setTimeout(() => {
                    console.log('🎰 Starting next round now...');
                    self.startKenoRound(); // Direct call – no flag check needed
                }, 5000);

            }, 3000); // 3 seconds to show results, then 5 seconds to next round

        } catch (error) {
            console.error('Error in processKenoResults:', error);
            // If an error occurred, release the scheduling block so that the game can recover
            self.isRoundScheduled = false;
            // Attempt to start a new round after a delay
            setTimeout(() => {
                if (!self.isKenoRoundActive && !self.isDrawing) {
                    self.startGameIfReady();
                }
            }, 5000);
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
                processedResults: false,
                drawSafetyTimer: null
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
        
        // Start first round automatically (even with no players)
        setTimeout(() => {
            self.startGameIfReady();
        }, 5000);
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
        
        // Calculate player win rates (unused)
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
                // Session tracking data (unused)
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
            console.log('🎰 No players online but round continues automatically.');
        } else if (onlinePlayers >= this.minimumPlayers && 
                   !this.isKenoRoundActive && 
                   !this.isDrawing &&
                   gameStatus === 'waiting' && 
                   !this.isRoundScheduled) {
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
        
        console.log(`🎯 Profit Control System ${enabled ? 'ENABLED' : 'DISABLED'}`);
        
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
