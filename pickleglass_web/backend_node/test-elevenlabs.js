const dotenv = require('dotenv');
const path = require('path');
const { ElevenLabsClient } = require('elevenlabs');
const fs = require('fs');

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

// Helper function to convert ReadableStream to Buffer
async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function testElevenLabs() {
  try {
    console.log('🧪 Testing ElevenLabs integration...');
    
    if (!process.env.ELEVENLABS_API_KEY) {
      console.error('❌ ELEVENLABS_API_KEY not found in environment variables');
      return;
    }
    
    console.log('✅ ElevenLabs API key found');
    
    // Initialize ElevenLabs client
    const elevenlabs = new ElevenLabsClient({
      apiKey: process.env.ELEVENLABS_API_KEY
    });
    
    // Test TTS
    console.log('🎤 Testing Text-to-Speech...');
    const ttsStream = await elevenlabs.textToSpeech.convert("21m00Tcm4TlvDq8ikWAM", {
      text: "Hello, this is a test of ElevenLabs text to speech integration.",
      model_id: 'eleven_monolingual_v1',
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.5,
      }
    });
    
    // Convert stream to buffer
    const ttsBuffer = await streamToBuffer(ttsStream);
    console.log(`✅ TTS successful! Generated ${ttsBuffer.length} bytes of audio`);
    
    // Save test audio file
    const testFile = path.join(__dirname, 'test_tts.mp3');
    fs.writeFileSync(testFile, ttsBuffer);
    console.log(`💾 Test audio saved to: ${testFile}`);
    
    console.log('🎉 ElevenLabs integration test completed successfully!');
    
  } catch (error) {
    console.error('❌ ElevenLabs test failed:', error.message);
    console.error('Full error:', error);
  }
}

testElevenLabs(); 