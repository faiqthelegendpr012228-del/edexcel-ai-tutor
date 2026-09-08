"use node";

// One-off probe: call the VLY AI gateway from inside the Convex runtime and
// report exactly what comes back. Temporary diagnostic — safe to delete.
import { action } from "./_generated/server";
import { vly } from "../lib/vly-integrations";

export const probe = action({
  args: {},
  handler: async () => {
    const out: Record<string, unknown> = {
      hasKey: !!process.env.VLY_INTEGRATION_KEY,
    };
    try {
      const res = await vly.ai.completion(
        {
          model: "gpt-4o-mini",
          messages: [{ role: "user", content: "Say OK" }],
          maxTokens: 5,
        },
        { timeout: 30_000 },
      );
      out.success = res.success;
      out.error = res.error ?? null;
      out.hasData = !!res.data;
      if (res.data) {
        const content = res.data.choices?.[0]?.message?.content ?? null;
        out.content = content;
      }
    } catch (err) {
      out.threw = err instanceof Error ? err.message : String(err);
    }
    return out;
  },
});
