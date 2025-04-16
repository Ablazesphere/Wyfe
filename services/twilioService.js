// Updated twilioService.js with confirmation flow integration
import { logger } from '../utils/logger.js';
import {
    getOpenAiConnection,
    initializeSession,
    sendInitialConversation,
    truncateAssistantResponse,
    sendAudioBuffer,
    sendTimeUpdate,
    returnConnectionToPool,
    sendSystemMessage
} from './openaiService.js';
import { processAssistantResponseForReminders } from './reminderService.js';
import {
    getPendingConfirmation,
    processConfirmationResponse
} from '../utils/confirmationHandler.js';

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
        awaitingConfirmation: false
    };

    // Extract caller phone number from Twilio if available
    if (req.query && req.query.From) {
        state.callerPhoneNumber = req.query.From;
        logger.info(`Caller phone number: ${state.callerPhoneNumber}`);
    }

    // Get OpenAI connection
    const openAiWs = getOpenAiConnection();

    // Setup time updates
    state.timeUpdateInterval = setInterval(() => {
        if (state.sessionInitialized) {
            sendTimeUpdate(openAiWs);
        }
    }, 60000); // Every minute

    /**
     * Handle interruption when the caller's speech starts
     */
    const handleSpeechStartedEvent = () => {
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
     * Process user's transcribed input for confirmations
     * @param {string} transcript User's transcribed input
     */
    const processUserInput = (transcript) => {
        // Check if we're awaiting confirmation
        if (state.callerPhoneNumber) {
            const pendingConfirmation = getPendingConfirmation(state.callerPhoneNumber);

            if (pendingConfirmation) {
                state.awaitingConfirmation = true;
                const confirmationResult = processConfirmationResponse(state.callerPhoneNumber, transcript);

                if (confirmationResult) {
                    if (confirmationResult.confirmed) {
                        // User confirmed the action, process it
                        const result = processAssistantResponseForReminders(
                            JSON.stringify({
                                action: confirmationResult.action,
                                task: confirmationResult.data.task,
                                time: confirmationResult.data.time,
                                date: confirmationResult.data.date
                            }),
                            state.callerPhoneNumber
                        );

                        // Provide feedback to the user via system message
                        if (result && result.success) {
                            let confirmationMessage;

                            switch (confirmationResult.action) {
                                case 'cancel':
                                    confirmationMessage = `I've cancelled your reminder to ${confirmationResult.data.task}.`;
                                    break;
                                case 'reschedule':
                                    confirmationMessage = `I've rescheduled your reminder to ${confirmationResult.data.task} for ${confirmationResult.data.time}.`;
                                    break;
                                default:
                                    confirmationMessage = "I've processed your request successfully.";
                            }

                            // Send the confirmation as a system message to OpenAI
                            sendSystemMessage(openAiWs, confirmationMessage);
                        } else {
                            sendSystemMessage(openAiWs, "I wasn't able to process that action. Could you try asking me again?");
                        }

                        state.awaitingConfirmation = false;
                    } else if (confirmationResult.action === 'rejected') {
                        // User rejected the action
                        sendSystemMessage(openAiWs, "No problem, I won't make that change.");
                        state.awaitingConfirmation = false;
                    } else if (confirmationResult.needsMoreClarification) {
                        // Need more clarification
                        sendSystemMessage(openAiWs, "I'm not sure if you want to proceed. Please say yes or no.");
                        state.awaitingConfirmation = true;
                    }
                }
            } else {
                state.awaitingConfirmation = false;
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

                // Process the complete response for reminder extraction
                if (!state.awaitingConfirmation) {
                    processAssistantResponseForReminders(response.transcript, state.callerPhoneNumber);
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

                    // Process the user's input for confirmations
                    processUserInput(response.transcript);

                    state.currentUserTranscript = '';
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
                    sendAudioBuffer(openAiWs, data.media.payload);
                    break;

                case 'start':
                    state.streamSid = data.start.streamSid;
                    logger.info('Incoming stream has started', state.streamSid);

                    // Initialize the session as soon as the stream starts
                    if (!state.sessionInitialized) {
                        initializeSession(openAiWs)
                            .then(() => {
                                state.sessionInitialized = true;
                                sendInitialConversation(openAiWs);

                                // Check if user has pending confirmations
                                if (state.callerPhoneNumber) {
                                    const pendingConfirmation = getPendingConfirmation(state.callerPhoneNumber);
                                    if (pendingConfirmation) {
                                        state.awaitingConfirmation = true;

                                        // Remind the user about the pending confirmation
                                        let reminderMessage;
                                        switch (pendingConfirmation.action) {
                                            case 'cancel':
                                                reminderMessage = `You were in the process of canceling your reminder to ${pendingConfirmation.data.task}. Would you like to continue with cancellation?`;
                                                break;
                                            case 'reschedule':
                                                reminderMessage = `You were in the process of rescheduling your reminder to ${pendingConfirmation.data.task}. Would you like to continue with rescheduling?`;
                                                break;
                                            default:
                                                reminderMessage = "You have a pending action to confirm. Would you like to proceed with it?";
                                        }

                                        // Send reminder as system message after a short delay
                                        setTimeout(() => {
                                            sendSystemMessage(openAiWs, reminderMessage);
                                        }, 3000);
                                    }
                                }
                            })
                            .catch(err => logger.error('Failed to initialize session:', err));
                    }

                    // Reset variables on a new stream
                    state.responseStartTimestampTwilio = null;
                    state.latestMediaTimestamp = 0;
                    state.currentUserTranscript = '';
                    state.lastTranscriptId = null;
                    state.currentAssistantResponse = '';
                    break;

                case 'mark':
                    if (state.markQueue.length > 0) {
                        state.markQueue.shift();
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
        returnConnectionToPool(openAiWs);
        logger.info('Client disconnected.');
    });

    // Handle WebSocket errors
    openAiWs.on('error', (error) => {
        logger.error('Error in the OpenAI WebSocket:', error);
    });
}