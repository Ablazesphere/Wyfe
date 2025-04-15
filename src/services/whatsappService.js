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

/**
 * Format a reminder notification message based on status
 * @param {String} action - Action type (completed, rescheduled, cancelled, etc.)
 * @param {String} content - The reminder content
 * @param {String} [additionalInfo] - Optional additional information like time
 * @returns {String} - Formatted WhatsApp message
 */
const formatReminderStatusMessage = (action, content, additionalInfo = '') => {
    switch (action) {
        case 'completed':
            return `✅ *Voice Call Update*: I've marked your reminder "${content}" as complete as per our phone conversation.`;

        case 'rescheduled':
            return `⏰ *Voice Call Update*: As requested during our call, I've rescheduled your reminder "${content}" for ${additionalInfo}.`;

        case 'cancelled':
            return `🚫 *Voice Call Update*: I've cancelled your reminder "${content}" as requested during our phone conversation.`;

        case 'missed_call':
            return `📞 *Missed Call*: I tried to call you about your reminder "${content}" but couldn't reach you. ${additionalInfo}`;

        case 'continue_conversation':
            return `📱 *Continue from Call*: You mentioned wanting to set a new reminder during our call. Please reply here with what you'd like to be reminded about and when. For example: "Remind me to call John tomorrow at 3pm"`;

        default:
            return `🔔 *Reminder Update*: ${content} ${additionalInfo ? '- ' + additionalInfo : ''}`;
    }
};

module.exports = {
    sendMessage,
    sendTemplateMessage,
    formatReminderStatusMessage
};