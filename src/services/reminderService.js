// src/services/reminderService.js

const Reminder = require('../models/reminder');

/**
 * Create a new reminder
 * @param {Object} reminderData - Data for creating the reminder
 * @returns {Promise<Object>} - Created reminder object
 */
const createReminder = async (reminderData) => {
    try {
        const reminder = new Reminder(reminderData);
        await reminder.save();
        return reminder;
    } catch (error) {
        console.error('Error creating reminder:', error);
        throw error;
    }
};

/**
 * Get all reminders for a user
 * @param {String} userId - User ID to get reminders for
 * @returns {Promise<Array>} - List of reminders
 */
const getUserReminders = async (userId) => {
    try {
        const reminders = await Reminder.find({
            user: userId,
            status: { $ne: 'cancelled' }
        }).sort({ scheduledFor: 1 });

        return reminders;
    } catch (error) {
        console.error('Error fetching user reminders:', error);
        throw error;
    }
};

/**
 * Update reminder status
 * @param {String} reminderId - Reminder ID
 * @param {String} status - New status
 * @returns {Promise<Object>} - Updated reminder
 */
const updateReminderStatus = async (reminderId, status) => {
    try {
        const reminder = await Reminder.findByIdAndUpdate(
            reminderId,
            { status },
            { new: true }
        );

        return reminder;
    } catch (error) {
        console.error('Error updating reminder status:', error);
        throw error;
    }
};

/**
 * Get pending reminders due for notification
 * @returns {Promise<Array>} - List of due reminders
 */
const getDueReminders = async () => {
    try {
        const now = new Date();

        const dueReminders = await Reminder.find({
            scheduledFor: { $lte: now },
            status: 'pending'
        }).populate('user');

        return dueReminders;
    } catch (error) {
        console.error('Error fetching due reminders:', error);
        throw error;
    }
};

/**
 * Delete a reminder
 * @param {String} reminderId - Reminder ID
 * @returns {Promise<Boolean>} - Success status
 */
const deleteReminder = async (reminderId) => {
    try {
        await Reminder.findByIdAndDelete(reminderId);
        return true;
    } catch (error) {
        console.error('Error deleting reminder:', error);
        throw error;
    }
};

/**
 * Get reminders within a date range
 * @param {String} userId - User ID
 * @param {Date} startDate - Start date
 * @param {Date} endDate - End date
 * @returns {Promise<Array>} - Reminders in range
 */
const getRemindersInRange = async (userId, startDate, endDate) => {
    try {
        const reminders = await Reminder.find({
            user: userId,
            scheduledFor: { $gte: startDate, $lte: endDate },
            status: { $ne: 'cancelled' }
        }).sort({ scheduledFor: 1 });

        return reminders;
    } catch (error) {
        console.error('Error fetching reminders in range:', error);
        throw error;
    }
};

/**
 * Search reminders by content
 * @param {String} userId - User ID
 * @param {String} searchTerm - Content to search for
 * @returns {Promise<Array>} - Matching reminders
 */
const searchRemindersByContent = async (userId, searchTerm) => {
    try {
        // Clean up the search term
        const cleanTerm = searchTerm.toLowerCase().trim();

        // Get all reminders for the user
        const allReminders = await Reminder.find({
            user: userId,
            status: { $ne: 'cancelled' }
        });

        // Filter reminders using a more flexible matching algorithm
        const matchedReminders = allReminders.filter(reminder => {
            const content = reminder.content.toLowerCase();

            // Direct substring match
            if (content.includes(cleanTerm)) {
                return true;
            }

            // Check for similar words (basic stemming)
            const contentWords = content.split(/\s+/);
            const searchWords = cleanTerm.split(/\s+/);

            // Check if most search words appear in content
            const matchingWords = searchWords.filter(searchWord =>
                contentWords.some(contentWord =>
                    contentWord.includes(searchWord) ||
                    searchWord.includes(contentWord) ||
                    // Handle singular/plural by checking for common endings
                    (contentWord.endsWith('s') && searchWord === contentWord.slice(0, -1)) ||
                    (searchWord.endsWith('s') && contentWord === searchWord.slice(0, -1)) ||
                    // Handle gerund forms (ing)
                    (contentWord.endsWith('ing') && searchWord === contentWord.replace(/ing$/, '')) ||
                    (searchWord.endsWith('ing') && contentWord === searchWord.replace(/ing$/, ''))
                )
            );

            // Return true if at least 60% of search words match
            return matchingWords.length >= Math.ceil(searchWords.length * 0.6);
        });

        return matchedReminders;
    } catch (error) {
        console.error('Error searching reminders:', error);
        throw error;
    }
};

/**
 * Get a reminder by ID
 * @param {String} reminderId - Reminder ID
 * @returns {Promise<Object>} - Reminder object
 */
const getReminderById = async (reminderId) => {
    try {
        const reminder = await Reminder.findById(reminderId);
        return reminder;
    } catch (error) {
        console.error('Error fetching reminder by ID:', error);
        throw error;
    }
};

/**
 * Update a reminder
 * @param {String} reminderId - Reminder ID
 * @param {Object} updateData - Fields to update
 * @returns {Promise<Object>} - Updated reminder
 */
const updateReminder = async (reminderId, updateData) => {
    try {
        const reminder = await Reminder.findByIdAndUpdate(
            reminderId,
            updateData,
            { new: true }
        );

        return reminder;
    } catch (error) {
        console.error('Error updating reminder:', error);
        throw error;
    }
};

// Add these methods to module.exports
module.exports = {
    createReminder,
    getUserReminders,
    updateReminderStatus,
    getDueReminders,
    deleteReminder,
    getRemindersInRange,
    searchRemindersByContent,
    getReminderById,
    updateReminder
};