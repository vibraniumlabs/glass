const { createTTS } = require('../ai/factory');
const modelStateService = require('./modelStateService');
const path = require('path');
const fs = require('fs');
const os = require('os');

class TtsService {
    constructor() {
        this.currentAudio = null;
        this.isPlaying = false;
        this.enabled = true; // Default to enabled
        this.defaultVoice = 'alloy';
        this.defaultSpeed = 1.0;
    }

    /**
     * Initialize the TTS service
     */
    async initialize() {
        console.log('[TtsService] Initializing TTS service...');
        // TTS service is ready - no additional setup needed
    }

    /**
     * Enable or disable TTS
     * @param {boolean} enabled - Whether TTS is enabled
     */
    setEnabled(enabled) {
        this.enabled = enabled;
        console.log(`[TtsService] TTS ${enabled ? 'enabled' : 'disabled'}`);
    }

    /**
     * Check if TTS is enabled
     * @returns {boolean} Whether TTS is enabled
     */
    isEnabled() {
        return this.enabled;
    }

    /**
     * Set the default voice for TTS
     * @param {string} voice - Voice ID (alloy, echo, fable, onyx, nova, shimmer)
     */
    setDefaultVoice(voice) {
        this.defaultVoice = voice;
        console.log(`[TtsService] Default voice set to: ${voice}`);
    }

    /**
     * Set the default speed for TTS
     * @param {number} speed - Speech speed (0.25 to 4.0)
     */
    setDefaultSpeed(speed) {
        this.defaultSpeed = Math.max(0.25, Math.min(4.0, speed));
        console.log(`[TtsService] Default speed set to: ${this.defaultSpeed}`);
    }

    /**
     * Stop any currently playing audio
     */
    stop() {
        try {
            if (this.currentAudio) {
                // Check if it's a subprocess (has kill method)
                if (typeof this.currentAudio.kill === 'function') {
                    this.currentAudio.kill();
                    console.log('[TtsService] Stopped current audio process');
                }
                // Check if it's an Audio element (has pause method)
                else if (typeof this.currentAudio.pause === 'function') {
                    this.currentAudio.pause();
                    console.log('[TtsService] Paused current audio playback');
                }
            }
        } catch (error) {
            console.warn('[TtsService] Error stopping audio:', error.message);
        } finally {
            // Always reset state regardless of stop success
            this.currentAudio = null;
            this.isPlaying = false;
        }
    }

    /**
     * Check if TTS is currently playing
     * @returns {boolean} Whether audio is currently playing
     */
    isCurrentlyPlaying() {
        return this.isPlaying;
    }

    /**
     * Convert text to speech and play it
     * @param {string} text - Text to convert to speech
     * @param {object} options - TTS options
     * @param {string} [options.voice] - Voice to use (overrides default)
     * @param {number} [options.speed] - Speed to use (overrides default)
     * @param {boolean} [options.stopCurrent=true] - Whether to stop current audio
     * @returns {Promise<boolean>} Whether the speech was successfully played
     */
    async speak(text, options = {}) {
        if (!this.enabled) {
            console.log('[TtsService] TTS is disabled, skipping speech');
            return false;
        }

        if (!text || typeof text !== 'string' || text.trim().length === 0) {
            console.warn('[TtsService] No valid text provided for TTS');
            return false;
        }

        // Stop current audio if requested
        if (options.stopCurrent !== false) {
            this.stop();
        }

        try {
            console.log(`[TtsService] Converting text to speech: "${text.substring(0, 100)}${text.length > 100 ? '...' : ''}"`);

            // Get current model configuration
            const modelInfo = await this._getCurrentTtsModelInfo();
            if (!modelInfo) {
                console.error('[TtsService] No TTS model configured');
                return false;
            }

            // Create TTS instance
            const tts = createTTS(modelInfo.provider, {
                apiKey: modelInfo.apiKey,
                model: modelInfo.model,
                voice: options.voice || this.defaultVoice,
                speed: options.speed || this.defaultSpeed,
                usePortkey: modelInfo.usePortkey,
                portkeyVirtualKey: modelInfo.portkeyVirtualKey
            });

            // Synthesize speech
            const audioBuffer = await tts.synthesize(text);
            
            // Play the audio
            await this._playAudioBuffer(audioBuffer);
            
            console.log('[TtsService] Speech synthesis and playback completed successfully');
            return true;

        } catch (error) {
            console.error('[TtsService] Error during speech synthesis:', error);
            return false;
        }
    }

    /**
     * Get current TTS model information
     * @returns {Promise<object|null>} Model info or null if not configured
     * @private
     */
    async _getCurrentTtsModelInfo() {
        try {
            const modelInfo = await modelStateService.getCurrentModelInfo('tts');
            return modelInfo;
        } catch (error) {
            // Fallback to LLM model info if TTS not configured
            try {
                const llmModelInfo = await modelStateService.getCurrentModelInfo('llm');
                if (llmModelInfo && llmModelInfo.provider === 'openai') {
                    return {
                        ...llmModelInfo,
                        model: 'tts-1' // Default TTS model
                    };
                }
            } catch (fallbackError) {
                console.error('[TtsService] Could not get fallback model info:', fallbackError);
            }
            console.error('[TtsService] Could not get TTS model info:', error);
            return null;
        }
    }

    /**
     * Play audio buffer using Node.js audio capabilities
     * @param {Uint8Array} audioBuffer - Audio data to play
     * @returns {Promise<void>}
     * @private
     */
    async _playAudioBuffer(audioBuffer) {
        return new Promise((resolve, reject) => {
            try {
                // Create temporary file for audio
                const tempAudioPath = path.join(os.tmpdir(), `tts-${Date.now()}.mp3`);
                
                // Write audio buffer to temporary file
                fs.writeFileSync(tempAudioPath, audioBuffer);
                
                // Determine the correct audio player for the platform
                let audioPlayer;
                let args;
                
                if (process.platform === 'darwin') {
                    // macOS - use afplay
                    audioPlayer = 'afplay';
                    args = [tempAudioPath];
                } else if (process.platform === 'win32') {
                    // Windows - use powershell
                    audioPlayer = 'powershell';
                    args = ['-c', `(New-Object Media.SoundPlayer "${tempAudioPath}").PlaySync()`];
                } else {
                    // Linux - try common audio players
                    audioPlayer = 'aplay';
                    args = [tempAudioPath];
                }

                // Spawn audio player process
                const { spawn } = require('child_process');
                const player = spawn(audioPlayer, args);

                this.isPlaying = true;

                player.on('close', (code) => {
                    this.isPlaying = false;
                    // Clean up temporary file
                    try {
                        fs.unlinkSync(tempAudioPath);
                    } catch (cleanupError) {
                        console.warn('[TtsService] Could not clean up temp audio file:', cleanupError.message);
                    }
                    
                    if (code === 0) {
                        resolve();
                    } else {
                        reject(new Error(`Audio player exited with code ${code}`));
                    }
                });

                player.on('error', (error) => {
                    this.isPlaying = false;
                    // Clean up temporary file
                    try {
                        fs.unlinkSync(tempAudioPath);
                    } catch (cleanupError) {
                        console.warn('[TtsService] Could not clean up temp audio file:', cleanupError.message);
                    }
                    reject(error);
                });

                // Store reference to current audio process
                this.currentAudio = player;

            } catch (error) {
                reject(error);
            }
        });
    }

    /**
     * Get available voices for the current TTS provider
     * @returns {Promise<Array>} Array of available voices
     */
    async getAvailableVoices() {
        try {
            const modelInfo = await this._getCurrentTtsModelInfo();
            if (!modelInfo) {
                return [];
            }

            const tts = createTTS(modelInfo.provider, {
                apiKey: modelInfo.apiKey,
                model: modelInfo.model
            });

            if (tts.getAvailableVoices) {
                return tts.getAvailableVoices();
            }

            return [];
        } catch (error) {
            console.error('[TtsService] Error getting available voices:', error);
            return [];
        }
    }

    /**
     * Clean up resources
     */
    cleanup() {
        this.stop();
        console.log('[TtsService] Cleaned up TTS service');
    }
}

// Export singleton instance
const ttsService = new TtsService();
module.exports = ttsService; 