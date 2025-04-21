// services/reminderService.js - Enhanced time parsing and edge case handling
import { logger } from '../utils/logger.js';
import { parseTimeAndDate, parseNumericTime, formatFriendlyTime, parseNaturalLanguageTime } from '../utils/dateUtils.js';
import { createReminder, getReminder, updateReminderStatus, removeReminder, getAllReminders, findRemindersByTask } from '../models/reminderModel.js';
import { config } from '../config/config.js';
import { sendSystemMessage } from './openaiService.js';
import { createConfirmation } from '../utils/confirmationHandler.js';

/**
 * Extract reminder data from text transcript with a more flexible regex
 * @param {string} text The transcript text
 * @returns {Object|null} Extracted reminder data or null
 */
export function extractReminderFromText(text) {
    // More flexible regex pattern that can handle all reminder action types
    const reminderRegex = /{{REMINDER:\s*({.*?})}?/;
    const match = text.match(reminderRegex);

    if (match && match[1]) {
        try {
            // Clean up possible JSON issues (missing closing brackets)
            let jsonString = match[1];
            if (!jsonString.endsWith('}')) {
                jsonString += '}';
            }

            // Try to parse the JSON
            const reminderData = JSON.parse(jsonString);

            // Validate the action type
            if (!reminderData.action) {
                logger.warn('Reminder missing action field');
                // Default to create for backward compatibility
                reminderData.action = 'create';
            }

            // Validate fields based on action type
            switch (reminderData.action) {
                case 'create':
                    if (!reminderData.task) {
                        logger.warn('Create reminder missing task field');
                        return null;
                    }
                    if (!reminderData.time) {
                        logger.warn('Create reminder missing time field');
                        return null;
                    }
                    if (!reminderData.date) {
                        logger.warn('Create reminder missing date field');
                        return null;
                    }
                    break;

                case 'list':
                    // No additional fields required for list action
                    break;

                case 'cancel':
                    if (!reminderData.task) {
                        logger.warn('Cancel reminder missing task field');
                        return null;
                    }
                    break;

                case 'reschedule':
                    if (!reminderData.task) {
                        logger.warn('Reschedule reminder missing task field');
                        return null;
                    }
                    if (!reminderData.time) {
                        logger.warn('Reschedule reminder missing time field');
                        return null;
                    }
                    if (!reminderData.date) {
                        logger.warn('Reschedule reminder missing date field');
                        return null;
                    }
                    break;

                default:
                    logger.warn(`Unknown reminder action: ${reminderData.action}`);
                    return null;
            }

            return reminderData;
        } catch (error) {
            logger.error('Failed to parse reminder JSON:', error);

            // Additional fallback parsing for severe JSON issues
            try {
                // Extract action type with regex
                const actionMatch = text.match(/"action"\s*:\s*"([^"]+)"/);
                const action = actionMatch ? actionMatch[1] : 'create'; // Default to create

                // Extract other fields based on action type
                const taskMatch = text.match(/"task"\s*:\s*"([^"]+)"/);
                const timeMatch = text.match(/"time"\s*:\s*"([^"]+)"/);
                const dateMatch = text.match(/"date"\s*:\s*"([^"]+)"/);

                const result = { action };

                if (taskMatch) result.task = taskMatch[1];
                if (timeMatch) result.time = timeMatch[1];
                if (dateMatch) result.date = dateMatch[1];

                // Validate minimal required fields based on action
                if ((action === 'create' || action === 'reschedule') &&
                    (!result.task || !result.time || !result.date)) {
                    return null;
                }

                if (action === 'cancel' && !result.task) {
                    return null;
                }

                return result;
            } catch (fallbackError) {
                logger.error('Fallback parsing also failed:', fallbackError);
            }
        }
    }

    return null;
}

/**
 * Schedule a reminder using the provided information
 * @param {string} task Task description
 * @param {string|number} time Time string (HH:MM) or minutes from now
 * @param {string} date Date string (dd/mm/yyyy) or null if using minutes
 * @param {string} phoneNumber User's phone number
 * @param {WebSocket} openAiWs Optional WebSocket to send time info to assistant
 * @returns {Object} The created reminder and time status information
 */
export function scheduleReminder(task, time, date, phoneNumber, openAiWs = null) {
    let triggerTime;
    let timeHasPassed = false;
    let isRelativeTime = false;
    const now = new Date();

    logger.debug(`Scheduling reminder with input time: ${time}, date: ${date} (time type: ${typeof time})`);

    // First, check if it's a natural language time expression
    if (typeof time === 'string' && time.toLowerCase().includes('tomorrow')) {
        // Handle "tomorrow" specifically
        const parsedTime = parseNaturalLanguageTime(time);
        if (parsedTime && parsedTime.date) {
            triggerTime = parsedTime.date;
            isRelativeTime = true;
            // No need to check if time has passed, since it's tomorrow
        }
    } else if (typeof time === 'string' && (
        time.toLowerCase().includes('minute') ||
        time.toLowerCase().includes('hour') ||
        time.toLowerCase().includes('min') ||
        time.toLowerCase().includes('am') ||
        time.toLowerCase().includes('pm')
    )) {
        // Handle other natural language expressions
        const parsedTime = parseNaturalLanguageTime(time);
        if (parsedTime && parsedTime.date) {
            triggerTime = parsedTime.date;
            timeHasPassed = parsedTime.timeHasPassed;
            isRelativeTime = parsedTime.isRelative;
        }
    } else if (typeof time === 'string' && typeof date === 'string') {
        // Handle time in "HH:MM" format with date in "dd/mm/yyyy" format
        const parseResult = parseTimeAndDate(time, date);

        if (!parseResult.date) {
            // Fallback to default time if parsing failed
            triggerTime = new Date(now.getTime() + config.REMINDER_DEFAULT_MINUTES * 60000);
            logger.warn(`Falling back to ${config.REMINDER_DEFAULT_MINUTES} minutes from now: ${triggerTime.toISOString()}`);
            isRelativeTime = true;
        } else {
            triggerTime = parseResult.date;
            timeHasPassed = parseResult.timeHasPassed;
        }
    } else if (typeof time === 'number' || (!isNaN(parseInt(time)) && typeof time === 'string')) {
        // If time is a number or numeric string, treat it as minutes from now
        triggerTime = parseNumericTime(time);
        isRelativeTime = true;

        if (!triggerTime) {
            // Fallback to default time if parsing failed
            triggerTime = new Date(now.getTime() + config.REMINDER_DEFAULT_MINUTES * 60000);
            logger.warn(`Falling back to ${config.REMINDER_DEFAULT_MINUTES} minutes from now: ${triggerTime.toISOString()}`);
            isRelativeTime = true;
        }
    } else {
        // Default to 5 minutes from now for any other format
        logger.warn(`Couldn't parse time format: ${time}, ${date}, defaulting to ${config.REMINDER_DEFAULT_MINUTES} minutes`);
        triggerTime = new Date(now.getTime() + config.REMINDER_DEFAULT_MINUTES * 60000);
        isRelativeTime = true;
    }

    // Double-check the time is not in the past (shouldn't happen with updated parseTimeAndDate)
    if (triggerTime < now) {
        logger.warn(`After parsing, time ${triggerTime.toISOString()} is still in the past. Moving to tomorrow.`);
        // Add 24 hours
        triggerTime = new Date(triggerTime.getTime() + 24 * 60 * 60 * 1000);
        timeHasPassed = true;
    }

    // IMPORTANT: Communicate time status to the assistant if WebSocket is provided
    if (openAiWs && timeHasPassed) {
        const timeFormat = formatFriendlyTime(triggerTime);
        const messageToAssistant = `IMPORTANT: The requested time (${time}) has already passed for today. The reminder is being set for TOMORROW at ${timeFormat} instead. You MUST tell the user it's for TOMORROW, not today.`;

        sendSystemMessage(openAiWs, messageToAssistant);
        logger.info("Sent time adjustment message to assistant: " + messageToAssistant);
    }

    // Create the reminder
    const reminder = createReminder(task, triggerTime, phoneNumber);

    // Schedule the reminder execution
    const delay = triggerTime.getTime() - now.getTime();
    if (delay > 0) {
        setTimeout(() => executeReminder(reminder.id), delay);
        logger.info(`Scheduled reminder to execute in ${Math.round(delay / 60000)} minutes`);
    } else {
        logger.warn(`Reminder time ${triggerTime} is in the past, executing immediately`);
        executeReminder(reminder.id);
    }

    return {
        reminder: reminder,
        timeHasPassed: timeHasPassed,
        isRelativeTime: isRelativeTime
    };
}

/**
 * Execute a reminder (send notification)
 * @param {string} reminderId The reminder ID
 * @returns {boolean} Success or failure
 */
export function executeReminder(reminderId) {
    const reminder = getReminder(reminderId);
    if (!reminder) {
        logger.warn(`Reminder ${reminderId} not found`);
        return false;
    }

    logger.info(`EXECUTING REMINDER: ${reminder.task} for ${reminder.phoneNumber}`);

    // TODO: Implement the actual reminder notification
    // This could be:
    // 1. Sending an SMS via Twilio
    // 2. Initiating a call to the user
    // 3. Or any other notification method

    // Update status and remove from active reminders
    updateReminderStatus(reminderId, 'completed');
    removeReminder(reminderId);

    return true;
}

/**
 * Process assistant's response for reminders
 * @param {string} transcript The assistant's response text
 * @param {string} phoneNumber User's phone number
 * @param {WebSocket} openAiWs Optional WebSocket for time communication
 * @returns {Object|null} Result of the reminder operation or null
 */
export function processAssistantResponseForReminders(transcript, phoneNumber, openAiWs = null) {
    // Extract reminder data from the transcript
    const reminderData = extractReminderFromText(transcript);

    if (!reminderData) return null;

    logger.info(`Detected reminder request with action: ${reminderData.action}`, reminderData);

    // Handle different reminder actions
    let result;
    switch (reminderData.action) {
        case 'create':
            result = handleCreateReminder(reminderData, phoneNumber, openAiWs);
            break;

        case 'list':
            result = handleListReminders(phoneNumber);
            // If we have a list result, send it back to be read by the assistant
            if (result && result.success && openAiWs) {
                // Only send after a short delay to ensure the initial response is finished
                setTimeout(() => {
                    logger.info(`Sending reminder list to be read: ${result.displayMessage}`);
                    sendSystemMessage(openAiWs, result.displayMessage);
                }, 1500);
            }
            break;

        case 'cancel':
            result = handleCancelReminder(reminderData, phoneNumber, openAiWs);
            break;

        case 'reschedule':
            result = handleRescheduleReminder(reminderData, phoneNumber, openAiWs);
            break;

        default:
            logger.warn(`Unknown reminder action: ${reminderData.action}`);
            return null;
    }

    return result;
}

/**
 * Handle the creation of a new reminder
 * @param {Object} reminderData The extracted reminder data
 * @param {string} phoneNumber User's phone number
 * @param {WebSocket} openAiWs Optional WebSocket for time communication
 * @returns {Object} The created reminder
 */
function handleCreateReminder(reminderData, phoneNumber, openAiWs = null) {
    if (!reminderData.task || !reminderData.time) {
        logger.warn('Missing required fields for creating reminder');
        return null;
    }

    // Schedule the reminder, passing the WebSocket for time communication
    const result = scheduleReminder(
        reminderData.task,
        reminderData.time,
        reminderData.date,
        phoneNumber || 'unknown',
        openAiWs
    );

    const reminder = result.reminder;
    const timeHasPassed = result.timeHasPassed;
    const isRelativeTime = result.isRelativeTime;

    logger.info('Reminder created:', reminder);
    return {
        action: 'create',
        success: true,
        reminder,
        timeHasPassed,
        isRelativeTime
    };
}

/**
 * Handle listing reminders for a user
 * @param {string} phoneNumber User's phone number
 * @returns {Object} Result with list of reminders
 */
function handleListReminders(phoneNumber) {
    // Get all reminders regardless of phone number for testing purposes
    // In production, you'd want to filter by phoneNumber
    const reminders = getAllReminders();
    logger.info(`Retrieved ${reminders.length} reminders in total`);

    // Group reminders by status and filter to only pending ones
    const pendingReminders = reminders.filter(r => r.status === 'pending');

    // Sort reminders by trigger time (earliest first)
    pendingReminders.sort((a, b) => a.triggerTime - b.triggerTime);

    // Format each reminder with friendly time/date
    const formattedReminders = pendingReminders.map(r => ({
        id: r.id,
        task: r.task,
        triggerTime: r.triggerTime.toISOString(),
        friendlyTime: formatFriendlyTime(r.triggerTime),
        friendlyDate: formatFriendlyDate(r.triggerTime),
        phoneNumber: r.phoneNumber
    }));

    // Generate a display message
    let displayMessage;
    if (pendingReminders.length === 0) {
        displayMessage = "You don't have any pending reminders.";
    } else {
        const reminderStrings = formattedReminders.map(r =>
            `${r.task} at ${r.friendlyTime} on ${r.friendlyDate}`
        ).join(', and ');

        displayMessage = `Here are your pending reminders: ${reminderStrings}.`;
    }

    return {
        action: 'list',
        success: true,
        reminders: formattedReminders,
        count: pendingReminders.length,
        displayMessage: displayMessage,  // This will be read aloud
        requiresDisambiguation: false    // Add this flag to explicitly indicate no disambiguation needed
    };
}

/**
 * Handle canceling a reminder with improved disambiguation
 * @param {Object} reminderData The extracted reminder data
 * @param {string} phoneNumber User's phone number
 * @param {WebSocket} openAiWs Optional WebSocket for system messages
 * @returns {Object} Result of the cancellation
 */
function handleCancelReminder(reminderData, phoneNumber, openAiWs = null) {
    if (!reminderData.task) {
        logger.warn('Missing task for canceling reminder');
        return null;
    }

    // Find reminders matching the task description for this user
    const matchingReminders = findRemindersByTask(reminderData.task, phoneNumber);

    if (matchingReminders.length === 0) {
        logger.info(`No matching reminders found for "${reminderData.task}" and phone ${phoneNumber}`);

        if (openAiWs) {
            sendSystemMessage(openAiWs, `I couldn't find any reminders that match "${reminderData.task}". Please check if the reminder exists or try with a different description.`);
        }

        return {
            action: 'cancel',
            success: false,
            reason: 'no_match',
            originalTask: reminderData.task
        };
    }

    if (matchingReminders.length > 1) {
        logger.info(`Multiple (${matchingReminders.length}) matching reminders found for "${reminderData.task}".`);

        // Create a confirmation flow for disambiguation
        if (openAiWs) {
            const reminderOptions = matchingReminders.map((r, i) =>
                `${i + 1}. "${r.task}" at ${formatFriendlyTime(r.triggerTime)}`
            ).join('\n');

            sendSystemMessage(openAiWs, `I found multiple reminders that match "${reminderData.task}":\n${reminderOptions}\n\nPlease specify which one you'd like to cancel by mentioning the specific reminder or its number.`);

            // Store the matching reminders for later use
            // We're not creating a confirmation yet, just informing the user
            return {
                action: 'disambiguation',
                success: false,
                matchingReminders: matchingReminders.map(r => r.toJSON()),
                count: matchingReminders.length,
                reason: 'multiple_matches'
            };
        }
    }

    // If we have exactly one match or we're proceeding without disambiguation
    const reminderToCancel = matchingReminders[0];

    // For a single match, create a confirmation request
    if (openAiWs && phoneNumber) {
        createConfirmation(phoneNumber, 'cancel', {
            task: reminderToCancel.task,
            reminderId: reminderToCancel.id,
            time: formatFriendlyTime(reminderToCancel.triggerTime)
        });

        sendSystemMessage(openAiWs, `Just to confirm, you want to cancel your reminder "${reminderToCancel.task}" scheduled for ${formatFriendlyTime(reminderToCancel.triggerTime)}. Is that correct?`);

        return {
            action: 'cancel',
            success: false,
            reminder: reminderToCancel.toJSON(),
            pendingConfirmation: true
        };
    }

    // If we don't have a way to confirm, proceed with cancellation
    updateReminderStatus(reminderToCancel.id, 'cancelled');
    const removed = removeReminder(reminderToCancel.id);

    logger.info(`Reminder cancelled: ${reminderToCancel.id}, removed: ${removed}`);
    return {
        action: 'cancel',
        success: removed,
        reminder: reminderToCancel.toJSON()
    };
}

/**
 * Handle rescheduling a reminder with improved disambiguation
 * @param {Object} reminderData The extracted reminder data
 * @param {string} phoneNumber User's phone number
 * @param {WebSocket} openAiWs Optional WebSocket for time communication
 * @returns {Object} Result of the rescheduling
 */
function handleRescheduleReminder(reminderData, phoneNumber, openAiWs = null) {
    if (!reminderData.task || !reminderData.time || !reminderData.date) {
        logger.warn('Missing required fields for rescheduling reminder');
        return null;
    }

    // Find reminders matching the task description for this user
    const matchingReminders = findRemindersByTask(reminderData.task, phoneNumber);

    if (matchingReminders.length === 0) {
        logger.info(`No matching reminders found for "${reminderData.task}" and phone ${phoneNumber}`);

        if (openAiWs) {
            sendSystemMessage(openAiWs, `I couldn't find any reminders that match "${reminderData.task}". Would you like me to create a new reminder instead?`);
        }

        // Instead of failing, create a new reminder
        logger.info(`Creating new reminder instead of rescheduling`);
        return handleCreateReminder(reminderData, phoneNumber, openAiWs);
    }

    if (matchingReminders.length > 1) {
        logger.info(`Multiple (${matchingReminders.length}) matching reminders found for "${reminderData.task}".`);

        // Create a confirmation flow for disambiguation
        if (openAiWs) {
            const reminderOptions = matchingReminders.map((r, i) =>
                `${i + 1}. "${r.task}" at ${formatFriendlyTime(r.triggerTime)}`
            ).join('\n');

            sendSystemMessage(openAiWs, `I found multiple reminders that match "${reminderData.task}":\n${reminderOptions}\n\nPlease specify which one you'd like to reschedule by mentioning the specific reminder or its number.`);

            return {
                action: 'disambiguation',
                success: false,
                matchingReminders: matchingReminders.map(r => r.toJSON()),
                count: matchingReminders.length,
                reason: 'multiple_matches'
            };
        }
    }

    // Get the first matching reminder
    const reminderToReschedule = matchingReminders[0];

    // For a single match, create a confirmation request
    if (openAiWs && phoneNumber) {
        // Parse the new time to provide clear information in the confirmation
        const timeInfo = parseTimeAndDate(reminderData.time, reminderData.date);
        const formattedNewTime = timeInfo.date ? formatFriendlyTime(timeInfo.date) : reminderData.time;
        const dayAdjustment = timeInfo.timeHasPassed ? " tomorrow" : " today";

        createConfirmation(phoneNumber, 'reschedule', {
            task: reminderToReschedule.task,
            reminderId: reminderToReschedule.id,
            time: reminderData.time,
            date: reminderData.date,
            oldTime: formatFriendlyTime(reminderToReschedule.triggerTime)
        });

        sendSystemMessage(openAiWs, `Just to confirm, you want to reschedule your reminder "${reminderToReschedule.task}" from ${formatFriendlyTime(reminderToReschedule.triggerTime)} to ${formattedNewTime}${dayAdjustment}. Is that correct?`);

        return {
            action: 'reschedule',
            success: false,
            reminder: reminderToReschedule.toJSON(),
            newTime: timeInfo.date ? timeInfo.date.toISOString() : null,
            timeHasPassed: timeInfo.timeHasPassed,
            pendingConfirmation: true
        };
    }

    // Cancel the old reminder
    updateReminderStatus(reminderToReschedule.id, 'rescheduled');
    removeReminder(reminderToReschedule.id);

    // Create a new reminder with the updated time
    const result = scheduleReminder(
        reminderToReschedule.task, // Keep the original task
        reminderData.time,         // Use the new time
        reminderData.date,         // Use the new date
        phoneNumber,               // Keep the same phone number
        openAiWs                   // Pass the WebSocket for time communication
    );

    const newReminder = result.reminder;
    const timeHasPassed = result.timeHasPassed;

    logger.info(`Reminder rescheduled: ${reminderToReschedule.id} -> ${newReminder.id}`);
    return {
        action: 'reschedule',
        success: true,
        oldReminder: reminderToReschedule.toJSON(),
        newReminder: newReminder.toJSON(),
        timeHasPassed: timeHasPassed
    };
}

/**
 * Process a disambiguation response to identify which reminder the user selected
 * @param {string} transcript User's response transcript
 * @param {Array} matchingReminders List of matching reminders
 * @returns {Object|null} The selected reminder or null if no selection identified
 */
export function processDisambiguationResponse(transcript, matchingReminders) {
    if (!transcript || !matchingReminders || matchingReminders.length === 0) {
        return null;
    }

    const normalizedTranscript = transcript.toLowerCase();

    // Check for numeric selection (e.g., "number 2" or "the second one")
    const numberWords = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'];
    const numberRegex = /\b(one|two|three|four|five|six|seven|eight|nine|ten|\d+)\b/;

    let selectedIndex = -1;

    // Check for explicit numbers (1, 2, 3, etc.)
    const numericMatch = normalizedTranscript.match(/\b(\d+)\b/);
    if (numericMatch) {
        selectedIndex = parseInt(numericMatch[1]) - 1; // Convert to 0-based index
    }

    // Check for number words (first, second, etc.)
    if (selectedIndex < 0) {
        for (let i = 0; i < numberWords.length; i++) {
            if (normalizedTranscript.includes(numberWords[i])) {
                selectedIndex = i;
                break;
            }
        }
    }

    // Check for number words as digits (one, two, etc.)
    if (selectedIndex < 0) {
        const wordMatch = normalizedTranscript.match(numberRegex);
        if (wordMatch) {
            const wordToNumber = {
                'one': 0, 'two': 1, 'three': 2, 'four': 3, 'five': 4,
                'six': 5, 'seven': 6, 'eight': 7, 'nine': 8, 'ten': 9
            };

            if (wordToNumber[wordMatch[1]] !== undefined) {
                selectedIndex = wordToNumber[wordMatch[1]];
            } else {
                // Try to parse it as a number
                selectedIndex = parseInt(wordMatch[1]) - 1;
            }
        }
    }

    // If we have a valid index, return that reminder
    if (selectedIndex >= 0 && selectedIndex < matchingReminders.length) {
        return matchingReminders[selectedIndex];
    }

    // If numeric selection failed, check for content match
    // This handles cases like "cancel the meeting with John" when multiple reminders were presented
    for (const reminder of matchingReminders) {
        // Check if significant parts of the reminder task appear in the transcript
        // This is a simple approach - more sophisticated NLP could be used
        const taskWords = reminder.task.toLowerCase().split(/\s+/);
        const significantWords = taskWords.filter(word => word.length > 3); // Filter out short words

        const matchCount = significantWords.filter(word => normalizedTranscript.includes(word)).length;
        const matchRatio = matchCount / significantWords.length;

        // If a significant portion of the task words are in the transcript
        if (matchRatio > 0.5 || (significantWords.length > 0 && matchCount >= 2)) {
            return reminder;
        }
    }

    // No clear selection found
    return null;
}