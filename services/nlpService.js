// services/nlpService.js - Enhanced NLP for reminder messages with follow-up and relative time support

import axios from 'axios';
import { logger } from '../utils/logger.js';
import {
    createReminder,
    updateReminder,
    deleteReminder,
    getReminders,
    formatFriendlyDateTime,
    parseDateTime
} from './reminderService.js';

// Set up OpenAI API client
const openaiClient = axios.create({
    baseURL: 'https://api.openai.com/v1',
    headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
    }
});

// Conversation state storage (for follow-up questions)
// key: userId, value: { pendingReminder, missingFields, currentField }
const conversationStates = new Map();

/**
 * Process a user message to identify intent and extract reminder details
 * @param {string} message The user's message text
 * @param {string} userId The user's identifier (phone number)
 * @param {boolean} isFollowUp Whether this is a follow-up to a previous message
 * @returns {Object} NLP processing result with intent and response
 */
export async function processUserMessage(message, userId, isFollowUp = false) {
    try {
        logger.info(`Processing ${isFollowUp ? 'follow-up' : 'initial'} message: "${message}" from ${userId}`);

        let systemPrompt;
        let userMessages;

        // Check if we're in a follow-up conversation
        const userState = conversationStates.get(userId);
        const inFollowUpMode = isFollowUp && userState && userState.pendingReminder && userState.currentField;

        if (inFollowUpMode) {
            // This is a follow-up for a specific missing field
            systemPrompt = `You are an AI assistant that extracts specific information for a reminder. 
            
The user has already requested a reminder, but the ${userState.currentField} is missing.
Extract ONLY the ${userState.currentField} from their response.

Today's date is ${new Date().toISOString().split('T')[0]}.

For date values:
- If they mention relative dates like "today", "tomorrow", "next Monday", etc., keep them as is
- If they mention a specific date like "May 5", "5th", etc., convert to YYYY-MM-DD format if possible
- Always set "valid" to true if you can extract any date information, even if it's a relative date

For time values:
- Extract the time in a consistent format (e.g., "3pm", "15:00", "morning", etc.)
- Keep descriptive times like "morning", "evening" as is
- If they mention relative time like "in 5 minutes", "in 2 hours", keep this format as is and set "valid" to true

Output a JSON object with the following structure:
{
  "${userState.currentField}": "the extracted value",
  "valid": true/false
}

If you cannot extract the information, set "valid" to false.`;

            userMessages = [
                { role: 'user', content: message }
            ];
        } else {
            // Initial reminder processing
            systemPrompt = `You are an AI assistant that processes natural language text to identify reminder requests.
            
Extract information from the user's message to identify:
1. Intent: create, update, delete, list, or other
2. For create/update: reminder content, date, time, and any additional details
3. For delete: which reminder to delete (by content or ID)
4. For list: any filtering criteria

Today's date is ${new Date().toISOString().split('T')[0]}.

When extracting time information:
- If the user mentions a specific number without AM/PM (e.g., "at 8"), intelligently determine whether it's AM or PM based on context.
- If it's currently after the mentioned time, assume the user means the next occurrence.
- For vague times like "evening", "morning", "afternoon", "night", use reasonable default hours.
- If the user mentions relative time like "in 5 minutes", "in 2 hours", etc., capture this as-is in the "relativeTime" field and leave the time field empty.

When extracting date information:
- For relative dates like "today", "tomorrow", "next Monday", etc., keep them AS IS - do not convert to absolute dates
- Only use absolute dates (YYYY-MM-DD) if the user specifically mentions a calendar date

Output a JSON object with the following structure:
{
  "intent": "create|update|delete|list|other",
  "reminderContent": "what the reminder is about",
  "date": "TODAY'S STRING AS IS (e.g., 'today', 'tomorrow', 'next monday')",
  "time": "HH:MM format (24-hour) or descriptive time",
  "relativeTime": "in X minutes/hours/days (if specified)",
  "additionalDetails": "any other details for the reminder",
  "reminderIdentifier": "specific identifier for update/delete operations",
  "response": "natural language response to confirm the action or ask for more details",
  "missingFields": ["list of required fields that are missing"],
  "followUpQuestions": {
    "field1": "question to ask about missing field1",
    "field2": "question to ask about missing field2"
  }
}

For "create" intent, reminderContent is always required. Either time OR relativeTime is required (not both).
If the user specifies a relative time like "in 5 minutes", fill the relativeTime field and leave time blank.
If there's no time or relativeTime specified, include "time" in missingFields.
For "update" and "delete" intents, reminderIdentifier is required.
For "list" intent, no additional fields are strictly required.

Do NOT include any other text in your response, just the JSON object.`;

            userMessages = [
                { role: 'user', content: message }
            ];
        }

        // Make API call to OpenAI
        const response = await openaiClient.post('/chat/completions', {
            model: 'gpt-4o',
            messages: [
                { role: 'system', content: systemPrompt },
                ...userMessages
            ],
            temperature: 0.2,
            response_format: { type: 'json_object' }
        });

        // Extract and parse the JSON response
        const aiResponse = response.data.choices[0].message.content;
        const parsedResponse = JSON.parse(aiResponse);

        // If this is a follow-up response, update the pending reminder
        if (inFollowUpMode) {
            return await handleFollowUpResponse(parsedResponse, userId);
        }

        // Check if we need to start a follow-up conversation for missing fields
        if (parsedResponse.intent === 'create' &&
            parsedResponse.missingFields &&
            parsedResponse.missingFields.length > 0) {
            // Store the conversation state for follow-up
            conversationStates.set(userId, {
                pendingReminder: parsedResponse,
                missingFields: [...parsedResponse.missingFields],
                currentField: parsedResponse.missingFields[0]
            });

            // Add a note about follow-up mode
            parsedResponse.inFollowUpMode = true;

            // Return the response without performing any database action yet
            return parsedResponse;
        }

        // Process the intent and perform the corresponding action
        switch (parsedResponse.intent) {
            case 'create':
                await handleCreateIntent(parsedResponse, userId);
                break;

            case 'update':
                await handleUpdateIntent(parsedResponse, userId);
                break;

            case 'delete':
                await handleDeleteIntent(parsedResponse, userId);
                break;

            case 'list':
                await handleListIntent(parsedResponse, userId);
                break;

            default:
                // No specific action for other intents
                break;
        }

        // Clear any conversation state since we processed the full request
        conversationStates.delete(userId);

        return parsedResponse;
    } catch (error) {
        logger.error('Error processing user message:', error);

        // Return a fallback response
        return {
            intent: 'error',
            response: "I'm sorry, I had trouble understanding your request. Could you please rephrase it? For example, you can say something like 'Remind me to take my medicine at 3pm tomorrow'."
        };
    }
}

/**
 * Handle a follow-up response and update the pending reminder
 * @param {Object} followUpResult The follow-up NLP result
 * @param {string} userId The user's identifier
 * @returns {Object} Updated response with next steps
 */
async function handleFollowUpResponse(followUpResult, userId) {
    const userState = conversationStates.get(userId);

    if (!userState || !userState.pendingReminder || !userState.currentField) {
        // No valid conversation state found
        conversationStates.delete(userId);
        return {
            intent: 'error',
            response: "I'm sorry, there was an issue with our conversation. Could you please start over with your reminder request?"
        };
    }

    const response = {
        intent: userState.pendingReminder.intent,
        inFollowUpMode: true
    };

    // If the follow-up was valid, update the pending reminder
    if (followUpResult.valid) {
        // Update the pending reminder with the new information
        userState.pendingReminder[userState.currentField] = followUpResult[userState.currentField];

        // Remove this field from missing fields
        userState.missingFields = userState.missingFields.filter(
            field => field !== userState.currentField
        );

        // Update the conversation state
        conversationStates.set(userId, userState);

        // Set response message
        response.response = `Thank you, I've updated your reminder with ${userState.currentField}: ${followUpResult[userState.currentField]}.`;

        // Check if we still have missing fields
        if (userState.missingFields.length > 0) {
            // Move to the next missing field
            userState.currentField = userState.missingFields[0];
            response.nextField = userState.currentField;
            response.nextQuestion = userState.pendingReminder.followUpQuestions[userState.currentField] ||
                `Please provide the ${userState.currentField}:`;
        } else {
            // All fields are filled, process the complete reminder
            switch (userState.pendingReminder.intent) {
                case 'create':
                    await handleCreateIntent(userState.pendingReminder, userId);
                    break;

                // Add cases for other intents if needed
                default:
                    break;
            }

            // Clear conversation state
            conversationStates.delete(userId);

            // Set final response
            response.inFollowUpMode = false;
            response.complete = true;
            response.response = userState.pendingReminder.response ||
                "Your reminder has been created successfully.";

            // Calculate the scheduled time for display
            const scheduledTime = parseDateTime(
                userState.pendingReminder.date,
                userState.pendingReminder.time,
                userState.pendingReminder.relativeTime
            );

            response.scheduledTime = formatFriendlyDateTime(scheduledTime);
        }
    } else {
        // Could not extract the required information
        response.response = `I couldn't understand the ${userState.currentField} from your message. Could you please try again?`;
        response.nextField = userState.currentField;
        response.nextQuestion = userState.pendingReminder.followUpQuestions[userState.currentField] ||
            `Please provide the ${userState.currentField}:`;
    }

    return response;
}

/**
 * Process a follow-up message from the user
 * @param {string} message The user's follow-up message
 * @param {string} userId The user's identifier
 * @returns {Object} NLP processing result
 */
export async function processFollowUpMessage(message, userId) {
    return await processUserMessage(message, userId, true);
}

/**
 * Check if the user is in follow-up mode
 * @param {string} userId The user's identifier
 * @returns {boolean} Whether the user is in follow-up mode
 */
export function isInFollowUpMode(userId) {
    const userState = conversationStates.get(userId);
    return !!(userState && userState.pendingReminder && userState.currentField);
}

/**
 * Get the next follow-up question for the user
 * @param {string} userId The user's identifier
 * @returns {string} The next follow-up question
 */
export function getNextFollowUpQuestion(userId) {
    const userState = conversationStates.get(userId);

    if (!userState || !userState.pendingReminder || !userState.currentField) {
        return null;
    }

    return userState.pendingReminder.followUpQuestions[userState.currentField] ||
        `Please provide the ${userState.currentField}:`;
}

/**
 * Handle intent to create a new reminder
 * @param {Object} nlpResult The NLP processing result
 * @param {string} userId The user's identifier
 */
async function handleCreateIntent(nlpResult, userId) {
    try {
        // Create the reminder in the database
        const reminder = await createReminder({
            userId,
            content: nlpResult.reminderContent,
            date: nlpResult.date,
            time: nlpResult.time,
            relativeTime: nlpResult.relativeTime,
            additionalDetails: nlpResult.additionalDetails
        });

        // Calculate human-readable scheduled time
        const friendlyTime = formatFriendlyDateTime(reminder.scheduledTime);

        // Update the response with confirmation
        nlpResult.response = `✅ I've set a reminder for you: "${nlpResult.reminderContent}" for ${friendlyTime}. I'll call you at that time to remind you.`;

        logger.info(`Created reminder for ${userId}:`, reminder);
    } catch (error) {
        logger.error('Error creating reminder:', error);
        nlpResult.response = "I'm sorry, I wasn't able to create that reminder. Could you try again?";
    }
}

/**
 * Handle intent to update an existing reminder
 * @param {Object} nlpResult The NLP processing result
 * @param {string} userId The user's identifier
 */
async function handleUpdateIntent(nlpResult, userId) {
    try {
        // Update the reminder in the database
        const updatedReminder = await updateReminder({
            userId,
            identifier: nlpResult.reminderIdentifier,
            content: nlpResult.reminderContent,
            date: nlpResult.date,
            time: nlpResult.time,
            relativeTime: nlpResult.relativeTime,
            additionalDetails: nlpResult.additionalDetails
        });

        if (updatedReminder) {
            // Calculate human-readable scheduled time
            const friendlyTime = formatFriendlyDateTime(updatedReminder.scheduledTime);

            nlpResult.response = `✅ I've updated your reminder about "${nlpResult.reminderIdentifier}". It's now set for ${friendlyTime}.`;
        } else {
            nlpResult.response = "I couldn't find that reminder to update. Could you be more specific or try creating a new reminder?";
        }

        logger.info(`Updated reminder for ${userId}:`, updatedReminder);
    } catch (error) {
        logger.error('Error updating reminder:', error);
        nlpResult.response = "I'm sorry, I wasn't able to update that reminder. Could you try again?";
    }
}

/**
 * Handle intent to delete a reminder
 * @param {Object} nlpResult The NLP processing result
 * @param {string} userId The user's identifier
 */
async function handleDeleteIntent(nlpResult, userId) {
    try {
        // Delete the reminder from the database
        const result = await deleteReminder({
            userId,
            identifier: nlpResult.reminderIdentifier
        });

        if (result) {
            nlpResult.response = `✅ I've deleted the reminder about "${nlpResult.reminderIdentifier}".`;
        } else {
            nlpResult.response = "I couldn't find that reminder to delete. Could you be more specific?";
        }

        logger.info(`Deleted reminder for ${userId}:`, result);
    } catch (error) {
        logger.error('Error deleting reminder:', error);
        nlpResult.response = "I'm sorry, I wasn't able to delete that reminder. Could you try again?";
    }
}

/**
 * Handle intent to list reminders
 * @param {Object} nlpResult The NLP processing result
 * @param {string} userId The user's identifier
 */
async function handleListIntent(nlpResult, userId) {
    try {
        // Build query parameters from NLP result
        const queryParams = {
            userId,
            status: 'scheduled'  // Default to showing scheduled reminders
        };

        // Add date filters if provided
        if (nlpResult.date) {
            queryParams.date = nlpResult.date;
        }

        // Get the user's reminders
        const reminders = await getReminders(queryParams);

        if (reminders.length === 0) {
            nlpResult.response = "You don't have any reminders set up. Would you like to create one?";
        } else {
            const reminderList = reminders.map(reminder => {
                const friendlyTime = formatFriendlyDateTime(reminder.scheduledTime);
                return `• ${reminder.content} on ${friendlyTime}`;
            }).join('\n');

            nlpResult.response = `Here are your upcoming reminders:\n${reminderList}`;
        }

        logger.info(`Listed reminders for ${userId}:`, { count: reminders.length });
    } catch (error) {
        logger.error('Error listing reminders:', error);
        nlpResult.response = "I'm sorry, I wasn't able to retrieve your reminders. Could you try again?";
    }
}

/**
 * Clear the conversation state for a user
 * @param {string} userId The user's identifier
 */
export function clearConversationState(userId) {
    conversationStates.delete(userId);
    logger.info(`Cleared conversation state for ${userId}`);
}