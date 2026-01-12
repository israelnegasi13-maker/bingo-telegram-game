// bot.js - Telegram Bot with Inline Keyboard Menu
const { Telegraf } = require('telegraf');
const mongoose = require('mongoose');
require('dotenv').config();

// Telegram Bot Token
const TELEGRAM_TOKEN = '8477483953:AAHM50XKZhMywXnBXQDnyAj6s7Gi4ybjHkE';

// Connect to MongoDB (same as server.js)
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/bingo', {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => console.log('✅ MongoDB Connected for Bot'))
.catch(err => {
  console.error('❌ MongoDB Connection Error:', err);
  process.exit(1);
});

// User model
const userSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true },
  userName: { type: String, required: true },
  balance: { type: Number, default: 0.00 },
  telegramId: { type: String, unique: true, sparse: true },
  telegramUsername: { type: String },
  joinedAt: { type: Date, default: Date.now },
  lastSeen: { type: Date, default: Date.now },
  isOnline: { type: Boolean, default: false }
});

const User = mongoose.model('User', userSchema);

// Initialize bot
const bot = new Telegraf(TELEGRAM_TOKEN);

// Helper function to get or create user
async function getOrCreateUser(telegramUser) {
  const telegramId = telegramUser.id.toString();
  const userName = telegramUser.first_name;
  const username = telegramUser.username;
  
  let user = await User.findOne({ telegramId: telegramId });
  
  if (!user) {
    user = new User({
      userId: `tg_${telegramId}`,
      userName: userName,
      balance: 0.00,
      telegramId: telegramId,
      telegramUsername: username
    });
    await user.save();
  }
  
  return user;
}

// Main menu keyboard
const mainMenuKeyboard = {
  reply_markup: {
    keyboard: [
      ["🎮 Play Games", "💰 Deposit"],
      ["📤 Withdraw", "🔀 Transfer"],
      ["👤 My Profile", "📊 Transactions"],
      ["💰 Balance", "👥 Join Group"],
      ["📞 Contact Us"]
    ],
    resize_keyboard: true,
    one_time_keyboard: false
  }
};

// Inline keyboard for mini app
const miniAppKeyboard = {
  reply_markup: {
    inline_keyboard: [
      [
        {
          text: "🎮 Play Bingo Now",
          web_app: { url: "https://bingo-telegram-game.onrender.com/telegram" }
        }
      ],
      [
        {
          text: "💰 Check Balance",
          callback_data: "check_balance"
        },
        {
          text: "📊 Transactions",
          callback_data: "transactions"
        }
      ],
      [
        {
          text: "👥 Join Community",
          url: "https://t.me/your_group_link"
        },
        {
          text: "📞 Contact Admin",
          callback_data: "contact_admin"
        }
      ]
    ]
  }
};

// Admin keyboard (for admin users)
const adminKeyboard = {
  reply_markup: {
    keyboard: [
      ["📊 Dashboard", "👥 Users"],
      ["💰 Add Funds", "📤 Payout"],
      ["🎮 Manage Games", "📊 Statistics"],
      ["🔙 Main Menu"]
    ],
    resize_keyboard: true,
    one_time_keyboard: false
  }
};

// Admin IDs (add your admin Telegram IDs here)
const ADMIN_IDS = ['YOUR_ADMIN_ID_HERE'];

// /start command
bot.command('start', async (ctx) => {
  const user = await getOrCreateUser(ctx.from);
  
  // Welcome message with image-like layout
  const welcomeMessage = `
✨ *NEXT GAMES*  
*LEVEL UP YOUR REALITY*  

🕟 *4:36 PM*  

Welcome to *BINGO ELITE* ${user.userName}! 🎮

💰 *Balance:* ${user.balance.toFixed(2)} ETB

Select an option below:
`;

  await ctx.replyWithPhoto(
    { url: 'https://via.placeholder.com/600x200/3b82f6/ffffff?text=BINGO+ELITE' }, // Replace with your actual image URL
    {
      caption: welcomeMessage,
      parse_mode: 'Markdown',
      ...mainMenuKeyboard
    }
  );
});

// Handle text messages
bot.on('text', async (ctx) => {
  const text = ctx.message.text;
  
  if (text === "🎮 Play Games") {
    const user = await getOrCreateUser(ctx.from);
    
    const playMessage = `
🎮 *PLAY GAMES*  

Choose your game:

*BINGO ELITE* - Real-time multiplayer bingo
• 10-100 ETB stakes
• Four Corners Bonus: 50 ETB
• Real-time box tracking
• 100 players per room

*COMING SOON:*
• Keno Ultra
• Dice Battle
• Lottery Draw

Click below to start playing! 🚀
`;
    
    await ctx.reply(playMessage, {
      parse_mode: 'Markdown',
      ...miniAppKeyboard
    });
  }
  else if (text === "💰 Deposit") {
    await ctx.reply(`
💰 *DEPOSIT FUNDS*  

To add funds to your account:

1. Contact @ethio_games1_admin
2. Send your deposit amount
3. Provide your user ID: \`tg_${ctx.from.id}\`
4. Receive confirmation within 5 minutes

*Minimum Deposit:* 10 ETB
*Maximum Deposit:* 10,000 ETB

Payment methods:
• Bank Transfer
• Mobile Money
• Crypto (USDT)

For urgent deposits, contact admin directly. ✅
`, {
      parse_mode: 'Markdown',
      reply_markup: {
        keyboard: [
          ["💳 Bank Transfer Info", "📱 Mobile Money Info"],
          ["🔙 Back to Main Menu"]
        ],
        resize_keyboard: true
      }
    });
  }
  else if (text === "📤 Withdraw") {
    const user = await getOrCreateUser(ctx.from);
    
    await ctx.reply(`
📤 *WITHDRAW FUNDS*  

*Available Balance:* ${user.balance.toFixed(2)} ETB

*Withdrawal Rules:*
• Minimum withdrawal: 50 ETB
• Processing time: 1-24 hours
• Fees: 2% (min 5 ETB)

To withdraw:
1. Click "Request Withdrawal" below
2. Enter amount
3. Provide payout details
4. Wait for confirmation

Make sure you have verified your account! ✅
`, {
      parse_mode: 'Markdown',
      reply_markup: {
        keyboard: [
          ["💸 Request Withdrawal"],
          ["📋 Withdrawal History"],
          ["🔙 Back to Main Menu"]
        ],
        resize_keyboard: true
      }
    });
  }
  else if (text === "🔀 Transfer") {
    const user = await getOrCreateUser(ctx.from);
    
    await ctx.reply(`
🔀 *TRANSFER FUNDS*  

*Available Balance:* ${user.balance.toFixed(2)} ETB

Transfer funds to other players instantly!

*Transfer Rules:*
• Minimum transfer: 10 ETB
• No fees for transfers
• Instant delivery
• Max 5,000 ETB per day

To transfer:
1. Enter recipient username
2. Enter amount
3. Confirm transfer

*Current Promo:* Transfer 100+ ETB, get 5 ETB bonus! 🎉
`, {
      parse_mode: 'Markdown',
      reply_markup: {
        keyboard: [
          ["👥 Transfer to Friend"],
          ["📋 Transfer History"],
          ["🔙 Back to Main Menu"]
        ],
        resize_keyboard: true
      }
    });
  }
  else if (text === "👤 My Profile") {
    const user = await getOrCreateUser(ctx.from);
    
    const profileMessage = `
👤 *MY PROFILE*  

*User ID:* \`${user.userId}\`
*Username:* @${user.telegramUsername || 'Not set'}
*Name:* ${user.userName}
*Joined:* ${user.joinedAt.toLocaleDateString()}

*Stats:*
💰 Balance: ${user.balance.toFixed(2)} ETB
🎮 Total Games: 0
🏆 Total Wins: 0
📈 Win Rate: 0%

*Referral Code:* ${user.userId.slice(-8)}
*Referral Bonus:* 5% of friend's first deposit

*Account Status:* ✅ Active
*Last Active:* Just now
`;
    
    await ctx.reply(profileMessage, {
      parse_mode: 'Markdown',
      reply_markup: {
        keyboard: [
          ["✏️ Edit Profile", "📊 My Stats"],
          ["👥 Refer Friends", "🏆 Achievements"],
          ["🔙 Back to Main Menu"]
        ],
        resize_keyboard: true
      }
    });
  }
  else if (text === "📊 Transactions") {
    const user = await getOrCreateUser(ctx.from);
    
    await ctx.reply(`
📊 *TRANSACTIONS*  

*Recent Activity:*
No transactions yet

*Filter Options:*
• All Transactions
• Deposits Only
• Withdrawals Only
• Game Winnings
• Transfers

Click below to view your transaction history or filter by type.
`, {
      parse_mode: 'Markdown',
      reply_markup: {
        keyboard: [
          ["📜 All Transactions", "💳 Deposits"],
          ["📤 Withdrawals", "🎮 Game History"],
          ["📅 This Month", "🔙 Back to Main Menu"]
        ],
        resize_keyboard: true
      }
    });
  }
  else if (text === "💰 Balance") {
    const user = await getOrCreateUser(ctx.from);
    
    const balanceMessage = `
💰 *ACCOUNT BALANCE*  

*Available Balance:* ${user.balance.toFixed(2)} ETB
*Pending Withdrawals:* 0.00 ETB
*Total Wagered:* 0.00 ETB
*Total Winnings:* 0.00 ETB

*Balance Breakdown:*
• Game Winnings: 0.00 ETB
• Deposits: 0.00 ETB
• Bonuses: 0.00 ETB
• Referral Earnings: 0.00 ETB

*Quick Actions:*
Add funds instantly or withdraw your winnings.
`;
    
    await ctx.reply(balanceMessage, {
      parse_mode: 'Markdown',
      reply_markup: {
        keyboard: [
          ["💳 Add Funds", "📤 Withdraw"],
          ["🔄 Refresh Balance", "📊 Detailed View"],
          ["🔙 Back to Main Menu"]
        ],
        resize_keyboard: true
      }
    });
  }
  else if (text === "👥 Join Group") {
    await ctx.reply(`
👥 *JOIN OUR COMMUNITY*  

Connect with other players, get updates, and participate in exclusive events!

*Official Channels:*
📢 Announcements: @ethio_games_announcements
💬 Community: @ethio_games_community
🎮 Tips & Strategies: @bingo_elite_tips
📱 Support: @ethio_games_support

*Benefits of joining:*
✅ Exclusive bonuses for group members
✅ Early access to new games
✅ Daily free giveaways
✅ Strategy discussions
✅ Live game notifications

Click the links below to join! 👇
`, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [
            { text: "📢 Join Announcements", url: "https://t.me/ethio_games_announcements" },
            { text: "💬 Join Community", url: "https://t.me/ethio_games_community" }
          ],
          [
            { text: "🎮 Game Tips", url: "https://t.me/bingo_elite_tips" },
            { text: "📱 Support", url: "https://t.me/ethio_games_support" }
          ],
          [
            { text: "🔙 Back", callback_data: "back_to_menu" }
          ]
        ]
      }
    });
  }
  else if (text === "📞 Contact Us") {
    await ctx.reply(`
📞 *CONTACT US*  

We're here to help you 24/7!

*For Support:*
👨‍💻 Customer Support: @ethio_games_support_bot
📧 Email: support@ethiogames.com
🌐 Website: https://ethiogames.com

*For Admin/Deposits:*
💰 Financial Admin: @ethio_games1_admin
🔒 Security Issues: @ethio_games_security

*Response Times:*
• General inquiries: Within 1 hour
• Financial issues: Within 15 minutes
• Technical support: Within 30 minutes
• Emergency: Immediate (24/7)

*Please have your User ID ready:* \`tg_${ctx.from.id}\`
`, {
      parse_mode: 'Markdown',
      reply_markup: {
        keyboard: [
          ["👨‍💻 Live Support", "💰 Deposit Help"],
          ["🚨 Report Issue", "💡 Suggestions"],
          ["🔙 Back to Main Menu"]
        ],
        resize_keyboard: true
      }
    });
  }
  else if (text === "🔙 Back to Main Menu" || text === "🔙 Back") {
    await ctx.reply("Returning to main menu...", mainMenuKeyboard);
  }
  else if (text === "🔙 Main Menu" && ADMIN_IDS.includes(ctx.from.id.toString())) {
    await ctx.reply("Switching to user mode...", mainMenuKeyboard);
  }
});

// Handle callback queries from inline keyboards
bot.on('callback_query', async (ctx) => {
  const data = ctx.callbackQuery.data;
  
  if (data === 'check_balance') {
    const user = await getOrCreateUser(ctx.from);
    await ctx.answerCbQuery();
    await ctx.reply(`💰 Your current balance: ${user.balance.toFixed(2)} ETB`);
  }
  else if (data === 'transactions') {
    await ctx.answerCbQuery();
    await ctx.reply("📊 Opening transaction history...");
  }
  else if (data === 'contact_admin') {
    await ctx.answerCbQuery();
    await ctx.reply("📞 Contacting admin... Please send your message.");
  }
  else if (data === 'back_to_menu') {
    await ctx.answerCbQuery();
    await ctx.reply("Returning to main menu...", mainMenuKeyboard);
  }
});

// Admin commands
bot.command('admin', async (ctx) => {
  if (ADMIN_IDS.includes(ctx.from.id.toString())) {
    await ctx.reply(`
🔐 *ADMIN PANEL*  

Welcome back, Admin!

Quick Stats:
• Total Users: 0
• Active Games: 0
• Total Balance: 0 ETB
• Today's Deposits: 0 ETB

Select an option below:
`, {
      parse_mode: 'Markdown',
      ...adminKeyboard
    });
  }
});

// Handle admin menu items
bot.on('text', async (ctx) => {
  if (!ADMIN_IDS.includes(ctx.from.id.toString())) return;
  
  const text = ctx.message.text;
  
  if (text === "📊 Dashboard") {
    await ctx.reply("Opening admin dashboard...");
    // Redirect to web admin panel
    await ctx.reply("🌐 Web Admin: https://bingo-telegram-game.onrender.com/admin");
  }
  else if (text === "👥 Users") {
    const users = await User.find({}).limit(10);
    let userList = "👥 *RECENT USERS*\n\n";
    users.forEach((user, index) => {
      userList += `${index + 1}. ${user.userName} - ${user.balance} ETB\n`;
    });
    await ctx.reply(userList, { parse_mode: 'Markdown' });
  }
});

// Error handling
bot.catch((err, ctx) => {
  console.error(`Error for ${ctx.updateType}:`, err);
});

// Start bot
bot.launch()
  .then(() => {
    console.log('✅ Telegram Bot is running...');
    console.log(`🤖 Bot: @${bot.botInfo.username}`);
  })
  .catch(err => {
    console.error('❌ Failed to start bot:', err);
  });

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

module.exports = { bot, getOrCreateUser };
