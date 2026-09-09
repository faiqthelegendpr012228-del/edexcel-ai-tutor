import { v, type GenericId } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import {
  QUOTA_WINDOW_DAYS,
  TUTOR_GROUNDED_QUOTA_PER_WEEK,
} from "./lib/limits";

type Id<T extends string> = GenericId<T>;

// Internal chat helpers live in their own module so `chats.ts` can reference
// them through `internal.chatsInternal.*` without creating a circular type
// graph between the module and its generated `api` types.

export const _getChat = internalQuery({
  args: { chatId: v.id("chats") },
  handler: async (ctx, args) => await ctx.db.get(args.chatId),
});

export const _getMessages = internalQuery({
  args: { chatId: v.id("chats") },
  handler: async (ctx, args) => {
    const messages = await ctx.db
      .query("messages")
      .withIndex("by_chat", (q) => q.eq("chatId", args.chatId))
      .collect();
    return messages.sort((a, b) => a.createdAt - b.createdAt);
  },
});

export const _getSources = internalQuery({
  args: { sourceIds: v.array(v.id("sources")) },
  handler: async (ctx, args) => {
    const out = [];
    for (const id of args.sourceIds) {
      const source = await ctx.db.get(id);
      if (source) out.push(source);
    }
    return out;
  },
});

export const _getUserReadySources = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) =>
    await ctx.db
      .query("sources")
      .withIndex("by_user_status", (q) =>
        q.eq("userId", args.userId).eq("status", "ready"),
      )
      .collect(),
});

export const _getChunksByIds = internalQuery({
  args: { ids: v.array(v.id("chunks")) },
  handler: async (ctx, args) => {
    const out = [];
    for (const id of args.ids) {
      const chunk = await ctx.db.get(id);
      if (chunk) out.push(chunk);
    }
    return out;
  },
});

export const _searchChunks = internalQuery({
  args: {
    userId: v.id("users"),
    query: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("chunks")
      .withSearchIndex("search_content", (q) =>
        q.search("content", args.query).eq("userId", args.userId),
      )
      .take(args.limit ?? 12);
  },
});

export const _insertMessage = internalMutation({
  args: {
    userId: v.id("users"),
    chatId: v.id("chats"),
    role: v.union(v.literal("user"), v.literal("assistant")),
    content: v.string(),
    status: v.union(
      v.literal("thinking"),
      v.literal("streaming"),
      v.literal("complete"),
      v.literal("error"),
    ),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("messages", {
      userId: args.userId,
      chatId: args.chatId,
      role: args.role,
      content: args.content,
      status: args.status,
      createdAt: Date.now(),
    });
  },
});

export const _updateMessageStreaming = internalMutation({
  args: { messageId: v.id("messages") },
  handler: async (ctx, args) => {
    const msg = await ctx.db.get(args.messageId);
    if (!msg || msg.status === "complete" || msg.status === "error") return;
    await ctx.db.patch(args.messageId, { status: "streaming" });
  },
});

// Streaming deltas arrive asynchronously and may race with the final write.
// The length guard makes stale writes no-ops.
export const _updateMessageDelta = internalMutation({
  args: { messageId: v.id("messages"), content: v.string() },
  handler: async (ctx, args) => {
    const msg = await ctx.db.get(args.messageId);
    if (!msg) return;
    if (msg.status === "complete" || msg.status === "error") return;
    if (args.content.length <= msg.content.length) return;
    await ctx.db.patch(args.messageId, { content: args.content });
  },
});

export const _finalizeMessage = internalMutation({
  args: {
    messageId: v.id("messages"),
    content: v.string(),
    citations: v.optional(
      v.array(
        v.object({
          sourceId: v.optional(v.id("sources")),
          documentTitle: v.optional(v.string()),
          uri: v.optional(v.string()),
          page: v.optional(v.number()),
          snippet: v.optional(v.string()),
        }),
      ),
    ),
    mode: v.optional(v.union(v.literal("sources"), v.literal("outside"))),
    needsPermission: v.optional(v.boolean()),
    grounded: v.optional(v.boolean()),
    groundingReason: v.optional(v.string()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const msg = await ctx.db.get(args.messageId);
    if (!msg) return;
    await ctx.db.patch(args.messageId, {
      content: args.content,
      status: args.error ? "error" : "complete",
      ...(args.citations !== undefined && { citations: args.citations }),
      ...(args.mode !== undefined && { mode: args.mode }),
      ...(args.needsPermission !== undefined && {
        needsPermission: args.needsPermission,
      }),
      ...(args.grounded !== undefined && { grounded: args.grounded }),
      ...(args.groundingReason !== undefined && {
        groundingReason: args.groundingReason,
      }),
      ...(args.error !== undefined && { error: args.error }),
    });
  },
});

// ---------------------------------------------------------------------------
// Grounded-query quota (File Search is the scarce free-tier resource)
// ---------------------------------------------------------------------------

const QUOTA_WINDOW_MS = QUOTA_WINDOW_DAYS * 24 * 60 * 60 * 1000;

/** Log one grounded File Search query against the rolling window. */
export const _recordAiUsage = internalMutation({
  args: {
    userId: v.id("users"),
    subject: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    await ctx.db.insert("aiUsage", {
      userId: args.userId,
      usedAt: now,
      windowStart: now - QUOTA_WINDOW_MS,
      subject: args.subject,
    });
  },
});

/**
 * Quota status for one student over the rolling window. Read-only — stale
 * rows are pruned separately in _pruneStaleUsage (writes aren't allowed in
 * queries).
 */
export const _getQuotaStatus = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const now = Date.now();
    const windowStart = now - QUOTA_WINDOW_MS;
    const inWindow = await ctx.db
      .query("aiUsage")
      .withIndex("by_user_used", (q) =>
        q.eq("userId", args.userId).gte("usedAt", windowStart),
      )
      .collect();

    const used = inWindow.length;
    const oldest = inWindow.reduce<number | null>(
      (acc, r) => (acc === null || r.usedAt < acc ? r.usedAt : acc),
      null,
    );
    const resetsInMs =
      used >= TUTOR_GROUNDED_QUOTA_PER_WEEK && oldest !== null
        ? Math.max(0, oldest + QUOTA_WINDOW_MS - now)
        : 0;
    return { used, limit: TUTOR_GROUNDED_QUOTA_PER_WEEK, resetsInMs };
  },
});

/** Remove aiUsage rows older than the window; called after each logged query. */
export const _pruneStaleUsage = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const cutoff = Date.now() - QUOTA_WINDOW_MS;
    const stale = await ctx.db
      .query("aiUsage")
      .withIndex("by_user_used", (q) =>
        q.eq("userId", args.userId).lt("usedAt", cutoff),
      )
      .take(200);
    for (const row of stale) {
      await ctx.db.delete(row._id);
    }
  },
});

export const _updateChatTitle = internalMutation({
  args: { chatId: v.id("chats"), title: v.string() },
  handler: async (ctx, args) => {
    const chat = await ctx.db.get(args.chatId);
    if (!chat || chat.title !== "New lesson") return;
    await ctx.db.patch(args.chatId, {
      title: args.title,
      updatedAt: Date.now(),
    });
  },
});