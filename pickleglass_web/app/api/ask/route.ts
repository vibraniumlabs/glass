import { openai } from '@ai-sdk/openai';
import { streamText } from 'ai';

// Allow streaming responses up to 30 seconds
export const maxDuration = 30;

// IMPORTANT! Set the runtime to edge
export const runtime = 'edge';

function getSystemPrompt(context: string): string {
    const contextInjection = `The user is currently working on the following incident. This information is critical context for their request.
---
INCIDENT CONTENT:
${context}
---
`;
    return `${contextInjection} You are a helpful AI assistant. Your role is to assist the user in triaging and understanding the provided incident context. Be concise and accurate.`;
}

export async function POST(req: Request) {
  const { messages, context } = await req.json();

  // Add the system prompt to the messages array
  const fullMessages = [
    { role: 'system', content: getSystemPrompt(context) },
    ...messages,
  ];

  const result = await streamText({
    model: openai('gpt-4o-mini'),
    messages: fullMessages,
  });

  return result.toDataStreamResponse();
} 