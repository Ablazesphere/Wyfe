// src/services/dateParserService.js

const { parseISO, addDays, addWeeks, addMonths, addMinutes, addHours, setHours, setMinutes, format, parse } = require('date-fns');
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
     * Handle relative time expressions (in X minutes/hours)
     * @param {Object} relativeTime - {unit, amount} object
     * @returns {Date} - Calculated future date
     */
    handleRelativeTime(relativeTime) {
        if (!relativeTime) return null;

        const now = new Date();
        const { unit, amount } = relativeTime;

        if (!unit || !amount) return null;

        console.log(`Processing relative time: ${amount} ${unit}`);

        if (unit === 'minutes' || unit === 'minute') {
            return new Date(now.getTime() + (amount * 60 * 1000));
        } else if (unit === 'hours' || unit === 'hour') {
            return new Date(now.getTime() + (amount * 60 * 60 * 1000));
        }

        return null;
    }

    /**
 * Parse date and time from LLM response and convert to user's timezone
 * @param {Object} dateTimeInfo - The date and time information from LLM
 * @param {String} userId - User ID for preferences
 * @param {String} timezone - The user's timezone
 * @returns {Date} - JavaScript Date object in user's timezone
 */
    async parseDateTime(dateTimeInfo, userId, timezone = 'Asia/Kolkata') {
        let { date, time, timeReference, relativeTime } = dateTimeInfo;
        const now = new Date();
        let parsedDate;

        // Fix any string "null" values that might come from the LLM
        if (time === "null") time = null;
        if (timeReference === "null") timeReference = null;
        if (date === "null") date = null;

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
            // Validate date string first if it's not a relative date
            if (date && !this.isRelativeDate(date) && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
                const validation = this.validateDateString(date);
                if (!validation.valid) {
                    throw new Error(validation.message || 'Invalid date');
                }
            }

            // Handle relative time expressions first (priority over other parsing)
            if (relativeTime) {
                const { unit, amount } = relativeTime;
                console.log(`Processing relative time: ${amount} ${unit}`);

                if (unit === 'minutes' || unit === 'minute') {
                    parsedDate = addMinutes(now, amount);
                } else if (unit === 'hours' || unit === 'hour') {
                    parsedDate = addHours(now, amount);
                } else if (unit === 'days' || unit === 'day') {
                    parsedDate = addDays(now, amount);
                } else {
                    throw new Error(`Unsupported time unit: ${unit}`);
                }

                console.log(`Parsed relative time: ${amount} ${unit}, result: ${parsedDate}`);

                // If we have a valid date from relative time, return it
                if (parsedDate && !isNaN(parsedDate.getTime())) {
                    console.log(`Using timezone: ${timezone}`);

                    // If timezone is valid, apply it
                    if (timezone) {
                        try {
                            // Only apply if the function exists
                            if (typeof utcToZonedTime === 'function') {
                                parsedDate = utcToZonedTime(parsedDate, timezone);
                                console.log(`After timezone conversion: ${parsedDate}`);
                            } else {
                                console.log('Timezone conversion function not available, skipping');
                            }
                        } catch (tzError) {
                            console.error('Error applying timezone:', tzError);
                            console.log('Using parsed date without timezone conversion');
                        }
                    }

                    return parsedDate;
                }
            }

            // Handle relative minute expressions in the date string
            if (typeof date === 'string' && date.match(/in\s+(\d+)\s+(minute|minutes|hour|hours)/i)) {
                const match = date.match(/in\s+(\d+)\s+(minute|minutes|hour|hours)/i);
                const amount = parseInt(match[1]);
                const unit = match[2].toLowerCase();

                console.log(`Found relative time in date string: ${amount} ${unit}`);

                if (unit === 'minutes' || unit === 'minute') {
                    parsedDate = addMinutes(now, amount);
                } else if (unit === 'hours' || unit === 'hour') {
                    parsedDate = addHours(now, amount);
                }

                console.log(`Parsed date from relative time: ${parsedDate}`);

                // If we have a valid date, apply timezone and return
                if (parsedDate && !isNaN(parsedDate.getTime())) {
                    if (timezone) {
                        try {
                            if (typeof utcToZonedTime === 'function') {
                                console.log(`Using timezone: ${timezone}`);
                                parsedDate = utcToZonedTime(parsedDate, timezone);
                                console.log(`After timezone conversion: ${parsedDate}`);
                            } else {
                                console.log('Timezone conversion function not available, skipping');
                            }
                        } catch (tzError) {
                            console.error('Error applying timezone:', tzError);
                        }
                    } else {
                        console.log('No timezone conversion (skipped)');
                    }

                    return parsedDate;
                }
            }

            // Standard date parsing
            if (date) {
                // If it's a full date string (YYYY-MM-DD)
                if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
                    parsedDate = parseISO(date);
                    if (isNaN(parsedDate.getTime())) {
                        throw new Error('Invalid date format');
                    }
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
                    } else {
                        throw new Error(`I don't understand what you mean by "next ${dayName}"`);
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
                    } else if (unit === 'minute' || unit === 'minutes') {
                        parsedDate = addMinutes(now, amount);
                    } else if (unit === 'hour' || unit === 'hours') {
                        parsedDate = addHours(now, amount);
                    } else {
                        throw new Error(`I don't understand the time unit "${unit}"`);
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
                    } else {
                        throw new Error(`I don't understand what you mean by "this ${dayName}"`);
                    }
                }
                // Try to parse specific date from natural language (e.g., "April 15th")
                else {
                    try {
                        // Try to extract month name and day
                        const monthNames = ['january', 'february', 'march', 'april', 'may', 'june',
                            'july', 'august', 'september', 'october', 'november', 'december'];
                        let foundMonth = false;
                        let monthIndex = -1;
                        let day = null;

                        for (let i = 0; i < monthNames.length; i++) {
                            if (date.toLowerCase().includes(monthNames[i])) {
                                foundMonth = true;
                                monthIndex = i;
                                break;
                            }
                        }

                        if (foundMonth) {
                            // Try to extract the day
                            const dayMatch = date.match(/(\d+)(?:st|nd|rd|th)?/);
                            if (dayMatch) {
                                day = parseInt(dayMatch[1]);

                                // Validate day for this month
                                let maxDay;
                                if ([3, 5, 8, 10].includes(monthIndex)) { // Apr, Jun, Sep, Nov
                                    maxDay = 30;
                                } else if (monthIndex === 1) { // Feb
                                    // Simple leap year check
                                    const year = now.getFullYear();
                                    maxDay = (year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)) ? 29 : 28;
                                } else {
                                    maxDay = 31;
                                }

                                if (day < 1 || day > maxDay) {
                                    throw new Error(`There's no ${day}${this.getOrdinalSuffix(day)} day in ${monthNames[monthIndex].charAt(0).toUpperCase() + monthNames[monthIndex].slice(1)}`);
                                }

                                // Create date object - use current year unless in the past
                                let year = now.getFullYear();
                                const tempDate = new Date(year, monthIndex, day);

                                // If the date is in the past, assume next year
                                if (tempDate < now) {
                                    year++;
                                    tempDate.setFullYear(year);
                                }

                                parsedDate = tempDate;
                            }
                        }

                        if (!parsedDate) {
                            throw new Error(`I couldn't understand the date "${date}"`);
                        }
                    } catch (nlpError) {
                        console.error('Error parsing natural language date:', nlpError);
                        throw new Error(`I couldn't understand the date "${date}". Please try a format like "tomorrow" or "next Monday".`);
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
                } else {
                    // Try to extract time from natural language
                    const timeMatch = time.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
                    if (timeMatch) {
                        let hours = parseInt(timeMatch[1]);
                        const minutes = timeMatch[2] ? parseInt(timeMatch[2]) : 0;
                        const ampm = timeMatch[3] ? timeMatch[3].toLowerCase() : null;

                        // Adjust for AM/PM
                        if (ampm === 'pm' && hours < 12) {
                            hours += 12;
                        } else if (ampm === 'am' && hours === 12) {
                            hours = 0;
                        }

                        parsedDate = setHours(parsedDate, hours);
                        parsedDate = setMinutes(parsedDate, minutes);
                    } else {
                        throw new Error(`I couldn't understand the time "${time}". Please use a format like "3:00pm" or "15:00".`);
                    }
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
                    // Unknown time reference
                    console.log(`Unknown time reference: ${timeReference}`);
                    throw new Error(`I don't understand the time reference "${timeReference}". Please try using a specific time like "3pm" or common times like "morning", "afternoon", or "evening".`);
                }
            }

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
                console.log(`Using timezone: ${timezone}`);
                try {
                    if (typeof utcToZonedTime === 'function') {
                        parsedDate = utcToZonedTime(parsedDate, timezone);
                        console.log(`After timezone conversion: ${parsedDate}`);
                    } else {
                        console.log('Timezone conversion function not available, skipping');
                    }
                } catch (tzError) {
                    console.error('Error applying timezone:', tzError);
                    console.log('Using parsed date without timezone conversion');
                }
            } else {
                console.log(`Using timezone: ${timezone} (conversion skipped)`);
            }

            return parsedDate;
        } catch (error) {
            console.error('Error parsing date and time:', error);
            throw error; // Rethrow to be handled by the caller
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

        // If "next" is specified and it's the same day, we always want next week
        if (date.getDay() === dayOfWeek) {
            // It's the same day of week, so add 7 days to get next week
            resultDate.setDate(date.getDate() + 7);
            return resultDate;
        }

        // Otherwise calculate the next occurrence
        resultDate.setDate(date.getDate() + ((7 + dayOfWeek - date.getDay()) % 7));

        // If we got today (case for "this Monday" when today is Monday), check context
        if (resultDate.toDateString() === date.toDateString()) {
            // If it's already later in the day, perhaps add extra logic here
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

    isDayOfWeekReference(dateStr) {
        if (!dateStr) return false;

        const dayNames = ['monday', 'tuesday', 'wednesday', 'thursday',
            'friday', 'saturday', 'sunday'];

        return dayNames.some(day =>
            dateStr.toLowerCase().includes(day) ||
            dateStr.toLowerCase().includes(day.substring(0, 3)) // Mon, Tue, etc.
        );
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
                } else if (unit === 'minute' || unit === 'minutes') {
                    resultDate = addMinutes(now, amount);
                } else if (unit === 'hour' || unit === 'hours') {
                    resultDate = addHours(now, amount);
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