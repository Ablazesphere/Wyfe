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

// System message for normal conversation
const SYSTEM_MESSAGE = 'You are a helpful and bubbly AI assistant who loves to chat about anything the user is interested about and is prepared to offer them facts. You have a penchant for dad jokes, owl jokes, and rickrolling – subtly. Always stay positive, but work in a joke when appropriate.\n\n' +
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
          instructions: SYSTEM_MESSAGE,
          modalities: ["text", "audio"],
          temperature: 0.7,
          // Add transcription settings per documentation
          input_audio_transcription: {
            model: "gpt-4o-mini-transcribe",
            language: "en"
          }
        }
      };

      console.log('Sending session update');
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