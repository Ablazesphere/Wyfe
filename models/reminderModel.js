// models/reminderModel.js - Reminder data structure
import { formatFriendlyTime } from '../utils/dateUtils.js';
import { logger } from '../utils/logger.js';

// In-memory storage for reminders
// In a production environment, use a database
const reminders = [];

export class Reminder {
    /**
     * Create a new reminder
     * @param {string} task The task description
     * @param {Date} triggerTime When the reminder should trigger
     * @param {string} phoneNumber User's phone number
     */
    constructor(task, triggerTime, phoneNumber) {
        this.id = Date.now().toString();
        this.task = task;
        this.triggerTime = triggerTime;
        this.phoneNumber = phoneNumber || 'unknown';
        this.created = new Date();
        this.status = 'pending'; // pending, completed, cancelled
    }

    /**
     * Get a human-readable representation of the reminder
     * @returns {string} Description of the reminder
     */
    getDescription() {
        return `Reminder: "${this.task}" at ${formatFriendlyTime(this.triggerTime)} for ${this.phoneNumber}`;
    }

    /**
     * Convert to JSON-friendly object
     * @returns {Object} JSON representation
     */
    toJSON() {
        return {
            id: this.id,
            task: this.task,
            triggerTime: this.triggerTime.toISOString(),
            phoneNumber: this.phoneNumber,
            created: this.created.toISOString(),
            status: this.status,
            friendlyTime: formatFriendlyTime(this.triggerTime)
        };
    }
}

/**
 * Create and store a new reminder
 * @param {string} task The task description
 * @param {Date} triggerTime When the reminder should trigger
 * @param {string} phoneNumber User's phone number
 * @returns {Reminder} The created reminder
 */
export function createReminder(task, triggerTime, phoneNumber) {
    // Validate trigger time is in the future
    const now = new Date();
    if (triggerTime < now) {
        logger.warn(`Reminder time ${triggerTime} is in the past, adjusting...`);
        // Set to 5 minutes from now
        triggerTime = new Date(now.getTime() + 5 * 60000);
    }

    const reminder = new Reminder(task, triggerTime, phoneNumber);
    reminders.push(reminder);

    logger.info(`Created: ${reminder.getDescription()}`);
    return reminder;
}

/**
 * Get a reminder by ID
 * @param {string} id Reminder ID
 * @returns {Reminder|null} The reminder or null if not found
 */
export function getReminder(id) {
    return reminders.find(r => r.id === id) || null;
}

/**
 * Get all reminders, optionally filtered by phone number
 * @param {string} phoneNumber Optional phone number to filter by
 * @returns {Array<Reminder>} List of reminders
 */
export function getAllReminders(phoneNumber) {
    if (phoneNumber) {
        return reminders.filter(r => r.phoneNumber === phoneNumber);
    }
    return [...reminders];
}

/**
 * Update a reminder's status
 * @param {string} id Reminder ID
 * @param {string} status New status
 * @returns {boolean} Success or failure
 */
export function updateReminderStatus(id, status) {
    const reminder = getReminder(id);
    if (!reminder) return false;

    reminder.status = status;
    return true;
}

/**
 * Remove a reminder from storage
 * @param {string} id Reminder ID
 * @returns {boolean} Success or failure
 */
export function removeReminder(id) {
    const index = reminders.findIndex(r => r.id === id);
    if (index === -1) return false;

    reminders.splice(index, 1);
    return true;
}