// keno-logic.js - KENO GAME LOGIC MODULE
module.exports = {
    // Game configuration
    CONFIG: {
        KENO_GAME_TIMER: 30, // seconds between rounds
        KENO_MIN_BET: 1,
        KENO_MAX_BET: 1000,
        KENO_MAX_SELECTIONS: 10,
        KENO_TOTAL_NUMBERS: 80,
        KENO_DRAW_COUNT: 20,
        PAYOUT_TABLE: {
            1: {1: 2, 2: 5, 3: 25, 4: 100, 5: 450, 6: 1600, 7: 5000, 8: 15000, 9: 50000, 10: 100000},
            2: {2: 1, 3: 2, 4: 10, 5: 25, 6: 80, 7: 500, 8: 2500, 9: 10000},
            3: {3: 1, 4: 2, 5: 5, 6: 15, 7: 50, 8: 400, 9: 2000},
            4: {4: 1, 5: 2, 6: 5, 7: 15, 8: 100, 9: 1000},
            5: {5: 1, 6: 2, 7: 5, 8: 20, 9: 200},
            6: {6: 1, 7: 2, 8: 5, 9: 50},
            7: {7: 1, 8: 2, 9: 25},
            8: {8: 1, 9: 10},
            9: {9: 5},
            10: {10: 2}
        },
        COMMISSION_PERCENTAGE: 5 // 5% house commission
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
        this.waitingPeriod = false;
        this.waitingPeriodInterval = null;
        this.totalKenoEarnings = 0;
        
        console.log('✅ Keno game logic initialized');
        
        // Load existing stats
        this.loadKenoStats();
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
                    config: {
                        minBet: self.CONFIG.KENO_MIN_BET,
                        maxBet: self.CONFIG.KENO_MAX_BET,
                        maxSelections: self.CONFIG.KENO_MAX_SELECTIONS,
                        totalNumbers: self.CONFIG.KENO_TOTAL_NUMBERS,
                        drawCount: self.CONFIG.KENO_DRAW_COUNT,
                        gameTimer: self.CONFIG.KENO_GAME_TIMER
                    }
                });
                
                console.log(`🎰 Keno player authenticated: ${userName} (${userId}) - Balance: ${user.balance} ETB`);
                
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
                if (isNaN(bet) || bet < self.CONFIG.KENO_MIN_BET || bet > self.CONFIG.KENO_MAX_BET) {
                    socket.emit('keno:error', `Bet amount must be between ${self.CONFIG.KENO_MIN_BET} and ${self.CONFIG.KENO_MAX_BET} ETB`);
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
                const pickCount = Math.min(count || 5, self.CONFIG.KENO_MAX_SELECTIONS);
                
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
                    currentBet: player.currentBet
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
        
        if (self.waitingPeriod) {
            console.log('🎰 Waiting period active, skipping round start');
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
                self.drawKenoNumbers();
            }
        }, 1000);
    },
    
    // Draw Keno numbers
    drawKenoNumbers: async function() {
        const self = this;
        const activeGame = self.getActiveKenoGame();
        
        if (!activeGame || activeGame.status !== 'betting') return;
        
        console.log('🎰 Drawing Keno numbers...');
        
        activeGame.status = 'drawing';
        self.isKenoRoundActive = false;
        
        // Broadcast draw start
        self.io.to('keno').emit('keno:draw_start', {
            round: activeGame.roundNumber,
            message: 'Drawing numbers...'
        });
        
        // Wait a bit for dramatic effect
        setTimeout(async () => {
            // Generate 20 random unique numbers
            const drawnNumbers = [];
            while (drawnNumbers.length < self.CONFIG.KENO_DRAW_COUNT) {
                const num = Math.floor(Math.random() * self.CONFIG.KENO_TOTAL_NUMBERS) + 1;
                if (!drawnNumbers.includes(num)) {
                    drawnNumbers.push(num);
                }
            }
            
            drawnNumbers.sort((a, b) => a - b);
            activeGame.drawnNumbers = drawnNumbers;
            
            // Broadcast drawn numbers
            self.io.to('keno').emit('keno:round_results', {
                round: activeGame.roundNumber,
                drawnNumbers: drawnNumbers,
                playersCount: activeGame.players.length,
                totalBets: activeGame.totalBets,
                message: `Round ${activeGame.roundNumber} results!`
            });
            
            // Process results
            await self.processKenoResults(activeGame);
            
        }, 2000);
    },
    
    // Process Keno results
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
        
        // Start waiting period before next round
        self.startWaitingPeriod();
    },
    
    // Start waiting period
    startWaitingPeriod: function() {
        const self = this;
        
        self.waitingPeriod = true;
        const waitTime = 10; // 10 seconds waiting period
        
        console.log(`🎰 Waiting period started (${waitTime}s until next round)`);
        
        // Broadcast waiting period
        self.io.to('keno').emit('keno:waiting_period', {
            duration: waitTime,
            message: `Next round starts in ${waitTime} seconds...`
        });
        
        // Start waiting countdown
        let waitCountdown = waitTime;
        self.waitingPeriodInterval = setInterval(() => {
            waitCountdown--;
            
            if (waitCountdown <= 0) {
                clearInterval(self.waitingPeriodInterval);
                self.waitingPeriod = false;
                self.startKenoRound();
            } else {
                // Broadcast countdown every second
                self.io.to('keno').emit('keno:waiting_countdown', {
                    countdown: waitCountdown,
                    message: `Next round in ${waitCountdown}...`
                });
            }
        }, 1000);
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
        return this.activeKenoGames.get('current');
    },
    
    getOrCreateActiveKenoGame: function() {
        let activeGame = this.getActiveKenoGame();
        if (!activeGame) {
            this.startKenoRound();
            activeGame = this.getActiveKenoGame();
        }
        return activeGame;
    },
    
    getKenoSocketByUserId: function(userId) {
        const player = this.kenoPlayers.get(userId);
        return player ? this.kenoSockets.get(player.socketId) : null;
    },
    
    broadcastKenoPlayersUpdate: function() {
        const activeGame = this.getActiveKenoGame();
        if (activeGame) {
            this.io.to('keno').emit('keno:players_update', {
                count: activeGame.players.length,
                totalBets: activeGame.totalBets
            });
        }
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
            self.startKenoRound();
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
        return {
            roundNumber: this.kenoRoundNumber,
            isRoundActive: this.isKenoRoundActive,
            countdown: this.kenoCountdown,
            playersCount: this.kenoPlayers.size,
            onlinePlayers: Array.from(this.kenoPlayers.values()).filter(p => p.isOnline).length,
            totalEarnings: this.totalKenoEarnings,
            activeGame: activeGame ? {
                players: activeGame.players.length,
                totalBets: activeGame.totalBets,
                totalBetAmount: activeGame.totalBetAmount,
                status: activeGame.status
            } : null,
            historyCount: this.kenoRoundHistory.length,
            waitingPeriod: this.waitingPeriod
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
