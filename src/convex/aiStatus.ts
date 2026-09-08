import { query } from "./_generated/server";

/**
 * Server-side capability status. Only booleans — never expose keys to clients.
 */
export const getStatus = query({
  args: {},
  handler: async () => {
    return {
      // Gemini File Search grounding for tutor answers.
      geminiFileSearch: !!process.env.GEMINI_API_KEY,
      // OpenAI key present → semantic retrieval enabled for the local RAG
      // fallback. Absent/OpenRouter → keyword search fallback keeps sources
      // usable.
      embeddingsConfigured:
        !!process.env.OPENAI_API_KEY &&
        !process.env.OPENAI_API_KEY.startsWith("sk-or-"),
      // Chat capability: Gemini (preferred) or the platform VLY gateway.
      chatConfigured: !!process.env.GEMINI_API_KEY || !!process.env.VLY_INTEGRATION_KEY,
    };
  },
});