// agent-logic.js - Manual Agent/Referral System for Elite Games
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

class ManualAgentSystem {
  constructor(io, models) {
    this.io = io;
    this.models = models;
    this.agentSockets = new Map(); // agentId -> socket
    this.commissionRates = {
      BINGO: 40, // 40% commission from Bingo wins
      KENO: 10   // 10% commission from Keno wins
    };
    this.processingClaims = new Map(); // user-room combo -> timestamp
    this.roomWinners = new Map(); // room-stake -> winnerId
    this.processedTransactions = new Map(); // transactionId -> timestamp
    this.commissionDebug = true; // Enable detailed commission logging
    this.agentHeartbeats = new Map(); // agentId -> lastHeartbeat
  }

  async initialize() {
    console.log('✅ Manual Agent system initializing...');
    await this.ensureAdminAgent();
    // Start background jobs
    this.startCommissionCalculationJob();
    this.startCleanupJob();
    this.startHeartbeatJob(); // ADDED: Heartbeat mechanism
    console.log('👑 Manual Agent system ready with 40% Bingo and 10% Keno commissions');
  }

  // Set game logic references from server.js
  setGameLogic(gameLogic) {
    this.gameLogic = gameLogic;
    console.log('🎮 Bingo game logic connected to agent system');
  }

  setKenoLogic(kenoLogic) {
    this.kenoLogic = kenoLogic;
    console.log('🎰 Keno game logic connected to agent system');
  }

  async ensureAdminAgent() {
    try {
      const adminExists = await this.models.Agent.findOne({ username: 'admin' });
      if (!adminExists) {
        const hashedPassword = await bcrypt.hash('admin123', 10);
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

  // Agent login
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

      // Store agent info in socket
      socket.agentId = agent._id.toString();
      socket.agentData = {
        id: agent._id,
        username: agent.username,
        name: agent.name,
        isSuperAdmin: agent.isSuperAdmin
      };

      this.agentSockets.set(agent._id.toString(), socket);
      this.agentHeartbeats.set(agent._id.toString(), Date.now());

      // Update last login
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
        phoneNumber: agent.phoneNumber || ''
      });

      console.log(`👤 Agent logged in: ${agent.username} (Super Admin: ${agent.isSuperAdmin})`);
    } catch (error) {
      console.error('Agent login error:', error);
      socket.emit('agent:loginError', 'Login failed');
    }
  }

  // NEW: Agent logout
  async handleAgentLogout(socket, data) {
    try {
      if (!socket.agentId) {
        socket.emit('agent:logoutError', 'Not authenticated');
        return;
      }

      const agentId = socket.agentId;
      const agentUsername = socket.agentData?.username || 'Unknown';
      
      // Remove from agent sockets map
      this.agentSockets.delete(agentId);
      this.agentHeartbeats.delete(agentId);
      
      // Clear socket agent data
      socket.agentId = null;
      socket.agentData = null;
      
      socket.emit('agent:logoutSuccess', {
        message: 'Logged out successfully',
        timestamp: new Date()
      });

      console.log(`👤 Agent logged out: ${agentUsername} (ID: ${agentId})`);
      
    } catch (error) {
      console.error('Agent logout error:', error);
      socket.emit('agent:logoutError', 'Logout failed');
    }
  }

  // NEW: Start heartbeat job
  startHeartbeatJob() {
    setInterval(() => {
      const now = Date.now();
      // Send heartbeat to all connected agents
      this.agentSockets.forEach((socket, agentId) => {
        if (socket.connected) {
          socket.emit('agent:heartbeat', { timestamp: now });
          
          // Check if agent is still responsive (last heartbeat within 60 seconds)
          const lastHeartbeat = this.agentHeartbeats.get(agentId) || 0;
          if (now - lastHeartbeat > 60000) {
            console.log(`⚠️ Agent ${agentId} not responding to heartbeats`);
            // Optionally mark as inactive or take action
          }
        } else {
          // Clean up disconnected sockets
          this.agentSockets.delete(agentId);
          this.agentHeartbeats.delete(agentId);
        }
      });
    }, 25000); // 25 seconds
  }

  // NEW: Handle heartbeat acknowledgement
  async handleHeartbeatAck(socket, data) {
    try {
      if (!socket.agentId) return;
      
      const agentId = socket.agentId;
      const timestamp = data.timestamp || Date.now();
      
      // Update last heartbeat timestamp
      this.agentHeartbeats.set(agentId, timestamp);
      
      if (this.commissionDebug) {
        console.log(`❤️ Heartbeat ack from agent ${agentId} at ${new Date(timestamp).toISOString()}`);
      }
      
      // Send acknowledgement back
      socket.emit('agent:heartbeat_ack', { 
        timestamp: Date.now(),
        agentId: agentId 
      });
    } catch (error) {
      console.error('Heartbeat ack error:', error);
    }
  }

  // Verify agent token for auto login
  async handleVerifyAgentToken(socket, data) {
    try {
      const { token } = data;
      
      if (!token) {
        socket.emit('agent:tokenInvalid');
        return;
      }

      const agent = await this.models.Agent.findById(token);
      if (!agent) {
        socket.emit('agent:tokenInvalid');
        return;
      }

      if (!agent.isActive) {
        socket.emit('agent:tokenInvalid');
        return;
      }

      // Store agent info in socket
      socket.agentId = agent._id.toString();
      socket.agentData = {
        id: agent._id,
        username: agent.username,
        name: agent.name,
        isSuperAdmin: agent.isSuperAdmin
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
        phoneNumber: agent.phoneNumber || ''
      });

      console.log(`👤 Agent auto-logged in: ${agent.username} via token`);
    } catch (error) {
      console.error('Token verification error:', error);
      socket.emit('agent:tokenInvalid');
    }
  }

  // Get agent dashboard data - UPDATED VERSION WITH IMMEDIATE REFRESH
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

      // Get referrals from User collection (users with agentId)
      const userReferrals = await this.models.User.find({ 
        agentId: agent._id,
        $or: [
          { agentReferredAt: { $exists: true } },
          { referredBy: { $exists: true } }
        ]
      })
      .sort({ agentReferredAt: -1 })
      .limit(50)
      .select('userId userName telegramUsername balance totalWagered totalWins totalBingos joinedAt lastSeen isOnline agentReferredAt referredBy agentCommissionEarned');

      // Get referral records from Referral collection
      const referralRecords = await this.models.Referral.find({ agentId: agent._id })
        .sort({ createdAt: -1 })
        .limit(50);

      // Log for debugging
      console.log(`📊 Agent ${agent.username}: User referrals: ${userReferrals.length}, Referral records: ${referralRecords.length}`);

      // Fix data mismatch if any
      if (userReferrals.length !== referralRecords.length) {
        console.warn(`⚠️ Data mismatch for agent ${agent.username}! User referrals: ${userReferrals.length}, Referral records: ${referralRecords.length}`);
        await this.fixReferralDataMismatch(agent._id, userReferrals, referralRecords);
      }

      // Get recent commissions (last 50)
      const commissions = await this.models.AgentCommission.find({ agentId: agent._id })
        .sort({ createdAt: -1 })
        .limit(50)
        .populate('userId', 'userName userId telegramUsername');

      // Get today's earnings
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      const todaysEarnings = await this.models.AgentCommission.aggregate([
        {
          $match: {
            agentId: agent._id,
            createdAt: { $gte: today },
            status: 'completed'
          }
        },
        {
          $group: {
            _id: null,
            total: { $sum: '$commissionAmount' }
          }
        }
      ]);

      // Get yesterday's earnings for comparison
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayEarnings = await this.models.AgentCommission.aggregate([
        {
          $match: {
            agentId: agent._id,
            createdAt: { $gte: yesterday, $lt: today },
            status: 'completed'
          }
        },
        {
          $group: {
            _id: null,
            total: { $sum: '$commissionAmount' }
          }
        }
      ]);

      // Get this month's earnings
      const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
      const monthlyEarnings = await this.models.AgentCommission.aggregate([
        {
          $match: {
            agentId: agent._id,
            createdAt: { $gte: startOfMonth },
            status: 'completed'
          }
        },
        {
          $group: {
            _id: null,
            total: { $sum: '$commissionAmount' }
          }
        }
      ]);

      // Get active referrals count from User collection
      const activeReferrals = await this.models.User.countDocuments({
        agentId: agent._id,
        isOnline: true
      });

      // Update agent's active referrals
      agent.activeReferrals = activeReferrals;
      
      // Update agent's total referrals from actual count (to fix any mismatches)
      const actualReferralCount = await this.models.User.countDocuments({ 
        agentId: agent._id,
        $or: [
          { agentReferredAt: { $exists: true } },
          { referredBy: { $exists: true } }
        ]
      });
      if (agent.totalReferrals !== actualReferralCount) {
        console.log(`🔄 Fixing referral count for ${agent.username}: ${agent.totalReferrals} -> ${actualReferralCount}`);
        agent.totalReferrals = actualReferralCount;
      }
      
      await agent.save();

      // Calculate earnings growth
      const todayTotal = todaysEarnings[0]?.total || 0;
      const yesterdayTotal = yesterdayEarnings[0]?.total || 0;
      const earningsGrowth = yesterdayTotal > 0 
        ? ((todayTotal - yesterdayTotal) / yesterdayTotal * 100).toFixed(1)
        : todayTotal > 0 ? 100 : 0;

      socket.emit('agent:dashboardData', {
        agent: {
          id: agent._id,
          username: agent.username,
          name: agent.name,
          commissionRateBingo: agent.commissionRateBingo,
          commissionRateKeno: agent.commissionRateKeno,
          totalEarnings: agent.totalEarnings,
          totalReferrals: agent.totalReferrals,
          activeReferrals: agent.activeReferrals,
          phoneNumber: agent.phoneNumber || '',
          createdAt: agent.createdAt,
          lastLogin: agent.lastLogin
        },
        stats: {
          todaysEarnings: todayTotal,
          yesterdayEarnings: yesterdayTotal,
          earningsGrowth: earningsGrowth,
          monthlyEarnings: monthlyEarnings[0]?.total || 0,
          totalEarnings: agent.totalEarnings,
          totalReferrals: agent.totalReferrals,
          activeReferrals: agent.activeReferrals
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
        })),
        debug: {
          userReferralsCount: userReferrals.length,
          referralRecordsCount: referralRecords.length,
          fixedMismatch: userReferrals.length !== referralRecords.length,
          actualReferralCount: actualReferralCount
        }
      });

      console.log(`📊 Dashboard sent to agent ${agent.username}: ${userReferrals.length} referrals, ${commissions.length} commissions`);
    } catch (error) {
      console.error('Dashboard error:', error);
      socket.emit('agent:error', 'Failed to load dashboard');
    }
  }

  // NEW: Refresh dashboard function
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

      // Force refresh agent statistics
      const actualReferralCount = await this.models.User.countDocuments({ 
        agentId: agent._id,
        $or: [
          { agentReferredAt: { $exists: true } },
          { referredBy: { $exists: true } }
        ]
      });
      const activeReferrals = await this.models.User.countDocuments({
        agentId: agent._id,
        isOnline: true
      });

      agent.totalReferrals = actualReferralCount;
      agent.activeReferrals = activeReferrals;
      await agent.save();

      // Then send the dashboard data
      await this.handleAgentDashboard(socket);

      socket.emit('agent:dashboardRefreshed', {
        message: 'Dashboard refreshed successfully',
        totalReferrals: agent.totalReferrals,
        activeReferrals: agent.activeReferrals,
        timestamp: new Date()
      });

      console.log(`🔄 Dashboard refreshed for agent ${agent.username}: ${agent.totalReferrals} referrals`);
    } catch (error) {
      console.error('Refresh dashboard error:', error);
      socket.emit('agent:error', 'Failed to refresh dashboard');
    }
  }

  // Agent disconnect - IMPROVED VERSION
  handleAgentDisconnect(socket) {
    try {
      if (socket.agentId) {
        const agentUsername = socket.agentData?.username || 'Unknown';
        console.log(`👤 Agent ${agentUsername} (${socket.agentId}) disconnected`);
        
        // Remove from agent sockets map
        this.agentSockets.delete(socket.agentId);
        this.agentHeartbeats.delete(socket.agentId);
        
        // Update active referrals count
        this.updateAgentActiveReferralsOnDisconnect(socket.agentId);
        
        // Clear socket data
        socket.agentId = null;
        socket.agentData = null;
      }
    } catch (error) {
      console.error('Agent disconnect error:', error);
    }
  }

  // NEW: Update agent active referrals on disconnect
  async updateAgentActiveReferralsOnDisconnect(agentId) {
    try {
      const agent = await this.models.Agent.findById(agentId);
      if (!agent) return;
      
      // Recalculate active referrals from database
      const activeReferrals = await this.models.User.countDocuments({
        agentId: agent._id,
        isOnline: true
      });
      
      agent.activeReferrals = activeReferrals;
      agent.updatedAt = new Date();
      await agent.save();
      
      console.log(`📊 Updated agent ${agent.username} active referrals to ${activeReferrals} after disconnect`);
    } catch (error) {
      console.error('Update agent active referrals on disconnect error:', error);
    }
  }

  // NEW: Check referral status
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

      // Check referral in both collections
      const userHasAgent = user.agentId ? user.agentId.toString() === agent._id.toString() : false;
      const referralRecord = await this.models.Referral.findOne({
        userId: user.userId,
        agentId: agent._id
      });

      // Get agent's total referrals from database
      const agentReferrals = await this.models.User.countDocuments({ 
        agentId: agent._id,
        $or: [
          { agentReferredAt: { $exists: true } },
          { referredBy: { $exists: true } }
        ]
      });
      const referralRecordsCount = await this.models.Referral.countDocuments({ agentId: agent._id });

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
          actualReferralsInDB: agentReferrals,
          referralRecordsCount: referralRecordsCount
        },
        status: userHasAgent ? 'assigned' : 'not_assigned'
      });
    } catch (error) {
      console.error('Check referral status error:', error);
      socket.emit('agent:error', 'Failed to check referral status');
    }
  }

  // Helper function to fix referral data mismatch
  async fixReferralDataMismatch(agentId, userReferrals, referralRecords) {
    try {
      console.log(`🔧 Fixing referral data mismatch for agent ${agentId}`);
      
      const userIdsFromUsers = userReferrals.map(u => u.userId);
      const userIdsFromReferrals = referralRecords.map(r => r.userId);
      
      // Find users in User collection but not in Referral collection
      const missingInReferrals = userReferrals.filter(user => 
        !userIdsFromReferrals.includes(user.userId)
      );
      
      // Find referrals in Referral collection but not in User collection
      const missingInUsers = referralRecords.filter(ref => 
        !userIdsFromUsers.includes(ref.userId)
      );
      
      // Create missing referral records
      for (const user of missingInReferrals) {
        console.log(`➕ Creating missing referral record for ${user.userId}`);
        const referral = new this.models.Referral({
          agentId: agentId,
          userId: user.userId,
          userName: user.userName,
          telegramUsername: user.telegramUsername,
          referralMethod: user.referredBy || 'auto_fix',
          status: 'active',
          createdAt: user.agentReferredAt || new Date(),
          updatedAt: new Date()
        });
        await referral.save();
      }
      
      // Fix users missing agentId
      for (const ref of missingInUsers) {
        const user = await this.models.User.findOne({ userId: ref.userId });
        if (user && (!user.agentId || user.agentId.toString() !== agentId.toString())) {
          console.log(`🔗 Fixing agentId for user ${ref.userId}`);
          user.agentId = agentId;
          user.agentReferredAt = ref.createdAt || new Date();
          user.referredBy = ref.referralMethod || 'auto_fix';
          await user.save();
        }
      }
      
      console.log(`✅ Fixed ${missingInReferrals.length} missing referral records and ${missingInUsers.length} missing agent assignments`);
    } catch (error) {
      console.error('Error fixing referral data mismatch:', error);
    }
  }

  // Helper function to find user by any identifier - IMPROVED VERSION
  async findUserByIdentifier(identifier) {
    try {
      const cleanId = identifier.replace('@', '').trim().toLowerCase();
      
      console.log(`🔍 [FIND USER] Searching for identifier: "${cleanId}"`);
      
      // First, check if it's a Telegram ID format
      if (cleanId.startsWith('tg_') || /^\d+$/.test(cleanId)) {
        const telegramId = cleanId.startsWith('tg_') ? cleanId : `tg_${cleanId}`;
        const userByTelegramId = await this.models.User.findOne({ 
          userId: new RegExp('^' + telegramId + '$', 'i') 
        });
        if (userByTelegramId) {
          console.log(`✅ [FIND USER] Found by Telegram ID: ${userByTelegramId.userId}`);
          return userByTelegramId;
        }
      }
      
      // Try to find by userId (exact match first)
      const userByUserId = await this.models.User.findOne({ 
        userId: new RegExp('^' + cleanId + '$', 'i') 
        });
      if (userByUserId) {
        console.log(`✅ [FIND USER] Found by userId: ${userByUserId.userId}`);
        return userByUserId;
      }
      
      // Try to find by telegramUsername (without @ symbol)
      const cleanUsername = cleanId.startsWith('@') ? cleanId.substring(1) : cleanId;
      const userByUsername = await this.models.User.findOne({
        telegramUsername: new RegExp('^' + cleanUsername + '$', 'i')
      });
      if (userByUsername) {
        console.log(`✅ [FIND USER] Found by telegramUsername: @${userByUsername.telegramUsername}`);
        return userByUsername;
      }
      
      // Try to find by userName
      const userByName = await this.models.User.findOne({
        userName: new RegExp('^' + cleanId + '$', 'i')
      });
      if (userByName) {
        console.log(`✅ [FIND USER] Found by userName: ${userByName.userName}`);
        return userByName;
      }
      
      // If not found, try partial matches
      const partialUsers = await this.models.User.find({
        $or: [
          { userId: { $regex: cleanId, $options: 'i' } },
          { telegramUsername: { $regex: cleanId, $options: 'i' } },
          { userName: { $regex: cleanId, $options: 'i' } }
        ]
      }).limit(5);
      
      if (partialUsers.length > 0) {
        console.log(`✅ [FIND USER] Found ${partialUsers.length} partial matches`);
        // Return the first one that seems most relevant
        const exactMatch = partialUsers.find(u => 
          u.userId.toLowerCase() === cleanId || 
          u.telegramUsername?.toLowerCase() === cleanId ||
          u.userName?.toLowerCase() === cleanId
        );
        return exactMatch || partialUsers[0];
      }
      
      console.log(`❌ [FIND USER] No user found for identifier: "${cleanId}"`);
      return null;
    } catch (error) {
      console.error('❌ [FIND USER] Error:', error);
      return null;
    }
  }

  // Manual referral assignment by agent - FIXED VERSION
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

      // Clean the identifier
      const cleanIdentifier = userIdentifier.replace('@', '').trim().toLowerCase();
      
      console.log(`🔍 [MANUAL REFERRAL] Agent ${agent.username} searching for player: "${cleanIdentifier}"`);
      
      // Find user by various methods
      let user = await this.findUserByIdentifier(cleanIdentifier);

      if (!user) {
        socket.emit('agent:error', `Player not found: "${userIdentifier}". Make sure the player has played at least once in the game.`);
        
        // Provide suggestions
        const similarUsers = await this.models.User.find({
          $or: [
            { userName: { $regex: cleanIdentifier.substring(0, 3), $options: 'i' } },
            { userId: { $regex: cleanIdentifier.substring(0, 3), $options: 'i' } },
            { telegramUsername: { $regex: cleanIdentifier.substring(0, 3), $options: 'i' } }
          ]
        }).limit(5).select('userId userName telegramUsername');
        
        if (similarUsers.length > 0) {
          const suggestions = similarUsers.map(u => {
            const username = u.telegramUsername ? `@${u.telegramUsername}` : (u.userName || 'No Name');
            return `• ${username} (${u.userId})`;
          }).join('\n');
          socket.emit('agent:suggestions', {
            message: `No exact match found. Did you mean one of these?\n${suggestions}`,
            suggestions: similarUsers
          });
        }
        
        return;
      }

      console.log(`✅ [MANUAL REFERRAL] Player found: ${user.userId} (${user.userName || 'No Name'})`);

      // Check if user already has an agent IN USER COLLECTION
      if (user.agentId) {
        if (user.agentId.toString() === agent._id.toString()) {
          socket.emit('agent:error', `"${user.userName || user.userId}" is already your referral.`);
          return;
        }
        
        const currentAgent = await this.models.Agent.findById(user.agentId);
        if (currentAgent) {
          socket.emit('agent:error', 
            `"${user.userName || user.userId}" is already assigned to agent: ${currentAgent.name || currentAgent.username}`
          );
        } else {
          socket.emit('agent:error', `"${user.userName || user.userId}" is already assigned to another agent.`);
        }
        return;
      }

      // DOUBLE CHECK in Referral collection too
      const existingReferral = await this.models.Referral.findOne({
        userId: user.userId,
        agentId: { $exists: true, $ne: null }
      });
      
      if (existingReferral) {
        if (existingReferral.agentId.toString() === agent._id.toString()) {
          socket.emit('agent:error', `"${user.userName || user.userId}" already has a referral record with you.`);
          return;
        }
        
        const referralAgent = await this.models.Agent.findById(existingReferral.agentId);
        if (referralAgent) {
          socket.emit('agent:error', 
            `"${user.userName || user.userId}" has an existing referral record with agent: ${referralAgent.name || referralAgent.username}`
          );
        } else {
          socket.emit('agent:error', `"${user.userName || user.userId}" has an existing referral record with another agent.`);
        }
        return;
      }

      // ✅ STEP 1: Update User collection - THIS IS WHAT THE DASHBOARD READS FROM
      user.agentId = agent._id;
      user.agentReferredAt = new Date();
      user.referredBy = 'manual';
      
      try {
        await user.save();
        console.log(`✅ [MANUAL REFERRAL] User collection updated: ${user.userId} -> agent ${agent.username}`);
        
        // VERIFY the save
        const verifiedUser = await this.models.User.findOne({ userId: user.userId });
        if (!verifiedUser || verifiedUser.agentId.toString() !== agent._id.toString()) {
          throw new Error('User agentId not saved properly');
        }
        console.log(`✅ [MANUAL REFERRAL] Verification passed for ${user.userId}`);
      } catch (saveError) {
        console.error('❌ [MANUAL REFERRAL] Error saving user:', saveError);
        socket.emit('agent:error', 'Failed to save user assignment: ' + saveError.message);
        return;
      }

      // ✅ STEP 2: Create referral record in Referral collection
      const referral = new this.models.Referral({
        agentId: agent._id,
        userId: user.userId,
        userName: user.userName,
        telegramUsername: user.telegramUsername,
        referralMethod: 'manual',
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date()
      });
      
      try {
        await referral.save();
        console.log(`✅ [MANUAL REFERRAL] Referral record created for ${user.userId}`);
      } catch (referralError) {
        console.error('❌ [MANUAL REFERRAL] Error saving referral:', referralError);
        // If referral record fails, we should still proceed since User collection was updated
      }

      // ✅ STEP 3: Update agent's referral count
      const previousReferrals = agent.totalReferrals || 0;
      
      // Count actual referrals from User collection to ensure accuracy
      const actualReferralCount = await this.models.User.countDocuments({ 
        agentId: agent._id,
        $or: [
          { agentReferredAt: { $exists: true } },
          { referredBy: { $exists: true } }
        ]
      });
      agent.totalReferrals = actualReferralCount;
      
      if (user.isOnline) {
        agent.activeReferrals = (agent.activeReferrals || 0) + 1;
      }
      agent.updatedAt = new Date();
      
      try {
        await agent.save();
        console.log(`✅ [MANUAL REFERRAL] Agent updated: totalReferrals = ${agent.totalReferrals}`);
      } catch (agentError) {
        console.error('❌ [MANUAL REFERRAL] Error saving agent:', agentError);
      }

      // Test query to verify it appears in dashboard
      const testReferrals = await this.models.User.find({ 
        agentId: agent._id,
        $or: [
          { agentReferredAt: { $exists: true } },
          { referredBy: { $exists: true } }
        ]
      }).countDocuments();
      console.log(`✅ [MANUAL REFERRAL] Database check: ${testReferrals} referrals in database for agent ${agent.username}`);

      socket.emit('agent:manualReferralSuccess', {
        success: true,
        message: `✅ Successfully added ${user.userName || user.userId} as your referral!`,
        user: {
          userId: user.userId,
          userName: user.userName,
          telegramUsername: user.telegramUsername || '',
          balance: user.balance || 0,
          totalWins: user.totalWins || 0,
          totalBingos: user.totalBingos || 0,
          totalWagered: user.totalWagered || 0,
          joinedAt: user.joinedAt,
          lastSeen: user.lastSeen,
          isOnline: user.isOnline || false,
          referredAt: new Date(),
          referredBy: 'manual'
        },
        agent: {
          totalReferrals: agent.totalReferrals,
          activeReferrals: agent.activeReferrals
        },
        debug: {
          previousReferrals,
          newTotal: agent.totalReferrals,
          databaseCount: testReferrals,
          userAgentIdVerified: true
        }
      });

      // Send real-time notification to agent
      this.sendAgentNotification(agent._id, 
        `✅ New manual referral: ${user.userName || user.userId}`, 
        'success'
      );

      console.log(`✅ Manual referral added successfully: ${user.userId} (${user.userName || 'No Name'}) -> Agent ${agent.username}`);
      
      // Refresh dashboard after 1 second to ensure data is saved
      setTimeout(() => {
        this.handleRefreshDashboard(socket);
      }, 1000);
      
    } catch (error) {
      console.error('Manual referral error:', error);
      socket.emit('agent:error', 'Failed to add referral: ' + (error.message || 'Internal error'));
    }
  }

  // Search users for manual assignment
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
      
      console.log(`🔍 [SEARCH] Searching users for query: "${cleanQuery}"`);
      
      // Build search query
      const searchConditions = [];
      
      // Check if it's a Telegram ID
      if (cleanQuery.startsWith('tg_') || /^\d+$/.test(cleanQuery)) {
        const telegramId = cleanQuery.startsWith('tg_') ? cleanQuery : `tg_${cleanQuery}`;
        searchConditions.push({ userId: new RegExp('^' + telegramId + '$', 'i') });
        searchConditions.push({ userId: new RegExp(telegramId, 'i') });
      }
      
      // Add other search patterns
      searchConditions.push({ userId: new RegExp('^' + cleanQuery + '$', 'i') });
      searchConditions.push({ telegramUsername: new RegExp('^' + cleanQuery + '$', 'i') });
      searchConditions.push({ userName: new RegExp('^' + cleanQuery + '$', 'i') });
      searchConditions.push({ userId: new RegExp(cleanQuery, 'i') });
      searchConditions.push({ telegramUsername: new RegExp(cleanQuery, 'i') });
      searchConditions.push({ userName: new RegExp(cleanQuery, 'i') });
      
      const searchQuery = {
        $or: searchConditions
      };

      // Only include users without agents OR users with other agents (not current agent)
      const finalQuery = {
        $and: [
          { $or: searchConditions },
          {
            $or: [
              { agentId: { $exists: false } },
              { agentId: null },
              { agentId: { $ne: agent._id } }
            ]
          }
        ]
      };

      const users = await this.models.User.find(finalQuery)
        .select('userId userName telegramUsername balance totalWagered totalWins totalBingos isOnline joinedAt lastSeen agentId phoneNumber referredBy agentReferredAt')
        .limit(parseInt(limit))
        .sort({ 
          isOnline: -1, 
          totalWins: -1, 
          joinedAt: -1 
        });

      console.log(`🔍 Search results for "${query}": ${users.length} players found`);

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

  // Bulk manual referral assignment
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
          const cleanIdentifier = identifier.replace('@', '').trim().toLowerCase();
          const user = await this.findUserByIdentifier(cleanIdentifier);

          if (!user) {
            results.notFound++;
            results.details.push({
              identifier,
              status: 'not_found',
              message: 'Player not found'
            });
            continue;
          }

          // Check if already assigned in User collection
          if (user.agentId) {
            if (user.agentId.toString() === agent._id.toString()) {
              results.alreadyAssigned++;
              results.details.push({
                identifier,
                userId: user.userId,
                userName: user.userName,
                telegramUsername: user.telegramUsername || '',
                status: 'already_yours',
                message: 'Already your referral'
              });
            } else {
              results.alreadyAssigned++;
              results.details.push({
                identifier,
                userId: user.userId,
                userName: user.userName,
                telegramUsername: user.telegramUsername || '',
                status: 'assigned_to_other',
                message: 'Assigned to another agent'
              });
            }
            continue;
          }

          // DOUBLE CHECK in Referral collection
          const existingReferral = await this.models.Referral.findOne({
            userId: user.userId,
            agentId: { $exists: true, $ne: null }
          });
          
          if (existingReferral) {
            results.alreadyAssigned++;
            results.details.push({
              identifier,
              userId: user.userId,
              userName: user.userName,
              telegramUsername: user.telegramUsername || '',
              status: 'has_referral_record',
              message: 'Has existing referral record'
            });
            continue;
          }

          // ✅ STEP 1: Update User collection (THIS IS CRITICAL FOR DASHBOARD)
          user.agentId = agent._id;
          user.agentReferredAt = new Date();
          user.referredBy = 'bulk_manual';
          await user.save();

          // ✅ STEP 2: Create referral record
          const referral = new this.models.Referral({
            agentId: agent._id,
            userId: user.userId,
            userName: user.userName,
            telegramUsername: user.telegramUsername,
            referralMethod: 'bulk_manual',
            status: 'active',
            createdAt: new Date(),
            updatedAt: new Date()
          });
          await referral.save();

          results.success++;
          results.details.push({
            identifier,
            userId: user.userId,
            userName: user.userName,
            telegramUsername: user.telegramUsername || '',
            status: 'success',
            message: 'Successfully added'
          });

        } catch (err) {
          console.error(`❌ Bulk error for ${identifier}:`, err);
          results.failed++;
          results.details.push({
            identifier,
            status: 'error',
            message: err.message
          });
        }
      }

      // Update agent stats based on actual count from database
      if (results.success > 0) {
        const actualReferralCount = await this.models.User.countDocuments({ 
          agentId: agent._id,
          $or: [
            { agentReferredAt: { $exists: true } },
            { referredBy: { $exists: true } }
          ]
        });
        agent.totalReferrals = actualReferralCount;
        agent.updatedAt = new Date();
        await agent.save();
      }

      socket.emit('agent:bulkManualReferralResult', {
        success: true,
        summary: results,
        agentStats: {
          totalReferrals: agent.totalReferrals,
          activeReferrals: agent.activeReferrals
        }
      });

      if (results.success > 0) {
        this.sendAgentNotification(agent._id, 
          `✅ Bulk referrals: Added ${results.success} new players`, 
          'success'
        );
        
        // Refresh dashboard after bulk operation
        setTimeout(() => {
          this.handleRefreshDashboard(socket);
        }, 1000);
      }

      console.log(`✅ Bulk manual referrals: ${results.success} added, ${results.failed} failed`);
      
    } catch (error) {
      console.error('Bulk manual referral error:', error);
      socket.emit('agent:error', 'Failed to process bulk referrals');
    }
  }

  // NEW: Test commission method for debugging
  async handleTestCommission(socket, data) {
    try {
      if (!socket.agentId) {
        socket.emit('agent:error', 'Not authenticated');
        return;
      }

      const { userId, gameType, amount } = data;
      if (!userId || !gameType || !amount) {
        socket.emit('agent:error', 'Missing required fields: userId, gameType, amount');
        return;
      }

      const agent = await this.models.Agent.findById(socket.agentId);
      if (!agent) {
        socket.emit('agent:error', 'Agent not found');
        return;
      }

      // Check if the user exists and is assigned to this agent
      const user = await this.models.User.findOne({ userId, agentId: agent._id });
      if (!user) {
        socket.emit('agent:error', `User ${userId} is not assigned to you or does not exist`);
        return;
      }

      let commissionAmount;
      if (gameType === 'BINGO') {
        commissionAmount = await this.processBingoWin(userId, { stake: 10 }, amount, `test_${Date.now()}`);
      } else if (gameType === 'KENO') {
        commissionAmount = await this.processKenoWin(userId, 5, amount, `test_${Date.now()}`);
      } else {
        socket.emit('agent:error', 'Invalid game type. Use BINGO or KENO');
        return;
      }

      socket.emit('agent:testCommissionResult', {
        success: true,
        commissionAmount,
        message: `Test ${gameType} commission recorded: ${commissionAmount.toFixed(2)} ETB`
      });

      console.log(`💰 Test commission by agent ${agent.username}: ${commissionAmount.toFixed(2)} ETB from ${gameType}`);
    } catch (error) {
      console.error('Test commission error:', error);
      socket.emit('agent:error', 'Test commission failed: ' + error.message);
    }
  }

  // Record commission for agent - UPDATED WITH BETTER LOGGING
  async recordCommission(agentId, userId, gameType, stake, winningAmount, transactionId = null) {
    try {
      console.log(`💰 [COMMISSION START] agent: ${agentId}, user: ${userId}, game: ${gameType}, win: ${winningAmount}`);
      
      // Generate a unique key for this commission to prevent duplicates
      const commissionKey = transactionId || `${userId}_${gameType}_${stake}_${winningAmount}_${Date.now()}`;
      
      // Check if this commission was already processed recently (within 5 minutes)
      if (this.processedTransactions.has(commissionKey)) {
        console.log(`⚠️ Commission already processed for key: ${commissionKey}`);
        return 0;
      }
      
      const agent = await this.models.Agent.findById(agentId);
      if (!agent) {
        console.log(`❌ Agent not found: ${agentId}`);
        return 0;
      }

      if (!agent.isActive) {
        console.log(`⚠️ Agent ${agent.username} is inactive, no commission recorded`);
        return 0;
      }

      // Get user first to check if they have agent assigned
      const user = await this.models.User.findOne({ userId });
      if (!user) {
        console.log(`❌ User not found for commission: ${userId}`);
        return 0;
      }

      // Double check agent assignment
      if (!user.agentId || user.agentId.toString() !== agentId.toString()) {
        console.log(`⚠️ User ${userId} not assigned to agent ${agentId}. User agent: ${user.agentId}`);
        return 0;
      }

      let commissionRate, commissionAmount;
      
      if (gameType === 'BINGO') {
        commissionRate = agent.commissionRateBingo;
        commissionAmount = (winningAmount * commissionRate) / 100;
        console.log(`🎱 Bingo commission: ${commissionRate}% of ${winningAmount} = ${commissionAmount}`);
      } else if (gameType === 'KENO') {
        commissionRate = agent.commissionRateKeno;
        commissionAmount = (winningAmount * commissionRate) / 100;
        console.log(`🎰 Keno commission: ${commissionRate}% of ${winningAmount} = ${commissionAmount}`);
      } else {
        console.log(`⚠️ Unknown game type: ${gameType}`);
        return 0;
      }

      // Minimum commission 0.01 ETB
      if (commissionAmount < 0.01) {
        console.log(`📏 Commission below minimum: ${commissionAmount}, setting to 0.01`);
        commissionAmount = 0.01;
      }

      // Check if similar commission already exists in database (within 2 minutes)
      const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);
      const existingCommission = await this.models.AgentCommission.findOne({
        agentId: agent._id,
        userId: userId,
        gameType: gameType,
        stake: stake,
        winningAmount: winningAmount,
        createdAt: { $gte: twoMinutesAgo }
      });

      if (existingCommission) {
        console.log(`⚠️ Duplicate commission detected for ${userId}, skipping`);
        return 0;
      }

      // Update user's agent commission earned
      user.agentCommissionEarned = (user.agentCommissionEarned || 0) + commissionAmount;
      await user.save();

      // Create commission record
      const commission = new this.models.AgentCommission({
        agentId: agent._id,
        userId: userId,
        userName: user.userName,
        telegramUsername: user.telegramUsername,
        gameType: gameType,
        stake: stake,
        winningAmount: winningAmount,
        commissionRate: commissionRate,
        commissionAmount: commissionAmount,
        status: 'completed',
        transactionKey: commissionKey,
        createdAt: new Date()
      });

      await commission.save();

      // Update agent earnings
      agent.totalEarnings = (agent.totalEarnings || 0) + commissionAmount;
      agent.lastCommissionDate = new Date();
      await agent.save();

      // Create transaction record for agent
      const agentTransaction = new this.models.AgentTransaction({
        agentId: agent._id,
        type: 'COMMISSION',
        amount: commissionAmount,
        description: `${gameType} commission from referral ${userId.substring(0, 8)}...`,
        status: 'completed',
        createdAt: new Date()
      });
      await agentTransaction.save();

      // Mark this transaction as processed to prevent duplicates
      this.processedTransactions.set(commissionKey, Date.now());
      
      // Auto-clean processed transactions after 10 minutes
      setTimeout(() => {
        this.processedTransactions.delete(commissionKey);
      }, 10 * 60 * 1000);

      // Update game transaction with agent commission
      const gameTransaction = await this.models.Transaction.findOne({
        userId: userId,
        type: gameType === 'BINGO' ? 'BINGO_WIN' : 'KENO_WIN',
        amount: winningAmount,
        createdAt: { $gte: new Date(Date.now() - 60000) }
      }).sort({ createdAt: -1 });

      if (gameTransaction) {
        gameTransaction.agentId = agent._id;
        gameTransaction.agentCommission = commissionAmount;
        gameTransaction.commissionProcessed = true;
        await gameTransaction.save();
      }

      // Notify agent in real-time if online
      const agentSocket = this.agentSockets.get(agentId.toString());
      if (agentSocket) {
        console.log(`📡 Sending real-time commission to agent ${agent.username}`);
        agentSocket.emit('agent:newCommission', {
          commissionId: commission._id,
          userId: userId,
          userName: user.userName || 'Unknown',
          telegramUsername: user.telegramUsername || '',
          gameType: gameType,
          stake: stake,
          winningAmount: winningAmount,
          commissionAmount: commissionAmount,
          commissionRate: commissionRate,
          timestamp: new Date()
        });
        
        // Also update dashboard immediately
        setTimeout(() => {
          this.handleRefreshDashboard(agentSocket);
        }, 500);
      } else {
        console.log(`⚠️ Agent ${agent.username} not connected, can't send real-time notification`);
      }

      console.log(`✅ Commission recorded: ${agent.username} earned ${commissionAmount.toFixed(2)} ETB from ${gameType} (Player: ${userId})`);
      return commissionAmount;
    } catch (error) {
      console.error('❌ Record commission error:', error);
      return 0;
    }
  }

  // Process Bingo win for agent commission - UPDATED WITH BETTER LOGGING
  async processBingoWin(userId, room, winningAmount, gameTransactionId = null) {
    try {
      console.log(`🎱 Processing Bingo win for ${userId}, amount: ${winningAmount}, room: ${room?.roomId}`);
      
      const user = await this.models.User.findOne({ userId });
      if (!user) {
        console.log(`❌ User not found: ${userId}`);
        return 0;
      }

      if (!user.agentId) {
        console.log(`ℹ️ User ${userId} has no agent, no commission`);
        return 0;
      }

      const stake = room?.stake || 10;
      const commissionAmount = await this.recordCommission(
        user.agentId,
        userId,
        'BINGO',
        stake,
        winningAmount,
        gameTransactionId || `bingo_${room?.roomId || Date.now()}`
      );

      if (commissionAmount > 0) {
        console.log(`✅ Bingo commission processed: ${commissionAmount.toFixed(2)} ETB for agent ${user.agentId}`);
      } else {
        console.log(`⚠️ No commission processed for Bingo win`);
      }

      return commissionAmount;
    } catch (error) {
      console.error('❌ Process Bingo win error:', error);
      return 0;
    }
  }

  // Process Keno win for agent commission - UPDATED WITH BETTER LOGGING
  async processKenoWin(userId, stake, winningAmount, gameTransactionId = null) {
    try {
      console.log(`🎰 Processing Keno win for ${userId}, amount: ${winningAmount}, stake: ${stake}`);
      
      const user = await this.models.User.findOne({ userId });
      if (!user) {
        console.log(`❌ User not found: ${userId}`);
        return 0;
      }

      if (!user.agentId) {
        console.log(`ℹ️ User ${userId} has no agent, no commission`);
        return 0;
      }

      const commissionAmount = await this.recordCommission(
        user.agentId,
        userId,
        'KENO',
        stake,
        winningAmount,
        gameTransactionId || `keno_${Date.now()}`
      );

      if (commissionAmount > 0) {
        console.log(`✅ Keno commission processed: ${commissionAmount.toFixed(2)} ETB for agent ${user.agentId}`);
      } else {
        console.log(`⚠️ No commission processed for Keno win`);
      }

      return commissionAmount;
    } catch (error) {
      console.error('❌ Process Keno win error:', error);
      return 0;
    }
  }

  // NEW: Process commission from game transaction directly
  async processGameTransaction(transaction) {
    try {
      console.log(`🔄 Processing commission from transaction: ${transaction._id}, type: ${transaction.type}`);
      
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

  // Send notification to agent
  async sendAgentNotification(agentId, message, type = 'info') {
    try {
      const agentSocket = this.agentSockets.get(agentId.toString());
      if (agentSocket) {
        agentSocket.emit('agent:notification', {
          message,
          type,
          timestamp: new Date()
        });
        return true;
      }
      return false;
    } catch (error) {
      console.error('Send agent notification error:', error);
      return false;
    }
  }

  // Start commission calculation job (runs every 10 minutes) - UPDATED
  startCommissionCalculationJob() {
    setInterval(async () => {
      try {
        await this.calculatePendingCommissions();
      } catch (error) {
        console.error('Commission calculation job error:', error);
      }
    }, 10 * 60 * 1000); // 10 minutes instead of 5
  }

  // Cleanup stale processing claims (runs every minute)
  startCleanupJob() {
    setInterval(() => {
      const now = Date.now();
      
      // Clean up processed transactions older than 30 minutes
      for (const [key, timestamp] of this.processedTransactions.entries()) {
        if (now - timestamp > 30 * 60 * 1000) {
          this.processedTransactions.delete(key);
        }
      }
      
      // Clean up old heartbeats (older than 5 minutes)
      for (const [agentId, timestamp] of this.agentHeartbeats.entries()) {
        if (now - timestamp > 5 * 60 * 1000) {
          this.agentHeartbeats.delete(agentId);
          console.log(`🧹 Cleaned up stale heartbeat for agent ${agentId}`);
        }
      }
      
      for (const [key, timestamp] of this.processingClaims.entries()) {
        // Remove claims older than 10 minutes
        if (now - timestamp > 10 * 60 * 1000) {
          this.processingClaims.delete(key);
        }
      }
      
      // Clean room winners older than 1 hour
      for (const [key, timestamp] of this.roomWinners.entries()) {
        if (now - timestamp > 60 * 60 * 1000) {
          this.roomWinners.delete(key);
        }
      }
    }, 60 * 1000); // 1 minute
  }

  // Calculate pending commissions for all agents - OPTIMIZED VERSION
  async calculatePendingCommissions() {
    try {
      console.log('🔄 Calculating pending commissions...');
      
      // Get all users with agentId and recent wins
      const usersWithAgents = await this.models.User.find({ 
        agentId: { $exists: true, $ne: null },
        totalWins: { $gt: 0 }
      }).limit(50); // Limit to 50 users per run

      console.log(`📊 Found ${usersWithAgents.length} users with agents`);

      for (const user of usersWithAgents) {
        // Add small delay between users to prevent database locks
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // Get user's win transactions that haven't been processed for commissions
        const winTransactions = await this.models.Transaction.find({
          userId: user.userId,
          type: { $in: ['BINGO_WIN', 'KENO_WIN'] },
          commissionProcessed: { $ne: true },
          createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } // Last 24 hours
        }).limit(10); // Limit to 10 transactions per user

        console.log(`📝 User ${user.userId} has ${winTransactions.length} unprocessed win transactions`);

        for (const transaction of winTransactions) {
          try {
            // Skip if already processed
            const commissionKey = `pending_${transaction._id}`;
            if (this.processedTransactions.has(commissionKey)) {
              continue;
            }
            
            // Mark as being processed
            this.processedTransactions.set(commissionKey, Date.now());
            
            let gameType = '';
            if (transaction.type === 'BINGO_WIN') {
              gameType = 'BINGO';
            } else if (transaction.type === 'KENO_WIN') {
              gameType = 'KENO';
            } else {
              this.processedTransactions.delete(commissionKey);
              continue;
            }

            // Record commission with transaction ID
            const stake = transaction.room || transaction.stake || 10;
            const commission = await this.recordCommission(
              user.agentId,
              user.userId,
              gameType,
              stake,
              transaction.amount,
              commissionKey
            );

            // Mark as processed
            if (commission > 0) {
              transaction.commissionProcessed = true;
              await transaction.save();
              console.log(`✅ Marked transaction ${transaction._id} as processed`);
            }
            
            // Remove from processing map
            this.processedTransactions.delete(commissionKey);
            
          } catch (transactionError) {
            console.error(`Error processing transaction ${transaction._id}:`, transactionError);
          }
        }
      }

      console.log('✅ Pending commissions calculation completed');
    } catch (error) {
      console.error('Calculate pending commissions error:', error);
    }
  }

  // Get total agent earnings (for display in admin panel)
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

  // Update agent's active referrals (called when user goes online/offline)
  async updateAgentActiveReferrals(userId, isOnline) {
    try {
      const user = await this.models.User.findOne({ userId });
      if (!user || !user.agentId) {
        return;
      }

      const agent = await this.models.Agent.findById(user.agentId);
      if (!agent) {
        return;
      }

      if (isOnline) {
        agent.activeReferrals = (agent.activeReferrals || 0) + 1;
      } else {
        agent.activeReferrals = Math.max(0, (agent.activeReferrals || 0) - 1);
      }
      
      agent.updatedAt = new Date();
      await agent.save();
      
      // Notify agent if online
      const agentSocket = this.agentSockets.get(agent._id.toString());
      if (agentSocket) {
        agentSocket.emit('agent:activeReferralsUpdated', {
          activeReferrals: agent.activeReferrals,
          userId: userId,
          userName: user.userName,
          isOnline: isOnline
        });
      }
    } catch (error) {
      console.error('Update agent active referrals error:', error);
    }
  }

  // Validate agent credentials (for API calls)
  async validateAgentCredentials(username, password) {
    try {
      const agent = await this.models.Agent.findOne({ username: username.toLowerCase() });
      if (!agent || !agent.isActive) {
        return null;
      }

      const isValid = await bcrypt.compare(password, agent.password);
      if (!isValid) {
        return null;
      }

      return {
        id: agent._id,
        username: agent.username,
        name: agent.name,
        isSuperAdmin: agent.isSuperAdmin
      };
    } catch (error) {
      console.error('Validate agent credentials error:', error);
      return null;
    }
  }

  // Debug function to find user by any identifier
  async debugFindUser(identifier) {
    try {
      const cleanIdentifier = identifier.replace('@', '').trim().toLowerCase();
      
      console.log(`🔍 [DEBUG FIND] Searching for: "${cleanIdentifier}"`);
      
      // Try all possible matches
      const queries = [
        // Exact userId match
        { userId: { $regex: new RegExp('^' + cleanIdentifier + '$', 'i') } },
        // Exact telegramUsername match
        { telegramUsername: { $regex: new RegExp('^' + cleanIdentifier + '$', 'i') } },
        // Exact userName match
        { userName: { $regex: new RegExp('^' + cleanIdentifier + '$', 'i') } },
        // Partial userId match
        { userId: { $regex: cleanIdentifier, $options: 'i' } },
        // Partial telegramUsername match
        { telegramUsername: { $regex: cleanIdentifier, $options: 'i' } },
        // Partial userName match
        { userName: { $regex: cleanIdentifier, $options: 'i' } },
        // Telegram ID format
        { userId: { $regex: 'tg_' + cleanIdentifier.replace('tg_', ''), $options: 'i' } },
        // Numeric only (telegram ID)
        { userId: { $regex: 'tg_' + cleanIdentifier, $options: 'i' } },
        // Phone number
        { phoneNumber: { $regex: cleanIdentifier, $options: 'i' } }
      ];

      for (const query of queries) {
        const user = await this.models.User.findOne(query);
        if (user) {
          console.log(`✅ [DEBUG FIND] Found user with query:`, query);
          console.log(`   User ID: ${user.userId}`);
          console.log(`   User Name: ${user.userName || 'No Name'}`);
          console.log(`   Telegram Username: ${user.telegramUsername || 'None'}`);
          console.log(`   Agent ID: ${user.agentId || 'None'}`);
          console.log(`   Is Online: ${user.isOnline}`);
          console.log(`   Total Wins: ${user.totalWins || 0}`);
          console.log(`   Total Bingos: ${user.totalBingos || 0}`);
          console.log(`   Referred By: ${user.referredBy || 'None'}`);
          console.log(`   Agent Referred At: ${user.agentReferredAt || 'None'}`);
          return user;
        }
      }
      
      console.log(`❌ [DEBUG FIND] No user found for: "${cleanIdentifier}"`);
      
      // List all users in database for debugging
      const allUsers = await this.models.User.find({})
        .select('userId userName telegramUsername agentId isOnline totalWins totalBingos joinedAt referredBy agentReferredAt')
        .limit(50)
        .sort({ joinedAt: -1 });
      
      console.log(`📋 [DEBUG FIND] Sample users in database (${allUsers.length} total):`);
      allUsers.forEach(u => {
        const telegramInfo = u.telegramUsername ? `@${u.telegramUsername}` : 'No Telegram';
        console.log(`   ${u.userId} - ${u.userName || 'No Name'} - ${telegramInfo} - Agent: ${u.agentId || 'None'} - Wins: ${u.totalWins || 0} - Bingos: ${u.totalBingos || 0} - Online: ${u.isOnline} - Referred By: ${u.referredBy || 'None'} - Agent Referred At: ${u.agentReferredAt || 'None'}`);
      });
      
      return null;
    } catch (error) {
      console.error('Debug find user error:', error);
      return null;
    }
  }

  // Test function to check user database
  async testUserDatabase(socket) {
    try {
      const users = await this.models.User.find({})
        .select('userId userName telegramUsername agentId totalWins totalBingos joinedAt isOnline referredBy agentReferredAt')
        .limit(20)
        .sort({ joinedAt: -1 });
      
      console.log('📋 Recent users in database:');
      users.forEach(user => {
        const telegramInfo = user.telegramUsername ? `@${user.telegramUsername}` : 'No Telegram';
        console.log(`   ${user.userId} - ${user.userName || 'No Name'} - ${telegramInfo} - Agent: ${user.agentId || 'None'} - Wins: ${user.totalWins || 0} - Bingos: ${user.totalBingos || 0} - Online: ${user.isOnline} - Referred By: ${user.referredBy || 'None'} - Agent Referred At: ${user.agentReferredAt || 'None'}`);
      });
      
      const totalUsers = await this.models.User.countDocuments();
      const usersWithoutAgents = await this.models.User.countDocuments({
        $or: [
          { agentId: { $exists: false } },
          { agentId: null }
        ]
      });
      const usersWithAgents = await this.models.User.countDocuments({
        agentId: { $exists: true, $ne: null }
      });
      
      socket.emit('agent:testResult', {
        totalUsers,
        usersWithoutAgents,
        usersWithAgents,
        sampleUsers: users.map(u => ({
          userId: u.userId,
          userName: u.userName,
          telegramUsername: u.telegramUsername,
          agentId: u.agentId,
          totalWins: u.totalWins,
          totalBingos: u.totalBingos,
          isOnline: u.isOnline,
          referredBy: u.referredBy,
          agentReferredAt: u.agentReferredAt
        }))
      });
    } catch (error) {
      console.error('Test error:', error);
    }
  }

  // Test function to verify referral assignment
  async testReferralAssignment(socket, data) {
    try {
      if (!socket.agentId) {
        socket.emit('agent:error', 'Not authenticated');
        return;
      }

      const { userId, agentId } = data;
      
      const agent = await this.models.Agent.findById(agentId || socket.agentId);
      if (!agent) {
        socket.emit('agent:error', 'Agent not found');
        return;
      }

      // Find the user
      const user = await this.models.User.findOne({ userId });
      if (!user) {
        socket.emit('agent:error', 'User not found');
        return;
      }

      // Check current state
      const currentState = {
        userId: user.userId,
        userName: user.userName,
        currentAgentId: user.agentId,
        hasAgent: !!user.agentId,
        referredBy: user.referredBy,
        agentReferredAt: user.agentReferredAt
      };

      // Count referrals for this agent
      const agentReferrals = await this.models.User.countDocuments({ 
        agentId: agent._id,
        $or: [
          { agentReferredAt: { $exists: true } },
          { referredBy: { $exists: true } }
        ]
      });
      const referralRecords = await this.models.Referral.countDocuments({ agentId: agent._id });

      socket.emit('agent:testResult', {
        agent: {
          id: agent._id,
          username: agent.username,
          name: agent.name,
          totalReferrals: agent.totalReferrals,
          activeReferrals: agent.activeReferrals
        },
        user: currentState,
        statistics: {
          agentReferrals,
          referralRecords
        },
        message: 'Test completed'
      });

    } catch (error) {
      console.error('Test referral assignment error:', error);
      socket.emit('agent:error', 'Test failed: ' + error.message);
    }
  }

  // Cleanup agent system
  async cleanup() {
    try {
      console.log('🧹 Cleaning up agent system...');
      
      // Clear caches
      this.agentSockets.clear();
      this.agentHeartbeats.clear();
      this.processingClaims.clear();
      this.roomWinners.clear();
      this.processedTransactions.clear();
      
      console.log('✅ Agent system cleanup completed');
    } catch (error) {
      console.error('Agent system cleanup error:', error);
    }
  }

  // Get agent system status
  getSystemStatus() {
    return {
      totalAgents: this.agentSockets.size,
      processingClaims: this.processingClaims.size,
      roomWinners: this.roomWinners.size,
      processedTransactions: this.processedTransactions.size,
      agentHeartbeats: this.agentHeartbeats.size,
      commissionRates: this.commissionRates,
      isInitialized: true
    };
  }

  // Get agent leaderboard (top earning agents)
  async getAgentLeaderboard(limit = 10, period = 'month') {
    try {
      const now = new Date();
      let startDate;
      
      switch (period) {
        case 'today':
          startDate = new Date(now.setHours(0, 0, 0, 0));
          break;
        case 'week':
          startDate = new Date(now.setDate(now.getDate() - 7));
          break;
        case 'month':
          startDate = new Date(now.setMonth(now.getMonth() - 1));
          break;
        default:
          startDate = new Date(now.setMonth(now.getMonth() - 1));
      }

      const leaderboard = await this.models.AgentCommission.aggregate([
        {
          $match: {
            createdAt: { $gte: startDate },
            status: 'completed'
          }
        },
        {
          $group: {
            _id: "$agentId",
            totalCommission: { $sum: "$commissionAmount" },
            bingoCommission: {
              $sum: {
                $cond: [{ $eq: ["$gameType", "BINGO"] }, "$commissionAmount", 0]
              }
            },
            kenoCommission: {
              $sum: {
                $cond: [{ $eq: ["$gameType", "KENO"] }, "$commissionAmount", 0]
              }
            },
            totalGames: { $sum: 1 },
            bingoGames: {
              $sum: {
                $cond: [{ $eq: ["$gameType", "BINGO"] }, 1, 0]
              }
            },
            kenoGames: {
              $sum: {
                $cond: [{ $eq: ["$gameType", "KENO"] }, 1, 0]
              }
            }
          }
        },
        {
          $lookup: {
            from: 'agents',
            localField: '_id',
            foreignField: '_id',
            as: 'agent'
          }
        },
        { $unwind: "$agent" },
        { $match: { "agent.isActive": true } },
        {
          $project: {
            _id: 1,
            agentId: "$_id",
            name: "$agent.name",
            username: "$agent.username",
            totalCommission: 1,
            bingoCommission: 1,
            kenoCommission: 1,
            totalGames: 1,
            bingoGames: 1,
            kenoGames: 1,
            commissionRateBingo: "$agent.commissionRateBingo",
            commissionRateKeno: "$agent.commissionRateKeno"
          }
        },
        { $sort: { totalCommission: -1 } },
        { $limit: limit }
      ]);

      return leaderboard;
    } catch (error) {
      console.error('Get agent leaderboard error:', error);
      return [];
    }
  }

  // Get agent's referral tree
  async getAgentReferralTree(agentId, depth = 2) {
    try {
      const agent = await this.models.Agent.findById(agentId);
      if (!agent) {
        return null;
      }

      // Get direct referrals from User collection (RELIABLE SOURCE)
      const directReferrals = await this.models.User.find({ 
        agentId: agent._id,
        $or: [
          { agentReferredAt: { $exists: true } },
          { referredBy: { $exists: true } }
        ]
      })
        .select('userId userName telegramUsername balance totalWagered totalWins totalBingos isOnline joinedAt lastSeen agentReferredAt referredBy')
        .sort({ agentReferredAt: -1 })
        .limit(100);

      return {
        agent: {
          id: agent._id,
          name: agent.name,
          username: agent.username,
          totalEarnings: agent.totalEarnings
        },
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

  // Get agent statistics (for admin dashboard)
  async getAgentStatistics() {
    try {
      const totalAgents = await this.models.Agent.countDocuments();
      const activeAgents = await this.models.Agent.countDocuments({ isActive: true });
      const newAgentsThisWeek = await this.models.Agent.countDocuments({
        createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
      });

      // Get commission statistics
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

      // Get game type breakdown
      const gameBreakdown = await this.models.AgentCommission.aggregate([
        { $match: { createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }, status: 'completed' } },
        {
          $group: {
            _id: '$gameType',
            totalCommission: { $sum: '$commissionAmount' },
            totalGames: { $sum: 1 },
            avgCommission: { $avg: '$commissionAmount' }
          }
        }
      ]);

      // Get top performing agents
      const topAgents = await this.models.AgentCommission.aggregate([
        { $match: { createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }, status: 'completed' } },
        {
          $group: {
            _id: '$agentId',
            totalCommission: { $sum: '$commissionAmount' },
            totalGames: { $sum: 1 }
          }
        },
        { $sort: { totalCommission: -1 } },
        { $limit: 10 },
        {
          $lookup: {
            from: 'agents',
            localField: '_id',
            foreignField: '_id',
            as: 'agent'
          }
        },
        { $unwind: '$agent' },
        {
          $project: {
            agentId: '$_id',
            agentName: '$agent.name',
            agentUsername: '$agent.username',
            totalCommission: 1,
            totalGames: 1,
            avgCommission: { $divide: ['$totalCommission', '$totalGames'] }
          }
        }
      ]);

      // Get withdrawal statistics
      const pendingWithdrawals = await this.models.AgentTransaction.aggregate([
        { $match: { type: 'WITHDRAWAL', status: 'pending' } },
        { $group: { _id: null, count: { $sum: 1 }, total: { $sum: { $abs: '$amount' } } } }
      ]);

      const completedWithdrawals = await this.models.AgentTransaction.aggregate([
        { $match: { type: 'WITHDRAWAL', status: 'completed', createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } } },
        { $group: { _id: null, count: { $sum: 1 }, total: { $sum: { $abs: '$amount' } } } }
      ]);

      // Get total referrals from User model (RELIABLE SOURCE)
      const totalReferrals = await this.models.User.countDocuments({ 
        agentId: { $exists: true, $ne: null },
        $or: [
          { agentReferredAt: { $exists: true } },
          { referredBy: { $exists: true } }
        ]
      });

      return {
        agents: {
          total: totalAgents,
          active: activeAgents,
          newThisWeek: newAgentsThisWeek,
          inactive: totalAgents - activeAgents
        },
        commissions: {
          today: {
            total: todayCommissions[0]?.total || 0,
            count: todayCommissions[0]?.count || 0
          },
          week: {
            total: weekCommissions[0]?.total || 0,
            count: weekCommissions[0]?.count || 0
          },
          month: {
            total: monthCommissions[0]?.total || 0,
            count: monthCommissions[0]?.count || 0
          }
        },
        gameBreakdown: gameBreakdown,
        topAgents: topAgents,
        withdrawals: {
          pending: {
            count: pendingWithdrawals[0]?.count || 0,
            total: pendingWithdrawals[0]?.total || 0
          },
          completed: {
            count: completedWithdrawals[0]?.count || 0,
            total: completedWithdrawals[0]?.total || 0
          }
        },
        referrals: totalReferrals
      };
    } catch (error) {
      console.error('Get agent statistics error:', error);
      return null;
    }
  }

  // Get agent's performance metrics
  async getAgentPerformanceMetrics(agentId) {
    try {
      const now = new Date();
      const today = new Date(now.setHours(0, 0, 0, 0));
      const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
      const monthAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);

      const [todayCommissions, weekCommissions, monthCommissions, allCommissions] = await Promise.all([
        this.models.AgentCommission.aggregate([
          { $match: { agentId: agentId, status: 'completed', createdAt: { $gte: today } } },
          { $group: { _id: null, total: { $sum: '$commissionAmount' }, count: { $sum: 1 } } }
        ]),
        this.models.AgentCommission.aggregate([
          { $match: { agentId: agentId, status: 'completed', createdAt: { $gte: weekAgo } } },
          { $group: { _id: null, total: { $sum: '$commissionAmount' }, count: { $sum: 1 } } }
        ]),
        this.models.AgentCommission.aggregate([
          { $match: { agentId: agentId, status: 'completed', createdAt: { $gte: monthAgo } } },
          { $group: { _id: null, total: { $sum: '$commissionAmount' }, count: { $sum: 1 } } }
        ]),
        this.models.AgentCommission.aggregate([
          { $match: { agentId: agentId, status: 'completed' } },
          { $group: { _id: null, total: { $sum: '$commissionAmount' }, count: { $sum: 1 } } }
        ])
      ]);

      const agent = await this.models.Agent.findById(agentId);
      const activeReferrals = await this.models.User.countDocuments({
        agentId: agentId,
        isOnline: true
      });

      return {
        today: {
          commission: todayCommissions[0]?.total || 0,
          games: todayCommissions[0]?.count || 0
        },
        week: {
          commission: weekCommissions[0]?.total || 0,
          games: weekCommissions[0]?.count || 0
        },
        month: {
          commission: monthCommissions[0]?.total || 0,
          games: monthCommissions[0]?.count || 0
        },
        allTime: {
          commission: allCommissions[0]?.total || 0,
          games: allCommissions[0]?.count || 0
        },
        agent: {
          name: agent?.name || 'Unknown',
          totalEarnings: agent?.totalEarnings || 0,
          totalReferrals: agent?.totalReferrals || 0,
          activeReferrals: activeReferrals,
          commissionRateBingo: agent?.commissionRateBingo || 40,
          commissionRateKeno: agent?.commissionRateKeno || 10
        }
      };
    } catch (error) {
      console.error('Get agent performance metrics error:', error);
      return null;
    }
  }

  // Manual referral assignment by admin
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
      if (!agent) {
        socket.emit('agent:error', 'Agent not found');
        return;
      }

      if (!agent.isActive) {
        socket.emit('agent:error', 'Agent is inactive');
        return;
      }

      // Find user
      const user = await this.findUserByIdentifier(userId);
      if (!user) {
        socket.emit('agent:error', 'User not found');
        return;
      }

      // Check if user already has an agent
      if (user.agentId) {
        const currentAgent = await this.models.Agent.findById(user.agentId);
        return socket.emit('agent:error', { 
          success: false, 
          message: `User already assigned to agent: ${currentAgent?.name || currentAgent?.username || 'Unknown'}`
        });
      }

      // ✅ STEP 1: Update User collection (CRITICAL FOR DASHBOARD)
      user.agentId = agent._id;
      user.agentReferredAt = new Date();
      user.referredBy = 'admin_assigned';
      await user.save();

      // ✅ STEP 2: Create referral record
      const referral = new this.models.Referral({
        agentId: agent._id,
        userId: user.userId,
        userName: user.userName,
        telegramUsername: user.telegramUsername,
        referralMethod: 'admin_assigned',
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date()
      });
      await referral.save();

      // Update agent referral counts based on actual database count
      const actualReferralCount = await this.models.User.countDocuments({ 
        agentId: agent._id,
        $or: [
          { agentReferredAt: { $exists: true } },
          { referredBy: { $exists: true } }
        ]
      });
      agent.totalReferrals = actualReferralCount;
      if (user.isOnline) {
        agent.activeReferrals = (agent.activeReferrals || 0) + 1;
      }
      await agent.save();

      socket.emit('agent:manualAssignmentSuccess', {
        success: true,
        message: 'User assigned to agent successfully',
        userId: userId,
        userName: user.userName,
        telegramUsername: user.telegramUsername || '',
        agentId: agent._id,
        agentName: agent.name,
        agentUsername: agent.username
      });

      // Notify the agent if online
      const agentSocket = this.agentSockets.get(agent._id.toString());
      if (agentSocket) {
        agentSocket.emit('agent:newReferral', {
          userId: userId,
          userName: user.userName,
          telegramUsername: user.telegramUsername || '',
          timestamp: new Date(),
          assignedBy: socket.agentData?.username || 'Admin'
        });
        
        // Refresh agent's dashboard
        setTimeout(() => {
          this.handleRefreshDashboard(agentSocket);
        }, 1000);
      }

      console.log(`✅ Manual assignment: ${userId} -> Agent ${agent.username}`);
      
    } catch (error) {
      console.error('Manual referral assignment error:', error);
      socket.emit('agent:error', 'Failed to assign user to agent');
    }
  }

  // Get user suggestions for manual referral
  async handleGetUserSuggestions(socket) {
    try {
      if (!socket.agentId) {
        socket.emit('agent:error', 'Not authenticated');
        return;
      }

      const agent = await this.models.Agent.findById(socket.agentId);
      
      // Get users without agents (potential referrals)
      const potentialUsers = await this.models.User.find({
        $or: [
          { agentId: { $exists: false } },
          { agentId: null }
        ],
        totalWins: { $gt: 0 } // Only suggest users who have won something
      })
      .select('userId userName telegramUsername balance totalWins totalBingos isOnline totalWagered lastSeen referredBy agentReferredAt')
      .limit(20)
      .sort({ totalWins: -1, joinedAt: -1 });

      // Get recent active users
      const recentUsers = await this.models.User.find({
        isOnline: true,
        $or: [
          { agentId: { $exists: false } },
          { agentId: null }
        ]
      })
      .select('userId userName telegramUsername isOnline lastSeen totalWins referredBy agentReferredAt')
      .limit(10)
      .sort({ lastSeen: -1 });

      // Get high wagering users without agents
      const highRollers = await this.models.User.find({
        $or: [
          { agentId: { $exists: false } },
          { agentId: null }
        ],
        totalWagered: { $gt: 1000 } // Users who wagered more than 1000 ETB
      })
      .select('userId userName telegramUsername totalWagered totalWins isOnline referredBy agentReferredAt')
      .limit(10)
      .sort({ totalWagered: -1 });

      socket.emit('agent:userSuggestions', {
        potentialUsers: potentialUsers.map(user => ({
          userId: user.userId,
          userName: user.userName || 'No Name',
          telegramUsername: user.telegramUsername || '',
          balance: user.balance || 0,
          totalWins: user.totalWins || 0,
          totalWagered: user.totalWagered || 0,
          isOnline: user.isOnline || false,
          lastSeen: user.lastSeen,
          suggestionReason: 'High activity player',
          referredBy: user.referredBy || null,
          agentReferredAt: user.agentReferredAt || null
        })),
        recentUsers: recentUsers.map(user => ({
          userId: user.userId,
          userName: user.userName || 'No Name',
          telegramUsername: user.telegramUsername || '',
          isOnline: user.isOnline || false,
          totalWins: user.totalWins || 0,
          lastSeen: user.lastSeen,
          suggestionReason: 'Recently active',
          referredBy: user.referredBy || null,
          agentReferredAt: user.agentReferredAt || null
        })),
        highRollers: highRollers.map(user => ({
          userId: user.userId,
          userName: user.userName || 'No Name',
          telegramUsername: user.telegramUsername || '',
          totalWagered: user.totalWagered || 0,
          totalWins: user.totalWins || 0,
          isOnline: user.isOnline || false,
          suggestionReason: 'High roller',
          referredBy: user.referredBy || null,
          agentReferredAt: user.agentReferredAt || null
        })),
        totalPotential: await this.models.User.countDocuments({ 
          $or: [
            { agentId: { $exists: false } },
            { agentId: null }
          ],
          totalWins: { $gt: 0 }
        })
      });

    } catch (error) {
      console.error('Get user suggestions error:', error);
      socket.emit('agent:error', 'Failed to get suggestions');
    }
  }

  // Update agent's commission rates
  async updateAgentCommissionRates(agentId, bingoRate, kenoRate) {
    try {
      const agent = await this.models.Agent.findById(agentId);
      if (!agent) {
        return { success: false, message: 'Agent not found' };
      }

      agent.commissionRateBingo = bingoRate || 40;
      agent.commissionRateKeno = kenoRate || 10;
      agent.updatedAt = new Date();
      await agent.save();

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

  // Process pending withdrawals (admin only)
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

      let processed = 0;
      let failed = 0;

      for (const transactionId of transactionIds) {
        try {
          const transaction = await this.models.AgentTransaction.findById(transactionId);
          if (!transaction || transaction.type !== 'WITHDRAWAL' || transaction.status !== 'pending') {
            failed++;
            continue;
          }

          // Update transaction status
          transaction.status = 'completed';
          transaction.processedAt = new Date();
          transaction.processedBy = socket.agentId;
          await transaction.save();

          processed++;
        } catch (err) {
          console.error(`Error processing withdrawal ${transactionId}:`, err);
          failed++;
        }
      }

      socket.emit('agent:withdrawalsProcessed', {
        message: `Processed ${processed} withdrawals, ${failed} failed`,
        processed,
        failed
      });

      console.log(`💰 Processed ${processed} withdrawals by admin ${socket.agentData?.username}`);
    } catch (error) {
      console.error('Process pending withdrawals error:', error);
      socket.emit('agent:error', 'Failed to process withdrawals');
    }
  }

  // Get system analytics
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

      // Get total agents statistics
      const totalAgents = await this.models.Agent.countDocuments();
      const activeAgents = await this.models.Agent.countDocuments({ isActive: true });
      const newAgentsThisWeek = await this.models.Agent.countDocuments({
        createdAt: { $gte: weekAgo }
      });

      // Get commission statistics
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

      // Get game type breakdown
      const gameBreakdown = await this.models.AgentCommission.aggregate([
        { $match: { createdAt: { $gte: monthAgo }, status: 'completed' } },
        {
          $group: {
            _id: '$gameType',
            totalCommission: { $sum: '$commissionAmount' },
            totalGames: { $sum: 1 },
            avgCommission: { $avg: '$commissionAmount' }
          }
        }
      ]);

      // Get top performing agents
      const topAgents = await this.models.AgentCommission.aggregate([
        { $match: { createdAt: { $gte: monthAgo }, status: 'completed' } },
        {
          $group: {
            _id: '$agentId',
            totalCommission: { $sum: '$commissionAmount' },
            totalGames: { $sum: 1 }
          }
        },
        { $sort: { totalCommission: -1 } },
        { $limit: 10 },
        {
          $lookup: {
            from: 'agents',
            localField: '_id',
            foreignField: '_id',
            as: 'agent'
          }
        },
        { $unwind: '$agent' },
        {
          $project: {
            agentId: '$_id',
            agentName: '$agent.name',
            agentUsername: '$agent.username',
            totalCommission: 1,
            totalGames: 1,
            avgCommission: { $divide: ['$totalCommission', '$totalGames'] }
          }
        }
      ]);

      // Get withdrawal statistics
      const pendingWithdrawals = await this.models.AgentTransaction.aggregate([
        { $match: { type: 'WITHDRAWAL', status: 'pending' } },
        { $group: { _id: null, count: { $sum: 1 }, total: { $sum: { $abs: '$amount' } } } }
      ]);

      const completedWithdrawals = await this.models.AgentTransaction.aggregate([
        { $match: { type: 'WITHDRAWAL', status: 'completed', createdAt: { $gte: monthAgo } } },
        { $group: { _id: null, count: { $sum: 1 }, total: { $sum: { $abs: '$amount' } } } }
      ]);

      socket.emit('agent:systemAnalytics', {
        agents: {
          total: totalAgents,
          active: activeAgents,
          newThisWeek: newAgentsThisWeek,
          inactive: totalAgents - activeAgents
        },
        commissions: {
          today: {
            total: todayCommissions[0]?.total || 0,
            count: todayCommissions[0]?.count || 0
          },
          week: {
            total: weekCommissions[0]?.total || 0,
            count: weekCommissions[0]?.count || 0
          },
          month: {
            total: monthCommissions[0]?.total || 0,
            count: monthCommissions[0]?.count || 0
          }
        },
        gameBreakdown: gameBreakdown,
        topAgents: topAgents,
        withdrawals: {
          pending: {
            count: pendingWithdrawals[0]?.count || 0,
            total: pendingWithdrawals[0]?.total || 0
          },
          completed: {
            count: completedWithdrawals[0]?.count || 0,
            total: completedWithdrawals[0]?.total || 0
          }
        },
        timestamp: new Date()
      });
    } catch (error) {
      console.error('Get system analytics error:', error);
      socket.emit('agent:error', 'Failed to get system analytics');
    }
  }

  // Export agent data (admin only)
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

      // Get agent commissions
      const commissions = await this.models.AgentCommission.find({
        agentId: agent._id,
        createdAt: { $gte: start, $lte: end },
        status: 'completed'
      }).sort({ createdAt: -1 });

      // Get agent referrals from User collection (RELIABLE SOURCE)
      const referrals = await this.models.User.find({
        agentId: agent._id,
        $or: [
          { agentReferredAt: { $gte: start, $lte: end } },
          { agentReferredAt: { $exists: true } }
        ]
      }).sort({ agentReferredAt: -1 });

      // Get agent withdrawals
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
        period: {
          startDate: start,
          endDate: end
        },
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

  // Emergency fix: Sync all referrals between User and Referral collections
  async emergencyFixReferralSync(agentId = null) {
    try {
      console.log('🚨 Starting emergency referral sync...');
      
      let query = {};
      if (agentId) {
        query.agentId = agentId;
      }
      
      // Get all users with agentId
      const usersWithAgents = await this.models.User.find({
        agentId: { $exists: true, $ne: null }
      });
      
      let created = 0;
      let errors = 0;
      
      for (const user of usersWithAgents) {
        try {
          // Check if referral record exists
          const existingReferral = await this.models.Referral.findOne({
            userId: user.userId,
            agentId: user.agentId
          });
          
          if (!existingReferral) {
            // Create missing referral record
            const referral = new this.models.Referral({
              agentId: user.agentId,
              userId: user.userId,
              userName: user.userName,
              telegramUsername: user.telegramUsername,
              referralMethod: user.referredBy || 'emergency_sync',
              status: 'active',
              createdAt: user.agentReferredAt || new Date(),
              updatedAt: new Date()
            });
            await referral.save();
            created++;
            console.log(`✅ Created referral record for ${user.userId} -> Agent ${user.agentId}`);
          }
        } catch (error) {
          errors++;
          console.error(`❌ Error syncing user ${user.userId}:`, error.message);
        }
      }
      
      // Update agent counts
      const agents = agentId ? [await this.models.Agent.findById(agentId)] : await this.models.Agent.find();
      
      for (const agent of agents) {
        if (agent) {
          const actualReferralCount = await this.models.User.countDocuments({ 
            agentId: agent._id,
            $or: [
              { agentReferredAt: { $exists: true } },
              { referredBy: { $exists: true } }
            ]
          });
          agent.totalReferrals = actualReferralCount;
          await agent.save();
          console.log(`✅ Updated agent ${agent.username}: ${actualReferralCount} referrals`);
        }
      }
      
      console.log(`🚨 Emergency sync completed: ${created} records created, ${errors} errors`);
      return { success: true, created, errors };
      
    } catch (error) {
      console.error('Emergency fix error:', error);
      return { success: false, error: error.message };
    }
  }

  // NEW: Force refresh agent dashboard
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

  // NEW: Get detailed referral information
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

      const referralRecord = await this.models.Referral.findOne({
        userId: user.userId,
        agentId: agent._id
      });

      const commissions = await this.models.AgentCommission.find({
        agentId: agent._id,
        userId: user.userId
      }).sort({ createdAt: -1 }).limit(20);

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

  // Handle emergency sync request from agent
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
      
      if (result.success) {
        socket.emit('agent:emergencySyncResult', {
          success: true,
          created: result.created,
          errors: result.errors,
          message: `Emergency sync completed: ${result.created} created, ${result.errors} errors`
        });
        
        // Refresh dashboard after sync
        setTimeout(() => {
          this.handleRefreshDashboard(socket);
        }, 1000);
      } else {
        socket.emit('agent:emergencySyncResult', {
          success: false,
          error: result.error,
          message: `Emergency sync failed: ${result.error}`
        });
      }
    } catch (error) {
      console.error('Handle emergency sync error:', error);
      socket.emit('agent:error', 'Emergency sync failed: ' + error.message);
    }
  }

  // Handle test user database request
  async handleTestUserDatabase(socket) {
    try {
      if (!socket.agentId) {
        socket.emit('agent:error', 'Not authenticated');
        return;
      }

      await this.testUserDatabase(socket);
    } catch (error) {
      console.error('Test user database error:', error);
      socket.emit('agent:error', 'Test failed: ' + error.message);
    }
  }

  // NEW: Check commission status for debugging
  async checkCommissionStatus(socket, data) {
    try {
      const { userId, gameType, startDate, endDate } = data;
      
      const matchQuery = {};
      if (userId) matchQuery.userId = userId;
      if (gameType) matchQuery.gameType = gameType;
      if (startDate || endDate) {
        matchQuery.createdAt = {};
        if (startDate) matchQuery.createdAt.$gte = new Date(startDate);
        if (endDate) matchQuery.createdAt.$lte = new Date(endDate);
      }

      const commissions = await this.models.AgentCommission.find(matchQuery)
        .sort({ createdAt: -1 })
        .limit(50)
        .populate('agentId', 'username name')
        .populate('userId', 'userId userName agentId');

      const stats = await this.models.AgentCommission.aggregate([
        { $match: matchQuery },
        {
          $group: {
            _id: null,
            totalCommissions: { $sum: 1 },
            totalAmount: { $sum: '$commissionAmount' },
            avgCommission: { $avg: '$commissionAmount' }
          }
        }
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

  // NEW: Get connection statistics
  getConnectionStats() {
    return {
      connectedAgents: this.agentSockets.size,
      totalHeartbeats: this.agentHeartbeats.size,
      socketIds: Array.from(this.agentSockets.keys()),
      timestamp: new Date()
    };
  }
}

module.exports = ManualAgentSystem;
