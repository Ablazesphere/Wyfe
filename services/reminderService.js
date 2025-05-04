// services/reminderService.js - Enhanced service for managing reminders in MongoDB

import { MongoClient, ObjectId } from 'mongodb';
import { logger } from '../utils/logger.js';

// MongoDB connection
let db;
let reminderCollection;
let client;

/**
 * Initialize the MongoDB connection
 * @returns {Promise} Resolves when connection is ready
 */
export async function initializeDatabase() {
    try {
        const uri = process.env.MONGODB_URI;

        if (!uri) {
            throw new Error('MONGODB_URI environment variable is required');
        }

        client = new MongoClient(uri);
        await client.connect();

        db = client.db('reminderSystem');
        reminderCollection = db.collection('reminders');

        // Create indexes for better query performance
        await reminderCollection.createIndex({ userId: 1 });
        await reminderCollection.createIndex({ scheduledTime: 1 });
        await reminderCollection.createIndex({ status: 1 });
        await reminderCollection.createIndex({ userId: 1, status: 1 });

        logger.info('MongoDB connection established successfully');
    } catch (error) {
        logger.error('Failed to connect to MongoDB:', error);
        throw error;
    }
}

/**
 * Close the MongoDB connection
 * @returns {Promise} Resolves when connection is closed
 */
export async function closeDatabase() {
    if (client) {
        await client.close();
        logger.info('MongoDB connection closed');
    }
}

/**
 * Enhanced date/time parsing with support for relative times
 * @param {string} dateStr Date string (e.g., "today", "tomorrow", "2025-05-05")
 * @param {string} timeStr Time string (e.g., "15:30", "3pm", "evening")
 * @param {string} relativeTimeStr Relative time string (e.g., "in 5 minutes")
 * @returns {Date} JavaScript Date object representing the parsed date/time
 */
export function parseDateTime(dateStr, timeStr, relativeTimeStr) {
    try {
        const now = new Date();
        let targetDate;

        // If we have a relative time expression, use that first
        if (relativeTimeStr) {
            targetDate = parseRelativeTime(relativeTimeStr);
            if (targetDate) {
                logger.debug(`Parsed relative time: "${relativeTimeStr}" → ${targetDate.toISOString()}`);
                return targetDate;
            }
        }

        // Parse date
        if (!dateStr || dateStr.trim() === '') {
            targetDate = new Date(now);
        } else if (dateStr.toLowerCase() === 'today') {
            targetDate = new Date(now);
        } else if (dateStr.toLowerCase() === 'tomorrow') {
            targetDate = new Date(now);
            targetDate.setDate(targetDate.getDate() + 1);
        } else if (dateStr.toLowerCase().startsWith('next')) {
            // Handle "next [day of week]"
            const dayOfWeek = dateStr.toLowerCase().split(' ')[1];
            targetDate = getNextDayOfWeek(now, dayOfWeek);
        } else if (dateStr.match(/^\d{4}-\d{2}-\d{2}$/)) {
            // Handle YYYY-MM-DD format
            targetDate = new Date(dateStr);
        } else {
            // Try to parse other date formats
            try {
                targetDate = new Date(dateStr);
                if (isNaN(targetDate.getTime())) {
                    // If parsing fails, default to today
                    logger.warn(`Could not parse date string: ${dateStr}, using today instead`);
                    targetDate = new Date(now);
                }
            } catch (error) {
                logger.warn(`Error parsing date string: ${dateStr}, using today instead`);
                targetDate = new Date(now);
            }
        }

        // Parse time with smart interpretation
        if (timeStr && timeStr.trim() !== '') {
            let hours = 0;
            let minutes = 0;

            // Handle descriptive times
            if (timeStr.toLowerCase() === 'morning') {
                hours = 9;
                minutes = 0;
            } else if (timeStr.toLowerCase() === 'afternoon') {
                hours = 14;
                minutes = 0;
            } else if (timeStr.toLowerCase() === 'evening') {
                hours = 19;
                minutes = 0;
            } else if (timeStr.toLowerCase() === 'night') {
                hours = 21;
                minutes = 0;
            } else if (timeStr.toLowerCase() === 'noon') {
                hours = 12;
                minutes = 0;
            } else if (timeStr.toLowerCase() === 'midnight') {
                hours = 0;
                minutes = 0;
            }
            // Handle 24-hour format (HH:MM)
            else if (timeStr.match(/^(\d{1,2}):(\d{2})$/)) {
                const timeMatch24 = timeStr.match(/^(\d{1,2}):(\d{2})$/);
                hours = parseInt(timeMatch24[1], 10);
                minutes = parseInt(timeMatch24[2], 10);
            }
            // Handle 12-hour format with am/pm (e.g., "3:00pm", "3pm")
            else if (timeStr.match(/^(\d{1,2})(?::(\d{2}))?(?:\s*)?(am|pm)$/i)) {
                const timeMatch12 = timeStr.match(/^(\d{1,2})(?::(\d{2}))?(?:\s*)?(am|pm)$/i);
                hours = parseInt(timeMatch12[1], 10);
                minutes = timeMatch12[2] ? parseInt(timeMatch12[2], 10) : 0;

                // Adjust for AM/PM
                const isPM = timeMatch12[3].toLowerCase() === 'pm';
                if (isPM && hours < 12) {
                    hours += 12;
                } else if (!isPM && hours === 12) {
                    hours = 0;
                }
            }
            // Handle lone numbers (e.g., "at 8") - SMART TIME FEATURE
            else if (timeStr.match(/^(\d{1,2})$/)) {
                hours = parseInt(timeStr, 10);
                minutes = 0;

                // Smart time interpretation:
                // If current time is past the specified hour, assume PM (if hour < 12)
                const currentHour = now.getHours();

                // If it's already past that hour today and the hour is < 12, assume PM
                if (currentHour >= hours && hours < 12) {
                    hours += 12;
                }

                logger.debug(`Smart time: Interpreted "${timeStr}" as ${hours}:00 ${hours >= 12 ? 'PM' : 'AM'}`);
            } else {
                // Fallback - keep current time
                hours = now.getHours();
                minutes = now.getMinutes();
            }

            // Set the time components
            targetDate.setHours(hours);
            targetDate.setMinutes(minutes);
            targetDate.setSeconds(0);
            targetDate.setMilliseconds(0);
        }

        return targetDate;
    } catch (error) {
        logger.error('Error parsing date/time:', error);
        return new Date(); // Return current date/time as fallback
    }
}

/**
 * Parse a relative time expression (e.g., "in 5 minutes")
 * @param {string} relativeTimeStr Relative time string
 * @returns {Date|null} Calculated date or null if parsing failed
 */
function parseRelativeTime(relativeTimeStr) {
    try {
        if (!relativeTimeStr) return null;

        const now = new Date();
        const result = new Date(now.getTime()); // Clone current date

        // Match patterns like "in X minutes/hours/days"
        const inMatch = relativeTimeStr.match(/in\s+(\d+)\s+(minute|minutes|hour|hours|day|days)/i);
        if (inMatch) {
            const amount = parseInt(inMatch[1], 10);
            const unit = inMatch[2].toLowerCase();

            if (unit === 'minute' || unit === 'minutes') {
                result.setMinutes(result.getMinutes() + amount);
            } else if (unit === 'hour' || unit === 'hours') {
                result.setHours(result.getHours() + amount);
            } else if (unit === 'day' || unit === 'days') {
                result.setDate(result.getDate() + amount);
            }

            return result;
        }

        // Match patterns like "X minutes/hours/days from now"
        const fromNowMatch = relativeTimeStr.match(/(\d+)\s+(minute|minutes|hour|hours|day|days)\s+from\s+now/i);
        if (fromNowMatch) {
            const amount = parseInt(fromNowMatch[1], 10);
            const unit = fromNowMatch[2].toLowerCase();

            if (unit === 'minute' || unit === 'minutes') {
                result.setMinutes(result.getMinutes() + amount);
            } else if (unit === 'hour' || unit === 'hours') {
                result.setHours(result.getHours() + amount);
            } else if (unit === 'day' || unit === 'days') {
                result.setDate(result.getDate() + amount);
            }

            return result;
        }

        return null; // No recognized pattern
    } catch (error) {
        logger.error('Error parsing relative time:', error);
        return null;
    }
}

/**
 * Get the next occurrence of a day of the week
 * @param {Date} date The reference date
 * @param {string} dayName The name of the day (e.g., "monday", "tuesday")
 * @returns {Date} The next occurrence of the specified day
 */
function getNextDayOfWeek(date, dayName) {
    const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const targetDay = days.indexOf(dayName.toLowerCase());

    if (targetDay < 0) {
        logger.warn(`Invalid day name: ${dayName}, using tomorrow instead`);
        const tomorrow = new Date(date);
        tomorrow.setDate(date.getDate() + 1);
        return tomorrow;
    }

    const currentDay = date.getDay();
    let daysToAdd = targetDay - currentDay;

    // If the day has already occurred this week, go to next week
    if (daysToAdd <= 0) {
        daysToAdd += 7;
    }

    const nextDate = new Date(date);
    nextDate.setDate(date.getDate() + daysToAdd);
    return nextDate;
}

/**
 * Format date for user-friendly display
 * @param {Date} date The date to format
 * @returns {string} Formatted date string
 */
export function formatDateForDisplay(date) {
    if (!date) return '';

    // Check if it's today
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);

    if (date.toDateString() === today.toDateString()) {
        return 'today';
    } else if (date.toDateString() === tomorrow.toDateString()) {
        return 'tomorrow';
    } else {
        return date.toLocaleDateString('en-US', {
            weekday: 'long',
            month: 'long',
            day: 'numeric'
        });
    }
}

/**
 * Format time for user-friendly display
 * @param {Date} date The date containing the time to format
 * @returns {string} Formatted time string
 */
export function formatTimeForDisplay(date) {
    if (!date) return '';

    return date.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
    });
}

/**
 * Format a date in a user-friendly complete way
 * @param {Date} date The date to format
 * @returns {string} Formatted date string
 */
export function formatFriendlyDateTime(date) {
    if (!date) return '';

    const options = {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
    };

    return date.toLocaleString('en-US', options);
}

/**
 * Create a new reminder
 * @param {Object} reminderData The reminder data
 * @returns {Promise<Object>} The created reminder
 */
export async function createReminder(reminderData) {
    try {
        const scheduledTime = parseDateTime(
            reminderData.date,
            reminderData.time,
            reminderData.relativeTime
        );

        const reminder = {
            userId: reminderData.userId,
            content: reminderData.content,
            originalDate: reminderData.date || '',
            originalTime: reminderData.time || '',
            relativeTime: reminderData.relativeTime || '',
            scheduledTime,
            additionalDetails: reminderData.additionalDetails || '',
            status: 'scheduled',
            createdAt: new Date(),
            updatedAt: new Date()
        };

        const result = await reminderCollection.insertOne(reminder);

        return {
            ...reminder,
            _id: result.insertedId
        };
    } catch (error) {
        logger.error('Error creating reminder:', error);
        throw error;
    }
}

/**
 * Update an existing reminder
 * @param {Object} updateData The update data
 * @returns {Promise<Object>} The updated reminder
 */
export async function updateReminder(updateData) {
    try {
        // Find the reminder by content or identifier
        const identifier = updateData.identifier;
        let query;

        if (ObjectId.isValid(identifier)) {
            query = { _id: new ObjectId(identifier), userId: updateData.userId };
        } else {
            // Content-based search (case-insensitive)
            query = {
                content: { $regex: new RegExp(identifier, 'i') },
                userId: updateData.userId
            };
        }

        // Get current reminder to preserve existing fields if only some are changing
        const currentReminder = await reminderCollection.findOne(query);
        if (!currentReminder) {
            return null;
        }

        // Build update object with only the fields that are provided
        const updateFields = {};

        if (updateData.content) updateFields.content = updateData.content;
        if (updateData.additionalDetails) updateFields.additionalDetails = updateData.additionalDetails;

        // Calculate new scheduled time if any time-related fields are provided
        if (updateData.date || updateData.time || updateData.relativeTime) {
            const newDate = updateData.date || currentReminder.originalDate;
            const newTime = updateData.time || currentReminder.originalTime;
            const newRelativeTime = updateData.relativeTime || currentReminder.relativeTime;

            updateFields.originalDate = newDate;
            updateFields.originalTime = newTime;
            updateFields.relativeTime = newRelativeTime;
            updateFields.scheduledTime = parseDateTime(newDate, newTime, newRelativeTime);
        }

        // Add metadata
        updateFields.updatedAt = new Date();

        // Perform the update
        const result = await reminderCollection.findOneAndUpdate(
            query,
            { $set: updateFields },
            { returnDocument: 'after' }
        );

        return result.value;
    } catch (error) {
        logger.error('Error updating reminder:', error);
        throw error;
    }
}

/**
 * Delete a reminder
 * @param {Object} deleteData The delete data
 * @returns {Promise<boolean>} True if deletion was successful
 */
export async function deleteReminder(deleteData) {
    try {
        // Find the reminder by content or identifier
        const identifier = deleteData.identifier;
        let query;

        if (ObjectId.isValid(identifier)) {
            query = { _id: new ObjectId(identifier), userId: deleteData.userId };
        } else {
            // Content-based search (case-insensitive)
            query = {
                content: { $regex: new RegExp(identifier, 'i') },
                userId: deleteData.userId
            };
        }

        const result = await reminderCollection.deleteOne(query);

        return result.deletedCount > 0;
    } catch (error) {
        logger.error('Error deleting reminder:', error);
        throw error;
    }
}

/**
 * Get reminders for a user
 * @param {Object} queryParams Query parameters
 * @returns {Promise<Array>} Array of reminders
 */
export async function getReminders(queryParams) {
    try {
        const query = { userId: queryParams.userId };

        // Add filters based on status if provided
        if (queryParams.status) {
            query.status = queryParams.status;
        } else {
            // Default to scheduled reminders
            query.status = 'scheduled';
        }

        // Add date range filter if provided
        if (queryParams.date) {
            // Handle relative dates like "today", "tomorrow"
            const startDate = parseDateTime(queryParams.date, '00:00');
            const endDate = new Date(startDate);
            endDate.setHours(23, 59, 59, 999);

            query.scheduledTime = {
                $gte: startDate,
                $lte: endDate
            };
        } else if (queryParams.fromDate && queryParams.toDate) {
            query.scheduledTime = {
                $gte: parseDateTime(queryParams.fromDate, '00:00'),
                $lte: parseDateTime(queryParams.toDate, '23:59')
            };
        } else if (queryParams.fromDate) {
            query.scheduledTime = {
                $gte: parseDateTime(queryParams.fromDate, '00:00')
            };
        } else if (queryParams.toDate) {
            query.scheduledTime = {
                $lte: parseDateTime(queryParams.toDate, '23:59')
            };
        }

        // Get reminders sorted by scheduled time
        const reminders = await reminderCollection
            .find(query)
            .sort({ scheduledTime: 1 })
            .toArray();

        return reminders;
    } catch (error) {
        logger.error('Error getting reminders:', error);
        throw error;
    }
}

/**
 * Get due reminders that need to be triggered now
 * @returns {Promise<Array>} Array of due reminders
 */
export async function getDueReminders() {
    try {
        const now = new Date();

        // Find reminders that are due and still scheduled
        const dueReminders = await reminderCollection
            .find({
                scheduledTime: { $lte: now },
                status: 'scheduled'
            })
            .toArray();

        return dueReminders;
    } catch (error) {
        logger.error('Error getting due reminders:', error);
        throw error;
    }
}

/**
 * Update reminder status
 * @param {string} reminderId Reminder ID
 * @param {string} status New status ('scheduled', 'sent', 'completed', 'failed', 'snoozed')
 * @param {Object} additionalData Any additional data to update
 * @returns {Promise<Object>} Updated reminder
 */
export async function updateReminderStatus(reminderId, status, additionalData = {}) {
    try {
        const updateFields = {
            status,
            updatedAt: new Date(),
            ...additionalData
        };

        const result = await reminderCollection.findOneAndUpdate(
            { _id: new ObjectId(reminderId) },
            { $set: updateFields },
            { returnDocument: 'after' }
        );

        return result.value;
    } catch (error) {
        logger.error('Error updating reminder status:', error);
        throw error;
    }
}

/**
 * Mock implementation for testing without database
 * This can be used when database is not available
 */
export const mockReminderService = {
    reminders: [],

    createReminder(reminderData) {
        const scheduledTime = parseDateTime(
            reminderData.date,
            reminderData.time,
            reminderData.relativeTime
        );

        const reminder = {
            _id: `mock_${Date.now()}`,
            userId: reminderData.userId,
            content: reminderData.content,
            originalDate: reminderData.date || '',
            originalTime: reminderData.time || '',
            relativeTime: reminderData.relativeTime || '',
            scheduledTime,
            additionalDetails: reminderData.additionalDetails || '',
            status: 'scheduled',
            createdAt: new Date(),
            updatedAt: new Date()
        };

        this.reminders.push(reminder);
        return Promise.resolve(reminder);
    },

    getReminders(queryParams) {
        const filtered = this.reminders.filter(r => r.userId === queryParams.userId);
        if (queryParams.status) {
            return Promise.resolve(filtered.filter(r => r.status === queryParams.status));
        }
        return Promise.resolve(filtered);
    },

    updateReminder(updateData) {
        const index = this.reminders.findIndex(r =>
            r.userId === updateData.userId &&
            r.content.toLowerCase().includes(updateData.identifier.toLowerCase())
        );

        if (index === -1) return Promise.resolve(null);

        const reminder = this.reminders[index];
        const newDate = updateData.date || reminder.originalDate;
        const newTime = updateData.time || reminder.originalTime;
        const newRelativeTime = updateData.relativeTime || reminder.relativeTime;

        const updated = {
            ...reminder,
            content: updateData.content || reminder.content,
            originalDate: newDate,
            originalTime: newTime,
            relativeTime: newRelativeTime,
            scheduledTime: parseDateTime(newDate, newTime, newRelativeTime),
            additionalDetails: updateData.additionalDetails || reminder.additionalDetails,
            updatedAt: new Date()
        };

        this.reminders[index] = updated;
        return Promise.resolve(updated);
    },

    deleteReminder(deleteData) {
        const initialLength = this.reminders.length;
        this.reminders = this.reminders.filter(r =>
            !(r.userId === deleteData.userId &&
                r.content.toLowerCase().includes(deleteData.identifier.toLowerCase()))
        );

        return Promise.resolve(this.reminders.length < initialLength);
    },

    updateReminderStatus(reminderId, status, additionalData = {}) {
        const index = this.reminders.findIndex(r => r._id === reminderId);

        if (index === -1) return Promise.resolve(null);

        const reminder = this.reminders[index];
        const updated = {
            ...reminder,
            status,
            updatedAt: new Date(),
            ...additionalData
        };

        this.reminders[index] = updated;
        return Promise.resolve(updated);
    },

    getDueReminders() {
        const now = new Date();
        return Promise.resolve(
            this.reminders.filter(r =>
                r.status === 'scheduled' && r.scheduledTime <= now
            )
        );
    }
};