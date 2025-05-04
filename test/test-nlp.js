// test/interactive-nlp-test-with-relative-time.js - Enhanced with relative time support

import dotenv from 'dotenv';
import axios from 'axios';
import { logger } from '../utils/logger.js';
import readline from 'readline';

// Load environment variables
dotenv.config();

// Create interface for reading user input
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

// Conversation state
const conversationState = {
    inFollowUpMode: false,
    pendingReminder: null,
    missingFields: [],
    currentField: null
};

/**
 * Process a message directly with OpenAI to test NLP capabilities
 * @param {string} message The message to process
 * @param {boolean} isFollowUp Whether this is a follow-up to a previous message
 * @returns {Promise<Object>} The NLP processing result
 */
async function testNlpProcessing(message, isFollowUp = false) {
    try {
        // Check if OpenAI API key is available
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) {
            throw new Error('OPENAI_API_KEY is not set in your environment variables');
        }

        // Create different prompts based on whether this is initial or follow-up
        let systemPrompt;
        let userMessages;

        if (isFollowUp && conversationState.pendingReminder) {
            // This is a follow-up for a specific missing field
            systemPrompt = `You are an AI assistant that extracts specific information for a reminder. 
      
The user has already requested a reminder, but the ${conversationState.currentField} is missing.
Extract ONLY the ${conversationState.currentField} from their response.

Today's date is ${new Date().toISOString().split('T')[0]}.

For date values:
- If they mention relative dates like "today", "tomorrow", "next Monday", etc., keep them as is
- If they mention a specific date like "May 5", "5th", etc., convert to YYYY-MM-DD format if possible
- Always set "valid" to true if you can extract any date information, even if it's a relative date

For time values:
- Extract the time in a consistent format (e.g., "3pm", "15:00", "morning", etc.)
- Keep descriptive times like "morning", "evening" as is
- If they mention relative time like "in 5 minutes", "in 2 hours", keep this format as is

Output a JSON object with the following structure:
{
  "${conversationState.currentField}": "the extracted value",
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
- If the user mentions relative time like "in 5 minutes", "in 2 hours", etc., capture this as-is in the "relativeTime" field.

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

For "create" intent, either time OR relativeTime is required (not both).
If the user specifies a relative time like "in 5 minutes", fill the relativeTime field and leave time blank.
If there's no time or relativeTime specified, include "time" in missingFields.
For "update" and "delete" intents, both reminderIdentifier and at least one field to update are required.
For "list" intent, no additional fields are strictly required.

Do NOT include any other text in your response, just the JSON object.`;

            userMessages = [
                { role: 'user', content: message }
            ];
        }

        logger.info('Sending request to OpenAI...');

        // Call OpenAI API directly
        const response = await axios.post('https://api.openai.com/v1/chat/completions', {
            model: 'gpt-4o',
            messages: [
                { role: 'system', content: systemPrompt },
                ...userMessages
            ],
            temperature: 0.2,
            response_format: { type: 'json_object' }
        }, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            }
        });

        // Extract and parse the JSON response
        const aiResponse = response.data.choices[0].message.content;
        return JSON.parse(aiResponse);
    } catch (error) {
        logger.error('Error in NLP processing:', error.message);
        if (error.response) {
            logger.error('OpenAI API error details:', {
                status: error.response.status,
                data: error.response.data
            });
        }
        return {
            intent: 'error',
            response: "Error processing the message. Check your API key and connection."
        };
    }
}

/**
 * Enhanced date/time parsing with support for relative times
 * @param {string} dateStr Date string
 * @param {string} timeStr Time string
 * @param {string} relativeTimeStr Relative time string (e.g., "in 5 minutes")
 * @returns {Date} Parsed date object
 */
function enhancedDateTimeParsing(dateStr, timeStr, relativeTimeStr) {
    try {
        const now = new Date();
        let targetDate;

        // If we have a relative time expression, use that first
        if (relativeTimeStr) {
            targetDate = parseRelativeTime(relativeTimeStr);
            if (targetDate) {
                console.log(`Relative time detected: "${relativeTimeStr}" → ${formatFriendlyDate(targetDate)}`);
                return targetDate;
            }
        }

        // Parse date
        if (!dateStr || dateStr.trim() === '') {
            targetDate = new Date(now);
        } else if (dateStr.toLowerCase() === 'today') {
            targetDate = new Date(now);
        } else if (dateStr.toLowerCase() === 'tomorrow') {
            targetDate = new Date(now);
            targetDate.setDate(targetDate.getDate() + 1);
        } else if (dateStr.toLowerCase().startsWith('next')) {
            // Handle "next [day of week]"
            const dayOfWeek = dateStr.toLowerCase().split(' ')[1];
            targetDate = getNextDayOfWeek(now, dayOfWeek);
        } else if (dateStr.match(/^\d{4}-\d{2}-\d{2}$/)) {
            // Handle YYYY-MM-DD format
            targetDate = new Date(dateStr);
        } else {
            // Try to parse other date formats
            try {
                targetDate = new Date(dateStr);
                if (isNaN(targetDate.getTime())) {
                    // If parsing fails, default to today
                    console.log(`Warning: Could not parse date "${dateStr}", using today instead.`);
                    targetDate = new Date(now);
                }
            } catch (error) {
                console.log(`Warning: Error parsing date "${dateStr}", using today instead.`);
                targetDate = new Date(now);
            }
        }

        // Parse time with smart interpretation
        if (timeStr && timeStr.trim() !== '') {
            let hours = 0;
            let minutes = 0;

            // Handle descriptive times
            if (timeStr.toLowerCase() === 'morning') {
                hours = 9;
                minutes = 0;
            } else if (timeStr.toLowerCase() === 'afternoon') {
                hours = 14;
                minutes = 0;
            } else if (timeStr.toLowerCase() === 'evening') {
                hours = 19;
                minutes = 0;
            } else if (timeStr.toLowerCase() === 'night') {
                hours = 21;
                minutes = 0;
            } else if (timeStr.toLowerCase() === 'noon') {
                hours = 12;
                minutes = 0;
            } else if (timeStr.toLowerCase() === 'midnight') {
                hours = 0;
                minutes = 0;
            }
            // Handle 24-hour format (HH:MM)
            else if (timeStr.match(/^(\d{1,2}):(\d{2})$/)) {
                const timeMatch24 = timeStr.match(/^(\d{1,2}):(\d{2})$/);
                hours = parseInt(timeMatch24[1], 10);
                minutes = parseInt(timeMatch24[2], 10);
            }
            // Handle 12-hour format with am/pm (e.g., "3:00pm", "3pm")
            else if (timeStr.match(/^(\d{1,2})(?::(\d{2}))?(?:\s*)?(am|pm)$/i)) {
                const timeMatch12 = timeStr.match(/^(\d{1,2})(?::(\d{2}))?(?:\s*)?(am|pm)$/i);
                hours = parseInt(timeMatch12[1], 10);
                minutes = timeMatch12[2] ? parseInt(timeMatch12[2], 10) : 0;

                // Adjust for AM/PM
                const isPM = timeMatch12[3].toLowerCase() === 'pm';
                if (isPM && hours < 12) {
                    hours += 12;
                } else if (!isPM && hours === 12) {
                    hours = 0;
                }
            }
            // Handle lone numbers (e.g., "at 8") - SMART TIME FEATURE
            else if (timeStr.match(/^(\d{1,2})$/)) {
                hours = parseInt(timeStr, 10);
                minutes = 0;

                // Smart time interpretation:
                // If current time is past the specified hour, assume PM (if hour < 12)
                const currentHour = now.getHours();

                // If it's already past that hour today and the hour is < 12, assume PM
                if (currentHour >= hours && hours < 12) {
                    hours += 12;
                }

                // Extra context for the user
                console.log(`Smart time: Interpreted "${timeStr}" as ${hours}:00 ${hours >= 12 ? 'PM' : 'AM'}`);
            } else {
                // Fallback - keep current time
                hours = now.getHours();
                minutes = now.getMinutes();
            }

            // Set the time components
            targetDate.setHours(hours);
            targetDate.setMinutes(minutes);
            targetDate.setSeconds(0);
            targetDate.setMilliseconds(0);
        }

        return targetDate;
    } catch (error) {
        logger.error('Error parsing date/time:', error);
        return new Date(); // Return current date/time as fallback
    }
}

/**
 * Parse a relative time expression (e.g., "in 5 minutes")
 * @param {string} relativeTimeStr Relative time string
 * @returns {Date|null} Calculated date or null if parsing failed
 */
function parseRelativeTime(relativeTimeStr) {
    try {
        if (!relativeTimeStr) return null;

        const now = new Date();
        const result = new Date(now.getTime()); // Clone current date

        // Match patterns like "in X minutes/hours/days"
        const inMatch = relativeTimeStr.match(/in\s+(\d+)\s+(minute|minutes|hour|hours|day|days)/i);
        if (inMatch) {
            const amount = parseInt(inMatch[1], 10);
            const unit = inMatch[2].toLowerCase();

            if (unit === 'minute' || unit === 'minutes') {
                result.setMinutes(result.getMinutes() + amount);
            } else if (unit === 'hour' || unit === 'hours') {
                result.setHours(result.getHours() + amount);
            } else if (unit === 'day' || unit === 'days') {
                result.setDate(result.getDate() + amount);
            }

            return result;
        }

        // Match patterns like "X minutes/hours/days from now"
        const fromNowMatch = relativeTimeStr.match(/(\d+)\s+(minute|minutes|hour|hours|day|days)\s+from\s+now/i);
        if (fromNowMatch) {
            const amount = parseInt(fromNowMatch[1], 10);
            const unit = fromNowMatch[2].toLowerCase();

            if (unit === 'minute' || unit === 'minutes') {
                result.setMinutes(result.getMinutes() + amount);
            } else if (unit === 'hour' || unit === 'hours') {
                result.setHours(result.getHours() + amount);
            } else if (unit === 'day' || unit === 'days') {
                result.setDate(result.getDate() + amount);
            }

            return result;
        }

        return null; // No recognized pattern
    } catch (error) {
        logger.error('Error parsing relative time:', error);
        return null;
    }
}

/**
 * Get the next occurrence of a day of the week
 * @param {Date} date The reference date
 * @param {string} dayName The name of the day (e.g., "monday", "tuesday")
 * @returns {Date} The next occurrence of the specified day
 */
function getNextDayOfWeek(date, dayName) {
    const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const targetDay = days.indexOf(dayName.toLowerCase());

    if (targetDay < 0) {
        logger.warn(`Invalid day name: ${dayName}, using tomorrow instead`);
        const tomorrow = new Date(date);
        tomorrow.setDate(date.getDate() + 1);
        return tomorrow;
    }

    const currentDay = date.getDay();
    let daysToAdd = targetDay - currentDay;

    // If the day has already occurred this week, go to next week
    if (daysToAdd <= 0) {
        daysToAdd += 7;
    }

    const nextDate = new Date(date);
    nextDate.setDate(date.getDate() + daysToAdd);
    return nextDate;
}

/**
 * Format a date in a user-friendly way
 * @param {Date} date The date to format
 * @returns {string} Formatted date string
 */
function formatFriendlyDate(date) {
    if (!date) return '';

    const options = {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
    };

    return date.toLocaleString('en-US', options);
}

/**
 * Process a follow-up response and update the pending reminder
 * @param {Object} followUpResult The follow-up NLP result
 */
function processFollowUp(followUpResult) {
    if (!conversationState.pendingReminder || !conversationState.currentField) {
        return;
    }

    // If the follow-up was valid, update the pending reminder
    if (followUpResult.valid) {
        // Update the pending reminder with the new information
        conversationState.pendingReminder[conversationState.currentField] =
            followUpResult[conversationState.currentField];

        // Remove this field from missing fields
        conversationState.missingFields = conversationState.missingFields.filter(
            field => field !== conversationState.currentField
        );

        console.log(`\n✅ Updated reminder with ${conversationState.currentField}: ${followUpResult[conversationState.currentField]}`);
    } else {
        console.log(`\n❌ Could not extract ${conversationState.currentField} from your response. Let's try again.`);
    }
}

/**
 * Interactive test loop
 */
async function runInteractiveTest() {
    console.log("\n=== Interactive NLP Reminder Test with Relative Time Support ===");
    console.log("Type your reminder message or type 'exit' to quit");
    console.log("Examples:");
    console.log("  - 'Remind me to get vegetables from the shop'");
    console.log("  - 'Remind me to drink coffee in 5 minutes'");
    console.log("  - 'I have to attend my brother's wedding tomorrow at 5pm'");
    console.log("If information is missing, the system will ask follow-up questions");

    const promptUser = () => {
        // Determine prompt based on conversation state
        let prompt;

        if (conversationState.inFollowUpMode && conversationState.currentField) {
            // We're in follow-up mode, ask about the specific missing field
            const followUpQuestion = conversationState.pendingReminder.followUpQuestions[conversationState.currentField];
            prompt = followUpQuestion || `Please provide the ${conversationState.currentField}:`;
        } else {
            // Regular prompt
            prompt = '\nEnter your message:';
        }

        rl.question(` ${prompt} `, async (input) => {
            if (input.toLowerCase() === 'exit') {
                console.log('Exiting interactive test...');
                rl.close();
                return;
            }

            try {
                logger.info(`Processing message: "${input}"`);

                let result;

                if (conversationState.inFollowUpMode) {
                    // Process as a follow-up response
                    result = await testNlpProcessing(input, true);
                    processFollowUp(result);

                    // If there are still missing fields, continue in follow-up mode
                    if (conversationState.missingFields.length > 0) {
                        // Move to the next missing field
                        conversationState.currentField = conversationState.missingFields[0];

                        // Continue prompting
                        promptUser();
                    } else {
                        // All fields are filled, show the completed reminder
                        console.log('\n=== Completed Reminder ===');
                        console.log(JSON.stringify(conversationState.pendingReminder, null, 2));

                        // Show parsed date/time if applicable
                        const hasTimeInfo = conversationState.pendingReminder.date ||
                            conversationState.pendingReminder.time ||
                            conversationState.pendingReminder.relativeTime;

                        if (hasTimeInfo) {
                            const parsedDateTime = enhancedDateTimeParsing(
                                conversationState.pendingReminder.date,
                                conversationState.pendingReminder.time,
                                conversationState.pendingReminder.relativeTime
                            );

                            console.log('\n=== Parsed Date/Time ===');
                            if (conversationState.pendingReminder.date) {
                                console.log(`Date input: ${conversationState.pendingReminder.date}`);
                            }
                            if (conversationState.pendingReminder.time) {
                                console.log(`Time input: ${conversationState.pendingReminder.time}`);
                            }
                            if (conversationState.pendingReminder.relativeTime) {
                                console.log(`Relative time: ${conversationState.pendingReminder.relativeTime}`);
                            }
                            console.log(`Parsed as: ${parsedDateTime.toLocaleString()}`);
                            console.log(`User-friendly: ${formatFriendlyDate(parsedDateTime)}`);
                        }

                        // Reset conversation state
                        conversationState.inFollowUpMode = false;
                        conversationState.pendingReminder = null;
                        conversationState.missingFields = [];
                        conversationState.currentField = null;

                        // Back to regular prompting
                        promptUser();
                    }
                } else {
                    // Process as a new request
                    result = await testNlpProcessing(input);

                    // Display the results
                    console.log('\n=== NLP Result ===');
                    console.log(JSON.stringify(result, null, 2));

                    // Check if there are missing fields that need follow-ups
                    if (result.intent === 'create' && result.missingFields && result.missingFields.length > 0) {
                        console.log('\n=== Missing Information Detected ===');
                        console.log(`Missing fields: ${result.missingFields.join(', ')}`);

                        // Enter follow-up mode
                        conversationState.inFollowUpMode = true;
                        conversationState.pendingReminder = result;
                        conversationState.missingFields = [...result.missingFields];
                        conversationState.currentField = result.missingFields[0];

                        // Continue prompting (which will now be a follow-up)
                        promptUser();
                    } else {
                        // If we have date/time and no missing fields, show what it would be parsed as
                        const hasTimeInfo = result.date || result.time || result.relativeTime;

                        if (hasTimeInfo && (!result.missingFields || result.missingFields.length === 0)) {
                            const parsedDateTime = enhancedDateTimeParsing(result.date, result.time, result.relativeTime);
                            console.log('\n=== Parsed Date/Time ===');
                            console.log(`Current time: ${new Date().toLocaleTimeString()}`);

                            if (result.date) {
                                console.log(`Date input: ${result.date}`);
                            }
                            if (result.time) {
                                console.log(`Time input: ${result.time}`);
                            }
                            if (result.relativeTime) {
                                console.log(`Relative time: ${result.relativeTime}`);
                            }

                            console.log(`Parsed as: ${parsedDateTime.toLocaleString()}`);
                            console.log(`User-friendly: ${formatFriendlyDate(parsedDateTime)}`);
                        }

                        // Continue with regular prompting
                        promptUser();
                    }
                }
            } catch (error) {
                logger.error('Error processing input:', error);

                // Continue prompting even after an error
                promptUser();
            }
        });
    };

    // Start the interactive loop
    promptUser();
}

// Run the interactive test
runInteractiveTest();