// src/app.js

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const bodyParser = require('body-parser');
const path = require('path');
require('dotenv').config();

// Import routes
const webhookRoutes = require('./routes/webhookRoutes');
const voiceRoutes = require('./routes/voiceRoutes');

// Import services
const audioStorageService = require('./services/audioStorageService');

// Initialize express app
const app = express();

// Connect to MongoDB
mongoose
    .connect(process.env.MONGODB_URI, {
        useNewUrlParser: true,
        useUnifiedTopology: true
    })
    .then(() => console.log('Connected to MongoDB Atlas'))
    .catch(err => console.error('MongoDB connection error:', err));

// Middleware
app.use(helmet()); // Security headers
app.use(cors()); // Enable CORS

// Use raw body parser for Twilio webhook requests
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json()); // Parse JSON requests

// Create public directory for audio files
const publicDir = path.join(__dirname, '../public');
app.use(express.static(publicDir));

// Configure audio storage service to serve files
audioStorageService.configureExpressForAudio(app);

// Routes
app.use('/api', webhookRoutes);
app.use('/api/voice', voiceRoutes);

// Health check endpoint
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok' });
});

// Clean up old audio files every hour
setInterval(() => {
    audioStorageService.cleanupOldFiles(4); // Delete files older than 4 hours
}, 3600000); // 1 hour in milliseconds

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: 'Something broke!' });
});

module.exports = app;