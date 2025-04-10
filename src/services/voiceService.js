// src/services/voiceService.js

const axios = require('axios');
const { format } = require('date-fns');
const reminderService = require('./reminderService');

/**
 * Service for handling voice-based notifications using Twilio and ElevenLabs
 */
class VoiceService {
    constructor() {
        // Verify required environment variables
        this.checkEnvironmentVariables();

        // Initialize Twilio client
        try {
            const twilio = require('twilio');
            this.twilioClient = twilio(
                process.env.TWILIO_ACCOUNT_SID,
                process.env.TWILIO_AUTH_TOKEN
            );
            console.log('Twilio client initialized successfully');
        } catch (error) {
            console.error('Failed to initialize Twilio client:', error);
            this.twilioClient = null;
        }
    }

    /**
     * Check if required environment variables are set
     */
    checkEnvironmentVariables() {
        const requiredVars = [
            'TWILIO_ACCOUNT_SID',
            'TWILIO_AUTH_TOKEN',
            'TWILIO_PHONE_NUMBER',
            'ELEVENLABS_API_KEY',
            'ELEVENLABS_VOICE_ID',
            'APP_URL'
        ];

        const missingVars = requiredVars.filter(varName => !process.env[varName]);

        if (missingVars.length > 0) {
            console.error(`Missing required environment variables: ${missingVars.join(', ')}`);
            return false;
        }

        return true;
    }

    /**
     * Generate natural speech audio using ElevenLabs API
     * @param {String} text - The text to convert to speech
     * @returns {Promise<Buffer>} - Audio data as buffer
     */
    async generateSpeech(text) {
        try {
            console.log(`Generating speech with ElevenLabs: "${text.substring(0, 50)}..."`);

            const response = await axios.post(
                `https://api.elevenlabs.io/v1/text-to-speech/${process.env.ELEVENLABS_VOICE_ID}`,
                {
                    text,
                    model_id: "eleven_monolingual_v1",
                    voice_settings: {
                        stability: 0.5,
                        similarity_boost: 0.75
                    }
                },
                {
                    headers: {
                        'xi-api-key': process.env.ELEVENLABS_API_KEY,
                        'Content-Type': 'application/json',
                    },
                    responseType: 'arraybuffer'
                }
            );

            console.log('Speech generation successful');
            return response.data;
        } catch (error) {
            console.error('Error generating speech with ElevenLabs:', error.message);
            if (error.response) {
                console.error('ElevenLabs API error:', error.response.status, error.response.statusText);
            }
            throw error;
        }
    }

    /**
     * Make a voice call for a reminder
     * @param {Object} reminder - The reminder object with populated user
     * @returns {Promise<Object>} - Twilio call object
     */
    async makeReminderCall(reminder) {
        try {
            // Verify Twilio client is initialized
            if (!this.twilioClient) {
                throw new Error('Twilio client not initialized');
            }

            // Make sure user is accessible
            if (!reminder.user || !reminder.user.phoneNumber) {
                throw new Error('Reminder does not have populated user information');
            }

            const user = reminder.user;
            console.log(`Making voice call to ${user.phoneNumber} for reminder ${reminder._id}`);

            // Create TwiML for the call
            const twimlUrl = `${process.env.APP_URL}/api/voice/reminder-call?reminderId=${reminder._id}`;
            console.log(`Using TwiML URL: ${twimlUrl}`);

            // Make the call
            const call = await this.twilioClient.calls.create({
                url: twimlUrl,
                to: user.phoneNumber,
                from: process.env.TWILIO_PHONE_NUMBER,
                statusCallback: `${process.env.APP_URL}/api/voice/status-callback?reminderId=${reminder._id}`,
                statusCallbackMethod: 'POST'
            });

            console.log(`Successfully initiated voice call to ${user.phoneNumber}, Call SID: ${call.sid}`);

            return call;
        } catch (error) {
            console.error('Error making reminder call:', error.message);

            // Log more detailed error information
            if (error.message.includes('authenticate')) {
                console.error('Twilio authentication error. Check your TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN');
            } else if (error.code === 21603) {
                console.error('Invalid phone number format. Phone number must be in E.164 format');
            } else if (error.code === 21212) {
                console.error('The provided phone number is not a valid phone number');
            }

            throw error;
        }
    }

    /**
     * Create a retry for failed voice calls
     * @param {String} reminderId - ID of the reminder
     * @param {Number} delayMinutes - Minutes to delay before retry (default: 5)
     */
    async scheduleCallRetry(reminderId, delayMinutes = 5) {
        try {
            // Get the reminder
            const reminder = await reminderService.getReminderById(reminderId);

            if (!reminder) {
                console.error(`Reminder ${reminderId} not found for call retry`);
                return;
            }

            // Schedule a new call after delay
            const retryTime = new Date(Date.now() + delayMinutes * 60 * 1000);

            // Create a new reminder with the same content but delayed time
            // This leverages your existing reminder system for scheduling
            const retryReminder = await reminderService.createReminder({
                user: reminder.user,
                content: `Retry: ${reminder.content}`,
                scheduledFor: retryTime,
                recurrence: 'none',
                notificationMethod: 'voice', // Ensure it uses voice only
                originalReminderId: reminder._id // Track the original reminder
            });

            console.log(`Scheduled call retry for reminder ${reminderId} at ${retryTime}`);

            return retryReminder;
        } catch (error) {
            console.error('Error scheduling call retry:', error);
            throw error;
        }
    }

    /**
     * Process the result of a speech recognition response
     * @param {String} speechResult - The text captured from user's speech
     * @returns {Object} - Analyzed intent
     */
    analyzeUserSpeech(speechResult) {
        if (!speechResult) return { intent: 'unknown' };

        const text = speechResult.toLowerCase();

        // Detect agreement/completion
        if (this.userSaidYes(text)) {
            return { intent: 'completed' };
        }

        // Detect request to postpone/delay
        if (this.userWantsDelay(text)) {
            // Extract delay time if mentioned
            const delayInfo = this.extractDelayTime(text);
            return {
                intent: 'delay',
                minutes: delayInfo.minutes
            };
        }

        // Detect cancellation request
        if (this.userWantsCancel(text)) {
            return { intent: 'cancel' };
        }

        // Default fallback
        return { intent: 'unknown' };
    }

    /**
     * Check if user indicated completion/agreement
     * @param {String} text - User's speech text
     * @returns {Boolean} - Whether user agreed
     */
    userSaidYes(text) {
        const positivePatterns = [
            'yes', 'yeah', 'yep', 'sure', 'correct',
            'right', 'already did', 'done', 'completed',
            'i did', 'finished', 'taken care of'
        ];

        return positivePatterns.some(pattern => text.includes(pattern));
    }

    /**
     * Check if user wants to delay the reminder
     * @param {String} text - User's speech text
     * @returns {Boolean} - Whether user wants to delay
     */
    userWantsDelay(text) {
        const delayPatterns = [
            'delay', 'later', 'remind me later', 'postpone',
            'reschedule', 'snooze', 'not now',
            'after', 'in a while', 'busy now'
        ];

        return delayPatterns.some(pattern => text.includes(pattern));
    }

    /**
     * Check if user wants to cancel the reminder
     * @param {String} text - User's speech text
     * @returns {Boolean} - Whether user wants to cancel
     */
    userWantsCancel(text) {
        const cancelPatterns = [
            'cancel', 'remove', 'delete', 'don\'t remind',
            'stop', 'forget it', 'nevermind'
        ];

        return cancelPatterns.some(pattern => text.includes(pattern));
    }

    /**
     * Extract delay time from speech
     * @param {String} text - User's speech text
     * @returns {Object} - Extracted delay information
     */
    extractDelayTime(text) {
        // Try to extract specific time periods
        const minutesMatch = text.match(/(\d+)\s*(?:minute|minutes|min|mins)/i);
        const hoursMatch = text.match(/(\d+)\s*(?:hour|hours|hr|hrs)/i);

        if (minutesMatch) {
            return { minutes: parseInt(minutesMatch[1]) };
        } else if (hoursMatch) {
            return { minutes: parseInt(hoursMatch[1]) * 60 };
        }

        // Extract common time references
        if (text.includes('half hour') || text.includes('30 minutes')) {
            return { minutes: 30 };
        } else if (text.includes('15 minutes') || text.includes('quarter hour')) {
            return { minutes: 15 };
        } else if (text.includes('an hour')) {
            return { minutes: 60 };
        }

        // Default to 30 minutes if we can't extract a time
        return { minutes: 30 };
    }
}

module.exports = new VoiceService();