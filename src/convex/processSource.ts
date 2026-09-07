import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { chatCompletion, embedTexts, hasEmbeddingsConfigured } from "./lib/ai";
import {
  chunkDocument,
  extractText,
  normalizeExtractedText,
  type Chunk,
} from "./lib/extract";

// Internal source-processing pipeline (scheduled from `createSource`). Lives
// in its own module so `sources.ts` can reference these through
// `internal.processSource.*` without circular type inference.

// Sanity caps so a single upload can't blow through action timeouts/costs.
const MAX_PAGES_PROCESSED = 300;
const MAX_CHUNKS = 400;

export const processSource = internalAction({
  args: {
    sourceId: v.id("sources"),
    userId: v.id("users"),
    storageId: v.id("_storage"),
    type: v.string(),
  },
  handler: async (ctx, args) => {
    const fail = async (message: string) => {
      await ctx.runMutation(internal.processSource.markSourceFailed, {
        sourceId: args.sourceId,
        userId: args.userId,
        error: message,
      });
    };

    await ctx.runMutation(internal.processSource.markSourceProcessing, {
      sourceId: args.sourceId,
      userId: args.userId,
    });

    try {
      const file = await ctx.storage.get(args.storageId);
      if (file === null) {
        await fail("The uploaded file could not be found in storage.");
        return;
      }
      const bytes = await file.arrayBuffer();

      const extracted = await extractText(args.type, bytes);
      const pages = extracted.pages.slice(0, MAX_PAGES_PROCESSED);
      const text = normalizeExtractedText(extracted.text);
      if (!text) {
        await fail(
          "We couldn't find any readable text in this file. It may be a scanned document or contain only images.",
        );
        return;
      }

      const chunks = chunkDocument({ ...extracted, pages }).slice(0, MAX_CHUNKS);

      // Semantic retrieval when the deployment has an OpenAI key; otherwise
      // the chunks are still stored and searched with keyword matching.
      let embeddings: number[][] | undefined;
      let retrievalMode: "semantic" | "keyword" = "keyword";
      if (hasEmbeddingsConfigured()) {
        try {
          embeddings = await embedTexts(chunks.map((c) => c.content));
          retrievalMode = "semantic";
        } catch (err) {
          const message =
            err instanceof Error ? err.message : "Embedding failed";
          // Keyword fallback — the source remains fully usable.
          console.warn(
            `[sources] Embedding failed for ${args.sourceId}, using keyword search: ${message}`,
          );
        }
      }

      let topics: string[] | undefined;
      if (retrievalMode === "keyword") {
        try {
          topics = await detectTopics(text.slice(0, 6000));
        } catch {
          topics = undefined;
        }
      }

      await ctx.runMutation(internal.processSource.writeChunksAndFinalize, {
        sourceId: args.sourceId,
        userId: args.userId,
        chunks,
        embeddings,
        pageCount: pages.length,
        topicsDetected: topics,
        retrievalMode,
      });
    } catch (err) {
      console.error("[sources] Processing failed:", err);
      const message =
        err instanceof Error
          ? err.message
          : "Something went wrong while reading this file.";
      await fail(shortenErrorMessage(message));
    }
  },
});

function shortenErrorMessage(message: string): string {
  if (message.length <= 240) return message;
  return `${message.slice(0, 240)}…`;
}

async function detectTopics(text: string): Promise<string[]> {
  const res = await chatCompletion(
    [
      {
        role: "system",
        content:
          "You detect Edexcel curriculum topics in study material. Reply with ONLY a JSON array of up to 6 short topic names (e.g. [\"Cell structure\", \"Osmosis\"]). No prose, no markdown fences.",
      },
      { role: "user", content: text.slice(0, 6000) },
    ],
    { maxTokens: 120 },
  );
  const cleaned = res.content
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "");
  const parsed: unknown = JSON.parse(cleaned);
  if (Array.isArray(parsed)) {
    return parsed
      .filter((t): t is string => typeof t === "string")
      .map((t) => t.trim())
      .filter(Boolean)
      .slice(0, 6);
  }
  return [];
}

export const markSourceProcessing = internalMutation({
  args: { sourceId: v.id("sources"), userId: v.id("users") },
  handler: async (ctx, args) => {
    const source = await ctx.db.get(args.sourceId);
    if (!source || source.userId !== args.userId) return;
    await ctx.db.patch(args.sourceId, {
      status: "processing",
      updatedAt: Date.now(),
    });
  },
});

export const markSourceFailed = internalMutation({
  args: {
    sourceId: v.id("sources"),
    userId: v.id("users"),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    const source = await ctx.db.get(args.sourceId);
    if (!source || source.userId !== args.userId) return;
    await ctx.db.patch(args.sourceId, {
      status: "failed",
      error: args.error,
      updatedAt: Date.now(),
    });
  },
});

export const writeChunksAndFinalize = internalMutation({
  args: {
    sourceId: v.id("sources"),
    userId: v.id("users"),
    chunks: v.array(
      v.object({
        content: v.string(),
        page: v.optional(v.number()),
        position: v.number(),
      }),
    ),
    embeddings: v.optional(v.array(v.array(v.float64()))),
    pageCount: v.optional(v.number()),
    topicsDetected: v.optional(v.array(v.string())),
    retrievalMode: v.union(v.literal("semantic"), v.literal("keyword")),
  },
  handler: async (ctx, args) => {
    const source = await ctx.db.get(args.sourceId);
    if (!source || source.userId !== args.userId) return;

    // Replace any previously stored chunks (re-processing).
    const existing = await ctx.db
      .query("chunks")
      .withIndex("by_source", (q) => q.eq("sourceId", args.sourceId))
      .collect();
    for (const chunk of existing) {
      await ctx.db.delete(chunk._id);
    }

    for (let i = 0; i < args.chunks.length; i++) {
      const chunk = args.chunks[i];
      await ctx.db.insert("chunks", {
        userId: args.userId,
        sourceId: args.sourceId,
        content: chunk.content,
        page: chunk.page,
        position: chunk.position,
        embedding: args.embeddings?.[i],
      });
    }

    await ctx.db.patch(args.sourceId, {
      status: "ready",
      chunkCount: args.chunks.length,
      pageCount: args.pageCount,
      topicsDetected: args.topicsDetected,
      retrievalMode: args.retrievalMode,
      error: undefined,
      updatedAt: Date.now(),
    });
  },
});

export const deleteSourceData = internalMutation({
  args: { sourceId: v.id("sources"), userId: v.id("users") },
  handler: async (ctx, args) => {
    const source = await ctx.db.get(args.sourceId);
    if (!source || source.userId !== args.userId) return;

    const chunks = await ctx.db
      .query("chunks")
      .withIndex("by_source", (q) => q.eq("sourceId", args.sourceId))
      .collect();
    for (const chunk of chunks) {
      await ctx.db.delete(chunk._id);
    }

    // Drop the source from every chat that had it selected.
    const chats = await ctx.db
      .query("chats")
      .withIndex("by_user_updated", (q) => q.eq("userId", args.userId))
      .collect();
    for (const chat of chats) {
      if (chat.selectedSourceIds.includes(args.sourceId)) {
        await ctx.db.patch(chat._id, {
          selectedSourceIds: chat.selectedSourceIds.filter(
            (id) => id !== args.sourceId,
          ),
          updatedAt: Date.now(),
        });
      }
    }

    await ctx.db.delete(args.sourceId);
  },
});

export const _getSource = internalQuery({
  args: { sourceId: v.id("sources") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.sourceId);
  },
});