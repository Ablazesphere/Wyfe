// src/server.js

const app = require('./app');

// Get port from environment variables or default to 3000
const PORT = process.env.PORT || 3000;

// Start the server
app.listen(PORT, () => {
    console.log(`Reminder system server running on port ${PORT}`);
});