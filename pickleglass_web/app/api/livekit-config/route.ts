import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  const wsUrl = process.env.NEXT_PUBLIC_LIVEKIT_URL;
  
  if (!wsUrl) {
    return NextResponse.json(
      { error: 'LiveKit URL not configured' },
      { status: 500 }
    );
  }

  return NextResponse.json({ 
    serverUrl: wsUrl
  });
} 