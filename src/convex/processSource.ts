import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

// Internal source-processing pipeline state transitions. The heavy lifting
// (file parsing, embedding, Gemini upload) runs in Node-runtime actions in
// `processSourceActions.ts`; this module hosts the mutations/queries those
// actions call through `internal.processSource.*`. Convex requires the split:
// a "use node" file may only export actions.

export const markSourceProcessing = internalMutation({
  args: { sourceId: v.id("sources"), userId: v.id("users") },
  handler: async (ctx, args) => {
    const source = await ctx.db.get(args.sourceId);
    if (!source || source.userId !== args.userId) return;
    await ctx.db.patch(args.sourceId, {
      status: "processing",
      // A fresh run starts the stage ladder from scratch.
      stage: "queued",
      stageDetail: undefined,
      // The run actually started: give it a fresh auto-requeue budget in case
      // a future scheduled run never starts at all.
      requeuedAt: undefined,
      updatedAt: Date.now(),
    });
  },
});

/**
 * Persist the current pipeline stage (and optional intra-stage progress,
 * e.g. "212/430") as the action works, so the UI shows live, real progress
 * and a mid-stage failure keeps its last-known stage for diagnosis.
 */
export const markSourceStage = internalMutation({
  args: {
    sourceId: v.id("sources"),
    userId: v.id("users"),
    stage: v.union(
      v.literal("extracting"),
      v.literal("chunking"),
      v.literal("embedding"),
      v.literal("finalizing"),
    ),
    stageDetail: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const source = await ctx.db.get(args.sourceId);
    if (!source || source.userId !== args.userId) return;
    await ctx.db.patch(args.sourceId, {
      stage: args.stage,
      ...(args.stageDetail !== undefined
        ? { stageDetail: args.stageDetail }
        : { stageDetail: undefined }),
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

export const writeChunks = internalMutation({
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
    replaceExisting: v.optional(v.boolean()),
    pageCount: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const source = await ctx.db.get(args.sourceId);
    if (!source || source.userId !== args.userId) return;

    // First batch of a (re)processing run: replace any previously stored
    // chunks so re-tries don't duplicate passages.
    if (args.replaceExisting) {
      const existing = await ctx.db
        .query("chunks")
        .withIndex("by_source", (q) => q.eq("sourceId", args.sourceId))
        .collect();
      for (const chunk of existing) {
        await ctx.db.delete(chunk._id);
      }
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
      ...(args.pageCount !== undefined && { pageCount: args.pageCount }),
      updatedAt: Date.now(),
    });
  },
});

export const markSourceReady = internalMutation({
  args: {
    sourceId: v.id("sources"),
    userId: v.id("users"),
    chunkCount: v.number(),
    pageCount: v.optional(v.number()),
    topicsDetected: v.optional(v.array(v.string())),
    retrievalMode: v.union(v.literal("semantic"), v.literal("keyword")),
    embeddingModel: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const source = await ctx.db.get(args.sourceId);
    if (!source || source.userId !== args.userId) return;
    await ctx.db.patch(args.sourceId, {
      status: "ready",
      stage: undefined,
      stageDetail: undefined,
      chunkCount: args.chunkCount,
      pageCount: args.pageCount,
      topicsDetected: args.topicsDetected,
      retrievalMode: args.retrievalMode,
      ...(args.embeddingModel !== undefined
        ? { embeddingModel: args.embeddingModel }
        : {}),
      error: undefined,
      updatedAt: Date.now(),
    });
  },
});

export const markSourceProgress = internalMutation({
  args: {
    sourceId: v.id("sources"),
    userId: v.id("users"),
    pageCount: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const source = await ctx.db.get(args.sourceId);
    if (!source || source.userId !== args.userId) return;
    await ctx.db.patch(args.sourceId, {
      ...(args.pageCount !== undefined && { pageCount: args.pageCount }),
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

export const setGeminiDocName = internalMutation({
  args: {
    sourceId: v.id("sources"),
    userId: v.id("users"),
    geminiDocName: v.string(),
  },
  handler: async (ctx, args) => {
    const source = await ctx.db.get(args.sourceId);
    if (!source || source.userId !== args.userId) return;
    await ctx.db.patch(args.sourceId, {
      geminiDocName: args.geminiDocName,
      updatedAt: Date.now(),
    });
  },
});

/** Stamp the large-upload cooldown from page-count-based largeness. */
export const stampLargeUpload = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("uploadCooldowns")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .first();
    const now = Date.now();
    if (row) {
      await ctx.db.patch(row._id, { lastLargeUploadAt: now, updatedAt: now });
    } else {
      await ctx.db.insert("uploadCooldowns", {
        userId: args.userId,
        lastLargeUploadAt: now,
        updatedAt: now,
      });
    }
  },
});
