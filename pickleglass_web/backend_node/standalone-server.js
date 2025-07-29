const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

// Simple in-memory storage for sessions and messages
// In production, you'd want to use a proper database
const sessions = new Map();
const messages = new Map();

function createStandaloneApp() {
    const app = express();

    // CORS policy for development
    app.use(cors({
        origin: '*',
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization', 'baggage', 'x-vercel-id', 'x-vercel-trace', 'sentry-trace', 'x-sentry-trace']
    }));

    app.use(express.json());

    app.get('/', (req, res) => {
        res.json({ message: "pickleglass Standalone API is running" });
    });

    // Get all sessions
    app.get('/api/conversations', (req, res) => {
        try {
            const sessionList = Array.from(sessions.values()).map(session => ({
                id: session.id,
                type: session.type,
                name: session.name,
                created_at: session.created_at,
                updated_at: session.updated_at
            }));
            res.json(sessionList);
        } catch (error) {
            console.error('Failed to get sessions:', error);
            res.status(500).json({ error: 'Failed to retrieve sessions' });
        }
    });

    // Create a new session
    app.post('/api/conversations', (req, res) => {
        try {
            const { type = 'widget', name = 'Widget Session' } = req.body;
            const sessionId = Date.now().toString();
            
            const session = {
                id: sessionId,
                type,
                name,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            };
            
            sessions.set(sessionId, session);
            messages.set(sessionId, []);
            
            console.log(`✅ Created session: ${sessionId}`);
            res.status(201).json({ id: sessionId, message: 'Session created successfully' });
        } catch (error) {
            console.error('Failed to create session:', error);
            res.status(500).json({ error: 'Failed to create session' });
        }
    });

    // Get session details
    app.get('/api/conversations/:session_id', (req, res) => {
        try {
            const sessionId = req.params.session_id;
            const session = sessions.get(sessionId);
            const sessionMessages = messages.get(sessionId) || [];
            
            if (!session) {
                return res.status(404).json({ error: 'Session not found' });
            }
            
            res.json({
                session,
                ai_messages: sessionMessages,
                transcripts: [],
                summary: null
            });
        } catch (error) {
            console.error(`Failed to get session details for ${req.params.session_id}:`, error);
            res.status(500).json({ error: 'Failed to retrieve session details' });
        }
    });

    // Add message to a session
    app.post('/api/conversations/:session_id/messages', (req, res) => {
        try {
            const { role, content, type = 'text' } = req.body;
            const sessionId = req.params.session_id;
            
            if (!role || !content) {
                return res.status(400).json({ error: 'Role and content are required' });
            }
            
            const session = sessions.get(sessionId);
            if (!session) {
                return res.status(404).json({ error: 'Session not found' });
            }
            
            const messageId = Date.now().toString();
            const message = {
                id: messageId,
                session_id: sessionId,
                role,
                content,
                type,
                sent_at: new Date().toISOString(),
                created_at: new Date().toISOString(),
                model: 'widget'
            };
            
            const sessionMessages = messages.get(sessionId) || [];
            sessionMessages.push(message);
            messages.set(sessionId, sessionMessages);
            
            // Update session timestamp
            session.updated_at = new Date().toISOString();
            sessions.set(sessionId, session);
            
            console.log(`✅ Added ${role} message to session ${sessionId}`);
            res.status(201).json({ 
                success: true, 
                messageId,
                message: 'Message added successfully' 
            });
        } catch (error) {
            console.error(`Failed to add message to session ${req.params.session_id}:`, error);
            res.status(500).json({ error: 'Failed to add message to session' });
        }
    });

    // Delete a session
    app.delete('/api/conversations/:session_id', (req, res) => {
        try {
            const sessionId = req.params.session_id;
            
            if (!sessions.has(sessionId)) {
                return res.status(404).json({ error: 'Session not found' });
            }
            
            sessions.delete(sessionId);
            messages.delete(sessionId);
            
            console.log(`✅ Deleted session: ${sessionId}`);
            res.status(200).json({ message: 'Session deleted successfully' });
        } catch (error) {
            console.error(`Failed to delete session ${req.params.session_id}:`, error);
            res.status(500).json({ error: 'Failed to delete session' });
        }
    });

    // Health check
    app.get('/api/health', (req, res) => {
        res.json({
            status: 'healthy',
            timestamp: new Date().toISOString(),
            sessions: sessions.size,
            messages: Array.from(messages.values()).reduce((total, msgs) => total + msgs.length, 0)
        });
    });

    // Glass sessions endpoint (for Vibe frontend)
    app.get('/api/glass-sessions/:incidentId', (req, res) => {
        try {
            const incidentId = req.params.incidentId;
            console.log(`🔍 Glass sessions request received for incident ${incidentId}`);
            console.log(`🔍 Request headers:`, req.headers);
            
            // Get all widget sessions and flatten messages
            const allInteractions = [];
            
            Array.from(sessions.values())
                .filter(session => session.type === 'widget')
                .forEach(session => {
                    const sessionMessages = messages.get(session.id) || [];
                    sessionMessages.forEach(message => {
                        allInteractions.push({
                            id: message.id,
                            speaker: message.role === 'user' ? 'User' : 'AI Assistant',
                            timestamp: message.sent_at,
                            content: message.content,
                            type: message.type || 'text'
                        });
                    });
                });
            
            console.log(`📖 Glass interactions requested for incident ${incidentId}: ${allInteractions.length} interactions`);
            console.log(`📄 Sample interaction:`, JSON.stringify(allInteractions[0], null, 2));
            console.log(`✅ Sending response with ${allInteractions.length} interactions`);
            
            // Prevent caching
            res.set({
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                'Pragma': 'no-cache',
                'Expires': '0'
            });
            
            // Return in the format the frontend expects
            res.json({
                interactions: allInteractions,
                count: allInteractions.length
            });
        } catch (error) {
            console.error('Error getting glass sessions:', error);
            res.status(500).json({ error: 'Failed to retrieve glass sessions' });
        }
    });

    return app;
}

// Start the server if this file is run directly
if (require.main === module) {
    const app = createStandaloneApp();
    const port = process.env.PORT || 3002;
    
    app.listen(port, () => {
        console.log(`🚀 pickleglass Standalone API running on port ${port}`);
        console.log(`📊 Health check: http://localhost:${port}/api/health`);
        console.log(`📝 Sessions: http://localhost:${port}/api/conversations`);
    });
}

module.exports = { createStandaloneApp }; 