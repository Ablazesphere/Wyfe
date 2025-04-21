// utils/dateUtils.js - Enhanced with natural language time parsing
import { logger } from './logger.js';
import { config } from '../config/config.js';

/**
 * Get current time formatted for IST
 * @returns {Object} Object with formatted time and date
 */
export function getCurrentTime() {
    const now = new Date();

    // Format the current time in IST using proper timezone handling
    const options = {
        timeZone: 'Asia/Kolkata',
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
        second: 'numeric',
        hour12: true
    };

    const currentISTTime = now.toLocaleString('en-IN', options);
    const isoTimeUTC = now.toISOString();

    return {
        istFormatted: currentISTTime,
        isoString: isoTimeUTC,
        dateObject: now
    };
}

/**
 * Format time to friendly format (e.g., 3:30 PM)
 * @param {Date} date Date object
 * @returns {string} Formatted time string
 */
export function formatFriendlyTime(date) {
    if (!date || !(date instanceof Date) || isNaN(date.getTime())) {
        return 'Invalid date';
    }

    const hours = date.getHours();
    const mins = date.getMinutes();
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const formattedHours = hours % 12 || 12;
    const formattedMins = mins < 10 ? `0${mins}` : mins;

    return `${formattedHours}:${formattedMins} ${ampm}`;
}

/**
 * Format date in human-friendly format
 * @param {Date} date Date object
 * @returns {string} Formatted date string (e.g., Monday, April 22)
 */
export function formatFriendlyDate(date) {
    if (!date || !(date instanceof Date) || isNaN(date.getTime())) {
        return 'Invalid date';
    }

    const options = {
        weekday: 'long',
        month: 'long',
        day: 'numeric'
    };

    return date.toLocaleDateString('en-IN', options);
}

/**
 * Parse time (HH:MM) and date (dd/mm/yyyy) strings into a Date object
 * Automatically moves to next day if time is in the past
 * @param {string} timeStr Time string in HH:MM format
 * @param {string} dateStr Date string in dd/mm/yyyy format
 * @returns {Object} Object with Date object and timeHasPassed flag
 */
export function parseTimeAndDate(timeStr, dateStr) {
    try {
        // Parse time in "HH:MM" format
        const [hours, minutes] = timeStr.split(':').map(num => parseInt(num, 10));

        // Parse date in "dd/mm/yyyy" format
        const [day, month, year] = dateStr.split('/').map(num => parseInt(num, 10));

        // Month is 0-indexed in JavaScript Date
        const date = new Date(year, month - 1, day, hours, minutes, 0);

        // Validate the date object
        if (isNaN(date.getTime())) {
            throw new Error("Invalid date after parsing");
        }

        // Check if the time is in the past (for today)
        const now = new Date();
        let timeHasPassed = false;

        // If date is today and time is in the past, move to tomorrow
        if (date.getFullYear() === now.getFullYear() &&
            date.getMonth() === now.getMonth() &&
            date.getDate() === now.getDate() &&
            date < now) {

            logger.info(`Time ${timeStr} is in the past. Moving reminder to tomorrow.`);
            date.setDate(date.getDate() + 1);
            timeHasPassed = true; // Flag that we moved the time
        }

        return {
            date: date,
            timeHasPassed: timeHasPassed
        };
    } catch (err) {
        logger.error(`Error parsing time/date: ${timeStr}, ${dateStr}`, err);
        return {
            date: null,
            timeHasPassed: false
        };
    }
}

/**
 * Parse numeric time (as minutes from now)
 * @param {string|number} timeValue Time value
 * @returns {Date|null} Date object or null if parsing failed
 */
export function parseNumericTime(timeValue) {
    try {
        let minutes;

        if (typeof timeValue === 'number') {
            minutes = timeValue;
        } else {
            // Extract just the numeric part if it's a string with units
            const numericMatch = timeValue.match(/^\d+/);
            minutes = numericMatch ? parseInt(numericMatch[0]) : parseInt(timeValue);
        }

        // Validate the minutes value
        if (isNaN(minutes) || minutes < 0) {
            logger.warn(`Invalid minutes value: ${minutes}, defaulting to ${config.REMINDER_DEFAULT_MINUTES} minutes`);
            minutes = config.REMINDER_DEFAULT_MINUTES;
        } else if (minutes > config.REMINDER_MAX_MINUTES) {
            logger.warn(`Very long delay requested (${minutes} minutes), capping at ${config.REMINDER_MAX_MINUTES} minutes`);
            minutes = config.REMINDER_MAX_MINUTES;
        }

        const now = new Date();
        return new Date(now.getTime() + minutes * 60000);
    } catch (err) {
        logger.error(`Error parsing numeric time: ${timeValue}`, err);
        return null;
    }
}

/**
 * Parse natural language time expressions
 * @param {string} timeExpr Time expression in natural language
 * @returns {Object} Object with date, timeHasPassed and isRelative flags
 */
export function parseNaturalLanguageTime(timeExpr) {
    if (!timeExpr) return { date: null, timeHasPassed: false, isRelative: false };

    const now = new Date();
    const lowerTimeExpr = timeExpr.toLowerCase().trim();
    let result = { date: null, timeHasPassed: false, isRelative: false };

    try {
        // Handle "in X minutes/hours" format
        const inMinutesMatch = lowerTimeExpr.match(/in\s+(\d+)\s+min(?:ute)?s?/);
        const inHoursMatch = lowerTimeExpr.match(/in\s+(\d+)\s+hour(?:s)?/);

        if (inMinutesMatch) {
            const minutes = parseInt(inMinutesMatch[1]);
            if (!isNaN(minutes) && minutes > 0) {
                result.date = new Date(now.getTime() + minutes * 60000);
                result.isRelative = true;
                return result;
            }
        }

        if (inHoursMatch) {
            const hours = parseInt(inHoursMatch[1]);
            if (!isNaN(hours) && hours > 0) {
                result.date = new Date(now.getTime() + hours * 3600000);
                result.isRelative = true;
                return result;
            }
        }

        // Handle specific time formats with AM/PM
        const timeMatch = lowerTimeExpr.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)/);
        if (timeMatch) {
            const hours = parseInt(timeMatch[1]);
            const minutes = timeMatch[2] ? parseInt(timeMatch[2]) : 0;
            const isPM = timeMatch[3].toLowerCase() === 'pm';

            if (!isNaN(hours) && !isNaN(minutes)) {
                // Convert to 24-hour format
                let hour24 = isPM ? (hours === 12 ? 12 : hours + 12) : (hours === 12 ? 0 : hours);

                const date = new Date(now);
                date.setHours(hour24, minutes, 0, 0);

                // Check if this time has already passed today
                let timeHasPassed = false;
                if (date < now) {
                    date.setDate(date.getDate() + 1); // Set to tomorrow
                    timeHasPassed = true;
                }

                result.date = date;
                result.timeHasPassed = timeHasPassed;
                return result;
            }
        }

        // Handle "tomorrow" with optional time
        if (lowerTimeExpr.includes('tomorrow')) {
            const tomorrow = new Date(now);
            tomorrow.setDate(tomorrow.getDate() + 1);

            // Check for specific time in "tomorrow" expression
            const tomorrowTimeMatch = lowerTimeExpr.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)/);
            if (tomorrowTimeMatch) {
                const hours = parseInt(tomorrowTimeMatch[1]);
                const minutes = tomorrowTimeMatch[2] ? parseInt(tomorrowTimeMatch[2]) : 0;
                const isPM = tomorrowTimeMatch[3].toLowerCase() === 'pm';

                if (!isNaN(hours) && !isNaN(minutes)) {
                    // Convert to 24-hour format
                    let hour24 = isPM ? (hours === 12 ? 12 : hours + 12) : (hours === 12 ? 0 : hours);
                    tomorrow.setHours(hour24, minutes, 0, 0);
                } else {
                    // Default to 9:00 AM if no time specified with "tomorrow"
                    tomorrow.setHours(9, 0, 0, 0);
                }
            } else {
                // Default to 9:00 AM if no time specified with "tomorrow"
                tomorrow.setHours(9, 0, 0, 0);
            }

            result.date = tomorrow;
            result.isRelative = true;
            return result;
        }

        // Handle "today" with time
        if (lowerTimeExpr.includes('today')) {
            const todayTimeMatch = lowerTimeExpr.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)/);
            if (todayTimeMatch) {
                const hours = parseInt(todayTimeMatch[1]);
                const minutes = todayTimeMatch[2] ? parseInt(todayTimeMatch[2]) : 0;
                const isPM = todayTimeMatch[3].toLowerCase() === 'pm';

                if (!isNaN(hours) && !isNaN(minutes)) {
                    // Convert to 24-hour format
                    let hour24 = isPM ? (hours === 12 ? 12 : hours + 12) : (hours === 12 ? 0 : hours);

                    const date = new Date(now);
                    date.setHours(hour24, minutes, 0, 0);

                    // Check if this time has already passed today
                    let timeHasPassed = false;
                    if (date < now) {
                        date.setDate(date.getDate() + 1); // Set to tomorrow
                        timeHasPassed = true;
                    }

                    result.date = date;
                    result.timeHasPassed = timeHasPassed;
                    return result;
                }
            }
        }

        // Handle common time references
        switch (lowerTimeExpr) {
            case 'noon':
            case 'midday':
                {
                    const date = new Date(now);
                    date.setHours(12, 0, 0, 0);

                    // If noon has passed, set to tomorrow
                    let timeHasPassed = false;
                    if (date < now) {
                        date.setDate(date.getDate() + 1);
                        timeHasPassed = true;
                    }

                    result.date = date;
                    result.timeHasPassed = timeHasPassed;
                    return result;
                }

            case 'midnight':
                {
                    const date = new Date(now);
                    date.setDate(date.getDate() + 1); // Always set to next day
                    date.setHours(0, 0, 0, 0);

                    result.date = date;
                    return result;
                }

            case 'evening':
                {
                    const date = new Date(now);
                    date.setHours(18, 0, 0, 0); // 6:00 PM

                    // If evening has passed, set to tomorrow
                    let timeHasPassed = false;
                    if (date < now) {
                        date.setDate(date.getDate() + 1);
                        timeHasPassed = true;
                    }

                    result.date = date;
                    result.timeHasPassed = timeHasPassed;
                    return result;
                }

            case 'morning':
                {
                    const date = new Date(now);
                    date.setHours(9, 0, 0, 0); // 9:00 AM

                    // If morning has passed, set to tomorrow
                    let timeHasPassed = false;
                    if (date < now) {
                        date.setDate(date.getDate() + 1);
                        timeHasPassed = true;
                    }

                    result.date = date;
                    result.timeHasPassed = timeHasPassed;
                    return result;
                }

            case 'afternoon':
                {
                    const date = new Date(now);
                    date.setHours(15, 0, 0, 0); // 3:00 PM

                    // If afternoon has passed, set to tomorrow
                    let timeHasPassed = false;
                    if (date < now) {
                        date.setDate(date.getDate() + 1);
                        timeHasPassed = true;
                    }

                    result.date = date;
                    result.timeHasPassed = timeHasPassed;
                    return result;
                }

            case 'night':
                {
                    const date = new Date(now);
                    date.setHours(20, 0, 0, 0); // 8:00 PM

                    // If night has passed, set to tomorrow
                    let timeHasPassed = false;
                    if (date < now) {
                        date.setDate(date.getDate() + 1);
                        timeHasPassed = true;
                    }

                    result.date = date;
                    result.timeHasPassed = timeHasPassed;
                    return result;
                }
        }

        // If we couldn't parse the expression, return null
        return result;
    } catch (err) {
        logger.error(`Error parsing natural language time: ${timeExpr}`, err);
        return result;
    }
}

/**
 * Get system message with current time information
 * @returns {string} Updated system message
 */
export function getSystemMessageWithTime() {
    const { istFormatted, isoString } = getCurrentTime();
    const now = new Date();

    // Generate information about passed hours
    const currentHour = now.getHours();
    let passedHoursText = "Hours that have already passed today: ";
    let hourStrings = [];

    for (let i = 0; i <= currentHour; i++) {
        const hour12 = i % 12 || 12;
        const ampm = i < 12 ? 'AM' : 'PM';
        hourStrings.push(`${hour12}:00 ${ampm}`);
    }

    const passedHoursInfo = passedHoursText + hourStrings.join(', ');

    // Generate day information
    const today = now.toLocaleDateString('en-IN', { weekday: 'long', month: 'long', day: 'numeric' });
    const tomorrow = new Date(now);
    tomorrow.setDate(now.getDate() + 1);
    const tomorrowStr = tomorrow.toLocaleDateString('en-IN', { weekday: 'long', month: 'long', day: 'numeric' });

    return config.SYSTEM_MESSAGE_BASE +
        '\n\nCURRENT TIME INFORMATION:\n' +
        `- Today is: ${today}\n` +
        `- Tomorrow is: ${tomorrowStr}\n` +
        `- The current time in India (IST) is: ${istFormatted}\n` +
        `- Current UTC time (ISO format): ${isoString}\n` +
        `- ${passedHoursInfo}\n` +
        '- Please use this exact time as your reference point for all time calculations\n' +
        '- IMPORTANT: For any reminder time that has already passed today, you MUST explicitly tell the user you are scheduling it for TOMORROW\n' +
        '- When calculating future times, be precise with timestamp calculations';
}

/**
 * Format date in dd/mm/yyyy format
 * @param {Date} date The date to format
 * @returns {string} Formatted date string
 */
export function formatDateForReminder(date) {
    if (!date || !(date instanceof Date) || isNaN(date.getTime())) {
        const now = new Date();
        return `${now.getDate().toString().padStart(2, '0')}/${(now.getMonth() + 1).toString().padStart(2, '0')}/${now.getFullYear()}`;
    }

    const day = date.getDate().toString().padStart(2, '0');
    const month = (date.getMonth() + 1).toString().padStart(2, '0'); // getMonth() is 0-indexed
    const year = date.getFullYear();

    return `${day}/${month}/${year}`;
}

/**
 * Format time in HH:MM format
 * @param {Date} date The date to format
 * @returns {string} Formatted time string
 */
export function formatTimeForReminder(date) {
    if (!date || !(date instanceof Date) || isNaN(date.getTime())) {
        const now = new Date();
        return `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
    }

    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');

    return `${hours}:${minutes}`;
}