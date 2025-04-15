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

// Modify system message for the first greeting to be faster
const INITIAL_SYSTEM_MESSAGE = 'You are an AI assistant who gives very brief initial greetings. Your first response should be a quick hello, no longer than 2-3 words.';

// Full system message for normal conversation
const SYSTEM_MESSAGE = 'You are a helpful and bubbly AI assistant who loves to chat about anything the user is interested about and is prepared to offer them facts. You have a penchant for dad jokes, owl jokes, and rickrolling – subtly. Always stay positive, but work in a joke when appropriate.\n\n' +
  'VOICE INSTRUCTIONS (Important - follow these exactly):\n' +
  'Voice: Speak in a warm, upbeat, and friendly tone—like a close buddy who checks in with genuine care. Use a calm, steady rhythm with a little enthusiasm to keep things positive.\n' +
  'Tone: Be supportive and encouraging, never pushy. Sound like someone who\'s rooting for the user, nudging them gently when needed.\n' +
  'Dialect: Use Indian English—conversational and natural, with little touches like "yaa," "just checking," or "hope you didn\'t forget." Sound local, familiar, and kind.\n' +
  'Pronunciation: Speak clearly and expressively, with a smooth rhythm and slight Indian intonation. Emphasize key words just enough to keep the user engaged without sounding robotic.';

// Voice settings
const VOICE = 'shimmer'; // Using 'nova' instead of 'alloy' for a warmer tone

const PORT = process.env.PORT || 5050; // Allow dynamic port assignment

// We'll optimize the connection flow instead of using pre-recorded greetings

// List of Event Types to log to the console.
const LOG_EVENT_TYPES = [
  'error',
  'response.content.done',
  'rate_limits.updated',
  'response.done',
  'input_audio_buffer.committed',
  'input_audio_buffer.speech_stopped',
  'input_audio_buffer.speech_started',
  'session.created'
];

// Show AI response elapsed timing calculations
const SHOW_TIMING_MATH = false;

// Root Route
fastify.get('/', async (request, reply) => {
  reply.send({ message: 'Twilio Media Stream Server is running!' });
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

// Initialize OpenAI connection pool
const openAiConnectionPool = [];
const MAX_POOL_SIZE = 5; // Increased pool size for better availability

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

    // Function to update system message after initial greeting
    const updateToFullSystemMessage = () => {
      if (!isFirstResponse) return;

      console.log('Updating to full system message for normal conversation');
      const fullSessionUpdate = {
        type: 'session.update',
        session: {
          instructions: SYSTEM_MESSAGE
        }
      };

      openAiWs.send(JSON.stringify(fullSessionUpdate));
      isFirstResponse = false;
    };

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
          // Use simpler instructions for initial greeting
          instructions: SYSTEM_MESSAGE,
          modalities: ["text", "audio"],
          temperature: 0.7, // Slightly lower temperature for faster responses
        }
      };

      console.log('Sending session update for fast greeting');
      openAiWs.send(JSON.stringify(sessionUpdate));
      sessionInitialized = true;

      // Immediately send the initial conversation
      sendInitialConversationItem();
    };

    // Send initial conversation item with simplified greeting
    const sendInitialConversationItem = () => {
      const initialConversationItem = {
        type: 'conversation.item.create',
        item: {
          type: 'message',
          role: 'user',
          content: [
            {
              type: 'input_text',
              // Use a shorter prompt for faster response generation
              text: 'Greet the user with "Hello there!"'
            }
          ]
        }
      };

      console.log('Sending initial conversation item');
      openAiWs.send(JSON.stringify(initialConversationItem));

      // Request immediate response with standard parameters
      openAiWs.send(JSON.stringify({
        type: 'response.create'
      }));
    };

    // Handle interruption when the caller's speech starts
    const handleSpeechStartedEvent = () => {
      if (markQueue.length > 0 && responseStartTimestampTwilio != null) {
        const elapsedTime = latestMediaTimestamp - responseStartTimestampTwilio;
        if (SHOW_TIMING_MATH) console.log(`Calculating elapsed time for truncation: ${latestMediaTimestamp} - ${responseStartTimestampTwilio} = ${elapsedTime}ms`);

        if (lastAssistantItem) {
          const truncateEvent = {
            type: 'conversation.item.truncate',
            item_id: lastAssistantItem,
            content_index: 0,
            audio_end_ms: elapsedTime
          };
          if (SHOW_TIMING_MATH) console.log('Sending truncation event:', JSON.stringify(truncateEvent));
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

    // Open event for OpenAI WebSocket
    if (openAiWs.readyState === WebSocket.CONNECTING) {
      openAiWs.on('open', () => {
        console.log('Connected to the OpenAI Realtime API');
        initializeSession(); // Initialize immediately without delay
      });
    } else if (openAiWs.readyState === WebSocket.OPEN) {
      // If we're using a pre-warmed connection, initialize immediately
      initializeSession();
    }

    // Listen for messages from the OpenAI WebSocket (and send to Twilio if necessary)
    openAiWs.on('message', (data) => {
      try {
        const response = JSON.parse(data);

        if (LOG_EVENT_TYPES.includes(response.type)) {
          console.log(`Received event: ${response.type}`, response);
        }

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
            if (SHOW_TIMING_MATH) console.log(`Setting start timestamp for new response: ${responseStartTimestampTwilio}ms`);
          }

          if (response.item_id) {
            lastAssistantItem = response.item_id;
          }

          sendMark(connection, streamSid);
        }

        // After first response is completed, update to full system message
        if (response.type === 'response.content.done' && isFirstResponse) {
          updateToFullSystemMessage();
        }

        if (response.type === 'input_audio_buffer.speech_started') {
          handleSpeechStartedEvent();
        }
      } catch (error) {
        console.error('Error processing OpenAI message:', error, 'Raw message:', data);
      }
    });

    // Handle incoming messages from Twilio
    connection.on('message', (message) => {
      try {
        const data = JSON.parse(message);

        switch (data.event) {
          case 'media':
            latestMediaTimestamp = data.media.timestamp;
            if (SHOW_TIMING_MATH) console.log(`Received media message with timestamp: ${latestMediaTimestamp}ms`);
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

            // Reset start and media timestamp on a new stream
            responseStartTimestampTwilio = null;
            latestMediaTimestamp = 0;
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
        console.error('Error parsing message:', error, 'Message:', message);
      }
    });

    // Handle connection close
    connection.on('close', () => {
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