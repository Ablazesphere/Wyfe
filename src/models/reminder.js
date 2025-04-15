// src/models/reminder.js

const mongoose = require('mongoose');

const ReminderSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    content: {
        type: String,
        required: true
    },
    scheduledFor: {
        type: Date,
        required: true,
        index: true
    },
    recurrence: {
        type: String,
        enum: ['none', 'daily', 'weekly', 'monthly', 'custom'],
        default: 'none'
    },
    // New fields for advanced recurrence patterns
    recurrencePattern: {
        frequency: {
            type: String,
            enum: ['day', 'week', 'month', 'year'],
            default: null
        },
        interval: {
            type: Number,
            default: 1 // 1 means every, 2 means every other, etc.
        },
        daysOfWeek: {
            type: [Number], // Array of days (0 = Sunday, 6 = Saturday)
            default: []
        },
        dayOfWeek: {
            type: Number, // 0 = Sunday, 6 = Saturday
            default: null
        },
        dayOfMonth: {
            type: Number,
            default: null
        },
        monthOfYear: {
            type: Number, // 0 = January, 11 = December
            default: null
        }
    },
    endDate: {
        type: Date,
        default: null // null means no end date
    },
    status: {
        type: String,
        enum: ['pending', 'sent', 'acknowledged', 'cancelled'],
        default: 'pending',
        index: true
    },
    notificationMethod: {
        type: String,
        enum: ['whatsapp', 'voice', 'both'],
        default: 'whatsapp'
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

const Reminder = mongoose.model('Reminder', ReminderSchema);

module.exports = Reminder;