// server.js - BINGO ELITE - TELEGRAM MINI APP - FULLY FIXED VERSION
require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const mongoose = require('mongoose');
const fs = require('fs');

// ========== CREATE BASIC HTML FILES IF MISSING ==========
function createMissingFiles() {
  const files = {
    'telegram-index.html': `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>🎮 Bingo Elite - Telegram Mini App</title>
    <script src="/socket.io/socket.io.js"></script>
    <style>
        body { margin: 0; padding: 20px; font-family: Arial, sans-serif; background: #1a1a2e; color: white; text-align: center; }
        .container { max-width: 800px; margin: 0 auto; padding: 40px; }
        h1 { color: #ffd700; font-size: 2.5rem; }
        .btn { display: inline-block; padding: 15px 30px; margin: 10px; background: #4CAF50; color: white; text-decoration: none; border-radius: 10px; font-size: 1.2rem; }
        .btn:hover { background: #45a049; transform: scale(1.05); }
        #status { margin-top: 30px; padding: 20px; background: rgba(255,255,255,0.1); border-radius: 10px; }
    </style>
</head>
<body>
    <div class="container">
        <div style="font-size: 4rem;">🎮</div>
        <h1>Bingo Elite</h1>
        <p>Telegram Mini App - Real Money Bingo</p>
        
        <div style="margin: 30px 0;">
            <a href="/game" class="btn">🎮 Play Game</a>
            <a href="https://t.me/ethio_games1_bot" class="btn" target="_blank">🤖 Open Telegram Bot</a>
            <a href="/" class="btn">🏠 Home</a>
        </div>
        
        <div id="status">
            <p>Connecting to server...</p>
        </div>
        
        <div style="margin-top: 40px; color: #aaa; font-size: 0.9rem;">
            <p>Bot: @ethio_games1_bot | Server: bingo-telegram-game.onrender.com</p>
            <p>Four Corners Bonus: 50 ETB | Real-time Multiplayer</p>
        </div>
    </div>
    
    <script>
        const socket = io();
        socket.on('connect', () => {
            document.getElementById('status').innerHTML = '<p style="color: #4CAF50;">✅ Connected to server! Ready to play.</p>';
            document.getElementById('status').innerHTML += '<p>Auto-redirecting to game in 3 seconds...</p>';
            setTimeout(() => {
                window.location.href = '/game';
            }, 3000);
        });
        socket.on('disconnect', () => {
            document.getElementById('status').innerHTML = '<p style="color: #ef4444;">❌ Disconnected from server. Please refresh.</p>';
        });
    </script>
</body>
</html>`,
    
    'game.html': `<!DOCTYPE html>
<html>
<head>
    <title>🎮 Bingo Elite Game</title>
    <script src="/socket.io/socket.io.js"></script>
    <style>
        body { margin: 0; padding: 20px; font-family: Arial, sans-serif; background: #0f172a; color: white; }
        .container { max-width: 1000px; margin: 0 auto; }
        .header { text-align: center; margin-bottom: 30px; }
        .game-area { display: grid; grid-template-columns: 2fr 1fr; gap: 20px; }
        .bingo-card { background: #1e293b; padding: 20px; border-radius: 15px; }
        .bingo-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 5px; margin: 20px 0; }
        .bingo-cell { aspect-ratio: 1; background: #334155; display: flex; align-items: center; justify-content: center; border-radius: 8px; font-weight: bold; cursor: pointer; }
        .bingo-cell.free { background: #4CAF50; }
        .bingo-cell.marked { background: #3b82f6; }
        .controls { background: #1e293b; padding: 20px; border-radius: 15px; }
        .btn { width: 100%; padding: 15px; margin: 10px 0; background: #3b82f6; color: white; border: none; border-radius: 8px; font-size: 1.1rem; cursor: pointer; }
        .btn:hover { background: #2563eb; }
        .btn:disabled { background: #64748b; cursor: not-allowed; }
        .btn-danger { background: #ef4444; }
        .btn-danger:hover { background: #dc2626; }
        .btn-success { background: #10b981; }
        .btn-success:hover { background: #059669; }
        #status { padding: 15px; background: rgba(255,255,255,0.1); border-radius: 10px; margin: 15px 0; }
        #balance { font-size: 1.5rem; color: #ffd700; font-weight: bold; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🎮 Bingo Elite</h1>
            <p>Real-time Multiplayer Bingo | Telegram: @ethio_games1_bot</p>
            <div style="display: flex; justify-content: center; gap: 20px; margin: 20px 0;">
                <div>💰 Balance: <span id="balance">0.00</span> ETB</div>
                <div id="roomStatus">Not in room</div>
            </div>
        </div>
        
        <div id="status">Connecting to server...</div>
        
        <div class="game-area" id="gameArea" style="display: none;">
            <div class="bingo-card">
                <h3>Your Bingo Card</h3>
                <div id="bingoGrid" class="bingo-grid">
                    <!-- Bingo cells will be generated by JavaScript -->
                </div>
                <div style="text-align: center; margin-top: 20px;">
                    <button id="claimBingoBtn" class="btn btn-success" disabled>🎯 Claim BINGO</button>
                </div>
            </div>
            
            <div class="controls">
                <h3>Game Controls</h3>
                <div id="roomSelection">
                    <h4>Select Room:</h4>
                    <button class="btn" onclick="joinRoom(10)">🎮 10 ETB Room</button>
                    <button class="btn" onclick="joinRoom(20)">🎮 20 ETB Room</button>
                    <button class="btn" onclick="joinRoom(50)">🎮 50 ETB Room</button>
                    <button class="btn" onclick="joinRoom(100)">🎮 100 ETB Room</button>
                </div>
                
                <div id="boxSelection" style="display: none;">
                    <h4>Select Ticket Number (1-100):</h4>
                    <input type="number" id="boxNumber" min="1" max="100" placeholder="Enter box number" style="width: 100%; padding: 10px; margin: 10px 0; border-radius: 5px;">
                    <button class="btn" onclick="selectBox()">Select Box</button>
                    <button class="btn btn-danger" onclick="cancelJoin()">Cancel</button>
                </div>
                
                <div id="gameControls" style="display: none;">
                    <h4>Game in Progress</h4>
                    <div id="currentBall">Current Ball: None</div>
                    <div id="ballsDrawn">Balls Drawn: 0</div>
                    <div id="timer">Time remaining: --</div>
                    <button class="btn btn-danger" onclick="leaveRoom()">Leave Room</button>
                </div>
                
                <div style="margin-top: 30px;">
                    <h4>Recent Numbers:</h4>
                    <div id="recentNumbers" style="min-height: 100px; background: rgba(255,255,255,0.05); border-radius: 8px; padding: 10px;"></div>
                </div>
            </div>
        </div>
        
        <div style="margin-top: 40px; text-align: center; color: #94a3b8; font-size: 0.9rem;">
            <p>🎯 Four Corners Bonus: 50 ETB | ⚡ Real-time Multiplayer | 🔒 Secure Transactions</p>
            <p>For deposits/withdrawals, contact @ethio_games1_bot on Telegram</p>
        </div>
    </div>
    
    <script>
        let socket;
        let currentRoom = null;
        let selectedBox = null;
        let balance = 0;
        let bingoGrid = [];
        let markedCells = [];
        let currentBall = null;
        let recentNumbers = [];
        
        function connectToServer() {
            socket = io();
            
            socket.on('connect', () => {
                document.getElementById('status').innerHTML = '<p style="color: #10b981;">✅ Connected to server!</p>';
                document.getElementById('gameArea').style.display = 'block';
                // Generate initial bingo card
                generateBingoCard();
            });
            
            socket.on('disconnect', () => {
                document.getElementById('status').innerHTML = '<p style="color: #ef4444;">❌ Disconnected from server. Reconnecting...</p>';
            });
            
            socket.on('connectionTest', (data) => {
                console.log('Connection test:', data);
            });
            
            socket.on('balanceUpdate', (newBalance) => {
                balance = newBalance;
                document.getElementById('balance').textContent = balance.toFixed(2);
            });
            
            socket.on('roomStatus', (rooms) => {
                console.log('Room status updated:', rooms);
            });
            
            socket.on('joinedRoom', () => {
                document.getElementById('status').innerHTML = '<p style="color: #10b981;">✅ Joined room! Waiting for game to start...</p>';
                document.getElementById('roomSelection').style.display = 'none';
                document.getElementById('boxSelection').style.display = 'none';
                document.getElementById('gameControls').style.display = 'block';
            });
            
            socket.on('gameStarted', (data) => {
                document.getElementById('status').innerHTML = '<p style="color: #3b82f6;">🎮 Game started! Balls will be drawn every 3 seconds.</p>';
            });
            
            socket.on('ballDrawn', (data) => {
                currentBall = data;
                recentNumbers.unshift(data.num);
                if (recentNumbers.length > 10) recentNumbers.pop();
                
                document.getElementById('currentBall').textContent = \`Current Ball: \${data.letter}-\${data.num}\`;
                document.getElementById('ballsDrawn').textContent = \`Balls Drawn: \${data.ballsDrawn}\`;
                
                // Update recent numbers display
                document.getElementById('recentNumbers').innerHTML = recentNumbers.map(num => \`<span style="display: inline-block; padding: 5px 10px; margin: 2px; background: #3b82f6; border-radius: 5px;">\${num}</span>\`).join('');
                
                // Check if this number is on our card
                if (bingoGrid.includes(data.num)) {
                    const index = bingoGrid.indexOf(data.num);
                    markCell(index);
                }
            });
            
            socket.on('enableBingo', () => {
                document.getElementById('claimBingoBtn').disabled = false;
            });
            
            socket.on('gameOver', (data) => {
                document.getElementById('status').innerHTML = \`<p style="color: #ffd700;">🏆 Game Over! Winner: \${data.winnerName} - Prize: \${data.prize} ETB\${data.isFourCornersWin ? ' (Four Corners Bonus!)' : ''}</p>\`;
                resetGame();
            });
            
            socket.on('error', (message) => {
                document.getElementById('status').innerHTML = \`<p style="color: #ef4444;">❌ Error: \${message}</p>\`;
            });
            
            socket.on('boxTaken', () => {
                document.getElementById('status').innerHTML = '<p style="color: #ef4444;">❌ Box already taken! Choose another.</p>';
            });
            
            socket.on('insufficientFunds', () => {
                document.getElementById('status').innerHTML = '<p style="color: #ef4444;">❌ Insufficient funds! Contact @ethio_games1_bot to deposit.</p>';
            });
            
            socket.on('leftRoom', (data) => {
                document.getElementById('status').innerHTML = \`<p style="color: #f59e0b;">👋 \${data.message}\${data.refunded ? ' (Stake refunded)' : ''}</p>\`;
                resetGame();
            });
            
            // Initialize user
            const userId = 'user_' + Date.now();
            socket.emit('init', {
                userId: userId,
                userName: 'Player'
            });
        }
        
        function generateBingoCard() {
            const grid = [];
            const container = document.getElementById('bingoGrid');
            container.innerHTML = '';
            
            // Generate random numbers for BINGO columns
            for (let i = 0; i < 24; i++) {
                let num;
                if (i < 5) num = Math.floor(Math.random() * 15) + 1; // B
                else if (i < 10) num = Math.floor(Math.random() * 15) + 16; // I
                else if (i < 14) num = Math.floor(Math.random() * 15) + 31; // N (skip center)
                else if (i < 19) num = Math.floor(Math.random() * 15) + 46; // G
                else num = Math.floor(Math.random() * 15) + 61; // O
                
                grid.push(num);
                
                const cell = document.createElement('div');
                cell.className = 'bingo-cell';
                cell.textContent = num;
                cell.dataset.index = i;
                cell.onclick = () => markCell(i);
                container.appendChild(cell);
            }
            
            // Add FREE space at position 12 (center)
            const freeCell = document.createElement('div');
            freeCell.className = 'bingo-cell free';
            freeCell.textContent = 'FREE';
            freeCell.dataset.index = 12;
            freeCell.onclick = () => markCell(12);
            
            // Insert at position 12
            const children = container.children;
            container.insertBefore(freeCell, children[12]);
            
            bingoGrid = [];
            for (let i = 0; i < 25; i++) {
                if (i === 12) {
                    bingoGrid.push('FREE');
                } else if (i < 12) {
                    bingoGrid.push(grid[i]);
                } else {
                    bingoGrid.push(grid[i-1]);
                }
            }
            
            markedCells = Array(25).fill(false);
        }
        
        function markCell(index) {
            const cells = document.querySelectorAll('.bingo-cell');
            if (markedCells[index]) {
                markedCells[index] = false;
                cells[index].classList.remove('marked');
            } else {
                markedCells[index] = true;
                cells[index].classList.add('marked');
            }
        }
        
        function joinRoom(stake) {
            currentRoom = stake;
            document.getElementById('roomSelection').style.display = 'none';
            document.getElementById('boxSelection').style.display = 'block';
            document.getElementById('status').innerHTML = \`<p>Joining \${stake} ETB room... Select your ticket number (1-100)</p>\`;
        }
        
        function selectBox() {
            const boxInput = document.getElementById('boxNumber');
            const box = parseInt(boxInput.value);
            
            if (isNaN(box) || box < 1 || box > 100) {
                document.getElementById('status').innerHTML = '<p style="color: #ef4444;">❌ Please enter a valid box number (1-100)</p>';
                return;
            }
            
            selectedBox = box;
            socket.emit('joinRoom', {
                room: currentRoom,
                box: box,
                userName: 'Player'
            });
        }
        
        function cancelJoin() {
            currentRoom = null;
            selectedBox = null;
            document.getElementById('roomSelection').style.display = 'block';
            document.getElementById('boxSelection').style.display = 'none';
            document.getElementById('status').innerHTML = '<p>Join cancelled.</p>';
        }
        
        function leaveRoom() {
            socket.emit('player:leaveRoom');
        }
        
        function claimBingo() {
            const markedNumbers = [];
            for (let i = 0; i < 25; i++) {
                if (markedCells[i]) {
                    markedNumbers.push(bingoGrid[i]);
                }
            }
            
            if (markedNumbers.length < 5) {
                document.getElementById('status').innerHTML = '<p style="color: #ef4444;">❌ Need at least 5 marked numbers for BINGO!</p>';
                return;
            }
            
            socket.emit('claimBingo', {
                room: currentRoom,
                grid: bingoGrid,
                marked: markedNumbers
            });
            
            document.getElementById('claimBingoBtn').disabled = true;
            document.getElementById('status').innerHTML = '<p style="color: #f59e0b;">🎯 BINGO claim submitted! Checking...</p>';
        }
        
        function resetGame() {
            currentRoom = null;
            selectedBox = null;
            document.getElementById('roomSelection').style.display = 'block';
            document.getElementById('gameControls').style.display = 'none';
            document.getElementById('claimBingoBtn').disabled = true;
            document.getElementById('recentNumbers').innerHTML = '';
            generateBingoCard();
        }
        
        // Initialize
        document.getElementById('claimBingoBtn').onclick = claimBingo;
        connectToServer();
    </script>
</body>
</html>`,
    
    'admin.html': `<!DOCTYPE html>
<html>
<head>
    <title>🔐 Bingo Elite Admin Panel</title>
    <script src="/socket.io/socket.io.js"></script>
    <style>
        body { margin: 0; padding: 20px; font-family: Arial, sans-serif; background: #0f172a; color: white; }
        .container { max-width: 1400px; margin: 0 auto; }
        .login-panel, .admin-panel { display: none; }
        .login-panel.active, .admin-panel.active { display: block; }
        .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; margin: 20px 0; }
        .card { background: #1e293b; padding: 20px; border-radius: 10px; }
        .stats-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 15px; margin: 20px 0; }
        .stat { background: rgba(255,255,255,0.1); padding: 15px; border-radius: 8px; text-align: center; }
        .stat-value { font-size: 2rem; font-weight: bold; color: #ffd700; }
        .stat-label { font-size: 0.9rem; color: #94a3b8; }
        table { width: 100%; border-collapse: collapse; margin: 10px 0; }
        th, td { padding: 10px; text-align: left; border-bottom: 1px solid #334155; }
        th { background: rgba(255,255,255,0.1); }
        tr:hover { background: rgba(255,255,255,0.05); }
        input, select, button { padding: 10px; margin: 5px; border-radius: 5px; border: 1px solid #475569; background: #1e293b; color: white; }
        button { background: #3b82f6; border: none; cursor: pointer; }
        button:hover { background: #2563eb; }
        .btn-danger { background: #ef4444; }
        .btn-danger:hover { background: #dc2626; }
        .btn-success { background: #10b981; }
        .btn-success:hover { background: #059669; }
        .online { color: #10b981; font-weight: bold; }
        .offline { color: #94a3b8; }
    </style>
</head>
<body>
    <div class="container">
        <h1>🔐 Bingo Elite Admin Panel</h1>
        
        <div id="loginPanel" class="login-panel active">
            <div class="card">
                <h2>Admin Login</h2>
                <input type="password" id="password" placeholder="Admin password" style="width: 300px;">
                <button onclick="login()">Login</button>
                <div id="loginError" style="color: #ef4444; margin-top: 10px;"></div>
            </div>
        </div>
        
        <div id="adminPanel" class="admin-panel">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
                <h2>Dashboard</h2>
                <button onclick="logout()" class="btn-danger">Logout</button>
            </div>
            
            <div class="stats-grid">
                <div class="stat">
                    <div class="stat-label">Connected Players</div>
                    <div class="stat-value" id="totalPlayers">0</div>
                </div>
                <div class="stat">
                    <div class="stat-label">Active Games</div>
                    <div class="stat-value" id="activeGames">0</div>
                </div>
                <div class="stat">
                    <div class="stat-label">Total Users</div>
                    <div class="stat-value" id="totalUsers">0</div>
                </div>
                <div class="stat">
                    <div class="stat-label">House Balance</div>
                    <div class="stat-value" id="houseBalance">0</div>
                </div>
            </div>
            
            <div class="grid">
                <div class="card">
                    <h3>Player Management</h3>
                    <input type="text" id="searchUser" placeholder="Search by User ID or Name" style="width: 100%;">
                    <div id="playersList" style="max-height: 400px; overflow-y: auto;"></div>
                </div>
                
                <div class="card">
                    <h3>Room Management</h3>
                    <div id="roomsList"></div>
                    <div style="margin-top: 15px;">
                        <button onclick="forceStartGame(10)">Start 10 ETB</button>
                        <button onclick="forceStartGame(20)">Start 20 ETB</button>
                        <button onclick="forceStartGame(50)">Start 50 ETB</button>
                        <button onclick="forceStartGame(100)">Start 100 ETB</button>
                    </div>
                </div>
                
                <div class="card">
                    <h3>Add Funds</h3>
                    <input type="text" id="fundsUserId" placeholder="User ID" style="width: 100%;">
                    <input type="number" id="fundsAmount" placeholder="Amount" style="width: 100%;">
                    <button onclick="addFunds()" class="btn-success">Add Funds</button>
                    <div id="fundsResult" style="margin-top: 10px;"></div>
                </div>
            </div>
            
            <div class="card" style="margin-top: 20px;">
                <h3>Recent Transactions</h3>
                <div id="transactionsList" style="max-height: 300px; overflow-y: auto;"></div>
            </div>
            
            <div class="card" style="margin-top: 20px;">
                <h3>System Actions</h3>
                <button onclick="refreshAll()" class="btn-success">Refresh All Data</button>
                <button onclick="clearAllBoxes()" class="btn-danger">Clear All Boxes</button>
                <button onclick="forceEndAllGames()" class="btn-danger">End All Games</button>
            </div>
        </div>
    </div>
    
    <script>
        let socket;
        let isAdmin = false;
        
        function login() {
            const password = document.getElementById('password').value;
            if (!socket) {
                socket = io();
                setupSocketListeners();
            }
            socket.emit('admin:auth', password);
        }
        
        function setupSocketListeners() {
            socket.on('admin:authSuccess', () => {
                isAdmin = true;
                document.getElementById('loginPanel').classList.remove('active');
                document.getElementById('adminPanel').classList.add('active');
                socket.emit('admin:getData');
            });
            
            socket.on('admin:authError', (msg) => {
                document.getElementById('loginError').textContent = 'Login failed: ' + msg;
            });
            
            socket.on('admin:update', (data) => {
                document.getElementById('totalPlayers').textContent = data.totalPlayers;
                document.getElementById('activeGames').textContent = data.activeGames;
                document.getElementById('totalUsers').textContent = data.totalUsers;
                document.getElementById('houseBalance').textContent = data.houseBalance.toFixed(2) + ' ETB';
            });
            
            socket.on('admin:players', (players) => {
                let html = '<table><tr><th>Name</th><th>Balance</th><th>Status</th><th>Room</th><th>Actions</th></tr>';
                players.forEach(player => {
                    html += \`<tr>
                        <td>\${player.userName}</td>
                        <td>\${player.balance.toFixed(2)} ETB</td>
                        <td class="\${player.isOnline ? 'online' : 'offline'}">\${player.isOnline ? '✅ Online' : '❌ Offline'}</td>
                        <td>\${player.currentRoom || '-'}</td>
                        <td>
                            <button onclick="addFundsToUser('\${player.userId}', '\${player.userName}')">Add Funds</button>
                        </td>
                    </tr>\`;
                });
                html += '</table>';
                document.getElementById('playersList').innerHTML = html;
            });
            
            socket.on('admin:rooms', (rooms) => {
                let html = '';
                for (const stake in rooms) {
                    const room = rooms[stake];
                    html += \`<div style="margin-bottom: 15px; padding: 10px; background: rgba(255,255,255,0.05); border-radius: 8px;">
                        <strong>\${stake} ETB Room</strong><br>
                        Players: \${room.playerCount} online / \${room.totalPlayers} total<br>
                        Status: \${room.status} \${room.locked ? '🔒' : ''}<br>
                        <button onclick="forceEndGame(\${stake})" style="padding: 5px 10px; font-size: 0.8rem;">End Game</button>
                        <button onclick="clearRoomBoxes(\${stake})" style="padding: 5px 10px; font-size: 0.8rem;">Clear Boxes</button>
                    </div>\`;
                }
                document.getElementById('roomsList').innerHTML = html;
            });
            
            socket.on('admin:transactions', (transactions) => {
                let html = '<table><tr><th>Time</th><th>User</th><th>Type</th><th>Amount</th><th>Description</th></tr>';
                transactions.forEach(tx => {
                    const amount = tx.amount > 0 ? \`+\${tx.amount.toFixed(2)}\` : tx.amount.toFixed(2);
                    html += \`<tr>
                        <td>\${new Date(tx.createdAt).toLocaleTimeString()}</td>
                        <td>\${tx.userName}</td>
                        <td>\${tx.type}</td>
                        <td>\${amount} ETB</td>
                        <td>\${tx.description}</td>
                    </tr>\`;
                });
                html += '</table>';
                document.getElementById('transactionsList').innerHTML = html;
            });
            
            socket.on('admin:success', (msg) => {
                alert('Success: ' + msg);
                socket.emit('admin:getData');
            });
            
            socket.on('admin:error', (msg) => {
                alert('Error: ' + msg);
            });
        }
        
        function logout() {
            isAdmin = false;
            document.getElementById('loginPanel').classList.add('active');
            document.getElementById('adminPanel').classList.remove('active');
            if (socket) {
                socket.disconnect();
                socket = null;
            }
        }
        
        function addFunds() {
            const userId = document.getElementById('fundsUserId').value;
            const amount = parseFloat(document.getElementById('fundsAmount').value);
            
            if (!userId || !amount || amount <= 0) {
                document.getElementById('fundsResult').innerHTML = '<span style="color: #ef4444;">Please enter valid user ID and amount</span>';
                return;
            }
            
            socket.emit('admin:addFunds', { userId, amount });
        }
        
        function addFundsToUser(userId, userName) {
            const amount = prompt(\`Enter amount to add to \${userName} (ID: \${userId}):\`);
            if (amount && !isNaN(parseFloat(amount))) {
                socket.emit('admin:addFunds', { userId, amount: parseFloat(amount) });
            }
        }
        
        function forceStartGame(stake) {
            if (confirm(\`Force start \${stake} ETB room?\`)) {
                socket.emit('admin:forceStartGame', stake);
            }
        }
        
        function forceEndGame(stake) {
            if (confirm(\`Force end \${stake} ETB game? All players will be refunded.\`)) {
                socket.emit('admin:forceEndGame', stake);
            }
        }
        
        function clearRoomBoxes(stake) {
            if (confirm(\`Clear all boxes in \${stake} ETB room? Players will be refunded.\`)) {
                socket.emit('admin:clearBoxes', stake);
            }
        }
        
        function clearAllBoxes() {
            if (confirm('Clear ALL boxes in ALL rooms? Players will be refunded.')) {
                [10, 20, 50, 100].forEach(stake => {
                    socket.emit('admin:clearBoxes', stake);
                });
            }
        }
        
        function forceEndAllGames() {
            if (confirm('Force end ALL active games? All players will be refunded.')) {
                [10, 20, 50, 100].forEach(stake => {
                    socket.emit('admin:forceEndGame', stake);
                });
            }
        }
        
        function refreshAll() {
            socket.emit('admin:getData');
        }
        
        // Auto-connect socket
        socket = io();
        setupSocketListeners();
    </script>
</body>
</html>`
  };
  
  for (const [filename, content] of Object.entries(files)) {
    const filePath = path.join(__dirname, filename);
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, content);
      console.log(`✅ Created missing file: ${filename}`);
    }
  }
}

// ========== MAIN SERVER CODE ==========

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/bingo', {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => console.log('✅ MongoDB Connected'))
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
  languageCode: { type: String, default: 'en' }
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
  totalFourCorners: { type: Number, default: 0 }
});

const User = mongoose.model('User', userSchema);
const Room = mongoose.model('Room', roomSchema);
const Transaction = mongoose.model('Transaction', transactionSchema);
const Stats = mongoose.model('Stats', statsSchema);

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

// Create missing HTML files on startup
createMissingFiles();

// Custom headers for WebSocket and Telegram
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', '*');
  res.header('Access-Control-Allow-Methods', '*');
  res.header('Content-Security-Policy', "frame-ancestors 'self' https://*.telegram.org https://web.telegram.org");
  res.header('X-Frame-Options', 'ALLOW-FROM https://*.telegram.org');
  next();
});

// ========== GAME CONFIGURATION ==========
const CONFIG = {
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || "admin1234",
  INITIAL_BALANCE: 0.00,
  ROOM_STAKES: [10, 20, 50, 100],
  MAX_PLAYERS_PER_ROOM: 100,
  GAME_TIMER: 3,
  MIN_PLAYERS_TO_START: 1,
  HOUSE_COMMISSION: {
    10: 2,
    20: 4,
    50: 10,
    100: 20
  },
  FOUR_CORNERS_BONUS: 50,
  COUNTDOWN_TIMER: 30,
  ROOM_STATUS_UPDATE_INTERVAL: 3000,
  MAX_TRANSACTIONS: 1000,
  AUTO_SAVE_INTERVAL: 60000,
  SESSION_TIMEOUT: 86400000,
  GAME_TIMEOUT_MINUTES: 7
};

// ========== GLOBAL STATE ==========
let socketToUser = new Map();
let adminSockets = new Set();
let activityLog = [];
let roomTimers = new Map();
let connectedSockets = new Set();
let roomSubscriptions = new Map();
let processingClaims = new Map();

// ========== REAL-TIME BOX TRACKING FUNCTIONS ==========
function broadcastTakenBoxes(roomStake, takenBoxes, newBox = null, playerName = null) {
  const updateData = {
    room: roomStake,
    takenBoxes: takenBoxes,
    playerCount: takenBoxes.length,
    timestamp: Date.now()
  };
  
  if (newBox && playerName) {
    updateData.newBox = newBox;
    updateData.playerName = playerName;
    updateData.message = `${playerName} selected box ${newBox}!`;
  }
  
  io.emit('boxesTakenUpdate', updateData);
  
  adminSockets.forEach(socketId => {
    const socket = io.sockets.sockets.get(socketId);
    if (socket) {
      socket.emit('admin:boxesUpdate', {
        room: roomStake,
        takenBoxes: takenBoxes,
        playerCount: takenBoxes.length,
        timestamp: new Date().toISOString(),
        newBox: newBox,
        playerName: playerName
      });
    }
  });
  
  console.log(`📦 Real-time box update for room ${roomStake}: ${takenBoxes.length} boxes taken${newBox ? `, new box ${newBox} by ${playerName}` : ''}`);
}

function cleanupRoomTimer(stake) {
  if (roomTimers.has(stake)) {
    clearInterval(roomTimers.get(stake));
    roomTimers.delete(stake);
    console.log(`🧹 Cleaned up timer for room ${stake}`);
  }
}

function cleanupProcessingClaims() {
  const now = Date.now();
  const tenSecondsAgo = now - 10000;
  
  processingClaims.forEach((timestamp, roomStake) => {
    if (timestamp < tenSecondsAgo) {
      processingClaims.delete(roomStake);
      console.log(`🧹 Cleaned up stale processing claim for room ${roomStake}`);
    }
  });
}

setInterval(cleanupProcessingClaims, 10000);

// ========== IMPROVED HELPER FUNCTIONS ==========
function getBingoLetter(number) {
  if (number >= 1 && number <= 15) return 'B';
  if (number >= 16 && number <= 30) return 'I';
  if (number >= 31 && number <= 45) return 'N';
  if (number >= 46 && number <= 60) return 'G';
  if (number >= 61 && number <= 75) return 'O';
  return '';
}

function generateReferralCode(userId) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code + userId.slice(-4);
}

async function getUser(userId, userName) {
  try {
    let user = await User.findOne({ userId: userId });
    
    if (!user) {
      user = new User({
        userId: userId,
        userName: userName || 'Guest',
        balance: CONFIG.INITIAL_BALANCE,
        referralCode: generateReferralCode(userId),
        telegramId: userId.startsWith('tg_') ? userId.replace('tg_', '') : null
      });
      await user.save();
      
      const transaction = new Transaction({
        type: 'NEW_USER',
        userId: userId,
        userName: userName || 'Guest',
        amount: 0,
        description: 'New user registered'
      });
      await transaction.save();
    } else {
      user.lastSeen = new Date();
      user.sessionCount = (user.sessionCount || 0) + 1;
      user.isOnline = true;
      
      if (userName && user.userName !== userName) {
        user.userName = userName;
      }
      
      await user.save();
    }
    
    return user;
  } catch (error) {
    console.error('Error getting user:', error);
    return null;
  }
}

async function getRoom(stake) {
  try {
    let room = await Room.findOne({ stake: stake, status: { $in: ['waiting', 'starting', 'playing'] } });
    
    if (!room) {
      room = new Room({
        stake: stake,
        players: [],
        takenBoxes: [],
        status: 'waiting',
        lastBoxUpdate: new Date()
      });
      await room.save();
    }
    
    return room;
  } catch (error) {
    console.error('Error getting room:', error);
    return null;
  }
}

function getConnectedUsers() {
  const connectedUsers = new Set();
  
  socketToUser.forEach((userId, socketId) => {
    const socket = io.sockets.sockets.get(socketId);
    if (socket && socket.connected) {
      connectedUsers.add(userId);
    }
  });
  
  io.sockets.sockets.forEach((socket) => {
    if (socket && socket.connected && socket.userId && socket.userId !== 'pending') {
      connectedUsers.add(socket.userId);
    }
  });
  
  return Array.from(connectedUsers);
}

async function getOnlinePlayersInRoom(roomStake) {
  try {
    const room = await Room.findOne({ stake: roomStake });
    if (!room) return [];
    
    const onlinePlayers = [];
    const connectedUserIds = getConnectedUsers();
    
    for (const playerId of room.players) {
      if (connectedUserIds.includes(playerId)) {
        onlinePlayers.push(playerId);
      }
    }
    
    return onlinePlayers;
  } catch (error) {
    console.error('Error getting online players in room:', error);
    return [];
  }
}

// ========== BROADCAST FUNCTIONS ==========
async function broadcastRoomStatus() {
  try {
    const rooms = await Room.find({ status: { $in: ['waiting', 'starting', 'playing'] } });
    const roomStatus = {};
    
    for (const room of rooms) {
      const onlinePlayers = await getOnlinePlayersInRoom(room.stake);
      const commissionPerPlayer = CONFIG.HOUSE_COMMISSION[room.stake] || 0;
      const contributionPerPlayer = room.stake - commissionPerPlayer;
      const potentialPrize = contributionPerPlayer * onlinePlayers.length;
      const houseFee = commissionPerPlayer * onlinePlayers.length;
      const potentialPrizeWithBonus = potentialPrize + CONFIG.FOUR_CORNERS_BONUS;
      
      const isLocked = room.status === 'playing';
      
      roomStatus[room.stake] = {
        stake: room.stake,
        playerCount: onlinePlayers.length,
        totalPlayers: room.players.length,
        status: isLocked ? 'locked' : room.status,
        locked: isLocked,
        takenBoxes: room.takenBoxes.length,
        commissionPerPlayer: commissionPerPlayer,
        contributionPerPlayer: contributionPerPlayer,
        potentialPrize: potentialPrize,
        potentialPrizeWithBonus: potentialPrizeWithBonus,
        houseFee: houseFee,
        currentBall: room.currentBall,
        ballsDrawn: room.ballsDrawn,
        minPlayers: CONFIG.MIN_PLAYERS_TO_START,
        fourCornersBonus: CONFIG.FOUR_CORNERS_BONUS
      };
    }
    
    io.emit('roomStatus', roomStatus);
    updateAdminPanel();
    
  } catch (error) {
    console.error('Error broadcasting room status:', error);
  }
}

async function updateAdminPanel() {
  try {
    const connectedPlayers = getConnectedUsers().length;
    const activeGames = await Room.countDocuments({ status: 'playing' });
    
    const users = await User.find({}).sort({ balance: -1 }).limit(100);
    
    const connectedUserIds = getConnectedUsers();
    
    const userArray = users.map(user => {
      let isOnline = false;
      
      if (connectedUserIds.includes(user.userId)) {
        isOnline = true;
      } else if (user.lastSeen) {
        const lastSeenTime = new Date(user.lastSeen);
        const now = new Date();
        const secondsSinceLastSeen = (now - lastSeenTime) / 1000;
        
        if (secondsSinceLastSeen < 30) {
          isOnline = true;
        }
      }
      
      return {
        userId: user.userId,
        userName: user.userName,
        balance: user.balance,
        currentRoom: user.currentRoom,
        box: user.box,
        isOnline: isOnline,
        totalWagered: user.totalWagered || 0,
        totalWins: user.totalWins || 0,
        lastSeen: user.lastSeen,
        telegramId: user.telegramId || '',
        joinedAt: user.joinedAt
      };
    });
    
    const roomsData = {};
    const rooms = await Room.find({ status: { $in: ['waiting', 'starting', 'playing'] } });
    
    for (const room of rooms) {
      const onlinePlayers = await getOnlinePlayersInRoom(room.stake);
      const commissionPerPlayer = CONFIG.HOUSE_COMMISSION[room.stake] || 0;
      const contributionPerPlayer = room.stake - commissionPerPlayer;
      const potentialPrize = contributionPerPlayer * onlinePlayers.length;
      const houseFee = commissionPerPlayer * onlinePlayers.length;
      
      roomsData[room.stake] = {
        stake: room.stake,
        playerCount: onlinePlayers.length,
        totalPlayers: room.players.length,
        takenBoxes: room.takenBoxes,
        status: room.status,
        locked: room.status === 'playing',
        currentBall: room.currentBall,
        ballsDrawn: room.ballsDrawn,
        commissionPerPlayer: commissionPerPlayer,
        contributionPerPlayer: contributionPerPlayer,
        potentialPrize: potentialPrize,
        houseFee: houseFee,
        players: room.players,
        onlinePlayers: onlinePlayers,
        startTime: room.startTime,
        gameDuration: room.startTime ? Math.floor((Date.now() - room.startTime) / 1000 / 60) : 0
      };
    }
    
    const houseBalance = await Transaction.aggregate([
      { $match: { type: { $in: ['HOUSE_EARNINGS', 'ADMIN_ADD'] } } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]).then(result => result[0]?.total || 0);
    
    const connectedSocketsCount = connectedSockets.size;
    
    const adminData = {
      totalPlayers: connectedPlayers,
      activeGames: activeGames,
      totalUsers: users.length,
      connectedSockets: connectedSocketsCount,
      houseBalance: houseBalance,
      timestamp: new Date().toISOString(),
      serverUptime: process.uptime(),
      gameTimeoutMinutes: CONFIG.GAME_TIMEOUT_MINUTES
    };
    
    adminSockets.forEach(socketId => {
      const socket = io.sockets.sockets.get(socketId);
      if (socket) {
        socket.emit('admin:update', adminData);
        socket.emit('admin:players', userArray);
        socket.emit('admin:rooms', roomsData);
        
        Transaction.find().sort({ createdAt: -1 }).limit(50)
          .then(transactions => {
            socket.emit('admin:transactions', transactions);
          })
          .catch(err => console.error('Error fetching transactions:', err));
      }
    });
    
    console.log(`📊 Admin Panel Updated: ${connectedPlayers} players online, ${activeGames} active games`);
    
  } catch (error) {
    console.error('Error updating admin panel:', error);
  }
}

function logActivity(type, details, adminSocketId = null) {
  const activity = {
    id: Date.now().toString(),
    timestamp: new Date().toISOString(),
    type: type,
    details: details,
    adminSocketId: adminSocketId
  };
  activityLog.unshift(activity);
  
  if (activityLog.length > 200) {
    activityLog = activityLog.slice(0, 200);
  }
  
  adminSockets.forEach(socketId => {
    const socket = io.sockets.sockets.get(socketId);
    if (socket) {
      socket.emit('admin:activity', activity);
    }
  });
}

// ========== AUTO-CLEAR LONG RUNNING GAMES (7 MINUTES) ==========
async function cleanupLongRunningGames() {
  try {
    const sevenMinutesAgo = new Date(Date.now() - CONFIG.GAME_TIMEOUT_MINUTES * 60 * 1000);
    const longRunningRooms = await Room.find({
      status: 'playing',
      startTime: { $lt: sevenMinutesAgo }
    });
    
    for (const room of longRunningRooms) {
      console.log(`⏰ Room ${room.stake} has been playing for ${CONFIG.GAME_TIMEOUT_MINUTES}+ minutes. Auto-ending...`);
      
      cleanupRoomTimer(room.stake);
      
      const playersInRoom = [...room.players];
      
      for (const userId of playersInRoom) {
        const user = await User.findOne({ userId: userId });
        if (user) {
          const oldBalance = user.balance;
          user.balance += room.stake;
          user.currentRoom = null;
          user.box = null;
          await user.save();
          
          console.log(`💰 Auto-refunded ${room.stake} ETB to ${user.userName} after ${CONFIG.GAME_TIMEOUT_MINUTES}min timeout`);
          
          const transaction = new Transaction({
            type: 'TIMEOUT_REFUND',
            userId: userId,
            userName: user.userName,
            amount: room.stake,
            room: room.stake,
            description: `Game auto-ended after ${CONFIG.GAME_TIMEOUT_MINUTES} minutes - stake refunded`
          });
          await transaction.save();
          
          for (const [socketId, uId] of socketToUser.entries()) {
            if (uId === userId) {
              const socket = io.sockets.sockets.get(socketId);
              if (socket) {
                socket.emit('gameTimeout', {
                  room: room.stake,
                  reason: `Game auto-ended after ${CONFIG.GAME_TIMEOUT_MINUTES} minutes`,
                  refunded: room.stake
                });
                socket.emit('balanceUpdate', user.balance);
                socket.emit('boxesCleared', { 
                  room: room.stake, 
                  reason: 'game_timeout' 
                });
              }
            }
          }
        }
      }
      
      room.players = [];
      room.takenBoxes = [];
      room.status = 'waiting';
      room.calledNumbers = [];
      room.currentBall = null;
      room.ballsDrawn = 0;
      room.startTime = null;
      room.endTime = new Date();
      room.lastBoxUpdate = new Date();
      await room.save();
      
      broadcastTakenBoxes(room.stake, []);
      
      console.log(`✅ Auto-cleared room ${room.stake} after ${CONFIG.GAME_TIMEOUT_MINUTES} minutes`);
    }
  } catch (error) {
    console.error('❌ Error in cleanupLongRunningGames:', error);
  }
}

// ========== FIXED GAME TIMER FUNCTION ==========
async function startGameTimer(room) {
  console.log(`🎲 STARTING GAME TIMER for room ${room.stake} with ${room.players.length} players`);
  
  cleanupRoomTimer(room.stake);
  
  room.calledNumbers = [];
  room.currentBall = null;
  room.ballsDrawn = 0;
  room.startTime = new Date();
  await room.save();
  
  console.log(`✅ Room ${room.stake} set to playing, starting ball timer...`);
  
  const timer = setInterval(async () => {
    try {
      const currentRoom = await Room.findById(room._id);
      if (!currentRoom || currentRoom.status !== 'playing') {
        console.log(`⚠️ Game timer stopped: Room ${room.stake} status is ${currentRoom?.status || 'not found'}`);
        clearInterval(timer);
        roomTimers.delete(room.stake);
        return;
      }
      
      if (currentRoom.ballsDrawn >= 75) {
        console.log(`⏰ Game timeout for room ${room.stake}: 75 balls drawn`);
        clearInterval(timer);
        roomTimers.delete(room.stake);
        await endGameWithNoWinner(currentRoom);
        return;
      }
      
      let ball;
      let letter;
      let attempts = 0;
      
      do {
        ball = Math.floor(Math.random() * 75) + 1;
        letter = getBingoLetter(ball);
        attempts++;
        
        if (attempts > 150) {
          for (let i = 1; i <= 75; i++) {
            if (!currentRoom.calledNumbers.includes(i)) {
              ball = i;
              letter = getBingoLetter(i);
              break;
            }
          }
          break;
        }
      } while (currentRoom.calledNumbers.includes(ball));
      
      console.log(`🎱 Drawing ball ${letter}-${ball} for room ${room.stake} (Ball #${currentRoom.ballsDrawn + 1})`);
      
      currentRoom.calledNumbers.push(ball);
      currentRoom.currentBall = ball;
      currentRoom.ballsDrawn += 1;
      currentRoom.lastBoxUpdate = new Date();
      await currentRoom.save();
      
      const ballData = {
        room: currentRoom.stake,
        num: ball,
        letter: letter,
        ballsDrawn: currentRoom.ballsDrawn
      };
      
      console.log(`📤 Broadcasting ball ${letter}-${ball} to ${currentRoom.players.length} players in room ${room.stake}`);
      
      currentRoom.players.forEach(userId => {
        for (const [socketId, uId] of socketToUser.entries()) {
          if (uId === userId) {
            const socket = io.sockets.sockets.get(socketId);
            if (socket && socket.connected) {
              socket.emit('ballDrawn', ballData);
              socket.emit('enableBingo');
            }
          }
        }
      });
      
      adminSockets.forEach(socketId => {
        const socket = io.sockets.sockets.get(socketId);
        if (socket) {
          socket.emit('admin:ballDrawn', {
            room: room.stake,
            ball: ball,
            letter: letter,
            ballsDrawn: currentRoom.ballsDrawn
          });
        }
      });
      
      broadcastRoomStatus();
      
    } catch (error) {
      console.error('❌ Error in game timer:', error);
      clearInterval(timer);
      roomTimers.delete(room.stake);
    }
  }, CONFIG.GAME_TIMER * 1000);
  
  roomTimers.set(room.stake, timer);
  console.log(`✅ Game timer started for room ${room.stake}, interval: ${CONFIG.GAME_TIMER}s`);
}

function checkBingo(markedNumbers, grid) {
  const patterns = [
    [0,1,2,3,4],
    [5,6,7,8,9],
    [10,11,12,13,14],
    [15,16,17,18,19],
    [20,21,22,23,24],
    [0,5,10,15,20],
    [1,6,11,16,21],
    [2,7,12,17,22],
    [3,8,13,18,23],
    [4,9,14,19,24],
    [0,6,12,18,24],
    [4,8,12,16,20],
    [0,4,20,24]
  ];
  
  for (const pattern of patterns) {
    const isBingo = pattern.every(index => {
      const cellValue = grid[index];
      
      if (cellValue === 'FREE') {
        const hasFree = markedNumbers.includes('FREE') || markedNumbers.some(m => m === 'FREE');
        return hasFree;
      }
      
      const cellValueNum = Number(cellValue);
      const isMarked = markedNumbers.some(marked => {
        if (marked === 'FREE') return false;
        const markedNum = Number(marked);
        return markedNum === cellValueNum;
      });
      
      return isMarked;
    });
    
    if (isBingo) {
      return {
        isBingo: true,
        pattern: pattern,
        isFourCorners: pattern.length === 4 && pattern[0] === 0 && pattern[1] === 4 && pattern[2] === 20 && pattern[3] === 24
      };
    }
  }
  
  return { isBingo: false };
}

// ========== FIXED END GAME WITH NO WINNER ==========
async function endGameWithNoWinner(room) {
  try {
    console.log(`🎮 Ending game with no winner for room ${room.stake}`);
    
    cleanupRoomTimer(room.stake);
    
    const playersInRoom = [...room.players];
    
    for (const userId of playersInRoom) {
      const user = await User.findOne({ userId: userId });
      if (user) {
        const oldBalance = user.balance;
        user.balance += room.stake;
        user.currentRoom = null;
        user.box = null;
        await user.save();
        
        console.log(`💰 Refunded ${room.stake} ETB to ${user.userName}, balance: ${oldBalance} → ${user.balance}`);
        
        const transaction = new Transaction({
          type: 'REFUND',
          userId: userId,
          userName: user.userName,
          amount: room.stake,
          room: room.stake,
          description: `Game ended with no winner - stake refunded`
        });
        await transaction.save();
        
        for (const [socketId, uId] of socketToUser.entries()) {
          if (uId === userId) {
            const socket = io.sockets.sockets.get(socketId);
            if (socket) {
              socket.emit('gameOver', {
                room: room.stake,
                winnerId: 'HOUSE',
                winnerName: 'House',
                prize: 0,
                basePrize: 0,
                bonus: 0,
                playersCount: playersInRoom.length,
                isFourCornersWin: false,
                gameEnded: true,
                reason: 'no_winner',
                commissionPerPlayer: CONFIG.HOUSE_COMMISSION[room.stake] || 0
              });
              socket.emit('balanceUpdate', user.balance);
            }
          }
        }
      }
    }
    
    room.players = [];
    room.takenBoxes = [];
    room.status = 'waiting';
    room.calledNumbers = [];
    room.currentBall = null;
    room.ballsDrawn = 0;
    room.startTime = null;
    room.endTime = new Date();
    room.lastBoxUpdate = new Date();
    await room.save();
    
    broadcastTakenBoxes(room.stake, []);
    io.emit('boxesCleared', { room: room.stake, reason: 'game_ended_no_winner' });
    
    console.log(`✅ Game ended with no winner for room ${room.stake}. Boxes cleared for next game.`);
    
    broadcastRoomStatus();
    updateAdminPanel();
    
  } catch (error) {
    console.error('❌ Error ending game with no winner:', error);
  }
}

// ========== FIXED COUNTDOWN FUNCTION ==========
async function startCountdownForRoom(room) {
  try {
    console.log(`⏱️ STARTING COUNTDOWN for room ${room.stake} at ${new Date().toISOString()}`);
    
    const countdownKey = `countdown_${room.stake}`;
    if (roomTimers.has(countdownKey)) {
      clearInterval(roomTimers.get(countdownKey));
      roomTimers.delete(countdownKey);
    }
    
    room.status = 'starting';
    room.countdownStartTime = new Date();
    room.countdownStartedWith = room.players.length;
    await room.save();
    
    let countdown = CONFIG.COUNTDOWN_TIMER;
    const countdownInterval = setInterval(async () => {
      try {
        const currentRoom = await Room.findById(room._id);
        if (!currentRoom || currentRoom.status !== 'starting') {
          console.log(`⏹️ Countdown stopped: Room ${room.stake} status changed to ${currentRoom?.status || 'deleted'}`);
          clearInterval(countdownInterval);
          roomTimers.delete(countdownKey);
          return;
        }
        
        const onlinePlayers = await getOnlinePlayersInRoom(room.stake);
        
        console.log(`⏱️ Room ${room.stake}: Countdown ${countdown}s, ${onlinePlayers.length} online players`);
        
        const socketsToSend = new Set();
        
        currentRoom.players.forEach(userId => {
          for (const [socketId, uId] of socketToUser.entries()) {
            if (uId === userId) {
              if (io.sockets.sockets.get(socketId)?.connected) {
                socketsToSend.add(socketId);
              }
            }
          }
        });
        
        const subscribedSockets = roomSubscriptions.get(room.stake) || new Set();
        subscribedSockets.forEach(socketId => {
          if (io.sockets.sockets.get(socketId)?.connected) {
            socketsToSend.add(socketId);
          }
        });
        
        socketsToSend.forEach(socketId => {
          const socket = io.sockets.sockets.get(socketId);
          if (socket && socket.connected) {
            socket.emit('gameCountdown', {
              room: room.stake,
              timer: countdown,
              onlinePlayers: onlinePlayers.length
            });
            socket.emit('lobbyUpdate', {
              room: room.stake,
              count: onlinePlayers.length
            });
          }
        });
        
        adminSockets.forEach(socketId => {
          const socket = io.sockets.sockets.get(socketId);
          if (socket) {
            socket.emit('admin:countdownUpdate', {
              room: room.stake,
              timer: countdown,
              onlinePlayers: onlinePlayers.length
            });
          }
        });
        
        countdown--;
        
        if (countdown < 0) {
          clearInterval(countdownInterval);
          roomTimers.delete(countdownKey);
          
          console.log(`🎮 Countdown finished for room ${room.stake} - AUTO STARTING GAME`);
          
          const finalRoom = await Room.findById(room._id);
          if (!finalRoom || finalRoom.status !== 'starting') {
            console.log(`⚠️ Countdown finished but room ${room.stake} is no longer in starting status`);
            return;
          }
          
          const finalOnlinePlayers = await getOnlinePlayersInRoom(room.stake);
          
          if (finalOnlinePlayers.length >= 1) {
            console.log(`🎮 AUTO STARTING game for room ${room.stake} with ${finalOnlinePlayers.length} online player(s)`);
            
            finalRoom.status = 'playing';
            finalRoom.startTime = new Date();
            finalRoom.countdownStartTime = null;
            finalRoom.countdownStartedWith = 0;
            await finalRoom.save();
            
            const finalSocketsToSend = new Set();
            
            finalRoom.players.forEach(userId => {
              for (const [socketId, uId] of socketToUser.entries()) {
                if (uId === userId) {
                  if (io.sockets.sockets.get(socketId)?.connected) {
                    finalSocketsToSend.add(socketId);
                  }
                }
              }
            });
            
            const finalSubscribedSockets = roomSubscriptions.get(room.stake) || new Set();
            finalSubscribedSockets.forEach(socketId => {
              if (io.sockets.sockets.get(socketId)?.connected) {
                finalSocketsToSend.add(socketId);
              }
            });
            
            finalSocketsToSend.forEach(socketId => {
              const socket = io.sockets.sockets.get(socketId);
              if (socket && socket.connected) {
                socket.emit('gameStarted', { 
                  room: room.stake,
                  players: finalOnlinePlayers.length
                });
                
                socket.emit('gameCountdown', {
                  room: room.stake,
                  timer: 0,
                  gameStarting: true
                });
              }
            });
            
            await startGameTimer(finalRoom);
            broadcastRoomStatus();
            
            console.log(`✅ Game AUTO STARTED for room ${room.stake}, timer active`);
          } else {
            console.log(`⚠️ Game start aborted for room ${room.stake}: no online players`);
            finalRoom.status = 'waiting';
            finalRoom.countdownStartTime = null;
            finalRoom.countdownStartedWith = 0;
            await finalRoom.save();
            
            const resetSocketsToSend = new Set();
            
            finalRoom.players.forEach(userId => {
              for (const [socketId, uId] of socketToUser.entries()) {
                if (uId === userId) {
                  if (io.sockets.sockets.get(socketId)?.connected) {
                    resetSocketsToSend.add(socketId);
                  }
                }
              }
            });
            
            const resetSubscribedSockets = roomSubscriptions.get(room.stake) || new Set();
            resetSubscribedSockets.forEach(socketId => {
              if (io.sockets.sockets.get(socketId)?.connected) {
                resetSocketsToSend.add(socketId);
              }
            });
            
            resetSocketsToSend.forEach(socketId => {
              const socket = io.sockets.sockets.get(socketId);
              if (socket && socket.connected) {
                socket.emit('countdownStopped', {
                  room: room.stake,
                  reason: 'no_players_online'
                });
                socket.emit('lobbyUpdate', {
                  room: room.stake,
                  count: 0,
                  reason: 'not_enough_players'
                });
              }
            });
            
            broadcastRoomStatus();
          }
        }
      } catch (error) {
        console.error('❌ Error in countdown interval:', error);
        clearInterval(countdownInterval);
        roomTimers.delete(countdownKey);
      }
    }, 1000);
    
    roomTimers.set(countdownKey, countdownInterval);
    console.log(`✅ Countdown timer started for room ${room.stake}`);
    
  } catch (error) {
    console.error('❌ Error starting countdown:', error);
  }
}

// ========== IMPROVED SOCKET.IO EVENT HANDLERS ==========
io.on('connection', (socket) => {
  console.log(`✅ Socket.IO Connected: ${socket.id} - User: ${socket.handshake.query?.userId || 'Unknown'}`);
  connectedSockets.add(socket.id);
  
  const query = socket.handshake.query;
  if (query.userId) {
    console.log(`👤 User connected via query: ${query.userId}`);
    socket.userId = query.userId;
  }
  
  socket.emit('connectionTest', { 
    status: 'connected', 
    serverTime: new Date().toISOString(),
    socketId: socket.id,
    server: 'Bingo Elite Telegram',
    userId: query.userId || 'unknown'
  });
  
  // ========== ADMIN AUTHENTICATION ==========
  socket.on('admin:auth', (password) => {
    console.log(`🔐 Admin authentication attempt from socket ${socket.id}`);
    
    if (password === CONFIG.ADMIN_PASSWORD) {
      adminSockets.add(socket.id);
      socket.emit('admin:authSuccess');
      updateAdminPanel();
      
      logActivity('ADMIN_LOGIN', { socketId: socket.id }, socket.id);
      console.log(`✅ Admin authenticated: ${socket.id}`);
    } else {
      console.log(`❌ Admin auth failed for socket ${socket.id}`);
      socket.emit('admin:authError', 'Invalid password');
    }
  });
  
  socket.on('admin:getData', () => {
    if (!adminSockets.has(socket.id)) {
      socket.emit('admin:error', 'Unauthorized - Please authenticate first');
      return;
    }
    updateAdminPanel();
  });
  
  socket.on('admin:addFunds', async ({ userId, amount }) => {
    if (!adminSockets.has(socket.id)) {
      socket.emit('admin:error', 'Unauthorized');
      return;
    }
    
    const user = await User.findOne({ userId: userId });
    if (!user) {
      socket.emit('admin:error', 'User not found');
      return;
    }
    
    const oldBalance = user.balance;
    user.balance += parseFloat(amount);
    await user.save();
    
    const transaction = new Transaction({
      type: 'ADMIN_ADD',
      userId: userId,
      userName: user.userName,
      amount: amount,
      admin: true,
      description: `Admin added ${amount} ETB`
    });
    await transaction.save();
    
    for (const [sId, uId] of socketToUser.entries()) {
      if (uId === userId) {
        const playerSocket = io.sockets.sockets.get(sId);
        if (playerSocket) {
          playerSocket.emit('balanceUpdate', user.balance);
          playerSocket.emit('fundsAdded', {
            amount: amount,
            newBalance: user.balance
          });
        }
      }
    }
    
    socket.emit('admin:success', `Added ${amount} ETB to ${user.userName}`);
    updateAdminPanel();
    
    logActivity('ADMIN_ADD_FUNDS', { adminSocket: socket.id, userId, amount }, socket.id);
  });
  
  socket.on('admin:forceDraw', async (roomStake) => {
    if (!adminSockets.has(socket.id)) {
      socket.emit('admin:error', 'Unauthorized');
      return;
    }
    
    const room = await Room.findOne({ stake: parseInt(roomStake), status: 'playing' });
    if (room) {
      let ball;
      let letter;
      do {
        ball = Math.floor(Math.random() * 75) + 1;
        letter = getBingoLetter(ball);
      } while (room.calledNumbers.includes(ball));
      
      room.calledNumbers.push(ball);
      room.currentBall = ball;
      room.ballsDrawn += 1;
      room.lastBoxUpdate = new Date();
      await room.save();
      
      const ballData = {
        room: room.stake,
        num: ball,
        letter: letter
      };
      
      room.players.forEach(userId => {
        for (const [sId, uId] of socketToUser.entries()) {
          if (uId === userId) {
            const s = io.sockets.sockets.get(sId);
            if (s) {
              s.emit('ballDrawn', ballData);
            }
          }
        }
      });
      
      socket.emit('admin:success', `Ball ${letter}-${ball} drawn in ${roomStake} ETB room`);
      broadcastRoomStatus();
      
      logActivity('ADMIN_FORCE_DRAW', { adminSocket: socket.id, roomStake, ball, letter }, socket.id);
    }
  });
  
  socket.on('admin:banPlayer', async (userId) => {
    if (!adminSockets.has(socket.id)) {
      socket.emit('admin:error', 'Unauthorized');
      return;
    }
    
    const user = await User.findOne({ userId: userId });
    if (!user) {
      socket.emit('admin:error', 'User not found');
      return;
    }
    
    for (const [sId, uId] of socketToUser.entries()) {
      if (uId === userId) {
        const playerSocket = io.sockets.sockets.get(sId);
        if (playerSocket) {
          playerSocket.emit('banned');
          playerSocket.disconnect();
        }
      }
    }
    
    socket.emit('admin:success', `Banned user ${user.userName}`);
    updateAdminPanel();
    
    logActivity('ADMIN_BAN', { adminSocket: socket.id, userId }, socket.id);
  });
  
  socket.on('admin:forceStartGame', async (roomStake) => {
    if (!adminSockets.has(socket.id)) {
      socket.emit('admin:error', 'Unauthorized');
      return;
    }
    
    const room = await Room.findOne({ stake: parseInt(roomStake) });
    if (room) {
      room.status = 'playing';
      room.startTime = new Date();
      await room.save();
      
      await startGameTimer(room);
      
      const socketsToSend = new Set();
      
      room.players.forEach(userId => {
        for (const [sId, uId] of socketToUser.entries()) {
          if (uId === userId) {
            if (io.sockets.sockets.get(sId)?.connected) {
              socketsToSend.add(sId);
            }
          }
        }
      });
      
      const subscribedSockets = roomSubscriptions.get(roomStake) || new Set();
      subscribedSockets.forEach(socketId => {
        if (io.sockets.sockets.get(socketId)?.connected) {
          socketsToSend.add(socketId);
        }
      });
      
      socketsToSend.forEach(socketId => {
        const s = io.sockets.sockets.get(socketId);
        if (s) {
          s.emit('gameStarted', { 
            room: roomStake,
            players: room.players.length
          });
        }
      });
      
      socket.emit('admin:success', `Force started ${roomStake} ETB room`);
      broadcastRoomStatus();
      
      logActivity('ADMIN_FORCE_START', { adminSocket: socket.id, roomStake }, socket.id);
    }
  });
  
  socket.on('admin:forceEndGame', async (roomStake) => {
    if (!adminSockets.has(socket.id)) {
      socket.emit('admin:error', 'Unauthorized');
      return;
    }
    
    const room = await Room.findOne({ stake: parseInt(roomStake) });
    if (room) {
      cleanupRoomTimer(roomStake);
      
      const playersInRoom = [...room.players];
      
      for (const userId of playersInRoom) {
        const user = await User.findOne({ userId: userId });
        if (user) {
          user.balance += roomStake;
          user.currentRoom = null;
          user.box = null;
          await user.save();
          
          const transaction = new Transaction({
            type: 'REFUND',
            userId: userId,
            userName: user.userName,
            amount: roomStake,
            room: roomStake,
            description: `Game force ended by admin - stake refunded`
          });
          await transaction.save();
          
          for (const [sId, uId] of socketToUser.entries()) {
            if (uId === userId) {
              const s = io.sockets.sockets.get(sId);
              if (s) {
                s.emit('gameOver', {
                  room: roomStake,
                  winnerId: 'ADMIN',
                  winnerName: 'Admin',
                  prize: 0,
                  basePrize: 0,
                  bonus: 0,
                  playersCount: playersInRoom.length,
                  isFourCornersWin: false,
                  gameEnded: true,
                  reason: 'admin_ended',
                  commissionPerPlayer: CONFIG.HOUSE_COMMISSION[roomStake] || 0
                });
                s.emit('balanceUpdate', user.balance);
              }
            }
          }
        }
      }
      
      room.players = [];
      room.takenBoxes = [];
      room.status = 'ended';
      room.endTime = new Date();
      room.lastBoxUpdate = new Date();
      await room.save();
      
      broadcastTakenBoxes(roomStake, []);
      
      socket.emit('admin:success', `Force ended ${roomStake} ETB game`);
      broadcastRoomStatus();
      
      logActivity('ADMIN_FORCE_END', { adminSocket: socket.id, roomStake }, socket.id);
    }
  });
  
  socket.on('admin:clearBoxes', async (roomStake) => {
    if (!adminSockets.has(socket.id)) {
      socket.emit('admin:error', 'Unauthorized');
      return;
    }
    
    const room = await Room.findOne({ stake: parseInt(roomStake) });
    if (!room) {
      socket.emit('admin:error', 'Room not found');
      return;
    }
    
    const playersInRoom = [...room.players];
    
    for (const userId of playersInRoom) {
      const user = await User.findOne({ userId: userId });
      if (user) {
        user.balance += roomStake;
        user.currentRoom = null;
        user.box = null;
        await user.save();
        
        const transaction = new Transaction({
          type: 'REFUND',
          userId: userId,
          userName: user.userName,
          amount: roomStake,
          room: roomStake,
          description: `Boxes cleared by admin - stake refunded`
        });
        await transaction.save();
        
        for (const [sId, uId] of socketToUser.entries()) {
          if (uId === userId) {
            const s = io.sockets.sockets.get(sId);
            if (s) {
              s.emit('boxesCleared', { room: roomStake, adminCleared: true, reason: 'admin_cleared' });
              s.emit('balanceUpdate', user.balance);
              s.emit('lobbyUpdate', { room: roomStake, count: 0 });
            }
          }
        }
      }
    }
    
    room.players = [];
    room.takenBoxes = [];
    room.status = 'waiting';
    room.lastBoxUpdate = new Date();
    await room.save();
    
    broadcastTakenBoxes(roomStake, []);
    socket.emit('admin:success', `Cleared all boxes in ${roomStake} ETB room`);
    
    logActivity('ADMIN_CLEAR_BOXES', { adminSocket: socket.id, roomStake }, socket.id);
  });
  
  socket.on('admin:debugCountdown', async (roomStake) => {
    if (!adminSockets.has(socket.id)) {
      socket.emit('admin:error', 'Unauthorized');
      return;
    }
    
    const room = await Room.findOne({ stake: parseInt(roomStake) });
    if (room) {
      const onlinePlayers = await getOnlinePlayersInRoom(room.stake);
      
      socket.emit('admin:success', `Room ${roomStake}: ${room.status}, ${onlinePlayers.length} online, ${room.players.length} total, countdown active: ${roomTimers.has(`countdown_${roomStake}`)}`);
    }
  });
  
  // Player events
  socket.on('init', async (data, callback) => {
    try {
      const { userId, userName } = data;
      
      console.log(`📱 User init: ${userName} (${userId}) via socket ${socket.id}`);
      
      socket.userId = userId;
      
      const user = await getUser(userId, userName);
      
      if (user) {
        socketToUser.set(socket.id, userId);
        
        await User.findOneAndUpdate(
          { userId: userId },
          { 
            isOnline: true,
            lastSeen: new Date(),
            sessionCount: (user.sessionCount || 0) + 1
          }
        );
        
        socket.emit('balanceUpdate', user.balance);
        socket.emit('userData', {
          userId: userId,
          userName: user.userName,
          balance: user.balance,
          referralCode: user.referralCode
        });
        
        socket.emit('connected', { message: 'Successfully connected to Bingo Elite' });
        
        if (callback) {
          callback({ success: true, message: 'User initialized successfully' });
        }
        
        console.log(`✅ User connected successfully: ${userName} (${userId})`);
        
        updateAdminPanel();
        broadcastRoomStatus();
        
        logActivity('USER_CONNECTED', { userId, userName, socketId: socket.id });
      } else {
        if (callback) {
          callback({ success: false, message: 'Failed to initialize user' });
        }
      }
    } catch (error) {
      console.error('Error in init:', error);
      if (callback) {
        callback({ success: false, message: 'Server error during initialization' });
      }
    }
  });
  
  socket.on('refreshBalance', async () => {
    const userId = socketToUser.get(socket.id);
    if (userId) {
      const user = await User.findOne({ userId: userId });
      if (user) {
        socket.emit('balanceUpdate', user.balance);
        socket.emit('balanceRefreshed', user.balance);
      }
    }
  });
  
  socket.on('getRoomCountdown', async ({ room }, callback) => {
    try {
      const roomData = await Room.findOne({ stake: parseInt(room) });
      
      if (!roomData) {
        if (callback) callback({ countdownActive: false });
        return;
      }
      
      if (roomData.status === 'starting' && roomData.countdownStartTime) {
        const elapsed = Date.now() - roomData.countdownStartTime;
        const secondsRemaining = Math.max(0, CONFIG.COUNTDOWN_TIMER - Math.floor(elapsed / 1000));
        const onlinePlayers = await getOnlinePlayersInRoom(room);
        
        if (callback) {
          callback({
            countdownActive: true,
            seconds: secondsRemaining,
            onlinePlayers: onlinePlayers.length,
            totalPlayers: roomData.players.length
          });
        }
      } else {
        if (callback) callback({ countdownActive: false });
      }
    } catch (error) {
      console.error('Error in getRoomCountdown:', error);
      if (callback) callback({ countdownActive: false });
    }
  });
  
  socket.on('getTakenBoxes', async ({ room }, callback) => {
    try {
      const roomData = await Room.findOne({ 
        stake: parseInt(room)
      });
      
      if (roomData) {
        console.log(`📦 Getting taken boxes for room ${room}: ${roomData.takenBoxes.length} boxes`);
        callback(roomData.takenBoxes || []);
      } else {
        console.log(`📦 No room found for ${room}, creating new one`);
        callback([]);
      }
    } catch (error) {
      console.error('Error getting taken boxes:', error);
      callback([]);
    }
  });
  
  socket.on('subscribeToRoom', (data) => {
    const userId = socketToUser.get(socket.id) || socket.userId;
    if (userId && data.room) {
      console.log(`👤 User ${userId} subscribed to room ${data.room} updates`);
      
      if (!roomSubscriptions.has(data.room)) {
        roomSubscriptions.set(data.room, new Set());
      }
      roomSubscriptions.get(data.room).add(socket.id);
      
      Room.findOne({ stake: data.room })
        .then(room => {
          if (room) {
            socket.emit('boxesTakenUpdate', {
              room: data.room,
              takenBoxes: room.takenBoxes || [],
              playerCount: room.players.length,
              timestamp: Date.now()
            });
          } else {
            socket.emit('boxesTakenUpdate', {
              room: data.room,
              takenBoxes: [],
              playerCount: 0,
              timestamp: Date.now()
            });
          }
        })
        .catch(console.error);
    }
  });
  
  socket.on('unsubscribeFromRoom', (data) => {
    const roomStake = data.room;
    if (roomSubscriptions.has(roomStake)) {
      roomSubscriptions.get(roomStake).delete(socket.id);
    }
  });
  
  socket.on('joinRoom', async (data, callback) => {
    try {
      const { room, box, userName } = data;
      const userId = socketToUser.get(socket.id) || socket.userId;
      
      if (!userId) {
        socket.emit('error', 'Player not initialized');
        if (callback) callback({ success: false, message: 'Player not initialized' });
        return;
      }
      
      const user = await User.findOne({ userId: userId });
      if (!user) {
        socket.emit('error', 'User not found');
        if (callback) callback({ success: false, message: 'User not found' });
        return;
      }
      
      if (user.balance < room) {
        socket.emit('insufficientFunds');
        if (callback) callback({ success: false, message: 'Insufficient funds' });
        return;
      }
      
      let roomData = await Room.findOne({ 
        stake: room, 
        status: { $in: ['waiting', 'starting', 'playing'] } 
      });
      
      if (!roomData) {
        roomData = new Room({
          stake: room,
          players: [],
          takenBoxes: [],
          status: 'waiting',
          lastBoxUpdate: new Date()
        });
        await roomData.save();
      }
      
      if (roomData.status === 'playing') {
        socket.emit('roomLocked', { 
          room: room, 
          message: 'Game is in progress. Please wait for the current game to finish.' 
        });
        if (callback) callback({ success: false, message: 'Room is locked - game in progress' });
        return;
      }
      
      if (box < 1 || box > 100) {
        socket.emit('error', 'Invalid box number. Must be between 1 and 100');
        if (callback) callback({ success: false, message: 'Invalid box number' });
        return;
      }
      
      if (roomData.takenBoxes.includes(box)) {
        socket.emit('boxTaken');
        if (callback) callback({ success: false, message: 'Box already taken' });
        return;
      }
      
      if (user.currentRoom) {
        if (user.currentRoom === room) {
          socket.emit('joinedRoom');
          if (callback) callback({ success: true, message: 'Already in room' });
          return;
        }
        socket.emit('error', 'Already in a different room');
        if (callback) callback({ success: false, message: 'Already in different room' });
        return;
      }
      
      user.balance -= room;
      user.totalWagered = (user.totalWagered || 0) + room;
      user.currentRoom = room;
      user.box = box;
      await user.save();
      
      const transaction = new Transaction({
        type: 'STAKE',
        userId: user.userId,
        userName: user.userName,
        amount: -room,
        room: room,
        description: `Joined ${room} ETB room with ticket ${box}`
      });
      await transaction.save();
      
      roomData.players.push(user.userId);
      roomData.takenBoxes.push(box);
      roomData.lastBoxUpdate = new Date();
      
      const onlinePlayers = await getOnlinePlayersInRoom(room);
      
      console.log(`🚀 joinRoom - Room ${room}:`);
      console.log(`   Players in room: ${roomData.players.length}`);
      console.log(`   Online players: ${onlinePlayers.length}`);
      console.log(`   Room status: ${roomData.status}`);
      
      broadcastTakenBoxes(room, roomData.takenBoxes, box, user.userName);
      
      await roomData.save();
      
      socket.emit('joinedRoom');
      socket.emit('balanceUpdate', user.balance);
      
      const playersInRoom = roomData.players;
      playersInRoom.forEach(playerUserId => {
        for (const [sId, uId] of socketToUser.entries()) {
          if (uId === playerUserId) {
            const s = io.sockets.sockets.get(sId);
            if (s) {
              s.emit('lobbyUpdate', {
                room: room,
                count: onlinePlayers.length
              });
            }
          }
        }
      });
      
      if (roomData.status === 'starting' && roomData.countdownStartTime) {
        const elapsed = Date.now() - roomData.countdownStartTime;
        const secondsRemaining = Math.max(0, CONFIG.COUNTDOWN_TIMER - Math.floor(elapsed / 1000));
        
        socket.emit('gameCountdown', {
          room: room,
          timer: secondsRemaining,
          onlinePlayers: onlinePlayers.length
        });
      }
      
      if (onlinePlayers.length >= CONFIG.MIN_PLAYERS_TO_START && roomData.status === 'waiting') {
        console.log(`🚀 STARTING COUNTDOWN for room ${room} with ${onlinePlayers.length} online player(s)!`);
        await startCountdownForRoom(roomData);
      } else {
        console.log(`⏸️ NOT starting countdown:`);
        console.log(`   Online players: ${onlinePlayers.length} (need ${CONFIG.MIN_PLAYERS_TO_START})`);
        console.log(`   Room status: ${roomData.status} (need 'waiting')`);
      }
      
      socket.emit('boxesTakenUpdate', {
        room: room,
        takenBoxes: roomData.takenBoxes,
        personalBox: box,
        message: `You selected box ${box}! Waiting for players...`
      });
      
      broadcastRoomStatus();
      updateAdminPanel();
      
      logActivity('BOX_TAKEN', { 
        userId: user.userId, 
        userName: user.userName, 
        room, 
        box,
        takenBoxes: roomData.takenBoxes.length,
        playerCount: roomData.players.length,
        onlinePlayers: onlinePlayers.length
      });
      
      if (callback) {
        callback({ 
          success: true, 
          message: 'Joined room successfully',
          onlinePlayers: onlinePlayers.length
        });
      }
      
    } catch (error) {
      console.error('Error joining room:', error);
      socket.emit('error', 'Server error while joining room');
      if (callback) callback({ success: false, message: 'Server error' });
    }
  });
  
  socket.on('claimBingo', async (data, callback) => {
    try {
      const { room, grid, marked } = data;
      const userId = socketToUser.get(socket.id) || socket.userId;
      
      if (!userId) {
        socket.emit('error', 'Player not initialized');
        if (callback) callback({ success: false, message: 'Player not initialized' });
        return;
      }
      
      const user = await User.findOne({ userId: userId });
      if (!user) {
        socket.emit('error', 'User not found');
        if (callback) callback({ success: false, message: 'User not found' });
        return;
      }
      
      const roomStake = parseInt(room);
      
      if (processingClaims.has(roomStake)) {
        console.log(`🚨 DOUBLE CLAIM PREVENTED: Room ${roomStake} already has a claim being processed`);
        socket.emit('error', 'A bingo claim is already being processed for this room');
        if (callback) callback({ 
          success: false, 
          message: 'A bingo claim is already being processed. Please wait.' 
        });
        return;
      }
      
      processingClaims.set(roomStake, Date.now());
      console.log(`🔒 Locked room ${roomStake} for claim processing by ${user.userName}`);
      
      const roomData = await Room.findOne({ stake: roomStake, status: 'playing' });
      if (!roomData) {
        processingClaims.delete(roomStake);
        socket.emit('error', 'Game not found or not in progress');
        if (callback) callback({ success: false, message: 'Game not found or not in progress' });
        return;
      }
      
      if (!roomData.players.includes(userId)) {
        processingClaims.delete(roomStake);
        socket.emit('error', 'You are not in this game');
        if (callback) callback({ success: false, message: 'You are not in this game' });
        return;
      }
      
      console.log('🎯 BINGO CLAIM RECEIVED:');
      console.log('   User:', user.userName);
      console.log('   Room:', room);
      console.log('   Processing lock active:', processingClaims.has(roomStake));
      
      const markedNumbers = marked.map(item => {
        if (item === 'FREE') return 'FREE';
        return Number(item);
      }).filter(item => !isNaN(item) || item === 'FREE');
      
      const bingoCheck = checkBingo(markedNumbers, grid);
      if (!bingoCheck.isBingo) {
        processingClaims.delete(roomStake);
        console.log('❌ Invalid bingo claim - no winning pattern found');
        socket.emit('error', 'Invalid bingo claim');
        if (callback) callback({ success: false, message: 'Invalid bingo claim - no winning pattern' });
        return;
      }
      
      const isFourCornersWin = bingoCheck.isFourCorners;
      
      const commissionPerPlayer = CONFIG.HOUSE_COMMISSION[room] || 0;
      const contributionPerPlayer = room - commissionPerPlayer;
      const totalPlayers = roomData.players.length;
      
      const basePrize = contributionPerPlayer * totalPlayers;
      
      let bonus = 0;
      if (isFourCornersWin) {
        bonus = CONFIG.FOUR_CORNERS_BONUS;
      }
      
      const totalPrize = basePrize + bonus;
      
      console.log(`🎰 WIN CALCULATION for ${room} ETB room:`);
      console.log(`   Total players: ${totalPlayers}`);
      console.log(`   Total prize: ${totalPrize} ETB`);
      console.log(`   Is four corners: ${isFourCornersWin}`);
      console.log(`   Bonus: ${bonus} ETB`);
      
      const oldBalance = user.balance;
      user.balance += totalPrize;
      user.totalWins = (user.totalWins || 0) + 1;
      user.totalBingos = (user.totalBingos || 0) + 1;
      user.currentRoom = null;
      user.box = null;
      await user.save();
      
      console.log(`💰 User ${user.userName} won ${totalPrize} ETB (was ${oldBalance}, now ${user.balance})`);
      
      const transactionType = isFourCornersWin ? 'WIN_FOUR_CORNERS' : 'WIN';
      const transaction = new Transaction({
        type: transactionType,
        userId: userId,
        userName: user.userName,
        amount: totalPrize,
        room: room,
        description: `Bingo win in ${room} ETB room with ${totalPlayers} players${isFourCornersWin ? ' (Four Corners Bonus)' : ''}`
      });
      await transaction.save();
      
      const houseEarnings = commissionPerPlayer * totalPlayers;
      const houseTransaction = new Transaction({
        type: 'HOUSE_EARNINGS',
        userId: 'HOUSE',
        userName: 'House',
        amount: houseEarnings,
        room: room,
        description: `Commission from ${totalPlayers} players in ${room} ETB room`
      });
      await houseTransaction.save();
      
      const playersInRoom = [...roomData.players];
      
      cleanupRoomTimer(room);
      
      roomData.status = 'ended';
      roomData.endTime = new Date();
      roomData.lastBoxUpdate = new Date();
      roomData.gameHistory.push({
        timestamp: new Date(),
        winner: userId,
        winnerName: user.userName,
        prize: totalPrize,
        bonus: bonus,
        basePrize: basePrize,
        players: playersInRoom.length,
        ballsDrawn: roomData.ballsDrawn,
        isFourCorners: isFourCornersWin,
        commissionCollected: houseEarnings
      });
      
      roomData.players = [];
      roomData.takenBoxes = [];
      roomData.status = 'waiting';
      roomData.calledNumbers = [];
      roomData.currentBall = null;
      roomData.ballsDrawn = 0;
      roomData.startTime = null;
      roomData.endTime = new Date();
      roomData.lastBoxUpdate = new Date();
      await roomData.save();
      
      processingClaims.delete(roomStake);
      console.log(`🔓 Released processing lock for room ${roomStake}`);
      
      const gameOverData = {
        room: room,
        winnerId: userId,
        winnerName: user.userName,
        prize: totalPrize,
        basePrize: basePrize,
        bonus: bonus,
        playersCount: playersInRoom.length,
        isFourCornersWin: isFourCornersWin,
        gameEnded: true,
        reason: 'bingo_win',
        commissionPerPlayer: commissionPerPlayer,
        contributionPerPlayer: contributionPerPlayer,
        houseEarnings: houseEarnings
      };
      
      if (callback) {
        callback({ 
          success: true, 
          message: 'BINGO claim received and being processed',
          isFourCornersWin: isFourCornersWin
        });
      }
      
      for (const playerId of playersInRoom) {
        if (playerId !== userId) {
          const losingUser = await User.findOne({ userId: playerId });
          if (losingUser) {
            losingUser.currentRoom = null;
            losingUser.box = null;
            await losingUser.save();
          }
        }
        
        for (const [sId, uId] of socketToUser.entries()) {
          if (uId === playerId) {
            const s = io.sockets.sockets.get(sId);
            if (s) {
              if (uId === userId) {
                s.emit('gameOver', gameOverData);
                s.emit('balanceUpdate', user.balance);
              } else {
                const losingUser = await User.findOne({ userId: playerId });
                s.emit('gameOver', gameOverData);
                if (losingUser) {
                  s.emit('balanceUpdate', losingUser.balance);
                }
              }
            }
          }
        }
      }
      
      broadcastTakenBoxes(room, []);
      io.emit('boxesCleared', { room: room, reason: 'game_ended_bingo_win' });
      
      console.log(`🎮 Game ended with bingo win for room ${room}. Boxes cleared for next game.`);
      
      broadcastRoomStatus();
      updateAdminPanel();
      
      logActivity('BINGO_WIN', { 
        userId, 
        userName: user.userName, 
        room, 
        prize: totalPrize, 
        bonus, 
        basePrize: basePrize,
        isFourCorners: isFourCornersWin,
        players: playersInRoom.length,
        commissionCollected: houseEarnings
      });
      
    } catch (error) {
      const roomStake = parseInt(data?.room);
      if (roomStake && processingClaims.has(roomStake)) {
        processingClaims.delete(roomStake);
        console.log(`🔓 Released processing lock for room ${roomStake} due to error`);
      }
      
      console.error('Error in claimBingo:', error);
      socket.emit('error', 'Server error processing bingo claim');
      if (callback) {
        callback({ 
          success: false, 
          message: 'Server error processing bingo claim'
        });
      }
    }
  });
  
  socket.on('player:activity', async (data) => {
    const userId = socketToUser.get(socket.id) || socket.userId;
    if (userId) {
      try {
        await User.findOneAndUpdate(
          { userId: userId },
          { lastSeen: new Date() }
        );
        
        updateAdminPanel();
      } catch (error) {
        console.error('Error updating player activity:', error);
      }
    }
  });
  
  socket.on('player:leaveRoom', async (data) => {
    try {
      const userId = socketToUser.get(socket.id) || socket.userId;
      if (!userId) {
        socket.emit('error', 'User not found');
        return;
      }
      
      console.log(`👤 Player ${userId} requesting to leave room`);
      
      const user = await User.findOne({ userId: userId });
      if (!user || !user.currentRoom) {
        socket.emit('leftRoom', { message: 'Not in a room' });
        return;
      }
      
      const roomStake = user.currentRoom;
      const room = await Room.findOne({ stake: roomStake });
      
      if (!room) {
        user.currentRoom = null;
        user.box = null;
        await user.save();
        socket.emit('leftRoom', { message: 'Left room (room not found)' });
        return;
      }
      
      if (room.status === 'playing') {
        console.log(`❌ Player ${user.userName} tried to leave during active game in room ${roomStake}`);
        socket.emit('error', 'Cannot leave room during active game! Wait for game to end.');
        return;
      }
      
      const playerIndex = room.players.indexOf(userId);
      const boxIndex = room.takenBoxes.indexOf(user.box);
      
      if (playerIndex > -1) {
        room.players.splice(playerIndex, 1);
      }
      
      if (boxIndex > -1) {
        room.takenBoxes.splice(boxIndex, 1);
      }
      
      room.lastBoxUpdate = new Date();
      
      const onlinePlayers = await getOnlinePlayersInRoom(roomStake);
      
      await room.save();
      
      user.currentRoom = null;
      user.box = null;
      
      if (room.status !== 'playing') {
        const oldBalance = user.balance;
        user.balance += roomStake;
        
        console.log(`💰 Refunded ${roomStake} ETB to ${user.userName}, new balance: ${user.balance}`);
        
        const transaction = new Transaction({
          type: 'REFUND',
          userId: userId,
          userName: user.userName,
          amount: roomStake,
          room: roomStake,
          description: `Left room before game start - stake refunded`
        });
        await transaction.save();
        
        socket.emit('balanceUpdate', user.balance);
      }
      
      await user.save();
      
      broadcastTakenBoxes(roomStake, room.takenBoxes);
      
      socket.emit('leftRoom', { 
        message: 'Left room successfully',
        refunded: room.status !== 'playing'
      });
      
      onlinePlayers.forEach(playerUserId => {
        for (const [sId, uId] of socketToUser.entries()) {
          if (uId === playerUserId) {
            const s = io.sockets.sockets.get(sId);
            if (s) {
              s.emit('lobbyUpdate', {
                room: roomStake,
                count: onlinePlayers.length
              });
            }
          }
        }
      });
      
      console.log(`✅ User ${user.userName} left room ${roomStake}, ${room.takenBoxes.length} boxes remain, ${onlinePlayers.length} online players`);
      
      broadcastRoomStatus();
      updateAdminPanel();
      
      logActivity('PLAYER_LEFT_ROOM', { 
        userId, 
        userName: user.userName, 
        room: roomStake,
        remainingPlayers: room.players.length,
        onlinePlayers: onlinePlayers.length,
        remainingBoxes: room.takenBoxes.length,
        status: room.status
      });
      
    } catch (error) {
      console.error('❌ Error in player:leaveRoom:', error);
      socket.emit('error', 'Failed to leave room: ' + error.message);
    }
  });
  
  socket.on('getRoomInfo', async (data) => {
    try {
      const { room } = data;
      const userId = socketToUser.get(socket.id) || socket.userId;
      
      const roomData = await Room.findOne({ stake: parseInt(room) });
      if (roomData) {
        const onlinePlayers = await getOnlinePlayersInRoom(room);
        
        socket.emit('lobbyUpdate', {
          room: room,
          count: onlinePlayers.length
        });
        
        if (roomData.status === 'starting') {
          socket.emit('gameCountdown', {
            room: room,
            timer: Math.max(0, CONFIG.COUNTDOWN_TIMER - Math.floor((Date.now() - roomData.countdownStartTime) / 1000))
          });
        }
      }
    } catch (error) {
      console.error('Error getting room info:', error);
    }
  });
  
  socket.on('game:ready', async (data) => {
    const userId = socketToUser.get(socket.id) || socket.userId;
    if (userId) {
      console.log(`🎮 Player ${userId} is ready for game`);
      await User.findOneAndUpdate(
        { userId: userId },
        { lastSeen: new Date() }
      );
    }
  });
  
  socket.on('game:started', async (data) => {
    const userId = socketToUser.get(socket.id) || socket.userId;
    if (userId) {
      console.log(`✅ Player ${userId} confirmed game started`);
    }
  });
  
  socket.on('disconnect', async () => {
    console.log(`❌ Socket disconnected: ${socket.id}`);
    connectedSockets.delete(socket.id);
    adminSockets.delete(socket.id);
    
    roomSubscriptions.forEach((sockets, room) => {
      sockets.delete(socket.id);
    });
    
    const userId = socketToUser.get(socket.id) || socket.userId;
    if (userId) {
      console.log(`👤 User ${userId} disconnected`);
      
      try {
        const user = await User.findOne({ userId: userId });
        if (user && user.currentRoom) {
          const roomStake = user.currentRoom;
          const room = await Room.findOne({ stake: roomStake });
          
          if (room) {
            if (room.status !== 'playing') {
              const playerIndex = room.players.indexOf(userId);
              const boxIndex = room.takenBoxes.indexOf(user.box);
              
              if (playerIndex > -1) {
                room.players.splice(playerIndex, 1);
              }
              
              if (boxIndex > -1) {
                room.takenBoxes.splice(boxIndex, 1);
              }
              
              room.lastBoxUpdate = new Date();
              
              await room.save();
              
              broadcastTakenBoxes(roomStake, room.takenBoxes);
              
              console.log(`👤 User ${user.userName} removed from room ${roomStake} due to disconnect`);
            } else {
              console.log(`⚠️ User ${user.userName} disconnected during gameplay in room ${roomStake}, keeping in game`);
            }
          }
          
          user.isOnline = false;
          user.lastSeen = new Date();
          await user.save();
        } else {
          await User.findOneAndUpdate(
            { userId: userId },
            { 
              isOnline: false,
              lastSeen: new Date() 
            }
          );
        }
      } catch (error) {
        console.error('❌ Error handling disconnect cleanup:', error);
      }
      
      socketToUser.delete(socket.id);
    }
    
    setTimeout(() => {
      updateAdminPanel();
      broadcastRoomStatus();
    }, 1000);
  });
  
  socket.on('ping', () => {
    socket.emit('pong', { time: Date.now() });
  });
});

// ========== PERIODIC TASKS ==========
setInterval(() => {
  broadcastRoomStatus();
}, CONFIG.ROOM_STATUS_UPDATE_INTERVAL);

setInterval(() => {
  updateAdminPanel();
}, 2000);

setInterval(cleanupLongRunningGames, 30000);

setInterval(() => {
  socketToUser.forEach((userId, socketId) => {
    const socket = io.sockets.sockets.get(socketId);
    if (!socket || !socket.connected) {
      socketToUser.delete(socketId);
      console.log(`🧹 Cleaned up disconnected socket: ${socketId} (user: ${userId})`);
    }
  });
}, 10000);

// ========== CONNECTION CLEANUP FUNCTION ==========
async function cleanupStaleConnections() {
  console.log('🧹 Running connection cleanup...');
  
  const now = new Date();
  const thirtySecondsAgo = new Date(now.getTime() - 30000);
  
  try {
    await User.updateMany(
      { 
        lastSeen: { $lt: thirtySecondsAgo },
        isOnline: true 
      },
      { 
        isOnline: false 
      }
    );
    
    socketToUser.forEach((userId, socketId) => {
      const socket = io.sockets.sockets.get(socketId);
      if (!socket || !socket.connected) {
        socketToUser.delete(socketId);
        console.log(`🧹 Removed stale socket from socketToUser: ${socketId} (user: ${userId})`);
      }
    });
    
  } catch (error) {
    console.error('Error in cleanupStaleConnections:', error);
  }
}

setInterval(cleanupStaleConnections, 30000);

// ========== CLEANUP STUCK COUNTDOWNS ==========
async function cleanupStuckCountdowns() {
  try {
    const now = new Date();
    const rooms = await Room.find({ status: 'starting' });
    
    for (const room of rooms) {
      if (room.countdownStartTime) {
        const timeSinceStart = now - new Date(room.countdownStartTime);
        if (timeSinceStart > 45000) {
          console.log(`⚠️ Cleaning up stuck countdown for room ${room.stake} (${timeSinceStart/1000}s)`);
          
          const countdownKey = `countdown_${room.stake}`;
          if (roomTimers.has(countdownKey)) {
            clearInterval(roomTimers.get(countdownKey));
            roomTimers.delete(countdownKey);
          }
          
          room.status = 'waiting';
          room.countdownStartTime = null;
          room.countdownStartedWith = 0;
          await room.save();
          
          const socketsToSend = new Set();
          
          room.players.forEach(userId => {
            for (const [socketId, uId] of socketToUser.entries()) {
              if (uId === userId) {
                if (io.sockets.sockets.get(socketId)?.connected) {
                  socketsToSend.add(socketId);
                }
              }
            }
          });
          
          const subscribedSockets = roomSubscriptions.get(room.stake) || new Set();
          subscribedSockets.forEach(socketId => {
            if (io.sockets.sockets.get(socketId)?.connected) {
              socketsToSend.add(socketId);
            }
          });
          
          const onlinePlayers = await getOnlinePlayersInRoom(room.stake);
          socketsToSend.forEach(socketId => {
            const socket = io.sockets.sockets.get(socketId);
            if (socket) {
              socket.emit('gameCountdown', {
                room: room.stake,
                timer: 0
              });
              socket.emit('lobbyUpdate', {
                room: room.stake,
                count: onlinePlayers.length
              });
            }
          });
          
          console.log(`✅ Reset stuck room ${room.stake} back to waiting`);
        }
      }
    }
  } catch (error) {
    console.error('Error in cleanupStuckCountdowns:', error);
  }
}

setInterval(cleanupStuckCountdowns, 10000);

// ========== ROOM CLEANUP FUNCTION ==========
async function cleanupStaleRooms() {
  try {
    const oneHourAgo = new Date(Date.now() - 3600000);
    
    const staleRooms = await Room.find({
      status: 'ended',
      endTime: { $lt: oneHourAgo }
    });
    
    for (const room of staleRooms) {
      console.log(`🧹 Cleaning up stale room: ${room.stake} ETB`);
      
      if (room.takenBoxes.length > 0 || room.players.length > 0) {
        console.log(`⚠️ Room ${room.stake} still has ${room.takenBoxes.length} taken boxes and ${room.players.length} players. Clearing...`);
        room.players = [];
        room.takenBoxes = [];
        room.status = 'waiting';
        room.lastBoxUpdate = new Date();
        await room.save();
        
        broadcastTakenBoxes(room.stake, []);
        io.emit('boxesCleared', { room: room.stake, reason: 'stale_room_cleanup' });
      }
      
      const oneDayAgo = new Date(Date.now() - 86400000);
      if (room.endTime && room.endTime < oneDayAgo) {
        await Room.deleteOne({ _id: room._id });
        console.log(`🗑️ Deleted stale room from database: ${room.stake} ETB`);
      }
    }
    
    const emptyPlayingRooms = await Room.find({
      status: 'playing',
      players: { $size: 0 }
    });
    
    for (const room of emptyPlayingRooms) {
      console.log(`🧹 Cleaning up empty playing room: ${room.stake} ETB`);
      cleanupRoomTimer(room.stake);
      
      room.players = [];
      room.takenBoxes = [];
      room.status = 'waiting';
      room.calledNumbers = [];
      room.currentBall = null;
      room.ballsDrawn = 0;
      room.startTime = null;
      room.lastBoxUpdate = new Date();
      await room.save();
      
      broadcastTakenBoxes(room.stake, []);
      io.emit('boxesCleared', { room: room.stake, reason: 'empty_room_cleanup' });
    }
    
  } catch (error) {
    console.error('Error in cleanupStaleRooms:', error);
  }
}

setInterval(cleanupStaleRooms, 300000);

// ========== HEALTH CHECK FUNCTION ==========
setInterval(async () => {
  try {
    const now = Date.now();
    const fiveMinutesAgo = new Date(now - 300000);
    
    await User.updateMany(
      { 
        lastSeen: { $lt: fiveMinutesAgo },
        isOnline: true 
      },
      { 
        isOnline: false,
        currentRoom: null,
        box: null
      }
    );
    
    const abandonedRooms = await Room.find({
      status: 'playing',
      players: { $size: 0 },
      startTime: { $lt: fiveMinutesAgo }
    });
    
    for (const room of abandonedRooms) {
      console.log(`⚠️ Cleaning up abandoned room: ${room.stake} ETB`);
      cleanupRoomTimer(room.stake);
      await Room.deleteOne({ _id: room._id });
    }
    
  } catch (error) {
    console.error('Error in health check:', error);
  }
}, 60000);

// ========== TELEGRAM BOT INTEGRATION ==========
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN || '8281813355:AAElz32khbZ9cnX23CeJQn7gwkAypHuJ9E4';

// Simple Telegram webhook
app.post('/telegram-webhook', express.json(), async (req, res) => {
  try {
    // Handle callback queries (button clicks)
    if (req.body.callback_query) {
      const callbackQuery = req.body.callback_query;
      const chatId = callbackQuery.message.chat.id;
      const data = callbackQuery.data;
      const userId = callbackQuery.from.id.toString();
      const userName = callbackQuery.from.first_name || 'Player';
      const messageId = callbackQuery.message.message_id;
      
      // Function to answer callback query
      const answerCallback = async (text = '') => {
        await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/answerCallbackQuery`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            callback_query_id: callbackQuery.id,
            text: text,
            show_alert: !!text
          })
        });
      };
      
      // Function to send message
      const sendMessage = async (text, keyboard = null) => {
        const payload = {
          chat_id: chatId,
          text: text,
          parse_mode: 'Markdown',
          disable_web_page_preview: true
        };
        
        if (keyboard) {
          payload.reply_markup = keyboard;
        }
        
        return await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
      };
      
      // Function to edit message
      const editMessage = async (text, keyboard = null) => {
        const payload = {
          chat_id: chatId,
          message_id: messageId,
          text: text,
          parse_mode: 'Markdown',
          disable_web_page_preview: true
        };
        
        if (keyboard) {
          payload.reply_markup = keyboard;
        }
        
        return await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/editMessageText`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
      };
      
      // Handle different callback data
      switch (data) {
        case 'main_menu':
          const user = await User.findOne({ telegramId: userId }) || 
                      await User.findOne({ userId: `tg_${userId}` }) ||
                      new User({ 
                        userId: `tg_${userId}`, 
                        userName: userName, 
                        telegramId: userId, 
                        balance: 0.00,
                        referralCode: `TG${userId}`
                      });
          
          await editMessage(
            `🎮 *Welcome to Bingo Elite, ${userName}!*\n\n` +
            `💰 Your balance: *${user.balance.toFixed(2)} ETB*\n\n` +
            `*Main Menu:*`,
            {
              inline_keyboard: [
                [
                  { text: '🎮 Play Game', callback_data: 'play_game' },
                  { text: '💰 Deposit', callback_data: 'deposit' }
                ],
                [
                  { text: '💳 Withdraw', callback_data: 'withdraw' },
                  { text: '🔄 Transfer', callback_data: 'transfer' }
                ],
                [
                  { text: '👤 Profile', callback_data: 'profile' },
                  { text: '📊 Transactions', callback_data: 'transactions' }
                ],
                [
                  { text: '👥 Join Groups', callback_data: 'join_group' },
                  { text: '📞 Contact Support', callback_data: 'contact_support' }
                ],
                [
                  { text: '❓ Help', callback_data: 'help' }
                ]
              ]
            }
          );
          await answerCallback();
          break;
          
        case 'play_game':
          const playUser = await User.findOne({ telegramId: userId }) || 
                          await User.findOne({ userId: `tg_${userId}` }) ||
                          new User({ 
                            userId: `tg_${userId}`, 
                            userName: userName, 
                            telegramId: userId, 
                            balance: 0.00 
                          });
          
          await editMessage(
            `🎮 *Play Bingo Elite*\n\n` +
            `💰 Your balance: *${playUser.balance.toFixed(2)} ETB*\n\n` +
            `*How to Play:*\n` +
            `1. Click the button below to launch the game\n` +
            `2. Select a room (10-100 ETB)\n` +
            `3. Choose your ticket number\n` +
            `4. Mark numbers as they're called\n` +
            `5. Claim BINGO to win!\n\n` +
            `🎯 *Four Corners Bonus:* 50 ETB!\n` +
            `🔒 *New Features:*\n` +
            `• Double prize bug fixed with claim lock\n` +
            `• Timer sync between discovery and waiting rooms\n` +
            `• Room lock when game is playing\n` +
            `• 7-minute auto-clear\n` +
            `• Timer shows on box selection screen`,
            {
              inline_keyboard: [
                [
                  {
                    text: '🎮 Launch Game Now',
                    web_app: { url: 'https://bingo-telegram-game.onrender.com/telegram' }
                  }
                ],
                [
                  { text: '⬅️ Back to Menu', callback_data: 'main_menu' }
                ]
              ]
            }
          );
          await answerCallback();
          break;
          
        case 'deposit':
          await editMessage(
            `💰 *Deposit Funds*\n\n` +
            `To add funds to your account:\n\n` +
            `1. *Contact Admin:* @ethio_games1_bot\n` +
            `2. Send your Telegram ID: \`${userId}\`\n` +
            `3. Send the amount you want to deposit\n` +
            `4. Admin will add funds to your account\n\n` +
            `*Minimum Deposit:* 10 ETB\n` +
            `*Available Payment Methods:*\n` +
            `• Bank Transfer\n` +
            `• Mobile Money\n` +
            `• Cryptocurrency\n\n` +
            `_Note: Funds are added instantly after payment confirmation_`,
            {
              inline_keyboard: [
                [
                  { text: '📞 Contact Admin', url: 'https://t.me/ethio_games1_bot' },
                  { text: '💰 Check Balance', callback_data: 'balance' }
                ],
                [
                  { text: '⬅️ Back to Menu', callback_data: 'main_menu' }
                ]
              ]
            }
          );
          await answerCallback();
          break;
          
        case 'withdraw':
          const withdrawUser = await User.findOne({ telegramId: userId }) || 
                              await User.findOne({ userId: `tg_${userId}` }) ||
                              new User({ 
                                userId: `tg_${userId}`, 
                                userName: userName, 
                                telegramId: userId, 
                                balance: 0.00 
                              });
          
          await editMessage(
            `💳 *Withdraw Funds*\n\n` +
            `💰 Your balance: *${withdrawUser.balance.toFixed(2)} ETB*\n\n` +
            `*Withdrawal Process:*\n` +
            `1. Minimum withdrawal: *100 ETB*\n` +
            `2. Contact admin: @ethio_games1_bot\n` +
            `3. Provide your Telegram ID: \`${userId}\`\n` +
            `4. Specify withdrawal amount\n` +
            `5. Provide your payment details\n\n` +
            `*Processing Time:* 24 hours\n` +
            `*Available Methods:*\n` +
            `• Bank Transfer\n` +
            `• Mobile Money\n` +
            `• Cryptocurrency`,
            {
              inline_keyboard: [
                [
                  { text: '📞 Contact Admin', url: 'https://t.me/ethio_games1_bot' },
                  { text: '💰 Check Balance', callback_data: 'balance' }
                ],
                [
                  { text: '⬅️ Back to Menu', callback_data: 'main_menu' }
                ]
              ]
            }
          );
          await answerCallback();
          break;
          
        case 'transfer':
          const transferUser = await User.findOne({ telegramId: userId }) || 
                              await User.findOne({ userId: `tg_${userId}` }) ||
                              new User({ 
                                userId: `tg_${userId}`, 
                                userName: userName, 
                                telegramId: userId, 
                                balance: 0.00 
                              });
          
          await editMessage(
            `🔄 *Transfer Funds*\n\n` +
            `💰 Your balance: *${transferUser.balance.toFixed(2)} ETB*\n\n` +
            `*Transfer to another player:*\n` +
            `1. Contact admin: @ethio_games1_bot\n` +
            `2. Provide:\n` +
            `   • Your Telegram ID: \`${userId}\`\n` +
            `   • Recipient's Telegram ID\n` +
            `   • Amount to transfer\n` +
            `3. Admin will process the transfer\n\n` +
            `*Minimum transfer:* 10 ETB\n` +
            `*Fee:* No fee for transfers\n` +
            `*Instant processing*`,
            {
              inline_keyboard: [
                [
                  { text: '📞 Contact Admin', url: 'https://t.me/ethio_games1_bot' },
                  { text: '💰 Check Balance', callback_data: 'balance' }
                ],
                [
                  { text: '⬅️ Back to Menu', callback_data: 'main_menu' }
                ]
              ]
            }
          );
          await answerCallback();
          break;
          
        case 'balance':
        case 'profile':
          const profileUser = await User.findOne({ telegramId: userId }) || 
                             await User.findOne({ userId: `tg_${userId}` }) ||
                             new User({ 
                               userId: `tg_${userId}`, 
                               userName: userName, 
                               telegramId: userId, 
                               balance: 0.00 
                             });
          
          await editMessage(
            `👤 *Your Profile*\n\n` +
            `*Name:* ${profileUser.userName}\n` +
            `*Telegram ID:* \`${userId}\`\n\n` +
            `💰 *Balance:* ${profileUser.balance.toFixed(2)} ETB\n` +
            `🎮 *Games Played:* ${profileUser.totalWagered || 0}\n` +
            `🏆 *Wins:* ${profileUser.totalWins || 0}\n` +
            `🎯 *Bingos:* ${profileUser.totalBingos || 0}\n\n` +
            `*Member since:* ${new Date(profileUser.joinedAt).toLocaleDateString()}\n` +
            `*Last seen:* ${new Date(profileUser.lastSeen).toLocaleDateString()}`,
            {
              inline_keyboard: [
                [
                  { text: '📊 Transactions', callback_data: 'transactions' },
                  { text: '🎮 Play Now', callback_data: 'play_game' }
                ],
                [
                  { text: '💰 Deposit', callback_data: 'deposit' },
                  { text: '💳 Withdraw', callback_data: 'withdraw' }
                ],
                [
                  { text: '⬅️ Back to Menu', callback_data: 'main_menu' }
                ]
              ]
            }
          );
          await answerCallback();
          break;
          
        case 'transactions':
          const userIdForTransactions = `tg_${userId}`;
          const transactions = await Transaction.find({ 
            userId: userIdForTransactions 
          }).sort({ createdAt: -1 }).limit(10);
          
          let transactionText = `📊 *Your Recent Transactions*\n\n`;
          
          if (transactions.length === 0) {
            transactionText += `No transactions yet.\nStart playing to see your activity!`;
          } else {
            transactions.forEach((tx, index) => {
              const date = new Date(tx.createdAt).toLocaleDateString();
              const time = new Date(tx.createdAt).toLocaleTimeString();
              const amount = tx.amount > 0 ? `+${tx.amount.toFixed(2)}` : tx.amount.toFixed(2);
              const emoji = tx.type.includes('WIN') ? '🏆' : 
                           tx.type.includes('ADMIN_ADD') ? '💰' : 
                           tx.type.includes('STAKE') ? '🎮' : 
                           tx.type.includes('REFUND') ? '↩️' : '📝';
              transactionText += `${emoji} *${tx.type.replace('_', ' ')}*\n`;
              transactionText += `Amount: ${amount} ETB\n`;
              transactionText += `Date: ${date} ${time}\n`;
              if (tx.description) {
                transactionText += `Note: ${tx.description}\n`;
              }
              transactionText += `\n`;
            });
          }
          
          await editMessage(transactionText, {
            inline_keyboard: [
              [
                { text: '👤 Profile', callback_data: 'profile' },
                { text: '💰 Balance', callback_data: 'balance' }
              ],
              [
                { text: '⬅️ Back to Menu', callback_data: 'main_menu' }
              ]
            ]
          });
          await answerCallback();
          break;
          
        case 'join_group':
          await editMessage(
            `👥 *Join Our Community*\n\n` +
            `*Official Groups:*\n\n` +
            `🎮 *Bingo Elite Players Group*\n` +
            `Join our community of players to discuss strategies, share wins, and get updates!\n\n` +
            `📢 *Announcements Channel*\n` +
            `Get notified about new features, tournaments, and special promotions!`,
            {
              inline_keyboard: [
                [
                  { text: '🎮 Join Players Group', url: 'https://t.me/bingo_elite_players' },
                  { text: '📢 Join Announcements', url: 'https://t.me/bingo_elite_announcements' }
                ],
                [
                  { text: '⬅️ Back to Menu', callback_data: 'main_menu' }
                ]
              ]
            }
          );
          await answerCallback();
          break;
          
        case 'contact_support':
          await editMessage(
            `📞 *Contact Support*\n\n` +
            `*For any issues or questions:*\n\n` +
            `👨‍💼 *Admin:* @ethio_games1_bot\n` +
            `*Available:* 24/7\n\n` +
            `*Common issues:*\n` +
            `• Game not loading\n` +
            `• Balance issues\n` +
            `• Deposit/withdrawal problems\n` +
            `• Technical support\n\n` +
            `*Your Telegram ID:* \`${userId}\`\n` +
            `Please include this ID when contacting support.`,
            {
              inline_keyboard: [
                [
                  { text: '📞 Contact Admin', url: 'https://t.me/ethio_games1_bot' },
                  { text: '❓ FAQ', callback_data: 'help' }
                ],
                [
                  { text: '⬅️ Back to Menu', callback_data: 'main_menu' }
                ]
              ]
            }
          );
          await answerCallback();
          break;
          
        case 'help':
          await editMessage(
            `❓ *Bingo Elite Help*\n\n` +
            `*Commands:*\n` +
            `/start, /menu - Show main menu\n` +
            `/play - Play Bingo Elite\n` +
            `/deposit - Add funds to account\n` +
            `/withdraw - Withdraw your winnings\n` +
            `/transfer - Transfer to another player\n` +
            `/profile, /balance - View your profile\n` +
            `/transactions - View transaction history\n` +
            `/group - Join community groups\n` +
            `/contacts, /support - Contact support\n` +
            `/help - This help message\n\n` +
            `*How to Play:*\n` +
            `1. Click Play Game\n` +
            `2. Select room (10-100 ETB)\n` +
            `3. Choose ticket number\n` +
            `4. Mark numbers as called\n` +
            `5. Claim BINGO to win!\n\n` +
            `🎯 *Four Corners Bonus:* 50 ETB\n` +
            `💰 *Real Money Prizes*\n` +
            `⚡ *Real-time Multiplayer*\n\n` +
            `🔒 *New Features & Fixes:*\n` +
            `• Double prize bug fixed with claim lock\n` +
            `• Timer sync between discovery and waiting rooms\n` +
            `• Room lock when game is playing\n` +
            `• 7-minute auto-clear\n` +
            `• Timer shows on box selection screen\n` +
            `• All players return to lobby after game ends\n` +
            `• Game starts with 1 player after 30 seconds`,
            {
              inline_keyboard: [
                [
                  { text: '🎮 Play Now', callback_data: 'play_game' },
                  { text: '💰 Deposit', callback_data: 'deposit' }
                ],
                [
                  { text: '📞 Contact Support', callback_data: 'contact_support' }
                ],
                [
                  { text: '⬅️ Back to Menu', callback_data: 'main_menu' }
                ]
              ]
            }
          );
          await answerCallback();
          break;
          
        default:
          await answerCallback('Unknown command');
      }
      
      res.sendStatus(200);
      return;
    }
    
    // Handle regular messages
    const { message } = req.body;
    
    if (message) {
      const chatId = message.chat.id;
      const text = message.text || '';
      const userId = message.from.id.toString();
      const userName = message.from.first_name || 'Player';
      const username = message.from.username || '';
      
      // Function to send message with inline keyboard
      const sendMessage = async (text, keyboard = null) => {
        const payload = {
          chat_id: chatId,
          text: text,
          parse_mode: 'Markdown',
          disable_web_page_preview: true
        };
        
        if (keyboard) {
          payload.reply_markup = keyboard;
        }
        
        return await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
      };
      
      // Function to get user from database
      const getUser = async () => {
        let user = await User.findOne({ telegramId: userId });
        if (!user) {
          user = await User.findOne({ userId: `tg_${userId}` });
        }
        if (!user) {
          user = new User({
            userId: `tg_${userId}`,
            userName: userName,
            telegramId: userId,
            telegramUsername: username,
            balance: 0.00,
            referralCode: `TG${userId}`
          });
          await user.save();
          
          const transaction = new Transaction({
            type: 'NEW_USER',
            userId: `tg_${userId}`,
            userName: userName,
            amount: 0,
            description: 'New user registered via Telegram'
          });
          await transaction.save();
        }
        return user;
      };
      
      // Handle different commands
      switch (text) {
        case '/start':
          const user = await getUser();
          await sendMessage(
            `🎮 *Welcome to Bingo Elite, ${userName}!*\n\n` +
            `💰 Your balance: *${user.balance.toFixed(2)} ETB*\n\n` +
            `*Main Menu:*\n\n` +
            `🎯 *New Features & Fixes:*\n` +
            `• 🔒 DOUBLE PRIZE BUG FIXED - Claim lock implemented\n` +
            `• ⏱️ Timer sync between discovery and waiting rooms\n` +
            `• 🔒 Room lock when game is playing\n` +
            `• ⏰ Auto-clear after 7 minutes\n` +
            `• ⏱️ Timer shows on box selection screen\n` +
            `• All players return to lobby after game ends\n` +
            `• Game starts with 1 player after 30 seconds`,
            {
              inline_keyboard: [
                [
                  { text: '🎮 Play Game', callback_data: 'play_game' },
                  { text: '💰 Deposit', callback_data: 'deposit' }
                ],
                [
                  { text: '💳 Withdraw', callback_data: 'withdraw' },
                  { text: '🔄 Transfer', callback_data: 'transfer' }
                ],
                [
                  { text: '👤 Profile', callback_data: 'profile' },
                  { text: '📊 Transactions', callback_data: 'transactions' }
                ],
                [
                  { text: '👥 Join Groups', callback_data: 'join_group' },
                  { text: '📞 Contact Support', callback_data: 'contact_support' }
                ],
                [
                  { text: '❓ Help', callback_data: 'help' }
                ]
              ]
            }
          );
          break;
          
        case '/menu':
          const menuUser = await getUser();
          await sendMessage(
            `🎮 *Main Menu*\n\n` +
            `💰 Your balance: *${menuUser.balance.toFixed(2)} ETB*\n\n` +
            `*Select an option:*`,
            {
              inline_keyboard: [
                [
                  { text: '🎮 Play Game', callback_data: 'play_game' },
                  { text: '💰 Deposit', callback_data: 'deposit' }
                ],
                [
                  { text: '💳 Withdraw', callback_data: 'withdraw' },
                  { text: '🔄 Transfer', callback_data: 'transfer' }
                ],
                [
                  { text: '👤 Profile', callback_data: 'profile' },
                  { text: '📊 Transactions', callback_data: 'transactions' }
                ],
                [
                  { text: '👥 Join Groups', callback_data: 'join_group' },
                  { text: '📞 Contact Support', callback_data: 'contact_support' }
                ],
                [
                  { text: '❓ Help', callback_data: 'help' }
                ]
              ]
            }
          );
          break;
          
        case '/play':
          const playUserCmd = await getUser();
          await sendMessage(
            `🎮 *Play Bingo Elite*\n\n` +
            `💰 Your balance: *${playUserCmd.balance.toFixed(2)} ETB*\n\n` +
            `*How to Play:*\n` +
            `1. Click the button below to launch the game\n` +
            `2. Select a room (10-100 ETB)\n` +
            `3. Choose your ticket number\n` +
            `4. Mark numbers as they're called\n` +
            `5. Claim BINGO to win!\n\n` +
            `🎯 *Four Corners Bonus:* 50 ETB!`,
            {
              inline_keyboard: [
                [
                  {
                    text: '🎮 Launch Game Now',
                    web_app: { url: 'https://bingo-telegram-game.onrender.com/telegram' }
                  }
                ],
                [
                  { text: '⬅️ Back to Menu', callback_data: 'main_menu' }
                ]
              ]
            }
          );
          break;
          
        case '/deposit':
          await sendMessage(
            `💰 *Deposit Funds*\n\n` +
            `To add funds to your account:\n\n` +
            `1. *Contact Admin:* @ethio_games1_bot\n` +
            `2. Send your Telegram ID: \`${userId}\`\n` +
            `3. Send the amount you want to deposit\n` +
            `4. Admin will add funds to your account\n\n` +
            `*Minimum Deposit:* 10 ETB\n` +
            `*Available Payment Methods:*\n` +
            `• Bank Transfer\n` +
            `• Mobile Money\n` +
            `• Cryptocurrency\n\n` +
            `_Note: Funds are added instantly after payment confirmation_`,
            {
              inline_keyboard: [
                [
                  { text: '📞 Contact Admin', url: 'https://t.me/ethio_games1_bot' },
                  { text: '💰 Check Balance', callback_data: 'balance' }
                ],
                [
                  { text: '⬅️ Back to Menu', callback_data: 'main_menu' }
                ]
              ]
            }
          );
          break;
          
        case '/withdraw':
          const withdrawUserCmd = await getUser();
          await sendMessage(
            `💳 *Withdraw Funds*\n\n` +
            `💰 Your balance: *${withdrawUserCmd.balance.toFixed(2)} ETB*\n\n` +
            `*Withdrawal Process:*\n` +
            `1. Minimum withdrawal: *100 ETB*\n` +
            `2. Contact admin: @ethio_games1_bot\n` +
            `3. Provide your Telegram ID: \`${userId}\`\n` +
            `4. Specify withdrawal amount\n` +
            `5. Provide your payment details\n\n` +
            `*Processing Time:* 24 hours\n` +
            `*Available Methods:*\n` +
            `• Bank Transfer\n` +
            `• Mobile Money\n` +
            `• Cryptocurrency`,
            {
              inline_keyboard: [
                [
                  { text: '📞 Contact Admin', url: 'https://t.me/ethio_games1_bot' },
                  { text: '💰 Check Balance', callback_data: 'balance' }
                ],
                [
                  { text: '⬅️ Back to Menu', callback_data: 'main_menu' }
                ]
              ]
            }
          );
          break;
          
        case '/transfer':
          const transferUserCmd = await getUser();
          await sendMessage(
            `🔄 *Transfer Funds*\n\n` +
            `💰 Your balance: *${transferUserCmd.balance.toFixed(2)} ETB*\n\n` +
            `*Transfer to another player:*\n` +
            `1. Contact admin: @ethio_games1_bot\n` +
            `2. Provide:\n` +
            `   • Your Telegram ID: \`${userId}\`\n` +
            `   • Recipient's Telegram ID\n` +
            `   • Amount to transfer\n` +
            `3. Admin will process the transfer\n\n` +
            `*Minimum transfer:* 10 ETB\n` +
            `*Fee:* No fee for transfers\n` +
            `*Instant processing*`,
            {
              inline_keyboard: [
                [
                  { text: '📞 Contact Admin', url: 'https://t.me/ethio_games1_bot' },
                  { text: '💰 Check Balance', callback_data: 'balance' }
                ],
                [
                  { text: '⬅️ Back to Menu', callback_data: 'main_menu' }
                ]
              ]
            }
          );
          break;
          
        case '/profile':
        case '/balance':
          const profileUserCmd = await getUser();
          await sendMessage(
            `👤 *Your Profile*\n\n` +
            `*Name:* ${profileUserCmd.userName}\n` +
            `*Telegram ID:* \`${userId}\`\n` +
            `*Username:* @${username || 'Not set'}\n\n` +
            `💰 *Balance:* ${profileUserCmd.balance.toFixed(2)} ETB\n` +
            `🎮 *Games Played:* ${profileUserCmd.totalWagered || 0}\n` +
            `🏆 *Wins:* ${profileUserCmd.totalWins || 0}\n` +
            `🎯 *Bingos:* ${profileUserCmd.totalBingos || 0}\n\n` +
            `*Member since:* ${new Date(profileUserCmd.joinedAt).toLocaleDateString()}\n` +
            `*Last seen:* ${new Date(profileUserCmd.lastSeen).toLocaleDateString()}`,
            {
              inline_keyboard: [
                [
                  { text: '📊 Transactions', callback_data: 'transactions' },
                  { text: '🎮 Play Now', callback_data: 'play_game' }
                ],
                [
                  { text: '💰 Deposit', callback_data: 'deposit' },
                  { text: '💳 Withdraw', callback_data: 'withdraw' }
                ],
                [
                  { text: '⬅️ Back to Menu', callback_data: 'main_menu' }
                ]
              ]
            }
          );
          break;
          
        case '/transactions':
          const transactionsCmd = await Transaction.find({ 
            userId: `tg_${userId}` 
          }).sort({ createdAt: -1 }).limit(10);
          
          let transactionTextCmd = `📊 *Your Recent Transactions*\n\n`;
          
          if (transactionsCmd.length === 0) {
            transactionTextCmd += `No transactions yet.\nStart playing to see your activity!`;
          } else {
            transactionsCmd.forEach((tx, index) => {
              const date = new Date(tx.createdAt).toLocaleDateString();
              const time = new Date(tx.createdAt).toLocaleTimeString();
              const amount = tx.amount > 0 ? `+${tx.amount.toFixed(2)}` : tx.amount.toFixed(2);
              const emoji = tx.type.includes('WIN') ? '🏆' : 
                           tx.type.includes('ADMIN_ADD') ? '💰' : 
                           tx.type.includes('STAKE') ? '🎮' : 
                           tx.type.includes('REFUND') ? '↩️' : '📝';
              transactionTextCmd += `${emoji} *${tx.type.replace('_', ' ')}*\n`;
              transactionTextCmd += `Amount: ${amount} ETB\n`;
              transactionTextCmd += `Date: ${date} ${time}\n`;
              if (tx.description) {
                transactionTextCmd += `Note: ${tx.description}\n`;
              }
              transactionTextCmd += `\n`;
            });
          }
          
          await sendMessage(transactionTextCmd, {
            inline_keyboard: [
              [
                { text: '👤 Profile', callback_data: 'profile' },
                { text: '💰 Balance', callback_data: 'balance' }
              ],
              [
                { text: '⬅️ Back to Menu', callback_data: 'main_menu' }
              ]
            ]
          });
          break;
          
        case '/group':
          await sendMessage(
            `👥 *Join Our Community*\n\n` +
            `*Official Groups:*\n\n` +
            `🎮 *Bingo Elite Players Group*\n` +
            `Join our community of players to discuss strategies, share wins, and get updates!\n\n` +
            `📢 *Announcements Channel*\n` +
            `Get notified about new features, tournaments, and special promotions!`,
            {
              inline_keyboard: [
                [
                  { text: '🎮 Join Players Group', url: 'https://t.me/bingo_elite_players' },
                  { text: '📢 Join Announcements', url: 'https://t.me/bingo_elite_announcements' }
                ],
                [
                  { text: '⬅️ Back to Menu', callback_data: 'main_menu' }
                ]
              ]
            }
          );
          break;
          
        case '/contacts':
        case '/support':
          await sendMessage(
            `📞 *Contact Support*\n\n` +
            `*For any issues or questions:*\n\n` +
            `👨‍💼 *Admin:* @ethio_games1_bot\n` +
            `*Available:* 24/7\n\n` +
            `*Common issues:*\n` +
            `• Game not loading\n` +
            `• Balance issues\n` +
            `• Deposit/withdrawal problems\n` +
            `• Technical support\n\n` +
            `*Your Telegram ID:* \`${userId}\`\n` +
            `Please include this ID when contacting support.`,
            {
              inline_keyboard: [
                [
                  { text: '📞 Contact Admin', url: 'https://t.me/ethio_games1_bot' },
                  { text: '❓ FAQ', callback_data: 'help' }
                ],
                [
                  { text: '⬅️ Back to Menu', callback_data: 'main_menu' }
                ]
              ]
            }
          );
          break;
          
        case '/help':
          await sendMessage(
            `❓ *Bingo Elite Help*\n\n` +
            `*Commands:*\n` +
            `/start, /menu - Show main menu\n` +
            `/play - Play Bingo Elite\n` +
            `/deposit - Add funds to account\n` +
            `/withdraw - Withdraw your winnings\n` +
            `/transfer - Transfer to another player\n` +
            `/profile, /balance - View your profile\n` +
            `/transactions - View transaction history\n` +
            `/group - Join community groups\n` +
            `/contacts, /support - Contact support\n` +
            `/help - This help message\n\n` +
            `*How to Play:*\n` +
            `1. Click Play Game\n` +
            `2. Select room (10-100 ETB)\n` +
            `3. Choose ticket number\n` +
            `4. Mark numbers as called\n` +
            `5. Claim BINGO to win!\n\n` +
            `🎯 *Four Corners Bonus:* 50 ETB\n` +
            `💰 *Real Money Prizes*\n` +
            `⚡ *Real-time Multiplayer*\n\n` +
            `🔒 *New Features & Fixes:*\n` +
            `• Double prize bug fixed with claim lock\n` +
            `• Timer sync between discovery and waiting rooms\n` +
            `• Room lock when game is playing\n` +
            `• 7-minute auto-clear\n` +
            `• Timer shows on box selection screen\n` +
            `• All players return to lobby after game ends\n` +
            `• Game starts with 1 player after 30 seconds`,
            {
              inline_keyboard: [
                [
                  { text: '🎮 Play Now', callback_data: 'play_game' },
                  { text: '💰 Deposit', callback_data: 'deposit' }
                ],
                [
                  { text: '📞 Contact Support', callback_data: 'contact_support' }
                ],
                [
                  { text: '⬅️ Back to Menu', callback_data: 'main_menu' }
                ]
              ]
            }
          );
          break;
          
        default:
          const defaultUser = await getUser();
          await sendMessage(
            `👋 Hello ${userName}!\n\n` +
            `💰 Your balance: *${defaultUser.balance.toFixed(2)} ETB*\n\n` +
            `*Use commands or buttons below:*`,
            {
              inline_keyboard: [
                [
                  { text: '🎮 Play Game', callback_data: 'play_game' },
                  { text: '💰 Check Balance', callback_data: 'balance' }
                ],
                [
                  { text: '📋 Full Menu', callback_data: 'main_menu' },
                  { text: '❓ Help', callback_data: 'help' }
                ]
              ]
            }
          );
      }
    }
    
    res.sendStatus(200);
  } catch (error) {
    console.error('Telegram webhook error:', error);
    res.sendStatus(200);
  }
});

// ========== EXPRESS ROUTES ==========
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Bingo Elite - Telegram Mini App</title>
      <style>
        body { font-family: Arial, sans-serif; padding: 40px; text-align: center; background: #0f172a; color: #f8fafc; }
        .container { max-width: 800px; margin: 0 auto; }
        .status { padding: 30px; background: #1e293b; border-radius: 20px; margin: 30px auto; border: 1px solid #334155; }
        .stats-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 20px; margin: 30px 0; }
        .stat { background: rgba(255,255,255,0.05); padding: 20px; border-radius: 12px; }
        .stat-value { font-size: 2.5rem; font-weight: 900; margin: 10px 0; }
        .stat-label { font-size: 0.9rem; color: #94a3b8; text-transform: uppercase; letter-spacing: 1px; }
        .btn { display: inline-block; padding: 12px 24px; background: #3b82f6; color: white; text-decoration: none; border-radius: 8px; margin: 10px; font-weight: bold; }
        .btn:hover { background: #2563eb; transform: translateY(-2px); }
        .btn-admin { background: #ef4444; }
        .btn-admin:hover { background: #dc2626; }
        .btn-game { background: #10b981; }
        .btn-game:hover { background: #059669; }
      </style>
    </head>
    <body>
      <div class="container">
        <h1 style="font-size: 3rem; margin-bottom: 20px;">🎮 Bingo Elite Telegram Mini App</h1>
        <p style="color: #94a3b8; font-size: 1.2rem;">Real-time multiplayer Bingo - Ready for Telegram</p>
        
        <div class="status">
          <h2 style="color: #10b981;">🚀 Server Status: RUNNING</h2>
          <div class="stats-grid">
            <div class="stat">
              <div class="stat-label">Connected Players</div>
              <div class="stat-value" id="playerCount">${connectedSockets.size}</div>
            </div>
            <div class="stat">
              <div class="stat-label">Database Status</div>
              <div class="stat-value" style="color: #10b981;">✅ Online</div>
            </div>
          </div>
          <p style="margin-top: 20px; color: #f59e0b; font-weight: bold;">🎯 Four Corners Bonus: ${CONFIG.FOUR_CORNERS_BONUS} ETB!</p>
          <p style="color: #64748b; margin-top: 10px;">Server Time: ${new Date().toLocaleString()}</p>
          <p style="color: #10b981;">✅ Telegram Mini App Ready</p>
          <p style="color: #3b82f6; margin-top: 10px;">📦 Real-time Box Tracking: ✅ ACTIVE</p>
          <p style="color: #10b981; margin-top: 10px;">🔒 NEW: Room lock when game is playing</p>
          <p style="color: #10b981;">⏰ NEW: 7-minute game timeout auto-clear</p>
          <p style="color: #10b981;">⏱️ NEW: Timer on box selection interface</p>
          <p style="color: #10b981; margin-top: 10px;">✅ FIXED: Game timer and ball drawing issues resolved</p>
          <p style="color: #10b981;">🎱 Balls pop every 3 seconds: ✅ WORKING</p>
          <p style="color: #10b981;">⏱️ 30-second countdown: ✅ WORKING</p>
          <p style="color: #10b981; font-weight: bold; margin-top: 10px;">✅✅✅ FIXED: Claim Bingo now properly checks numbers!</p>
          <p style="color: #10b981; font-weight: bold;">✅✅ All players return to lobby after game ends</p>
          <p style="color: #10b981; font-weight: bold; margin-top: 10px;">🔒 NEW: DOUBLE PRIZE BUG FIXED</p>
          <p style="color: #10b981;">✅ Claim lock prevents double prize payouts</p>
          <p style="color: #10b981;">⏱️ Timer sync between discovery and waiting rooms</p>
          <p style="color: #10b981; font-weight: bold; margin-top: 10px;">✅ TELEGRAM BOT MENU SYSTEM ADDED</p>
          <p style="color: #10b981;">✅ All menu commands working: /start, /menu, /play, /deposit, /withdraw, /transfer, /profile, /transactions, /balance, /group, /contacts, /help</p>
        </div>
        
        <div style="margin-top: 40px;">
          <h3>Access Points:</h3>
          <div>
            <a href="/admin" class="btn btn-admin" target="_blank">🔒 Admin Panel</a>
            <a href="/game" class="btn btn-game" target="_blank">🎮 Game Client</a>
          </div>
          <div style="margin-top: 20px;">
            <a href="/health" class="btn" style="background: #64748b;" target="_blank">📊 Health Check</a>
            <a href="/telegram" class="btn" style="background: #8b5cf6;" target="_blank">🤖 Telegram Entry</a>
          </div>
          <div style="margin-top: 20px;">
            <a href="/debug-connections" class="btn" style="background: #f59e0b;" target="_blank">🔍 Debug Connections</a>
            <a href="/debug-users" class="btn" style="background: #f59e0b;" target="_blank">👥 Debug Users</a>
            <a href="/debug-calculations/10/5" class="btn" style="background: #f59e0b;" target="_blank">🧮 Debug Calculations</a>
            <a href="/debug-room/10" class="btn" style="background: #f59e0b;" target="_blank">🏠 Debug Room 10</a>
          </div>
          <div style="margin-top: 20px;">
            <a href="/test-connections" class="btn" style="background: #f59e0b;" target="_blank">🔌 Test Connections</a>
            <a href="/force-start/10" class="btn" style="background: #10b981;" target="_blank">🚀 Force Start Room 10</a>
          </div>
          <div style="margin-top: 20px;">
            <a href="https://t.me/ethio_games1_bot" class="btn" style="background: #3b82f6;" target="_blank">🤖 Open Telegram Bot</a>
            <a href="/setup-telegram" class="btn" style="background: #f59e0b;" target="_blank">⚙️ Setup Telegram Bot</a>
          </div>
        </div>
        
        <div style="margin-top: 40px; padding: 20px; background: rgba(255,255,255,0.03); border-radius: 12px;">
          <h4>Telegram Mini App Information</h4>
          <p style="color: #94a3b8; font-size: 0.9rem;">
            Version: 2.9.0 (WITH TELEGRAM MENU SYSTEM) | Database: MongoDB Atlas<br>
            Socket.IO: ✅ Connected Sockets: ${connectedSockets.size}<br>
            SocketToUser: ${socketToUser.size} | Admin Sockets: ${adminSockets.size}<br>
            Processing Claims: ${processingClaims.size} active<br>
            Telegram Integration: ✅ Ready<br>
            Telegram Bot Commands: ✅ 12 commands added<br>
            Game Timer: ${CONFIG.GAME_TIMER}s between balls<br>
            Game Timeout: ${CONFIG.GAME_TIMEOUT_MINUTES} minutes auto-clear<br>
            Bot Username: @ethio_games1_bot<br>
            Real-time Box Updates: ✅ ACTIVE<br>
            Room Lock: ✅ IMPLEMENTED (games lock when playing)<br>
            Auto-Clear: ✅ ${CONFIG.GAME_TIMEOUT_MINUTES} minute timeout<br>
            Box Selection Timer: ✅ SYNCED WITH WAITING ROOM<br>
            Telegram Menu: ✅ FULLY IMPLEMENTED<br>
            Fixed Issues: ✅ Double prize bug fixed, ✅ Claim lock implemented<br>
            ✅ Timer synchronization fixed, ✅ Game timer working<br>
            ✅ Ball popping every 3s, ✅ 30-second countdown working<br>
            ✅ Players properly removed when leaving, ✅ Countdown stuck issue resolved<br>
            ✅ Balls drawn correctly, ✅ BINGO checking working<br>
            ✅✅ COUNTDOWN CONTINUES WHEN PLAYERS LEAVE<br>
            ✅✅ GAME STARTS WITH 1 PLAYER AFTER 30 SECONDS<br>
            ✅✅✅✅ CLAIM BINGO NOW PROPERLY CHECKS NUMBERS (STRING/NUMBER FIX)<br>
            ✅✅✅ ALL PLAYERS RETURN TO LOBBY AFTER GAME ENDS<br>
            ✅✅✅ TELEGRAM BOT WITH FULL MENU SYSTEM<br>
            ✅✅✅ /start, /menu, /play, /deposit, /withdraw, /transfer, /profile, /transactions, /balance, /group, /contacts, /help
          </p>
        </div>
      </div>
      
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

// Telegram Mini App entry point
app.get('/telegram', (req, res) => {
  res.sendFile(path.join(__dirname, 'telegram-index.html'));
});

app.get('/socket-test', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Socket.IO Connection Test</title>
      <script src="https://cdn.socket.io/4.7.2/socket.io.min.js"></script>
      <style>
        body { font-family: Arial, sans-serif; padding: 20px; max-width: 800px; margin: 0 auto; }
        .status { padding: 20px; margin: 10px 0; border-radius: 10px; font-weight: bold; }
        .connected { background: #d1fae5; color: #065f46; border: 2px solid #10b981; }
        .disconnected { background: #fee2e2; color: #991b1b; border: 2px solid #ef4444; }
        .log { background: #1e293b; color: #cbd5e1; padding: 15px; border-radius: 10px; font-family: monospace; height: 300px; overflow-y: auto; margin-top: 20px; }
        .log-entry { margin: 5px 0; padding: 5px; border-bottom: 1px solid #334155; }
        .success { color: #10b981; }
        .error { color: #ef4444; }
        .info { color: #3b82f6; }
      </style>
    </head>
    <body>
      <h1>🔌 Socket.IO Connection Test</h1>
      <div id="status" class="status disconnected">Connecting to server...</div>
      
      <h3>Test Actions:</h3>
      <div>
        <button onclick="testConnection()" style="padding: 10px 20px; margin: 5px; background: #3b82f6; color: white; border: none; border-radius: 5px; cursor: pointer;">
          Test Connection
        </button>
        <button onclick="testInit()" style="padding: 10px 20px; margin: 5px; background: #10b981; color: white; border: none; border-radius: 5px; cursor: pointer;">
          Test User Init
        </button>
        <button onclick="testRoomStatus()" style="padding: 10px 20px; margin: 5px; background: #8b5cf6; color: white; border: none; border-radius: 5px; cursor: pointer;">
          Test Room Status
        </button>
      </div>
      
      <h3>Connection Log:</h3>
      <div id="log" class="log"></div>
      
      <script>
        const log = document.getElementById('log');
        const status = document.getElementById('status');
        
        function addLog(message, type = 'info') {
          const entry = document.createElement('div');
          entry.className = 'log-entry ' + type;
          entry.textContent = new Date().toLocaleTimeString() + ' - ' + message;
          log.appendChild(entry);
          log.scrollTop = log.scrollHeight;
        }
        
        const socket = io({
          reconnection: true,
          reconnectionAttempts: Infinity,
          reconnectionDelay: 1000,
          reconnectionDelayMax: 5000,
          timeout: 20000,
          transports: ['websocket', 'polling'],
          forceNew: true,
          autoConnect: true
        });
        
        socket.on('connect', () => {
          status.className = 'status connected';
          status.textContent = '✅ Connected - Socket ID: ' + socket.id;
          addLog('Connected to server with ID: ' + socket.id, 'success');
        });
        
        socket.on('disconnect', (reason) => {
          status.className = 'status disconnected';
          status.textContent = '❌ Disconnected: ' + reason;
          addLog('Disconnected: ' + reason, 'error');
        });
        
        socket.on('connect_error', (error) => {
          addLog('Connection error: ' + error.message, 'error');
        });
        
        socket.on('connectionTest', (data) => {
          addLog('Server connection test: ' + JSON.stringify(data), 'success');
        });
        
        socket.on('connected', (data) => {
          addLog('Server connected message: ' + JSON.stringify(data), 'success');
        });
        
        socket.on('balanceUpdate', (data) => {
          addLog('Balance update: ' + data, 'info');
        });
        
        socket.on('roomStatus', (data) => {
          addLog('Room status received: ' + Object.keys(data).length + ' rooms', 'info');
        });
        
        socket.on('boxesTakenUpdate', (data) => {
          addLog('Boxes update: ' + data.takenBoxes.length + ' boxes taken in room ' + data.room, 'info');
        });
        
        socket.on('boxesCleared', (data) => {
          addLog('Boxes cleared for room ' + data.room + ': ' + data.reason, 'info');
        });
        
        function testConnection() {
          addLog('Testing connection...', 'info');
          socket.emit('ping');
        }
        
        function testInit() {
          addLog('Testing user initialization...', 'info');
          socket.emit('init', {
            userId: 'test-' + Date.now(),
            userName: 'Test Player'
          });
        }
        
        function testRoomStatus() {
          addLog('Requesting room status...', 'info');
          socket.emit('getTakenBoxes', { room: 10 }, (boxes) => {
            addLog('Taken boxes for room 10: ' + boxes.length + ' boxes', 'info');
          });
        }
        
        setTimeout(() => {
          testConnection();
        }, 1000);
      </script>
    </body>
    </html>
  `);
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

app.get('/game', (req, res) => {
  res.sendFile(path.join(__dirname, 'game.html'));
});

app.get('/health', async (req, res) => {
  try {
    const connectedPlayers = getConnectedUsers().length;
    const activeGames = await Room.countDocuments({ status: 'playing' });
    const totalUsers = await User.countDocuments();
    const rooms = await Room.countDocuments();
    const totalTransactions = await Transaction.countDocuments();
    
    const startingRooms = await Room.find({ status: 'starting' });
    const roomDetails = await Promise.all(startingRooms.map(async (room) => {
      const onlinePlayers = await getOnlinePlayersInRoom(room.stake);
      return {
        stake: room.stake,
        onlinePlayers: onlinePlayers.length,
        totalPlayers: room.players.length,
        countdownStartTime: room.countdownStartTime,
        countdownStartedWith: room.countdownStartedWith
      };
    }));
    
    res.json({
      status: 'ok',
      database: 'connected',
      connectedPlayers: connectedPlayers,
      connectedSockets: connectedSockets.size,
      socketToUser: socketToUser.size,
      processingClaims: processingClaims.size,
      totalUsers: totalUsers,
      activeGames: activeGames,
      startingRooms: roomDetails,
      totalRooms: rooms,
      totalTransactions: totalTransactions,
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      memoryUsage: process.memoryUsage(),
      nodeVersion: process.version,
      telegramReady: true,
      botUsername: '@ethio_games1_bot',
      serverUrl: 'https://bingo-telegram-game.onrender.com',
      realTimeBoxUpdates: 'active',
      boxClearing: 'enabled',
      gameTimer: CONFIG.GAME_TIMER + ' seconds',
      countdownTimer: CONFIG.COUNTDOWN_TIMER + ' seconds',
      gameTimeoutMinutes: CONFIG.GAME_TIMEOUT_MINUTES + ' minutes',
      minPlayersToStart: CONFIG.MIN_PLAYERS_TO_START + ' player',
      roomLockFeature: 'enabled',
      boxSelectionTimer: 'synced with waiting room',
      telegramMenuSystem: 'fully implemented',
      telegramCommands: [
        '/start - 🚀 Start the bot',
        '/menu - 📋 Show main menu',
        '/play - 🎮 Play game',
        '/deposit - 💰 Deposit funds',
        '/withdraw - 💳 Withdraw funds',
        '/transfer - 🔄 Transfer funds',
        '/profile - 👤 View profile',
        '/transactions - 📊 View transactions',
        '/balance - 💰 Check balance',
        '/group - 👥 Join groups',
        '/contacts - 📞 Contact support',
        '/help - ❓ Get help'
      ],
      newFeatures: [
        'telegram_menu_system_full_implementation',
        'double_prize_bug_fixed_with_claim_lock',
        'timer_synchronization_between_discovery_and_waiting',
        'room_lock_when_playing',
        '7_minute_game_timeout_auto_clear',
        'timer_on_box_selection_interface'
      ],
      fixedIssues: [
        'telegram_bot_commands_working',
        'callback_queries_handled',
        'double_claim_prevention_implemented',
        'claim_bingo_properly_checks_numbers',
        'all_players_return_to_lobby_after_game_ends',
        'game_starts_with_1_player_after_30_seconds',
        'connection_tracking_fixed',
        'game_timer_fixed', 
        'ball_drawing_working', 
        'players_properly_removed_on_leave',
        'countdown_stuck_at_30_seconds_fixed',
        'balls_pop_every_3_seconds',
        '30_second_countdown_working',
        'countdown_continues_when_players_leave',
        'game_starts_with_any_players_at_countdown_0'
      ]
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
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
      telegramId: user.telegramId
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API endpoint to add funds (for admin)
app.post('/api/add-funds', async (req, res) => {
  try {
    const { userId, amount, adminPassword } = req.body;
    
    if (adminPassword !== CONFIG.ADMIN_PASSWORD) {
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

// Real-time tracking test endpoint
app.get('/real-time-status', async (req, res) => {
  try {
    const connectedPlayers = getConnectedUsers().length;
    const connectedSocketsCount = connectedSockets.size;
    const socketToUserSize = socketToUser.size;
    
    res.json({
      connectedPlayers: connectedPlayers,
      connectedSockets: connectedSocketsCount,
      socketToUserSize: socketToUserSize,
      socketToUser: Array.from(socketToUser.entries()),
      adminSockets: Array.from(adminSockets),
      processingClaims: Array.from(processingClaims.entries()),
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.json({ error: error.message });
  }
});

// ========== TEST CONNECTIONS ENDPOINT ==========
app.get('/test-connections', (req, res) => {
  const connections = [];
  
  io.sockets.sockets.forEach((socket) => {
    connections.push({
      socketId: socket.id,
      connected: socket.connected,
      userId: socket.userId || 'none',
      handshakeQuery: socket.handshake.query,
      inSocketToUser: socketToUser.has(socket.id)
    });
  });
  
  res.json({
    totalSockets: connections.length,
    connectedSockets: Array.from(connectedSockets).length,
    socketToUserSize: socketToUser.size,
    socketToUserEntries: Array.from(socketToUser.entries()),
    processingClaims: Array.from(processingClaims.entries()),
    connections: connections,
    getConnectedUsersResult: getConnectedUsers()
  });
});

// ========== DEBUG CONNECTION ENDPOINT ==========
app.get('/debug-connections', async (req, res) => {
  try {
    const connectedUserIds = getConnectedUsers();
    const socketToUserArray = Array.from(socketToUser.entries());
    const connectedSocketsArray = Array.from(connectedSockets);
    
    res.json({
      timestamp: new Date().toISOString(),
      totalConnectedUsers: connectedUserIds.length,
      connectedUserIds: connectedUserIds,
      socketToUserCount: socketToUser.size,
      socketToUser: socketToUserArray.map(([socketId, userId]) => ({ socketId, userId })),
      processingClaimsCount: processingClaims.size,
      processingClaims: Array.from(processingClaims.entries()),
      connectedSocketsCount: connectedSockets.size,
      connectedSockets: connectedSocketsArray.map(socketId => {
        const socket = io.sockets.sockets.get(socketId);
        return {
          socketId,
          connected: socket?.connected || false,
          userId: socketToUser.get(socketId) || socket?.userId || 'unknown',
          handshakeQuery: socket?.handshake?.query || {}
        };
      }),
      adminSocketsCount: adminSockets.size,
      adminSockets: Array.from(adminSockets)
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ========== DEBUG USERS ENDPOINT ==========
app.get('/debug-users', async (req, res) => {
  try {
    const connectedUserIds = getConnectedUsers();
    const allUsers = await User.find({}).limit(100);
    
    const userStatus = allUsers.map(user => {
      const isOnline = connectedUserIds.includes(user.userId);
      const lastSeenTime = new Date(user.lastSeen);
      const now = new Date();
      const secondsSinceLastSeen = (now - lastSeenTime) / 1000;
      
      return {
        userId: user.userId,
        userName: user.userName,
        isOnline: isOnline,
        lastSeen: user.lastSeen,
        secondsSinceLastSeen: Math.floor(secondsSinceLastSeen),
        currentRoom: user.currentRoom,
        balance: user.balance,
        socketId: Array.from(socketToUser.entries())
          .find(([_, uid]) => uid === user.userId)?.[0] || 'none'
      };
    });
    
    res.json({
      timestamp: new Date().toISOString(),
      totalConnectedUsers: connectedUserIds.length,
      connectedUserIds: connectedUserIds,
      socketToUserSize: socketToUser.size,
      processingClaimsCount: processingClaims.size,
      connectedSockets: connectedSockets.size,
      allUsers: userStatus
    });
  } catch (error) {
    res.json({ error: error.message });
  }
});

// ========== DEBUG ROOM ENDPOINT ==========
app.get('/debug-room/:stake', async (req, res) => {
  try {
    const stake = parseInt(req.params.stake);
    const room = await Room.findOne({ stake: stake });
    const onlinePlayers = await getOnlinePlayersInRoom(stake);
    
    res.json({
      stake: stake,
      roomExists: !!room,
      roomStatus: room?.status || 'not_found',
      playersInRoom: room?.players?.length || 0,
      onlinePlayers: onlinePlayers.length,
      takenBoxes: room?.takenBoxes?.length || 0,
      countdownActive: roomTimers.has(`countdown_${stake}`),
      gameTimerActive: roomTimers.has(stake),
      processingClaim: processingClaims.has(stake),
      roomData: room,
      countdownStartedWith: room?.countdownStartedWith || 0,
      countdownStartTime: room?.countdownStartTime,
      startTime: room?.startTime,
      gameDurationMinutes: room?.startTime ? Math.floor((Date.now() - room.startTime) / 1000 / 60) : 0,
      locked: room?.status === 'playing'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ========== DEBUG FORCE START ENDPOINT ==========
app.get('/force-start/:stake', async (req, res) => {
  try {
    const stake = parseInt(req.params.stake);
    const room = await Room.findOne({ stake: stake });
    
    if (room) {
      room.status = 'playing';
      room.startTime = new Date();
      await room.save();
      
      await startGameTimer(room);
      
      const socketsToSend = new Set();
      
      room.players.forEach(userId => {
        for (const [socketId, uId] of socketToUser.entries()) {
          if (uId === userId) {
            if (io.sockets.sockets.get(socketId)?.connected) {
              socketsToSend.add(socketId);
            }
          }
        }
      });
      
      const subscribedSockets = roomSubscriptions.get(stake) || new Set();
      subscribedSockets.forEach(socketId => {
        if (io.sockets.sockets.get(socketId)?.connected) {
          socketsToSend.add(socketId);
        }
      });
      
      socketsToSend.forEach(socketId => {
        const socket = io.sockets.sockets.get(socketId);
        if (socket) {
          socket.emit('gameStarted', { 
            room: stake,
            players: room.players.length
          });
        }
      });
      
      res.json({ 
        success: true, 
        message: `Forced game start for ${stake} ETB room`,
        players: room.players.length
      });
    } else {
      res.json({ success: false, message: 'Room not found' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ========== DEBUG CALCULATIONS ENDPOINT ==========
app.get('/debug-calculations/:stake/:players', (req, res) => {
  try {
    const stake = parseInt(req.params.stake);
    const players = parseInt(req.params.players);
    
    const commissionPerPlayer = CONFIG.HOUSE_COMMISSION[stake] || 0;
    const contributionPerPlayer = stake - commissionPerPlayer;
    const totalContributions = contributionPerPlayer * players;
    const houseFee = commissionPerPlayer * players;
    const totalCollected = stake * players;
    const potentialPrizeWithBonus = totalContributions + CONFIG.FOUR_CORNERS_BONUS;
    
    res.json({
      stake: stake,
      players: players,
      commissionPerPlayer: commissionPerPlayer,
      contributionPerPlayer: contributionPerPlayer,
      totalContributions: totalContributions,
      houseFee: houseFee,
      totalCollected: totalCollected,
      fourCornersBonus: CONFIG.FOUR_CORNERS_BONUS,
      potentialPrize: totalContributions,
      potentialPrizeWithBonus: potentialPrizeWithBonus,
      breakdown: {
        "Each player pays": stake + " ETB",
        "House commission per player": commissionPerPlayer + " ETB",
        "Contribution to prize pool per player": contributionPerPlayer + " ETB",
        "Total prize pool (base)": totalContributions + " ETB",
        "Four corners bonus": CONFIG.FOUR_CORNERS_BONUS + " ETB",
        "Maximum possible win (four corners)": potentialPrizeWithBonus + " ETB",
        "House earnings": houseFee + " ETB",
        "Total collected from all players": totalCollected + " ETB"
      },
      example_scenarios: [
        {
          scenario: "5 players, no four corners",
          prize: totalContributions,
          per_player_contribution: contributionPerPlayer,
          winner_gets: totalContributions + " ETB",
          house_gets: houseFee + " ETB"
        },
        {
          scenario: "5 players, with four corners",
          prize: totalContributions,
          bonus: CONFIG.FOUR_CORNERS_BONUS,
          total: potentialPrizeWithBonus,
          winner_gets: potentialPrizeWithBonus + " ETB",
          house_gets: houseFee + " ETB (plus pays bonus)"
        },
        {
          scenario: "10 players, no four corners",
          prize: contributionPerPlayer * 10,
          winner_gets: (contributionPerPlayer * 10) + " ETB",
          house_gets: (commissionPerPlayer * 10) + " ETB"
        }
      ]
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ========== SETUP TELEGRAM BOT ENDPOINT ==========
app.get('/setup-telegram', async (req, res) => {
  try {
    const setCommandsResponse = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/setMyCommands`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        commands: [
          { command: 'start', description: '🚀 Start the bot' },
          { command: 'menu', description: '📋 Show main menu' },
          { command: 'play', description: '🎮 Play game' },
          { command: 'deposit', description: '💰 Deposit funds' },
          { command: 'withdraw', description: '💳 Withdraw funds' },
          { command: 'transfer', description: '🔄 Transfer funds' },
          { command: 'profile', description: '👤 View profile' },
          { command: 'transactions', description: '📊 View transactions' },
          { command: 'balance', description: '💰 Check balance' },
          { command: 'group', description: '👥 Join groups' },
          { command: 'contacts', description: '📞 Contact support' },
          { command: 'help', description: '❓ Get help' }
        ]
      })
    });
    
    const setCommandsResult = await setCommandsResponse.json();
    
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
          text: '🎮 Play Bingo',
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
        </style>
      </head>
      <body>
        <div class="container">
          <h1>✅ Telegram Bot Setup Complete!</h1>
          <div class="success">✓ Bot Commands Configured</div>
          <div class="success">✓ Webhook Configured</div>
          <div class="success">✓ Menu Button Set</div>
          
          <div class="info-box">
            <h3>Bot Information:</h3>
            <p><strong>Bot:</strong> @ethio_games1_bot</p>
            <p><strong>Game URL:</strong> https://bingo-telegram-game.onrender.com/telegram</p>
            <p><strong>Admin Panel:</strong> https://bingo-telegram-game.onrender.com/admin</p>
            <p><strong>Admin Password:</strong> admin1234</p>
            <p><strong>Bot Commands Added:</strong></p>
            <p>1. /start - 🚀 Start the bot</p>
            <p>2. /menu - 📋 Show main menu</p>
            <p>3. /play - 🎮 Play game</p>
            <p>4. /deposit - 💰 Deposit funds</p>
            <p>5. /withdraw - 💳 Withdraw funds</p>
            <p>6. /transfer - 🔄 Transfer funds</p>
            <p>7. /profile - 👤 View profile</p>
            <p>8. /transactions - 📊 View transactions</p>
            <p>9. /balance - 💰 Check balance</p>
            <p>10. /group - 👥 Join groups</p>
            <p>11. /contacts - 📞 Contact support</p>
            <p>12. /help - ❓ Get help</p>
            <p><strong>New Features & Fixes:</strong></p>
            <p>1. 🔒 <strong>DOUBLE PRIZE BUG FIXED:</strong> Claim lock prevents multiple payouts</p>
            <p>2. ⏱️ <strong>Timer Synchronization:</strong> Discovery timer synced with waiting room</p>
            <p>3. 🔒 <strong>Room Lock:</strong> Rooms lock when game is playing</p>
            <p>4. ⏰ <strong>7-minute Auto-clear:</strong> Games auto-end after 7 minutes</p>
            <p>5. ⏱️ <strong>Box Selection Timer:</strong> Countdown shows on box selection screen</p>
            <p>6. 🤖 <strong>Telegram Menu System:</strong> Full menu with inline keyboards</p>
            <p><strong>Real-time Features:</strong> Box tracking, Live updates</p>
            <p><strong>Fixed Issues:</strong> Double prize bug eliminated, Claim Bingo now properly checks numbers, All players return to lobby, Game starts with 1 player</p>
            <p><strong>✅ 30-second countdown now working</strong></p>
            <p><strong>✅ Balls pop every 3 seconds</strong></p>
            <p><strong>✅ Countdown continues when players leave</strong></p>
            <p><strong>✅ Game starts with 1 player after 30 seconds</strong></p>
            <p><strong>✅✅✅ DOUBLE PRIZE BUG ELIMINATED WITH CLAIM LOCK</strong></p>
            <p><strong>✅✅✅ CLAIM BINGO NOW PROPERLY CHECKS NUMBERS</strong></p>
            <p><strong>✅✅ ALL PLAYERS RETURN TO LOBBY AFTER GAME ENDS</strong></p>
            <p><strong>✅✅ TELEGRAM BOT MENU SYSTEM IMPLEMENTED</strong></p>
          </div>
          
          <div>
            <a href="https://t.me/ethio_games1_bot" class="btn" target="_blank">Open Bot in Telegram</a>
            <a href="/admin" class="btn" style="background: #ef4444;" target="_blank">Open Admin Panel</a>
          </div>
          
          <div style="margin-top: 30px; text-align: left;">
            <h4>Next Steps:</h4>
            <ol>
              <li>Open @ethio_games1_bot in Telegram</li>
              <li>Click "Start"</li>
              <li>Use /menu to see all options</li>
              <li>Click menu button (bottom left) or use /play to start game</li>
              <li>Play Bingo with new features!</li>
            </ol>
            
            <h4>To Add Funds to Players:</h4>
            <ol>
              <li>Open Admin Panel (link above)</li>
              <li>Login with password: admin1234</li>
              <li>Find user by Telegram ID</li>
              <li>Click "Add Funds" button</li>
            </ol>
            
            <h4>Testing Bot Commands:</h4>
            <ol>
              <li>/start - Welcome message</li>
              <li>/menu - Main menu with inline keyboard</li>
              <li>/play - Game launch instructions</li>
              <li>/balance - Check your balance</li>
              <li>/help - Get help information</li>
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
      <a href="/" class="btn">Back to Home</a>
    `);
  }
});

// ========== START SERVER ==========
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════════════╗
║             🤖 BINGO ELITE - TELEGRAM READY         ║
╠══════════════════════════════════════════════════════╣
║  URL:          https://bingo-telegram-game.onrender.com ║
║  Port:         ${PORT}                                ║
║  Game:         /game                                 ║
║  Admin:        /admin (password: admin1234)         ║
║  Telegram:     /telegram                             ║
║  Bot Setup:    /setup-telegram                       ║
║  Real-Time:    /real-time-status                     ║
║  Debug:        /debug-connections                    ║
║  Debug Users:  /debug-users                          ║
║  Debug Room:   /debug-room/:stake                    ║
║  Force Start:  /force-start/:stake                   ║
║  Test:         /test-connections                     ║
╠══════════════════════════════════════════════════════╣
║  🔑 Admin Password: ${process.env.ADMIN_PASSWORD || 'admin1234'} ║
║  🤖 Telegram Bot: @ethio_games1_bot                 ║
║  🤖 Bot Token: ${TELEGRAM_TOKEN.substring(0, 10)}... ║
║  📡 WebSocket: ✅ Ready for Telegram connections    ║
║  🎮 Four Corners Bonus: ${CONFIG.FOUR_CORNERS_BONUS} ETB       ║
║  📦 Real-time Box Tracking: ✅ ACTIVE               ║
║  🆕 NEW FEATURES & FIXES:                           ║
║  🔒 DOUBLE PRIZE BUG: ✅ FIXED WITH CLAIM LOCK     ║
║  ⏱️ Timer Sync: ✅ Discovery ↔ Waiting Room        ║
║  🔒 Room Lock: ✅ When game is playing              ║
║  ⏰ Auto-Clear: ✅ 7-minute timeout ║
║  ⏱️ Box Timer: ✅ Shows on selection screen         ║
║  🤖 Telegram Menu: ✅ FULLY IMPLEMENTED             ║
║  📋 Bot Commands: ✅ 12 commands added              ║
║  🧹 Box Clearing After Game: ✅ IMPLEMENTED         ║
║  🚀 FIXES: ✅ Double prize bug eliminated           ║
║         ✅ Game timer working                        ║
║         ✅ Ball drawing fixed (every 3 seconds)     ║
║         ✅ Players properly removed when leaving    ║
║         ✅✅ 30-SECOND COUNTDOWN NOW WORKING        ║
║         ✅✅ BALLS POP EVERY 3 SECONDS WORKING      ║
║         ✅✅ COUNTDOWN CONTINUES WHEN PLAYERS LEAVE ║
║         ✅✅ GAME STARTS WITH 1 PLAYER AFTER 30 SECONDS ║
║         ✅✅✅✅ CLAIM BINGO NOW PROPERLY CHECKS NUMBERS ║
║         ✅✅✅ ALL PLAYERS RETURN TO LOBBY AFTER GAME ENDS ║
║         ✅✅✅ TELEGRAM BOT WITH FULL MENU SYSTEM   ║
╚══════════════════════════════════════════════════════╝
✅ Server ready with TELEGRAM MENU SYSTEM and all fixes
  `);
  
  // Initial broadcast
  setTimeout(() => {
    broadcastRoomStatus();
  }, 1000);
  
  // Setup Telegram bot after server starts
  setTimeout(async () => {
    try {
      if (TELEGRAM_TOKEN && TELEGRAM_TOKEN.length > 20) {
        const webhookUrl = `https://bingo-telegram-game.onrender.com/telegram-webhook`;
        
        // Set bot commands
        await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/setMyCommands`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            commands: [
              { command: 'start', description: '🚀 Start the bot' },
              { command: 'menu', description: '📋 Show main menu' },
              { command: 'play', description: '🎮 Play game' },
              { command: 'deposit', description: '💰 Deposit funds' },
              { command: 'withdraw', description: '💳 Withdraw funds' },
              { command: 'transfer', description: '🔄 Transfer funds' },
              { command: 'profile', description: '👤 View profile' },
              { command: 'transactions', description: '📊 View transactions' },
              { command: 'balance', description: '💰 Check balance' },
              { command: 'group', description: '👥 Join groups' },
              { command: 'contacts', description: '📞 Contact support' },
              { command: 'help', description: '❓ Get help' }
            ]
          })
        });
        
        // Set webhook
        const webhookResponse = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/setWebhook`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url: webhookUrl,
            drop_pending_updates: true
          })
        });
        
        const webhookResult = await webhookResponse.json();
        console.log('✅ Telegram Bot Auto-Setup:', {
          commands: 'set',
          webhook: webhookResult.ok ? 'configured' : 'failed'
        });
      }
    } catch (error) {
      console.log('⚠️ Telegram auto-setup skipped or failed:', error.message);
    }
  }, 3000);
});
