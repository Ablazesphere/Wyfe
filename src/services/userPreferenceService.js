// Create a new file: src/services/userPreferenceService.js

const User = require('../models/USER.JS');
const whatsappService = require('./whatsappService');

/**
 * Service for managing user preferences
 */
class UserPreferenceService {
    /**
     * Default time preferences (can be overridden by user)
     */
    constructor() {
        this.defaultTimePreferences = {
            morning: { hour: 9, minute: 0 },
            afternoon: { hour: 14, minute: 0 },
            evening: { hour: 18, minute: 0 },
            night: { hour: 20, minute: 0 },
            noon: { hour: 12, minute: 0 },
            midnight: { hour: 0, minute: 0 }
        };

        this.availableTimezones = [
            'Asia/Kolkata',
            'America/New_York',
            'America/Los_Angeles',
            'Europe/London',
            'Europe/Paris',
            'Australia/Sydney',
            'Pacific/Auckland',
            'Asia/Tokyo',
            'Asia/Dubai'
        ];
    }

    /**
     * Get a user's time preferences
     * @param {String} userId - User ID
     * @returns {Object} - User's time preferences
     */
    async getTimePreferences(userId) {
        const user = await User.findById(userId);

        if (!user || !user.preferences || !user.preferences.timeReferences) {
            return this.defaultTimePreferences;
        }

        return user.preferences.timeReferences;
    }

    /**
     * Update a user's time preferences
     * @param {String} userId - User ID
     * @param {String} timeReference - Time reference to update (morning, evening, etc.)
     * @param {Number} hour - Hour value (0-23)
     * @param {Number} minute - Minute value (0-59)
     * @returns {Object} - Updated user
     */
    async setTimePreference(userId, timeReference, hour, minute) {
        // Validate inputs
        if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
            throw new Error('Invalid time values');
        }

        // Find user and update preferences
        const user = await User.findById(userId);

        if (!user) {
            throw new Error('User not found');
        }

        // Initialize preferences if they don't exist
        if (!user.preferences) {
            user.preferences = {};
        }

        if (!user.preferences.timeReferences) {
            user.preferences.timeReferences = this.defaultTimePreferences;
        }

        // Update the specific time preference
        user.preferences.timeReferences[timeReference] = { hour, minute };

        // Save and return updated user
        await user.save();
        return user;
    }

    /**
     * Update user's timezone
     * @param {String} userId - User ID
     * @param {String} timezone - Timezone identifier (e.g., 'America/New_York')
     * @returns {Object} - Updated user
     */
    async setTimezone(userId, timezone) {
        // Validate timezone
        if (!this.availableTimezones.includes(timezone)) {
            throw new Error('Invalid timezone');
        }

        // Update user's timezone
        const user = await User.findByIdAndUpdate(
            userId,
            { timeZone: timezone },
            { new: true }
        );

        if (!user) {
            throw new Error('User not found');
        }

        return user;
    }

    /**
     * Set notification preferences
     * @param {String} userId - User ID
     * @param {Object} preferences - Notification preferences object
     * @returns {Object} - Updated user
     */
    async setNotificationPreferences(userId, preferences) {
        const user = await User.findById(userId);

        if (!user) {
            throw new Error('User not found');
        }

        // Initialize preferences if they don't exist
        if (!user.preferences) {
            user.preferences = {};
        }

        // Update notification preferences
        user.preferences.notifications = {
            ...user.preferences.notifications,
            ...preferences
        };

        // Save and return updated user
        await user.save();
        return user;
    }

    /**
     * Handle preference setting commands
     * @param {Object} user - User document
     * @param {Object} command - Preference command from NLP
     */
    async handlePreferenceCommand(user, command) {
        try {
            const { action, preferenceType, value } = command;

            switch (preferenceType) {
                case 'timezone':
                    if (action === 'set') {
                        await this.setTimezone(user._id, value);
                        await whatsappService.sendMessage(
                            user.phoneNumber,
                            `✅ Your timezone has been updated to ${value}.`
                        );
                    } else if (action === 'get') {
                        await whatsappService.sendMessage(
                            user.phoneNumber,
                            `Your current timezone is set to ${user.timeZone || 'Asia/Kolkata'}.`
                        );
                    }
                    break;

                case 'time_reference':
                    if (action === 'set') {
                        const { reference, hour, minute } = value;
                        await this.setTimePreference(user._id, reference, hour, minute);
                        await whatsappService.sendMessage(
                            user.phoneNumber,
                            `✅ Your "${reference}" time preference has been set to ${hour}:${minute.toString().padStart(2, '0')}.`
                        );
                    } else if (action === 'get') {
                        const timePreferences = await this.getTimePreferences(user._id);
                        const reference = value.reference; // Access reference from the value object

                        // Check if the reference exists in preferences, fall back to defaults
                        let timeDisplay;
                        if (timePreferences[reference]) {
                            const { hour, minute } = timePreferences[reference];
                            timeDisplay = `${hour}:${minute.toString().padStart(2, '0')}`;
                        } else if (this.defaultTimePreferences[reference]) {
                            const { hour, minute } = this.defaultTimePreferences[reference];
                            timeDisplay = `${hour}:${minute.toString().padStart(2, '0')}`;
                        } else {
                            timeDisplay = "not set";
                        }

                        await whatsappService.sendMessage(
                            user.phoneNumber,
                            `Your "${reference}" time is set to ${timeDisplay}.`
                        );
                    }
                    break;

                case 'notification_method':
                    if (action === 'set') {
                        await this.setNotificationPreferences(user._id, {
                            preferredMethod: value
                        });

                        await whatsappService.sendMessage(
                            user.phoneNumber,
                            `✅ Your notification method has been set to ${value}.`
                        );
                    }
                    break;

                default:
                    await whatsappService.sendMessage(
                        user.phoneNumber,
                        "I'm not sure what preference you're trying to set. You can set your timezone, time preferences, or notification method."
                    );
            }

            // Reset conversation state
            user.conversationState = { stage: 'initial' };
            await user.save();

        } catch (error) {
            console.error('Error handling preference command:', error);
            await whatsappService.sendMessage(
                user.phoneNumber,
                "I had trouble updating your preferences. Please try again."
            );
        }
    }
}

module.exports = new UserPreferenceService();