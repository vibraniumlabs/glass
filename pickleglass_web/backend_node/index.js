const express = require('express');
const cors = require('cors');
// const db = require('./db'); // No longer needed
const { identifyUser } = require('./middleware/auth');

function createApp(eventBridge) {
    const app = express();

    // WARNING: This is a permissive CORS policy for development.
    // In production, you should restrict this to your app's domain.
    app.use(cors({
        origin: '*', // Allows all origins
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization']
    }));

    app.use(express.json());

    app.get('/', (req, res) => {
        res.json({ message: "pickleglass API is running" });
    });

    app.use((req, res, next) => {
        req.bridge = eventBridge;
        next();
    });

    app.use('/api', identifyUser);

    app.use('/api/auth', require('./routes/auth'));
    app.use('/api/user', require('./routes/user'));
    app.use('/api/conversations', require('./routes/conversations'));
    app.use('/api/presets', require('./routes/presets'));
    app.use('/api/context', require('./routes/context'));

    app.get('/api/sync/status', (req, res) => {
        res.json({
            status: 'online',
            timestamp: new Date().toISOString(),
            version: '1.0.0'
        });
    });

    app.post('/api/desktop/set-user', (req, res) => {
        res.json({
            success: true,
            message: "Direct IPC communication is now used. This endpoint is deprecated.",
            user: req.body,
            deprecated: true
        });
    });

    app.get('/api/desktop/status', (req, res) => {
        res.json({
            connected: true,
            current_user: null,
            communication_method: "IPC",
            file_based_deprecated: true
        });
    });

    return app;
}

module.exports = createApp;
