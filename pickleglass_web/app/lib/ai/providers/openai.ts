import OpenAI from 'openai';
import { Stream } from 'openai/streaming';

interface OpenAIProviderOptions {
  apiKey: string;
  usePortkey?: boolean;
  portkeyVirtualKey?: string;
}

export class OpenAIProvider {
  private openai: OpenAI;
  private usePortkey: boolean;

  constructor(options: OpenAIProviderOptions) {
    const { apiKey, usePortkey = false, portkeyVirtualKey } = options;

    if (!apiKey) {
      throw new Error('OpenAI API key is required');
    }

    this.usePortkey = usePortkey;

    let baseURL = 'https://api.openai.com/v1';
    let effectiveApiKey = apiKey;
    const headers: { [key: string]: string } = {};

    if (this.usePortkey) {
      baseURL = 'https://api.portkey.ai/v1';
      headers['x-portkey-api-key'] = process.env.PORTKEY_API_KEY || ''; // Portkey's own API key
      headers['x-portkey-virtual-key'] = portkeyVirtualKey || '';
      effectiveApiKey = 'dummy'; // Not used by Portkey, but the SDK requires a value
    }

    this.openai = new OpenAI({
      apiKey: effectiveApiKey,
      baseURL,
      defaultHeaders: headers,
    });
  }

  createStreamingLLM(opts: { model: string; temperature: number; maxTokens: number; }) {
    const { model, temperature, maxTokens } = opts;
    return {
      streamChat: (messages: any[]): Promise<Stream<OpenAI.Chat.Completions.ChatCompletionChunk>> => {
        return this.openai.chat.completions.create({
          model,
          messages,
          temperature,
          max_tokens: maxTokens,
          stream: true,
        });
      },
    };
  }
}

export function createStreamingLLM(opts: OpenAIProviderOptions & { model: string; temperature: number; maxTokens: number; }) {
  const provider = new OpenAIProvider(opts);
  return provider.createStreamingLLM(opts);
} 