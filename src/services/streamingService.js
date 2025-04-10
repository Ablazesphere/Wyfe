// src/services/streamingService.js

const axios = require('axios');
const express = require('express');

/**
 * Service for providing a streaming proxy between ElevenLabs and Twilio
 */
class StreamingService {
    constructor() {
        this.setupStreamingEndpoints = this.setupStreamingEndpoints.bind(this);
    }

    /**
     * Set up streaming endpoints in Express app
     * @param {Object} app - Express app instance
     */
    setupStreamingEndpoints(app) {
        // Ensure the app is provided
        if (!app) {
            console.error('Express app must be provided to set up streaming endpoints');
            return;
        }

        console.log('Setting up streaming proxy endpoints');

        // Create a streaming endpoint for ElevenLabs
        app.get('/api/stream-audio/:audioId', async (req, res) => {
            try {
                const { audioId } = req.params;
                const { text } = req.query;

                // Validate parameters
                if (!text) {
                    return res.status(400).send('Text parameter is required');
                }

                console.log(`Streaming audio for text: ${text.substring(0, 50)}...`);

                // Set appropriate headers for streaming audio
                res.setHeader('Content-Type', 'audio/mpeg');
                res.setHeader('Transfer-Encoding', 'chunked');

                // Process SSML if present
                let processedText = text;
                if (text.trim().startsWith('<speak>') && text.trim().endsWith('</speak>')) {
                    processedText = text
                        .replace(/<speak>([\s\S]*)<\/speak>/, '$1')
                        .replace(/<break[^>]*>/g, ' ')
                        .replace(/<[^>]*>/g, '');
                }

                // Make request to ElevenLabs
                const response = await axios({
                    method: 'post',
                    url: `https://api.elevenlabs.io/v1/text-to-speech/${process.env.ELEVENLABS_VOICE_ID}/stream`,
                    data: {
                        text: processedText,
                        model_id: 'eleven_monolingual_v1',
                        voice_settings: {
                            stability: 0.5,
                            similarity_boost: 0.75
                        }
                    },
                    headers: {
                        'xi-api-key': process.env.ELEVENLABS_API_KEY,
                        'Content-Type': 'application/json',
                    },
                    responseType: 'stream'
                });

                // Pipe the audio stream directly to the response
                response.data.pipe(res);

                // Handle errors in the stream
                response.data.on('error', (error) => {
                    console.error('Error in ElevenLabs stream:', error);
                    res.end();
                });

                // Log when the stream ends
                response.data.on('end', () => {
                    console.log(`Finished streaming audio for ID: ${audioId}`);
                });
            } catch (error) {
                console.error('Error streaming audio from ElevenLabs:', error.message);

                // If headers haven't been sent yet, send error response
                if (!res.headersSent) {
                    res.status(500).send('Error generating audio stream');
                } else {
                    // Otherwise, just end the response
                    res.end();
                }
            }
        });

        console.log('Streaming proxy endpoints set up successfully');
    }

    /**
     * Get URL for streaming audio from our proxy
     * @param {String} text - Text to convert to speech
     * @returns {String} - URL to streaming endpoint
     */
    getStreamingUrl(text) {
        // Create a unique ID for this audio request
        const audioId = Date.now().toString();

        // Create a URL-safe version of the text
        const encodedText = encodeURIComponent(text);

        // Return URL to our proxy endpoint
        return `${process.env.APP_URL}/api/stream-audio/${audioId}?text=${encodedText}`;
    }
}

module.exports = new StreamingService();