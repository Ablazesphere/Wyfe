// controllers/reminderController.js - Handle reminder routes
import { logger } from '../utils/logger.js';
import {
    getAllReminders,
    getReminder,
    createReminder,
    updateReminderStatus,
    removeReminder
} from '../models/reminderModel.js';
import {
    getPendingConfirmation,
    confirmAction,
    cancelConfirmation
} from '../utils/confirmationHandler.js';
import { parseTimeAndDate } from '../utils/dateUtils.js';

/**
 * Setup reminder-related routes
 * @param {Object} fastify Fastify instance
 */
export function setupReminderRoutes(fastify) {
    // Get all reminders
    fastify.get('/reminders', async (request, reply) => {
        logger.info('Reminders list requested');

        const phoneNumber = request.query.phoneNumber;
        const reminders = getAllReminders(phoneNumber);

        // Convert to JSON-friendly format
        const jsonReminders = reminders.map(r => r.toJSON());

        return {
            reminders: jsonReminders,
            count: jsonReminders.length,
            phoneFilter: phoneNumber || 'none'
        };
    });

    // Get a specific reminder by ID
    fastify.get('/reminders/:id', async (request, reply) => {
        const { id } = request.params;
        logger.info(`Reminder ${id} requested`);

        const reminder = getReminder(id);

        if (!reminder) {
            reply.code(404);
            return { error: 'Reminder not found' };
        }

        return { reminder: reminder.toJSON() };
    });

    // Create a new reminder manually
    fastify.post('/reminders', async (request, reply) => {
        logger.info('Create reminder requested');

        const { task, time, date, phoneNumber } = request.body;

        if (!task || !time || !date || !phoneNumber) {
            reply.code(400);
            return { error: 'Missing required fields' };
        }

        // Parse the time and date
        const triggerTime = parseTimeAndDate(time, date);

        if (!triggerTime) {
            reply.code(400);
            return { error: 'Invalid time or date format' };
        }

        const reminder = createReminder(task, triggerTime, phoneNumber);

        return {
            success: true,
            message: 'Reminder created successfully',
            reminder: reminder.toJSON()
        };
    });

    // Cancel a reminder
    fastify.delete('/reminders/:id', async (request, reply) => {
        const { id } = request.params;
        logger.info(`Delete reminder ${id} requested`);

        const reminder = getReminder(id);

        if (!reminder) {
            reply.code(404);
            return { error: 'Reminder not found' };
        }

        // Update status and remove
        updateReminderStatus(id, 'cancelled');
        const removed = removeReminder(id);

        if (removed) {
            return {
                success: true,
                message: 'Reminder cancelled successfully'
            };
        } else {
            reply.code(500);
            return { error: 'Failed to cancel reminder' };
        }
    });

    // Get pending confirmation for a user
    fastify.get('/confirmations/:userId', async (request, reply) => {
        const { userId } = request.params;
        logger.info(`Confirmation check for ${userId}`);

        const confirmation = getPendingConfirmation(userId);

        if (!confirmation) {
            return {
                hasPending: false
            };
        }

        return {
            hasPending: true,
            action: confirmation.action,
            data: confirmation.data,
            timestamp: confirmation.timestamp
        };
    });

    // Confirm a pending action
    fastify.post('/confirmations/:userId/confirm', async (request, reply) => {
        const { userId } = request.params;
        logger.info(`Confirmation request for ${userId}`);

        const result = confirmAction(userId);

        if (!result) {
            reply.code(404);
            return { error: 'No pending confirmation found' };
        }

        return {
            success: true,
            confirmed: result.confirmed,
            action: result.action,
            data: result.data
        };
    });

    // Cancel a pending confirmation
    fastify.post('/confirmations/:userId/cancel', async (request, reply) => {
        const { userId } = request.params;
        logger.info(`Confirmation cancellation for ${userId}`);

        const cancelled = cancelConfirmation(userId);

        if (!cancelled) {
            reply.code(404);
            return { error: 'No pending confirmation found' };
        }

        return {
            success: true,
            message: 'Confirmation cancelled'
        };
    });
}