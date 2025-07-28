const dotenv = require('dotenv');
const path = require('path');
const { Room, RoomEvent, Track, AudioStream, AudioFrame, combineAudioFrames, AudioSource, LocalAudioTrack } = require('@livekit/rtc-node');
const { AccessToken } = require('livekit-server-sdk');
const OpenAI = require('openai');
const { ElevenLabsClient } = require('elevenlabs');
const fs = require('fs');
const wav = require('node-wav');
const audioDecode = require('audio-decode').default;
const http = require('http'); // For sending logs to browser API

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '../../.env.local') });

// Initialize OpenAI (for chat completions only)
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Initialize ElevenLabs for TTS and STT
const elevenlabs = new ElevenLabsClient({
  apiKey: process.env.ELEVENLABS_API_KEY
});

// Helper function to convert ReadableStream to Buffer
async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

// Helper function to clean text for better TTS pronunciation
function cleanTextForTTS(text) {
  return text
    // Remove markdown and special characters
    .replace(/\*/g, '')
    .replace(/`/g, '')
    .replace(/#/g, '')
    .replace(/\*\*/g, '')
    .replace(/_/g, ' ')
    
    // Improve pronunciation of technical terms
    .replace(/SEV1/g, 'S E V 1')
    .replace(/SEV2/g, 'S E V 2')
    .replace(/SEV3/g, 'S E V 3')
    .replace(/500/g, 'five hundred')
    .replace(/404/g, 'four oh four')
    .replace(/503/g, 'five oh three')
    .replace(/ID: (\d+)/g, 'ID number $1')
    .replace(/ID (\d+)/g, 'ID number $1')
    
    // Clean up common abbreviations
    .replace(/PM/g, 'P M')
    .replace(/AM/g, 'A M')
    .replace(/AI/g, 'A I')
    .replace(/API/g, 'A P I')
    .replace(/UI/g, 'U I')
    .replace(/UX/g, 'U X')
    
    // Clean up punctuation and spacing
    .replace(/\s+/g, ' ')
    .replace(/\s+\./g, '.')
    .replace(/\s+,/g, ',')
    .trim();
}

// LiveKit configuration
const LIVEKIT_URL = process.env.LIVEKIT_URL;
const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY;
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET;
const ROOM_NAME = 'vibe-ai-copilot-room';
const AGENT_IDENTITY = 'ai-copilot-agent';

// ElevenLabs configuration
const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || "ErXwobaYiN019PkySvjV"; // Antoni voice ID

// Configuration validation
if (!LIVEKIT_URL || !LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
  console.error('Missing required LiveKit environment variables');
  process.exit(1);
}

if (!process.env.ELEVENLABS_API_KEY) {
  console.error('Missing required ElevenLabs API key');
  process.exit(1);
}

// Conversation logging function
async function logConversation(roomName, participantId, message, role, type = 'voice') {
    return new Promise((resolve, reject) => {
        const data = JSON.stringify({
            roomName,
            participantId,
            message,
            role,
            type
        });

        const options = {
            hostname: 'localhost',
            port: 3001,
            path: '/api/voice-conversation',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(data)
            }
        };

        const req = http.request(options, (res) => {
            let responseBody = '';
            
            res.on('data', (chunk) => {
                responseBody += chunk;
            });
            
            res.on('end', () => {
                if (res.statusCode === 200) {
                    try {
                        const result = JSON.parse(responseBody);
                        resolve(result);
                    } catch (e) {
                        resolve({});
                    }
                } else {
                    console.error('Failed to log conversation:', res.statusCode);
                    resolve({});
                }
            });
        });

        req.on('error', (error) => {
            console.error('Error logging conversation:', error.message);
            resolve({}); // Don't reject, just resolve empty to continue
        });

        req.write(data);
        req.end();
    });
}

// Context function - fetch current incident context from web interface
async function getIncidentContext() {
  return new Promise((resolve) => {
            const options = {
            hostname: 'localhost',
            port: 3001,
            path: '/api/current-context',
            method: 'GET'
        };

    const req = http.request(options, (res) => {
      let responseBody = '';
      
      res.on('data', (chunk) => {
        responseBody += chunk;
      });
      
      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            const result = JSON.parse(responseBody);
            console.log('📋 Fetched current incident context from web interface');
            resolve(result.context || "No incident context available.");
          } catch (e) {
            console.log('⚠️ Error parsing context response, using fallback');
            resolve("No incident context available.");
          }
        } else {
          console.log('⚠️ Could not fetch context from web interface, using fallback');
          resolve("No incident context available.");
        }
      });
    });

    req.on('error', (error) => {
      console.log('⚠️ Error fetching context, using fallback:', error.message);
      resolve("No incident context available.");
    });

    req.setTimeout(2000, () => {
      console.log('⚠️ Context fetch timeout, using fallback');
      resolve("No incident context available.");
    });

    req.end();
  });
}

function getSystemPrompt(context) {
  return `You are a helpful AI assistant with vision capabilities for incident response. The user is currently working on the following incident. This information is critical context for their request.
---
INCIDENT CONTEXT:
${context}
---

IMPORTANT: When you receive a screenshot (image), you MUST analyze and describe what you can see in the visual content. Do not ask for screenshots if one is already provided - instead, focus on analyzing the visual elements, UI components, charts, logs, error messages, or any other content visible in the image.

Be specific about what you observe visually and provide actionable insights based on both the incident context and the visual information. Reference specific visual elements like colors, text, layouts, charts, graphs, error messages, or interface components that you can see.

Your role is to assist the user by answering their questions about the incident. Be concise and accurate.`;
}

class VoiceAgent {
  constructor() {
    this.room = null;
    this.isConnected = false;
    this.audioSource = null;
    this.lastActivityTime = Date.now();
    this.inactivityTimeout = null;
    this.cleanupTimeout = null;
    this.participantCount = 0;
  }

  async start() {
    console.log('Starting Voice AI Agent...');
    
    try {
      // Generate token
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

      // Create room instance
      this.room = new Room();

      // Set up event listeners
      this.setupEventListeners();

      // Connect to room
      await this.room.connect(LIVEKIT_URL, jwt);
      this.isConnected = true;
      
      console.log(`Agent connected to room: ${ROOM_NAME}`);

    } catch (error) {
      console.error('Failed to start agent:', error.message);
      throw error;
    }
  }

  setupEventListeners() {
    // When connected
    this.room.on(RoomEvent.Connected, () => {
      console.log('Connected to LiveKit room');
      this.isConnected = true;
      this.lastActivityTime = Date.now();
      this.startInactivityTimer();
    });

    // When a participant joins
    this.room.on(RoomEvent.ParticipantConnected, (participant) => {
      console.log(`Participant joined: ${participant.identity}`);
      this.participantCount++;
      this.lastActivityTime = Date.now();
      this.resetInactivityTimer();
      
      // Listen for their audio tracks
      if (participant.audioTrackPublications) {
        participant.audioTrackPublications.forEach((publication) => {
          if (publication.track) {
            this.handleAudioTrack(publication.track, participant);
          }
        });
      }
    });

    // When a track is subscribed
    this.room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
      if (track.kind === 1) { // Audio track
        this.handleAudioTrack(track, participant);
      }
    });

    // When a participant leaves
    this.room.on(RoomEvent.ParticipantDisconnected, (participant) => {
      console.log(`Participant left: ${participant.identity}`);
      this.participantCount = Math.max(0, this.participantCount - 1);
      this.lastActivityTime = Date.now();
      
      if (this.participantCount === 0) {
        this.startCleanupTimer();
      } else {
        this.resetInactivityTimer();
      }
    });

    // Handle disconnection
    this.room.on(RoomEvent.Disconnected, () => {
      console.log('Agent disconnected from room');
      this.isConnected = false;
      this.stopInactivityTimer();
    });
  }

  async handleAudioTrack(track, participant) {
    console.log(`Listening to audio from: ${participant.identity}`);
    
    try {
      const audioStream = new AudioStream(track, {
        sampleRate: 48000,
        numChannels: 1,
        frameSizeMs: 20 // 20ms frames
      });
      
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
                }
                lastSpeechTime = now;
                audioFrames.push(audioFrame);
              } else {
                // Silence detected
                if (speechStartTime && lastSpeechTime) {
                  const speechDuration = lastSpeechTime - speechStartTime;
                  const silenceDuration = now - lastSpeechTime;
                  
                  // If we have enough speech and enough silence, process it
                  if (speechDuration >= MIN_SPEECH_DURATION && silenceDuration >= SILENCE_TIMEOUT && audioFrames.length > 0) {
                    await this.processAudioFrames(audioFrames.slice(), participant);
                    
                    // Reset for next speech
                    audioFrames.length = 0;
                    speechStartTime = null;
                    lastSpeechTime = null;
                  }
                }
              }
            }
          }
        } catch (error) {
          if (error.code !== 'ERR_INVALID_STATE') {
            console.error('Error reading audio stream:', error);
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
      console.error('Error setting up audio track:', error);
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
      const combinedFrame = combineAudioFrames(audioFrames);
      
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
      
      const tempAudioFile = path.join(__dirname, 'temp_audio.wav');
      fs.writeFileSync(tempAudioFile, wavFile);
      
            // Use ElevenLabs STT API
      const transcriptionResponse = await elevenlabs.speechToText.convert({
        file: fs.createReadStream(tempAudioFile),
        model_id: 'scribe_v1'
      });
      
      const transcription = { text: transcriptionResponse.text };

      console.log(`User said: "${transcription.text}"`);
      
      // Log the user's transcribed message
      await logConversation(ROOM_NAME, participant.identity, transcription.text, 'user', 'voice');
      
      // Clean up temp file
      try {
        if (fs.existsSync(tempAudioFile)) {
          fs.unlinkSync(tempAudioFile);
        }
      } catch (error) {
        // Ignore cleanup errors
      }

      const incidentContext = await getIncidentContext();
      
      // Get current screenshot for vision capabilities
      let screenshot = null;
      try {
          const screenshotResponse = await new Promise((resolve, reject) => {
              const options = {
                  hostname: 'localhost',
                  port: 3001,
                  path: '/api/current-screenshot',
                  method: 'GET'
              };

              const req = http.request(options, (res) => {
                  let responseBody = '';
                  res.on('data', (chunk) => responseBody += chunk);
                  res.on('end', () => {
                      if (res.statusCode === 200) {
                          try {
                              resolve(JSON.parse(responseBody));
                          } catch (e) {
                              resolve(null);
                          }
                      } else {
                          resolve(null);
                      }
                  });
              });

              req.on('error', () => resolve(null));
              req.end();
          });

          if (screenshotResponse && screenshotResponse.screenshot) {
              screenshot = screenshotResponse.screenshot;
          }
      } catch (error) {
          // Ignore screenshot errors
      }

      // Create messages with or without vision
      let messages = [
          { role: 'system', content: getSystemPrompt(incidentContext) }
      ];

      if (screenshot) {
          // Use vision-capable message format
          messages.push({
              role: 'user',
              content: [
                  { type: 'text', text: transcription.text },
                  {
                      type: 'image_url',
                      image_url: {
                          url: screenshot,
                          detail: 'high'
                      }
                  }
              ]
          });
      } else {
          // Use text-only format
          messages.push({
              role: 'user', 
              content: transcription.text
          });
      }

      const completion = await openai.chat.completions.create({
          model: screenshot ? 'gpt-4o' : 'gpt-4o-mini', // Use gpt-4o for vision, gpt-4o-mini for text-only
          messages: messages,
      });

      const aiResponse = completion.choices[0].message.content;
      console.log(`🤖 AI Response: "${aiResponse}"`);
      
      // Log the AI's response
      await logConversation(ROOM_NAME, participant.identity, aiResponse, 'assistant', 'voice');

      // Clean the AI response for better TTS pronunciation
      const cleanedText = cleanTextForTTS(aiResponse);
      console.log(`🗣️ Original text: ${aiResponse}`);
      console.log(`🗣️ Cleaned text: ${cleanedText}`);
      
      // Use ElevenLabs TTS API (default format)
      const ttsStream = await elevenlabs.textToSpeech.convert(ELEVENLABS_VOICE_ID, {
          text: cleanedText,
          model_id: 'eleven_monolingual_v1',
          voice_settings: {
              stability: 0.5,
              similarity_boost: 0.5,
          }
      });

      const audioResponseBuffer = await streamToBuffer(ttsStream);
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
        const incidentContext = await getIncidentContext();
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
        const ttsStream = await elevenlabs.textToSpeech.convert(ELEVENLABS_VOICE_ID, {
          text: aiResponse,
          model_id: 'eleven_monolingual_v1',
          voice_settings: {
              stability: 0.5,
              similarity_boost: 0.5,
          }
        });

        const audioResponseBuffer = await streamToBuffer(ttsStream);
        console.log(`🗣️ Generated ${audioResponseBuffer.length} bytes of speech`);

        // Step 4: Play audio response back to the room
        await this.playAudioResponse(audioResponseBuffer);
        
        return;
      }
      
      // Original real audio processing code would go here
      // Step 1: Transcribe audio with Whisper
      const tempAudioFile = path.join(__dirname, 'temp_audio.wav');
      fs.writeFileSync(tempAudioFile, audioData);
      
      // Use ElevenLabs STT API
      const transcriptionResponse = await elevenlabs.speechToText.convert({
        file: fs.createReadStream(tempAudioFile),
        model_id: 'scribe_v1'
      });
      
      const transcription = { text: transcriptionResponse.text };

      console.log(`💬 User said: "${transcription.text}"`);
      
      // Clean up temp file
      try {
        if (fs.existsSync(tempAudioFile)) {
          fs.unlinkSync(tempAudioFile);
        }
      } catch (error) {
        console.log('⚠️ Could not delete temp audio file:', error.message);
      }

      // Step 2: Generate AI response
      const incidentContext = await getIncidentContext();
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
        const ttsStream = await elevenlabs.textToSpeech.convert(ELEVENLABS_VOICE_ID, {
          text: aiResponse,
          model_id: 'eleven_monolingual_v1',
          voice_settings: {
              stability: 0.5,
              similarity_boost: 0.5,
          }
        });

        const audioResponseBuffer = await streamToBuffer(ttsStream);
      console.log(`🗣️ Generated ${audioResponseBuffer.length} bytes of speech`);

      // Step 4: Play audio response back to the room
      await this.playAudioResponse(audioResponseBuffer);

    } catch (error) {
      console.error('❌ Error processing audio:', error);
    }
  }

  async playAudioResponse(audioBuffer) {
    try {
      console.log('🔊 Playing audio response...');
      
      // Save the MP3 buffer to a temporary file
      const tempMp3File = path.join(__dirname, 'temp_response.mp3');
      fs.writeFileSync(tempMp3File, audioBuffer);
      
      // Decode MP3 using audio-decode
      const decodedAudioBuffer = await audioDecode(fs.readFileSync(tempMp3File));
      
      if (!decodedAudioBuffer || !decodedAudioBuffer.sampleRate || !decodedAudioBuffer.length) {
        console.error('Failed to decode MP3 data');
        return;
      }
      
      console.log(`🎵 Decoded MP3: ${decodedAudioBuffer.sampleRate}Hz, ${decodedAudioBuffer.numberOfChannels} channels, ${decodedAudioBuffer.length} samples`);
      
      // Create an AudioSource (use the decoded sample rate, then resample if needed)
      const audioSource = new AudioSource(48000, 1); // LiveKit typically uses 48kHz mono
      
      // Create a local audio track
      const audioTrack = LocalAudioTrack.createAudioTrack('ai-response', audioSource);
      
      // Publish the track to the room
      const publication = await this.room.localParticipant.publishTrack(audioTrack, {
        name: 'ai-response',
        source: 2 // MICROPHONE source
      });
      
      // Convert the decoded audio to the format LiveKit expects
      let audioData;
      if (decodedAudioBuffer.numberOfChannels === 1) {
        // Already mono - get the channel data
        audioData = decodedAudioBuffer.getChannelData(0);
      } else {
        // Convert stereo to mono by averaging channels
        const leftChannel = decodedAudioBuffer.getChannelData(0);
        const rightChannel = decodedAudioBuffer.getChannelData(1);
        audioData = new Float32Array(leftChannel.length);
        for (let i = 0; i < leftChannel.length; i++) {
          audioData[i] = (leftChannel[i] + rightChannel[i]) / 2;
        }
      }
      
      // Convert Float32 to Int16 and resample if necessary
      const targetSampleRate = 48000;
      const sourceSampleRate = decodedAudioBuffer.sampleRate;
      
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
      
      // Create AudioFrame and send it
      const frame = new AudioFrame(
        int16Data,        // data: Int16Array
        targetSampleRate, // sampleRate: number
        1,                // channels: number  
        int16Data.length  // samplesPerChannel: number
      );
      
      await audioSource.captureFrame(frame);
      
      // Wait for the audio to finish playing
      await audioSource.waitForPlayout();
      
      // Clean up
      setTimeout(async () => {
        try {
          await audioTrack.close();
          if (fs.existsSync(tempMp3File)) {
            fs.unlinkSync(tempMp3File);
          }
        } catch (e) {
          // Ignore cleanup errors
        }
      }, 3000);
      
      console.log('✅ Audio response played successfully');
      
    } catch (error) {
      console.error('Error playing audio response:', error);
    }
  }

  startInactivityTimer() {
    // Auto-disconnect after 5 minutes of inactivity
    this.inactivityTimeout = setTimeout(async () => {
      console.log('Inactivity timeout reached, disconnecting agent...');
      await this.stop();
    }, 5 * 60 * 1000); // 5 minutes
  }

  startCleanupTimer() {
    // Auto-disconnect after 30 seconds of no participants
    this.cleanupTimeout = setTimeout(async () => {
      if (this.participantCount === 0) {
        console.log('No participants for 30 seconds, cleaning up agent...');
        await this.stop();
      }
    }, 30 * 1000); // 30 seconds
  }

  resetInactivityTimer() {
    if (this.inactivityTimeout) {
      clearTimeout(this.inactivityTimeout);
    }
    this.startInactivityTimer();
  }

  stopInactivityTimer() {
    if (this.inactivityTimeout) {
      clearTimeout(this.inactivityTimeout);
      this.inactivityTimeout = null;
    }
    if (this.cleanupTimeout) {
      clearTimeout(this.cleanupTimeout);
      this.cleanupTimeout = null;
    }
  }

  async stop() {
    if (this.isConnected) {
      this.stopInactivityTimer();
      await this.room.disconnect();
      this.isConnected = false;
      console.log('Agent stopped and cleaned up');
    }
  }
}

// Start the agent
async function main() {
  const agent = new VoiceAgent();
  
  try {
    await agent.start();
    
    // Handle shutdown
    process.on('SIGINT', async () => {
      console.log('\nShutting down agent...');
      await agent.stop();
      process.exit(0);
    });
    
    // Auto-reconnect if disconnected
    setInterval(() => {
      if (!agent.isConnected) {
        console.log('Agent disconnected, attempting to reconnect...');
        agent.start().catch(console.error);
      }
    }, 10000);
    
  } catch (error) {
    console.error('Failed to start agent:', error);
    process.exit(1);
  }
}

main();