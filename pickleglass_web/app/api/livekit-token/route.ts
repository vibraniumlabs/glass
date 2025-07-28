import { AccessToken } from 'livekit-server-sdk';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  const room = req.nextUrl.searchParams.get('room');
  const userName = req.nextUrl.searchParams.get('username');
  if (!room || !userName) {
    return NextResponse.json(
      { error: 'Missing "room" or "username" query parameters' },
      { status: 400 }
    );
  }

  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  const wsUrl = process.env.NEXT_PUBLIC_LIVEKIT_URL;

  if (!apiKey || !apiSecret || !wsUrl) {
    return NextResponse.json(
      { error: 'Server misconfigured' },
      { status: 500 }
    );
  }

  const at = new AccessToken(apiKey, apiSecret, { identity: userName });

  at.addGrant({ room, roomJoin: true, canPublish: true, canSubscribe: true });

  return NextResponse.json({ 
    token: await at.toJwt(),
    serverUrl: wsUrl
  });
} 