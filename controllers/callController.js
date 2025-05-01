// controllers/callController.js - Handle incoming call routes
import { logger } from '../utils/logger.js';
import { setupMediaStreamHandler } from '../services/twilioService.js';
import { sendPreloadedGreeting } from '../services/openaiService.js';

/**
 * Setup call-related routes
 * @param {Object} fastify Fastify instance
 */
export function setupCallRoutes(fastify) {
    // Route for Twilio to handle incoming calls
    fastify.all('/incoming-call', async (request, reply) => {
        logger.info('Incoming call received');

        // Track this call for later preloaded audio dispatch
        const callSid = request.body.CallSid || 'unknown';
        logger.info(`Call SID: ${callSid}`);

        const twimlResponse = `<?xml version="1.0" encoding="UTF-8"?>
                              <Response>
                                  <Connect>
                                      <Stream url="wss://${request.headers.host}/media-stream" />
                                  </Connect>
                              </Response>`;

        reply.type('text/xml').send(twimlResponse);
    });


    // WebSocket route for media-stream
    fastify.register(async (fastify) => {
        fastify.get('/media-stream', { websocket: true }, (connection, req) => {
            setupMediaStreamHandler(connection, req);
        });
    });
}