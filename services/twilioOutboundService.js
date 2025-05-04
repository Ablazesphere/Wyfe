// services/twilioOutboundService.js - Service for initiating outbound calls with Twilio

import twilio from 'twilio';
import { logger } from '../utils/logger.js';

// Initialize Twilio client
let twilioClient;

/**
 * Initialize the Twilio outbound service
 */
export function initializeTwilioOutbound() {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;

    if (!accountSid || !authToken) {
        throw new Error('TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN environment variables are required');
    }

    twilioClient = twilio(accountSid, authToken);
    logger.info('Twilio outbound service initialized');
}

/**
 * Initiate an outbound call for a reminder
 * @param {Object} reminder The reminder object
 * @returns {Promise<Object>} Call details
 */
export async function initiateOutboundCall(reminder) {
    try {
        if (!twilioClient) {
            throw new Error('Twilio client not initialized');
        }

        const twilioPhoneNumber = process.env.TWILIO_PHONE_NUMBER;
        if (!twilioPhoneNumber) {
            throw new Error('TWILIO_PHONE_NUMBER environment variable is required');
        }

        // Create URL-encoded parameters to pass reminder context
        const urlParams = new URLSearchParams({
            reminderId: reminder._id.toString(),
            reminderContent: reminder.content
        }).toString();

        // Make the call using TwiML webhook with reminder context
        const call = await twilioClient.calls.create({
            to: reminder.userId, // Phone number from reminder
            from: twilioPhoneNumber,
            url: `${process.env.BASE_URL}/reminder-call?${urlParams}`,
            statusCallback: `${process.env.BASE_URL}/call-status-callback`,
            statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
            statusCallbackMethod: 'POST'
        });

        logger.info(`Initiated call for reminder ${reminder._id}, Twilio Call SID: ${call.sid}`);

        return {
            callSid: call.sid,
            status: call.status
        };
    } catch (error) {
        logger.error(`Error initiating call for reminder ${reminder._id}:`, error);
        throw error;
    }
}

/**
 * Get call status
 * @param {string} callSid The Twilio Call SID
 * @returns {Promise<Object>} Call details
 */
export async function getCallStatus(callSid) {
    try {
        if (!twilioClient) {
            throw new Error('Twilio client not initialized');
        }

        const call = await twilioClient.calls(callSid).fetch();

        return {
            callSid: call.sid,
            status: call.status,
            duration: call.duration,
            price: call.price,
            direction: call.direction,
            answeredBy: call.answeredBy,
            startTime: call.startTime,
            endTime: call.endTime
        };
    } catch (error) {
        logger.error(`Error getting call status for ${callSid}:`, error);
        throw error;
    }
}