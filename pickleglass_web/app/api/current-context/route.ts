export const maxDuration = 30;
export const runtime = 'edge';

// In-memory storage for the current incident context
let currentContext: string = '';

export async function POST(req: Request) {
  try {
    const { context } = await req.json();

    if (!context) {
      return Response.json({ error: 'No context provided' }, { status: 400 });
    }

    currentContext = context;

    console.log(`📋 Context updated: ${context.length} characters at ${new Date().toLocaleTimeString()}`);

    return Response.json({
      success: true,
      timestamp: Date.now()
    });

  } catch (error) {
    console.error('❌ Error storing context:', error);
    return Response.json({ error: 'Failed to store context' }, { status: 500 });
  }
}

export async function GET(req: Request) {
  try {
    return Response.json({
      context: currentContext,
      timestamp: Date.now()
    });
  } catch (error) {
    console.error('❌ Error retrieving context:', error);
    return Response.json({ error: 'Failed to retrieve context' }, { status: 500 });
  }
} 