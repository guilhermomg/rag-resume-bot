import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';

function getEnvVar(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const supabaseUrl = getEnvVar('SUPABASE_URL');
const supabaseKey = getEnvVar('SUPABASE_SERVICE_KEY');
const supabase = createClient(supabaseUrl, supabaseKey);

const openaiApiKey = getEnvVar('OPENAI_API_KEY');
const openai = new OpenAI({ apiKey: openaiApiKey });

interface SupabaseDocument {
  content: string;
  metadata?: Record<string, unknown>;
  similarity?: number;
}

export async function POST(req: NextRequest) {
  try {
    const { message } = await req.json();

    if (!message) {
      return NextResponse.json({ error: 'Message is required' }, { status: 400 });
    }

    // Step 1: Generate embedding for the user's question
    const embeddingResponse = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: message,
    });

    const queryEmbedding = embeddingResponse.data[0].embedding;

    // Step 2: Search for relevant documents
    // Always search at the lowest threshold to ensure comprehensive coverage
    const { data: docs, error: searchError } = await supabase.rpc('match_documents', {
      query_embedding: queryEmbedding,
      match_threshold: 0.10,  // Use lowest threshold to capture all potentially relevant docs
      match_count: 30,         // Get more results for better filtering
    });

    if (searchError) {
      console.error('Search error:', searchError);
      return NextResponse.json({ error: 'Search failed' }, { status: 500 });
    }

    console.log('Query:', message);
    console.log('Final documents returned:', docs.length);
    if (docs && docs.length > 0) {
      docs.slice(0, 5).forEach((doc: SupabaseDocument, idx: number) => {
        console.log(`Doc ${idx} - Similarity: ${doc.similarity}, Content: ${doc.content.substring(0, 80)}...`);
      });
    }

    // Extract year from document content
    const extractFirstYear = (text: string): number => {
      // Try multiple date patterns
      const patterns = [
        /\[EMPLOYMENT: (\d{4})-/,  // [EMPLOYMENT: YYYY-YYYY]
        /\*([A-Za-z]+ \d{4})/,     // *Jan 2021
        /\((\d{4})\)/,             // (YYYY)
        /(\d{4})/                  // Any YYYY
      ];
      
      for (let patternIndex = 0; patternIndex < patterns.length; patternIndex++) {
        const match = text.match(patterns[patternIndex]);
        if (match) {
          // For date format pattern (index 1), extract year from "Month YYYY"
          const yearStr = patternIndex === 1 ? match[1].split(' ')[1] : match[1];
          const year = parseInt(yearStr);
          if (!isNaN(year) && year > 1900 && year < 2100) {
            return year;
          }
        }
      }
      return 9999; // No date found, push to end
    };

    // Pre-compute years for all documents to avoid redundant parsing
    const docsWithYears: Array<{ doc: SupabaseDocument; year: number }> = docs.map((doc: SupabaseDocument) => ({
      doc,
      year: extractFirstYear(doc.content)
    }));

    // Sort by pre-computed years (earliest first)
    const sortedDocs = docsWithYears
      .sort((a: { doc: SupabaseDocument; year: number }, b: { doc: SupabaseDocument; year: number }) => a.year - b.year)
      .map((item: { doc: SupabaseDocument; year: number }) => item.doc);

    // Step 3: Combine retrieved documents into context
    const context = sortedDocs?.map((doc: SupabaseDocument) => doc.content).join('\n\n') || 'No relevant information found.';

    // Step 4: Create the system prompt with context
    const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    const basePrompt = process.env.SYSTEM_PROMPT || 'You are a helpful AI assistant.';
    const systemPrompt = `${basePrompt}\n\nToday's date is: ${today}\n\nContext:\n${context}`;

    // Step 5: Generate response with streaming
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: message },
      ],
      temperature: 0.7,
      max_tokens: 500,
      stream: true,
    });

    // Step 6: Create a streaming response
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of completion) {
            const content = chunk.choices[0]?.delta?.content || '';
            if (content) {
              const data = `data: ${JSON.stringify({ content })}\n\n`;
              controller.enqueue(encoder.encode(data));
            }
          }
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
        } catch (error) {
          controller.error(error);
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });

  } catch (error) {
    console.error('API Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
