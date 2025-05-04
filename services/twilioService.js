// services/twilioService.js - Fixed Twilio media stream handling with better reminder response
import { logger } from '../utils/logger.js';
import {
    getOpenAiConnection,
    initializeSession,
    sendInitialConversation,
    truncateAssistantResponse,
    sendAudioBuffer,
    sendTimeUpdate,
    closeConnection,
    sendPreloadedGreeting,
    handleReminderResponse,
    sendRemindersAsContext,
    sendRemindersResponseMessage
} from './openaiService.js';
import { getAllReminders } from './reminderService.js';
import { clearUserConfirmations } from '../utils/confirmationHandler.js';

/**
 * Check if transcript contains a reminder list request
 * @param {string} transcript User's spoken text
 * @returns {boolean} True if this is a list reminders request
 */
function isListRemindersRequest(transcript) {
    if (!transcript) return false;

    const lowerTranscript = transcript.toLowerCase().trim();

    // Common phrases for requesting reminders list
    const listPhrases = [
        'list', 'show', 'tell me', 'what are', 'any', 'do i have'
    ];

    // Check if any of the list phrases are in the transcript
    const hasListPhrase = listPhrases.some(phrase =>
        lowerTranscript.includes(phrase)
    );

    // Check if the word "reminder" or "reminders" is in the transcript
    const hasReminderWord = lowerTranscript.includes('reminder');

    // Return true if both conditions are met
    return hasListPhrase && hasReminderWord;
}

/**
 * Handle user's transcript for reminder commands
 * @param {WebSocket} openAiWs OpenAI WebSocket connection
 * @param {string} transcript User's spoken text
 * @param {string} phoneNumber User's phone number
 * @param {Object} state Connection state
 */
function handleUserTranscript(openAiWs, transcript, phoneNumber, state) {
    // Check if user is asking for reminders list
    if (isListRemindersRequest(transcript)) {
        logger.info('Detected list reminders request from transcript');

        // Get the user's reminders
        const userReminders = getAllReminders(phoneNumber);

        // Directly send reminders as a forced response
        // This bypasses the normal flow and ensures the assistant reads out the reminders
        sendRemindersResponseMessage(openAiWs, userReminders, phoneNumber);

        // Mark that we're processing a list command to avoid double-processing
        state.processingListCommand = true;
        return true;
    }

    return false;
}

/**
 * Create a Twilio Media Stream handler
 * @param {WebSocket} connection Twilio WebSocket connection
 * @param {Object} req Request object
 */
export function setupMediaStreamHandler(connection, req) {
    logger.info('Client connected');

    // Connection-specific state
    const state = {
        streamSid: null,
        latestMediaTimestamp: 0,
        lastAssistantItem: null,
        markQueue: [],
        responseStartTimestampTwilio: null,
        sessionInitialized: false,
        currentUserTranscript: '',
        lastTranscriptId: null,
        callerPhoneNumber: null,
        currentAssistantResponse: '',
        timeUpdateInterval: null,
        pendingConfirmation: null,
        contextSent: false,
        lastUserActivity: Date.now(),
        processingListCommand: false
    };

    // Extract caller phone number from Twilio if available
    if (req.query && req.query.From) {
        state.callerPhoneNumber = req.query.From;
        logger.info(`Caller phone number: ${state.callerPhoneNumber}`);
    }

    // Create a new OpenAI connection 
    const openAiWs = getOpenAiConnection();

    // Setup time updates with a longer interval and activity check
    state.timeUpdateInterval = setInterval(() => {
        if (state.sessionInitialized) {
            // Only send time updates if there has been recent activity
            // This prevents sending updates to inactive sessions
            const now = Date.now();
            const idleTime = now - state.lastUserActivity;

            // If user has been idle for less than 5 minutes, send the update
            if (idleTime < 5 * 60 * 1000) {
                sendTimeUpdate(openAiWs);
            } else {
                logger.debug(`Skipping time update due to inactivity (${Math.round(idleTime / 1000)}s)`);
            }
        }
    }, 5 * 60 * 1000); // Every 5 minutes instead of every minute

    /**
     * Handle interruption when the caller's speech starts
     */
    const handleSpeechStartedEvent = () => {
        // Update activity timestamp
        state.lastUserActivity = Date.now();

        if (state.markQueue.length > 0 && state.responseStartTimestampTwilio != null) {
            const elapsedTime = state.latestMediaTimestamp - state.responseStartTimestampTwilio;

            if (state.lastAssistantItem) {
                truncateAssistantResponse(openAiWs, state.lastAssistantItem, elapsedTime);
            }

            connection.send(JSON.stringify({
                event: 'clear',
                streamSid: state.streamSid
            }));

            // Reset
            state.markQueue = [];
            state.lastAssistantItem = null;
            state.responseStartTimestampTwilio = null;
            state.currentAssistantResponse = '';
        }
    };

    /**
     * Send mark messages to Media Streams
     */
    const sendMark = () => {
        if (state.streamSid) {
            const markEvent = {
                event: 'mark',
                streamSid: state.streamSid,
                mark: { name: 'responsePart' }
            };
            connection.send(JSON.stringify(markEvent));
            state.markQueue.push('responsePart');
        }
    };

    /**
     * Send user's existing reminders as context to the assistant
     */
    const sendUserRemindersAsContext = () => {
        if (state.callerPhoneNumber && state.sessionInitialized && !state.contextSent) {
            // Get existing reminders for this user
            const userReminders = getAllReminders(state.callerPhoneNumber);

            if (userReminders.length > 0) {
                // Send reminders to OpenAI as context
                sendRemindersAsContext(openAiWs, userReminders);
                state.contextSent = true;
                logger.info(`Sent ${userReminders.length} existing reminders as context`);
            } else {
                logger.info('No existing reminders to send as context');
            }
        }
    };

    // Setup OpenAI WebSocket event handlers
    openAiWs.on('message', (data) => {
        try {
            const response = JSON.parse(data);

            // Handle the assistant's response transcript
            if (response.type === 'response.audio_transcript.done') {
                logger.assistantMessage(response.transcript);
                state.currentAssistantResponse = response.transcript;
                state.lastUserActivity = Date.now(); // Update activity timestamp

                // Only process for reminders if we're not already in a list command
                if (!state.processingListCommand) {
                    // Process the complete response for reminder extraction
                    const reminderResult = handleReminderResponse(
                        openAiWs,
                        response.transcript,
                        state.callerPhoneNumber
                    );

                    if (reminderResult) {
                        logger.info('Processed reminder:', reminderResult);

                        // Special handling for list command
                        if (reminderResult.action === 'listed') {
                            state.processingListCommand = true;
                            // Note: The response is already sent in handleReminderResponse
                        }
                        // Handle confirmation if needed
                        else if (reminderResult.confirmationRequested) {
                            state.pendingConfirmation = {
                                type: reminderResult.confirmationType,
                                data: reminderResult.reminder
                            };
                        } else {
                            // If we processed a reminder successfully, refresh the context
                            // with updated reminders next time
                            state.contextSent = false;
                        }
                    }
                } else {
                    // Reset the list command flag after processing is complete
                    state.processingListCommand = false;
                }
            }

            // Handle OpenAI's transcription events
            if (response.type === 'conversation.item.input_audio_transcription.delta') {
                // For incremental transcript updates
                if (response.delta) {
                    state.currentUserTranscript += response.delta;
                }
            }

            // Handle completed transcription events
            if (response.type === 'conversation.item.input_audio_transcription.completed') {
                if (response.transcript) {
                    logger.userMessage(response.transcript);
                    state.lastUserActivity = Date.now(); // Update activity timestamp

                    // Direct handling of list commands from user transcript
                    const handledAsListCommand = handleUserTranscript(
                        openAiWs,
                        response.transcript,
                        state.callerPhoneNumber,
                        state
                    );

                    // Only continue with normal processing if not handled as a list command
                    if (!handledAsListCommand) {
                        // Regular context updates
                        state.currentUserTranscript = '';

                        // After user speaks, we may need to send updated reminders context
                        if (!state.contextSent) {
                            sendUserRemindersAsContext();
                        }
                    }
                }
            }

            // Handle specific event types for the Twilio audio pipeline
            if (response.type === 'response.audio.delta' && response.delta) {
                const audioDelta = {
                    event: 'media',
                    streamSid: state.streamSid,
                    media: { payload: response.delta }
                };
                connection.send(JSON.stringify(audioDelta));

                // First delta from a new response starts the elapsed time counter
                if (!state.responseStartTimestampTwilio) {
                    state.responseStartTimestampTwilio = state.latestMediaTimestamp;
                }

                if (response.item_id) {
                    state.lastAssistantItem = response.item_id;
                }

                sendMark();
            }

            if (response.type === 'input_audio_buffer.speech_started') {
                handleSpeechStartedEvent();
            }

            // Speech stopped - good time to update context if needed
            if (response.type === 'input_audio_buffer.speech_stopped') {
                if (!state.contextSent) {
                    sendUserRemindersAsContext();
                }

                // Reset processing flag if needed
                if (!state.processingListCommand) {
                    state.processingListCommand = false;
                }
            }
        } catch (error) {
            logger.error('Error processing OpenAI message:', error);
        }
    });

    // Handle incoming messages from Twilio
    connection.on('message', (message) => {
        try {
            const data = JSON.parse(message);

            switch (data.event) {
                case 'media':
                    state.latestMediaTimestamp = data.media.timestamp;
                    state.lastUserActivity = Date.now(); // Update activity timestamp
                    sendAudioBuffer(openAiWs, data.media.payload);
                    break;

                case 'start':
                    state.streamSid = data.start.streamSid;
                    logger.info('Incoming stream has started', state.streamSid);
                    state.lastUserActivity = Date.now(); // Update activity timestamp

                    // Send preloaded greeting immediately
                    const greetingSent = sendPreloadedGreeting(connection, state.streamSid);
                    logger.info(greetingSent ? 'Sent preloaded greeting' : 'No preloaded greeting available');

                    // Initialize the session regardless of whether greeting was sent
                    if (!state.sessionInitialized) {
                        initializeSession(openAiWs)
                            .then(() => {
                                state.sessionInitialized = true;

                                // Only send the initial conversation if we didn't use preloaded greeting
                                if (!greetingSent) {
                                    sendInitialConversation(openAiWs);
                                } else {
                                    // If we sent the greeting, we should still initialize the conversation state
                                    // but we don't need to send another greeting
                                    logger.info('Using preloaded greeting, skipping initial conversation');
                                }

                                // After session is initialized, send existing reminders as context
                                sendUserRemindersAsContext();
                            })
                            .catch(err => logger.error('Failed to initialize session:', err));
                    }

                    // Reset variables on a new stream
                    state.responseStartTimestampTwilio = null;
                    state.latestMediaTimestamp = 0;
                    state.currentUserTranscript = '';
                    state.lastTranscriptId = null;
                    state.currentAssistantResponse = '';
                    state.pendingConfirmation = null;
                    state.contextSent = false;
                    state.processingListCommand = false;
                    break;

                case 'mark':
                    if (state.markQueue.length > 0) {
                        state.markQueue.shift();
                    }
                    break;

                case 'stop':
                    // Clean up when the stream ends
                    logger.info('Media stream stopped');
                    state.lastUserActivity = Date.now(); // Update activity timestamp

                    // Clear any pending confirmations for this user
                    if (state.callerPhoneNumber) {
                        clearUserConfirmations(state.callerPhoneNumber);
                    }
                    break;

                default:
                    logger.debug('Received non-media event:', data.event);
                    break;
            }
        } catch (error) {
            logger.error('Error parsing message:', error);
        }
    });

    // Handle connection close
    connection.on('close', () => {
        clearInterval(state.timeUpdateInterval);
        closeConnection(openAiWs); // Close the connection instead of returning it to pool

        // Clear any pending confirmations for this user
        if (state.callerPhoneNumber) {
            clearUserConfirmations(state.callerPhoneNumber);
        }

        logger.info('Client disconnected.');
    });

    // Handle WebSocket errors
    openAiWs.on('error', (error) => {
        logger.error('Error in the OpenAI WebSocket:', error);
    });
}