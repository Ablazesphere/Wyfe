// src/services/nlpService.js

const axios = require('axios');
const { format, parse, parseISO, addHours, addMinutes } = require('date-fns');
const { zonedTimeToUtc, utcToZonedTime } = require('date-fns-tz');
const whatsappService = require('./whatsappService');
const reminderService = require('./reminderService');

/**
 * Process user message using OpenRouter LLM
 * @param {Object} user - User document from MongoDB
 * @param {String} messageText - Raw message text from user
 */
const processUserMessage = async (user, messageText) => {
    try {
        // Extract conversation state from user or create a new one
        const conversationState = user.conversationState || { stage: 'initial' };

        // Create system prompt based on conversation stage
        const systemPrompt = getSystemPrompt(conversationState);

        // Get completion from OpenRouter with Llama or another open-source model
        const openRouterResponse = await axios.post(
            'https://openrouter.ai/api/v1/chat/completions',
            {
                model: process.env.LLM_MODEL || "meta-llama/llama-3-8b-instruct", // Default to Llama 3 8B
                messages: [
                    {
                        role: "system",
                        content: systemPrompt + "\n\nIMPORTANT: You must only respond with valid JSON in the exact format specified. Do not include any explanatory text, markdown formatting, or code blocks. Just output the JSON object directly."
                    },
                    { role: "user", content: messageText }
                ],
                temperature: 0.3, // Lower temperature for more predictable outputs
                response_format: { type: "json_object" },
                max_tokens: 500 // Limit token length to avoid verbose responses
            },
            {
                headers: {
                    'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
                    'HTTP-Referer': process.env.APP_URL, // Required by OpenRouter
                    'X-Title': 'Reminder System', // Optional
                    'Content-Type': 'application/json'
                }
            }
        );

        // Parse response with error handling
        let response;
        try {
            const responseContent = openRouterResponse.data.choices[0].message.content;
            console.log('Raw LLM response:', responseContent);

            // Try to extract JSON if it's wrapped in text or code blocks
            let jsonContent = responseContent;

            // Check if response contains JSON inside ```json blocks
            const jsonBlockMatch = responseContent.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
            if (jsonBlockMatch && jsonBlockMatch[1]) {
                jsonContent = jsonBlockMatch[1];
            }
            // Check if response has { and } and extract what's between them
            else if (!jsonContent.trim().startsWith('{')) {
                const jsonMatch = responseContent.match(/(\{[\s\S]*\})/);
                if (jsonMatch && jsonMatch[1]) {
                    jsonContent = jsonMatch[1];
                }
            }

            response = JSON.parse(jsonContent);
            console.log('Parsed JSON response:', response);
        } catch (parseError) {
            console.error('Error parsing LLM response:', parseError);
            console.log('Attempting to create a fallback response');

            // Create a fallback response to avoid crashing
            response = {
                type: "not_reminder",
                content: "unrecognized message format"
            };

            // If the message looks like it's about a reminder, use incomplete_reminder
            if (messageText.toLowerCase().includes('remind') ||
                messageText.toLowerCase().includes('tomorrow') ||
                messageText.toLowerCase().includes('today')) {
                response = {
                    type: "incomplete_reminder",
                    content: messageText,
                    date: null,
                    time: null,
                    missing: ["date", "time"]
                };
            }
        }

        // Process the response based on what we received
        await handleNlpResponse(user, response, conversationState);

    } catch (error) {
        console.error('Error processing message with NLP:', error);
        // Send error message to user
        await whatsappService.sendMessage(
            user.phoneNumber,
            "I'm having trouble understanding that. Could you please try again?"
        );
    }
};

/**
 * Get appropriate system prompt based on conversation state
 */
const getSystemPrompt = (conversationState) => {
    switch (conversationState.stage) {
        case 'followup_datetime':
            return `You are a helpful reminder assistant. The user has previously requested a reminder for: "${conversationState.content}". 
              You need to extract the date and time for this reminder.
              ALWAYS format dates as YYYY-MM-DD (e.g., 2025-03-23) and times in 24-hour format as HH:MM (e.g., 09:00 or 14:30).
              For relative dates like "tomorrow" or "next Monday", convert them to the actual date.
              
              Respond with JSON in this format: 
              { 
                "type": "reminder_datetime", 
                "date": "YYYY-MM-DD", 
                "time": "HH:MM", 
                "timezone": "user timezone or UTC" 
              }
              
              If you cannot determine the date or time, respond with: 
              { 
                "type": "unclear_datetime", 
                "missing": ["date", "time", or both] 
              }`;

        case 'followup_content':
            return `You are a helpful reminder assistant. The user has previously specified a reminder for date: ${conversationState.date} and time: ${conversationState.time}.
              You need to extract what the reminder is for.
              Respond with JSON in this format: { "type": "reminder_content", "content": "what the reminder is for" }`;

        case 'initial':
        default:
            return `You are a helpful reminder assistant. Extract reminder information from user messages.
              ALWAYS format dates as YYYY-MM-DD (e.g., 2025-03-23) and times in 24-hour format as HH:MM (e.g., 09:00 or 14:30).
              For relative dates like "tomorrow" or "next Monday", convert them to the actual date.
              Today's date is ${format(new Date(), 'yyyy-MM-dd')}.
              
              Respond with JSON in this format:
              { 
                "type": "reminder", 
                "content": "what the reminder is for", 
                "date": "YYYY-MM-DD", 
                "time": "HH:MM",
                "recurrence": "none|daily|weekly|monthly" 
              }
              If reminder information is incomplete, respond with: 
              { 
                "type": "incomplete_reminder", 
                "content": "what you understood of the content or null", 
                "date": "YYYY-MM-DD or null", 
                "time": "HH:MM or null",
                "missing": ["content", "date", "time"] 
              }
              If the message is not a reminder request, respond with:
              { "type": "not_reminder", "content": "brief description of user's message" }`;
    }
};

/**
 * Handle the parsed NLP response based on its type
 */
const handleNlpResponse = async (user, response, conversationState) => {
    // Update the last processed message timestamp
    user.lastInteraction = new Date();

    switch (response.type) {
        case 'reminder':
            // Complete reminder information
            await createReminderFromResponse(user, response);
            break;

        case 'incomplete_reminder':
            // Handle incomplete reminder info
            await handleIncompleteReminder(user, response);
            break;

        case 'reminder_datetime':
            // Handle datetime followup
            if (conversationState.stage === 'followup_datetime') {
                await handleDateTimeFollowup(user, response, conversationState);
            }
            break;

        case 'reminder_content':
            // Handle content followup
            if (conversationState.stage === 'followup_content') {
                await handleContentFollowup(user, response, conversationState);
            }
            break;

        case 'unclear_datetime':
            // Handle unclear datetime response
            await handleUnclearDateTime(user, response, conversationState);
            break;

        case 'not_reminder':
            // Handle non-reminder message
            await handleNonReminderMessage(user, response);
            break;

        default:
            // Unrecognized response type
            await whatsappService.sendMessage(
                user.phoneNumber,
                "I'm not sure how to help with that. Would you like to set a reminder?"
            );
            // Reset conversation state
            user.conversationState = { stage: 'initial' };
    }

    // Save updated user with new conversation state
    await user.save();
};

/**
 * Create a reminder from complete information with proper timezone handling
 */
const createReminderFromResponse = async (user, response) => {
    try {
        // Ensure date and time are valid before proceeding
        if (!response.date || !response.time) {
            throw new Error('Missing date or time for reminder');
        }

        // Double check that content exists
        if (!response.content) {
            console.error('Missing content for reminder');
            throw new Error('Reminder content is required');
        }

        // Get user's timezone
        const userTimeZone = user.timeZone || 'Asia/Kolkata';  // Default to India timezone

        // Properly parse the date and time with timezone
        let scheduledDateTime;
        try {
            console.log(`Parsing date: ${response.date} and time: ${response.time} in timezone: ${userTimeZone}`);

            // Create date parts
            const [hours, minutes] = response.time.split(':').map(Number);
            const [year, month, day] = response.date.split('-').map(Number);

            // Create date in user's local timezone
            // Note: month is 0-indexed in JavaScript Date
            const localDate = new Date(year, month - 1, day, hours, minutes);
            console.log(`Created local date: ${localDate.toString()}`);

            // No timezone conversion needed - we're already creating the date
            // in the user's timezone context
            scheduledDateTime = localDate;

            // Validate the date
            if (isNaN(scheduledDateTime.valueOf())) {
                throw new Error('Invalid date format');
            }

            console.log(`Final scheduled date time: ${scheduledDateTime.toString()}`);

            // Check if the date is in the past
            const now = new Date();
            if (scheduledDateTime < now) {
                // If it's today and the time has passed, move to tomorrow
                const today = new Date();
                if (scheduledDateTime.getDate() === today.getDate() &&
                    scheduledDateTime.getMonth() === today.getMonth() &&
                    scheduledDateTime.getFullYear() === today.getFullYear()) {

                    scheduledDateTime.setDate(scheduledDateTime.getDate() + 1);
                    console.log(`Date was today but in past, adjusted to tomorrow: ${scheduledDateTime.toString()}`);
                }
            }
        } catch (dateError) {
            console.error('Error parsing date:', dateError);
            throw new Error('Could not parse reminder date and time');
        }

        // Create the reminder with validated date
        const reminder = await reminderService.createReminder({
            user: user._id,
            content: response.content,
            scheduledFor: scheduledDateTime,
            recurrence: response.recurrence || 'none',
            notificationMethod: user.preferredNotificationMethod
        });

        // Format date for user-friendly message
        // Use a specific format string that won't cause issues
        const formattedDate = format(scheduledDateTime, 'EEEE, MMMM do');
        const formattedTime = format(scheduledDateTime, 'h:mm a');
        const scheduledDate = `${formattedDate} at ${formattedTime}`;

        // Send confirmation message
        await whatsappService.sendMessage(
            user.phoneNumber,
            `✅ Reminder set for ${scheduledDate}: "${response.content}"`
        );

        // Reset conversation state
        user.conversationState = { stage: 'initial' };
    } catch (error) {
        console.error('Error creating reminder:', error);

        // If the error was due to missing time, update conversation state
        // to expect a follow-up with the time
        if (error.message === 'Missing date or time for reminder' && response.content) {
            // Set the state to follow up for datetime but preserve the content
            user.conversationState = {
                stage: 'followup_datetime',
                content: response.content
            };

            await whatsappService.sendMessage(
                user.phoneNumber,
                `What time would you like to be reminded to ${response.content}?`
            );
        } else {
            // For other errors, use the generic message
            await whatsappService.sendMessage(
                user.phoneNumber,
                "I had trouble setting your reminder. Please try again with a specific date and time, like 'tomorrow at 9am'."
            );
        }
    }
};

/**
 * Handle incomplete reminder information
 */
const handleIncompleteReminder = async (user, response) => {
    // Determine what's missing and ask appropriate follow-up
    const missing = response.missing || [];

    // Save the content properly in conversation state
    const reminderContent = response.content || null;

    if (missing.includes('date') || missing.includes('time')) {
        // Missing date/time info
        await whatsappService.sendMessage(
            user.phoneNumber,
            `When would you like to be reminded${reminderContent ? ` about "${reminderContent}"` : ''}?`
        );

        // Update conversation state with the content
        user.conversationState = {
            stage: 'followup_datetime',
            content: reminderContent  // Make sure to store the content
        };

        console.log("Stored content in conversation state:", reminderContent);
    } else if (missing.includes('content')) {
        // Missing reminder content
        await whatsappService.sendMessage(
            user.phoneNumber,
            `What would you like to be reminded about on ${response.date} at ${response.time}?`
        );

        // Update conversation state
        user.conversationState = {
            stage: 'followup_content',
            date: response.date,
            time: response.time
        };
    }
};


/**
 * Handle datetime followup
 */
const handleDateTimeFollowup = async (user, response, conversationState) => {
    if (response.date && response.time) {
        // Log the conversation state to debug
        console.log("Current conversation state:", conversationState);

        // Make sure we have the content from the conversation state
        const reminderContent = conversationState.content || "Untitled reminder";

        console.log("Creating reminder with content:", reminderContent);

        // We now have date and time
        await createReminderFromResponse(user, {
            type: 'reminder',
            content: reminderContent, // Use the content saved in conversation state
            date: response.date,
            time: response.time,
            recurrence: 'none'
        });
    } else {
        // Still missing information
        await handleUnclearDateTime(user, response, conversationState);
    }
};

/**
 * Handle content followup
 */
const handleContentFollowup = async (user, response, conversationState) => {
    if (response.content) {
        // We now have the content
        await createReminderFromResponse(user, {
            type: 'reminder',
            content: response.content,
            date: conversationState.date,
            time: conversationState.time,
            recurrence: 'none'
        });
    } else {
        // Still missing content
        await whatsappService.sendMessage(
            user.phoneNumber,
            "I need to know what you want to be reminded about. Please provide a brief description."
        );
    }
};

/**
 * Handle unclear datetime information
 */
const handleUnclearDateTime = async (user, response, conversationState) => {
    const missing = response.missing || [];
    let message = "I need more information about when you want to be reminded.";

    if (missing.includes('date') && missing.includes('time')) {
        message = "Please provide both a date and time for your reminder.";
    } else if (missing.includes('date')) {
        message = "Please specify what date you want to be reminded.";
    } else if (missing.includes('time')) {
        message = "Please specify what time you want to be reminded.";
    }

    await whatsappService.sendMessage(user.phoneNumber, message);
};

/**
 * Handle non-reminder messages
 */
const handleNonReminderMessage = async (user, response) => {
    // Simple responses for common non-reminder queries
    const message = "I'm your reminder assistant. Would you like to set a reminder? Just tell me what you need to be reminded about and when.";
    await whatsappService.sendMessage(user.phoneNumber, message);

    // Reset conversation state
    user.conversationState = { stage: 'initial' };
};

module.exports = {
    processUserMessage
};