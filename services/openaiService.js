// services/openaiService.js - Updated for reminder context

import WebSocket from 'ws';
import { config } from '../config/config.js';
import { logger } from '../utils/logger.js';
import { updateReminderStatus } from './reminderService.js';

/**
 * Create a new OpenAI connection
 * @returns {WebSocket} An OpenAI WebSocket connection
 */
export function getOpenAiConnection() {
    logger.info('Creating new OpenAI connection');
    return new WebSocket(`wss://api.openai.com/v1/realtime?model=${config.OPENAI_MODEL}`, {
        headers: {
            Authorization: `Bearer ${config.OPENAI_API_KEY}`,
            "OpenAI-Beta": "realtime=v1"
        }
    });
}

/**
 * Close the WebSocket connection
 * @param {WebSocket} connection The WebSocket connection
 */
export function closeConnection(connection) {
    if (connection && connection.readyState === WebSocket.OPEN) {
        logger.info('Closing OpenAI connection');
        connection.close();
    }
}

/**
 * Initialize a session with OpenAI
 * @param {WebSocket} openAiWs The OpenAI WebSocket
 * @param {Object} options Session options including reminderContext
 * @returns {Promise} Resolves when session is initialized
 */
export function initializeSession(openAiWs, options = {}) {
    return new Promise((resolve, reject) => {
        let systemInstructions = config.SYSTEM_MESSAGE_BASE;

        // If this is a reminder call, customize the system instructions
        if (options.reminderContext) {
            const { reminderContent } = options.reminderContext;

            systemInstructions = `You are an AI voice assistant making a scheduled reminder call. 
            Your task is to remind the person about: "${reminderContent}".
            
            CONVERSATION FLOW:
            1. Start by identifying yourself as an AI assistant making a reminder call.
            2. Clearly deliver the reminder content.
            3. Ask if they'd like to mark the reminder as completed or would prefer to be reminded again later.
            4. If they want to mark it as completed, thank them and confirm it's marked as done.
            5. If they want to be reminded later, ask when they'd like to be reminded again and confirm the new time.
            6. If they don't provide a clear response, ask again politely.
            7. Keep the conversation natural and friendly but on-topic about this specific reminder.

            VOICE INSTRUCTIONS (Important - follow these exactly):
            Voice: Speak in a warm, professional tone with a natural conversational cadence.
            Tone: Be supportive, clear, and direct, with appropriate enthusiasm about helping them remember this task.
            Pronunciation: Speak clearly and expressively, with good rhythm and appropriate emphasis.`;
        }

        const sessionUpdate = {
            type: 'session.update',
            session: {
                turn_detection: { type: 'server_vad' },
                input_audio_format: 'g711_ulaw',
                output_audio_format: 'g711_ulaw',
                voice: config.OPENAI_VOICE,
                instructions: systemInstructions,
                modalities: ["text", "audio"],
                temperature: 0.7,
                input_audio_transcription: {
                    model: "gpt-4o-mini-transcribe",
                    language: "en"
                }
            }
        };

        logger.info('Sending session update', { isReminderContext: !!options.reminderContext });

        if (openAiWs.readyState === WebSocket.OPEN) {
            openAiWs.send(JSON.stringify(sessionUpdate));
            resolve();
        } else {
            openAiWs.on('open', () => {
                openAiWs.send(JSON.stringify(sessionUpdate));
                resolve();
            });

            openAiWs.on('error', (error) => {
                reject(error);
            });
        }
    });
}

/**
 * Send initial conversation item to start the interaction
 * @param {WebSocket} openAiWs OpenAI WebSocket
 * @param {Object} options Options including reminderContext
 */
export function sendInitialConversation(openAiWs, options = {}) {
    if (openAiWs.readyState !== WebSocket.OPEN) return;

    let initialText = 'Greet the user with a friendly hello and ask how you can help them today.';

    // If this is a reminder call, customize the initial message
    if (options.reminderContext) {
        const { reminderContent } = options.reminderContext;
        initialText = `Start the reminder call by introducing yourself as an AI assistant making a scheduled reminder call about ${reminderContent}.`;
    }

    const initialConversationItem = {
        type: 'conversation.item.create',
        item: {
            type: 'message',
            role: 'user',
            content: [
                {
                    type: 'input_text',
                    text: initialText
                }
            ]
        }
    };

    logger.info('Sending initial conversation item', { isReminderContext: !!options.reminderContext });
    openAiWs.send(JSON.stringify(initialConversationItem));

    // Request immediate response
    openAiWs.send(JSON.stringify({
        type: 'response.create'
    }));
}

/**
 * Truncate the assistant's response
 * @param {WebSocket} openAiWs OpenAI WebSocket
 * @param {string} itemId Item ID to truncate
 * @param {number} elapsedTime Elapsed time in ms
 */
export function truncateAssistantResponse(openAiWs, itemId, elapsedTime) {
    if (!itemId || openAiWs.readyState !== WebSocket.OPEN) return;

    const truncateEvent = {
        type: 'conversation.item.truncate',
        item_id: itemId,
        content_index: 0,
        audio_end_ms: elapsedTime
    };

    openAiWs.send(JSON.stringify(truncateEvent));
    logger.debug(`Truncated assistant response at ${elapsedTime}ms`);
}

/**
 * Send audio buffer to OpenAI
 * @param {WebSocket} openAiWs OpenAI WebSocket
 * @param {string} audioData Audio data
 */
export function sendAudioBuffer(openAiWs, audioData) {
    if (openAiWs.readyState !== WebSocket.OPEN) return;

    const audioAppend = {
        type: 'input_audio_buffer.append',
        audio: audioData
    };

    openAiWs.send(JSON.stringify(audioAppend));
}

/**
 * Parse user intent from conversation for reminder calls
 * @param {string} transcript User's transcript
 * @param {Object} reminderContext Reminder context
 * @returns {Object} Parsed intent
 */
export function parseReminderIntent(transcript, reminderContext) {
    // Simple intent detection for reminders
    const lowerTranscript = transcript.toLowerCase();

    // Check for completion intent
    if (
        lowerTranscript.includes('complete') ||
        lowerTranscript.includes('done') ||
        lowerTranscript.includes('finished') ||
        lowerTranscript.includes('mark as complete') ||
        lowerTranscript.includes('completed')
    ) {
        return {
            intent: 'complete',
            reminderId: reminderContext.reminderId
        };
    }

    // Check for snooze/reschedule intent
    if (
        lowerTranscript.includes('remind me later') ||
        lowerTranscript.includes('snooze') ||
        lowerTranscript.includes('reschedule') ||
        lowerTranscript.includes('later')
    ) {
        // Try to extract a time reference (simple approach)
        const timeMatches = lowerTranscript.match(/(\d+)\s*(hour|minute|min|hr)/);
        const timeAmount = timeMatches ? parseInt(timeMatches[1], 10) : 30;
        const timeUnit = timeMatches ?
            timeMatches[2].startsWith('h') ? 'hours' : 'minutes' :
            'minutes';

        return {
            intent: 'snooze',
            reminderId: reminderContext.reminderId,
            snoozeAmount: timeAmount,
            snoozeUnit: timeUnit
        };
    }

    // Default is no specific intent detected
    return {
        intent: 'unknown',
        reminderId: reminderContext.reminderId
    };
}

/**
 * Process reminder response based on intent
 * @param {Object} intent The detected intent
 * @returns {Promise<Object>} Processing result
 */
export async function processReminderIntent(intent) {
    try {
        switch (intent.intent) {
            case 'complete':
                // Mark reminder as completed
                await updateReminderStatus(intent.reminderId, 'completed', {
                    completedAt: new Date(),
                    completionMethod: 'call'
                });

                logger.info(`Marked reminder ${intent.reminderId} as completed`);
                return { success: true, message: 'Reminder marked as completed' };

            case 'snooze':
                // Calculate new scheduled time
                const now = new Date();
                let snoozedTime = new Date(now);

                if (intent.snoozeUnit === 'hours') {
                    snoozedTime.setHours(now.getHours() + intent.snoozeAmount);
                } else {
                    snoozedTime.setMinutes(now.getMinutes() + intent.snoozeAmount);
                }

                // Update reminder with new scheduled time
                await updateReminderStatus(intent.reminderId, 'snoozed', {
                    previousScheduledTime: now,
                    scheduledTime: snoozedTime,
                    snoozeAmount: intent.snoozeAmount,
                    snoozeUnit: intent.snoozeUnit
                });

                logger.info(`Snoozed reminder ${intent.reminderId} for ${intent.snoozeAmount} ${intent.snoozeUnit}`);
                return {
                    success: true,
                    message: `Reminder snoozed for ${intent.snoozeAmount} ${intent.snoozeUnit}`,
                    snoozedTime
                };

            default:
                logger.info(`No specific intent detected for reminder ${intent.reminderId}`);
                return { success: false, message: 'No action taken' };
        }
    } catch (error) {
        logger.error(`Error processing reminder intent for ${intent.reminderId}:`, error);
        return { success: false, message: 'Error processing intent', error: error.message };
    }
}