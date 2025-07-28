const http = require('http');

console.log('🧪 Testing LiveKit APIs...');

// Test 1: Get LiveKit config
console.log('📡 Testing /api/livekit-config...');
const configOptions = {
  hostname: 'localhost',
  port: 3001,
  path: '/api/livekit-config',
  method: 'GET'
};

const configReq = http.request(configOptions, (res) => {
  console.log(`📡 Config Status: ${res.statusCode}`);
  let data = '';
  
  res.on('data', (chunk) => {
    data += chunk;
  });
  
  res.on('end', () => {
    console.log('📡 Config Response:', data);
    
    // Test 2: Get LiveKit token
    console.log('🔑 Testing /api/livekit-token...');
    const tokenOptions = {
      hostname: 'localhost',
      port: 3001,
      path: '/api/livekit-token?room=vibe-ai-copilot-room&username=user',
      method: 'GET'
    };
    
    const tokenReq = http.request(tokenOptions, (tokenRes) => {
      console.log(`🔑 Token Status: ${tokenRes.statusCode}`);
      let tokenData = '';
      
      tokenRes.on('data', (chunk) => {
        tokenData += chunk;
      });
      
      tokenRes.on('end', () => {
        console.log('🔑 Token Response:', tokenData.substring(0, 200) + '...');
        
        try {
          const parsed = JSON.parse(tokenData);
          if (parsed.token) {
            console.log('✅ Token received successfully');
            console.log('🔗 Server URL from config:', JSON.parse(data).serverUrl);
          } else {
            console.log('❌ No token in response');
          }
        } catch (e) {
          console.log('❌ Could not parse token response');
        }
      });
    });
    
    tokenReq.on('error', (e) => {
      console.error('🔑 Token Error:', e.message);
    });
    
    tokenReq.end();
  });
});

configReq.on('error', (e) => {
  console.error('📡 Config Error:', e.message);
});

configReq.end(); 