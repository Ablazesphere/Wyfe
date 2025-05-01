// services/openaiService.js - OpenAI interaction with preloading support
import WebSocket from 'ws';
import { config } from '../config/config.js';
import { logger } from '../utils/logger.js';
import { getSystemMessageWithTime } from '../utils/dateUtils.js';

/**
 * Maintains a cache of pregenerated greeting audio responses
 */
let greetingAudioCache = {
    buffer: null,
    itemId: null,
    lastGenerated: null,
    isGenerating: false
};

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
    const options = {
        timeZone: 'Asia/Kolkata',
        hour: 'numeric',
        minute: 'numeric',
        second: 'numeric',
        hour12: true
    };
    const currentISTTime = now.toLocaleString('en-IN', options);
    const isoTimeUTC = now.toISOString();

    // Send time update as a system message
    const timeUpdate = {
        type: 'conversation.item.create',
        item: {
            type: 'message',
            role: 'system',
            content: [
                {
                    type: 'text',
                    text: `Current time update: ${currentISTTime} (${isoTimeUTC})`
                }
            ]
        }
    };

    logger.debug(`Time update sent: ${currentISTTime}`);
    openAiWs.send(JSON.stringify(timeUpdate));
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
 * Preload greeting audio to eliminate initial silence
 * @returns {Promise} Resolves when audio is cached
 */
export function preloadGreetingAudio() {
    // If we're already generating or have a recent cache, don't regenerate
    if (greetingAudioCache.isGenerating) return Promise.resolve();

    const now = new Date();
    const cacheAge = greetingAudioCache.lastGenerated ?
        (now - greetingAudioCache.lastGenerated) : Infinity;

    // Only regenerate if cache is older than the TTL
    if (greetingAudioCache.buffer && cacheAge < config.GREETING_CACHE_TTL) return Promise.resolve();

    greetingAudioCache.isGenerating = true;
    logger.info('Preloading greeting audio...');

    return new Promise((resolve, reject) => {
        // Create a temporary WebSocket connection just for preloading
        const tempWs = getOpenAiConnection();
        let audioData = [];
        let responseItemId = null;

        tempWs.on('open', () => {
            // Initialize session
            initializeSession(tempWs)
                .then(() => {
                    // Send greeting request
                    const greetingRequest = {
                        type: 'conversation.item.create',
                        item: {
                            type: 'message',
                            role: 'user',
                            content: [
                                {
                                    type: 'input_text',
                                    text: config.GREETING_TEXT
                                }
                            ]
                        }
                    };

                    tempWs.send(JSON.stringify(greetingRequest));

                    // Request response
                    tempWs.send(JSON.stringify({
                        type: 'response.create'
                    }));
                })
                .catch(err => {
                    logger.error('Failed to initialize preload session:', err);
                    tempWs.close();
                    greetingAudioCache.isGenerating = false;
                    reject(err);
                });
        });

        tempWs.on('message', (data) => {
            try {
                const message = JSON.parse(data);

                // Collect audio data
                if (message.type === 'response.audio.delta' && message.delta) {
                    audioData.push(message.delta);

                    if (message.item_id && !responseItemId) {
                        responseItemId = message.item_id;
                    }
                }

                // When audio generation is complete
                if (message.type === 'response.audio_transcript.done') {
                    logger.info('Greeting audio preloaded successfully');

                    // Cache the audio buffer and item ID
                    greetingAudioCache = {
                        buffer: audioData,
                        itemId: responseItemId,
                        lastGenerated: new Date(),
                        isGenerating: false
                    };

                    // Close the temporary connection
                    tempWs.close();
                    resolve();
                }
            } catch (error) {
                logger.error('Error processing preload message:', error);
            }
        });

        tempWs.on('error', (error) => {
            logger.error('Error in preload connection:', error);
            greetingAudioCache.isGenerating = false;
            tempWs.close();
            reject(error);
        });

        // Set timeout to prevent hanging
        setTimeout(() => {
            if (greetingAudioCache.isGenerating) {
                logger.warn('Preload timed out after 10 seconds');
                greetingAudioCache.isGenerating = false;
                tempWs.close();
                reject(new Error('Preload timed out'));
            }
        }, 10000);
    });
}

/**
 * Sends preloaded greeting audio to the client
 * @param {WebSocket} connection Twilio WebSocket connection 
 * @param {string} streamSid Twilio stream SID
 * @returns {boolean} True if sent successfully, false otherwise
 */
export function sendPreloadedGreeting(connection, streamSid) {
    if (!greetingAudioCache.buffer || !streamSid) {
        logger.warn('No preloaded greeting available or missing streamSid');
        return false;
    }

    logger.info(`Sending preloaded greeting for stream ${streamSid}`);

    try {
        // Send each audio buffer chunk to the client
        greetingAudioCache.buffer.forEach(chunk => {
            const audioDelta = {
                event: 'media',
                streamSid: streamSid,
                media: { payload: chunk }
            };
            connection.send(JSON.stringify(audioDelta));
        });

        // Send mark event
        connection.send(JSON.stringify({
            event: 'mark',
            streamSid: streamSid,
            mark: { name: 'preloadedGreeting' }
        }));

        return true;
    } catch (err) {
        logger.error('Error sending preloaded greeting:', err);
        return false;
    }
}