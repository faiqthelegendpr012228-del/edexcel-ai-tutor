import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

// Internal practice/flashcard helpers live in their own module so
// `practice.ts` can reference them through `internal.practiceInternal.*`
// without creating a circular type graph between the module and its generated
// `api` types (same pattern as chats.ts / chatsInternal.ts).

export const _getMessage = internalQuery({
  args: { messageId: v.id("messages") },
  handler: async (ctx, args) => await ctx.db.get(args.messageId),
});

export const _getChat = internalQuery({
  args: { chatId: v.id("chats") },
  handler: async (ctx, args) => await ctx.db.get(args.chatId),
});

export const _insertCards = internalMutation({
  args: {
    userId: v.id("users"),
    chatId: v.optional(v.id("chats")),
    subject: v.optional(v.string()),
    cards: v.array(v.object({ front: v.string(), back: v.string() })),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("flashcards")
      .withIndex("by_user_due", (q) => q.eq("userId", args.userId))
      .collect();
    let count = 0;
    for (const card of args.cards) {
      if (existing.length + count >= MAX_CARDS_PER_USER) break;
      const now = Date.now();
      await ctx.db.insert("flashcards", {
        userId: args.userId,
        chatId: args.chatId,
        subject: args.subject,
        front: card.front,
        back: card.back,
        box: 0,
        mastered: false,
        nextDueAt: now,
        createdAt: now,
      });
      count++;
    }
    return count;
  },
});

const MAX_CARDS_PER_USER = 500;
