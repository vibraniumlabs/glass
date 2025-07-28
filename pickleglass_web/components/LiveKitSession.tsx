'use client';

import { useEffect, useState } from 'react';
import {
  AudioConference,
  LiveKitRoom,
} from '@livekit/components-react';
import '@livekit/components-styles';

interface LiveKitSessionProps {
  roomName: string;
  userName: string;
  onConnected: (isConnected: boolean) => void;
}

export default function LiveKitSession({ roomName, userName, onConnected }: LiveKitSessionProps) {
  const [token, setToken] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const resp = await fetch(
          `/api/livekit-token?room=${roomName}&username=${userName}`
        );
        const data = await resp.json();
        setToken(data.token);
        onConnected(true);
      } catch (e) {
        console.error(e);
        onConnected(false);
      }
    })();
  }, [roomName, userName, onConnected]);

  if (token === '') {
    return <div>Getting token...</div>;
  }

  return (
    <LiveKitRoom
      video={false}
      audio={true}
      token={token}
      serverUrl={process.env.NEXT_PUBLIC_LIVEKIT_URL}
      data-lk-theme="default"
      style={{ height: '100%' }}
    >
      <AudioConference />
    </LiveKitRoom>
  );
} 