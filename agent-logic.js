// agent-logic.js - Complete Agent/Referral System for Elite Games
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

class AgentSystem {
  constructor(io, models) {
    this.io = io;
    this.models = models;
    this.agentSockets = new Map(); // agentId -> socket
    this.referralCache = new Map(); // referralCode -> agentId for quick lookups
    this.commissionRates = {
      BINGO: 40, // 40% commission from Bingo wins
      KENO: 10   // 10% commission from Keno wins
    };
    this.processingClaims = new Map(); // user-room combo -> timestamp for preventing double claims
    this.roomWinners = new Map(); // room-stake -> winnerId for preventing double winners
    this.gameLogic = null; // Will be set from server.js
    this.kenoLogic = null; // Will be set from server.js
    this.botUsername = '@Ethio_elite_games_bot'; // New bot username
  }

  async initialize() {
    console.log('✅ Agent system initializing...');
    console.log(`🤖 Bot username: ${this.botUsername}`);
    
    // Create admin agent if doesn't exist
    await this.ensureAdminAgent();
    
    // Load referral codes into cache
    await this.loadReferralCache();
    
    // Start commission calculation job
    this.startCommissionCalculationJob();
    
    // Start cleanup job for processing claims
    this.startCleanupJob();
    
    console.log('👑 Agent system ready with 40% Bingo and 10% Keno commissions');
  }

  // Set game logic references from server.js
  setGameLogic(gameLogic) {
    this.gameLogic = gameLogic;
  }

  setKenoLogic(kenoLogic) {
    this.kenoLogic = kenoLogic;
  }

  // Helper method to check admin access
  checkAdminAccess(socket) {
    return socket.admin || (socket.agentData && socket.agentData.isSuperAdmin);
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
          referralCode: 'ADMIN001',
          phoneNumber: '0962577855',
          createdAt: new Date(),
          updatedAt: new Date()
        });
        console.log('👑 Default admin agent created with username: admin, password: admin123');
        
        // Add to cache
        this.referralCache.set('ADMIN001', adminAgent._id.toString());
        
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

  async loadReferralCache() {
    try {
      const agents = await this.models.Agent.find({ isActive: true }).select('referralCode');
      agents.forEach(agent => {
        if (agent.referralCode) {
          this.referralCache.set(agent.referralCode, agent._id.toString());
        }
      });
      console.log(`📊 Loaded ${this.referralCache.size} referral codes into cache`);
    } catch (error) {
      console.error('Error loading referral cache:', error);
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
        phoneNumber: agent.phoneNumber || '',
        referralCode: agent.referralCode || ''
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
        phoneNumber: agent.phoneNumber || '',
        referralCode: agent.referralCode || ''
      });

      console.log(`👤 Agent auto-logged in: ${agent.username} via token`);
    } catch (error) {
      console.error('Token verification error:', error);
      socket.emit('agent:tokenInvalid');
    }
  }

  // Get agent dashboard data - UPDATED to show referral methods
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

      // Get recent referrals (last 50) with referral method
      const referrals = await this.models.User.find({ agentId: agent._id })
        .sort({ agentReferredAt: -1 })
        .limit(50)
        .select('userId userName balance totalWagered totalWins totalBingos joinedAt lastSeen isOnline referredBy agentReferredAt');

      // Get referral records for more details
      const referralRecords = await this.models.Referral.find({ agentId: agent._id })
        .sort({ createdAt: -1 })
        .limit(50);

      // Combine user data with referral method
      const enhancedReferrals = referrals.map(user => {
        const referralRecord = referralRecords.find(r => r.userId === user.userId);
        return {
          userId: user.userId,
          userName: user.userName || 'No Name',
          balance: user.balance || 0,
          totalWagered: user.totalWagered || 0,
          totalWins: user.totalWins || 0,
          totalBingos: user.totalBingos || 0,
          joinedAt: user.joinedAt,
          lastSeen: user.lastSeen,
          isOnline: user.isOnline || false,
          referralMethod: user.referredBy || (referralRecord ? referralRecord.referralMethod : 'unknown'),
          referredAt: user.agentReferredAt || (referralRecord ? referralRecord.createdAt : null),
          referralCode: referralRecord ? referralRecord.referralCode : 'N/A'
        };
      });

      // Get recent commissions (last 50)
      const commissions = await this.models.AgentCommission.find({ agentId: agent._id })
        .sort({ createdAt: -1 })
        .limit(50)
        .populate('userId', 'userName userId');

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

      // Get active referrals count
      const activeReferrals = await this.models.User.countDocuments({
        agentId: agent._id,
        isOnline: true
      });

      // Update agent's active referrals
      agent.activeReferrals = activeReferrals;
      await agent.save();

      // Calculate earnings growth
      const todayTotal = todaysEarnings[0]?.total || 0;
      const yesterdayTotal = yesterdayEarnings[0]?.total || 0;
      const earningsGrowth = yesterdayTotal > 0 
        ? ((todayTotal - yesterdayTotal) / yesterdayTotal * 100).toFixed(1)
        : todayTotal > 0 ? 100 : 0;

      // Get referral methods breakdown
      const telegramReferrals = await this.models.Referral.countDocuments({
        agentId: agent._id,
        referralMethod: 'telegram_link'
      });
      
      const manualReferrals = await this.models.Referral.countDocuments({
        agentId: agent._id,
        referralMethod: { $in: ['manual', 'bulk_manual'] }
      });

      const adminReferrals = await this.models.Referral.countDocuments({
        agentId: agent._id,
        referralMethod: 'admin_assigned'
      });

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
          referralCode: agent.referralCode,
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
          activeReferrals: agent.activeReferrals,
          pendingCommissions: await this.models.AgentCommission.countDocuments({
            agentId: agent._id,
            status: 'pending'
          }),
          telegramReferrals: telegramReferrals,
          manualReferrals: manualReferrals,
          adminReferrals: adminReferrals
        },
        referrals: enhancedReferrals,
        commissions: commissions.map(comm => ({
          id: comm._id,
          userId: comm.userId?.userId || 'Unknown',
          userName: comm.userId?.userName || 'Unknown',
          gameType: comm.gameType,
          stake: comm.stake,
          winningAmount: comm.winningAmount,
          commissionRate: comm.commissionRate,
          commissionAmount: comm.commissionAmount,
          status: comm.status,
          createdAt: comm.createdAt
        }))
      });
    } catch (error) {
      console.error('Dashboard error:', error);
      socket.emit('agent:error', 'Failed to load dashboard');
    }
  }

  // Generate referral link for the new bot
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

      // Generate unique referral code if not exists
      if (!agent.referralCode) {
        let newCode;
        let isUnique = false;
        
        while (!isUnique) {
          newCode = `AGENT${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
          const existing = await this.models.Agent.findOne({ referralCode: newCode });
          if (!existing) {
            isUnique = true;
          }
        }
        
        agent.referralCode = newCode;
        await agent.save();
        
        // Update cache
        this.referralCache.set(newCode, agent._id.toString());
      }

      // Generate Telegram referral link for the new bot
      const telegramLink = `https://t.me/Ethio_elite_games_bot?start=${agent.referralCode}`;

      socket.emit('agent:referralLink', {
        referralCode: agent.referralCode,
        telegramLink: telegramLink,
        referralMessage: `Join Elite Games via my referral link and earn together! ${telegramLink}`
      });
    } catch (error) {
      console.error('Generate link error:', error);
      socket.emit('agent:error', 'Failed to generate referral code');
    }
  }

  // Handle Telegram bot referral when user clicks start link - UPDATED to create referral record
  async handleTelegramReferral(userId, startParam) {
    try {
      // Extract referral code from start parameter
      let referralCode = startParam;
      
      // Check if startParam contains the referral code
      if (startParam && startParam.startsWith('agent')) {
        referralCode = startParam.toUpperCase();
      }

      console.log(`🤖 Processing Telegram referral: User ${userId}, Code: ${referralCode}`);

      // Find agent by referral code
      const agent = await this.getAgentByReferralCode(referralCode);
      if (!agent) {
        console.log(`❌ Agent not found for referral code: ${referralCode}`);
        return {
          success: false,
          message: 'Invalid referral code'
        };
      }

      if (!agent.isActive) {
        console.log(`❌ Agent ${agent.username} is inactive`);
        return {
          success: false,
          message: 'Agent account is inactive'
        };
      }

      // Find user
      const user = await this.models.User.findOne({ userId });
      if (!user) {
        console.log(`❌ User not found: ${userId}`);
        return {
          success: false,
          message: 'User not found in system'
        };
      }

      // Check if user already has an agent
      if (user.agentId) {
        if (user.agentId.toString() === agent._id.toString()) {
          console.log(`ℹ️ User ${userId} is already referral of agent ${agent.username}`);
          return {
            success: true,
            already: true,
            message: `You are already registered under ${agent.name}`,
            agent: agent.name
          };
        }
        
        const currentAgent = await this.models.Agent.findById(user.agentId);
        return {
          success: false,
          alreadyHasAgent: true,
          message: `You are already registered under agent: ${currentAgent?.name || 'Another agent'}`
        };
      }

      // Assign user to agent
      user.agentId = agent._id;
      user.agentReferredAt = new Date();
      user.referredBy = 'telegram_link';
      await user.save();

      // Update agent referral counts
      agent.totalReferrals = (agent.totalReferrals || 0) + 1;
      if (user.isOnline) {
        agent.activeReferrals = (agent.activeReferrals || 0) + 1;
      }
      agent.updatedAt = new Date();
      await agent.save();

      // Create referral record
      const referralRecord = new this.models.Referral({
        agentId: agent._id,
        userId: user.userId,
        userName: user.userName,
        referralMethod: 'telegram_link',
        referralCode: agent.referralCode,
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date()
      });
      await referralRecord.save();

      // Notify agent in real-time
      this.sendAgentNotification(agent._id, 
        `✅ New Telegram referral: ${user.userName || user.userId} via your link`, 
        'success'
      );

      console.log(`✅ Telegram referral success: ${user.userId} -> Agent ${agent.username} (${referralCode})`);

      return {
        success: true,
        message: `Successfully registered under agent ${agent.name}! You will now earn commissions for them.`,
        agent: {
          name: agent.name,
          username: agent.username,
          referralCode: agent.referralCode
        },
        user: {
          userId: user.userId,
          userName: user.userName
        }
      };
    } catch (error) {
      console.error('Telegram referral error:', error);
      return {
        success: false,
        message: 'Failed to process referral'
      };
    }
  }

  // Process manual referral when agent types username/user ID - UPDATED to create referral record
  async handleManualReferralAssignmentByAgent(socket, data) {
    try {
      if (!socket.agentId) {
        socket.emit('agent:error', 'Not authenticated');
        return;
      }

      const { userIdentifier } = data; // Can be Telegram username, user ID, or display name
      if (!userIdentifier) {
        socket.emit('agent:error', 'User identifier is required');
        return;
      }

      const agent = await this.models.Agent.findById(socket.agentId);
      if (!agent) {
        socket.emit('agent:error', 'Agent not found');
        return;
      }

      // Clean the identifier
      const cleanIdentifier = userIdentifier.replace('@', '').trim().toLowerCase();
      
      console.log(`🔍 Searching for user: "${cleanIdentifier}" for agent ${agent.username}`);
      
      // Find user by various methods
      let user = await this.findUserByIdentifier(cleanIdentifier);

      if (!user) {
        socket.emit('agent:error', `User not found: "${userIdentifier}". Make sure the user has played at least once in the game.`);
        
        // Provide suggestions
        const similarUsers = await this.models.User.find({
          $or: [
            { userName: { $regex: cleanIdentifier.substring(0, 3), $options: 'i' } },
            { userId: { $regex: cleanIdentifier.substring(0, 3), $options: 'i' } }
          ]
        }).limit(5).select('userId userName');
        
        if (similarUsers.length > 0) {
          const suggestions = similarUsers.map(u => `• ${u.userName || 'No Name'} (${u.userId})`).join('\n');
          socket.emit('agent:suggestions', {
            message: `No exact match found. Did you mean one of these?\n${suggestions}`,
            suggestions: similarUsers
          });
        }
        
        return;
      }

      console.log(`✅ User found: ${user.userId} (${user.userName || 'No Name'})`);

      // Check if user already has an agent
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

      // Assign user to agent
      user.agentId = agent._id;
      user.agentReferredAt = new Date();
      user.referredBy = 'manual';
      await user.save();

      // Update agent's referral count
      agent.totalReferrals = (agent.totalReferrals || 0) + 1;
      if (user.isOnline) {
        agent.activeReferrals = (agent.activeReferrals || 0) + 1;
      }
      agent.updatedAt = new Date();
      await agent.save();

      // Create referral record
      const referralRecord = new this.models.Referral({
        agentId: agent._id,
        userId: user.userId,
        userName: user.userName,
        referralMethod: 'manual',
        referralCode: agent.referralCode,
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date()
      });
      await referralRecord.save();

      socket.emit('agent:manualReferralSuccess', {
        success: true,
        message: `✅ Successfully added ${user.userName || user.userId} as your referral!`,
        user: {
          userId: user.userId,
          userName: user.userName,
          balance: user.balance || 0,
          totalWins: user.totalWins || 0,
          totalBingos: user.totalBingos || 0,
          totalWagered: user.totalWagered || 0,
          joinedAt: user.joinedAt,
          lastSeen: user.lastSeen,
          isOnline: user.isOnline || false,
          referralMethod: 'manual',
          referredAt: new Date()
        },
        agent: {
          totalReferrals: agent.totalReferrals,
          activeReferrals: agent.activeReferrals
        }
      });

      // Send real-time notification to agent
      this.sendAgentNotification(agent._id, 
        `✅ New manual referral: ${user.userName || user.userId}`, 
        'success'
      );

      console.log(`✅ Manual referral added: ${user.userId} (${user.userName || 'No Name'}) -> Agent ${agent.username} (${agent.referralCode})`);

    } catch (error) {
      console.error('Manual referral error:', error);
      socket.emit('agent:error', 'Failed to add referral: ' + (error.message || 'Internal error'));
    }
  }

  // Helper function to find user by any identifier
  async findUserByIdentifier(identifier) {
    const cleanId = identifier.replace('@', '').trim().toLowerCase();
    
    // Try different search patterns
    const searchPatterns = [
      { userId: { $regex: new RegExp('^' + cleanId + '$', 'i') } },
      { userId: { $regex: cleanId, $options: 'i' } },
      { userName: { $regex: new RegExp('^' + cleanId + '$', 'i') } },
      { userName: { $regex: cleanId, $options: 'i' } },
      { userId: { $regex: 'tg_' + cleanId.replace('tg_', ''), $options: 'i' } },
      { phoneNumber: cleanId }
    ];

    for (const pattern of searchPatterns) {
      const user = await this.models.User.findOne(pattern);
      if (user) return user;
    }

    // Broader search
    const users = await this.models.User.find({
      $or: [
        { userId: { $regex: cleanId, $options: 'i' } },
        { userName: { $regex: cleanId, $options: 'i' } }
      ]
    }).limit(1);
    
    return users[0] || null;
  }

  // Bulk manual referral assignment - UPDATED to create referral records
  async handleBulkManualReferral(socket, data) {
    try {
      if (!socket.agentId) {
        socket.emit('agent:error', 'Not authenticated');
        return;
      }

      const { userIdentifiers } = data; // Array of usernames/user IDs
      if (!Array.isArray(userIdentifiers) || userIdentifiers.length === 0) {
        socket.emit('agent:error', 'Please provide at least one user identifier');
        return;
      }

      const agent = await this.models.Agent.findById(socket.agentId);
      if (!agent) {
        socket.emit('agent:error', 'Agent not found');
        return;
      }

      // Limit bulk operations
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
              message: 'User not found'
            });
            continue;
          }

          // Check if already assigned
          if (user.agentId) {
            if (user.agentId.toString() === agent._id.toString()) {
              results.alreadyAssigned++;
              results.details.push({
                identifier,
                userId: user.userId,
                userName: user.userName,
                status: 'already_yours',
                message: 'Already your referral'
              });
            } else {
              results.alreadyAssigned++;
              results.details.push({
                identifier,
                userId: user.userId,
                userName: user.userName,
                status: 'assigned_to_other',
                message: 'Assigned to another agent'
              });
            }
            continue;
          }

          // Assign user
          user.agentId = agent._id;
          user.agentReferredAt = new Date();
          user.referredBy = 'bulk_manual';
          await user.save();

          // Create referral record
          const referralRecord = new this.models.Referral({
            agentId: agent._id,
            userId: user.userId,
            userName: user.userName,
            referralMethod: 'bulk_manual',
            referralCode: agent.referralCode,
            status: 'active',
            createdAt: new Date(),
            updatedAt: new Date()
          });
          await referralRecord.save();

          results.success++;
          results.details.push({
            identifier,
            userId: user.userId,
            userName: user.userName,
            status: 'success',
            message: 'Successfully added',
            referralMethod: 'bulk_manual'
          });

        } catch (err) {
          results.failed++;
          results.details.push({
            identifier,
            status: 'error',
            message: err.message
          });
        }
      }

      // Update agent stats
      if (results.success > 0) {
        agent.totalReferrals = (agent.totalReferrals || 0) + results.success;
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
          `✅ Bulk referrals: Added ${results.success} new referrals`, 
          'success'
        );
      }

      console.log(`✅ Bulk manual referrals: ${results.success} added, ${results.failed} failed`);

    } catch (error) {
      console.error('Bulk manual referral error:', error);
      socket.emit('agent:error', 'Failed to process bulk referrals');
    }
  }

  // Search users for manual assignment
  async handleSearchUsers(socket, data) {
    try {
      if (!socket.agentId) {
        socket.emit('agent:error', 'Not authenticated');
        return;
      }

      const { query, limit = 20 } = data;
      if (!query || query.trim().length < 1) {
        socket.emit('agent:searchUsersResult', { users: [], query });
        return;
      }

      const agent = await this.models.Agent.findById(socket.agentId);
      const cleanQuery = query.replace('@', '').trim().toLowerCase();
      
      // Build search query
      const searchQuery = {
        $and: [
          {
            $or: [
              { userId: { $regex: new RegExp('^' + cleanQuery + '$', 'i') } },
              { userId: { $regex: cleanQuery, $options: 'i' } },
              { userName: { $regex: new RegExp('^' + cleanQuery + '$', 'i') } },
              { userName: { $regex: cleanQuery, $options: 'i' } },
              { userId: { $regex: 'tg_' + cleanQuery.replace('tg_', ''), $options: 'i' } },
              { phoneNumber: { $regex: cleanQuery, $options: 'i' } }
            ]
          }
        ]
      };

      // Only exclude current agent's referrals, not all agents
      searchQuery.$and.push({
        $or: [
          { agentId: { $exists: false } },
          { agentId: null },
          { agentId: { $ne: agent._id } }
        ]
      });

      const users = await this.models.User.find(searchQuery)
        .select('userId userName balance totalWagered totalWins totalBingos isOnline joinedAt lastSeen agentId referredBy')
        .limit(parseInt(limit))
        .sort({ 
          isOnline: -1, 
          totalWins: -1, 
          joinedAt: -1 
        });

      console.log(`🔍 Search results for "${query}": ${users.length} users found`);

      socket.emit('agent:searchUsersResult', {
        query,
        users: users.map(user => ({
          userId: user.userId,
          userName: user.userName || 'No Name',
          balance: user.balance || 0,
          totalWins: user.totalWins || 0,
          totalBingos: user.totalBingos || 0,
          totalWagered: user.totalWagered || 0,
          isOnline: user.isOnline || false,
          joinedAt: user.joinedAt,
          lastSeen: user.lastSeen,
          hasAgent: !!user.agentId,
          canAdd: !user.agentId || user.agentId.toString() !== agent._id.toString(),
          currentAgentId: user.agentId ? user.agentId.toString() : null,
          referredBy: user.referredBy || null
        }))
      });

    } catch (error) {
      console.error('Search users error:', error);
      socket.emit('agent:error', 'Search failed: ' + error.message);
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
      .select('userId userName balance totalWins totalBingos isOnline totalWagered lastSeen referredBy')
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
      .select('userId userName isOnline lastSeen totalWins referredBy')
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
      .select('userId userName totalWagered totalWins isOnline referredBy')
      .limit(10)
      .sort({ totalWagered: -1 });

      socket.emit('agent:userSuggestions', {
        potentialUsers: potentialUsers.map(user => ({
          userId: user.userId,
          userName: user.userName || 'No Name',
          balance: user.balance || 0,
          totalWins: user.totalWins || 0,
          totalWagered: user.totalWagered || 0,
          isOnline: user.isOnline || false,
          lastSeen: user.lastSeen,
          suggestionReason: 'High activity player',
          referredBy: user.referredBy || null
        })),
        recentUsers: recentUsers.map(user => ({
          userId: user.userId,
          userName: user.userName || 'No Name',
          isOnline: user.isOnline || false,
          totalWins: user.totalWins || 0,
          lastSeen: user.lastSeen,
          suggestionReason: 'Recently active',
          referredBy: user.referredBy || null
        })),
        highRollers: highRollers.map(user => ({
          userId: user.userId,
          userName: user.userName || 'No Name',
          totalWagered: user.totalWagered || 0,
          totalWins: user.totalWins || 0,
          isOnline: user.isOnline || false,
          suggestionReason: 'High roller',
          referredBy: user.referredBy || null
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

  // Manual referral assignment by admin - UPDATED to create referral record
  async handleManualReferralAssignment(socket, data) {
    try {
      if (!this.checkAdminAccess(socket)) {
        socket.emit('agent:error', 'Unauthorized - Admin access required');
        return;
      }

      const { userId, referralCode } = data;
      
      if (!userId || !referralCode) {
        socket.emit('agent:error', 'User ID and Referral Code are required');
        return;
      }

      const result = await this.assignUserToAgent(userId, referralCode, 'admin_assigned');
      
      if (result.success) {
        socket.emit('agent:manualAssignmentSuccess', {
          message: result.message,
          userId: result.userId,
          agentId: result.agentId,
          agentName: result.agentName
        });
        
        // Notify the agent if online
        const agentSocket = this.agentSockets.get(result.agentId);
        if (agentSocket) {
          agentSocket.emit('agent:newReferral', {
            userId: userId,
            userName: result.userName,
            timestamp: new Date(),
            referralCode: referralCode,
            assignedBy: socket.agentData?.username || 'Admin',
            referralMethod: 'admin_assigned'
          });
        }
      } else {
        socket.emit('agent:error', result.message);
      }
    } catch (error) {
      console.error('Manual referral assignment error:', error);
      socket.emit('agent:error', 'Failed to assign user to agent');
    }
  }

  // Assign user to agent (utility method) - UPDATED to create referral record
  async assignUserToAgent(userId, referralCode, referralMethod = 'admin_assigned') {
    try {
      // Find agent by referral code
      const agent = await this.models.Agent.findOne({ referralCode });
      if (!agent) {
        return { success: false, message: 'Agent not found with this referral code' };
      }

      if (!agent.isActive) {
        return { success: false, message: 'Agent is inactive' };
      }

      // Find user
      const user = await this.findUserByIdentifier(userId);
      if (!user) {
        return { success: false, message: 'User not found' };
      }

      // Check if user already has an agent
      if (user.agentId) {
        const currentAgent = await this.models.Agent.findById(user.agentId);
        return { 
          success: false, 
          message: `User already assigned to agent: ${currentAgent?.name || currentAgent?.username || 'Unknown'}`
        };
      }

      // Assign agent to user
      user.agentId = agent._id;
      user.agentReferredAt = new Date();
      user.referredBy = referralMethod;
      await user.save();

      // Update agent referral counts
      agent.totalReferrals = (agent.totalReferrals || 0) + 1;
      if (user.isOnline) {
        agent.activeReferrals = (agent.activeReferrals || 0) + 1;
      }
      await agent.save();

      // Create referral record
      const referralRecord = new this.models.Referral({
        agentId: agent._id,
        userId: user.userId,
        userName: user.userName,
        referralMethod: referralMethod,
        referralCode: referralCode,
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date()
      });
      await referralRecord.save();

      // Update cache
      this.referralCache.set(agent.referralCode, agent._id.toString());

      console.log(`✅ Manual assignment: ${userId} -> Agent ${agent.username} (${referralCode}) via ${referralMethod}`);
      
      return {
        success: true,
        message: 'User assigned to agent successfully',
        userId: userId,
        userName: user.userName,
        agentId: agent._id,
        agentName: agent.name,
        agentUsername: agent.username,
        referralCode: referralCode,
        referralMethod: referralMethod
      };
    } catch (error) {
      console.error('Assign user to agent error:', error);
      return { success: false, message: error.message };
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
        createdAt: { $gte: new Date(Date.now() - 60000) } // Within last minute
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
          gameType: gameType,
          winningAmount: winningAmount,
          commissionAmount: commissionAmount,
          commissionRate: commissionRate,
          timestamp: new Date()
        });
      }

      // Update daily stats
      await this.updateDailyAgentStats(agentId, commissionAmount);

      console.log(`💰 Agent commission: ${agent.username} earned ${commissionAmount.toFixed(2)} ETB from ${gameType} (User: ${userId})`);
      return commissionAmount;
    } catch (error) {
      console.error('Record commission error:', error);
      return 0;
    }
  }

  // Update daily agent stats
  async updateDailyAgentStats(agentId, commissionAmount) {
    try {
      const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
      
      await this.models.Stats.findOneAndUpdate(
        { date: today },
        {
          $inc: {
            agentCommissions: commissionAmount,
            agentReferrals: 0 // Only increment when new referrals are added
          }
        },
        { upsert: true, new: true }
      );

      // Update active agents count
      const activeAgents = await this.models.Agent.countDocuments({ isActive: true });
      await this.models.Stats.findOneAndUpdate(
        { date: today },
        { $set: { activeAgents: activeAgents } },
        { upsert: true }
      );
    } catch (error) {
      console.error('Update daily agent stats error:', error);
    }
  }

  // Calculate pending commissions for all agents (run periodically)
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

  // Super Admin: Get all agents - UPDATED to include referral stats
  async handleGetAllAgents(socket) {
    try {
      if (!this.checkAdminAccess(socket)) {
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

          // Get total referrals from User model
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

          // Get referral methods breakdown
          const telegramReferrals = await this.models.Referral.countDocuments({
            agentId: agent._id,
            referralMethod: 'telegram_link'
          });
          
          const manualReferrals = await this.models.Referral.countDocuments({
            agentId: agent._id,
            referralMethod: { $in: ['manual', 'bulk_manual'] }
          });

          const adminReferrals = await this.models.Referral.countDocuments({
            agentId: agent._id,
            referralMethod: 'admin_assigned'
          });

          return {
            ...agent.toObject(),
            totalCommissions: totalCommissions[0]?.total || 0,
            totalReferrals: totalReferrals,
            activeReferrals: activeReferrals,
            todaysEarnings: todaysEarnings[0]?.total || 0,
            pendingWithdrawals: pendingWithdrawals[0]?.total || 0,
            telegramReferrals: telegramReferrals,
            manualReferrals: manualReferrals,
            adminReferrals: adminReferrals
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
        hasAdminProp: !!socket.admin,
        agentData: socket.agentData,
        isSuperAdmin: socket.agentData?.isSuperAdmin,
        data: data
      });

      // Check for admin authorization
      const isAdmin = socket.admin || (socket.agentData && socket.agentData.isSuperAdmin);
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

      // Generate unique referral code
      let referralCode;
      let isUnique = false;
      let attempts = 0;
      const maxAttempts = 10;
      
      while (!isUnique && attempts < maxAttempts) {
        referralCode = `AGENT${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
        const existing = await this.models.Agent.findOne({ referralCode });
        if (!existing) {
          isUnique = true;
        }
        attempts++;
      }

      if (!isUnique) {
        socket.emit('agent:error', 'Failed to generate unique referral code. Please try again.');
        return;
      }

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
        referralCode,
        phoneNumber: phoneNumber ? phoneNumber.trim() : '',
        isActive: true,
        isSuperAdmin: false,
        createdAt: new Date(),
        updatedAt: new Date()
      });

      await agent.save();

      // Add to cache
      this.referralCache.set(referralCode, agent._id.toString());

      socket.emit('agent:agentCreated', {
        success: true,
        message: 'Agent created successfully',
        agent: {
          id: agent._id,
          username: agent.username,
          name: agent.name,
          referralCode: agent.referralCode,
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
        referralCode: agent.referralCode,
        createdAt: new Date(),
        createdBy: socket.agentData?.username || 'Admin'
      });

      console.log(`👤 New agent created: ${agent.username} by ${socket.agentData?.username || socket.adminId || 'Admin'}`);
      
    } catch (error) {
      console.error('Create agent error:', error);
      socket.emit('agent:error', `Failed to create agent: ${error.message}`);
    }
  }

  // Super Admin: Update agent
  async handleUpdateAgent(socket, data) {
    try {
      if (!this.checkAdminAccess(socket)) {
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

      // If updating referral code, check if it's available
      if (updates.referralCode && updates.referralCode !== agent.referralCode) {
        const existing = await this.models.Agent.findOne({ referralCode: updates.referralCode });
        if (existing) {
          socket.emit('agent:error', 'Referral code already in use');
          return;
        }
        
        // Update cache
        this.referralCache.delete(agent.referralCode);
        this.referralCache.set(updates.referralCode, agentId.toString());
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
      if (!this.checkAdminAccess(socket)) {
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

      // Remove from cache
      if (agent.referralCode) {
        this.referralCache.delete(agent.referralCode);
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
            agentCommissionEarned: "",
            referredBy: ""
          } 
        }
      );

      // Mark referral records as inactive
      await this.models.Referral.updateMany(
        { agentId: agent._id },
        { 
          $set: { 
            status: 'inactive',
            updatedAt: new Date()
          } 
        }
      );

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

  // Get agent performance report - UPDATED to include referral methods
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
      if (agentId && (socket.agentData?.isSuperAdmin || socket.admin)) {
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
      const agent = await this.models.Agent.findById(targetAgentId).select('name username referralCode');

      // Get referral stats for the period
      const referralStats = await this.models.Referral.aggregate([
        {
          $match: {
            agentId: targetAgentId,
            createdAt: { $gte: start, $lte: end }
          }
        },
        {
          $group: {
            _id: "$referralMethod",
            count: { $sum: 1 }
          }
        }
      ]);

      socket.emit('agent:reportData', {
        agent: agent ? {
          name: agent.name,
          username: agent.username,
          referralCode: agent.referralCode
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
        },
        referralStats: referralStats
      });
    } catch (error) {
      console.error('Report error:', error);
      socket.emit('agent:error', 'Failed to generate report');
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

  // Broadcast to all admin agents
  broadcastToAdmins(event, data) {
    this.agentSockets.forEach((socket, agentId) => {
      if (socket.agentData?.isSuperAdmin) {
        socket.emit(event, data);
      }
    });
  }

  // Agent disconnect
  handleAgentDisconnect(socket) {
    if (socket.agentId) {
      this.agentSockets.delete(socket.agentId);
      console.log(`👤 Agent disconnected: ${socket.agentData?.username}`);
    }
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

  // Get agent by referral code (utility method)
  async getAgentByReferralCode(referralCode) {
    try {
      // Check cache first
      const agentId = this.referralCache.get(referralCode);
      if (agentId) {
        return await this.models.Agent.findById(agentId);
      }

      // Check database
      const agent = await this.models.Agent.findOne({ referralCode });
      if (agent) {
        this.referralCache.set(referralCode, agent._id.toString());
        return agent;
      }

      return null;
    } catch (error) {
      console.error('Get agent by referral code error:', error);
      return null;
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

      const stake = room.stake || 10; // Default stake if not available
      const commissionAmount = await this.recordCommission(
        user.agentId,
        userId,
        'BINGO',
        stake,
        winningAmount
      );

      // Update room history with agent commission
      if (room && room._id) {
        await this.models.Room.findByIdAndUpdate(room._id, {
          $push: {
            gameHistory: {
              $each: [{
                agentCommission: commissionAmount
              }],
              $position: -1
            }
          }
        });
      }

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

  // Check if agent exists by referral code
  async checkAgentByReferralCode(referralCode) {
    try {
      const agent = await this.models.Agent.findOne({ 
        referralCode: referralCode,
        isActive: true 
      });
      
      return agent ? {
        exists: true,
        agentId: agent._id,
        name: agent.name,
        referralCode: agent.referralCode
      } : { exists: false };
    } catch (error) {
      console.error('Check agent by referral code error:', error);
      return { exists: false };
    }
  }

  // Debug function to find user by any identifier
  async debugFindUser(identifier) {
    try {
      const cleanIdentifier = identifier.replace('@', '').trim().toLowerCase();
      
      console.log(`🔍 Debug search for: "${cleanIdentifier}"`);
      
      // Try all possible matches
      const queries = [
        // Exact userId match
        { userId: { $regex: new RegExp('^' + cleanIdentifier + '$', 'i') } },
        // Partial userId match
        { userId: { $regex: cleanIdentifier, $options: 'i' } },
        // Exact userName match
        { userName: { $regex: new RegExp('^' + cleanIdentifier + '$', 'i') } },
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
          console.log(`✅ Found user with query:`, query);
          console.log(`   User ID: ${user.userId}`);
          console.log(`   User Name: ${user.userName || 'No Name'}`);
          console.log(`   Agent ID: ${user.agentId}`);
          console.log(`   Referred By: ${user.referredBy}`);
          console.log(`   Is Online: ${user.isOnline}`);
          console.log(`   Total Wins: ${user.totalWins}`);
          return user;
        }
      }
      
      console.log(`❌ No user found for: "${cleanIdentifier}"`);
      
      // List all users in database for debugging
      const allUsers = await this.models.User.find({})
        .select('userId userName agentId referredBy isOnline totalWins joinedAt')
        .limit(50)
        .sort({ joinedAt: -1 });
      
      console.log(`📋 Sample users in database (${allUsers.length} total):`);
      allUsers.forEach(u => {
        console.log(`   ${u.userId} - ${u.userName || 'No Name'} - Agent: ${u.agentId || 'None'} - Referred By: ${u.referredBy || 'None'} - Wins: ${u.totalWins} - Online: ${u.isOnline}`);
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
        .select('userId userName agentId referredBy totalWins joinedAt isOnline')
        .limit(20)
        .sort({ joinedAt: -1 });
      
      console.log('📋 Recent users in database:');
      users.forEach(user => {
        console.log(`   ${user.userId} - ${user.userName || 'No Name'} - Agent: ${user.agentId || 'None'} - Referred By: ${user.referredBy || 'None'} - Wins: ${user.totalWins} - Online: ${user.isOnline}`);
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
        sampleUsers: users
      });
    } catch (error) {
      console.error('Test error:', error);
    }
  }

  // Cleanup agent system
  async cleanup() {
    try {
      console.log('🧹 Cleaning up agent system...');
      
      // Clear caches
      this.agentSockets.clear();
      this.referralCache.clear();
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
      totalReferralCodes: this.referralCache.size,
      processingClaims: this.processingClaims.size,
      roomWinners: this.roomWinners.size,
      commissionRates: this.commissionRates,
      botUsername: this.botUsername,
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
            referralCode: "$agent.referralCode",
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

  // Get agent's referral tree - UPDATED to include referral methods
  async getAgentReferralTree(agentId, depth = 2) {
    try {
      const agent = await this.models.Agent.findById(agentId);
      if (!agent) {
        return null;
      }

      // Get direct referrals with referral method
      const directReferrals = await this.models.User.find({ agentId: agent._id })
        .select('userId userName balance totalWagered totalWins totalBingos isOnline joinedAt lastSeen referredBy agentReferredAt')
        .sort({ agentReferredAt: -1 })
        .limit(100);

      // Get referral records
      const referralRecords = await this.models.Referral.find({ agentId: agent._id })
        .sort({ createdAt: -1 })
        .limit(100);

      // Combine user data with referral method
      const enhancedReferrals = directReferrals.map(user => {
        const referralRecord = referralRecords.find(r => r.userId === user.userId);
        return {
          userId: user.userId,
          userName: user.userName || 'No Name',
          balance: user.balance || 0,
          totalWagered: user.totalWagered || 0,
          totalWins: user.totalWins || 0,
          totalBingos: user.totalBingos || 0,
          isOnline: user.isOnline || false,
          joinedAt: user.joinedAt,
          lastSeen: user.lastSeen,
          referralMethod: user.referredBy || (referralRecord ? referralRecord.referralMethod : 'unknown'),
          referredAt: user.agentReferredAt || (referralRecord ? referralRecord.createdAt : null),
          referralCode: referralRecord ? referralRecord.referralCode : 'N/A'
        };
      });

      // Get referral methods breakdown
      const telegramReferrals = await this.models.Referral.countDocuments({
        agentId: agent._id,
        referralMethod: 'telegram_link'
      });
      
      const manualReferrals = await this.models.Referral.countDocuments({
        agentId: agent._id,
        referralMethod: { $in: ['manual', 'bulk_manual'] }
      });

      const adminReferrals = await this.models.Referral.countDocuments({
        agentId: agent._id,
        referralMethod: 'admin_assigned'
      });

      return {
        agent: {
          id: agent._id,
          name: agent.name,
          username: agent.username,
          referralCode: agent.referralCode,
          totalEarnings: agent.totalEarnings
        },
        directReferrals: enhancedReferrals,
        stats: {
          totalDirectReferrals: directReferrals.length,
          activeDirectReferrals: directReferrals.filter(r => r.isOnline).length,
          totalCommission: agent.totalEarnings,
          telegramReferrals: telegramReferrals,
          manualReferrals: manualReferrals,
          adminReferrals: adminReferrals
        }
      };
    } catch (error) {
      console.error('Get agent referral tree error:', error);
      return null;
    }
  }

  // Get agent statistics (for admin dashboard) - UPDATED to include referral stats
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

      // Get total referrals from User model
      const totalReferrals = await this.models.User.countDocuments({ agentId: { $exists: true, $ne: null } });

      // Get referral methods breakdown
      const telegramReferrals = await this.models.Referral.countDocuments({ referralMethod: 'telegram_link' });
      const manualReferrals = await this.models.Referral.countDocuments({ referralMethod: { $in: ['manual', 'bulk_manual'] } });
      const adminReferrals = await this.models.Referral.countDocuments({ referralMethod: 'admin_assigned' });

      return {
        totalAgents,
        activeAgents,
        totalCommissions: totalCommissions[0]?.total || 0,
        todayCommissions: todayCommissions[0]?.total || 0,
        pendingWithdrawals: pendingWithdrawals[0]?.total || 0,
        totalReferrals,
        telegramReferrals,
        manualReferrals,
        adminReferrals: adminReferrals || 0
      };
    } catch (error) {
      console.error('Get agent statistics error:', error);
      return null;
    }
  }

  // Get agent's performance metrics - UPDATED to include referral methods
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

      // Get referral method stats
      const telegramReferrals = await this.models.Referral.countDocuments({
        agentId: agentId,
        referralMethod: 'telegram_link'
      });
      
      const manualReferrals = await this.models.Referral.countDocuments({
        agentId: agentId,
        referralMethod: { $in: ['manual', 'bulk_manual'] }
      });

      const adminReferrals = await this.models.Referral.countDocuments({
        agentId: agentId,
        referralMethod: 'admin_assigned'
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
          telegramReferrals: telegramReferrals,
          manualReferrals: manualReferrals,
          adminReferrals: adminReferrals,
          commissionRateBingo: agent?.commissionRateBingo || 40,
          commissionRateKeno: agent?.commissionRateKeno || 10
        }
      };
    } catch (error) {
      console.error('Get agent performance metrics error:', error);
      return null;
    }
  }
}

module.exports = AgentSystem;
