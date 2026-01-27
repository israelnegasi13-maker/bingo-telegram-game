// server.js - BINGO ELITE + KENO ULTRA - TELEGRAM MINI APP - MAIN SERVER FILE
require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const mongoose = require('mongoose');
const fetch = require('node-fetch');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

// Import game logic modules
const gameLogic = require('./game-logic');
const kenoLogic = require('./keno-logic');

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/bingo', {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(async () => {
  console.log('✅ MongoDB Connected');
  await initializeTelebirrNumber(); // Initialize default Telebirr number
  await ensureAdminAgent(); // Initialize admin agent
})
.catch(err => {
  console.error('❌ MongoDB Connection Error:', err);
  process.exit(1);
});

// MongoDB Models
const userSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true },
  userName: { type: String, required: true },
  balance: { type: Number, default: 0.00 },
  referralCode: { type: String, unique: true },
  agentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Agent' }, // Added for agent system
  currentRoom: { type: Number, default: null },
  box: { type: Number, default: null },
  totalWagered: { type: Number, default: 0 },
  totalWins: { type: Number, default: 0 },
  totalBingos: { type: Number, default: 0 },
  joinedAt: { type: Date, default: Date.now },
  lastSeen: { type: Date, default: Date.now },
  isOnline: { type: Boolean, default: false },
  sessionCount: { type: Number, default: 0 },
  telegramId: { type: String, unique: true, sparse: true },
  telegramUsername: { type: String },
  languageCode: { type: String, default: 'en' },
  phoneNumber: { type: String }
});

const roomSchema = new mongoose.Schema({
  stake: { type: Number, required: true },
  players: [String],
  takenBoxes: [Number],
  status: { type: String, default: 'waiting' },
  calledNumbers: [Number],
  currentBall: { type: Number, default: null },
  ballsDrawn: { type: Number, default: 0 },
  startTime: { type: Date, default: null },
  endTime: { type: Date, default: null },
  gameHistory: [{
    timestamp: Date,
    winner: String,
    winnerName: String,
    prize: Number,
    bonus: Number,
    players: Number,
    ballsDrawn: Number,
    isFourCorners: Boolean,
    commissionCollected: Number,
    basePrize: Number
  }],
  lastBoxUpdate: { type: Date, default: Date.now },
  countdownStartTime: { type: Date, default: null },
  countdownStartedWith: { type: Number, default: 0 }
});

const transactionSchema = new mongoose.Schema({
  type: { type: String, required: true },
  userId: { type: String, required: true },
  userName: { type: String, required: true },
  amount: { type: Number, required: true },
  room: { type: Number, default: null },
  admin: { type: Boolean, default: false },
  description: { type: String, required: true },
  receiptNumber: { type: String },
  phoneNumber: { type: String },
  status: { type: String, default: 'pending' },
  approvedBy: { type: String },
  approvedAt: { type: Date },
  createdAt: { type: Date, default: Date.now }
});

const statsSchema = new mongoose.Schema({
  date: { type: String, required: true, unique: true },
  totalWagered: { type: Number, default: 0 },
  totalEarnings: { type: Number, default: 0 },
  totalGames: { type: Number, default: 0 },
  totalUsers: { type: Number, default: 0 },
  newUsers: { type: Number, default: 0 },
  totalBingos: { type: Number, default: 0 },
  totalFourCorners: { type: Number, default: 0 },
  totalKenoWagered: { type: Number, default: 0 },
  totalKenoEarnings: { type: Number, default: 0 },
  totalKenoGames: { type: Number, default: 0 },
  totalKenoWins: { type: Number, default: 0 }
});

const settingSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  value: { type: mongoose.Schema.Types.Mixed, required: true },
  updatedAt: { type: Date, default: Date.now }
});

// Agent System Models
const agentSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  name: { type: String, required: true },
  commissionRateBingo: { type: Number, default: 40 },
  commissionRateKeno: { type: Number, default: 10 },
  totalEarnings: { type: Number, default: 0 },
  totalReferrals: { type: Number, default: 0 },
  activeReferrals: { type: Number, default: 0 },
  referralCode: { type: String, unique: true },
  phoneNumber: String,
  isActive: { type: Boolean, default: true },
  isSuperAdmin: { type: Boolean, default: false },
  lastLogin: Date,
  lastCommissionDate: Date,
  createdAt: { type: Date, default: Date.now }
});

const agentCommissionSchema = new mongoose.Schema({
  agentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Agent', required: true },
  userId: { type: String, required: true },
  gameType: { type: String, required: true, enum: ['BINGO', 'KENO'] },
  stake: { type: Number, required: true },
  winningAmount: { type: Number, required: true },
  commissionRate: { type: Number, required: true },
  commissionAmount: { type: Number, required: true },
  status: { type: String, default: 'pending', enum: ['pending', 'completed', 'cancelled'] },
  createdAt: { type: Date, default: Date.now }
});

const agentTransactionSchema = new mongoose.Schema({
  agentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Agent', required: true },
  type: { type: String, required: true, enum: ['COMMISSION', 'WITHDRAWAL', 'ADJUSTMENT'] },
  amount: { type: Number, required: true },
  description: String,
  status: { type: String, default: 'completed', enum: ['pending', 'completed', 'failed'] },
  createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);
const Room = mongoose.model('Room', roomSchema);
const Transaction = mongoose.model('Transaction', transactionSchema);
const Stats = mongoose.model('Stats', statsSchema);
const Setting = mongoose.model('Setting', settingSchema);
const Agent = mongoose.model('Agent', agentSchema);
const AgentCommission = mongoose.model('AgentCommission', agentCommissionSchema);
const AgentTransaction = mongoose.model('AgentTransaction', agentTransactionSchema);

// ========== TELEBIRR NUMBER DATABASE FUNCTIONS ==========
async function getTelebirrNumber() {
  try {
    const setting = await Setting.findOne({ key: 'telebirrNumber' });
    if (!setting) {
      await initializeTelebirrNumber();
      const newSetting = await Setting.findOne({ key: 'telebirrNumber' });
      return newSetting ? newSetting.value : '0962577855';
    }
    return setting.value;
  } catch (err) {
    console.error('❌ Error getting Telebirr number:', err);
    return '0962577855';
  }
}

async function updateTelebirrNumber(newNumber) {
  try {
    if (!/^09[0-9]{8}$/.test(newNumber)) {
      throw new Error('Invalid phone number format. Must be 09xxxxxxxx (10 digits)');
    }
    
    const result = await Setting.findOneAndUpdate(
      { key: 'telebirrNumber' },
      { 
        value: newNumber, 
        updatedAt: new Date() 
      },
      { 
        upsert: true, 
        new: true,
        setDefaultsOnInsert: true 
      }
    );
    
    console.log(`✅ Telebirr number updated to: ${newNumber}`);
    
    if (gameLogic && gameLogic.setTelebirrNumber) {
      gameLogic.setTelebirrNumber(newNumber);
    }
    
    return result;
  } catch (err) {
    console.error('❌ Error updating Telebirr number:', err);
    throw err;
  }
}

async function initializeTelebirrNumber() {
  try {
    const exists = await Setting.findOne({ key: 'telebirrNumber' });
    if (!exists) {
      await Setting.create({
        key: 'telebirrNumber',
        value: '0962577855',
        updatedAt: new Date()
      });
      console.log('✅ Default Telebirr number initialized: 0962577855');
      
      if (gameLogic && gameLogic.setTelebirrNumber) {
        gameLogic.setTelebirrNumber('0962577855');
      }
    } else {
      console.log(`✅ Telebirr number loaded from DB: ${exists.value}`);
      
      if (gameLogic && gameLogic.setTelebirrNumber) {
        gameLogic.setTelebirrNumber(exists.value);
      }
    }
  } catch (err) {
    console.error('❌ Error initializing Telebirr number:', err);
  }
}

// ========== AGENT SYSTEM FUNCTIONS ==========
async function ensureAdminAgent() {
  try {
    const adminExists = await Agent.findOne({ username: 'admin' });
    if (!adminExists) {
      const hashedPassword = await bcrypt.hash('admin123', 10);
      const adminAgent = await Agent.create({
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
    }
  } catch (error) {
    console.error('Error creating admin agent:', error);
  }
}

// Record commission for agent
async function recordCommission(agentId, userId, gameType, stake, winningAmount) {
  try {
    const agent = await Agent.findById(agentId);
    if (!agent || !agent.isActive) return 0;

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

    if (commissionAmount < 0.01) {
      commissionAmount = 0.01;
    }

    // Create commission record
    const commission = new AgentCommission({
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
    const agentTransaction = new AgentTransaction({
      agentId: agent._id,
      type: 'COMMISSION',
      amount: commissionAmount,
      description: `${gameType} commission from referral ${userId.substring(0, 8)}...`,
      status: 'completed'
    });
    await agentTransaction.save();

    console.log(`💰 Agent commission: ${agent.username} earned ${commissionAmount.toFixed(2)} ETB from ${gameType}`);
    return commissionAmount;
  } catch (error) {
    console.error('Record commission error:', error);
    return 0;
  }
}

// Process referral when user joins via referral link
async function processReferral(userId, referralCode) {
  try {
    if (!referralCode) return null;

    const agent = await Agent.findOne({ referralCode });
    if (!agent || !agent.isActive) return null;

    // Assign agent to user
    const user = await User.findOne({ userId });
    if (user) {
      user.agentId = agent._id;
      await user.save();

      // Update agent's referral count
      await Agent.findByIdAndUpdate(agent._id, {
        $inc: { totalReferrals: 1 }
      });

      console.log(`✅ Referral processed: ${userId} -> Agent ${agent.username} (${referralCode})`);
      return agent._id;
    }

    return null;
  } catch (error) {
    console.error('Process referral error:', error);
    return null;
  }
}

// Socket.io connection handling for agent events
function setupAgentSocketHandlers(io, socket) {
  const agentSockets = new Map();
  const referralCache = new Map();

  // Agent login
  socket.on('agent:login', async (data) => {
    try {
      const { username, password } = data;
      
      const agent = await Agent.findOne({ username });
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

      agentSockets.set(agent._id.toString(), socket);

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
  });

  // Get agent dashboard data
  socket.on('agent:getDashboard', async () => {
    try {
      if (!socket.agentId) {
        socket.emit('agent:error', 'Not authenticated');
        return;
      }

      const agent = await Agent.findById(socket.agentId);
      if (!agent) {
        socket.emit('agent:error', 'Agent not found');
        return;
      }

      // Get recent referrals (last 50)
      const referrals = await User.find({ agentId: agent._id })
        .sort({ joinedAt: -1 })
        .limit(50)
        .select('userId userName balance totalWagered totalWins totalBingos joinedAt lastSeen isOnline');

      // Get recent commissions (last 50)
      const commissions = await AgentCommission.find({ agentId: agent._id })
        .sort({ createdAt: -1 })
        .limit(50);

      // Get today's earnings
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      const todaysEarnings = await AgentCommission.aggregate([
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

      // Get yesterday's earnings
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayEarnings = await AgentCommission.aggregate([
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
      const monthlyEarnings = await AgentCommission.aggregate([
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
      const activeReferrals = await User.countDocuments({
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
          pendingCommissions: await AgentCommission.countDocuments({
            agentId: agent._id,
            status: 'pending'
          })
        },
        referrals: referrals,
        commissions: commissions.map(comm => ({
          id: comm._id,
          userId: comm.userId,
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
  });

  // Generate referral link
  socket.on('agent:generateReferralLink', async () => {
    try {
      if (!socket.agentId) {
        socket.emit('agent:error', 'Not authenticated');
        return;
      }

      const agent = await Agent.findById(socket.agentId);
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
          const existing = await Agent.findOne({ referralCode: newCode });
          if (!existing) {
            isUnique = true;
          }
        }
        
        agent.referralCode = newCode;
        await agent.save();
        
        // Update cache
        referralCache.set(newCode, agent._id.toString());
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
  });

  // Super Admin: Get all agents
  socket.on('agent:getAllAgents', async () => {
    try {
      if (!socket.agentData?.isSuperAdmin) {
        socket.emit('agent:error', 'Unauthorized');
        return;
      }

      const agents = await Agent.find()
        .sort({ createdAt: -1 })
        .select('-password');

      const agentsWithStats = await Promise.all(
        agents.map(async (agent) => {
          // Get total commissions
          const totalCommissions = await AgentCommission.aggregate([
            { $match: { agentId: agent._id, status: 'completed' } },
            { $group: { _id: null, total: { $sum: '$commissionAmount' } } }
          ]);

          // Get total referrals
          const totalReferrals = await User.countDocuments({ agentId: agent._id });

          // Get active referrals
          const activeReferrals = await User.countDocuments({ 
            agentId: agent._id,
            isOnline: true 
          });

          // Get today's earnings
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          const todaysEarnings = await AgentCommission.aggregate([
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
  });

  // Super Admin: Create new agent
  socket.on('agent:createAgent', async (data) => {
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
      const existingAgent = await Agent.findOne({ username });
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
        const existing = await Agent.findOne({ referralCode });
        if (!existing) {
          isUnique = true;
        }
      }

      // Create agent
      const agent = new Agent({
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
      referralCache.set(referralCode, agent._id.toString());

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

      console.log(`👤 New agent created: ${agent.username} by ${socket.agentData.username}`);
    } catch (error) {
      console.error('Create agent error:', error);
      socket.emit('agent:error', 'Failed to create agent');
    }
  });

  // Super Admin: Update agent
  socket.on('agent:updateAgent', async (data) => {
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
      const agent = await Agent.findById(agentId);
      if (!agent) {
        socket.emit('agent:error', 'Agent not found');
        return;
      }

      // If updating username, check if it's available
      if (updates.username && updates.username !== agent.username) {
        const existing = await Agent.findOne({ username: updates.username });
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
        const existing = await Agent.findOne({ referralCode: updates.referralCode });
        if (existing) {
          socket.emit('agent:error', 'Referral code already in use');
          return;
        }
        
        // Update cache
        referralCache.delete(agent.referralCode);
        referralCache.set(updates.referralCode, agentId.toString());
      }

      const updatedAgent = await Agent.findByIdAndUpdate(
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

      console.log(`👤 Agent updated: ${updatedAgent.username} by ${socket.agentData.username}`);
    } catch (error) {
      console.error('Update agent error:', error);
      socket.emit('agent:error', 'Failed to update agent');
    }
  });

  // Super Admin: Delete agent
  socket.on('agent:deleteAgent', async (agentId) => {
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

      const agent = await Agent.findById(agentId);
      if (!agent) {
        socket.emit('agent:error', 'Agent not found');
        return;
      }

      // Check if agent has active referrals
      const activeReferrals = await User.countDocuments({
        agentId: agentId,
        isOnline: true
      });

      if (activeReferrals > 0) {
        socket.emit('agent:error', `Cannot delete agent with ${activeReferrals} active referrals. Deactivate instead.`);
        return;
      }

      // Remove from cache
      if (agent.referralCode) {
        referralCache.delete(agent.referralCode);
      }

      // Mark agent as inactive instead of deleting (soft delete)
      agent.isActive = false;
      await agent.save();

      // Remove agent from online sockets
      agentSockets.delete(agentId.toString());

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
  });

  // Handle agent disconnect
  socket.on('disconnect', () => {
    if (socket.agentId) {
      agentSockets.delete(socket.agentId);
      console.log(`👤 Agent disconnected: ${socket.agentData?.username}`);
    }
  });
}

const app = express();
const server = http.createServer(app);

// ========== SOCKET.IO CONFIGURATION ==========
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    credentials: true
  },
  transports: ['websocket', 'polling'],
  allowEIO3: true,
  pingTimeout: 60000,
  pingInterval: 25000,
  cookie: false,
  maxHttpBufferSize: 1e8
});

// ========== MIDDLEWARE ==========
app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  credentials: true
}));

app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Custom headers for WebSocket and Telegram
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', '*');
  res.header('Access-Control-Allow-Methods', '*');
  res.header('Content-Security-Policy', "frame-ancestors 'self' https://*.telegram.org https://web.telegram.org");
  res.header('X-Frame-Options', 'ALLOW-FROM https://*.telegram.org');
  next();
});

// ========== INITIALIZE GAME LOGIC ==========
// Pass database models and Telebirr number functions to game logic
gameLogic.initialize(io, { 
  User, 
  Room, 
  Transaction, 
  Stats,
  Setting,
  getTelebirrNumber,
  updateTelebirrNumber,
  processReferral, // Add referral processing function
  recordCommission // Add commission recording function
});

// Initialize Keno logic
kenoLogic.initialize(io, {
  User,
  Transaction,
  Stats
});

// Load initial Telebirr number into game logic
(async () => {
  const telebirrNumber = await getTelebirrNumber();
  console.log(`📱 Initial Telebirr number loaded: ${telebirrNumber}`);
})();

// ========== SOCKET.IO EVENT HANDLERS ==========
io.on('connection', (socket) => {
  console.log(`🔌 New connection: ${socket.id}`);
  
  // Setup agent socket handlers
  setupAgentSocketHandlers(io, socket);
  
  // Admin authentication
  socket.on('admin:auth', async (password) => {
    if (password === gameLogic.CONFIG.ADMIN_PASSWORD) {
      socket.admin = true;
      socket.emit('admin:authSuccess');
      
      const telebirrNumber = await getTelebirrNumber();
      socket.emit('admin:telebirrNumber', telebirrNumber);
      
      const kenoStats = kenoLogic.getKenoGameStats ? kenoLogic.getKenoGameStats() : null;
      if (kenoStats) {
        socket.emit('admin:kenoStats', kenoStats);
      }
      
      console.log(`🔑 Admin authenticated: ${socket.id}`);
    } else {
      socket.emit('admin:authError', 'Invalid password');
    }
  });
  
  // Get Telebirr number (admin only)
  socket.on('admin:getTelebirrNumber', async () => {
    if (socket.admin) {
      const number = await getTelebirrNumber();
      socket.emit('admin:telebirrNumber', number);
    }
  });
  
  // Update Telebirr number (admin only)
  socket.on('admin:updateTelebirrNumber', async (newNumber) => {
    if (socket.admin) {
      try {
        const result = await updateTelebirrNumber(newNumber);
        const updatedNumber = result.value;
        
        io.emit('admin:telebirrNumberUpdated', { 
          telebirrNumber: updatedNumber,
          updatedAt: result.updatedAt
        });
        
        io.emit('telebirrNumberUpdate', {
          telebirrNumber: updatedNumber,
          timestamp: new Date().toISOString()
        });
        
        socket.emit('admin:success', `Telebirr number updated to ${updatedNumber}`);
        console.log(`📱 Telebirr number updated by admin to: ${updatedNumber}`);
        
        const adminTransaction = new Transaction({
          type: 'TELEBIRR_UPDATE',
          userId: 'admin',
          userName: 'Admin',
          amount: 0,
          admin: true,
          description: `Telebirr number updated to ${updatedNumber}`
        });
        await adminTransaction.save();
        
      } catch (error) {
        console.error('❌ Error updating Telebirr number:', error);
        socket.emit('admin:error', error.message || 'Failed to update Telebirr number');
      }
    }
  });
  
  // Admin: Get Keno stats
  socket.on('admin:getKenoStats', () => {
    if (socket.admin && kenoLogic.getKenoGameStats) {
      const stats = kenoLogic.getKenoGameStats();
      socket.emit('admin:kenoStats', stats);
    }
  });
  
  // Admin: Get detailed Keno stats
  socket.on('admin:getKenoDetailedStats', () => {
    if (socket.admin && kenoLogic.getKenoDetailedStats) {
      const stats = kenoLogic.getKenoDetailedStats();
      socket.emit('admin:kenoDetailedStats', stats);
    }
  });
  
  // Admin: Get Keno player list
  socket.on('admin:getKenoPlayers', () => {
    if (socket.admin && kenoLogic.getKenoPlayerList) {
      const players = kenoLogic.getKenoPlayerList();
      socket.emit('admin:kenoPlayers', players);
    }
  });
  
  // Admin: Reset Keno earnings
  socket.on('admin:resetKenoEarnings', async () => {
    if (socket.admin && kenoLogic.resetKenoEarnings) {
      try {
        const result = await kenoLogic.resetKenoEarnings();
        socket.emit('admin:kenoEarningsReset', result);
      } catch (error) {
        socket.emit('admin:error', error.message || 'Failed to reset Keno earnings');
      }
    }
  });
  
  // Admin: Force start Keno round
  socket.on('admin:forceStartKenoRound', () => {
    if (socket.admin && kenoLogic.forceStartKenoRound) {
      const success = kenoLogic.forceStartKenoRound();
      socket.emit('admin:kenoRoundForced', { success });
    }
  });
  
  // Reset house earnings (admin only)
  socket.on('admin:resetHouseEarnings', async () => {
    if (socket.admin) {
      try {
        const houseEarningsTransactions = await Transaction.find({ 
          type: 'HOUSE_EARNINGS' 
        });
        const previousAmount = houseEarningsTransactions.reduce((sum, t) => sum + t.amount, 0);
        
        const resetTransaction = new Transaction({
          type: 'HOUSE_EARNINGS_RESET',
          userId: 'system',
          userName: 'System',
          amount: -previousAmount,
          admin: true,
          description: `House earnings reset from ${previousAmount.toFixed(2)} to 0 ETB`
        });
        await resetTransaction.save();
        
        socket.emit('admin:houseEarningsReset', { 
          previousAmount,
          resetAmount: 0,
          message: `House earnings reset from ${previousAmount.toFixed(2)} to 0 ETB`
        });
        
        console.log(`🔄 House earnings reset from ${previousAmount.toFixed(2)} to 0 ETB`);
      } catch (error) {
        console.error('Error resetting house earnings:', error);
        socket.emit('admin:houseEarningsResetError', error.message);
      }
    }
  });
  
  // Existing admin events (delegated to gameLogic)
  socket.on('admin:getData', () => {
    if (socket.admin && gameLogic.handleAdminGetData) {
      gameLogic.handleAdminGetData(socket);
    }
  });
  
  socket.on('admin:addFunds', (data) => {
    if (socket.admin && gameLogic.handleAdminAddFunds) {
      gameLogic.handleAdminAddFunds(socket, data);
    }
  });
  
  socket.on('admin:banPlayer', (userId) => {
    if (socket.admin && gameLogic.handleAdminBanPlayer) {
      gameLogic.handleAdminBanPlayer(socket, userId);
    }
  });
  
  socket.on('admin:kickPlayer', (userId) => {
    if (socket.admin && gameLogic.handleAdminKickPlayer) {
      gameLogic.handleAdminKickPlayer(socket, userId);
    }
  });
  
  socket.on('admin:disconnectUser', (userId) => {
    if (socket.admin && gameLogic.handleAdminDisconnectUser) {
      gameLogic.handleAdminDisconnectUser(socket, userId);
    }
  });
  
  socket.on('admin:forceStartGame', (stake) => {
    if (socket.admin && gameLogic.handleAdminForceStartGame) {
      gameLogic.handleAdminForceStartGame(socket, stake);
    }
  });
  
  socket.on('admin:forceDraw', (stake) => {
    if (socket.admin && gameLogic.handleAdminForceDraw) {
      gameLogic.handleAdminForceDraw(socket, stake);
    }
  });
  
  socket.on('admin:forceEndGame', (stake) => {
    if (socket.admin && gameLogic.handleAdminForceEndGame) {
      gameLogic.handleAdminForceEndGame(socket, stake);
    }
  });
  
  socket.on('admin:getPendingTransactions', async () => {
    if (socket.admin && gameLogic.handleAdminGetPendingTransactions) {
      await gameLogic.handleAdminGetPendingTransactions(socket);
    }
  });
  
  socket.on('admin:approveDeposit', (transactionId) => {
    if (socket.admin && gameLogic.handleAdminApproveDeposit) {
      gameLogic.handleAdminApproveDeposit(socket, transactionId);
    }
  });
  
  socket.on('admin:approveWithdrawal', (transactionId) => {
    if (socket.admin && gameLogic.handleAdminApproveWithdrawal) {
      gameLogic.handleAdminApproveWithdrawal(socket, transactionId);
    }
  });
  
  socket.on('admin:rejectTransaction', (transactionId) => {
    if (socket.admin && gameLogic.handleAdminRejectTransaction) {
      gameLogic.handleAdminRejectTransaction(socket, transactionId);
    }
  });
  
  // ========== KENO GAME SOCKET EVENTS ==========
  kenoLogic.handleKenoConnection(socket);
  
  // Disconnect handler
  socket.on('disconnect', () => {
    console.log(`🔌 Disconnected: ${socket.id}`);
    if (socket.admin) {
      console.log(`🔑 Admin disconnected: ${socket.id}`);
    }
    
    if (gameLogic.handleDisconnect) {
      gameLogic.handleDisconnect(socket);
    }
    
    if (kenoLogic.handleKenoDisconnect) {
      kenoLogic.handleKenoDisconnect(socket);
    }
  });
  
  // Forward game events to game logic
  socket.on('join', (data) => {
    if (gameLogic.handleJoin) {
      gameLogic.handleJoin(socket, data);
    }
  });
  
  socket.on('selectBox', (data) => {
    if (gameLogic.handleSelectBox) {
      gameLogic.handleSelectBox(socket, data);
    }
  });
  
  socket.on('claimBingo', (data) => {
    if (gameLogic.handleClaimBingo) {
      gameLogic.handleClaimBingo(socket, data);
    }
  });
  
  socket.on('markNumber', (data) => {
    if (gameLogic.handleMarkNumber) {
      gameLogic.handleMarkNumber(socket, data);
    }
  });
  
  socket.on('depositRequest', (data) => {
    if (gameLogic.handleDepositRequest) {
      gameLogic.handleDepositRequest(socket, data);
    }
  });
  
  socket.on('withdrawRequest', (data) => {
    if (gameLogic.handleWithdrawRequest) {
      gameLogic.handleWithdrawRequest(socket, data);
    }
  });
  
  socket.on('getUserData', (data) => {
    if (gameLogic.handleGetUserData) {
      gameLogic.handleGetUserData(socket, data);
    }
  });
  
  // Telebirr number request from players
  socket.on('getTelebirrNumber', async (callback) => {
    try {
      const telebirrNumber = await getTelebirrNumber();
      if (callback) {
        callback({ telebirrNumber });
      } else {
        socket.emit('telebirrNumber', telebirrNumber);
      }
    } catch (error) {
      console.error('Error getting Telebirr number for player:', error);
      if (callback) {
        callback({ telebirrNumber: '0962577855' });
      }
    }
  });
});

// ========== EXPRESS ROUTES ==========
app.get('/', async (req, res) => {
  const connectedSockets = gameLogic.getConnectedSockets ? gameLogic.getConnectedSockets().size : 0;
  const socketToUser = gameLogic.getSocketToUser ? gameLogic.getSocketToUser().size : 0;
  const adminSockets = gameLogic.getAdminSockets ? gameLogic.getAdminSockets().size : 0;
  const processingClaims = gameLogic.getProcessingClaims ? gameLogic.getProcessingClaims().size : 0;
  const roomWinners = gameLogic.getRoomWinners ? gameLogic.getRoomWinners().size : 0;
  const kenoPlayers = kenoLogic.getKenoPlayersCount ? kenoLogic.getKenoPlayersCount() : 0;
  const kenoOnline = kenoLogic.getOnlinePlayersCount ? kenoLogic.getOnlinePlayersCount() : 0;
  const telebirrNumber = await getTelebirrNumber();
  
  // Get agent statistics
  let agentStats = { totalAgents: 0, activeAgents: 0 };
  try {
    agentStats.totalAgents = await Agent.countDocuments();
    agentStats.activeAgents = await Agent.countDocuments({ isActive: true });
  } catch (error) {
    console.error('Error getting agent stats:', error);
  }
  
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Bingo Elite + Keno Ultra - Telegram Mini App</title>
      <style>
        body { font-family: Arial, sans-serif; padding: 40px; text-align: center; background: #0f172a; color: #f8fafc; }
        .container { max-width: 800px; margin: 0 auto; }
        .status { padding: 30px; background: #1e293b; border-radius: 20px; margin: 30px auto; border: 1px solid #334155; }
        .stats-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; margin: 30px 0; }
        .stat { background: rgba(255,255,255,0.05); padding: 20px; border-radius: 12px; }
        .stat-value { font-size: 2.5rem; font-weight: 900; margin: 10px 0; }
        .stat-label { font-size: 0.9rem; color: #94a3b8; text-transform: uppercase; letter-spacing: 1px; }
        .btn { display: inline-block; padding: 12px 24px; background: #3b82f6; color: white; text-decoration: none; border-radius: 8px; margin: 10px; font-weight: bold; }
        .btn-admin { background: #ef4444; }
        .btn-admin:hover { background: #dc2626; }
        .btn-game { background: #10b981; }
        .btn-game:hover { background: #059669; }
        .btn-agent { background: #8b5cf6; }
        .btn-agent:hover { background: #7c3aed; }
        .telebirr-info { background: rgba(59, 130, 246, 0.1); padding: 15px; border-radius: 12px; margin: 20px 0; border: 1px solid rgba(59, 130, 246, 0.3); }
        .telebirr-number { font-size: 1.5rem; font-weight: bold; color: #60a5fa; margin: 10px 0; }
        .agent-highlight { background: rgba(139, 92, 246, 0.1); padding: 15px; border-radius: 12px; margin: 20px 0; border: 1px solid rgba(139, 92, 246, 0.3); }
        .game-section { background: rgba(139, 92, 246, 0.1); padding: 15px; border-radius: 12px; margin: 20px 0; border: 1px solid rgba(139, 92, 246, 0.3); }
      </style>
    </head>
    <body>
      <div class="container">
        <h1 style="font-size: 3rem; margin-bottom: 20px;">🎮 Bingo Elite + Keno Ultra</h1>
        <p style="color: #94a3b8; font-size: 1.2rem;">Multi-game Telegram Mini App - Ready for Telegram</p>
        
        <div class="status">
          <h2 style="color: #10b981;">🚀 Server Status: RUNNING</h2>
          <div class="stats-grid">
            <div class="stat">
              <div class="stat-label">Connected Players</div>
              <div class="stat-value" id="playerCount">${connectedSockets}</div>
            </div>
            <div class="stat">
              <div class="stat-label">Active Agents</div>
              <div class="stat-value" style="color: #8b5cf6;">${agentStats.activeAgents}/${agentStats.totalAgents}</div>
            </div>
            <div class="stat">
              <div class="stat-label">Keno Players</div>
              <div class="stat-value" style="color: #8b5cf6;">${kenoOnline}/${kenoPlayers}</div>
            </div>
          </div>
          
          <div class="telebirr-info">
            <div class="stat-label">📱 TELEBIRR PAYMENT NUMBER</div>
            <div class="telebirr-number">${telebirrNumber}</div>
            <p style="color: #94a3b8; font-size: 0.9rem;">Persisted in database - Will survive server restarts</p>
          </div>
          
          <div class="agent-highlight">
            <h3 style="color: #8b5cf6;">👑 AGENT SYSTEM - NOW ACTIVE</h3>
            <p style="color: #94a3b8;">
              <strong>Agent Features:</strong><br>
              1. ✅ Agents earn 40% from Bingo wins<br>
              2. ✅ Agents earn 10% from Keno wins<br>
              3. ✅ Agent dashboard with statistics<br>
              4. ✅ Real-time commission tracking<br>
              5. ✅ Referral links & QR codes<br>
              6. ✅ Super admin panel<br>
              7. ✅ Withdrawal system for agents<br>
              8. ✅ Professional mobile-friendly interface<br>
            </p>
          </div>
          
          <div class="game-section">
            <h3 style="color: #8b5cf6;">🎰 KENO ULTRA - NOW ACTIVE</h3>
            <p style="color: #94a3b8;">
              <strong>New Features:</strong><br>
              1. ✅ Fast-paced number game<br>
              2. ✅ Select 5 numbers from 1-80<br>
              3. ✅ 20 numbers drawn per round<br>
              4. ✅ Bet amounts: 5, 10, 20, 50, 100 ETB only<br>
              5. ✅ 30-second rounds<br>
              6. ✅ Payouts: Match 3-5 numbers<br>
              7. ✅ Real-time multiplayer<br>
              8. ✅ Automatic game rounds<br>
            </p>
          </div>
          
          <p style="margin-top: 20px; color: #f59e0b; font-weight: bold;">🎯 Four Corners Bonus: ${gameLogic.CONFIG ? gameLogic.CONFIG.FOUR_CORNERS_BONUS : 50} ETB!</p>
          <p style="color: #8b5cf6; margin-top: 10px; font-weight: bold;">🎰 Keno Payouts: 3 matches = 1x, 4 matches = 5x, 5 matches = 50x</p>
          <p style="color: #8b5cf6; margin-top: 10px; font-weight: bold;">👑 Agent Commissions: Bingo 40%, Keno 10%</p>
          <p style="color: #64748b; margin-top: 10px;">Server Time: ${new Date().toLocaleString()}</p>
          <p style="color: #10b981;">✅ Telegram Mini App Ready</p>
          <p style="color: #3b82f6; margin-top: 10px;">📦 Real-time Box Tracking: ✅ ACTIVE</p>
          <p style="color: #10b981; margin-top: 10px;">💰 Wallet System: ✅ ACTIVE</p>
          <p style="color: #10b981; margin-top: 10px;">👑 Agent System: ✅ ACTIVE</p>
        </div>
        
        <div style="margin-top: 40px;">
          <h3>Access Points:</h3>
          <div>
            <a href="/admin" class="btn btn-admin" target="_blank">🔒 Admin Panel</a>
            <a href="/agent" class="btn btn-agent" target="_blank">👑 Agent Dashboard</a>
            <a href="/game" class="btn btn-game" target="_blank">🎮 Bingo Game</a>
            <a href="/keno" class="btn" style="background: #8b5cf6;" target="_blank">🎰 Keno Game</a>
          </div>
          <div style="margin-top: 20px;">
            <a href="/health" class="btn" style="background: #64748b;" target="_blank">📊 Health Check</a>
            <a href="/telegram" class="btn" style="background: #8b5cf6;" target="_blank">🤖 Telegram Entry</a>
          </div>
        </div>
        
        <div style="margin-top: 40px; padding: 20px; background: rgba(255,255,255,0.03); border-radius: 12px;">
          <h4>Agent System Information</h4>
          <p style="color: #94a3b8; font-size: 0.9rem;">
            Agent Portal: <strong>/agent</strong><br>
            Super Admin: <strong>admin/admin123</strong><br>
            Agent Commission: <strong>Bingo: 40%, Keno: 10%</strong><br>
            Minimum Commission: <strong>0.01 ETB</strong><br>
            Referral Links: <strong>Telegram deep links with QR codes</strong><br>
            Real-time Updates: <strong>Agent dashboard updates in real-time</strong><br>
            Mobile Optimized: <strong>Responsive design for all devices</strong><br>
            <br>
            <strong>🎯 How Agents Earn:</strong><br>
            1. Share referral link with players<br>
            2. Players join using referral link<br>
            3. When player wins in Bingo: Agent gets 40% of win amount<br>
            4. When player wins in Keno: Agent gets 10% of win amount<br>
            5. Commissions credited instantly<br>
            6. Agents can withdraw earnings<br>
          </p>
        </div>
      </div>
      
      <script src="/socket.io/socket.io.js"></script>
      <script>
        const socket = io();
        socket.on('connect', () => {
          document.getElementById('playerCount').textContent = 'Connected';
        });
      </script>
    </body>
    </html>
  `);
});

// ========== AGENT ROUTES ==========
// Serve Agent Dashboard HTML page
app.get('/agent', (req, res) => {
  res.sendFile(path.join(__dirname, 'agent.html'));
});

// Serve Agent Login HTML page
app.get('/agent/login', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
        <title>Agent Login - Bingo Elite</title>
        <script src="/socket.io/socket.io.js"></script>
        <style>
            * {
                margin: 0;
                padding: 0;
                box-sizing: border-box;
                -webkit-tap-highlight-color: transparent;
            }
            
            body {
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
                color: #fff;
                min-height: 100vh;
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 20px;
            }
            
            .login-container {
                width: 100%;
                max-width: 400px;
            }
            
            .login-card {
                background: rgba(255, 255, 255, 0.08);
                backdrop-filter: blur(10px);
                border: 1px solid rgba(255, 255, 255, 0.1);
                border-radius: 20px;
                padding: 30px;
                box-shadow: 0 20px 40px rgba(0, 0, 0, 0.3);
                animation: slideUp 0.5s ease;
            }
            
            .logo {
                text-align: center;
                margin-bottom: 30px;
            }
            
            .logo h1 {
                font-size: 32px;
                background: linear-gradient(45deg, #4361ee, #7209b7);
                -webkit-background-clip: text;
                -webkit-text-fill-color: transparent;
                margin-bottom: 10px;
            }
            
            .logo p {
                color: #94a3b8;
                font-size: 14px;
            }
            
            .form-group {
                margin-bottom: 20px;
            }
            
            .form-group label {
                display: block;
                margin-bottom: 8px;
                color: #fff;
                font-size: 14px;
                font-weight: 500;
            }
            
            .form-control {
                width: 100%;
                padding: 16px;
                background: rgba(255, 255, 255, 0.1);
                border: 1px solid rgba(255, 255, 255, 0.2);
                border-radius: 12px;
                color: #fff;
                font-size: 16px;
                transition: all 0.3s;
            }
            
            .form-control:focus {
                outline: none;
                border-color: #4361ee;
                background: rgba(255, 255, 255, 0.15);
            }
            
            .btn {
                width: 100%;
                padding: 16px;
                background: linear-gradient(45deg, #4361ee, #7209b7);
                color: white;
                border: none;
                border-radius: 12px;
                font-size: 16px;
                font-weight: 600;
                cursor: pointer;
                transition: all 0.3s;
                margin-top: 10px;
            }
            
            .btn:hover {
                transform: translateY(-2px);
                box-shadow: 0 10px 20px rgba(67, 97, 238, 0.3);
            }
            
            .error-message {
                background: rgba(220, 38, 38, 0.1);
                border: 1px solid #ef4444;
                color: #ef4444;
                padding: 12px;
                border-radius: 8px;
                margin-top: 20px;
                font-size: 14px;
                display: none;
            }
            
            .footer {
                text-align: center;
                margin-top: 20px;
                color: #94a3b8;
                font-size: 14px;
            }
            
            .footer a {
                color: #4361ee;
                text-decoration: none;
            }
            
            @keyframes slideUp {
                from {
                    opacity: 0;
                    transform: translateY(20px);
                }
                to {
                    opacity: 1;
                    transform: translateY(0);
                }
            }
            
            @media (max-width: 480px) {
                .login-card {
                    padding: 20px;
                }
                
                .logo h1 {
                    font-size: 28px;
                }
            }
        </style>
    </head>
    <body>
        <div class="login-container">
            <div class="login-card">
                <div class="logo">
                    <h1>👑 Agent Portal</h1>
                    <p>Bingo Elite - Commission Management</p>
                </div>
                
                <div class="form-group">
                    <label for="username">Username</label>
                    <input type="text" id="username" class="form-control" placeholder="Enter your username">
                </div>
                
                <div class="form-group">
                    <label for="password">Password</label>
                    <input type="password" id="password" class="form-control" placeholder="Enter your password">
                </div>
                
                <button class="btn" onclick="login()">Login</button>
                
                <div class="error-message" id="errorMessage"></div>
                
                <div class="footer">
                    <p>Need an agent account? <a href="#" onclick="requestAccount()">Contact Admin</a></p>
                </div>
            </div>
        </div>
        
        <script>
            let socket = null;
            
            function initSocket() {
                socket = io();
                
                socket.on('connect', () => {
                    console.log('Connected to agent server');
                });
                
                socket.on('agent:loginSuccess', (data) => {
                    localStorage.setItem('agentData', JSON.stringify(data));
                    localStorage.setItem('agentToken', data.id);
                    window.location.href = '/agent';
                });
                
                socket.on('agent:loginError', (message) => {
                    showError(message);
                });
            }
            
            function login() {
                const username = document.getElementById('username').value;
                const password = document.getElementById('password').value;
                
                if (!username || !password) {
                    showError('Please enter username and password');
                    return;
                }
                
                socket.emit('agent:login', { username, password });
            }
            
            function showError(message) {
                const errorDiv = document.getElementById('errorMessage');
                errorDiv.textContent = message;
                errorDiv.style.display = 'block';
                setTimeout(() => {
                    errorDiv.style.display = 'none';
                }, 5000);
            }
            
            function requestAccount() {
                alert('Contact the system administrator to create an agent account.');
            }
            
            window.onload = function() {
                initSocket();
                
                // Check if already logged in
                const agentData = localStorage.getItem('agentData');
                if (agentData) {
                    window.location.href = '/agent';
                }
            };
        </script>
    </body>
    </html>
  `);
});

// ========== TELEGRAM ENTRY PAGE ==========
app.get('/telegram', async (req, res) => {
  const telebirrNumber = await getTelebirrNumber();
  const minWithdrawal = gameLogic.CONFIG ? gameLogic.CONFIG.MIN_WITHDRAWAL : 50;
  
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
        <title>ETHIO GAMES - Telegram Mini App</title>
        <script src="https://telegram.org/js/telegram-web-app.js"></script>
        <style>
            :root {
                --primary-gradient: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                --secondary-gradient: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
                --accent-color: #fbbf24;
                --dark-bg: #0f172a;
                --card-bg: rgba(30, 41, 59, 0.8);
                --card-border: rgba(255, 255, 255, 0.1);
                --text-primary: #f8fafc;
                --text-secondary: #94a3b8;
                --success: #10b981;
                --warning: #f59e0b;
                --keno-color: #8b5cf6;
                --glass-bg: rgba(15, 23, 42, 0.7);
                --glass-border: rgba(255, 255, 255, 0.08);
            }
            
            * {
                margin: 0;
                padding: 0;
                box-sizing: border-box;
                -webkit-tap-highlight-color: transparent;
            }
            
            body {
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
                background: var(--dark-bg);
                color: var(--text-primary);
                min-height: 100vh;
                overflow-x: hidden;
                background-image: 
                    radial-gradient(at 40% 20%, rgba(56, 189, 248, 0.1) 0px, transparent 50%),
                    radial-gradient(at 80% 0%, rgba(139, 92, 246, 0.1) 0px, transparent 50%),
                    radial-gradient(at 0% 50%, rgba(239, 68, 68, 0.1) 0px, transparent 50%);
                backdrop-filter: blur(20px);
                -webkit-backdrop-filter: blur(20px);
            }
            
            .container {
                min-height: 100vh;
                padding: 16px;
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: space-between;
            }
            
            .header {
                width: 100%;
                text-align: center;
                padding: 20px 0;
                margin-bottom: 12px;
                position: relative;
            }
            
            .logo-container {
                margin-bottom: 12px;
                position: relative;
            }
            
            .logo {
                font-size: 2.2rem;
                background: var(--primary-gradient);
                -webkit-background-clip: text;
                -webkit-text-fill-color: transparent;
                background-clip: text;
                filter: drop-shadow(0 4px 6px rgba(0, 0, 0, 0.3));
                animation: float 6s ease-in-out infinite;
            }
            
            .welcome-text {
                font-size: 1.4rem;
                font-weight: 700;
                margin-bottom: 4px;
                background: var(--primary-gradient);
                -webkit-background-clip: text;
                -webkit-text-fill-color: transparent;
                background-clip: text;
                letter-spacing: -0.5px;
            }
            
            .subtitle {
                color: var(--text-secondary);
                font-size: 0.75rem;
                font-weight: 400;
                letter-spacing: 0.5px;
                max-width: 280px;
                margin: 0 auto;
                line-height: 1.3;
            }
            
            .games-section {
                width: 100%;
                max-width: 360px;
                margin: 0 auto 20px;
            }
            
            .section-label {
                font-size: 0.85rem;
                font-weight: 600;
                color: var(--text-secondary);
                text-transform: uppercase;
                letter-spacing: 1px;
                margin-bottom: 12px;
                display: flex;
                align-items: center;
                gap: 8px;
            }
            
            .section-label::after {
                content: '';
                flex: 1;
                height: 1px;
                background: linear-gradient(90deg, transparent, var(--text-secondary), transparent);
            }
            
            .games-grid {
                display: flex;
                flex-direction: column;
                gap: 12px;
                margin-bottom: 20px;
            }
            
            .game-card {
                background: var(--card-bg);
                backdrop-filter: blur(10px);
                -webkit-backdrop-filter: blur(10px);
                border: 1px solid var(--card-border);
                border-radius: 16px;
                padding: 16px;
                display: flex;
                align-items: center;
                gap: 14px;
                cursor: pointer;
                transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                position: relative;
                overflow: hidden;
            }
            
            .game-card::before {
                content: '';
                position: absolute;
                top: 0;
                left: 0;
                right: 0;
                height: 1px;
                background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.1), transparent);
            }
            
            .game-card:hover {
                transform: translateY(-2px);
                border-color: rgba(139, 92, 246, 0.3);
                box-shadow: 0 8px 25px rgba(0, 0, 0, 0.3);
            }
            
            .game-card:active {
                transform: translateY(0);
            }
            
            .game-icon {
                width: 42px;
                height: 42px;
                border-radius: 12px;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 1.5rem;
                flex-shrink: 0;
                position: relative;
                overflow: hidden;
            }
            
            .game-icon::before {
                content: '';
                position: absolute;
                inset: 0;
                background: inherit;
                opacity: 0.2;
            }
            
            .bingo-icon {
                background: linear-gradient(135deg, #3b82f6, #1d4ed8);
                color: #60a5fa;
            }
            
            .keno-icon {
                background: linear-gradient(135deg, #8b5cf6, #7c3aed);
                color: #a78bfa;
            }
            
            .game-content {
                flex: 1;
            }
            
            .game-title {
                font-size: 1rem;
                font-weight: 700;
                margin-bottom: 2px;
                display: flex;
                align-items: center;
                gap: 6px;
            }
            
            .game-description {
                color: var(--text-secondary);
                font-size: 0.7rem;
                line-height: 1.2;
                margin-bottom: 6px;
            }
            
            .game-features {
                display: flex;
                gap: 6px;
                flex-wrap: wrap;
            }
            
            .feature-tag {
                background: rgba(59, 130, 246, 0.1);
                color: #60a5fa;
                padding: 2px 6px;
                border-radius: 8px;
                font-size: 0.6rem;
                font-weight: 500;
                border: 1px solid rgba(59, 130, 246, 0.2);
            }
            
            .feature-tag.keno {
                background: rgba(139, 92, 246, 0.1);
                color: #a78bfa;
                border-color: rgba(139, 92, 246, 0.2);
            }
            
            .game-action {
                margin-left: auto;
            }
            
            .play-btn {
                background: var(--primary-gradient);
                color: white;
                border: none;
                padding: 8px 14px;
                border-radius: 10px;
                font-size: 0.75rem;
                font-weight: 700;
                cursor: pointer;
                transition: all 0.2s;
                box-shadow: 0 4px 12px rgba(59, 130, 246, 0.25);
                white-space: nowrap;
            }
            
            .play-btn.keno {
                background: linear-gradient(135deg, #8b5cf6, #7c3aed);
                box-shadow: 0 4px 12px rgba(139, 92, 246, 0.25);
            }
            
            .play-btn:hover {
                transform: scale(1.05);
                box-shadow: 0 6px 16px rgba(59, 130, 246, 0.35);
            }
            
            .play-btn.keno:hover {
                box-shadow: 0 6px 16px rgba(139, 92, 246, 0.35);
            }
            
            .features-highlight {
                width: 100%;
                max-width: 360px;
                margin: 0 auto 20px;
                background: var(--glass-bg);
                backdrop-filter: blur(10px);
                border: 1px solid var(--glass-border);
                border-radius: 16px;
                padding: 16px;
            }
            
            .features-title {
                font-size: 0.9rem;
                font-weight: 700;
                margin-bottom: 10px;
                color: var(--accent-color);
                display: flex;
                align-items: center;
                gap: 6px;
            }
            
            .features-grid {
                display: grid;
                grid-template-columns: repeat(2, 1fr);
                gap: 8px;
            }
            
            .feature-item {
                display: flex;
                align-items: center;
                gap: 6px;
                font-size: 0.7rem;
                color: var(--text-secondary);
            }
            
            .feature-icon {
                color: var(--success);
                font-size: 0.8rem;
            }
            
            .footer {
                width: 100%;
                max-width: 360px;
                text-align: center;
                padding: 16px 0;
                color: var(--text-secondary);
                font-size: 0.7rem;
                border-top: 1px solid rgba(255, 255, 255, 0.05);
                margin-top: auto;
            }
            
            .footer-links {
                display: flex;
                justify-content: center;
                gap: 16px;
                margin-top: 8px;
            }
            
            .footer-link {
                color: var(--text-secondary);
                text-decoration: none;
                font-size: 0.65rem;
                transition: color 0.2s;
            }
            
            .footer-link:hover {
                color: var(--text-primary);
            }
            
            .status-badge {
                display: inline-flex;
                align-items: center;
                gap: 4px;
                padding: 2px 8px;
                background: rgba(16, 185, 129, 0.1);
                color: var(--success);
                border-radius: 20px;
                font-size: 0.6rem;
                font-weight: 600;
                margin-left: 6px;
            }
            
            .status-badge.keno {
                background: rgba(139, 92, 246, 0.1);
                color: #a78bfa;
            }
            
            @keyframes float {
                0%, 100% { transform: translateY(0px); }
                50% { transform: translateY(-5px); }
            }
            
            @keyframes slideIn {
                from { opacity: 0; transform: translateY(10px); }
                to { opacity: 1; transform: translateY(0); }
            }
            
            .user-greeting {
                position: absolute;
                top: 16px;
                right: 16px;
                font-size: 0.75rem;
                color: var(--text-secondary);
                display: flex;
                align-items: center;
                gap: 4px;
            }
            
            @media (max-width: 360px) {
                .container {
                    padding: 12px;
                }
                
                .game-card {
                    padding: 12px;
                }
                
                .features-grid {
                    grid-template-columns: 1fr;
                }
            }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <div class="user-greeting" id="userGreeting" style="display: none;">
                    👋 <span id="userName">User</span>
                </div>
                
                <div class="logo-container">
                    <div class="logo">🎮</div>
                </div>
                
                <h1 class="welcome-text">ETHIO GAMES</h1>
                <p class="subtitle">Premium gaming experience on Telegram</p>
            </div>
            
            <div class="games-section">
                <div class="section-label">
                    <span>🎯 FEATURED GAMES</span>
                </div>
                
                <div class="games-grid">
                    <div class="game-card" onclick="launchGame('bingo')">
                        <div class="game-icon bingo-icon">
                            🎱
                        </div>
                        <div class="game-content">
                            <h3 class="game-title">
                                BINGO ELITE
                                <span class="status-badge">🔥 HOT</span>
                            </h3>
                            <p class="game-description">
                                Real-time multiplayer bingo with big wins
                            </p>
                            <div class="game-features">
                                <span class="feature-tag">🎯 50 ETB Bonus</span>
                                <span class="feature-tag">💰 Real Money</span>
                                <span class="feature-tag">⚡ Fast</span>
                            </div>
                        </div>
                        <div class="game-action">
                            <button class="play-btn" id="bingoBtn">
                                PLAY
                            </button>
                        </div>
                    </div>
                    
                    <div class="game-card" onclick="launchGame('keno')">
                        <div class="game-icon keno-icon">
                            🎲
                        </div>
                        <div class="game-content">
                            <h3 class="game-title">
                                KENO ULTRA
                                <span class="status-badge keno">NEW</span>
                            </h3>
                            <p class="game-description">
                                Fast number selection with instant wins
                            </p>
                            <div class="game-features">
                                <span class="feature-tag keno">🎰 5 Numbers</span>
                                <span class="feature-tag keno">⚡ 30s Rounds</span>
                                <span class="feature-tag keno">💰 50x Wins</span>
                            </div>
                        </div>
                        <div class="game-action">
                            <button class="play-btn keno" id="kenoBtn">
                                PLAY
                            </button>
                        </div>
                    </div>
                </div>
            </div>
            
            <div class="features-highlight">
                <div class="features-title">
                    ⭐ FEATURES
                </div>
                <div class="features-grid">
                    <div class="feature-item">
                        <span class="feature-icon">✓</span>
                        <span>Real-time Multiplayer</span>
                    </div>
                    <div class="feature-item">
                        <span class="feature-icon">✓</span>
                        <span>Four Corners Bonus</span>
                    </div>
                    <div class="feature-item">
                        <span class="feature-icon">✓</span>
                        <span>Wallet System</span>
                    </div>
                    <div class="feature-item">
                        <span class="feature-icon">✓</span>
                        <span>Auto Start</span>
                    </div>
                </div>
            </div>
            
            <div class="footer">
                <p>Powered by Telegram • Play responsibly</p>
                <div class="footer-links">
                    <a href="#" class="footer-link" onclick="showHelp()">Help</a>
                    <a href="#" class="footer-link" onclick="showWalletInfo()">Wallet</a>
                    <a href="#" class="footer-link" onclick="showTerms()">Terms</a>
                </div>
            </div>
        </div>
        
        <script>
            const tg = window.Telegram.WebApp;
            
            tg.ready();
            tg.expand();
            
            tg.setHeaderColor('#3b82f6');
            tg.setBackgroundColor('#0f172a');
            
            const user = tg.initDataUnsafe?.user;
            
            if (user) {
                document.getElementById('userGreeting').style.display = 'flex';
                document.getElementById('userName').textContent = user.first_name || 'User';
                
                localStorage.setItem('telegramUser', JSON.stringify({
                    id: user.id,
                    firstName: user.first_name,
                    username: user.username,
                    languageCode: user.language_code
                }));
            }
            
            function launchGame(game) {
                if (tg && tg.HapticFeedback) {
                    tg.HapticFeedback.impactOccurred('light');
                }
                
                if (game === 'bingo') {
                    window.location.href = '/game';
                } else if (game === 'keno') {
                    window.location.href = '/keno';
                }
            }
            
            function showHelp() {
                tg.showPopup({
                    title: 'How to Play',
                    message: 'BINGO:\\n1. Select room (10-100 ETB)\\n2. Choose an available ticket\\n3. Wait for countdown\\n4. Mark numbers as called\\n5. Claim BINGO to win!\\n\\nKENO:\\n1. Select 5 numbers from 1-80\\n2. Choose bet amount (5-100 ETB)\\n3. 20 numbers drawn per round\\n4. Match 3-5 numbers to win!',
                    buttons: [{ type: 'ok' }]
                });
            }
            
            function showWalletInfo() {
                tg.showPopup({
                    title: 'Wallet Information',
                    message: '💳 Deposit to: ${telebirrNumber}\\n💰 Min withdrawal: ${minWithdrawal} ETB\\n🎮 Play: @ethio_games1_bot',
                    buttons: [{ type: 'ok' }]
                });
            }
            
            function showTerms() {
                tg.showPopup({
                    title: 'Terms & Conditions',
                    message: '• Must be 18+ to play\\n• Play responsibly\\n• Admin decisions are final\\n• Contact @ethio_games1_bot for support',
                    buttons: [{ type: 'ok' }]
                });
            }
            
            document.getElementById('bingoBtn').addEventListener('click', () => launchGame('bingo'));
            document.getElementById('kenoBtn').addEventListener('click', () => launchGame('keno'));
            
            if (tg && tg.MainButton) {
                tg.MainButton.setText('🎮 PLAY GAMES');
                tg.MainButton.show();
                tg.MainButton.onClick(function() {
                    tg.showPopup({
                        title: 'Select Game',
                        message: 'Choose which game to play:',
                        buttons: [
                            { id: 'bingo', type: 'default', text: '🎱 Bingo Elite' },
                            { id: 'keno', type: 'default', text: '🎰 Keno Ultra' },
                            { type: 'cancel' }
                        ]
                    });
                    
                    tg.onEvent('popupButtonClicked', function(e) {
                        if (e.buttonId === 'bingo') {
                            launchGame('bingo');
                        } else if (e.buttonId === 'keno') {
                            launchGame('keno');
                        }
                    });
                });
            }
            
            // Add entrance animations
            document.querySelectorAll('.game-card').forEach((card, index) => {
                card.style.animation = \`slideIn 0.4s ease \${index * 0.1}s both\`;
            });
        </script>
    </body>
    </html>
  `);
});

// Serve Keno HTML page
app.get('/keno', (req, res) => {
  res.sendFile(path.join(__dirname, 'keno.html'));
});

// Serve Bingo HTML page
app.get('/game', (req, res) => {
  res.sendFile(path.join(__dirname, 'game.html'));
});

// Serve Admin HTML page
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

// API endpoint to get user balance
app.get('/api/user/:userId', async (req, res) => {
  try {
    const user = await User.findOne({ userId: req.params.userId });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json({
      userId: user.userId,
      userName: user.userName,
      balance: user.balance,
      isOnline: user.isOnline,
      lastSeen: user.lastSeen,
      telegramId: user.telegramId,
      phoneNumber: user.phoneNumber || ''
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API endpoint to get Telebirr number
app.get('/api/telebirr-number', async (req, res) => {
  try {
    const telebirrNumber = await getTelebirrNumber();
    res.json({ telebirrNumber });
  } catch (error) {
    console.error('Error getting Telebirr number:', error);
    res.status(500).json({ error: error.message, telebirrNumber: '0962577855' });
  }
});

// API endpoint to add funds (for admin)
app.post('/api/add-funds', async (req, res) => {
  try {
    const { userId, amount, adminPassword } = req.body;
    
    if (adminPassword !== gameLogic.CONFIG.ADMIN_PASSWORD) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    const user = await User.findOne({ userId: userId });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    user.balance += parseFloat(amount);
    await user.save();
    
    const transaction = new Transaction({
      type: 'ADMIN_ADD',
      userId: userId,
      userName: user.userName,
      amount: amount,
      admin: true,
      description: `Admin added ${amount} ETB via API`
    });
    await transaction.save();
    
    res.json({
      success: true,
      message: `Added ${amount} ETB to ${user.userName}`,
      newBalance: user.balance
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ========== TELEGRAM BOT INTEGRATION ==========
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN || '8281813355:AAElz32khbZ9cnX23CeJQn7gwkAypHuJ9E4';

// Simple Telegram webhook
app.post('/telegram-webhook', express.json(), async (req, res) => {
  try {
    const { message } = req.body;
    
    if (message) {
      const chatId = message.chat.id;
      const text = message.text || '';
      const userId = message.from.id.toString();
      const userName = message.from.first_name || 'Player';
      const username = message.from.username || '';
      
      const telebirrNumber = await getTelebirrNumber();
      const minWithdrawal = gameLogic.CONFIG ? gameLogic.CONFIG.MIN_WITHDRAWAL : 50;
      
      // Check for referral code in start command
      let referralCode = null;
      if (text.includes('ref_')) {
        const match = text.match(/ref_(\w+)/);
        if (match) {
          referralCode = match[1];
        }
      }
      
      if (text === '/start' || text === '/play' || text.includes('ref_')) {
        let user = await User.findOne({ telegramId: userId });
        const isNewUser = !user;
        
        if (!user) {
          user = new User({
            userId: `tg_${userId}`,
            userName: userName,
            telegramId: userId,
            telegramUsername: username,
            balance: 0.00,
            referralCode: `TG${userId}`
          });
          
          // Process referral if provided
          if (referralCode) {
            await processReferral(`tg_${userId}`, referralCode);
          }
          
          await user.save();
          
          console.log(`👤 New Telegram user: ${userName} (@${username})`);
        }
        
        let welcomeMessage = `🎮 *Welcome to ETHIO GAMES, ${userName}!*\n\n`;
        
        if (referralCode && isNewUser) {
          welcomeMessage += `✅ You joined via referral link!\n`;
        }
        
        welcomeMessage += `💰 Your balance: *${user.balance.toFixed(2)} ETB*\n\n`;
        welcomeMessage += `🎯 *Games Available:*\n`;
        welcomeMessage += `• 🎱 **BINGO ELITE** - Real-time multiplayer bingo\n`;
        welcomeMessage += `• 🎰 **KENO ULTRA** - Fast number selection game\n\n`;
        welcomeMessage += `💳 *Wallet Instructions:*\n`;
        welcomeMessage += `1. Send money to Telebirr: *${telebirrNumber}*\n`;
        welcomeMessage += `2. Enter receipt number in game wallet\n`;
        welcomeMessage += `3. Admin will approve within 24 hours\n\n`;
        welcomeMessage += `_Need help? Contact admin_`;
        
        await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: welcomeMessage,
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [[
                {
                  text: '🎱 Play Bingo',
                  web_app: { url: 'https://bingo-telegram-game.onrender.com/game' }
                },
                {
                  text: '🎰 Play Keno',
                  web_app: { url: 'https://bingo-telegram-game.onrender.com/keno' }
                }
              ]]
            }
          })
        });
      }
      else if (text === '/balance') {
        const user = await User.findOne({ telegramId: userId });
        const balance = user ? user.balance : 0;
        
        await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: `💰 *Your Balance:* ${balance.toFixed(2)} ETB\n\n` +
                  `💳 *Deposit to:* ${telebirrNumber}\n` +
                  `🎮 Play: @ethio_games1_bot\n` +
                  `👑 Admin: Contact for funds\n` +
                  `🆔 Your ID: \`${userId}\``,
            parse_mode: 'Markdown'
          })
        });
      }
      else if (text === '/wallet') {
        await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: `💳 *ETHIO GAMES Wallet*\n\n` +
                  `*How to Deposit:*\n` +
                  `1. Send money to Telebirr: *${telebirrNumber}*\n` +
                  `2. Open game and go to Wallet (💰 button)\n` +
                  `3. Enter receipt number and amount\n` +
                  `4. Admin will approve within 24 hours\n\n` +
                  `*How to Withdraw:*\n` +
                  `1. Minimum withdrawal: ${minWithdrawal} ETB\n` +
                  `2. Open game Wallet\n` +
                  `3. Select amount and enter phone number\n` +
                  `4. Admin will send money within 24 hours\n\n` +
                  `🎮 *Play Now:* @ethio_games1_bot`,
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [[
                {
                  text: '🎮 Open Games',
                  web_app: { url: 'https://bingo-telegram-game.onrender.com/telegram' }
                }
              ]]
            }
          })
        });
      }
      else if (text === '/agent') {
        await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: `👑 *Agent System*\n\n` +
                  `*Become an Agent:*\n` +
                  `Agents earn commission from referred players!\n\n` +
                  `*Commission Rates:*\n` +
                  `• Bingo Wins: 40% commission\n` +
                  `• Keno Wins: 10% commission\n\n` +
                  `*How it Works:*\n` +
                  `1. Get referral link from admin\n` +
                  `2. Share with players\n` +
                  `3. Earn commission when they win\n` +
                  `4. Track earnings in agent dashboard\n\n` +
                  `*Agent Dashboard:*\n` +
                  `https://bingo-telegram-game.onrender.com/agent\n\n` +
                  `_Contact admin to become an agent_`,
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [[
                {
                  text: '👑 Agent Login',
                  web_app: { url: 'https://bingo-telegram-game.onrender.com/agent/login' }
                }
              ]]
            }
          })
        });
      }
      else if (text === '/help') {
        await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: `🎮 *ETHIO GAMES Help*\n\n` +
                  `*Games Available:*\n` +
                  `• 🎱 **BINGO ELITE** - Real-time multiplayer bingo\n` +
                  `• 🎰 **KENO ULTRA** - Fast number selection (NEW)\n\n` +
                  `*Keno Rules:*\n` +
                  `• Select exactly 5 numbers from 1-80\n` +
                  `• Bet amounts: 5, 10, 20, 50, 100 ETB only\n` +
                  `• 20 numbers drawn per round\n` +
                  `• Match 3 numbers: 1x payout\n` +
                  `• Match 4 numbers: 5x payout\n` +
                  `• Match 5 numbers: 50x payout\n` +
                  `• 30-second rounds\n\n` +
                  `*Agent System:*\n` +
                  `• Earn 40% from Bingo wins\n` +
                  `• Earn 10% from Keno wins\n` +
                  `• Dashboard: /agent\n\n` +
                  `*Commands:*\n` +
                  `/start - Start the bot\n` +
                  `/play - Play games\n` +
                  `/balance - Check balance\n` +
                  `/wallet - Wallet instructions\n` +
                  `/agent - Agent information\n` +
                  `/help - This message\n\n` +
                  `💳 *Wallet:*\n` +
                  `Deposit to Telebirr: *${telebirrNumber}*\n` +
                  `Min withdrawal: ${minWithdrawal} ETB\n\n` +
                  `_Need help? Contact admin_`,
            parse_mode: 'Markdown'
          })
        });
      }
    }
    
    res.sendStatus(200);
  } catch (error) {
    console.error('Telegram webhook error:', error);
    res.sendStatus(200);
  }
});

// Setup endpoint for Telegram bot
app.get('/setup-telegram', async (req, res) => {
  try {
    const telebirrNumber = await getTelebirrNumber();
    const minWithdrawal = gameLogic.CONFIG ? gameLogic.CONFIG.MIN_WITHDRAWAL : 50;
    
    const webhookResponse = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/setWebhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: 'https://bingo-telegram-game.onrender.com/telegram-webhook',
        drop_pending_updates: true
      })
    });
    
    const webhookResult = await webhookResponse.json();
    
    await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/setChatMenuButton`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        menu_button: {
          type: 'web_app',
          text: '🎮 Play Games',
          web_app: { url: 'https://bingo-telegram-game.onrender.com/telegram' }
        }
      })
    });
    
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Telegram Bot Setup Complete</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 40px; text-align: center; background: #0f172a; color: #f8fafc; }
          .container { max-width: 600px; margin: 0 auto; }
          .success { color: #10b981; font-size: 2rem; margin: 20px 0; }
          .info-box { background: #1e293b; padding: 20px; border-radius: 12px; margin: 20px 0; text-align: left; }
          .btn { display: inline-block; padding: 12px 24px; background: #3b82f6; color: white; text-decoration: none; border-radius: 8px; margin: 10px; font-weight: bold; }
          .telebirr-highlight { background: rgba(59, 130, 246, 0.1); padding: 15px; border-radius: 12px; margin: 20px 0; border: 1px solid rgba(59, 130, 246, 0.3); }
          .telebirr-number { font-size: 1.5rem; font-weight: bold; color: #60a5fa; margin: 10px 0; }
          .agent-highlight { background: rgba(139, 92, 246, 0.1); padding: 15px; border-radius: 12px; margin: 20px 0; border: 1px solid rgba(139, 92, 246, 0.3); }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>✅ Telegram Bot Setup Complete!</h1>
          <div class="success">✓ Webhook Configured</div>
          <div class="success">✓ Menu Button Set</div>
          
          <div class="telebirr-highlight">
            <h3>📱 TELEBIRR PAYMENT NUMBER (DATABASE PERSISTED)</h3>
            <div class="telebirr-number">${telebirrNumber}</div>
            <p>This number is stored in MongoDB and will survive server restarts.</p>
            <p>Admin can update it in Admin Panel → Settings</p>
          </div>
          
          <div class="agent-highlight">
            <h3>👑 AGENT SYSTEM - NOW AVAILABLE</h3>
            <p><strong>Agent Features:</strong></p>
            <p>• Agents earn 40% from Bingo wins</p>
            <p>• Agents earn 10% from Keno wins</p>
            <p>• Professional agent dashboard</p>
            <p>• Real-time commission tracking</p>
            <p>• Referral links with QR codes</p>
            <p>• Super admin panel for agent management</p>
            <p>• Agent Portal: /agent</p>
            <p>• Agent Login: /agent/login</p>
            <p><strong>Default Admin Agent:</strong> admin/admin123</p>
          </div>
          
          <div class="info-box">
            <h3>Bot Information:</h3>
            <p><strong>Bot:</strong> @ethio_games1_bot</p>
            <p><strong>Game Entry:</strong> https://bingo-telegram-game.onrender.com/telegram</p>
            <p><strong>Bingo Game:</strong> https://bingo-telegram-game.onrender.com/game</p>
            <p><strong>Keno Game:</strong> https://bingo-telegram-game.onrender.com/keno</p>
            <p><strong>Agent Dashboard:</strong> https://bingo-telegram-game.onrender.com/agent</p>
            <p><strong>Agent Login:</strong> https://bingo-telegram-game.onrender.com/agent/login</p>
            <p><strong>Admin Panel:</strong> https://bingo-telegram-game.onrender.com/admin</p>
            <p><strong>Admin Password:</strong> ${gameLogic.CONFIG.ADMIN_PASSWORD}</p>
            <p><strong>Agent Admin:</strong> admin/admin123</p>
            <p><strong>Games Available:</strong></p>
            <p>1. 🎱 <strong>BINGO ELITE:</strong> Real-time multiplayer bingo</p>
            <p>2. 🎰 <strong>KENO ULTRA:</strong> Fast number selection game (NEW)</p>
            <p><strong>Agent Commission:</strong></p>
            <p>• Bingo Wins: 40%</p>
            <p>• Keno Wins: 10%</p>
            <p><strong>Wallet Features:</strong></p>
            <p>• Telebirr Number: ${telebirrNumber} <strong>(DATABASE PERSISTED)</strong></p>
            <p>• Minimum Withdrawal: ${minWithdrawal} ETB</p>
            <p>• Admin approval for all transactions</p>
          </div>
          
          <div>
            <a href="https://t.me/ethio_games1_bot" class="btn" target="_blank">Open Bot in Telegram</a>
            <a href="/admin" class="btn" style="background: #ef4444;" target="_blank">Open Admin Panel</a>
            <a href="/agent" class="btn" style="background: #8b5cf6;" target="_blank">Open Agent Dashboard</a>
          </div>
          
          <div style="margin-top: 30px; text-align: left;">
            <h4>Agent System Commands:</h4>
            <ol>
              <li>/agent - Show agent information</li>
              <li>Agent Login: Visit /agent/login</li>
              <li>Super Admin: username: admin, password: admin123</li>
              <li>Create new agents from super admin dashboard</li>
              <li>Agents get referral links to share</li>
            </ol>
          </div>
        </div>
      </body>
      </html>
    `);
  } catch (error) {
    res.send(`
      <h1 style="color: #ef4444;">❌ Setup Error</h1>
      <p>${error.message}</p>
      <p>Make sure your bot token is correct: ${TELEGRAM_TOKEN}</p>
    `);
  }
});

// Health check endpoint
app.get('/health', async (req, res) => {
  try {
    const connectedPlayers = gameLogic.getConnectedUsers ? gameLogic.getConnectedUsers().length : 0;
    const activeGames = await Room.countDocuments({ status: 'playing' });
    const totalUsers = await User.countDocuments();
    const rooms = await Room.countDocuments();
    const totalTransactions = await Transaction.countDocuments();
    const pendingDeposits = await Transaction.countDocuments({ type: 'DEPOSIT_REQUEST', status: 'pending' });
    const pendingWithdrawals = await Transaction.countDocuments({ type: 'WITHDRAW_REQUEST', status: 'pending' });
    const telebirrNumber = await getTelebirrNumber();
    const processingClaims = gameLogic.getProcessingClaims ? gameLogic.getProcessingClaims().size : 0;
    const roomWinners = gameLogic.getRoomWinners ? gameLogic.getRoomWinners().size : 0;
    const kenoPlayers = kenoLogic.getKenoPlayersCount ? kenoLogic.getKenoPlayersCount() : 0;
    const kenoOnline = kenoLogic.getOnlinePlayersCount ? kenoLogic.getOnlinePlayersCount() : 0;
    const kenoEarnings = kenoLogic.totalKenoEarnings || 0;
    
    // Agent statistics
    const totalAgents = await Agent.countDocuments();
    const activeAgents = await Agent.countDocuments({ isActive: true });
    const agentCommissions = await AgentCommission.aggregate([
      { $match: { status: 'completed' } },
      { $group: { _id: null, total: { $sum: '$commissionAmount' } } }
    ]);
    
    res.json({
      status: 'ok',
      database: 'connected',
      connectedPlayers: connectedPlayers,
      kenoPlayers: {
        total: kenoPlayers,
        online: kenoOnline,
        earnings: kenoEarnings
      },
      agentSystem: {
        totalAgents: totalAgents,
        activeAgents: activeAgents,
        totalCommissions: agentCommissions[0]?.total || 0,
        commissionRates: {
          bingo: '40%',
          keno: '10%'
        }
      },
      totalUsers: totalUsers,
      activeGames: activeGames,
      totalRooms: rooms,
      totalTransactions: totalTransactions,
      pendingDeposits: pendingDeposits,
      pendingWithdrawals: pendingWithdrawals,
      telebirrNumber: telebirrNumber,
      telebirrPersisted: true,
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      telegramReady: true,
      botUsername: '@ethio_games1_bot',
      realTimeBoxUpdates: 'active',
      walletSystem: 'active',
      agentSystem: 'active',
      gamesAvailable: ['bingo', 'keno']
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 404 handler
app.use((req, res) => {
  res.status(404).send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>404 - Page Not Found</title>
      <style>
        body { font-family: Arial, sans-serif; padding: 40px; text-align: center; background: #0f172a; color: #f8fafc; }
        .container { max-width: 600px; margin: 0 auto; }
        h1 { color: #ef4444; font-size: 3rem; }
        .btn { display: inline-block; padding: 12px 24px; background: #3b82f6; color: white; text-decoration: none; border-radius: 8px; margin: 10px; font-weight: bold; }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>404 - Page Not Found</h1>
        <p style="margin: 20px 0; color: #94a3b8;">The page you're looking for doesn't exist.</p>
        <div>
          <a href="/" class="btn">🏠 Go Home</a>
          <a href="/telegram" class="btn" style="background: #8b5cf6;">🤖 Telegram Entry</a>
          <a href="/agent" class="btn" style="background: #8b5cf6;">👑 Agent Dashboard</a>
          <a href="/game" class="btn" style="background: #10b981;">🎮 Play Bingo</a>
          <a href="/keno" class="btn" style="background: #8b5cf6;">🎰 Play Keno</a>
        </div>
      </div>
    </body>
    </html>
  `);
});

// ========== START SERVER ==========
const PORT = process.env.PORT || 3000;
server.listen(PORT, async () => {
  const telebirrNumber = await getTelebirrNumber();
  console.log(`
╔══════════════════════════════════════════════════════════════════════════════╗
║             🤖 BINGO ELITE + KENO ULTRA + AGENT SYSTEM                      ║
╠══════════════════════════════════════════════════════════════════════════════╣
║  URL:          https://bingo-telegram-game.onrender.com                     ║
║  Port:         ${PORT}                                                      ║
║  Bingo:        /game                                                        ║
║  Keno:         /keno                                                        ║
║  Agent:        /agent                                                       ║
║  Agent Login:  /agent/login                                                 ║
║  Admin:        /admin (password: ${gameLogic.CONFIG.ADMIN_PASSWORD})                 ║
║  Telegram:     /telegram                                                    ║
╠══════════════════════════════════════════════════════════════════════════════╣
║  👑 Agent System: ACTIVE                                                    ║
║  🤖 Telegram Bot: @ethio_games1_bot                                         ║
║  🎮 Games: Bingo Elite + Keno Ultra                                         ║
║  💰 Agent Commission: Bingo 40%, Keno 10%                                   ║
║  🎯 Four Corners Bonus: ${gameLogic.CONFIG.FOUR_CORNERS_BONUS} ETB           ║
║  🎰 Keno Payouts: Match 3=1x, 4=5x, 5=50x                                  ║
║  📱 TELEBIRR: ${telebirrNumber}                                             ║
║  👑 Default Agent Admin: admin/admin123                                     ║
╠══════════════════════════════════════════════════════════════════════════════╣
║  ✅ Agent System Features:                                                   ║
║  • Professional mobile-friendly dashboard                                    ║
║  • Real-time commission tracking                                             ║
║  • Referral links with QR codes                                             ║
║  • Super admin panel for agent management                                   ║
║  • Bingo: 40% commission from referral wins                                 ║
║  • Keno: 10% commission from referral wins                                  ║
║  • Automatic commission calculation                                         ║
╚══════════════════════════════════════════════════════════════════════════════╝
✅ Server ready with Agent System
📱 Telebirr number loaded from database: ${telebirrNumber}
🎰 Keno Ultra game: ACTIVE (5 numbers, 30s rounds)
👑 Agent System: ACTIVE (Bingo 40%, Keno 10%)
  `);
});
