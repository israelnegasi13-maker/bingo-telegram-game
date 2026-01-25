[file name]: keno-logic.js
[file content begin]
// keno-logic.js - KENO GAME LOGIC MODULE
module.exports = {
    // Game configuration - UPDATED
    CONFIG: {
        KENO_GAME_TIMER: 30, // 30 seconds between rounds
        KENO_MIN_BET: 5,
        KENO_MAX_BET: 100,
        KENO_MAX_SELECTIONS: 5, // Changed from 10 to 5
        KENO_TOTAL_NUMBERS: 80,
        KENO_DRAW_COUNT: 20,
        DRAW_DELAY_MS: 3000, // 3 seconds between drawn numbers
        BET_VALUES: [5, 10, 20, 50, 100], // Updated bet amounts
        PAYOUT_TABLE: {
            1: {1: 2},
            2: {2: 5},
            3: {2: 1, 3: 10},
            4: {2: 1, 3: 2, 4: 20},
            5: {3: 1, 4: 5, 5: 100}
        },
        COMMISSION_PERCENTAGE: 5, // 5% house commission
        MIN_PLAYERS: 1, // Minimum players to continue game
        AUTO_RESTART_DELAY: 10000 // 10 seconds delay before auto-restart when players join
    },

    // Initialize Keno logic
    initialize: function(io, models) {
        this.io = io;
        this.User = models.User;
        this.Transaction = models.Transaction;
        this.Stats = models.Stats;
        
        // Active Keno games state
        this.activeKenoGames = new Map();
        this.kenoPlayers = new Map();
        this.kenoSockets = new Map();
        this.kenoRoundHistory = [];
        this.kenoRoundNumber = 1;
        this.isKenoRoundActive = false;
        this.kenoCountdown = this.CONFIG.KENO_GAME_TIMER;
        this.kenoCountdownInterval = null;
        this.gamePaused = false;
        this.pauseCheckInterval = null;
        this.numberDrawInterval = null;
        this.totalKenoEarnings = 0;
        this.currentDrawIndex = 0;
        this.drawnNumbers = [];
        
        console.log('✅ Keno game logic initialized');
        
        // Load existing stats
        this.loadKenoStats();
        
        // Start pause checking
        this.startPauseCheck();
        
        // Start game server
        this.startKenoServer();
    },

    // Load Keno stats from database
    loadKenoStats: async function() {
        try {
            // Try to get today's stats
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
                    totalKenoWins: 0
                });
                await stats.save();
            }
            
            this.totalKenoEarnings = stats.totalKenoEarnings || 0;
            console.log(`📊 Keno stats loaded: ${this.totalKenoEarnings.toFixed(2)} ETB earnings`);
            
        } catch (error) {
            console.error('Error loading Keno stats:', error);
        }
    },

    // Start pause checking for empty games
    startPauseCheck: function() {
        const self = this;
        
        if (self.pauseCheckInterval) {
            clearInterval(self.pauseCheckInterval);
        }
        
        self.pauseCheckInterval = setInterval(() => {
            const onlinePlayers = Array.from(self.kenoPlayers.values()).filter(p => p.isOnline).length;
            
            // If no players and game is not already paused
            if (onlinePlayers < self.CONFIG.MIN_PLAYERS && !self.gamePaused) {
                self.pauseKenoGame();
            }
            // If players are back and game is paused
            else if (onlinePlayers >= self.CONFIG.MIN_PLAYERS && self.gamePaused) {
                self.resumeKenoGame();
            }
        }, 5000); // Check every 5 seconds
    },

    // Pause Keno game when no players
    pauseKenoGame: function() {
        const self = this;
        
        console.log('⏸️ Pausing Keno game - no players online');
        
        // Stop any active timers
        if (self.kenoCountdownInterval) {
            clearInterval(self.kenoCountdownInterval);
            self.kenoCountdownInterval = null;
        }
        
        if (self.numberDrawInterval) {
            clearInterval(self.numberDrawInterval);
            self.numberDrawInterval = null;
        }
        
        self.gamePaused = true;
        self.isKenoRoundActive = false;
        
        // Broadcast game paused to all connected players
        self.io.to('keno').emit('keno:game_paused', {
            message: 'Game paused - waiting for players to join...',
            playersNeeded: self.CONFIG.MIN_PLAYERS,
            autoRestart: true
        });
    },

    // Resume Keno game when players return
    resumeKenoGame: function() {
        const self = this;
        
        console.log('▶️ Resuming Keno game - players are back');
        
        self.gamePaused = false;
        
        // Broadcast game resumed
        self.io.to('keno').emit('keno:game_resumed', {
            message: 'Game resumed! Next round starting soon...',
            playersOnline: Array.from(self.kenoPlayers.values()).filter(p => p.isOnline).length
        });
        
        // Start a new round after a short delay
        setTimeout(() => {
            if (!self.gamePaused) {
                self.startKenoRound();
            }
        }, 5000); // 5 second delay before starting new round
    },

    // Handle Keno socket connection
    handleKenoConnection: function(socket) {
        const self = this;
        
        console.log(`🎰 Keno connection: ${socket.id}`);
        
        // Store socket for keno
        self.kenoSockets.set(socket.id, socket);
        
        // Keno authentication
        socket.on('keno:auth', async (data) => {
            try {
                const { userId, userName } = data;
                
                // Find user in database
                const user = await self.User.findOne({ userId: userId });
                
                if (!user) {
                    socket.emit('keno:error', 'User not found');
                    return;
                }
                
                // Store player info
                socket.userId = userId;
                socket.userName = userName;
                socket.kenoPlayer = true;
                
                // Add to keno players
                self.kenoPlayers.set(userId, {
                    socketId: socket.id,
                    userId: userId,
                    userName: userName,
                    balance: user.balance,
                    currentBet: null,
                    selectedNumbers: [],
                    hasPlacedBet: false,
                    totalWagered: user.totalWagered || 0,
                    totalWins: user.totalWins || 0,
                    isOnline: true,
                    lastSeen: new Date()
                });
                
                // Update user online status
                user.isOnline = true;
                user.lastSeen = new Date();
                user.sessionCount = (user.sessionCount || 0) + 1;
                await user.save();
                
                // Join Keno room
                socket.join('keno');
                
                // Get current game state
                const activeGame = self.getActiveKenoGame();
                
                // Send welcome data
                socket.emit('keno:welcome', {
                    playerId: userId,
                    userName: userName,
                    balance: user.balance,
                    currentRound: self.kenoRoundNumber,
                    isRoundActive: self.isKenoRoundActive,
                    countdown: self.kenoCountdown,
                    nextDrawTime: Date.now() + (self.kenoCountdown * 1000),
                    roundHistory: self.kenoRoundHistory.slice(0, 10),
                    payoutTable: self.CONFIG.PAYOUT_TABLE,
                    playersCount: activeGame ? activeGame.players.length : 0,
                    totalBets: activeGame ? activeGame.totalBets : 0,
                    gamePaused: self.gamePaused,
                    config: {
                        minBet: self.CONFIG.KENO_MIN_BET,
                        maxBet: self.CONFIG.KENO_MAX_BET,
                        maxSelections: self.CONFIG.KENO_MAX_SELECTIONS,
                        totalNumbers: self.CONFIG.KENO_TOTAL_NUMBERS,
                        drawCount: self.CONFIG.KENO_DRAW_COUNT,
                        gameTimer: self.CONFIG.KENO_GAME_TIMER,
                        betValues: self.CONFIG.BET_VALUES
                    }
                });
                
                console.log(`🎰 Keno player authenticated: ${userName} (${userId}) - Balance: ${user.balance} ETB`);
                
                // Check if we should resume game
                const onlinePlayers = Array.from(self.kenoPlayers.values()).filter(p => p.isOnline).length;
                if (onlinePlayers >= self.CONFIG.MIN_PLAYERS && self.gamePaused) {
                    self.resumeKenoGame();
                }
                
            } catch (error) {
                console.error('Keno auth error:', error);
                socket.emit('keno:error', 'Authentication failed');
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
                
                // Check if game is paused
                if (self.gamePaused) {
                    socket.emit('keno:error', 'Game is paused. Please wait for more players.');
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
                
                // Validate bet amount
                const bet = parseFloat(betAmount);
                if (isNaN(bet) || !self.CONFIG.BET_VALUES.includes(bet)) {
                    socket.emit('keno:error', `Bet amount must be one of: ${self.CONFIG.BET_VALUES.join(', ')} ETB`);
                    return;
                }
                
                // Validate numbers
                if (!Array.isArray(numbers) || numbers.length < 1 || numbers.length > self.CONFIG.KENO_MAX_SELECTIONS) {
                    socket.emit('keno:error', `Select 1-${self.CONFIG.KENO_MAX_SELECTIONS} numbers`);
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
                
                // Deduct bet amount
                user.balance -= bet;
                user.totalWagered += bet;
                await user.save();
                
                // Update player state
                player.balance = user.balance;
                player.selectedNumbers = sortedNumbers;
                player.currentBet = bet;
                player.hasPlacedBet = true;
                player.totalWagered += bet;
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
                    placedAt: new Date(),
                    userName: player.userName
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
                    status: 'completed'
                });
                await transaction.save();
                
                // Update stats
                await self.updateKenoStats(bet, 0, 1);
                
                // Emit confirmation
                socket.emit('keno:betConfirmed', {
                    success: true,
                    balance: user.balance,
                    betAmount: bet,
                    numbers: sortedNumbers,
                    message: `Bet placed: ${bet} ETB`
                });
                
                // Broadcast updated player count
                self.broadcastKenoPlayersUpdate();
                
                console.log(`🎰 Bet placed: ${player.userName} - ${bet} ETB on ${sortedNumbers.length} numbers`);
                
            } catch (error) {
                console.error('Keno place bet error:', error);
                socket.emit('keno:error', 'Failed to place bet');
            }
        });
        
        // Quick pick numbers
        socket.on('keno:quickPick', (data) => {
            try {
                if (!socket.userId) {
                    socket.emit('keno:error', 'Not authenticated');
                    return;
                }
                
                const { count } = data;
                const pickCount = Math.min(count || self.CONFIG.KENO_MAX_SELECTIONS, self.CONFIG.KENO_MAX_SELECTIONS);
                
                // Generate random unique numbers
                const numbers = [];
                while (numbers.length < pickCount) {
                    const num = Math.floor(Math.random() * self.CONFIG.KENO_TOTAL_NUMBERS) + 1;
                    if (!numbers.includes(num)) {
                        numbers.push(num);
                    }
                }
                
                numbers.sort((a, b) => a - b);
                
                socket.emit('keno:quickPickNumbers', { 
                    success: true,
                    numbers: numbers 
                });
                
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
                    gamePaused: self.gamePaused
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
                    userName: user.userName
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
                
                // Only allow clearing if haven't placed bet yet
                if (!player.hasPlacedBet) {
                    player.selectedNumbers = [];
                    player.currentBet = null;
                    self.kenoPlayers.set(socket.userId, player);
                    
                    socket.emit('keno:selectionCleared', {
                        success: true,
                        message: 'Selection cleared'
                    });
                } else {
                    socket.emit('keno:error', 'Cannot clear after placing bet');
                }
                
            } catch (error) {
                console.error('Keno clear selection error:', error);
                socket.emit('keno:error', 'Failed to clear selection');
            }
        });
        
        // Join Keno room
        socket.on('keno:join', () => {
            socket.join('keno');
            console.log(`🎰 Player joined Keno room: ${socket.id}`);
        });
        
        // Restart game (admin/player request)
        socket.on('keno:restartGame', () => {
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
                
                // Check if game is paused
                if (!self.gamePaused) {
                    socket.emit('keno:error', 'Game is already running');
                    return;
                }
                
                // Check if we have enough players
                const onlinePlayers = Array.from(self.kenoPlayers.values()).filter(p => p.isOnline).length;
                if (onlinePlayers < self.CONFIG.MIN_PLAYERS) {
                    socket.emit('keno:error', `Need at least ${self.CONFIG.MIN_PLAYERS} player(s) to start`);
                    return;
                }
                
                // Resume game
                self.resumeKenoGame();
                
                socket.emit('keno:gameRestarted', {
                    success: true,
                    message: 'Game restarted successfully'
                });
                
            } catch (error) {
                console.error('Keno restart game error:', error);
                socket.emit('keno:error', 'Failed to restart game');
            }
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
        
        // Update user offline status
        if (socket.userId) {
            const player = self.kenoPlayers.get(socket.userId);
            if (player) {
                player.isOnline = false;
                player.lastSeen = new Date();
                self.kenoPlayers.set(socket.userId, player);
                
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
        
        // Note: We don't remove from players map to preserve data
        // but we do remove from active game
        if (socket.userId) {
            const activeGame = self.getActiveKenoGame();
            if (activeGame) {
                const index = activeGame.players.indexOf(socket.userId);
                if (index > -1) {
                    activeGame.players.splice(index, 1);
                }
                
                // Broadcast updated player count
                self.broadcastKenoPlayersUpdate();
            }
        }
    },
    
    // Start Keno game round
    startKenoRound: function() {
        const self = this;
        
        // Check if game is paused
        if (self.gamePaused) {
            console.log('🎰 Game is paused, skipping round start');
            return;
        }
        
        // Check if we have enough players
        const onlinePlayers = Array.from(self.kenoPlayers.values()).filter(p => p.isOnline).length;
        if (onlinePlayers < self.CONFIG.MIN_PLAYERS) {
            console.log('🎰 Not enough players to start round');
            self.pauseKenoGame();
            return;
        }
        
        console.log('🎰 Starting new Keno round...');
        
        self.isKenoRoundActive = true;
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
            winners: [],
            totalBets: 0,
            totalBetAmount: 0,
            totalPayout: 0,
            commissionCollected: 0
        };
        
        self.activeKenoGames.set('current', activeGame);
        
        // Broadcast round start
        self.io.to('keno').emit('keno:round_start', {
            round: activeGame.roundNumber,
            duration: self.CONFIG.KENO_GAME_TIMER,
            message: `Round ${activeGame.roundNumber} started! Place your bets!`
        });
        
        // Reset all players' bet status
        for (const [userId, player] of self.kenoPlayers) {
            player.hasPlacedBet = false;
            player.selectedNumbers = [];
            player.currentBet = null;
            self.kenoPlayers.set(userId, player);
        }
        
        // Start countdown
        self.startKenoCountdown();
    },
    
    // Start Keno countdown
    startKenoCountdown: function() {
        const self = this;
        
        // Clear any existing interval
        if (self.kenoCountdownInterval) {
            clearInterval(self.kenoCountdownInterval);
        }
        
        self.kenoCountdown = self.CONFIG.KENO_GAME_TIMER;
        
        self.kenoCountdownInterval = setInterval(() => {
            // Check if game is paused
            if (self.gamePaused) {
                clearInterval(self.kenoCountdownInterval);
                self.kenoCountdownInterval = null;
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
    
    // Draw Keno numbers with 3-second delay
    drawKenoNumbers: async function() {
        const self = this;
        const activeGame = self.getActiveKenoGame();
        
        if (!activeGame || activeGame.status !== 'betting') return;
        
        console.log('🎰 Drawing Keno numbers...');
        
        activeGame.status = 'drawing';
        self.isKenoRoundActive = false;
        
        // Reset draw state
        self.currentDrawIndex = 0;
        self.drawnNumbers = [];
        activeGame.drawnNumbers = [];
        
        // Broadcast draw start
        self.io.to('keno').emit('keno:draw_start', {
            round: activeGame.roundNumber,
            message: 'Drawing numbers...'
        });
        
        // Wait a bit for dramatic effect
        setTimeout(() => {
            // Start drawing numbers one by one with 3-second delay
            self.numberDrawInterval = setInterval(() => {
                // Generate a random unique number
                let num;
                do {
                    num = Math.floor(Math.random() * self.CONFIG.KENO_TOTAL_NUMBERS) + 1;
                } while (self.drawnNumbers.includes(num));
                
                self.drawnNumbers.push(num);
                activeGame.drawnNumbers.push(num);
                self.currentDrawIndex++;
                
                // Sort the drawn numbers for display
                const sortedDrawnNumbers = [...self.drawnNumbers].sort((a, b) => a - b);
                
                // Broadcast each drawn number
                self.io.to('keno').emit('keno:number_drawn', {
                    round: activeGame.roundNumber,
                    number: num,
                    drawnNumbers: sortedDrawnNumbers,
                    currentIndex: self.currentDrawIndex,
                    totalToDraw: self.CONFIG.KENO_DRAW_COUNT
                });
                
                console.log(`🎰 Drawn number ${self.currentDrawIndex}/${self.CONFIG.KENO_DRAW_COUNT}: ${num}`);
                
                // Check if we've drawn all numbers
                if (self.currentDrawIndex >= self.CONFIG.KENO_DRAW_COUNT) {
                    clearInterval(self.numberDrawInterval);
                    self.numberDrawInterval = null;
                    
                    // Sort final drawn numbers
                    activeGame.drawnNumbers.sort((a, b) => a - b);
                    
                    // Wait a moment then process results
                    setTimeout(() => {
                        self.processKenoResults(activeGame);
                    }, 2000);
                }
            }, self.CONFIG.DRAW_DELAY_MS); // 3 seconds between numbers
            
        }, 2000);
    },
    
    // Process Keno results
    processKenoResults: async function(activeGame) {
        const self = this;
        
        console.log('🎰 Processing Keno results...');
        
        // Broadcast final results
        self.io.to('keno').emit('keno:round_results', {
            round: activeGame.roundNumber,
            drawnNumbers: activeGame.drawnNumbers,
            playersCount: activeGame.players.length,
            totalBets: activeGame.totalBets,
            message: `Round ${activeGame.roundNumber} results!`
        });
        
        // Calculate winnings for each player
        for (const [playerId, bet] of Object.entries(activeGame.bets)) {
            try {
                // Count matches
                const matches = bet.numbers.filter(num => 
                    activeGame.drawnNumbers.includes(num)
                ).length;
                
                // Calculate winnings
                let winnings = 0;
                if (matches > 0 && self.CONFIG.PAYOUT_TABLE[bet.numbers.length]) {
                    const payout = self.CONFIG.PAYOUT_TABLE[bet.numbers.length][matches];
                    if (payout) {
                        winnings = bet.amount * payout;
                    }
                }
                
                if (winnings > 0) {
                    // Update user balance
                    const user = await self.User.findOne({ userId: playerId });
                    if (user) {
                        user.balance += winnings;
                        user.totalWins += winnings;
                        await user.save();
                        
                        // Create win transaction
                        const transaction = new self.Transaction({
                            type: 'KENO_WIN',
                            userId: playerId,
                            userName: user.userName,
                            amount: winnings,
                            description: `Keno win: ${winnings} ETB (bet ${bet.amount} ETB, matched ${matches} of ${bet.numbers.length} numbers)`,
                            game: 'keno',
                            status: 'completed'
                        });
                        await transaction.save();
                        
                        // Add to winners list
                        activeGame.winners.push({
                            playerId: playerId,
                            playerName: user.userName,
                            betAmount: bet.amount,
                            numbers: bet.numbers,
                            matches: matches,
                            winnings: winnings
                        });
                        
                        activeGame.totalPayout += winnings;
                        
                        // Update player state
                        const player = self.kenoPlayers.get(playerId);
                        if (player) {
                            player.balance = user.balance;
                            player.totalWins += winnings;
                            player.hasPlacedBet = false;
                            player.selectedNumbers = [];
                            player.currentBet = null;
                            self.kenoPlayers.set(playerId, player);
                        }
                        
                        // Send personal result
                        const playerSocket = self.getKenoSocketByUserId(playerId);
                        if (playerSocket) {
                            playerSocket.emit('keno:round_result', {
                                round: activeGame.roundNumber,
                                drawnNumbers: activeGame.drawnNumbers,
                                yourNumbers: bet.numbers,
                                matches: matches,
                                winnings: winnings,
                                newBalance: user.balance,
                                bet: bet.amount,
                                message: `You won ${winnings} ETB! Matched ${matches} numbers.`
                            });
                        }
                        
                        console.log(`🎰 Winner: ${user.userName} won ${winnings} ETB (matched ${matches} numbers)`);
                    }
                } else {
                    // Send loss result
                    const playerSocket = self.getKenoSocketByUserId(playerId);
                    if (playerSocket) {
                        playerSocket.emit('keno:round_result', {
                            round: activeGame.roundNumber,
                            drawnNumbers: activeGame.drawnNumbers,
                            yourNumbers: bet.numbers,
                            matches: matches,
                            winnings: 0,
                            newBalance: await self.getUserBalance(playerId),
                            bet: bet.amount,
                            message: `Matched ${matches} numbers. Better luck next round!`
                        });
                    }
                    
                    // Update player state
                    const player = self.kenoPlayers.get(playerId);
                    if (player) {
                        player.hasPlacedBet = false;
                        player.selectedNumbers = [];
                        player.currentBet = null;
                        self.kenoPlayers.set(playerId, player);
                    }
                }
            } catch (error) {
                console.error(`Error processing result for player ${playerId}:`, error);
            }
        }
        
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
            timestamp: new Date()
        });
        
        // Keep only last 20 rounds in history
        if (self.kenoRoundHistory.length > 20) {
            self.kenoRoundHistory = self.kenoRoundHistory.slice(0, 20);
        }
        
        // Update database stats
        await self.updateKenoStats(totalWagered, activeGame.totalPayout, 1);
        
        // Increment round number
        self.kenoRoundNumber++;
        
        // Check if we have enough players to continue
        const onlinePlayers = Array.from(self.kenoPlayers.values()).filter(p => p.isOnline).length;
        if (onlinePlayers < self.CONFIG.MIN_PLAYERS) {
            self.pauseKenoGame();
        } else {
            // Start next round after a short delay
            setTimeout(() => {
                if (!self.gamePaused) {
                    self.startKenoRound();
                }
            }, 5000); // 5 second delay between rounds
        }
    },
    
    // Update Keno stats in database
    updateKenoStats: async function(wagered, payout, games) {
        try {
            const today = new Date().toISOString().split('T')[0];
            
            await this.Stats.findOneAndUpdate(
                { date: today },
                {
                    $inc: {
                        totalWagered: wagered,
                        totalEarnings: wagered - payout,
                        totalGames: games,
                        totalKenoWagered: wagered,
                        totalKenoEarnings: wagered - payout,
                        totalKenoGames: games,
                        totalKenoWins: wagered > payout ? 1 : 0
                    }
                },
                { upsert: true, new: true }
            );
            
        } catch (error) {
            console.error('Error updating Keno stats:', error);
        }
    },
    
    // Helper methods
    getActiveKenoGame: function() {
        const game = this.activeKenoGames.get('current');
        if (!game) {
            // Create a default game if none exists
            const defaultGame = {
                id: Date.now(),
                roundNumber: this.kenoRoundNumber,
                startTime: new Date(),
                endTime: null,
                status: 'betting',
                players: [],
                bets: {},
                drawnNumbers: [],
                winners: [],
                totalBets: 0,
                totalBetAmount: 0,
                totalPayout: 0,
                commissionCollected: 0
            };
            this.activeKenoGames.set('current', defaultGame);
            return defaultGame;
        }
        return game;
    },
    
    getKenoSocketByUserId: function(userId) {
        const player = this.kenoPlayers.get(userId);
        return player ? this.kenoSockets.get(player.socketId) : null;
    },
    
    broadcastKenoPlayersUpdate: function() {
        const activeGame = this.getActiveKenoGame();
        const onlinePlayers = Array.from(this.kenoPlayers.values()).filter(p => p.isOnline).length;
        
        this.io.to('keno').emit('keno:players_update', {
            count: onlinePlayers,
            totalBets: activeGame.totalBets
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
        
        // Start first round after 5 seconds
        setTimeout(() => {
            // Check if we have players
            const onlinePlayers = Array.from(self.kenoPlayers.values()).filter(p => p.isOnline).length;
            if (onlinePlayers >= self.CONFIG.MIN_PLAYERS) {
                self.startKenoRound();
            } else {
                console.log('🎰 Waiting for players to join...');
                self.pauseKenoGame();
            }
        }, 5000);
    },
    
    // Handle Keno socket connection (alternative method)
    handleKenoSocketConnection: function(socket) {
        this.handleKenoConnection(socket);
    },
    
    // Get Keno players count
    getKenoPlayersCount: function() {
        return this.kenoPlayers.size;
    },
    
    // Get Keno active games count
    getKenoActiveGamesCount: function() {
        return this.activeKenoGames.size;
    },
    
    // Get all Keno players
    getAllKenoPlayers: function() {
        return Array.from(this.kenoPlayers.values());
    },
    
    // Force start Keno round (admin)
    forceStartKenoRound: function() {
        const activeGame = this.getActiveKenoGame();
        if (activeGame && activeGame.status === 'betting') {
            clearInterval(this.kenoCountdownInterval);
            this.drawKenoNumbers();
            return true;
        }
        return false;
    },
    
    // Get Keno game stats
    getKenoGameStats: function() {
        const activeGame = this.getActiveKenoGame();
        const onlinePlayers = Array.from(this.kenoPlayers.values()).filter(p => p.isOnline).length;
        
        return {
            roundNumber: this.kenoRoundNumber,
            isRoundActive: this.isKenoRoundActive,
            countdown: this.kenoCountdown,
            playersCount: this.kenoPlayers.size,
            onlinePlayers: onlinePlayers,
            gamePaused: this.gamePaused,
            totalEarnings: this.totalKenoEarnings,
            activeGame: activeGame ? {
                players: activeGame.players.length,
                totalBets: activeGame.totalBets,
                totalBetAmount: activeGame.totalBetAmount,
                status: activeGame.status,
                drawnNumbersCount: activeGame.drawnNumbers.length
            } : null,
            historyCount: this.kenoRoundHistory.length,
            config: {
                minPlayers: this.CONFIG.MIN_PLAYERS,
                gameTimer: this.CONFIG.KENO_GAME_TIMER,
                drawDelay: this.CONFIG.DRAW_DELAY_MS,
                maxSelections: this.CONFIG.KENO_MAX_SELECTIONS,
                betValues: this.CONFIG.BET_VALUES
            }
        };
    },
    
    // Get detailed Keno stats for admin
    getKenoDetailedStats: function() {
        const stats = this.getKenoGameStats();
        const recentHistory = this.kenoRoundHistory.slice(0, 5);
        
        return {
            ...stats,
            recentHistory: recentHistory,
            totalPlayers: this.kenoPlayers.size,
            connectedSockets: this.kenoSockets.size,
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
                totalWins: player.totalWins
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
                removedCount++;
            }
        }
        
        if (removedCount > 0) {
            console.log(`🧹 Cleaned up ${removedCount} inactive Keno players`);
        }
    }
};
