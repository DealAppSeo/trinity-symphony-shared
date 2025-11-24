#!/usr/bin/env python3
“””
Trinity Voice Bot - Voice-activated task insertion into Trinity Symphony
Listens for Telegram voice messages, converts to text, inserts into Supabase
“””

import os
import logging
from telegram import Update
from telegram.ext import Application, MessageHandler, CommandHandler, ContextTypes, filters
from supabase import create_client, Client

# Configure logging

logging.basicConfig(
format=’%(asctime)s - %(name)s - %(levelname)s - %(message)s’,
level=logging.INFO
)
logger = logging.getLogger(**name**)

# Environment variables

TELEGRAM_BOT_TOKEN = os.environ.get(‘TELEGRAM_BOT_TOKEN’)
SUPABASE_URL = os.environ.get(‘SUPABASE_URL’)
SUPABASE_KEY = os.environ.get(‘SUPABASE_SERVICE_ROLE_KEY’)

# Initialize Supabase client

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

async def start_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
“”“Handle /start command”””
welcome_message = “””
🎤 **Trinity Voice Bot Active**

Send me a voice message or text, and I’ll add it as a task to Trinity Symphony!

**How to use:**
• Send voice note: “Build a mobile controller for Trinity”
• Send text: “Create API documentation”
• I’ll insert it into trinity_tasks with priority 1
• HDM/APM/MEL will fight over who claims it first

**Commands:**
/start - Show this message
/status - Check bot status
/recent - Show last 5 tasks

Ready to orchestrate the symphony! 🎵
“””
await update.message.reply_text(welcome_message, parse_mode=‘Markdown’)

async def status_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
“”“Handle /status command - show system status”””
try:
# Quick health check
response = supabase.table(‘trinity_tasks’).select(‘status’, count=‘exact’).limit(1).execute()

```
    await update.message.reply_text(
        f"✅ **Trinity Voice Bot Status**\n\n"
        f"🔗 Connected to Supabase\n"
        f"📊 Database accessible\n"
        f"🎤 Ready to receive tasks\n\n"
        f"Send me your voice commands!",
        parse_mode='Markdown'
    )
except Exception as e:
    logger.error(f"Status check failed: {e}")
    await update.message.reply_text(f"⚠️ Connection issue: {str(e)}")
```

async def recent_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
“”“Handle /recent command - show last 5 tasks”””
try:
response = supabase.table(‘trinity_tasks’)  
.select(‘task_id, prompt, priority, status, assigned_agent, created_at’)  
.order(‘created_at’, desc=True)  
.limit(5)  
.execute()

```
    if not response.data:
        await update.message.reply_text("📭 No tasks in the system yet.")
        return
    
    message = "📋 **Last 5 Tasks:**\n\n"
    for task in response.data:
        status_emoji = {
            'not_started': '⚪',
            'in_progress': '🟡',
            'completed': '✅',
            'blocked': '🔴'
        }.get(task['status'], '❓')
        
        agent = task['assigned_agent'] or 'Unclaimed'
        message += f"{status_emoji} **[P{task['priority']}]** {task['prompt'][:50]}...\n"
        message += f"   Agent: {agent} | ID: {task['task_id']}\n\n"
    
    await update.message.reply_text(message, parse_mode='Markdown')
except Exception as e:
    logger.error(f"Recent tasks fetch failed: {e}")
    await update.message.reply_text(f"❌ Error fetching tasks: {str(e)}")
```

async def handle_voice(update: Update, context: ContextTypes.DEFAULT_TYPE):
“”“Handle voice messages - convert to text and insert task”””
try:
# Get voice file
voice = update.message.voice
voice_file = await context.bot.get_file(voice.file_id)

```
    # Download voice file
    voice_path = f"/tmp/voice_{voice.file_id}.ogg"
    await voice_file.download_to_drive(voice_path)
    
    # Send acknowledgment
    processing_msg = await update.message.reply_text("🎤 Processing your voice command...")
    
    # Telegram doesn't provide transcription API - we need to use the text
    # For now, ask user to send text version or integrate with a speech-to-text service
    await processing_msg.edit_text(
        "⚠️ Voice transcription requires external API.\n\n"
        "**For now, please send your task as text:**\n"
        "Just type what you want the symphony to build!\n\n"
        "Or I can help you set up Deepgram/AssemblyAI for automatic transcription. "
        "Say 'SETUP VOICE TRANSCRIPTION' and I'll show you how."
    )
    
    # Clean up
    if os.path.exists(voice_path):
        os.remove(voice_path)
        
except Exception as e:
    logger.error(f"Voice processing error: {e}")
    await update.message.reply_text(f"❌ Voice processing failed: {str(e)}")
```

async def handle_text(update: Update, context: ContextTypes.DEFAULT_TYPE):
“”“Handle text messages - insert as task into Supabase”””
try:
user_text = update.message.text

```
    # Skip if it's a command
    if user_text.startswith('/'):
        return
    
    # Send acknowledgment
    processing_msg = await update.message.reply_text("⚙️ Creating task...")
    
    # Insert into Supabase trinity_tasks
    task_data = {
        'task_type': 'feature',
        'priority': 1,
        'status': 'not_started',
        'prompt': user_text,
        'assigned_agent': None,  # Let agents claim it
        'output_location': 'GitHub: trinity-symphony-shared',
        'cost_limit': 2.00
    }
    
    response = supabase.table('trinity_tasks').insert(task_data).execute()
    
    if response.data:
        task_id = response.data[0]['task_id']
        await processing_msg.edit_text(
            f"✅ **Task Created!**\n\n"
            f"📝 **Task:** {user_text[:100]}...\n"
            f"🆔 **ID:** {task_id}\n"
            f"⚡ **Priority:** 1\n"
            f"🎯 **Status:** Waiting for agent to claim\n\n"
            f"HDM, APM, or MEL will pick this up within 60 seconds! 🚀",
            parse_mode='Markdown'
        )
        logger.info(f"Task {task_id} created: {user_text[:50]}")
    else:
        await processing_msg.edit_text("❌ Failed to create task. Check logs.")
        
except Exception as e:
    logger.error(f"Text processing error: {e}")
    await update.message.reply_text(f"❌ Task creation failed: {str(e)}")
```

async def handle_error(update: Update, context: ContextTypes.DEFAULT_TYPE):
“”“Log errors”””
logger.error(f”Update {update} caused error {context.error}”)

def main():
“”“Start the bot”””
if not TELEGRAM_BOT_TOKEN:
logger.error(“TELEGRAM_BOT_TOKEN not set!”)
return

```
if not SUPABASE_URL or not SUPABASE_KEY:
    logger.error("Supabase credentials not set!")
    return

# Create application
application = Application.builder().token(TELEGRAM_BOT_TOKEN).build()

# Add handlers
application.add_handler(CommandHandler("start", start_command))
application.add_handler(CommandHandler("status", status_command))
application.add_handler(CommandHandler("recent", recent_command))
application.add_handler(MessageHandler(filters.VOICE, handle_voice))
application.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_text))
application.add_error_handler(handle_error)

# Start bot
logger.info("🎤 Trinity Voice Bot starting...")
application.run_polling(allowed_updates=Update.ALL_TYPES)
```

if **name** == ‘**main**’:
main()
