const { createTTS } = require('./src/features/common/ai/factory');
const modelStateService = require('./src/features/common/services/modelStateService');
const ttsService = require('./src/features/common/services/ttsService');

async function debugTTS() {
    console.log('🔍 Starting TTS Debug...\n');
    
    try {
        // 1. Check if TTS service is initialized
        console.log('1. Checking TTS Service initialization...');
        await ttsService.initialize();
        console.log('✅ TTS Service initialized\n');
        
        // 2. Check if TTS is enabled
        console.log('2. Checking if TTS is enabled...');
        const isEnabled = ttsService.isEnabled();
        console.log(`TTS Enabled: ${isEnabled}\n`);
        
        if (!isEnabled) {
            console.log('⚠️  TTS is disabled. Enabling it...');
            ttsService.setEnabled(true);
            console.log('✅ TTS enabled\n');
        }
        
        // 3. Check model state
        console.log('3. Checking model state...');
        await modelStateService.initialize();
        const modelInfo = await modelStateService.getCurrentModelInfo('tts');
        console.log('Current TTS Model Info:', JSON.stringify(modelInfo, null, 2));
        
        if (!modelInfo) {
            console.log('❌ No TTS model configured');
            return;
        }
        
        if (!modelInfo.apiKey) {
            console.log('❌ No API key found for TTS');
            return;
        }
        
        console.log('✅ TTS model and API key found\n');
        
        // 4. Test TTS directly
        console.log('4. Testing TTS synthesis...');
        const testText = 'Hello, this is a test of the text to speech system.';
        
        try {
            console.log('🎙️  Attempting to speak test text...');
            await ttsService.speak(testText);
            console.log('✅ TTS synthesis completed successfully!');
            console.log('🔊 You should have heard: "' + testText + '"');
        } catch (ttsError) {
            console.error('❌ TTS synthesis failed:', ttsError.message);
            console.error('Full error:', ttsError);
        }
        
        // 5. Check available voices
        console.log('\n5. Checking available voices...');
        try {
            const voices = await ttsService.getAvailableVoices();
            console.log('Available voices:', voices);
        } catch (voiceError) {
            console.error('Could not get available voices:', voiceError.message);
        }
        
        // 6. System audio check
        console.log('\n6. System audio check...');
        console.log('Platform:', process.platform);
        console.log('Please check:');
        console.log('- Your speakers/headphones are connected and working');
        console.log('- Volume is turned up');
        console.log('- No other audio applications are blocking sound');
        
    } catch (error) {
        console.error('❌ Debug failed:', error.message);
        console.error('Full error:', error);
    }
}

debugTTS().then(() => {
    console.log('\n🏁 TTS Debug completed');
    process.exit(0);
}).catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
}); 