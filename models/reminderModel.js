// models/reminderModel.js - Enhanced reminder data structure with improved search
import { formatFriendlyTime, formatFriendlyDate } from '../utils/dateUtils.js';
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
        this.status = 'pending'; // pending, completed, cancelled, rescheduled

        // Generate normalized search terms for better matching
        this.searchTerms = this.generateSearchTerms();
    }

    /**
     * Generate search terms based on task content
     * @returns {Array} Array of search terms
     */
    generateSearchTerms() {
        if (!this.task) return [];

        // Normalize and split the task into words
        const normalizedTask = this.task.toLowerCase()
            .replace(/[^\w\s]/g, '') // Remove punctuation
            .replace(/\s+/g, ' '); // Normalize whitespace

        // Generate individual words and combinations
        const words = normalizedTask.split(' ');

        // Add individual words, filtering out common stop words
        const stopWords = ['a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'with', 'about'];
        const filteredWords = words.filter(word => word.length > 1 && !stopWords.includes(word));

        return filteredWords;
    }

    /**
     * Get a human-readable representation of the reminder
     * @returns {string} Description of the reminder
     */
    getDescription() {
        return `Reminder: "${this.task}" at ${formatFriendlyTime(this.triggerTime)} on ${formatFriendlyDate(this.triggerTime)} for ${this.phoneNumber}`;
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
            friendlyTime: formatFriendlyTime(this.triggerTime),
            friendlyDate: formatFriendlyDate(this.triggerTime)
        };
    }

    /**
     * Check if this reminder matches a text query
     * @param {string} query The search query
     * @returns {boolean} True if the reminder matches the query
     */
    matchesQuery(query) {
        if (!query) return false;

        // Normalize the query
        const normalizedQuery = query.toLowerCase()
            .replace(/[^\w\s]/g, '')
            .replace(/\s+/g, ' ')
            .trim();

        // Split into words
        const queryWords = normalizedQuery.split(' ');

        // Simple match: check if query is contained in task
        if (this.task.toLowerCase().includes(normalizedQuery)) {
            return true;
        }

        // Check if significant query words match our search terms
        const significantQueryWords = queryWords.filter(word => word.length > 2);
        if (significantQueryWords.length === 0) {
            // If no significant words, try simple matching with the full query
            return this.task.toLowerCase().includes(normalizedQuery);
        }

        // Check how many of the significant query words match our search terms
        const matchCount = significantQueryWords.filter(word =>
            this.searchTerms.some(term => term.includes(word) || word.includes(term))
        ).length;

        // Require at least half of significant words to match, or at least 2 matches
        return matchCount >= Math.max(2, Math.ceil(significantQueryWords.length / 2));
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
 * Find reminders matching a task description
 * @param {string} taskQuery Task description or partial match
 * @param {string} phoneNumber Optional phone number to filter by
 * @returns {Array<Reminder>} List of matching reminders
 */
export function findRemindersByTask(taskQuery, phoneNumber) {
    if (!taskQuery) return [];

    let matches = reminders.filter(r => {
        // Only include pending reminders
        if (r.status !== 'pending') return false;

        // Filter by phone number if provided
        if (phoneNumber && r.phoneNumber !== phoneNumber) return false;

        // Check if the reminder matches the query
        return r.matchesQuery(taskQuery);
    });

    // Sort matches by relevance (simple implementation)
    matches.sort((a, b) => {
        // Exact matches first
        const aExact = a.task.toLowerCase() === taskQuery.toLowerCase();
        const bExact = b.task.toLowerCase() === taskQuery.toLowerCase();

        if (aExact && !bExact) return -1;
        if (!aExact && bExact) return 1;

        // Then by how early the query appears in the task
        const aIndex = a.task.toLowerCase().indexOf(taskQuery.toLowerCase());
        const bIndex = b.task.toLowerCase().indexOf(taskQuery.toLowerCase());

        if (aIndex >= 0 && bIndex >= 0) {
            return aIndex - bIndex;
        }

        // Then by time (sooner first)
        return a.triggerTime - b.triggerTime;
    });

    return matches;
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
 * Get all pending reminders, optionally filtered by phone number
 * @param {string} phoneNumber Optional phone number to filter by
 * @returns {Array<Reminder>} List of pending reminders
 */
export function getPendingReminders(phoneNumber) {
    let result = reminders.filter(r => r.status === 'pending');

    if (phoneNumber) {
        result = result.filter(r => r.phoneNumber === phoneNumber);
    }

    // Sort by trigger time (sooner first)
    result.sort((a, b) => a.triggerTime - b.triggerTime);

    return result;
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

/**
 * Get stats about reminders for a user
 * @param {string} phoneNumber User's phone number 
 * @returns {Object} Stats about the user's reminders
 */
export function getReminderStats(phoneNumber) {
    if (!phoneNumber) return null;

    const userReminders = getAllReminders(phoneNumber);

    // Count reminders by status
    const pending = userReminders.filter(r => r.status === 'pending').length;
    const completed = userReminders.filter(r => r.status === 'completed').length;
    const cancelled = userReminders.filter(r => r.status === 'cancelled').length;
    const rescheduled = userReminders.filter(r => r.status === 'rescheduled').length;
    const total = userReminders.length;

    // Find upcoming reminders
    const now = new Date();
    const upcoming = userReminders.filter(r =>
        r.status === 'pending' && r.triggerTime > now
    ).sort((a, b) => a.triggerTime - b.triggerTime);

    // Get next reminder if any
    const nextReminder = upcoming.length > 0 ? upcoming[0].toJSON() : null;

    return {
        counts: {
            pending,
            completed,
            cancelled,
            rescheduled,
            total
        },
        nextReminder,
        upcomingCount: upcoming.length
    };
}