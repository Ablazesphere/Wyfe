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
    const hours = date.getHours();
    const mins = date.getMinutes();
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const formattedHours = hours % 12 || 12;
    const formattedMins = mins < 10 ? `0${mins}` : mins;

    return `${formattedHours}:${formattedMins} ${ampm}`;
}

/**
 * Parse time (HH:MM) and date (dd/mm/yyyy) strings into a Date object
 * @param {string} timeStr Time string in HH:MM format
 * @param {string} dateStr Date string in dd/mm/yyyy format
 * @returns {Date|null} Date object or null if parsing failed
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