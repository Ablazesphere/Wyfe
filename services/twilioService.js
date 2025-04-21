// services/twilioService.js - Enhanced with contextual understanding and bug fix
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
import {
    processAssistantResponseForReminders,
    extractReminderFromText,
    processDisambiguationResponse
} from './reminderService.js';
import {
    getPendingConfirmation,
    processConfirmationResponse,
    addDisambiguationOptions,
    confirmAction,
    cancelConfirmation
} from '../utils/confirmationHandler.js';
import { getAllReminders, getReminderStats } from '../models/reminderModel.js';
import { formatFriendlyTime, formatFriendlyDate } from '../utils/dateUtils.js';

// User conversation context tracking
const userContexts = new Map();

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
        awaitingConfirmation: false,
        awaitingDisambiguation: false,
        lastTimeUpdate: Date.now(),
        conversationHistory: [], // Track conversation for context
        lastReminderAction: null, // Track last reminder action for follow-ups
        lastMentionedReminders: null // Store reminders mentioned for follow-ups
    };

    // Extract caller phone number from Twilio if available
    if (req.query && req.query.From) {
        state.callerPhoneNumber = req.query.From;
        logger.info(`Caller phone number: ${state.callerPhoneNumber}`);

        // Initialize or retrieve user context
        if (!userContexts.has(state.callerPhoneNumber)) {
            userContexts.set(state.callerPhoneNumber, {
                lastInteraction: new Date(),
                reminderStats: null,
                conversationTopics: []
            });
        }

        // Update last interaction time
        const userContext = userContexts.get(state.callerPhoneNumber);
        userContext.lastInteraction = new Date();

        // Get user's reminder statistics for personalized experience
        try {
            userContext.reminderStats = getReminderStats(state.callerPhoneNumber);
        } catch (error) {
            logger.error('Error getting user reminder stats:', error);
        }
    }

    // Get OpenAI connection
    const openAiWs = getOpenAiConnection();

    // Setup time updates - now passing the state object to sendTimeUpdate
    // and using a longer interval (5 minutes instead of 1 minute)
    state.timeUpdateInterval = setInterval(() => {
        if (state.sessionInitialized) {
            // Only update if enough time has passed (at least 5 minutes)
            const now = Date.now();
            if (now - state.lastTimeUpdate >= 5 * 60 * 1000) {
                // Only update the lastTimeUpdate if sendTimeUpdate actually sent an update
                if (sendTimeUpdate(openAiWs, state)) {
                    state.lastTimeUpdate = now;
                }
            }
        }
    }, 60 * 1000); // Check every 1 minute

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
     * Process user's transcribed input for confirmations, disambiguations, and reminders
     * Enhanced with better context tracking
     * @param {string} transcript User's transcribed input
     */
    const processUserInput = (transcript) => {
        // Store in conversation history
        state.conversationHistory.push({
            role: 'user',
            content: transcript,
            timestamp: new Date()
        });

        // Check if we're awaiting disambiguation
        if (state.awaitingDisambiguation && state.lastMentionedReminders) {
            const selectedReminder = processDisambiguationResponse(transcript, state.lastMentionedReminders);

            if (selectedReminder) {
                // User selected a specific reminder from options
                logger.info(`User selected reminder: ${selectedReminder.task}`);

                // Proceed with the pending action on the selected reminder
                if (state.lastReminderAction) {
                    let messageToAssistant;

                    switch (state.lastReminderAction) {
                        case 'cancel':
                            messageToAssistant = `I'll cancel your reminder "${selectedReminder.task}" scheduled for ${formatFriendlyTime(selectedReminder.triggerTime)} on ${formatFriendlyDate(selectedReminder.triggerTime)}. Is that correct?`;
                            break;
                        case 'reschedule':
                            messageToAssistant = `I'll reschedule your reminder "${selectedReminder.task}". What time would you like to reschedule it to?`;
                            break;
                        default:
                            messageToAssistant = `You selected the reminder "${selectedReminder.task}". What would you like to do with it?`;
                    }

                    // Send message to assistant
                    sendSystemMessage(openAiWs, messageToAssistant);

                    // Reset disambiguation but set the context for follow-up
                    state.awaitingDisambiguation = false;
                    state.lastMentionedReminders = [selectedReminder];
                    return;
                }
            } else {
                // Couldn't determine which reminder was selected
                sendSystemMessage(openAiWs, "I'm not sure which reminder you're referring to. Could you be more specific or choose one of the options I provided?");
                return;
            }
        }

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
                            state.callerPhoneNumber,
                            openAiWs  // Pass the OpenAI WebSocket for time communication
                        );

                        // Provide feedback to the user via system message
                        if (result && result.success) {
                            let confirmationMessage;

                            switch (confirmationResult.action) {
                                case 'cancel':
                                    confirmationMessage = `I've cancelled your reminder to ${confirmationResult.data.task}.`;
                                    break;
                                case 'reschedule':
                                    // Include time adjustment information if relevant
                                    if (result.timeHasPassed) {
                                        confirmationMessage = `I've rescheduled your reminder to ${confirmationResult.data.task} for ${confirmationResult.data.time} tomorrow.`;
                                    } else {
                                        confirmationMessage = `I've rescheduled your reminder to ${confirmationResult.data.task} for ${confirmationResult.data.time} today.`;
                                    }
                                    break;
                                default:
                                    confirmationMessage = "I've processed your request successfully.";
                            }

                            // Send the confirmation as a system message to OpenAI
                            sendSystemMessage(openAiWs, confirmationMessage);

                            // Update conversation context
                            state.lastReminderAction = confirmationResult.action;
                        } else {
                            sendSystemMessage(openAiWs, "I wasn't able to process that action. Could you try asking me again?");
                        }

                        state.awaitingConfirmation = false;
                    } else if (confirmationResult.action === 'rejected') {
                        // User rejected the action
                        sendSystemMessage(openAiWs, "No problem, I won't make that change.");
                        state.awaitingConfirmation = false;
                    } else if (confirmationResult.needsExplicitConfirmation) {
                        // User selected an option, now we need explicit confirmation
                        let confirmationMessage;

                        switch (confirmationResult.action) {
                            case 'cancel':
                                confirmationMessage = `You want to cancel the reminder "${confirmationResult.selectedOption.task}" scheduled for ${confirmationResult.selectedOption.friendlyTime}. Is that correct?`;
                                break;
                            case 'reschedule':
                                confirmationMessage = `You want to reschedule the reminder "${confirmationResult.selectedOption.task}". Is that correct?`;
                                break;
                            default:
                                confirmationMessage = `You selected "${confirmationResult.selectedOption.task}". Is that correct?`;
                        }

                        sendSystemMessage(openAiWs, confirmationMessage);
                        state.awaitingConfirmation = true;
                    } else if (confirmationResult.needsMoreClarification) {
                        // Need more clarification
                        let clarificationMessage = "I'm not sure if you want to proceed. ";

                        // More specific guidance based on attempts
                        if (confirmationResult.attempts > 1) {
                            clarificationMessage += "Please clearly say 'yes' or 'no'.";
                        } else {
                            clarificationMessage += "Please say yes or no.";
                        }

                        sendSystemMessage(openAiWs, clarificationMessage);
                        state.awaitingConfirmation = true;
                    }
                }
            } else {
                state.awaitingConfirmation = false;

                // Check for context-aware follow-up requests
                processFollowUpRequest(transcript);
            }
        }
    };

    /**
     * Process potential follow-up requests based on conversation context
     * @param {string} transcript User's transcribed input
     */
    const processFollowUpRequest = (transcript) => {
        // Don't process if we're in the middle of a confirmation or disambiguation
        if (state.awaitingConfirmation || state.awaitingDisambiguation) {
            return;
        }

        const lowerTranscript = transcript.toLowerCase();

        // Check for contextual follow-ups like "cancel that" or "reschedule it"
        const followUpTriggers = {
            cancel: ['cancel it', 'cancel that', 'delete it', 'delete that', 'remove it', 'remove that'],
            reschedule: ['reschedule it', 'reschedule that', 'change it', 'change that', 'move it', 'move that'],
            remind: ['remind me again', 'what was that reminder', 'repeat that reminder']
        };

        // Check for cancel follow-up
        if (followUpTriggers.cancel.some(trigger => lowerTranscript.includes(trigger)) && state.lastMentionedReminders) {
            if (state.lastMentionedReminders.length === 1) {
                // We have a single reminder from context
                const reminder = state.lastMentionedReminders[0];

                // Send confirmation request
                sendSystemMessage(openAiWs, `Do you want to cancel your reminder "${reminder.task}" scheduled for ${formatFriendlyTime(reminder.triggerTime)}?`);

                // Set up confirmation
                if (state.callerPhoneNumber) {
                    const confirmData = {
                        task: reminder.task,
                        reminderId: reminder.id
                    };

                    import('../utils/confirmationHandler.js').then(({ createConfirmation }) => {
                        createConfirmation(state.callerPhoneNumber, 'cancel', confirmData);
                        state.awaitingConfirmation = true;
                        state.lastReminderAction = 'cancel';
                    });
                }
            } else if (state.lastMentionedReminders.length > 1) {
                // Multiple reminders, we need disambiguation
                const reminderOptions = state.lastMentionedReminders.map((r, i) =>
                    `${i + 1}. "${r.task}" at ${formatFriendlyTime(r.triggerTime)}`
                ).join('\n');

                sendSystemMessage(openAiWs, `Which reminder would you like to cancel?\n${reminderOptions}\n\nPlease specify by number or description.`);
                state.awaitingDisambiguation = true;
                state.lastReminderAction = 'cancel';
            }
            return;
        }

        // Check for reschedule follow-up
        if (followUpTriggers.reschedule.some(trigger => lowerTranscript.includes(trigger)) && state.lastMentionedReminders) {
            if (state.lastMentionedReminders.length === 1) {
                // We have a single reminder from context
                const reminder = state.lastMentionedReminders[0];

                // Send reschedule request
                sendSystemMessage(openAiWs, `When would you like to reschedule your reminder "${reminder.task}" to?`);

                // Set up for the next part of the conversation
                state.lastReminderAction = 'reschedule';
            } else if (state.lastMentionedReminders.length > 1) {
                // Multiple reminders, we need disambiguation
                const reminderOptions = state.lastMentionedReminders.map((r, i) =>
                    `${i + 1}. "${r.task}" at ${formatFriendlyTime(r.triggerTime)}`
                ).join('\n');

                sendSystemMessage(openAiWs, `Which reminder would you like to reschedule?\n${reminderOptions}\n\nPlease specify by number or description.`);
                state.awaitingDisambiguation = true;
                state.lastReminderAction = 'reschedule';
            }
            return;
        }

        // Check for reminder info follow-up
        if (followUpTriggers.remind.some(trigger => lowerTranscript.includes(trigger)) && state.lastMentionedReminders) {
            if (state.lastMentionedReminders.length === 1) {
                // We have a single reminder from context
                const reminder = state.lastMentionedReminders[0];

                // Send reminder details
                sendSystemMessage(openAiWs, `Your reminder "${reminder.task}" is scheduled for ${formatFriendlyTime(reminder.triggerTime)} on ${formatFriendlyDate(reminder.triggerTime)}.`);
            } else if (state.lastMentionedReminders.length > 1) {
                // Summarize multiple reminders
                const reminderSummary = state.lastMentionedReminders.map(r =>
                    `• "${r.task}" at ${formatFriendlyTime(r.triggerTime)} on ${formatFriendlyDate(r.triggerTime)}`
                ).join('\n');

                sendSystemMessage(openAiWs, `Here are your reminders:\n${reminderSummary}`);
            }
            return;
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

                // Store in conversation history
                state.conversationHistory.push({
                    role: 'assistant',
                    content: response.transcript,
                    timestamp: new Date()
                });

                // Extract reminder data from the transcript (if any)
                const reminderData = extractReminderFromText(response.transcript);

                // Critical fix: Only process reminder actions if we found valid reminder data
                // and we're not already in a confirmation or disambiguation flow
                if (reminderData && !state.awaitingConfirmation && !state.awaitingDisambiguation) {
                    logger.info(`Detected reminder request with action: ${reminderData.action}`, reminderData);

                    // SPECIAL HANDLING FOR LIST ACTION
                    if (reminderData.action === 'list') {
                        // Get all reminders for this user
                        const allReminders = getAllReminders(state.callerPhoneNumber);
                        const pendingReminders = allReminders.filter(r => r.status === 'pending');

                        // Format the reminder list for speaking
                        let reminderListMessage;
                        if (pendingReminders.length === 0) {
                            reminderListMessage = "You don't have any reminders at the moment.";
                            // Clear context since there are no reminders
                            state.lastMentionedReminders = null;
                        } else {
                            // Format reminders in a way that sounds natural when spoken
                            const formattedReminders = pendingReminders.map(r => {
                                const time = formatFriendlyTime(r.triggerTime);
                                const date = formatFriendlyDate(r.triggerTime);
                                return `${r.task} at ${time} on ${date}`;
                            });

                            // Join with proper speech pauses
                            if (formattedReminders.length === 1) {
                                reminderListMessage = `You have one reminder: ${formattedReminders[0]}.`;
                            } else {
                                const lastReminder = formattedReminders.pop();
                                reminderListMessage = `You have ${pendingReminders.length} reminders: ${formattedReminders.join(', ')} and ${lastReminder}.`;
                            }

                            // Update state context with actual reminder objects
                            state.lastMentionedReminders = pendingReminders;
                        }

                        // Send the formatted message to be read aloud after a short delay
                        // The delay ensures the initial "Let me check your reminders" is spoken first
                        setTimeout(() => {
                            logger.info(`Sending reminder list to be read: ${reminderListMessage}`);
                            sendSystemMessage(openAiWs, reminderListMessage);
                        }, 1500);

                        // *** CRITICAL FIX: Ensure we're not in disambiguation mode ***
                        state.awaitingDisambiguation = false;
                    } else {
                        // For non-list actions, use the standard processing function
                        processAssistantResponseForReminders(response.transcript, state.callerPhoneNumber, openAiWs);
                    }
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

                    // Process the user's input for confirmations and follow-ups
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

                                // If caller is a returning user with reminders, provide a personalized greeting
                                if (state.callerPhoneNumber) {
                                    const userContext = userContexts.get(state.callerPhoneNumber);

                                    if (userContext && userContext.reminderStats && userContext.reminderStats.counts.pending > 0) {
                                        // User has pending reminders, mention them
                                        const nextReminder = userContext.reminderStats.nextReminder;
                                        let personalizedGreeting;

                                        if (nextReminder) {
                                            personalizedGreeting = `Hello! Welcome back. You currently have ${userContext.reminderStats.counts.pending} pending reminders. Your next reminder is "${nextReminder.task}" at ${nextReminder.friendlyTime}.`;
                                        } else {
                                            personalizedGreeting = `Hello! Welcome back. You currently have ${userContext.reminderStats.counts.pending} pending reminders.`;
                                        }

                                        // Send personalized greeting as system message
                                        setTimeout(() => {
                                            sendSystemMessage(openAiWs, personalizedGreeting);
                                        }, 1000);

                                        // Update conversation context
                                        if (nextReminder) {
                                            state.lastMentionedReminders = [{
                                                id: nextReminder.id,
                                                task: nextReminder.task,
                                                triggerTime: new Date(nextReminder.triggerTime),
                                                friendlyTime: nextReminder.friendlyTime,
                                                friendlyDate: nextReminder.friendlyDate
                                            }];
                                        }
                                    } else {
                                        // Regular greeting for new user or user without reminders
                                        sendInitialConversation(openAiWs);
                                    }
                                } else {
                                    // Regular greeting for unknown user
                                    sendInitialConversation(openAiWs);
                                }

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
                    state.lastTimeUpdate = Date.now();
                    state.awaitingDisambiguation = false;
                    state.awaitingConfirmation = false;
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

        // If caller had a phone number, update their context with conversation summary
        if (state.callerPhoneNumber && userContexts.has(state.callerPhoneNumber)) {
            const userContext = userContexts.get(state.callerPhoneNumber);

            // Extract conversation topics from the history
            if (state.conversationHistory.length > 0) {
                // This would be more sophisticated in a full implementation,
                // but for now just track if they used reminders
                const reminderActions = state.conversationHistory.filter(item =>
                    item.content.toLowerCase().includes('remind') ||
                    item.content.toLowerCase().includes('schedule')
                ).length;

                if (reminderActions > 0) {
                    userContext.conversationTopics.push('reminders');
                }

                // Store last interaction time
                userContext.lastInteraction = new Date();
            }
        }
    });

    // Handle WebSocket errors
    openAiWs.on('error', (error) => {
        logger.error('Error in the OpenAI WebSocket:', error);
    });
}