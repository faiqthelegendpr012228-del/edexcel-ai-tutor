import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

/**
 * Internal helpers for the visualizations feature. Called from actions via
 * ctx.runQuery / ctx.runMutation so the heavy AI work can live in actions
 * while DB reads/writes stay in queries/mutations.
 */

export const _getMessage = internalQuery({
  args: { messageId: v.id("messages") },
  handler: async (ctx, args) => {
    const message = await ctx.db.get(args.messageId);
    if (!message) return null;
    return {
      _id: message._id,
      userId: message.userId,
      chatId: message.chatId,
      content: message.content,
      status: message.status,
    };
  },
});

export const _getChatMeta = internalQuery({
  args: { chatId: v.optional(v.id("chats")) },
  handler: async (ctx, args) => {
    if (!args.chatId) return null;
    const chat = await ctx.db.get(args.chatId);
    if (!chat) return null;
    return { title: chat.title, subject: chat.subject };
  },
});

export const _countForMessage = internalQuery({
  args: { messageId: v.id("messages") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("visualizations")
      .withIndex("by_message", (q) => q.eq("messageId", args.messageId))
      .collect()
      .then((rows) => rows.length);
  },
});

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

export const _deleteForUser = internalMutation({
  args: { visualizationId: v.id("visualizations") },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.visualizationId);
    if (row) await ctx.db.delete(row._id);
  },
});