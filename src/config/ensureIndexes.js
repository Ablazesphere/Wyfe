// src/config/ensureIndexes.js

const User = require('../models/User');
const Reminder = require('../models/Reminder');

/**
 * Ensures all required database indexes are created
 * @returns {Promise<void>}
 */
async function ensureIndexes() {
    try {
        console.log('Ensuring database indexes are set up...');

        // This will create all indexes defined in the schemas
        await User.createIndexes();
        await Reminder.createIndexes();

        // Log indexes for verification
        const userIndexes = await User.collection.indexes();
        const reminderIndexes = await Reminder.collection.indexes();

        console.log(`Created ${userIndexes.length} indexes for User collection`);
        console.log(`Created ${reminderIndexes.length} indexes for Reminder collection`);

        console.log('Database indexes set up successfully');
    } catch (error) {
        console.error('Error setting up database indexes:', error);
        throw error;
    }
}

module.exports = ensureIndexes;