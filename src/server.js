// src/server.js

const app = require('./app');
const mongoose = require('mongoose');
const notificationService = require('./services/notificationService');

// Get port from environment variables or default to 3000
const PORT = process.env.PORT || 3000;

// Variable to track if MongoDB is connected
let isMongoConnected = false;

// Listen for MongoDB connection events
mongoose.connection.on('connected', () => {
    console.log('Connected to MongoDB Atlas');
    isMongoConnected = true;

    // Initialize notification service after MongoDB is connected
    if (process.env.NODE_ENV !== 'test') {
        // Set up notification cron job to run every minute
        notificationService.setupNotificationCron(1);
        console.log('Notification service initialized');

        // Run an initial check for any reminders that might have been missed during server downtime
        notificationService.processNotifications().catch(err => {
            console.error('Error in initial notification check:', err);
        });
    }
});

mongoose.connection.on('error', (err) => {
    console.error('MongoDB connection error:', err);
});

// Start the server
app.listen(PORT, () => {
    console.log(`Reminder system server running on port ${PORT}`);
});