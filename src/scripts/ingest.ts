import { createClient } from '@supabase/supabase-js';
import { config as loadEnv } from 'dotenv';
import OpenAI from 'openai';
import * as fs from 'fs';
import * as path from 'path';

loadEnv({ path: path.resolve(process.cwd(), '.env.local') });
loadEnv({ path: path.resolve(process.cwd(), '.env'), override: false });

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY!;
const openaiKey = process.env.OPENAI_API_KEY!;

if (!supabaseUrl || !supabaseKey || !openaiKey) {
  throw new Error('Missing environment variables: SUPABASE_URL, SUPABASE_SERVICE_KEY, or OPENAI_API_KEY');
}

const supabase = createClient(supabaseUrl, supabaseKey);
const openai = new OpenAI({ apiKey: openaiKey });

const dataDir = path.join(process.cwd(), 'data');
const files = fs.readdirSync(dataDir).filter(f => f.endsWith('.md') || f.endsWith('.txt'));

async function ingest() {
  // clear existing
  await supabase.from('documents').delete().neq('id', 0);

  for (const file of files) {
    const content = fs.readFileSync(path.join(dataDir, file), 'utf-8');
    
    // Simple chunking: split into ~800 char chunks
    const chunks = chunkText(content, 800);
    
    for (let i = 0; i < chunks.length; i++) {
      const embeddingResponse = await openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: chunks[i],
      });

      const { error } = await supabase
        .from('documents')
        .insert({
          content: chunks[i],
          metadata: {
            source: file,
            chunk: i,
            title: path.basename(file, path.extname(file)),
          },
          embedding: embeddingResponse.data[0].embedding,
        });

      if (error) console.error('Insert error:', error);
      else console.log(`Ingested chunk ${i} from ${file}`);
    }
  }
  console.log('Ingestion complete!');
}

function chunkText(text: string, maxChars: number): string[] {
  const sentences = text.split(/(?<=[.!?])\s+/);
  const chunks: string[] = [];
  let currentChunk = '';

  for (const sentence of sentences) {
    if ((currentChunk + sentence).length > maxChars && currentChunk) {
      chunks.push(currentChunk.trim());
      currentChunk = sentence;
    } else {
      currentChunk += sentence + ' ';
    }
  }
  if (currentChunk) chunks.push(currentChunk.trim());
  return chunks;
}

ingest().catch(console.error);
