// src/routes/webhookRoutes.js

const express = require('express');
const router = express.Router();
const { verifyWebhook, handleIncomingMessage } = require('../controllers/webhookController');

// Webhook verification endpoint
router.get('/webhook', verifyWebhook);

// Webhook endpoint for receiving messages
router.post('/webhook', handleIncomingMessage);

module.exports = router;