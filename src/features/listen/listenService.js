const { BrowserWindow } = require('electron');
const SttService = require('./stt/sttService');
const SummaryService = require('./summary/summaryService');
const authService = require('../common/services/authService');
const sessionRepository = require('../common/repositories/session');
const sttRepository = require('./stt/repositories');
const internalBridge = require('../../bridge/internalBridge');

class ListenService {
    constructor() {
        this.sttService = new SttService();
        this.summaryService = new SummaryService();
        this.currentSessionId = null;
        this.isInitializingSession = false;
        
        // Speech management for preventing feedback
        this.isAISpeaking = false;
        this.speechQueue = [];
        this.lastAIResponse = null;
        this.lastSpeechTime = null;

        this.setupServiceCallbacks();
        console.log('[ListenService] Service instance created.');
    }

    setupServiceCallbacks() {
        // STT service callbacks
        this.sttService.setCallbacks({
            onTranscriptionComplete: (speaker, text) => {
                this.handleTranscriptionComplete(speaker, text);
            },
            onStatusUpdate: (status) => {
                this.sendToRenderer('update-status', status);
            }
        });

        // Summary service callbacks
        this.summaryService.setCallbacks({
            onAnalysisComplete: (data) => {
                console.log('📊 Analysis completed:', data);
            },
            onStatusUpdate: (status) => {
                this.sendToRenderer('update-status', status);
            }
        });
    }

    sendToRenderer(channel, data) {
        const { windowPool } = require('../../window/windowManager');
        const listenWindow = windowPool?.get('listen');
        
        if (listenWindow && !listenWindow.isDestroyed()) {
            listenWindow.webContents.send(channel, data);
        }
    }

    initialize() {
        this.setupIpcHandlers();
        console.log('[ListenService] Initialized and ready.');
    }

    async handleListenRequest(listenButtonText) {
        const { windowPool } = require('../../window/windowManager');
        const listenWindow = windowPool.get('listen');
        const header = windowPool.get('header');

        try {
            switch (listenButtonText) {
                case 'Listen':
                    console.log('[ListenService] changeSession to "Listen"');
                    internalBridge.emit('window:requestVisibility', { name: 'listen', visible: true });
                    await this.initializeSession();
                    if (listenWindow && !listenWindow.isDestroyed()) {
                        listenWindow.webContents.send('session-state-changed', { isActive: true });
                    }
                    break;
        
                case 'Stop':
                    console.log('[ListenService] changeSession to "Stop"');
                    await this.closeSession();
                    if (listenWindow && !listenWindow.isDestroyed()) {
                        listenWindow.webContents.send('session-state-changed', { isActive: false });
                    }
                    break;
        
                case 'Done':
                    console.log('[ListenService] changeSession to "Done"');
                    internalBridge.emit('window:requestVisibility', { name: 'listen', visible: false });
                    listenWindow.webContents.send('session-state-changed', { isActive: false });
                    break;
        
                default:
                    throw new Error(`[ListenService] unknown listenButtonText: ${listenButtonText}`);
            }
            
            header.webContents.send('listen:changeSessionResult', { success: true });

        } catch (error) {
            console.error('[ListenService] error in handleListenRequest:', error);
            header.webContents.send('listen:changeSessionResult', { success: false });
            throw error; 
        }
    }

    async handleTranscriptionComplete(speaker, text) {
        console.log(`[ListenService] Transcription complete: ${speaker} - ${text}`);
        
        // Filter out AI speech to prevent feedback loop
        if (this.isAISpeaking) {
            console.log(`[ListenService] Ignoring transcription while AI is speaking (feedback prevention): "${text}"`);
            return;
        }
        
        // Additional filtering: Ignore very short or repetitive texts that might be AI echo
        if (this.isLikelyAIEcho(text)) {
            console.log(`[ListenService] Filtering out likely AI echo: "${text}"`);
            return;
        }
        
        // Only process "Me" transcriptions for voice conversations
        if (speaker !== 'Me') {
            console.log(`[ListenService] Ignoring "${speaker}" transcription in voice mode: "${text}"`);
            return;
        }
        
        // Additional safety: Check if we recently spoke (within last 2 seconds)
        if (this.lastSpeechTime && (Date.now() - this.lastSpeechTime) < 2000) {
            console.log(`[ListenService] Ignoring transcription too soon after AI speech: "${text}"`);
            return;
        }
        
        // Save to database
        await this.saveConversationTurn(speaker, text);
        
        // Add to summary service for analysis
        this.summaryService.addConversationTurn(speaker, text);
        
        // If the user ("Me") spoke, send to AI for interaction and respond verbally
        if (text.trim().length > 0) {
            await this.handleUserQuestion(text);
        }
    }
    
    /**
     * Check if transcribed text is likely to be AI echo/feedback
     */
    isLikelyAIEcho(text) {
        const cleanText = text.toLowerCase().trim();
        
        // Filter very short utterances that are likely artifacts
        if (cleanText.length < 8) return true;
        
        // Store the last AI response for comparison
        if (this.lastAIResponse) {
            const lastResponseWords = this.lastAIResponse.toLowerCase().split(' ');
            const textWords = cleanText.split(' ');
            
            // Check if current text contains consecutive words from AI response
            for (let i = 0; i < textWords.length - 2; i++) {
                const threeWords = textWords.slice(i, i + 3).join(' ');
                if (this.lastAIResponse.toLowerCase().includes(threeWords) && threeWords.length > 10) {
                    console.log(`[ListenService] Detected AI echo: "${threeWords}" matches previous response`);
                    return true;
                }
            }
        }
        
        // No additional pattern filtering - rely on timing and response comparison
        return false;
    }
    
    async handleUserQuestion(userText) {
        try {
            console.log(`[ListenService] Processing user question: "${userText}"`);
            
            const ttsService = require('../common/services/ttsService');
            
            // Get AI response directly (not using streaming Ask service)
            const aiResponse = await this.getAIResponse(userText);
            
            if (aiResponse) {
                console.log(`[ListenService] AI response: ${aiResponse}`);
                
                // Store AI response for echo detection
                this.lastAIResponse = aiResponse;
                
                // Save AI response as a conversation turn from "Assistant"
                await this.saveConversationTurn('Assistant', aiResponse);
                this.summaryService.addConversationTurn('Assistant', aiResponse);
                
                // Update the UI to show the AI response
                this.sendToRenderer('ai-response', {
                    text: aiResponse,
                    timestamp: Date.now()
                });
                
                // Convert AI response to speech with feedback prevention
                if (ttsService.isEnabled()) {
                    // Generate a conversational summary for speech
                    const speechSummary = await this.generateSpeechSummary(aiResponse);
                    await this.speakResponse(speechSummary, ttsService);
                }
            }
            
        } catch (error) {
            console.error('[ListenService] Error processing user question:', error);
            
            // Speak an error message with feedback prevention
            const ttsService = require('../common/services/ttsService');
            if (ttsService.isEnabled()) {
                await this.speakResponse('Sorry, I encountered an error processing your request.', ttsService);
            }
        }
    }
    
    /**
     * Get AI response directly (non-streaming for voice conversations)
     */
    async getAIResponse(userText) {
        try {
            // Import AI services
            const modelStateService = require('../common/services/modelStateService');
            const { createLLM } = require('../common/ai/factory');
            const { getSystemPrompt } = require('../common/prompts/promptBuilder');
            
            // Get current LLM model info
            const modelInfo = await modelStateService.getCurrentModelInfo('llm');
            if (!modelInfo || !modelInfo.apiKey) {
                throw new Error('AI model or API key is not configured.');
            }
            
            console.log(`[ListenService] Sending AI request to ${modelInfo.provider} using model ${modelInfo.model}`);
            
            // Build messages with system prompt
            const systemPrompt = getSystemPrompt('pickle_glass_analysis', [], false);
            const messages = [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userText }
            ];
            
            // Create LLM instance
            const llm = createLLM(modelInfo.provider, {
                apiKey: modelInfo.apiKey,
                model: modelInfo.model,
                temperature: 0.7,
                maxTokens: 1024,
                usePortkey: modelInfo.provider === 'openai-glass',
                portkeyVirtualKey: modelInfo.provider === 'openai-glass' ? modelInfo.apiKey : undefined,
            });
            
            // Get AI response
            const completion = await llm.chat(messages);
            return completion.content.trim();
            
        } catch (error) {
            console.error('[ListenService] Error getting AI response:', error);
            throw error;
        }
    }
    
    /**
     * Generate a conversational summary for speech (shorter, more natural)
     */
    async generateSpeechSummary(fullResponse) {
        try {
            // If the response is already short enough, use it as-is
            if (fullResponse.length <= 200) {
                return this.makeConversational(fullResponse);
            }
            
            console.log('[ListenService] Generating speech summary for long response...');
            
            // Import AI services for summarization
            const modelStateService = require('../common/services/modelStateService');
            const { createLLM } = require('../common/ai/factory');
            
            // Get current LLM model info
            const modelInfo = await modelStateService.getCurrentModelInfo('llm');
            if (!modelInfo || !modelInfo.apiKey) {
                console.warn('[ListenService] No LLM available for summarization, using fallback');
                return this.extractKeySentences(fullResponse);
            }
            
            // Create LLM instance for summarization
            const llm = createLLM(modelInfo.provider, {
                apiKey: modelInfo.apiKey,
                model: modelInfo.model,
                temperature: 0.3,
                maxTokens: 100,
                usePortkey: modelInfo.provider === 'openai-glass',
                portkeyVirtualKey: modelInfo.provider === 'openai-glass' ? modelInfo.apiKey : undefined,
            });
            
            // Generate conversational summary
            const summaryPrompt = `Convert this detailed response into a brief, conversational spoken summary (1-2 sentences max):

"${fullResponse}"

Make it sound natural for speech, like you're talking to a friend. Focus on the main point only.`;
            
            const messages = [
                { role: 'system', content: 'You are a conversational AI assistant. Create brief, natural spoken summaries.' },
                { role: 'user', content: summaryPrompt }
            ];
            
            const completion = await llm.chat(messages);
            const summary = completion.content.trim();
            
            console.log(`[ListenService] Generated speech summary: "${summary}"`);
            return summary;
            
        } catch (error) {
            console.error('[ListenService] Error generating speech summary:', error);
            // Fallback to simple extraction
            return this.extractKeySentences(fullResponse);
        }
    }
    
    /**
     * Make text more conversational for speech
     */
    makeConversational(text) {
        return text
            // Remove markdown formatting
            .replace(/\*\*(.*?)\*\*/g, '$1')
            .replace(/\*(.*?)\*/g, '$1')
            .replace(/- /g, '')
            .replace(/\n+/g, ' ')
            // Remove formal patterns
            .replace(/In summary,?/gi, '')
            .replace(/To summarize,?/gi, '')
            .replace(/In conclusion,?/gi, '')
            .trim();
    }
    
    /**
     * Fallback: Extract key sentences from response
     */
    extractKeySentences(text) {
        const sentences = text
            .replace(/\*\*(.*?)\*\*/g, '$1') // Remove markdown
            .replace(/\*(.*?)\*/g, '$1')
            .replace(/- /g, '')
            .split(/[.!?]+/)
            .map(s => s.trim())
            .filter(s => s.length > 10);
        
        // Take first 1-2 key sentences
        const keySentences = sentences.slice(0, 2).join('. ');
        return keySentences.length > 0 ? keySentences + '.' : text.substring(0, 200) + '...';
    }

    /**
     * Speak AI response with feedback loop prevention
     */
    async speakResponse(text, ttsService) {
        try {
            // Set AI speaking flag to prevent feedback
            this.isAISpeaking = true;
            console.log('[ListenService] AI started speaking - transcription paused');
            
            // Add delay before speaking to let any ongoing transcription finish
            await new Promise(resolve => setTimeout(resolve, 500));
            
            // Speak the response
            console.log(`[ListenService] Speaking: "${text}"`);
            await ttsService.speak(text);
            
            // Longer delay to ensure all audio processing is complete
            await new Promise(resolve => setTimeout(resolve, 1500));
            
        } catch (error) {
            console.error('[ListenService] Error during TTS:', error);
        } finally {
            // Clear AI speaking flag to resume transcription
            this.isAISpeaking = false;
            this.lastSpeechTime = Date.now(); // Track when we finished speaking
            console.log('[ListenService] AI finished speaking - transcription ready for follow-up');
        }
    }

    async saveConversationTurn(speaker, transcription) {
        if (!this.currentSessionId) {
            console.error('[DB] Cannot save turn, no active session ID.');
            return;
        }
        if (transcription.trim() === '') return;

        try {
            await sessionRepository.touch(this.currentSessionId);
            await sttRepository.addTranscript({
                sessionId: this.currentSessionId,
                speaker: speaker,
                text: transcription.trim(),
            });
            console.log(`[DB] Saved transcript for session ${this.currentSessionId}: (${speaker})`);
        } catch (error) {
            console.error('Failed to save transcript to DB:', error);
        }
    }

    async initializeNewSession() {
        try {
            // The UID is no longer passed to the repository method directly.
            // The adapter layer handles UID injection. We just ensure a user is available.
            const user = authService.getCurrentUser();
            if (!user) {
                // This case should ideally not happen as authService initializes a default user.
                throw new Error("Cannot initialize session: auth service not ready.");
            }
            
            this.currentSessionId = await sessionRepository.getOrCreateActive('listen');
            console.log(`[DB] New listen session ensured: ${this.currentSessionId}`);

            // Set session ID for summary service
            this.summaryService.setSessionId(this.currentSessionId);
            
            // Reset conversation history
            this.summaryService.resetConversationHistory();

            console.log('New conversation session started:', this.currentSessionId);
            return true;
        } catch (error) {
            console.error('Failed to initialize new session in DB:', error);
            this.currentSessionId = null;
            return false;
        }
    }

    async initializeSession(language = 'en') {
        if (this.isInitializingSession) {
            console.log('Session initialization already in progress.');
            return false;
        }

        this.isInitializingSession = true;
        this.sendToRenderer('session-initializing', true);
        this.sendToRenderer('update-status', 'Initializing sessions...');

        try {
            // Initialize database session
            const sessionInitialized = await this.initializeNewSession();
            if (!sessionInitialized) {
                throw new Error('Failed to initialize database session');
            }

            /* ---------- STT Initialization Retry Logic ---------- */
            const MAX_RETRY = 10;
            const RETRY_DELAY_MS = 300;   // 0.3 seconds

            let sttReady = false;
            for (let attempt = 1; attempt <= MAX_RETRY; attempt++) {
                try {
                    await this.sttService.initializeSttSessions(language);
                    sttReady = true;
                    break;                         // Exit on success
                } catch (err) {
                    console.warn(
                        `[ListenService] STT init attempt ${attempt} failed: ${err.message}`
                    );
                    if (attempt < MAX_RETRY) {
                        await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
                    }
                }
            }
            if (!sttReady) throw new Error('STT init failed after retries');
            /* ------------------------------------------- */

            console.log('✅ Listen service initialized successfully.');
            
            this.sendToRenderer('update-status', 'Connected. Ready to listen.');
            
            return true;
        } catch (error) {
            console.error('❌ Failed to initialize listen service:', error);
            this.sendToRenderer('update-status', 'Initialization failed.');
            return false;
        } finally {
            this.isInitializingSession = false;
            this.sendToRenderer('session-initializing', false);
            this.sendToRenderer('change-listen-capture-state', { status: "start" });
        }
    }

    async sendMicAudioContent(data, mimeType) {
        return await this.sttService.sendMicAudioContent(data, mimeType);
    }

    async startMacOSAudioCapture() {
        if (process.platform !== 'darwin') {
            throw new Error('macOS audio capture only available on macOS');
        }
        return await this.sttService.startMacOSAudioCapture();
    }

    async stopMacOSAudioCapture() {
        this.sttService.stopMacOSAudioCapture();
    }

    isSessionActive() {
        return this.sttService.isSessionActive();
    }

    async closeSession() {
        try {
            this.sendToRenderer('change-listen-capture-state', { status: "stop" });
            // Close STT sessions
            await this.sttService.closeSessions();

            await this.stopMacOSAudioCapture();

            // End database session
            if (this.currentSessionId) {
                await sessionRepository.end(this.currentSessionId);
                console.log(`[DB] Session ${this.currentSessionId} ended.`);
            }

            // Reset state
            this.currentSessionId = null;
            this.summaryService.resetConversationHistory();

            console.log('Listen service session closed.');
            return { success: true };
        } catch (error) {
            console.error('Error closing listen service session:', error);
            return { success: false, error: error.message };
        }
    }

    getCurrentSessionData() {
        return {
            sessionId: this.currentSessionId,
            conversationHistory: this.summaryService.getConversationHistory(),
            totalTexts: this.summaryService.getConversationHistory().length,
            analysisData: this.summaryService.getCurrentAnalysisData(),
        };
    }

    getConversationHistory() {
        return this.summaryService.getConversationHistory();
    }

    _createHandler(asyncFn, successMessage, errorMessage) {
        return async (...args) => {
            try {
                const result = await asyncFn.apply(this, args);
                if (successMessage) console.log(successMessage);
                // `startMacOSAudioCapture`는 성공 시 { success, error } 객체를 반환하지 않으므로,
                // 핸들러가 일관된 응답을 보내도록 여기서 success 객체를 반환합니다.
                // 다른 함수들은 이미 success 객체를 반환합니다.
                return result && typeof result.success !== 'undefined' ? result : { success: true };
            } catch (e) {
                console.error(errorMessage, e);
                return { success: false, error: e.message };
            }
        };
    }

    // `_createHandler`를 사용하여 핸들러들을 동적으로 생성합니다.
    handleSendMicAudioContent = this._createHandler(
        this.sendMicAudioContent,
        null,
        'Error sending user audio:'
    );

    handleStartMacosAudio = this._createHandler(
        async () => {
            if (process.platform !== 'darwin') {
                return { success: false, error: 'macOS audio capture only available on macOS' };
            }
            if (this.sttService.isMacOSAudioRunning?.()) {
                return { success: false, error: 'already_running' };
            }
            await this.startMacOSAudioCapture();
            return { success: true, error: null };
        },
        'macOS audio capture started.',
        'Error starting macOS audio capture:'
    );
    
    handleStopMacosAudio = this._createHandler(
        this.stopMacOSAudioCapture,
        'macOS audio capture stopped.',
        'Error stopping macOS audio capture:'
    );

    handleUpdateGoogleSearchSetting = this._createHandler(
        async (enabled) => {
            console.log('Google Search setting updated to:', enabled);
        },
        null,
        'Error updating Google Search setting:'
    );
}

const listenService = new ListenService();
module.exports = listenService;