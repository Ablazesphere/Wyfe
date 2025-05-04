// services/twilioService.js - Updated for reminder functionality

import { logger } from '../utils/logger.js';
import {
    getOpenAiConnection,
    initializeSession,
    sendInitialConversation,
    truncateAssistantResponse,
    sendAudioBuffer,
    closeConnection,
    parseReminderIntent,
    processReminderIntent
} from './openaiService.js';

/**
 * Create a Twilio Media Stream handler
 * @param {WebSocket} connection Twilio WebSocket connection
 * @param {Object} req Request object
 */
export function setupMediaStreamHandler(connection, req) {
    logger.info('Client connected');

    // Check if this is a reminder call
    const reminderContext = req.reminderContext || null;
    if (reminderContext) {
        logger.info('Handling reminder call', {
            reminderId: reminderContext.reminderId,
            content: reminderContext.reminderContent
        });
    }

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
        reminderContext: reminderContext,
        reminderIntentProcessed: false
    };

    // Extract caller phone number if available
    if (req.query && req.query.From) {
        state.callerPhoneNumber = req.query.From;
        logger.info(`Caller phone number: ${state.callerPhoneNumber}`);
    }

    // Create a new OpenAI connection 
    const openAiWs = getOpenAiConnection();

    // Handle interruption when the caller's speech starts
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

    // Send mark messages to Media Streams
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

    // Process reminder-specific actions based on user transcript
    const processReminderActions = async (transcript) => {
        if (!state.reminderContext || state.reminderIntentProcessed) {
            return;
        }

        // Parse intent from transcript
        const intent = parseReminderIntent(transcript, state.reminderContext);

        // If we detected a clear intent, process it
        if (intent.intent !== 'unknown') {
            const result = await processReminderIntent(intent);

            // Mark as processed to avoid duplicates
            state.reminderIntentProcessed = true;

            logger.info('Processed reminder intent', result);
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
            }

            // Handle OpenAI's transcription events
            if (response.type === 'conversation.item.input_audio_transcription.delta') {
                if (response.delta) {
                    state.currentUserTranscript += response.delta;
                }
            }

            // Handle completed transcription events
            if (response.type === 'conversation.item.input_audio_transcription.completed') {
                if (response.transcript) {
                    logger.userMessage(response.transcript);

                    // For reminder calls, process any actions based on transcript
                    if (state.reminderContext) {
                        processReminderActions(response.transcript);
                    }

                    state.currentUserTranscript = '';
                }
            }

            // Handle audio delta for Twilio
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

                    // Initialize the session
                    if (!state.sessionInitialized) {
                        initializeSession(openAiWs, { reminderContext: state.reminderContext })
                            .then(() => {
                                state.sessionInitialized = true;
                                sendInitialConversation(openAiWs, { reminderContext: state.reminderContext });
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

                case 'stop':
                    logger.info('Media stream stopped');
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
        closeConnection(openAiWs);
        logger.info('Client disconnected.');
    });

    // Handle WebSocket errors
    openAiWs.on('error', (error) => {
        logger.error('Error in the OpenAI WebSocket:', error);
    });
}