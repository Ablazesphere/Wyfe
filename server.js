// server.js - Main entry point
import Fastify from 'fastify';
import fastifyFormBody from '@fastify/formbody';
import fastifyWs from '@fastify/websocket';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Import controllers
import { setupCallRoutes } from './controllers/callController.js';
import { setupReminderRoutes } from './controllers/reminderController.js';

// Import services
import { prepareOpenAiConnections } from './services/openaiService.js';
import { logger } from './utils/logger.js';
import { config } from './config/config.js';

// Initialize Fastify
const fastify = Fastify();
fastify.register(fastifyFormBody);
fastify.register(fastifyWs);

// Setup routes
setupCallRoutes(fastify);
setupReminderRoutes(fastify);

// Root Route
fastify.get('/', async (request, reply) => {
    reply.send({ message: 'Twilio Media Stream Server with Reminders is running!' });
});

// Start the server
const startServer = async () => {
    try {
        // Pre-establish OpenAI connections
        prepareOpenAiConnections();

        await fastify.listen({ port: config.PORT });
        logger.info(`Server is listening on port ${config.PORT}`);
    } catch (err) {
        logger.error('Error starting server:', err);
        process.exit(1);
    }
};

// Start the server
startServer();