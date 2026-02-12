// agent-logic.js - Manual Agent/Referral System for Elite Games (FULLY UPDATED)
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

// 🛠️ FIXED: Helper to escape regex special characters
function escapeRegex(text) {
    return text.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
}

class ManualAgentSystem {
    constructor(io, models) {
        this.io = io;
        this.models = models;
        this.agentSockets = new Map();          // agentId -> socket
        // 🛠️ FIXED: removed unused this.commissionRates – rates come from agent document
        this.processingClaims = new Map();      // user-room combo -> timestamp
        this.processedTransactions = new Map(); // transactionId -> timestamp
        this.commissionDebug = true;
        this.agentHeartbeats = new Map();       // agentId -> lastHeartbeat
    }

    // ========== INITIALIZATION ==========
    async initialize() {
        console.log('✅ Manual Agent system initializing...');
        await this.ensureAdminAgent();
        this.startCommissionCalculationJob();
        this.startCleanupJob();
        this.startHeartbeatJob();
        console.log('👑 Manual Agent system ready with 40% Bingo and 10% Keno commissions');
    }

    setGameLogic(gameLogic) {
        this.gameLogic = gameLogic;
        console.log('🎮 Bingo game logic connected to agent system');
    }

    setKenoLogic(kenoLogic) {
        this.kenoLogic = kenoLogic;
        console.log('🎰 Keno game logic connected to agent system');
    }

    // ========== ADMIN AGENT SEEDING ==========
    async ensureAdminAgent() {
        try {
            const adminExists = await this.models.Agent.findOne({ username: 'admin' });
            if (!adminExists) {
                const hashedPassword = await bcrypt.hash('admin123', 10);
                // 🛠️ FIXED: generate a secure authToken
                const authToken = crypto.randomBytes(32).toString('hex');
                const adminAgent = await this.models.Agent.create({
                    username: 'admin',
                    password: hashedPassword,
                    name: 'System Administrator',
                    commissionRateBingo: 40,
                    commissionRateKeno: 10,
                    totalEarnings: 0,
                    totalReferrals: 0,
                    activeReferrals: 0,
                    isActive: true,
                    isSuperAdmin: true,
                    phoneNumber: '0962577855',
                    referralCode: 'ADMIN001',
                    authToken,                 // 🛠️ FIXED: store secure token
                    createdAt: new Date(),
                    updatedAt: new Date()
                });
                console.log('👑 Default admin agent created with username: admin, password: admin123');
                return adminAgent;
            } else {
                console.log('✅ Admin agent already exists');
                return adminExists;
            }
        } catch (error) {
            console.error('Error creating admin agent:', error);
            return null;
        }
    }

    // ========== AUTHENTICATION ==========
    async handleAgentLogin(socket, data) {
        try {
            const { username, password } = data;
            const agent = await this.models.Agent.findOne({ username: username.toLowerCase() });
            if (!agent) {
                socket.emit('agent:loginError', 'Invalid username or password');
                return;
            }
            if (!agent.isActive) {
                socket.emit('agent:loginError', 'Account is deactivated');
                return;
            }
            const isValid = await bcrypt.compare(password, agent.password);
            if (!isValid) {
                socket.emit('agent:loginError', 'Invalid username or password');
                return;
            }

            // 🛠️ FIXED: ensure authToken exists, generate if missing
            if (!agent.authToken) {
                agent.authToken = crypto.randomBytes(32).toString('hex');
                await agent.save();
            }

            socket.agentId = agent._id.toString();
            socket.agentData = {
                id: agent._id,
                username: agent.username,
                name: agent.name,
                isSuperAdmin: agent.isSuperAdmin,
                authToken: agent.authToken
            };

            this.agentSockets.set(agent._id.toString(), socket);
            this.agentHeartbeats.set(agent._id.toString(), Date.now());

            agent.lastLogin = new Date();
            await agent.save();

            socket.emit('agent:loginSuccess', {
                id: agent._id,
                username: agent.username,
                name: agent.name,
                commissionRateBingo: agent.commissionRateBingo,
                commissionRateKeno: agent.commissionRateKeno,
                totalEarnings: agent.totalEarnings,
                totalReferrals: agent.totalReferrals,
                activeReferrals: agent.activeReferrals,
                isSuperAdmin: agent.isSuperAdmin,
                phoneNumber: agent.phoneNumber || '',
                authToken: agent.authToken   // send token for auto‑login
            });

            console.log(`👤 Agent logged in: ${agent.username} (Super Admin: ${agent.isSuperAdmin})`);
        } catch (error) {
            console.error('Agent login error:', error);
            socket.emit('agent:loginError', 'Login failed');
        }
    }

    // 🛠️ FIXED: token verification now uses stored authToken
    async handleVerifyAgentToken(socket, data) {
        try {
            const { token } = data;
            if (!token) {
                socket.emit('agent:tokenInvalid');
                return;
            }
            const agent = await this.models.Agent.findOne({ authToken: token, isActive: true });
            if (!agent) {
                socket.emit('agent:tokenInvalid');
                return;
            }

            socket.agentId = agent._id.toString();
            socket.agentData = {
                id: agent._id,
                username: agent.username,
                name: agent.name,
                isSuperAdmin: agent.isSuperAdmin,
                authToken: agent.authToken
            };
            this.agentSockets.set(agent._id.toString(), socket);
            this.agentHeartbeats.set(agent._id.toString(), Date.now());

            socket.emit('agent:tokenVerified', {
                id: agent._id,
                username: agent.username,
                name: agent.name,
                commissionRateBingo: agent.commissionRateBingo,
                commissionRateKeno: agent.commissionRateKeno,
                totalEarnings: agent.totalEarnings,
                totalReferrals: agent.totalReferrals,
                activeReferrals: agent.activeReferrals,
                isSuperAdmin: agent.isSuperAdmin,
                phoneNumber: agent.phoneNumber || '',
                authToken: agent.authToken
            });

            console.log(`👤 Agent auto-logged in: ${agent.username} via token`);
        } catch (error) {
            console.error('Token verification error:', error);
            socket.emit('agent:tokenInvalid');
        }
    }

    // ========== DASHBOARD & REFRESH ==========
    async handleAgentDashboard(socket) {
        try {
            if (!socket.agentId) {
                socket.emit('agent:error', 'Not authenticated');
                return;
            }

            const agent = await this.models.Agent.findById(socket.agentId);
            if (!agent) {
                socket.emit('agent:error', 'Agent not found');
                return;
            }

            // All users with this agentId are referrals
            const userReferrals = await this.models.User.find({ agentId: agent._id })
                .sort({ agentReferredAt: -1 })
                .limit(50)
                .select('userId userName telegramUsername balance totalWagered totalWins totalBingos joinedAt lastSeen isOnline agentReferredAt referredBy agentCommissionEarned');

            // Recent commissions
            const commissions = await this.models.AgentCommission.find({ agentId: agent._id })
                .sort({ createdAt: -1 })
                .limit(50)
                .populate('userId', 'userId userName telegramUsername');

            // Today's earnings
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const todaysEarnings = await this.models.AgentCommission.aggregate([
                { $match: { agentId: agent._id, createdAt: { $gte: today }, status: 'completed' } },
                { $group: { _id: null, total: { $sum: '$commissionAmount' } } }
            ]);

            // Yesterday's earnings
            const yesterday = new Date(today);
            yesterday.setDate(yesterday.getDate() - 1);
            const yesterdayEarnings = await this.models.AgentCommission.aggregate([
                { $match: { agentId: agent._id, createdAt: { $gte: yesterday, $lt: today }, status: 'completed' } },
                { $group: { _id: null, total: { $sum: '$commissionAmount' } } }
            ]);

            // Monthly earnings
            const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
            const monthlyEarnings = await this.models.AgentCommission.aggregate([
                { $match: { agentId: agent._id, createdAt: { $gte: startOfMonth }, status: 'completed' } },
                { $group: { _id: null, total: { $sum: '$commissionAmount' } } }
            ]);

            // Active referrals count
            const activeReferrals = await this.models.User.countDocuments({
                agentId: agent._id,
                isOnline: true
            });

            // Total referrals count (direct from User collection)
            const actualReferralCount = await this.models.User.countDocuments({ agentId: agent._id });

            // Update agent stats atomically
            await this.models.Agent.findByIdAndUpdate(agent._id, {
                $set: {
                    activeReferrals,
                    totalReferrals: actualReferralCount,
                    updatedAt: new Date()
                }
            });

            // Re-fetch updated agent
            const updatedAgent = await this.models.Agent.findById(agent._id);

            // Earnings growth
            const todayTotal = todaysEarnings[0]?.total || 0;
            const yesterdayTotal = yesterdayEarnings[0]?.total || 0;
            const earningsGrowth = yesterdayTotal > 0
                ? ((todayTotal - yesterdayTotal) / yesterdayTotal * 100).toFixed(1)
                : todayTotal > 0 ? 100 : 0;

            socket.emit('agent:dashboardData', {
                agent: {
                    id: updatedAgent._id,
                    username: updatedAgent.username,
                    name: updatedAgent.name,
                    commissionRateBingo: updatedAgent.commissionRateBingo,
                    commissionRateKeno: updatedAgent.commissionRateKeno,
                    totalEarnings: updatedAgent.totalEarnings,
                    totalReferrals: updatedAgent.totalReferrals,
                    activeReferrals: updatedAgent.activeReferrals,
                    phoneNumber: updatedAgent.phoneNumber || '',
                    createdAt: updatedAgent.createdAt,
                    lastLogin: updatedAgent.lastLogin
                },
                stats: {
                    todaysEarnings: todayTotal,
                    yesterdayEarnings: yesterdayTotal,
                    earningsGrowth: earningsGrowth,
                    monthlyEarnings: monthlyEarnings[0]?.total || 0,
                    totalEarnings: updatedAgent.totalEarnings,
                    totalReferrals: updatedAgent.totalReferrals,
                    activeReferrals: updatedAgent.activeReferrals
                },
                referrals: userReferrals.map(user => ({
                    userId: user.userId,
                    userName: user.userName || 'No Name',
                    telegramUsername: user.telegramUsername || '',
                    balance: user.balance || 0,
                    totalWagered: user.totalWagered || 0,
                    totalWins: user.totalWins || 0,
                    totalBingos: user.totalBingos || 0,
                    joinedAt: user.joinedAt,
                    lastSeen: user.lastSeen,
                    isOnline: user.isOnline || false,
                    referredAt: user.agentReferredAt,
                    referredBy: user.referredBy || 'manual',
                    agentCommissionEarned: user.agentCommissionEarned || 0
                })),
                commissions: commissions.map(comm => ({
                    id: comm._id,
                    userId: comm.userId?.userId || 'Unknown',
                    userName: comm.userId?.userName || 'Unknown',
                    telegramUsername: comm.userId?.telegramUsername || '',
                    gameType: comm.gameType,
                    stake: comm.stake,
                    winningAmount: comm.winningAmount,
                    commissionRate: comm.commissionRate,
                    commissionAmount: comm.commissionAmount,
                    status: comm.status,
                    createdAt: comm.createdAt
                }))
            });

            console.log(`📊 Dashboard sent to agent ${updatedAgent.username}: ${userReferrals.length} referrals, ${commissions.length} commissions`);
        } catch (error) {
            console.error('Dashboard error:', error);
            socket.emit('agent:error', 'Failed to load dashboard');
        }
    }

    async handleRefreshDashboard(socket) {
        try {
            if (!socket.agentId) {
                socket.emit('agent:error', 'Not authenticated');
                return;
            }
            const agent = await this.models.Agent.findById(socket.agentId);
            if (!agent) {
                socket.emit('agent:error', 'Agent not found');
                return;
            }

            const actualReferralCount = await this.models.User.countDocuments({ agentId: agent._id });
            const activeReferrals = await this.models.User.countDocuments({ agentId: agent._id, isOnline: true });

            await this.models.Agent.findByIdAndUpdate(agent._id, {
                $set: {
                    totalReferrals: actualReferralCount,
                    activeReferrals,
                    updatedAt: new Date()
                }
            });

            await this.handleAgentDashboard(socket);

            socket.emit('agent:dashboardRefreshed', {
                message: 'Dashboard refreshed successfully',
                totalReferrals: actualReferralCount,
                activeReferrals,
                timestamp: new Date()
            });

            console.log(`🔄 Dashboard refreshed for agent ${agent.username}: ${actualReferralCount} referrals`);
        } catch (error) {
            console.error('Refresh dashboard error:', error);
            socket.emit('agent:error', 'Failed to refresh dashboard');
        }
    }

    // ========== DISCONNECT & HEARTBEAT ==========
    handleAgentDisconnect(socket) {
        try {
            if (socket.agentId) {
                const agentUsername = socket.agentData?.username || 'Unknown';
                console.log(`👤 Agent ${agentUsername} (${socket.agentId}) disconnected`);
                this.agentSockets.delete(socket.agentId);
                this.agentHeartbeats.delete(socket.agentId);
                this.updateAgentActiveReferralsOnDisconnect(socket.agentId);
                socket.agentId = null;
                socket.agentData = null;
            }
        } catch (error) {
            console.error('Agent disconnect error:', error);
        }
    }

    async updateAgentActiveReferralsOnDisconnect(agentId) {
        try {
            const agent = await this.models.Agent.findById(agentId);
            if (!agent) return;
            const activeReferrals = await this.models.User.countDocuments({ agentId: agent._id, isOnline: true });
            await this.models.Agent.findByIdAndUpdate(agent._id, {
                $set: { activeReferrals, updatedAt: new Date() }
            });
            console.log(`📊 Updated agent ${agent.username} active referrals to ${activeReferrals} after disconnect`);
        } catch (error) {
            console.error('Update agent active referrals on disconnect error:', error);
        }
    }

    startHeartbeatJob() {
        setInterval(() => {
            const now = Date.now();
            this.agentSockets.forEach((socket, agentId) => {
                if (socket.connected) {
                    socket.emit('agent:heartbeat', { timestamp: now });
                    const lastHeartbeat = this.agentHeartbeats.get(agentId) || 0;
                    if (now - lastHeartbeat > 60000) {
                        console.log(`⚠️ Agent ${agentId} not responding to heartbeats`);
                    }
                } else {
                    this.agentSockets.delete(agentId);
                    this.agentHeartbeats.delete(agentId);
                }
            });
        }, 25000);
    }

    async handleHeartbeatAck(socket, data) {
        try {
            if (!socket.agentId) return;
            const agentId = socket.agentId;
            const timestamp = data.timestamp || Date.now();
            this.agentHeartbeats.set(agentId, timestamp);
            if (this.commissionDebug) {
                console.log(`❤️ Heartbeat ack from agent ${agentId} at ${new Date(timestamp).toISOString()}`);
            }
            socket.emit('agent:heartbeat_ack', { timestamp: Date.now(), agentId });
        } catch (error) {
            console.error('Heartbeat ack error:', error);
        }
    }

    // ========== USER SEARCH & HELPERS (IMPROVED) ==========
    // 🛠️ FIXED: robust search with exact matches first, escaped regex
    async findUserByIdentifier(identifier) {
        try {
            const cleanId = identifier.replace(/^@/, '').trim();
            console.log(`🔍 [FIND USER] Searching for identifier: "${cleanId}"`);

            // 1. Exact match on userId (case-insensitive, but exact string)
            let user = await this.models.User.findOne({ userId: { $regex: `^${escapeRegex(cleanId)}$`, $options: 'i' } });
            if (user) return user;

            // 2. Exact match on telegramUsername (case-insensitive)
            user = await this.models.User.findOne({ telegramUsername: { $regex: `^${escapeRegex(cleanId)}$`, $options: 'i' } });
            if (user) return user;

            // 3. Exact match on userName
            user = await this.models.User.findOne({ userName: { $regex: `^${escapeRegex(cleanId)}$`, $options: 'i' } });
            if (user) return user;

            // 4. If cleanId is numeric, try tg_ prefix
            if (/^\d+$/.test(cleanId)) {
                const telegramId = `tg_${cleanId}`;
                user = await this.models.User.findOne({ userId: telegramId });
                if (user) return user;
            }

            // 5. Partial matches (only as fallback, limited to 5)
            const partialUsers = await this.models.User.find({
                $or: [
                    { userId: { $regex: escapeRegex(cleanId), $options: 'i' } },
                    { telegramUsername: { $regex: escapeRegex(cleanId), $options: 'i' } },
                    { userName: { $regex: escapeRegex(cleanId), $options: 'i' } }
                ]
            }).limit(5);
            if (partialUsers.length > 0) {
                return partialUsers[0];
            }

            console.log(`❌ [FIND USER] No user found for identifier: "${cleanId}"`);
            return null;
        } catch (error) {
            console.error('❌ [FIND USER] Error:', error);
            return null;
        }
    }

    // ========== MANUAL REFERRAL ASSIGNMENT (ATOMIC) ==========
    async handleManualReferralAssignmentByAgent(socket, data) {
        try {
            if (!socket.agentId) {
                socket.emit('agent:error', 'Not authenticated');
                return;
            }

            const { userIdentifier } = data;
            if (!userIdentifier) {
                socket.emit('agent:error', 'Player identifier is required');
                return;
            }

            const agent = await this.models.Agent.findById(socket.agentId);
            if (!agent) {
                socket.emit('agent:error', 'Agent not found');
                return;
            }

            const user = await this.findUserByIdentifier(userIdentifier);
            if (!user) {
                socket.emit('agent:error', `Player not found: "${userIdentifier}"`);
                return;
            }

            const updatedUser = await this.models.User.findOneAndUpdate(
                { userId: user.userId, agentId: null },
                {
                    $set: {
                        agentId: agent._id,
                        agentReferredAt: new Date(),
                        referredBy: 'manual'
                    }
                },
                { new: true }
            );

            if (!updatedUser) {
                const existingUser = await this.models.User.findOne({ userId: user.userId });
                if (existingUser.agentId) {
                    if (existingUser.agentId.toString() === agent._id.toString()) {
                        socket.emit('agent:error', `"${user.userName || user.userId}" is already your referral.`);
                    } else {
                        const currentAgent = await this.models.Agent.findById(existingUser.agentId);
                        socket.emit('agent:error', `Already assigned to ${currentAgent?.name || currentAgent?.username || 'another agent'}`);
                    }
                } else {
                    socket.emit('agent:error', 'User was just assigned to another agent. Please try again.');
                }
                return;
            }

            await this.models.Referral.findOneAndUpdate(
                { userId: user.userId },
                {
                    $setOnInsert: {
                        agentId: agent._id,
                        userId: user.userId,
                        userName: user.userName,
                        telegramUsername: user.telegramUsername,
                        referralMethod: 'manual',
                        status: 'active',
                        createdAt: new Date(),
                        updatedAt: new Date()
                    }
                },
                { upsert: true }
            );

            const actualReferralCount = await this.models.User.countDocuments({ agentId: agent._id });
            const activeReferrals = await this.models.User.countDocuments({ agentId: agent._id, isOnline: true });

            await this.models.Agent.findByIdAndUpdate(agent._id, {
                $set: {
                    totalReferrals: actualReferralCount,
                    activeReferrals,
                    updatedAt: new Date()
                }
            });

            socket.emit('agent:manualReferralSuccess', {
                success: true,
                message: `✅ Added ${updatedUser.userName || updatedUser.userId} as your referral!`,
                user: {
                    userId: updatedUser.userId,
                    userName: updatedUser.userName,
                    telegramUsername: updatedUser.telegramUsername || '',
                    balance: updatedUser.balance || 0,
                    totalWins: updatedUser.totalWins || 0,
                    totalBingos: updatedUser.totalBingos || 0,
                    totalWagered: updatedUser.totalWagered || 0,
                    joinedAt: updatedUser.joinedAt,
                    lastSeen: updatedUser.lastSeen,
                    isOnline: updatedUser.isOnline || false,
                    referredAt: updatedUser.agentReferredAt,
                    referredBy: 'manual'
                },
                agent: {
                    totalReferrals: actualReferralCount,
                    activeReferrals
                }
            });

            setTimeout(() => this.handleRefreshDashboard(socket), 500);
            console.log(`✅ Manual referral: ${updatedUser.userId} -> Agent ${agent.username}`);
        } catch (error) {
            console.error('Manual referral error:', error);
            socket.emit('agent:error', 'Failed to add referral: ' + error.message);
        }
    }

    // ========== BULK MANUAL REFERRAL ==========
    async handleBulkManualReferral(socket, data) {
        try {
            if (!socket.agentId) {
                socket.emit('agent:error', 'Not authenticated');
                return;
            }

            const { userIdentifiers } = data;
            if (!Array.isArray(userIdentifiers) || userIdentifiers.length === 0) {
                socket.emit('agent:error', 'Please provide at least one player identifier');
                return;
            }

            const agent = await this.models.Agent.findById(socket.agentId);
            if (!agent) {
                socket.emit('agent:error', 'Agent not found');
                return;
            }

            const maxBulkSize = 20;
            const identifiersToProcess = userIdentifiers.slice(0, maxBulkSize);

            const results = {
                totalProcessed: identifiersToProcess.length,
                success: 0,
                failed: 0,
                alreadyAssigned: 0,
                notFound: 0,
                details: []
            };

            for (const identifier of identifiersToProcess) {
                try {
                    const user = await this.findUserByIdentifier(identifier);
                    if (!user) {
                        results.notFound++;
                        results.details.push({ identifier, status: 'not_found' });
                        continue;
                    }

                    const updatedUser = await this.models.User.findOneAndUpdate(
                        { userId: user.userId, agentId: null },
                        {
                            $set: {
                                agentId: agent._id,
                                agentReferredAt: new Date(),
                                referredBy: 'bulk_manual'
                            }
                        },
                        { new: true }
                    );

                    if (!updatedUser) {
                        results.alreadyAssigned++;
                        results.details.push({ identifier, userId: user.userId, status: 'already_assigned' });
                        continue;
                    }

                    await this.models.Referral.findOneAndUpdate(
                        { userId: user.userId },
                        {
                            $setOnInsert: {
                                agentId: agent._id,
                                userId: user.userId,
                                userName: user.userName,
                                telegramUsername: user.telegramUsername,
                                referralMethod: 'bulk_manual',
                                status: 'active',
                                createdAt: new Date(),
                                updatedAt: new Date()
                            }
                        },
                        { upsert: true }
                    );

                    results.success++;
                    results.details.push({
                        identifier,
                        userId: user.userId,
                        userName: user.userName,
                        status: 'success'
                    });
                } catch (err) {
                    results.failed++;
                    results.details.push({ identifier, status: 'error', message: err.message });
                }
            }

            const actualReferralCount = await this.models.User.countDocuments({ agentId: agent._id });
            const activeReferrals = await this.models.User.countDocuments({ agentId: agent._id, isOnline: true });

            await this.models.Agent.findByIdAndUpdate(agent._id, {
                $set: {
                    totalReferrals: actualReferralCount,
                    activeReferrals,
                    updatedAt: new Date()
                }
            });

            socket.emit('agent:bulkManualReferralResult', {
                success: true,
                summary: results,
                agentStats: { totalReferrals: actualReferralCount, activeReferrals }
            });

            if (results.success > 0) {
                this.sendAgentNotification(agent._id, `✅ Bulk referrals: Added ${results.success} new players`, 'success');
                setTimeout(() => this.handleRefreshDashboard(socket), 1000);
            }

            console.log(`✅ Bulk manual referrals: ${results.success} added, ${results.failed} failed`);
        } catch (error) {
            console.error('Bulk manual referral error:', error);
            socket.emit('agent:error', 'Failed to process bulk referrals');
        }
    }

    // ========== REFERRAL LINK GENERATION ==========
    async handleGenerateReferralLink(socket) {
        try {
            if (!socket.agentId) {
                socket.emit('agent:error', 'Not authenticated');
                return;
            }

            const agent = await this.models.Agent.findById(socket.agentId);
            if (!agent) {
                socket.emit('agent:error', 'Agent not found');
                return;
            }

            if (!agent.referralCode) {
                agent.referralCode = `${agent.username}_${Date.now().toString(36)}`.toUpperCase();
                await agent.save();
            }

            const botUsername = process.env.BOT_USERNAME || 'Ethio_elite_games_bot';
            const referralLink = `https://t.me/${botUsername}?start=ref_${agent.referralCode}`;

            socket.emit('agent:referralLink', {
                success: true,
                referralCode: agent.referralCode,
                referralLink,
                message: 'Share this link with your friends'
            });

            console.log(`🔗 Referral link generated for ${agent.username}: ${referralLink}`);
        } catch (error) {
            console.error('Generate referral link error:', error);
            socket.emit('agent:error', 'Failed to generate referral link');
        }
    }

    // ========== PROCESS REFERRAL (FROM TELEGRAM) ==========
    async processReferral(userId, referralCode) {
        try {
            console.log(`🔍 Processing referral for ${userId} with code ${referralCode}`);

            const agent = await this.models.Agent.findOne({ referralCode, isActive: true });
            if (!agent) {
                console.log(`⚠️ No active agent found for referral code: ${referralCode}`);
                return false;
            }

            const updatedUser = await this.models.User.findOneAndUpdate(
                { userId, agentId: null },
                {
                    $set: {
                        agentId: agent._id,
                        agentReferredAt: new Date(),
                        referredBy: 'telegram_link'
                    }
                },
                { new: true }
            );

            if (!updatedUser) {
                console.log(`⚠️ User ${userId} already assigned or not found`);
                return false;
            }

            await this.models.Referral.findOneAndUpdate(
                { userId },
                {
                    $setOnInsert: {
                        agentId: agent._id,
                        userId,
                        userName: updatedUser.userName,
                        telegramUsername: updatedUser.telegramUsername,
                        referralMethod: 'telegram_link',
                        referralCode,
                        status: 'active',
                        createdAt: new Date(),
                        updatedAt: new Date()
                    }
                },
                { upsert: true }
            );

            const actualReferralCount = await this.models.User.countDocuments({ agentId: agent._id });
            const activeReferrals = await this.models.User.countDocuments({ agentId: agent._id, isOnline: true });
            await this.models.Agent.findByIdAndUpdate(agent._id, {
                $set: { totalReferrals: actualReferralCount, activeReferrals, updatedAt: new Date() }
            });

            this.sendAgentNotification(agent._id, `✅ New referral: ${updatedUser.userName || userId} joined via your link`, 'success');
            console.log(`✅ Referral successful: ${userId} -> Agent ${agent.username}`);
            return true;
        } catch (error) {
            console.error('Process referral error:', error);
            return false;
        }
    }

    async handleTelegramReferral(userId, referralCode) {
        return this.processReferral(userId, referralCode);
    }

    // ========== AGENT REPORT ==========
    async handleAgentReport(socket, data = {}) {
        try {
            if (!socket.agentId) {
                socket.emit('agent:error', 'Not authenticated');
                return;
            }

            const agent = await this.models.Agent.findById(socket.agentId);
            if (!agent) {
                socket.emit('agent:error', 'Agent not found');
                return;
            }

            const { period = 'month' } = data;
            let startDate = new Date();
            if (period === 'today') startDate.setHours(0, 0, 0, 0);
            else if (period === 'week') startDate.setDate(startDate.getDate() - 7);
            else if (period === 'month') startDate.setMonth(startDate.getMonth() - 1);
            else startDate = new Date(0);

            const commissions = await this.models.AgentCommission.find({
                agentId: agent._id,
                createdAt: { $gte: startDate },
                status: 'completed'
            }).sort({ createdAt: -1 });

            const referrals = await this.models.User.find({
                agentId: agent._id,
                agentReferredAt: { $gte: startDate }
            }).sort({ agentReferredAt: -1 });

            const totalCommission = commissions.reduce((sum, c) => sum + c.commissionAmount, 0);
            const bingoCommission = commissions.filter(c => c.gameType === 'BINGO').reduce((sum, c) => sum + c.commissionAmount, 0);
            const kenoCommission = commissions.filter(c => c.gameType === 'KENO').reduce((sum, c) => sum + c.commissionAmount, 0);

            socket.emit('agent:report', {
                period,
                startDate,
                summary: {
                    totalCommission,
                    bingoCommission,
                    kenoCommission,
                    totalGames: commissions.length,
                    bingoGames: commissions.filter(c => c.gameType === 'BINGO').length,
                    kenoGames: commissions.filter(c => c.gameType === 'KENO').length,
                    newReferrals: referrals.length
                },
                commissions: commissions.slice(0, 100).map(c => ({
                    id: c._id,
                    userId: c.userId,
                    gameType: c.gameType,
                    stake: c.stake,
                    winningAmount: c.winningAmount,
                    commissionAmount: c.commissionAmount,
                    createdAt: c.createdAt
                })),
                referrals: referrals.slice(0, 100).map(r => ({
                    userId: r.userId,
                    userName: r.userName,
                    telegramUsername: r.telegramUsername,
                    referredAt: r.agentReferredAt,
                    isOnline: r.isOnline
                }))
            });
        } catch (error) {
            console.error('Agent report error:', error);
            socket.emit('agent:error', 'Failed to generate report');
        }
    }

    // ========== AGENT WITHDRAWAL SYSTEM (FULLY FIXED) ==========
    async handleAgentWithdrawRequest(socket, data) {
        try {
            if (!socket.agentId) {
                socket.emit('agent:error', 'Not authenticated');
                return;
            }

            const { amount, phoneNumber } = data;
            if (!amount || amount < 100) {
                socket.emit('agent:error', 'Minimum withdrawal is 100 ETB');
                return;
            }

            const agent = await this.models.Agent.findById(socket.agentId);
            if (!agent) {
                socket.emit('agent:error', 'Agent not found');
                return;
            }

            if (agent.totalEarnings < amount) {
                socket.emit('agent:error', 'Insufficient earnings');
                return;
            }

            const withdrawal = new this.models.AgentTransaction({
                agentId: agent._id,
                type: 'WITHDRAWAL',
                amount: -amount,
                description: `Withdrawal request to ${phoneNumber}`,
                status: 'pending',
                createdAt: new Date()
            });
            await withdrawal.save();

            this.io.emit('admin:newAgentWithdrawal', {
                agentId: agent._id,
                agentName: agent.name,
                amount,
                phoneNumber,
                transactionId: withdrawal._id
            });

            socket.emit('agent:withdrawRequestSuccess', {
                message: 'Withdrawal request submitted. Admin will process it within 24 hours.',
                transactionId: withdrawal._id
            });

            console.log(`💰 Agent withdrawal request: ${agent.username} - ${amount} ETB`);
        } catch (error) {
            console.error('Agent withdrawal error:', error);
            socket.emit('agent:error', 'Failed to submit withdrawal request');
        }
    }

    async handleGetWithdrawalHistory(socket) {
        try {
            if (!socket.agentId) {
                socket.emit('agent:error', 'Not authenticated');
                return;
            }

            const withdrawals = await this.models.AgentTransaction.find({
                agentId: socket.agentId,
                type: 'WITHDRAWAL'
            }).sort({ createdAt: -1 }).limit(50);

            socket.emit('agent:withdrawalHistory', withdrawals.map(w => ({
                id: w._id,
                amount: -w.amount,
                status: w.status,
                description: w.description,
                createdAt: w.createdAt,
                processedAt: w.processedAt
            })));
        } catch (error) {
            console.error('Get withdrawal history error:', error);
            socket.emit('agent:error', 'Failed to load withdrawal history');
        }
    }

    // 🆕 NEW: Get all pending agent withdrawals (admin only)
    async getPendingAgentWithdrawals() {
        try {
            const withdrawals = await this.models.AgentTransaction.find({
                type: 'WITHDRAWAL',
                status: 'pending'
            })
                .populate('agentId', 'username name phoneNumber totalEarnings')
                .sort({ createdAt: 1 });
            return withdrawals.map(w => ({
                id: w._id,
                agentId: w.agentId._id,
                agentName: w.agentId.name,
                agentUsername: w.agentId.username,
                agentPhone: w.agentId.phoneNumber,
                amount: -w.amount,
                description: w.description,
                createdAt: w.createdAt,
                currentEarnings: w.agentId.totalEarnings
            }));
        } catch (error) {
            console.error('Get pending agent withdrawals error:', error);
            return [];
        }
    }

    // 🆕 NEW: Approve withdrawal – deduct earnings, mark completed
    async approveAgentWithdrawal(transactionId, adminId) {
        const session = await this.models.AgentTransaction.startSession();
        session.startTransaction();
        try {
            const withdrawal = await this.models.AgentTransaction.findById(transactionId)
                .populate('agentId')
                .session(session);
            if (!withdrawal || withdrawal.type !== 'WITHDRAWAL' || withdrawal.status !== 'pending') {
                await session.abortTransaction();
                session.endSession();
                throw new Error('Withdrawal not found or already processed');
            }

            const agent = withdrawal.agentId;
            const amount = -withdrawal.amount; // positive

            if (agent.totalEarnings < amount) {
                await session.abortTransaction();
                session.endSession();
                throw new Error('Agent has insufficient earnings now');
            }

            // Deduct earnings
            agent.totalEarnings -= amount;
            await agent.save({ session });

            withdrawal.status = 'completed';
            withdrawal.processedAt = new Date();
            withdrawal.processedBy = adminId;
            await withdrawal.save({ session });

            await session.commitTransaction();
            session.endSession();

            console.log(`💰 Withdrawal approved: ${agent.username} - ${amount} ETB`);

            // Notify agent
            this.sendAgentNotification(agent._id, `✅ Your withdrawal of ${amount} ETB has been approved.`, 'success');
            this.forceRefreshAgentDashboard(agent._id);

            return { success: true, agentId: agent._id, amount };
        } catch (error) {
            await session.abortTransaction();
            session.endSession();
            console.error('Approve agent withdrawal error:', error);
            throw error;
        }
    }

    // 🆕 NEW: Reject withdrawal – mark failed, no deduction
    async rejectAgentWithdrawal(transactionId, adminId) {
        try {
            const withdrawal = await this.models.AgentTransaction.findById(transactionId);
            if (!withdrawal || withdrawal.type !== 'WITHDRAWAL' || withdrawal.status !== 'pending') {
                throw new Error('Withdrawal not found or already processed');
            }

            withdrawal.status = 'failed';
            withdrawal.processedAt = new Date();
            withdrawal.processedBy = adminId;
            await withdrawal.save();

            console.log(`❌ Withdrawal rejected: ${withdrawal.agentId} - ${-withdrawal.amount} ETB`);

            // Notify agent
            this.sendAgentNotification(withdrawal.agentId, `❌ Your withdrawal of ${-withdrawal.amount} ETB has been rejected.`, 'error');

            return { success: true, agentId: withdrawal.agentId };
        } catch (error) {
            console.error('Reject agent withdrawal error:', error);
            throw error;
        }
    }

    // 🆕 NEW: Force refresh an agent's dashboard if online
    async forceRefreshAgentDashboard(agentId) {
        try {
            const agentSocket = this.agentSockets.get(agentId.toString());
            if (agentSocket) {
                await this.handleRefreshDashboard(agentSocket);
                return { success: true, message: 'Dashboard refreshed' };
            }
            return { success: false, message: 'Agent not online' };
        } catch (error) {
            console.error('Force refresh dashboard error:', error);
            return { success: false, error: error.message };
        }
    }

    // ========== SUPER ADMIN METHODS ==========
    async handleGetAllAgents(socket) {
        try {
            if (!socket.agentData?.isSuperAdmin) {
                socket.emit('agent:error', 'Unauthorized');
                return;
            }

            const agents = await this.models.Agent.find().sort({ createdAt: -1 }).select('-password');
            socket.emit('agent:allAgents', agents.map(a => ({
                id: a._id,
                username: a.username,
                name: a.name,
                phoneNumber: a.phoneNumber,
                commissionRateBingo: a.commissionRateBingo,
                commissionRateKeno: a.commissionRateKeno,
                totalEarnings: a.totalEarnings,
                totalReferrals: a.totalReferrals,
                activeReferrals: a.activeReferrals,
                isActive: a.isActive,
                isSuperAdmin: a.isSuperAdmin,
                createdAt: a.createdAt,
                lastLogin: a.lastLogin,
                referralCode: a.referralCode,
                authToken: a.authToken // only visible to super admin
            })));
        } catch (error) {
            console.error('Get all agents error:', error);
            socket.emit('agent:error', 'Failed to load agents');
        }
    }

    async handleCreateAgent(socket, data) {
        try {
            if (!socket.agentData?.isSuperAdmin) {
                socket.emit('agent:error', 'Unauthorized');
                return;
            }

            const { username, password, name, phoneNumber, bingoRate = 40, kenoRate = 10 } = data;
            if (!username || !password || !name) {
                socket.emit('agent:error', 'Username, password and name are required');
                return;
            }

            const existing = await this.models.Agent.findOne({ username: username.toLowerCase() });
            if (existing) {
                socket.emit('agent:error', 'Username already exists');
                return;
            }

            const hashedPassword = await bcrypt.hash(password, 10);
            const authToken = crypto.randomBytes(32).toString('hex');
            const agent = new this.models.Agent({
                username: username.toLowerCase(),
                password: hashedPassword,
                name,
                phoneNumber,
                commissionRateBingo: bingoRate,
                commissionRateKeno: kenoRate,
                referralCode: `${username}_${Date.now().toString(36)}`.toUpperCase(),
                authToken,
                isActive: true,
                isSuperAdmin: false,
                createdAt: new Date(),
                updatedAt: new Date()
            });
            await agent.save();

            socket.emit('agent:agentCreated', {
                success: true,
                agent: {
                    id: agent._id,
                    username: agent.username,
                    name: agent.name,
                    phoneNumber: agent.phoneNumber,
                    commissionRateBingo: agent.commissionRateBingo,
                    commissionRateKeno: agent.commissionRateKeno,
                    referralCode: agent.referralCode,
                    authToken: agent.authToken
                }
            });

            console.log(`➕ New agent created: ${agent.username} by ${socket.agentData?.username}`);
        } catch (error) {
            console.error('Create agent error:', error);
            socket.emit('agent:error', 'Failed to create agent');
        }
    }

    async handleUpdateAgent(socket, data) {
        try {
            if (!socket.agentData?.isSuperAdmin) {
                socket.emit('agent:error', 'Unauthorized');
                return;
            }

            const { agentId, name, phoneNumber, bingoRate, kenoRate, isActive, password } = data;
            const update = { updatedAt: new Date() };
            if (name) update.name = name;
            if (phoneNumber) update.phoneNumber = phoneNumber;
            if (bingoRate) update.commissionRateBingo = bingoRate;
            if (kenoRate) update.commissionRateKeno = kenoRate;
            if (typeof isActive === 'boolean') update.isActive = isActive;
            if (password) {
                update.password = await bcrypt.hash(password, 10);
            }

            const agent = await this.models.Agent.findByIdAndUpdate(agentId, { $set: update }, { new: true });
            if (!agent) {
                socket.emit('agent:error', 'Agent not found');
                return;
            }

            socket.emit('agent:agentUpdated', {
                success: true,
                agent: {
                    id: agent._id,
                    username: agent.username,
                    name: agent.name,
                    phoneNumber: agent.phoneNumber,
                    commissionRateBingo: agent.commissionRateBingo,
                    commissionRateKeno: agent.commissionRateKeno,
                    isActive: agent.isActive
                }
            });

            console.log(`✏️ Agent updated: ${agent.username} by ${socket.agentData?.username}`);
        } catch (error) {
            console.error('Update agent error:', error);
            socket.emit('agent:error', 'Failed to update agent');
        }
    }

    async handleDeleteAgent(socket, agentId) {
        try {
            if (!socket.agentData?.isSuperAdmin) {
                socket.emit('agent:error', 'Unauthorized');
                return;
            }

            const agent = await this.models.Agent.findById(agentId);
            if (!agent) {
                socket.emit('agent:error', 'Agent not found');
                return;
            }

            if (agent.isSuperAdmin) {
                socket.emit('agent:error', 'Cannot delete super admin');
                return;
            }

            await this.models.Agent.findByIdAndDelete(agentId);
            socket.emit('agent:agentDeleted', { success: true, agentId });
            console.log(`🗑️ Agent deleted: ${agent.username} by ${socket.agentData?.username}`);
        } catch (error) {
            console.error('Delete agent error:', error);
            socket.emit('agent:error', 'Failed to delete agent');
        }
    }

    // ========== COMMISSION SYSTEM (DUPLICATE PROTECTION) ==========
    async recordCommission(agentId, userId, gameType, stake, winningAmount, transactionId = null) {
        try {
            console.log(`💰 [COMMISSION START] agent: ${agentId}, user: ${userId}, game: ${gameType}, win: ${winningAmount}`);

            // 🛠️ FIXED: Check if this transaction was already processed
            if (transactionId && this.processedTransactions.has(transactionId)) {
                console.log(`⏭️ Skipping already processed transaction ${transactionId}`);
                return 0;
            }

            const agent = await this.models.Agent.findById(agentId);
            if (!agent || !agent.isActive) {
                console.log(`⚠️ Agent not found or inactive: ${agentId}`);
                return 0;
            }

            const user = await this.models.User.findOne({ userId });
            if (!user || !user.agentId || user.agentId.toString() !== agentId.toString()) {
                console.log(`⚠️ User ${userId} not assigned to agent ${agentId}`);
                return 0;
            }

            let commissionRate, commissionAmount;
            if (gameType === 'BINGO') {
                commissionRate = agent.commissionRateBingo;
                commissionAmount = (winningAmount * commissionRate) / 100;
            } else if (gameType === 'KENO') {
                commissionRate = agent.commissionRateKeno;
                commissionAmount = (winningAmount * commissionRate) / 100;
            } else {
                return 0;
            }

            if (commissionAmount < 0.01) commissionAmount = 0.01;

            // 🛠️ FIXED: Use transactionKey to enforce uniqueness at DB level
            const transactionKey = transactionId || `${userId}_${gameType}_${Date.now()}`;

            // Try to create commission record – duplicate key error will be caught
            const commission = new this.models.AgentCommission({
                agentId: agent._id,
                userId,
                userName: user.userName,
                telegramUsername: user.telegramUsername,
                gameType,
                stake,
                winningAmount,
                commissionRate,
                commissionAmount,
                status: 'completed',
                transactionKey,
                createdAt: new Date()
            });

            await commission.save();

            // Mark transaction as processed in memory
            if (transactionId) {
                this.processedTransactions.set(transactionId, Date.now());
                setTimeout(() => this.processedTransactions.delete(transactionId), 30 * 60 * 1000);
            }

            // Update user's total commission earned
            await this.models.User.findByIdAndUpdate(user._id, {
                $inc: { agentCommissionEarned: commissionAmount }
            });

            // Update agent earnings
            await this.models.Agent.findByIdAndUpdate(agent._id, {
                $inc: { totalEarnings: commissionAmount },
                $set: { lastCommissionDate: new Date(), updatedAt: new Date() }
            });

            // Create transaction record for agent
            await this.models.AgentTransaction.create({
                agentId: agent._id,
                type: 'COMMISSION',
                amount: commissionAmount,
                description: `${gameType} commission from referral ${userId.substring(0, 8)}...`,
                status: 'completed',
                createdAt: new Date()
            });

            // Update game transaction with agent info if applicable
            if (transactionId && transactionId.toString().length > 10) {
                await this.models.Transaction.findByIdAndUpdate(transactionId, {
                    $set: { agentId: agent._id, agentCommission: commissionAmount, commissionProcessed: true }
                }).catch(err => console.log('⚠️ Could not update transaction:', err.message));
            }

            // Real-time notification
            const agentSocket = this.agentSockets.get(agentId.toString());
            if (agentSocket) {
                agentSocket.emit('agent:newCommission', {
                    commissionId: commission._id,
                    userId,
                    userName: user.userName || 'Unknown',
                    telegramUsername: user.telegramUsername || '',
                    gameType,
                    stake,
                    winningAmount,
                    commissionAmount,
                    commissionRate,
                    timestamp: new Date()
                });
                setTimeout(() => this.handleRefreshDashboard(agentSocket), 500);
            }

            console.log(`✅ Commission recorded: ${agent.username} earned ${commissionAmount.toFixed(2)} ETB from ${gameType}`);
            return commissionAmount;
        } catch (error) {
            if (error.code === 11000) {
                console.log(`⚠️ Duplicate commission detected for key ${error.keyValue?.transactionKey} – skipping`);
                return 0;
            }
            console.error('❌ Record commission error:', error);
            return 0;
        }
    }

    async processBingoWin(userId, room, winningAmount, gameTransactionId = null) {
        try {
            const user = await this.models.User.findOne({ userId });
            if (!user || !user.agentId) return 0;
            const stake = room?.stake || 10;
            return await this.recordCommission(
                user.agentId,
                userId,
                'BINGO',
                stake,
                winningAmount,
                gameTransactionId || `bingo_${room?.roomId || Date.now()}`
            );
        } catch (error) {
            console.error('❌ Process Bingo win error:', error);
            return 0;
        }
    }

    async processKenoWin(userId, stake, winningAmount, gameTransactionId = null) {
        try {
            const user = await this.models.User.findOne({ userId });
            if (!user || !user.agentId) return 0;
            return await this.recordCommission(
                user.agentId,
                userId,
                'KENO',
                stake,
                winningAmount,
                gameTransactionId || `keno_${Date.now()}`
            );
        } catch (error) {
            console.error('❌ Process Keno win error:', error);
            return 0;
        }
    }

    async processGameTransaction(transaction) {
        try {
            const { userId, type, amount, room, stake } = transaction;
            if (type === 'BINGO_WIN') {
                return await this.processBingoWin(userId, { room, stake }, amount, transaction._id);
            } else if (type === 'KENO_WIN') {
                return await this.processKenoWin(userId, stake || 5, amount, transaction._id);
            }
            return 0;
        } catch (error) {
            console.error('Process game transaction error:', error);
            return 0;
        }
    }

    // ========== PENDING COMMISSIONS – FALLBACK JOB ==========
    async calculatePendingCommissions() {
        try {
            console.log('🔄 Calculating pending commissions for ALL unprocessed wins...');
            const winTransactions = await this.models.Transaction.find({
                type: { $in: ['BINGO_WIN', 'KENO_WIN'] },
                commissionProcessed: { $ne: true }
            }).limit(200);

            console.log(`📝 Found ${winTransactions.length} unprocessed win transactions`);

            for (const tx of winTransactions) {
                try {
                    const user = await this.models.User.findOne({ userId: tx.userId });
                    if (!user || !user.agentId) {
                        tx.commissionProcessed = true;
                        await tx.save();
                        continue;
                    }
                    const gameType = tx.type === 'BINGO_WIN' ? 'BINGO' : 'KENO';
                    const stake = tx.room || tx.stake || (gameType === 'BINGO' ? 10 : 5);
                    await this.recordCommission(
                        user.agentId,
                        user.userId,
                        gameType,
                        stake,
                        tx.amount,
                        tx._id.toString()
                    );
                    tx.commissionProcessed = true;
                    await tx.save();
                } catch (txError) {
                    console.error(`Error processing transaction ${tx._id}:`, txError);
                }
            }
            console.log('✅ Pending commissions calculation completed');
        } catch (error) {
            console.error('Calculate pending commissions error:', error);
        }
    }

    // ========== BACKGROUND JOBS ==========
    startCommissionCalculationJob() {
        setInterval(() => {
            this.calculatePendingCommissions();
        }, 2 * 60 * 1000); // 2 minutes
    }

    startCleanupJob() {
        setInterval(() => {
            const now = Date.now();
            // Clean processed transactions older than 30 minutes
            for (const [key, timestamp] of this.processedTransactions.entries()) {
                if (now - timestamp > 30 * 60 * 1000) this.processedTransactions.delete(key);
            }
            // Clean stale heartbeats older than 5 minutes
            for (const [agentId, timestamp] of this.agentHeartbeats.entries()) {
                if (now - timestamp > 5 * 60 * 1000) this.agentHeartbeats.delete(agentId);
            }
            // Clean processing claims older than 10 minutes
            for (const [key, timestamp] of this.processingClaims.entries()) {
                if (now - timestamp > 10 * 60 * 1000) this.processingClaims.delete(key);
            }
        }, 60 * 1000);
    }

    // ========== NOTIFICATIONS ==========
    async sendAgentNotification(agentId, message, type = 'info') {
        try {
            const agentSocket = this.agentSockets.get(agentId.toString());
            if (agentSocket) {
                agentSocket.emit('agent:notification', { message, type, timestamp: new Date() });
                return true;
            }
            return false;
        } catch (error) {
            console.error('Send agent notification error:', error);
            return false;
        }
    }

    // ========== SEARCH USERS FOR ASSIGNMENT ==========
    async handleSearchUsers(socket, data) {
        try {
            if (!socket.agentId) {
                socket.emit('agent:error', 'Not authenticated');
                return;
            }

            const { query, limit = 15 } = data;
            if (!query || query.trim().length < 1) {
                socket.emit('agent:searchUsersResult', { users: [], query });
                return;
            }

            const agent = await this.models.Agent.findById(socket.agentId);
            const cleanQuery = query.replace('@', '').trim().toLowerCase();
            const escaped = escapeRegex(cleanQuery);

            const searchConditions = [
                { userId: { $regex: escaped, $options: 'i' } },
                { telegramUsername: { $regex: escaped, $options: 'i' } },
                { userName: { $regex: escaped, $options: 'i' } }
            ];
            if (cleanQuery.startsWith('tg_') || /^\d+$/.test(cleanQuery)) {
                const telegramId = cleanQuery.startsWith('tg_') ? cleanQuery : `tg_${cleanQuery}`;
                searchConditions.push({ userId: new RegExp('^' + escapeRegex(telegramId) + '$', 'i') });
            }

            const users = await this.models.User.find({
                $and: [
                    { $or: searchConditions },
                    { $or: [{ agentId: { $exists: false } }, { agentId: null }, { agentId: { $ne: agent._id } }] }
                ]
            })
                .select('userId userName telegramUsername balance totalWagered totalWins totalBingos isOnline joinedAt lastSeen agentId phoneNumber referredBy agentReferredAt')
                .limit(parseInt(limit))
                .sort({ isOnline: -1, totalWins: -1, joinedAt: -1 });

            socket.emit('agent:searchUsersResult', {
                query,
                users: users.map(user => ({
                    userId: user.userId,
                    userName: user.userName || 'No Name',
                    telegramUsername: user.telegramUsername || '',
                    balance: user.balance || 0,
                    totalWins: user.totalWins || 0,
                    totalBingos: user.totalBingos || 0,
                    totalWagered: user.totalWagered || 0,
                    isOnline: user.isOnline || false,
                    phoneNumber: user.phoneNumber || '',
                    joinedAt: user.joinedAt,
                    lastSeen: user.lastSeen,
                    hasAgent: !!user.agentId,
                    canAdd: !user.agentId || user.agentId.toString() !== agent._id.toString(),
                    currentAgentId: user.agentId ? user.agentId.toString() : null,
                    referredBy: user.referredBy || null,
                    agentReferredAt: user.agentReferredAt || null
                }))
            });
        } catch (error) {
            console.error('Search users error:', error);
            socket.emit('agent:error', 'Search failed: ' + error.message);
        }
    }

    // ========== USER SUGGESTIONS ==========
    async handleGetUserSuggestions(socket) {
        try {
            if (!socket.agentId) {
                socket.emit('agent:error', 'Not authenticated');
                return;
            }

            const agent = await this.models.Agent.findById(socket.agentId);
            const potentialUsers = await this.models.User.find({
                $or: [{ agentId: { $exists: false } }, { agentId: null }],
                totalWins: { $gt: 0 }
            })
                .select('userId userName telegramUsername balance totalWins totalBingos isOnline totalWagered lastSeen referredBy agentReferredAt')
                .limit(20)
                .sort({ totalWins: -1, joinedAt: -1 });

            const recentUsers = await this.models.User.find({
                isOnline: true,
                $or: [{ agentId: { $exists: false } }, { agentId: null }]
            })
                .select('userId userName telegramUsername isOnline lastSeen totalWins referredBy agentReferredAt')
                .limit(10)
                .sort({ lastSeen: -1 });

            const highRollers = await this.models.User.find({
                $or: [{ agentId: { $exists: false } }, { agentId: null }],
                totalWagered: { $gt: 1000 }
            })
                .select('userId userName telegramUsername totalWagered totalWins isOnline referredBy agentReferredAt')
                .limit(10)
                .sort({ totalWagered: -1 });

            socket.emit('agent:userSuggestions', {
                potentialUsers: potentialUsers.map(user => ({ ...user.toObject(), suggestionReason: 'High activity player' })),
                recentUsers: recentUsers.map(user => ({ ...user.toObject(), suggestionReason: 'Recently active' })),
                highRollers: highRollers.map(user => ({ ...user.toObject(), suggestionReason: 'High roller' })),
                totalPotential: await this.models.User.countDocuments({
                    $or: [{ agentId: { $exists: false } }, { agentId: null }],
                    totalWins: { $gt: 0 }
                })
            });
        } catch (error) {
            console.error('Get user suggestions error:', error);
            socket.emit('agent:error', 'Failed to get suggestions');
        }
    }

    // ========== CHECK REFERRAL STATUS ==========
    async handleCheckReferralStatus(socket, data) {
        try {
            if (!socket.agentId) {
                socket.emit('agent:error', 'Not authenticated');
                return;
            }

            const { userIdentifier } = data;
            if (!userIdentifier) {
                socket.emit('agent:error', 'User identifier is required');
                return;
            }

            const agent = await this.models.Agent.findById(socket.agentId);
            const user = await this.findUserByIdentifier(userIdentifier);
            if (!user) {
                socket.emit('agent:error', 'User not found');
                return;
            }

            const userHasAgent = user.agentId ? user.agentId.toString() === agent._id.toString() : false;
            const referralRecord = await this.models.Referral.findOne({ userId: user.userId, agentId: agent._id });
            const agentReferrals = await this.models.User.countDocuments({ agentId: agent._id });

            socket.emit('agent:referralStatus', {
                user: {
                    userId: user.userId,
                    userName: user.userName,
                    telegramUsername: user.telegramUsername,
                    agentId: user.agentId,
                    hasAgent: !!user.agentId,
                    isAssignedToYou: userHasAgent,
                    agentReferredAt: user.agentReferredAt,
                    referredBy: user.referredBy
                },
                referral: {
                    exists: !!referralRecord,
                    method: referralRecord?.referralMethod,
                    createdAt: referralRecord?.createdAt
                },
                agentStats: {
                    totalReferrals: agent.totalReferrals,
                    actualReferralsInDB: agentReferrals
                },
                status: userHasAgent ? 'assigned' : 'not_assigned'
            });
        } catch (error) {
            console.error('Check referral status error:', error);
            socket.emit('agent:error', 'Failed to check referral status');
        }
    }

    // ========== UPDATE AGENT ACTIVE REFERRALS (CALL FROM GAME LOGIC) ==========
    async updateAgentActiveReferrals(userId, isOnline) {
        try {
            const user = await this.models.User.findOne({ userId });
            if (!user || !user.agentId) return;
            const agent = await this.models.Agent.findById(user.agentId);
            if (!agent) return;

            const delta = isOnline ? 1 : -1;
            await this.models.Agent.findByIdAndUpdate(agent._id, {
                $inc: { activeReferrals: delta },
                $set: { updatedAt: new Date() }
            });

            const agentSocket = this.agentSockets.get(agent._id.toString());
            if (agentSocket) {
                const updatedAgent = await this.models.Agent.findById(agent._id);
                agentSocket.emit('agent:activeReferralsUpdated', {
                    activeReferrals: updatedAgent.activeReferrals,
                    userId,
                    userName: user.userName,
                    isOnline
                });
            }
        } catch (error) {
            console.error('Update agent active referrals error:', error);
        }
    }

    // ========== VALIDATE AGENT CREDENTIALS ==========
    async validateAgentCredentials(username, password) {
        try {
            const agent = await this.models.Agent.findOne({ username: username.toLowerCase() });
            if (!agent || !agent.isActive) return null;
            const isValid = await bcrypt.compare(password, agent.password);
            return isValid ? { id: agent._id, username: agent.username, name: agent.name, isSuperAdmin: agent.isSuperAdmin } : null;
        } catch (error) {
            console.error('Validate agent credentials error:', error);
            return null;
        }
    }

    // ========== DEBUG FUNCTIONS ==========
    async debugFindUser(identifier) {
        return this.findUserByIdentifier(identifier); // reuse the improved method
    }

    async testUserDatabase(socket) {
        try {
            const users = await this.models.User.find({})
                .select('userId userName telegramUsername agentId totalWins totalBingos joinedAt isOnline referredBy agentReferredAt')
                .limit(20)
                .sort({ joinedAt: -1 });
            const totalUsers = await this.models.User.countDocuments();
            const usersWithoutAgents = await this.models.User.countDocuments({ $or: [{ agentId: { $exists: false } }, { agentId: null }] });
            const usersWithAgents = await this.models.User.countDocuments({ agentId: { $exists: true, $ne: null } });
            socket.emit('agent:testResult', { totalUsers, usersWithoutAgents, usersWithAgents, sampleUsers: users });
        } catch (error) {
            console.error('Test error:', error);
            socket.emit('agent:error', 'Test failed');
        }
    }

    async handleTestUserDatabase(socket) {
        await this.testUserDatabase(socket);
    }

    // ========== EMERGENCY SYNC ==========
    async emergencyFixReferralSync(agentId = null) {
        console.log('🚨 Starting emergency referral sync...');
        let query = {};
        if (agentId) query.agentId = agentId;
        const usersWithAgents = await this.models.User.find({ agentId: { $exists: true, $ne: null } });
        let created = 0, errors = 0;
        for (const user of usersWithAgents) {
            try {
                await this.models.Referral.findOneAndUpdate(
                    { userId: user.userId },
                    {
                        $setOnInsert: {
                            agentId: user.agentId,
                            userId: user.userId,
                            userName: user.userName,
                            telegramUsername: user.telegramUsername,
                            referralMethod: user.referredBy || 'emergency_sync',
                            status: 'active',
                            createdAt: user.agentReferredAt || new Date(),
                            updatedAt: new Date()
                        }
                    },
                    { upsert: true }
                );
                created++;
            } catch (error) {
                errors++;
            }
        }
        const agents = agentId ? [await this.models.Agent.findById(agentId)] : await this.models.Agent.find();
        for (const agent of agents) {
            if (agent) {
                const actualReferralCount = await this.models.User.countDocuments({ agentId: agent._id });
                await this.models.Agent.findByIdAndUpdate(agent._id, { $set: { totalReferrals: actualReferralCount } });
            }
        }
        console.log(`🚨 Emergency sync completed: ${created} records created, ${errors} errors`);
        return { success: true, created, errors };
    }

    async handleEmergencySync(socket) {
        try {
            if (!socket.agentId) {
                socket.emit('agent:error', 'Not authenticated');
                return;
            }
            const agent = await this.models.Agent.findById(socket.agentId);
            if (!agent) {
                socket.emit('agent:error', 'Agent not found');
                return;
            }
            const result = await this.emergencyFixReferralSync(agent._id);
            socket.emit('agent:emergencySyncResult', {
                success: result.success,
                created: result.created,
                errors: result.errors,
                message: `Emergency sync completed: ${result.created} created, ${result.errors} errors`
            });
            setTimeout(() => this.handleRefreshDashboard(socket), 1000);
        } catch (error) {
            console.error('Handle emergency sync error:', error);
            socket.emit('agent:error', 'Emergency sync failed: ' + error.message);
        }
    }

    // ========== REFERRAL TREE ==========
    async getAgentReferralTree(agentId, depth = 2) {
        try {
            const agent = await this.models.Agent.findById(agentId);
            if (!agent) return null;
            const directReferrals = await this.models.User.find({ agentId: agent._id })
                .select('userId userName telegramUsername balance totalWagered totalWins totalBingos isOnline joinedAt lastSeen agentReferredAt referredBy')
                .sort({ agentReferredAt: -1 })
                .limit(100);
            return {
                agent: { id: agent._id, name: agent.name, username: agent.username, totalEarnings: agent.totalEarnings },
                directReferrals: directReferrals.map(user => ({
                    userId: user.userId,
                    userName: user.userName || 'No Name',
                    telegramUsername: user.telegramUsername || '',
                    balance: user.balance || 0,
                    totalWagered: user.totalWagered || 0,
                    totalWins: user.totalWins || 0,
                    totalBingos: user.totalBingos || 0,
                    isOnline: user.isOnline || false,
                    joinedAt: user.joinedAt,
                    lastSeen: user.lastSeen,
                    referredAt: user.agentReferredAt,
                    referredBy: user.referredBy || 'unknown'
                })),
                stats: {
                    totalDirectReferrals: directReferrals.length,
                    activeDirectReferrals: directReferrals.filter(r => r.isOnline).length,
                    totalCommission: agent.totalEarnings
                }
            };
        } catch (error) {
            console.error('Get agent referral tree error:', error);
            return null;
        }
    }

    // ========== LEADERBOARD ==========
    async getAgentLeaderboard(limit = 10, period = 'month') {
        try {
            const now = new Date();
            let startDate;
            if (period === 'today') startDate = new Date(now.setHours(0, 0, 0, 0));
            else if (period === 'week') startDate = new Date(now.setDate(now.getDate() - 7));
            else startDate = new Date(now.setMonth(now.getMonth() - 1));

            const leaderboard = await this.models.AgentCommission.aggregate([
                { $match: { createdAt: { $gte: startDate }, status: 'completed' } },
                { $group: { _id: "$agentId", totalCommission: { $sum: "$commissionAmount" }, bingoCommission: { $sum: { $cond: [{ $eq: ["$gameType", "BINGO"] }, "$commissionAmount", 0] } }, kenoCommission: { $sum: { $cond: [{ $eq: ["$gameType", "KENO"] }, "$commissionAmount", 0] } }, totalGames: { $sum: 1 } } },
                { $lookup: { from: 'agents', localField: '_id', foreignField: '_id', as: 'agent' } },
                { $unwind: "$agent" },
                { $match: { "agent.isActive": true } },
                { $project: { agentId: "$_id", name: "$agent.name", username: "$agent.username", totalCommission: 1, bingoCommission: 1, kenoCommission: 1, totalGames: 1 } },
                { $sort: { totalCommission: -1 } },
                { $limit: limit }
            ]);
            return leaderboard;
        } catch (error) {
            console.error('Get agent leaderboard error:', error);
            return [];
        }
    }

    // ========== AGENT PERFORMANCE METRICS ==========
    async getAgentPerformanceMetrics(agentId) {
        try {
            const now = new Date();
            const today = new Date(now.setHours(0, 0, 0, 0));
            const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
            const monthAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);

            const [todayCommissions, weekCommissions, monthCommissions, allCommissions] = await Promise.all([
                this.models.AgentCommission.aggregate([{ $match: { agentId, status: 'completed', createdAt: { $gte: today } } }, { $group: { _id: null, total: { $sum: '$commissionAmount' }, count: { $sum: 1 } } }]),
                this.models.AgentCommission.aggregate([{ $match: { agentId, status: 'completed', createdAt: { $gte: weekAgo } } }, { $group: { _id: null, total: { $sum: '$commissionAmount' }, count: { $sum: 1 } } }]),
                this.models.AgentCommission.aggregate([{ $match: { agentId, status: 'completed', createdAt: { $gte: monthAgo } } }, { $group: { _id: null, total: { $sum: '$commissionAmount' }, count: { $sum: 1 } } }]),
                this.models.AgentCommission.aggregate([{ $match: { agentId, status: 'completed' } }, { $group: { _id: null, total: { $sum: '$commissionAmount' }, count: { $sum: 1 } } }])
            ]);

            const agent = await this.models.Agent.findById(agentId);
            const activeReferrals = await this.models.User.countDocuments({ agentId, isOnline: true });

            return {
                today: { commission: todayCommissions[0]?.total || 0, games: todayCommissions[0]?.count || 0 },
                week: { commission: weekCommissions[0]?.total || 0, games: weekCommissions[0]?.count || 0 },
                month: { commission: monthCommissions[0]?.total || 0, games: monthCommissions[0]?.count || 0 },
                allTime: { commission: allCommissions[0]?.total || 0, games: allCommissions[0]?.count || 0 },
                agent: {
                    name: agent?.name || 'Unknown',
                    totalEarnings: agent?.totalEarnings || 0,
                    totalReferrals: agent?.totalReferrals || 0,
                    activeReferrals,
                    commissionRateBingo: agent?.commissionRateBingo || 40,
                    commissionRateKeno: agent?.commissionRateKeno || 10
                }
            };
        } catch (error) {
            console.error('Get agent performance metrics error:', error);
            return null;
        }
    }

    // ========== ADMIN MANUAL REFERRAL ASSIGNMENT ==========
    async handleManualReferralAssignment(socket, data) {
        try {
            if (!socket.agentData?.isSuperAdmin) {
                socket.emit('agent:error', 'Unauthorized - Admin access required');
                return;
            }

            const { userId, agentId } = data;
            if (!userId || !agentId) {
                socket.emit('agent:error', 'User ID and Agent ID are required');
                return;
            }

            const agent = await this.models.Agent.findById(agentId);
            if (!agent || !agent.isActive) {
                socket.emit('agent:error', 'Agent not found or inactive');
                return;
            }

            const user = await this.findUserByIdentifier(userId);
            if (!user) {
                socket.emit('agent:error', 'User not found');
                return;
            }

            const updatedUser = await this.models.User.findOneAndUpdate(
                { userId: user.userId, agentId: null },
                {
                    $set: {
                        agentId: agent._id,
                        agentReferredAt: new Date(),
                        referredBy: 'admin_assigned'
                    }
                },
                { new: true }
            );

            if (!updatedUser) {
                socket.emit('agent:error', 'User already assigned to another agent');
                return;
            }

            await this.models.Referral.findOneAndUpdate(
                { userId: user.userId },
                {
                    $setOnInsert: {
                        agentId: agent._id,
                        userId: user.userId,
                        userName: user.userName,
                        telegramUsername: user.telegramUsername,
                        referralMethod: 'admin_assigned',
                        status: 'active',
                        createdAt: new Date(),
                        updatedAt: new Date()
                    }
                },
                { upsert: true }
            );

            const actualReferralCount = await this.models.User.countDocuments({ agentId: agent._id });
            const activeReferrals = await this.models.User.countDocuments({ agentId: agent._id, isOnline: true });
            await this.models.Agent.findByIdAndUpdate(agent._id, {
                $set: { totalReferrals: actualReferralCount, activeReferrals, updatedAt: new Date() }
            });

            socket.emit('agent:manualAssignmentSuccess', {
                success: true,
                message: 'User assigned to agent successfully',
                userId: updatedUser.userId,
                userName: updatedUser.userName,
                telegramUsername: updatedUser.telegramUsername || '',
                agentId: agent._id,
                agentName: agent.name,
                agentUsername: agent.username
            });

            const agentSocket = this.agentSockets.get(agent._id.toString());
            if (agentSocket) {
                agentSocket.emit('agent:newReferral', {
                    userId: updatedUser.userId,
                    userName: updatedUser.userName,
                    telegramUsername: updatedUser.telegramUsername || '',
                    timestamp: new Date(),
                    assignedBy: socket.agentData?.username || 'Admin'
                });
                setTimeout(() => this.handleRefreshDashboard(agentSocket), 1000);
            }

            console.log(`✅ Manual assignment (admin): ${updatedUser.userId} -> Agent ${agent.username}`);
        } catch (error) {
            console.error('Manual referral assignment error:', error);
            socket.emit('agent:error', 'Failed to assign user to agent');
        }
    }

    // ========== GET DETAILED REFERRAL INFO ==========
    async getDetailedReferralInfo(socket, data) {
        try {
            if (!socket.agentId) {
                socket.emit('agent:error', 'Not authenticated');
                return;
            }

            const { userId } = data;
            if (!userId) {
                socket.emit('agent:error', 'User ID is required');
                return;
            }

            const user = await this.models.User.findOne({ userId });
            if (!user) {
                socket.emit('agent:error', 'User not found');
                return;
            }

            const agent = await this.models.Agent.findById(socket.agentId);
            const isAssigned = user.agentId && user.agentId.toString() === agent._id.toString();
            const referralRecord = await this.models.Referral.findOne({ userId: user.userId, agentId: agent._id });
            const commissions = await this.models.AgentCommission.find({ agentId: agent._id, userId: user.userId })
                .sort({ createdAt: -1 }).limit(20);

            socket.emit('agent:detailedReferralInfo', {
                user: {
                    userId: user.userId,
                    userName: user.userName,
                    telegramUsername: user.telegramUsername,
                    balance: user.balance,
                    totalWins: user.totalWins,
                    totalBingos: user.totalBingos,
                    totalWagered: user.totalWagered,
                    isOnline: user.isOnline,
                    joinedAt: user.joinedAt,
                    lastSeen: user.lastSeen
                },
                assignment: {
                    isAssigned,
                    agentId: user.agentId,
                    referredBy: user.referredBy,
                    agentReferredAt: user.agentReferredAt
                },
                referralRecord: referralRecord ? {
                    id: referralRecord._id,
                    referralMethod: referralRecord.referralMethod,
                    status: referralRecord.status,
                    createdAt: referralRecord.createdAt,
                    updatedAt: referralRecord.updatedAt
                } : null,
                commissions: commissions.map(comm => ({
                    gameType: comm.gameType,
                    stake: comm.stake,
                    winningAmount: comm.winningAmount,
                    commissionRate: comm.commissionRate,
                    commissionAmount: comm.commissionAmount,
                    createdAt: comm.createdAt
                })),
                totalCommissionEarned: commissions.reduce((sum, comm) => sum + comm.commissionAmount, 0)
            });
        } catch (error) {
            console.error('Get detailed referral info error:', error);
            socket.emit('agent:error', 'Failed to get detailed info');
        }
    }

    // ========== UPDATE COMMISSION RATES ==========
    async updateAgentCommissionRates(agentId, bingoRate, kenoRate) {
        try {
            const agent = await this.models.Agent.findByIdAndUpdate(
                agentId,
                {
                    $set: {
                        commissionRateBingo: bingoRate || 40,
                        commissionRateKeno: kenoRate || 10,
                        updatedAt: new Date()
                    }
                },
                { new: true }
            );
            if (!agent) return { success: false, message: 'Agent not found' };
            return {
                success: true,
                message: 'Commission rates updated successfully',
                agent: {
                    id: agent._id,
                    name: agent.name,
                    commissionRateBingo: agent.commissionRateBingo,
                    commissionRateKeno: agent.commissionRateKeno
                }
            };
        } catch (error) {
            console.error('Update agent commission rates error:', error);
            return { success: false, message: error.message };
        }
    }

    // ========== PROCESS PENDING WITHDRAWALS (ADMIN) ==========
    async processPendingWithdrawals(socket, data) {
        try {
            if (!socket.agentData?.isSuperAdmin) {
                socket.emit('agent:error', 'Unauthorized - Admin access required');
                return;
            }

            const { transactionIds } = data;
            if (!Array.isArray(transactionIds) || transactionIds.length === 0) {
                socket.emit('agent:error', 'No transactions specified');
                return;
            }

            let processed = 0, failed = 0;
            for (const transactionId of transactionIds) {
                try {
                    const transaction = await this.models.AgentTransaction.findById(transactionId);
                    if (!transaction || transaction.type !== 'WITHDRAWAL' || transaction.status !== 'pending') {
                        failed++;
                        continue;
                    }
                    transaction.status = 'completed';
                    transaction.processedAt = new Date();
                    transaction.processedBy = socket.agentId;
                    await transaction.save();
                    processed++;
                } catch (err) {
                    failed++;
                }
            }

            socket.emit('agent:withdrawalsProcessed', { message: `Processed ${processed} withdrawals, ${failed} failed`, processed, failed });
            console.log(`💰 Processed ${processed} withdrawals by admin ${socket.agentData?.username}`);
        } catch (error) {
            console.error('Process pending withdrawals error:', error);
            socket.emit('agent:error', 'Failed to process withdrawals');
        }
    }

    // ========== SYSTEM ANALYTICS (ADMIN) ==========
    async getSystemAnalytics(socket) {
        try {
            if (!socket.agentData?.isSuperAdmin) {
                socket.emit('agent:error', 'Unauthorized - Admin access required');
                return;
            }

            const now = new Date();
            const today = new Date(now.setHours(0, 0, 0, 0));
            const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
            const monthAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);

            const totalAgents = await this.models.Agent.countDocuments();
            const activeAgents = await this.models.Agent.countDocuments({ isActive: true });
            const newAgentsThisWeek = await this.models.Agent.countDocuments({ createdAt: { $gte: weekAgo } });

            const todayCommissions = await this.models.AgentCommission.aggregate([
                { $match: { createdAt: { $gte: today }, status: 'completed' } },
                { $group: { _id: null, total: { $sum: '$commissionAmount' }, count: { $sum: 1 } } }
            ]);
            const weekCommissions = await this.models.AgentCommission.aggregate([
                { $match: { createdAt: { $gte: weekAgo }, status: 'completed' } },
                { $group: { _id: null, total: { $sum: '$commissionAmount' }, count: { $sum: 1 } } }
            ]);
            const monthCommissions = await this.models.AgentCommission.aggregate([
                { $match: { createdAt: { $gte: monthAgo }, status: 'completed' } },
                { $group: { _id: null, total: { $sum: '$commissionAmount' }, count: { $sum: 1 } } }
            ]);

            const gameBreakdown = await this.models.AgentCommission.aggregate([
                { $match: { createdAt: { $gte: monthAgo }, status: 'completed' } },
                { $group: { _id: '$gameType', totalCommission: { $sum: '$commissionAmount' }, totalGames: { $sum: 1 }, avgCommission: { $avg: '$commissionAmount' } } }
            ]);

            const topAgents = await this.models.AgentCommission.aggregate([
                { $match: { createdAt: { $gte: monthAgo }, status: 'completed' } },
                { $group: { _id: '$agentId', totalCommission: { $sum: '$commissionAmount' }, totalGames: { $sum: 1 } } },
                { $sort: { totalCommission: -1 } },
                { $limit: 10 },
                { $lookup: { from: 'agents', localField: '_id', foreignField: '_id', as: 'agent' } },
                { $unwind: '$agent' },
                { $project: { agentId: '$_id', agentName: '$agent.name', agentUsername: '$agent.username', totalCommission: 1, totalGames: 1, avgCommission: { $divide: ['$totalCommission', '$totalGames'] } } }
            ]);

            const pendingWithdrawals = await this.models.AgentTransaction.aggregate([
                { $match: { type: 'WITHDRAWAL', status: 'pending' } },
                { $group: { _id: null, count: { $sum: 1 }, total: { $sum: { $abs: '$amount' } } } }
            ]);
            const completedWithdrawals = await this.models.AgentTransaction.aggregate([
                { $match: { type: 'WITHDRAWAL', status: 'completed', createdAt: { $gte: monthAgo } } },
                { $group: { _id: null, count: { $sum: 1 }, total: { $sum: { $abs: '$amount' } } } }
            ]);

            socket.emit('agent:systemAnalytics', {
                agents: { total: totalAgents, active: activeAgents, newThisWeek: newAgentsThisWeek, inactive: totalAgents - activeAgents },
                commissions: {
                    today: { total: todayCommissions[0]?.total || 0, count: todayCommissions[0]?.count || 0 },
                    week: { total: weekCommissions[0]?.total || 0, count: weekCommissions[0]?.count || 0 },
                    month: { total: monthCommissions[0]?.total || 0, count: monthCommissions[0]?.count || 0 }
                },
                gameBreakdown,
                topAgents,
                withdrawals: {
                    pending: { count: pendingWithdrawals[0]?.count || 0, total: pendingWithdrawals[0]?.total || 0 },
                    completed: { count: completedWithdrawals[0]?.count || 0, total: completedWithdrawals[0]?.total || 0 }
                },
                timestamp: new Date()
            });
        } catch (error) {
            console.error('Get system analytics error:', error);
            socket.emit('agent:error', 'Failed to get system analytics');
        }
    }

    // ========== EXPORT AGENT DATA (ADMIN) ==========
    async exportAgentData(socket, data) {
        try {
            if (!socket.agentData?.isSuperAdmin) {
                socket.emit('agent:error', 'Unauthorized - Admin access required');
                return;
            }

            const { agentId, startDate, endDate } = data;
            const start = new Date(startDate);
            const end = new Date(endDate);
            end.setHours(23, 59, 59, 999);

            const agent = await this.models.Agent.findById(agentId);
            if (!agent) {
                socket.emit('agent:error', 'Agent not found');
                return;
            }

            const commissions = await this.models.AgentCommission.find({
                agentId: agent._id,
                createdAt: { $gte: start, $lte: end },
                status: 'completed'
            }).sort({ createdAt: -1 });

            const referrals = await this.models.User.find({
                agentId: agent._id,
                agentReferredAt: { $gte: start, $lte: end }
            }).sort({ agentReferredAt: -1 });

            const withdrawals = await this.models.AgentTransaction.find({
                agentId: agent._id,
                type: 'WITHDRAWAL',
                createdAt: { $gte: start, $lte: end }
            }).sort({ createdAt: -1 });

            const exportData = {
                agent: {
                    id: agent._id,
                    name: agent.name,
                    username: agent.username,
                    commissionRateBingo: agent.commissionRateBingo,
                    commissionRateKeno: agent.commissionRateKeno,
                    totalEarnings: agent.totalEarnings,
                    totalReferrals: agent.totalReferrals
                },
                period: { startDate: start, endDate: end },
                commissions: commissions.map(comm => ({
                    date: comm.createdAt,
                    gameType: comm.gameType,
                    userId: comm.userId,
                    stake: comm.stake,
                    winningAmount: comm.winningAmount,
                    commissionRate: comm.commissionRate,
                    commissionAmount: comm.commissionAmount
                })),
                referrals: referrals.map(ref => ({
                    date: ref.agentReferredAt,
                    userId: ref.userId,
                    userName: ref.userName,
                    telegramUsername: ref.telegramUsername || '',
                    totalWins: ref.totalWins,
                    totalWagered: ref.totalWagered,
                    referredBy: ref.referredBy || 'unknown'
                })),
                withdrawals: withdrawals.map(w => ({
                    date: w.createdAt,
                    amount: -w.amount,
                    status: w.status,
                    description: w.description
                })),
                summary: {
                    totalCommissions: commissions.reduce((sum, c) => sum + c.commissionAmount, 0),
                    totalReferrals: referrals.length,
                    totalWithdrawals: withdrawals.reduce((sum, w) => sum + (-w.amount), 0)
                }
            };

            socket.emit('agent:exportData', exportData);
            console.log(`📤 Exported data for agent ${agent.username}`);
        } catch (error) {
            console.error('Export agent data error:', error);
            socket.emit('agent:error', 'Failed to export agent data');
        }
    }

    // ========== CHECK COMMISSION STATUS (DEBUG) ==========
    async checkCommissionStatus(socket, data) {
        try {
            const matchQuery = {};
            if (data.userId) matchQuery.userId = data.userId;
            if (data.gameType) matchQuery.gameType = data.gameType;
            if (data.startDate || data.endDate) {
                matchQuery.createdAt = {};
                if (data.startDate) matchQuery.createdAt.$gte = new Date(data.startDate);
                if (data.endDate) matchQuery.createdAt.$lte = new Date(data.endDate);
            }

            const commissions = await this.models.AgentCommission.find(matchQuery)
                .sort({ createdAt: -1 })
                .limit(50)
                .populate('agentId', 'username name')
                .populate('userId', 'userId userName agentId');

            const stats = await this.models.AgentCommission.aggregate([
                { $match: matchQuery },
                { $group: { _id: null, totalCommissions: { $sum: 1 }, totalAmount: { $sum: '$commissionAmount' }, avgCommission: { $avg: '$commissionAmount' } } }
            ]);

            socket.emit('agent:commissionStatus', {
                commissions: commissions.map(comm => ({
                    id: comm._id,
                    userId: comm.userId?.userId,
                    userName: comm.userId?.userName,
                    agentId: comm.agentId?._id,
                    agentName: comm.agentId?.name,
                    gameType: comm.gameType,
                    stake: comm.stake,
                    winningAmount: comm.winningAmount,
                    commissionAmount: comm.commissionAmount,
                    commissionRate: comm.commissionRate,
                    createdAt: comm.createdAt
                })),
                stats: stats[0] || { totalCommissions: 0, totalAmount: 0, avgCommission: 0 },
                processedTransactions: Array.from(this.processedTransactions.entries()).slice(0, 20)
            });
        } catch (error) {
            console.error('Check commission status error:', error);
            socket.emit('agent:error', 'Failed to check commission status');
        }
    }

    // ========== GET CONNECTION STATS ==========
    getConnectionStats() {
        return {
            connectedAgents: this.agentSockets.size,
            totalHeartbeats: this.agentHeartbeats.size,
            socketIds: Array.from(this.agentSockets.keys()),
            timestamp: new Date()
        };
    }

    // ========== AGENT STATISTICS (FOR ADMIN DASHBOARD) ==========
    async getAgentStatistics() {
        try {
            const totalAgents = await this.models.Agent.countDocuments();
            const activeAgents = await this.models.Agent.countDocuments({ isActive: true });
            const newAgentsThisWeek = await this.models.Agent.countDocuments({
                createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
            });

            const todayCommissions = await this.models.AgentCommission.aggregate([
                { $match: { createdAt: { $gte: new Date().setHours(0, 0, 0, 0) }, status: 'completed' } },
                { $group: { _id: null, total: { $sum: '$commissionAmount' }, count: { $sum: 1 } } }
            ]);
            const weekCommissions = await this.models.AgentCommission.aggregate([
                { $match: { createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }, status: 'completed' } },
                { $group: { _id: null, total: { $sum: '$commissionAmount' }, count: { $sum: 1 } } }
            ]);
            const monthCommissions = await this.models.AgentCommission.aggregate([
                { $match: { createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }, status: 'completed' } },
                { $group: { _id: null, total: { $sum: '$commissionAmount' }, count: { $sum: 1 } } }
            ]);

            const gameBreakdown = await this.models.AgentCommission.aggregate([
                { $match: { createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }, status: 'completed' } },
                { $group: { _id: '$gameType', totalCommission: { $sum: '$commissionAmount' }, totalGames: { $sum: 1 }, avgCommission: { $avg: '$commissionAmount' } } }
            ]);

            const topAgents = await this.models.AgentCommission.aggregate([
                { $match: { createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }, status: 'completed' } },
                { $group: { _id: '$agentId', totalCommission: { $sum: '$commissionAmount' }, totalGames: { $sum: 1 } } },
                { $sort: { totalCommission: -1 } },
                { $limit: 10 },
                { $lookup: { from: 'agents', localField: '_id', foreignField: '_id', as: 'agent' } },
                { $unwind: '$agent' },
                { $project: { agentId: '$_id', agentName: '$agent.name', agentUsername: '$agent.username', totalCommission: 1, totalGames: 1, avgCommission: { $divide: ['$totalCommission', '$totalGames'] } } }
            ]);

            const pendingWithdrawals = await this.models.AgentTransaction.aggregate([
                { $match: { type: 'WITHDRAWAL', status: 'pending' } },
                { $group: { _id: null, count: { $sum: 1 }, total: { $sum: { $abs: '$amount' } } } }
            ]);
            const completedWithdrawals = await this.models.AgentTransaction.aggregate([
                { $match: { type: 'WITHDRAWAL', status: 'completed', createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } } },
                { $group: { _id: null, count: { $sum: 1 }, total: { $sum: { $abs: '$amount' } } } }
            ]);

            const totalReferrals = await this.models.User.countDocuments({ agentId: { $exists: true, $ne: null } });

            return {
                agents: { total: totalAgents, active: activeAgents, newThisWeek: newAgentsThisWeek, inactive: totalAgents - activeAgents },
                commissions: {
                    today: { total: todayCommissions[0]?.total || 0, count: todayCommissions[0]?.count || 0 },
                    week: { total: weekCommissions[0]?.total || 0, count: weekCommissions[0]?.count || 0 },
                    month: { total: monthCommissions[0]?.total || 0, count: monthCommissions[0]?.count || 0 }
                },
                gameBreakdown,
                topAgents,
                withdrawals: {
                    pending: { count: pendingWithdrawals[0]?.count || 0, total: pendingWithdrawals[0]?.total || 0 },
                    completed: { count: completedWithdrawals[0]?.count || 0, total: completedWithdrawals[0]?.total || 0 }
                },
                referrals: totalReferrals
            };
        } catch (error) {
            console.error('Get agent statistics error:', error);
            return null;
        }
    }

    // ========== GET TOTAL AGENT EARNINGS ==========
    async getTotalAgentEarnings() {
        try {
            const result = await this.models.Agent.aggregate([
                { $match: { isActive: true } },
                { $group: { _id: null, total: { $sum: '$totalEarnings' } } }
            ]);
            return result[0]?.total || 0;
        } catch (error) {
            console.error('Get total agent earnings error:', error);
            return 0;
        }
    }

    // ========== CLEANUP ==========
    async cleanup() {
        console.log('🧹 Cleaning up agent system...');
        this.agentSockets.clear();
        this.agentHeartbeats.clear();
        this.processingClaims.clear();
        this.processedTransactions.clear();
        console.log('✅ Agent system cleanup completed');
    }

    // ========== SYSTEM STATUS ==========
    getSystemStatus() {
        return {
            totalAgents: this.agentSockets.size,
            processingClaims: this.processingClaims.size,
            processedTransactions: this.processedTransactions.size,
            agentHeartbeats: this.agentHeartbeats.size,
            isInitialized: true
        };
    }
}

module.exports = ManualAgentSystem;
