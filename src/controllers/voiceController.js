// src/controllers/voiceController.js

const VoiceResponse = require('twilio').twiml.VoiceResponse;
const Reminder = require('../models/reminder');
const User = require('../models/USER.JS');
const voiceService = require('../services/voiceService');
const reminderService = require('../services/reminderService');
const dateParserService = require('../services/dateParserService');
const mongoose = require('mongoose');

/**
 * Generate TwiML for initial reminder call
 */
// In src/controllers/voiceController.js
const handleReminderCall = async (req, res) => {
    console.log("=== REMINDER CALL HANDLER TRIGGERED ===");
    console.log("Request URL:", req.originalUrl);
    console.log("Reminder ID:", req.query.reminderId);

    const twiml = new VoiceResponse();
    const reminderId = req.query.reminderId;

    try {
        // Validate reminder ID format first
        if (!reminderId || !reminderId.match(/^[0-9a-fA-F]{24}$/)) {
            console.log("Invalid reminder ID format:", reminderId);
            twiml.say('Sorry, the reminder ID format is invalid.');
            twiml.hangup();
            res.type('text/xml');
            return res.send(twiml.toString());
        }

        console.log("Attempting to find reminder:", reminderId);

        // Check MongoDB connection state
        const connectionState = mongoose.connection.readyState;
        console.log("MongoDB connection state:", connectionState); // 1 = connected

        if (connectionState !== 1) {
            console.log("MongoDB not connected");
            twiml.say('Sorry, the database connection is unavailable.');
            twiml.hangup();
            res.type('text/xml');
            return res.send(twiml.toString());
        }

        // Find reminder with robust error handling
        let reminder;
        try {
            reminder = await Reminder.findById(reminderId);
            console.log("Reminder search result:", reminder ? "Found" : "Not found");
        } catch (dbError) {
            console.error("Database error when finding reminder:", dbError);
            twiml.say('Sorry, there was a database error when finding your reminder.');
            twiml.hangup();
            res.type('text/xml');
            return res.send(twiml.toString());
        }

        if (!reminder) {
            console.log("Reminder not found with ID:", reminderId);
            twiml.say('Sorry, I could not find the reminder with the provided ID.');
            twiml.hangup();
            res.type('text/xml');
            return res.send(twiml.toString());
        }

        // Now try to populate the user
        try {
            await reminder.populate('user');
            console.log("User populated successfully:", reminder.user ? "Yes" : "No");
        } catch (populateError) {
            console.error("Error populating user:", populateError);
            twiml.say('Sorry, there was an error retrieving user information for this reminder.');
            twiml.hangup();
            res.type('text/xml');
            return res.send(twiml.toString());
        }

        if (!reminder.user) {
            console.log("User not found for reminder:", reminderId);
            twiml.say('Sorry, the user associated with this reminder was not found.');
            twiml.hangup();
            res.type('text/xml');
            return res.send(twiml.toString());
        }

        // Continue with normal flow
        console.log("Found reminder:", reminder._id, "for user:", reminder.user.phoneNumber);

        // Get time-appropriate greeting
        const hour = new Date().getHours();
        let greeting = 'Hello';
        if (hour < 12) greeting = 'Good morning';
        else if (hour < 18) greeting = 'Good afternoon';
        else greeting = 'Good evening';

        // Add user's name if available
        const userName = reminder.user.name ? `, ${reminder.user.name}` : '';

        // Create initial message
        twiml.say({
            voice: 'Polly.Amy', // Use Amazon Polly for better quality
            language: 'en-US'
        }, `${greeting}${userName}. This is your reminder assistant calling. I'm calling to remind you about: ${reminder.content}. Have you completed this task?`);

        // Gather the user's speech response
        twiml.gather({
            input: 'speech',
            action: `/api/voice/process-response?reminderId=${reminderId}`,
            method: 'POST',
            speechTimeout: 'auto',
            language: 'en-US'
        });

        // Add fallback in case user doesn't respond
        twiml.say('I didn\'t hear a response. Please check your reminder in the app. Goodbye.');
        twiml.hangup();

        // Send the TwiML response
        res.type('text/xml');
        res.send(twiml.toString());

    } catch (error) {
        console.error('Error generating TwiML for reminder call:', error);

        // Send a simple error response
        twiml.say('Sorry, there was an error with this reminder call. Please check your app.');
        twiml.hangup();

        res.type('text/xml');
        res.send(twiml.toString());
    }
};

/**
 * Process user's speech response to a reminder call
 */
const processResponse = async (req, res) => {
    const twiml = new VoiceResponse();
    const reminderId = req.query.reminderId;
    // Extract speech result from Twilio
    const speechResult = req.body.SpeechResult;

    console.log(`Speech response for reminder ${reminderId}: "${speechResult}"`);

    try {
        // Get the reminder
        const reminder = await Reminder.findById(reminderId).populate('user');

        if (!reminder) {
            twiml.say('Sorry, I could not find the reminder information.');
            twiml.hangup();
            res.type('text/xml');
            return res.send(twiml.toString());
        }

        // Analyze speech content
        const analysis = voiceService.analyzeUserSpeech(speechResult);

        // Handle different intents
        switch (analysis.intent) {
            case 'completed':
                // User has completed the task
                await reminderService.updateReminderStatus(reminder._id, 'acknowledged');

                twiml.say('Great! I\'ll mark that as complete. Is there anything else you need help with?');

                // Gather for follow-up question
                twiml.gather({
                    input: 'speech',
                    action: `/api/voice/process-followup?userId=${reminder.user._id}&context=completed`,
                    method: 'POST',
                    speechTimeout: 'auto',
                    language: 'en-US'
                });

                // Add fallback
                twiml.say('I didn\'t hear a response. Thank you for using our reminder service. Goodbye.');
                twiml.hangup();
                break;

            case 'delay':
                // User wants to delay the reminder
                const delayMinutes = analysis.minutes || 30;
                const newReminderTime = new Date(Date.now() + delayMinutes * 60 * 1000);

                // Create a new delayed reminder
                const delayedReminder = await reminderService.createReminder({
                    user: reminder.user._id,
                    content: reminder.content,
                    scheduledFor: newReminderTime,
                    recurrence: 'none',
                    notificationMethod: reminder.notificationMethod
                });

                // Mark the original as acknowledged
                await reminderService.updateReminderStatus(reminder._id, 'acknowledged');

                // Format time for speech
                const timeDisplay = dateParserService.formatDateForDisplay(newReminderTime);

                twiml.say(`I'll remind you again at ${timeDisplay}. Is there anything else you need help with?`);

                // Gather for follow-up question
                twiml.gather({
                    input: 'speech',
                    action: `/api/voice/process-followup?userId=${reminder.user._id}&context=delayed`,
                    method: 'POST',
                    speechTimeout: 'auto',
                    language: 'en-US'
                });

                // Add fallback
                twiml.say('I didn\'t hear a response. Thank you for using our reminder service. Goodbye.');
                twiml.hangup();
                break;

            case 'cancel':
                // User wants to cancel the reminder
                await reminderService.updateReminderStatus(reminder._id, 'cancelled');

                twiml.say('I\'ve cancelled this reminder. Is there anything else you need help with?');

                // Gather for follow-up question
                twiml.gather({
                    input: 'speech',
                    action: `/api/voice/process-followup?userId=${reminder.user._id}&context=cancelled`,
                    method: 'POST',
                    speechTimeout: 'auto',
                    language: 'en-US'
                });

                // Add fallback
                twiml.say('I didn\'t hear a response. Thank you for using our reminder service. Goodbye.');
                twiml.hangup();
                break;

            case 'unknown':
            default:
                // Couldn't understand or ambiguous response
                twiml.say('I\'m not sure I understood. Would you like me to remind you again later?');

                // Gather for clarification
                twiml.gather({
                    input: 'speech',
                    action: `/api/voice/process-response?reminderId=${reminderId}&retry=true`,
                    method: 'POST',
                    speechTimeout: 'auto',
                    language: 'en-US'
                });

                // Add fallback
                twiml.say('I didn\'t hear a response. I\'ll keep this reminder active. Goodbye.');
                twiml.hangup();
                break;
        }

    } catch (error) {
        console.error('Error processing speech response:', error);

        // Send a simple error response
        twiml.say('Sorry, there was an error processing your response. Your reminder will remain active. Please check your app.');
        twiml.hangup();
    }

    res.type('text/xml');
    res.send(twiml.toString());
};

/**
 * Process follow-up responses after reminder is handled
 */
const processFollowup = async (req, res) => {
    const twiml = new VoiceResponse();
    const userId = req.query.userId;
    const context = req.query.context || 'general';
    const speechResult = req.body.SpeechResult;

    console.log(`Follow-up response for user ${userId}: "${speechResult}"`);

    try {
        // Simple check if user wants more help
        const wantsMoreHelp = voiceService.userSaidYes(speechResult?.toLowerCase());

        if (wantsMoreHelp) {
            // User wants more help - could extend this to handle specific requests
            twiml.say('What else can I help you with? For now, you can create or manage reminders through the WhatsApp chat.');
            twiml.pause({ length: 1 });
            twiml.say('Thank you for using our reminder service. Goodbye.');
        } else {
            // User doesn't need anything else
            twiml.say('Thank you for using our reminder service. Have a great day! Goodbye.');
        }

        twiml.hangup();

    } catch (error) {
        console.error('Error processing follow-up response:', error);

        // Send a simple error response
        twiml.say('Sorry, there was an error processing your response. Thank you for using our reminder service. Goodbye.');
        twiml.hangup();
    }

    res.type('text/xml');
    res.send(twiml.toString());
};

/**
 * Handle Twilio call status callbacks
 */
const handleStatusCallback = async (req, res) => {
    const reminderId = req.query.reminderId;
    const callSid = req.body.CallSid;
    const callStatus = req.body.CallStatus;

    console.log(`Call ${callSid} status for reminder ${reminderId}: ${callStatus}`);

    try {
        // Handle failed or unanswered calls
        if (['busy', 'no-answer', 'failed', 'canceled'].includes(callStatus)) {
            console.log(`Call failed with status ${callStatus}, scheduling retry`);

            // Schedule a retry after 10 minutes
            await voiceService.scheduleCallRetry(reminderId, 10);

            // Record the call outcome
            // You could add a calls collection to track this in MongoDB
        }

        // Send a 200 OK response
        res.status(200).send('Status processed');

    } catch (error) {
        console.error('Error handling call status callback:', error);
        res.status(500).send('Error processing status callback');
    }
};

module.exports = {
    handleReminderCall,
    processResponse,
    processFollowup,
    handleStatusCallback
};