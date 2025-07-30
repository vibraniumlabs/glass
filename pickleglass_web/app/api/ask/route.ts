import { openai } from '@ai-sdk/openai';
import { streamText } from 'ai';
import OpenAI from 'openai';

export const maxDuration = 30;
export const runtime = 'edge';

// Direct OpenAI client for testing
const directOpenAI = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Function to log interaction to main database via IPC
async function logToMainDatabase(sessionId: string, role: 'user' | 'assistant', content: string) {
  try {
    // Get the API URL from environment
    const apiUrl = process.env.pickleglass_API_URL || 'http://localhost:3002';
    
    // Log the message to the main database
    const logResponse = await fetch(`${apiUrl}/api/conversations/${sessionId}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        role,
        content,
        type: 'text'
      })
    });

    if (!logResponse.ok) {
      console.error('Failed to log message to main database:', await logResponse.text());
    } else {
      console.log(`✅ Logged ${role} message to session ${sessionId}`);
    }
  } catch (error) {
    console.error('Error logging to main database:', error);
  }
}

// Function to create or get session for widget interactions
async function getOrCreateWidgetSession() {
  try {
    const apiUrl = process.env.pickleglass_API_URL || 'http://localhost:3002';
    
    // Create a new session for widget interactions
    const sessionResponse = await fetch(`${apiUrl}/api/conversations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        type: 'widget',
        name: 'Glass Widget Session'
      })
    });

    if (!sessionResponse.ok) {
      console.error('Failed to create widget session:', await sessionResponse.text());
      return null;
    }

    const sessionData = await sessionResponse.json();
    console.log('✅ Created widget session:', sessionData.id);
    return sessionData.id;
  } catch (error) {
    console.error('Error creating widget session:', error);
    return null;
  }
}

function getSystemPrompt(context: string): string {
    const contextInjection = `The user is currently working on the following incident. This information is critical context for their request.
---
INCIDENT CONTENT:
${context}
---
`;
    return `${contextInjection} You are a helpful AI assistant with vision capabilities for incident response. Your primary goal is to assist the user by identifying and clearly stating the *next actionable steps* or 'action items' related to the incident. These action items should be concise, directly guide the user, and be presented as clear directives.

When an action item involves investigating or interacting with a specific system (e.g., a monitoring tool, a dashboard like Sentry, Grafana, etc.), explicitly name that system and, if possible, suggest where to look within it. For example, if the incident points to an error in Sentry, an action item might be: 'Investigate the \`TRPCClientError\` in Sentry. Look for the incident with ID 1007 or the one with the most events.'

Anticipate common incident response workflows. Based on the provided incident context, suggest logical next steps even if not explicitly asked, framing them as clear action items. Your responses should be structured to provide immediate, actionable value.

IMPORTANT: When you receive a screenshot (image), you MUST analyze and describe what you can see in the visual content. Do not ask for screenshots if one is already provided - instead, focus on analyzing the visual elements, UI components, charts, logs, error messages, or any other content visible in the image.

Be specific about what you observe visually and provide actionable insights based on both the incident context and the visual information. Focus on error messages, data, and actionable content - do not describe UI elements like logos, columns, layouts, or interface components.

Maintain a helpful, clear, and directive tone. Avoid ambiguity. If you need more information to formulate an action item, ask a precise clarifying question.

Keep your responses to 2 sentences maximum. Be direct and actionable.

Your role is to assist the user by providing clear action items and guidance for incident response. Be concise, accurate, and actionable.`;
}

export async function POST(req: Request) {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, baggage, x-vercel-id, x-vercel-trace, sentry-trace, x-sentry-trace',
      },
    });
  }

  const { messages, context, screenshot } = await req.json();

  console.log('🔍 API Debug:', {
    hasScreenshot: !!screenshot,
    screenshotLength: screenshot ? screenshot.length : 0,
    messagesCount: messages.length
  });

  // Create or get session for widget interactions
  const sessionId = await getOrCreateWidgetSession();
  if (!sessionId) {
    console.warn('⚠️ Could not create widget session, continuing without logging');
  }

  // Log the user message to the main database
  if (sessionId && messages.length > 0) {
    const lastUserMessage = messages[messages.length - 1];
    if (lastUserMessage.role === 'user') {
      await logToMainDatabase(sessionId, 'user', lastUserMessage.content);
    }
  }

  const systemPrompt = getSystemPrompt(context);
  
  // Build the messages array with system prompt
  const fullMessages = [
    { role: 'system', content: systemPrompt },
    ...messages,
  ];

  // If we have a valid screenshot, enhance the last user message with vision capabilities
  const isValidScreenshot = screenshot && 
    typeof screenshot === 'string' && 
    screenshot.length > 100 && 
    (screenshot.startsWith('data:image/') || screenshot.startsWith('http'));
    
  if (isValidScreenshot && fullMessages.length > 1) {
    const lastMessage = fullMessages[fullMessages.length - 1];
    
    if (lastMessage.role === 'user') {
      console.log('🖼️ Adding screenshot to message for user:', lastMessage.content);
      
      // Convert text content to multimodal format
      lastMessage.content = [
        { type: 'text', text: lastMessage.content },
        {
          type: 'image_url',
          image_url: { 
            url: screenshot,
            detail: 'high' // Use high detail for better analysis
          }
        }
      ];
      
      console.log('✅ Multimodal message created with screenshot');
    }
  } else {
    console.log('⚠️ No valid screenshot provided or no user message to enhance');
    console.log('📸 Screenshot validation:', {
      hasScreenshot: !!screenshot,
      isString: typeof screenshot === 'string',
      length: screenshot?.length || 0,
      startsWithData: screenshot?.startsWith?.('data:image/'),
      startsWithHttp: screenshot?.startsWith?.('http')
    });
  }

  try {
    console.log('📤 Sending to OpenAI with model: gpt-4o');
    console.log('📋 Final messages structure:', JSON.stringify(fullMessages, null, 2));
    
    // If valid screenshot is provided, try direct OpenAI API first
    if (isValidScreenshot) {
      console.log('🔬 Testing direct OpenAI Vision API...');
      
      try {
        const directResponse = await directOpenAI.chat.completions.create({
          model: 'gpt-4o',
          messages: [
            {
              role: 'system',
              content: systemPrompt
            },
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: fullMessages[fullMessages.length - 1].content[0].text
                },
                {
                  type: 'image_url',
                  image_url: {
                    url: screenshot,
                    detail: 'high'
                  }
                }
              ]
            }
          ],
          max_tokens: 1000
        });
        
        console.log('✅ Direct OpenAI Vision API worked!');
        
        // Get the response text
        const responseText = directResponse.choices[0].message.content || 'No response received';
        
        // Log the assistant response to the main database
        if (sessionId) {
          await logToMainDatabase(sessionId, 'assistant', responseText);
        }
        
        return new Response(responseText, {
          headers: { 
            'Content-Type': 'text/plain',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization, baggage, x-vercel-id, x-vercel-trace, sentry-trace, x-sentry-trace',
          }
        });
        
      } catch (directError) {
        console.error('❌ Direct OpenAI Vision API failed:', directError);
        console.log('🔄 Falling back to AI SDK...');
      }
    }
    
    const result = await streamText({
      model: openai('gpt-4o'), // Use GPT-4o for vision capabilities
      messages: fullMessages,
    });

    // Create a custom response that logs the assistant message
    const originalResponse = result.toDataStreamResponse();
    
    // We'll need to capture the full response to log it
    // For now, we'll create a simple response and log it later
    const response = new Response(originalResponse.body, {
      headers: {
        ...Object.fromEntries(originalResponse.headers.entries()),
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, baggage, x-vercel-id, x-vercel-trace, sentry-trace, x-sentry-trace',
      }
    });

    // Note: For streaming responses, we'll need to handle the logging differently
    // This is a simplified approach - in a full implementation, we'd need to
    // capture the full response and log it after completion
    
    return response;
  } catch (error) {
    console.error('❌ Vision API error:', error);
    
    // Fallback to text-only if vision fails
    console.log('🔄 Falling back to text-only...');
    
    const textOnlyMessages = fullMessages.map(msg => ({
      ...msg,
      content: typeof msg.content === 'string' 
        ? msg.content 
        : (msg.content as any[]).find((c: any) => c.type === 'text')?.text || 'Please help me with the incident.'
    }));

    const fallbackResult = await streamText({
      model: openai('gpt-4o-mini'), // Fallback to cheaper model
      messages: textOnlyMessages,
    });

    const fallbackResponse = fallbackResult.toDataStreamResponse();
    // Add CORS headers to fallback response
    fallbackResponse.headers.set('Access-Control-Allow-Origin', '*');
    fallbackResponse.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    fallbackResponse.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, baggage, x-vercel-id, x-vercel-trace, sentry-trace, x-sentry-trace');
    return fallbackResponse;
  }
} 