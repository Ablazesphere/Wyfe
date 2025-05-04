// services/whapiService.js - Service for interacting with the WhatsApp API

import axios from 'axios';
import { logger } from '../utils/logger.js';

// Create axios instance for WhatsApp API
const whapiClient = axios.create({
    baseURL: 'https://graph.facebook.com/v20.0',
    headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.WHATSAPP_API_TOKEN}`
    }
});

/**
 * Send a text message via WhatsApp
 * @param {string} phoneNumber Recipient's phone number with country code
 * @param {string} message Message text to send
 * @returns {Promise} Response from WhatsApp API
 */
export async function sendWhatsAppMessage(phoneNumber, message) {
    try {
        logger.info(`Sending WhatsApp message to ${phoneNumber}`);

        const response = await whapiClient.post(`/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: phoneNumber,
            type: 'text',
            text: {
                body: message
            }
        });

        logger.info('WhatsApp message sent successfully', {
            messageId: response.data.messages?.[0]?.id
        });

        return response.data;
    } catch (error) {
        logger.error('Error sending WhatsApp message:', error.response?.data || error.message);
        throw error;
    }
}

/**
 * Mark a message as read
 * @param {string} messageId The ID of the message to mark as read
 * @returns {Promise} Response from WhatsApp API
 */
export async function markMessageAsRead(messageId) {
    try {
        logger.debug(`Marking message ${messageId} as read`);

        const response = await whapiClient.post(`/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
            messaging_product: 'whatsapp',
            status: 'read',
            message_id: messageId
        });

        return response.data;
    } catch (error) {
        logger.error('Error marking message as read:', error.response?.data || error.message);
        throw error;
    }
}

/**
 * Initialize the WhatsApp service
 * Validates required environment variables
 */
export function initializeWhapiService() {
    const requiredEnvVars = [
        'WHATSAPP_API_TOKEN',
        'WHATSAPP_PHONE_NUMBER_ID',
        'WHATSAPP_VERIFY_TOKEN'
    ];

    const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);

    if (missingVars.length > 0) {
        throw new Error(`Missing required environment variables: ${missingVars.join(', ')}`);
    }

    logger.info('WhatsApp service initialized successfully');
}