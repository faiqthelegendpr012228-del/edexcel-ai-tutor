import { v } from "convex/values";
import { internalQuery } from "./_generated/server";

/** TEMPORARY diagnostic (pairs with diag3.ts) — delete after diagnosis. */
export const _recentChats = internalQuery({
  args: {},
  handler: async (ctx) => {
    const docs = await ctx.db.query("chats").order("desc").take(8);
    return docs.map((c) => ({
      id: c._id,
      subject: (c as { subject?: string }).subject ?? null,
      userId: (c as { userId?: string }).userId ?? null,
      title: (c as { title?: string }).title ?? null,
    }));
  },
});

/** TEMPORARY diagnostic (pairs with diag3.ts) — delete after diagnosis. */
export const _recentMessages = internalQuery({
  args: { since: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const since = args.since ?? Date.now() - 3 * 24 * 60 * 60 * 1000;
    const docs = await ctx.db.query("messages").order("desc").take(40);
    const rows = docs
      .filter((m) => m.createdAt >= since)
      .map((m) => ({
        id: m._id,
        chatId: m.chatId,
        role: m.role,
        createdAt: m.createdAt,
        contentHead:
          typeof m.content === "string" ? m.content.slice(0, 90) : "(non-string)",
        error: m.error ?? null,
        // The full row minus heavy fields, so no real field names are missed
        extra: Object.fromEntries(
          Object.entries(m).filter(
            ([k]) =>
              !["_id", "_creationTime", "chatId", "role", "createdAt", "content", "error"].includes(k),
          ),
        ),
      }));
    return rows;
  },
});
