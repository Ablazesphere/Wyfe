// src/services/twilioClient.js

const twilio = require('twilio');

/**
 * Create a Twilio client with the appropriate configurations
 * @returns {Object} Twilio client instance
 */
function createTwilioClient() {
    try {
        // Check for required environment variables
        if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
            console.error('Missing required Twilio environment variables');
            return null;
        }

        // Create the Twilio client with standard settings
        const client = twilio(
            process.env.TWILIO_ACCOUNT_SID,
            process.env.TWILIO_AUTH_TOKEN
        );

        console.log('Twilio client initialized successfully');

        // You can add client.on('error') handlers here if needed

        return client;
    } catch (error) {
        console.error('Failed to initialize Twilio client:', error);
        return null;
    }
}

// Create and export a singleton instance
const twilioClient = createTwilioClient();

module.exports = twilioClient;