# PDF Q&A Server (Express)

This server provides two protected endpoints for the internship task:

- `POST /api/upload` - multipart form upload with field `file`. Extracts text from PDF, chunks it, creates embeddings with OpenAI, and upserts to Pinecone index.
- `POST /api/ask` - JSON `{ question }`. Embeds the question, queries Pinecone for top contexts, and uses OpenAI chat to answer.

## Setup

1. Create a `.env` in the server folder:

```
OPENAI_API_KEY=your_openai_key
PINECONE_API_KEY=your_pinecone_key
PINECONE_ENVIRONMENT=your_pinecone_env
PINECONE_INDEX=pdf-qa-index
SERVER_API_KEY=a_secret_token_for_frontend_calls
PORT=4000
```

2. Install dependencies and start:

```bash
cd server
npm install
npm run dev
```