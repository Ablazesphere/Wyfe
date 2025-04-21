// utils/confirmationHandler.js - Enhanced confirmation flows for critical actions
import { logger } from './logger.js';

// Store pending confirmations in memory
// Format: { userId: { action: 'cancel', data: {}, timestamp: Date, confirmed: false, contextHistory: [] } }
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
        confirmed: false,
        contextHistory: [], // Store conversation context for disambiguation
        attempts: 0, // Track how many confirmation attempts have been made
        disambiguationOptions: null // For storing multiple options when needed
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
 * Add disambiguation options to a pending confirmation
 * @param {string} userId Unique user identifier
 * @param {Array} options Array of options to choose from
 * @returns {boolean} Success or failure
 */
export function addDisambiguationOptions(userId, options) {
    const pendingConfirmation = getPendingConfirmation(userId);

    if (!pendingConfirmation) {
        logger.info(`No pending confirmation found for ${userId}`);
        return false;
    }

    pendingConfirmation.disambiguationOptions = options;
    pendingConfirmation.awaitingDisambiguation = true;

    logger.info(`Added ${options.length} disambiguation options for ${userId}`);
    return true;
}

/**
 * Update a pending confirmation with selected option
 * @param {string} userId Unique user identifier
 * @param {Object} selectedOption The selected option
 * @returns {boolean} Success or failure
 */
export function updateWithSelectedOption(userId, selectedOption) {
    const pendingConfirmation = getPendingConfirmation(userId);

    if (!pendingConfirmation || !pendingConfirmation.awaitingDisambiguation) {
        return false;
    }

    // Update the confirmation data with the selected option
    pendingConfirmation.data = {
        ...pendingConfirmation.data,
        ...selectedOption
    };

    pendingConfirmation.awaitingDisambiguation = false;

    logger.info(`Updated confirmation for ${userId} with selected option`);
    return true;
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

    // If awaiting disambiguation, we can't confirm yet
    if (pendingConfirmation.awaitingDisambiguation) {
        logger.info(`Cannot confirm action for ${userId} - disambiguation required first`);
        return {
            action: pendingConfirmation.action,
            data: pendingConfirmation.data,
            confirmed: false,
            needsDisambiguation: true,
            options: pendingConfirmation.disambiguationOptions
        };
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
 * Add context to a pending confirmation
 * @param {string} userId Unique user identifier
 * @param {string} message Message to add to context
 * @returns {boolean} Success or failure
 */
export function addConfirmationContext(userId, message) {
    const pendingConfirmation = getPendingConfirmation(userId);

    if (!pendingConfirmation) {
        return false;
    }

    // Add message to context history
    pendingConfirmation.contextHistory.push({
        message,
        timestamp: new Date()
    });

    // Increment attempt counter
    pendingConfirmation.attempts += 1;

    return true;
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

    // Add this response to context
    addConfirmationContext(userId, transcript);

    // If we're awaiting disambiguation, process differently
    if (pendingConfirmation.awaitingDisambiguation) {
        return processDisambiguationResponse(userId, transcript, pendingConfirmation);
    }

    // Analyze the transcript for confirmation or rejection
    const affirmativeResponses = [
        'yes', 'yeah', 'yep', 'correct', 'right', 'sure', 'okay', 'ok', 'confirm',
        'confirmed', 'do it', 'please do', 'go ahead', 'absolutely', 'definitely',
        'yup', 'affirmative', 'fine', 'good', 'that\'s right', 'thats right', 'great'
    ];

    const negativeResponses = [
        'no', 'nope', 'don\'t', 'do not', 'cancel', 'abort', 'stop', 'never mind',
        'nevermind', 'wrong', 'incorrect', 'negative', 'don\'t do that', 'wait',
        'hold on', 'forget it', 'negative', 'forget about it', 'dont'
    ];

    const normalizedTranscript = transcript.toLowerCase();

    // Enhanced pattern matching - check for phrases rather than just words
    const containsPhrase = (phrases) => {
        return phrases.some(phrase => {
            // Check for exact word match (with word boundaries)
            const regex = new RegExp(`\\b${phrase}\\b`, 'i');
            if (regex.test(normalizedTranscript)) return true;

            // For longer phrases, just check if they're included
            if (phrase.includes(' ') && normalizedTranscript.includes(phrase)) return true;

            return false;
        });
    };

    // Check for confirmation with enhanced matching
    const isConfirmed = containsPhrase(affirmativeResponses);

    // Check for rejection with enhanced matching
    const isRejected = containsPhrase(negativeResponses);

    if (isConfirmed) {
        return confirmAction(userId);
    } else if (isRejected) {
        cancelConfirmation(userId);
        return { confirmed: false, action: 'rejected' };
    }

    // Handle ambiguous responses based on attempts
    if (pendingConfirmation.attempts >= 2) {
        // After multiple attempts, treat ambiguous responses as rejections
        cancelConfirmation(userId);
        return { confirmed: false, action: 'rejected_ambiguous' };
    }

    // If we can't determine user intent, return the pending confirmation
    // so the system knows a confirmation is still needed
    return {
        action: pendingConfirmation.action,
        data: pendingConfirmation.data,
        confirmed: false,
        needsMoreClarification: true,
        attempts: pendingConfirmation.attempts
    };
}

/**
 * Process disambiguation response
 * @param {string} userId Unique user identifier
 * @param {string} transcript User's response transcript
 * @param {Object} confirmation The pending confirmation
 * @returns {Object} Result of disambiguation processing
 */
function processDisambiguationResponse(userId, transcript, confirmation) {
    const normalizedTranscript = transcript.toLowerCase();
    const options = confirmation.disambiguationOptions || [];

    if (!options.length) {
        // No options to disambiguate, treat as regular confirmation
        confirmation.awaitingDisambiguation = false;
        return processConfirmationResponse(userId, transcript);
    }

    // Check for numeric selection
    const numberWords = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'];
    const numberRegex = /\b(one|two|three|four|five|six|seven|eight|nine|ten|\d+)\b/;

    let selectedIndex = -1;

    // Check for explicit numbers (1, 2, 3, etc.)
    const numericMatch = normalizedTranscript.match(/\b(\d+)\b/);
    if (numericMatch) {
        selectedIndex = parseInt(numericMatch[1]) - 1; // Convert to 0-based index
    }

    // Check for number words (first, second, etc.)
    if (selectedIndex < 0) {
        for (let i = 0; i < numberWords.length; i++) {
            if (normalizedTranscript.includes(numberWords[i])) {
                selectedIndex = i;
                break;
            }
        }
    }

    // Check for number words as digits (one, two, etc.)
    if (selectedIndex < 0) {
        const wordMatch = normalizedTranscript.match(numberRegex);
        if (wordMatch) {
            const wordToNumber = {
                'one': 0, 'two': 1, 'three': 2, 'four': 3, 'five': 4,
                'six': 5, 'seven': 6, 'eight': 7, 'nine': 8, 'ten': 9
            };

            if (wordToNumber[wordMatch[1]] !== undefined) {
                selectedIndex = wordToNumber[wordMatch[1]];
            } else {
                // Try to parse it as a number
                selectedIndex = parseInt(wordMatch[1]) - 1;
            }
        }
    }

    // If we have a valid index, select that option
    if (selectedIndex >= 0 && selectedIndex < options.length) {
        const selectedOption = options[selectedIndex];
        updateWithSelectedOption(userId, selectedOption);

        // Now proceed with confirmation
        return {
            action: confirmation.action,
            data: pendingConfirmations.get(userId).data, // Get updated data
            selectedOption,
            confirmed: false,
            needsExplicitConfirmation: true
        };
    }

    // Try to match option content
    for (let i = 0; i < options.length; i++) {
        const option = options[i];

        // Skip if option doesn't have a task property
        if (!option.task) continue;

        // Check if significant parts of the option appear in the transcript
        const taskWords = option.task.toLowerCase().split(/\s+/);
        const significantWords = taskWords.filter(word => word.length > 3);

        const matchCount = significantWords.filter(word => normalizedTranscript.includes(word)).length;
        const matchRatio = matchCount / significantWords.length;

        // If a significant portion of the task words are in the transcript
        if (matchRatio > 0.5 || (significantWords.length > 0 && matchCount >= 2)) {
            updateWithSelectedOption(userId, option);

            // Now proceed with confirmation
            return {
                action: confirmation.action,
                data: pendingConfirmations.get(userId).data, // Get updated data
                selectedOption: option,
                confirmed: false,
                needsExplicitConfirmation: true
            };
        }
    }

    // If we still haven't found a match, ask for clarification
    return {
        action: confirmation.action,
        data: confirmation.data,
        options,
        confirmed: false,
        needsMoreClarification: true,
        attempts: confirmation.attempts
    };
}