const dotenv = require('dotenv');
const path = require('path');
const { Room, RoomEvent, Track, AudioStream, AudioFrame, combineAudioFrames, AudioSource, LocalAudioTrack } = require('@livekit/rtc-node');
const { AccessToken } = require('livekit-server-sdk');
const OpenAI = require('openai');
const fs = require('fs');
const wav = require('node-wav');

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '../../.env.local') });

// Initialize OpenAI
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// LiveKit configuration
const LIVEKIT_URL = process.env.LIVEKIT_URL;
const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY;
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET;
const ROOM_NAME = 'vibe-ai-copilot-room';
const AGENT_IDENTITY = 'ai-copilot-agent';

// Debug: Log the configuration (without secrets)
console.log('🔧 Configuration:');
console.log(`   URL: ${LIVEKIT_URL}`);
console.log(`   API Key: ${LIVEKIT_API_KEY ? `${LIVEKIT_API_KEY.substring(0, 10)}...` : 'NOT SET'}`);
console.log(`   API Secret: ${LIVEKIT_API_SECRET ? 'SET' : 'NOT SET'}`);
console.log(`   Room: ${ROOM_NAME}`);
console.log(`   Agent: ${AGENT_IDENTITY}`);

// Context function
function getIncidentContext() {
  return "The user is viewing an incident report for a '502 Bad Gateway' error on the checkout service. The error spike started at 14:30 UTC and is affecting 15% of users. The root cause is currently unknown.";
}

function getSystemPrompt(context) {
  return `You are a helpful AI assistant for incident response. The user is currently working on the following incident. This information is critical context for their request.
---
INCIDENT CONTEXT:
${context}
---
Your role is to assist the user by answering their questions about the incident. Be concise and accurate.`;
}

class VoiceAgent {
  constructor() {
    this.room = new Room();
    this.isConnected = false;
    this.audioBuffer = [];
  }

  async start() {
    console.log('🚀 Starting Voice AI Agent...');
    
    try {
      // Validate required environment variables
      if (!LIVEKIT_URL || !LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
        throw new Error('Missing required LiveKit environment variables');
      }

      // Test token generation first
      console.log('🔑 Testing token generation...');
      const token = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
        identity: AGENT_IDENTITY,
      });
      token.addGrant({
        room: ROOM_NAME,
        roomJoin: true,
        canPublish: true,
        canSubscribe: true,
      });
      
      const jwt = await token.toJwt();
      console.log('✅ Token generated successfully');
      console.log(`   Token length: ${jwt.length} characters`);
      
      // Test if we can reach the LiveKit endpoint
      console.log('🌐 Testing LiveKit endpoint reachability...');
      const testUrl = LIVEKIT_URL.replace('wss://', 'https://');
      try {
        const fetch = require('node-fetch');
        const response = await fetch(testUrl, { 
          method: 'GET',
          timeout: 5000,
          headers: {
            'Authorization': `Bearer ${jwt}`
          }
        });
        console.log(`   HTTP Response: ${response.status} ${response.statusText}`);
        const responseText = await response.text();
        console.log(`   Response preview: ${responseText.substring(0, 200)}...`);
      } catch (fetchError) {
        console.log(`   Fetch test failed: ${fetchError.message}`);
      }

      // Set up event listeners
      this.setupEventListeners();

      console.log('🔗 Attempting to connect to LiveKit...');
      
      // Try a simpler connection without extra options first
      await this.room.connect(LIVEKIT_URL, jwt);
      this.isConnected = true;
      
      console.log(`✅ Agent connected to room: ${ROOM_NAME}`);
      console.log('👂 Listening for participants...');

    } catch (error) {
      console.error('❌ Failed to start agent:', error.message);
      console.error('❌ Full error:', error);
      console.error('❌ Error stack:', error.stack);
      console.error('💡 Debug info:', {
        hasUrl: !!LIVEKIT_URL,
        hasApiKey: !!LIVEKIT_API_KEY,
        hasApiSecret: !!LIVEKIT_API_SECRET,
        urlFormat: LIVEKIT_URL ? LIVEKIT_URL.substring(0, 20) + '...' : 'none'
      });
      throw error;
    }
  }

  setupEventListeners() {
    // When a participant joins
    this.room.on(RoomEvent.ParticipantConnected, (participant) => {
      console.log(`👋 Participant joined: ${participant.identity}`);
      
      // Listen for their audio tracks (with null checks)
      if (participant.audioTrackPublications) {
        participant.audioTrackPublications.forEach((publication) => {
          if (publication.track) {
            this.handleAudioTrack(publication.track, participant);
          }
        });
      }
    });

    // When a track is subscribed (room-level event)
    this.room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
      console.log(`🎵 Track subscribed: ${track.kind} from ${participant.identity}`);
      if (track.kind === 1) { // 1 = audio track kind
        this.handleAudioTrack(track, participant);
      }
    });

    // When a participant leaves
    this.room.on(RoomEvent.ParticipantDisconnected, (participant) => {
      console.log(`👋 Participant left: ${participant.identity}`);
    });

    // Handle connection issues
    this.room.on(RoomEvent.Disconnected, () => {
      console.log('❌ Agent disconnected from room');
      this.isConnected = false;
    });
  }

  async handleAudioTrack(track, participant) {
    console.log(`🎤 Listening to audio from: ${participant.identity}`);
    
    try {
      console.log(`📊 Track info:`, track.info);
      
      console.log('🔄 Creating AudioStream from track...');
      const audioStream = new AudioStream(track, {
        sampleRate: 48000,
        numChannels: 1,
        frameSizeMs: 20 // 20ms frames
      });
      
      console.log('✅ AudioStream created successfully');
      
      const audioFrames = [];
      let isCollecting = true;
      let reader = null;
      let speechStartTime = null;
      let lastSpeechTime = null;
      const SPEECH_THRESHOLD = 0.01; // Minimum energy level to consider as speech
      const MIN_SPEECH_DURATION = 1000; // Minimum 1 second of speech before processing
      const SILENCE_TIMEOUT = 2000; // 2 seconds of silence before processing
      
      const collectFrames = async () => {
        try {
          reader = audioStream.getReader();
          
          while (isCollecting) {
            const { done, value: audioFrame } = await reader.read();
            
            if (done) {
              console.log('📝 Audio stream ended');
              break;
            }
            
            if (audioFrame) {
              // Calculate audio energy to detect speech
              const energy = this.calculateAudioEnergy(audioFrame);
              const now = Date.now();
              
              if (energy > SPEECH_THRESHOLD) {
                // Speech detected
                if (!speechStartTime) {
                  speechStartTime = now;
                  console.log('🎤 Speech started');
                }
                lastSpeechTime = now;
                audioFrames.push(audioFrame);
                
                console.log(`🔊 Speech frame: ${audioFrame.samplesPerChannel} samples, energy: ${energy.toFixed(4)}`);
              } else {
                // Silence detected
                if (speechStartTime && lastSpeechTime) {
                  const speechDuration = lastSpeechTime - speechStartTime;
                  const silenceDuration = now - lastSpeechTime;
                  
                  // If we have enough speech and enough silence, process it
                  if (speechDuration >= MIN_SPEECH_DURATION && silenceDuration >= SILENCE_TIMEOUT && audioFrames.length > 0) {
                    console.log(`🎯 Processing speech: ${speechDuration}ms duration, ${audioFrames.length} frames`);
                    await this.processAudioFrames(audioFrames.slice(), participant);
                    
                    // Reset for next speech
                    audioFrames.length = 0;
                    speechStartTime = null;
                    lastSpeechTime = null;
                  }
                }
                
                // Only log silence occasionally to avoid spam
                if (audioFrames.length > 0 && audioFrames.length % 50 === 0) {
                  console.log(`🔇 Silence detected, waiting for speech end...`);
                }
              }
            }
          }
        } catch (error) {
          if (error.code !== 'ERR_INVALID_STATE') {
            console.error('❌ Error reading audio stream:', error);
          }
        } finally {
          try {
            if (reader) {
              reader.releaseLock();
            }
          } catch (e) {
            // Ignore cleanup errors
          }
        }
      };
      
      collectFrames();
      
    } catch (error) {
      console.error('❌ Error setting up audio track:', error);
    }
  }

  calculateAudioEnergy(audioFrame) {
    // Calculate RMS (Root Mean Square) energy of the audio frame
    const data = audioFrame.data;
    let sum = 0;
    
    for (let i = 0; i < data.length; i++) {
      const sample = data[i] / 0x7FFF; // Normalize to -1 to 1
      sum += sample * sample;
    }
    
    return Math.sqrt(sum / data.length);
  }

  async processAudioFrames(audioFrames, participant) {
    try {
      console.log(`📝 Processing ${audioFrames.length} audio frames from ${participant.identity}...`);
      
      const combinedFrame = combineAudioFrames(audioFrames);
      console.log(`🔗 Combined into single frame: ${combinedFrame.samplesPerChannel} samples at ${combinedFrame.sampleRate}Hz`);
      
      // Convert the audio data to proper format for WAV
      const audioBuffer = new Int16Array(combinedFrame.data);
      const sampleRate = combinedFrame.sampleRate;
      const numChannels = combinedFrame.channels;
      const bytesPerSample = 2; // 16-bit
      const dataSize = audioBuffer.length * bytesPerSample;
      const fileSize = 36 + dataSize;
      
      // Create proper WAV header
      const wavHeader = Buffer.alloc(44);
      wavHeader.write('RIFF', 0, 'ascii');
      wavHeader.writeUInt32LE(fileSize, 4);
      wavHeader.write('WAVE', 8, 'ascii');
      wavHeader.write('fmt ', 12, 'ascii');
      wavHeader.writeUInt32LE(16, 16); // PCM format chunk size
      wavHeader.writeUInt16LE(1, 20);  // PCM format
      wavHeader.writeUInt16LE(numChannels, 22);
      wavHeader.writeUInt32LE(sampleRate, 24);
      wavHeader.writeUInt32LE(sampleRate * numChannels * bytesPerSample, 28); // byte rate
      wavHeader.writeUInt16LE(numChannels * bytesPerSample, 32); // block align
      wavHeader.writeUInt16LE(16, 34); // bits per sample
      wavHeader.write('data', 36, 'ascii');
      wavHeader.writeUInt32LE(dataSize, 40);
      
      // Convert Int16Array to Buffer properly
      const audioDataBuffer = Buffer.alloc(audioBuffer.length * 2);
      for (let i = 0; i < audioBuffer.length; i++) {
          audioDataBuffer.writeInt16LE(audioBuffer[i], i * 2);
      }
      
      const wavFile = Buffer.concat([wavHeader, audioDataBuffer]);
      
      console.log(`🎵 Created WAV file: ${wavFile.length} bytes (header: 44, data: ${audioDataBuffer.length})`);
      
      const tempAudioFile = path.join(__dirname, 'temp_audio.wav');
      fs.writeFileSync(tempAudioFile, wavFile);
      
      console.log('🎤 Transcribing with OpenAI Whisper...');
      const transcription = await openai.audio.transcriptions.create({
          file: fs.createReadStream(tempAudioFile),
          model: 'whisper-1',
      });

      console.log(`💬 User said: "${transcription.text}"`);
      
      fs.unlinkSync(tempAudioFile);

      const incidentContext = getIncidentContext();
      const completion = await openai.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [
              { role: 'system', content: getSystemPrompt(incidentContext) },
              { role: 'user', content: transcription.text }
          ],
      });

      const aiResponse = completion.choices[0].message.content;
      console.log(`🤖 AI Response: "${aiResponse}"`);

      const ttsResponse = await openai.audio.speech.create({
          model: 'tts-1',
          voice: 'alloy',
          input: aiResponse,
          response_format: 'wav' // Request WAV format instead of MP3
      });

      const audioResponseBuffer = Buffer.from(await ttsResponse.arrayBuffer());
      console.log(`🗣️ Generated ${audioResponseBuffer.length} bytes of speech`);

      await this.playAudioResponse(audioResponseBuffer);

    } catch (error) {
      console.error('❌ Error processing audio frames:', error);
    }
  }

  async processAudioBuffer(audioData, participant) {
    try {
      console.log(`📝 Processing audio from ${participant.identity}...`);
      
      // For testing, let's simulate a transcription instead of using real audio
      if (audioData.toString() === 'dummy audio data') {
        console.log('🧪 Using test transcription for pipeline testing...');
        
        const testTranscription = "What is the current status of this incident?";
        console.log(`💬 Simulated user said: "${testTranscription}"`);

        // Step 2: Generate AI response
        const incidentContext = getIncidentContext();
        const completion = await openai.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: getSystemPrompt(incidentContext) },
            { role: 'user', content: testTranscription }
          ],
        });

        const aiResponse = completion.choices[0].message.content;
        console.log(`🤖 AI Response: "${aiResponse}"`);

        // Step 3: Convert response to speech
        const ttsResponse = await openai.audio.speech.create({
          model: 'tts-1',
          voice: 'alloy',
          input: aiResponse,
        });

        const audioResponseBuffer = Buffer.from(await ttsResponse.arrayBuffer());
        console.log(`🗣️ Generated ${audioResponseBuffer.length} bytes of speech`);

        // Step 4: Play audio response back to the room
        await this.playAudioResponse(audioResponseBuffer);
        
        return;
      }
      
      // Original real audio processing code would go here
      // Step 1: Transcribe audio with Whisper
      const tempAudioFile = path.join(__dirname, 'temp_audio.wav');
      fs.writeFileSync(tempAudioFile, audioData);
      
      const transcription = await openai.audio.transcriptions.create({
        file: fs.createReadStream(tempAudioFile),
        model: 'whisper-1',
      });

      console.log(`💬 User said: "${transcription.text}"`);
      
      // Clean up temp file
      fs.unlinkSync(tempAudioFile);

      // Step 2: Generate AI response
      const incidentContext = getIncidentContext();
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: getSystemPrompt(incidentContext) },
          { role: 'user', content: transcription.text }
        ],
      });

      const aiResponse = completion.choices[0].message.content;
      console.log(`🤖 AI Response: "${aiResponse}"`);

      // Step 3: Convert response to speech
      const ttsResponse = await openai.audio.speech.create({
        model: 'tts-1',
        voice: 'alloy',
        input: aiResponse,
      });

      const audioResponseBuffer = Buffer.from(await ttsResponse.arrayBuffer());
      console.log(`🗣️ Generated ${audioResponseBuffer.length} bytes of speech`);

      // Step 4: Play audio response back to the room
      await this.playAudioResponse(audioResponseBuffer);

    } catch (error) {
      console.error('❌ Error processing audio:', error);
    }
  }

  async playAudioResponse(audioBuffer) {
        try {
            console.log(`🎵 Playing audio response: ${audioBuffer.length} bytes`);
            
            // Save TTS audio to a temporary file first
            const tempFile = path.join(__dirname, 'temp_response.wav'); // Changed to .wav
            fs.writeFileSync(tempFile, audioBuffer);
            console.log(`🔊 Audio saved to ${tempFile}`);
            
            // Decode the WAV file to get PCM data
            const wavData = wav.decode(fs.readFileSync(tempFile));
            console.log(`🎵 Decoded WAV: ${wavData.sampleRate}Hz, ${wavData.channelData.length} channels, ${wavData.channelData[0].length} samples`);
            
            // Validate the decoded data and fix corrupted sample count
            if (!wavData.channelData || wavData.channelData.length === 0 || wavData.channelData[0].length === 0) {
                console.error('❌ Invalid WAV data');
                return;
            }
            
            // The sample count might be corrupted (2147483647), so calculate it from actual data
            let actualSampleCount = wavData.channelData[0].length;
            if (actualSampleCount === 2147483647 || actualSampleCount > 1000000) {
                // Calculate from the audio buffer size
                const audioBufferSize = fs.statSync(tempFile).size - 44; // Subtract WAV header
                const bytesPerSample = 2; // 16-bit audio
                const channels = wavData.channelData.length;
                actualSampleCount = Math.floor(audioBufferSize / (bytesPerSample * channels));
                console.log(`🔧 Fixed sample count from ${wavData.channelData[0].length} to ${actualSampleCount}`);
                
                // Truncate the channel data to the actual size
                for (let i = 0; i < wavData.channelData.length; i++) {
                    wavData.channelData[i] = wavData.channelData[i].slice(0, actualSampleCount);
                }
            }
            
            // Create an AudioSource (use the original sample rate, then resample if needed)
            const audioSource = new AudioSource(48000, 1); // LiveKit typically uses 48kHz mono
            
            // Create a local audio track
            const audioTrack = LocalAudioTrack.createAudioTrack('ai-response', audioSource);
            
            // Publish the track to the room
            const publication = await this.room.localParticipant.publishTrack(audioTrack, {
                name: 'ai-response',
                source: 2 // MICROPHONE source
            });
            
            console.log(`🎤 Published audio track: ${publication.sid}`);
            
            // Convert the decoded audio to the format LiveKit expects
            let audioData;
            if (wavData.channelData.length === 1) {
                // Already mono
                audioData = wavData.channelData[0];
            } else {
                // Convert stereo to mono by averaging channels
                const leftChannel = wavData.channelData[0];
                const rightChannel = wavData.channelData[1];
                audioData = new Float32Array(leftChannel.length);
                for (let i = 0; i < leftChannel.length; i++) {
                    audioData[i] = (leftChannel[i] + rightChannel[i]) / 2;
                }
            }
            
            // Convert Float32 to Int16 and resample if necessary
            const targetSampleRate = 48000;
            const sourceSampleRate = wavData.sampleRate;
            
            let finalAudioData;
            if (sourceSampleRate !== targetSampleRate) {
                // Simple resampling (linear interpolation)
                const resampleRatio = targetSampleRate / sourceSampleRate;
                const newLength = Math.floor(audioData.length * resampleRatio);
                const resampled = new Float32Array(newLength);
                
                for (let i = 0; i < newLength; i++) {
                    const sourceIndex = i / resampleRatio;
                    const lowerIndex = Math.floor(sourceIndex);
                    const upperIndex = Math.min(lowerIndex + 1, audioData.length - 1);
                    const fraction = sourceIndex - lowerIndex;
                    
                    resampled[i] = audioData[lowerIndex] * (1 - fraction) + audioData[upperIndex] * fraction;
                }
                finalAudioData = resampled;
            } else {
                finalAudioData = audioData;
            }
            
            // Convert to Int16Array (LiveKit expects 16-bit PCM)
            const int16Data = new Int16Array(finalAudioData.length);
            for (let i = 0; i < finalAudioData.length; i++) {
                // Clamp and convert to 16-bit signed integer
                const sample = Math.max(-1, Math.min(1, finalAudioData[i]));
                int16Data[i] = Math.floor(sample * 0x7FFF);
            }
            
            const samplesPerChannel = int16Data.length;
            console.log(`🎵 Prepared audio: ${samplesPerChannel} samples at ${targetSampleRate}Hz`);
            
            // Create AudioFrame and send it
            const frame = new AudioFrame(
                int16Data,        // data: Int16Array
                targetSampleRate,       // sampleRate: number
                1,               // channels: number  
                samplesPerChannel // samplesPerChannel: number
            );
            
            console.log(`🎵 Sending audio frame: ${frame.samplesPerChannel} samples`);
            await audioSource.captureFrame(frame);
            
            // Wait for the audio to finish playing
            await audioSource.waitForPlayout();
            
            // Clean up
            setTimeout(async () => {
                try {
                    await audioTrack.close();
                    fs.unlinkSync(tempFile);
                    console.log(`🧹 Cleaned up audio track and temp file`);
                } catch (e) {
                    console.log(`⚠️ Cleanup error (non-critical):`, e.message);
                }
            }, 3000);
            
            console.log(`✅ Audio response played successfully!`);
            
        } catch (error) {
            console.error('❌ Error playing audio response:', error);
        }
    }

  async stop() {
    if (this.isConnected) {
      await this.room.disconnect();
      console.log('🛑 Agent stopped');
    }
  }
}

// Start the agent
async function main() {
  const agent = new VoiceAgent();
  
  try {
    await agent.start();
    
    // Keep the process running
    process.on('SIGINT', async () => {
      console.log('\n🛑 Shutting down agent...');
      await agent.stop();
      process.exit(0);
    });
    
    // Keep alive
    setInterval(() => {
      if (!agent.isConnected) {
        console.log('⚠️ Agent disconnected, attempting to reconnect...');
        agent.start().catch(console.error);
      }
    }, 10000);
    
  } catch (error) {
    console.error('❌ Failed to start agent:', error);
    process.exit(1);
  }
}

main();