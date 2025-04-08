// src/services/recurrenceParserService.js

const { addDays, addWeeks, addMonths, addYears, parse, parseISO, format, isBefore } = require('date-fns');
const { utcToZonedTime } = require('date-fns-tz');

/**
 * Service for parsing and handling recurrence patterns
 */
class RecurrenceParserService {
    /**
     * Parse a natural language recurrence pattern
     * @param {String} text - The recurrence text
     * @returns {Object} - Structured recurrence pattern
     */
    parseRecurrencePattern(text) {
        if (!text) return null;

        const lowerText = text.toLowerCase();

        // Extract days of the week mentioned in the text
        const daysOfWeek = {
            'sunday': 0,
            'monday': 1,
            'tuesday': 2,
            'wednesday': 3,
            'thursday': 4,
            'friday': 5,
            'saturday': 6
        };

        let mentionedDays = [];

        // Check for multiple days (e.g., "every Monday and Wednesday")
        for (const [dayName, dayNum] of Object.entries(daysOfWeek)) {
            if (lowerText.includes(dayName)) {
                mentionedDays.push(dayNum);
            }
        }

        // If we have multiple days, create a pattern with daysOfWeek
        if (mentionedDays.length > 1) {
            return {
                recurrence: 'custom',
                recurrencePattern: {
                    frequency: 'week',
                    interval: 1,
                    daysOfWeek: mentionedDays
                }
            };
        }

        // Handle "every day/daily"
        if (lowerText.includes('every day') || lowerText.includes('daily')) {
            return {
                recurrence: 'daily',
                recurrencePattern: {
                    frequency: 'day',
                    interval: 1
                }
            };
        }

        // Handle "every week/weekly"
        if (lowerText.includes('every week') || lowerText.includes('weekly')) {
            return {
                recurrence: 'weekly',
                recurrencePattern: {
                    frequency: 'week',
                    interval: 1
                }
            };
        }

        // Handle "every month/monthly"
        if (lowerText.includes('every month') || lowerText.includes('monthly')) {
            return {
                recurrence: 'monthly',
                recurrencePattern: {
                    frequency: 'month',
                    interval: 1
                }
            };
        }

        // Handle "every X days/weeks/months"
        const everyXPattern = /every\s+(\d+)\s+(day|days|week|weeks|month|months|year|years)/i;
        const everyXMatch = lowerText.match(everyXPattern);

        if (everyXMatch) {
            const interval = parseInt(everyXMatch[1]);
            let frequency = everyXMatch[2].toLowerCase();

            // Normalize frequency
            if (frequency.endsWith('s')) {
                frequency = frequency.slice(0, -1); // Remove trailing 's'
            }

            return {
                recurrence: 'custom',
                recurrencePattern: {
                    frequency,
                    interval
                }
            };
        }

        // Handle "every other X" (X = day, week, month, year)
        const everyOtherPattern = /every\s+other\s+(day|week|month|year|monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i;
        const everyOtherMatch = lowerText.match(everyOtherPattern);

        if (everyOtherMatch) {
            const timeUnit = everyOtherMatch[1].toLowerCase();

            // Check if it's a day of week
            const daysOfWeek = {
                'sunday': 0,
                'monday': 1,
                'tuesday': 2,
                'wednesday': 3,
                'thursday': 4,
                'friday': 5,
                'saturday': 6
            };

            if (daysOfWeek[timeUnit] !== undefined) {
                return {
                    recurrence: 'custom',
                    recurrencePattern: {
                        frequency: 'week',
                        interval: 2,
                        dayOfWeek: daysOfWeek[timeUnit]
                    }
                };
            } else {
                return {
                    recurrence: 'custom',
                    recurrencePattern: {
                        frequency: timeUnit,
                        interval: 2
                    }
                };
            }
        }

        // Handle "every X" (X = Monday, Tuesday, etc.)
        const everyDayPattern = /every\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i;
        const everyDayMatch = lowerText.match(everyDayPattern);

        if (everyDayMatch) {
            const dayName = everyDayMatch[1].toLowerCase();
            const daysOfWeek = {
                'sunday': 0,
                'monday': 1,
                'tuesday': 2,
                'wednesday': 3,
                'thursday': 4,
                'friday': 5,
                'saturday': 6
            };

            return {
                recurrence: 'custom',
                recurrencePattern: {
                    frequency: 'week',
                    interval: 1,
                    dayOfWeek: daysOfWeek[dayName]
                }
            };
        }

        // Handle end dates
        let endDate = null;

        // Check for "until X" pattern
        const untilPattern = /until\s+([a-zA-Z]+\s+\d{1,2}(?:st|nd|rd|th)?(?:,\s+\d{4})?|\d{4}-\d{2}-\d{2}|[a-zA-Z]+)/i;
        const untilMatch = lowerText.match(untilPattern);

        if (untilMatch) {
            const dateStr = untilMatch[1];
            try {
                // Handle month names (e.g., "until December")
                const monthNames = ['january', 'february', 'march', 'april', 'may', 'june',
                    'july', 'august', 'september', 'october', 'november', 'december'];

                let parsedEndDate = null;

                // First, check if it's just a month name (e.g., "until December")
                const monthMatch = monthNames.findIndex(month =>
                    dateStr.toLowerCase().includes(month)
                );

                if (monthMatch !== -1) {
                    // It's a month reference
                    const currentYear = new Date().getFullYear();
                    const currentMonth = new Date().getMonth();

                    // Determine the year (current year or next year)
                    let targetYear = currentYear;
                    if (monthMatch < currentMonth) {
                        // If the month has already passed this year, assume next year
                        targetYear = currentYear + 1;
                    }

                    // Set to the last day of the specified month
                    const lastDay = new Date(targetYear, monthMatch + 1, 0).getDate();
                    parsedEndDate = new Date(targetYear, monthMatch, lastDay);

                    console.log(`Parsed month reference "${dateStr}" to ${parsedEndDate}`);
                }
                // Try to match "December 2023" or "December 31" format
                else {
                    const monthYearPattern = /([a-zA-Z]+)(?:\s+(\d{1,2})(?:st|nd|rd|th)?)?(?:,?\s+(\d{4}))?/i;
                    const monthYearMatch = dateStr.match(monthYearPattern);

                    if (monthYearMatch) {
                        const monthName = monthYearMatch[1].toLowerCase();
                        const monthIndex = monthNames.findIndex(month => monthName.includes(month));

                        if (monthIndex !== -1) {
                            // Determine the year (specified, current, or next)
                            const currentYear = new Date().getFullYear();
                            const currentMonth = new Date().getMonth();

                            let year = monthYearMatch[3] ? parseInt(monthYearMatch[3]) : currentYear;

                            // If month already passed this year and no year specified, assume next year
                            if (!monthYearMatch[3] && monthIndex < currentMonth) {
                                year = currentYear + 1;
                            }

                            // Determine the day (specified or last day of month)
                            let day;
                            if (monthYearMatch[2]) {
                                day = parseInt(monthYearMatch[2]);
                            } else {
                                // Last day of the month
                                day = new Date(year, monthIndex + 1, 0).getDate();
                            }

                            parsedEndDate = new Date(year, monthIndex, day);
                            console.log(`Parsed date string "${dateStr}" to ${parsedEndDate}`);
                        }
                    }
                }

                // If we couldn't parse as month/date, try ISO format
                if (!parsedEndDate && dateStr.match(/\d{4}-\d{2}-\d{2}/)) {
                    parsedEndDate = new Date(dateStr);
                }

                if (parsedEndDate && !isNaN(parsedEndDate.getTime())) {
                    // Format as ISO string for consistency
                    endDate = parsedEndDate.toISOString().split('T')[0];
                    console.log(`Set end date to ${endDate}`);
                }
            } catch (error) {
                console.error('Error parsing end date:', error);
            }
        }

        // Return the pattern with end date
        return {
            recurrence: 'custom',
            recurrencePattern: {
                frequency: 'week',
                interval: 2,
                dayOfWeek: 2 // Tuesday
            },
            endDate
        };
    }

    /**
     * Calculate the next occurrence of a recurring event
     * @param {Date} baseDate - The base date to calculate from
     * @param {Object} recurrencePattern - The recurrence pattern
     * @param {Date} endDate - Optional end date for the recurrence
     * @returns {Date|null} - The next occurrence, or null if past end date
     */
    calculateNextOccurrence(baseDate, recurrencePattern, endDate = null) {
        if (!recurrencePattern) return null;

        const { frequency, interval, dayOfWeek, dayOfMonth } = recurrencePattern;
        let nextDate = new Date(baseDate);

        switch (frequency) {
            case 'day':
                nextDate = addDays(baseDate, interval);
                break;

            case 'week':
                // Handle multiple days of week
                if (daysOfWeek && daysOfWeek.length > 0) {
                    // Find the next occurrence of any of the specified days
                    const currentDay = baseDate.getDay();

                    // Sort days to find the next one after the current day
                    const sortedDays = [...daysOfWeek].sort((a, b) => a - b);

                    // Find the next day in the same week
                    let nextDay = sortedDays.find(day => day > currentDay);

                    if (nextDay !== undefined) {
                        // Found a day later this week
                        const daysToAdd = nextDay - currentDay;
                        nextDate = addDays(baseDate, daysToAdd);
                    } else {
                        // No days left this week, move to the first day next week
                        const daysToAdd = 7 - currentDay + sortedDays[0];
                        nextDate = addDays(baseDate, daysToAdd);
                    }
                } else if (dayOfWeek !== null && dayOfWeek !== undefined) {
                    // Single day of week handling (existing code)
                    nextDate = addWeeks(baseDate, interval);

                    // Adjust to the specified day of week
                    const currentDay = nextDate.getDay();
                    const daysToAdd = (dayOfWeek - currentDay + 7) % 7;
                    nextDate = addDays(nextDate, daysToAdd);
                } else {
                    // Simple weekly recurrence
                    nextDate = addWeeks(baseDate, interval);
                }
                break;

            case 'month':
                nextDate = addMonths(baseDate, interval);

                // If specific day of month is specified, adjust to that day
                if (dayOfMonth !== null && dayOfMonth !== undefined) {
                    nextDate.setDate(Math.min(dayOfMonth, this.getDaysInMonth(nextDate)));
                }
                break;

            case 'year':
                nextDate = addYears(baseDate, interval);
                break;

            default:
                return null;
        }

        // Check if we've passed the end date
        if (endDate && isBefore(endDate, nextDate)) {
            return null;
        }

        return nextDate;
    }

    /**
     * Get the number of days in the month for a given date
     * @param {Date} date - The date to check
     * @returns {Number} - Number of days in the month
     */
    getDaysInMonth(date) {
        return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
    }

    /**
  * Format a recurrence pattern for display to the user
  * @param {Object} recurrencePattern - The recurrence pattern
  * @param {Date} startDate - Start date of the recurrence
  * @param {Date} endDate - End date of the recurrence
  * @returns {String} - Human-readable description
  */
    formatRecurrenceForDisplay(recurrencePattern, startDate, endDate = null) {
        if (!recurrencePattern) return "One-time reminder";

        const { frequency, interval, dayOfWeek, daysOfWeek } = recurrencePattern;
        const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

        let description = "";

        // Determine interval phrase
        const intervalPhrase = interval === 1 ? "every" : interval === 2 ? "every other" : `every ${interval}`;

        // Build frequency phrase
        switch (frequency) {
            case 'day':
                description = `${intervalPhrase} day`;
                break;

            case 'week':
                if (daysOfWeek && daysOfWeek.length > 0) {
                    // Handle multiple days of the week
                    const daysList = daysOfWeek.map(day => dayNames[day]);

                    if (daysList.length === 2) {
                        description = `${intervalPhrase} ${daysList[0]} and ${daysList[1]}`;
                    } else {
                        // Format list with Oxford comma
                        const lastDay = daysList.pop();
                        description = `${intervalPhrase} ${daysList.join(', ')}${daysList.length > 0 ? ',' : ''} and ${lastDay}`;
                    }
                } else if (dayOfWeek !== null && dayOfWeek !== undefined) {
                    description = `${intervalPhrase} ${dayNames[dayOfWeek]}`;
                } else {
                    description = `${intervalPhrase} week`;
                }
                break;

            case 'month':
                description = `${intervalPhrase} month`;

                // Add day of month detail if specified
                if (recurrencePattern.dayOfMonth) {
                    description += ` on day ${recurrencePattern.dayOfMonth}`;
                }
                break;

            case 'year':
                description = `${intervalPhrase} year`;
                break;

            default:
                return "Custom recurrence";
        }

        // Add start date if provided
        if (startDate) {
            description += ` starting ${format(startDate, 'MMMM do, yyyy')}`;
        }

        // Add end date if provided
        if (endDate) {
            description += ` until ${format(endDate, 'MMMM do, yyyy')}`;
        }

        return description;
    }
}

module.exports = new RecurrenceParserService();