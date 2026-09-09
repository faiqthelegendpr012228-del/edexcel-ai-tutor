import { query } from "./_generated/server";

/**
 * Server-side capability status. Only booleans — never expose keys to clients.
 */
export const getStatus = query({
  args: {},
  handler: async () => {
    // Gemini is the single AI provider: File Search grounding for tutor
    // answers, embeddings for the local-RAG fallback chain, and quick-task
    // completions all run off the same key.
    const geminiKey = !!process.env.GEMINI_API_KEY;
    return {
      // Gemini File Search grounding for tutor answers.
      geminiFileSearch: geminiKey,
      // Gemini key present → semantic retrieval enabled for the local RAG
      // fallback chain. Absent → keyword search fallback keeps sources
      // usable.
      embeddingsConfigured: geminiKey,
      // Chat capability: Gemini (preferred) or the platform VLY gateway.
      chatConfigured: geminiKey || !!process.env.VLY_INTEGRATION_KEY,
    };
  },
});
