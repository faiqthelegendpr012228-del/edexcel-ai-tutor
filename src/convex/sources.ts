import { getAuthUserId } from "@convex-dev/auth/server";
import { v, type GenericId } from "convex/values";
import { action, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";

type Id<T extends string> = GenericId<T>;

// ---------------------------------------------------------------------------
// Upload + source lifecycle
// ---------------------------------------------------------------------------

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    return await ctx.storage.generateUploadUrl();
  },
});

export const createSource = mutation({
  args: {
    storageId: v.id("_storage"),
    name: v.string(),
    type: v.union(
      v.literal("pdf"),
      v.literal("docx"),
      v.literal("pptx"),
      v.literal("txt"),
      v.literal("md"),
      v.literal("image"),
      v.literal("unknown"),
    ),
    size: v.number(),
    subject: v.optional(v.string()),
    qualification: v.optional(v.string()),
    collectionId: v.optional(v.id("collections")),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");

    if (args.collectionId) {
      const collection = await ctx.db.get(args.collectionId);
      if (!collection || collection.userId !== userId) {
        throw new Error("Collection not found");
      }
    }

    const now = Date.now();
    const sourceId = await ctx.db.insert("sources", {
      userId,
      storageId: args.storageId,
      name: args.name,
      type: args.type,
      subject: args.subject,
      qualification: args.qualification,
      collectionId: args.collectionId,
      size: args.size,
      status: "queued",
      createdAt: now,
      updatedAt: now,
    });

    await ctx.scheduler.runAfter(0, internal.processSource.processSource, {
      sourceId,
      userId,
      storageId: args.storageId,
      type: args.type,
    });

    return sourceId;
  },
});

/**
 * Re-run the extraction/embedding pipeline for a source that failed or got
 * stuck while processing. Uses the same storage blob, so no re-upload needed.
 */
export const retrySource = mutation({
  args: { sourceId: v.id("sources") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    const source = await ctx.db.get(args.sourceId);
    if (!source || source.userId !== userId) throw new Error("Source not found");
    if (source.status === "ready") throw new Error("Source is already ready");

    await ctx.db.patch(args.sourceId, {
      status: "queued",
      error: undefined,
      updatedAt: Date.now(),
    });

    await ctx.scheduler.runAfter(0, internal.processSource.processSource, {
      sourceId: args.sourceId,
      userId,
      storageId: source.storageId,
      type: source.type,
    });
  },
});

export const deleteSource = action({
  args: { sourceId: v.id("sources") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");

    const source = await ctx.runQuery(internal.processSource._getSource, {
      sourceId: args.sourceId,
    });
    if (!source || source.userId !== userId) {
      throw new Error("Source not found");
    }

    await ctx.storage.delete(source.storageId);
    await ctx.runMutation(internal.processSource.deleteSourceData, {
      sourceId: args.sourceId,
      userId,
    });
  },
});

// ---------------------------------------------------------------------------
// Public queries + mutations
// ---------------------------------------------------------------------------

export const listSources = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return [];
    return await ctx.db
      .query("sources")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .collect();
  },
});

export const getSource = query({
  args: { sourceId: v.id("sources") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null;
    const source = await ctx.db.get(args.sourceId);
    return source && source.userId === userId ? source : null;
  },
});

export const updateSourceMeta = mutation({
  args: {
    sourceId: v.id("sources"),
    name: v.optional(v.string()),
    subject: v.optional(v.string()),
    qualification: v.optional(v.string()),
    collectionId: v.optional(v.union(v.id("collections"), v.null())),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    const source = await ctx.db.get(args.sourceId);
    if (!source || source.userId !== userId) throw new Error("Not found");

    if (args.collectionId !== undefined && args.collectionId !== null) {
      const collection = await ctx.db.get(args.collectionId);
      if (!collection || collection.userId !== userId) {
        throw new Error("Collection not found");
      }
    }

    await ctx.db.patch(args.sourceId, {
      ...(args.name !== undefined && { name: args.name }),
      ...(args.subject !== undefined && { subject: args.subject }),
      ...(args.qualification !== undefined && {
        qualification: args.qualification,
      }),
      ...(args.collectionId !== undefined && {
        collectionId:
          args.collectionId === null ? undefined : args.collectionId,
      }),
      updatedAt: Date.now(),
    });
  },
});

// ---------------------------------------------------------------------------
// Collections
// ---------------------------------------------------------------------------

export const listCollections = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return [];
    return await ctx.db
      .query("collections")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
  },
});

export const createCollection = mutation({
  args: { name: v.string() },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    const name = args.name.trim().slice(0, 80);
    if (!name) throw new Error("Name is required");
    return await ctx.db.insert("collections", {
      userId,
      name,
      createdAt: Date.now(),
    });
  },
});

export const deleteCollection = mutation({
  args: { collectionId: v.id("collections") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    const collection = await ctx.db.get(args.collectionId);
    if (!collection || collection.userId !== userId) {
      throw new Error("Collection not found");
    }
    const sources = await ctx.db
      .query("sources")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    for (const source of sources) {
      if (source.collectionId === args.collectionId) {
        await ctx.db.patch(source._id, {
          collectionId: undefined,
          updatedAt: Date.now(),
        });
      }
    }
    await ctx.db.delete(args.collectionId);
  },
});