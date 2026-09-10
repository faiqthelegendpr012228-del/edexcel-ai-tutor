import { v } from "convex/values";
import { internalQuery } from "./_generated/server";

// TEMPORARY diagnostic driver — read the REAL error stored by askTutor's
// catch block on failed assistant messages (the UI only shows the generic
// text; the message row keeps the underlying error string).

export const _recentErrors = internalQuery({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 15;
    const messages = await ctx.db.query("messages").collect();
    const errors = messages
      .filter((m) => m.status === "error" || (m.error !== undefined && m.error !== ""))
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit)
      .map((m) => ({
        id: m._id,
        chatId: m.chatId,
        role: m.role,
        status: m.status,
        createdAt: m.createdAt,
        createdAtISO: new Date(m.createdAt).toISOString(),
        contentPreview: m.content.slice(0, 120),
        error: m.error,
      }));
    return { totalMessages: messages.length, errors };
  },
});

export const _recentAssistantMessages = internalQuery({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 20;
    const messages = await ctx.db.query("messages").collect();
    const recent = messages
      .filter((m) => m.role === "assistant")
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit)
      .map((m) => ({
        id: m._id,
        chatId: m.chatId,
        status: m.status,
        createdAt: m.createdAt,
        createdAtISO: new Date(m.createdAt).toISOString(),
        contentPreview: m.content.slice(0, 100),
        error: m.error,
        grounded: m.grounded,
        groundingReason: m.groundingReason,
        mode: m.mode,
      }));
    return recent;
  },
});
