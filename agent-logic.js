[file name]: agent-logic.js
[file content begin]
// agent-logic.js - Enhanced Agent/Referral System for Elite Games
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
    this.processingClaims = new Map();
    this.roomWinners = new Map();
    this.gameLogic = null;
    this.kenoLogic = null;
    this.botUsername = '@Ethio_elite_games_bot';
  }

  async initialize() {
    console.log('🚀 Initializing Agent System...');
    console.log(`🤖 Bot username: ${this.botUsername}`);
    
    await this.ensureAdminAgent();
    await this.loadReferralCache();
    
    this.startCommissionCalculationJob();
    this.startCleanupJob();
    
    console.log('✅ Agent System Ready');
  }

  setGameLogic(gameLogic) {
    this.gameLogic = gameLogic;
  }

  setKenoLogic(kenoLogic) {
    this.kenoLogic = kenoLogic;
  }

  // 🔐 ADMIN ACCESS CHECK
  checkAdminAccess(socket) {
    return socket.admin || (socket.agentData && socket.agentData.isSuperAdmin);
  }

  // 👑 ADMIN AGENT CREATION
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
        console.log('👑 Admin agent created (admin/admin123)');
        this.referralCache.set('ADMIN001', adminAgent._id.toString());
        return adminAgent;
      }
      return adminExists;
    } catch (error) {
      console.error('Admin agent creation error:', error);
      return null;
    }
  }

  // 📊 LOAD REFERRAL CACHE
  async loadReferralCache() {
    try {
      const agents = await this.models.Agent.find({ isActive: true }).select('referralCode');
      agents.forEach(agent => {
        if (agent.referralCode) {
          this.referralCache.set(agent.referralCode, agent._id.toString());
        }
      });
      console.log(`📊 Loaded ${this.referralCache.size} referral codes`);
    } catch (error) {
      console.error('Cache loading error:', error);
    }
  }

  // 🔐 AGENT LOGIN
  async handleAgentLogin(socket, data) {
    try {
      const { username, password } = data;
      
      const agent = await this.models.Agent.findOne({ 
        username: username.toLowerCase().trim() 
      });
      
      if (!agent) {
        socket.emit('agent:loginError', 'Invalid username or password');
        return;
      }

      if (!agent.isActive) {
        socket.emit('agent:loginError', 'Account deactivated');
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
        referralCode: agent.referralCode || '',
        lastLogin: agent.lastLogin
      });

      console.log(`👤 Agent login: ${agent.username}`);
    } catch (error) {
      console.error('Login error:', error);
      socket.emit('agent:loginError', 'Login failed');
    }
  }

  // 🔄 TOKEN VERIFICATION (AUTO LOGIN)
  async handleVerifyAgentToken(socket, data) {
    try {
      const { token } = data;
      
      if (!token) {
        socket.emit('agent:tokenInvalid');
        return;
      }

      const agent = await this.models.Agent.findById(token);
      if (!agent || !agent.isActive) {
        socket.emit('agent:tokenInvalid');
        return;
      }

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

      console.log(`👤 Auto-login: ${agent.username}`);
    } catch (error) {
      console.error('Token verification error:', error);
      socket.emit('agent:tokenInvalid');
    }
  }

  // 📊 AGENT DASHBOARD DATA
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

      // Get recent referrals (50)
      const referrals = await this.models.User.find({ agentId: agent._id })
        .sort({ agentReferredAt: -1 })
        .limit(50)
        .select('userId userName balance totalWagered totalWins totalBingos joinedAt lastSeen isOnline referredBy agentReferredAt');

      // Get referral records
      const referralRecords = await this.models.Referral.find({ 
        agentId: agent._id,
        userId: { $in: referrals.map(r => r.userId) }
      }).sort({ createdAt: -1 });

      // Combine data
      const referralRecordMap = {};
      referralRecords.forEach(record => {
        if (!referralRecordMap[record.userId]) {
          referralRecordMap[record.userId] = record;
        }
      });

      const enhancedReferrals = referrals.map(user => {
        const referralRecord = referralRecordMap[user.userId];
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

      // Get recent commissions (50)
      const commissions = await this.models.AgentCommission.find({ agentId: agent._id })
        .sort({ createdAt: -1 })
        .limit(50)
        .populate('userId', 'userName userId');

      // Today's earnings
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

      // Yesterday's earnings
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

      // Monthly earnings
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

      // Active referrals
      const activeReferrals = await this.models.User.countDocuments({
        agentId: agent._id,
        isOnline: true
      });

      // Update agent's active referrals
      agent.activeReferrals = activeReferrals;
      await agent.save();

      // Earnings growth
      const todayTotal = todaysEarnings[0]?.total || 0;
      const yesterdayTotal = yesterdayEarnings[0]?.total || 0;
      const earningsGrowth = yesterdayTotal > 0 
        ? ((todayTotal - yesterdayTotal) / yesterdayTotal * 100).toFixed(1)
        : todayTotal > 0 ? 100 : 0;

      // Referral methods breakdown
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

      // Leaderboard position
      const allAgents = await this.models.Agent.find({ isActive: true })
        .select('totalEarnings name')
        .sort({ totalEarnings: -1 });
      
      const rank = allAgents.findIndex(a => a._id.toString() === agent._id.toString()) + 1;

      // Send dashboard data
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
          adminReferrals: adminReferrals,
          totalReferralMethods: telegramReferrals + manualReferrals + adminReferrals,
          rank: rank,
          nextRankAmount: rank > 1 ? allAgents[rank - 2]?.totalEarnings || 0 : 0
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
          referralMethod: comm.referralMethod || 'unknown',
          status: comm.status,
          createdAt: comm.createdAt
        }))
      });

      console.log(`📊 Dashboard sent: ${agent.username}`);
    } catch (error) {
      console.error('Dashboard error:', error);
      socket.emit('agent:error', 'Failed to load dashboard');
    }
  }

  // 🔗 GENERATE REFERRAL LINK
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
        
        this.referralCache.set(newCode, agent._id.toString());
      }

      // Generate Telegram referral link
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

  // 🤖 TELEGRAM BOT REFERRAL PROCESSING
  async handleTelegramReferral(userId, startParam) {
    try {
      let referralCode = startParam;
      
      // Extract referral code
      if (startParam && startParam.startsWith('agent')) {
        referralCode = startParam.toUpperCase();
      }

      console.log(`🤖 Telegram referral: User ${userId}, Code: ${referralCode}`);

      // Find agent
      const agent = await this.getAgentByReferralCode(referralCode);
      if (!agent) {
        console.log(`❌ Agent not found: ${referralCode}`);
        return { success: false, message: 'Invalid referral code' };
      }

      if (!agent.isActive) {
        return { success: false, message: 'Agent account is inactive' };
      }

      // Find user
      const user = await this.models.User.findOne({ userId });
      if (!user) {
        return { success: false, message: 'User not found in system' };
      }

      // Check if user already has an agent
      if (user.agentId) {
        if (user.agentId.toString() === agent._id.toString()) {
          // Check if referral record exists
          const existingReferral = await this.models.Referral.findOne({
            agentId: agent._id,
            userId: userId
          });
          
          if (!existingReferral) {
            // Create missing referral record
            const referralRecord = new this.models.Referral({
              agentId: agent._id,
              userId: user.userId,
              userName: user.userName,
              referralMethod: 'telegram_link',
              referralCode: agent.referralCode,
              status: 'active',
              createdAt: user.agentReferredAt || new Date(),
              updatedAt: new Date()
            });
            await referralRecord.save();
          }
          
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
        `✅ New Telegram referral: ${user.userName || user.userId}`, 
        'success'
      );

      console.log(`✅ Telegram referral success: ${user.userId} -> Agent ${agent.username}`);

      return {
        success: true,
        message: `Successfully registered under agent ${agent.name}!`,
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
      return { success: false, message: 'Failed to process referral' };
    }
  }

  // 👤 MANUAL REFERRAL ADDITION - FIXED VERSION
  async handleManualReferralAssignmentByAgent(socket, data) {
    try {
      if (!socket.agentId) {
        socket.emit('agent:error', 'Not authenticated');
        return;
      }

      const { userIdentifier } = data;
      if (!userIdentifier || userIdentifier.trim() === '') {
        socket.emit('agent:error', 'Please enter a username, user ID, or display name');
        return;
      }

      const agent = await this.models.Agent.findById(socket.agentId);
      if (!agent) {
        socket.emit('agent:error', 'Agent not found');
        return;
      }

      // Clean the identifier
      const cleanIdentifier = userIdentifier.replace('@', '').trim();
      
      console.log(`🔍 Manual referral attempt: "${cleanIdentifier}" by agent ${agent.username}`);
      
      // Find user by multiple methods
      const user = await this.findUserByIdentifier(cleanIdentifier);
      
      if (!user) {
        console.log(`❌ User not found: "${cleanIdentifier}"`);
        
        // Try to find similar users
        const similarUsers = await this.models.User.find({
          $or: [
            { userName: { $regex: cleanIdentifier, $options: 'i' } },
            { userId: { $regex: cleanIdentifier, $options: 'i' } }
          ]
        }).limit(5).select('userId userName totalWins isOnline');
        
        if (similarUsers.length > 0) {
          const suggestions = similarUsers.map(u => 
            `• ${u.userName || 'No Name'} (${u.userId.substring(0, 12)}...) - ${u.totalWins} wins - ${u.isOnline ? 'Online' : 'Offline'}`
          ).join('\n');
          
          socket.emit('agent:error', 
            `User "${cleanIdentifier}" not found. Similar users:\n${suggestions}`
          );
        } else {
          socket.emit('agent:error', 
            `User "${cleanIdentifier}" not found. Make sure the user has played at least once.`
          );
        }
        return;
      }

      console.log(`✅ User found: ${user.userId} (${user.userName || 'No Name'})`);

      // Check if user already has an agent
      if (user.agentId) {
        if (user.agentId.toString() === agent._id.toString()) {
          // User is already assigned to this agent
          const existingReferral = await this.models.Referral.findOne({
            agentId: agent._id,
            userId: user.userId
          });
          
          if (!existingReferral) {
            // Create missing referral record
            const referralRecord = new this.models.Referral({
              agentId: agent._id,
              userId: user.userId,
              userName: user.userName,
              referralMethod: 'manual',
              referralCode: agent.referralCode,
              status: 'active',
              createdAt: user.agentReferredAt || new Date(),
              updatedAt: new Date()
            });
            await referralRecord.save();
          }
          
          socket.emit('agent:manualReferralSuccess', {
            success: true,
            alreadyYours: true,
            message: `✅ "${user.userName || user.userId}" is already your referral.`,
            user: {
              userId: user.userId,
              userName: user.userName
            }
          });
          return;
        }
        
        // User has another agent
        const currentAgent = await this.models.Agent.findById(user.agentId);
        socket.emit('agent:error', 
          `❌ "${user.userName || user.userId}" is already assigned to agent: ${currentAgent?.name || 'Another agent'}`
        );
        return;
      }

      // ✅ ASSIGN USER TO AGENT
      user.agentId = agent._id;
      user.agentReferredAt = new Date();
      user.referredBy = 'manual';
      await user.save();

      // Update agent stats
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

      // Send success response
      socket.emit('agent:manualReferralSuccess', {
        success: true,
        message: `✅ Successfully added "${user.userName || user.userId}" as your referral!`,
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

      // Send real-time notification
      this.sendAgentNotification(agent._id, 
        `🎯 New manual referral: ${user.userName || user.userId}`, 
        'success'
      );

      console.log(`✅ Manual referral added: ${user.userId} -> Agent ${agent.username}`);

    } catch (error) {
      console.error('Manual referral error:', error);
      socket.emit('agent:error', `Failed to add referral: ${error.message}`);
    }
  }

  // 🔍 IMPROVED USER IDENTIFIER SEARCH
  async findUserByIdentifier(identifier) {
    const cleanId = identifier.trim().toLowerCase();
    
    console.log(`🔍 Searching for user: "${cleanId}"`);
    
    // Try different search patterns in order of specificity
    const searchPatterns = [
      // Exact Telegram ID match
      { userId: cleanId },
      // Exact username match (case insensitive)
      { userName: { $regex: new RegExp('^' + cleanId + '$', 'i') } },
      // Partial Telegram ID match
      { userId: { $regex: cleanId, $options: 'i' } },
      // Partial username match
      { userName: { $regex: cleanId, $options: 'i' } },
      // Phone number match
      { phoneNumber: cleanId },
      // Telegram ID without 'tg_' prefix
      { userId: { $regex: 'tg_' + cleanId.replace(/^tg_/, ''), $options: 'i' } },
      // Display name match
      { displayName: { $regex: cleanId, $options: 'i' } }
    ];

    for (const pattern of searchPatterns) {
      try {
        const user = await this.models.User.findOne(pattern);
        if (user) {
          console.log(`✅ Found with pattern:`, pattern);
          return user;
        }
      } catch (err) {
        console.log(`⚠️ Pattern failed:`, pattern, err.message);
      }
    }

    // Broader search as last resort
    const users = await this.models.User.find({
      $or: [
        { userId: { $regex: cleanId, $options: 'i' } },
        { userName: { $regex: cleanId, $options: 'i' } },
        { phoneNumber: { $regex: cleanId, $options: 'i' } }
      ]
    }).limit(5);
    
    return users.length > 0 ? users[0] : null;
  }

  // 👥 BULK MANUAL REFERRAL
  async handleBulkManualReferral(socket, data) {
    try {
      if (!socket.agentId) {
        socket.emit('agent:error', 'Not authenticated');
        return;
      }

      const { userIdentifiers } = data;
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
          const cleanIdentifier = identifier.replace('@', '').trim();
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
            message: 'Successfully added'
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
          `📦 Bulk referrals: Added ${results.success} new users`, 
          'success'
        );
      }

      console.log(`✅ Bulk referrals: ${results.success} added, ${results.failed} failed`);

    } catch (error) {
      console.error('Bulk manual referral error:', error);
      socket.emit('agent:error', 'Failed to process bulk referrals');
    }
  }

  // 🔎 SEARCH USERS
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
              { userId: { $regex: cleanQuery, $options: 'i' } },
              { userName: { $regex: cleanQuery, $options: 'i' } },
              { phoneNumber: { $regex: cleanQuery, $options: 'i' } }
            ]
          }
        ]
      };

      // Exclude current agent's referrals
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
        .sort({ isOnline: -1, totalWins: -1 });

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
      socket.emit('agent:error', 'Search failed');
    }
  }

  // 💰 RECORD COMMISSION
  async recordCommission(agentId, userId, gameType, stake, winningAmount) {
    try {
      const agent = await this.models.Agent.findById(agentId);
      if (!agent || !agent.isActive) {
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

      // Minimum commission
      if (commissionAmount < 0.01) {
        commissionAmount = 0.01;
      }

      // Get user info
      const user = await this.models.User.findOne({ userId });
      if (!user) {
        return 0;
      }

      // Get referral method
      const referralRecord = await this.models.Referral.findOne({
        agentId: agent._id,
        userId: userId
      }).sort({ createdAt: -1 });

      const referralMethod = referralRecord ? referralRecord.referralMethod : (user.referredBy || 'unknown');

      // Update user's agent commission
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
        referralMethod: referralMethod,
        status: 'completed',
        createdAt: new Date()
      });
      await commission.save();

      // Update agent earnings
      agent.totalEarnings = (agent.totalEarnings || 0) + commissionAmount;
      agent.lastCommissionDate = new Date();
      await agent.save();

      // Create transaction record
      const agentTransaction = new this.models.AgentTransaction({
        agentId: agent._id,
        type: 'COMMISSION',
        amount: commissionAmount,
        description: `${gameType} commission from ${userId.substring(0, 8)}... via ${referralMethod}`,
        status: 'completed',
        createdAt: new Date()
      });
      await agentTransaction.save();

      // Notify agent in real-time
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
          referralMethod: referralMethod,
          timestamp: new Date()
        });
      }

      // Update daily stats
      await this.updateDailyAgentStats(agentId, commissionAmount);

      console.log(`💰 Commission: ${agent.username} earned ${commissionAmount.toFixed(2)} ETB from ${gameType}`);
      return commissionAmount;
    } catch (error) {
      console.error('Record commission error:', error);
      return 0;
    }
  }

  // 📈 PROCESS BINGO WIN
  async processBingoWin(userId, room, winningAmount) {
    try {
      const user = await this.models.User.findOne({ userId });
      if (!user || !user.agentId) {
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

  // 🎰 PROCESS KENO WIN
  async processKenoWin(userId, stake, winningAmount) {
    try {
      const user = await this.models.User.findOne({ userId });
      if (!user || !user.agentId) {
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

  // 💸 WITHDRAWAL REQUEST
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
      if (isNaN(amountNum) || amountNum < 10) {
        socket.emit('agent:error', 'Minimum withdrawal is 10 ETB');
        return;
      }

      if (amountNum > agent.totalEarnings) {
        socket.emit('agent:error', 'Insufficient earnings');
        return;
      }

      // Validate phone number
      if (!phoneNumber || !/^09[0-9]{8}$/.test(phoneNumber)) {
        socket.emit('agent:error', 'Invalid Ethiopian phone number (09xxxxxxxx)');
        return;
      }

      // Create withdrawal transaction
      const transaction = new this.models.AgentTransaction({
        agentId: agent._id,
        type: 'WITHDRAWAL',
        amount: -amountNum,
        description: `Withdrawal to ${phoneNumber}`,
        status: 'pending',
        createdAt: new Date()
      });
      await transaction.save();

      // Update agent earnings
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

      console.log(`💰 Withdrawal requested: ${agent.name} - ${amountNum} ETB`);
    } catch (error) {
      console.error('Withdraw request error:', error);
      socket.emit('agent:error', 'Failed to process withdrawal');
    }
  }

  // 📊 GET AGENT LEADERBOARD
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
            totalGames: { $sum: 1 }
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
            totalGames: 1
          }
        },
        { $sort: { totalCommission: -1 } },
        { $limit: limit }
      ]);

      return leaderboard;
    } catch (error) {
      console.error('Leaderboard error:', error);
      return [];
    }
  }

  // 🔔 SEND AGENT NOTIFICATION
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
      console.error('Notification error:', error);
      return false;
    }
  }

  // 📡 BROADCAST TO ADMINS
  broadcastToAdmins(event, data) {
    this.agentSockets.forEach((socket, agentId) => {
      if (socket.agentData?.isSuperAdmin) {
        socket.emit(event, data);
      }
    });
  }

  // 📤 AGENT DISCONNECT
  handleAgentDisconnect(socket) {
    if (socket.agentId) {
      this.agentSockets.delete(socket.agentId);
      console.log(`👤 Agent disconnected: ${socket.agentData?.username}`);
    }
  }

  // ⚙️ UTILITY METHODS
  async getAgentByReferralCode(referralCode) {
    try {
      const agentId = this.referralCache.get(referralCode);
      if (agentId) {
        return await this.models.Agent.findById(agentId);
      }

      const agent = await this.models.Agent.findOne({ referralCode });
      if (agent) {
        this.referralCache.set(referralCode, agent._id.toString());
        return agent;
      }

      return null;
    } catch (error) {
      console.error('Get agent by code error:', error);
      return null;
    }
  }

  async updateDailyAgentStats(agentId, commissionAmount) {
    try {
      const today = new Date().toISOString().split('T')[0];
      
      await this.models.Stats.findOneAndUpdate(
        { date: today },
        {
          $inc: {
            agentCommissions: commissionAmount,
            agentReferrals: 0
          }
        },
        { upsert: true, new: true }
      );

      const activeAgents = await this.models.Agent.countDocuments({ isActive: true });
      await this.models.Stats.findOneAndUpdate(
        { date: today },
        { $set: { activeAgents: activeAgents } },
        { upsert: true }
      );
    } catch (error) {
      console.error('Update stats error:', error);
    }
  }

  async calculatePendingCommissions() {
    try {
      console.log('🔄 Calculating pending commissions...');
      
      const usersWithAgents = await this.models.User.find({ 
        agentId: { $exists: true, $ne: null },
        totalWins: { $gt: 0 }
      });

      for (const user of usersWithAgents) {
        const winTransactions = await this.models.Transaction.find({
          userId: user.userId,
          type: { $in: ['BINGO_WIN', 'KENO_WIN'] },
          commissionProcessed: { $ne: true }
        });

        for (const transaction of winTransactions) {
          let gameType = '';
          if (transaction.type === 'BINGO_WIN') gameType = 'BINGO';
          if (transaction.type === 'KENO_WIN') gameType = 'KENO';
          
          if (!gameType) continue;

          const stake = transaction.room ? transaction.room * 2 : 10;
          await this.recordCommission(
            user.agentId,
            user.userId,
            gameType,
            stake,
            transaction.amount
          );

          transaction.commissionProcessed = true;
          await transaction.save();
        }
      }

      console.log('✅ Pending commissions calculated');
    } catch (error) {
      console.error('Commission calculation error:', error);
    }
  }

  // ⏰ SCHEDULED JOBS
  startCommissionCalculationJob() {
    setInterval(async () => {
      try {
        await this.calculatePendingCommissions();
      } catch (error) {
        console.error('Commission job error:', error);
      }
    }, 5 * 60 * 1000);
  }

  startCleanupJob() {
    setInterval(() => {
      const now = Date.now();
      for (const [key, timestamp] of this.processingClaims.entries()) {
        if (now - timestamp > 10 * 60 * 1000) {
          this.processingClaims.delete(key);
        }
      }
      
      for (const [key, timestamp] of this.roomWinners.entries()) {
        if (now - timestamp > 60 * 60 * 1000) {
          this.roomWinners.delete(key);
        }
      }
    }, 60 * 1000);
  }

  // 🔧 FIX MISSING REFERRAL RECORDS
  async fixMissingReferralRecords(socket) {
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

      const users = await this.models.User.find({ 
        agentId: agent._id 
      }).select('userId userName referredBy agentReferredAt');

      let fixedCount = 0;
      let alreadyExistCount = 0;

      for (const user of users) {
        const existingReferral = await this.models.Referral.findOne({
          agentId: agent._id,
          userId: user.userId
        });

        if (!existingReferral) {
          const referralRecord = new this.models.Referral({
            agentId: agent._id,
            userId: user.userId,
            userName: user.userName,
            referralMethod: user.referredBy || 'unknown',
            referralCode: agent.referralCode,
            status: 'active',
            createdAt: user.agentReferredAt || new Date(),
            updatedAt: new Date()
          });
          await referralRecord.save();
          fixedCount++;
        } else {
          alreadyExistCount++;
        }
      }

      socket.emit('agent:fixResult', {
        success: true,
        message: `Fixed ${fixedCount} missing records. ${alreadyExistCount} already existed.`,
        fixedCount,
        alreadyExistCount,
        totalUsers: users.length
      });

      console.log(`🔧 Fixed ${fixedCount} records for ${agent.username}`);
    } catch (error) {
      console.error('Fix records error:', error);
      socket.emit('agent:error', 'Failed to fix records');
    }
  }

  // 📊 GET SYSTEM STATUS
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

  // 🧹 CLEANUP
  async cleanup() {
    try {
      console.log('🧹 Cleaning up agent system...');
      
      this.agentSockets.clear();
      this.referralCache.clear();
      this.processingClaims.clear();
      this.roomWinners.clear();
      
      console.log('✅ Cleanup completed');
    } catch (error) {
      console.error('Cleanup error:', error);
    }
  }
}

module.exports = AgentSystem;
[file content end]
