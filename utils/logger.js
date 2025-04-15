// utils/logger.js - Logging utilities
export const logger = {
    info: (message, ...args) => {
        console.log(`[INFO] ${new Date().toISOString()} - ${message}`, ...args);
    },

    warn: (message, ...args) => {
        console.warn(`[WARN] ${new Date().toISOString()} - ${message}`, ...args);
    },

    error: (message, ...args) => {
        console.error(`[ERROR] ${new Date().toISOString()} - ${message}`, ...args);
    },

    debug: (message, ...args) => {
        console.log(`[DEBUG] ${new Date().toISOString()} - ${message}`, ...args);
    },

    // Special logging for user and assistant transcripts
    userMessage: (message) => {
        console.log(`\n[USER] ${new Date().toISOString()} - "${message}"`);
    },

    assistantMessage: (message) => {
        console.log(`\n[ASSISTANT] ${new Date().toISOString()} - "${message}"`);
    }
};