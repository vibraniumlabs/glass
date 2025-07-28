'use client';
import React, { useState, useEffect, useRef } from 'react';
import LiveKitSession from './LiveKitSession';

interface GlassAgentProps {
  incidentContext: string;
  onClose: () => void;
}

const GlassAgent: React.FC<GlassAgentProps> = ({ incidentContext, onClose }) => {
  const [permissions, setPermissions] = useState({
    microphone: false,
    screen: false
  });
  const [isListening, setIsListening] = useState(false);
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const screenVideoRef = useRef<HTMLVideoElement>(null);

  const [messages, setMessages] = useState<Array<{id: string, role: 'user' | 'assistant', content: string}>>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [voiceMessages, setVoiceMessages] = useState<Array<{
    id: string;
    role: 'user' | 'assistant';
    content: string;
    timestamp: number;
    type: 'voice' | 'text';
  }>>([]);
  const chatContainerRef = useRef<HTMLDivElement>(null);

  // Custom submit handler that includes screenshot
  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    
    if (!input.trim() || isLoading) return;
    
    const userMessage = input.trim();
    setInput('');
    setIsLoading(true);
    
        // Add user message to chat
    const userMsgId = Date.now().toString();
    const assistantMsgId = (Date.now() + 1).toString();
    setMessages(prev => [...prev, { id: userMsgId, role: 'user', content: userMessage }]);

    try {
      // Capture screenshot if screen sharing is active
      const screenshot = await captureScreenshot();

      console.log('📤 Sending question with screenshot:', screenshot ? '✅ included' : '❌ no screen sharing');
      if (screenshot && screenshot.startsWith('data:image/')) {
        console.log('📸 Screenshot data length:', screenshot.length);
        console.log('📸 Screenshot preview:', screenshot.substring(0, 50) + '...');
      } else if (screenshot) {
        console.log('⚠️ Invalid screenshot format:', screenshot.substring(0, 50) + '...');
      }

      // Only send valid screenshots
      const validScreenshot = screenshot && screenshot.startsWith('data:image/jpeg;base64,') ? screenshot : null;
      
      // Send request with screenshot
      const response = await fetch('/api/ask', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messages: [...messages.map(m => ({ role: m.role, content: m.content })), { role: 'user', content: userMessage }],
          context: incidentContext,
          screenshot: validScreenshot
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to get AI response');
      }

      // Check if this is a plain text response (from direct OpenAI API)
      const contentType = response.headers.get('content-type');
      if (contentType?.includes('text/plain')) {
        console.log('📝 Received plain text response from direct OpenAI API');
        const textResponse = await response.text();
        
        setMessages(prev => [...prev, { 
          id: assistantMsgId, 
          role: 'assistant', 
          content: textResponse 
        }]);
        
        setIsLoading(false);
        return;
      }

      // Handle streaming response (from AI SDK)
      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No response stream');
      }

      const decoder = new TextDecoder();
      let assistantResponse = '';
      
      // Add empty assistant message that we'll update
      setMessages(prev => [...prev, { id: assistantMsgId, role: 'assistant', content: '' }]);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.trim() === '') continue;
          
          // Handle different streaming formats
          if (line.startsWith('0:')) {
            try {
              // Parse the text content
              const textContent = line.slice(2);
              if (textContent.startsWith('"') && textContent.endsWith('"')) {
                // Remove quotes and add to response
                const textDelta = JSON.parse(textContent);
                assistantResponse += textDelta;
                setMessages(prev => prev.map(m => 
                  m.id === assistantMsgId 
                    ? { ...m, content: assistantResponse }
                    : m
                ));
              }
            } catch (e) {
              // Ignore parsing errors for non-JSON lines
            }
          } else if (line.includes('0:"')) {
            // Handle the format: f:{"messageId":"..."} 0:"text" 0:"more text"
            try {
              const parts = line.split('0:"');
              for (let i = 1; i < parts.length; i++) {
                const part = parts[i];
                const endQuoteIndex = part.indexOf('"');
                if (endQuoteIndex !== -1) {
                  const textDelta = part.substring(0, endQuoteIndex);
                  assistantResponse += textDelta;
                  setMessages(prev => prev.map(m => 
                    m.id === assistantMsgId 
                      ? { ...m, content: assistantResponse }
                      : m
                  ));
                }
              }
            } catch (e) {
              console.error('Error parsing streaming response:', e);
            }
          }
        }
      }
    } catch (error) {
      console.error('Error sending message:', error);
      setMessages(prev => [...prev, { 
        id: (Date.now() + 1).toString(), 
        role: 'assistant', 
        content: 'Sorry, I encountered an error processing your request.' 
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInput(e.target.value);
  };

  useEffect(() => {
    console.log('🔍 GlassAgent mounted with permissions:', permissions);
    console.log('🔍 Screen sharing state:', isScreenSharing);
    console.log('🔍 Screen stream state:', !!screenStream);
    
    // Send incident context to the LiveKit agent
    if (incidentContext) {
      fetch('/api/current-context', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ context: incidentContext })
      }).then(() => {
        console.log('📋 Incident context sent to LiveKit agent');
      }).catch(error => {
        console.error('❌ Error sending context to LiveKit agent:', error);
      });
    }
  }, [incidentContext]);

  const requestPermissions = async () => {
    try {
      // Request microphone permission first
      const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      setPermissions(prev => ({ ...prev, microphone: true }));
      micStream.getTracks().forEach(track => track.stop()); // Stop the test stream
      
      // Request screen permission after microphone
      const screenStream = await navigator.mediaDevices.getDisplayMedia({ 
        video: true,
        audio: true // Also capture screen audio if available
      });
      setPermissions(prev => ({ ...prev, screen: true }));
      setScreenStream(screenStream);
      setIsScreenSharing(true);
      
      // Small delay to ensure React has updated the DOM
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Display screen stream in video element
      if (screenVideoRef.current) {
        screenVideoRef.current.srcObject = screenStream;
        
        // Force play the video
        try {
          await screenVideoRef.current.play();
        } catch (playError) {
          console.error('Screen video play failed:', playError);
        }
      }
      
      // Handle screen share ending
      screenStream.getVideoTracks()[0].addEventListener('ended', () => {
        setIsScreenSharing(false);
        setScreenStream(null);
      });
      
    } catch (error) {
      console.error('Permission request failed:', error);
      alert('Please grant microphone and screen access permissions to use the voice AI agent.');
    }
  };

  const startScreenCapture = async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ 
        video: true,
        audio: true 
      });
      
      setScreenStream(stream);
      setIsScreenSharing(true);
      
      // Small delay to ensure React has updated the DOM
      await new Promise(resolve => setTimeout(resolve, 100));
      
      if (screenVideoRef.current) {
        screenVideoRef.current.srcObject = stream;
        
        // Force play the video
        try {
          await screenVideoRef.current.play();
        } catch (playError) {
          console.error('Video play failed:', playError);
        }
      }
      
      stream.getVideoTracks()[0].addEventListener('ended', () => {
        setIsScreenSharing(false);
        setScreenStream(null);
      });
    } catch (error) {
      console.error('Screen capture failed:', error);
    }
  };

  const stopScreenCapture = () => {
    if (screenStream) {
      screenStream.getTracks().forEach(track => track.stop());
      setScreenStream(null);
      setIsScreenSharing(false);
    }
  };

  const captureScreenshot = async (): Promise<string | null> => {
    if (!screenVideoRef.current || !isScreenSharing) {
      console.log('⚠️ Cannot capture screenshot: no video ref or not sharing');
      return null;
    }
    
    try {
      const canvas = document.createElement('canvas');
      const video = screenVideoRef.current;
      
      console.log('📸 Attempting screenshot capture:', {
        videoWidth: video.videoWidth,
        videoHeight: video.videoHeight,
        readyState: video.readyState,
        paused: video.paused,
        ended: video.ended
      });
      
      // Check if video has valid dimensions
      if (video.videoWidth === 0 || video.videoHeight === 0) {
        console.log('⚠️ Video has no dimensions, cannot capture screenshot');
        return null;
      }
      
      // Check if video is ready
      if (video.readyState < 2) { // HAVE_CURRENT_DATA
        console.log('⚠️ Video not ready, waiting...');
        // Wait a bit for video to load
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        if (video.videoWidth === 0 || video.videoHeight === 0) {
          console.log('⚠️ Video still not ready after waiting');
          return null;
        }
      }
      
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      
      ctx.drawImage(video, 0, 0);
      
      // Convert to base64 image
      const screenshot = canvas.toDataURL('image/jpeg', 0.8);
      
      // Validate the screenshot
      if (screenshot && screenshot.startsWith('data:image/jpeg;base64,')) {
        console.log('📸 Screenshot captured successfully:', {
          width: video.videoWidth,
          height: video.videoHeight,
          dataLength: screenshot.length
        });
        return screenshot;
      } else {
        console.log('⚠️ Invalid screenshot generated:', screenshot?.substring(0, 50));
        return null;
      }
    } catch (error) {
      console.error('❌ Screenshot capture failed:', error);
      return null;
    }
  };

    // Poll for voice conversation updates and send screenshots when listening
  useEffect(() => {
    let pollInterval: NodeJS.Timeout;
    let screenshotInterval: NodeJS.Timeout;
    
    if (isListening) {
      console.log('🔄 Starting voice conversation polling and screenshot sharing...');
      
      const pollVoiceConversations = async () => {
        try {
          const response = await fetch(`/api/voice-conversation?roomName=vibe-ai-copilot-room&participantId=user`);
          if (response.ok) {
            const data = await response.json();
            if (data.messages && data.messages.length > voiceMessages.length) {
              console.log(`📨 Received ${data.messages.length} voice messages`);
              setVoiceMessages(data.messages);
            }
          }
        } catch (error) {
          console.error('❌ Error polling voice conversations:', error);
        }
      };

      const sendCurrentScreenshot = async () => {
        try {
          const screenshot = await captureScreenshot();
          if (screenshot) {
            const response = await fetch('/api/current-screenshot', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ screenshot })
            });
            if (response.ok) {
              console.log('📸 Screenshot sent to voice agent');
            }
          }
        } catch (error) {
          console.error('❌ Error sending screenshot:', error);
        }
      };
      
      // Start both polling processes
      pollVoiceConversations();
      sendCurrentScreenshot();
      pollInterval = setInterval(pollVoiceConversations, 2000);
      screenshotInterval = setInterval(sendCurrentScreenshot, 5000); // Send screenshot every 5 seconds
    } else {
      console.log('🛑 Stopping voice conversation polling and screenshot sharing...');
    }
    
    return () => {
      if (pollInterval) clearInterval(pollInterval);
      if (screenshotInterval) clearInterval(screenshotInterval);
    };
  }, [isListening, voiceMessages.length]);

  // Scroll to bottom when messages change
  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [messages, voiceMessages]);

  if (!permissions.microphone || !permissions.screen) {
    console.log('🔒 Showing permission modal. Current permissions:', permissions);
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg p-8 max-w-md w-full mx-4">
          <h2 className="text-xl font-bold mb-4">🎙️ Vibe AI Copilot</h2>
          <p className="text-gray-600 mb-6">
            Please grant microphone and screen access permissions to use the voice AI agent.
          </p>
          <div className="space-y-2 mb-6">
            <div className="flex items-center space-x-2">
              <div className={`w-3 h-3 rounded-full ${permissions.microphone ? 'bg-green-500' : 'bg-gray-300'}`}></div>
              <span className="text-sm">Microphone Access</span>
            </div>
            <div className="flex items-center space-x-2">
              <div className={`w-3 h-3 rounded-full ${permissions.screen ? 'bg-green-500' : 'bg-gray-300'}`}></div>
              <span className="text-sm">Screen Capture Access</span>
            </div>
          </div>
          <div className="flex space-x-3">
            <button 
              onClick={requestPermissions}
              className="flex-1 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
            >
              Grant Permissions
            </button>
            <button 
              onClick={onClose}
              className="px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    );
  }

  const handleListenClick = () => {
    setIsListening(prev => !prev);
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-2xl w-full max-w-4xl h-5/6 flex flex-col overflow-hidden">
        <header className="flex items-center justify-between p-4 border-b">
          <h2 className="text-lg font-semibold">🎙️ Vibe AI Copilot</h2>
          <div className="flex items-center space-x-4">
            <div className="flex items-center space-x-2 text-sm">
              <div className={`w-2 h-2 rounded-full ${isScreenSharing ? 'bg-green-500' : 'bg-gray-300'}`}></div>
              <span>Screen {isScreenSharing ? 'Sharing' : 'Off'}</span>
            </div>
            <button onClick={onClose} className="text-gray-500 hover:text-gray-800 text-xl">
              &times;
            </button>
          </div>
        </header>
        
        <main className="flex-1 flex">
          {/* Screen Preview Panel */}
          <div className="w-2/5 border-r bg-gray-50 flex flex-col">
            <div className="p-3 border-b bg-gray-100">
              <h3 className="font-medium text-sm">Screen Preview</h3>
              <div className="flex space-x-2 mt-2">
                {!isScreenSharing ? (
                  <button
                    onClick={() => {
                      console.log('🔘 Start Sharing button clicked!');
                      startScreenCapture();
                    }}
                    className="px-3 py-1 bg-blue-500 text-white text-xs rounded hover:bg-blue-600"
                  >
                    Start Sharing
                  </button>
                ) : (
                  <button
                    onClick={stopScreenCapture}
                    className="px-3 py-1 bg-red-500 text-white text-xs rounded hover:bg-red-600"
                  >
                    Stop Sharing
                  </button>
                )}
              </div>
            </div>
            <div className="flex-1 p-3">
              {isScreenSharing ? (
                <video
                  ref={screenVideoRef}
                  autoPlay
                  muted
                  playsInline
                  className="w-full h-full object-contain bg-black rounded"
                  style={{ 
                    objectFit: 'contain',
                    objectPosition: 'center',
                    minHeight: '100%'
                  }}
                  onLoadedMetadata={(e) => {
                    const video = e.target as HTMLVideoElement;
                    console.log('📹 Video loaded:', {
                      videoWidth: video.videoWidth,
                      videoHeight: video.videoHeight,
                      containerWidth: video.offsetWidth,
                      containerHeight: video.offsetHeight
                    });
                  }}
                  onError={(e) => {
                    console.error('📹 Video error:', e);
                  }}
                />
              ) : (
                <div className="w-full h-full bg-gray-200 rounded flex items-center justify-center">
                  <div className="text-center text-gray-500">
                    <div className="text-4xl mb-2">🖥️</div>
                    <p className="text-sm">No screen sharing</p>
                    <p className="text-xs">Click "Start Sharing" to begin</p>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Chat Panel */}
          <div className="flex-1 flex flex-col">
            <div className="p-4 border-b bg-gray-50">
              <p className="text-sm text-gray-600">
                <strong>Incident Context:</strong> {incidentContext}
              </p>
            </div>
            
            <div ref={chatContainerRef} className="flex-1 p-4 overflow-y-auto min-h-0">
              {isListening ? (
                <div className="h-full flex flex-col">
                  {/* Voice Conversation Display */}
                  <div className="flex-1 overflow-y-auto min-h-0">
                    <div className="space-y-4">
                      {voiceMessages.map((m) => (
                        <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                          <div className={`px-4 py-2 rounded-lg max-w-md break-words ${m.role === 'user' ? 'bg-blue-500 text-white' : 'bg-gray-200 text-gray-800'}`}>
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-xs opacity-70">
                                🎤 {m.role === 'user' ? 'You' : 'AI'} ({new Date(m.timestamp).toLocaleTimeString()})
                              </span>
                            </div>
                            {m.content}
                          </div>
                        </div>
                      ))}
                      {voiceMessages.length === 0 && (
                        <div className="text-center text-gray-500 py-8">
                          <p>🎤 Voice conversation will appear here...</p>
                          <p className="text-sm">Speak to start chatting with the AI!</p>
                        </div>
                      )}
                    </div>
                  </div>
                  
                  {/* Compact LiveKit Audio Interface */}
                  <div className="h-16 border rounded-lg bg-gray-50 flex items-center justify-center">
                    <LiveKitSession
                      roomName="vibe-ai-copilot-room"
                      userName="user"
                      onConnected={(isConnected) => console.log(isConnected ? 'LiveKit connected' : 'LiveKit connection failed')}
                    />
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  {messages.map((m) => (
                    <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                      <div className={`px-4 py-2 rounded-lg max-w-md break-words ${m.role === 'user' ? 'bg-blue-500 text-white' : 'bg-gray-200 text-gray-800'}`}>
                        {m.content}
                      </div>
                    </div>
                  ))}
                  {isLoading && (
                    <div className="flex justify-start">
                      <div className="px-4 py-2 rounded-lg bg-gray-200 text-gray-800">
                        🤔 Thinking...
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            <footer className="p-4 border-t">
              {!isListening ? (
                <form onSubmit={handleSubmit}>
                  <div className="flex space-x-2">
                    <input
                      type="text"
                      placeholder="Ask a question about the incident..."
                      className="flex-1 px-4 py-2 border rounded-full focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900"
                      value={input}
                      onChange={handleInputChange}
                      disabled={isLoading}
                    />
                    <button
                      type="submit"
                      className="px-4 py-2 bg-blue-500 text-white rounded-full font-semibold hover:bg-blue-600 disabled:bg-blue-300"
                      disabled={isLoading}
                    >
                      Ask
                    </button>
                    <button
                      type="button"
                      onClick={handleListenClick}
                      className="px-4 py-2 bg-green-500 text-white rounded-full font-semibold hover:bg-green-600"
                    >
                      🎤 Listen
                    </button>
                  </div>
                </form>
              ) : (
                <div className="text-center">
                  <button
                    onClick={handleListenClick}
                    className="px-6 py-2 bg-red-500 text-white rounded-full font-semibold hover:bg-red-600"
                  >
                    🛑 Stop Listening
                  </button>
                  <p className="text-sm text-gray-600 mt-2">
                    Voice mode active - speak your question
                  </p>
                </div>
              )}
            </footer>
          </div>
        </main>
      </div>
    </div>
  );
};

export default GlassAgent; 