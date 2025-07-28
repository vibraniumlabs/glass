'use client';

import { useEffect, useState } from 'react';
import {
  LiveKitRoom,
  AudioConference,
} from '@livekit/components-react';
import '@livekit/components-styles';

interface LiveKitSessionProps {
  roomName: string;
  userName: string;
  onConnected: (isConnected: boolean) => void;
}

export default function LiveKitSession({ roomName, userName, onConnected }: LiveKitSessionProps) {
  const [token, setToken] = useState('');
  const [serverUrl, setServerUrl] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        // Get the server URL
        const configResp = await fetch('/api/livekit-config');
        if (!configResp.ok) {
          throw new Error(`Failed to get config: ${configResp.status}`);
        }
        const configData = await configResp.json();
        setServerUrl(configData.serverUrl);
        
        // Get the token
        const resp = await fetch(`/api/livekit-token?room=${roomName}&username=${userName}`);
        if (!resp.ok) {
          throw new Error(`Failed to get token: ${resp.status}`);
        }
        
        const data = await resp.json();
        setToken(data.token);
        onConnected(true);
      } catch (e) {
        console.error('LiveKit setup error:', e);
        setError(e instanceof Error ? e.message : 'Unknown error');
        onConnected(false);
      }
    })();
  }, [roomName, userName, onConnected]);

  if (error || token === '' || serverUrl === '') {
    return null;
  }

  return (
    <LiveKitRoom
      video={false}
      audio={true}
      token={token}
      serverUrl={serverUrl}
      data-lk-theme="default"
      style={{ height: '100%' }}
    >
      {/* Hidden AudioConference to receive audio from agent */}
      <div className="hidden">
        <AudioConference />
      </div>
    </LiveKitRoom>
  );
} 