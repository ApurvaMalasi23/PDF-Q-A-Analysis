import express from "express";
import multer from "multer";
import pdfParse from "pdf-parse";
import dotenv from "dotenv";
import cors from "cors";
import { Pinecone } from '@pinecone-database/pinecone';
import { v4 as uuidv4 } from "uuid";
import fs from "fs/promises";
import path from "path";
import { GoogleGenerativeAI } from "@google/generative-ai";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

const PORT = process.env.PORT || 4000;
const SERVER_API_KEY = process.env.SERVER_API_KEY || "dev_token";

// API key middleware
function requireApiKey(req, res, next) {
    const key = req.headers["x-api-key"] || req.headers["authorization"];
    if (!key) return res.status(401).json({ error: "Missing API key" });
    const token = key.startsWith("Bearer ") ? key.split(" ")[1] : key;
    if (token !== SERVER_API_KEY) return res.status(403).json({ error: "Invalid API key" });
    next();
}

// Multer for file uploads
const upload = multer({ dest: "uploads/" });

// Initialize Google Generative AI clients
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
const geminiEmbeddingModel = genAI.getGenerativeModel({
    model: process.env.GEMINI_EMBEDDING_MODEL || "text-embedding-004",
});
const geminiChatModel = genAI.getGenerativeModel({
    model: process.env.GEMINI_CHAT_MODEL || "gemini-1.5-flash",
});

// Initialize Pinecone client
const pc = new Pinecone({
    apiKey: process.env.PINECONE_API_KEY
});
const index = pc.index(process.env.PINECONE_INDEX || 'pdf-qa');

// Helper function to clean and validate text
function cleanText(text) {
    if (!text || typeof text !== 'string') return '';
    
    // Remove or replace problematic characters
    let cleaned = text
        // Replace common mathematical symbols with text equivalents
        .replace(/Â°/g, ' degrees ')
        .replace(/âˆ /g, 'angle ')
        .replace(/âˆ†/g, 'triangle ')
        .replace(/Ï€/g, 'pi ')
        .replace(/âˆš/g, 'sqrt ')
        // Remove other special Unicode characters that might cause issues
        .replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ') // Remove control characters
        .replace(/[\u2000-\u206F]/g, ' ') // Remove general punctuation
        .replace(/[\u2070-\u209F]/g, ' ') // Remove superscripts/subscripts
        .replace(/[\u20A0-\u20CF]/g, ' ') // Remove currency symbols
        .replace(/[\u2100-\u214F]/g, ' ') // Remove letterlike symbols
        // Normalize whitespace
        .replace(/\s+/g, ' ')
        .trim();
    
    // Additional validation
    if (cleaned.length < 10) return ''; // Too short to be meaningful
    if (cleaned.length > 8000) return cleaned.substring(0, 8000); // Prevent overly long chunks
    
    return cleaned;
}

// Helper function to chunk text
function chunkText(text, maxLen = 1000) {
    const chunks = [];
    let i = 0;
    while (i < text.length) {
        const chunk = text.slice(i, i + maxLen);
        const cleanedChunk = cleanText(chunk);
        if (cleanedChunk) { // Only add if chunk is valid after cleaning
            chunks.push(cleanedChunk);
        }
        i += maxLen - 200; // 200-character overlap
    }
    return chunks;
}

// Helper function to create embeddings with better error handling
async function embedTexts(texts) {
    try {
        // Filter and clean texts before sending to API
        const cleanedTexts = texts
            .map(text => cleanText(text))
            .filter(text => text.length > 0);

        if (cleanedTexts.length === 0) {
            throw new Error("No valid text chunks after cleaning");
        }

        console.log(`[DEBUG] Sending ${cleanedTexts.length} cleaned chunks to embedding API`);
        
        // Process in smaller batches to avoid API limits
        const batchSize = 10; // Reduce batch size for stability
        const allEmbeddings = [];
        
        for (let i = 0; i < cleanedTexts.length; i += batchSize) {
            const batch = cleanedTexts.slice(i, i + batchSize);
            console.log(`[DEBUG] Processing batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(cleanedTexts.length/batchSize)}`);
            
            try {
                const requests = batch.map(text => ({
                    content: {
                        parts: [{ text: text }]
                    }
                }));
                
                const result = await geminiEmbeddingModel.batchEmbedContents({ requests });
                
                if (result.embeddings && result.embeddings.length > 0) {
                    const embeddings = result.embeddings.map(e => e.values);
                    allEmbeddings.push(...embeddings);
                } else {
                    console.warn(`[WARNING] No embeddings returned for batch starting at index ${i}`);
                }
            } catch (batchError) {
                console.error(`[ERROR] Failed to process batch starting at index ${i}:`, batchError.message);
                // Try processing each text individually in this batch
                for (const text of batch) {
                    try {
                        const singleResult = await geminiEmbeddingModel.embedContent(text);
                        allEmbeddings.push(singleResult.embedding.values);
                    } catch (singleError) {
                        console.error(`[ERROR] Failed to embed individual text: "${text.substring(0, 100)}..."`);
                        console.error(`[ERROR] Single embedding error:`, singleError.message);
                        // Skip this problematic text
                    }
                }
            }
            
            // Add a small delay between batches to be respectful to the API
            if (i + batchSize < cleanedTexts.length) {
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        }
        
        console.log(`[DEBUG] Successfully created ${allEmbeddings.length} embeddings from ${cleanedTexts.length} texts`);
        return allEmbeddings;
        
    } catch (error) {
        console.error("Error during embedding:", error);
        if (error.errorDetails) {
            console.error("Error details:", JSON.stringify(error.errorDetails, null, 2));
        }
        throw error;
    }
}

// Helper function to delete session vectors
async function deleteSessionVectors(sessionId) {
    try {
        console.log(`[DEBUG] Attempting to delete vectors for session: ${sessionId}`);
        
        // Query to find all vectors for this session
        const queryResponse = await index.query({
            vector: new Array(768).fill(0), // Dummy vector for querying
            topK: 10000, // Large number to get all vectors
            includeMetadata: true,
            filter: { session_id: sessionId }
        });
        
        if (queryResponse.matches && queryResponse.matches.length > 0) {
            const vectorIds = queryResponse.matches.map(match => match.id);
            console.log(`[DEBUG] Found ${vectorIds.length} vectors to delete for session ${sessionId}`);
            
            // Delete vectors in batches
            const batchSize = 1000;
            for (let i = 0; i < vectorIds.length; i += batchSize) {
                const batch = vectorIds.slice(i, i + batchSize);
                await index.deleteMany(batch);
                console.log(`[DEBUG] Deleted batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(vectorIds.length/batchSize)}`);
            }
            
            console.log(`[DEBUG] Successfully deleted ${vectorIds.length} vectors for session ${sessionId}`);
        } else {
            console.log(`[DEBUG] No vectors found for session ${sessionId}`);
        }
    } catch (error) {
        console.error(`[ERROR] Failed to delete session vectors:`, error);
        // Don't throw the error - we'll proceed with the upload even if cleanup fails
    }
}

// --- API ROUTES ---

// Route for uploading and processing a PDF
app.post("/api/upload", requireApiKey, upload.single("file"), async (req, res) => {
    console.log("\n--- New PDF Upload Request Received ---");
    try {
        if (!req.file) {
            return res.status(400).json({ error: "No file uploaded" });
        }

        const sessionId = req.body.sessionId;
        if (!sessionId) {
            return res.status(400).json({ error: "Missing session ID" });
        }

        console.log(`[DEBUG] Processing upload for session: ${sessionId}`);

        // Clean up existing vectors for this session first
        await deleteSessionVectors(sessionId);

        const filePath = path.resolve(req.file.path);
        const data = await fs.readFile(filePath);
        const pdfData = await pdfParse(data);
        const text = pdfData.text || "";

        if (!text.trim()) {
            await fs.unlink(filePath);
            return res.status(400).json({ error: "PDF contains no readable text content." });
        }

        console.log(`[DEBUG] Extracted text length: ${text.length} characters`);
        
        const chunks = chunkText(text, 1000);
        
        console.log(`[DEBUG] Total chunks created: ${chunks.length}`);
        
        const validChunks = chunks.filter(chunk => chunk && chunk.trim() !== "");
        
        console.log(`[DEBUG] Valid chunks after filtering: ${validChunks.length}`);
        
        if (validChunks.length === 0) {
            await fs.unlink(filePath);
            console.log("[ERROR] No valid text chunks found after cleaning.");
            return res.status(400).json({ error: "PDF contains no processable text content after cleaning." });
        }
        
        console.log("Attempting to create embeddings for valid chunks...");
        const embeddings = await embedTexts(validChunks);
        console.log("Embeddings created successfully.");

        // Ensure we have the same number of embeddings and chunks
        const minLength = Math.min(embeddings.length, validChunks.length);
        const vectors = embeddings.slice(0, minLength).map((emb, i) => ({
            id: `${sessionId}_${i}`, // Include session ID in vector ID
            values: emb,
            metadata: {
                text: validChunks[i],
                source: req.file.originalname,
                chunk_index: i,
                session_id: sessionId, // Add session ID to metadata for filtering
                uploaded_at: new Date().toISOString()
            },
        }));

        console.log(`Upserting ${vectors.length} vectors to Pinecone...`);
        const batchSize = 100;
        for (let i = 0; i < vectors.length; i += batchSize) {
            const batch = vectors.slice(i, i + batchSize);
            await index.upsert(batch);
        }
        console.log("Upsert to Pinecone complete.");

        await fs.unlink(filePath);
        res.json({ ok: true, uploaded_chunks: vectors.length, session_id: sessionId });

    } catch (err) {
        console.error("--- ERROR IN /api/upload ---");
        if (err.errorDetails) {
            console.error(JSON.stringify(err.errorDetails, null, 2));
        } else {
            console.error(err);
        }
        
        // Clean up file if it still exists
        try {
            if (req.file && req.file.path) {
                await fs.unlink(path.resolve(req.file.path));
            }
        } catch (unlinkError) {
            console.error("Error cleaning up file:", unlinkError.message);
        }
        
        const errorMessage = err.message || "An internal server error occurred.";
        res.status(500).json({ error: errorMessage });
    }
});

// Route for asking a question
app.post("/api/ask", requireApiKey, async (req, res) => {
    try {
        const { question, sessionId, topK = 4 } = req.body;
        if (!question) {
            return res.status(400).json({ error: "Missing question" });
        }

        if (!sessionId) {
            return res.status(400).json({ error: "Missing session ID" });
        }

        console.log(`[DEBUG] Processing question for session: ${sessionId}`);

        // Clean the question before embedding
        const cleanedQuestion = cleanText(question);
        if (!cleanedQuestion) {
            return res.status(400).json({ error: "Question contains no valid content" });
        }

        const qEmbResp = await geminiEmbeddingModel.embedContent(cleanedQuestion);
        const qEmb = qEmbResp.embedding.values;

        // Query with session filter
        const queryResp = await index.query({
            topK,
            vector: qEmb,
            includeMetadata: true,
            filter: { session_id: sessionId } // Filter by session ID
        });

        const matches = queryResp.matches || [];
        
        if (matches.length === 0) {
            return res.json({ 
                answer: "I couldn't find any relevant information in the current document. Please make sure you have uploaded a PDF document for this session.",
                sources: []
            });
        }

        const contexts = matches.map(m => m.metadata.text).join("\n---\n");

        const systemInstruction = "You are a helpful assistant. Use the provided context from the uploaded PDF document to answer the question. If the answer is not contained within the context, say that you cannot find the answer in the provided document. Answer concisely and accurately based only on the document content.";
        const userPrompt = `Context from the uploaded document:\n${contexts}\n\nQuestion: ${question}`;
        
        const fullPrompt = `${systemInstruction}\n\n${userPrompt}`;
        
        const result = await geminiChatModel.generateContent(fullPrompt);
        const response = await result.response;
        const answer = response.text();

        res.json({ 
            answer, 
            sources: matches.map(m => ({
                source: m.metadata.source,
                chunk_index: m.metadata.chunk_index,
                session_id: m.metadata.session_id
            })),
            session_id: sessionId
        });

    } catch (err) {
        console.error("--- ERROR IN /api/ask ---", err);
        const errorMessage = err.message || "An internal server error occurred.";
        res.status(500).json({ error: errorMessage });
    }
});

// Route to clear/delete session data
app.post("/api/clear-session", requireApiKey, async (req, res) => {
    try {
        const { sessionId } = req.body;
        if (!sessionId) {
            return res.status(400).json({ error: "Missing session ID" });
        }

        console.log(`[DEBUG] Clearing session: ${sessionId}`);
        await deleteSessionVectors(sessionId);
        
        res.json({ ok: true, message: `Session ${sessionId} cleared successfully` });
    } catch (err) {
        console.error("--- ERROR IN /api/clear-session ---", err);
        const errorMessage = err.message || "An internal server error occurred.";
        res.status(500).json({ error: errorMessage });
    }
});

// Route to get session info
app.get("/api/session/:sessionId", requireApiKey, async (req, res) => {
    try {
        const { sessionId } = req.params;
        
        // Query to get document info for this session
        const queryResponse = await index.query({
            vector: new Array(768).fill(0), // Dummy vector for querying
            topK: 1, // We just need to check if session exists
            includeMetadata: true,
            filter: { session_id: sessionId }
        });
        
        if (queryResponse.matches && queryResponse.matches.length > 0) {
            const firstMatch = queryResponse.matches[0];
            res.json({
                exists: true,
                document: firstMatch.metadata.source,
                uploaded_at: firstMatch.metadata.uploaded_at,
                session_id: sessionId
            });
        } else {
            res.json({
                exists: false,
                session_id: sessionId
            });
        }
        
    } catch (err) {
        console.error("--- ERROR IN /api/session/:sessionId ---", err);
        const errorMessage = err.message || "An internal server error occurred.";
        res.status(500).json({ error: errorMessage });
    }
});

app.get("/", (req, res) => {
    res.send("PDF Q&A server with session management is running.");
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));