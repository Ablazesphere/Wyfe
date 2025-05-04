// services/reminderService.js - Reminder creation and execution logic
import { logger } from '../utils/logger.js';
import { parseTimeAndDate, parseNumericTime } from '../utils/dateUtils.js';
import { createReminder, getReminder, updateReminderStatus, removeReminder, getAllReminders as getRemindersFromModel } from '../models/reminderModel.js';
import { config } from '../config/config.js';

/**
 * Reminder command types
 */
export const REMINDER_COMMANDS = {
    CREATE: 'create',
    RESCHEDULE: 'reschedule',
    CANCEL: 'cancel',
    LIST: 'list',
    UPDATE: 'update'
};

/**
 * Extract reminder data from text transcript with a more flexible regex
 * @param {string} text The transcript text
 * @returns {Object|null} Extracted reminder data or null
 */
export function extractReminderFromText(text) {
    // More flexible regex pattern that can handle incomplete closing brackets
    // and potential whitespace variations
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

            // Validate the reminder data
            return validateReminderData(reminderData);
        } catch (error) {
            logger.error('Failed to parse reminder JSON:', error);

            // Additional fallback parsing for severe JSON issues
            try {
                // Try to extract individual fields with regex if JSON parsing fails
                const taskMatch = text.match(/"task"\s*:\s*"([^"]+)"/);
                const timeMatch = text.match(/"time"\s*:\s*"([^"]+)"/);
                const dateMatch = text.match(/"date"\s*:\s*"([^"]+)"/);
                const commandMatch = text.match(/"command"\s*:\s*"([^"]+)"/);
                const idMatch = text.match(/"id"\s*:\s*"([^"]+)"/);

                if (taskMatch || timeMatch || dateMatch || commandMatch || idMatch) {
                    const extractedData = {
                        task: taskMatch ? taskMatch[1] : null,
                        time: timeMatch ? timeMatch[1] : null,
                        date: dateMatch ? dateMatch[1] : null,
                        command: commandMatch ? commandMatch[1] : REMINDER_COMMANDS.CREATE,
                        id: idMatch ? idMatch[1] : null
                    };

                    return validateReminderData(extractedData);
                }
            } catch (fallbackError) {
                logger.error('Fallback parsing also failed:', fallbackError);
            }
        }
    }

    return null;
}

/**
 * Validate and normalize reminder data
 * @param {Object} reminderData The extracted reminder data
 * @returns {Object|null} Validated reminder data or null
 */
function validateReminderData(reminderData) {
    if (!reminderData) return null;

    // Set default command if missing
    if (!reminderData.command) {
        reminderData.command = REMINDER_COMMANDS.CREATE;
    }

    // For create command, ensure required fields
    if (reminderData.command === REMINDER_COMMANDS.CREATE) {
        if (!reminderData.task) {
            logger.warn('Create reminder missing task field');
            return null;
        }

        if (!reminderData.time) {
            logger.warn('Create reminder missing time field');
            return null;
        }

        // Date can be inferred for relative times
        if (!reminderData.date) {
            const now = new Date();
            reminderData.date = `${now.getDate()}/${now.getMonth() + 1}/${now.getFullYear()}`;
            logger.info(`Inferred date field: ${reminderData.date}`);
        }
    }
    // For reschedule/cancel/update, ensure ID field
    else if ([REMINDER_COMMANDS.RESCHEDULE, REMINDER_COMMANDS.CANCEL, REMINDER_COMMANDS.UPDATE].includes(reminderData.command)) {
        if (!reminderData.id) {
            logger.warn(`${reminderData.command} reminder missing id field`);
            return null;
        }
    }

    return reminderData;
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
    if (typeof time === 'string' && time.match(/^\d{1,2}:\d{2}$/)) {
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
        // Try to parse natural language expressions
        triggerTime = parseNaturalLanguageTime(time);

        if (!triggerTime) {
            // Default to 5 minutes from now for any other format
            logger.warn(`Couldn't parse time format: ${time}, ${date}, defaulting to ${config.REMINDER_DEFAULT_MINUTES} minutes`);
            triggerTime = new Date(now.getTime() + config.REMINDER_DEFAULT_MINUTES * 60000);
        }
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
 * Parse natural language time expressions
 * @param {string} timeExpression Natural language time expression
 * @returns {Date|null} Date object or null if parsing failed
 */
function parseNaturalLanguageTime(timeExpression) {
    if (!timeExpression) return null;

    const now = new Date();
    const lowerExpression = timeExpression.toLowerCase();

    // Common time expressions
    if (lowerExpression.match(/\btomorrow\b/)) {
        const tomorrow = new Date(now);
        tomorrow.setDate(tomorrow.getDate() + 1);

        // Check if time is specified (e.g., "tomorrow at 3pm")
        const timeMatch = lowerExpression.match(/\bat\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
        if (timeMatch) {
            let hours = parseInt(timeMatch[1], 10);
            const minutes = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;
            const ampm = timeMatch[3] ? timeMatch[3].toLowerCase() : null;

            // Adjust hours for AM/PM
            if (ampm === 'pm' && hours < 12) hours += 12;
            if (ampm === 'am' && hours === 12) hours = 0;

            tomorrow.setHours(hours, minutes, 0, 0);
        } else {
            // Default to 9am if no time specified
            tomorrow.setHours(9, 0, 0, 0);
        }

        return tomorrow;
    }

    // "next week", "next month", etc.
    if (lowerExpression.match(/\bnext\s+week\b/)) {
        const nextWeek = new Date(now);
        nextWeek.setDate(nextWeek.getDate() + 7);
        return nextWeek;
    }

    if (lowerExpression.match(/\bnext\s+month\b/)) {
        const nextMonth = new Date(now);
        nextMonth.setMonth(nextMonth.getMonth() + 1);
        return nextMonth;
    }

    // Handle specific days of the week (e.g., "on Monday")
    const dayMatch = lowerExpression.match(/\bon\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i);
    if (dayMatch) {
        const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
        const targetDay = days.indexOf(dayMatch[1].toLowerCase());
        const today = now.getDay();

        // Calculate days to add (if today is the target day, go to next week)
        let daysToAdd = targetDay - today;
        if (daysToAdd <= 0) daysToAdd += 7; // Go to next week

        const targetDate = new Date(now);
        targetDate.setDate(targetDate.getDate() + daysToAdd);

        // Set default time (9am) unless specified
        const timeMatch = lowerExpression.match(/\bat\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
        if (timeMatch) {
            let hours = parseInt(timeMatch[1], 10);
            const minutes = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;
            const ampm = timeMatch[3] ? timeMatch[3].toLowerCase() : null;

            // Adjust hours for AM/PM
            if (ampm === 'pm' && hours < 12) hours += 12;
            if (ampm === 'am' && hours === 12) hours = 0;

            targetDate.setHours(hours, minutes, 0, 0);
        } else {
            targetDate.setHours(9, 0, 0, 0);
        }

        return targetDate;
    }

    // "in X hours/minutes"
    const inTimeMatch = lowerExpression.match(/\bin\s+(\d+)\s+(minute|minutes|hour|hours|day|days)\b/i);
    if (inTimeMatch) {
        const amount = parseInt(inTimeMatch[1], 10);
        const unit = inTimeMatch[2].toLowerCase();

        const futureDate = new Date(now);
        if (unit.startsWith('minute')) {
            futureDate.setMinutes(futureDate.getMinutes() + amount);
        } else if (unit.startsWith('hour')) {
            futureDate.setHours(futureDate.getHours() + amount);
        } else if (unit.startsWith('day')) {
            futureDate.setDate(futureDate.getDate() + amount);
        }

        return futureDate;
    }

    // "at X:YY am/pm"
    const atTimeMatch = lowerExpression.match(/\bat\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i);
    if (atTimeMatch) {
        let hours = parseInt(atTimeMatch[1], 10);
        const minutes = atTimeMatch[2] ? parseInt(atTimeMatch[2], 10) : 0;
        const ampm = atTimeMatch[3].toLowerCase();

        // Adjust hours for AM/PM
        if (ampm === 'pm' && hours < 12) hours += 12;
        if (ampm === 'am' && hours === 12) hours = 0;

        const targetDate = new Date(now);
        targetDate.setHours(hours, minutes, 0, 0);

        // If the time has already passed today, set for tomorrow
        if (targetDate <= now) {
            targetDate.setDate(targetDate.getDate() + 1);
        }

        return targetDate;
    }

    // No pattern matched
    return null;
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
 * Reschedule an existing reminder
 * @param {string} reminderId The reminder ID
 * @param {string|number} newTime New time string (HH:MM) or minutes from now
 * @param {string} newDate New date string (dd/mm/yyyy) or null if using minutes
 * @returns {Object|null} Updated reminder or null if failed
 */
export function rescheduleReminder(reminderId, newTime, newDate) {
    const reminder = getReminder(reminderId);
    if (!reminder) {
        logger.warn(`Cannot reschedule reminder ${reminderId} - not found`);
        return null;
    }

    // Create a temporary reminder to calculate the new trigger time
    const tempReminder = scheduleReminder(
        reminder.task,
        newTime,
        newDate,
        reminder.phoneNumber
    );

    // Copy the trigger time to the original reminder
    reminder.triggerTime = tempReminder.triggerTime;

    // Remove the temporary reminder
    removeReminder(tempReminder.id);

    logger.info(`Rescheduled reminder ${reminderId} to ${reminder.triggerTime.toISOString()}`);

    // Reschedule the execution
    const delay = reminder.triggerTime.getTime() - new Date().getTime();
    if (delay > 0) {
        setTimeout(() => executeReminder(reminder.id), delay);
        logger.info(`Rescheduled reminder to execute in ${Math.round(delay / 60000)} minutes`);
    } else {
        logger.warn(`Rescheduled time ${reminder.triggerTime} is in the past, executing immediately`);
        executeReminder(reminder.id);
    }

    return reminder;
}

/**
 * Cancel a reminder
 * @param {string} reminderId The reminder ID
 * @returns {boolean} Success or failure
 */
export function cancelReminder(reminderId) {
    const reminder = getReminder(reminderId);
    if (!reminder) {
        logger.warn(`Cannot cancel reminder ${reminderId} - not found`);
        return false;
    }

    // Update status and remove
    updateReminderStatus(reminderId, 'cancelled');
    removeReminder(reminderId);

    logger.info(`Cancelled reminder ${reminderId}`);
    return true;
}

/**
 * Update a reminder's task
 * @param {string} reminderId The reminder ID
 * @param {string} newTask The new task description
 * @returns {Object|null} Updated reminder or null if failed
 */
export function updateReminderTask(reminderId, newTask) {
    const reminder = getReminder(reminderId);
    if (!reminder) {
        logger.warn(`Cannot update reminder ${reminderId} - not found`);
        return null;
    }

    reminder.task = newTask;
    logger.info(`Updated task for reminder ${reminderId}`);
    return reminder;
}

/**
 * Get all reminders, optionally filtered by phone number
 * @param {string} phoneNumber Optional phone number to filter by
 * @returns {Array} List of reminders
 */
export function getAllReminders(phoneNumber) {
    return getRemindersFromModel(phoneNumber);
}

/**
 * Process assistant's response for reminders
 * @param {string} transcript The assistant's response text
 * @param {string} phoneNumber User's phone number
 * @returns {Object|null} Processed reminder or action result
 */
export function processAssistantResponseForReminders(transcript, phoneNumber) {
    // Check if the transcript contains reminder data
    const reminderData = extractReminderFromText(transcript);

    if (!reminderData) return null;

    logger.info('Detected reminder request:', reminderData);

    // Process based on command type
    switch (reminderData.command) {
        case REMINDER_COMMANDS.CREATE:
            if (reminderData.task && reminderData.time) {
                const reminder = scheduleReminder(
                    reminderData.task,
                    reminderData.time,
                    reminderData.date,
                    phoneNumber || 'unknown'
                );
                logger.info('Reminder created:', reminder);
                return { action: 'created', reminder };
            }
            break;

        case REMINDER_COMMANDS.RESCHEDULE:
            if (reminderData.id && (reminderData.time || reminderData.date)) {
                const updatedReminder = rescheduleReminder(
                    reminderData.id,
                    reminderData.time,
                    reminderData.date
                );
                logger.info('Reminder rescheduled:', updatedReminder);
                return { action: 'rescheduled', reminder: updatedReminder };
            }
            break;

        case REMINDER_COMMANDS.CANCEL:
            if (reminderData.id) {
                const success = cancelReminder(reminderData.id);
                logger.info(`Reminder cancellation ${success ? 'succeeded' : 'failed'}`);
                return { action: 'cancelled', success };
            }
            break;

        case REMINDER_COMMANDS.UPDATE:
            if (reminderData.id && reminderData.task) {
                const updatedReminder = updateReminderTask(reminderData.id, reminderData.task);
                logger.info('Reminder task updated:', updatedReminder);
                return { action: 'updated', reminder: updatedReminder };
            }
            break;

        case REMINDER_COMMANDS.LIST:
            const reminders = getAllReminders(phoneNumber);
            logger.info(`Listed ${reminders.length} reminders for ${phoneNumber}`);
            return { action: 'listed', reminders };

        default:
            logger.warn(`Unknown reminder command: ${reminderData.command}`);
            return null;
    }

    return null;
}