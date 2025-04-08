// src/controllers/webhookController.js

const { processUserMessage } = require('../services/nlpService');
const User = require('../models/USER.JS');

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

            // Check if this is a response to a reminder notification
            const isReminderResponse = await handleReminderResponse(user, text.body);

            if (isReminderResponse) {
                // The message was handled as a reminder response, no need for NLP processing
                console.log('Handled as reminder response');
            } else {
                // Process the message using NLP service
                await processUserMessage(user, text.body);
            }
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

        const isExactMatch = completionKeywords.some(keyword => lowerMessage === keyword);
        const isPatternMatch = completionPatterns.some(pattern => pattern.test(lowerMessage));

        if (isExactMatch || isPatternMatch) {
            // Attempt to find the most recent reminder sent to the user
            const reminderService = require('../services/reminderService');
            const recentReminders = await reminderService.getRecentSentReminders(user._id, 1);

            if (recentReminders && recentReminders.length > 0) {
                const reminder = recentReminders[0];
                const whatsappService = require('../services/whatsappService');

                // Update reminder status
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
        }

        // Not a reminder response
        return false;
    } catch (error) {
        console.error('Error handling reminder response:', error);
        return false;
    }
};

module.exports = {
    verifyWebhook,
    handleIncomingMessage,
    handleReminderResponse
};