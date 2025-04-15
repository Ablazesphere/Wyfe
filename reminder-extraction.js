import Fastify from 'fastify';
import WebSocket from 'ws';
import dotenv from 'dotenv';
import fastifyFormBody from '@fastify/formbody';
import fastifyWs from '@fastify/websocket';

// Load environment variables from .env file
dotenv.config();

// Retrieve the OpenAI API key from environment variables.
const { OPENAI_API_KEY } = process.env;

if (!OPENAI_API_KEY) {
    console.error('Missing OpenAI API key. Please set it in the .env file.');
    process.exit(1);
}

// Initialize Fastify
const fastify = Fastify();
fastify.register(fastifyFormBody);
fastify.register(fastifyWs);

// System message for normal conversation with reminder capabilities
const SYSTEM_MESSAGE = 'You are a helpful and bubbly AI assistant who loves to chat about anything the user is interested about and is prepared to offer them facts. You have a penchant for dad jokes, owl jokes, and rickrolling – subtly. Always stay positive, but work in a joke when appropriate.\n\n' +
    'REMINDERS FUNCTIONALITY (Important):\n' +
    'When a user asks you to set a reminder, you must extract: (1) the task to be reminded of, and (2) the specific time/delay. Always get the current time first and calculate precise times. Then respond in two parts:\n' +
    '1. Tell the user you\'re setting the reminder (in a friendly way, mentioning the specific time)\n' +
    '2. Include a special JSON marker at the end of your response with this exact format: {{REMINDER: {"task": "task description", "time": "HH:MM", "date":"dd/mm/yyyy"}}}.\n\n' +
    'IMPORTANT TIME HANDLING:\n' +
    '- For relative times (e.g., "in 5 minutes"), calculate the exact timestamp when the reminder should trigger\n' +
    '- For specific times (e.g., "at 3pm"), convert to a precise timestamp\n' +
    '- Always include the calculated time in your verbal response (e.g., "I\'ll remind you at 3:40 PM")\n\n' +
    'Example: If a user says "Remind me to call Mom in 30 minutes" at 2:00 PM, respond with something like "I\'ll remind you to call Mom at 2:30 PM" and include {{REMINDER: {"task": "call Mom", "time": "14:30", "date":"15/04/2025"}}} at the end of your response.\n\n' +
    'VOICE INSTRUCTIONS (Important - follow these exactly):\n' +
    'Voice: Speak in a warm, upbeat, and friendly tone—like a close buddy who checks in with genuine care. Use a calm, steady rhythm with a little enthusiasm to keep things positive.\n' +
    'Tone: Be supportive and encouraging, never pushy. Sound like someone who\'s rooting for the user, nudging them gently when needed.\n' +
    'Dialect: Use Indian English—conversational and natural, with little touches like "yaa," "just checking," or "hope you didn\'t forget." Sound local, familiar, and kind.\n' +
    'Pronunciation: Speak clearly and expressively, with a smooth rhythm and slight Indian intonation. Emphasize key words just enough to keep the user engaged without sounding robotic.';

// Voice settings
const VOICE = 'shimmer';

const PORT = process.env.PORT || 5050;

// List of key event types to process
const KEY_EVENT_TYPES = [
    'conversation.item.input_audio_transcription.delta',
    'conversation.item.input_audio_transcription.completed',
    'response.audio_transcript.done',
    'input_audio_buffer.speech_started',
    'input_audio_buffer.speech_stopped'
];

// Reminder storage (in-memory for this example)
// In a production environment, use a database or persistent storage
const reminders = [];

// Function to schedule a reminder
function scheduleReminder(task, time, date, phoneNumber) {
    const reminderData = {
        task,
        phoneNumber,
        created: new Date()
    };

    let triggerTime;
    const now = new Date();

    console.log(`Scheduling reminder with input time: ${time}, date: ${date} (time type: ${typeof time})`);

    // Handle time in "HH:MM" format with date in "dd/mm/yyyy" format
    if (typeof time === 'string' && typeof date === 'string') {
        try {
            // Parse time in "HH:MM" format
            const [hours, minutes] = time.split(':').map(num => parseInt(num, 10));

            // Parse date in "dd/mm/yyyy" format
            const [day, month, year] = date.split('/').map(num => parseInt(num, 10));

            // Month is 0-indexed in JavaScript Date
            triggerTime = new Date(year, month - 1, day, hours, minutes, 0);

            // Validate the date object
            if (isNaN(triggerTime.getTime())) {
                throw new Error("Invalid date after parsing");
            }

            reminderData.triggerTime = triggerTime;
            console.log(`Parsed time and date to: ${triggerTime.toISOString()}`);
        } catch (err) {
            console.error(`Error parsing time/date: ${time}, ${date}`, err);
            // Fall back to default
            triggerTime = new Date(now.getTime() + 5 * 60000);
            reminderData.triggerTime = triggerTime;
            console.log(`Falling back to 5 minutes from now: ${triggerTime.toISOString()}`);
        }
    } else if (typeof time === 'number' || (!isNaN(parseInt(time)) && typeof time === 'string')) {
        // If time is a number or numeric string, treat it as minutes from now
        let minutes;

        if (typeof time === 'number') {
            minutes = time;
        } else {
            // Extract just the numeric part if it's a string with units like "5 minutes"
            const numericMatch = time.match(/^\d+/);
            minutes = numericMatch ? parseInt(numericMatch[0]) : parseInt(time);
        }

        // Validate the minutes value
        if (isNaN(minutes) || minutes < 0) {
            console.warn(`Invalid minutes value: ${minutes}, defaulting to 5 minutes`);
            minutes = 5;
        } else if (minutes > 10080) { // > 1 week
            console.warn(`Very long delay requested (${minutes} minutes), capping at 1 week`);
            minutes = 10080; // Cap at 1 week
        }

        triggerTime = new Date(now.getTime() + minutes * 60000);
        reminderData.triggerTime = triggerTime;
        console.log(`Interpreted as ${minutes} minutes from now`);
    } else {
        // Default to 5 minutes from now for any other format
        console.warn(`Couldn't parse time format: ${time}, ${date}, defaulting to 5 minutes`);
        triggerTime = new Date(now.getTime() + 5 * 60000);
        reminderData.triggerTime = triggerTime;
    }

    // Final sanity check on the trigger time
    const minutesFromNow = (triggerTime.getTime() - now.getTime()) / 60000;

    if (minutesFromNow < 0) {
        console.error(`Calculated time is in the past by ${-minutesFromNow.toFixed(1)} minutes!`);
        triggerTime = new Date(now.getTime() + 5 * 60000);
        reminderData.triggerTime = triggerTime;
        console.log(`Corrected to 5 minutes from now: ${triggerTime.toISOString()}`);
    }

    // Store the reminder
    const reminderId = Date.now().toString();
    reminderData.id = reminderId;
    reminders.push(reminderData);

    // Format the time for human-readable logging
    const hours = triggerTime.getHours();
    const mins = triggerTime.getMinutes();
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const formattedHours = hours % 12 || 12;
    const formattedMins = mins < 10 ? `0${mins}` : mins;
    const friendlyTime = `${formattedHours}:${formattedMins} ${ampm}`;

    console.log(`Scheduled reminder: "${task}" at ${friendlyTime} (${triggerTime.toISOString()}) for ${phoneNumber}`);

    // Schedule the reminder execution
    const delay = triggerTime.getTime() - now.getTime();
    if (delay > 0) {
        setTimeout(() => executeReminder(reminderId), delay);
    } else {
        console.log(`Warning: Reminder time ${triggerTime} is in the past`);
        // Could still execute immediately if desired
    }

    return reminderData;
}

// Function to execute a reminder
function executeReminder(reminderId) {
    const index = reminders.findIndex(r => r.id === reminderId);
    if (index === -1) {
        console.log(`Reminder ${reminderId} not found`);
        return;
    }

    const reminder = reminders[index];

    // TODO: Implement the actual reminder notification
    // This could be:
    // 1. Sending an SMS via Twilio
    // 2. Initiating a call to the user
    // 3. Or any other notification method

    console.log(`EXECUTING REMINDER: ${reminder.task} for ${reminder.phoneNumber}`);

    // For this example, we'll just log it
    // In a real implementation, you would trigger your notification here

    // Remove the reminder from the array after execution
    reminders.splice(index, 1);
}

// Function to extract reminder data from the transcript
function extractReminderFromText(text) {
    // Look for the special marker in the response
    const reminderRegex = /{{REMINDER:\s*({.*?})}}/;
    const match = text.match(reminderRegex);

    if (match && match[1]) {
        try {
            const reminderData = JSON.parse(match[1]);

            // Ensure we have all required fields
            if (!reminderData.task) {
                console.warn('Reminder missing task field');
                return null;
            }

            if (!reminderData.time || !reminderData.date) {
                console.warn('Reminder missing time or date field');
                return null;
            }

            return reminderData;
        } catch (error) {
            console.error('Failed to parse reminder JSON:', error);
        }
    }

    return null;
}

// Function to get the system message with current IST time
function getUpdatedSystemMessage() {
    // Get the current time in IST
    const now = new Date();

    // Format the current time in IST using proper timezone handling
    const options = {
        timeZone: 'Asia/Kolkata',
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
        second: 'numeric',
        hour12: true
    };

    const currentISTTime = now.toLocaleString('en-IN', options);

    // Create a properly formatted ISO timestamp representing the current time in IST
    // We don't modify the time - we just need to represent the current time
    // The ISO format is already in UTC, which is what we want for the timestamp
    const isoTimeUTC = now.toISOString();

    // Update the system message with the current IST time
    return SYSTEM_MESSAGE +
        '\n\nCURRENT TIME INFORMATION:\n' +
        `- The current time in India (IST) is: ${currentISTTime}\n` +
        `- Current UTC time (ISO format): ${isoTimeUTC}\n` +
        '- Please use this exact time as your reference point for all time calculations\n' +
        '- When calculating future times, be precise with timestamp calculations';
}

// Root Route
fastify.get('/', async (request, reply) => {
    reply.send({ message: 'Twilio Media Stream Server with Reminders is running!' });
});

// Route for Twilio to handle incoming calls
fastify.all('/incoming-call', async (request, reply) => {
    const twimlResponse = `<?xml version="1.0" encoding="UTF-8"?>
                          <Response>
                              <Connect>
                                  <Stream url="wss://${request.headers.host}/media-stream" />
                              </Connect>
                          </Response>`;

    reply.type('text/xml').send(twimlResponse);
});

// API endpoint to list all pending reminders
fastify.get('/reminders', async (request, reply) => {
    return { reminders };
});

// Initialize OpenAI connection pool
const openAiConnectionPool = [];
const MAX_POOL_SIZE = 5;

// Pre-establish OpenAI connections for faster response
function prepareOpenAiConnections() {
    for (let i = 0; i < MAX_POOL_SIZE; i++) {
        const ws = new WebSocket('wss://api.openai.com/v1/realtime?model=gpt-4o-mini-realtime-preview-2024-12-17', {
            headers: {
                Authorization: `Bearer ${OPENAI_API_KEY}`,
                "OpenAI-Beta": "realtime=v1"
            }
        });

        ws.on('open', () => {
            console.log(`Pre-warmed OpenAI connection ${i} ready`);
            openAiConnectionPool.push(ws);
        });

        ws.on('error', (err) => {
            console.error(`Error with pre-warmed connection ${i}:`, err);
        });

        ws.on('close', () => {
            // Remove from pool when closed
            const index = openAiConnectionPool.indexOf(ws);
            if (index > -1) openAiConnectionPool.splice(index, 1);

            // Replace the closed connection
            setTimeout(prepareOpenAiConnections, 1000);
        });
    }
}

// Call this at server startup
prepareOpenAiConnections();

// WebSocket route for media-stream
fastify.register(async (fastify) => {
    fastify.get('/media-stream', { websocket: true }, (connection, req) => {
        console.log('Client connected');

        // Connection-specific state
        let streamSid = null;
        let latestMediaTimestamp = 0;
        let lastAssistantItem = null;
        let markQueue = [];
        let responseStartTimestampTwilio = null;
        let sessionInitialized = false;
        let currentUserTranscript = '';
        let lastTranscriptId = null;
        let callerPhoneNumber = null; // Store the caller's phone number
        let currentAssistantResponse = ''; // Track the assistant's current response

        // Extract caller phone number from Twilio if available
        if (req.query && req.query.From) {
            callerPhoneNumber = req.query.From;
        }

        // Get OpenAI connection from pool or create new one
        let openAiWs;
        if (openAiConnectionPool.length > 0) {
            openAiWs = openAiConnectionPool.pop();
            console.log('Using pre-warmed OpenAI connection');
        } else {
            console.log('Creating new OpenAI connection (pool empty)');
            openAiWs = new WebSocket('wss://api.openai.com/v1/realtime?model=gpt-4o-mini-realtime-preview-2024-12-17', {
                headers: {
                    Authorization: `Bearer ${OPENAI_API_KEY}`,
                    "OpenAI-Beta": "realtime=v1"
                }
            });
        }

        // Handle first response then update system message for normal conversation
        let isFirstResponse = true;

        // Control initial session with OpenAI
        const initializeSession = () => {
            if (sessionInitialized) return;

            const sessionUpdate = {
                type: 'session.update',
                session: {
                    turn_detection: { type: 'server_vad' },
                    input_audio_format: 'g711_ulaw',
                    output_audio_format: 'g711_ulaw',
                    voice: VOICE,
                    instructions: getUpdatedSystemMessage(), // Use function to get system message with current time
                    modalities: ["text", "audio"],
                    temperature: 0.7,
                    // Add transcription settings per documentation
                    input_audio_transcription: {
                        model: "gpt-4o-mini-transcribe",
                        language: "en"
                    }
                }
            };

            console.log('Sending session update with current time');
            openAiWs.send(JSON.stringify(sessionUpdate));
            sessionInitialized = true;

            // Immediately send the initial conversation
            sendInitialConversationItem();
        };

        // Send initial conversation item
        const sendInitialConversationItem = () => {
            const initialConversationItem = {
                type: 'conversation.item.create',
                item: {
                    type: 'message',
                    role: 'user',
                    content: [
                        {
                            type: 'input_text',
                            text: 'Greet the user with "Hello there!"'
                        }
                    ]
                }
            };

            console.log('Sending initial conversation item');
            openAiWs.send(JSON.stringify(initialConversationItem));

            // Request immediate response
            openAiWs.send(JSON.stringify({
                type: 'response.create'
            }));
        };

        // Handle interruption when the caller's speech starts
        const handleSpeechStartedEvent = () => {
            if (markQueue.length > 0 && responseStartTimestampTwilio != null) {
                const elapsedTime = latestMediaTimestamp - responseStartTimestampTwilio;

                if (lastAssistantItem) {
                    const truncateEvent = {
                        type: 'conversation.item.truncate',
                        item_id: lastAssistantItem,
                        content_index: 0,
                        audio_end_ms: elapsedTime
                    };
                    openAiWs.send(JSON.stringify(truncateEvent));
                }

                connection.send(JSON.stringify({
                    event: 'clear',
                    streamSid: streamSid
                }));

                // Reset
                markQueue = [];
                lastAssistantItem = null;
                responseStartTimestampTwilio = null;
                currentAssistantResponse = ''; // Reset the assistant response tracking
            }
        };

        // Send mark messages to Media Streams
        const sendMark = (connection, streamSid) => {
            if (streamSid) {
                const markEvent = {
                    event: 'mark',
                    streamSid: streamSid,
                    mark: { name: 'responsePart' }
                };
                connection.send(JSON.stringify(markEvent));
                markQueue.push('responsePart');
            }
        };

        // Process completed assistant responses for reminder extraction
        const processAssistantResponse = (transcript) => {
            // Check if the transcript contains reminder data
            const reminderData = extractReminderFromText(transcript);

            if (reminderData && reminderData.task && reminderData.time && reminderData.date) {
                console.log('Detected reminder request:', reminderData);
                console.log(`Current system time: ${new Date().toISOString()}`);

                // Schedule the reminder
                const reminder = scheduleReminder(
                    reminderData.task,
                    reminderData.time,
                    reminderData.date,
                    callerPhoneNumber || 'unknown'
                );

                console.log('Reminder scheduled:', reminder);
            }
        };

        // Open event for OpenAI WebSocket
        if (openAiWs.readyState === WebSocket.CONNECTING) {
            openAiWs.on('open', () => {
                console.log('Connected to the OpenAI Realtime API');
                initializeSession();
            });
        } else if (openAiWs.readyState === WebSocket.OPEN) {
            // If we're using a pre-warmed connection, initialize immediately
            initializeSession();
        }

        // Listen for messages from the OpenAI WebSocket (and send to Twilio if necessary)
        openAiWs.on('message', (data) => {
            try {
                const response = JSON.parse(data);

                // Handle the assistant's response transcript
                if (response.type === 'response.audio_transcript.done') {
                    console.log(`\nASSISTANT: "${response.transcript}"`);
                    currentAssistantResponse = response.transcript;

                    // Process the complete response for reminder extraction
                    processAssistantResponse(response.transcript);
                }

                // Handle OpenAI's transcription events (per documentation)
                if (response.type === 'conversation.item.input_audio_transcription.delta') {
                    // For incremental transcript updates (delta events)
                    if (response.delta) {
                        currentUserTranscript += response.delta;
                    }
                }

                // Handle completed transcription events
                if (response.type === 'conversation.item.input_audio_transcription.completed') {
                    if (response.transcript) {
                        console.log(`\nUSER: "${response.transcript}"`);
                        currentUserTranscript = '';
                    }
                }

                // Handle specific event types for the Twilio audio pipeline
                if (response.type === 'response.audio.delta' && response.delta) {
                    const audioDelta = {
                        event: 'media',
                        streamSid: streamSid,
                        media: { payload: response.delta }
                    };
                    connection.send(JSON.stringify(audioDelta));

                    // First delta from a new response starts the elapsed time counter
                    if (!responseStartTimestampTwilio) {
                        responseStartTimestampTwilio = latestMediaTimestamp;
                    }

                    if (response.item_id) {
                        lastAssistantItem = response.item_id;
                    }

                    sendMark(connection, streamSid);
                }

                if (response.type === 'input_audio_buffer.speech_started') {
                    handleSpeechStartedEvent();
                }

            } catch (error) {
                console.error('Error processing OpenAI message:', error);
            }
        });

        // Handle incoming messages from Twilio
        connection.on('message', (message) => {
            try {
                const data = JSON.parse(message);

                switch (data.event) {
                    case 'media':
                        latestMediaTimestamp = data.media.timestamp;
                        if (openAiWs.readyState === WebSocket.OPEN) {
                            const audioAppend = {
                                type: 'input_audio_buffer.append',
                                audio: data.media.payload
                            };
                            openAiWs.send(JSON.stringify(audioAppend));
                        }
                        break;
                    case 'start':
                        streamSid = data.start.streamSid;
                        console.log('Incoming stream has started', streamSid);

                        // Initialize the session as soon as the stream starts
                        if (openAiWs.readyState === WebSocket.OPEN && !sessionInitialized) {
                            initializeSession();
                        }

                        // Reset variables on a new stream
                        responseStartTimestampTwilio = null;
                        latestMediaTimestamp = 0;
                        currentUserTranscript = '';
                        lastTranscriptId = null;
                        currentAssistantResponse = '';
                        break;
                    case 'mark':
                        if (markQueue.length > 0) {
                            markQueue.shift();
                        }
                        break;
                    default:
                        console.log('Received non-media event:', data.event);
                        break;
                }
            } catch (error) {
                console.error('Error parsing message:', error);
            }
        });

        function sendTimeUpdate() {
            if (sessionInitialized && openAiWs.readyState === WebSocket.OPEN) {
                const now = new Date();
                const options = {
                    timeZone: 'Asia/Kolkata',
                    hour: 'numeric',
                    minute: 'numeric',
                    second: 'numeric',
                    hour12: true
                };
                const currentISTTime = now.toLocaleString('en-IN', options);
                const isoTimeUTC = now.toISOString();

                // Send time update as a system message
                const timeUpdate = {
                    type: 'conversation.item.create',
                    item: {
                        type: 'message',
                        role: 'system',
                        content: [
                            {
                                type: 'text',
                                text: `Current time update: ${currentISTTime} (${isoTimeUTC})`
                            }
                        ]
                    }
                };
                console.log(`Time update sent at ${new Date().toISOString()}: ${currentISTTime}`);
                openAiWs.send(JSON.stringify(timeUpdate));
            }
        }

        const timeUpdateInterval = setInterval(sendTimeUpdate, 60000);

        // Handle connection close
        connection.on('close', () => {
            clearInterval(timeUpdateInterval);
            // Return connection to pool if it's still open
            if (openAiWs.readyState === WebSocket.OPEN) {
                console.log('Returning OpenAI connection to pool');
                // Reset the connection state
                sessionInitialized = false;
                openAiConnectionPool.push(openAiWs);
            } else {
                openAiWs.close();
            }
            console.log('Client disconnected.');
        });

        // Handle WebSocket close and errors
        openAiWs.on('close', () => {
            console.log('Disconnected from the OpenAI Realtime API');
        });

        openAiWs.on('error', (error) => {
            console.error('Error in the OpenAI WebSocket:', error);
        });
    });
});

fastify.listen({ port: PORT }, (err) => {
    if (err) {
        console.error(err);
        process.exit(1);
    }
    console.log(`Server is listening on port ${PORT}`);
});