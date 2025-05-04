// utils/confirmationHandler.js - Manages confirmation flows for critical actions
import { logger } from './logger.js';

// Store pending confirmations with timeout handling
const pendingConfirmations = new Map();

// Confirmation timeout (5 minutes)
const CONFIRMATION_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Types of actions that require confirmation
 */
export const CONFIRMATION_TYPES = {
    CANCEL_ALL: 'cancel_all_reminders',
    DELETE_REMINDER: 'delete_reminder',
    RESCHEDULE_IMPORTANT: 'reschedule_important',
    UPDATE_CRITICAL: 'update_critical'
};

/**
 * Request confirmation for an action
 * @param {string} userId User identifier (usually phone number)
 * @param {string} actionType Type of action from CONFIRMATION_TYPES
 * @param {Object} actionData Data needed to complete the action
 * @returns {string} Confirmation ID
 */
export function requestConfirmation(userId, actionType, actionData) {
    // Generate a unique confirmation ID
    const confirmationId = `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;

    // Create the confirmation record
    const confirmation = {
        userId,
        actionType,
        actionData,
        timestamp: Date.now(),
        timeoutId: setTimeout(() => {
            // Auto-expire confirmations after the timeout
            expireConfirmation(confirmationId);
        }, CONFIRMATION_TIMEOUT_MS)
    };

    // Store the confirmation
    pendingConfirmations.set(confirmationId, confirmation);

    logger.info(`Confirmation requested: ${actionType} for user ${userId}, ID: ${confirmationId}`);

    return confirmationId;
}

/**
 * Expire a confirmation request
 * @param {string} confirmationId Confirmation ID
 */
function expireConfirmation(confirmationId) {
    const confirmation = pendingConfirmations.get(confirmationId);

    if (confirmation) {
        clearTimeout(confirmation.timeoutId);
        pendingConfirmations.delete(confirmationId);

        logger.info(`Confirmation expired: ${confirmationId}`);
    }
}

/**
 * Process a user's confirmation response
 * @param {string} userId User identifier
 * @param {string} userResponse User's response text
 * @returns {Object|null} Action to perform or null if no confirmation matched
 */
export function processConfirmationResponse(userId, userResponse) {
    // No pending confirmations for this user
    const userConfirmations = Array.from(pendingConfirmations.entries())
        .filter(([_, conf]) => conf.userId === userId);

    if (userConfirmations.length === 0) {
        return null;
    }

    // Check if response is confirmatory
    const isConfirmed = isConfirmationResponse(userResponse);

    // If not confirmed, clear all pending confirmations
    if (!isConfirmed) {
        // Clear all of this user's confirmations
        userConfirmations.forEach(([confirmationId, _]) => {
            expireConfirmation(confirmationId);
        });

        logger.info(`User ${userId} declined all confirmation requests`);
        return { confirmed: false, canceled: true };
    }

    // Get the most recent confirmation
    const [mostRecentId, mostRecent] = userConfirmations.reduce(
        (latest, current) => {
            return latest[1].timestamp > current[1].timestamp ? latest : current;
        }
    );

    // Clear the timeout and remove from pending
    clearTimeout(mostRecent.timeoutId);
    pendingConfirmations.delete(mostRecentId);

    logger.info(`User ${userId} confirmed action: ${mostRecent.actionType}`);

    // Return the confirmed action
    return {
        confirmed: true,
        actionType: mostRecent.actionType,
        actionData: mostRecent.actionData
    };
}

/**
 * Check if a user response should be considered a confirmation
 * @param {string} response User response text
 * @returns {boolean} True if the response is a confirmation
 */
function isConfirmationResponse(response) {
    if (!response) return false;

    const normalizedResponse = response.toLowerCase().trim();

    // Common confirmation phrases
    const confirmationPhrases = [
        'yes', 'yeah', 'yep', 'sure', 'ok', 'okay', 'confirm',
        'do it', 'please do', 'go ahead', 'proceed', 'approved',
        'i confirm', 'let\'s do it', 'sounds good', 'correct',
        'that\'s right', 'right', 'exactly', 'definitely', 'absolutely'
    ];

    return confirmationPhrases.some(phrase =>
        normalizedResponse === phrase ||
        normalizedResponse.startsWith(phrase + ' ') ||
        normalizedResponse.includes(' ' + phrase + ' ') ||
        normalizedResponse.endsWith(' ' + phrase)
    );
}

/**
 * Get confirmation message for a specific action type
 * @param {string} actionType Type of action from CONFIRMATION_TYPES
 * @param {Object} actionData Data about the action
 * @returns {string} Confirmation request message
 */
export function getConfirmationMessage(actionType, actionData) {
    switch (actionType) {
        case CONFIRMATION_TYPES.CANCEL_ALL:
            return `Are you sure you want to cancel all your reminders? Please confirm with 'yes' or cancel with 'no'.`;

        case CONFIRMATION_TYPES.DELETE_REMINDER:
            const task = actionData.task || 'this reminder';
            return `Are you sure you want to delete the reminder for "${task}"? Please confirm with 'yes' or cancel with 'no'.`;

        case CONFIRMATION_TYPES.RESCHEDULE_IMPORTANT:
            const oldTime = actionData.oldTime || 'the original time';
            const newTime = actionData.newTime || 'a new time';
            return `This appears to be an important reminder. Are you sure you want to reschedule it from ${oldTime} to ${newTime}? Please confirm with 'yes' or cancel with 'no'.`;

        case CONFIRMATION_TYPES.UPDATE_CRITICAL:
            return `This seems to be a critical reminder. Are you sure you want to change it? Please confirm with 'yes' or cancel with 'no'.`;

        default:
            return `Please confirm this action by saying 'yes' or cancel with 'no'.`;
    }
}

/**
 * Check if a reminder action requires confirmation
 * @param {string} actionType The action being performed (create, update, delete, etc.)
 * @param {Object} reminderData The reminder data
 * @returns {Object|null} Confirmation type and message if needed, null otherwise
 */
export function checkIfConfirmationNeeded(actionType, reminderData) {
    // Check for critical keywords in the task
    const criticalKeywords = [
        'medicine', 'medication', 'doctor', 'hospital', 'emergency',
        'health', 'medical', 'appointment', 'critical', 'urgent',
        'important', 'essential', 'crucial', 'vital', 'meeting',
        'interview', 'exam', 'test', 'deadline', 'submission'
    ];

    const taskLower = reminderData.task?.toLowerCase() || '';
    const hasCriticalKeyword = criticalKeywords.some(keyword =>
        taskLower.includes(keyword)
    );

    // Specific confirmation logic by action type
    switch (actionType) {
        case 'cancel':
            // Require confirmation for critical reminders
            if (hasCriticalKeyword) {
                return {
                    type: CONFIRMATION_TYPES.DELETE_REMINDER,
                    actionData: reminderData
                };
            }
            break;

        case 'reschedule':
            // Require confirmation for critical reminders being rescheduled
            if (hasCriticalKeyword) {
                return {
                    type: CONFIRMATION_TYPES.RESCHEDULE_IMPORTANT,
                    actionData: reminderData
                };
            }
            break;

        case 'update':
            // Require confirmation for critical reminders being updated
            if (hasCriticalKeyword) {
                return {
                    type: CONFIRMATION_TYPES.UPDATE_CRITICAL,
                    actionData: reminderData
                };
            }
            break;

        // Add more cases as needed
    }

    // No confirmation needed
    return null;
}

/**
 * Clear all pending confirmations for a user
 * @param {string} userId User identifier
 */
export function clearUserConfirmations(userId) {
    const userConfirmations = Array.from(pendingConfirmations.entries())
        .filter(([_, conf]) => conf.userId === userId);

    userConfirmations.forEach(([confirmationId, conf]) => {
        clearTimeout(conf.timeoutId);
        pendingConfirmations.delete(confirmationId);
    });

    if (userConfirmations.length > 0) {
        logger.info(`Cleared ${userConfirmations.length} pending confirmations for user ${userId}`);
    }
}