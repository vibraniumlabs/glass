export const maxDuration = 30;
export const runtime = 'edge';

// In-memory storage for the current screenshot
let currentScreenshot: string | null = null;
let lastUpdated: number = 0;

export async function POST(req: Request) {
  try {
    const { screenshot } = await req.json();
    
    if (!screenshot) {
      return Response.json({ error: 'No screenshot provided' }, { status: 400 });
    }
    
    currentScreenshot = screenshot;
    lastUpdated = Date.now();
    
    console.log(`📸 Screenshot updated: ${screenshot.length} bytes at ${new Date().toLocaleTimeString()}`);
    
    return Response.json({ 
      success: true, 
      timestamp: lastUpdated 
    });
    
  } catch (error) {
    console.error('❌ Error storing screenshot:', error);
    return Response.json({ error: 'Failed to store screenshot' }, { status: 500 });
  }
}

export async function GET(req: Request) {
  try {
    if (!currentScreenshot) {
      return Response.json({ 
        screenshot: null, 
        timestamp: null,
        message: 'No screenshot available'
      });
    }
    
    // Check if screenshot is older than 30 seconds
    const age = Date.now() - lastUpdated;
    if (age > 30000) {
      console.log(`⚠️ Screenshot is ${Math.round(age/1000)}s old, may be stale`);
    }
    
    console.log(`📸 Screenshot retrieved: ${currentScreenshot.length} bytes (${Math.round(age/1000)}s old)`);
    
    return Response.json({ 
      screenshot: currentScreenshot, 
      timestamp: lastUpdated,
      age: age
    });
    
  } catch (error) {
    console.error('❌ Error retrieving screenshot:', error);
    return Response.json({ error: 'Failed to retrieve screenshot' }, { status: 500 });
  }
} 