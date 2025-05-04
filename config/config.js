// config/config.js - Configuration settings with improved list commands
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Validate required environment variables
if (!process.env.OPENAI_API_KEY) {
    console.error('Missing OPENAI_API_KEY in environment variables');
    process.exit(1);
}

export const config = {
    // Server config
    PORT: process.env.PORT || 5050,

    // OpenAI config
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    OPENAI_MODEL: 'gpt-4o-mini-realtime-preview-2024-12-17',
    OPENAI_VOICE: 'shimmer',

    // Greeting preload config
    GREETING_PRELOAD_ENABLED: process.env.GREETING_PRELOAD_ENABLED !== 'false', // Enable by default
    GREETING_CACHE_TTL: parseInt(process.env.GREETING_CACHE_TTL || '3600000', 10), // 1 hour in ms
    GREETING_TEXT: process.env.GREETING_TEXT || 'Hello there! I\'m your reminder assistant. How can I help you today?',

    // System message
    SYSTEM_MESSAGE_BASE: `You are a helpful and bubbly AI assistant who specializes in setting reminders and managing schedules. You're designed to help users stay organized while maintaining a warm conversational tone. You have a penchant for gentle humor and empathetic responses.

REMINDERS FUNCTIONALITY (Important):
You can handle several types of reminder commands through your special JSON format. Always respond naturally first, then include the JSON marker for system processing.

1. CREATE REMINDERS:
   When a user asks to set a reminder, extract: (1) the task, and (2) the time/date.
   Format: {{REMINDER: {"command": "create", "task": "task description", "time": "HH:MM", "date":"dd/mm/yyyy"}}}
   Example: "Remind me to call Mom at 3pm tomorrow" → {{REMINDER: {"command": "create", "task": "call Mom", "time": "15:00", "date":"08/05/2025"}}}

2. LIST REMINDERS:
   When a user asks to see their reminders, include this marker:
   Format: {{REMINDER: {"command": "list"}}}
   Example: "Show me my reminders" → {{REMINDER: {"command": "list"}}}
   
   IMPORTANT FOR LIST COMMAND: When responding to a list command, you'll be given details about the user's reminders. When you get this information, make sure to read it back to the user conversationally. For example:
   
   "Here are your reminders: You have a reminder to call Mom at 3:00 PM today, and another reminder to pick up groceries at 5:00 PM tomorrow. Would you like to make any changes to these reminders?"
   
   If the user has no reminders, let them know with something like:
   "You don't have any reminders set up at the moment. Would you like to create one?"

3. RESCHEDULE REMINDERS:
   When a user wants to change a reminder's time:
   Format: {{REMINDER: {"command": "reschedule", "id": "reminder_id", "time": "new_time", "date": "new_date"}}}
   Example: "Change my 3pm reminder to 5pm" → {{REMINDER: {"command": "reschedule", "id": "1715348591234", "time": "17:00", "date":"07/05/2025"}}}

4. CANCEL REMINDERS:
   When a user wants to delete a reminder:
   Format: {{REMINDER: {"command": "cancel", "id": "reminder_id"}}}
   Example: "Cancel my meeting reminder" → {{REMINDER: {"command": "cancel", "id": "1715348591234"}}}

5. UPDATE REMINDER TASK:
   When a user wants to change what a reminder is about:
   Format: {{REMINDER: {"command": "update", "id": "reminder_id", "task": "new task description"}}}
   Example: "Change my 3pm reminder to pick up groceries" → {{REMINDER: {"command": "update", "id": "1715348591234", "task": "pick up groceries"}}}

IMPORTANT TIME HANDLING:
- Always calculate precise timestamps based on the CURRENT TIME provided to you
- For relative times (e.g., "in 5 minutes"), calculate the exact time
- For specific times (e.g., "at 3pm"), convert to 24-hour format
- For dates, use dd/mm/yyyy format
- For ambiguous times like "tomorrow", assume a sensible default time (e.g., 9:00 AM)
- If no specific date is mentioned, assume the current date for times later today, or tomorrow for times that have already passed today

EXAMPLES FOR DIFFERENT COMMANDS:
1. "Remind me to call Mom in 30 minutes" → "I'll remind you to call Mom in 30 minutes, at 2:30 PM." {{REMINDER: {"command": "create", "task": "call Mom", "time": "14:30", "date":"07/05/2025"}}}

2. "What reminders do I have?" → "Let me check your reminders for you." {{REMINDER: {"command": "list"}}}

3. "Move my dentist reminder to tomorrow at 10am" → "I've rescheduled your dentist reminder to tomorrow at 10:00 AM." {{REMINDER: {"command": "reschedule", "id": "1715348591234", "time": "10:00", "date":"08/05/2025"}}}

4. "Cancel my workout reminder" → "I've cancelled your workout reminder." {{REMINDER: {"command": "cancel", "id": "1715348591234"}}}

5. "Change my 3pm reminder to say 'pick up dry cleaning'" → "I've updated your 3:00 PM reminder to 'pick up dry cleaning'." {{REMINDER: {"command": "update", "id": "1715348591234", "task": "pick up dry cleaning"}}}

VOICE INSTRUCTIONS (Important - follow these exactly):
Voice: Speak in a warm, upbeat, and friendly tone—like a close buddy who checks in with genuine care. Use a calm, steady rhythm with a little enthusiasm to keep things positive.
Tone: Be supportive and encouraging, never pushy. Sound like someone who's rooting for the user, nudging them gently when needed.
Dialect: Use Indian English—conversational and natural, with little touches like "yaa," "just checking," or "hope you didn't forget." Sound local, familiar, and kind.
Pronunciation: Speak clearly and expressively, with a smooth rhythm and slight Indian intonation. Emphasize key words just enough to keep the user engaged without sounding robotic.`,

    // Reminder defaults
    REMINDER_DEFAULT_MINUTES: 5,
    REMINDER_MAX_MINUTES: 10080, // 1 week in minutes

    // Event types
    KEY_EVENT_TYPES: [
        'conversation.item.input_audio_transcription.delta',
        'conversation.item.input_audio_transcription.completed',
        'response.audio_transcript.done',
        'input_audio_buffer.speech_started',
        'input_audio_buffer.speech_stopped'
    ],

    // Commands that can be recognized
    REMINDER_COMMANDS: {
        CREATE: 'create',
        LIST: 'list',
        RESCHEDULE: 'reschedule',
        CANCEL: 'cancel',
        UPDATE: 'update'
    },

    // Regular expressions for intent detection
    INTENT_PATTERNS: {
        CREATE_REMINDER: [
            /remind\s+me\s+to\s+(.+?)(?:\s+(?:at|on|in|by)\s+(.+?))?(?:\s+|$)/i,
            /set\s+(?:a|an)?\s*reminder\s+(?:to|for)\s+(.+?)(?:\s+(?:at|on|in|by)\s+(.+?))?(?:\s+|$)/i,
            /create\s+(?:a|an)?\s*reminder\s+(?:to|for)\s+(.+?)(?:\s+(?:at|on|in|by)\s+(.+?))?(?:\s+|$)/i,
            /schedule\s+(?:a|an)?\s*reminder\s+(?:to|for)\s+(.+?)(?:\s+(?:at|on|in|by)\s+(.+?))?(?:\s+|$)/i
        ],
        LIST_REMINDERS: [
            /(?:show|list|view|get|what are)\s+(?:my|all)?\s*reminders/i,
            /what\s+(?:reminders|tasks|events)\s+do\s+i\s+have/i,
            /read\s+(?:my|all)?\s*reminders/i,
            /any\s+reminders/i,
            /tell\s+me\s+(?:my|about|all)?\s*(?:my)?\s*reminders/i
        ],
        RESCHEDULE_REMINDER: [
            /(?:reschedule|move|change|shift)\s+(?:my|the)?\s*reminder\s+(?:for|about|to)?\s*(.+?)(?:\s+to\s+(.+?))?(?:\s+|$)/i,
            /(?:update|change)\s+(?:the|my)?\s*time\s+(?:for|of)\s+(?:my|the)?\s*reminder\s+(?:for|about|to)?\s*(.+?)(?:\s+to\s+(.+?))?(?:\s+|$)/i
        ],
        CANCEL_REMINDER: [
            /(?:cancel|delete|remove)\s+(?:my|the)?\s*reminder\s+(?:for|about|to)?\s*(.+?)(?:\s+|$)/i,
            /(?:stop|drop)\s+(?:my|the)?\s*reminder\s+(?:for|about|to)?\s*(.+?)(?:\s+|$)/i
        ],
        UPDATE_REMINDER: [
            /(?:update|change|edit)\s+(?:my|the)?\s*reminder\s+(?:from|for|about)?\s*(.+?)(?:\s+to\s+(.+?))?(?:\s+|$)/i,
            /(?:modify|revise)\s+(?:my|the)?\s*reminder\s+(?:from|for|about)?\s*(.+?)(?:\s+to\s+(.+?))?(?:\s+|$)/i
        ]
    },

    // Example phrases for different reminder command types
    EXAMPLE_PHRASES: {
        CREATE: [
            "Remind me to call Mom at 3pm",
            "Set a reminder to take my medicine in 2 hours",
            "Create a reminder for my doctor's appointment on Monday at 10am",
            "Remind me to pick up groceries tomorrow evening"
        ],
        LIST: [
            "Show me my reminders",
            "What reminders do I have today?",
            "List all my reminders",
            "Any reminders for today?"
        ],
        RESCHEDULE: [
            "Move my dentist reminder to tomorrow at 10am",
            "Reschedule my 3pm meeting to 5pm",
            "Change the time of my medication reminder to 9pm",
            "Shift my reminder about the call to next week"
        ],
        CANCEL: [
            "Cancel my workout reminder",
            "Delete the reminder about meeting John",
            "Remove my 3pm reminder",
            "Stop the reminder for taking medicine"
        ],
        UPDATE: [
            "Change my 3pm reminder to picking up dry cleaning",
            "Update my reminder about the meeting to include the agenda",
            "Edit my doctor appointment reminder to add the address",
            "Modify my reminder to buy milk to buying groceries"
        ]
    },

    // Formats for reminder responses
    REMINDER_RESPONSES: {
        NO_REMINDERS: [
            "You don't have any reminders set up at the moment. Would you like to create one?",
            "I don't see any reminders on your schedule. Need me to set one up for you?",
            "Your reminder list is empty. Would you like me to help you create a reminder?",
            "There are no reminders in your list right now. Can I help you set one up?"
        ],
        SINGLE_REMINDER: [
            "You have one reminder: {task} at {time} {date_context}.",
            "I found one reminder for you: {task} scheduled for {time} {date_context}.",
            "There's one reminder on your list: {task} at {time} {date_context}."
        ],
        MULTIPLE_REMINDERS: [
            "Here are your reminders:\n{reminder_list}\nIs there anything you'd like me to do with these?",
            "I found these reminders for you:\n{reminder_list}\nWould you like to make any changes?",
            "Your reminder list has {count} items:\n{reminder_list}\nIs there anything else you need?"
        ],
        REMINDER_CREATED: [
            "I've set a reminder for you to {task} at {time} {date_context}.",
            "Got it! I'll remind you to {task} at {time} {date_context}.",
            "Your reminder is set. I'll remind you to {task} at {time} {date_context}."
        ]
    }
};