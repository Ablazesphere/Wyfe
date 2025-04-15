// Update src/models/user.js to include preferences

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
    preferences: {
        timeReferences: {
            type: Map,
            of: {
                hour: Number,
                minute: Number
            }
        },
        notifications: {
            preferredMethod: {
                type: String,
                enum: ['whatsapp', 'voice', 'both'],
                default: 'whatsapp'
            },
            advanceNotice: {
                type: Number,
                default: 15  // minutes
            },
            quietHoursStart: {
                type: String,
                default: '22:00'
            },
            quietHoursEnd: {
                type: String,
                default: '07:00'
            }
        }
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

const User = mongoose.model('User', UserSchema);

module.exports = User;