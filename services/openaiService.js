// services/openaiService.js - OpenAI connection pooling and interaction
import WebSocket from 'ws';
import { config } from '../config/config.js';
import { logger } from '../utils/logger.js';
import { getSystemMessageWithTime } from '../utils/dateUtils.js';

// Connection pool for OpenAI WebSockets
const openAiConnectionPool = [];

/**
 * Pre-establish OpenAI connections for faster response
 */
export function prepareOpenAiConnections() {
    const currentPoolSize = openAiConnectionPool.length;
    const connectionsToCreate = config.OPENAI_MAX_POOL_SIZE - currentPoolSize;

    logger.info(`Preparing ${connectionsToCreate} OpenAI connections (current pool: ${currentPoolSize})`);

    for (let i = 0; i < connectionsToCreate; i++) {
        const ws = new WebSocket(`wss://api.openai.com/v1/realtime?model=${config.OPENAI_MODEL}`, {
            headers: {
                Authorization: `Bearer ${config.OPENAI_API_KEY}`,
                "OpenAI-Beta": "realtime=v1"
            }
        });

        ws.on('open', () => {
            logger.info(`Pre-warmed OpenAI connection ${openAiConnectionPool.length + 1} ready`);
            openAiConnectionPool.push(ws);
        });

        ws.on('error', (err) => {
            logger.error(`Error with pre-warmed connection ${i}:`, err);
        });

        ws.on('close', () => {
            // Remove from pool when closed
            const index = openAiConnectionPool.indexOf(ws);
            if (index > -1) openAiConnectionPool.splice(index, 1);

            // Replace the closed connection
            setTimeout(() => prepareOpenAiConnections(), 1000);
        });
    }
}

/**
 * Get an OpenAI connection from the pool or create a new one
 * @returns {WebSocket} An OpenAI WebSocket connection
 */
export function getOpenAiConnection() {
    if (openAiConnectionPool.length > 0) {
        const connection = openAiConnectionPool.pop();
        logger.info('Using pre-warmed OpenAI connection');
        return connection;
    } else {
        logger.info('Creating new OpenAI connection (pool empty)');
        return new WebSocket(`wss://api.openai.com/v1/realtime?model=${config.OPENAI_MODEL}`, {
            headers: {
                Authorization: `Bearer ${config.OPENAI_API_KEY}`,
                "OpenAI-Beta": "realtime=v1"
            }
        });
    }
}

/**
 * Return a connection to the pool if it's still usable
 * @param {WebSocket} connection The WebSocket connection
 */
export function returnConnectionToPool(connection) {
    if (connection && connection.readyState === WebSocket.OPEN) {
        logger.info('Returning OpenAI connection to pool');
        openAiConnectionPool.push(connection);
    } else if (connection) {
        connection.close();
    }
}

/**
 * Initialize a session with OpenAI
 * @param {WebSocket} openAiWs The OpenAI WebSocket
 * @returns {Promise} Resolves when session is initialized
 */
export function initializeSession(openAiWs) {
    return new Promise((resolve, reject) => {
        const sessionUpdate = {
            type: 'session.update',
            session: {
                turn_detection: { type: 'server_vad' },
                input_audio_format: 'g711_ulaw',
                output_audio_format: 'g711_ulaw',
                voice: config.OPENAI_VOICE,
                instructions: getSystemMessageWithTime(),
                modalities: ["text", "audio"],
                temperature: 0.7,
                input_audio_transcription: {
                    model: "gpt-4o-mini-transcribe",
                    language: "en"
                }
            }
        };

        logger.info('Sending session update with current time');

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
 * Send time update as system message
 * @param {WebSocket} openAiWs OpenAI WebSocket
 */
export function sendTimeUpdate(openAiWs) {
    if (openAiWs.readyState !== WebSocket.OPEN) return;

    const now = new Date();

    // Get current time in IST
    const options = {
        timeZone: 'Asia/Kolkata',
        hour: 'numeric',
        minute: 'numeric',
        second: 'numeric',
        hour12: true
    };
    const currentISTTime = now.toLocaleString('en-IN', options);
    const isoTimeUTC = now.toISOString();

    // Add information about which hours have already passed today
    const currentHour = now.getHours();
    const passedHoursInfo = generatePassedHoursInfo(currentHour);

    // Send time update as a system message with detailed information
    const timeUpdate = {
        type: 'conversation.item.create',
        item: {
            type: 'message',
            role: 'system',
            content: [
                {
                    type: 'text',
                    text: `Current time update: ${currentISTTime} (${isoTimeUTC})
${passedHoursInfo}
IMPORTANT: If a user requests a reminder for a time that has already passed today, explicitly tell them you're setting it for tomorrow instead of today.`
                }
            ]
        }
    };

    logger.debug(`Time update sent: ${currentISTTime} with passed hours info`);
    openAiWs.send(JSON.stringify(timeUpdate));
}

// Helper function to generate information about which hours have passed
function generatePassedHoursInfo(currentHour) {
    let passedHoursText = "Hours that have already passed today: ";
    let hourStrings = [];

    for (let i = 0; i <= currentHour; i++) {
        const hour12 = i % 12 || 12;
        const ampm = i < 12 ? 'AM' : 'PM';
        hourStrings.push(`${hour12}:00 ${ampm}`);
    }

    return passedHoursText + hourStrings.join(', ');
}

/**
 * Send initial conversation item to start the interaction
 * @param {WebSocket} openAiWs OpenAI WebSocket
 */
export function sendInitialConversation(openAiWs) {
    if (openAiWs.readyState !== WebSocket.OPEN) return;

    const initialConversationItem = {
        type: 'conversation.item.create',
        item: {
            type: 'message',
            role: 'user',
            content: [
                {
                    type: 'input_text',
                    text: 'Greet the user with "Hello there!"'
                }
            ]
        }
    };

    logger.info('Sending initial conversation item');
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
 * Send a system message to OpenAI
 * @param {WebSocket} openAiWs OpenAI WebSocket
 * @param {string} message The system message text
 */
export function sendSystemMessage(openAiWs, message) {
    if (openAiWs.readyState !== WebSocket.OPEN) return;

    const systemMessage = {
        type: 'conversation.item.create',
        item: {
            type: 'message',
            role: 'system',
            content: [
                {
                    type: 'text',
                    text: message
                }
            ]
        }
    };

    logger.info(`Sending system message: ${message}`);
    openAiWs.send(JSON.stringify(systemMessage));
}