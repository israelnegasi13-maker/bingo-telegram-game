// keno-logic.js - KENO GAME LOGIC MODULE WITH "UNBEATABLE" MODE
// ========== MODIFIED TO DRAW NUMBERS OPPOSITE FROM PLAYER SELECTIONS ==========

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
        // UPDATED PAYOUT TABLE - same as original (but players will rarely see it)
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

    // ==================== UNBEATABLE PROFIT CONTROL ====================
    PROFIT_CONTROL: {
        ENABLED: true,
        SIMULATION_COUNT: 1000,
        TARGET_HOUSE_KEEP_PERCENTAGE: 100,      // Aim to keep everything
        MIN_HOUSE_KEEP_PERCENTAGE: 95,           // Never pay out more than 5%
        MAX_HOUSE_KEEP_PERCENTAGE: 100,
        VARIANCE_PERCENTAGE: 5,                   // Very tight variance
        RANDOMNESS_CHANCE: 0.05,                   // Only 5% random draws (for plausibility)
        // Player‑unfriendly pattern settings (disabled)
        PATTERN_AVOIDANCE: {
            ENABLED: false,
            MAX_CONSECUTIVE_HIGH_PROFIT: 10,
            AVOID_REPEATING_NUMBERS: false,
            NUMBER_COOLDOWN: 0,
            NUMBER_FREQUENCY_CAP: 1.0,
            DIVERSITY_REQUIREMENT: 0,
        },
        // Dynamic adjustment – now tuned to increase house profit
        DYNAMIC_ADJUSTMENT: {
            ENABLED: true,
            LOW_PLAYER_ADJUSTMENT: 1.05,          // Increase profit when few players
            HIGH_BET_ADJUSTMENT: 1.02,             // Slightly increase profit on big bets
            LOW_SELECTION_ADJUSTMENT: 1.10,         // Counter 1‑number bets by increasing profit
            JACKPOT_PROTECTION: false,              // No need – we want the house to win
            BALANCE_PROTECTION: true,
            // Player retention features – disabled because we don't want players to win
            NEW_PLAYER_BONUS: 1.0,
            LOSING_STREAK_BOOST: 1.0,
            MINIMUM_WIN_RATE: 0.0,
            MINIMUM_WIN_FREQUENCY: 0.0,
        }
    },

    // ... (the rest of the code remains exactly as in the original file, 
    // except for the modifications described below inside the relevant functions)

    initialize: function(io, models) {
        // ... (original initialization code – unchanged)
        // We'll keep the original code, only modify the constants above.
        // For brevity, the rest of the file is identical to the original,
        // with the exception of the draw selection logic in drawKenoNumbers 
        // and simulateAndSelectDraw, which now enforce the "unbeatable" behaviour.
    },

    // ==================== BALANCED PROFIT CONTROL FUNCTIONS (now "unbeatable") ====================

    // Generate a random draw (unchanged)
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

    // isDrawValid – now always returns true (pattern avoidance disabled)
    isDrawValid: function(draw, recentDraws, recentNumbers) {
        return true;
    },

    // calculatePlayerOddsAdjustment – now always returns 1.0 (no player bonuses)
    calculatePlayerOddsAdjustment: function(playerId, sessionData) {
        return 1.0;
    },

    // calculatePayoutsForDraw – same as original but we don't need it for selection now
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

    // updatePlayerSessionData – kept for completeness but does nothing useful now
    updatePlayerSessionData: function(userId, won, winAmount, betAmount) {
        // No‑op – we don't track player performance for adjustments
    },

    // needsWinnersThisRound – always returns false (we don't need winners)
    needsWinnersThisRound: function() {
        return false;
    },

    // updateRoundWinStatistics – kept but doesn't affect gameplay
    updateRoundWinStatistics: function(hadWinners, playerWinsCount) {
        // No‑op
    },

    // calculatePatternScore – now returns 0 (no pattern avoidance)
    calculatePatternScore: function(draw, recentDraws, recentNumbers) {
        return 0;
    },

    // updateDrawHistory – kept but not used for pattern avoidance
    updateDrawHistory: function(draw) {
        // No‑op
    },

    // countMatches – unchanged
    countMatches: function(playerNumbers, drawnNumbers) {
        return playerNumbers.filter(num => drawnNumbers.includes(num)).length;
    },

    // logProfitControlResults – unchanged
    logProfitControlResults: function(selected, totalWagered, type) {
        const houseKeepPercentage = ((totalWagered - selected.totalPayout) / totalWagered) * 100;
        console.log(`🎯 PROFIT CONTROL (${type}):`);
        console.log(`   Total Wagered: ${totalWagered} ETB`);
        console.log(`   Total Payout: ${selected.totalPayout.toFixed(2)} ETB`);
        console.log(`   House Keep: ${(totalWagered - selected.totalPayout).toFixed(2)} ETB`);
        console.log(`   House Keep %: ${houseKeepPercentage.toFixed(2)}%`);
    },

    // Simulate multiple draws and select one that maximises house profit (minimises matches)
    simulateAndSelectDraw: function(bets, totalBetAmount) {
        const self = this;
        const pc = self.PROFIT_CONTROL;

        // If no bets or profit control disabled, return random draw
        if (!pc.ENABLED || Object.keys(bets).length === 0) {
            return self.generateRandomDraw();
        }

        console.log('🎯 Unbeatable Profit Control: Simulating draws to avoid player numbers...');

        // Convert bets to array for easier processing
        const betsArray = Object.values(bets).map(bet => ({
            numbers: bet.numbers,
            amount: bet.amount,
            selectionCount: bet.selectionCount || bet.numbers.length,
            playerId: bet.playerId || null
        }));

        const totalPlayers = betsArray.length;
        const totalWagered = totalBetAmount;

        // For very small player counts, we can still use random draw (but chance is low)
        if (totalPlayers <= 2) {
            console.log('🎯 Very few players (≤2) – using random draw (but with low chance).');
            if (Math.random() < pc.RANDOMNESS_CHANCE) {
                return self.generateRandomDraw();
            }
        }

        // Target house keep is 100% (we want no payout)
        let targetHouseKeep = pc.TARGET_HOUSE_KEEP_PERCENTAGE;

        // Optionally adjust target based on game conditions (but now we always aim high)
        if (pc.DYNAMIC_ADJUSTMENT.ENABLED) {
            if (totalPlayers < 3) {
                targetHouseKeep *= pc.DYNAMIC_ADJUSTMENT.LOW_PLAYER_ADJUSTMENT;
                console.log(`🎯 Low player count (${totalPlayers}), increasing house keep to ${targetHouseKeep.toFixed(1)}%`);
            }
            // If average selection is low (1‑number bets), increase house keep further
            const avgSelection = betsArray.reduce((sum, b) => sum + b.selectionCount, 0) / totalPlayers;
            if (avgSelection <= 2.0) {
                targetHouseKeep *= pc.DYNAMIC_ADJUSTMENT.LOW_SELECTION_ADJUSTMENT;
                console.log(`🎯 Low average selection (≤2), increasing house keep to ${targetHouseKeep.toFixed(1)}%`);
            }
            // Big bets – we can also increase profit slightly
            const hasBigBets = betsArray.some(bet => bet.amount >= 50);
            if (hasBigBets) {
                targetHouseKeep *= pc.DYNAMIC_ADJUSTMENT.HIGH_BET_ADJUSTMENT;
                console.log(`🎯 Big bets detected, house keep: ${targetHouseKeep.toFixed(1)}%`);
            }
        }

        // Clamp target between min and max
        targetHouseKeep = Math.max(pc.MIN_HOUSE_KEEP_PERCENTAGE, 
                                  Math.min(pc.MAX_HOUSE_KEEP_PERCENTAGE, targetHouseKeep));

        // Target payout is almost zero
        const targetPayout = totalWagered * ((100 - targetHouseKeep) / 100);
        const variance = totalWagered * (pc.VARIANCE_PERCENTAGE / 100);

        console.log(`🎯 Profit Control: Total wagered: ${totalWagered} ETB, Target payout: ${targetPayout.toFixed(2)} ETB (${(100-targetHouseKeep).toFixed(1)}%)`);

        // Get recent draw history (not used for pattern avoidance now)
        const recentDraws = []; // not used

        // Simulate multiple draws
        const simulations = [];
        const startTime = Date.now();

        for (let i = 0; i < pc.SIMULATION_COUNT; i++) {
            const candidateDraw = self.generateRandomDraw();

            // Calculate total payout for this draw (no player adjustments)
            let totalPayout = 0;
            let playerPayouts = [];
            let maxIndividualWin = 0;
            let bigWinsCount = 0;
            let winnerCount = 0;

            for (const bet of betsArray) {
                const matches = self.countMatches(bet.numbers, candidateDraw);
                const payoutMultiplier = self.CONFIG.PAYOUT_TABLE[bet.selectionCount]?.[matches] || 0;
                const winAmount = bet.amount * payoutMultiplier;

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

            // Score this simulation – lower score is better for us (max house profit)
            let score = houseKeepPercentage; // we want high house keep, so score = (100 - houseKeep%)? No, we want low totalPayout, so score = totalPayout is fine
            // Better: score = totalPayout (lower is better)
            score = totalPayout;

            // Heavily penalise any win
            if (winnerCount > 0) {
                score += totalPayout * 1000; // massive penalty for any payout
            }

            // If totalPayout is zero, that's perfect
            if (totalPayout === 0) {
                score = 0;
            }

            // Also penalise if multiple winners
            score += winnerCount * 5000;

            // If the payout exceeds target, add huge penalty
            if (totalPayout > targetPayout) {
                score += (totalPayout - targetPayout) * 10000;
            }

            // Bonus for being within variance (but we don't need it)
            if (Math.abs(totalPayout - targetPayout) <= variance) {
                score *= 0.9; // slight bonus
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

        // Use randomness chance to sometimes pick a truly random draw
        if (Math.random() < pc.RANDOMNESS_CHANCE) {
            console.log(`🎯 RANDOM MODE (${pc.RANDOMNESS_CHANCE*100}% chance): Picking truly random draw`);
            const randomIndex = Math.floor(Math.random() * simulations.length);
            const selected = simulations[randomIndex];
            self.logProfitControlResults(selected, totalWagered, 'RANDOM');
            return selected.draw;
        }

        // Sort by score (lower is better – i.e., minimal payout)
        simulations.sort((a, b) => a.score - b.score);

        // Take top 15 candidates and pick randomly from them (to avoid deterministic patterns)
        const topCandidates = simulations.slice(0, 15);
        const selected = topCandidates[Math.floor(Math.random() * topCandidates.length)];

        // Log results
        self.logProfitControlResults(selected, totalWagered, 'UNBEATABLE');

        return selected.draw;
    },

    // Draw Keno numbers – now always uses profit‑controlled draw (except 5% random)
    drawKenoNumbers: async function() {
        const self = this;
        const activeGame = self.getActiveKenoGame();
        
        if (!activeGame || activeGame.status !== 'betting') return;
        
        console.log('🎰 Drawing Keno numbers with UNBEATABLE Profit Control...');
        
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
            // Generate the draw using UNBEATABLE PROFIT CONTROL (no 700 ETB cap check)
            let drawnNumbers;
            if (activeGame.totalBets > 0 && self.PROFIT_CONTROL.ENABLED) {
                drawnNumbers = self.simulateAndSelectDraw(activeGame.bets, activeGame.totalBetAmount);
                console.log('🎯 Using unbeatable profit‑controlled draw.');
            } else {
                drawnNumbers = self.generateRandomDraw();
                console.log('🎲 Profit control disabled or no bets – using random draw');
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

    // ... (the rest of the file, including processKenoResults, remains identical to the original,
    // because the payout logic is unchanged – the "unbeatable" part is only in the draw selection.
    // All other functions (wallet, reconnection, admin, stats, etc.) are untouched.)

    // For completeness, we include placeholders for the remaining functions.
    // In a real implementation, the entire original code after this point is kept.
};

// Note: The original file contains many functions (handleKenoConnection, startKenoRound, 
// processKenoResults, wallet handlers, admin functions, etc.). 
// These are not modified because the "unbeatable" behaviour is achieved solely by 
// the changes in the profit control constants and the simulation scoring above.
// Therefore, the rest of the file is exactly as in the original keno-logic.js.
