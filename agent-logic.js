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
  }

  async initialize() {
    console.log('✅ Manual Agent system initializing...');
    await this.ensureAdminAgent();
    // Start background jobs
    this.startCommissionCalculationJob();
    this.startCleanupJob();
    console.log('👑 Manual Agent system ready with 40% Bingo and 10% Keno commissions');
  }

  // Set game logic references from server.js
  setGameLogic(gameLogic) {
    this.gameLogic = gameLogic;
  }

  setKenoLogic(kenoLogic) {
    this.kenoLogic = kenoLogic;
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

  // Get agent dashboard data - FIXED VERSION
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

      // Get referrals from BOTH collections to ensure data consistency
      // Get referrals from User collection (users with agentId)
      const userReferrals = await this.models.User.find({ agentId: agent._id })
        .sort({ agentReferredAt: -1 })
        .limit(50)
        .select('userId userName telegramUsername balance totalWagered totalWins totalBingos joinedAt lastSeen isOnline agentReferredAt');

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
      const actualReferralCount = await this.models.User.countDocuments({ agentId: agent._id });
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
          referredAt: user.agentReferredAt
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
          fixedMismatch: userReferrals.length !== referralRecords.length
        }
      });

      console.log(`📊 Dashboard sent to agent ${agent.username}: ${userReferrals.length} referrals, ${commissions.length} commissions`);
    } catch (error) {
      console.error('Dashboard error:', error);
      socket.emit('agent:error', 'Failed to load dashboard');
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
          referralMethod: 'auto_fix',
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
          user.referredBy = 'auto_fix';
          await user.save();
        }
      }
      
      console.log(`✅ Fixed ${missingInReferrals.length} missing referral records and ${missingInUsers.length} missing agent assignments`);
    } catch (error) {
      console.error('Error fixing referral data mismatch:', error);
    }
  }

  // Helper function to find user by any identifier - FIXED VERSION
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
        return partialUsers[0];
      }
      
      console.log(`❌ [FIND USER] No user found for identifier: "${cleanId}"`);
      return null;
    } catch (error) {
      console.error('❌ [FIND USER] Error:', error);
      return null;
    }
  }

  // Manual referral assignment by agent - COMPLETELY FIXED VERSION
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
      const actualReferralCount = await this.models.User.countDocuments({ agentId: agent._id });
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
      const testReferrals = await this.models.User.find({ agentId: agent._id }).countDocuments();
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
          referredAt: new Date()
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
      
      // Update the dashboard immediately
      try {
        await this.handleAgentDashboard(socket);
      } catch (dashboardError) {
        console.error('Dashboard update error:', dashboardError);
      }
    } catch (error) {
      console.error('Manual referral error:', error);
      socket.emit('agent:error', 'Failed to add referral: ' + (error.message || 'Internal error'));
    }
  }

  // Search users for manual assignment - FIXED VERSION
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
        .select('userId userName telegramUsername balance totalWagered totalWins totalBingos isOnline joinedAt lastSeen agentId phoneNumber')
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
          currentAgentId: user.agentId ? user.agentId.toString() : null
        }))
      });
    } catch (error) {
      console.error('Search users error:', error);
      socket.emit('agent:error', 'Search failed: ' + error.message);
    }
  }

  // Bulk manual referral assignment - FIXED VERSION
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
        const actualReferralCount = await this.models.User.countDocuments({ agentId: agent._id });
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
      }

      console.log(`✅ Bulk manual referrals: ${results.success} added, ${results.failed} failed`);
      
      // Update dashboard after bulk operation
      try {
        await this.handleAgentDashboard(socket);
      } catch (dashboardError) {
        console.error('Dashboard update error:', dashboardError);
      }
    } catch (error) {
      console.error('Bulk manual referral error:', error);
      socket.emit('agent:error', 'Failed to process bulk referrals');
    }
  }

  // Record commission for agent
  async recordCommission(agentId, userId, gameType, stake, winningAmount) {
    try {
      const agent = await this.models.Agent.findById(agentId);
      if (!agent) {
        console.log(`Agent not found: ${agentId}`);
        return 0;
      }

      if (!agent.isActive) {
        console.log(`⚠️ Agent ${agent.username} is inactive, no commission recorded`);
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
        console.log(`⚠️ Unknown game type: ${gameType}`);
        return 0;
      }

      // Minimum commission 0.01 ETB
      if (commissionAmount < 0.01) {
        commissionAmount = 0.01;
      }

      // Get user info for the commission record
      const user = await this.models.User.findOne({ userId });
      if (!user) {
        console.log(`User not found for commission: ${userId}`);
        return 0;
      }

      // Update user's agent commission earned
      user.agentCommissionEarned = (user.agentCommissionEarned || 0) + commissionAmount;
      await user.save();

      // Create commission record
      const commission = new this.models.AgentCommission({
        agentId: agent._id,
        userId: userId,
        gameType: gameType,
        stake: stake,
        winningAmount: winningAmount,
        commissionRate: commissionRate,
        commissionAmount: commissionAmount,
        status: 'completed',
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
        agentSocket.emit('agent:newCommission', {
          commissionId: commission._id,
          userId: userId,
          userName: user.userName,
          telegramUsername: user.telegramUsername || '',
          gameType: gameType,
          winningAmount: winningAmount,
          commissionAmount: commissionAmount,
          commissionRate: commissionRate,
          timestamp: new Date()
        });
      }

      console.log(`💰 Agent commission: ${agent.username} earned ${commissionAmount.toFixed(2)} ETB from ${gameType} (Player: ${userId})`);
      return commissionAmount;
    } catch (error) {
      console.error('Record commission error:', error);
      return 0;
    }
  }

  // Process Bingo win for agent commission
  async processBingoWin(userId, room, winningAmount) {
    try {
      const user = await this.models.User.findOne({ userId });
      if (!user || !user.agentId) {
        console.log(`No agent for user ${userId} or user not found`);
        return 0;
      }

      const stake = room.stake || 10;
      const commissionAmount = await this.recordCommission(
        user.agentId,
        userId,
        'BINGO',
        stake,
        winningAmount
      );

      return commissionAmount;
    } catch (error) {
      console.error('Process Bingo win error:', error);
      return 0;
    }
  }

  // Process Keno win for agent commission
  async processKenoWin(userId, stake, winningAmount) {
    try {
      const user = await this.models.User.findOne({ userId });
      if (!user || !user.agentId) {
        console.log(`No agent for user ${userId} or user not found`);
        return 0;
      }

      const commissionAmount = await this.recordCommission(
        user.agentId,
        userId,
        'KENO',
        stake,
        winningAmount
      );

      return commissionAmount;
    } catch (error) {
      console.error('Process Keno win error:', error);
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

  // Agent disconnect
  handleAgentDisconnect(socket) {
    if (socket.agentId) {
      this.agentSockets.delete(socket.agentId);
      console.log(`👤 Agent disconnected: ${socket.agentData?.username}`);
    }
  }

  // Super Admin: Get all agents
  async handleGetAllAgents(socket) {
    try {
      if (!socket.agentData?.isSuperAdmin) {
        socket.emit('agent:error', 'Unauthorized - Admin access required');
        return;
      }

      const agents = await this.models.Agent.find()
        .sort({ createdAt: -1 })
        .select('-password');

      const agentsWithStats = await Promise.all(
        agents.map(async (agent) => {
          // Get total commissions
          const totalCommissions = await this.models.AgentCommission.aggregate([
            { $match: { agentId: agent._id, status: 'completed' } },
            { $group: { _id: null, total: { $sum: '$commissionAmount' } } }
          ]);

          // Get total referrals from User collection (RELIABLE SOURCE)
          const totalReferrals = await this.models.User.countDocuments({ agentId: agent._id });

          // Get active referrals
          const activeReferrals = await this.models.User.countDocuments({ 
            agentId: agent._id,
            isOnline: true 
          });

          // Get today's earnings
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          const todaysEarnings = await this.models.AgentCommission.aggregate([
            {
              $match: { 
                agentId: agent._id,
                status: 'completed',
                createdAt: { $gte: today }
              }
            },
            { $group: { _id: null, total: { $sum: '$commissionAmount' } } }
          ]);

          // Get pending withdrawals
          const pendingWithdrawals = await this.models.AgentTransaction.aggregate([
            {
              $match: { 
                agentId: agent._id,
                type: 'WITHDRAWAL',
                status: 'pending'
              }
            },
            { $group: { _id: null, total: { $sum: { $abs: '$amount' } } } }
          ]);

          return {
            ...agent.toObject(),
            totalCommissions: totalCommissions[0]?.total || 0,
            totalReferrals: totalReferrals,
            activeReferrals: activeReferrals,
            todaysEarnings: todaysEarnings[0]?.total || 0,
            pendingWithdrawals: pendingWithdrawals[0]?.total || 0
          };
        })
      );

      socket.emit('agent:allAgents', agentsWithStats);
    } catch (error) {
      console.error('Get all agents error:', error);
      socket.emit('agent:error', 'Failed to get agents');
    }
  }

  // Super Admin: Create new agent
  async handleCreateAgent(socket, data) {
    try {
      console.log('🔧 handleCreateAgent called:', {
        agentData: socket.agentData,
        isSuperAdmin: socket.agentData?.isSuperAdmin,
        data: data
      });

      // Check for admin authorization
      const isAdmin = socket.agentData && socket.agentData.isSuperAdmin;
      if (!isAdmin) {
        console.log('❌ Unauthorized access attempt');
        socket.emit('agent:error', 'Unauthorized - Admin access required');
        return;
      }

      const { username, password, name, commissionRateBingo, commissionRateKeno, phoneNumber } = data;

      // Validate input
      if (!username || !password || !name) {
        socket.emit('agent:error', 'Username, password and name are required');
        return;
      }

      if (username.length < 4) {
        socket.emit('agent:error', 'Username must be at least 4 characters');
        return;
      }

      if (password.length < 6) {
        socket.emit('agent:error', 'Password must be at least 6 characters');
        return;
      }

      // Check if agent exists
      const existingAgent = await this.models.Agent.findOne({ 
        username: username.toLowerCase().trim() 
      });
      
      if (existingAgent) {
        socket.emit('agent:error', 'Username already exists');
        return;
      }

      // Hash password
      const hashedPassword = await bcrypt.hash(password, 10);

      // Create agent
      const agent = new this.models.Agent({
        username: username.toLowerCase().trim(),
        password: hashedPassword,
        name: name.trim(),
        commissionRateBingo: commissionRateBingo || 40,
        commissionRateKeno: commissionRateKeno || 10,
        totalEarnings: 0,
        totalReferrals: 0,
        activeReferrals: 0,
        phoneNumber: phoneNumber ? phoneNumber.trim() : '',
        isActive: true,
        isSuperAdmin: false,
        createdAt: new Date(),
        updatedAt: new Date()
      });

      await agent.save();

      socket.emit('agent:agentCreated', {
        success: true,
        message: 'Agent created successfully',
        agent: {
          id: agent._id,
          username: agent.username,
          name: agent.name,
          commissionRateBingo: agent.commissionRateBingo,
          commissionRateKeno: agent.commissionRateKeno,
          phoneNumber: agent.phoneNumber,
          isActive: agent.isActive
        }
      });

      // Notify all admin agents
      this.broadcastToAdmins('agent:newAgentCreated', {
        agentId: agent._id,
        username: agent.username,
        name: agent.name,
        createdAt: new Date(),
        createdBy: socket.agentData?.username || 'Admin'
      });

      console.log(`👤 New agent created: ${agent.username} by ${socket.agentData?.username || 'Admin'}`);
      
    } catch (error) {
      console.error('Create agent error:', error);
      socket.emit('agent:error', `Failed to create agent: ${error.message}`);
    }
  }

  // Super Admin: Update agent
  async handleUpdateAgent(socket, data) {
    try {
      if (!socket.agentData?.isSuperAdmin) {
        socket.emit('agent:error', 'Unauthorized - Admin access required');
        return;
      }

      const { agentId, updates } = data;
      
      if (!agentId) {
        socket.emit('agent:error', 'Agent ID is required');
        return;
      }

      // Don't allow updating admin's own super admin status
      if (updates.isSuperAdmin && agentId.toString() === socket.agentId) {
        socket.emit('agent:error', 'Cannot modify your own admin status');
        return;
      }

      // Check if agent exists
      const agent = await this.models.Agent.findById(agentId);
      if (!agent) {
        socket.emit('agent:error', 'Agent not found');
        return;
      }

      // If updating username, check if it's available
      if (updates.username && updates.username !== agent.username) {
        const existing = await this.models.Agent.findOne({ username: updates.username.toLowerCase() });
        if (existing && existing._id.toString() !== agentId.toString()) {
          socket.emit('agent:error', 'Username already taken');
          return;
        }
        updates.username = updates.username.toLowerCase();
      }

      // If updating password, hash it
      if (updates.password) {
        if (updates.password.length < 6) {
          socket.emit('agent:error', 'Password must be at least 6 characters');
          return;
        }
        updates.password = await bcrypt.hash(updates.password, 10);
      }

      updates.updatedAt = new Date();
      const updatedAgent = await this.models.Agent.findByIdAndUpdate(
        agentId,
        { $set: updates },
        { new: true }
      ).select('-password');

      if (!updatedAgent) {
        socket.emit('agent:error', 'Agent not found');
        return;
      }

      socket.emit('agent:agentUpdated', {
        message: 'Agent updated successfully',
        agent: updatedAgent
      });

      // Notify the agent if they're online
      const agentSocket = this.agentSockets.get(agentId.toString());
      if (agentSocket) {
        agentSocket.emit('agent:profileUpdated', {
          message: 'Your profile has been updated by admin',
          updates: updates
        });
      }

      console.log(`👤 Agent updated: ${updatedAgent.username} by ${socket.agentData?.username || 'Admin'}`);
    } catch (error) {
      console.error('Update agent error:', error);
      socket.emit('agent:error', 'Failed to update agent');
    }
  }

  // Super Admin: Delete agent
  async handleDeleteAgent(socket, agentId) {
    try {
      if (!socket.agentData?.isSuperAdmin) {
        socket.emit('agent:error', 'Unauthorized - Admin access required');
        return;
      }

      if (!agentId) {
        socket.emit('agent:error', 'Agent ID is required');
        return;
      }

      // Don't allow deleting yourself
      if (agentId.toString() === socket.agentId) {
        socket.emit('agent:error', 'Cannot delete your own account');
        return;
      }

      const agent = await this.models.Agent.findById(agentId);
      if (!agent) {
        socket.emit('agent:error', 'Agent not found');
        return;
      }

      // Check if agent has active referrals
      const activeReferrals = await this.models.User.countDocuments({
        agentId: agentId,
        isOnline: true
      });

      if (activeReferrals > 0) {
        socket.emit('agent:error', `Cannot delete agent with ${activeReferrals} active referrals. Deactivate instead.`);
        return;
      }

      // Mark agent as inactive instead of deleting (soft delete)
      agent.isActive = false;
      agent.updatedAt = new Date();
      await agent.save();

      // Remove agent from online sockets
      this.agentSockets.delete(agentId.toString());

      socket.emit('agent:agentDeleted', {
        message: 'Agent deactivated successfully',
        agentId: agentId,
        agentName: agent.name
      });

      // Remove agent from user records
      await this.models.User.updateMany(
        { agentId: agent._id },
        { 
          $unset: { 
            agentId: "",
            agentReferredAt: "",
            agentCommissionEarned: ""
          } 
        }
      );

      // Remove referral records
      await this.models.Referral.deleteMany({ agentId: agent._id });

      console.log(`👤 Agent deactivated: ${agent.username} by ${socket.agentData?.username || 'Admin'}`);
    } catch (error) {
      console.error('Delete agent error:', error);
      socket.emit('agent:error', 'Failed to delete agent');
    }
  }

  // Agent withdraw request
  async handleAgentWithdrawRequest(socket, data) {
    try {
      if (!socket.agentId) {
        socket.emit('agent:error', 'Not authenticated');
        return;
      }

      const { amount, phoneNumber } = data;
      const agent = await this.models.Agent.findById(socket.agentId);
      
      if (!agent) {
        socket.emit('agent:error', 'Agent not found');
        return;
      }

      // Validate amount
      const amountNum = parseFloat(amount);
      if (isNaN(amountNum) || amountNum <= 0) {
        socket.emit('agent:error', 'Invalid amount');
        return;
      }

      if (amountNum > agent.totalEarnings) {
        socket.emit('agent:error', 'Insufficient earnings');
        return;
      }

      // Validate phone number (Ethiopian format)
      if (!phoneNumber || !/^09[0-9]{8}$/.test(phoneNumber)) {
        socket.emit('agent:error', 'Invalid phone number. Must be Ethiopian format (09xxxxxxxx)');
        return;
      }

      // Create withdrawal transaction
      const transaction = new this.models.AgentTransaction({
        agentId: agent._id,
        type: 'WITHDRAWAL',
        amount: -amountNum,
        description: `Agent withdrawal request - Phone: ${phoneNumber}`,
        status: 'pending',
        createdAt: new Date()
      });

      await transaction.save();

      // Update agent earnings (subtract pending withdrawal)
      agent.totalEarnings -= amountNum;
      agent.updatedAt = new Date();
      await agent.save();

      socket.emit('agent:withdrawRequested', {
        message: 'Withdrawal request submitted',
        transactionId: transaction._id,
        amount: amountNum,
        phoneNumber: phoneNumber,
        status: 'pending',
        timestamp: new Date()
      });

      // Notify admin agents
      this.broadcastToAdmins('agent:newWithdrawalRequest', {
        agentId: agent._id,
        agentName: agent.name,
        agentUsername: agent.username,
        amount: amountNum,
        phoneNumber: phoneNumber,
        transactionId: transaction._id,
        timestamp: new Date()
      });

      console.log(`💰 Agent withdrawal requested: ${agent.name} - ${amountNum} ETB to ${phoneNumber}`);
    } catch (error) {
      console.error('Withdraw request error:', error);
      socket.emit('agent:error', 'Failed to process withdrawal request');
    }
  }

  // Get agent's withdrawal history
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
        description: w.description,
        status: w.status,
        createdAt: w.createdAt
      })));
    } catch (error) {
      console.error('Get withdrawal history error:', error);
      socket.emit('agent:error', 'Failed to get withdrawal history');
    }
  }

  // Get agent performance report
  async handleAgentReport(socket, data) {
    try {
      if (!socket.agentId) {
        socket.emit('agent:error', 'Not authenticated');
        return;
      }

      const { startDate, endDate, agentId } = data;
      const start = new Date(startDate);
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);

      let targetAgentId = socket.agentId;
      
      // If super admin viewing another agent's report
      if (agentId && socket.agentData?.isSuperAdmin) {
        targetAgentId = agentId;
      }

      const matchQuery = { 
        agentId: targetAgentId,
        createdAt: { $gte: start, $lte: end },
        status: 'completed'
      };

      // Get commissions grouped by date and game type
      const dailyCommissions = await this.models.AgentCommission.aggregate([
        { $match: matchQuery },
        {
          $group: {
            _id: {
              date: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
              gameType: "$gameType"
            },
            totalCommission: { $sum: "$commissionAmount" },
            totalGames: { $sum: 1 },
            totalWinnings: { $sum: "$winningAmount" },
            averageCommission: { $avg: "$commissionAmount" }
          }
        },
        { $sort: { "_id.date": 1, "_id.gameType": 1 } }
      ]);

      // Get total summary
      const summary = await this.models.AgentCommission.aggregate([
        { $match: matchQuery },
        {
          $group: {
            _id: null,
            totalCommission: { $sum: "$commissionAmount" },
            totalGames: { $sum: 1 },
            totalWinnings: { $sum: "$winningAmount" },
            averageCommission: { $avg: "$commissionAmount" },
            minCommission: { $min: "$commissionAmount" },
            maxCommission: { $max: "$commissionAmount" }
          }
        }
      ]);

      // Get agent info
      const agent = await this.models.Agent.findById(targetAgentId).select('name username');

      socket.emit('agent:reportData', {
        agent: agent ? {
          name: agent.name,
          username: agent.username
        } : null,
        period: {
          startDate: start,
          endDate: end,
          days: Math.ceil((end - start) / (1000 * 60 * 60 * 24))
        },
        dailyCommissions: dailyCommissions,
        summary: summary[0] || { 
          totalCommission: 0, 
          totalGames: 0, 
          totalWinnings: 0,
          averageCommission: 0,
          minCommission: 0,
          maxCommission: 0
        }
      });
    } catch (error) {
      console.error('Report error:', error);
      socket.emit('agent:error', 'Failed to generate report');
    }
  }

  // Broadcast to all admin agents
  broadcastToAdmins(event, data) {
    this.agentSockets.forEach((socket, agentId) => {
      if (socket.agentData?.isSuperAdmin) {
        socket.emit(event, data);
      }
    });
  }

  // Start commission calculation job (runs every 5 minutes)
  startCommissionCalculationJob() {
    setInterval(async () => {
      try {
        await this.calculatePendingCommissions();
      } catch (error) {
        console.error('Commission calculation job error:', error);
      }
    }, 5 * 60 * 1000); // 5 minutes
  }

  // Cleanup stale processing claims (runs every minute)
  startCleanupJob() {
    setInterval(() => {
      const now = Date.now();
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

  // Calculate pending commissions for all agents
  async calculatePendingCommissions() {
    try {
      console.log('🔄 Calculating pending commissions...');
      
      // Get all users with agentId
      const usersWithAgents = await this.models.User.find({ 
        agentId: { $exists: true, $ne: null },
        totalWins: { $gt: 0 }
      });

      for (const user of usersWithAgents) {
        // Get user's win transactions that haven't been processed for commissions
        const winTransactions = await this.models.Transaction.find({
          userId: user.userId,
          type: { $in: ['BINGO_WIN', 'KENO_WIN'] },
          commissionProcessed: { $ne: true }
        });

        for (const transaction of winTransactions) {
          // Determine game type from transaction description
          let gameType = '';
          if (transaction.type === 'BINGO_WIN') {
            gameType = 'BINGO';
          } else if (transaction.type === 'KENO_WIN') {
            gameType = 'KENO';
          } else {
            continue;
          }

          // Record commission
          const stake = transaction.room ? transaction.room * 2 : 10; // Approximate stake
          await this.recordCommission(
            user.agentId,
            user.userId,
            gameType,
            stake,
            transaction.amount
          );

          // Mark as processed
          transaction.commissionProcessed = true;
          await transaction.save();
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
          return user;
        }
      }
      
      console.log(`❌ [DEBUG FIND] No user found for: "${cleanIdentifier}"`);
      
      // List all users in database for debugging
      const allUsers = await this.models.User.find({})
        .select('userId userName telegramUsername agentId isOnline totalWins totalBingos joinedAt')
        .limit(50)
        .sort({ joinedAt: -1 });
      
      console.log(`📋 [DEBUG FIND] Sample users in database (${allUsers.length} total):`);
      allUsers.forEach(u => {
        const telegramInfo = u.telegramUsername ? `@${u.telegramUsername}` : 'No Telegram';
        console.log(`   ${u.userId} - ${u.userName || 'No Name'} - ${telegramInfo} - Agent: ${u.agentId || 'None'} - Wins: ${u.totalWins || 0} - Bingos: ${u.totalBingos || 0} - Online: ${u.isOnline}`);
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
        .select('userId userName telegramUsername agentId totalWins totalBingos joinedAt isOnline')
        .limit(20)
        .sort({ joinedAt: -1 });
      
      console.log('📋 Recent users in database:');
      users.forEach(user => {
        const telegramInfo = user.telegramUsername ? `@${user.telegramUsername}` : 'No Telegram';
        console.log(`   ${user.userId} - ${user.userName || 'No Name'} - ${telegramInfo} - Agent: ${user.agentId || 'None'} - Wins: ${user.totalWins || 0} - Bingos: ${user.totalBingos || 0} - Online: ${user.isOnline}`);
      });
      
      const totalUsers = await this.models.User.countDocuments();
      const usersWithoutAgents = await this.models.User.countDocuments({
        $or: [
          { agentId: { $exists: false } },
          { agentId: null }
        ]
      });
      
      socket.emit('agent:testResult', {
        totalUsers,
        usersWithoutAgents,
        sampleUsers: users.map(u => ({
          userId: u.userId,
          userName: u.userName,
          telegramUsername: u.telegramUsername,
          agentId: u.agentId,
          totalWins: u.totalWins,
          totalBingos: u.totalBingos,
          isOnline: u.isOnline
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
      const agentReferrals = await this.models.User.countDocuments({ agentId: agent._id });
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
      this.processingClaims.clear();
      this.roomWinners.clear();
      
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
      const directReferrals = await this.models.User.find({ agentId: agent._id })
        .select('userId userName telegramUsername balance totalWagered totalWins totalBingos isOnline joinedAt lastSeen agentReferredAt')
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
          referredAt: user.agentReferredAt
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
      const totalCommissions = await this.models.AgentCommission.aggregate([
        { $match: { status: 'completed' } },
        { $group: { _id: null, total: { $sum: '$commissionAmount' } } }
      ]);
      const todayCommissions = await this.models.AgentCommission.aggregate([
        { 
          $match: { 
            status: 'completed',
            createdAt: { $gte: new Date().setHours(0, 0, 0, 0) }
          } 
        },
        { $group: { _id: null, total: { $sum: '$commissionAmount' } } }
      ]);

      // Get pending withdrawals
      const pendingWithdrawals = await this.models.AgentTransaction.aggregate([
        { 
          $match: { 
            type: 'WITHDRAWAL',
            status: 'pending'
          } 
        },
        { $group: { _id: null, total: { $sum: { $abs: '$amount' } } } }
      ]);

      // Get total referrals from User model (RELIABLE SOURCE)
      const totalReferrals = await this.models.User.countDocuments({ agentId: { $exists: true, $ne: null } });

      return {
        totalAgents,
        activeAgents,
        totalCommissions: totalCommissions[0]?.total || 0,
        todayCommissions: todayCommissions[0]?.total || 0,
        pendingWithdrawals: pendingWithdrawals[0]?.total || 0,
        totalReferrals
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
      const actualReferralCount = await this.models.User.countDocuments({ agentId: agent._id });
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
      .select('userId userName telegramUsername balance totalWins totalBingos isOnline totalWagered lastSeen')
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
      .select('userId userName telegramUsername isOnline lastSeen totalWins')
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
      .select('userId userName telegramUsername totalWagered totalWins isOnline')
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
          suggestionReason: 'High activity player'
        })),
        recentUsers: recentUsers.map(user => ({
          userId: user.userId,
          userName: user.userName || 'No Name',
          telegramUsername: user.telegramUsername || '',
          isOnline: user.isOnline || false,
          totalWins: user.totalWins || 0,
          lastSeen: user.lastSeen,
          suggestionReason: 'Recently active'
        })),
        highRollers: highRollers.map(user => ({
          userId: user.userId,
          userName: user.userName || 'No Name',
          telegramUsername: user.telegramUsername || '',
          totalWagered: user.totalWagered || 0,
          totalWins: user.totalWins || 0,
          isOnline: user.isOnline || false,
          suggestionReason: 'High roller'
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
        agentReferredAt: { $gte: start, $lte: end }
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
          totalWagered: ref.totalWagered
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
              referralMethod: 'emergency_sync',
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
          const actualReferralCount = await this.models.User.countDocuments({ agentId: agent._id });
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
}

module.exports = ManualAgentSystem;
