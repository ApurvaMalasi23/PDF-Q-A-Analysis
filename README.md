# Mini PDF Q&A (React + Express)

This project implements the internship task using React for frontend and Express for backend (instead of Next.js as requested).

## Structure

- `server/` - Express backend handling PDF upload, embedding with OpenAI, storing/querying Pinecone.
- `client/` - Vite + React frontend with a ChatGPT-like UI.

## Quickstart

1. Create server/.env with your keys (see server/README.md).
2. Create client/.env.local with `VITE_SERVER_API_KEY` (must match server SERVER_API_KEY).
3. Install dependencies in each folder and run:

```bash
cd server
npm install
npm run dev

cd ../client
npm install
npm run dev
```

## Notes

- This is a demo template. For production, protect keys properly and don't expose API tokens in frontend.
- The backend expects a Pinecone index already created. Index name controlled by PINECONE_INDEX env var.