'use client';

import { useState, useRef, useEffect } from 'react';
import { X, Mic, MicOff, Send, Monitor, MonitorOff } from 'lucide-react';
import LiveKitSession from './LiveKitSession';

interface VibeGlassWidgetProps {
  incidentContext: string;
  isOpen: boolean;
  onClose: () => void;
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  type: 'text' | 'voice';
}

const VibeGlassWidget: React.FC<VibeGlassWidgetProps> = ({ 
  incidentContext, 
  isOpen, 
  onClose 
}) => {
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [voiceMessages, setVoiceMessages] = useState<Message[]>([]);
  const [permissions, setPermissions] = useState({ microphone: false, screen: false });
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const [liveKitConnected, setLiveKitConnected] = useState(false);
  const screenVideoRef = useRef<HTMLVideoElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);

  // Auto-request permissions when widget opens
  useEffect(() => {
    if (isOpen && !permissions.microphone && !permissions.screen) {
      setTimeout(() => {
        requestPermissions();
      }, 100);
    }
  }, [isOpen]);

  // Auto-scroll to bottom of chat
  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [messages, voiceMessages]);

  // Poll for voice conversations
  useEffect(() => {
    if (isListening && isOpen) {
      const pollVoiceConversations = async () => {
        try {
          const response = await fetch('/api/voice-conversation?roomName=vibe-ai-copilot-room&participantId=user');
          if (response.ok) {
            const data = await response.json();
            setVoiceMessages(data.messages || []);
          }
        } catch (error) {
          console.error('Error polling voice conversations:', error);
        }
      };

      const interval = setInterval(pollVoiceConversations, 2000);
      return () => clearInterval(interval);
    }
  }, [isListening, isOpen]);

  // Send current screenshot periodically
  useEffect(() => {
    if (isScreenSharing && isOpen) {
      const sendCurrentScreenshot = async () => {
        try {
          const screenshot = await captureScreenshot();
          if (screenshot) {
            await fetch('/api/current-screenshot', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ screenshot })
            });
          }
        } catch (error) {
          console.error('Error sending screenshot:', error);
        }
      };

      const interval = setInterval(sendCurrentScreenshot, 5000);
      return () => clearInterval(interval);
    }
  }, [isScreenSharing, isOpen]);

  // Send incident context to the LiveKit agent
  useEffect(() => {
    if (incidentContext && isOpen) {
      fetch('/api/current-context', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ context: incidentContext })
      }).catch(error => {
        console.error('Error sending context to LiveKit agent:', error);
      });
    }
  }, [incidentContext, isOpen]);

  const requestPermissions = async () => {
    try {
      // Request microphone permission
      const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      setPermissions(prev => ({ ...prev, microphone: true }));
      micStream.getTracks().forEach(track => track.stop());

      // Request screen permission
      const screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true
      });
      setPermissions(prev => ({ ...prev, screen: true }));
      setScreenStream(screenStream);
      setIsScreenSharing(true);

      // Display screen stream
      if (screenVideoRef.current) {
        screenVideoRef.current.srcObject = screenStream;
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
      alert('Please grant microphone and screen access permissions.');
    }
  };

  const captureScreenshot = async (): Promise<string | null> => {
    if (!screenVideoRef.current || !isScreenSharing) return null;
    
    const video = screenVideoRef.current;
    if (video.videoWidth === 0 || video.videoHeight === 0) return null;

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    
    ctx.drawImage(video, 0, 0);
    const screenshot = canvas.toDataURL('image/jpeg', 0.8);
    
    return screenshot.startsWith('data:image/jpeg;base64,') ? screenshot : null;
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const userMessage = input.trim();
    setInput('');
    setIsLoading(true);

    const userMsgId = Date.now().toString();
    const assistantMsgId = (Date.now() + 1).toString();
    
    setMessages(prev => [...prev, { 
      id: userMsgId, 
      role: 'user', 
      content: userMessage, 
      timestamp: Date.now(),
      type: 'text'
    }]);

    try {
      const screenshot = await captureScreenshot();
      const validScreenshot = screenshot && screenshot.startsWith('data:image/jpeg;base64,') ? screenshot : null;

      const response = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [...messages.map(m => ({ role: m.role, content: m.content })), { role: 'user', content: userMessage }],
          context: incidentContext,
          screenshot: validScreenshot
        }),
      });

      if (!response.ok) throw new Error('Failed to get AI response');

      const contentType = response.headers.get('content-type');
      if (contentType?.includes('text/plain')) {
        const textResponse = await response.text();
        setMessages(prev => [...prev, {
          id: assistantMsgId,
          role: 'assistant',
          content: textResponse,
          timestamp: Date.now(),
          type: 'text'
        }]);
      } else {
        const reader = response.body?.getReader();
        if (!reader) throw new Error('No response stream');

        const decoder = new TextDecoder();
        let assistantResponse = '';

        setMessages(prev => [...prev, { 
          id: assistantMsgId, 
          role: 'assistant', 
          content: '', 
          timestamp: Date.now(),
          type: 'text'
        }]);

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split('\n');

          for (const line of lines) {
            if (line.trim() === '') continue;

            // Handle AI SDK streaming format
            if (line.startsWith('0:')) {
              try {
                const textContent = line.slice(2);
                if (textContent.startsWith('"') && textContent.endsWith('"')) {
                  const textDelta = JSON.parse(textContent);
                  assistantResponse += textDelta;
                  setMessages(prev => prev.map(m =>
                    m.id === assistantMsgId ? { ...m, content: assistantResponse } : m
                  ));
                }
              } catch (e) {
                // Try to extract text from complex format
                if (line.includes('0:"')) {
                  const parts = line.split('0:"');
                  for (let i = 1; i < parts.length; i++) {
                    const part = parts[i];
                    const endQuoteIndex = part.indexOf('"');
                    if (endQuoteIndex !== -1) {
                      const textDelta = part.substring(0, endQuoteIndex);
                      assistantResponse += textDelta;
                      setMessages(prev => prev.map(m =>
                        m.id === assistantMsgId ? { ...m, content: assistantResponse } : m
                      ));
                    }
                  }
                }
              }
            } else if (line.includes('0:"')) {
              // Handle lines that contain 0:" but don't start with it
              try {
                const parts = line.split('0:"');
                for (let i = 1; i < parts.length; i++) {
                  const part = parts[i];
                  const endQuoteIndex = part.indexOf('"');
                  if (endQuoteIndex !== -1) {
                    const textDelta = part.substring(0, endQuoteIndex);
                    assistantResponse += textDelta;
                    setMessages(prev => prev.map(m =>
                      m.id === assistantMsgId ? { ...m, content: assistantResponse } : m
                    ));
                  }
                }
              } catch (e) {
                console.error('Error parsing streaming response:', e);
              }
            }
          }
        }
      }
    } catch (error) {
      console.error('Error sending message:', error);
      setMessages(prev => [...prev, {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: 'Sorry, I encountered an error processing your request.',
        timestamp: Date.now(),
        type: 'text'
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleListenClick = async () => {
    if (!permissions.microphone) {
      requestPermissions();
      return;
    }
    
    if (isListening) {
      // Stop listening
      setIsListening(false);
      setLiveKitConnected(false);
      
      // Stop the LiveKit agent
      try {
        await fetch('/api/stop-agent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        });
      } catch (error) {
        console.error('Error stopping agent:', error);
      }
    } else {
      // Start listening
      setIsListening(true);
      setLiveKitConnected(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl h-[80vh] flex flex-col animate-in slide-in-from-bottom-4 duration-300">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-gradient-to-r from-blue-500 to-purple-600 rounded-lg flex items-center justify-center">
              <span className="text-white font-bold text-sm">AI</span>
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Vibe AI Copilot</h2>
              <p className="text-sm text-gray-500">Incident Assistant</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {/* Main Content */}
        <div className="flex-1 flex overflow-hidden">
          {/* Screen Preview */}
          <div className="w-1/3 border-r border-gray-200 flex flex-col">
            <div className="p-4 border-b border-gray-200">
              <h3 className="font-medium text-gray-900 flex items-center gap-2">
                <Monitor className="w-4 h-4" />
                Screen Preview
              </h3>
            </div>
            <div className="flex-1 p-4">
              {isScreenSharing ? (
                <video
                  ref={screenVideoRef}
                  autoPlay
                  playsInline
                  muted
                  className="w-full h-full object-contain rounded-lg border border-gray-200"
                />
              ) : (
                <div className="w-full h-full bg-gray-50 rounded-lg border-2 border-dashed border-gray-300 flex items-center justify-center">
                  <div className="text-center">
                    <MonitorOff className="w-8 h-8 text-gray-400 mx-auto mb-2" />
                    <p className="text-sm text-gray-500">Screen sharing not active</p>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Chat Area */}
          <div className="flex-1 flex flex-col">
            {/* Incident Context */}
            <div className="p-4 border-b border-gray-200 bg-gray-50">
              <h3 className="font-medium text-gray-900 mb-2">Incident Context</h3>
              <p className="text-sm text-gray-600 line-clamp-2">
                {incidentContext.substring(0, 200)}...
              </p>
              
              {/* Permission Status */}
              <div className="mt-3 p-3 bg-blue-50 rounded-lg">
                <h4 className="text-sm font-medium text-blue-900 mb-2">Permissions</h4>
                <div className="flex items-center gap-4 text-sm">
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${permissions.microphone ? 'bg-green-500' : 'bg-red-500'}`}></span>
                    <span className={permissions.microphone ? 'text-green-700' : 'text-red-700'}>
                      Microphone: {permissions.microphone ? 'Granted' : 'Not granted'}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${permissions.screen ? 'bg-green-500' : 'bg-red-500'}`}></span>
                    <span className={permissions.screen ? 'text-green-700' : 'text-red-700'}>
                      Screen: {permissions.screen ? 'Granted' : 'Not granted'}
                    </span>
                  </div>
                  {isListening && (
                    <div className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${liveKitConnected ? 'bg-green-500' : 'bg-yellow-500'}`}></span>
                      <span className={liveKitConnected ? 'text-green-700' : 'text-yellow-700'}>
                        Voice Agent: {liveKitConnected ? 'Connected' : 'Connecting...'}
                      </span>
                    </div>
                  )}
                </div>
                {(!permissions.microphone || !permissions.screen) && (
                  <button
                    onClick={requestPermissions}
                    className="mt-2 px-3 py-1 bg-blue-500 text-white text-xs rounded hover:bg-blue-600 transition-colors"
                  >
                    Grant Permissions
                  </button>
                )}
              </div>
            </div>

            {/* Messages */}
            <div ref={chatContainerRef} className="flex-1 p-4 overflow-y-auto">
              {isListening ? (
                <div className="space-y-4">
                  {voiceMessages.map((m) => (
                    <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                      <div className={`px-4 py-2 rounded-2xl max-w-md ${m.role === 'user' ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-900'}`}>
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
                      <Mic className="w-8 h-8 mx-auto mb-2 text-gray-400" />
                      <p>Voice conversation will appear here...</p>
                    </div>
                  )}
                  
                  {/* LiveKit Session for voice */}
                  {isListening && !liveKitConnected && (
                    <div className="hidden">
                      <LiveKitSession
                        key="livekit-session"
                        roomName="vibe-ai-copilot-room"
                        userName="user"
                        onConnected={(isConnected) => {
                          setLiveKitConnected(isConnected);
                        }}
                      />
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-4">
                  {messages.map((m) => (
                    <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                      <div className={`px-4 py-2 rounded-2xl max-w-md ${m.role === 'user' ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-900'}`}>
                        {m.content}
                      </div>
                    </div>
                  ))}
                  {isLoading && (
                    <div className="flex justify-start">
                      <div className="px-4 py-2 rounded-2xl bg-gray-100 text-gray-900">
                        <div className="flex items-center gap-2">
                          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-500"></div>
                          Thinking...
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Input Area */}
            <div className="p-4 border-t border-gray-200">
              {!isListening ? (
                <form onSubmit={handleSubmit} className="flex gap-3">
                  <input
                    type="text"
                    placeholder="Ask about the incident..."
                    className="flex-1 px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    disabled={isLoading}
                  />
                  <button
                    type="submit"
                    disabled={isLoading || !input.trim()}
                    className="px-6 py-3 bg-blue-500 text-white rounded-xl font-medium hover:bg-blue-600 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
                  >
                    <Send className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={handleListenClick}
                    className={`px-6 py-3 rounded-xl font-medium transition-colors ${
                      isListening 
                        ? 'bg-red-500 text-white hover:bg-red-600' 
                        : 'bg-green-500 text-white hover:bg-green-600'
                    }`}
                  >
                    {isListening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                  </button>
                </form>
              ) : (
                <div className="text-center">
                  <button
                    onClick={handleListenClick}
                    className="px-8 py-3 bg-red-500 text-white rounded-xl font-medium hover:bg-red-600 transition-colors"
                  >
                    <MicOff className="w-4 h-4 inline mr-2" />
                    Stop Listening
                  </button>
                  <p className="text-sm text-gray-600 mt-2">
                    Voice mode active - speak your question
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default VibeGlassWidget; 