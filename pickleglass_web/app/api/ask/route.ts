import { openai } from '@ai-sdk/openai';
import { streamText } from 'ai';
import OpenAI from 'openai';

export const maxDuration = 30;
export const runtime = 'edge';

// Direct OpenAI client for testing
const directOpenAI = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

function getSystemPrompt(context: string): string {
    const contextInjection = `The user is currently working on the following incident. This information is critical context for their request.
---
INCIDENT CONTENT:
${context}
---
`;
    return `${contextInjection} You are a helpful AI assistant with vision capabilities. Your role is to assist the user in triaging and understanding the provided incident context. 

IMPORTANT: When you receive a screenshot (image), you MUST analyze and describe what you can see in the visual content. Do not ask for screenshots if one is already provided - instead, focus on analyzing the visual elements, UI components, charts, logs, error messages, or any other content visible in the image.

Be specific about what you observe visually and provide actionable insights based on both the incident context and the visual information. Reference specific visual elements like colors, text, layouts, charts, graphs, error messages, or interface components that you can see.`;
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
        
        // Return the direct response as a simple text response
        const responseText = directResponse.choices[0].message.content || 'No response received';
        
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

    const response = result.toDataStreamResponse();
    // Add CORS headers to streaming response
    response.headers.set('Access-Control-Allow-Origin', '*');
    response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, baggage, x-vercel-id, x-vercel-trace, sentry-trace, x-sentry-trace');
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