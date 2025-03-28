// src/models/user.js

const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
    phoneNumber: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    name: String,
    timeZone: {
        type: String,
        default: 'Asia/Kolkata' // Default to India timezone
    },
    preferredNotificationMethod: {
        type: String,
        enum: ['whatsapp', 'voice', 'both'],
        default: 'whatsapp'
    },
    active: {
        type: Boolean,
        default: true
    },
    lastInteraction: Date,
    conversationState: {
        type: Object,
        default: { stage: 'initial' }
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

const User = mongoose.model('User', UserSchema);

module.exports = User;