export const maxDuration = 30;
export const runtime = 'edge';

// In-memory storage for voice conversations (in production, use a database)
const conversations = new Map<string, Array<{
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  type: 'voice' | 'text';
}>>();

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

    // Create conversation key
    const conversationKey = `${roomName}-${participantId}`;
    
    // Get existing conversation or create new one
    if (!conversations.has(conversationKey)) {
      conversations.set(conversationKey, []);
    }
    
    const conversation = conversations.get(conversationKey)!;
    
    // Add new message
    const newMessage = {
      id: Date.now().toString(),
      role,
      content: message,
      timestamp: Date.now(),
      type
    };
    
    conversation.push(newMessage);
    
    // Keep only last 50 messages to prevent memory issues
    if (conversation.length > 50) {
      conversation.splice(0, conversation.length - 50);
    }
    
    console.log(`💬 Added ${role} message to conversation ${conversationKey}. Total messages: ${conversation.length}`);
    
    return Response.json({ 
      success: true, 
      messageId: newMessage.id,
      totalMessages: conversation.length 
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
    
    const conversationKey = `${roomName}-${participantId}`;
    const conversation = conversations.get(conversationKey) || [];
    
    console.log(`📖 Retrieved conversation for ${conversationKey}: ${conversation.length} messages`);
    
    return Response.json({ 
      messages: conversation,
      totalMessages: conversation.length 
    });
    
  } catch (error) {
    console.error('❌ Error retrieving voice conversation:', error);
    return Response.json({ error: 'Failed to retrieve conversation' }, { status: 500 });
  }
} 