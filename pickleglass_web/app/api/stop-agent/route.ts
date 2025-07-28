import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'child_process';
import path from 'path';

export async function POST(req: NextRequest) {
  try {
    console.log('🛑 Stopping LiveKit agent...');
    
    // Find and kill the agent process
    const agentProcess = spawn('pkill', ['-f', 'livekit-agent.cjs'], {
      stdio: 'pipe'
    });

    return new Promise((resolve) => {
      agentProcess.on('close', (code) => {
        if (code === 0) {
          console.log('✅ LiveKit agent stopped successfully');
          resolve(NextResponse.json({ success: true, message: 'Agent stopped' }));
        } else {
          console.log('⚠️ No agent process found to stop');
          resolve(NextResponse.json({ success: true, message: 'No agent running' }));
        }
      });

      agentProcess.on('error', (error) => {
        console.error('❌ Error stopping agent:', error);
        resolve(NextResponse.json({ success: false, error: error.message }, { status: 500 }));
      });
    });

  } catch (error) {
    console.error('❌ Failed to stop agent:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to stop agent' },
      { status: 500 }
    );
  }
} 