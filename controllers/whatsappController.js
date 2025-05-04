// controllers/whatsappController.js - Handle WhatsApp webhooks and message processing

import { logger } from '../utils/logger.js';
import { processUserMessage } from '../services/nlpService.js';
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

                                    logger.info(`WhatsApp message from ${userPhoneNumber}: ${messageContent}`);

                                    // Process the message with NLP
                                    const nlpResult = await processUserMessage(messageContent, userPhoneNumber);

                                    // Send response back to the user
                                    await sendWhatsAppMessage(userPhoneNumber, nlpResult.response);

                                    // No need to do anything else for now, we'll handle reminder creation in the NLP service
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