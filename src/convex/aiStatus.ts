import { query } from "./_generated/server";

/**
 * Server-side capability status. Only booleans — never expose keys to clients.
 */
export const getStatus = query({
  args: {},
  handler: async () => {
    return {
      // OpenAI key present → semantic retrieval enabled. Absent → keyword
      // search fallback keeps sources usable.
      embeddingsConfigured: !!process.env.OPENAI_API_KEY,
      // The VLY gateway key is injected by the platform at deploy time.
      chatConfigured: !!process.env.VLY_INTEGRATION_KEY,
    };
  },
});