import OpenAI from 'openai';

export interface StreamChunk {
  content: string;
}

export interface LLMClient {
  streamChat(systemPrompt: string, userMessage: string): AsyncGenerator<StreamChunk>;
  createEmbedding(text: string): Promise<number[]>;
}

class OpenAIClient implements LLMClient {
  private client: OpenAI;
  private model: string;
  private maxTokens: number;

  constructor(apiKey: string, model = 'gpt-4o-mini', maxTokens = 1000) {
    this.client = new OpenAI({ apiKey });
    this.model = model;
    this.maxTokens = maxTokens;
  }

  async *streamChat(systemPrompt: string, userMessage: string): AsyncGenerator<StreamChunk> {
    const completion = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      temperature: 0.7,
      max_tokens: this.maxTokens,
      stream: true,
    });

    for await (const chunk of completion) {
      const content = chunk.choices[0]?.delta?.content || '';
      if (content) yield { content };
    }
  }

  async createEmbedding(text: string): Promise<number[]> {
    const response = await this.client.embeddings.create({
      model: 'text-embedding-3-small',
      input: text,
    });
    return response.data[0].embedding;
  }
}

export function createLLMClient(): LLMClient {
  const openaiApiKey = process.env.OPENAI_API_KEY;
  if (!openaiApiKey) throw new Error('OPENAI_API_KEY is required');

  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
  const maxTokens = parseInt(process.env.OPENAI_MAX_TOKENS || '1000', 10);
  return new OpenAIClient(openaiApiKey, model, maxTokens);
}
