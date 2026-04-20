import { NextRequest, NextResponse } from 'next/server';
import { createLLMClient } from '@/lib/llm-provider';
import sql from '@/lib/db';

const allowedOrigin = process.env.ALLOWED_ORIGIN || 'http://localhost:4321';

function getCorsHeaders(requestOrigin: string | null) {
  const origin = requestOrigin && requestOrigin === allowedOrigin ? requestOrigin : allowedOrigin;
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  };
}

const similarityThreshold = parseFloat(process.env.PRECISION_THRESHOLD || '0.20');
const maxContextDocs = parseInt(process.env.MAX_CONTEXT_DOCS || '15', 10);

interface Document {
  content: string;
  metadata?: Record<string, unknown>;
  similarity?: number;
}

export async function POST(req: NextRequest) {
  const corsHeaders = getCorsHeaders(req.headers.get('origin'));
  try {
    const { message } = await req.json();

    if (!message) {
      return NextResponse.json({ error: 'Message is required' }, { status: 400, headers: corsHeaders });
    }

    const llmClient = createLLMClient();

    // Step 1: Generate embedding for the user's question
    const queryEmbedding = await llmClient.createEmbedding(message);
    const embeddingLiteral = `[${queryEmbedding.join(',')}]`;

    // Step 2: Search for relevant documents via pgvector
    const docs = await sql<Document[]>`
      SELECT content, metadata, 1 - (embedding <=> ${embeddingLiteral}::vector) AS similarity
      FROM documents
      WHERE 1 - (embedding <=> ${embeddingLiteral}::vector) > 0.10
      ORDER BY embedding <=> ${embeddingLiteral}::vector
      LIMIT 30
    `;

    console.log('Query:', message);
    console.log('Documents found:', docs.length);
    if (docs.length > 0) {
      docs.slice(0, 5).forEach((doc, idx) => {
        console.log(`Doc ${idx} - Similarity: ${doc.similarity}, Content: ${doc.content.substring(0, 80)}...`);
      });
    }

    // Extract year from document content for chronological sorting
    const extractFirstYear = (text: string): number => {
      const patterns = [
        /\[EMPLOYMENT: (\d{4})-/,
        /\*([A-Za-z]+ \d{4})/,
        /\((\d{4})\)/,
        /(\d{4})/,
      ];
      for (let i = 0; i < patterns.length; i++) {
        const match = text.match(patterns[i]);
        if (match) {
          const yearStr = i === 1 ? match[1].split(' ')[1] : match[1];
          const year = parseInt(yearStr);
          if (!isNaN(year) && year > 1900 && year < 2100) return year;
        }
      }
      return 9999;
    };

    const sortedDocs = docs
      .map(doc => ({ doc, year: extractFirstYear(doc.content) }))
      .sort((a, b) => a.year - b.year)
      .map(item => item.doc);

    const filteredDocs = sortedDocs
      .filter(doc => (doc.similarity ?? 0) >= similarityThreshold)
      .slice(0, maxContextDocs);

    console.log(`After precision filter (threshold: ${similarityThreshold}): ${filteredDocs.length} documents`);

    // Step 3: Build context and system prompt
    const context = filteredDocs.map(doc => doc.content).join('\n\n') || 'No relevant information found.';
    const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    const basePrompt = process.env.SYSTEM_PROMPT || 'You are a helpful AI assistant.';
    const systemPrompt = `${basePrompt}\n\nToday's date is: ${today}\n\nContext:\n${context}`;

    // Step 4: Stream response
    const stream = llmClient.streamChat(systemPrompt, message);
    const encoder = new TextEncoder();
    const readableStream = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of stream) {
            if (chunk.content) {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: chunk.content })}\n\n`));
            }
          }
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
        } catch (error) {
          controller.error(error);
        }
      },
    });

    return new Response(readableStream, {
      headers: {
        ...corsHeaders,
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });

  } catch (error) {
    console.error('API Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500, headers: corsHeaders }
    );
  }
}

export async function OPTIONS(req: NextRequest) {
  return NextResponse.json({}, { headers: getCorsHeaders(req.headers.get('origin')) });
}
