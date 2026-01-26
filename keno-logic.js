// keno-logic.js - KENO GAME LOGIC MODULE
module.exports = {
    // Game configuration - UPDATED
    CONFIG: {
        KENO_GAME_TIMER: 30, // seconds between rounds
        KENO_MIN_BET: 5,     // Updated from 1
        KENO_MAX_BET: 100,   // Updated from 1000
        KENO_SELECTIONS: 5,  // Fixed: Players can only choose 5 numbers
        KENO_TOTAL_NUMBERS: 80,
        KENO_DRAW_COUNT: 20,
        NUMBER_POP_INTERVAL: 3000, // 3 seconds between number pops
        PAYOUT_TABLE: {
            5: {1: 0, 2: 0, 3: 1, 4: 5, 5: 50} // Payout for 5 numbers only
        },
        COMMISSION_PERCENTAGE: 5, // 5% house commission
        ALLOWED_BETS: [5, 10, 20, 50, 100] // Only these bet amounts allowed
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
        this.totalKenoEarnings = 0;
        this.minimumPlayers = 1; // Game stops if no players
        
        console.log('✅ Keno game logic initialized - 5 numbers only, bets: 5,10,20,50,100 ETB');
        
        // Load existing stats
        this.loadKenoStats();
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
                    socket.emit('keno:error', { message: 'User not found' });
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
                        selections: self.CONFIG.KENO_SELECTIONS,
                        totalNumbers: self.CONFIG.KENO_TOTAL_NUMBERS,
                        drawCount: self.CONFIG.KENO_DRAW_COUNT,
                        gameTimer: self.CONFIG.KENO_GAME_TIMER,
                        allowedBets: self.CONFIG.ALLOWED_BETS
                    }
                });
                
                console.log(`🎰 Keno player authenticated: ${userName} - Balance: ${user.balance} ETB`);
                
                // If no active round and we have players, start a round
                if (!self.isKenoRoundActive && self.kenoPlayers.size >= self.minimumPlayers) {
                    setTimeout(() => {
                        self.startKenoRound();
                    }, 2000);
                }
                
            } catch (error) {
                console.error('Keno auth error:', error);
                socket.emit('keno:error', { message: 'Authentication failed' });
            }
        });
        
        // Place bet in Keno
        socket.on('keno:placeBet', async (data) => {
            try {
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
                
                // Validate bet amount - ONLY 5,10,20,50,100 allowed
                const bet = parseFloat(betAmount);
                if (isNaN(bet) || !self.CONFIG.ALLOWED_BETS.includes(bet)) {
                    socket.emit('keno:error', { message: 'Bet amount must be 5, 10, 20, 50, or 100 ETB' });
                    return;
                }
                
                // Validate numbers - MUST be exactly 5 numbers
                if (!Array.isArray(numbers) || numbers.length !== self.CONFIG.KENO_SELECTIONS) {
                    socket.emit('keno:error', { message: `You must select exactly ${self.CONFIG.KENO_SELECTIONS} numbers` });
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
                
                // Check balance
                const user = await self.User.findOne({ userId: socket.userId });
                if (!user || user.balance < bet) {
                    socket.emit('keno:error', { message: 'Insufficient balance' });
                    return;
                }
                
                // Deduct bet amount
                const previousBalance = user.balance;
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
                    userName: player.userName,
                    previousBalance: previousBalance,
                    newBalance: user.balance
                };
                activeGame.totalBets++;
                activeGame.totalBetAmount += bet;
                
                // Create transaction record
                const transaction = new self.Transaction({
                    type: 'KENO_BET',
                    userId: socket.userId,
                    userName: player.userName,
                    amount: -bet,
                    description: `Keno bet: ${bet} ETB on numbers ${sortedNumbers.join(', ')}`,
                    game: 'keno',
                    status: 'completed',
                    previousBalance: previousBalance,
                    newBalance: user.balance
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
                
                console.log(`🎰 Bet placed: ${player.userName} - ${bet} ETB on numbers ${sortedNumbers.join(', ')}`);
                
            } catch (error) {
                console.error('Keno place bet error:', error);
                socket.emit('keno:error', { message: 'Failed to place bet' });
            }
        });
        
        // Quick pick numbers - Always returns 5 numbers
        socket.on('keno:quickPick', (data) => {
            try {
                if (!socket.userId) {
                    socket.emit('keno:error', { message: 'Not authenticated' });
                    return;
                }
                
                // Always generate 5 numbers
                const numbers = [];
                while (numbers.length < self.CONFIG.KENO_SELECTIONS) {
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
                socket.emit('keno:error', { message: 'Failed to generate quick pick' });
            }
        });
        
        // Get current game state
        socket.on('keno:getState', async () => {
            try {
                if (!socket.userId) {
                    socket.emit('keno:error', { message: 'Not authenticated' });
                    return;
                }
                
                const player = self.kenoPlayers.get(socket.userId);
                if (!player) {
                    socket.emit('keno:error', { message: 'Player not found' });
                    return;
                }
                
                // Get latest balance
                const user = await self.User.findOne({ userId: socket.userId });
                if (user) {
                    player.balance = user.balance;
                    self.kenoPlayers.set(socket.userId, player);
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
                socket.emit('keno:error', { message: 'Failed to get game state' });
            }
        });
        
        // Get user balance
        socket.on('keno:getBalance', async () => {
            try {
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
                    self.kenoPlayers.set(socket.userId, player);
                }
                
                socket.emit('keno:balance', {
                    success: true,
                    balance: user.balance,
                    userName: user.userName
                });
                
            } catch (error) {
                console.error('Keno get balance error:', error);
                socket.emit('keno:error', { message: 'Failed to get balance' });
            }
        });
        
        // Clear current selection
        socket.on('keno:clearSelection', () => {
            try {
                if (!socket.userId) {
                    socket.emit('keno:error', { message: 'Not authenticated' });
                    return;
                }
                
                const player = self.kenoPlayers.get(socket.userId);
                if (!player) {
                    socket.emit('keno:error', { message: 'Player not found' });
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
                    socket.emit('keno:error', { message: 'Cannot clear after placing bet' });
                }
                
            } catch (error) {
                console.error('Keno clear selection error:', error);
                socket.emit('keno:error', { message: 'Failed to clear selection' });
            }
        });
        
        // Cancel current bet (only allowed if round still active)
        socket.on('keno:cancelBet', async () => {
            try {
                if (!socket.userId) {
                    socket.emit('keno:error', { message: 'Not authenticated' });
                    return;
                }
                
                const player = self.kenoPlayers.get(socket.userId);
                if (!player) {
                    socket.emit('keno:error', { message: 'Player not found' });
                    return;
                }
                
                // Only allow canceling if bet was placed this round
                if (!player.hasPlacedBet || !player.currentBet) {
                    socket.emit('keno:error', { message: 'No bet to cancel' });
                    return;
                }
                
                // Check if round is still active (within betting period)
                if (!self.isKenoRoundActive) {
                    socket.emit('keno:error', { message: 'Cannot cancel bet after betting period ends' });
                    return;
                }
                
                // Check if countdown is less than 5 seconds (don't allow cancellation in last seconds)
                if (self.kenoCountdown <= 5) {
                    socket.emit('keno:error', { message: 'Cannot cancel bet in last 5 seconds' });
                    return;
                }
                
                // Get the bet amount
                const betAmount = player.currentBet;
                
                // Refund to user
                const user = await self.User.findOne({ userId: socket.userId });
                if (user) {
                    user.balance += betAmount;
                    user.totalWagered -= betAmount; // Remove from wagered stats
                    await user.save();
                    
                    // Update player state
                    player.balance = user.balance;
                    player.hasPlacedBet = false;
                    player.selectedNumbers = [];
                    player.currentBet = null;
                    player.totalWagered -= betAmount;
                    self.kenoPlayers.set(socket.userId, player);
                    
                    // Remove from active game
                    const activeGame = self.getActiveKenoGame();
                    if (activeGame && activeGame.bets[socket.userId]) {
                        delete activeGame.bets[socket.userId];
                        activeGame.totalBets--;
                        activeGame.totalBetAmount -= betAmount;
                        
                        // Remove from players array if they have no bet
                        const index = activeGame.players.indexOf(socket.userId);
                        if (index > -1) {
                            activeGame.players.splice(index, 1);
                        }
                    }
                    
                    // Create refund transaction
                    const transaction = new self.Transaction({
                        type: 'KENO_REFUND',
                        userId: socket.userId,
                        userName: player.userName,
                        amount: betAmount,
                        description: `Keno bet refund: ${betAmount} ETB`,
                        game: 'keno',
                        status: 'completed',
                        previousBalance: user.balance - betAmount,
                        newBalance: user.balance
                    });
                    await transaction.save();
                    
                    // Update stats (remove the wagered amount)
                    await self.updateKenoStats(-betAmount, 0, 0);
                    
                    socket.emit('keno:betCancelled', {
                        success: true,
                        balance: user.balance,
                        refundAmount: betAmount,
                        message: `Bet of ${betAmount} ETB cancelled and refunded`
                    });
                    
                    // Broadcast updated player count
                    self.broadcastKenoPlayersUpdate();
                    
                    console.log(`🎰 Bet cancelled: ${player.userName} - ${betAmount} ETB refunded`);
                }
                
            } catch (error) {
                console.error('Keno cancel bet error:', error);
                socket.emit('keno:error', { message: 'Failed to cancel bet' });
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
                
                // Remove from active game if no bet placed
                const activeGame = self.getActiveKenoGame();
                if (activeGame && !player.hasPlacedBet) {
                    const index = activeGame.players.indexOf(socket.userId);
                    if (index > -1) {
                        activeGame.players.splice(index, 1);
                    }
                }
            }
        }
        
        // Remove from keno sockets
        self.kenoSockets.delete(socket.id);
        
        // Broadcast updated player count
        self.broadcastKenoPlayersUpdate();
        
        // Check if we need to pause the game (no players left)
        const activeGame = self.getActiveKenoGame();
        const onlinePlayers = Array.from(self.kenoPlayers.values()).filter(p => p.isOnline).length;
        
        if (onlinePlayers === 0 && self.isKenoRoundActive) {
            console.log('🎰 No players online, pausing game...');
            self.pauseKenoGame();
        }
    },
    
    // Start Keno game round
    startKenoRound: function() {
        const self = this;
        
        // Check if we have minimum players
        const onlinePlayers = Array.from(self.kenoPlayers.values()).filter(p => p.isOnline).length;
        if (onlinePlayers < self.minimumPlayers) {
            console.log('🎰 Not enough players to start round. Waiting...');
            // Broadcast waiting status
            self.io.to('keno').emit('keno:waiting', {
                message: 'Waiting for players...',
                playersNeeded: self.minimumPlayers,
                countdown: self.kenoCountdown
            });
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
            commissionCollected: 0,
            drawComplete: false
        };
        
        self.activeKenoGames.set('current', activeGame);
        
        // Reset all players' bet status for new round
        for (const [userId, player] of self.kenoPlayers) {
            player.hasPlacedBet = false;
            player.selectedNumbers = [];
            player.currentBet = null;
            self.kenoPlayers.set(userId, player);
        }
        
        // Broadcast round start
        self.io.to('keno').emit('keno:round_start', {
            round: activeGame.roundNumber,
            duration: self.CONFIG.KENO_GAME_TIMER,
            message: `Round ${activeGame.roundNumber} started! Place your bets!`,
            nextDrawTime: Date.now() + (self.CONFIG.KENO_GAME_TIMER * 1000)
        });
        
        // Start countdown
        self.startKenoCountdown();
    },
    
    // Pause Keno game when no players
    pauseKenoGame: function() {
        const self = this;
        
        if (self.kenoCountdownInterval) {
            clearInterval(self.kenoCountdownInterval);
            self.kenoCountdownInterval = null;
        }
        
        self.isKenoRoundActive = false;
        
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
        }
        
        self.kenoCountdown = self.CONFIG.KENO_GAME_TIMER;
        
        self.kenoCountdownInterval = setInterval(() => {
            self.kenoCountdown--;
            
            // Check if we still have players
            const onlinePlayers = Array.from(self.kenoPlayers.values()).filter(p => p.isOnline).length;
            if (onlinePlayers === 0) {
                clearInterval(self.kenoCountdownInterval);
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
            message: 'Drawing numbers...',
            popInterval: self.CONFIG.NUMBER_POP_INTERVAL
        });
        
        // Wait 2 seconds for dramatic effect
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
            
            // Broadcast drawn numbers (ALL AT ONCE for all players to see same numbers)
            self.io.to('keno').emit('keno:round_results', {
                round: activeGame.roundNumber,
                drawnNumbers: drawnNumbers,
                playersCount: activeGame.players.length,
                totalBets: activeGame.totalBets,
                popInterval: self.CONFIG.NUMBER_POP_INTERVAL,
                message: `Round ${activeGame.roundNumber} results!`
            });
            
            // Mark draw as complete
            activeGame.drawComplete = true;
            
            // Process results after numbers are shown
            setTimeout(async () => {
                await self.processKenoResults(activeGame);
            }, (drawnNumbers.length * self.CONFIG.NUMBER_POP_INTERVAL) + 5000);
            
        }, 2000);
    },
    
    // Process Keno results
    processKenoResults: async function(activeGame) {
        const self = this;
        
        console.log('🎰 Processing Keno results...');
        
        // Calculate winnings for each player
        const playerPromises = Object.entries(activeGame.bets).map(async ([playerId, bet]) => {
            try {
                // Count matches
                const matches = bet.numbers.filter(num => 
                    activeGame.drawnNumbers.includes(num)
                ).length;
                
                // Calculate winnings based on 5-number payout table
                let winnings = 0;
                if (matches >= 3 && self.CONFIG.PAYOUT_TABLE[5]) {
                    const payout = self.CONFIG.PAYOUT_TABLE[5][matches];
                    if (payout) {
                        winnings = bet.amount * payout;
                    }
                }
                
                if (winnings > 0) {
                    // Update user balance
                    const user = await self.User.findOne({ userId: playerId });
                    if (user) {
                        const previousBalance = user.balance;
                        user.balance += winnings;
                        user.totalWins += winnings;
                        await user.save();
                        
                        // Create win transaction
                        const transaction = new self.Transaction({
                            type: 'KENO_WIN',
                            userId: playerId,
                            userName: user.userName,
                            amount: winnings,
                            description: `Keno win: ${winnings} ETB (bet ${bet.amount} ETB, matched ${matches} of 5 numbers)`,
                            game: 'keno',
                            status: 'completed',
                            previousBalance: previousBalance,
                            newBalance: user.balance
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
                        
                        console.log(`🎰 Winner: ${user.userName} won ${winnings} ETB (matched ${matches}/5 numbers)`);
                    }
                } else {
                    // Send loss result
                    const user = await self.User.findOne({ userId: playerId });
                    const playerSocket = self.getKenoSocketByUserId(playerId);
                    if (playerSocket) {
                        playerSocket.emit('keno:round_result', {
                            round: activeGame.roundNumber,
                            drawnNumbers: activeGame.drawnNumbers,
                            yourNumbers: bet.numbers,
                            matches: matches,
                            winnings: 0,
                            newBalance: user ? user.balance : 0,
                            bet: bet.amount,
                            message: `Matched ${matches} numbers. Better luck next round!`
                        });
                    }
                    
                    // Update player state
                    const player = self.kenoPlayers.get(playerId);
                    if (player) {
                        player.balance = user ? user.balance : player.balance;
                        player.hasPlacedBet = false;
                        player.selectedNumbers = [];
                        player.currentBet = null;
                        self.kenoPlayers.set(playerId, player);
                    }
                }
            } catch (error) {
                console.error(`Error processing result for player ${playerId}:`, error);
            }
        });
        
        // Wait for all player results to be processed
        await Promise.all(playerPromises);
        
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
        
        // Check if we have players for next round
        const onlinePlayers = Array.from(self.kenoPlayers.values()).filter(p => p.isOnline).length;
        
        if (onlinePlayers >= self.minimumPlayers) {
            // Start next round after 5 seconds
            setTimeout(() => {
                self.startKenoRound();
            }, 5000);
        } else {
            console.log('🎰 No players online. Game will wait for players.');
            // Broadcast waiting message
            self.io.to('keno').emit('keno:waiting', {
                message: 'Waiting for players to start next round...',
                playersNeeded: self.minimumPlayers,
                countdown: self.CONFIG.KENO_GAME_TIMER
            });
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
                        totalKenoWins: payout > 0 ? 1 : 0
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
                winners: [],
                totalBets: 0,
                totalBetAmount: 0,
                totalPayout: 0,
                commissionCollected: 0,
                drawComplete: false
            };
            this.activeKenoGames.set('current', game);
        }
        return game;
    },
    
    getKenoSocketByUserId: function(userId) {
        const player = this.kenoPlayers.get(userId);
        if (player && this.kenoSockets.get(player.socketId)) {
            return this.kenoSockets.get(player.socketId);
        }
        return null;
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
        
        // Start first round if we have players
        const onlinePlayers = Array.from(self.kenoPlayers.values()).filter(p => p.isOnline).length;
        
        if (onlinePlayers >= self.minimumPlayers) {
            setTimeout(() => {
                self.startKenoRound();
            }, 5000);
        } else {
            console.log('🎰 Waiting for players to start first round...');
            self.io.to('keno').emit('keno:waiting', {
                message: 'Waiting for players to start first round...',
                playersNeeded: self.minimumPlayers,
                countdown: self.CONFIG.KENO_GAME_TIMER
            });
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
        
        return {
            roundNumber: this.kenoRoundNumber,
            isRoundActive: this.isKenoRoundActive,
            countdown: this.kenoCountdown,
            playersCount: this.kenoPlayers.size,
            onlinePlayers: onlinePlayers,
            totalEarnings: this.totalKenoEarnings,
            activeGame: activeGame ? {
                players: activeGame.players.length,
                totalBets: activeGame.totalBets,
                totalBetAmount: activeGame.totalBetAmount,
                status: activeGame.status,
                drawnNumbers: activeGame.drawnNumbers
            } : null,
            historyCount: this.kenoRoundHistory.length,
            minimumPlayers: this.minimumPlayers
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
                totalWins: player.totalWins,
                hasPlacedBet: player.hasPlacedBet,
                currentBet: player.currentBet
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
    },
    
    // Check if game should be active
    checkGameStatus: function() {
        const onlinePlayers = this.getOnlinePlayersCount();
        if (onlinePlayers === 0 && this.isKenoRoundActive) {
            this.pauseKenoGame();
        } else if (onlinePlayers >= this.minimumPlayers && !this.isKenoRoundActive) {
            // Check if no active game, start one
            const activeGame = this.getActiveKenoGame();
            if (activeGame.status === 'waiting' || activeGame.status === 'completed') {
                this.startKenoRound();
            }
        }
    },
    
    // Admin: Force end current round (emergency only)
    forceEndCurrentRound: async function() {
        try {
            const activeGame = this.getActiveKenoGame();
            
            if (activeGame && activeGame.status === 'betting') {
                // End betting and draw numbers
                if (this.kenoCountdownInterval) {
                    clearInterval(this.kenoCountdownInterval);
                }
                
                console.log('🛑 Admin forced end of current round');
                
                // Draw numbers immediately
                this.drawKenoNumbers();
                
                return { success: true, message: 'Round ended by admin' };
            } else {
                return { success: false, message: 'No active betting round to end' };
            }
        } catch (error) {
            console.error('Error forcing end of round:', error);
            return { success: false, error: error.message };
        }
    },
    
    // Get current round details
    getCurrentRoundDetails: function() {
        const activeGame = this.getActiveKenoGame();
        const playerDetails = [];
        
        for (const [playerId, bet] of Object.entries(activeGame.bets)) {
            const player = this.kenoPlayers.get(playerId);
            if (player) {
                playerDetails.push({
                    userName: player.userName,
                    betAmount: bet.amount,
                    numbers: bet.numbers,
                    placedAt: bet.placedAt
                });
            }
        }
        
        return {
            roundNumber: activeGame.roundNumber,
            status: activeGame.status,
            startTime: activeGame.startTime,
            totalBets: activeGame.totalBets,
            totalBetAmount: activeGame.totalBetAmount,
            players: playerDetails,
            drawnNumbers: activeGame.drawnNumbers,
            winners: activeGame.winners,
            totalPayout: activeGame.totalPayout,
            commissionCollected: activeGame.commissionCollected
        };
    }
};
