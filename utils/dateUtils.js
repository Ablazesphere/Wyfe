// utils/dateUtils.js - Date/time parsing and formatting helpers
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
        logger.warn('Invalid date provided to formatFriendlyTime');
        return 'Invalid time';
    }

    const hours = date.getHours();
    const mins = date.getMinutes();
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const formattedHours = hours % 12 || 12;
    const formattedMins = mins < 10 ? `0${mins}` : mins;

    return `${formattedHours}:${formattedMins} ${ampm}`;
}

/**
 * Format date to friendly format (e.g., Monday, January 1, 2025)
 * @param {Date} date Date object
 * @returns {string} Formatted date string
 */
export function formatFriendlyDate(date) {
    if (!date || !(date instanceof Date) || isNaN(date.getTime())) {
        logger.warn('Invalid date provided to formatFriendlyDate');
        return 'Invalid date';
    }

    const options = {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    };

    return date.toLocaleDateString('en-IN', options);
}

/**
 * Format a full date and time in a friendly way
 * @param {Date} date Date object
 * @returns {string} Formatted date and time
 */
export function formatFriendlyDateTime(date) {
    if (!date || !(date instanceof Date) || isNaN(date.getTime())) {
        logger.warn('Invalid date provided to formatFriendlyDateTime');
        return 'Invalid date/time';
    }

    return `${formatFriendlyDate(date)} at ${formatFriendlyTime(date)}`;
}

/**
 * Parse time (HH:MM) and date (dd/mm/yyyy) strings into a Date object
 * @param {string} timeStr Time string in HH:MM format
 * @param {string} dateStr Date string in dd/mm/yyyy format
 * @returns {Date|null} Date object or null if parsing failed
 */
export function parseTimeAndDate(timeStr, dateStr) {
    try {
        // Validate time format (HH:MM)
        const timeRegex = /^(\d{1,2}):(\d{2})(?:\s*(am|pm))?$/i;
        const timeMatch = timeStr.match(timeRegex);

        if (!timeMatch) {
            throw new Error(`Invalid time format: ${timeStr}, expected HH:MM`);
        }

        let hours = parseInt(timeMatch[1], 10);
        const minutes = parseInt(timeMatch[2], 10);
        const ampm = timeMatch[3] ? timeMatch[3].toLowerCase() : null;

        // Validate hours and minutes
        if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
            throw new Error(`Invalid time values: hours=${hours}, minutes=${minutes}`);
        }

        // Handle AM/PM if provided
        if (ampm === 'pm' && hours < 12) {
            hours += 12;
        } else if (ampm === 'am' && hours === 12) {
            hours = 0;
        }

        // Handle date formats: dd/mm/yyyy or dd-mm-yyyy
        const dateRegex = /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/;
        const dateMatch = dateStr.match(dateRegex);

        if (!dateMatch) {
            throw new Error(`Invalid date format: ${dateStr}, expected dd/mm/yyyy or dd-mm-yyyy`);
        }

        const day = parseInt(dateMatch[1], 10);
        const month = parseInt(dateMatch[2], 10) - 1; // Month is 0-indexed in JS
        const year = parseInt(dateMatch[3], 10);

        // Create and validate the date
        const date = new Date(year, month, day, hours, minutes, 0);

        if (isNaN(date.getTime())) {
            throw new Error("Invalid date after parsing");
        }

        // Validate day of month (to catch issues like Feb 30)
        if (date.getDate() !== day || date.getMonth() !== month || date.getFullYear() !== year) {
            throw new Error(`Invalid date components: day=${day}, month=${month + 1}, year=${year}`);
        }

        return date;
    } catch (err) {
        logger.error(`Error parsing time/date: ${timeStr}, ${dateStr}`, err);
        return null;
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
 * Calculate relative time difference in friendly format
 * @param {Date} date The date to compare
 * @param {Date} baseDate Base date to compare against (default: now)
 * @returns {string} Friendly relative time
 */
export function getRelativeTimeString(date, baseDate = new Date()) {
    if (!date || !(date instanceof Date) || isNaN(date.getTime())) {
        return 'unknown time';
    }

    const diffMs = date.getTime() - baseDate.getTime();
    const diffMins = Math.round(diffMs / 60000);
    const diffHours = Math.round(diffMs / 3600000);
    const diffDays = Math.round(diffMs / 86400000);

    // Future
    if (diffMs > 0) {
        if (diffMins < 1) return 'in less than a minute';
        if (diffMins === 1) return 'in 1 minute';
        if (diffMins < 60) return `in ${diffMins} minutes`;
        if (diffHours === 1) return 'in 1 hour';
        if (diffHours < 24) return `in ${diffHours} hours`;
        if (diffDays === 1) return 'tomorrow';
        if (diffDays < 7) return `in ${diffDays} days`;
        return formatFriendlyDate(date);
    }

    // Past
    const absDiffMins = Math.abs(diffMins);
    const absDiffHours = Math.abs(diffHours);
    const absDiffDays = Math.abs(diffDays);

    if (absDiffMins < 1) return 'just now';
    if (absDiffMins === 1) return '1 minute ago';
    if (absDiffMins < 60) return `${absDiffMins} minutes ago`;
    if (absDiffHours === 1) return '1 hour ago';
    if (absDiffHours < 24) return `${absDiffHours} hours ago`;
    if (absDiffDays === 1) return 'yesterday';
    if (absDiffDays < 7) return `${absDiffDays} days ago`;
    return formatFriendlyDate(date);
}

/**
 * Check if a time is today
 * @param {Date} date Date to check
 * @returns {boolean} True if date is today
 */
export function isToday(date) {
    if (!date || !(date instanceof Date) || isNaN(date.getTime())) {
        return false;
    }

    const today = new Date();
    return date.getDate() === today.getDate() &&
        date.getMonth() === today.getMonth() &&
        date.getFullYear() === today.getFullYear();
}

/**
 * Check if a time is tomorrow
 * @param {Date} date Date to check
 * @returns {boolean} True if date is tomorrow
 */
export function isTomorrow(date) {
    if (!date || !(date instanceof Date) || isNaN(date.getTime())) {
        return false;
    }

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);

    return date.getDate() === tomorrow.getDate() &&
        date.getMonth() === tomorrow.getMonth() &&
        date.getFullYear() === tomorrow.getFullYear();
}

/**
 * Get system message with current time information
 * @returns {string} Updated system message
 */
export function getSystemMessageWithTime() {
    const { istFormatted, isoString } = getCurrentTime();

    return config.SYSTEM_MESSAGE_BASE +
        '\n\nCURRENT TIME INFORMATION:\n' +
        `- The current time in India (IST) is: ${istFormatted}\n` +
        `- Current UTC time (ISO format): ${isoString}\n` +
        '- Please use this exact time as your reference point for all time calculations\n' +
        '- When calculating future times, be precise with timestamp calculations';
}