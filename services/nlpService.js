// services/nlpService.js - Natural Language Processing for reminder messages

import axios from 'axios';
import { logger } from '../utils/logger.js';
import { createReminder, updateReminder, deleteReminder, getReminders } from './reminderService.js';

// Set up OpenAI API client
const openaiClient = axios.create({
    baseURL: 'https://api.openai.com/v1',
    headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
    }
});

/**
 * Process a user message to identify intent and extract reminder details
 * @param {string} message The user's message text
 * @param {string} userId The user's identifier (phone number)
 * @returns {Object} NLP processing result with intent and response
 */
export async function processUserMessage(message, userId) {
    try {
        logger.info(`Processing message: "${message}" from ${userId}`);

        // Prepare the system prompt for reminder processing
        const systemPrompt = `You are an AI assistant that processes natural language text to identify reminder requests.
        
Extract information from the user's message to identify:
1. Intent: create, update, delete, list, or other
2. For create/update: reminder content, date, time, and any additional details
3. For delete: which reminder to delete (by content or ID)
4. For list: any filtering criteria

Output ONLY a JSON object with the following structure:
{
  "intent": "create|update|delete|list|other",
  "reminderContent": "what the reminder is about",
  "date": "YYYY-MM-DD format or 'today', 'tomorrow', etc.",
  "time": "HH:MM format or descriptive time",
  "additionalDetails": "any other details for the reminder",
  "reminderIdentifier": "specific identifier for update/delete operations",
  "response": "natural language response to confirm the action or ask for more details"
}

Do NOT include any other text in your response, just the JSON object.`;

        const response = await openaiClient.post('/chat/completions', {
            model: 'gpt-4o-mini-2024-07-18',
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: message }
            ],
            temperature: 0.2,
            response_format: { type: 'json_object' }
        });

        // Extract and parse the JSON response
        const aiResponse = response.data.choices[0].message.content;
        const parsedResponse = JSON.parse(aiResponse);

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
            additionalDetails: nlpResult.additionalDetails
        });

        // Update the response with confirmation
        nlpResult.response = `✅ I've set a reminder for you: "${nlpResult.reminderContent}" on ${nlpResult.date} at ${nlpResult.time}. I'll call you at that time to remind you.`;

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
            additionalDetails: nlpResult.additionalDetails
        });

        if (updatedReminder) {
            nlpResult.response = `✅ I've updated your reminder about "${nlpResult.reminderContent}". It's now set for ${nlpResult.date} at ${nlpResult.time}.`;
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
            nlpResult.response = `✅ I've deleted the reminder about "${nlpResult.reminderIdentifier || nlpResult.reminderContent}".`;
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
        // Get the user's reminders
        const reminders = await getReminders({ userId });

        if (reminders.length === 0) {
            nlpResult.response = "You don't have any reminders set up. Would you like to create one?";
        } else {
            const reminderList = reminders.map(reminder =>
                `• ${reminder.content} on ${formatDate(reminder.date)} at ${reminder.time}`
            ).join('\n');

            nlpResult.response = `Here are your upcoming reminders:\n${reminderList}`;
        }

        logger.info(`Listed reminders for ${userId}:`, { count: reminders.length });
    } catch (error) {
        logger.error('Error listing reminders:', error);
        nlpResult.response = "I'm sorry, I wasn't able to retrieve your reminders. Could you try again?";
    }
}

/**
 * Format a date for user-friendly display
 * @param {string} dateStr The date string to format
 * @returns {string} Formatted date string
 */
function formatDate(dateStr) {
    if (dateStr === 'today' || dateStr === 'tomorrow') {
        return dateStr;
    }

    try {
        const date = new Date(dateStr);
        return date.toLocaleDateString('en-US', {
            weekday: 'long',
            month: 'long',
            day: 'numeric'
        });
    } catch (error) {
        return dateStr;
    }
}