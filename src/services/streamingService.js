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

                // Decode the text URL parameter
                const decodedText = decodeURIComponent(text);
                console.log(`Streaming audio for ID: ${audioId}`);
                console.log(`Text content (first 100 chars): ${decodedText.substring(0, 100)}...`);

                // Set appropriate headers for streaming audio
                res.setHeader('Content-Type', 'audio/mpeg');
                res.setHeader('Cache-Control', 'no-cache');
                res.setHeader('Transfer-Encoding', 'chunked');

                // Process SSML if present
                let processedText = decodedText;
                if (decodedText.trim().startsWith('<speak>') && decodedText.trim().endsWith('</speak>')) {
                    processedText = decodedText
                        .replace(/<speak>([\s\S]*)<\/speak>/, '$1')
                        .replace(/<break[^>]*>/g, ' ')
                        .replace(/<[^>]*>/g, '');

                    console.log(`Processed SSML to plain text (first 100 chars): ${processedText.substring(0, 100)}...`);
                }

                // Make request to ElevenLabs streaming API with increased timeout
                console.log(`Making request to ElevenLabs streaming API`);
                const response = await axios({
                    method: 'post',
                    url: `https://api.elevenlabs.io/v1/text-to-speech/${process.env.ELEVENLABS_VOICE_ID}/stream`,
                    data: {
                        text: processedText,
                        model_id: 'eleven_flash_v2_5',
                        voice_settings: {
                            stability: 0.5,
                            similarity_boost: 0.75,
                        }
                    },
                    headers: {
                        'xi-api-key': process.env.ELEVENLABS_API_KEY,
                        'Content-Type': 'application/json',
                    },
                    responseType: 'stream',
                    timeout: 120000 // Increase timeout to 2 minutes for ElevenLabs API
                });

                // Pipe the audio stream directly to the response
                console.log(`Streaming audio to client`);
                response.data.pipe(res);

                // Handle errors in the stream
                response.data.on('error', (error) => {
                    console.error('Error in ElevenLabs stream:', error);
                    if (!res.headersSent) {
                        res.status(500).send('Streaming error');
                    } else {
                        res.end();
                    }
                });

                // Log when the stream ends
                response.data.on('end', () => {
                    console.log(`Finished streaming audio for ID: ${audioId}`);
                });
            } catch (error) {
                console.error('Error streaming audio from ElevenLabs:', error.message);
                if (error.response) {
                    console.error('ElevenLabs API error:', error.response.status, error.response.statusText);
                }

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
        const url = `${process.env.APP_URL}/api/stream-audio/${audioId}?text=${encodedText}`;

        console.log(`Created streaming URL: ${url.substring(0, 100)}...`);
        return url;
    }
}

module.exports = new StreamingService();