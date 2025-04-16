// services/reminderService.js - Reminder creation and execution logic
import { logger } from '../utils/logger.js';
import { parseTimeAndDate, parseNumericTime } from '../utils/dateUtils.js';
import { createReminder, getReminder, updateReminderStatus, removeReminder } from '../models/reminderModel.js';
import { config } from '../config/config.js';

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
 * @returns {Object} The created reminder
 */
export function scheduleReminder(task, time, date, phoneNumber) {
    let triggerTime;
    const now = new Date();

    logger.debug(`Scheduling reminder with input time: ${time}, date: ${date} (time type: ${typeof time})`);

    // Handle time in "HH:MM" format with date in "dd/mm/yyyy" format
    if (typeof time === 'string' && typeof date === 'string') {
        triggerTime = parseTimeAndDate(time, date);

        if (!triggerTime) {
            // Fallback to default time if parsing failed
            triggerTime = new Date(now.getTime() + config.REMINDER_DEFAULT_MINUTES * 60000);
            logger.warn(`Falling back to ${config.REMINDER_DEFAULT_MINUTES} minutes from now: ${triggerTime.toISOString()}`);
        }
    } else if (typeof time === 'number' || (!isNaN(parseInt(time)) && typeof time === 'string')) {
        // If time is a number or numeric string, treat it as minutes from now
        triggerTime = parseNumericTime(time);

        if (!triggerTime) {
            // Fallback to default time if parsing failed
            triggerTime = new Date(now.getTime() + config.REMINDER_DEFAULT_MINUTES * 60000);
            logger.warn(`Falling back to ${config.REMINDER_DEFAULT_MINUTES} minutes from now: ${triggerTime.toISOString()}`);
        }
    } else {
        // Default to 5 minutes from now for any other format
        logger.warn(`Couldn't parse time format: ${time}, ${date}, defaulting to ${config.REMINDER_DEFAULT_MINUTES} minutes`);
        triggerTime = new Date(now.getTime() + config.REMINDER_DEFAULT_MINUTES * 60000);
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

    return reminder;
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
 * @returns {Object|null} Result of the reminder operation or null
 */
export function processAssistantResponseForReminders(transcript, phoneNumber) {
    // Extract reminder data from the transcript
    const reminderData = extractReminderFromText(transcript);

    if (!reminderData) return null;

    logger.info(`Detected reminder request with action: ${reminderData.action}`, reminderData);

    // Handle different reminder actions
    switch (reminderData.action) {
        case 'create':
            return handleCreateReminder(reminderData, phoneNumber);

        case 'list':
            return handleListReminders(phoneNumber);

        case 'cancel':
            return handleCancelReminder(reminderData, phoneNumber);

        case 'reschedule':
            return handleRescheduleReminder(reminderData, phoneNumber);

        default:
            logger.warn(`Unknown reminder action: ${reminderData.action}`);
            return null;
    }
}

/**
 * Handle the creation of a new reminder
 * @param {Object} reminderData The extracted reminder data
 * @param {string} phoneNumber User's phone number
 * @returns {Object} The created reminder
 */
function handleCreateReminder(reminderData, phoneNumber) {
    if (!reminderData.task || !reminderData.time) {
        logger.warn('Missing required fields for creating reminder');
        return null;
    }

    // Schedule the reminder
    const reminder = scheduleReminder(
        reminderData.task,
        reminderData.time,
        reminderData.date,
        phoneNumber || 'unknown'
    );

    logger.info('Reminder created:', reminder);
    return { action: 'create', success: true, reminder };
}

/**
 * Handle listing reminders for a user
 * @param {string} phoneNumber User's phone number
 * @returns {Object} Result with list of reminders
 */
function handleListReminders(phoneNumber) {
    // Import the getAllReminders function if needed
    // const { getAllReminders } = require('../models/reminderModel.js');

    const reminders = getAllReminders(phoneNumber);
    logger.info(`Retrieved ${reminders.length} reminders for ${phoneNumber}`);

    return {
        action: 'list',
        success: true,
        reminders: reminders.map(r => r.toJSON()),
        count: reminders.length
    };
}

/**
 * Handle canceling a reminder
 * @param {Object} reminderData The extracted reminder data
 * @param {string} phoneNumber User's phone number
 * @returns {Object} Result of the cancellation
 */
function handleCancelReminder(reminderData, phoneNumber) {
    if (!reminderData.task) {
        logger.warn('Missing task for canceling reminder');
        return null;
    }

    // Find reminders matching the task description for this user
    const userReminders = getAllReminders(phoneNumber);
    const matchingReminders = userReminders.filter(r =>
        r.task.toLowerCase().includes(reminderData.task.toLowerCase())
    );

    if (matchingReminders.length === 0) {
        logger.info(`No matching reminders found for "${reminderData.task}" and phone ${phoneNumber}`);
        return { action: 'cancel', success: false, reason: 'no_match', originalTask: reminderData.task };
    }

    if (matchingReminders.length > 1) {
        logger.info(`Multiple matching reminders found for "${reminderData.task}". Using the first one.`);
        // We could return a disambiguation result here, but for now we'll use the first match
    }

    // Cancel the first matching reminder
    const reminderToCancel = matchingReminders[0];
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
 * Handle rescheduling a reminder
 * @param {Object} reminderData The extracted reminder data
 * @param {string} phoneNumber User's phone number
 * @returns {Object} Result of the rescheduling
 */
function handleRescheduleReminder(reminderData, phoneNumber) {
    if (!reminderData.task || !reminderData.time || !reminderData.date) {
        logger.warn('Missing required fields for rescheduling reminder');
        return null;
    }

    // Find reminders matching the task description for this user
    const userReminders = getAllReminders(phoneNumber);
    const matchingReminders = userReminders.filter(r =>
        r.task.toLowerCase().includes(reminderData.task.toLowerCase())
    );

    if (matchingReminders.length === 0) {
        logger.info(`No matching reminders found for "${reminderData.task}" and phone ${phoneNumber}`);

        // Instead of failing, create a new reminder
        logger.info(`Creating new reminder instead of rescheduling`);
        return handleCreateReminder(reminderData, phoneNumber);
    }

    if (matchingReminders.length > 1) {
        logger.info(`Multiple matching reminders found for "${reminderData.task}". Using the first one.`);
        // We could return a disambiguation result here, but for now we'll use the first match
    }

    // Get the first matching reminder
    const reminderToReschedule = matchingReminders[0];

    // Cancel the old reminder
    updateReminderStatus(reminderToReschedule.id, 'rescheduled');
    removeReminder(reminderToReschedule.id);

    // Create a new reminder with the updated time
    const newReminder = scheduleReminder(
        reminderToReschedule.task, // Keep the original task
        reminderData.time,         // Use the new time
        reminderData.date,         // Use the new date
        phoneNumber                // Keep the same phone number
    );

    logger.info(`Reminder rescheduled: ${reminderToReschedule.id} -> ${newReminder.id}`);
    return {
        action: 'reschedule',
        success: true,
        oldReminder: reminderToReschedule.toJSON(),
        newReminder: newReminder.toJSON()
    };
}