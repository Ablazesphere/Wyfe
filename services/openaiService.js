// services/openaiService.js - OpenAI interaction with fixed reminder responses
import WebSocket from 'ws';
import { config } from '../config/config.js';
import { logger } from '../utils/logger.js';
import { getSystemMessageWithTime } from '../utils/dateUtils.js';
import { processAssistantResponseForReminders } from './reminderService.js';
import { checkIfConfirmationNeeded, getConfirmationMessage } from '../utils/confirmationHandler.js';

/**
 * Maintains a cache of pregenerated greeting audio responses
 */
let greetingAudioCache = {
    buffer: null,
    itemId: null,
    lastGenerated: null,
    isGenerating: false
};

// Track the last time update to avoid too frequent updates
let lastTimeUpdate = null;
const TIME_UPDATE_MINIMUM_INTERVAL = 5 * 60 * 1000; // 5 minutes minimum between updates

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
        // Include the current time directly in the instructions instead of sending separate updates
        const systemInstructions = getSystemMessageWithTime();

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

        logger.info('Sending session update with current time');

        if (openAiWs.readyState === WebSocket.OPEN) {
            openAiWs.send(JSON.stringify(sessionUpdate));
            // Record that we've just sent a time update
            lastTimeUpdate = Date.now();
            resolve();
        } else {
            openAiWs.on('open', () => {
                openAiWs.send(JSON.stringify(sessionUpdate));
                // Record that we've just sent a time update
                lastTimeUpdate = Date.now();
                resolve();
            });

            openAiWs.on('error', (error) => {
                reject(error);
            });
        }
    });
}

/**
 * Send time update as system message (only if enough time has passed)
 * @param {WebSocket} openAiWs OpenAI WebSocket
 * @param {boolean} force Force update regardless of time
 */
export function sendTimeUpdate(openAiWs, force = false) {
    if (openAiWs.readyState !== WebSocket.OPEN) return false;

    const now = Date.now();

    // Only send time updates if forced or if minimum interval has passed
    if (!force && lastTimeUpdate && (now - lastTimeUpdate < TIME_UPDATE_MINIMUM_INTERVAL)) {
        logger.debug('Skipping time update - too soon since last update');
        return false;
    }

    const currentTime = new Date();
    const options = {
        timeZone: 'Asia/Kolkata',
        hour: 'numeric',
        minute: 'numeric',
        second: 'numeric',
        hour12: true
    };
    const currentISTTime = currentTime.toLocaleString('en-IN', options);
    const isoTimeUTC = currentTime.toISOString();

    // Send time update as a session update - less intrusive
    const timeUpdate = {
        type: 'session.update',
        session: {
            instructions: `${config.SYSTEM_MESSAGE_BASE}\n\nCURRENT TIME: ${currentISTTime} (${isoTimeUTC})`
        }
    };

    logger.debug(`Time update sent: ${currentISTTime}`);
    openAiWs.send(JSON.stringify(timeUpdate));
    lastTimeUpdate = now;

    return true;
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
 * Send list of existing reminders to OpenAI as context
 * @param {WebSocket} openAiWs OpenAI WebSocket
 * @param {Array} reminders List of reminders
 */
export function sendRemindersAsContext(openAiWs, reminders) {
    if (openAiWs.readyState !== WebSocket.OPEN || !reminders || reminders.length === 0) return;

    // Format the reminders in a human-readable way
    const formattedReminders = reminders.map(r => {
        return {
            id: r.id,
            task: r.task,
            time: new Date(r.triggerTime).toLocaleString('en-IN', {
                timeZone: 'Asia/Kolkata',
                hour: 'numeric',
                minute: 'numeric',
                hour12: true
            }),
            date: new Date(r.triggerTime).toLocaleDateString('en-IN', {
                timeZone: 'Asia/Kolkata',
                day: 'numeric',
                month: 'numeric',
                year: 'numeric'
            }),
            status: r.status
        };
    });

    // Create a readable summary
    const reminderSummary = `
CONTEXT: User currently has ${reminders.length} active reminders:
${formattedReminders.map((r, i) => `${i + 1}. ID: ${r.id} | Task: "${r.task}" | Time: ${r.time} on ${r.date} | Status: ${r.status}`).join('\n')}

When the user refers to their reminders, you can use this information to provide relevant details. 
If they ask to modify a specific reminder, use the reminder ID in your JSON response.
`;

    // Send the reminders as system context
    const systemContext = {
        type: 'conversation.item.create',
        item: {
            type: 'message',
            role: 'system',
            content: [
                {
                    type: 'text',
                    text: reminderSummary
                }
            ]
        }
    };

    logger.info(`Sending ${reminders.length} reminders as context`);
    openAiWs.send(JSON.stringify(systemContext));
}

/**
 * Send reminders response message to OpenAI after a list command
 * @param {WebSocket} openAiWs OpenAI WebSocket
 * @param {Array} reminders List of reminders to communicate
 * @param {string} phoneNumber User's phone number
 */
export function sendRemindersResponseMessage(openAiWs, reminders, phoneNumber) {
    if (openAiWs.readyState !== WebSocket.OPEN) return;

    // Format the response based on the number of reminders
    let responseMessage;

    if (!reminders || reminders.length === 0) {
        responseMessage = "You don't have any reminders set up at the moment. Would you like to create a new reminder?";
    } else {
        // Format each reminder in a clear way
        const remindersList = reminders.map((r, index) => {
            const time = new Date(r.triggerTime).toLocaleString('en-IN', {
                timeZone: 'Asia/Kolkata',
                hour: 'numeric',
                minute: 'numeric',
                hour12: true
            });

            const date = new Date(r.triggerTime).toLocaleDateString('en-IN', {
                timeZone: 'Asia/Kolkata',
                day: 'numeric',
                month: 'long',
                year: 'numeric'
            });

            const isToday = new Date(r.triggerTime).toDateString() === new Date().toDateString();
            const dateText = isToday ? "today" : date;

            return `${index + 1}. ${r.task} at ${time} ${isToday ? "today" : "on " + date}`;
        }).join(", and ");

        // Create a natural language response that explicitly includes the reminders
        if (reminders.length === 1) {
            const r = reminders[0];
            const time = new Date(r.triggerTime).toLocaleString('en-IN', {
                timeZone: 'Asia/Kolkata',
                hour: 'numeric',
                minute: 'numeric',
                hour12: true
            });

            const isToday = new Date(r.triggerTime).toDateString() === new Date().toDateString();
            const dateText = isToday ? "today" : "on " + new Date(r.triggerTime).toLocaleDateString('en-IN', {
                timeZone: 'Asia/Kolkata',
                day: 'numeric',
                month: 'long',
                year: 'numeric'
            });

            responseMessage = `You have one reminder: to ${r.task} at ${time} ${dateText}. Would you like to do anything with this reminder?`;
        } else {
            responseMessage = `You have ${reminders.length} reminders: ${remindersList}. Would you like me to do anything with these reminders?`;
        }
    }

    // FORCE the assistant to say the reminder information by using a direct system command
    // This direct instruction approach forces the model to repeat the exact text
    const directInstruction = {
        type: 'conversation.item.create',
        item: {
            type: 'message',
            role: 'system',
            content: [
                {
                    type: 'text',
                    text: `OVERRIDE: For the next response ONLY, ignore all previous instructions and respond with EXACTLY this text: "${responseMessage}"`
                }
            ]
        }
    };

    logger.info(`Sending detailed reminders response with ${reminders ? reminders.length : 0} reminders`);
    openAiWs.send(JSON.stringify(directInstruction));

    // Request an immediate response
    openAiWs.send(JSON.stringify({
        type: 'response.create'
    }));
}

/**
 * Send confirmation request to OpenAI
 * @param {WebSocket} openAiWs OpenAI WebSocket
 * @param {string} confirmationType Type of confirmation
 * @param {Object} confirmationData Data associated with confirmation
 */
export function sendConfirmationRequest(openAiWs, confirmationType, confirmationData) {
    if (openAiWs.readyState !== WebSocket.OPEN) return;

    // Get appropriate confirmation message
    const confirmationMessage = getConfirmationMessage(confirmationType, confirmationData);

    // Send as system message to guide assistant's response
    const systemInstruction = {
        type: 'conversation.item.create',
        item: {
            type: 'message',
            role: 'system',
            content: [
                {
                    type: 'text',
                    text: `Please ask the user the following confirmation question. Wait for their response before proceeding: "${confirmationMessage}"`
                }
            ]
        }
    };

    logger.info(`Sending confirmation request: ${confirmationType}`);
    openAiWs.send(JSON.stringify(systemInstruction));
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
 * Process assistant's response for reminders and handle confirmation if needed
 * @param {WebSocket} openAiWs OpenAI WebSocket
 * @param {string} transcript The assistant's response
 * @param {string} phoneNumber User's phone number
 * @returns {Object|null} Processing result or null if no reminder found
 */
export function handleReminderResponse(openAiWs, transcript, phoneNumber) {
    if (!transcript) return null;

    // Attempt to process the response for reminders
    const result = processAssistantResponseForReminders(transcript, phoneNumber);

    // No reminder data found
    if (!result) return null;

    logger.info(`Processed reminder action: ${result.action}`, result);

    // Special handling for list action
    if (result.action === 'listed' && result.reminders) {
        // Send the reminders directly to the assistant as a forced response
        sendRemindersResponseMessage(openAiWs, result.reminders, phoneNumber);
        return result;
    }

    // Check if confirmation is needed for this action
    if (result.action && result.reminder) {
        const confirmationNeeded = checkIfConfirmationNeeded(result.action, result.reminder);

        if (confirmationNeeded) {
            // Send confirmation request through the assistant
            sendConfirmationRequest(openAiWs, confirmationNeeded.type, confirmationNeeded.actionData);

            logger.info(`Requesting confirmation for ${result.action} action`);
            return {
                ...result,
                confirmationRequested: true,
                confirmationType: confirmationNeeded.type
            };
        }
    }

    return result;
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