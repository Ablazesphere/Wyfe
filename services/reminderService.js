// services/reminderService.js - Service for managing reminders in MongoDB

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
 * Parse date and time strings into a JavaScript Date object
 * @param {string} dateStr The date in YYYY-MM-DD format or 'today'/'tomorrow'
 * @param {string} timeStr The time in HH:MM format
 * @returns {Date} JavaScript Date object
 */
function parseDateTime(dateStr, timeStr) {
    const now = new Date();
    let targetDate;

    // Parse date
    if (dateStr === 'today') {
        targetDate = new Date(now);
    } else if (dateStr === 'tomorrow') {
        targetDate = new Date(now);
        targetDate.setDate(targetDate.getDate() + 1);
    } else {
        targetDate = new Date(dateStr);
    }

    // Parse time
    if (timeStr) {
        const [hours, minutes] = timeStr.split(':').map(num => parseInt(num, 10));
        targetDate.setHours(hours || 0);
        targetDate.setMinutes(minutes || 0);
        targetDate.setSeconds(0);
        targetDate.setMilliseconds(0);
    }

    return targetDate;
}

/**
 * Create a new reminder
 * @param {Object} reminderData The reminder data
 * @returns {Promise<Object>} The created reminder
 */
export async function createReminder(reminderData) {
    try {
        const scheduledTime = parseDateTime(reminderData.date, reminderData.time);

        const reminder = {
            userId: reminderData.userId,
            content: reminderData.content,
            originalDate: reminderData.date,
            originalTime: reminderData.time,
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

        // Build update object with only the fields that are provided
        const updateFields = {};

        if (updateData.content) updateFields.content = updateData.content;
        if (updateData.additionalDetails) updateFields.additionalDetails = updateData.additionalDetails;

        // Update scheduled time if date or time is provided
        if (updateData.date || updateData.time) {
            // Get current reminder to preserve existing date/time if only one is changing
            const currentReminder = await reminderCollection.findOne(query);

            if (!currentReminder) {
                return null;
            }

            const newDate = updateData.date || currentReminder.originalDate;
            const newTime = updateData.time || currentReminder.originalTime;

            updateFields.originalDate = newDate;
            updateFields.originalTime = newTime;
            updateFields.scheduledTime = parseDateTime(newDate, newTime);
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
        if (queryParams.fromDate && queryParams.toDate) {
            query.scheduledTime = {
                $gte: new Date(queryParams.fromDate),
                $lte: new Date(queryParams.toDate)
            };
        } else if (queryParams.fromDate) {
            query.scheduledTime = { $gte: new Date(queryParams.fromDate) };
        } else if (queryParams.toDate) {
            query.scheduledTime = { $lte: new Date(queryParams.toDate) };
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