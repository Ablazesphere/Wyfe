// src/services/whatsappService.js

const axios = require('axios');

/**
 * Send a WhatsApp message using Whapi.cloud API
 * @param {String} to - Phone number to send message to
 * @param {String} text - Message text to send
 * @returns {Promise} - Response from Whapi API
 */
const sendMessage = async (to, text) => {
    try {
        const response = await axios.post(
            'https://gate.whapi.cloud/messages/text',
            {
                to,
                body: text
            },
            {
                headers: {
                    'Authorization': `Bearer ${process.env.WHAPI_TOKEN}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        return response.data;
    } catch (error) {
        console.error('Error sending WhatsApp message:', error);
        throw error;
    }
};

/**
 * Send a template message for specific notification types
 * @param {String} to - Phone number to send message to
 * @param {String} templateName - Template name
 * @param {Array} components - Template components
 * @returns {Promise} - Response from Whapi API
 */
const sendTemplateMessage = async (to, templateName, components) => {
    try {
        const response = await axios.post(
            'https://gate.whapi.cloud/messages/template',
            {
                to,
                template: {
                    name: templateName,
                    language: { code: 'en' },
                    components
                }
            },
            {
                headers: {
                    'Authorization': `Bearer ${process.env.WHAPI_TOKEN}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        return response.data;
    } catch (error) {
        console.error('Error sending WhatsApp template message:', error);
        throw error;
    }
};

module.exports = {
    sendMessage,
    sendTemplateMessage
};