// controllers/reminderController.js - Handle reminder routes
import { logger } from '../utils/logger.js';
import { getAllReminders, getReminder } from '../models/reminderModel.js';

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

    // Additional reminder routes could be added here:
    // - POST /reminders - Create a new reminder manually
    // - DELETE /reminders/:id - Cancel a reminder
    // - PUT /reminders/:id - Update a reminder
}