const express = require('express');
const router = express.Router();
const { ipcRequest } = require('../ipcBridge');

router.post('/', async (req, res) => {
    try {
        const incidentContext = req.body;
        if (!incidentContext || Object.keys(incidentContext).length === 0) {
            return res.status(400).json({ error: 'Incident context cannot be empty' });
        }
        
        // Forward the context to the main Electron process
        await ipcRequest(req, 'seed-incident-context', incidentContext);
        
        res.status(200).json({ message: 'Incident context received and seeded successfully' });
    } catch (error) {
        console.error('Failed to seed incident context via IPC:', error);
        res.status(500).json({ error: 'Failed to seed incident context' });
    }
});

module.exports = router; 