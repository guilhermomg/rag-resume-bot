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

// Rate limiting configuration
const RATE_LIMIT_DELAY = parseInt(process.env.OPENAI_RATE_LIMIT_DELAY || '100'); // ms between requests
const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY = 1000; // ms

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function createEmbeddingWithRetry(text: string, attempt = 1): Promise<number[]> {
  try {
    const response = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: text,
    });
    return response.data[0].embedding;
  } catch (error: unknown) {
    const apiError = error as { status?: number; message?: string };
    if (apiError.status === 429 && attempt < MAX_RETRIES) {
      // Rate limit error - exponential backoff
      const retryDelay = INITIAL_RETRY_DELAY * Math.pow(2, attempt - 1);
      console.warn(`Rate limited. Retrying in ${retryDelay}ms (attempt ${attempt}/${MAX_RETRIES})`);
      await delay(retryDelay);
      return createEmbeddingWithRetry(text, attempt + 1);
    }
    throw error;
  }
}

const dataDir = path.join(process.cwd(), 'data');

if (!fs.existsSync(dataDir)) {
  console.error(`Data directory not found: ${dataDir}`);
  process.exit(1);
}
const files = fs.readdirSync(dataDir).filter(f => f.endsWith('.md') || f.endsWith('.txt'));

async function ingest() {
  // clear existing
  await supabase.from('documents').delete();

  for (const file of files) {
    const content = fs.readFileSync(path.join(dataDir, file), 'utf-8');
    
    // Simple chunking: split into ~800 char chunks
    const chunks = chunkText(content, 800);
    
    for (let i = 0; i < chunks.length; i++) {
      const embedding = await createEmbeddingWithRetry(chunks[i]);

      const { error } = await supabase
        .from('documents')
        .insert({
          content: chunks[i],
          metadata: {
            source: file,
            chunk: i,
            title: path.basename(file, path.extname(file)),
          },
          embedding: embedding,
        });

      if (error) {
        console.error('Insert error for file', file, 'chunk', i, ':', error);
        throw error;
      } else {
        console.log(`Ingested chunk ${i}/${chunks.length - 1} from ${file}`);
      }

      // Rate limiting: delay between requests
      if (i < chunks.length - 1) {
        await delay(RATE_LIMIT_DELAY);
      }
    }
  }
  console.log('Ingestion complete!');
}

function chunkText(text: string, maxChars: number): string[] {
  // Split by markdown headers (###) to keep Q&A pairs together
  const sections = text.split(/(?=^###\s)/gm);
  const chunks: string[] = [];
  let currentChunk = '';

  for (const section of sections) {
    const trimmedSection = section.trim();
    if (!trimmedSection) continue;
    
    // Skip title-only sections (lines that don't have substantial content)
    if (trimmedSection.length < 50 || !trimmedSection.includes('\n')) {
      console.warn(
        'Skipping short/one-line section during chunking:',
        `(length=${trimmedSection.length})`,
        `"${trimmedSection.slice(0, 100)}${trimmedSection.length > 100 ? '...' : ''}"`
      );
      continue;
    }

    // Extract date range if this looks like a job entry
    // Format: ### Job Title\n**Company** | Position | *Jan 2021 - Jul 2022*
    const dateMatch = trimmedSection.match(/\*([A-Za-z]+ \d{4})\s*-\s*([A-Za-z]+ \d{4}|Present)\*/);
    let enrichedSection = trimmedSection;
    
    if (dateMatch) {
      const startDate = dateMatch[1];
      const endDate = dateMatch[2];
      // Extract year from dates for temporal marker
      const startYear = startDate.split(' ')[1];
      const endYear = endDate === 'Present' ? new Date().getFullYear().toString() : endDate.split(' ')[1];
      enrichedSection = `[EMPLOYMENT: ${startYear}-${endYear}]\n\n${trimmedSection}`;
    }

    // If adding this section would exceed max and we have content, push current chunk
    if (currentChunk && (currentChunk + '\n\n' + enrichedSection).length > maxChars) {
      chunks.push(currentChunk.trim());
      currentChunk = enrichedSection;
    } else {
      currentChunk += (currentChunk ? '\n\n' : '') + enrichedSection;
    }
  }
  
  if (currentChunk) chunks.push(currentChunk.trim());
  return chunks;
}

ingest().catch(console.error);
