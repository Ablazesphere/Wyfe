// services/schedulerService.js - Service for scheduling and processing reminders

import cron from 'node-cron';
import { logger } from '../utils/logger.js';
import { getDueReminders, updateReminderStatus } from './reminderService.js';
import { initiateOutboundCall } from './twilioOutboundService.js';

// Store active jobs
const activeJobs = new Map();

/**
 * Initialize the scheduler
 */
export function initializeScheduler() {
    // Schedule job to check for due reminders every minute
    const schedulerJob = cron.schedule('* * * * *', async () => {
        try {
            await processReminders();
        } catch (error) {
            logger.error('Error processing reminders:', error);
        }
    });

    activeJobs.set('reminderProcessor', schedulerJob);

    logger.info('Reminder scheduler initialized');
}

/**
 * Process due reminders and trigger notifications
 */
async function processReminders() {
    try {
        // Get reminders that are due now
        const dueReminders = await getDueReminders();

        if (dueReminders.length === 0) {
            return;
        }

        logger.info(`Processing ${dueReminders.length} due reminders`);

        // Process each reminder
        for (const reminder of dueReminders) {
            try {
                // Update status to 'processing'
                await updateReminderStatus(reminder._id, 'processing');

                // Initiate outbound call
                await initiateOutboundCall(reminder);

                // Update status to 'sent'
                await updateReminderStatus(reminder._id, 'sent', {
                    callInitiatedAt: new Date()
                });

                logger.info(`Reminder notification sent for reminder ${reminder._id}`);
            } catch (error) {
                logger.error(`Error processing reminder ${reminder._id}:`, error);

                // Update status to 'failed'
                await updateReminderStatus(reminder._id, 'failed', {
                    error: error.message
                });
            }
        }
    } catch (error) {
        logger.error('Error in processReminders:', error);
    }
}

/**
 * Schedule a specific reminder (for immediate testing or manual scheduling)
 * @param {string} reminderId The reminder ID to process
 * @returns {Promise<boolean>} Success status
 */
export async function scheduleReminderNow(reminderId) {
    try {
        // Get the reminder
        const reminder = await updateReminderStatus(reminderId, 'processing');

        if (!reminder) {
            logger.warn(`Reminder ${reminderId} not found for scheduling`);
            return false;
        }

        // Initiate outbound call
        await initiateOutboundCall(reminder);

        // Update status to 'sent'
        await updateReminderStatus(reminderId, 'sent', {
            callInitiatedAt: new Date()
        });

        logger.info(`Reminder ${reminderId} manually scheduled and sent`);
        return true;
    } catch (error) {
        logger.error(`Error scheduling reminder ${reminderId}:`, error);

        // Update status to 'failed'
        await updateReminderStatus(reminderId, 'failed', {
            error: error.message
        });

        return false;
    }
}

/**
 * Gracefully shut down the scheduler
 */
export function shutdownScheduler() {
    // Stop all scheduled jobs
    for (const [jobName, job] of activeJobs.entries()) {
        job.stop();
        logger.info(`Stopped scheduled job: ${jobName}`);
    }

    activeJobs.clear();
    logger.info('Scheduler shutdown complete');
}