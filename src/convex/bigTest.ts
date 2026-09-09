//
// TEMPORARY E2E driver for large-file verification — deleted after the test.
// Lets the shell upload a big PDF through a real Convex storage upload URL,
// then runs the REAL processSource action against it and reports survival.
//
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";

export const _anyUserId = internalQuery({
  args: {},
  handler: async (ctx): Promise<Id<"users">> => {
    const user = await ctx.db.query("users").first();
    if (!user) throw new Error("No users exist yet");
    return user._id;
  },
});

export const _newUploadUrl = internalMutation({
  args: {},
  handler: async (ctx): Promise<string> => await ctx.storage.generateUploadUrl(),
});

export const _insertBigTestSource = internalMutation({
  args: { storageId: v.id("_storage"), size: v.number() },
  handler: async (
    ctx,
    args,
  ): Promise<Id<"sources">> => {
    const userId = await ctx.runQuery(internal.bigTest._anyUserId, {});
    const now = Date.now();
    return await ctx.db.insert("sources", {
      userId,
      storageId: args.storageId,
      name: "large-e2e-test.pdf",
      type: "pdf",
      subject: "Biology",
      size: args.size,
      status: "queued",
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const _cleanupSource = internalMutation({
  args: { sourceId: v.id("sources") },
  handler: async (ctx, args) => {
    const source = await ctx.db.get(args.sourceId);
    if (!source) return;
    const chunks = await ctx.db
      .query("chunks")
      .withIndex("by_source", (q) => q.eq("sourceId", args.sourceId))
      .collect();
    for (const chunk of chunks) await ctx.db.delete(chunk._id);
    await ctx.storage.delete(source.storageId);
    await ctx.db.delete(args.sourceId);
  },
});

interface BigTestResult {
  pass: boolean;
  seconds: number;
  finalStatus: string;
  stage: string | null;
  pageCount: number | null;
  chunkCount: number | null;
  error: string | null;
  sizeMB: number;
}

export const runBigPipelineTest = internalAction({
  args: { storageId: v.id("_storage"), size: v.number() },
  handler: async (ctx, args): Promise<BigTestResult> => {
    const userId = await ctx.runQuery(internal.bigTest._anyUserId, {});
    const sourceId = await ctx.runMutation(internal.bigTest._insertBigTestSource, {
      storageId: args.storageId,
      size: args.size,
    });
    const started = Date.now();
    try {
      // The REAL pipeline action, exactly as scheduled in production.
      await ctx.runAction(internal.processSourceActions.processSource, {
        sourceId,
        userId,
        storageId: args.storageId,
        type: "pdf",
      });
      const finished = Date.now();
      let finalStatus = "unknown";
      let stage: string | null = null;
      let error: string | null = null;
      let pageCount: number | null = null;
      let chunkCount: number | null = null;
      for (let i = 0; i < 60; i++) {
        await new Promise((r) => setTimeout(r, 1000));
        const s = await ctx.runQuery(internal.processSource._getSource, { sourceId });
        if (!s) break;
        finalStatus = s.status;
        stage = s.stage ?? null;
        error = s.error ?? null;
        pageCount = s.pageCount ?? null;
        chunkCount = s.chunkCount ?? null;
        if (s.status === "ready" || s.status === "failed") break;
      }
      return {
        pass: finalStatus === "ready",
        seconds: Math.round((finished - started) / 1000),
        finalStatus,
        stage,
        pageCount,
        chunkCount,
        error: error?.slice(0, 300) ?? null,
        sizeMB: Math.round(args.size / 1024 / 1024),
      };
    } finally {
      await ctx.runMutation(internal.bigTest._cleanupSource, { sourceId });
    }
  },
});
