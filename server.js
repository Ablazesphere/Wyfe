// server.js - Updated for AI Reminder System

import Fastify from 'fastify';
import fastifyFormBody from '@fastify/formbody';
import fastifyWs from '@fastify/websocket';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Import controllers
import { setupCallRoutes } from './controllers/callController.js';
import { setupWhatsAppRoutes } from './controllers/whatsappController.js';
import { setupReminderCallRoutes } from './controllers/reminderCallController.js';

// Import services
import { logger } from './utils/logger.js';
import { config } from './config/config.js';
import { initializeDatabase, closeDatabase } from './services/reminderService.js';
import { initializeScheduler, shutdownScheduler } from './services/schedulerService.js';
import { initializeWhapiService } from './services/whapiService.js';
import { initializeTwilioOutbound } from './services/twilioOutboundService.js';

// Initialize Fastify
const fastify = Fastify();
fastify.register(fastifyFormBody);
fastify.register(fastifyWs);

// Setup routes
setupCallRoutes(fastify);
setupWhatsAppRoutes(fastify);
setupReminderCallRoutes(fastify);

// Health check route
fastify.get('/health', async (request, reply) => {
    return { status: 'ok', timestamp: new Date().toISOString() };
});

// Start the server and initialize services
const startServer = async () => {
    try {
        // Initialize database
        await initializeDatabase();

        // Initialize WhatsApp service
        initializeWhapiService();

        // Initialize Twilio outbound service
        initializeTwilioOutbound();

        // Initialize scheduler
        initializeScheduler();

        // Start the server
        await fastify.listen({ port: config.PORT, host: '0.0.0.0' })
            .then(() => {
                logger.info(`Wyfe server is listening on port ${config.PORT}`);
            });
    } catch (err) {
        logger.error('Error starting server:', err);
        process.exit(1);
    }
};

// Handle graceful shutdown
const shutdown = async (signal) => {
    logger.info(`Received ${signal}. Shutting down gracefully...`);

    // Stop the scheduler
    shutdownScheduler();

    // Close database connection
    await closeDatabase();

    // Close Fastify
    await fastify.close();

    logger.info('Cleanup completed, exiting process');
    process.exit(0);
};

// Register shutdown handlers
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// Start the server
startServer();