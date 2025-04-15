// src/routes/voiceRoutes.js

const express = require('express');
const router = express.Router();
const voiceController = require('../controllers/voiceController');

// Route for initial reminder call TwiML generation
router.route('/reminder-call')
    .get(voiceController.handleReminderCall)
    .post(voiceController.handleReminderCall);


router.get('/create-reminder', voiceController.handleCreateReminder);
router.post('/create-reminder-content', voiceController.processReminderContent);
router.post('/create-reminder-time', voiceController.processReminderTime);

// Route for processing user's speech response
router.post('/process-response', voiceController.processResponse);

// Route for processing follow-up responses
router.post('/process-followup', voiceController.processFollowup);

// Route for handling Twilio call status callbacks
router.post('/status-callback', voiceController.handleStatusCallback);

module.exports = router;