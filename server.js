// server.js - Main entry point with fixed time update handling
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
import { logger } from './utils/logger.js';
import { config } from './config/config.js';
import { preloadGreetingAudio } from './services/openaiService.js';

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

// Health check route
fastify.get('/health', async (request, reply) => {
    reply.send({ status: 'ok', timestamp: new Date().toISOString() });
});

// Start the server
const startServer = async () => {
    try {
        await fastify.listen({ port: config.PORT, host: '0.0.0.0' })
            .then(() => {
                logger.info(`Server is listening on port ${config.PORT}`);

                // Preload greeting audio on server start
                if (config.GREETING_PRELOAD_ENABLED) {
                    return preloadGreetingAudio()
                        .then(() => {
                            logger.info('Greeting audio preloaded successfully');
                        })
                        .catch(err => {
                            logger.warn('Failed to preload greeting audio:', err);
                            // Continue running even if preloading fails
                        });
                } else {
                    logger.info('Greeting preloading is disabled');
                    return Promise.resolve();
                }
            });

        // Periodically refresh the greeting audio cache, but less frequently
        if (config.GREETING_PRELOAD_ENABLED) {
            // Refresh every 2 hours instead of using config.GREETING_CACHE_TTL
            const REFRESH_INTERVAL = 2 * 60 * 60 * 1000; // 2 hours

            setInterval(() => {
                preloadGreetingAudio()
                    .then(() => logger.debug('Refreshed greeting audio cache'))
                    .catch(err => logger.warn('Failed to refresh greeting cache:', err));
            }, REFRESH_INTERVAL);
        }

        // Handle graceful shutdown
        process.on('SIGINT', () => gracefulShutdown());
        process.on('SIGTERM', () => gracefulShutdown());

    } catch (err) {
        logger.error('Error starting server:', err);
        process.exit(1);
    }
};

/**
 * Perform graceful shutdown
 */
const gracefulShutdown = async () => {
    logger.info('Graceful shutdown initiated...');

    try {
        await fastify.close();
        logger.info('Server shutdown complete');
        process.exit(0);
    } catch (err) {
        logger.error('Error during shutdown:', err);
        process.exit(1);
    }
};

// Start the server
startServer();