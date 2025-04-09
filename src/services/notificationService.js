// src/services/notificationService.js

const reminderService = require('./reminderService');
const whatsappService = require('./whatsappService');
const dateParserService = require('./dateParserService');
const { format } = require('date-fns');

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
                // Send notification based on user's preference
                if (reminder.notificationMethod === 'whatsapp' || reminder.notificationMethod === 'both') {
                    await this.sendWhatsAppNotification(reminder);
                }

                if (reminder.notificationMethod === 'voice' || reminder.notificationMethod === 'both') {
                    await this.sendVoiceNotification(reminder);
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
            message += '\n\nReply "done" to mark as complete or "delay" to reschedule.';

            // Send the notification
            await whatsappService.sendMessage(user.phoneNumber, message);
            console.log(`Sent WhatsApp notification to ${user.phoneNumber}`);
        } catch (error) {
            console.error('Error sending WhatsApp notification:', error);
        }
    }

    /**
     * Send voice notification for reminder
     * @param {Object} reminder - The reminder to send notification for
     */
    async sendVoiceNotification(reminder) {
        try {
            const user = reminder.user;

            // Build SSML script for voice message
            let ssmlScript = `<speak>
                <prosody rate="medium">
                    This is a reminder: ${reminder.content}
                </prosody>`;

            // Add recurrence info if applicable
            if (reminder.recurrence !== 'none') {
                const recurrenceParserService = require('./recurrenceParserService');
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
                        const formattedNextDate = format(nextDate, 'EEEE, MMMM do, yyyy');
                        ssmlScript += `
                        <break time="500ms"/>
                        <prosody rate="medium">
                            Your next reminder is scheduled for ${formattedNextDate}
                        </prosody>`;
                    }
                }
            }

            ssmlScript += `</speak>`;

            // TODO: Implement voice call notification using Twilio and ElevenLabs
            // This is a placeholder for the actual implementation
            console.log(`Would send voice notification to ${user.phoneNumber} with SSML:`, ssmlScript);
        } catch (error) {
            console.error('Error sending voice notification:', error);
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