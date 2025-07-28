import React, { useEffect, useState } from 'react';
import { useChat } from '@ai-sdk/react';
import LiveKitSession from './LiveKitSession';

interface GlassAgentProps {
  incidentContext: string;
  onClose: () => void;
}

const GlassAgent: React.FC<GlassAgentProps> = ({ incidentContext, onClose }) => {
  const [hasScreenAccess, setHasScreenAccess] = useState(false);
  const [hasMicrophoneAccess, setHasMicrophoneAccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isListening, setIsListening] = useState(false);

  const { messages, input, handleInputChange, handleSubmit, isLoading } = useChat({
    api: '/api/ask',
    body: {
      context: incidentContext,
    },
  });

  useEffect(() => {
    const requestPermissions = async () => {
      try {
        // Request screen sharing permission
        const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        // We don't need to do anything with the stream yet, just confirm access
        screenStream.getTracks().forEach(track => track.stop());
        setHasScreenAccess(true);

        // Request microphone permission
        const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        // We don't need to do anything with the stream yet, just confirm access
        audioStream.getTracks().forEach(track => track.stop());
        setHasMicrophoneAccess(true);
      } catch (err) {
        console.error("Permission error:", err);
        setError("Permissions are required to use the AI Copilot. Please grant access and try again.");
      }
    };

    requestPermissions();
  }, []);

  const handleListenClick = () => {
    setIsListening(prev => !prev);
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center">
      <div className="bg-white rounded-lg shadow-2xl w-full max-w-2xl h-3/4 flex flex-col">
        <header className="flex items-center justify-between p-4 border-b">
          <h2 className="text-lg font-semibold">Vibe AI Copilot</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-800">
            &times;
          </button>
        </header>
        <main className="flex-1 p-4 overflow-y-auto">
          {error ? (
            <div className="text-red-500 bg-red-100 p-4 rounded-lg">{error}</div>
          ) : (
            <>
              <div className="flex justify-between text-sm mb-4">
                <span className={`px-3 py-1 rounded-full ${hasScreenAccess ? 'bg-green-200 text-green-800' : 'bg-gray-200 text-gray-800'}`}>
                  {hasScreenAccess ? 'Screen Access Granted' : 'Requesting Screen Access...'}
                </span>
                <span className={`px-3 py-1 rounded-full ${hasMicrophoneAccess ? 'bg-green-200 text-green-800' : 'bg-gray-200 text-gray-800'}`}>
                  {hasMicrophoneAccess ? 'Microphone Access Granted' : 'Requesting Microphone...'}
                </span>
              </div>
              <p className="text-sm text-gray-600 mb-4">
                <strong>Incident Context:</strong> {incidentContext}
              </p>
              {isListening ? (
                <div className="h-full">
                  <LiveKitSession
                    roomName="vibe-ai-copilot-room"
                    userName="user"
                    onConnected={(isConnected) => console.log(isConnected ? 'LiveKit connected' : 'LiveKit connection failed')}
                  />
                </div>
              ) : (
                <div className="space-y-4">
                  {messages.map((m) => (
                    <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                      <div className={`px-4 py-2 rounded-lg ${m.role === 'user' ? 'bg-blue-500 text-white' : 'bg-gray-200 text-gray-800'}`}>
                        {m.content}
                      </div>
                    </div>
                  ))}
                  {isLoading && (
                    <div className="flex justify-start">
                      <div className="px-4 py-2 rounded-lg bg-gray-200 text-gray-800">
                        Thinking...
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </main>
        <footer className="p-4 border-t">
          {!isListening ? (
            <form onSubmit={handleSubmit}>
              <div className="flex space-x-4">
                <input
                  type="text"
                  placeholder="Ask a question..."
                  className="flex-1 px-4 py-2 border rounded-full focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={input}
                  onChange={handleInputChange}
                  disabled={isLoading}
                />
                <button
                  type="submit"
                  className="px-6 py-2 bg-blue-500 text-white rounded-full font-semibold hover:bg-blue-600 disabled:bg-blue-300"
                  disabled={isLoading}
                >
                  Ask
                </button>
                <button
                  type="button"
                  onClick={handleListenClick}
                  className="px-6 py-2 bg-green-500 text-white rounded-full font-semibold hover:bg-green-600"
                >
                  Listen
                </button>
              </div>
            </form>
          ) : (
            <div className="flex justify-center">
              <button
                type="button"
                onClick={handleListenClick}
                className="px-6 py-2 bg-red-500 text-white rounded-full font-semibold hover:bg-red-600"
              >
                Stop Listening
              </button>
            </div>
          )}
        </footer>
      </div>
    </div>
  );
};

export default GlassAgent; 