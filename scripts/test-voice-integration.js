// scripts/test-voice-integration.js

/**
 * Test script for voice integration components
 * Run with: node scripts/test-voice-integration.js
 */

require('dotenv').config();
const axios = require('axios');

// Mock reminderService for testing purposes
const mockReminderService = {
    getReminderById: async () => ({ _id: '123', content: 'Test reminder' })
};

// Test Twilio integration
async function testTwilioIntegration() {
    console.log('\n=== Testing Twilio Integration ===\n');

    // Check environment variables
    const twilioVars = ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_PHONE_NUMBER'];
    const missingTwilioVars = twilioVars.filter(varName => !process.env[varName]);

    if (missingTwilioVars.length > 0) {
        console.error(`❌ Missing Twilio environment variables: ${missingTwilioVars.join(', ')}`);
        return false;
    }

    console.log('✅ Twilio environment variables are set');

    // Initialize Twilio client
    try {
        const twilio = require('twilio');
        const twilioClient = twilio(
            process.env.TWILIO_ACCOUNT_SID,
            process.env.TWILIO_AUTH_TOKEN
        );

        console.log('✅ Twilio client initialized successfully');

        // Verify credentials by making a simple API call
        const account = await twilioClient.api.accounts(process.env.TWILIO_ACCOUNT_SID).fetch();
        console.log(`✅ Twilio credentials verified successfully (Account: ${account.friendlyName})`);

        // Check if the phone number exists in the account
        const numbers = await twilioClient.incomingPhoneNumbers.list();
        const hasMatchingNumber = numbers.some(num =>
            num.phoneNumber === process.env.TWILIO_PHONE_NUMBER ||
            num.phoneNumber === `+${process.env.TWILIO_PHONE_NUMBER}`
        );

        if (hasMatchingNumber) {
            console.log(`✅ Phone number ${process.env.TWILIO_PHONE_NUMBER} found in your Twilio account`);
        } else {
            console.warn(`⚠️ Phone number ${process.env.TWILIO_PHONE_NUMBER} not found in your Twilio account`);
        }

        return true;
    } catch (error) {
        console.error('❌ Twilio client initialization failed:', error.message);

        if (error.message.includes('authenticate')) {
            console.error('   -> Authentication error. Check your TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN');
        }

        return false;
    }
}

// Test ElevenLabs integration
async function testElevenLabsIntegration() {
    console.log('\n=== Testing ElevenLabs Integration ===\n');

    // Check environment variables
    const elevenLabsVars = ['ELEVENLABS_API_KEY', 'ELEVENLABS_VOICE_ID'];
    const missingVars = elevenLabsVars.filter(varName => !process.env[varName]);

    if (missingVars.length > 0) {
        console.error(`❌ Missing ElevenLabs environment variables: ${missingVars.join(', ')}`);
        return false;
    }

    console.log('✅ ElevenLabs environment variables are set');

    // Test ElevenLabs API
    try {
        // Check if API key is valid by fetching voices
        const response = await axios.get('https://api.elevenlabs.io/v1/voices', {
            headers: {
                'xi-api-key': process.env.ELEVENLABS_API_KEY,
                'Content-Type': 'application/json'
            }
        });

        console.log('✅ ElevenLabs API key is valid');

        // Verify voice ID exists
        const voices = response.data.voices;
        const selectedVoice = voices.find(voice => voice.voice_id === process.env.ELEVENLABS_VOICE_ID);

        if (selectedVoice) {
            console.log(`✅ Voice ID (${process.env.ELEVENLABS_VOICE_ID}) is valid: ${selectedVoice.name}`);
        } else {
            console.error(`❌ Voice ID ${process.env.ELEVENLABS_VOICE_ID} not found in your ElevenLabs account`);
            console.log('   Available voices:');
            voices.forEach(voice => {
                console.log(`   - ${voice.name} (${voice.voice_id})`);
            });
            return false;
        }

        return true;
    } catch (error) {
        console.error('❌ ElevenLabs API test failed:', error.message);

        if (error.response && error.response.status === 401) {
            console.error('   -> Authentication error. Check your ELEVENLABS_API_KEY');
        }

        return false;
    }
}

// Test VoiceService functionality
async function testVoiceServiceIntegration() {
    console.log('\n=== Testing VoiceService Integration ===\n');

    try {
        // Check APP_URL environment variable
        if (!process.env.APP_URL) {
            console.error('❌ Missing APP_URL environment variable');
            return false;
        }

        console.log('✅ APP_URL environment variable is set');

        // Try to require the voiceService module
        try {
            // Save the original require.cache to restore later
            const originalCache = { ...require.cache };

            // Mock the reminderService in the require cache
            require.cache[require.resolve('../src/services/reminderService')] = {
                exports: mockReminderService
            };

            const voiceService = require('../src/services/voiceService');
            console.log('✅ VoiceService module loaded successfully');

            // Restore the original require cache
            require.cache = originalCache;

            return true;
        } catch (error) {
            console.error('❌ Failed to load VoiceService module:', error.message);
            return false;
        }
    } catch (error) {
        console.error('❌ VoiceService test failed:', error.message);
        return false;
    }
}

// Test makeReminderCall with a dummy reminder
async function testMakeReminderCall(testPhoneNumber) {
    console.log('\n=== Testing makeReminderCall Functionality ===\n');

    if (!testPhoneNumber) {
        console.error('❌ No test phone number provided. Use: node scripts/test-voice-integration.js +1234567890');
        return false;
    }

    try {
        // Mock reminderService
        require.cache[require.resolve('../src/services/reminderService')] = {
            exports: mockReminderService
        };

        const voiceService = require('../src/services/voiceService');

        // Create a dummy reminder
        const dummyReminder = {
            _id: 'test123',
            content: 'This is a test reminder',
            user: {
                phoneNumber: testPhoneNumber
            }
        };

        console.log(`Attempting to make a test call to ${testPhoneNumber}...`);

        // Make the call
        const call = await voiceService.makeReminderCall(dummyReminder);

        console.log(`✅ Test call initiated successfully! Call SID: ${call.sid}`);
        console.log(`   Call status: ${call.status}`);

        return true;
    } catch (error) {
        console.error('❌ Test call failed:', error.message);

        if (error.code === 21603) {
            console.error('   -> Invalid phone number format. Phone number must be in E.164 format');
            console.error('      Example: +12125551234');
        } else if (error.code === 21212) {
            console.error('   -> The provided phone number is not a valid phone number');
        }

        return false;
    }
}

// Main test function
async function runTests() {
    console.log('=== Voice Integration Diagnostic Tool ===\n');

    const testPhone = process.argv[2]; // Get phone number from command line args

    let allPassed = true;

    // Run tests
    allPassed = await testTwilioIntegration() && allPassed;
    allPassed = await testElevenLabsIntegration() && allPassed;
    allPassed = await testVoiceServiceIntegration() && allPassed;

    // Only test the call if all previous tests pass and a phone number was provided
    if (allPassed && testPhone) {
        allPassed = await testMakeReminderCall(testPhone) && allPassed;
    } else if (allPassed) {
        console.log('\n⚠️ No test phone number provided. Skipping call test.');
        console.log('   To test a call, run: node scripts/test-voice-integration.js +1234567890\n');
    }

    // Print final results
    console.log('\n=== Test Results ===\n');

    if (allPassed) {
        console.log('✅ All available tests passed!');

        if (!testPhone) {
            console.log('   Run with a phone number to test calling functionality:');
            console.log('   node scripts/test-voice-integration.js +1234567890');
        }
    } else {
        console.log('❌ Some tests failed. Please fix the issues and try again.');
    }
}

// Run the tests
runTests().catch(console.error);