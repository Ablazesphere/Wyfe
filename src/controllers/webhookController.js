// src/controllers/webhookController.js

const { processUserMessage } = require('../services/nlpService');
const User = require('../models/USER.JS');
const Reminder = require('../models/reminder');
const reminderService = require('../services/reminderService'); // Added missing import
const whatsappService = require('../services/whatsappService');
const dateParserService = require('../services/dateParserService');

/**
 * Verifies the webhook endpoint for Whapi.cloud
 */
const verifyWebhook = (req, res) => {
    // Verify the webhook based on Whapi.cloud verification token
    if (req.query['hub.verify_token'] === process.env.WHAPI_VERIFY_TOKEN) {
        return res.send(req.query['hub.challenge']);
    }

    // If verification fails, deny access
    res.status(403).send('Verification failed');
};

/**
 * Handles incoming WhatsApp messages from Whapi.cloud
 */
const handleIncomingMessage = async (req, res) => {
    try {
        const { messages } = req.body;

        // Return early if no messages
        if (!messages || !messages.length) {
            return res.status(200).send('No messages to process');
        }

        console.log('Received webhook payload:', JSON.stringify(req.body, null, 2));

        // Process each message
        for (const message of messages) {
            // Only process text messages for now
            if (message.type !== 'text') {
                console.log(`Skipping non-text message of type: ${message.type}`);
                continue;
            }

            // Skip messages that are from_me (sent by our bot)
            if (message.from_me) {
                console.log(`Skipping message from our bot: ${message.text.body}`);
                continue;
            }

            // Skip messages that start with "✅ Reminder set for" (our confirmation messages)
            if (message.text.body.startsWith("✅ Reminder set for")) {
                console.log(`Skipping confirmation message: ${message.text.body}`);
                continue;
            }

            const {
                from,       // Phone number of the sender
                text        // Message content
            } = message;

            console.log(`Processing message from ${from}: "${text.body}"`);

            // Find or create user
            let user = await User.findOne({ phoneNumber: from });

            if (!user) {
                console.log(`Creating new user for phone number: ${from}`);
                user = new User({
                    phoneNumber: from,
                    timeZone: 'Asia/Kolkata', // Default to India timezone
                    preferredNotificationMethod: 'whatsapp'
                });
                await user.save();
            }

            // Log current conversation state
            console.log(`Current conversation state:`, user.conversationState);

            // Update last interaction timestamp
            user.lastInteraction = new Date();
            await user.save();

            // Check if this is a response to a reminder notification first
            // Only try to handle it as a reminder response if there are pending reminders
            const recentReminders = await reminderService.getRecentSentReminders(user._id, 1);
            const pendingReminders = await Reminder.find({
                user: user._id,
                status: 'pending'
            }).sort({ scheduledFor: 1 }).limit(1);

            // If we have recent reminders or pending reminders, try to process as a response
            if (recentReminders.length > 0 || pendingReminders.length > 0) {
                const isReminderResponse = await handleReminderResponse(user, text.body);

                if (isReminderResponse) {
                    // The message was handled as a reminder response, no need for NLP processing
                    console.log('Handled as reminder response');
                    return; // Skip further processing
                }
            } else {
                console.log('No existing reminders found, will process as a new message');
            }

            // If it wasn't handled as a reminder response or there are no existing reminders,
            // process it as a regular message through the NLP service
            await processUserMessage(user, text.body);
        }

        // Acknowledge receipt
        res.status(200).send('Message processed');
    } catch (error) {
        console.error('Error handling incoming message:', error);
        res.status(500).send('Error processing message');
    }
};

/**
 * Handle user responses to reminders
 * @param {Object} user - User document
 * @param {String} messageText - Message text from user
 */
const handleReminderResponse = async (user, messageText) => {
    try {
        console.log('Processing potential reminder response:', messageText);

        // Check if the message is a response to a reminder
        const lowerMessage = messageText.toLowerCase().trim();

        // Keywords indicating completion
        const completionKeywords = ['done', 'completed', 'finished', 'complete', 'ok done', 'got it'];

        // Patterns indicating completion (partial matches)
        const completionPatterns = [
            /mark.*done/i,
            /mark.*complete/i,
            /mark.*finished/i,
            /complete.*reminder/i,
            /finish.*reminder/i,
            /done.*reminder/i
        ];

        // Define patterns indicating delay requests
        const delayPatterns = [
            /delay/i,
            /postpone/i,
            /reschedule/i,
            /later/i,
            /after/i,
            /remind.*again/i,
            /snooze/i,
            /can you delay this/i,
            /move.*to/i
        ];

        const isExactMatch = completionKeywords.some(keyword => lowerMessage === keyword);
        const isPatternMatch = completionPatterns.some(pattern => pattern.test(lowerMessage));

        // We now have a context-aware approach, so we're more confident this is a delay request
        // if we get to this point (we've already verified we have existing reminders)
        const isDelayRequest = delayPatterns.some(pattern => pattern.test(lowerMessage));

        console.log('Is delay request:', isDelayRequest);

        // Attempt to find the most recent reminder sent to the user
        const recentReminders = await reminderService.getRecentSentReminders(user._id, 1);

        if (recentReminders && recentReminders.length > 0) {
            const reminder = recentReminders[0];
            console.log('Found recent reminder:', reminder.content);

            if (isExactMatch || isPatternMatch) {
                console.log('Handling completion response');
                // Handle completion response
                await reminderService.updateReminderStatus(reminder._id, 'acknowledged');

                // Send confirmation
                await whatsappService.sendMessage(
                    user.phoneNumber,
                    `✅ Marked "${reminder.content}" as complete.`
                );

                // Reset the conversation state to initial
                user.conversationState = { stage: 'initial' };
                await user.save();

                return true; // Message was handled as a reminder response
            }
            else if (isDelayRequest) {
                console.log('Handling delay request');
                // Handle delay request

                // Extract delay time information
                const delayInfo = extractDelayInfo(messageText);
                console.log('Extracted delay info:', delayInfo);

                let newScheduledTime;

                if (delayInfo.minutes > 0) {
                    // Use the extracted minutes
                    newScheduledTime = new Date(Date.now() + delayInfo.minutes * 60 * 1000);
                } else {
                    // Default to 30 minutes if we couldn't extract a specific time
                    newScheduledTime = new Date(Date.now() + 30 * 60 * 1000);
                }

                console.log('Creating delayed reminder for:', newScheduledTime);

                // Create a new reminder with the same content but delayed time
                const delayedReminder = await reminderService.createReminder({
                    user: user._id,
                    content: reminder.content,
                    scheduledFor: newScheduledTime,
                    recurrence: reminder.recurrence,
                    recurrencePattern: reminder.recurrencePattern,
                    notificationMethod: reminder.notificationMethod
                });

                // Mark the original reminder as acknowledged
                await reminderService.updateReminderStatus(reminder._id, 'acknowledged');

                // Format the new time for display
                const formattedTime = dateParserService.formatDateForDisplay(newScheduledTime);

                // Send confirmation message
                await whatsappService.sendMessage(
                    user.phoneNumber,
                    `⏰ Reminder "${reminder.content}" rescheduled for ${formattedTime}`
                );

                // Reset conversation state
                user.conversationState = { stage: 'initial' };
                await user.save();

                return true; // Message was handled as a delay request
            }
        } else if (isDelayRequest) {
            // Handle delay requests for pending reminders
            console.log('Delay request detected for pending reminders');

            // Fetch all pending reminders for this user
            const pendingReminders = await Reminder.find({
                user: user._id,
                status: 'pending'
            }).sort({ scheduledFor: 1 }).limit(1);

            if (pendingReminders && pendingReminders.length > 0) {
                // Use the next upcoming reminder
                const upcomingReminder = pendingReminders[0];
                console.log('Found upcoming reminder to delay:', upcomingReminder.content);

                // Extract delay time information
                const delayInfo = extractDelayInfo(messageText);
                let newScheduledTime;

                if (delayInfo.minutes > 0) {
                    // Use the extracted minutes from the original scheduled time
                    newScheduledTime = new Date(upcomingReminder.scheduledFor.getTime() + delayInfo.minutes * 60 * 1000);
                } else {
                    // Default to 30 minutes from now
                    newScheduledTime = new Date(Date.now() + 30 * 60 * 1000);
                }

                // Update the reminder with the new time
                await reminderService.updateReminder(upcomingReminder._id, {
                    scheduledFor: newScheduledTime
                });

                // Format the new time for display
                const formattedTime = dateParserService.formatDateForDisplay(newScheduledTime);

                // Send confirmation message
                await whatsappService.sendMessage(
                    user.phoneNumber,
                    `⏰ Reminder "${upcomingReminder.content}" rescheduled for ${formattedTime}`
                );

                // Reset conversation state
                user.conversationState = { stage: 'initial' };
                await user.save();

                return true; // Message was handled as a delay request
            } else {
                // No reminders found to delay
                await whatsappService.sendMessage(
                    user.phoneNumber,
                    "I don't see any active reminders to delay. Would you like to set a new reminder?"
                );
                return true; // We still handled this as a reminder response
            }
        }

        console.log('Not handled as a reminder response');
        // Not a reminder response
        return false;
    } catch (error) {
        console.error('Error handling reminder response:', error);
        return false;
    }
};

/**
 * Extract delay time information from user message
 * @param {String} message - User message text
 * @returns {Object} - Extracted delay information
 */
const extractDelayInfo = (message) => {
    const lowerMessage = message.toLowerCase();
    let minutes = 0;

    // Try to extract specific time periods
    const minutesMatch = lowerMessage.match(/(\d+)\s*(?:minute|minutes|min|mins)/i);
    const hoursMatch = lowerMessage.match(/(\d+)\s*(?:hour|hours|hr|hrs)/i);
    const afterMatch = lowerMessage.match(/after\s+(\d+)/i);
    const byMatch = lowerMessage.match(/by\s+(\d+)/i);
    const justNumberMatch = lowerMessage.match(/delay\s+(?:this|reminder|it)?\s+(?:by|for)?\s+(\d+)/i);

    if (minutesMatch) {
        minutes = parseInt(minutesMatch[1]);
    } else if (hoursMatch) {
        minutes = parseInt(hoursMatch[1]) * 60;
    } else if (afterMatch) {
        // Assume "after X" refers to minutes if no unit specified
        minutes = parseInt(afterMatch[1]);
    } else if (byMatch) {
        // Assume "by X" refers to minutes if no unit specified
        minutes = parseInt(byMatch[1]);
    } else if (justNumberMatch) {
        // Found a number without unit, assume minutes
        minutes = parseInt(justNumberMatch[1]);
    }

    // Common time references
    if (lowerMessage.includes('later')) {
        minutes = minutes || 30; // Default "later" to 30 minutes
    }

    // Set a default if nothing was extracted
    if (minutes <= 0) {
        if (lowerMessage.includes('tomorrow')) {
            minutes = 24 * 60; // Tomorrow = 24 hours
        } else {
            minutes = 30; // Default delay time
        }
    }

    return { minutes };
};

module.exports = {
    verifyWebhook,
    handleIncomingMessage,
    handleReminderResponse
};