// src/controllers/voiceController.js

const VoiceResponse = require('twilio').twiml.VoiceResponse;
const Reminder = require('../models/reminder');
const User = require('../models/USER.JS');
const voiceService = require('../services/voiceService');
const reminderService = require('../services/reminderService');
const dateParserService = require('../services/dateParserService');
const mongoose = require('mongoose');

/**
 * Creates a more natural-sounding speech text based on reminder content
 * @param {Object} reminder - The reminder object
 * @param {String} greeting - Time-based greeting (Good morning, etc.)
 * @param {String} userName - User's name or empty string
 * @returns {String} - Natural sounding speech text with SSML
 */
const createNaturalSpeechText = (reminder, greeting, userName) => {
    // Extract core information
    const content = reminder.content;
    const nameGreeting = userName ? `${greeting}, ${userName.trim()}!` : `${greeting}!`;

    // Create variations of intros to sound more natural
    const intros = [
        `${nameGreeting} Just calling to remind you about something.`,
        `${nameGreeting} I wanted to check in about something.`,
        `${nameGreeting} This is your reminder about something important.`,
        `${nameGreeting} Hope your day is going well. I'm calling about a reminder.`
    ];

    // Create variations of the reminder content phrasing
    const contentPhrases = [
        `You asked me to remind you to ${content}.`,
        `You wanted to remember to ${content}.`,
        `Don't forget to ${content}.`,
        `I'm calling about ${content}.`,
        `You have ${content} on your list today.`
    ];

    // Create variations of follow-up questions
    const followUps = [
        `Have you had a chance to do this yet?`,
        `Have you taken care of this?`,
        `Did you already handle this?`,
        `Is this something you've completed?`,
        `Has this been done yet?`
    ];

    // Select random variations to create a more natural, varied speech pattern
    const randomIntro = intros[Math.floor(Math.random() * intros.length)];
    const randomContent = contentPhrases[Math.floor(Math.random() * contentPhrases.length)];
    const randomFollowUp = followUps[Math.floor(Math.random() * followUps.length)];

    // Combine the parts with natural pauses (using SSML)
    const speechText = `<speak>${randomIntro} <break time="300ms"/> ${randomContent} <break time="200ms"/> ${randomFollowUp}</speak>`;

    return speechText;
};

/**
 * Create a natural-sounding completion response
 * @param {String} reminderContent - The content of the reminder
 * @returns {String} - Natural speech text with SSML
 */
const createCompletionResponse = (reminderContent) => {
    const responses = [
        `<speak>Great job! <break time="200ms"/> I'll mark that as completed. <break time="300ms"/> Is there anything else I can help you with today?</speak>`,
        `<speak>Perfect! <break time="200ms"/> I've marked that as done. <break time="300ms"/> Can I help with anything else?</speak>`,
        `<speak>Excellent! <break time="200ms"/> That's been checked off your list. <break time="300ms"/> Is there something else you need assistance with?</speak>`,
        `<speak>Awesome! <break time="200ms"/> I've marked that reminder as complete. <break time="300ms"/> Anything else you need help with?</speak>`,
        `<speak>Sounds good! <break time="200ms"/> I've marked ${reminderContent} as completed. <break time="300ms"/> Anything else I can do for you?</speak>`
    ];

    return responses[Math.floor(Math.random() * responses.length)];
};

/**
 * Create a natural-sounding delay response
 * @param {String} timeDisplay - The formatted time for the delayed reminder
 * @returns {String} - Natural speech text with SSML
 */
const createDelayResponse = (timeDisplay) => {
    const responses = [
        `<speak>No problem at all! <break time="200ms"/> I'll remind you again at ${timeDisplay}. <break time="300ms"/> Is there anything else you need?</speak>`,
        `<speak>Sure thing! <break time="200ms"/> I'll get back to you about this at ${timeDisplay}. <break time="300ms"/> Can I help with anything else?</speak>`,
        `<speak>Got it. <break time="200ms"/> I've rescheduled this for ${timeDisplay}. <break time="300ms"/> Anything else you need assistance with?</speak>`,
        `<speak>I understand. <break time="200ms"/> I'll remind you again at ${timeDisplay}. <break time="300ms"/> Is there something else I can help with today?</speak>`,
        `<speak>Alright! <break time="200ms"/> I've set this reminder for ${timeDisplay} instead. <break time="300ms"/> Anything else you'd like help with?</speak>`
    ];

    return responses[Math.floor(Math.random() * responses.length)];
};

/**
 * Create a natural-sounding cancellation response
 * @returns {String} - Natural speech text with SSML
 */
const createCancellationResponse = () => {
    const responses = [
        `<speak>No problem! <break time="200ms"/> I've cancelled that reminder for you. <break time="300ms"/> Is there anything else I can help with?</speak>`,
        `<speak>Sure thing! <break time="200ms"/> That reminder has been removed from your list. <break time="300ms"/> Can I help with anything else today?</speak>`,
        `<speak>Got it. <break time="200ms"/> I've gone ahead and cancelled that reminder. <break time="300ms"/> Anything else you need?</speak>`,
        `<speak>All set! <break time="200ms"/> I've removed that from your reminders. <break time="300ms"/> Is there something else you'd like assistance with?</speak>`,
        `<speak>Done! <break time="200ms"/> That reminder has been cancelled. <break time="300ms"/> Anything else I can help you with?</speak>`
    ];

    return responses[Math.floor(Math.random() * responses.length)];
};

/**
 * Create a natural-sounding unclear response
 * @returns {String} - Natural speech text with SSML
 */
const createUnclearResponse = () => {
    const responses = [
        `<speak>I'm not quite sure I understood that. <break time="200ms"/> Would you like me to remind you about this again later?</speak>`,
        `<speak>Sorry, I didn't catch that clearly. <break time="200ms"/> Should I remind you about this again at a later time?</speak>`,
        `<speak>I'm having trouble understanding. <break time="200ms"/> Would you like me to reschedule this reminder for later?</speak>`,
        `<speak>I didn't quite get that. <break time="200ms"/> Do you want me to remind you about this again later?</speak>`,
        `<speak>Sorry about that. <break time="200ms"/> Would you like me to remind you about this at another time?</speak>`
    ];

    return responses[Math.floor(Math.random() * responses.length)];
};

/**
 * Create a natural-sounding follow-up response based on whether user wants more help
 * @param {Boolean} wantsMoreHelp - Whether the user wants additional help
 * @returns {String} - Natural speech text with SSML
 */
const createFollowUpResponse = (wantsMoreHelp) => {
    if (wantsMoreHelp) {
        const responses = [
            `<speak>I'd be happy to help with something else! <break time="200ms"/> Currently, you can manage your reminders through WhatsApp chat. <break time="300ms"/> Is there a specific reminder you'd like me to set up for you?</speak>`,
            `<speak>Sure thing! <break time="200ms"/> Right now, reminder management is available through WhatsApp. <break time="300ms"/> Would you like me to explain how to set up new reminders?</speak>`,
            `<speak>Of course! <break time="200ms"/> At the moment, you can use the WhatsApp chat to manage your reminders. <break time="300ms"/> Is there a particular reminder you're interested in setting up?</speak>`
        ];
        return responses[Math.floor(Math.random() * responses.length)];
    } else {
        const responses = [
            `<speak>Alright then! <break time="200ms"/> Have a wonderful day. <break time="100ms"/> Goodbye!</speak>`,
            `<speak>Sounds good! <break time="200ms"/> Thanks for using our reminder service. <break time="100ms"/> Have a great day!</speak>`,
            `<speak>Perfect! <break time="200ms"/> I hope the rest of your day goes well. <break time="100ms"/> Bye for now!</speak>`,
            `<speak>No problem! <break time="200ms"/> Enjoy the rest of your day. <break time="100ms"/> Goodbye!</speak>`
        ];
        return responses[Math.floor(Math.random() * responses.length)];
    }
};

/**
 * Create a natural-sounding goodbye message
 * @returns {String} - Natural speech text with SSML
 */
const createGoodbyeMessage = () => {
    const responses = [
        `<speak>Thanks for using our reminder service! <break time="200ms"/> Have a wonderful day!</speak>`,
        `<speak>I appreciate you using our service! <break time="200ms"/> Talk to you next time!</speak>`,
        `<speak>Thank you for your time! <break time="200ms"/> Catch you later!</speak>`,
        `<speak>Thanks for chatting with me today! <break time="200ms"/> Goodbye!</speak>`
    ];

    return responses[Math.floor(Math.random() * responses.length)];
};

/**
 * Generate TwiML for initial reminder call using ElevenLabs for voice
 */
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
            // Fallback to TwiML say for error messages
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
        const userName = reminder.user.name || "";

        // Create the natural-sounding speech text
        const speechText = createNaturalSpeechText(reminder, greeting, userName);

        try {
            // Get either a streaming URL or file URL depending on configuration
            console.log("Generating ElevenLabs speech for reminder call");
            console.log("Speech text:", speechText);

            // Use getSpeechUrl instead of generateAndSaveSpeech
            const audioUrl = await voiceService.getSpeechUrl(speechText, `reminder-${reminderId}`);

            console.log(`Using ElevenLabs audio URL: ${audioUrl}`);

            // Play the ElevenLabs generated audio
            twiml.play(audioUrl);

            // Gather the user's speech response
            twiml.gather({
                input: 'speech',
                action: `/api/voice/process-response?reminderId=${reminderId}`,
                method: 'POST',
                speechTimeout: 'auto',
                language: 'en-US'
            });

            // Add fallback in case user doesn't respond
            // Use a more natural fallback message too
            twiml.say({
                voice: 'Polly.Amy',
                language: 'en-US'
            }, "I didn't catch that. No worries, you can check the reminder in your messages. Take care!");
            twiml.hangup();
        } catch (speechError) {
            console.error("Error generating ElevenLabs speech:", speechError);
            console.log("Falling back to TwiML say for speech");

            // Fallback to regular TwiML say if ElevenLabs fails
            // Still use more natural text, just without SSML
            const fallbackText = `${greeting} ${userName}. I'm calling about your reminder to ${reminder.content}. Have you had a chance to do this yet?`;

            twiml.say({
                voice: 'Polly.Amy',  // Fallback to Amazon Polly
                language: 'en-US'
            }, fallbackText);

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
        }

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
        let responseText = '';

        // Handle different intents
        switch (analysis.intent) {
            case 'completed':
                // User has completed the task
                await reminderService.updateReminderStatus(reminder._id, 'acknowledged');
                responseText = createCompletionResponse(reminder.content);
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
                responseText = createDelayResponse(timeDisplay);
                break;

            case 'cancel':
                // User wants to cancel the reminder
                await reminderService.updateReminderStatus(reminder._id, 'cancelled');
                responseText = createCancellationResponse();
                break;

            case 'unknown':
            default:
                // Couldn't understand or ambiguous response
                responseText = createUnclearResponse();

                // Send this response
                try {
                    const audioUrl = await voiceService.getSpeechUrl(responseText, `response-${reminderId}`);
                    twiml.play(audioUrl);
                } catch (error) {
                    console.error('Error generating ElevenLabs speech for response:', error);
                    twiml.say({
                        voice: 'Polly.Amy',
                        language: 'en-US'
                    }, "I'm not quite sure I understood. Would you like me to remind you about this again later?");
                }

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

                res.type('text/xml');
                return res.send(twiml.toString());
        }

        // For completed, delay, or cancel intents, we use the response text and gather for follow-up
        try {
            const audioUrl = await voiceService.getSpeechUrl(responseText, `response-${reminderId}`);
            twiml.play(audioUrl);
        } catch (error) {
            console.error('Error generating ElevenLabs speech for response:', error);
            // Fallback to simpler messages without SSML when using Polly
            let fallbackText = "Great! I've marked that as complete. Is there anything else I can help with?";

            if (analysis.intent === 'delay') {
                const timeDisplay = dateParserService.formatDateForDisplay(newReminderTime);
                fallbackText = `No problem! I'll remind you again at ${timeDisplay}. Is there anything else you need?`;
            } else if (analysis.intent === 'cancel') {
                fallbackText = "Sure thing! I've cancelled that reminder. Is there anything else I can help with?";
            }

            twiml.say({
                voice: 'Polly.Amy',
                language: 'en-US'
            }, fallbackText);
        }

        // Context varies based on the action taken
        const context = analysis.intent === 'completed' ? 'completed' :
            analysis.intent === 'delay' ? 'delayed' : 'cancelled';

        // Gather for follow-up question
        twiml.gather({
            input: 'speech',
            action: `/api/voice/process-followup?userId=${reminder.user._id}&context=${context}`,
            method: 'POST',
            speechTimeout: 'auto',
            language: 'en-US'
        });

        // Add fallback
        twiml.say('I didn\'t hear a response. Thanks for using our reminder service. Have a great day!');
        twiml.hangup();

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

        // Create appropriate follow-up response
        const responseText = createFollowUpResponse(wantsMoreHelp);

        // Try to use ElevenLabs for the response
        try {
            const audioUrl = await voiceService.getSpeechUrl(responseText, `followup-${userId}`);
            twiml.play(audioUrl);
        } catch (error) {
            console.error('Error generating ElevenLabs speech for followup:', error);

            // Fallback to simpler messages without SSML for Polly
            let fallbackText = wantsMoreHelp
                ? "I'd be happy to help with something else! You can manage your reminders through WhatsApp chat."
                : "Thanks for using our reminder service. Have a great day!";

            twiml.say({
                voice: 'Polly.Amy',
                language: 'en-US'
            }, fallbackText);
        }

        // If they don't want more help, just end the call
        if (!wantsMoreHelp) {
            twiml.hangup();
        } else {
            // If they want more help, add a pause and another message before ending
            twiml.pause({ length: 1 });

            const goodbyeText = createGoodbyeMessage();
            try {
                const audioUrl = await voiceService.getSpeechUrl(goodbyeText, `goodbye-${userId}`);
                twiml.play(audioUrl);
            } catch (error) {
                twiml.say("Thank you for using our reminder service. Goodbye!");
            }

            twiml.hangup();
        }

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
    handleStatusCallback,
    createNaturalSpeechText,
    createCompletionResponse,
    createDelayResponse,
    createCancellationResponse,
    createUnclearResponse,
    createFollowUpResponse,
    createGoodbyeMessage
};