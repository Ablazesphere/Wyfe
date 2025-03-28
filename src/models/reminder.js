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
        enum: ['none', 'daily', 'weekly', 'monthly'],
        default: 'none'
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