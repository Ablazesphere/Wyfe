// services/openaiService.js - Simplified for general chatbot

import WebSocket from 'ws';
import { config } from '../config/config.js';
import { logger } from '../utils/logger.js';

/**
 * Create a new OpenAI connection
 * @returns {WebSocket} An OpenAI WebSocket connection
 */
export function getOpenAiConnection() {
    logger.info('Creating new OpenAI connection');
    return new WebSocket(`wss://api.openai.com/v1/realtime?model=${config.OPENAI_MODEL}`, {
        headers: {
            Authorization: `Bearer ${config.OPENAI_API_KEY}`,
            "OpenAI-Beta": "realtime=v1"
        }
    });
}

/**
 * Close the WebSocket connection
 * @param {WebSocket} connection The WebSocket connection
 */
export function closeConnection(connection) {
    if (connection && connection.readyState === WebSocket.OPEN) {
        logger.info('Closing OpenAI connection');
        connection.close();
    }
}

/**
 * Initialize a session with OpenAI
 * @param {WebSocket} openAiWs The OpenAI WebSocket
 * @returns {Promise} Resolves when session is initialized
 */
export function initializeSession(openAiWs) {
    return new Promise((resolve, reject) => {
        // For a general chatbot, we can use a simpler system message
        const systemInstructions = `You are a helpful, friendly voice assistant designed to have 
        natural conversations with users. Respond in a conversational, warm manner. Keep responses 
        concise and engaging. You can discuss a wide range of topics including answering questions, 
        providing information, having casual conversation, telling jokes, or discussing ideas.`;

        const sessionUpdate = {
            type: 'session.update',
            session: {
                turn_detection: { type: 'server_vad' },
                input_audio_format: 'g711_ulaw',
                output_audio_format: 'g711_ulaw',
                voice: config.OPENAI_VOICE,
                instructions: systemInstructions,
                modalities: ["text", "audio"],
                temperature: 0.7,
                input_audio_transcription: {
                    model: "gpt-4o-mini-transcribe",
                    language: "en"
                }
            }
        };

        logger.info('Sending session update');

        if (openAiWs.readyState === WebSocket.OPEN) {
            openAiWs.send(JSON.stringify(sessionUpdate));
            resolve();
        } else {
            openAiWs.on('open', () => {
                openAiWs.send(JSON.stringify(sessionUpdate));
                resolve();
            });

            openAiWs.on('error', (error) => {
                reject(error);
            });
        }
    });
}

/**
 * Send initial conversation item to start the interaction
 * @param {WebSocket} openAiWs OpenAI WebSocket
 */
export function sendInitialConversation(openAiWs) {
    if (openAiWs.readyState !== WebSocket.OPEN) return;

    const initialConversationItem = {
        type: 'conversation.item.create',
        item: {
            type: 'message',
            role: 'user',
            content: [
                {
                    type: 'input_text',
                    text: 'Greet the user with a friendly hello and ask how you can help them today.'
                }
            ]
        }
    };

    logger.info('Sending initial conversation item');
    openAiWs.send(JSON.stringify(initialConversationItem));

    // Request immediate response
    openAiWs.send(JSON.stringify({
        type: 'response.create'
    }));
}

/**
 * Truncate the assistant's response
 * @param {WebSocket} openAiWs OpenAI WebSocket
 * @param {string} itemId Item ID to truncate
 * @param {number} elapsedTime Elapsed time in ms
 */
export function truncateAssistantResponse(openAiWs, itemId, elapsedTime) {
    if (!itemId || openAiWs.readyState !== WebSocket.OPEN) return;

    const truncateEvent = {
        type: 'conversation.item.truncate',
        item_id: itemId,
        content_index: 0,
        audio_end_ms: elapsedTime
    };

    openAiWs.send(JSON.stringify(truncateEvent));
    logger.debug(`Truncated assistant response at ${elapsedTime}ms`);
}

/**
 * Send audio buffer to OpenAI
 * @param {WebSocket} openAiWs OpenAI WebSocket
 * @param {string} audioData Audio data
 */
export function sendAudioBuffer(openAiWs, audioData) {
    if (openAiWs.readyState !== WebSocket.OPEN) return;

    const audioAppend = {
        type: 'input_audio_buffer.append',
        audio: audioData
    };

    openAiWs.send(JSON.stringify(audioAppend));
}