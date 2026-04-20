This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## 🤖 RAG Resume Bot

A Next.js chatbot that uses RAG (Retrieval-Augmented Generation) to answer questions about your professional experience. Supports both OpenAI and Claude as LLM providers.

## 🚀 Features

- **Multi-LLM Support**: Switch between OpenAI (GPT-4) and Claude (Anthropic) with a single environment variable
- **RAG Architecture**: Uses Supabase vector search for context retrieval
- **Streaming Responses**: Real-time chat experience
- **Flexible Configuration**: Easy switching between providers

## 🛠️ Environment Variables

Create a `.env.local` file with the following variables:

```bash
# Supabase Configuration
SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_KEY=your_supabase_service_key

# LLM Provider Selection (openai or claude)
LLM_PROVIDER=openai  # Change to "claude" to use Anthropic

# OpenAI Configuration (required for embeddings, optional for chat if using Claude)
OPENAI_API_KEY=your_openai_api_key
OPENAI_MODEL=gpt-4o-mini  # Optional, defaults to gpt-4o-mini
OPENAI_MAX_TOKENS=1000    # Optional, defaults to 1000

# Anthropic Configuration (only required if LLM_PROVIDER=claude)
ANTHROPIC_API_KEY=your_anthropic_api_key  # Only needed for Claude
CLAUDE_MODEL=claude-3-5-sonnet-20241022   # Optional, defaults to claude-3-5-sonnet

# System Prompt
SYSTEM_PROMPT=You are a helpful AI assistant...

# RAG Configuration
PRECISION_THRESHOLD=0.20  # Similarity threshold for filtering results
MAX_CONTEXT_DOCS=15       # Maximum number of documents to include in context

# Public Configuration
NEXT_PUBLIC_FIRST_NAME=Your First Name
NEXT_PUBLIC_LAST_NAME=Your Last Name
```

## 🔄 Switching Between Providers

To switch from OpenAI to Claude, simply change:

```bash
LLM_PROVIDER=claude
```

And add your Anthropic API key:

```bash
ANTHROPIC_API_KEY=your_anthropic_api_key
```

**Note**: OpenAI API key is always required because Claude doesn't have an embeddings API. The system uses OpenAI's `text-embedding-3-small` for all embedding generation.

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
