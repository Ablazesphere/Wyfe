// config/config.js - Configuration for general voice chatbot
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
    GREETING_TEXT: process.env.GREETING_TEXT || 'Hello there! I\'m your AI assistant. How can I help you today?',

    // System message for a general conversational assistant
    SYSTEM_MESSAGE_BASE: `You are a helpful and friendly AI voice assistant designed to have natural conversations with users. 
You respond in a conversational, warm manner and keep your responses concise and engaging.

You can discuss a wide range of topics including:
- Answering questions on virtually any subject
- Providing information about current events
- Having casual conversations
- Telling jokes or stories
- Discussing ideas, concepts, or hypotheticals
- Offering advice or suggestions on general topics

VOICE INSTRUCTIONS (Important - follow these exactly):
Voice: Speak in a warm, friendly tone with a natural conversational cadence.
Tone: Be supportive and helpful, with appropriate enthusiasm and empathy.
Pronunciation: Speak clearly and expressively, with good rhythm and appropriate emphasis.`,

    // Event types to track
    KEY_EVENT_TYPES: [
        'conversation.item.input_audio_transcription.delta',
        'conversation.item.input_audio_transcription.completed',
        'response.audio_transcript.done',
        'input_audio_buffer.speech_started',
        'input_audio_buffer.speech_stopped'
    ]
};