export const maxDuration = 30;
export const runtime = 'edge';

// Function to get or create widget session for voice conversations
async function getOrCreateWidgetSession() {
  try {
    const apiUrl = process.env.pickleglass_API_URL || 'http://localhost:3002';
    
    // Create a new session for widget voice interactions
    const sessionResponse = await fetch(`${apiUrl}/api/conversations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        type: 'widget',
        name: 'Glass Widget Voice Session'
      })
    });

    if (!sessionResponse.ok) {
      console.error('Failed to create widget voice session:', await sessionResponse.text());
      return null;
    }

    const sessionData = await sessionResponse.json();
    console.log('✅ Created widget voice session:', sessionData.id);
    return sessionData.id;
  } catch (error) {
    console.error('Error creating widget voice session:', error);
    return null;
  }
}

// Function to log voice interaction to main database
async function logVoiceToMainDatabase(sessionId: string, role: 'user' | 'assistant', content: string) {
  try {
    const apiUrl = process.env.pickleglass_API_URL || 'http://localhost:3002';
    
    // Log the voice message to the main database
    const logResponse = await fetch(`${apiUrl}/api/conversations/${sessionId}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        role,
        content,
        type: 'voice'
      })
    });

    if (!logResponse.ok) {
      console.error('Failed to log voice message to main database:', await logResponse.text());
      return null;
    } else {
      const result = await logResponse.json();
      console.log(`✅ Logged ${role} voice message to session ${sessionId}`);
      return result.messageId;
    }
  } catch (error) {
    console.error('Error logging voice to main database:', error);
    return null;
  }
}

// Function to get voice messages from main database
async function getVoiceMessagesFromDatabase(sessionId: string) {
  try {
    const apiUrl = process.env.pickleglass_API_URL || 'http://localhost:3002';
    
    // Get session details which includes messages
    const sessionResponse = await fetch(`${apiUrl}/api/conversations/${sessionId}`);
    
    if (!sessionResponse.ok) {
      console.error('Failed to get session details:', await sessionResponse.text());
      return [];
    }

    const sessionData = await sessionResponse.json();
    
    // Filter for voice messages only
    const voiceMessages = sessionData.ai_messages?.filter((msg: any) => 
      msg.type === 'voice' || msg.model === 'widget'
    ) || [];
    
    console.log(`📖 Retrieved ${voiceMessages.length} voice messages from session ${sessionId}`);
    return voiceMessages;
  } catch (error) {
    console.error('Error getting voice messages from database:', error);
    return [];
  }
}

export async function POST(req: Request) {
  try {
    const { roomName, participantId, message, role, type = 'voice' } = await req.json();
    
    console.log('📝 Voice conversation log received:', {
      roomName,
      participantId, 
      role,
      message: message.substring(0, 100) + '...',
      type
    });

    // Get or create widget session for voice conversations
    const sessionId = await getOrCreateWidgetSession();
    if (!sessionId) {
      console.warn('⚠️ Could not create widget voice session, continuing without logging');
      return Response.json({ 
        success: false, 
        error: 'Failed to create session' 
      }, { status: 500 });
    }

    // Log the voice message to the main database
    const messageId = await logVoiceToMainDatabase(sessionId, role, message);
    
    if (!messageId) {
      return Response.json({ 
        success: false, 
        error: 'Failed to log message to database' 
      }, { status: 500 });
    }
    
    console.log(`💬 Added ${role} voice message to session ${sessionId}. Message ID: ${messageId}`);
    
    return Response.json({ 
      success: true, 
      messageId,
      sessionId,
      totalMessages: 1 // We don't track total count in this simplified version
    });
    
  } catch (error) {
    console.error('❌ Error logging voice conversation:', error);
    return Response.json({ error: 'Failed to log conversation' }, { status: 500 });
  }
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const roomName = searchParams.get('roomName');
    const participantId = searchParams.get('participantId');
    
    if (!roomName || !participantId) {
      return Response.json({ error: 'Missing roomName or participantId' }, { status: 400 });
    }
    
    // For now, we'll use a simple approach: get the most recent widget session
    // In a more sophisticated implementation, we'd track session IDs per room/participant
    try {
      const apiUrl = process.env.pickleglass_API_URL || 'http://localhost:3002';
      
      // Get all sessions and find the most recent widget session
      const sessionsResponse = await fetch(`${apiUrl}/api/conversations`);
      
      if (!sessionsResponse.ok) {
        console.error('Failed to get sessions:', await sessionsResponse.text());
        return Response.json({ messages: [], totalMessages: 0 });
      }

      const sessions = await sessionsResponse.json();
      
      // Find the most recent widget session
      const widgetSessions = sessions.filter((session: any) => 
        session.type === 'widget' || session.name?.includes('Widget')
      );
      
      if (widgetSessions.length === 0) {
        console.log('No widget sessions found');
        return Response.json({ messages: [], totalMessages: 0 });
      }
      
      // Get the most recent widget session
      const latestSession = widgetSessions[widgetSessions.length - 1];
      const voiceMessages = await getVoiceMessagesFromDatabase(latestSession.id);
      
      console.log(`📖 Retrieved conversation for ${roomName}-${participantId}: ${voiceMessages.length} messages`);
      
      return Response.json({ 
        messages: voiceMessages,
        totalMessages: voiceMessages.length 
      });
      
    } catch (error) {
      console.error('Error retrieving voice messages:', error);
      return Response.json({ messages: [], totalMessages: 0 });
    }
    
  } catch (error) {
    console.error('❌ Error retrieving voice conversation:', error);
    return Response.json({ error: 'Failed to retrieve conversation' }, { status: 500 });
  }
} 