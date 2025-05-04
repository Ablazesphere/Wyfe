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
    scheduleReminder,
    rescheduleReminder,
    cancelReminder,
    updateReminderTask,
    REMINDER_COMMANDS
} from '../services/reminderService.js';
import {
    formatFriendlyTime,
    formatFriendlyDate,
    formatFriendlyDateTime
} from '../utils/dateUtils.js';
import {
    checkIfConfirmationNeeded,
    getConfirmationMessage,
    requestConfirmation,
    processConfirmationResponse
} from '../utils/confirmationHandler.js';

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

        // Convert to JSON-friendly format and add human-readable times
        const jsonReminders = reminders.map(r => {
            const reminder = r.toJSON();
            reminder.friendlyTime = formatFriendlyTime(new Date(reminder.triggerTime));
            reminder.friendlyDate = formatFriendlyDate(new Date(reminder.triggerTime));
            reminder.friendlyDateTime = formatFriendlyDateTime(new Date(reminder.triggerTime));
            return reminder;
        });

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

        const jsonReminder = reminder.toJSON();
        jsonReminder.friendlyTime = formatFriendlyTime(new Date(jsonReminder.triggerTime));
        jsonReminder.friendlyDate = formatFriendlyDate(new Date(jsonReminder.triggerTime));
        jsonReminder.friendlyDateTime = formatFriendlyDateTime(new Date(jsonReminder.triggerTime));

        return { reminder: jsonReminder };
    });

    // Create a new reminder manually
    fastify.post('/reminders', async (request, reply) => {
        logger.info('Create reminder requested');

        const { task, time, date, phoneNumber } = request.body;

        // Validate required fields
        if (!task || !time) {
            reply.code(400);
            return { error: 'Missing required fields: task and time are required' };
        }

        try {
            // Schedule the reminder
            const reminder = scheduleReminder(task, time, date, phoneNumber);

            logger.info(`Reminder created: ${reminder.getDescription()}`);
            return {
                message: 'Reminder created successfully',
                reminder: reminder.toJSON()
            };
        } catch (error) {
            logger.error('Error creating reminder:', error);
            reply.code(500);
            return { error: 'Failed to create reminder', details: error.message };
        }
    });

    // Update a reminder
    fastify.put('/reminders/:id', async (request, reply) => {
        const { id } = request.params;
        const { task, time, date, status, phoneNumber } = request.body;

        logger.info(`Update reminder ${id} requested`);

        // Check if reminder exists
        const reminder = getReminder(id);
        if (!reminder) {
            reply.code(404);
            return { error: 'Reminder not found' };
        }

        try {
            let updated = false;
            let message = 'No changes made to the reminder';

            // Update task if provided
            if (task) {
                updateReminderTask(id, task);
                updated = true;
                message = 'Reminder task updated';
            }

            // Update time/date if provided
            if (time || date) {
                const rescheduled = rescheduleReminder(
                    id,
                    time || formatFriendlyTime(new Date(reminder.triggerTime)),
                    date
                );

                if (rescheduled) {
                    updated = true;
                    message = time && date
                        ? 'Reminder rescheduled'
                        : (time ? 'Reminder time updated' : 'Reminder date updated');
                }
            }

            // Update status if provided
            if (status) {
                updateReminderStatus(id, status);
                updated = true;
                message = `Reminder status changed to ${status}`;

                // Remove cancelled reminders
                if (status === 'cancelled') {
                    removeReminder(id);
                    message = 'Reminder cancelled and removed';
                }
            }

            // Get the updated reminder (might be null if it was removed)
            const updatedReminder = getReminder(id);

            return {
                message,
                updated,
                reminder: updatedReminder ? updatedReminder.toJSON() : null
            };
        } catch (error) {
            logger.error(`Error updating reminder ${id}:`, error);
            reply.code(500);
            return { error: 'Failed to update reminder', details: error.message };
        }
    });

    // Delete a reminder
    fastify.delete('/reminders/:id', async (request, reply) => {
        const { id } = request.params;
        logger.info(`Delete reminder ${id} requested`);

        // Check if reminder exists
        const reminder = getReminder(id);
        if (!reminder) {
            reply.code(404);
            return { error: 'Reminder not found' };
        }

        try {
            // Cancel the reminder
            const success = cancelReminder(id);

            if (success) {
                return {
                    message: 'Reminder deleted successfully',
                    id
                };
            } else {
                reply.code(500);
                return { error: 'Failed to delete reminder' };
            }
        } catch (error) {
            logger.error(`Error deleting reminder ${id}:`, error);
            reply.code(500);
            return { error: 'Failed to delete reminder', details: error.message };
        }
    });

    // Process confirmation responses
    fastify.post('/reminders/confirm', async (request, reply) => {
        logger.info('Confirmation processing requested');

        const { userId, response } = request.body;

        if (!userId || !response) {
            reply.code(400);
            return { error: 'Missing required fields: userId and response are required' };
        }

        try {
            // Process the confirmation response
            const result = processConfirmationResponse(userId, response);

            if (!result) {
                return {
                    message: 'No pending confirmation found',
                    confirmed: false
                };
            }

            if (!result.confirmed) {
                return {
                    message: 'Action cancelled by user',
                    confirmed: false
                };
            }

            // Handle the confirmed action
            let actionResult = null;

            switch (result.actionType) {
                case 'delete_reminder':
                    actionResult = cancelReminder(result.actionData.id);
                    break;

                case 'reschedule_important':
                    actionResult = rescheduleReminder(
                        result.actionData.id,
                        result.actionData.time,
                        result.actionData.date
                    );
                    break;

                case 'update_critical':
                    actionResult = updateReminderTask(
                        result.actionData.id,
                        result.actionData.task
                    );
                    break;

                case 'cancel_all_reminders':
                    // Get all reminders for this user
                    const userReminders = getAllReminders(result.actionData.phoneNumber);

                    // Cancel each one
                    userReminders.forEach(reminder => {
                        cancelReminder(reminder.id);
                    });

                    actionResult = { count: userReminders.length };
                    break;

                default:
                    logger.warn(`Unknown confirmation action type: ${result.actionType}`);
            }

            return {
                message: 'Action confirmed and processed',
                confirmed: true,
                actionType: result.actionType,
                result: actionResult
            };

        } catch (error) {
            logger.error('Error processing confirmation:', error);
            reply.code(500);
            return { error: 'Failed to process confirmation', details: error.message };
        }
    });

    // Batch operations (used for critical operations like cancelling all reminders)
    fastify.post('/reminders/batch', async (request, reply) => {
        logger.info('Batch reminder operation requested');

        const { operation, phoneNumber } = request.body;

        if (!operation || !phoneNumber) {
            reply.code(400);
            return { error: 'Missing required fields: operation and phoneNumber are required' };
        }

        try {
            // Handle different batch operations
            switch (operation) {
                case 'cancel_all':
                    // This is a critical operation, so we'll require confirmation
                    const confirmationId = requestConfirmation(
                        phoneNumber,
                        'cancel_all_reminders',
                        { phoneNumber }
                    );

                    return {
                        message: 'Confirmation required to cancel all reminders',
                        confirmationId,
                        confirmationMessage: getConfirmationMessage('cancel_all_reminders', { phoneNumber })
                    };

                case 'list_pending':
                    // Get all pending reminders for this user
                    const pendingReminders = getAllReminders(phoneNumber)
                        .filter(reminder => reminder.status === 'pending');

                    // Convert to JSON-friendly format with human-readable times
                    const jsonReminders = pendingReminders.map(r => {
                        const reminder = r.toJSON();
                        reminder.friendlyTime = formatFriendlyTime(new Date(reminder.triggerTime));
                        reminder.friendlyDate = formatFriendlyDate(new Date(reminder.triggerTime));
                        reminder.friendlyDateTime = formatFriendlyDateTime(new Date(reminder.triggerTime));
                        return reminder;
                    });

                    return {
                        message: `Found ${jsonReminders.length} pending reminders`,
                        reminders: jsonReminders,
                        count: jsonReminders.length
                    };

                default:
                    reply.code(400);
                    return { error: `Unknown batch operation: ${operation}` };
            }
        } catch (error) {
            logger.error('Error processing batch operation:', error);
            reply.code(500);
            return { error: 'Failed to process batch operation', details: error.message };
        }
    });
}