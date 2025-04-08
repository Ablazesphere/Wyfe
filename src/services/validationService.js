// Create a new file: src/services/validationService.js

const { format, isSameDay, differenceInMinutes } = require('date-fns');
const Reminder = require('../models/reminder');

/**
 * Service for validating reminders
 */
class ValidationService {
    /**
     * Check if a new reminder conflicts with existing reminders
     * @param {String} userId - User ID
     * @param {Date} scheduledFor - Scheduled date and time
     * @param {Number} durationMinutes - Duration in minutes (default 30)
     * @returns {Promise<Object>} - Conflict information if found
     */
    async checkConflicts(userId, scheduledFor, durationMinutes = 30) {
        try {
            // Define the time window to check for conflicts
            const bufferMinutes = 15; // Buffer before and after
            const startWindow = new Date(scheduledFor);
            startWindow.setMinutes(startWindow.getMinutes() - bufferMinutes);

            const endWindow = new Date(scheduledFor);
            endWindow.setMinutes(endWindow.getMinutes() + durationMinutes + bufferMinutes);

            // Find reminders within the time window
            const potentialConflicts = await Reminder.find({
                user: userId,
                scheduledFor: { $gte: startWindow, $lte: endWindow },
                status: { $ne: 'cancelled' }
            });

            if (potentialConflicts.length > 0) {
                return {
                    hasConflict: true,
                    conflicts: potentialConflicts,
                    message: this.formatConflictMessage(potentialConflicts)
                };
            }

            return { hasConflict: false };
        } catch (error) {
            console.error('Error checking for conflicts:', error);
            return {
                hasConflict: false,
                error: 'Could not check for conflicts.'
            };
        }
    }

    /**
     * Format a user-friendly message about conflicting reminders
     * @param {Array} conflicts - List of conflicting reminders
     * @returns {String} - Formatted message
     */
    formatConflictMessage(conflicts) {
        if (conflicts.length === 1) {
            const reminder = conflicts[0];
            const time = format(reminder.scheduledFor, 'h:mm a');
            return `This conflicts with your reminder "${reminder.content}" at ${time}. Would you like to schedule it anyway?`;
        } else {
            return `This conflicts with ${conflicts.length} other reminders you have around that time. Would you like to schedule it anyway?`;
        }
    }

    /**
     * Validate a date to ensure it's not too far in the past
     * @param {Date} date - Date to validate
     * @returns {Object} - Validation result
     */
    validateDate(date) {
        const now = new Date();

        // Check if date is in the past
        if (date < now) {
            const minutesDiff = differenceInMinutes(now, date);

            // If it's more than 5 minutes in the past
            if (minutesDiff > 5) {
                // If it's the same day, suggest the same time tomorrow
                if (isSameDay(date, now)) {
                    const tomorrowSameTime = new Date(date);
                    tomorrowSameTime.setDate(tomorrowSameTime.getDate() + 1);

                    return {
                        valid: false,
                        message: "This time has already passed for today.",
                        suggestion: {
                            action: "reschedule",
                            date: tomorrowSameTime,
                            message: `Would you like to set this for ${format(tomorrowSameTime, 'EEEE')} at the same time instead?`
                        }
                    };
                } else {
                    // It's a past date, suggest today or tomorrow
                    const suggestedDate = new Date(now);
                    suggestedDate.setHours(date.getHours(), date.getMinutes());

                    // If the suggested time would still be in the past, move to tomorrow
                    if (suggestedDate < now) {
                        suggestedDate.setDate(suggestedDate.getDate() + 1);
                    }

                    return {
                        valid: false,
                        message: "The date you specified is in the past.",
                        suggestion: {
                            action: "reschedule",
                            date: suggestedDate,
                            message: `Would you like to set this for ${format(suggestedDate, 'EEEE, MMMM do')} at ${format(suggestedDate, 'h:mm a')} instead?`
                        }
                    };
                }
            } else {
                // Just a few minutes in the past, let it through with a small adjustment
                const adjustedDate = new Date(now);
                adjustedDate.setMinutes(adjustedDate.getMinutes() + 1);

                return {
                    valid: true,
                    adjusted: true,
                    date: adjustedDate,
                    message: "I've set this reminder for a minute from now."
                };
            }
        }

        // Date is in the future, it's valid
        return { valid: true, date };
    }

    /**
     * Validate reminder content
     * @param {String} content - Reminder content
     * @returns {Object} - Validation result
     */
    validateContent(content) {
        if (!content || content.trim() === '') {
            return {
                valid: false,
                message: "I need to know what to remind you about."
            };
        }

        // Check if the content is just a date/time reference
        const timeReferences = ['morning', 'afternoon', 'evening', 'night',
            'tomorrow', 'today', 'next week', 'next month'];

        // Check if content is just a time reference
        const isTimeReference = timeReferences.some(ref =>
            content.toLowerCase() === ref ||
            content.toLowerCase() === `${ref}` ||
            content.toLowerCase() === `tomorrow ${ref}` ||
            content.toLowerCase() === `today ${ref}`
        );

        if (isTimeReference) {
            return {
                valid: false,
                message: "What would you like to be reminded about?",
                reason: "content_is_time_reference"
            };
        }

        if (content.length > 500) {
            return {
                valid: false,
                message: "That reminder text is too long. Please keep it under 500 characters.",
                suggestion: {
                    action: "shorten",
                    message: "Please provide a shorter description for your reminder."
                }
            };
        }

        return { valid: true };
    }

    /**
     * Generate a rescheduling message based on validation results
     * @param {Object} validationResult - Result from date validation
     * @returns {String} - Message for the user
     */
    generateReschedulingMessage(validationResult) {
        if (!validationResult.valid && validationResult.suggestion) {
            return validationResult.suggestion.message;
        }

        return "When would you like to reschedule this reminder?";
    }
}

module.exports = new ValidationService();