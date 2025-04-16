// utils/confirmationHandler.js - Manage confirmation flows for critical actions
import { logger } from './logger.js';

// Store pending confirmations in memory
// Format: { userId: { action: 'cancel', data: {}, timestamp: Date, confirmed: false } }
const pendingConfirmations = new Map();

// Time limit for confirmations (5 minutes)
const CONFIRMATION_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Create a new confirmation request
 * @param {string} userId Unique user identifier (typically phone number)
 * @param {string} action Action type (cancel, reschedule)
 * @param {Object} data Data related to the action
 * @returns {Object} Confirmation request details
 */
export function createConfirmation(userId, action, data) {
    const confirmationRequest = {
        action,
        data,
        timestamp: new Date(),
        confirmed: false
    };

    pendingConfirmations.set(userId, confirmationRequest);
    logger.info(`Created confirmation request for ${userId}, action: ${action}`);

    // Schedule cleanup of this confirmation if not confirmed
    setTimeout(() => {
        cleanupExpiredConfirmation(userId);
    }, CONFIRMATION_TIMEOUT_MS);

    return confirmationRequest;
}

/**
 * Check if a user has a pending confirmation
 * @param {string} userId Unique user identifier
 * @returns {Object|null} Pending confirmation or null
 */
export function getPendingConfirmation(userId) {
    if (!pendingConfirmations.has(userId)) {
        return null;
    }

    const confirmation = pendingConfirmations.get(userId);

    // Check if confirmation has expired
    const now = new Date();
    if (now - confirmation.timestamp > CONFIRMATION_TIMEOUT_MS) {
        pendingConfirmations.delete(userId);
        return null;
    }

    return confirmation;
}

/**
 * Confirm a pending action for a user
 * @param {string} userId Unique user identifier
 * @returns {Object|null} Confirmed action data or null
 */
export function confirmAction(userId) {
    const pendingConfirmation = getPendingConfirmation(userId);

    if (!pendingConfirmation) {
        logger.info(`No pending confirmation found for ${userId}`);
        return null;
    }

    // Mark as confirmed
    pendingConfirmation.confirmed = true;
    logger.info(`Confirmed action for ${userId}: ${pendingConfirmation.action}`);

    // Remove from pending map
    pendingConfirmations.delete(userId);

    return {
        action: pendingConfirmation.action,
        data: pendingConfirmation.data,
        confirmed: true
    };
}

/**
 * Cancel a pending confirmation
 * @param {string} userId Unique user identifier
 * @returns {boolean} Success or failure
 */
export function cancelConfirmation(userId) {
    if (!pendingConfirmations.has(userId)) {
        return false;
    }

    pendingConfirmations.delete(userId);
    logger.info(`Cancelled confirmation for ${userId}`);
    return true;
}

/**
 * Clean up expired confirmations
 * @param {string} userId Unique user identifier
 */
function cleanupExpiredConfirmation(userId) {
    if (!pendingConfirmations.has(userId)) {
        return;
    }

    const confirmation = pendingConfirmations.get(userId);
    const now = new Date();

    if (now - confirmation.timestamp > CONFIRMATION_TIMEOUT_MS && !confirmation.confirmed) {
        pendingConfirmations.delete(userId);
        logger.info(`Expired confirmation for ${userId} was removed`);
    }
}

/**
 * Process user response for confirmation flow
 * @param {string} userId Unique user identifier 
 * @param {string} transcript User's response transcript
 * @returns {Object|null} Result of confirmation processing
 */
export function processConfirmationResponse(userId, transcript) {
    const pendingConfirmation = getPendingConfirmation(userId);

    if (!pendingConfirmation) {
        return null;
    }

    // Analyze the transcript for confirmation or rejection
    const affirmativeResponses = [
        'yes', 'yeah', 'yep', 'correct', 'right', 'sure', 'okay', 'ok', 'confirm',
        'confirmed', 'do it', 'please do', 'go ahead', 'absolutely', 'definitely'
    ];

    const negativeResponses = [
        'no', 'nope', 'don\'t', 'do not', 'cancel', 'abort', 'stop', 'never mind',
        'nevermind', 'wrong', 'incorrect', 'negative', 'don\'t do that'
    ];

    const normalizedTranscript = transcript.toLowerCase();

    // Check for confirmation
    const isConfirmed = affirmativeResponses.some(phrase =>
        normalizedTranscript.includes(phrase)
    );

    // Check for rejection
    const isRejected = negativeResponses.some(phrase =>
        normalizedTranscript.includes(phrase)
    );

    if (isConfirmed) {
        return confirmAction(userId);
    } else if (isRejected) {
        cancelConfirmation(userId);
        return { confirmed: false, action: 'rejected' };
    }

    // If we can't determine user intent, return the pending confirmation
    // so the system knows a confirmation is still needed
    return {
        action: pendingConfirmation.action,
        data: pendingConfirmation.data,
        confirmed: false,
        needsMoreClarification: true
    };
}