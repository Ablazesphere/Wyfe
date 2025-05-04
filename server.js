// server.js - WebSocket setup for Twilio

import Fastify from 'fastify';
import fastifyFormBody from '@fastify/formbody';
import fastifyWs from '@fastify/websocket';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Import controllers
import { setupCallRoutes } from './controllers/callController.js';

// Import services
import { logger } from './utils/logger.js';
import { config } from './config/config.js';

// Initialize Fastify
const fastify = Fastify();
fastify.register(fastifyFormBody);
fastify.register(fastifyWs);

// Setup routes
setupCallRoutes(fastify);

// Start the server
const startServer = async () => {
    try {
        await fastify.listen({ port: config.PORT, host: '0.0.0.0' })
            .then(() => {
                logger.info(`Server is listening on port ${config.PORT}`);
            });
    } catch (err) {
        logger.error('Error starting server:', err);
        process.exit(1);
    }
};

// Start the server
startServer();