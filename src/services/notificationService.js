// src/services/notificationService.js

const reminderService = require('./reminderService');
const whatsappService = require('./whatsappService');
const dateParserService = require('./dateParserService');
const { format } = require('date-fns');

// Explicitly import voiceService with error handling
let voiceService;
try {
    voiceService = require('./voiceService');
    console.log('VoiceService loaded successfully');
} catch (error) {
    console.error('Failed to load voiceService:', error);
}

/**
 * Service for handling notifications
 */
class NotificationService {
    /**
     * Process notifications for due reminders and handle recurrence
     */
    async processNotifications() {
        try {
            // Get due reminders
            const dueReminders = await reminderService.getDueReminders();

            console.log(`Processing ${dueReminders.length} due reminders`);

            for (const reminder of dueReminders) {
                console.log(`Processing reminder ${reminder._id} with method: ${reminder.notificationMethod}`);

                // Send notification based on user's preference
                if (reminder.notificationMethod === 'whatsapp' || reminder.notificationMethod === 'both') {
                    await this.sendWhatsAppNotification(reminder);
                }

                if (reminder.notificationMethod === 'voice' || reminder.notificationMethod === 'both') {
                    console.log(`Voice notification needed for reminder ${reminder._id}`);
                    if (!voiceService) {
                        console.error('Cannot send voice notification: voiceService is not loaded');
                    } else {
                        console.log('voiceService is loaded, attempting to send notification');
                        try {
                            await this.sendVoiceNotification(reminder);
                            console.log('Voice notification completed successfully');
                        } catch (error) {
                            console.error('Voice notification failed with error:', error);
                        }
                    }
                }

                // Update reminder status
                await reminderService.updateReminderStatus(reminder._id, 'sent');

                // Handle recurrence - create next instance if applicable
                if (reminder.recurrence !== 'none') {
                    const nextReminder = await reminderService.processRecurrence(reminder);

                    // If next reminder was created, log it
                    if (nextReminder) {
                        console.log(`Created next recurring reminder for ${reminder.content}, scheduled for ${nextReminder.scheduledFor}`);
                    }
                }
            }
        } catch (error) {
            console.error('Error processing notifications:', error);
        }
    }

    /**
     * Send WhatsApp notification for reminder
     * @param {Object} reminder - The reminder to send notification for
     */
    async sendWhatsAppNotification(reminder) {
        try {
            const user = reminder.user;

            // Format message based on recurrence
            let message = `🔔 REMINDER: ${reminder.content}`;

            // Add recurrence info if applicable
            if (reminder.recurrence !== 'none') {
                const recurrenceParserService = require('./recurrenceParserService');

                // Only calculate next instance if we need it for the message
                const recurrencePattern = reminder.recurrencePattern;
                const endDate = reminder.endDate;

                if (recurrencePattern) {
                    // Calculate next occurrence date
                    const nextDate = recurrenceParserService.calculateNextOccurrence(
                        reminder.scheduledFor,
                        recurrencePattern,
                        endDate
                    );

                    if (nextDate) {
                        const formattedNextDate = dateParserService.formatDateForDisplay(nextDate);
                        message += `\n\nNext reminder: ${formattedNextDate}`;
                    }
                }
            }

            // Add response options - updated to include delay option
            message += '\n\nReply "done" to mark as complete, or "delay 30 mins" to reschedule.';

            // Send the notification
            await whatsappService.sendMessage(user.phoneNumber, message);
            console.log(`Sent WhatsApp notification to ${user.phoneNumber}`);
        } catch (error) {
            console.error('Error sending WhatsApp notification:', error);
        }
    }

    /**
     * Send voice notification for reminder using Twilio and ElevenLabs
     * @param {Object} reminder - The reminder to send notification for
     */
    async sendVoiceNotification(reminder) {
        try {
            console.log(`Starting voice notification process for reminder ${reminder._id}`);

            // Check if reminder.user is populated
            let user = reminder.user;
            if (!user || typeof user === 'string' || !user.phoneNumber) {
                console.log('User not populated in reminder, fetching user data');
                const populatedReminder = await reminderService.getReminderById(reminder._id);

                if (!populatedReminder || !populatedReminder.user) {
                    throw new Error(`Could not find reminder ${reminder._id} or its user`);
                }

                reminder = populatedReminder;
                user = reminder.user;
            }

            console.log(`Preparing voice call to ${user.phoneNumber}`);

            // Verify Twilio and ElevenLabs environment variables are set
            if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
                throw new Error('Missing Twilio credentials in environment variables');
            }

            // Make the voice call using voiceService
            try {
                await voiceService.makeReminderCall(reminder);
                console.log(`Successfully initiated voice call for reminder to ${user.phoneNumber}`);
            } catch (callError) {
                console.error(`Error in voiceService.makeReminderCall:`, callError);
                throw callError;
            }
        } catch (error) {
            console.error(`Error sending voice notification for reminder ${reminder._id}:`, error);

            // Log detailed error for troubleshooting
            if (error.response) {
                // API error response
                console.error('API Error Response:', error.response.data);
            } else if (error.request) {
                // No response received
                console.error('No response received from API');
            }

            // Don't retry here - we'll handle retries via the Twilio status callback
            console.log(`Voice notification failed for reminder ${reminder._id}, will be handled by status callback`);
        }
    }

    /**
     * Set up cron job to check for due reminders
     * @param {Number} intervalMinutes - Check interval in minutes
     */
    setupNotificationCron(intervalMinutes = 1) {
        const cron = require('node-cron');

        // Run every X minutes
        const cronSchedule = `*/${intervalMinutes} * * * *`;

        cron.schedule(cronSchedule, async () => {
            console.log(`Running notification check at ${new Date().toISOString()}`);
            await this.processNotifications();
        });

        console.log(`Notification service scheduled to run every ${intervalMinutes} minute(s)`);
    }
}

module.exports = new NotificationService();