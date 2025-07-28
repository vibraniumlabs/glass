import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  try {
    const { audioData, roomName, participantId } = await req.json();
    
    // This endpoint will handle voice input from the widget
    // and process it through the LiveKit agent
    console.log('🎤 Received voice input from widget:', {
      roomName,
      participantId,
      audioDataLength: audioData ? audioData.length : 0
    });
    
    // TODO: Process the audio data through the LiveKit agent
    // For now, just acknowledge receipt
    
    return NextResponse.json({ 
      success: true, 
      message: 'Voice input received' 
    });
    
  } catch (error) {
    console.error('❌ Error processing voice input:', error);
    return NextResponse.json(
      { error: 'Failed to process voice input' },
      { status: 500 }
    );
  }
} 