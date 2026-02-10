// agent-logic.js - Manual Agent/Referral System for Elite Games - FIXED VERSION
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const validator = require('validator');
const sanitizeHtml = require('sanitize-html');
const mongoose = require('mongoose');

class ManualAgentSystem {
  constructor(io, models) {
    this.io = io;
    this.models = models;
    this.agentSockets = new Map(); // agentId -> socket
    this.commissionRates = {
      BINGO: process.env.BINGO_COMMISSION_RATE || 40,
      KENO: process.env.KENO_COMMISSION_RATE || 10
    };
    this.processingClaims = new Map();
    this.roomWinners = new Map();
    this.failedLoginAttempts = new Map(); // For rate limiting
    this.dashboardCache = new Map();
    
    // Rate limiting configuration
    this.rateLimit = {
      login: { windowMs: 15 * 60 * 1000, maxAttempts: 5 }, // 15 minutes, 5 attempts
      referral: { windowMs: 60 * 1000, maxRequests: 10 }, // 1 minute, 10 requests
      withdrawal: { windowMs: 60 * 1000, maxRequests: 3 } // 1 minute, 3 requests
    };
  }

  async initialize() {
    console.log('✅ Manual Agent system initializing...');
    await this.ensureAdminAgent();
    await this.createDatabaseIndexes();
    // Start background jobs
    this.startCommissionCalculationJob();
    this.startCleanupJob();
    console.log('👑 Manual Agent system ready with 40% Bingo and 10% Keno commissions');
  }

  // Set game logic references
  setGameLogic(gameLogic) {
    this.gameLogic = gameLogic;
  }

  setKenoLogic(kenoLogic) {
    this.kenoLogic = kenoLogic;
  }

  // Create necessary database indexes for performance
  async createDatabaseIndexes() {
    try {
      console.log('📊 Creating database indexes...');
      
      await this.models.User.createIndexes([
        { userId: 1 },
        { telegramUsername: 1 },
        { phoneNumber: 1 },
        { agentId: 1, isOnline: 1 },
        { agentId: 1, agentReferredAt: -1 },
        { agentId: 1, referredBy: 1 },
        { agentId: 1, totalWins: -1 }
      ]);

      await this.models.Agent.createIndexes([
        { username: 1, unique: true },
        { isActive: 1, totalEarnings: -1 },
        { lastLogin: -1 }
      ]);

      await this.models.AgentCommission.createIndexes([
        { agentId: 1, createdAt: -1 },
        { agentId: 1, status: 1, createdAt: -1 },
        { agentId: 1, gameType: 1, createdAt: -1 },
        { userId: 1, createdAt: -1 },
        { createdAt: -1 }
      ]);

      await this.models.Referral.createIndexes([
        { agentId: 1, userId: 1, unique: true },
        { agentId: 1, createdAt: -1 },
        { userId: 1 }
      ]);

      await this.models.AgentTransaction.createIndexes([
        { agentId: 1, type: 1, createdAt: -1 },
        { agentId: 1, status: 1, createdAt: -1 },
        { createdAt: -1 }
      ]);

      console.log('✅ Database indexes created successfully');
    } catch (error) {
      console.error('❌ Failed to create database indexes:', error);
    }
  }

  // Secure input sanitization
  sanitizeInput(input) {
    if (typeof input === 'string') {
      // Remove potentially dangerous characters
      let sanitized = sanitizeHtml(input, {
        allowedTags: [],
        allowedAttributes: {}
      });
      
      // Trim and limit length
      sanitized = sanitized.trim().substring(0, 255);
      
      return sanitized;
    }
    return input;
  }

  // Validate phone number (Ethiopian format)
  validatePhoneNumber(phone) {
    return validator.isMobilePhone(phone, 'am-ET');
  }

  // Rate limiting middleware
  checkRateLimit(socket, type, identifier) {
    const now = Date.now();
    const limitConfig = this.rateLimit[type];
    
    if (!limitConfig) return true; // No rate limit for this type
    
    const key = `${type}:${identifier || socket.id}`;
    const attempts = this.failedLoginAttempts.get(key) || [];
    
    // Remove attempts outside the time window
    const validAttempts = attempts.filter(time => now - time < limitConfig.windowMs);
    
    if (validAttempts.length >= limitConfig.maxAttempts) {
      return false;
    }
    
    validAttempts.push(now);
    this.failedLoginAttempts.set(key, validAttempts);
    return true;
  }

  // Initialize socket event handlers
  initializeSocketHandlers(socket) {
    // Authentication handlers
    socket.on('agent:login', (data) => this.handleAgentLogin(socket, data));
    socket.on('agent:verifyToken', (data) => this.handleVerifyAgentToken(socket, data));
    
    // Dashboard handlers
    socket.on('agent:getDashboard', () => this.handleAgentDashboard(socket));
    socket.on('agent:refreshDashboard', () => this.handleRefreshDashboard(socket));
    
    // Referral handlers
    socket.on('agent:manualReferralAssignment', (data) => this.handleManualReferralAssignmentByAgent(socket, data));
    socket.on('agent:bulkManualReferral', (data) => this.handleBulkManualReferral(socket, data));
    socket.on('agent:searchUsers', (data) => this.handleSearchUsers(socket, data));
    socket.on('agent:checkReferralStatus', (data) => this.handleCheckReferralStatus(socket, data));
    socket.on('agent:getUserSuggestions', () => this.handleGetUserSuggestions(socket));
    socket.on('agent:getDetailedReferralInfo', (data) => this.getDetailedReferralInfo(socket, data));
    
    // Commission handlers
    socket.on('agent:getCommissionHistory', () => this.loadCommissionHistory(socket));
    socket.on('agent:getReport', (data) => this.handleAgentReport(socket, data));
    
    // Withdrawal handlers
    socket.on('agent:withdrawRequest', (data) => this.handleAgentWithdrawRequest(socket, data));
    socket.on('agent:getWithdrawalHistory', () => this.handleGetWithdrawalHistory(socket));
    
    // Admin handlers
    socket.on('agent:getAllAgents', () => this.handleGetAllAgents(socket));
    socket.on('agent:createAgent', (data) => this.handleCreateAgent(socket, data));
    socket.on('agent:updateAgent', (data) => this.handleUpdateAgent(socket, data));
    socket.on('agent:deleteAgent', (agentId) => this.handleDeleteAgent(socket, agentId));
    socket.on('agent:processWithdrawals', (data) => this.processPendingWithdrawals(socket, data));
    socket.on('agent:getSystemAnalytics', () => this.getSystemAnalytics(socket));
    socket.on('agent:exportAgentData', (data) => this.exportAgentData(socket, data));
    socket.on('agent:manualAssignment', (data) => this.handleManualReferralAssignment(socket, data));
    
    // Debug handlers
    socket.on('agent:emergencySync', () => this.handleEmergencySync(socket));
    socket.on('agent:testUserDatabase', () => this.testUserDatabase(socket));
    socket.on('agent:testReferralAssignment', (data) => this.testReferralAssignment(socket, data));
    
    // Disconnect handler
    socket.on('disconnect', () => this.handleAgentDisconnect(socket));
  }

  // Create admin agent with environment variables
  async ensureAdminAgent() {
    try {
      const adminUsername = process.env.ADMIN_USERNAME || 'admin';
      const adminPassword = process.env.ADMIN_PASSWORD || crypto.randomBytes(16).toString('hex');
      const adminName = process.env.ADMIN_NAME || 'System Administrator';
      const adminPhone = process.env.ADMIN_PHONE || '';
      
      const adminExists = await this.models.Agent.findOne({ username: adminUsername });
      if (!adminExists) {
        const hashedPassword = await bcrypt.hash(adminPassword, 10);
        const adminAgent = await this.models.Agent.create({
          username: adminUsername,
          password: hashedPassword,
          name: adminName,
          commissionRateBingo: this.commissionRates.BINGO,
          commissionRateKeno: this.commissionRates.KENO,
          totalEarnings: 0,
          totalReferrals: 0,
          activeReferrals: 0,
          isActive: true,
          isSuperAdmin: true,
          phoneNumber: adminPhone,
          createdAt: new Date(),
          updatedAt: new Date()
        });
        
        console.log('👑 Default admin agent created');
        console.log(`   Username: ${adminUsername}`);
        console.log(`   Password: ${adminPassword}`);
        console.log('⚠️  CHANGE THIS PASSWORD IMMEDIATELY!');
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

  // Enhanced agent login with rate limiting
  async handleAgentLogin(socket, data) {
    try {
      // Rate limiting check
      if (!this.checkRateLimit(socket, 'login', data.username)) {
        socket.emit('agent:loginError', 'Too many login attempts. Please try again in 15 minutes.');
        return;
      }
      
      // Input validation
      const { username, password } = data;
      
      if (!validator.isAlphanumeric(username.replace('_', '').replace('-', '')) || username.length < 4) {
        socket.emit('agent:loginError', 'Invalid username format');
        return;
      }
      
      if (!password || password.length < 6) {
        socket.emit('agent:loginError', 'Password must be at least 6 characters');
        return;
      }
      
      const agent = await this.models.Agent.findOne({ 
        username: username.toLowerCase().trim() 
      });
      
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

      // Check if password needs to be changed (first login with default password)
      const isDefaultPassword = agent.createdAt && 
        (new Date() - agent.createdAt) < 24 * 60 * 60 * 1000 && // Created less than 24 hours ago
        agent.lastLogin === undefined;
      
      // Store agent info in socket
      socket.agentId = agent._id.toString();
      socket.agentData = {
        id: agent._id,
        username: agent.username,
        name: agent.name,
        isSuperAdmin: agent.isSuperAdmin,
        needsPasswordChange: isDefaultPassword
      };

      this.agentSockets.set(agent._id.toString(), socket);

      // Update last login
      agent.lastLogin = new Date();
      await agent.save();

      // Clear failed login attempts
      const key = `login:${username}`;
      this.failedLoginAttempts.delete(key);

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
        needsPasswordChange: isDefaultPassword
      });

      console.log(`👤 Agent logged in: ${agent.username} (Super Admin: ${agent.isSuperAdmin})`);
    } catch (error) {
      console.error('Agent login error:', error);
      socket.emit('agent:loginError', 'Login failed');
    }
  }

  // Token verification with enhanced security
  async handleVerifyAgentToken(socket, data) {
    try {
      const { token } = data;
      
      if (!token || !validator.isMongoId(token)) {
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

      // Check for suspicious activity (multiple logins from different IPs)
      const existingSocket = this.agentSockets.get(agent._id.toString());
      if (existingSocket && existingSocket.id !== socket.id) {
        console.warn(`⚠️ Multiple login detected for agent: ${agent.username}`);
        // Send notification to existing socket
        existingSocket.emit('agent:multipleLogin', {
          message: 'Your account was logged in from another location',
          timestamp: new Date()
        });
        // Disconnect the old session
        existingSocket.disconnect();
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
        phoneNumber: agent.phoneNumber || ''
      });

      console.log(`👤 Agent auto-logged in: ${agent.username} via token`);
    } catch (error) {
      console.error('Token verification error:', error);
      socket.emit('agent:tokenInvalid');
    }
  }

  // Optimized dashboard with caching
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

      // Check cache first
      const cacheKey = `dashboard:${agent._id}:${Math.floor(Date.now() / 60000)}`; // Cache per minute
      if (this.dashboardCache.has(cacheKey)) {
        const cachedData = this.dashboardCache.get(cacheKey);
        socket.emit('agent:dashboardData', cachedData);
        return;
      }

      // Use single aggregation for all data
      const dashboardData = await this.getDashboardData(agent);
      
      // Cache the results
      this.dashboardCache.set(cacheKey, dashboardData);
      
      socket.emit('agent:dashboardData', dashboardData);

      console.log(`📊 Dashboard sent to agent ${agent.username}: ${dashboardData.referrals.length} referrals`);
    } catch (error) {
      console.error('Dashboard error:', error);
      socket.emit('agent:error', 'Failed to load dashboard');
    }
  }

  // Optimized dashboard data retrieval
  async getDashboardData(agent) {
    const session = await mongoose.startSession();
    try {
      await session.startTransaction();
      
      const now = new Date();
      const today = new Date(now.setHours(0, 0, 0, 0));
      const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
      const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
      
      // Parallel database queries for performance
      const [
        userReferrals,
        referralRecords,
        commissions,
        statsAggregation
      ] = await Promise.all([
        this.models.User.find({ 
          agentId: agent._id,
          $or: [
            { agentReferredAt: { $exists: true } },
            { referredBy: { $exists: true } }
          ]
        })
        .sort({ agentReferredAt: -1 })
        .limit(50)
        .select('userId userName telegramUsername balance totalWagered totalWins totalBingos joinedAt lastSeen isOnline agentReferredAt referredBy')
        .session(session),
        
        this.models.Referral.find({ agentId: agent._id })
          .sort({ createdAt: -1 })
          .limit(50)
          .session(session),
        
        this.models.AgentCommission.find({ agentId: agent._id })
          .sort({ createdAt: -1 })
          .limit(50)
          .populate('userId', 'userName userId telegramUsername')
          .session(session),
        
        this.models.AgentCommission.aggregate([
          {
            $match: {
              agentId: agent._id,
              status: 'completed'
            }
          },
          {
            $facet: {
              today: [
                { $match: { createdAt: { $gte: today } } },
                { $group: { _id: null, total: { $sum: '$commissionAmount' }, count: { $sum: 1 } } }
              ],
              yesterday: [
                { $match: { createdAt: { $gte: yesterday, $lt: today } } },
                { $group: { _id: null, total: { $sum: '$commissionAmount' }, count: { $sum: 1 } } }
              ],
              month: [
                { $match: { createdAt: { $gte: startOfMonth } } },
                { $group: { _id: null, total: { $sum: '$commissionAmount' }, count: { $sum: 1 } } }
              ],
              allTime: [
                { $group: { _id: null, total: { $sum: '$commissionAmount' }, count: { $sum: 1 } } }
              ]
            }
          }
        ]).session(session)
      ]);

      // Fix any data mismatches
      if (userReferrals.length !== referralRecords.length) {
        await this.fixReferralDataMismatch(agent._id, userReferrals, referralRecords, session);
      }

      // Get active referrals count
      const activeReferrals = await this.models.User.countDocuments({
        agentId: agent._id,
        isOnline: true
      }).session(session);

      // Update agent stats
      const actualReferralCount = await this.models.User.countDocuments({ 
        agentId: agent._id,
        $or: [
          { agentReferredAt: { $exists: true } },
          { referredBy: { $exists: true } }
        ]
      }).session(session);
      
      agent.activeReferrals = activeReferrals;
      agent.totalReferrals = actualReferralCount;
      await agent.save({ session });

      // Calculate earnings growth
      const todayStats = statsAggregation[0]?.today[0] || { total: 0 };
      const yesterdayStats = statsAggregation[0]?.yesterday[0] || { total: 0 };
      const earningsGrowth = yesterdayStats.total > 0 
        ? ((todayStats.total - yesterdayStats.total) / yesterdayStats.total * 100).toFixed(1)
        : todayStats.total > 0 ? 100 : 0;

      await session.commitTransaction();

      return {
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
          todaysEarnings: todayStats.total,
          yesterdayEarnings: yesterdayStats.total,
          earningsGrowth: earningsGrowth,
          monthlyEarnings: statsAggregation[0]?.month[0]?.total || 0,
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
          referredBy: user.referredBy || 'manual'
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
      };

    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }

  // Refresh dashboard with cache invalidation
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

      // Invalidate cache
      const cacheKeys = Array.from(this.dashboardCache.keys())
        .filter(key => key.includes(`dashboard:${agent._id}`));
      cacheKeys.forEach(key => this.dashboardCache.delete(key));

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

      // Get fresh dashboard data
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

  // Enhanced user search with input validation
  async findUserByIdentifier(identifier) {
    try {
      const cleanId = this.sanitizeInput(identifier.replace('@', '').trim().toLowerCase());
      
      if (!cleanId || cleanId.length < 2) {
        return null;
      }

      console.log(`🔍 [FIND USER] Searching for identifier: "${cleanId}"`);
      
      // Priority-based search (most specific first)
      const queries = [
        // 1. Exact userId match
        { userId: cleanId },
        // 2. Exact telegramUsername (without @)
        { telegramUsername: cleanId },
        // 3. Phone number
        { phoneNumber: cleanId },
        // 4. Telegram ID format (tg_123456)
        { userId: cleanId.startsWith('tg_') ? cleanId : `tg_${cleanId}` },
        // 5. Partial matches (least specific)
        { userId: { $regex: `^${cleanId}`, $options: 'i' } },
        { telegramUsername: { $regex: `^${cleanId}`, $options: 'i' } },
        { userName: { $regex: `^${cleanId}`, $options: 'i' } }
      ];

      // Execute queries in order until we find a match
      for (const query of queries) {
        const user = await this.models.User.findOne(query);
        if (user) {
          console.log(`✅ [FIND USER] Found by query:`, query);
          return user;
        }
      }
      
      console.log(`❌ [FIND USER] No user found for identifier: "${cleanId}"`);
      return null;
    } catch (error) {
      console.error('❌ [FIND USER] Error:', error);
      return null;
    }
  }

  // Manual referral assignment with transactions and audit logging
  async handleManualReferralAssignmentByAgent(socket, data) {
    const session = await mongoose.startSession();
    try {
      await session.startTransaction();
      
      if (!socket.agentId) {
        throw new Error('Not authenticated');
      }

      const { userIdentifier } = data;
      if (!userIdentifier) {
        throw new Error('Player identifier is required');
      }

      // Input validation and sanitization
      const cleanIdentifier = this.sanitizeInput(userIdentifier);
      if (cleanIdentifier.length < 2) {
        throw new Error('Identifier too short');
      }

      const agent = await this.models.Agent.findById(socket.agentId).session(session);
      if (!agent) {
        throw new Error('Agent not found');
      }

      if (!agent.isActive) {
        throw new Error('Agent account is inactive');
      }

      console.log(`🔍 [MANUAL REFERRAL] Agent ${agent.username} searching for player: "${cleanIdentifier}"`);
      
      // Find user
      const user = await this.findUserByIdentifier(cleanIdentifier);
      if (!user) {
        throw new Error(`Player not found: "${userIdentifier}". Make sure the player has played at least once.`);
      }

      console.log(`✅ [MANUAL REFERRAL] Player found: ${user.userId} (${user.userName || 'No Name'})`);

      // Check if user already has an agent
      if (user.agentId) {
        if (user.agentId.toString() === agent._id.toString()) {
          throw new Error(`"${user.userName || user.userId}" is already your referral.`);
        }
        
        const currentAgent = await this.models.Agent.findById(user.agentId).session(session);
        throw new Error(
          `"${user.userName || user.userId}" is already assigned to agent: ${currentAgent?.name || currentAgent?.username || 'Unknown'}`
        );
      }

      // Check in Referral collection
      const existingReferral = await this.models.Referral.findOne({
        userId: user.userId,
        agentId: { $exists: true, $ne: null }
      }).session(session);
      
      if (existingReferral && existingReferral.agentId.toString() !== agent._id.toString()) {
        throw new Error(`"${user.userName || user.userId}" has an existing referral record with another agent.`);
      }

      // ✅ Update User collection
      user.agentId = agent._id;
      user.agentReferredAt = new Date();
      user.referredBy = 'manual';
      await user.save({ session });

      // ✅ Create referral record
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
      await referral.save({ session });

      // ✅ Update agent stats based on actual count
      const actualReferralCount = await this.models.User.countDocuments({ 
        agentId: agent._id,
        $or: [
          { agentReferredAt: { $exists: true } },
          { referredBy: { $exists: true } }
        ]
      }).session(session);
      
      agent.totalReferrals = actualReferralCount;
      if (user.isOnline) {
        agent.activeReferrals = (agent.activeReferrals || 0) + 1;
      }
      agent.updatedAt = new Date();
      await agent.save({ session });

      // ✅ Create audit log
      await this.logAuditEvent(socket, 'REFERRAL_ADDED', {
        agentId: agent._id,
        agentName: agent.name,
        userId: user.userId,
        userName: user.userName,
        method: 'manual',
        timestamp: new Date()
      });

      await session.commitTransaction();

      // Send success response
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
        }
      });

      // Send notification to agent
      this.sendAgentNotification(agent._id, 
        `✅ New manual referral: ${user.userName || user.userId}`, 
        'success'
      );

      console.log(`✅ Manual referral added: ${user.userId} -> Agent ${agent.username}`);
      
      // Refresh dashboard
      setTimeout(() => {
        this.handleRefreshDashboard(socket);
      }, 1000);
      
    } catch (error) {
      await session.abortTransaction();
      console.error('Manual referral error:', error);
      socket.emit('agent:error', error.message || 'Failed to add referral');
    } finally {
      session.endSession();
    }
  }

  // Bulk referral assignment with progress tracking
  async handleBulkManualReferral(socket, data) {
    const session = await mongoose.startSession();
    try {
      await session.startTransaction();
      
      if (!socket.agentId) {
        throw new Error('Not authenticated');
      }

      const { userIdentifiers } = data;
      if (!Array.isArray(userIdentifiers) || userIdentifiers.length === 0) {
        throw new Error('Please provide at least one player identifier');
      }

      const agent = await this.models.Agent.findById(socket.agentId).session(session);
      if (!agent) {
        throw new Error('Agent not found');
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

      // Process with progress updates
      for (let i = 0; i < identifiersToProcess.length; i++) {
        const identifier = identifiersToProcess[i];
        
        // Send progress update
        socket.emit('agent:bulkProgress', {
          current: i + 1,
          total: identifiersToProcess.length,
          processed: identifier
        });

        try {
          const cleanIdentifier = this.sanitizeInput(identifier.replace('@', '').trim().toLowerCase());
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

          // Check if already assigned
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

          // Check in Referral collection
          const existingReferral = await this.models.Referral.findOne({
            userId: user.userId,
            agentId: { $exists: true, $ne: null }
          }).session(session);
          
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

          // ✅ Update User collection
          user.agentId = agent._id;
          user.agentReferredAt = new Date();
          user.referredBy = 'bulk_manual';
          await user.save({ session });

          // ✅ Create referral record
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
          await referral.save({ session });

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

      // Update agent stats based on actual count
      if (results.success > 0) {
        const actualReferralCount = await this.models.User.countDocuments({ 
          agentId: agent._id,
          $or: [
            { agentReferredAt: { $exists: true } },
            { referredBy: { $exists: true } }
          ]
        }).session(session);
        agent.totalReferrals = actualReferralCount;
        agent.updatedAt = new Date();
        await agent.save({ session });
      }

      await session.commitTransaction();

      // Send final results
      socket.emit('agent:bulkManualReferralResult', {
        success: true,
        summary: results,
        agentStats: {
          totalReferrals: agent.totalReferrals,
          activeReferrals: agent.activeReferrals
        }
      });

      // Create audit log for bulk operation
      await this.logAuditEvent(socket, 'BULK_REFERRAL_ADDED', {
        agentId: agent._id,
        agentName: agent.name,
        totalProcessed: results.totalProcessed,
        success: results.success,
        failed: results.failed,
        timestamp: new Date()
      });

      if (results.success > 0) {
        this.sendAgentNotification(agent._id, 
          `✅ Bulk referrals: Added ${results.success} new players`, 
          'success'
        );
        
        // Refresh dashboard
        setTimeout(() => {
          this.handleRefreshDashboard(socket);
        }, 1000);
      }

      console.log(`✅ Bulk manual referrals: ${results.success} added, ${results.failed} failed`);
      
    } catch (error) {
      await session.abortTransaction();
      console.error('Bulk manual referral error:', error);
      socket.emit('agent:error', 'Failed to process bulk referrals');
    } finally {
      session.endSession();
    }
  }

  // Enhanced search users with validation
  async handleSearchUsers(socket, data) {
    try {
      if (!socket.agentId) {
        socket.emit('agent:error', 'Not authenticated');
        return;
      }

      const { query, limit = 15 } = data;
      if (!query || query.trim().length < 2) {
        socket.emit('agent:searchUsersResult', { users: [], query });
        return;
      }

      const agent = await this.models.Agent.findById(socket.agentId);
      const cleanQuery = this.sanitizeInput(query.replace('@', '').trim().toLowerCase());
      
      if (cleanQuery.length < 2) {
        socket.emit('agent:searchUsersResult', { users: [], query });
        return;
      }

      console.log(`🔍 [SEARCH] Searching users for query: "${cleanQuery}"`);
      
      // Build search query
      const searchConditions = [];
      
      // Exact matches first
      searchConditions.push({ userId: cleanId });
      searchConditions.push({ telegramUsername: cleanId });
      searchConditions.push({ userName: cleanId });
      
      // Partial matches
      searchConditions.push({ userId: { $regex: cleanId, $options: 'i' } });
      searchConditions.push({ telegramUsername: { $regex: cleanId, $options: 'i' } });
      searchConditions.push({ userName: { $regex: cleanId, $options: 'i' } });
      searchConditions.push({ phoneNumber: { $regex: cleanId, $options: 'i' } });

      // Only include users without agents OR users with other agents
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

  // Commission recording with real-time updates
  async recordCommission(agentId, userId, gameType, stake, winningAmount) {
    const session = await mongoose.startSession();
    try {
      await session.startTransaction();
      
      const agent = await this.models.Agent.findById(agentId).session(session);
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

      // Minimum commission 0.01 ETB
      if (commissionAmount < 0.01) {
        commissionAmount = 0.01;
      }

      const user = await this.models.User.findOne({ userId }).session(session);
      if (!user) {
        return 0;
      }

      // Update user's agent commission earned
      user.agentCommissionEarned = (user.agentCommissionEarned || 0) + commissionAmount;
      await user.save({ session });

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

      await commission.save({ session });

      // Update agent earnings
      agent.totalEarnings = (agent.totalEarnings || 0) + commissionAmount;
      agent.lastCommissionDate = new Date();
      await agent.save({ session });

      // Create transaction record
      const agentTransaction = new this.models.AgentTransaction({
        agentId: agent._id,
        type: 'COMMISSION',
        amount: commissionAmount,
        description: `${gameType} commission from referral ${userId.substring(0, 8)}...`,
        status: 'completed',
        createdAt: new Date()
      });
      await agentTransaction.save({ session });

      // Update game transaction with agent commission
      const gameTransaction = await this.models.Transaction.findOne({
        userId: userId,
        type: gameType === 'BINGO' ? 'BINGO_WIN' : 'KENO_WIN',
        amount: winningAmount,
        createdAt: { $gte: new Date(Date.now() - 60000) }
      }).sort({ createdAt: -1 }).session(session);

      if (gameTransaction) {
        gameTransaction.agentId = agent._id;
        gameTransaction.agentCommission = commissionAmount;
        gameTransaction.commissionProcessed = true;
        await gameTransaction.save({ session });
      }

      await session.commitTransaction();

      // Notify agent in real-time
      this.sendRealTimeCommissionUpdate(agentId, {
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

      console.log(`💰 Agent commission: ${agent.username} earned ${commissionAmount.toFixed(2)} ETB from ${gameType} (Player: ${userId})`);
      return commissionAmount;
    } catch (error) {
      await session.abortTransaction();
      console.error('Record commission error:', error);
      return 0;
    } finally {
      session.endSession();
    }
  }

  // Send real-time commission update
  sendRealTimeCommissionUpdate(agentId, commissionData) {
    const agentSocket = this.agentSockets.get(agentId.toString());
    if (agentSocket) {
      agentSocket.emit('agent:newCommission', commissionData);
    }
    
    // Also update dashboard cache
    this.invalidateAgentCache(agentId);
  }

  // Process Bingo win for agent commission
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

      // Send real-time notification
      if (commissionAmount > 0) {
        this.io.emit('game:commissionEarned', {
          agentId: user.agentId,
          userId: userId,
          gameType: 'BINGO',
          amount: commissionAmount,
          timestamp: new Date()
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
        return 0;
      }

      const commissionAmount = await this.recordCommission(
        user.agentId,
        userId,
        'KENO',
        stake,
        winningAmount
      );

      // Send real-time notification
      if (commissionAmount > 0) {
        this.io.emit('game:commissionEarned', {
          agentId: user.agentId,
          userId: userId,
          gameType: 'KENO',
          amount: commissionAmount,
          timestamp: new Date()
        });
      }

      return commissionAmount;
    } catch (error) {
      console.error('Process Keno win error:', error);
      return 0;
    }
  }

  // Enhanced withdrawal request with validation
  async handleAgentWithdrawRequest(socket, data) {
    const session = await mongoose.startSession();
    try {
      await session.startTransaction();
      
      if (!socket.agentId) {
        throw new Error('Not authenticated');
      }

      const { amount, phoneNumber } = data;
      const agent = await this.models.Agent.findById(socket.agentId).session(session);
      
      if (!agent) {
        throw new Error('Agent not found');
      }

      // Validate amount
      const amountNum = parseFloat(amount);
      if (isNaN(amountNum) || amountNum <= 0) {
        throw new Error('Invalid amount');
      }

      if (amountNum > agent.totalEarnings) {
        throw new Error('Insufficient earnings');
      }

      // Validate phone number
      if (!phoneNumber || !this.validatePhoneNumber(phoneNumber)) {
        throw new Error('Invalid phone number. Must be Ethiopian format (09xxxxxxxx)');
      }

      // Rate limiting for withdrawals
      if (!this.checkRateLimit(socket, 'withdrawal')) {
        throw new Error('Too many withdrawal requests. Please try again later.');
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

      await transaction.save({ session });

      // Update agent earnings
      agent.totalEarnings -= amountNum;
      agent.updatedAt = new Date();
      await agent.save({ session });

      // Create audit log
      await this.logAuditEvent(socket, 'WITHDRAWAL_REQUESTED', {
        agentId: agent._id,
        agentName: agent.name,
        amount: amountNum,
        phoneNumber: phoneNumber,
        transactionId: transaction._id,
        timestamp: new Date()
      });

      await session.commitTransaction();

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
      await session.abortTransaction();
      console.error('Withdraw request error:', error);
      socket.emit('agent:error', error.message || 'Failed to process withdrawal request');
    } finally {
      session.endSession();
    }
  }

  // Process pending withdrawals (admin only)
  async processPendingWithdrawals(socket, data) {
    const session = await mongoose.startSession();
    try {
      await session.startTransaction();
      
      if (!socket.agentData?.isSuperAdmin) {
        throw new Error('Unauthorized - Admin access required');
      }

      const { transactionIds } = data;
      if (!Array.isArray(transactionIds) || transactionIds.length === 0) {
        throw new Error('No transactions specified');
      }

      let processed = 0;
      let failed = 0;
      const results = [];

      for (const transactionId of transactionIds) {
        try {
          const transaction = await this.models.AgentTransaction.findById(transactionId).session(session);
          if (!transaction || transaction.type !== 'WITHDRAWAL' || transaction.status !== 'pending') {
            failed++;
            continue;
          }

          // Simulate payment processing (integrate with actual payment gateway here)
          const paymentResult = await this.processPayment(transaction);
          
          if (paymentResult.success) {
            transaction.status = 'completed';
            transaction.processedAt = new Date();
            transaction.processedBy = socket.agentId;
            await transaction.save({ session });

            processed++;
            results.push({ transactionId, status: 'completed' });
            
            // Notify agent
            this.sendAgentNotification(transaction.agentId, 
              `✅ Withdrawal of ${-transaction.amount} ETB has been processed`, 
              'success'
            );
          } else {
            transaction.status = 'failed';
            transaction.error = paymentResult.error;
            await transaction.save({ session });
            
            failed++;
            results.push({ transactionId, status: 'failed', error: paymentResult.error });
          }
        } catch (err) {
          console.error(`Error processing withdrawal ${transactionId}:`, err);
          failed++;
          results.push({ transactionId, status: 'error', error: err.message });
        }
      }

      await session.commitTransaction();

      socket.emit('agent:withdrawalsProcessed', {
        message: `Processed ${processed} withdrawals, ${failed} failed`,
        processed,
        failed,
        results
      });

      console.log(`💰 Processed ${processed} withdrawals by admin ${socket.agentData?.username}`);
    } catch (error) {
      await session.abortTransaction();
      console.error('Process pending withdrawals error:', error);
      socket.emit('agent:error', error.message || 'Failed to process withdrawals');
    } finally {
      session.endSession();
    }
  }

  // Simulate payment processing (replace with actual payment gateway integration)
  async processPayment(transaction) {
    // TODO: Integrate with Telebirr or other payment gateway
    // This is a mock implementation
    return new Promise((resolve) => {
      setTimeout(() => {
        // Simulate 95% success rate
        const success = Math.random() < 0.95;
        resolve({
          success,
          transactionId: transaction._id,
          reference: `PAY-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          error: success ? null : 'Payment gateway timeout'
        });
      }, 1000);
    });
  }

  // Create agent with validation
  async handleCreateAgent(socket, data) {
    const session = await mongoose.startSession();
    try {
      await session.startTransaction();
      
      if (!socket.agentData?.isSuperAdmin) {
        throw new Error('Unauthorized - Admin access required');
      }

      const { username, password, name, commissionRateBingo, commissionRateKeno, phoneNumber } = data;

      // Input validation
      if (!username || !password || !name) {
        throw new Error('Username, password and name are required');
      }

      if (!validator.isAlphanumeric(username.replace('_', '').replace('-', '')) || username.length < 4) {
        throw new Error('Username must be at least 4 alphanumeric characters');
      }

      if (password.length < 8) {
        throw new Error('Password must be at least 8 characters');
      }

      if (name.length < 2) {
        throw new Error('Name must be at least 2 characters');
      }

      if (phoneNumber && !this.validatePhoneNumber(phoneNumber)) {
        throw new Error('Invalid phone number format');
      }

      // Check if agent exists
      const existingAgent = await this.models.Agent.findOne({ 
        username: username.toLowerCase().trim() 
      }).session(session);
      
      if (existingAgent) {
        throw new Error('Username already exists');
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

      await agent.save({ session });

      // Create audit log
      await this.logAuditEvent(socket, 'AGENT_CREATED', {
        createdBy: socket.agentData?.username,
        agentId: agent._id,
        agentName: agent.name,
        agentUsername: agent.username,
        timestamp: new Date()
      });

      await session.commitTransaction();

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
      await session.abortTransaction();
      console.error('Create agent error:', error);
      socket.emit('agent:error', error.message || 'Failed to create agent');
    } finally {
      session.endSession();
    }
  }

  // Audit logging
  async logAuditEvent(socket, action, details) {
    try {
      const auditLog = new this.models.AuditLog({
        agentId: socket.agentId,
        action,
        details,
        ipAddress: socket.handshake.address,
        userAgent: socket.handshake.headers['user-agent'],
        timestamp: new Date()
      });
      
      await auditLog.save();
    } catch (error) {
      console.error('Audit log error:', error);
    }
  }

  // Enhanced referral data mismatch fix
  async fixReferralDataMismatch(agentId, userReferrals, referralRecords, session = null) {
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
        
        if (session) {
          await referral.save({ session });
        } else {
          await referral.save();
        }
      }
      
      // Fix users missing agentId
      for (const ref of missingInUsers) {
        const user = await this.models.User.findOne({ userId: ref.userId });
        if (user && (!user.agentId || user.agentId.toString() !== agentId.toString())) {
          console.log(`🔗 Fixing agentId for user ${ref.userId}`);
          user.agentId = agentId;
          user.agentReferredAt = ref.createdAt || new Date();
          user.referredBy = ref.referralMethod || 'auto_fix';
          
          if (session) {
            await user.save({ session });
          } else {
            await user.save();
          }
        }
      }
      
      console.log(`✅ Fixed ${missingInReferrals.length} missing referral records and ${missingInUsers.length} missing agent assignments`);
    } catch (error) {
      console.error('Error fixing referral data mismatch:', error);
    }
  }

  // Emergency sync with progress
  async handleEmergencySync(socket) {
    try {
      if (!socket.agentId) {
        socket.emit('agent:error', 'Not authenticated');
        return;
      }

      socket.emit('agent:debugProgress', { status: 'Starting emergency sync...' });
      
      const result = await this.emergencyFixReferralSync();
      
      socket.emit('agent:emergencySyncResult', {
        success: result.success,
        created: result.created,
        errors: result.errors,
        message: result.success ? 'Emergency sync completed successfully' : 'Emergency sync failed'
      });

      // Refresh dashboard
      setTimeout(() => {
        this.handleRefreshDashboard(socket);
      }, 1000);
    } catch (error) {
      console.error('Emergency sync error:', error);
      socket.emit('agent:error', 'Emergency sync failed: ' + error.message);
    }
  }

  // Invalidate agent cache
  invalidateAgentCache(agentId) {
    const cacheKeys = Array.from(this.dashboardCache.keys())
      .filter(key => key.includes(`dashboard:${agentId}`));
    cacheKeys.forEach(key => this.dashboardCache.delete(key));
  }

  // Send agent notification
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

  // Agent disconnect handler
  handleAgentDisconnect(socket) {
    if (socket.agentId) {
      this.agentSockets.delete(socket.agentId);
      console.log(`👤 Agent disconnected: ${socket.agentData?.username}`);
    }
  }

  // Start commission calculation job
  startCommissionCalculationJob() {
    setInterval(async () => {
      try {
        await this.calculatePendingCommissions();
      } catch (error) {
        console.error('Commission calculation job error:', error);
      }
    }, 5 * 60 * 1000); // 5 minutes
  }

  // Start cleanup job
  startCleanupJob() {
    setInterval(() => {
      const now = Date.now();
      
      // Clean up old processing claims
      for (const [key, timestamp] of this.processingClaims.entries()) {
        if (now - timestamp > 10 * 60 * 1000) {
          this.processingClaims.delete(key);
        }
      }
      
      // Clean room winners
      for (const [key, timestamp] of this.roomWinners.entries()) {
        if (now - timestamp > 60 * 60 * 1000) {
          this.roomWinners.delete(key);
        }
      }
      
      // Clean old cache entries (older than 5 minutes)
      for (const [key, timestamp] of this.dashboardCache.entries()) {
        if (now - timestamp > 5 * 60 * 1000) {
          this.dashboardCache.delete(key);
        }
      }
      
      // Clean old rate limiting entries
      for (const [key, attempts] of this.failedLoginAttempts.entries()) {
        const validAttempts = attempts.filter(time => now - time < 60 * 60 * 1000); // 1 hour
        if (validAttempts.length === 0) {
          this.failedLoginAttempts.delete(key);
        } else {
          this.failedLoginAttempts.set(key, validAttempts);
        }
      }
    }, 60 * 1000); // 1 minute
  }

  // Load commission history
  async loadCommissionHistory(socket) {
    try {
      if (!socket.agentId) {
        socket.emit('agent:error', 'Not authenticated');
        return;
      }

      const commissions = await this.models.AgentCommission.find({ agentId: socket.agentId })
        .sort({ createdAt: -1 })
        .limit(100)
        .populate('userId', 'userName userId telegramUsername');

      socket.emit('agent:commissionHistory', {
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
    } catch (error) {
      console.error('Load commission history error:', error);
      socket.emit('agent:error', 'Failed to load commission history');
    }
  }

  // Check referral status
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
      const referralRecord = await this.models.Referral.findOne({
        userId: user.userId,
        agentId: agent._id
      });

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
        status: userHasAgent ? 'assigned' : 'not_assigned'
      });
    } catch (error) {
      console.error('Check referral status error:', error);
      socket.emit('agent:error', 'Failed to check referral status');
    }
  }

  // Get user suggestions
  async handleGetUserSuggestions(socket) {
    try {
      if (!socket.agentId) {
        socket.emit('agent:error', 'Not authenticated');
        return;
      }

      const agent = await this.models.Agent.findById(socket.agentId);
      
      // Get users without agents who have won something
      const potentialUsers = await this.models.User.find({
        $or: [
          { agentId: { $exists: false } },
          { agentId: null }
        ],
        totalWins: { $gt: 0 }
      })
      .select('userId userName telegramUsername balance totalWins totalBingos isOnline totalWagered lastSeen referredBy agentReferredAt')
      .limit(20)
      .sort({ totalWins: -1, joinedAt: -1 });

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
          suggestionReason: 'Active player with wins',
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

  // Get detailed referral info
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
      }).sort({ createdAt: -1 }).limit(50);

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

  // Get all agents (admin only)
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
          const totalCommissions = await this.models.AgentCommission.aggregate([
            { $match: { agentId: agent._id, status: 'completed' } },
            { $group: { _id: null, total: { $sum: '$commissionAmount' } } }
          ]);

          const totalReferrals = await this.models.User.countDocuments({ 
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

  // Update agent
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

      // Don't allow updating own super admin status
      if (updates.isSuperAdmin && agentId.toString() === socket.agentId) {
        socket.emit('agent:error', 'Cannot modify your own admin status');
        return;
      }

      const agent = await this.models.Agent.findById(agentId);
      if (!agent) {
        socket.emit('agent:error', 'Agent not found');
        return;
      }

      // Validate username if updating
      if (updates.username && updates.username !== agent.username) {
        const existing = await this.models.Agent.findOne({ username: updates.username.toLowerCase() });
        if (existing && existing._id.toString() !== agentId.toString()) {
          socket.emit('agent:error', 'Username already taken');
          return;
        }
        updates.username = updates.username.toLowerCase();
      }

      // Validate password if updating
      if (updates.password) {
        if (updates.password.length < 8) {
          socket.emit('agent:error', 'Password must be at least 8 characters');
          return;
        }
        updates.password = await bcrypt.hash(updates.password, 10);
      }

      // Validate phone number if updating
      if (updates.phoneNumber && !this.validatePhoneNumber(updates.phoneNumber)) {
        socket.emit('agent:error', 'Invalid phone number format');
        return;
      }

      updates.updatedAt = new Date();
      const updatedAgent = await this.models.Agent.findByIdAndUpdate(
        agentId,
        { $set: updates },
        { new: true }
      ).select('-password');

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

  // Delete agent (deactivate)
  async handleDeleteAgent(socket, agentId) {
    const session = await mongoose.startSession();
    try {
      await session.startTransaction();
      
      if (!socket.agentData?.isSuperAdmin) {
        throw new Error('Unauthorized - Admin access required');
      }

      if (!agentId) {
        throw new Error('Agent ID is required');
      }

      if (agentId.toString() === socket.agentId) {
        throw new Error('Cannot delete your own account');
      }

      const agent = await this.models.Agent.findById(agentId).session(session);
      if (!agent) {
        throw new Error('Agent not found');
      }

      const activeReferrals = await this.models.User.countDocuments({
        agentId: agentId,
        isOnline: true
      }).session(session);

      if (activeReferrals > 0) {
        throw new Error(`Cannot delete agent with ${activeReferrals} active referrals. Deactivate instead.`);
      }

      // Mark agent as inactive (soft delete)
      agent.isActive = false;
      agent.updatedAt = new Date();
      await agent.save({ session });

      // Remove agent from online sockets
      this.agentSockets.delete(agentId.toString());

      // Remove agent from user records
      await this.models.User.updateMany(
        { agentId: agent._id },
        { 
          $unset: { 
            agentId: "",
            agentReferredAt: "",
            agentCommissionEarned: ""
          },
          $set: {
            referredBy: 'agent_deleted'
          }
        }
      ).session(session);

      // Remove referral records
      await this.models.Referral.deleteMany({ agentId: agent._id }).session(session);

      // Create audit log
      await this.logAuditEvent(socket, 'AGENT_DELETED', {
        deletedBy: socket.agentData?.username,
        agentId: agent._id,
        agentName: agent.name,
        agentUsername: agent.username,
        timestamp: new Date()
      });

      await session.commitTransaction();

      socket.emit('agent:agentDeleted', {
        message: 'Agent deactivated successfully',
        agentId: agentId,
        agentName: agent.name
      });

      console.log(`👤 Agent deactivated: ${agent.username} by ${socket.agentData?.username || 'Admin'}`);
    } catch (error) {
      await session.abortTransaction();
      console.error('Delete agent error:', error);
      socket.emit('agent:error', error.message || 'Failed to delete agent');
    } finally {
      session.endSession();
    }
  }

  // Get withdrawal history
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

  // Get agent report
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

  // Calculate pending commissions
  async calculatePendingCommissions() {
    try {
      console.log('🔄 Calculating pending commissions...');
      
      const usersWithAgents = await this.models.User.find({ 
        agentId: { $exists: true, $ne: null },
        totalWins: { $gt: 0 }
      }).limit(100); // Process in batches

      for (const user of usersWithAgents) {
        const winTransactions = await this.models.Transaction.find({
          userId: user.userId,
          type: { $in: ['BINGO_WIN', 'KENO_WIN'] },
          commissionProcessed: { $ne: true }
        }).limit(50);

        for (const transaction of winTransactions) {
          let gameType = '';
          if (transaction.type === 'BINGO_WIN') {
            gameType = 'BINGO';
          } else if (transaction.type === 'KENO_WIN') {
            gameType = 'KENO';
          } else {
            continue;
          }

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

      console.log('✅ Pending commissions calculation completed');
    } catch (error) {
      console.error('Calculate pending commissions error:', error);
    }
  }

  // Manual referral assignment by admin
  async handleManualReferralAssignment(socket, data) {
    const session = await mongoose.startSession();
    try {
      await session.startTransaction();
      
      if (!socket.agentData?.isSuperAdmin) {
        throw new Error('Unauthorized - Admin access required');
      }

      const { userId, agentId } = data;
      
      if (!userId || !agentId) {
        throw new Error('User ID and Agent ID are required');
      }

      const agent = await this.models.Agent.findById(agentId).session(session);
      if (!agent) {
        throw new Error('Agent not found');
      }

      if (!agent.isActive) {
        throw new Error('Agent is inactive');
      }

      const user = await this.findUserByIdentifier(userId);
      if (!user) {
        throw new Error('User not found');
      }

      if (user.agentId) {
        const currentAgent = await this.models.Agent.findById(user.agentId).session(session);
        throw new Error(`User already assigned to agent: ${currentAgent?.name || currentAgent?.username || 'Unknown'}`);
      }

      // Update User collection
      user.agentId = agent._id;
      user.agentReferredAt = new Date();
      user.referredBy = 'admin_assigned';
      await user.save({ session });

      // Create referral record
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
      await referral.save({ session });

      // Update agent referral counts
      const actualReferralCount = await this.models.User.countDocuments({ 
        agentId: agent._id,
        $or: [
          { agentReferredAt: { $exists: true } },
          { referredBy: { $exists: true } }
        ]
      }).session(session);
      
      agent.totalReferrals = actualReferralCount;
      if (user.isOnline) {
        agent.activeReferrals = (agent.activeReferrals || 0) + 1;
      }
      await agent.save({ session });

      await session.commitTransaction();

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
      await session.abortTransaction();
      console.error('Manual referral assignment error:', error);
      socket.emit('agent:error', error.message || 'Failed to assign user to agent');
    } finally {
      session.endSession();
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

      const [
        totalAgents,
        activeAgents,
        newAgentsThisWeek,
        analyticsData
      ] = await Promise.all([
        this.models.Agent.countDocuments(),
        this.models.Agent.countDocuments({ isActive: true }),
        this.models.Agent.countDocuments({ createdAt: { $gte: weekAgo } }),
        this.models.AgentCommission.aggregate([
          {
            $facet: {
              today: [
                { $match: { createdAt: { $gte: today }, status: 'completed' } },
                { $group: { _id: null, total: { $sum: '$commissionAmount' }, count: { $sum: 1 } } }
              ],
              week: [
                { $match: { createdAt: { $gte: weekAgo }, status: 'completed' } },
                { $group: { _id: null, total: { $sum: '$commissionAmount' }, count: { $sum: 1 } } }
              ],
              month: [
                { $match: { createdAt: { $gte: monthAgo }, status: 'completed' } },
                { $group: { _id: null, total: { $sum: '$commissionAmount' }, count: { $sum: 1 } } }
              ],
              gameBreakdown: [
                { $match: { createdAt: { $gte: monthAgo }, status: 'completed' } },
                {
                  $group: {
                    _id: '$gameType',
                    totalCommission: { $sum: '$commissionAmount' },
                    totalGames: { $sum: 1 },
                    avgCommission: { $avg: '$commissionAmount' }
                  }
                }
              ],
              topAgents: [
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
              ]
            }
          }
        ])
      ]);

      const [pendingWithdrawals, completedWithdrawals] = await Promise.all([
        this.models.AgentTransaction.aggregate([
          { $match: { type: 'WITHDRAWAL', status: 'pending' } },
          { $group: { _id: null, count: { $sum: 1 }, total: { $sum: { $abs: '$amount' } } } }
        ]),
        this.models.AgentTransaction.aggregate([
          { $match: { type: 'WITHDRAWAL', status: 'completed', createdAt: { $gte: monthAgo } } },
          { $group: { _id: null, count: { $sum: 1 }, total: { $sum: { $abs: '$amount' } } } }
        ])
      ]);

      socket.emit('agent:systemAnalytics', {
        agents: {
          total: totalAgents,
          active: activeAgents,
          newThisWeek: newAgentsThisWeek,
          inactive: totalAgents - activeAgents
        },
        commissions: {
          today: analyticsData[0]?.today[0] || { total: 0, count: 0 },
          week: analyticsData[0]?.week[0] || { total: 0, count: 0 },
          month: analyticsData[0]?.month[0] || { total: 0, count: 0 }
        },
        gameBreakdown: analyticsData[0]?.gameBreakdown || [],
        topAgents: analyticsData[0]?.topAgents || [],
        withdrawals: {
          pending: pendingWithdrawals[0] || { count: 0, total: 0 },
          completed: completedWithdrawals[0] || { count: 0, total: 0 }
        },
        timestamp: new Date()
      });
    } catch (error) {
      console.error('Get system analytics error:', error);
      socket.emit('agent:error', 'Failed to get system analytics');
    }
  }

  // Export agent data
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

      const [commissions, referrals, withdrawals] = await Promise.all([
        this.models.AgentCommission.find({
          agentId: agent._id,
          createdAt: { $gte: start, $lte: end },
          status: 'completed'
        }).sort({ createdAt: -1 }),
        
        this.models.User.find({
          agentId: agent._id,
          $or: [
            { agentReferredAt: { $gte: start, $lte: end } },
            { agentReferredAt: { $exists: true } }
          ]
        }).sort({ agentReferredAt: -1 }),
        
        this.models.AgentTransaction.find({
          agentId: agent._id,
          type: 'WITHDRAWAL',
          createdAt: { $gte: start, $lte: end }
        }).sort({ createdAt: -1 })
      ]);

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

  // Emergency fix referral sync
  async emergencyFixReferralSync(agentId = null) {
    const session = await mongoose.startSession();
    try {
      await session.startTransaction();
      
      console.log('🚨 Starting emergency referral sync...');
      
      let query = {};
      if (agentId) {
        query.agentId = agentId;
      }
      
      const usersWithAgents = await this.models.User.find({
        agentId: { $exists: true, $ne: null }
      }).session(session);
      
      let created = 0;
      let errors = 0;
      
      for (const user of usersWithAgents) {
        try {
          const existingReferral = await this.models.Referral.findOne({
            userId: user.userId,
            agentId: user.agentId
          }).session(session);
          
          if (!existingReferral) {
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
            await referral.save({ session });
            created++;
            console.log(`✅ Created referral record for ${user.userId}`);
          }
        } catch (error) {
          errors++;
          console.error(`❌ Error syncing user ${user.userId}:`, error.message);
        }
      }
      
      // Update agent counts
      const agents = agentId ? [await this.models.Agent.findById(agentId).session(session)] : await this.models.Agent.find().session(session);
      
      for (const agent of agents) {
        if (agent) {
          const actualReferralCount = await this.models.User.countDocuments({ 
            agentId: agent._id,
            $or: [
              { agentReferredAt: { $exists: true } },
              { referredBy: { $exists: true } }
            ]
          }).session(session);
          agent.totalReferrals = actualReferralCount;
          await agent.save({ session });
          console.log(`✅ Updated agent ${agent.username}: ${actualReferralCount} referrals`);
        }
      }
      
      await session.commitTransaction();
      
      console.log(`🚨 Emergency sync completed: ${created} records created, ${errors} errors`);
      return { success: true, created, errors };
      
    } catch (error) {
      await session.abortTransaction();
      console.error('Emergency fix error:', error);
      return { success: false, error: error.message };
    } finally {
      session.endSession();
    }
  }

  // Test user database
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
          isOnline: u.isOnline,
          referredBy: u.referredBy,
          agentReferredAt: u.agentReferredAt
        }))
      });
    } catch (error) {
      console.error('Test error:', error);
    }
  }

  // Test referral assignment
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

      const user = await this.models.User.findOne({ userId });
      if (!user) {
        socket.emit('agent:error', 'User not found');
        return;
      }

      const currentState = {
        userId: user.userId,
        userName: user.userName,
        currentAgentId: user.agentId,
        hasAgent: !!user.agentId,
        referredBy: user.referredBy,
        agentReferredAt: user.agentReferredAt
      };

      const [agentReferrals, referralRecords] = await Promise.all([
        this.models.User.countDocuments({ 
          agentId: agent._id,
          $or: [
            { agentReferredAt: { $exists: true } },
            { referredBy: { $exists: true } }
          ]
        }),
        this.models.Referral.countDocuments({ agentId: agent._id })
      ]);

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

  // Get system status
  getSystemStatus() {
    return {
      totalAgents: this.agentSockets.size,
      processingClaims: this.processingClaims.size,
      roomWinners: this.roomWinners.size,
      cacheSize: this.dashboardCache.size,
      rateLimitEntries: this.failedLoginAttempts.size,
      commissionRates: this.commissionRates,
      isInitialized: true,
      timestamp: new Date()
    };
  }

  // Cleanup agent system
  async cleanup() {
    try {
      console.log('🧹 Cleaning up agent system...');
      
      // Clear caches
      this.agentSockets.clear();
      this.processingClaims.clear();
      this.roomWinners.clear();
      this.dashboardCache.clear();
      this.failedLoginAttempts.clear();
      
      console.log('✅ Agent system cleanup completed');
    } catch (error) {
      console.error('Agent system cleanup error:', error);
    }
  }
}

module.exports = ManualAgentSystem;
