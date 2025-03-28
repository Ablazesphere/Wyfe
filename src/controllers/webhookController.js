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

            // Process the message using NLP service
            await processUserMessage(user, text.body);
        }

        // Acknowledge receipt
        res.status(200).send('Message processed');
    } catch (error) {
        console.error('Error handling incoming message:', error);
        res.status(500).send('Error processing message');
    }
};

module.exports = {
    verifyWebhook,
    handleIncomingMessage
};