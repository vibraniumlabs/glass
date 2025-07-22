const express = require('express');
const cors = require('cors');

const app = express();
const PORT = 9000;

app.use(cors());
app.use(express.json({ limit: '50mb' })); // Use express.json() to parse JSON bodies

app.post('/v1/incidents/:incidentId/context', (req, res) => {
    const { incidentId } = req.params;
    const payload = req.body;

    console.log(`✅ [Mock Backend] Received data for Incident ID: ${incidentId}`);
    console.log('====================== PAYLOAD START ======================');
    console.log(JSON.stringify(payload, null, 2));
    console.log('======================= PAYLOAD END =======================');

    res.status(200).json({
        status: 'success',
        message: `Data received for incident ${incidentId}`,
    });
});

app.listen(PORT, () => {
    console.log(`🚀 [Mock Backend] Server listening on http://localhost:${PORT}`);
    console.log('Waiting to receive data from the Vibranium Copilot...');
}); 