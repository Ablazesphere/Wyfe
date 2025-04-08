// src/services/nlpService.js

const axios = require('axios');
const { format, parse, parseISO, addHours, addMinutes } = require('date-fns');
const { zonedTimeToUtc, utcToZonedTime } = require('date-fns-tz');
const whatsappService = require('./whatsappService');
const reminderService = require('./reminderService');
const dateParserService = require('./dateParserService');
const userPreferenceService = require('./userPreferenceService');
const validationService = require('./validationService');


const processUserMessage = async (user, messageText) => {
    try {
        // Extract conversation state from user or create a new one
        const conversationState = user.conversationState || { stage: 'initial' };

        // Create system prompt based on conversation stage
        const systemPrompt = getSystemPrompt(conversationState);

        // Extract recurrence pattern directly using the recurrence parser
        const recurrenceParserService = require('./recurrenceParserService');

        // Check if message actually contains recurrence-related keywords before parsing
        const containsRecurrenceKeywords = containsRecurrenceTerms(messageText);

        // Only get recurrence info if the message potentially contains recurrence terms
        const recurrenceInfo = containsRecurrenceKeywords ?
            recurrenceParserService.parseRecurrencePattern(messageText) : null;

        // Get completion from OpenRouter with Llama or another open-source model
        const openRouterResponse = await axios.post(
            'https://openrouter.ai/api/v1/chat/completions',
            {
                model: process.env.LLM_MODEL || "meta-llama/llama-3-8b-instruct",
                messages: [
                    {
                        role: "system",
                        content: systemPrompt + "\n\nIMPORTANT: You must only respond with valid JSON in the exact format specified. Do not include any explanatory text, markdown formatting, or code blocks. Just output the JSON object directly."
                    },
                    { role: "user", content: messageText }
                ],
                temperature: 0.3,
                response_format: { type: "json_object" },
                max_tokens: 500
            },
            {
                headers: {
                    'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
                    'HTTP-Referer': process.env.APP_URL,
                    'X-Title': 'Reminder System',
                    'Content-Type': 'application/json'
                }
            }
        );

        // Parse response with error handling
        let nlpResponse;
        try {
            const responseContent = openRouterResponse.data.choices[0].message.content;
            console.log('Raw LLM response:', responseContent);

            // Try to extract JSON if it's wrapped in text or code blocks
            let jsonContent = responseContent.trim();

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

            nlpResponse = JSON.parse(jsonContent);
            console.log('Parsed JSON response:', nlpResponse);

            // Check for multiple days of week pattern
            if (nlpResponse.type === 'reminder') {
                const lowerMessage = messageText.toLowerCase();

                // Map of day names to numbers
                const daysOfWeek = {
                    'sunday': 0,
                    'monday': 1,
                    'tuesday': 2,
                    'wednesday': 3,
                    'thursday': 4,
                    'friday': 5,
                    'saturday': 6
                };

                // Check for day name mentions
                let mentionedDays = [];

                for (const [dayName, dayNum] of Object.entries(daysOfWeek)) {
                    if (lowerMessage.includes(dayName)) {
                        mentionedDays.push(dayNum);
                    }
                }

                // If multiple days mentioned, update the recurrence pattern
                if (mentionedDays.length > 1) {
                    console.log(`Detected multiple days of week: ${mentionedDays}`);

                    if (!nlpResponse.recurrencePattern) {
                        nlpResponse.recurrencePattern = {};
                    }

                    nlpResponse.recurrence = 'custom';
                    nlpResponse.recurrencePattern.frequency = 'week';
                    nlpResponse.recurrencePattern.interval = 1;
                    nlpResponse.recurrencePattern.daysOfWeek = mentionedDays;

                    // Remove the single dayOfWeek if it was set
                    if (nlpResponse.recurrencePattern.dayOfWeek !== undefined) {
                        delete nlpResponse.recurrencePattern.dayOfWeek;
                    }
                }
            }

            // FIXED: Only merge with recurrence info if the message actually contains recurrence terms
            // and the LLM didn't already identify a recurrence pattern
            if (nlpResponse.type === 'reminder' && containsRecurrenceKeywords &&
                recurrenceInfo && recurrenceInfo.recurrence &&
                (nlpResponse.recurrence === 'none' || !nlpResponse.recurrence)) {

                nlpResponse.recurrence = recurrenceInfo.recurrence;
                nlpResponse.recurrencePattern = recurrenceInfo.recurrencePattern;

                if (recurrenceInfo.endDate) {
                    nlpResponse.endDate = recurrenceInfo.endDate;
                }

                console.log('Enhanced with recurrence info:', nlpResponse);
            }

        } catch (parseError) {
            console.error('Error parsing LLM response:', parseError);
            console.log('Attempting to create a fallback response');

            // Create a fallback response to avoid crashing
            nlpResponse = {
                type: "not_reminder",
                content: "unrecognized message format"
            };

            // If the message looks like it's about a reminder, use incomplete_reminder
            if (messageText.toLowerCase().includes('remind') ||
                messageText.toLowerCase().includes('tomorrow') ||
                messageText.toLowerCase().includes('today')) {
                nlpResponse = {
                    type: "incomplete_reminder",
                    content: messageText,
                    date: null,
                    time: null,
                    missing: ["date", "time"]
                };
            }
        }

        // Process the response based on what we received
        await handleNlpResponse(user, nlpResponse, conversationState, messageText);

    } catch (error) {
        console.error('Error processing message with NLP:', error);
        // Send error message to user
        await whatsappService.sendMessage(
            user.phoneNumber,
            "I'm having trouble understanding that. Could you please try again?"
        );
    }
};

// Add a helper function to check if a message contains recurrence-related terms
function containsRecurrenceTerms(message) {
    if (!message) return false;

    const lowerMessage = message.toLowerCase();

    // List of terms that indicate recurrence intent
    const recurrenceTerms = [
        'every', 'daily', 'weekly', 'monthly', 'yearly',
        'each', 'repeat', 'recurring', 'recur',
        'mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun',
        'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'
    ];

    // Check if the message contains terms like "every X" where X is day/week/month
    const hasEveryPattern = /\bevery\s+(day|week|month|year|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(lowerMessage);

    if (hasEveryPattern) return true;

    // Check for other recurrence terms
    const recurrenceTermFound = recurrenceTerms.some(term => {
        // Use word boundary to ensure we match whole words
        const regex = new RegExp(`\\b${term}\\b`, 'i');
        return regex.test(lowerMessage);
    });

    // Check for "every X days/weeks/months" patterns
    const everyXPattern = /\bevery\s+\d+\s+(day|days|week|weeks|month|months)\b/i.test(lowerMessage);

    // Only daily/weekly/monthly on its own is not enough - need context
    if (recurrenceTermFound && !['daily', 'weekly', 'monthly'].includes(lowerMessage.trim())) {
        return true;
    }

    return everyXPattern;
}

/**
 * Get appropriate system prompt based on conversation state
 */
/**
 * Get appropriate system prompt based on conversation state
 */
const getSystemPrompt = (conversationState) => {
    switch (conversationState.stage) {
        case 'followup_datetime':
            return `You are a helpful reminder assistant. The user has previously requested a reminder for: "${conversationState.content}". 
                You need to extract the date and time for this reminder.
                
                For dates, extract in one of these formats:
                - YYYY-MM-DD (e.g., 2025-03-23) for specific dates
                - "today", "tomorrow" for relative dates
                - "next Monday", "next week" for day references
                - "in 3 days", "in 2 weeks" for duration-based dates
                
                For times, extract in one of these formats:
                - HH:MM in 24-hour format (e.g., 09:00 or 14:30) for specific times
                - Or include a timeReference like "morning", "afternoon", "evening", "night"
                
                Respond with JSON in this format: 
                { 
                  "type": "reminder_datetime", 
                  "date": "YYYY-MM-DD or relative date expression", 
                  "time": "HH:MM or null if using timeReference", 
                  "timeReference": "morning/afternoon/evening/night (if applicable)",
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

        case 'reschedule_confirmation':
        case 'conflict_resolution':
            return `You are a helpful reminder assistant. The user is responding to a question about a reminder.
                
                If the response indicates agreement (yes, sure, okay, fine, that works, go ahead, etc.), respond with:
                { "type": "confirmation", "confirmed": true }
                
                If the response indicates disagreement (no, don't, I'll choose another time, let me pick another time, etc.), respond with:
                { "type": "confirmation", "confirmed": false }
                
                For any other response type, try to determine if it's more likely an agreement or disagreement.`;

        case 'delete_reminder_selection':
            return `You are a helpful reminder assistant. The user is selecting a reminder to delete.
                
                If the response contains a number (e.g., "the first one", "number 2", "3"), respond with:
                { "type": "selection", "index": [number-1] }
                
                If the response describes a reminder by content instead of number, respond with:
                { "type": "selection", "content": "the content mentioned" }
                
                If you cannot determine which reminder they want to delete, respond with:
                { "type": "unclear_selection", "message": "I couldn't determine which reminder you want to delete" }`;

        case 'update_reminder_selection':
            return `You are a helpful reminder assistant. The user is selecting a reminder to update.
                
                If the response contains a number (e.g., "the first one", "number 2", "3"), respond with:
                { "type": "selection", "index": [number-1] }
                
                If the response describes a reminder by content instead of number, respond with:
                { "type": "selection", "content": "the content mentioned" }
                
                If you cannot determine which reminder they want to update, respond with:
                { "type": "unclear_selection", "message": "I couldn't determine which reminder you want to update" }`;

        case 'initial':
        default:
            return `You are a helpful reminder assistant. Extract reminder information from user messages.
                
                For dates, extract in one of these formats:
                - YYYY-MM-DD (e.g., 2025-03-23) for specific dates
                - "today", "tomorrow" for relative dates
                - "next Monday", "next week" for day references
                - "in 3 days", "in 2 weeks" for duration-based dates
                
                For times, extract in one of these formats:
                - HH:MM in 24-hour format (e.g., 09:00 or 14:30) for specific times
                - Or include a timeReference like "morning", "afternoon", "evening", "night"

                For relative times like "in X minutes" or "in X hours", extract as:
                { "relativeTime": { "unit": "minutes|hours", "amount": X } }
                
                For recurrence patterns, extract details like:
                - "daily", "weekly", "monthly" for simple recurrence
                - For complex patterns like "every other Tuesday until December", extract as:
                {
                  "recurrenceType": "custom",
                  "pattern": {
                    "frequency": "week",
                    "interval": 2,  // 1 = every, 2 = every other, 3 = every third, etc.
                    "dayOfWeek": 2  // 0 = Sunday, 1 = Monday, 2 = Tuesday, etc.
                  },
                  "endDate": "2025-12-31"  // Extract end date if specified
                }
                
                Today's date is ${format(new Date(), 'yyyy-MM-dd')}.
                
                If the message is asking to create a reminder, respond with:
                { 
                  "type": "reminder", 
                  "content": "what the reminder is for", 
                  "date": "YYYY-MM-DD or relative date expression", 
                  "time": "HH:MM or null if using timeReference", 
                  "timeReference": "morning/afternoon/evening/night (if applicable)",
                  "recurrence": "none|daily|weekly|monthly|custom",
                  "recurrencePattern": { // Only if recurrence is "custom"
                    "frequency": "day|week|month|year",
                    "interval": 1, // 1 = every, 2 = every other, etc.
                    "dayOfWeek": 0-6, // 0 = Sunday, etc., null if not applicable
                    "dayOfMonth": 1-31, // null if not applicable
                    "monthOfYear": 0-11 // 0 = January, etc., null if not applicable
                  },
                  "endDate": "YYYY-MM-DD or null" // End date for recurrence if specified
                }
                
                If reminder information is incomplete, respond with: 
                { 
                  "type": "incomplete_reminder", 
                  "content": "what you understood of the content or null", 
                  "date": "extracted date or null", 
                  "time": "extracted time or null",
                  "timeReference": "extracted time reference or null",
                  "missing": ["content", "date", "time"] 
                }
                
                If the message is asking to see, list, or view reminders, respond with:
                { "type": "list_reminders", "filter": "all|today|week|specific content" }
                
                If the message is asking to delete or cancel a reminder, respond with:
                { "type": "delete_reminder", "identifierType": "content|id", "identifier": "the content or id" }
                
                If the message is asking to update or change a reminder, respond with:
                { "type": "update_reminder", "identifierType": "content|id", "identifier": "the content or id", "updates": {"date": "new date", "time": "new time", "content": "new content"} }
                
                If the message is about setting or getting user preferences, respond with:
                { 
                  "type": "preference", 
                  "action": "set|get", 
                  "preferenceType": "timezone|time_reference|notification_method", 
                  "value": "the preference value or reference object" 
                }
                
                Examples of preference queries:
                - "What time is morning for me?" → { "type": "preference", "action": "get", "preferenceType": "time_reference", "value": {"reference": "morning"} }
                - "What time has been set for evening?" → { "type": "preference", "action": "get", "preferenceType": "time_reference", "value": {"reference": "evening"} }
                - "What's my current timezone?" → { "type": "preference", "action": "get", "preferenceType": "timezone", "value": null }
                - "Show me my time preferences" → { "type": "preference", "action": "get", "preferenceType": "time_reference", "value": {"reference": "all"} }
                
                For time references, parse as:
                { 
                  "type": "preference", 
                  "action": "set", 
                  "preferenceType": "time_reference", 
                  "value": {
                    "reference": "morning|afternoon|evening|night", 
                    "hour": 9, 
                    "minute": 0
                  }
                }
                
                If the message is not a reminder-related request, respond with:
                { "type": "not_reminder", "content": "brief description of user's message" }`;
    }
};

/**
 * Handle the parsed NLP response based on its type
 * @param {Object} user - The user document
 * @param {Object} response - The parsed NLP response
 * @param {Object} conversationState - The current conversation state
 * @param {String} messageText - The original message text from user
 */
const handleNlpResponse = async (user, response, conversationState, messageText = '') => {
    // Update the last processed message timestamp
    user.lastInteraction = new Date();

    switch (response.type) {
        case 'reminder':
            // Complete reminder information
            await createReminderFromResponse(user, response, messageText);
            break;


        case 'list_reminders':
            await handleListReminders(user, response);
            break;

        case 'delete_reminder':
            await handleDeleteReminder(user, response);
            break;

        case 'update_reminder':
            await handleUpdateReminder(user, response);
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

        case 'preference':
            await userPreferenceService.handlePreferenceCommand(user, response);
            break;

        case 'confirmation':
            // This is a response to a previous question requiring confirmation
            if (conversationState.stage === 'reschedule_confirmation') {
                await handleRescheduleConfirmation(user, response);
            } else if (conversationState.stage === 'conflict_resolution') {
                await handleConflictResolution(user, response);
            }
            break;

        case 'date_clarification':
            await handleDateClarification(user, response, conversationState);
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


const handleDateClarification = async (user, response, conversationState) => {
    // Check if the response indicates today or next week
    const isToday = response.content?.toLowerCase().includes('today') ||
        response.content?.toLowerCase().includes('this');

    const isNextWeek = response.content?.toLowerCase().includes('next');

    // Choose the appropriate date
    let scheduledDate;
    if (isNextWeek) {
        scheduledDate = conversationState.nextWeekOption;
    } else {
        scheduledDate = conversationState.todayOption;
    }

    // Create the reminder with the clarified date
    await createReminderFromResponse(user, {
        type: 'reminder',
        content: conversationState.content,
        date: format(scheduledDate, 'yyyy-MM-dd'),
        time: conversationState.time,
        timeReference: conversationState.timeReference,
        recurrence: 'none'
    });
};

/**
 * Handle response to rescheduling suggestion
 */
const handleRescheduleConfirmation = async (user, response) => {
    const { content, suggestedDate } = user.conversationState;

    if (response.confirmed) {
        // User accepted the suggested rescheduling
        try {
            const reminder = await reminderService.createReminder({
                user: user._id,
                content: content,
                scheduledFor: new Date(suggestedDate),
                recurrence: 'none',
                notificationMethod: user.preferredNotificationMethod
            });

            // Format date for user-friendly message
            const scheduledDate = dateParserService.formatDateForDisplay(new Date(suggestedDate));

            // Send confirmation message
            await whatsappService.sendMessage(
                user.phoneNumber,
                `✅ Reminder set for ${scheduledDate}: "${content}"`
            );
        } catch (error) {
            console.error('Error creating rescheduled reminder:', error);
            await whatsappService.sendMessage(
                user.phoneNumber,
                "I had trouble setting your reminder. Please try again."
            );
        }
    } else {
        // User rejected the suggestion
        await whatsappService.sendMessage(
            user.phoneNumber,
            "No problem. Please specify a different date and time for your reminder."
        );

        // Update conversation state to await new date/time
        user.conversationState = {
            stage: 'followup_datetime',
            content: content
        };

        return;
    }

    // Reset conversation state
    user.conversationState = { stage: 'initial' };
};

/**
 * Handle response to conflict resolution
 */
const handleConflictResolution = async (user, response) => {
    const { content, scheduledFor } = user.conversationState;

    if (response.confirmed) {
        // User wants to schedule despite the conflict
        try {
            const reminder = await reminderService.createReminder({
                user: user._id,
                content: content,
                scheduledFor: new Date(scheduledFor),
                recurrence: 'none',
                notificationMethod: user.preferredNotificationMethod
            });

            // Format date for user-friendly message
            const scheduledDate = dateParserService.formatDateForDisplay(new Date(scheduledFor));

            // Send confirmation message
            await whatsappService.sendMessage(
                user.phoneNumber,
                `✅ Reminder set for ${scheduledDate}: "${content}"`
            );
        } catch (error) {
            console.error('Error creating reminder with conflict:', error);
            await whatsappService.sendMessage(
                user.phoneNumber,
                "I had trouble setting your reminder. Please try again."
            );
        }
    } else {
        // User wants to avoid the conflict
        await whatsappService.sendMessage(
            user.phoneNumber,
            "No problem. Please specify a different date and time for your reminder."
        );

        // Update conversation state to await new date/time
        user.conversationState = {
            stage: 'followup_datetime',
            content: content
        };

        return;
    }

    // Reset conversation state
    user.conversationState = { stage: 'initial' };
};

/**
 * Handle request to list reminders
 */
const handleListReminders = async (user, response) => {
    try {
        const filter = response.filter || 'all';
        const now = new Date();
        let reminders;

        // Apply filtering
        if (filter === 'today') {
            const endOfDay = new Date(now);
            endOfDay.setHours(23, 59, 59, 999);

            reminders = await reminderService.getRemindersInRange(
                user._id,
                now,
                endOfDay
            );
        } else if (filter === 'week') {
            const endOfWeek = new Date(now);
            endOfWeek.setDate(now.getDate() + 7);

            reminders = await reminderService.getRemindersInRange(
                user._id,
                now,
                endOfWeek
            );
        } else if (filter === 'all') {
            reminders = await reminderService.getUserReminders(user._id);
        } else {
            // Content-based filter
            reminders = await reminderService.searchRemindersByContent(
                user._id,
                filter
            );
        }

        if (reminders.length === 0) {
            await whatsappService.sendMessage(
                user.phoneNumber,
                `You don't have any ${filter !== 'all' ? filter + ' ' : ''}reminders.`
            );
            return;
        }

        // Format reminders for display
        let message = `Here are your ${filter !== 'all' ? filter + ' ' : ''}reminders:\n\n`;

        reminders.forEach((reminder, index) => {
            const date = dateParserService.formatDateForDisplay(reminder.scheduledFor);
            message += `${index + 1}. ${reminder.content} - ${date}\n`;
        });

        // Add instructions for management
        message += "\nTo cancel a reminder, say: 'Cancel my [reminder content]'";

        await whatsappService.sendMessage(user.phoneNumber, message);
    } catch (error) {
        console.error('Error listing reminders:', error);
        await whatsappService.sendMessage(
            user.phoneNumber,
            "I had trouble retrieving your reminders. Please try again."
        );
    }
};

/**
 * Handle request to delete a reminder
 */
const handleDeleteReminder = async (user, response) => {
    try {
        const { identifierType, identifier } = response;
        let reminder;

        if (identifierType === 'content') {
            // Find by content similarity
            const reminders = await reminderService.searchRemindersByContent(
                user._id,
                identifier
            );

            if (reminders.length === 0) {
                await whatsappService.sendMessage(
                    user.phoneNumber,
                    `I couldn't find a reminder about "${identifier}".`
                );
                return;
            } else if (reminders.length > 1) {
                // Multiple matches found, ask user to be more specific
                let message = "I found multiple matching reminders. Please specify which one to cancel:\n\n";

                reminders.forEach((reminder, index) => {
                    const date = dateParserService.formatDateForDisplay(reminder.scheduledFor);
                    message += `${index + 1}. "${reminder.content}" - ${date}\n`;
                });

                // Set conversation state for follow-up
                user.conversationState = {
                    stage: 'delete_reminder_selection',
                    reminders: reminders.map(r => r._id.toString())
                };

                await whatsappService.sendMessage(user.phoneNumber, message);
                return;
            }

            // Single match found
            reminder = reminders[0];
        } else if (identifierType === 'id') {
            // Direct ID reference (from a previous list or selection)
            reminder = await reminderService.getReminderById(identifier);

            if (!reminder || reminder.user.toString() !== user._id.toString()) {
                await whatsappService.sendMessage(
                    user.phoneNumber,
                    "I couldn't find that reminder."
                );
                return;
            }
        }

        // Delete the reminder
        await reminderService.deleteReminder(reminder._id);

        // Confirm deletion
        await whatsappService.sendMessage(
            user.phoneNumber,
            `✅ Reminder "${reminder.content}" has been cancelled.`
        );

        // Reset conversation state
        user.conversationState = { stage: 'initial' };
    } catch (error) {
        console.error('Error deleting reminder:', error);
        await whatsappService.sendMessage(
            user.phoneNumber,
            "I had trouble cancelling that reminder. Please try again."
        );
    }
};

/**
 * Handle request to update a reminder with improved content matching
 */
const handleUpdateReminder = async (user, response) => {
    try {
        const { identifierType, identifier, updates } = response;
        let reminder;

        if (identifierType === 'content') {
            // Use the enhanced similarity search from before
            const reminders = await reminderService.searchRemindersByContent(
                user._id,
                identifier
            );

            if (reminders.length === 0) {
                // If direct search fails, try a more lenient search
                const allReminders = await reminderService.getUserReminders(user._id);

                // Try to find a fuzzy match
                const possibleMatches = allReminders.filter(r => {
                    const content = r.content.toLowerCase();
                    const searchTerm = identifier.toLowerCase();

                    // Calculate word similarity
                    const contentWords = content.split(/\s+/);
                    const searchWords = searchTerm.split(/\s+/);

                    // Check for word overlap, including stemming
                    let matchCount = 0;
                    for (const searchWord of searchWords) {
                        if (contentWords.some(word =>
                            word.includes(searchWord) ||
                            searchWord.includes(word) ||
                            // Remove common endings for comparison
                            word.replace(/ing$|s$|ed$/, '') === searchWord.replace(/ing$|s$|ed$/, '')
                        )) {
                            matchCount++;
                        }
                    }

                    // Consider it a match if at least half the words match
                    return matchCount >= Math.ceil(searchWords.length / 2);
                });

                if (possibleMatches.length === 0) {
                    await whatsappService.sendMessage(
                        user.phoneNumber,
                        `I couldn't find a reminder about "${identifier}".`
                    );
                    return;
                }

                // Use the fuzzy matches
                if (possibleMatches.length === 1) {
                    reminder = possibleMatches[0];
                } else {
                    // Multiple matches found, ask user to be more specific
                    let message = "I found multiple matching reminders. Please specify which one to update:\n\n";

                    possibleMatches.forEach((reminder, index) => {
                        const date = dateParserService.formatDateForDisplay(reminder.scheduledFor);
                        message += `${index + 1}. "${reminder.content}" - ${date}\n`;
                    });

                    // Set conversation state for follow-up
                    user.conversationState = {
                        stage: 'update_reminder_selection',
                        reminders: possibleMatches.map(r => r._id.toString()),
                        updates
                    };

                    await whatsappService.sendMessage(user.phoneNumber, message);
                    return;
                }
            } else if (reminders.length > 1) {
                // Multiple matches found, ask user to be more specific
                let message = "I found multiple matching reminders. Please specify which one to update:\n\n";

                reminders.forEach((reminder, index) => {
                    const date = dateParserService.formatDateForDisplay(reminder.scheduledFor);
                    message += `${index + 1}. "${reminder.content}" - ${date}\n`;
                });

                // Set conversation state for follow-up with the update info
                user.conversationState = {
                    stage: 'update_reminder_selection',
                    reminders: reminders.map(r => r._id.toString()),
                    updates
                };

                await whatsappService.sendMessage(user.phoneNumber, message);
                return;
            }

            // Single match found
            reminder = reminders[0];
        } else if (identifierType === 'id') {
            // Direct ID reference (from a previous list or selection)
            reminder = await reminderService.getReminderById(identifier);

            if (!reminder || reminder.user.toString() !== user._id.toString()) {
                await whatsappService.sendMessage(
                    user.phoneNumber,
                    "I couldn't find that reminder."
                );
                return;
            }
        }

        // Process updates
        let updatedFields = {};

        if (updates.content) {
            updatedFields.content = updates.content;
        }

        if (updates.date || updates.time || updates.timeReference) {
            // Parse new date/time if provided
            try {
                const dateTimeInfo = {
                    date: updates.date || format(reminder.scheduledFor, 'yyyy-MM-dd'),
                    time: updates.time || format(reminder.scheduledFor, 'HH:mm'),
                    timeReference: updates.timeReference
                };

                const newDateTime = await dateParserService.parseDateTime(
                    dateTimeInfo,
                    user._id,
                    user.timeZone || 'Asia/Kolkata'
                );

                updatedFields.scheduledFor = newDateTime;
            } catch (error) {
                await whatsappService.sendMessage(
                    user.phoneNumber,
                    "I couldn't understand the new date or time. Please try again."
                );
                return;
            }
        }

        // Update the reminder
        const updatedReminder = await reminderService.updateReminder(
            reminder._id,
            updatedFields
        );

        // Confirm update
        const formattedDate = dateParserService.formatDateForDisplay(updatedReminder.scheduledFor);

        await whatsappService.sendMessage(
            user.phoneNumber,
            `✅ Reminder updated: "${updatedReminder.content}" - ${formattedDate}`
        );

        // Reset conversation state
        user.conversationState = { stage: 'initial' };
    } catch (error) {
        console.error('Error updating reminder:', error);
        await whatsappService.sendMessage(
            user.phoneNumber,
            "I had trouble updating that reminder. Please try again."
        );
    }
};

/**
 * Create a reminder from complete information with proper timezone handling
 * @param {Object} user - User document from database
 * @param {Object} response - Parsed NLP response
 * @param {String} originalMessage - Original message text from user (optional)
 */
const createReminderFromResponse = async (user, response, originalMessage = '') => {
    try {
        // Validate content
        const contentValidation = validationService.validateContent(response.content);
        if (!contentValidation.valid) {
            await whatsappService.sendMessage(
                user.phoneNumber,
                contentValidation.message
            );

            if (contentValidation.reason === "content_is_time_reference") {
                // Set conversation state to await content, but preserve date/time info
                user.conversationState = {
                    stage: 'followup_content',
                    date: response.date,
                    time: response.time,
                    timeReference: response.timeReference
                };
                await user.save();
            }
            else if (contentValidation.suggestion && contentValidation.suggestion.action === 'shorten') {
                // Set conversation state to await shorter content
                user.conversationState = {
                    stage: 'followup_content',
                    date: response.date,
                    time: response.time,
                    timeReference: response.timeReference
                };
            }
            return;
        }

        // Get the user's timezone
        const userTimeZone = user.timeZone || 'Asia/Kolkata';

        // Parse the date and time using our enhanced parser
        let scheduledDateTime;
        try {
            // Special handling for relative time expressions (priority over other parsing)
            if (response.relativeTime) {
                // Simple relative time handling without timezone dependency
                const now = new Date();
                const { unit, amount } = response.relativeTime;

                console.log(`Processing relative time: ${amount} ${unit}`);

                if (unit === 'minutes' || unit === 'minute') {
                    scheduledDateTime = new Date(now.getTime() + (amount * 60 * 1000));
                } else if (unit === 'hours' || unit === 'hour') {
                    scheduledDateTime = new Date(now.getTime() + (amount * 60 * 60 * 1000));
                } else {
                    throw new Error('Unsupported time unit');
                }

                console.log(`Parsed from relative time: ${scheduledDateTime}`);
            } else {
                // Regular date/time parsing for non-relative expressions
                // Prepare the date/time info for the parser
                const dateTimeInfo = {
                    date: response.date,
                    time: response.time,
                    timeReference: response.timeReference
                };

                scheduledDateTime = await dateParserService.parseDateTime(dateTimeInfo, user._id, userTimeZone);
            }

            console.log(`Parsed date: ${scheduledDateTime.toISOString()}`);

            if (isNaN(scheduledDateTime.valueOf())) {
                throw new Error('Invalid date');
            }
        } catch (dateError) {
            console.error('Error parsing date:', dateError);
            throw new Error('Could not understand the date and time');
        }

        // Validate the date
        const dateValidation = validationService.validateDate(scheduledDateTime);
        if (!dateValidation.valid) {
            await whatsappService.sendMessage(
                user.phoneNumber,
                dateValidation.message
            );

            // If there's a suggestion for rescheduling
            if (dateValidation.suggestion && dateValidation.suggestion.action === 'reschedule') {
                // Set conversation state to await rescheduling confirmation
                user.conversationState = {
                    stage: 'reschedule_confirmation',
                    content: response.content,
                    suggestedDate: dateValidation.suggestion.date
                };

                await whatsappService.sendMessage(
                    user.phoneNumber,
                    dateValidation.suggestion.message
                );
            }
            return;
        } else if (dateValidation.adjusted) {
            // If the date was slightly adjusted
            scheduledDateTime = dateValidation.date;
        }

        // Check for conflicts
        const conflictCheck = await validationService.checkConflicts(
            user._id,
            scheduledDateTime
        );

        if (conflictCheck.hasConflict) {
            // Set conversation state to await conflict resolution
            user.conversationState = {
                stage: 'conflict_resolution',
                content: response.content,
                scheduledFor: scheduledDateTime,
                conflicts: conflictCheck.conflicts.map(c => c._id)
            };

            await whatsappService.sendMessage(
                user.phoneNumber,
                conflictCheck.message
            );
            return;
        }

        // Add this to createReminderFromResponse before creating the reminder
        const today = new Date();
        if (format(scheduledDateTime, 'yyyy-MM-dd') === format(today, 'yyyy-MM-dd') &&
            dateParserService.isDayOfWeekReference(response.date)) {

            // Ask for clarification
            await whatsappService.sendMessage(
                user.phoneNumber,
                `Did you mean today (${format(today, 'EEEE, MMMM do')}) or next ${format(today, 'EEEE')}?`
            );

            // Update conversation state for clarification
            user.conversationState = {
                stage: 'date_clarification',
                content: response.content,
                todayOption: today,
                nextWeekOption: addDays(today, 7),
                time: response.time,
                timeReference: response.timeReference
            };
            return;
        }

        // Handle recurrence patterns
        let recurrencePattern = null;
        let endDate = null;
        const recurrenceParserService = require('./recurrenceParserService');

        // Handle end date from response or recurrence pattern
        if (response.endDate && response.endDate !== "null") {
            try {
                // Direct parsing if it's in ISO format
                if (/^\d{4}-\d{2}-\d{2}$/.test(response.endDate)) {
                    endDate = parseISO(response.endDate);
                    console.log(`Parsed ISO end date: ${endDate}`);
                } else {
                    // Try to extract end date via recurrence parser
                    const recurrenceText = `until ${response.endDate}`;
                    const parsedRecurrence = recurrenceParserService.parseRecurrencePattern(recurrenceText);

                    if (parsedRecurrence && parsedRecurrence.endDate) {
                        endDate = parseISO(parsedRecurrence.endDate);
                        console.log(`Parsed end date from text: ${endDate}`);
                    }
                }

                // Validate the parsed date
                if (endDate && isNaN(endDate.getTime())) {
                    console.log('Invalid end date format, using null instead');
                    endDate = null;
                }
            } catch (error) {
                console.error('Error parsing end date:', error);
                endDate = null;
            }
        }

        // Extract end date from the recurrence pattern if available
        if (response.recurrencePattern && response.recurrencePattern.endDate) {
            try {
                endDate = parseISO(response.recurrencePattern.endDate);
                // Remove from pattern to avoid duplication
                delete response.recurrencePattern.endDate;
            } catch (error) {
                console.error('Error parsing endDate from recurrencePattern:', error);
            }
        }

        // Check if we need to extract end date from message text
        if (!endDate && originalMessage && originalMessage.toLowerCase().includes('until')) {
            try {
                const recurrenceText = originalMessage;
                const parsedRecurrence = recurrenceParserService.parseRecurrencePattern(recurrenceText);

                if (parsedRecurrence && parsedRecurrence.endDate) {
                    endDate = parseISO(parsedRecurrence.endDate);
                    console.log(`Extracted end date from message text: ${endDate}`);
                }
            } catch (error) {
                console.error('Error extracting end date from message:', error);
            }
        }

        // Check if we have a custom recurrence pattern
        if (response.recurrence === 'custom' && response.recurrencePattern) {
            recurrencePattern = response.recurrencePattern;
        }
        // If we have a simple recurrence (daily, weekly, monthly), convert to pattern format
        else if (['daily', 'weekly', 'monthly'].includes(response.recurrence)) {
            const frequencyMap = {
                'daily': 'day',
                'weekly': 'week',
                'monthly': 'month'
            };

            recurrencePattern = {
                frequency: frequencyMap[response.recurrence],
                interval: 1
            };
        }

        // Create the reminder with recurrence if applicable
        let reminder;

        if (recurrencePattern) {
            console.log('Creating recurring reminder with pattern:', JSON.stringify(recurrencePattern));
            console.log('End date:', endDate ? endDate.toISOString() : 'null');

            try {
                // Use createRecurringReminder for recurring reminders
                reminder = await reminderService.createRecurringReminder({
                    user: user._id,
                    content: response.content,
                    scheduledFor: scheduledDateTime,
                    notificationMethod: user.preferredNotificationMethod
                }, recurrencePattern, endDate);

                // Format recurrence for display
                const recurrenceDescription = recurrenceParserService.formatRecurrenceForDisplay(
                    recurrencePattern,
                    scheduledDateTime,
                    endDate
                );

                // Format date for user-friendly message
                const scheduledDate = dateParserService.formatDateForDisplay(scheduledDateTime);

                // Send confirmation message with recurrence info
                await whatsappService.sendMessage(
                    user.phoneNumber,
                    `✅ Recurring reminder set for ${scheduledDate}: "${response.content}"\n\nRecurs: ${recurrenceDescription}`
                );
            } catch (error) {
                console.error('Error creating recurring reminder:', error);
                throw error; // Re-throw to be handled by the outer catch block
            }
        } else {
            // Use regular createReminder for one-time reminders
            reminder = await reminderService.createReminder({
                user: user._id,
                content: response.content,
                scheduledFor: scheduledDateTime,
                recurrence: 'none',
                notificationMethod: user.preferredNotificationMethod
            });

            // Format date for user-friendly message
            const scheduledDate = dateParserService.formatDateForDisplay(scheduledDateTime);

            // Send confirmation message
            await whatsappService.sendMessage(
                user.phoneNumber,
                `✅ Reminder set for ${scheduledDate}: "${response.content}"`
            );
        }

        // Reset conversation state
        user.conversationState = { stage: 'initial' };
    } catch (error) {
        console.error('Error creating reminder:', error);

        // Handle specific errors with helpful messages
        if (error.message === 'Could not understand the date and time') {
            await whatsappService.sendMessage(
                user.phoneNumber,
                "I couldn't understand when you want to be reminded. Please try specifying a date and time like 'tomorrow at 9am' or 'next Monday evening'."
            );
        } else if (error.message === 'Reminder content is required') {
            // Update conversation state to ask for content
            user.conversationState = {
                stage: 'followup_content',
                date: response.date,
                time: response.time,
                timeReference: response.timeReference
            };

            await whatsappService.sendMessage(
                user.phoneNumber,
                "What would you like to be reminded about?"
            );
        } else {
            await whatsappService.sendMessage(
                user.phoneNumber,
                "I had trouble setting your reminder. Please try again."
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
    // Check if we have enough information to create a reminder
    // Valid combinations are date+time or date+timeReference or relativeTime
    if ((response.date && (response.time || response.timeReference)) || response.relativeTime) {
        // Log the conversation state to debug
        console.log("Current conversation state:", conversationState);

        // Make sure we have the content from the conversation state
        const reminderContent = conversationState.content || "Untitled reminder";

        console.log("Creating reminder with content:", reminderContent);

        // We now have date and time/timeReference or relativeTime
        await createReminderFromResponse(user, {
            type: 'reminder',
            content: reminderContent, // Use the content saved in conversation state
            date: response.date,
            time: response.time,
            timeReference: response.timeReference,
            relativeTime: response.relativeTime,
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

    // Check if the original error contains specific validation messages
    if (response.error && response.error.message) {
        message = response.error.message;
    } else if (missing.includes('date') && missing.includes('time')) {
        message = "Please provide both a date and time for your reminder.";
    } else if (missing.includes('date')) {
        // Check if there's a validation error in the user input
        const userInput = user.lastRawInput; // We would need to add this to the user model
        if (userInput && userInput.includes('35th')) {
            message = "There's no 35th day in any month. Please provide a valid date.";
        } else {
            message = "Please specify what date you want to be reminded.";
        }
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