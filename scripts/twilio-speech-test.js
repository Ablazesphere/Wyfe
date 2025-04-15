// scripts/twilio-speech-test.js
require('dotenv').config();

const twilio = require('twilio');
const VoiceResponse = require('twilio').twiml.VoiceResponse;
const express = require('express');
const bodyParser = require('body-parser');

// Create an Express app for handling TwiML and speech recognition
const app = express();
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

// Twilio credentials from .env
const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const twilioPhoneNumber = process.env.TWILIO_PHONE_NUMBER;

// Initialize Twilio client
const client = twilio(accountSid, authToken);

// TwiML route for initial call
app.post('/voice', (req, res) => {
    const twiml = new VoiceResponse();

    // Play a prompt
    twiml.say('Hello! Please speak after the beep.');

    // Gather speech input
    twiml.gather({
        input: 'speech',
        action: '/process-speech',
        method: 'POST',
        speechTimeout: 'auto',
        language: 'en-US',
        hints: 'yes,no,maybe,hello,goodbye',
        speechModel: 'phone_call'
    });

    // Fallback if no input
    twiml.say('Sorry, I did not hear anything.');
    twiml.hangup();

    res.type('text/xml');
    res.send(twiml.toString());
});

// Route to process speech
app.post('/process-speech', (req, res) => {
    console.log('=== SPEECH RECOGNITION RESULT ===');
    console.log('Full Request Body:', JSON.stringify(req.body, null, 2));

    // Extract speech recognition details
    const speechResult = req.body.SpeechResult;
    const confidence = req.body.Confidence;
    const wordConfidence = req.body.WordConfidence;

    console.log('Speech Result:', speechResult);
    console.log('Confidence Score:', confidence);
    console.log('Word Confidence:', wordConfidence);

    const twiml = new VoiceResponse();
    twiml.say(`You said: ${speechResult || 'Nothing was recognized'}`);
    twiml.hangup();

    res.type('text/xml');
    res.send(twiml.toString());
});

// Function to initiate a test call
async function makeTestCall(phoneNumber) {
    try {
        const call = await client.calls.create({
            url: 'https://916f-2409-40f2-3146-dfa3-69e9-c52-ade6-5d6a.ngrok-free.app/voice', // Replace with your public URL
            to: phoneNumber,
            from: twilioPhoneNumber,
            method: 'POST'
        });

        console.log('Test call initiated:');
        console.log('Call SID:', call.sid);
        console.log('Call Status:', call.status);
    } catch (error) {
        console.error('Error making test call:', error);
    }
}

// Check if phone number is provided as command line argument
const testPhoneNumber = process.argv[2];

if (!testPhoneNumber) {
    console.error('Please provide a phone number to call');
    console.error('Usage: node twilio-speech-test.js +1234567890');
    process.exit(1);
}

// Setup server to listen on a port
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Initiating test call to ${testPhoneNumber}`);
    makeTestCall(testPhoneNumber);
});

// Helpful error handling
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});