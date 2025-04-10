// src/routes/voiceRoutes.js

const express = require('express');
const router = express.Router();
const voiceController = require('../controllers/voiceController');

// Route for initial reminder call TwiML generation
router.get('/reminder-call', voiceController.handleReminderCall);

// Route for processing user's speech response
router.post('/process-response', voiceController.processResponse);

// Route for processing follow-up responses
router.post('/process-followup', voiceController.processFollowup);

// Route for handling Twilio call status callbacks
router.post('/status-callback', voiceController.handleStatusCallback);

module.exports = router;