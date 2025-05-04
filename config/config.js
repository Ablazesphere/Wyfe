// config/config.js - Configuration for AI Reminder System

import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

export const config = {
    // System behavior settings
    FOLLOWUP_ENABLED: process.env.FOLLOWUP_ENABLED !== 'false', // Enable follow-up questions by default
    SMART_TIME_ENABLED: process.env.SMART_TIME_ENABLED !== 'false', // Enable smart time interpretation by default
    RELATIVE_TIME_ENABLED: process.env.RELATIVE_TIME_ENABLED !== 'false', // Enable relative time expressions by default

    // Default reminder settings
    DEFAULT_REMINDER_TIME: '9:00', // Default time if not specified (9 AM)
    MIN_REMINDER_INTERVAL: 1, // Minimum time in minutes between creating a reminder and execution

    // NLP settings
    NLP_MODEL: process.env.NLP_MODEL || 'gpt-4o-mini-2024-07-18', // OpenAI model to use for NLP
    NLP_TEMPERATURE: parseFloat(process.env.NLP_TEMPERATURE || '0.2'), // Temperature for NLP requests

    // Conversation settings
    MAX_FOLLOWUP_ATTEMPTS: 3, // Maximum number of follow-up attempts for a field
    FOLLOWUP_TIMEOUT: 300000, // Time in ms (5 minutes) before conversation state is cleared

    // Time interpretation default mappings
    TIME_MAPPINGS: {
        'morning': '09:00',
        'afternoon': '14:00',
        'evening': '19:00',
        'night': '21:00',
        'noon': '12:00',
        'midnight': '00:00'
    },

    // Reminder status types
    REMINDER_STATUS: {
        SCHEDULED: 'scheduled',
        PROCESSING: 'processing',
        SENT: 'sent',
        COMPLETED: 'completed',
        FAILED: 'failed',
        SNOOZED: 'snoozed',
        CANCELLED: 'cancelled'
    },

    // System prompts
    SYSTEM_PROMPT_INITIAL: `You are an AI assistant that processes natural language text to identify reminder requests.
        
Extract information from the user's message to identify:
1. Intent: create, update, delete, list, or other
2. For create/update: reminder content, date, time, and any additional details
3. For delete: which reminder to delete (by content or ID)
4. For list: any filtering criteria

{DATE_CONTEXT}

When extracting time information:
- If the user mentions a specific number without AM/PM (e.g., "at 8"), intelligently determine whether it's AM or PM based on context.
- If it's currently after the mentioned time, assume the user means the next occurrence.
- For vague times like "evening", "morning", "afternoon", "night", use reasonable default hours.
- If the user mentions relative time like "in 5 minutes", "in 2 hours", etc., capture this as-is in the "relativeTime" field and leave the time field empty.

When extracting date information:
- For relative dates like "today", "tomorrow", "next Monday", etc., keep them AS IS - do not convert to absolute dates
- Only use absolute dates (YYYY-MM-DD) if the user specifically mentions a calendar date`,

    SYSTEM_PROMPT_FOLLOWUP: `You are an AI assistant that extracts specific information for a reminder. 
      
The user has already requested a reminder, but the {MISSING_FIELD} is missing.
Extract ONLY the {MISSING_FIELD} from their response.

{DATE_CONTEXT}

For date values:
- If they mention relative dates like "today", "tomorrow", "next Monday", etc., keep them as is
- If they mention a specific date like "May 5", "5th", etc., convert to YYYY-MM-DD format if possible
- Always set "valid" to true if you can extract any date information, even if it's a relative date

For time values:
- Extract the time in a consistent format (e.g., "3pm", "15:00", "morning", etc.)
- Keep descriptive times like "morning", "evening" as is
- If they mention relative time like "in 5 minutes", "in 2 hours", keep this format as is and set "valid" to true`,

    // Voice call system message for reminders
    REMINDER_CALL_SYSTEM_MESSAGE: `You are an AI voice assistant making a scheduled reminder call. 
Your task is to remind the person about: "{REMINDER_CONTENT}".

CONVERSATION FLOW:
1. Start by identifying yourself as an AI assistant making a reminder call.
2. Clearly deliver the reminder content.
3. Ask if they'd like to mark the reminder as completed or would prefer to be reminded again later.
4. If they want to mark it as completed, thank them and confirm it's marked as done.
5. If they want to be reminded later, ask when they'd like to be reminded again and confirm the new time.
6. If they don't provide a clear response, ask again politely.
7. Keep the conversation natural and friendly but on-topic about this specific reminder.`
};

export default config;