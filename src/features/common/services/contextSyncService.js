const sessionRepository = require('../repositories/session');
const sttRepository = require('../../listen/stt/repositories');
const askRepository = require('../../ask/repositories');
const fetch = require('node-fetch');

// TODO: Move this to a config file
const VIBE_AI_BACKEND_URL = 'http://localhost:3003';

async function syncSessionOnQuit() {
    console.log('[ContextSync] Starting sync-back process on quit...');
    try {
        // Only get the most recently active session, not all historical sessions
        const activeSessions = await sessionRepository.getAllByUserId();
        
        // Find the most recent session with an external_incident_id
        const sessionsWithIncidentId = activeSessions.filter(s => s.external_incident_id);
        
        if (sessionsWithIncidentId.length === 0) {
            console.log('[ContextSync] No active session with external incident ID to sync. Exiting.');
            return;
        }

        // Sort by updated_at or created_at to get the most recent session
        const mostRecentSession = sessionsWithIncidentId.sort((a, b) => 
            (b.updated_at || b.created_at) - (a.updated_at || a.created_at)
        )[0];

        console.log(`[ContextSync] Found most recent session ${mostRecentSession.id} for incident ${mostRecentSession.external_incident_id}`);
        
        await processSingleSession(mostRecentSession);

    } catch (error) {
        console.error('[ContextSync] Error during sync-back on quit:', error);
    }
}

async function processSingleSession(session) {
    try {
        console.log(`[ContextSync] Processing session ${session.id} for incident ${session.external_incident_id}`);

        const [transcripts, ai_messages] = await Promise.all([
            sttRepository.getAllTranscriptsBySessionId(session.id),
            askRepository.getAllAiMessagesBySessionId(session.id)
        ]);

        const payload = {
            source: 'vibranium-copilot',
            sessionId: session.id,
            timestamp: new Date().toISOString(),
            data: {
                transcripts: transcripts,
                messages: ai_messages
            }
        };

        const targetUrl = `${VIBE_AI_BACKEND_URL}/api/v1/incidents/${session.external_incident_id}/context`;

        console.log(`[ContextSync] POSTing data for incident ${session.external_incident_id} to ${targetUrl}`);
        console.log(`[ContextSync] Payload:`, JSON.stringify(payload, null, 2));

        const response = await fetch(targetUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            throw new Error(`Failed to sync to Vibe AI backend. Status: ${response.status} ${response.statusText}`);
        }

        console.log(`[ContextSync] Successfully synced session ${session.id} for incident ${session.external_incident_id}`);

    } catch (error) {
        console.error(`[ContextSync] Failed to process and sync session ${session.id}:`, error);
    }
}

module.exports = {
    syncSessionOnQuit
}; 