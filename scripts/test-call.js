// scripts/test-call.js
//
// Simple script to test making a direct Twilio call
// Usage: node scripts/test-call.js +916363956838
//

require('dotenv').config();

// Check if Twilio is installed
try {
    require('twilio');
} catch (error) {
    console.error('Error: Twilio package is not installed. Run: npm install twilio');
    process.exit(1);
}

const twilio = require('twilio');

// Verify required environment variables
if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN || !process.env.TWILIO_PHONE_NUMBER) {
    console.error('Error: Missing required environment variables.');
    console.error('Make sure TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_PHONE_NUMBER are set in your .env file.');
    process.exit(1);
}

// Get the phone number from command line arguments
const phoneNumber = process.argv[2];

if (!phoneNumber) {
    console.error('Error: No phone number provided.');
    console.error('Usage: node scripts/test-call.js +916363956838');
    process.exit(1);
}

// Function to validate E.164 format
function isValidE164(phoneNumber) {
    const e164Pattern = /^\+[1-9]\d{1,14}$/;
    return e164Pattern.test(phoneNumber);
}

// Validate phone number format
if (!isValidE164(phoneNumber)) {
    console.error('Error: Invalid phone number format. The number must be in E.164 format.');
    console.error('Example: +916363956838 (include the plus sign and country code)');
    process.exit(1);
}

console.log(`Testing Twilio call to ${phoneNumber}...`);

// Initialize Twilio client
const client = twilio(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN
);

// Make a test call
client.calls.create({
    url: 'http://demo.twilio.com/docs/voice.xml', // Test TwiML URL
    to: phoneNumber,
    from: process.env.TWILIO_PHONE_NUMBER
})
    .then(call => {
        console.log('✅ Call initiated successfully!');
        console.log(`Call SID: ${call.sid}`);
        console.log(`Call Status: ${call.status}`);

        // Check call status every 5 seconds for up to 30 seconds
        let checkCount = 0;
        const maxChecks = 6;

        const checkInterval = setInterval(async () => {
            try {
                const callStatus = await client.calls(call.sid).fetch();
                console.log(`Call status after ${(checkCount + 1) * 5} seconds: ${callStatus.status}`);

                checkCount++;

                if (checkCount >= maxChecks || ['completed', 'failed', 'busy', 'no-answer', 'canceled'].includes(callStatus.status)) {
                    clearInterval(checkInterval);
                    console.log('Final call status:', callStatus.status);
                    process.exit(0);
                }
            } catch (error) {
                console.error('Error checking call status:', error.message);
                clearInterval(checkInterval);
                process.exit(1);
            }
        }, 5000);
    })
    .catch(error => {
        console.error('❌ Error initiating call:', error.message);

        if (error.code === 21603) {
            console.error('This error usually means the phone number format is invalid.');
            console.error('Make sure your phone number is in E.164 format (e.g., +916363956838)');
        } else if (error.code === 21212) {
            console.error('This error means the phone number is not a valid phone number.');
        } else if (error.message.includes('authenticate')) {
            console.error('Authentication error. Check your TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN');
        }

        process.exit(1);
    });