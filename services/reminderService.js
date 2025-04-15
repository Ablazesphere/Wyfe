// services/reminderService.js - Reminder creation and execution logic
import { logger } from '../utils/logger.js';
import { parseTimeAndDate, parseNumericTime } from '../utils/dateUtils.js';
import { createReminder, getReminder, updateReminderStatus, removeReminder } from '../models/reminderModel.js';
import { config } from '../config/config.js';

/**
 * Extract reminder data from text transcript
 * @param {string} text The transcript text
 * @returns {Object|null} Extracted reminder data or null
 */
export function extractReminderFromText(text) {
    // Look for the special marker in the response
    const reminderRegex = /{{REMINDER:\s*({.*?})}}/;
    const match = text.match(reminderRegex);

    if (match && match[1]) {
        try {
            const reminderData = JSON.parse(match[1]);

            // Ensure we have all required fields
            if (!reminderData.task) {
                logger.warn('Reminder missing task field');
                return null;
            }

            if (!reminderData.time || !reminderData.date) {
                logger.warn('Reminder missing time or date field');
                return null;
            }

            return reminderData;
        } catch (error) {
            logger.error('Failed to parse reminder JSON:', error);
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
 */
export function processAssistantResponseForReminders(transcript, phoneNumber) {
    // Check if the transcript contains reminder data
    const reminderData = extractReminderFromText(transcript);

    if (reminderData && reminderData.task && reminderData.time && reminderData.date) {
        logger.info('Detected reminder request:', reminderData);

        // Schedule the reminder
        const reminder = scheduleReminder(
            reminderData.task,
            reminderData.time,
            reminderData.date,
            phoneNumber || 'unknown'
        );

        logger.info('Reminder scheduled:', reminder);
        return reminder;
    }

    return null;
}