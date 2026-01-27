// agent-logic.js - Complete Agent/Referral System for Bingo Elite
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
  }

  async initialize() {
    console.log('✅ Agent system initialized');
    
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
          isActive: true,
          isSuperAdmin: true,
          referralCode: 'ADMIN001',
          phoneNumber: '0962577855'
        });
        console.log('👑 Default admin agent created');
        
        // Add to cache
        this.referralCache.set('ADMIN001', adminAgent._id.toString());
      }
    } catch (error) {
      console.error('Error creating admin agent:', error);
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
      
      const agent = await this.models.Agent.findOne({ username });
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

      console.log(`👤 Agent logged in: ${agent.username}`);
    } catch (error) {
      console.error('Agent login error:', error);
      socket.emit('agent:loginError', 'Login failed');
    }
  }

  // Get agent dashboard data
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

      // Get recent referrals (last 50)
      const referrals = await this.models.User.find({ agentId: agent._id })
        .sort({ joinedAt: -1 })
        .limit(50)
        .select('userId userName balance totalWagered totalWins totalBingos joinedAt lastSeen isOnline');

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
          })
        },
        referrals: referrals,
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

  // Generate referral link
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

      const referralLink = `https://t.me/ethio_games1_bot?start=ref_${agent.referralCode}`;
      const referralMessage = `Join Bingo Elite using my referral link and I'll get commission from your wins! 🎮\n\n${referralLink}\n\nAgent: ${agent.name}`;
      
      socket.emit('agent:referralLink', {
        referralCode: agent.referralCode,
        referralLink: referralLink,
        referralMessage: referralMessage,
        qrCode: `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(referralLink)}`
      });
    } catch (error) {
      console.error('Generate link error:', error);
      socket.emit('agent:error', 'Failed to generate referral link');
    }
  }

  // Process referral when user joins via referral link
  async processReferral(userId, referralCode) {
    try {
      if (!referralCode) return null;

      // Check cache first
      let agentId = this.referralCache.get(referralCode);
      
      if (!agentId) {
        // Check database
        const agent = await this.models.Agent.findOne({ referralCode });
        if (!agent) return null;
        
        agentId = agent._id.toString();
        this.referralCache.set(referralCode, agentId);
      }

      // Assign agent to user
      const user = await this.models.User.findOne({ userId });
      if (user) {
        user.agentId = agentId;
        await user.save();

        // Update agent's referral count
        await this.models.Agent.findByIdAndUpdate(agentId, {
          $inc: { totalReferrals: 1 }
        });

        console.log(`✅ Referral processed: ${userId} -> Agent ${agentId} (${referralCode})`);
        return agentId;
      }

      return null;
    } catch (error) {
      console.error('Process referral error:', error);
      return null;
    }
  }

  // Record commission for agent
  async recordCommission(agentId, userId, gameType, stake, winningAmount) {
    try {
      const agent = await this.models.Agent.findById(agentId);
      if (!agent) return 0;

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

      // Create commission record
      const commission = new this.models.AgentCommission({
        agentId: agent._id,
        userId: userId,
        gameType: gameType,
        stake: stake,
        winningAmount: winningAmount,
        commissionRate: commissionRate,
        commissionAmount: commissionAmount,
        status: 'completed'
      });

      await commission.save();

      // Update agent earnings
      agent.totalEarnings += commissionAmount;
      agent.lastCommissionDate = new Date();
      await agent.save();

      // Create transaction record for agent
      const agentTransaction = new this.models.AgentTransaction({
        agentId: agent._id,
        type: 'COMMISSION',
        amount: commissionAmount,
        description: `${gameType} commission from referral ${userId.substring(0, 8)}...`,
        status: 'completed'
      });
      await agentTransaction.save();

      // Notify agent in real-time if online
      const agentSocket = this.agentSockets.get(agentId.toString());
      if (agentSocket) {
        agentSocket.emit('agent:newCommission', {
          commissionId: commission._id,
          userId: userId,
          gameType: gameType,
          winningAmount: winningAmount,
          commissionAmount: commissionAmount,
          timestamp: new Date()
        });
      }

      console.log(`💰 Agent commission: ${agent.username} earned ${commissionAmount.toFixed(2)} ETB from ${gameType}`);
      return commissionAmount;
    } catch (error) {
      console.error('Record commission error:', error);
      return 0;
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
          await this.recordCommission(
            user.agentId,
            user.userId,
            gameType,
            transaction.amount / 2, // Assuming stake is half of win amount
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

  // Super Admin: Get all agents
  async handleGetAllAgents(socket) {
    try {
      if (!socket.agentData?.isSuperAdmin) {
        socket.emit('agent:error', 'Unauthorized');
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

          // Get total referrals
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

          return {
            ...agent.toObject(),
            totalCommissions: totalCommissions[0]?.total || 0,
            totalReferrals: totalReferrals,
            activeReferrals: activeReferrals,
            todaysEarnings: todaysEarnings[0]?.total || 0
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
      if (!socket.agentData?.isSuperAdmin) {
        socket.emit('agent:error', 'Unauthorized');
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
      const existingAgent = await this.models.Agent.findOne({ username });
      if (existingAgent) {
        socket.emit('agent:error', 'Username already exists');
        return;
      }

      // Hash password
      const hashedPassword = await bcrypt.hash(password, 10);

      // Generate unique referral code
      let referralCode;
      let isUnique = false;
      
      while (!isUnique) {
        referralCode = `AGENT${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
        const existing = await this.models.Agent.findOne({ referralCode });
        if (!existing) {
          isUnique = true;
        }
      }

      // Create agent
      const agent = new this.models.Agent({
        username: username.toLowerCase(),
        password: hashedPassword,
        name,
        commissionRateBingo: commissionRateBingo || 40,
        commissionRateKeno: commissionRateKeno || 10,
        referralCode,
        phoneNumber: phoneNumber || '',
        isActive: true,
        isSuperAdmin: false
      });

      await agent.save();

      // Add to cache
      this.referralCache.set(referralCode, agent._id.toString());

      socket.emit('agent:agentCreated', {
        message: 'Agent created successfully',
        agent: {
          id: agent._id,
          username: agent.username,
          name: agent.name,
          referralCode: agent.referralCode,
          commissionRateBingo: agent.commissionRateBingo,
          commissionRateKeno: agent.commissionRateKeno
        }
      });

      // Notify all admin agents
      this.broadcastToAdmins('agent:newAgentCreated', {
        agentId: agent._id,
        username: agent.username,
        name: agent.name,
        createdAt: new Date()
      });

      console.log(`👤 New agent created: ${agent.username} by ${socket.agentData.username}`);
    } catch (error) {
      console.error('Create agent error:', error);
      socket.emit('agent:error', 'Failed to create agent');
    }
  }

  // Super Admin: Update agent
  async handleUpdateAgent(socket, data) {
    try {
      if (!socket.agentData?.isSuperAdmin) {
        socket.emit('agent:error', 'Unauthorized');
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
        const existing = await this.models.Agent.findOne({ username: updates.username });
        if (existing && existing._id.toString() !== agentId.toString()) {
          socket.emit('agent:error', 'Username already taken');
          return;
        }
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

      console.log(`👤 Agent updated: ${updatedAgent.username} by ${socket.agentData.username}`);
    } catch (error) {
      console.error('Update agent error:', error);
      socket.emit('agent:error', 'Failed to update agent');
    }
  }

  // Super Admin: Delete agent
  async handleDeleteAgent(socket, agentId) {
    try {
      if (!socket.agentData?.isSuperAdmin) {
        socket.emit('agent:error', 'Unauthorized');
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
      await agent.save();

      // Remove agent from online sockets
      this.agentSockets.delete(agentId.toString());

      socket.emit('agent:agentDeleted', {
        message: 'Agent deactivated successfully',
        agentId: agentId,
        agentName: agent.name
      });

      console.log(`👤 Agent deactivated: ${agent.username} by ${socket.agentData.username}`);
    } catch (error) {
      console.error('Delete agent error:', error);
      socket.emit('agent:error', 'Failed to delete agent');
    }
  }

  // Super Admin: Reset agent password
  async handleResetAgentPassword(socket, data) {
    try {
      if (!socket.agentData?.isSuperAdmin) {
        socket.emit('agent:error', 'Unauthorized');
        return;
      }

      const { agentId, newPassword } = data;
      
      if (!agentId || !newPassword) {
        socket.emit('agent:error', 'Agent ID and new password are required');
        return;
      }

      if (newPassword.length < 6) {
        socket.emit('agent:error', 'Password must be at least 6 characters');
        return;
      }

      const agent = await this.models.Agent.findById(agentId);
      if (!agent) {
        socket.emit('agent:error', 'Agent not found');
        return;
      }

      // Hash new password
      const hashedPassword = await bcrypt.hash(newPassword, 10);
      agent.password = hashedPassword;
      await agent.save();

      socket.emit('agent:passwordReset', {
        message: 'Password reset successfully',
        agentId: agentId,
        agentName: agent.name
      });

      console.log(`🔑 Password reset for agent: ${agent.username} by ${socket.agentData.username}`);
    } catch (error) {
      console.error('Reset password error:', error);
      socket.emit('agent:error', 'Failed to reset password');
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

      // Get hourly distribution for the period
      const hourlyDistribution = await this.models.AgentCommission.aggregate([
        { $match: matchQuery },
        {
          $group: {
            _id: { $hour: "$createdAt" },
            totalCommission: { $sum: "$commissionAmount" },
            count: { $sum: 1 }
          }
        },
        { $sort: { "_id": 1 } }
      ]);

      // Get top referral users by commission generated
      const topReferrals = await this.models.AgentCommission.aggregate([
        { $match: matchQuery },
        {
          $group: {
            _id: "$userId",
            totalCommission: { $sum: "$commissionAmount" },
            totalGames: { $sum: 1 },
            totalWinnings: { $sum: "$winningAmount" }
          }
        },
        { $sort: { totalCommission: -1 } },
        { $limit: 10 }
      ]);

      // Get game type breakdown
      const gameTypeBreakdown = await this.models.AgentCommission.aggregate([
        { $match: matchQuery },
        {
          $group: {
            _id: "$gameType",
            totalCommission: { $sum: "$commissionAmount" },
            totalGames: { $sum: 1 },
            totalWinnings: { $sum: "$winningAmount" },
            averageCommission: { $avg: "$commissionAmount" }
          }
        }
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
        dailyCommissions: dailyCommissions,
        hourlyDistribution: hourlyDistribution,
        topReferrals: topReferrals,
        gameTypeBreakdown: gameTypeBreakdown,
        summary: summary[0] || { 
          totalCommission: 0, 
          totalGames: 0, 
          totalWinnings: 0,
          averageCommission: 0,
          minCommission: 0,
          maxCommission: 0
        },
        dateRange: { 
          startDate: start, 
          endDate: end,
          days: Math.ceil((end - start) / (1000 * 60 * 60 * 24))
        }
      });
    } catch (error) {
      console.error('Report error:', error);
      socket.emit('agent:error', 'Failed to generate report');
    }
  }

  // Export agent data to CSV
  async handleExportAgentData(socket, data) {
    try {
      if (!socket.agentData?.isSuperAdmin) {
        socket.emit('agent:error', 'Unauthorized');
        return;
      }

      const { agentId, startDate, endDate } = data;
      const start = startDate ? new Date(startDate) : new Date(0);
      const end = endDate ? new Date(endDate) : new Date();
      end.setHours(23, 59, 59, 999);

      const matchQuery = { agentId };
      if (startDate || endDate) {
        matchQuery.createdAt = {};
        if (startDate) matchQuery.createdAt.$gte = start;
        if (endDate) matchQuery.createdAt.$lte = end;
      }

      const commissions = await this.models.AgentCommission.find(matchQuery)
        .populate('userId', 'userName userId')
        .sort({ createdAt: -1 });

      // Format CSV data
      const csvRows = [];
      
      // Header row
      csvRows.push(['Date', 'Time', 'User ID', 'Username', 'Game Type', 'Stake (ETB)', 'Win Amount (ETB)', 'Commission Rate (%)', 'Commission (ETB)', 'Status'].join(','));

      // Data rows
      commissions.forEach(commission => {
        const date = new Date(commission.createdAt);
        const dateStr = date.toISOString().split('T')[0];
        const timeStr = date.toTimeString().split(' ')[0];
        
        csvRows.push([
          dateStr,
          timeStr,
          commission.userId?.userId || 'Unknown',
          commission.userId?.userName || 'Unknown',
          commission.gameType,
          commission.stake.toFixed(2),
          commission.winningAmount.toFixed(2),
          commission.commissionRate,
          commission.commissionAmount.toFixed(2),
          commission.status
        ].join(','));
      });

      const csvData = csvRows.join('\n');

      socket.emit('agent:exportData', {
        csvData: csvData,
        filename: `agent_${agentId}_${new Date().toISOString().split('T')[0]}.csv`,
        totalRecords: commissions.length
      });
    } catch (error) {
      console.error('Export error:', error);
      socket.emit('agent:error', 'Failed to export data');
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

      if (amount > agent.totalEarnings) {
        socket.emit('agent:error', 'Insufficient earnings');
        return;
      }

      // Create withdrawal transaction
      const transaction = new this.models.AgentTransaction({
        agentId: agent._id,
        type: 'WITHDRAWAL',
        amount: -amount,
        description: `Agent withdrawal request - ${phoneNumber}`,
        status: 'pending'
      });

      await transaction.save();

      // Update agent earnings (subtract pending withdrawal)
      agent.totalEarnings -= amount;
      await agent.save();

      socket.emit('agent:withdrawRequested', {
        message: 'Withdrawal request submitted',
        transactionId: transaction._id,
        amount: amount,
        status: 'pending'
      });

      // Notify admin agents
      this.broadcastToAdmins('agent:newWithdrawalRequest', {
        agentId: agent._id,
        agentName: agent.name,
        amount: amount,
        phoneNumber: phoneNumber,
        transactionId: transaction._id,
        timestamp: new Date()
      });

      console.log(`💰 Agent withdrawal requested: ${agent.name} - ${amount} ETB to ${phoneNumber}`);
    } catch (error) {
      console.error('Withdraw request error:', error);
      socket.emit('agent:error', 'Failed to process withdrawal request');
    }
  }

  // Super Admin: Approve agent withdrawal
  async handleApproveAgentWithdrawal(socket, transactionId) {
    try {
      if (!socket.agentData?.isSuperAdmin) {
        socket.emit('agent:error', 'Unauthorized');
        return;
      }

      const transaction = await this.models.AgentTransaction.findById(transactionId);
      if (!transaction) {
        socket.emit('agent:error', 'Transaction not found');
        return;
      }

      if (transaction.type !== 'WITHDRAWAL' || transaction.status !== 'pending') {
        socket.emit('agent:error', 'Invalid withdrawal transaction');
        return;
      }

      transaction.status = 'completed';
      await transaction.save();

      // Notify agent
      const agentSocket = this.agentSockets.get(transaction.agentId.toString());
      if (agentSocket) {
        agentSocket.emit('agent:withdrawalApproved', {
          transactionId: transaction._id,
          amount: -transaction.amount,
          timestamp: new Date()
        });
      }

      socket.emit('agent:withdrawalApprovedAdmin', {
        message: 'Withdrawal approved successfully',
        transactionId: transaction._id,
        agentId: transaction.agentId
      });

      console.log(`✅ Agent withdrawal approved: ${transaction.agentId} - ${-transaction.amount} ETB`);
    } catch (error) {
      console.error('Approve withdrawal error:', error);
      socket.emit('agent:error', 'Failed to approve withdrawal');
    }
  }

  // Super Admin: Reject agent withdrawal
  async handleRejectAgentWithdrawal(socket, transactionId) {
    try {
      if (!socket.agentData?.isSuperAdmin) {
        socket.emit('agent:error', 'Unauthorized');
        return;
      }

      const transaction = await this.models.AgentTransaction.findById(transactionId);
      if (!transaction) {
        socket.emit('agent:error', 'Transaction not found');
        return;
      }

      if (transaction.type !== 'WITHDRAWAL' || transaction.status !== 'pending') {
        socket.emit('agent:error', 'Invalid withdrawal transaction');
        return;
      }

      // Return amount to agent
      const agent = await this.models.Agent.findById(transaction.agentId);
      if (agent) {
        agent.totalEarnings += (-transaction.amount);
        await agent.save();
      }

      transaction.status = 'failed';
      transaction.description = `Withdrawal rejected by admin - ${transaction.description}`;
      await transaction.save();

      // Notify agent
      const agentSocket = this.agentSockets.get(transaction.agentId.toString());
      if (agentSocket) {
        agentSocket.emit('agent:withdrawalRejected', {
          transactionId: transaction._id,
          amount: -transaction.amount,
          timestamp: new Date()
        });
      }

      socket.emit('agent:withdrawalRejectedAdmin', {
        message: 'Withdrawal rejected',
        transactionId: transaction._id,
        agentId: transaction.agentId
      });

      console.log(`❌ Agent withdrawal rejected: ${transaction.agentId} - ${-transaction.amount} ETB`);
    } catch (error) {
      console.error('Reject withdrawal error:', error);
      socket.emit('agent:error', 'Failed to reject withdrawal');
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

      socket.emit('agent:withdrawalHistory', withdrawals);
    } catch (error) {
      console.error('Get withdrawal history error:', error);
      socket.emit('agent:error', 'Failed to get withdrawal history');
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

      return {
        totalAgents,
        activeAgents,
        totalCommissions: totalCommissions[0]?.total || 0,
        todayCommissions: todayCommissions[0]?.total || 0,
        pendingWithdrawals: pendingWithdrawals[0]?.total || 0
      };
    } catch (error) {
      console.error('Get agent statistics error:', error);
      return null;
    }
  }

  // Get all pending agent withdrawals (for admin)
  async handleGetPendingWithdrawals(socket) {
    try {
      if (!socket.agentData?.isSuperAdmin) {
        socket.emit('agent:error', 'Unauthorized');
        return;
      }

      const withdrawals = await this.models.AgentTransaction.find({
        type: 'WITHDRAWAL',
        status: 'pending'
      })
      .populate('agentId', 'name username')
      .sort({ createdAt: -1 });

      socket.emit('agent:pendingWithdrawals', withdrawals);
    } catch (error) {
      console.error('Get pending withdrawals error:', error);
      socket.emit('agent:error', 'Failed to get pending withdrawals');
    }
  }

  // Process Bingo win for agent commission
  async processBingoWin(userId, room, winningAmount) {
    try {
      const user = await this.models.User.findOne({ userId });
      if (!user || !user.agentId) {
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

      return commissionAmount;
    } catch (error) {
      console.error('Process Keno win error:', error);
      return 0;
    }
  }

  // Get processing claims (for debugging)
  getProcessingClaims() {
    return this.processingClaims;
  }

  // Get room winners (for debugging)
  getRoomWinners() {
    return this.roomWinners;
  }

  // Update user agent assignment (for manual admin updates)
  async updateUserAgent(userId, agentId) {
    try {
      const user = await this.models.User.findOne({ userId });
      if (!user) {
        return { success: false, message: 'User not found' };
      }

      const oldAgentId = user.agentId;
      user.agentId = agentId;
      await user.save();

      // Update agent referral counts
      if (oldAgentId) {
        await this.models.Agent.findByIdAndUpdate(oldAgentId, {
          $inc: { totalReferrals: -1, activeReferrals: -1 }
        });
      }

      if (agentId) {
        await this.models.Agent.findByIdAndUpdate(agentId, {
          $inc: { totalReferrals: 1 }
        });

        // Update active referrals count if user is online
        if (user.isOnline) {
          await this.models.Agent.findByIdAndUpdate(agentId, {
            $inc: { activeReferrals: 1 }
          });
        }
      }

      return { 
        success: true, 
        message: 'User agent updated successfully',
        userId,
        oldAgentId,
        newAgentId: agentId
      };
    } catch (error) {
      console.error('Update user agent error:', error);
      return { success: false, message: error.message };
    }
  }

  // Bulk assign users to agent by referral code pattern
  async bulkAssignUsersByPattern(agentId, pattern) {
    try {
      const agent = await this.models.Agent.findById(agentId);
      if (!agent) {
        return { success: false, message: 'Agent not found' };
      }

      let query = {};
      if (pattern === 'telegram') {
        query = { userId: /^tg_/ }; // Users with Telegram IDs
      } else if (pattern === 'all') {
        query = { agentId: { $exists: false } }; // Users without agent
      }

      const users = await this.models.User.find(query);
      let assignedCount = 0;

      for (const user of users) {
        if (!user.agentId) {
          user.agentId = agentId;
          await user.save();
          assignedCount++;
        }
      }

      // Update agent referral count
      await this.models.Agent.findByIdAndUpdate(agentId, {
        $inc: { totalReferrals: assignedCount }
      });

      return { 
        success: true, 
        message: `Assigned ${assignedCount} users to agent ${agent.username}`,
        agent: agent.username,
        assignedCount
      };
    } catch (error) {
      console.error('Bulk assign users error:', error);
      return { success: false, message: error.message };
    }
  }

  // Generate agent referral report
  async generateAgentReport(agentId, period = 'month') {
    try {
      const agent = await this.models.Agent.findById(agentId);
      if (!agent) {
        return null;
      }

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
        case 'year':
          startDate = new Date(now.setFullYear(now.getFullYear() - 1));
          break;
        default:
          startDate = new Date(now.setMonth(now.getMonth() - 1));
      }

      // Get commissions
      const commissions = await this.models.AgentCommission.aggregate([
        {
          $match: {
            agentId: agent._id,
            createdAt: { $gte: startDate },
            status: 'completed'
          }
        },
        {
          $group: {
            _id: {
              gameType: "$gameType"
            },
            totalCommission: { $sum: "$commissionAmount" },
            count: { $sum: 1 },
            totalWinnings: { $sum: "$winningAmount" }
          }
        }
      ]);

      // Get referral stats
      const referralStats = await this.models.User.aggregate([
        {
          $match: {
            agentId: agent._id,
            joinedAt: { $gte: startDate }
          }
        },
        {
          $group: {
            _id: null,
            totalReferrals: { $sum: 1 },
            activeReferrals: {
              $sum: {
                $cond: [{ $eq: ["$isOnline", true] }, 1, 0]
              }
            },
            totalWagered: { $sum: "$totalWagered" },
            totalWins: { $sum: "$totalWins" }
          }
        }
      ]);

      return {
        agent: {
          id: agent._id,
          name: agent.name,
          username: agent.username
        },
        period: {
          startDate,
          endDate: new Date(),
          type: period
        },
        commissions: commissions.reduce((acc, curr) => {
          acc[curr._id.gameType] = {
            totalCommission: curr.totalCommission,
            count: curr.count,
            totalWinnings: curr.totalWinnings
          };
          return acc;
        }, {}),
        referrals: referralStats[0] || {
          totalReferrals: 0,
          activeReferrals: 0,
          totalWagered: 0,
          totalWins: 0
        },
        summary: {
          totalCommission: commissions.reduce((sum, curr) => sum + curr.totalCommission, 0),
          totalReferrals: referralStats[0]?.totalReferrals || 0,
          activeReferrals: referralStats[0]?.activeReferrals || 0
        }
      };
    } catch (error) {
      console.error('Generate agent report error:', error);
      return null;
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
            referralCode: "$agent.referralCode"
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

      // Get direct referrals
      const directReferrals = await this.models.User.find({ agentId: agent._id })
        .select('userId userName balance totalWagered totalWins isOnline joinedAt')
        .sort({ joinedAt: -1 })
        .limit(100);

      // For each direct referral, get their sub-referrals (if any)
      // This is a simplified version - in a real system, you might have multi-level referrals
      
      return {
        agent: {
          id: agent._id,
          name: agent.name,
          username: agent.username,
          referralCode: agent.referralCode
        },
        directReferrals: directReferrals,
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

  // Reset agent statistics (for testing/admin)
  async resetAgentStatistics(agentId) {
    try {
      const agent = await this.models.Agent.findById(agentId);
      if (!agent) {
        return { success: false, message: 'Agent not found' };
      }

      // Reset agent stats
      agent.totalEarnings = 0;
      agent.totalReferrals = 0;
      agent.activeReferrals = 0;
      agent.lastCommissionDate = null;
      await agent.save();

      // Delete all commissions and transactions
      await this.models.AgentCommission.deleteMany({ agentId: agent._id });
      await this.models.AgentTransaction.deleteMany({ agentId: agent._id });

      // Remove agent from user records
      await this.models.User.updateMany(
        { agentId: agent._id },
        { $unset: { agentId: "" } }
      );

      return { 
        success: true, 
        message: `Agent ${agent.username} statistics reset successfully`,
        agentId: agent._id,
        username: agent.username
      };
    } catch (error) {
      console.error('Reset agent statistics error:', error);
      return { success: false, message: error.message };
    }
  }
}

module.exports = AgentSystem;
