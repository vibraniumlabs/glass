import { OpenAIProvider, createStreamingLLM as createOpenAIStreamingLLM } from './providers/openai';

interface ModelOption {
  id: string;
  name: string;
}

interface Provider {
  name: string;
  handler: () => any;
  llmModels: ModelOption[];
  sttModels: ModelOption[];
  ttsModels: ModelOption[];
}

const PROVIDERS: { [key: string]: Provider } = {
  'openai': {
      name: 'OpenAI',
      handler: () => ({ createStreamingLLM: createOpenAIStreamingLLM, OpenAIProvider }),
      llmModels: [
          { id: 'gpt-4o', name: 'GPT-4o (Latest)' },
          { id: 'gpt-4o-mini', name: 'GPT-4o Mini (Fast)' },
      ],
      sttModels: [],
      ttsModels: [],
  },
  // Other providers removed for simplicity
};

function sanitizeModelId(model: string): string {
  return model.replace(/-glass$/, '');
}

export function createStreamingLLM(provider: string, opts: any) {
  if (provider === 'openai-glass') provider = 'openai';

  const handler = PROVIDERS[provider]?.handler();
  if (!handler?.createStreamingLLM) {
      throw new Error(`Streaming LLM not supported for provider: ${provider}`);
  }
  if (opts && opts.model) {
    opts = { ...opts, model: sanitizeModelId(opts.model) };
  }
  return handler.createStreamingLLM(opts);
}