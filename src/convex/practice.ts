import { getAuthUserId } from "@convex-dev/auth/server";
import { v, type GenericId } from "convex/values";
import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { chatCompletion, MODELS } from "./lib/ai";

type Id<T extends string> = GenericId<T>;

// Leitner-style spaced repetition. Box 0 = new/struggling, box 5 = mastered.
// Index 0 is the "again" re-queue delay; 1..5 are the got-it intervals.
const BOX_INTERVAL_MINUTES = [2, 1440, 4320, 10080, 20160, 43200];
const MAX_CARDS_PER_USER = 500;

const FLASHCARD_SYSTEM_PROMPT = `You create study flashcards from tutoring material for Edexcel students. Reply with ONLY a JSON array of 4-8 objects, each {"front": string, "back": string}. Front: a precise question or recall prompt covering one fact, definition, formula or concept from the material. Back: a concise, correct answer in 1-3 sentences. Cover the most exam-relevant points. No prose, no markdown fences, no numbering.`;

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export const getStats = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      return { total: 0, due: 0, mastered: 0, nextDueAt: null };
    }
    const cards = await ctx.db
      .query("flashcards")
      .withIndex("by_user_due", (q) => q.eq("userId", userId))
      .collect();
    const now = Date.now();
    let nextDueAt: number | null = null;
    for (const card of cards) {
      if (
        card.nextDueAt > now &&
        (nextDueAt === null || card.nextDueAt < nextDueAt)
      ) {
        nextDueAt = card.nextDueAt;
      }
    }
    return {
      total: cards.length,
      due: cards.filter((c) => c.nextDueAt <= now).length,
      mastered: cards.filter((c) => c.mastered).length,
      nextDueAt,
    };
  },
});

export const listDue = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return [];
    return await ctx.db
      .query("flashcards")
      .withIndex("by_user_due", (q) =>
        q.eq("userId", userId).lte("nextDueAt", Date.now()),
      )
      .order("asc")
      .take(50);
  },
});

export const listAll = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return [];
    const cards = await ctx.db
      .query("flashcards")
      .withIndex("by_user_due", (q) => q.eq("userId", userId))
      .collect();
    return cards.sort((a, b) => b.createdAt - a.createdAt);
  },
});

// ---------------------------------------------------------------------------
// Review + management
// ---------------------------------------------------------------------------

export const reviewCard = mutation({
  args: {
    cardId: v.id("flashcards"),
    result: v.union(v.literal("again"), v.literal("gotit")),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    const card = await ctx.db.get(args.cardId);
    if (!card || card.userId !== userId) throw new Error("Card not found");

    const now = Date.now();
    if (args.result === "again") {
      await ctx.db.patch(args.cardId, {
        box: 0,
        mastered: false,
        nextDueAt: now + BOX_INTERVAL_MINUTES[0] * 60_000,
        lastReviewedAt: now,
      });
      return;
    }

    const box = Math.min(card.box + 1, 5);
    await ctx.db.patch(args.cardId, {
      box,
      mastered: box >= 5,
      nextDueAt: now + BOX_INTERVAL_MINUTES[box] * 60_000,
      lastReviewedAt: now,
    });
  },
});

export const deleteCard = mutation({
  args: { cardId: v.id("flashcards") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    const card = await ctx.db.get(args.cardId);
    if (!card || card.userId !== userId) throw new Error("Card not found");
    await ctx.db.delete(args.cardId);
  },
});

// ---------------------------------------------------------------------------
// Generation from a tutoring answer
// ---------------------------------------------------------------------------

function isCard(value: unknown): value is { front: string; back: string } {
  if (typeof value !== "object" || value === null) return false;
  const obj = value as Record<string, unknown>;
  return typeof obj.front === "string" && typeof obj.back === "string";
}

export const generateFromMessage = action({
  args: { messageId: v.id("messages") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");

    const message = await ctx.runQuery(internal.practice._getMessage, {
      messageId: args.messageId,
    });
    if (!message || message.userId !== userId) {
      throw new Error("Message not found");
    }
    if (message.status !== "complete") {
      throw new Error("Wait for the answer to finish first.");
    }
    const content = message.content.trim();
    if (!content) {
      throw new Error("There's nothing to turn into flashcards yet.");
    }

    const chat = message.chatId
      ? await ctx.runQuery(internal.practice._getChat, {
          chatId: message.chatId,
        })
      : null;

    const res = await chatCompletion(
      [
        { role: "system", content: FLASHCARD_SYSTEM_PROMPT },
        { role: "user", content: content.slice(0, 6000) },
      ],
      { model: MODELS.quick, temperature: 0.3, maxTokens: 1000 },
    );

    const cleaned = res.content
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/```\s*$/, "");

    let parsed: unknown;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      throw new Error(
        "Couldn't generate flashcards from that answer. Try again.",
      );
    }
    if (!Array.isArray(parsed)) {
      throw new Error(
        "Couldn't generate flashcards from that answer. Try again.",
      );
    }

    const cards = parsed
      .filter(isCard)
      .map((c) => ({
        front: c.front.trim().slice(0, 300),
        back: c.back.trim().slice(0, 600),
      }))
      .filter((c) => c.front && c.back)
      .slice(0, 8);

    if (cards.length === 0) {
      throw new Error(
        "Couldn't generate flashcards from that answer. Try again.",
      );
    }

    return await ctx.runMutation(internal.practice._insertCards, {
      userId,
      chatId: message.chatId,
      subject: chat?.subject ?? undefined,
      cards,
    });
  },
});

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

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
