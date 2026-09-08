import { v } from "convex/values";
import { internalMutation } from "./_generated/server";

/**
 * Internal helpers for the visualizations feature. Called from actions via
 * ctx.runMutation so the heavy AI work can live in actions while DB writes
 * stay in mutations.
 */

export const _insert = internalMutation({
  args: {
    userId: v.id("users"),
    chatId: v.optional(v.id("chats")),
    messageId: v.optional(v.id("messages")),
    title: v.string(),
    html: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("visualizations", {
      userId: args.userId,
      chatId: args.chatId,
      messageId: args.messageId,
      title: args.title,
      html: args.html,
      createdAt: Date.now(),
    });
  },
});

export const _deleteForMessage = internalMutation({
  args: { messageId: v.id("messages") },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("visualizations")
      .withIndex("by_message", (q) => q.eq("messageId", args.messageId))
      .collect();
    for (const row of rows) {
      await ctx.db.delete(row._id);
    }
  },
});

export const _deleteForUser = internalMutation({
  args: { visualizationId: v.id("visualizations") },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.visualizationId);
    if (row) await ctx.db.delete(row._id);
  },
});
