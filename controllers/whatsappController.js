// controllers/whatsappController.js - Handle WhatsApp webhooks with follow-up support

import { logger } from '../utils/logger.js';
import {
    processUserMessage,
    processFollowUpMessage,
    isInFollowUpMode,
    getNextFollowUpQuestion,
    clearConversationState
} from '../services/nlpService.js';
import { sendWhatsAppMessage } from '../services/whapiService.js';

/**
 * Setup WhatsApp webhook routes
 * @param {Object} fastify Fastify instance
 */
export function setupWhatsAppRoutes(fastify) {
    // Route for webhook verification
    fastify.get('/whatsapp-webhook', async (request, reply) => {
        logger.info('WhatsApp webhook verification request received');

        // Get verification token from query parameters
        const mode = request.query['hub.mode'];
        const token = request.query['hub.verify_token'];
        const challenge = request.query['hub.challenge'];

        // Verify against your environment token
        const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN;

        if (mode === 'subscribe' && token === verifyToken) {
            logger.info('WhatsApp webhook verified successfully');
            return reply.code(200).send(challenge);
        } else {
            logger.warn('WhatsApp webhook verification failed', { mode, token });
            return reply.code(403).send('Verification failed');
        }
    });

    // Route for receiving messages
    fastify.post('/whatsapp-webhook', async (request, reply) => {
        try {
            logger.info('WhatsApp message received');

            // Extract data from the webhook payload
            const data = request.body;

            // Check if this is a WhatsApp message
            if (data && data.object === 'whatsapp_business_account') {
                // Process each entry
                for (const entry of data.entry || []) {
                    // Process each change in the entry
                    for (const change of entry.changes || []) {
                        if (change.field === 'messages') {
                            // Process each message in the change
                            for (const message of change.value.messages || []) {
                                if (message.type === 'text') {
                                    const userPhoneNumber = change.value.contacts[0]?.wa_id;
                                    const messageContent = message.text.body;
                                    const messageId = message.id;

                                    logger.info(`WhatsApp message from ${userPhoneNumber}: ${messageContent}`);

                                    // Handle the message
                                    await handleWhatsAppMessage(userPhoneNumber, messageContent, messageId);
                                }
                            }
                        }
                    }
                }
            }

            // Always return a 200 OK to acknowledge receipt
            return reply.code(200).send('OK');
        } catch (error) {
            logger.error('Error processing WhatsApp webhook:', error);
            // Still return 200 to avoid WhatsApp retrying the webhook
            return reply.code(200).send('Error processed');
        }
    });
}

/**
 * Handle an incoming WhatsApp message
 * @param {string} userPhoneNumber The user's phone number
 * @param {string} messageContent The message content
 * @param {string} messageId The message ID
 */
async function handleWhatsAppMessage(userPhoneNumber, messageContent, messageId) {
    try {
        // Mark message as read first
        try {
            await markMessageAsRead(messageId);
        } catch (error) {
            logger.error('Error marking message as read:', error);
            // Continue processing even if marking as read fails
        }

        let response;

        // Check if this is a follow-up to a pending conversation
        if (isInFollowUpMode(userPhoneNumber)) {
            logger.info(`Processing follow-up message from ${userPhoneNumber}`);
            response = await processFollowUpMessage(messageContent, userPhoneNumber);

            // Send response
            await sendWhatsAppMessage(userPhoneNumber, response.response);

            // If there are more missing fields, send the next question
            if (response.inFollowUpMode && response.nextQuestion) {
                // Add a small delay to make conversation feel more natural
                setTimeout(async () => {
                    await sendWhatsAppMessage(userPhoneNumber, response.nextQuestion);
                }, 1000);
            } else if (response.complete) {
                // All fields completed, send a final confirmation
                if (response.scheduledTime) {
                    const scheduledTimeMessage = `Your reminder is set for: ${response.scheduledTime}`;

                    // Add a small delay to make conversation feel more natural
                    setTimeout(async () => {
                        await sendWhatsAppMessage(userPhoneNumber, scheduledTimeMessage);
                    }, 1000);
                }
            }
        } else {
            // Process the message with NLP
            response = await processUserMessage(messageContent, userPhoneNumber);

            // Send the initial response
            await sendWhatsAppMessage(userPhoneNumber, response.response);

            // If we need follow-up questions, send the first one
            if (response.inFollowUpMode && response.missingFields && response.missingFields.length > 0) {
                const firstField = response.missingFields[0];
                const followUpQuestion = response.followUpQuestions[firstField] ||
                    `Please provide the ${firstField}:`;

                // Add a small delay to make conversation feel more natural
                setTimeout(async () => {
                    await sendWhatsAppMessage(userPhoneNumber, followUpQuestion);
                }, 1000);
            }
        }
    } catch (error) {
        logger.error(`Error handling WhatsApp message from ${userPhoneNumber}:`, error);

        // Send an error message to the user
        try {
            await sendWhatsAppMessage(
                userPhoneNumber,
                "I'm sorry, I encountered an issue processing your request. Could you please try again?"
            );

            // Clear any conversation state to avoid getting stuck
            clearConversationState(userPhoneNumber);
        } catch (sendError) {
            logger.error(`Error sending error message to ${userPhoneNumber}:`, sendError);
        }
    }
}

/**
 * Mark a WhatsApp message as read
 * @param {string} messageId Message ID
 */
async function markMessageAsRead(messageId) {
    try {
        // Import whapiService on-demand to avoid circular dependencies
        const { markMessageAsRead } = await import('../services/whapiService.js');
        return await markMessageAsRead(messageId);
    } catch (error) {
        logger.error(`Error marking message ${messageId} as read:`, error);
        throw error;
    }
}