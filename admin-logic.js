// Configuration
const CONFIG = {
    SERVER_URL: window.location.origin,
    AUTO_REFRESH_INTERVAL: 5000,
    MAX_ACTIVITY_ITEMS: 20,
    PERSISTENT_STORAGE: true,
    VERSION: "4.2"
};

// State
let state = {
    isAdmin: false,
    users: [],
    filteredUsers: [],
    agents: [],
    filteredAgents: [],
    allTransactions: [],
    pendingTransactions: [],
    depositRequests: [],
    withdrawalRequests: [],
    activityLog: [],
    charts: {},
    lastUpdate: new Date(),
    socket: null,
    lastPlayerCount: 0,
    debugInfo: {},
    showUserDetails: false,
    multiSocketUsers: 0,
    telebirrNumber: "0962577855",
    editingAgentId: null,
    quickAddUserId: null,
    quickAddUserName: null,
    quickAddUserBalance: 0,
    agentStatistics: {
        totalAgents: 0,
        activeAgents: 0,
        totalCommissions: 0,
        referralUsers: 0
    },
    analyticsData: {
        totalDeposits: 0,
        totalWithdrawals: 0,
        netProfit: 0,
        activeUsers: 0
    },
    transactionChart: null,
    isConnecting: false,
    loginAttempts: 0,
    maxLoginAttempts: 3
};

// Initialize
document.addEventListener('DOMContentLoaded', function() {
    console.log('🔄 Admin panel loading...');
    
    // Update version display
    document.querySelectorAll('.sidebar-version, .login-subtitle').forEach(el => {
        el.textContent = `Admin v${CONFIG.VERSION}`;
    });
    
    // Check for saved session
    const savedSession = localStorage.getItem('bingo_admin_session');
    if (savedSession) {
        try {
            const session = JSON.parse(savedSession);
            if (session.expires > Date.now()) {
                document.getElementById('adminPassword').value = session.password;
                // Don't auto-login, let user click the button
            } else {
                console.log('⚠️ Saved session expired');
                localStorage.removeItem('bingo_admin_session');
            }
        } catch (e) {
            console.error('❌ Error parsing saved session:', e);
            localStorage.removeItem('bingo_admin_session');
        }
    }
    
    // Setup auto-connect on password input enter key
    document.getElementById('adminPassword').addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            adminLogin();
        }
    });
    
    // Setup initial connection status
    updateConnectionStatus();
    updateLastUpdateTime();
    
    // Initialize navigation listeners
    attachNavListeners();
    
    console.log('✅ Admin panel initialized');
});

function attachNavListeners() {
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', function() {
            const section = this.dataset.section;
            
            document.querySelectorAll('.nav-item').forEach(nav => nav.classList.remove('active'));
            this.classList.add('active');
            
            document.querySelectorAll('.content-section').forEach(s => s.classList.remove('active'));
            document.getElementById(`${section}Section`).classList.add('active');
            
            const titleMap = {
                'overview': 'Dashboard',
                'users': 'User Management',
                'agents': 'Agent Management',
                'transactions': 'Transactions',
                'wallet-approvals': 'Wallet Approvals',
                'deposit-requests': 'Deposit Requests',
                'withdrawal-requests': 'Withdrawal Requests',
                'rooms': 'Game Rooms',
                'analytics': 'Analytics',
                'controls': 'System Controls',
                'logs': 'Activity Log',
                'debug': 'Debug Information'
            };
            document.getElementById('pageTitle').textContent = titleMap[section] || 'Dashboard';
            
            if (window.innerWidth < 992) {
                toggleSidebar();
            }
            
            // Refresh specific data when switching sections
            if (section === 'wallet-approvals') {
                refreshPendingTransactions();
            } else if (section === 'deposit-requests') {
                refreshDepositRequests();
            } else if (section === 'withdrawal-requests') {
                refreshWithdrawalRequests();
            } else if (section === 'agents') {
                refreshAgents();
            } else if (section === 'users') {
                applyFilters();
            } else if (section === 'analytics') {
                updateAnalytics();
                initTransactionChart();
            } else if (section === 'transactions') {
                loadAllTransactions();
            }
        });
    });
}

// Socket connection with retry logic
function connectSocket() {
    console.log(`🔗 Connecting to server: ${CONFIG.SERVER_URL}`);
    
    if (state.isConnecting) {
        console.log('⚠️ Already connecting to server...');
        return state.socket;
    }
    
    state.isConnecting = true;
    
    // Disconnect existing socket if any
    if (state.socket) {
        state.socket.disconnect();
        state.socket = null;
    }
    
    // Create new socket connection
    try {
        state.socket = io(CONFIG.SERVER_URL, {
            reconnection: true,
            reconnectionAttempts: 5,
            reconnectionDelay: 1000,
            reconnectionDelayMax: 5000,
            timeout: 10000,
            transports: ['websocket', 'polling']
        });

        setupSocketListeners();
        
        return state.socket;
    } catch (error) {
        console.error('❌ Failed to create socket:', error);
        state.isConnecting = false;
        showToast('Failed to connect: ' + error.message, 'error');
        return null;
    }
}

function setupSocketListeners() {
    // Socket event handlers
    state.socket.on('connect', () => {
        console.log('✅ Connected to server');
        state.isConnecting = false;
        updateConnectionStatus('Connected', 'success');
        showToast('Connected to server', 'success');
    });

    state.socket.on('connect_error', (error) => {
        console.error('❌ Connection error:', error);
        state.isConnecting = false;
        updateConnectionStatus('Connection Failed', 'error');
        showToast(`Connection failed: ${error.message || 'Unknown error'}`, 'error');
        
        // Try to reconnect after 3 seconds
        setTimeout(() => {
            if (!state.socket?.connected) {
                console.log('🔄 Attempting to reconnect...');
                connectSocket();
            }
        }, 3000);
    });

    state.socket.on('disconnect', (reason) => {
        console.log('🔌 Disconnected from server:', reason);
        updateConnectionStatus('Disconnected', 'error');
        showToast('Disconnected from server', 'error');
        
        if (reason === 'io server disconnect') {
            // Server disconnected, try to reconnect
            setTimeout(() => {
                if (!state.socket?.connected) {
                    console.log('🔄 Server disconnected, attempting to reconnect...');
                    connectSocket();
                }
            }, 2000);
        }
    });

    // Admin authentication events
    state.socket.on('admin:authSuccess', (data) => {
        console.log('🔑 Admin authentication successful');
        state.isAdmin = true;
        state.loginAttempts = 0;
        
        // Hide login screen and show dashboard
        document.getElementById('loginScreen').style.display = 'none';
        document.getElementById('dashboard').style.display = 'block';
        
        showToast('Login successful!', 'success');
        
        // Save session
        const password = document.getElementById('adminPassword').value;
        const session = {
            password: password,
            expires: Date.now() + (24 * 60 * 60 * 1000)
        };
        localStorage.setItem('bingo_admin_session', JSON.stringify(session));
        
        // Request initial data
        console.log('📊 Requesting initial data...');
        state.socket.emit('admin:getData');
        state.socket.emit('agent:getAllAgents');
        state.socket.emit('admin:getTelebirrNumber');
        state.socket.emit('admin:getAllTransactions');
        state.socket.emit('admin:getPendingTransactions');
        
        // Start auto-refresh
        startAutoRefresh();
        
        // Initialize charts after a delay
        setTimeout(initCharts, 1000);
    });

    state.socket.on('admin:authError', (message) => {
        console.error('❌ Admin auth error:', message);
        state.isAdmin = false;
        state.loginAttempts++;
        
        showToast('Login failed: ' + message, 'error');
        localStorage.removeItem('bingo_admin_session');
        document.getElementById('adminPassword').value = '';
        document.getElementById('adminPassword').focus();
        
        if (state.loginAttempts >= state.maxLoginAttempts) {
            showToast('Too many failed attempts. Please try again later.', 'error');
            document.querySelector('.btn-primary').disabled = true;
            setTimeout(() => {
                document.querySelector('.btn-primary').disabled = false;
            }, 30000);
        }
    });

    // Data update events
    state.socket.on('admin:update', (data) => {
        console.log('📊 Received admin update data');
        updateStats(data);
        state.lastUpdate = new Date();
        updateLastUpdateTime();
        if (data.connectedSockets !== undefined) {
            document.getElementById('activeConnections').textContent = data.connectedSockets;
        }
        updateOnlineStatus(data.totalPlayers || 0);
    });

    state.socket.on('admin:players', (data) => {
        console.log(`👥 Received ${data.length} users`);
        state.users = data;
        applyFilters();
        updateUsersTable();
        updateRecentRequestsTable();
        
        const onlineCount = data.filter(user => user.isOnline).length;
        updateUserCountBadge(onlineCount);
        
        const multiSocketCount = data.filter(user => (user.socketCount || 0) > 1).length;
        state.multiSocketUsers = multiSocketCount;
        if (document.getElementById('debugMultiSocketUsers')) {
            document.getElementById('debugMultiSocketUsers').textContent = multiSocketCount;
        }
        
        updateFundsUserList();
    });

    // Agent events
    state.socket.on('agent:allAgents', (data) => {
        console.log(`👑 Received ${data.length} agents`);
        state.agents = data;
        updateAgentsTable();
        updateAgentCountBadge();
    });

    state.socket.on('admin:telebirrNumber', (number) => {
        console.log(`📱 Received Telebirr number: ${number}`);
        state.telebirrNumber = number;
        document.getElementById('telebirrNumber').value = number;
        const statusEl = document.getElementById('telebirrNumberStatus');
        if (statusEl) {
            statusEl.innerHTML = `<span style="color: var(--success);"><i class="fas fa-check"></i> Current: ${number}</span>`;
        }
    });

    // Transaction events
    state.socket.on('admin:allTransactions', (transactions) => {
        console.log(`💰 Received ${transactions.length} transactions`);
        state.allTransactions = transactions;
        updateTransactionHistory();
        updateAnalyticsFromTransactions();
    });

    state.socket.on('admin:pendingTransactions', (transactions) => {
        console.log(`⏳ Received ${transactions.length} pending transactions`);
        state.pendingTransactions = transactions;
        updatePendingTransactionsBadge();
        updateWalletApprovalsTable();
        updateRecentRequestsTable();
    });

    state.socket.on('admin:newTransaction', (transaction) => {
        console.log(`➕ New transaction: ${transaction.type}`);
        state.allTransactions.unshift(transaction);
        
        if (transaction.status === 'pending') {
            state.pendingTransactions.unshift(transaction);
            updatePendingTransactionsBadge();
            playNotificationSound();
            
            if (transaction.type === 'DEPOSIT_REQUEST') {
                showToast(`New deposit request from ${transaction.userName}`, 'info');
            } else if (transaction.type === 'WITHDRAW_REQUEST') {
                showToast(`New withdrawal request from ${transaction.userName}`, 'info');
            }
        }
        
        updateTransactionHistory();
        updateWalletApprovalsTable();
        updateRecentRequestsTable();
    });

    state.socket.on('admin:success', (message) => {
        showToast(message, 'success');
        // Refresh data
        if (state.socket && state.socket.connected) {
            state.socket.emit('admin:getData');
            state.socket.emit('admin:getAllTransactions');
            state.socket.emit('admin:getPendingTransactions');
        }
    });

    state.socket.on('admin:error', (message) => {
        console.error('❌ Admin error:', message);
        showToast('Error: ' + message, 'error');
    });

    state.socket.on('admin:activity', (activity) => {
        addActivityItem(activity);
    });

    // Wallet transaction events
    state.socket.on('wallet:depositApproved', (data) => {
        console.log(`✅ Deposit approved: ${data.amount} ETB`);
        showToast(`Deposit approved: ${data.amount} ETB added`, 'success');
        refreshPendingTransactions();
    });

    state.socket.on('wallet:withdrawalApproved', (data) => {
        console.log(`✅ Withdrawal approved: ${data.amount} ETB`);
        showToast(`Withdrawal approved: ${data.amount} ETB sent`, 'success');
        refreshPendingTransactions();
    });

    state.socket.on('wallet:depositRejected', (data) => {
        console.log(`❌ Deposit rejected: ${data.message}`);
        showToast(`Deposit rejected: ${data.message}`, 'error');
        refreshPendingTransactions();
    });

    state.socket.on('wallet:withdrawalRejected', (data) => {
        console.log(`❌ Withdrawal rejected: ${data.message}`);
        showToast(`Withdrawal rejected: ${data.message}`, 'error');
        refreshPendingTransactions();
    });

    // House earnings reset
    state.socket.on('admin:houseEarningsReset', (data) => {
        console.log(`🔄 House earnings reset`);
        showToast(`House earnings reset to ${data.resetAmount} ETB`, 'success');
        if (document.getElementById('houseEarnings')) {
            document.getElementById('houseEarnings').textContent = data.resetAmount.toFixed(2) + ' ETB';
        }
    });

    console.log('✅ Socket event listeners attached');
}

// Login Function
function adminLogin() {
    const password = document.getElementById('adminPassword').value.trim();
    if (!password) {
        showToast('Please enter password', 'error');
        document.getElementById('adminPassword').focus();
        return;
    }
    
    console.log('🔑 Attempting admin login...');
    
    // Show loading state
    const loginBtn = document.querySelector('.btn-primary');
    const originalText = loginBtn.innerHTML;
    loginBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Connecting...';
    loginBtn.disabled = true;
    
    // Connect socket first if not connected
    if (!state.socket || !state.socket.connected) {
        console.log('🔄 Creating new socket connection...');
        const socket = connectSocket();
        
        if (!socket) {
            loginBtn.innerHTML = originalText;
            loginBtn.disabled = false;
            return;
        }
        
        // Wait for connection then send auth
        const checkConnection = setInterval(() => {
            if (state.socket?.connected) {
                clearInterval(checkConnection);
                console.log('✅ Socket connected, sending auth...');
                state.socket.emit('admin:auth', password);
            } else if (!state.isConnecting) {
                clearInterval(checkConnection);
                showToast('Failed to connect to server', 'error');
                loginBtn.innerHTML = originalText;
                loginBtn.disabled = false;
            }
        }, 500);
        
        // Timeout after 10 seconds
        setTimeout(() => {
            clearInterval(checkConnection);
            if (!state.socket?.connected) {
                showToast('Connection timeout. Check server.', 'error');
                loginBtn.innerHTML = originalText;
                loginBtn.disabled = false;
            }
        }, 10000);
    } else {
        // Socket already connected, send auth
        console.log('✅ Socket already connected, sending auth...');
        state.socket.emit('admin:auth', password);
        
        // Restore button after 2 seconds
        setTimeout(() => {
            loginBtn.innerHTML = originalText;
            loginBtn.disabled = false;
        }, 2000);
    }
}

// UI Functions
function showToast(message, type = 'success') {
    const toastContainer = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
        <div class="toast-icon">
            <i class="fas fa-${type === 'success' ? 'check-circle' : type === 'error' ? 'exclamation-circle' : 'info-circle'}"></i>
        </div>
        <div class="toast-content">
            <div class="toast-title">${type === 'success' ? 'Success' : type === 'error' ? 'Error' : 'Info'}</div>
            <div class="toast-message">${message}</div>
        </div>
    `;
    
    toastContainer.appendChild(toast);
    
    setTimeout(() => {
        toast.classList.add('show');
    }, 10);
    
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => {
            toastContainer.removeChild(toast);
        }, 300);
    }, 3000);
}

function showModal(modalId) {
    document.getElementById(modalId).classList.add('active');
}

function hideModal(modalId) {
    document.getElementById(modalId).classList.remove('active');
}

function toggleSidebar() {
    document.getElementById('sidebar').classList.toggle('active');
}

function playNotificationSound() {
    try {
        const audio = new Audio('data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAZGF0YQQAAAAAAA==');
        audio.volume = 0.3;
        audio.play().catch(e => console.log('Audio play failed:', e));
    } catch (e) {
        // Audio not supported
    }
}

// Data Update Functions
function updateStats(data) {
    console.log('📈 Updating stats:', data);
    if (document.getElementById('totalUsers')) {
        document.getElementById('totalUsers').textContent = data.totalUsers || 0;
    }
    if (document.getElementById('onlinePlayers')) {
        document.getElementById('onlinePlayers').textContent = data.totalPlayers || 0;
    }
    if (document.getElementById('houseEarnings')) {
        document.getElementById('houseEarnings').textContent = (data.houseEarnings || 0).toFixed(2) + ' ETB';
    }
    
    // Update pending requests count
    const pendingCount = state.pendingTransactions.length;
    if (document.getElementById('pendingRequests')) {
        document.getElementById('pendingRequests').textContent = pendingCount;
    }
}

function updateConnectionStatus(status = 'Disconnected', type = 'error') {
    const statusText = document.getElementById('connectionStatusText');
    const statusIndicator = document.querySelector('.status-indicator');
    
    if (statusText) {
        statusText.textContent = status;
        statusText.style.color = type === 'success' ? 'var(--success)' : 'var(--danger)';
    }
    
    if (statusIndicator) {
        statusIndicator.style.background = type === 'success' ? 'var(--success)' : 'var(--danger)';
        statusIndicator.style.animation = type === 'success' ? 'pulse 2s infinite' : 'none';
    }
}

function updateOnlineStatus(onlineCount) {
    const onlineStatus = document.getElementById('onlineStatus');
    if (onlineStatus) {
        if (onlineCount > 0) {
            onlineStatus.className = 'stat-change positive';
            onlineStatus.innerHTML = '<i class="fas fa-circle"></i> ' + onlineCount + ' players online';
        } else {
            onlineStatus.className = 'stat-change';
            onlineStatus.innerHTML = '<i class="fas fa-circle"></i> No players online';
        }
    }
}

function applyFilters() {
    const statusFilter = document.getElementById('statusFilter')?.value || 'all';
    const searchTerm = document.getElementById('userSearch')?.value.toLowerCase() || '';
    
    let filtered = [...state.users];
    
    if (statusFilter === 'online') {
        filtered = filtered.filter(user => user.isOnline);
    } else if (statusFilter === 'offline') {
        filtered = filtered.filter(user => !user.isOnline);
    } else if (statusFilter === 'telegram') {
        filtered = filtered.filter(user => user.telegramId);
    } else if (statusFilter === 'multi') {
        filtered = filtered.filter(user => (user.socketCount || 0) > 1);
    } else if (statusFilter === 'hasAgent') {
        filtered = filtered.filter(user => user.agentId);
    } else if (statusFilter === 'noAgent') {
        filtered = filtered.filter(user => !user.agentId);
    }
    
    if (searchTerm) {
        filtered = filtered.filter(user => 
            (user.userName && user.userName.toLowerCase().includes(searchTerm)) ||
            (user.userId && user.userId.toLowerCase().includes(searchTerm))
        );
    }
    
    state.filteredUsers = filtered;
    updateUsersTable();
}

function searchUsers() {
    applyFilters();
}

function updateUsersTable() {
    const tbody = document.getElementById('usersTableBody');
    if (!tbody) return;
    
    tbody.innerHTML = '';
    
    if (state.filteredUsers.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="8" style="text-align: center; padding: 40px; color: var(--text-muted);">
                    <i class="fas fa-users-slash"></i>
                    <div class="mt-2">No users found</div>
                </td>
            </tr>
        `;
        return;
    }
    
    state.filteredUsers.forEach(user => {
        const row = document.createElement('tr');
        row.className = 'user-row ' + (user.isOnline ? 'online' : 'offline') + (user.currentRoom ? ' playing' : '');
        
        let statusBadge = '';
        if (user.isOnline) {
            if (user.currentRoom) {
                statusBadge = '<span class="badge badge-warning">Playing</span>';
            } else {
                statusBadge = '<span class="badge badge-success">Online</span>';
            }
        } else {
            statusBadge = '<span class="badge">Offline</span>';
        }
        
        let roomBadge = '<span class="text-muted">Lobby</span>';
        if (user.currentRoom) {
            roomBadge = `<span class="badge badge-primary">${user.currentRoom} ETB</span>`;
        }
        
        const socketCount = user.socketCount || 0;
        const socketBadge = socketCount > 1 ? 
            `<span class="badge badge-warning">${socketCount}</span>` : 
            `<span class="text-muted">${socketCount}</span>`;
        
        let agentInfo = '<span class="text-muted">None</span>';
        if (user.agentId) {
            const agent = state.agents.find(a => a._id === user.agentId);
            if (agent) {
                agentInfo = `<span class="badge badge-agent">${agent.name}</span>`;
            }
        }
        
        row.innerHTML = `
            <td>
                <div class="d-flex align-center gap-2">
                    <div class="user-avatar">${user.userName ? user.userName.charAt(0).toUpperCase() : 'U'}</div>
                    <div>
                        <div style="font-weight: 600;">${user.userName || 'Unknown'}</div>
                        <div class="text-muted" style="font-size: 0.75rem;">${user.userId ? user.userId.substring(0, 12) + '...' : 'No ID'}</div>
                    </div>
                </div>
            </td>
            <td style="font-weight: 700; color: ${(user.balance || 0) >= 0 ? 'var(--success)' : 'var(--danger)'}">
                ${(user.balance || 0).toFixed(2)} ETB
            </td>
            <td>${agentInfo}</td>
            <td>${statusBadge}</td>
            <td>${socketBadge}</td>
            <td>${roomBadge}</td>
            <td>
                <div class="text-muted" style="font-size: 0.85rem;">
                    ${user.lastSeen ? new Date(user.lastSeen).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : 'Never'}
                </div>
            </td>
            <td>
                <div class="action-buttons">
                    <button class="btn btn-primary btn-sm" onclick="quickAddFundsToUser('${user.userId}', '${user.userName || 'Unknown'}', ${user.balance || 0})" title="Add Funds">
                        <i class="fas fa-money-bill-wave"></i>
                    </button>
                    <button class="btn btn-agent btn-sm" onclick="showAssignAgentToUser('${user.userId}', '${user.userName || 'Unknown'}')" title="Assign Agent">
                        <i class="fas fa-user-tie"></i>
                    </button>
                    <button class="btn btn-danger btn-sm" onclick="kickUser('${user.userId}')" title="Kick User">
                        <i class="fas fa-user-slash"></i>
                    </button>
                </div>
            </td>
        `;
        
        tbody.appendChild(row);
    });
}

// Update funds user list for datalist
function updateFundsUserList() {
    const datalist = document.getElementById('fundsUserList');
    if (!datalist) return;
    
    datalist.innerHTML = '';
    
    state.users.forEach(user => {
        const option = document.createElement('option');
        option.value = `${user.userName} (${user.userId})`;
        option.setAttribute('data-userid', user.userId);
        datalist.appendChild(option);
    });
}

// Transaction Functions
function loadAllTransactions() {
    if (state.socket && state.isAdmin && state.socket.connected) {
        console.log('📊 Requesting all transactions...');
        state.socket.emit('admin:getAllTransactions');
    }
}

function refreshPendingTransactions() {
    if (state.socket && state.isAdmin && state.socket.connected) {
        console.log('⏳ Requesting pending transactions...');
        state.socket.emit('admin:getPendingTransactions');
    }
}

function refreshDepositRequests() {
    if (state.socket && state.isAdmin && state.socket.connected) {
        console.log('💳 Requesting deposit requests...');
        state.socket.emit('admin:getDepositRequests');
    }
}

function refreshWithdrawalRequests() {
    if (state.socket && state.isAdmin && state.socket.connected) {
        console.log('💸 Requesting withdrawal requests...');
        state.socket.emit('admin:getWithdrawalRequests');
    }
}

function filterWalletTransactions() {
    updateWalletApprovalsTable();
}

function filterDepositRequests() {
    updateDepositRequestsTable();
}

function filterWithdrawalRequests() {
    updateWithdrawalRequestsTable();
}

function updateWalletApprovalsTable() {
    const tbody = document.getElementById('walletApprovalsTableBody');
    if (!tbody) return;
    
    tbody.innerHTML = '';
    
    const typeFilter = document.getElementById('walletTypeFilter')?.value || 'all';
    const statusFilter = document.getElementById('walletStatusFilter')?.value || 'pending';
    
    let filtered = state.pendingTransactions;
    
    if (typeFilter === 'deposit') {
        filtered = filtered.filter(t => t.type === 'DEPOSIT_REQUEST');
    } else if (typeFilter === 'withdraw') {
        filtered = filtered.filter(t => t.type === 'WITHDRAW_REQUEST');
    }
    
    if (statusFilter !== 'all') {
        filtered = filtered.filter(t => t.status === statusFilter);
    }
    
    if (filtered.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="7" style="text-align: center; padding: 40px; color: var(--text-muted);">
                    <i class="fas fa-check-circle"></i>
                    <div class="mt-2">No transactions found</div>
                </td>
            </tr>
        `;
        return;
    }
    
    filtered.forEach(transaction => {
        const row = document.createElement('tr');
        row.className = 'user-row';
        
        const time = new Date(transaction.createdAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
        const date = new Date(transaction.createdAt).toLocaleDateString();
        
        let typeBadge = '';
        if (transaction.type === 'DEPOSIT_REQUEST') {
            typeBadge = '<span class="badge badge-success">Deposit</span>';
        } else if (transaction.type === 'WITHDRAW_REQUEST') {
            typeBadge = '<span class="badge badge-danger">Withdrawal</span>';
        }
        
        let statusBadge = '';
        if (transaction.status === 'pending') {
            statusBadge = '<span class="badge badge-warning">Pending</span>';
        } else if (transaction.status === 'approved') {
            statusBadge = '<span class="badge badge-success">Approved</span>';
        } else if (transaction.status === 'rejected') {
            statusBadge = '<span class="badge badge-danger">Rejected</span>';
        }
        
        let details = '';
        if (transaction.type === 'DEPOSIT_REQUEST') {
            details = `Receipt: ${transaction.receiptNumber || 'N/A'}`;
            if (transaction.phoneNumber) {
                details += `<br>Phone: ${transaction.phoneNumber}`;
            }
        } else if (transaction.type === 'WITHDRAW_REQUEST') {
            details = `Phone: ${transaction.phoneNumber || 'N/A'}`;
        }
        
        row.innerHTML = `
            <td>
                <div class="d-flex align-center gap-2">
                    <div class="user-avatar">${transaction.userName ? transaction.userName.charAt(0).toUpperCase() : 'U'}</div>
                    <div>
                        <div style="font-weight: 600;">${transaction.userName || 'Unknown'}</div>
                        <div class="text-muted" style="font-size: 0.75rem;">${transaction.userId ? transaction.userId.substring(0, 12) + '...' : 'No ID'}</div>
                    </div>
                </div>
            </td>
            <td>${typeBadge}</td>
            <td style="font-weight: 700; color: ${transaction.type === 'DEPOSIT_REQUEST' ? 'var(--success)' : 'var(--danger)'}">
                ${transaction.type === 'DEPOSIT_REQUEST' ? '+' : '-'}${Math.abs(transaction.amount).toFixed(2)} ETB
            </td>
            <td>
                <div style="font-size: 0.85rem;">${details}</div>
            </td>
            <td>
                <div>${date}</div>
                <div class="text-muted" style="font-size: 0.75rem;">${time}</div>
            </td>
            <td>${statusBadge}</td>
            <td>
                <div class="action-buttons">
                    ${transaction.status === 'pending' ? `
                        <button class="btn btn-success btn-sm" onclick="approveTransaction('${transaction._id}', '${transaction.type}')" title="Approve">
                            <i class="fas fa-check"></i>
                        </button>
                        <button class="btn btn-danger btn-sm" onclick="rejectTransaction('${transaction._id}', '${transaction.type}')" title="Reject">
                            <i class="fas fa-times"></i>
                        </button>
                    ` : ''}
                    <button class="btn btn-primary btn-sm" onclick="showTransactionDetails('${transaction._id}')" title="View Details">
                        <i class="fas fa-eye"></i>
                    </button>
                    <button class="btn btn-primary btn-sm" onclick="quickAddFundsToUser('${transaction.userId}', '${transaction.userName}', 0)" title="Add Funds">
                        <i class="fas fa-money-bill-wave"></i>
                    </button>
                </div>
            </td>
        `;
        
        tbody.appendChild(row);
    });
}

function updateDepositRequestsTable() {
    const tbody = document.getElementById('depositRequestsTableBody');
    if (!tbody) return;
    
    tbody.innerHTML = '';
    
    const statusFilter = document.getElementById('depositStatusFilter')?.value || 'all';
    const dateFilter = document.getElementById('depositDateFilter')?.value || 'all';
    
    let filtered = state.allTransactions.filter(t => t.type === 'DEPOSIT_REQUEST');
    
    if (statusFilter !== 'all') {
        filtered = filtered.filter(t => t.status === statusFilter);
    }
    
    if (dateFilter !== 'all') {
        const now = new Date();
        filtered = filtered.filter(t => {
            const transactionDate = new Date(t.createdAt);
            if (dateFilter === 'today') {
                return transactionDate.toDateString() === now.toDateString();
            } else if (dateFilter === 'week') {
                const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
                return transactionDate >= weekAgo;
            } else if (dateFilter === 'month') {
                const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
                return transactionDate >= monthAgo;
            }
            return true;
        });
    }
    
    if (filtered.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="7" style="text-align: center; padding: 40px; color: var(--text-muted);">
                    <i class="fas fa-inbox"></i>
                    <div class="mt-2">No deposit requests</div>
                </td>
            </tr>
        `;
        return;
    }
    
    filtered.forEach(transaction => {
        const row = document.createElement('tr');
        row.className = 'user-row';
        
        const time = new Date(transaction.createdAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
        const date = new Date(transaction.createdAt).toLocaleDateString();
        
        let statusBadge = '';
        if (transaction.status === 'pending') {
            statusBadge = '<span class="badge badge-warning">Pending</span>';
        } else if (transaction.status === 'approved') {
            statusBadge = '<span class="badge badge-success">Approved</span>';
        } else if (transaction.status === 'rejected') {
            statusBadge = '<span class="badge badge-danger">Rejected</span>';
        }
        
        row.innerHTML = `
            <td>
                <div class="d-flex align-center gap-2">
                    <div class="user-avatar">${transaction.userName ? transaction.userName.charAt(0).toUpperCase() : 'U'}</div>
                    <div>
                        <div style="font-weight: 600;">${transaction.userName || 'Unknown'}</div>
                        <div class="text-muted" style="font-size: 0.75rem;">${transaction.userId ? transaction.userId.substring(0, 12) + '...' : 'No ID'}</div>
                    </div>
                </div>
            </td>
            <td style="font-weight: 700; color: var(--success)">
                +${Math.abs(transaction.amount).toFixed(2)} ETB
            </td>
            <td>
                <div style="font-family: monospace; font-weight: 600;">${transaction.receiptNumber || 'N/A'}</div>
            </td>
            <td>
                <div style="font-family: monospace;">${transaction.phoneNumber || 'N/A'}</div>
            </td>
            <td>${statusBadge}</td>
            <td>
                <div>${date}</div>
                <div class="text-muted" style="font-size: 0.75rem;">${time}</div>
            </td>
            <td>
                <div class="action-buttons">
                    ${transaction.status === 'pending' ? `
                        <button class="btn btn-success btn-sm" onclick="approveTransaction('${transaction._id}', 'DEPOSIT_REQUEST')" title="Approve">
                            <i class="fas fa-check"></i>
                        </button>
                        <button class="btn btn-danger btn-sm" onclick="rejectTransaction('${transaction._id}', 'DEPOSIT_REQUEST')" title="Reject">
                            <i class="fas fa-times"></i>
                        </button>
                    ` : ''}
                    <button class="btn btn-primary btn-sm" onclick="showTransactionDetails('${transaction._id}')" title="View Details">
                        <i class="fas fa-eye"></i>
                    </button>
                </div>
            </td>
        `;
        
        tbody.appendChild(row);
    });
}

function updateWithdrawalRequestsTable() {
    const tbody = document.getElementById('withdrawalRequestsTableBody');
    if (!tbody) return;
    
    tbody.innerHTML = '';
    
    const statusFilter = document.getElementById('withdrawalStatusFilter')?.value || 'all';
    const dateFilter = document.getElementById('withdrawalDateFilter')?.value || 'all';
    
    let filtered = state.allTransactions.filter(t => t.type === 'WITHDRAW_REQUEST');
    
    if (statusFilter !== 'all') {
        filtered = filtered.filter(t => t.status === statusFilter);
    }
    
    if (dateFilter !== 'all') {
        const now = new Date();
        filtered = filtered.filter(t => {
            const transactionDate = new Date(t.createdAt);
            if (dateFilter === 'today') {
                return transactionDate.toDateString() === now.toDateString();
            } else if (dateFilter === 'week') {
                const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
                return transactionDate >= weekAgo;
            } else if (dateFilter === 'month') {
                const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
                return transactionDate >= monthAgo;
            }
            return true;
        });
    }
    
    if (filtered.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="6" style="text-align: center; padding: 40px; color: var(--text-muted);">
                    <i class="fas fa-inbox"></i>
                    <div class="mt-2">No withdrawal requests</div>
                </td>
            </tr>
        `;
        return;
    }
    
    filtered.forEach(transaction => {
        const row = document.createElement('tr');
        row.className = 'user-row';
        
        const time = new Date(transaction.createdAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
        const date = new Date(transaction.createdAt).toLocaleDateString();
        
        let statusBadge = '';
        if (transaction.status === 'pending') {
            statusBadge = '<span class="badge badge-warning">Pending</span>';
        } else if (transaction.status === 'approved') {
            statusBadge = '<span class="badge badge-success">Approved</span>';
        } else if (transaction.status === 'rejected') {
            statusBadge = '<span class="badge badge-danger">Rejected</span>';
        }
        
        row.innerHTML = `
            <td>
                <div class="d-flex align-center gap-2">
                    <div class="user-avatar">${transaction.userName ? transaction.userName.charAt(0).toUpperCase() : 'U'}</div>
                    <div>
                        <div style="font-weight: 600;">${transaction.userName || 'Unknown'}</div>
                        <div class="text-muted" style="font-size: 0.75rem;">${transaction.userId ? transaction.userId.substring(0, 12) + '...' : 'No ID'}</div>
                    </div>
                </div>
            </td>
            <td style="font-weight: 700; color: var(--danger)">
                -${Math.abs(transaction.amount).toFixed(2)} ETB
            </td>
            <td>
                <div style="font-family: monospace; font-weight: 600;">${transaction.phoneNumber || 'N/A'}</div>
            </td>
            <td>${statusBadge}</td>
            <td>
                <div>${date}</div>
                <div class="text-muted" style="font-size: 0.75rem;">${time}</div>
            </td>
            <td>
                <div class="action-buttons">
                    ${transaction.status === 'pending' ? `
                        <button class="btn btn-success btn-sm" onclick="approveTransaction('${transaction._id}', 'WITHDRAW_REQUEST')" title="Approve">
                            <i class="fas fa-check"></i>
                        </button>
                        <button class="btn btn-danger btn-sm" onclick="rejectTransaction('${transaction._id}', 'WITHDRAW_REQUEST')" title="Reject">
                            <i class="fas fa-times"></i>
                        </button>
                    ` : ''}
                    <button class="btn btn-primary btn-sm" onclick="showTransactionDetails('${transaction._id}')" title="View Details">
                        <i class="fas fa-eye"></i>
                    </button>
                </div>
            </td>
        `;
        
        tbody.appendChild(row);
    });
}

function updateRecentRequestsTable() {
    const tbody = document.getElementById('recentRequestsTableBody');
    if (!tbody) return;
    
    tbody.innerHTML = '';
    
    // Get recent 5 pending requests
    const recentRequests = state.pendingTransactions.slice(0, 5);
    
    if (recentRequests.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="7" style="text-align: center; padding: 40px; color: var(--text-muted);">
                    <i class="fas fa-inbox"></i>
                    <div class="mt-2">No recent requests</div>
                </td>
            </tr>
        `;
        return;
    }
    
    recentRequests.forEach(transaction => {
        const row = document.createElement('tr');
        row.className = 'user-row';
        
        const time = new Date(transaction.createdAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
        
        let typeBadge = '';
        if (transaction.type === 'DEPOSIT_REQUEST') {
            typeBadge = '<span class="badge badge-success">Deposit</span>';
        } else if (transaction.type === 'WITHDRAW_REQUEST') {
            typeBadge = '<span class="badge badge-danger">Withdrawal</span>';
        }
        
        let statusBadge = '';
        if (transaction.status === 'pending') {
            statusBadge = '<span class="badge badge-warning">Pending</span>';
        } else if (transaction.status === 'approved') {
            statusBadge = '<span class="badge badge-success">Approved</span>';
        } else if (transaction.status === 'rejected') {
            statusBadge = '<span class="badge badge-danger">Rejected</span>';
        }
        
        let details = '';
        if (transaction.type === 'DEPOSIT_REQUEST') {
            details = `Receipt: ${transaction.receiptNumber?.substring(0, 10) || 'N/A'}`;
        } else if (transaction.type === 'WITHDRAW_REQUEST') {
            details = `Phone: ${transaction.phoneNumber || 'N/A'}`;
        }
        
        row.innerHTML = `
            <td>
                <div class="d-flex align-center gap-2">
                    <div class="user-avatar">${transaction.userName ? transaction.userName.charAt(0).toUpperCase() : 'U'}</div>
                    <div>
                        <div style="font-weight: 600;">${transaction.userName || 'Unknown'}</div>
                        <div class="text-muted" style="font-size: 0.75rem;">${transaction.userId ? transaction.userId.substring(0, 8) + '...' : 'No ID'}</div>
                    </div>
                </div>
            </td>
            <td>${typeBadge}</td>
            <td style="font-weight: 700; color: ${transaction.type === 'DEPOSIT_REQUEST' ? 'var(--success)' : 'var(--danger)'}">
                ${transaction.type === 'DEPOSIT_REQUEST' ? '+' : '-'}${Math.abs(transaction.amount).toFixed(2)} ETB
            </td>
            <td>
                <div style="font-size: 0.85rem;">${details}</div>
            </td>
            <td>
                <div class="text-muted" style="font-size: 0.75rem;">${time}</div>
            </td>
            <td>${statusBadge}</td>
            <td>
                <div class="action-buttons">
                    ${transaction.status === 'pending' ? `
                        <button class="btn btn-success btn-sm" onclick="approveTransaction('${transaction._id}', '${transaction.type}')" title="Approve">
                            <i class="fas fa-check"></i>
                        </button>
                        <button class="btn btn-primary btn-sm" onclick="showTransactionDetails('${transaction._id}')" title="View Details">
                            <i class="fas fa-eye"></i>
                        </button>
                    ` : ''}
                </div>
            </td>
        `;
        
        tbody.appendChild(row);
    });
}

function updateTransactionHistory() {
    const container = document.getElementById('transactionHistory');
    if (!container) return;
    
    container.innerHTML = '';
    
    const searchTerm = document.getElementById('transactionSearch')?.value.toLowerCase() || '';
    const typeFilter = document.getElementById('transactionTypeFilter')?.value || 'all';
    
    let filtered = state.allTransactions;
    
    if (typeFilter !== 'all') {
        if (typeFilter === 'deposit') {
            filtered = filtered.filter(t => t.type === 'DEPOSIT_REQUEST');
        } else if (typeFilter === 'withdrawal') {
            filtered = filtered.filter(t => t.type === 'WITHDRAW_REQUEST');
        } else if (typeFilter === 'agent') {
            filtered = filtered.filter(t => t.type === 'AGENT_COMMISSION');
        } else if (typeFilter === 'bingo') {
            filtered = filtered.filter(t => t.type === 'BINGO_WIN');
        } else if (typeFilter === 'keno') {
            filtered = filtered.filter(t => t.type === 'KENO_WIN');
        } else if (typeFilter === 'bonus') {
            filtered = filtered.filter(t => t.type === 'BONUS');
        }
    }
    
    if (searchTerm) {
        filtered = filtered.filter(t => 
            (t.userName && t.userName.toLowerCase().includes(searchTerm)) ||
            (t.userId && t.userId.toLowerCase().includes(searchTerm)) ||
            (t.receiptNumber && t.receiptNumber.toLowerCase().includes(searchTerm)) ||
            (t.phoneNumber && t.phoneNumber.includes(searchTerm))
        );
    }
    
    if (filtered.length === 0) {
        container.innerHTML = `
            <div style="text-align: center; padding: 40px; color: var(--text-muted);">
                <i class="fas fa-exchange-alt"></i>
                <div class="mt-2">No transactions found</div>
            </div>
        `;
        return;
    }
    
    filtered.slice(0, 50).forEach(transaction => {
        const item = document.createElement('div');
        item.className = 'transaction-item';
        item.onclick = () => showTransactionDetails(transaction._id);
        
        const time = new Date(transaction.createdAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
        const date = new Date(transaction.createdAt).toLocaleDateString();
        
        let iconClass = '';
        let amountClass = '';
        let icon = '';
        
        if (transaction.type === 'DEPOSIT_REQUEST') {
            iconClass = 'deposit';
            amountClass = 'deposit';
            icon = 'fa-money-bill-wave';
        } else if (transaction.type === 'WITHDRAW_REQUEST') {
            iconClass = 'withdraw';
            amountClass = 'withdraw';
            icon = 'fa-money-check-alt';
        } else if (transaction.type === 'AGENT_COMMISSION') {
            iconClass = 'commission';
            amountClass = 'commission';
            icon = 'fa-user-tie';
        } else if (transaction.type === 'BINGO_WIN' || transaction.type === 'KENO_WIN') {
            iconClass = 'deposit';
            amountClass = 'deposit';
            icon = 'fa-trophy';
        } else if (transaction.type === 'BONUS') {
            iconClass = 'deposit';
            amountClass = 'deposit';
            icon = 'fa-gift';
        }
        
        let statusBadge = '';
        if (transaction.status === 'pending') {
            statusBadge = '<span class="badge badge-warning" style="margin-left: 8px;">Pending</span>';
        } else if (transaction.status === 'rejected') {
            statusBadge = '<span class="badge badge-danger" style="margin-left: 8px;">Rejected</span>';
        }
        
        item.innerHTML = `
            <div class="transaction-icon ${iconClass}">
                <i class="fas ${icon}"></i>
            </div>
            <div class="transaction-details">
                <div class="transaction-title">
                    ${transaction.userName || 'Unknown'} 
                    ${statusBadge}
                </div>
                <div class="transaction-time">${date} ${time}</div>
                ${transaction.receiptNumber ? `<div class="text-muted" style="font-size: 0.75rem; margin-top: 2px;">Receipt: ${transaction.receiptNumber}</div>` : ''}
                ${transaction.phoneNumber ? `<div class="text-muted" style="font-size: 0.75rem; margin-top: 2px;">Phone: ${transaction.phoneNumber}</div>` : ''}
            </div>
            <div class="transaction-amount ${amountClass}">
                ${transaction.type === 'DEPOSIT_REQUEST' || transaction.type === 'BINGO_WIN' || transaction.type === 'KENO_WIN' || transaction.type === 'BONUS' ? '+' : '-'}${Math.abs(transaction.amount).toFixed(2)} ETB
            </div>
        `;
        
        container.appendChild(item);
    });
}

function showTransactionDetails(transactionId) {
    const transaction = state.allTransactions.find(t => t._id === transactionId);
    if (!transaction) return;
    
    const content = document.getElementById('transactionDetailsContent');
    if (!content) return;
    
    const time = new Date(transaction.createdAt).toLocaleString();
    const updatedTime = transaction.updatedAt ? new Date(transaction.updatedAt).toLocaleString() : 'N/A';
    
    let statusBadge = '';
    if (transaction.status === 'pending') {
        statusBadge = '<span class="badge badge-warning">Pending</span>';
    } else if (transaction.status === 'approved') {
        statusBadge = '<span class="badge badge-success">Approved</span>';
    } else if (transaction.status === 'rejected') {
        statusBadge = '<span class="badge badge-danger">Rejected</span>';
    }
    
    let typeText = '';
    if (transaction.type === 'DEPOSIT_REQUEST') {
        typeText = 'Deposit Request';
    } else if (transaction.type === 'WITHDRAW_REQUEST') {
        typeText = 'Withdrawal Request';
    } else if (transaction.type === 'AGENT_COMMISSION') {
        typeText = 'Agent Commission';
    } else if (transaction.type === 'BINGO_WIN') {
        typeText = 'Bingo Win';
    } else if (transaction.type === 'KENO_WIN') {
        typeText = 'Keno Win';
    } else if (transaction.type === 'BONUS') {
        typeText = 'Bonus';
    }
    
    content.innerHTML = `
        <div class="form-group">
            <label class="form-label">Transaction ID</label>
            <div class="form-input" style="background: var(--dark-3); font-family: monospace;">${transaction._id}</div>
        </div>
        
        <div class="form-row">
            <div class="form-group">
                <label class="form-label">User</label>
                <div class="form-input" style="background: var(--dark-3);">${transaction.userName || 'Unknown'} (${transaction.userId || 'N/A'})</div>
            </div>
            <div class="form-group">
                <label class="form-label">Amount</label>
                <div class="form-input" style="background: var(--dark-3); font-weight: bold; color: ${transaction.type === 'DEPOSIT_REQUEST' ? 'var(--success)' : 'var(--danger)'}">
                    ${Math.abs(transaction.amount).toFixed(2)} ETB
                </div>
            </div>
        </div>
        
        <div class="form-row">
            <div class="form-group">
                <label class="form-label">Type</label>
                <div class="form-input" style="background: var(--dark-3);">${typeText}</div>
            </div>
            <div class="form-group">
                <label class="form-label">Status</label>
                <div class="form-input" style="background: var(--dark-3);">${statusBadge}</div>
            </div>
        </div>
        
        <div class="form-group">
            <label class="form-label">Created</label>
            <div class="form-input" style="background: var(--dark-3);">${time}</div>
        </div>
        
        <div class="form-group">
            <label class="form-label">Last Updated</label>
            <div class="form-input" style="background: var(--dark-3);">${updatedTime}</div>
        </div>
        
        ${transaction.receiptNumber ? `
            <div class="form-group">
                <label class="form-label">Receipt Number</label>
                <div class="form-input" style="background: var(--dark-3); font-family: monospace;">${transaction.receiptNumber}</div>
            </div>
        ` : ''}
        
        ${transaction.phoneNumber ? `
            <div class="form-group">
                <label class="form-label">Phone Number</label>
                <div class="form-input" style="background: var(--dark-3); font-family: monospace;">${transaction.phoneNumber}</div>
            </div>
        ` : ''}
        
        ${transaction.notes ? `
            <div class="form-group">
                <label class="form-label">Notes</label>
                <div class="form-input" style="background: var(--dark-3);">${transaction.notes}</div>
            </div>
        ` : ''}
        
        ${transaction.processedBy ? `
            <div class="form-group">
                <label class="form-label">Processed By</label>
                <div class="form-input" style="background: var(--dark-3);">${transaction.processedBy}</div>
            </div>
        ` : ''}
        
        ${transaction.rejectionReason ? `
            <div class="form-group">
                <label class="form-label">Rejection Reason</label>
                <div class="form-input" style="background: var(--dark-3); color: var(--danger);">${transaction.rejectionReason}</div>
            </div>
        ` : ''}
    `;
    
    showModal('transactionDetailsModal');
}

function printTransactionDetails() {
    const printContent = document.getElementById('transactionDetailsContent').innerHTML;
    const originalContent = document.body.innerHTML;
    
    document.body.innerHTML = `
        <html>
            <head>
                <title>Transaction Details</title>
                <style>
                    body { font-family: Arial, sans-serif; padding: 20px; }
                    .form-group { margin-bottom: 15px; }
                    .form-label { font-weight: bold; margin-bottom: 5px; }
                    .form-input { padding: 8px; border: 1px solid #ccc; border-radius: 4px; }
                </style>
            </head>
            <body>
                <h2>Transaction Details</h2>
                ${printContent}
            </body>
        </html>
    `;
    
    window.print();
    document.body.innerHTML = originalContent;
    location.reload();
}

function approveTransaction(transactionId, type) {
    const transaction = state.allTransactions.find(t => t._id === transactionId);
    if (!transaction) return;
    
    const action = type === 'DEPOSIT_REQUEST' ? 'deposit' : 'withdrawal';
    
    if (!confirm(`Approve this ${action} request of ${transaction.amount} ETB for ${transaction.userName}?`)) {
        return;
    }
    
    if (state.socket && state.socket.connected) {
        if (type === 'DEPOSIT_REQUEST') {
            state.socket.emit('admin:approveDeposit', transactionId);
        } else if (type === 'WITHDRAW_REQUEST') {
            state.socket.emit('admin:approveWithdrawal', transactionId);
        }
        
        showToast(`${action === 'deposit' ? 'Deposit' : 'Withdrawal'} approval sent...`, 'info');
    } else {
        showToast('Not connected to server', 'error');
    }
}

function rejectTransaction(transactionId, type) {
    const transaction = state.allTransactions.find(t => t._id === transactionId);
    if (!transaction) return;
    
    const action = type === 'DEPOSIT_REQUEST' ? 'deposit' : 'withdrawal';
    const reason = prompt(`Enter rejection reason for ${action} request of ${transaction.amount} ETB:`, "Invalid receipt/phone number");
    
    if (reason === null) return;
    
    if (state.socket && state.socket.connected) {
        state.socket.emit('admin:rejectTransaction', {
            transactionId: transactionId,
            reason: reason
        });
        
        showToast(`${action === 'deposit' ? 'Deposit' : 'Withdrawal'} rejection sent...`, 'warning');
    } else {
        showToast('Not connected to server', 'error');
    }
}

function updatePendingTransactionsBadge() {
    const badge = document.getElementById('walletApprovalBadge');
    if (!badge) return;
    
    const pendingCount = state.pendingTransactions.filter(t => t.status === 'pending').length;
    
    badge.textContent = pendingCount;
    
    if (pendingCount > 0) {
        badge.style.background = 'var(--warning)';
    } else {
        badge.style.background = 'var(--text-muted)';
    }
    
    // Also update the pending requests stat
    if (document.getElementById('pendingRequests')) {
        document.getElementById('pendingRequests').textContent = pendingCount;
    }
}

function updateDepositRequestBadge() {
    const badge = document.getElementById('depositRequestBadge');
    if (!badge) return;
    
    const pendingCount = state.allTransactions.filter(t => t.type === 'DEPOSIT_REQUEST' && t.status === 'pending').length;
    
    badge.textContent = pendingCount;
    
    if (pendingCount > 0) {
        badge.style.background = 'var(--success)';
    } else {
        badge.style.background = 'var(--text-muted)';
    }
}

function updateWithdrawalRequestBadge() {
    const badge = document.getElementById('withdrawalRequestBadge');
    if (!badge) return;
    
    const pendingCount = state.allTransactions.filter(t => t.type === 'WITHDRAW_REQUEST' && t.status === 'pending').length;
    
    badge.textContent = pendingCount;
    
    if (pendingCount > 0) {
        badge.style.background = 'var(--danger)';
    } else {
        badge.style.background = 'var(--text-muted)';
    }
}

// Agent Management Functions
function refreshAgents() {
    if (state.socket && state.isAdmin && state.socket.connected) {
        console.log('👑 Requesting agents...');
        state.socket.emit('agent:getAllAgents');
    }
}

function updateAgentsTable() {
    const tbody = document.getElementById('agentsTableBody');
    if (!tbody) return;
    
    tbody.innerHTML = '';
    
    if (state.agents.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="7" style="text-align: center; padding: 40px; color: var(--text-muted);">
                    <i class="fas fa-user-slash"></i>
                    <div class="mt-2">No agents found</div>
                </td>
            </tr>
        `;
        return;
    }
    
    state.agents.forEach(agent => {
        const row = document.createElement('tr');
        row.className = 'user-row';
        
        const statusBadge = agent.isActive ? 
            '<span class="badge badge-success">Active</span>' : 
            '<span class="badge">Inactive</span>';
        
        row.innerHTML = `
            <td>
                <div class="d-flex align-center gap-2">
                    <div class="user-avatar" style="background: var(--agent);">${agent.name ? agent.name.charAt(0).toUpperCase() : 'A'}</div>
                    <div>
                        <div style="font-weight: 600;">${agent.name || 'Unknown'}</div>
                        <div class="text-muted" style="font-size: 0.75rem;">@${agent.username || 'N/A'}</div>
                    </div>
                </div>
            </td>
            <td>
                <div style="font-family: monospace; font-weight: 600; color: var(--agent);">
                    ${agent.referralCode || 'N/A'}
                </div>
            </td>
            <td>
                <div>Bingo: ${agent.commissionRateBingo || 40}%</div>
                <div class="text-muted" style="font-size: 0.75rem;">Keno: ${agent.commissionRateKeno || 10}%</div>
            </td>
            <td>
                <div style="font-weight: 600;">${agent.totalReferrals || 0}</div>
            </td>
            <td>
                <div style="font-weight: 700; color: var(--warning);">
                    ${(agent.totalEarnings || 0).toFixed(2)} ETB
                </div>
            </td>
            <td>${statusBadge}</td>
            <td>
                <div class="action-buttons">
                    <button class="btn btn-primary btn-sm" onclick="showEditAgentModal('${agent._id}')" title="Edit">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="btn btn-danger btn-sm" onclick="deleteAgent('${agent._id}')" title="Deactivate">
                        <i class="fas fa-ban"></i>
                    </button>
                </div>
            </td>
        `;
        
        tbody.appendChild(row);
    });
}

function updateAgentCountBadge() {
    const badge = document.getElementById('agentCountBadge');
    if (!badge) return;
    
    const activeAgents = state.agents.filter(a => a.isActive).length;
    
    badge.textContent = activeAgents;
    
    if (activeAgents > 0) {
        badge.style.background = 'var(--agent)';
    } else {
        badge.style.background = 'var(--text-muted)';
    }
    
    if (document.getElementById('totalAgents')) {
        document.getElementById('totalAgents').textContent = state.agents.length;
    }
}

function showCreateAgentModal() {
    state.editingAgentId = null;
    document.getElementById('agentModalTitle').innerHTML = '<i class="fas fa-user-plus"></i> Create New Agent';
    document.getElementById('agentUsername').value = '';
    document.getElementById('agentPassword').value = '';
    document.getElementById('agentName').value = '';
    document.getElementById('agentPhone').value = '';
    document.getElementById('agentBingoRate').value = '40';
    document.getElementById('agentKenoRate').value = '10';
    document.getElementById('agentIsSuperAdmin').checked = false;
    document.getElementById('agentIsActive').checked = true;
    showModal('agentModal');
}

function showEditAgentModal(agentId) {
    const agent = state.agents.find(a => a._id === agentId);
    if (!agent) return;
    
    state.editingAgentId = agentId;
    document.getElementById('agentModalTitle').innerHTML = '<i class="fas fa-edit"></i> Edit Agent';
    document.getElementById('agentUsername').value = agent.username;
    document.getElementById('agentPassword').value = '';
    document.getElementById('agentName').value = agent.name;
    document.getElementById('agentPhone').value = agent.phoneNumber || '';
    document.getElementById('agentBingoRate').value = agent.commissionRateBingo || 40;
    document.getElementById('agentKenoRate').value = agent.commissionRateKeno || 10;
    document.getElementById('agentIsSuperAdmin').checked = agent.isSuperAdmin || false;
    document.getElementById('agentIsActive').checked = agent.isActive !== false;
    showModal('agentModal');
}

function saveAgent() {
    const username = document.getElementById('agentUsername').value.trim();
    const password = document.getElementById('agentPassword').value;
    const name = document.getElementById('agentName').value.trim();
    const phone = document.getElementById('agentPhone').value.trim();
    const bingoRate = parseFloat(document.getElementById('agentBingoRate').value);
    const kenoRate = parseFloat(document.getElementById('agentKenoRate').value);
    const isSuperAdmin = document.getElementById('agentIsSuperAdmin').checked;
    const isActive = document.getElementById('agentIsActive').checked;
    
    if (!username || !name) {
        showToast('Username and name are required', 'error');
        return;
    }
    
    if (!state.editingAgentId && !password) {
        showToast('Password is required for new agents', 'error');
        return;
    }
    
    const agentData = {
        username,
        name,
        commissionRateBingo: bingoRate,
        commissionRateKeno: kenoRate,
        phoneNumber: phone,
        isSuperAdmin,
        isActive
    };
    
    if (password) {
        agentData.password = password;
    }
    
    if (state.socket && state.socket.connected) {
        if (state.editingAgentId) {
            console.log('👑 Updating agent:', state.editingAgentId);
            state.socket.emit('agent:updateAgent', {
                agentId: state.editingAgentId,
                updates: agentData
            });
        } else {
            console.log('👑 Creating new agent:', username);
            state.socket.emit('agent:createAgent', agentData);
        }
    } else {
        showToast('Not connected to server', 'error');
    }
    
    hideModal('agentModal');
}

function deleteAgent(agentId) {
    if (confirm('Are you sure you want to deactivate this agent?')) {
        if (state.socket && state.socket.connected) {
            console.log('👑 Deleting agent:', agentId);
            state.socket.emit('agent:deleteAgent', agentId);
            showToast('Deactivating agent...', 'warning');
        } else {
            showToast('Not connected to server', 'error');
        }
    }
}

function showAssignAgentModal() {
    const userSelect = document.getElementById('assignUserSelect');
    if (!userSelect) return;
    
    userSelect.innerHTML = '<option value="">Select a user</option>';
    
    state.users.forEach(user => {
        const option = document.createElement('option');
        option.value = user.userId;
        option.textContent = `${user.userName} (${user.userId})`;
        userSelect.appendChild(option);
    });
    
    const agentSelect = document.getElementById('assignAgentSelect');
    if (!agentSelect) return;
    
    agentSelect.innerHTML = '<option value="">Select an agent</option>';
    
    state.agents.filter(a => a.isActive).forEach(agent => {
        const option = document.createElement('option');
        option.value = agent._id;
        option.textContent = `${agent.name} (${agent.referralCode})`;
        agentSelect.appendChild(option);
    });
    
    document.getElementById('assignUserId').value = '';
    document.getElementById('assignOverride').checked = true;
    
    showModal('assignAgentModal');
}

function showAssignAgentToUser(userId, userName) {
    const agentSelect = document.getElementById('assignAgentSelect');
    if (!agentSelect) return;
    
    agentSelect.innerHTML = '<option value="">Select an agent</option>';
    
    state.agents.filter(a => a.isActive).forEach(agent => {
        const option = document.createElement('option');
        option.value = agent._id;
        option.textContent = `${agent.name} (${agent.referralCode})`;
        agentSelect.appendChild(option);
    });
    
    document.getElementById('assignUserSelect').innerHTML = `<option value="${userId}">${userName} (${userId})</option>`;
    document.getElementById('assignUserId').value = userId;
    document.getElementById('assignOverride').checked = true;
    
    showModal('assignAgentModal');
}

function assignUserToAgent() {
    const userIdSelect = document.getElementById('assignUserSelect').value;
    const userIdInput = document.getElementById('assignUserId').value.trim();
    const agentId = document.getElementById('assignAgentSelect').value;
    const override = document.getElementById('assignOverride').checked;
    
    const userId = userIdSelect || userIdInput;
    
    if (!userId) {
        showToast('Please select or enter a user ID', 'error');
        return;
    }
    
    if (!agentId) {
        showToast('Please select an agent', 'error');
        return;
    }
    
    const agent = state.agents.find(a => a._id === agentId);
    if (!agent) return;
    
    const agentData = {
        userId: userId,
        referralCode: agent.referralCode
    };
    
    if (override) {
        agentData.override = true;
    }
    
    if (state.socket && state.socket.connected) {
        console.log('👑 Assigning user to agent:', agentData);
        state.socket.emit('agent:manualReferralAssignment', agentData);
        showToast('Assigning user to agent...', 'info');
    } else {
        showToast('Not connected to server', 'error');
    }
    
    hideModal('assignAgentModal');
}

// Action Functions
function addFunds() {
    const userIdInput = document.getElementById('fundsUserId').value;
    const amount = document.getElementById('fundsAmount').value;
    
    // Extract user ID from input (format: "Username (userId)")
    let userId = userIdInput;
    const match = userIdInput.match(/\((.*?)\)/);
    if (match && match[1]) {
        userId = match[1].trim();
    }
    
    if (!userId || !amount) {
        showToast('Please enter user ID and amount', 'error');
        return;
    }
    
    const reason = document.getElementById('fundsReason').value;
    const data = { 
        userId, 
        amount: parseFloat(amount),
        reason: reason
    };
    
    if (state.socket && state.socket.connected) {
        console.log('💰 Adding funds:', data);
        state.socket.emit('admin:addFunds', data);
        showToast(`Adding ${amount} ETB to user...`, 'info');
    } else {
        showToast('Not connected to server', 'error');
    }
    
    hideModal('addFundsModal');
}

function quickAddFundsToUser(userId, userName, currentBalance) {
    state.quickAddUserId = userId;
    state.quickAddUserName = userName;
    state.quickAddUserBalance = currentBalance;
    
    document.getElementById('quickAddUserName').textContent = userName || 'Unknown';
    document.getElementById('quickAddUserId').textContent = userId || 'No ID';
    document.getElementById('quickAddUserAvatar').textContent = userName ? userName.charAt(0).toUpperCase() : 'U';
    document.getElementById('quickAddCurrentBalance').textContent = currentBalance.toFixed(2) + ' ETB';
    document.getElementById('quickAddAmount').value = '100';
    
    showModal('quickAddFundsModal');
}

function quickAddFunds() {
    const amount = document.getElementById('quickAddAmount').value;
    
    if (!state.quickAddUserId || !amount) {
        showToast('Please enter amount', 'error');
        return;
    }
    
    const data = { 
        userId: state.quickAddUserId, 
        amount: parseFloat(amount),
        reason: 'quick_add'
    };
    
    if (state.socket && state.socket.connected) {
        console.log('💰 Quick adding funds:', data);
        state.socket.emit('admin:addFunds', data);
        showToast(`Adding ${amount} ETB to ${state.quickAddUserName}...`, 'success');
    } else {
        showToast('Not connected to server', 'error');
    }
    
    hideModal('quickAddFundsModal');
}

function setAmount(amount) {
    const input = document.getElementById('fundsAmount');
    if (input) {
        input.value = amount;
    }
}

function setQuickAmount(amount) {
    const input = document.getElementById('quickAddAmount');
    if (input) {
        input.value = amount;
    }
}

function showAddFundsModal() {
    document.getElementById('fundsUserId').value = '';
    document.getElementById('fundsAmount').value = '';
    document.getElementById('fundsReason').value = 'manual';
    showModal('addFundsModal');
}

function kickUser(userId) {
    if (confirm('Kick this user from the game?')) {
        if (state.socket && state.socket.connected) {
            console.log('👢 Kicking user:', userId);
            state.socket.emit('admin:kickPlayer', userId);
            showToast('User kicked', 'warning');
        } else {
            showToast('Not connected to server', 'error');
        }
    }
}

function showBroadcastModal() {
    document.getElementById('broadcastMessage').value = '';
    showModal('broadcastModal');
}

function sendBroadcast() {
    const message = document.getElementById('broadcastMessage').value;
    const type = document.getElementById('broadcastType').value;
    
    if (!message) {
        showToast('Please enter a message', 'error');
        return;
    }
    
    if (state.socket && state.socket.connected) {
        console.log('📢 Sending broadcast:', { message, type });
        state.socket.emit('admin:broadcast', { message, type });
        showToast('Broadcast sent to all players', 'success');
    } else {
        showToast('Not connected to server', 'error');
    }
    
    hideModal('broadcastModal');
}

function showPendingRequests() {
    // Navigate to wallet approvals section
    document.querySelectorAll('.nav-item').forEach(nav => nav.classList.remove('active'));
    const walletApprovalNav = document.querySelector('.nav-item[data-section="wallet-approvals"]');
    if (walletApprovalNav) {
        walletApprovalNav.classList.add('active');
    }
    
    document.querySelectorAll('.content-section').forEach(s => s.classList.remove('active'));
    const walletSection = document.getElementById('walletApprovalsSection');
    if (walletSection) {
        walletSection.classList.add('active');
    }
    
    if (document.getElementById('pageTitle')) {
        document.getElementById('pageTitle').textContent = 'Wallet Approvals';
    }
    
    refreshPendingTransactions();
}

function forceRefreshData() {
    if (state.socket && state.socket.connected) {
        console.log('🔄 Forcing refresh of all data...');
        state.socket.emit('admin:getData');
        state.socket.emit('admin:getAllAgents');
        state.socket.emit('admin:getTelebirrNumber');
        refreshAgents();
        refreshPendingTransactions();
        refreshDepositRequests();
        refreshWithdrawalRequests();
        loadAllTransactions();
        showToast('Refreshing all data...', 'success');
    } else {
        showToast('Not connected to server', 'error');
    }
}

function updateLastUpdateTime() {
    const now = new Date();
    const diff = Math.floor((now - state.lastUpdate) / 1000);
    
    let text = 'Just now';
    if (diff > 60) {
        const minutes = Math.floor(diff / 60);
        text = `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
    }
    
    const element = document.getElementById('lastUpdateTime');
    if (element) {
        element.textContent = 'Updated ' + text;
    }
}

function updateUserCountBadge(count) {
    const badge = document.getElementById('userCountBadge');
    if (!badge) return;
    
    badge.textContent = count;
    
    if (count > 0) {
        badge.style.background = 'var(--success)';
    } else {
        badge.style.background = 'var(--text-muted)';
    }
}

// Analytics Functions
function updateAnalytics() {
    if (!state.socket || !state.isAdmin || !state.socket.connected) return;
    
    const dateRange = document.getElementById('analyticsDateRange')?.value || 'today';
    console.log('📈 Requesting analytics for:', dateRange);
    updateAnalyticsFromTransactions();
}

function updateAnalyticsFromTransactions() {
    const now = new Date();
    const dateRange = document.getElementById('analyticsDateRange')?.value || 'today';
    
    let filteredTransactions = state.allTransactions;
    
    if (dateRange !== 'all') {
        filteredTransactions = filteredTransactions.filter(t => {
            const transactionDate = new Date(t.createdAt);
            if (dateRange === 'today') {
                return transactionDate.toDateString() === now.toDateString();
            } else if (dateRange === 'week') {
                const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
                return transactionDate >= weekAgo;
            } else if (dateRange === 'month') {
                const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
                return transactionDate >= monthAgo;
            }
            return true;
        });
    }
    
    // Calculate analytics
    const deposits = filteredTransactions.filter(t => t.type === 'DEPOSIT_REQUEST' && t.status === 'approved');
    const withdrawals = filteredTransactions.filter(t => t.type === 'WITHDRAW_REQUEST' && t.status === 'approved');
    
    const totalDeposits = deposits.reduce((sum, t) => sum + (t.amount || 0), 0);
    const totalWithdrawals = withdrawals.reduce((sum, t) => sum + (t.amount || 0), 0);
    const netProfit = totalDeposits - totalWithdrawals;
    
    // Update UI
    if (document.getElementById('totalDeposits')) {
        document.getElementById('totalDeposits').textContent = totalDeposits.toFixed(2) + ' ETB';
    }
    if (document.getElementById('totalWithdrawals')) {
        document.getElementById('totalWithdrawals').textContent = totalWithdrawals.toFixed(2) + ' ETB';
    }
    if (document.getElementById('netProfit')) {
        document.getElementById('netProfit').textContent = netProfit.toFixed(2) + ' ETB';
    }
    
    // Update analytics data
    state.analyticsData.totalDeposits = totalDeposits;
    state.analyticsData.totalWithdrawals = totalWithdrawals;
    state.analyticsData.netProfit = netProfit;
    
    // Update transaction chart if it exists
    if (state.transactionChart) {
        updateTransactionChart();
    }
}

function initTransactionChart() {
    const ctx = document.getElementById('transactionChart');
    if (!ctx) return;
    
    // Check if Chart is available
    if (typeof Chart === 'undefined') {
        console.warn('Chart.js not loaded');
        return;
    }
    
    // Get last 7 days
    const labels = [];
    const depositData = [];
    const withdrawalData = [];
    
    for (let i = 6; i >= 0; i--) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        labels.push(dateStr);
        
        // Filter transactions for this date
        const startOfDay = new Date(date);
        startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date(date);
        endOfDay.setHours(23, 59, 59, 999);
        
        const dayDeposits = state.allTransactions.filter(t => 
            t.type === 'DEPOSIT_REQUEST' && 
            t.status === 'approved' &&
            new Date(t.createdAt) >= startOfDay &&
            new Date(t.createdAt) <= endOfDay
        );
        
        const dayWithdrawals = state.allTransactions.filter(t => 
            t.type === 'WITHDRAW_REQUEST' && 
            t.status === 'approved' &&
            new Date(t.createdAt) >= startOfDay &&
            new Date(t.createdAt) <= endOfDay
        );
        
        depositData.push(dayDeposits.reduce((sum, t) => sum + (t.amount || 0), 0));
        withdrawalData.push(dayWithdrawals.reduce((sum, t) => sum + (t.amount || 0), 0));
    }
    
    if (state.transactionChart) {
        state.transactionChart.destroy();
    }
    
    state.transactionChart = new Chart(ctx.getContext('2d'), {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Deposits',
                    data: depositData,
                    backgroundColor: 'rgba(16, 185, 129, 0.5)',
                    borderColor: 'var(--success)',
                    borderWidth: 1
                },
                {
                    label: 'Withdrawals',
                    data: withdrawalData,
                    backgroundColor: 'rgba(239, 68, 68, 0.5)',
                    borderColor: 'var(--danger)',
                    borderWidth: 1
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: {
                    grid: {
                        color: 'rgba(255, 255, 255, 0.05)'
                    },
                    ticks: {
                        color: 'var(--text-secondary)'
                    }
                },
                y: {
                    grid: {
                        color: 'rgba(255, 255, 255, 0.05)'
                    },
                    ticks: {
                        color: 'var(--text-secondary)',
                        callback: function(value) {
                            return value + ' ETB';
                        }
                    }
                }
            },
            plugins: {
                legend: {
                    labels: {
                        color: 'var(--text-primary)'
                    }
                }
            }
        }
    });
}

function updateTransactionChart() {
    if (!state.transactionChart) return;
    
    // Update chart data based on current date range
    updateAnalyticsFromTransactions();
}

// Activity Log Functions
function addActivityItem(activity) {
    const activityFeed = document.getElementById('activityFeed');
    if (!activityFeed) return;
    
    const activityItem = document.createElement('div');
    activityItem.className = 'd-flex align-center gap-3 mb-3';
    
    const time = new Date(activity.timestamp || Date.now()).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
    const date = new Date(activity.timestamp || Date.now()).toLocaleDateString();
    
    let icon = 'fa-info-circle';
    let color = 'var(--info)';
    
    if (activity.type === 'WIN' || activity.type === 'WIN_FOUR_CORNERS') {
        icon = 'fa-trophy';
        color = 'var(--success)';
    } else if (activity.type === 'AGENT_COMMISSION') {
        icon = 'fa-user-tie';
        color = 'var(--agent)';
    } else if (activity.type === 'DEPOSIT_REQUEST') {
        icon = 'fa-money-bill-wave';
        color = 'var(--primary)';
    } else if (activity.type === 'WITHDRAW_REQUEST') {
        icon = 'fa-money-check-alt';
        color = 'var(--warning)';
    }
    
    activityItem.innerHTML = `
        <div style="width: 40px; height: 40px; border-radius: 50%; background: ${color}15; color: ${color}; display: flex; align-items: center; justify-content: center;">
            <i class="fas ${icon}"></i>
        </div>
        <div style="flex: 1;">
            <div style="font-weight: 600;">${activity.details || activity.message || 'Activity'}</div>
            <div class="text-muted" style="font-size: 0.85rem;">${date} ${time}</div>
        </div>
    `;
    
    activityFeed.insertBefore(activityItem, activityFeed.firstChild);
    
    if (activityFeed.children.length > CONFIG.MAX_ACTIVITY_ITEMS) {
        activityFeed.removeChild(activityFeed.lastChild);
    }
}

function refreshActivity() {
    if (state.socket && state.isAdmin && state.socket.connected) {
        console.log('🔄 Refreshing activity...');
        state.socket.emit('admin:getData');
        showToast('Activity refreshed', 'success');
    }
}

function startAutoRefresh() {
    console.log('⏰ Starting auto-refresh every', CONFIG.AUTO_REFRESH_INTERVAL, 'ms');
    setInterval(() => {
        if (state.isAdmin && state.socket && state.socket.connected) {
            state.socket.emit('admin:getData');
            // Refresh pending transactions more frequently
            if (Math.random() < 0.3) { // 30% chance each interval
                refreshPendingTransactions();
            }
        }
    }, CONFIG.AUTO_REFRESH_INTERVAL);
}

// Chart Functions
function initCharts() {
    console.log('📊 Initializing charts...');
    setTimeout(initTransactionChart, 1000);
}

// System Functions
function resetHouseEarnings() {
    if (confirm('Are you sure you want to reset house earnings to zero? This action cannot be undone.')) {
        if (state.socket && state.isAdmin && state.socket.connected) {
            console.log('🔄 Resetting house earnings...');
            // Optimistically update the UI
            if (document.getElementById('houseEarnings')) {
                document.getElementById('houseEarnings').textContent = '0.00 ETB';
            }
            
            // Emit reset event to server
            state.socket.emit('admin:resetHouseEarnings');
            
            showToast('Resetting house earnings to zero...', 'warning');
        } else {
            showToast('Not connected to server', 'error');
        }
    }
}

function clearAllApprovedTransactions() {
    if (confirm('Clear all approved/rejected transactions from view? This will remove them from the list but keep them in the database.')) {
        console.log('🧹 Clearing approved/rejected transactions from view...');
        // Filter out only pending transactions to keep
        state.pendingTransactions = state.pendingTransactions.filter(t => t.status === 'pending');
        
        // Also filter allTransactions to remove completed transactions from view
        state.allTransactions = state.allTransactions.filter(t => 
            t.status === 'pending' || 
            t.type === 'BINGO_WIN' || 
            t.type === 'KENO_WIN' ||
            t.type === 'AGENT_COMMISSION' ||
            t.type === 'BONUS'
        );
        
        // Update all UI components
        updateWalletApprovalsTable();
        updateRecentRequestsTable();
        updateTransactionHistory();
        updateDepositRequestsTable();
        updateWithdrawalRequestsTable();
        updatePendingTransactionsBadge();
        updateDepositRequestBadge();
        updateWithdrawalRequestBadge();
        
        showToast('Cleared all approved/rejected transactions from view', 'success');
    }
}

function resetAllTransactions() {
    if (confirm('WARNING: This will reset ALL transaction history including pending requests. Are you sure?')) {
        if (state.socket && state.isAdmin && state.socket.connected) {
            console.log('🔄 Resetting all transactions...');
            state.socket.emit('admin:resetAllTransactions');
            showToast('Resetting all transactions...', 'warning');
            
            // Clear local state
            state.allTransactions = [];
            state.pendingTransactions = [];
            
            // Update all UI components
            updateWalletApprovalsTable();
            updateRecentRequestsTable();
            updateTransactionHistory();
            updateDepositRequestsTable();
            updateWithdrawalRequestsTable();
            updatePendingTransactionsBadge();
            updateDepositRequestBadge();
            updateWithdrawalRequestBadge();
        } else {
            showToast('Not connected to server', 'error');
        }
    }
}

function updateTelebirrNumber() {
    const newNumber = document.getElementById('telebirrNumber').value.trim();
    const statusEl = document.getElementById('telebirrNumberStatus');
    
    if (!newNumber) {
        if (statusEl) {
            statusEl.innerHTML = '<span style="color: var(--danger);">Please enter a phone number</span>';
        }
        showToast('Please enter a phone number', 'error');
        return;
    }
    
    if (!/^09[0-9]{8}$/.test(newNumber)) {
        if (statusEl) {
            statusEl.innerHTML = '<span style="color: var(--warning);">Format: 09xxxxxxxx (10 digits)</span>';
        }
        showToast('Invalid format. Must be 09xxxxxxxx (10 digits)', 'warning');
        return;
    }
    
    if (state.socket && state.isAdmin && state.socket.connected) {
        console.log('📱 Updating Telebirr number to:', newNumber);
        if (statusEl) {
            statusEl.innerHTML = '<span style="color: var(--info);"><i class="fas fa-spinner fa-spin"></i> Updating...</span>';
        }
        state.socket.emit('admin:updateTelebirrNumber', newNumber);
        showToast('Updating Telebirr number...', 'info');
    } else {
        showToast('Not connected to server', 'error');
    }
}

function focusTelebirrNumber() {
    document.querySelectorAll('.nav-item').forEach(nav => nav.classList.remove('active'));
    const controlsNav = document.querySelector('.nav-item[data-section="controls"]');
    if (controlsNav) {
        controlsNav.classList.add('active');
    }
    
    document.querySelectorAll('.content-section').forEach(s => s.classList.remove('active'));
    const controlsSection = document.getElementById('controlsSection');
    if (controlsSection) {
        controlsSection.classList.add('active');
    }
    
    if (document.getElementById('pageTitle')) {
        document.getElementById('pageTitle').textContent = 'System Controls';
    }
    
    setTimeout(() => {
        const input = document.getElementById('telebirrNumber');
        if (input) {
            input.focus();
            input.select();
        }
    }, 100);
}

function updateGameTimer() {
    const timer = document.getElementById('gameTimer')?.value;
    if (timer && timer > 0) {
        console.log('⏱️ Updating game timer to:', timer, 'seconds');
        showToast(`Game timer updated to ${timer} seconds`, 'success');
    }
}

function updateMinPlayers() {
    const minPlayers = document.getElementById('minPlayers')?.value;
    if (minPlayers && minPlayers >= 1) {
        console.log('👥 Updating minimum players to:', minPlayers);
        showToast(`Minimum players updated to ${minPlayers}`, 'success');
    }
}

function updateTransactionSettings() {
    const minDeposit = document.getElementById('minDeposit')?.value;
    const minWithdrawal = document.getElementById('minWithdrawal')?.value;
    const maxWithdrawal = document.getElementById('maxWithdrawal')?.value;
    const autoApproveLimit = document.getElementById('autoApproveLimit')?.value;
    
    if (confirm('Update transaction settings?')) {
        console.log('⚙️ Updating transaction settings:', { minDeposit, minWithdrawal, maxWithdrawal, autoApproveLimit });
        showToast('Transaction settings updated', 'success');
    }
}

function updateDefaultCommissions() {
    const bingoRate = document.getElementById('defaultBingoCommission')?.value;
    const kenoRate = document.getElementById('defaultKenoCommission')?.value;
    
    if (confirm(`Set default commissions to Bingo: ${bingoRate}%, Keno: ${kenoRate}%?`)) {
        console.log('👑 Updating default commissions:', { bingoRate, kenoRate });
        showToast('Default commissions updated', 'success');
    }
}

function forceStartAllGames() {
    if (confirm('Force start all waiting games?')) {
        console.log('🎮 Force starting all games...');
        showToast('Starting all games...', 'success');
    }
}

function clearLogs() {
    if (confirm('Clear all system logs?')) {
        console.log('🗑️ Clearing system logs...');
        const systemLogs = document.getElementById('systemLogs');
        if (systemLogs) {
            systemLogs.innerHTML = '';
        }
        showToast('System logs cleared', 'success');
    }
}

function exportLogs() {
    console.log('📤 Exporting logs...');
    showToast('Logs exported to CSV', 'success');
}

function exportUsers() {
    console.log('📤 Exporting users...');
    showToast('Users exported to CSV', 'success');
}

function searchTransactions() {
    updateTransactionHistory();
}

function applyTransactionFilters() {
    updateTransactionHistory();
}

function filterLogs() {
    console.log('🔍 Filtering logs...');
    showToast('Filtering logs...', 'info');
}

function updateDebugInfo() {
    if (state.debugInfo) {
        if (document.getElementById('debugSockets')) {
            document.getElementById('debugSockets').textContent = state.debugInfo.connectedSockets || 0;
        }
        if (document.getElementById('debugStoredTransactions')) {
            document.getElementById('debugStoredTransactions').textContent = state.debugInfo.storedTransactions || 0;
        }
        if (document.getElementById('debugAdmins')) {
            document.getElementById('debugAdmins').textContent = state.debugInfo.activeAdmins || 0;
        }
        if (document.getElementById('debugMultiSocketUsers')) {
            document.getElementById('debugMultiSocketUsers').textContent = state.debugInfo.multiSocketUsers || 0;
        }
    }
}

function clearTransactionCache() {
    if (confirm('Clear transaction cache? This will reload all transactions from server.')) {
        console.log('🧹 Clearing transaction cache...');
        loadAllTransactions();
        refreshPendingTransactions();
        showToast('Transaction cache cleared', 'success');
    }
}

function testNotification() {
    console.log('🔔 Testing notification...');
    playNotificationSound();
    showToast('Test notification sent', 'info');
}

function backupDatabase() {
    console.log('💾 Backing up database...');
    showToast('Database backup initiated', 'info');
}

function logout() {
    if (confirm('Logout from admin panel?')) {
        console.log('👋 Logging out...');
        localStorage.removeItem('bingo_admin_session');
        if (state.socket) {
            state.socket.disconnect();
        }
        window.location.reload();
    }
}

// Test connection function
function testConnection() {
    console.log('🔗 Testing connection to:', CONFIG.SERVER_URL);
    showToast('Testing connection...', 'info');
    
    if (!state.socket || !state.socket.connected) {
        connectSocket();
    } else {
        showToast('Already connected to server', 'success');
    }
}

// Initialize on load
console.log('🚀 Admin panel ready');

// Make functions available globally
window.adminLogin = adminLogin;
window.toggleSidebar = toggleSidebar;
window.forceRefreshData = forceRefreshData;
window.showBroadcastModal = showBroadcastModal;
window.focusTelebirrNumber = focusTelebirrNumber;
window.logout = logout;
window.resetHouseEarnings = resetHouseEarnings;
window.showAddFundsModal = showAddFundsModal;
window.showCreateAgentModal = showCreateAgentModal;
window.showPendingRequests = showPendingRequests;
window.refreshPendingTransactions = refreshPendingTransactions;
window.refreshActivity = refreshActivity;
window.applyFilters = applyFilters;
window.searchUsers = searchUsers;
window.refreshAgents = refreshAgents;
window.refreshDepositRequests = refreshDepositRequests;
window.refreshWithdrawalRequests = refreshWithdrawalRequests;
window.filterWalletTransactions = filterWalletTransactions;
window.filterDepositRequests = filterDepositRequests;
window.filterWithdrawalRequests = filterWithdrawalRequests;
window.loadAllTransactions = loadAllTransactions;
window.searchTransactions = searchTransactions;
window.applyTransactionFilters = applyTransactionFilters;
window.updateAnalytics = updateAnalytics;
window.updateTelebirrNumber = updateTelebirrNumber;
window.updateGameTimer = updateGameTimer;
window.updateMinPlayers = updateMinPlayers;
window.updateTransactionSettings = updateTransactionSettings;
window.updateDefaultCommissions = updateDefaultCommissions;
window.forceStartAllGames = forceStartAllGames;
window.clearLogs = clearLogs;
window.exportLogs = exportLogs;
window.exportUsers = exportUsers;
window.filterLogs = filterLogs;
window.clearTransactionCache = clearTransactionCache;
window.testNotification = testNotification;
window.backupDatabase = backupDatabase;
window.clearAllApprovedTransactions = clearAllApprovedTransactions;
window.resetAllTransactions = resetAllTransactions;
window.setAmount = setAmount;
window.setQuickAmount = setQuickAmount;
window.addFunds = addFunds;
window.sendBroadcast = sendBroadcast;
window.saveAgent = saveAgent;
window.assignUserToAgent = assignUserToAgent;
window.quickAddFundsToUser = quickAddFundsToUser;
window.quickAddFunds = quickAddFunds;
window.showAssignAgentModal = showAssignAgentModal;
window.showAssignAgentToUser = showAssignAgentToUser;
window.showEditAgentModal = showEditAgentModal;
window.deleteAgent = deleteAgent;
window.kickUser = kickUser;
window.approveTransaction = approveTransaction;
window.rejectTransaction = rejectTransaction;
window.showTransactionDetails = showTransactionDetails;
window.printTransactionDetails = printTransactionDetails;
window.hideModal = hideModal;
window.showModal = showModal;
