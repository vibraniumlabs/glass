const sessionRepository = require('../repositories/session');
const sttRepository = require('../../listen/stt/repositories');
const askRepository = require('../../ask/repositories');
const fetch = require('node-fetch');

// TODO: Move this to a config file
const VIBE_AI_BACKEND_URL = 'http://localhost:9000';

async function syncSessionOnQuit() {
    console.log('[ContextSync] Starting sync-back process on quit...');
    try {
        const allSessions = await sessionRepository.getAllByUserId();
        console.log(`[ContextSync] Found ${allSessions.length} total sessions.`);

        const sessionsToSync = allSessions.filter(s => s.external_incident_id);

        if (sessionsToSync.length === 0) {
            console.log('[ContextSync] No sessions with external incident IDs to sync. Exiting.');
            return;
        }

        console.log(`[ContextSync] Found ${sessionsToSync.length} sessions to sync.`);
        for (const session of sessionsToSync) {
            await processSingleSession(session);
        }

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
            incidentId: session.external_incident_id,
            sessionData: {
                ...session,
                transcripts,
                ai_messages
            }
        };

        const targetUrl = `${VIBE_AI_BACKEND_URL}/v1/incidents/${session.external_incident_id}/context`;

        console.log(`[ContextSync] POSTing data for incident ${session.external_incident_id} to ${targetUrl}`);

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