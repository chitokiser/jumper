import os
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import ApplicationBuilder, CommandHandler, ContextTypes

BOT_TOKEN = os.environ["BOT_TOKEN"]

async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    keyboard = [
        [InlineKeyboardButton("🎮 JUMP22 Game Hub", 
            url="https://jump22.netlify.app/merchants")],
        [
            InlineKeyboardButton("🗺️ Treasure Hunt", url="https://jump22.netlify.app/merchants"),
            InlineKeyboardButton("🛹 Monster Race", url="https://jump22.netlify.app/monsterrace"),
        ],
        [
            InlineKeyboardButton("🏹 Archery Hunt", url="https://jump22.netlify.app/bow"),
            InlineKeyboardButton("🃏 Memory Game", url="https://jump22.netlify.app/memory"),
        ],
        [
            InlineKeyboardButton("🏰 Monster Siege", url="https://jump22.netlify.app/conquest"),
        ],
    ]
    reply_markup = InlineKeyboardMarkup(keyboard)

    await update.message.reply_text(
        "🎮 *JUMP22 Game Hub*\n\n"
        "From GPS Treasure Hunt to Monster Battles!\n"
        "Pick a game, earn GP, and exchange for TON! 🚀",
        parse_mode="Markdown",
        reply_markup=reply_markup
    )

async def play(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await start(update, context)

def main():
    app = ApplicationBuilder().token(BOT_TOKEN).build()
    app.add_handler(CommandHandler("start", start))
    app.add_handler(CommandHandler("play", play))
    print("✅ Bot is running...")
    app.run_polling()

if __name__ == "__main__":
    main()