// bot.js - Simple Telegram Bot
require('dotenv').config();
const { Telegraf } = require('telegraf');

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

bot.start((ctx) => {
    ctx.reply(
        '🎮 Welcome to Bingo Elite!\n\n' +
        'Play real-time Bingo and win money!\n\n' +
        'Click below to launch the game:',
        {
            reply_markup: {
                inline_keyboard: [
                    [{
                        text: '🚀 LAUNCH GAME',
                        web_app: { url: process.env.SERVER_URL + '/game' }
                    }]
                ]
            }
        }
    );
});

bot.help((ctx) => {
    ctx.reply('Send /start to launch the game');
});

bot.launch()
    .then(() => console.log('🤖 Bot running!'))
    .catch(err => console.error('Bot error:', err));

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));