import { config as loadEnv } from 'dotenv';
import OpenAI from 'openai';
import * as fs from 'fs';
import * as path from 'path';
import postgres from 'postgres';

loadEnv({ path: path.resolve(process.cwd(), '.env.local') });
loadEnv({ path: path.resolve(process.cwd(), '.env'), override: false });

const databaseUrl = process.env.DATABASE_URL!;
const openaiKey = process.env.OPENAI_API_KEY!;

if (!databaseUrl || !openaiKey) {
  throw new Error('Missing environment variables: DATABASE_URL or OPENAI_API_KEY');
}

const sql = postgres(databaseUrl, { ssl: 'require' });
const openai = new OpenAI({ apiKey: openaiKey });

const RATE_LIMIT_DELAY = parseInt(process.env.OPENAI_RATE_LIMIT_DELAY || '100');
const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY = 1000;

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function createEmbeddingWithRetry(text: string, attempt = 1): Promise<number[]> {
  try {
    const response = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: text,
    });
    return response.data[0].embedding;
  } catch (error: unknown) {
    const apiError = error as { status?: number };
    if (apiError.status === 429 && attempt < MAX_RETRIES) {
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
  // Clear existing documents
  await sql`DELETE FROM documents`;
  console.log('Cleared existing documents.');

  for (const file of files) {
    const content = fs.readFileSync(path.join(dataDir, file), 'utf-8');
    const chunks = chunkText(content, 800);

    for (let i = 0; i < chunks.length; i++) {
      const embedding = await createEmbeddingWithRetry(chunks[i]);
      const embeddingLiteral = `[${embedding.join(',')}]`;
      const metadata = { source: file, chunk: i, title: path.basename(file, path.extname(file)) };

      await sql`
        INSERT INTO documents (content, metadata, embedding)
        VALUES (${chunks[i]}, ${sql.json(metadata)}, ${embeddingLiteral}::vector)
      `;

      console.log(`Ingested chunk ${i}/${chunks.length - 1} from ${file}`);

      if (i < chunks.length - 1) await delay(RATE_LIMIT_DELAY);
    }
  }

  await sql.end();
  console.log('Ingestion complete!');
}

function chunkText(text: string, maxChars: number): string[] {
  const sections = text.split(/(?=^###\s)/gm);
  const chunks: string[] = [];
  let currentChunk = '';

  for (const section of sections) {
    const trimmedSection = section.trim();
    if (!trimmedSection) continue;

    if (trimmedSection.length < 50 || !trimmedSection.includes('\n')) {
      console.warn(
        'Skipping short/one-line section during chunking:',
        `(length=${trimmedSection.length})`,
        `"${trimmedSection.slice(0, 100)}${trimmedSection.length > 100 ? '...' : ''}"`
      );
      continue;
    }

    const dateMatch = trimmedSection.match(/\*([A-Za-z]+ \d{4})\s*-\s*([A-Za-z]+ \d{4}|Present)\*/);
    let enrichedSection = trimmedSection;

    if (dateMatch) {
      const startYear = dateMatch[1].split(' ')[1];
      const endYear = dateMatch[2] === 'Present' ? new Date().getFullYear().toString() : dateMatch[2].split(' ')[1];
      enrichedSection = `[EMPLOYMENT: ${startYear}-${endYear}]\n\n${trimmedSection}`;
    }

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
