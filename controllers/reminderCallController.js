// controllers/reminderCallController.js - Handle reminder call routes and TwiML

import { logger } from '../utils/logger.js';
import { updateReminderStatus } from '../services/reminderService.js';

/**
 * Setup reminder call-related routes
 * @param {Object} fastify Fastify instance
 */
export function setupReminderCallRoutes(fastify) {
    // Route for handling reminder call TwiML
    fastify.get('/reminder-call', async (request, reply) => {
        try {
            const reminderId = request.query.reminderId;
            const reminderContent = request.query.reminderContent;

            logger.info(`Generating TwiML for reminder call: ${reminderId}`);

            // Create TwiML for the reminder call
            const twimlResponse = `<?xml version="1.0" encoding="UTF-8"?>
                                <Response>
                                    <Connect>
                                        <Stream url="wss://${request.headers.host}/reminder-stream?reminderId=${reminderId}&reminderContent=${encodeURIComponent(reminderContent)}" />
                                    </Connect>
                                </Response>`;

            return reply.type('text/xml').send(twimlResponse);
        } catch (error) {
            logger.error('Error generating reminder call TwiML:', error);

            // Return a basic TwiML response in case of error
            const errorTwiml = `<?xml version="1.0" encoding="UTF-8"?>
                              <Response>
                                  <Say>I'm sorry, there was an error processing your reminder. Please check your reminders through WhatsApp.</Say>
                                  <Hangup />
                              </Response>`;

            return reply.type('text/xml').send(errorTwiml);
        }
    });

    // Route for call status callbacks
    fastify.post('/call-status-callback', async (request, reply) => {
        try {
            const callSid = request.body.CallSid;
            const callStatus = request.body.CallStatus;
            const reminderId = request.body.reminderId;

            logger.info(`Call status callback: ${callSid}, status: ${callStatus}`);

            // If we have a reminderId, update the reminder status
            if (reminderId) {
                let reminderStatus;

                // Map Twilio call status to reminder status
                switch (callStatus) {
                    case 'completed':
                        reminderStatus = 'completed';
                        break;
                    case 'busy':
                    case 'failed':
                    case 'no-answer':
                    case 'canceled':
                        reminderStatus = 'failed';
                        break;
                    default:
                        // For in-progress statuses, don't update the reminder status
                        reminderStatus = null;
                }

                if (reminderStatus) {
                    await updateReminderStatus(reminderId, reminderStatus, {
                        callStatus,
                        callSid,
                        completedAt: new Date()
                    });

                    logger.info(`Updated reminder ${reminderId} status to ${reminderStatus}`);
                }
            }

            return reply.code(200).send('OK');
        } catch (error) {
            logger.error('Error processing call status callback:', error);
            return reply.code(200).send('Error processed');
        }
    });

    // WebSocket route for reminder-stream
    fastify.register(async (fastify) => {
        fastify.get('/reminder-stream', { websocket: true }, (connection, req) => {
            setupReminderMediaStreamHandler(connection, req);
        });
    });
}

/**
 * Setup media stream handler for reminder calls
 * @param {WebSocket} connection Twilio WebSocket connection
 * @param {Object} req Request object
 */
function setupReminderMediaStreamHandler(connection, req) {
    // Extract reminder information from query parameters
    const reminderId = req.query.reminderId;
    const reminderContent = req.query.reminderContent ?
        decodeURIComponent(req.query.reminderContent) :
        'your scheduled reminder';

    logger.info(`Reminder call stream established for reminder ${reminderId}`);

    // Reuse existing media stream handler but with reminder context
    // Import the existing handler from twilioService.js
    import('../services/twilioService.js').then(({ setupMediaStreamHandler }) => {
        // Add reminder context to the request object
        req.reminderContext = {
            reminderId,
            reminderContent,
            isReminderCall: true
        };

        // Use the existing media stream handler
        setupMediaStreamHandler(connection, req);
    }).catch(error => {
        logger.error('Error setting up reminder media stream:', error);
        connection.close();
    });
}