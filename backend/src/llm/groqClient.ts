import { ChatGroq } from "@langchain/groq";
import dotenv from "dotenv";

dotenv.config();

if (!process.env.GROQ_API_KEY) {
    console.warn("⚠️ GROQ_API_KEY is missing. Voice will be dumb.");
}

// Llama 3.3 70B Versatile: High intelligence, extremely low latency (Groq LPU)
// Updated from decommissioned llama3-70b-8192
export const llm = new ChatGroq({
    apiKey: process.env.GROQ_API_KEY,
    model: "llama-3.3-70b-versatile",
    temperature: 0, // Deterministic = Safety
    maxTokens: 1024,
});

console.log("[LLM] Groq (Llama 3.3 70B Versatile) initialized.");
