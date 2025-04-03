// src/services/dateParserService.js

const { parseISO, addDays, addWeeks, addMonths, setHours, setMinutes, format, parse } = require('date-fns');
const { zonedTimeToUtc, utcToZonedTime } = require('date-fns-tz');
const userPreferenceService = require('./userPreferenceService');

/**
 * Service for parsing date and time expressions from natural language
 */
class DateParserService {
    constructor() {
        // Default time mappings for ambiguous time references
        this.timeDefaults = {
            morning: { hour: 9, minute: 0 },
            afternoon: { hour: 14, minute: 0 },
            evening: { hour: 18, minute: 0 },
            night: { hour: 20, minute: 0 },
            noon: { hour: 12, minute: 0 },
            midnight: { hour: 0, minute: 0 },
            lunch: { hour: 12, minute: 30 },
            dinner: { hour: 19, minute: 0 },
            breakfast: { hour: 8, minute: 0 }
        };

        // Day of week mappings
        this.dayOfWeek = {
            sunday: 0,
            monday: 1,
            tuesday: 2,
            wednesday: 3,
            thursday: 4,
            friday: 5,
            saturday: 6
        };
    }

    /**
     * Parse date and time from LLM response and convert to user's timezone
     * @param {Object} dateTimeInfo - The date and time information from LLM
     * @param {String} userId - User ID for preferences
     * @param {String} timezone - The user's timezone
     * @returns {Date} - JavaScript Date object in user's timezone
     */
    async parseDateTime(dateTimeInfo, userId, timezone = 'Asia/Kolkata') {
        let { date, time, timeReference } = dateTimeInfo;
        const now = new Date();
        let parsedDate;

        // Get user's time preferences
        let timePreferences = this.timeDefaults;
        if (userId) {
            try {
                timePreferences = await userPreferenceService.getTimePreferences(userId);
            } catch (error) {
                console.error('Error getting user time preferences:', error);
                // Fall back to defaults
            }
        }

        try {
            // Handle date
            if (date) {
                // If it's a full date string (YYYY-MM-DD)
                if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
                    parsedDate = parseISO(date);
                }
                // Handle relative dates
                else if (date.toLowerCase() === 'today') {
                    parsedDate = now;
                }
                else if (date.toLowerCase() === 'tomorrow') {
                    parsedDate = addDays(now, 1);
                }
                else if (/^next\s+(\w+)$/i.test(date)) {
                    const matches = date.match(/^next\s+(\w+)$/i);
                    const dayName = matches[1].toLowerCase();

                    if (this.dayOfWeek[dayName] !== undefined) {
                        parsedDate = this.getNextDayOfWeek(now, this.dayOfWeek[dayName]);
                    } else if (dayName === 'week') {
                        parsedDate = addWeeks(now, 1);
                    } else if (dayName === 'month') {
                        parsedDate = addMonths(now, 1);
                    }
                }
                else if (/^in\s+(\d+)\s+(\w+)$/i.test(date)) {
                    const matches = date.match(/^in\s+(\d+)\s+(\w+)$/i);
                    const amount = parseInt(matches[1]);
                    const unit = matches[2].toLowerCase();

                    if (unit === 'day' || unit === 'days') {
                        parsedDate = addDays(now, amount);
                    } else if (unit === 'week' || unit === 'weeks') {
                        parsedDate = addWeeks(now, amount);
                    } else if (unit === 'month' || unit === 'months') {
                        parsedDate = addMonths(now, amount);
                    }
                }
                else if (/^this\s+(\w+)$/i.test(date)) {
                    const matches = date.match(/^this\s+(\w+)$/i);
                    const dayName = matches[1].toLowerCase();

                    if (this.dayOfWeek[dayName] !== undefined) {
                        const targetDay = this.dayOfWeek[dayName];
                        const currentDay = now.getDay();

                        if (targetDay === currentDay) {
                            // It's today
                            parsedDate = now;
                        } else if (targetDay > currentDay) {
                            // It's later this week
                            const diff = targetDay - currentDay;
                            parsedDate = addDays(now, diff);
                        } else {
                            // It's next week
                            const diff = 7 - (currentDay - targetDay);
                            parsedDate = addDays(now, diff);
                        }
                    } else if (dayName === 'week') {
                        parsedDate = now; // This week means current week
                    } else if (dayName === 'month') {
                        parsedDate = now; // This month means current month
                    }
                }
            }

            // If we couldn't parse the date, default to today
            if (!parsedDate || isNaN(parsedDate.getTime())) {
                parsedDate = new Date();
                console.log('Using current date as fallback');
            }
            // Handle time
            if (time) {
                // If it's a HH:MM format
                if (/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/.test(time)) {
                    const [hours, minutes] = time.split(':').map(Number);
                    parsedDate = setHours(parsedDate, hours);
                    parsedDate = setMinutes(parsedDate, minutes);
                }
            }

            else if (timeReference) {
                // First check if this reference exists in user preferences or defaults
                const timeSettings = timePreferences[timeReference.toLowerCase()] ||
                    this.timeDefaults[timeReference.toLowerCase()];

                if (timeSettings) {
                    const { hour, minute } = timeSettings;
                    // Start with today's date but set the hour and minute from preferences
                    parsedDate.setHours(hour, minute, 0, 0);
                    console.log(`Using time reference "${timeReference}": ${hour}:${minute}`);
                } else {
                    // Unknown time reference, keep current time
                    console.log(`Unknown time reference: ${timeReference}`);
                }
            }

            // // Handle time references like "morning", "evening", etc. using user preferences
            // else if (timeReference && timePreferences[timeReference.toLowerCase()]) {
            //     const { hour, minute } = timePreferences[timeReference.toLowerCase()];
            //     parsedDate = setHours(parsedDate, hour);
            //     parsedDate = setMinutes(parsedDate, minute);
            // }

            // Ensure the date is not in the past
            if (parsedDate < now) {
                // If it's today and the time has already passed, move to tomorrow
                if (format(parsedDate, 'yyyy-MM-dd') === format(now, 'yyyy-MM-dd')) {
                    parsedDate = addDays(parsedDate, 1);
                    console.log('Time already passed today, moved to tomorrow');
                }
            }

            // Convert to user's timezone if needed
            if (timezone) {
                parsedDate = utcToZonedTime(parsedDate, timezone);
            }

            return parsedDate;
        } catch (error) {
            console.error('Error parsing date and time:', error);
            throw new Error('Could not parse the date and time');
        }
    }

    /**
     * Get the next occurrence of a specific day of the week
     * @param {Date} date - Starting date
     * @param {Number} dayOfWeek - Day of week (0 = Sunday, 6 = Saturday)
     * @returns {Date} - Next occurrence of that day
     */
    getNextDayOfWeek(date, dayOfWeek) {
        const resultDate = new Date(date.getTime());
        resultDate.setDate(date.getDate() + ((7 + dayOfWeek - date.getDay()) % 7));

        // If the day is today but it's already passed, get next week's occurrence
        if (resultDate.getDay() === date.getDay() && resultDate.getHours() < date.getHours()) {
            resultDate.setDate(resultDate.getDate() + 7);
        }

        return resultDate;
    }

    /**
     * Format a date for display to the user
     * @param {Date} date - The date to format
     * @returns {String} - Formatted date string
     */
    formatDateForDisplay(date) {
        // Simple, robust format that won't cause issues
        const dayName = format(date, 'EEEE');
        const monthName = format(date, 'MMMM');
        const day = format(date, 'do');
        const time = format(date, 'h:mm a');

        return `${dayName}, ${monthName} ${day} at ${time}`;
    }

    /**
     * Check if a date string is a relative date expression
     * @param {String} dateStr - The date string to check
     * @returns {Boolean} - Whether it's a relative date
     */
    isRelativeDate(dateStr) {
        if (!dateStr) return false;

        const relativeDatePatterns = [
            /^today$/i,
            /^tomorrow$/i,
            /^next\s+\w+$/i,
            /^in\s+\d+\s+\w+$/i,
            /^this\s+\w+$/i
        ];

        return relativeDatePatterns.some(pattern => pattern.test(dateStr));
    }

    /**
     * Convert a relative date to an absolute date
     * @param {String} relativeDate - Relative date expression
     * @returns {String} - YYYY-MM-DD formatted date
     */
    convertRelativeToAbsolute(relativeDate) {
        const now = new Date();
        let resultDate;

        try {
            if (relativeDate.toLowerCase() === 'today') {
                resultDate = now;
            }
            else if (relativeDate.toLowerCase() === 'tomorrow') {
                resultDate = addDays(now, 1);
            }
            else if (/^next\s+(\w+)$/i.test(relativeDate)) {
                const matches = relativeDate.match(/^next\s+(\w+)$/i);
                const dayName = matches[1].toLowerCase();

                if (this.dayOfWeek[dayName] !== undefined) {
                    resultDate = this.getNextDayOfWeek(now, this.dayOfWeek[dayName]);
                } else if (dayName === 'week') {
                    resultDate = addWeeks(now, 1);
                } else if (dayName === 'month') {
                    resultDate = addMonths(now, 1);
                }
            }
            else if (/^in\s+(\d+)\s+(\w+)$/i.test(relativeDate)) {
                const matches = relativeDate.match(/^in\s+(\d+)\s+(\w+)$/i);
                const amount = parseInt(matches[1]);
                const unit = matches[2].toLowerCase();

                if (unit === 'day' || unit === 'days') {
                    resultDate = addDays(now, amount);
                } else if (unit === 'week' || unit === 'weeks') {
                    resultDate = addWeeks(now, amount);
                } else if (unit === 'month' || unit === 'months') {
                    resultDate = addMonths(now, amount);
                }
            }

            if (resultDate) {
                return format(resultDate, 'yyyy-MM-dd');
            }
        } catch (error) {
            console.error('Error converting relative date:', error);
        }

        // Return today as fallback
        return format(now, 'yyyy-MM-dd');
    }
}

module.exports = new DateParserService();