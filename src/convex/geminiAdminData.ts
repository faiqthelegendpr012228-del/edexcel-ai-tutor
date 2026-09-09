//
// TEMPORARY V8-runtime helpers for the geminiAdmin diagnostic driver —
// deleted together with it after the duplicate cleanup + race-fix work.
// (Convex: a "use node" file may only export actions, so the DB-reading
// query/mutation live here in the default runtime.)
//
import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";

export const _allSources = internalQuery({
  args: {},
  handler: async (
    ctx,
  ): Promise<
    Array<{
      id: Id<"sources">;
      name: string;
      geminiDocName: string | null;
      createdAt: number;
      status: string;
    }>
  > => {
    const rows = await ctx.db.query("sources").order("desc").take(40);
    return rows.map((s: Doc<"sources">) => ({
      id: s._id,
      name: s.name,
      geminiDocName: s.geminiDocName ?? null,
      createdAt: s.createdAt,
      status: s.status,
    }));
  },
});

export const repointSourceDoc = internalMutation({
  args: { sourceId: v.id("sources"), geminiDocName: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.sourceId, {
      geminiDocName: args.geminiDocName,
      updatedAt: Date.now(),
    });
    return { repointed: args.sourceId };
  },
});

// --- race-test scaffolding (temporary) -------------------------------------

export const insertRaceRow = internalMutation({
  args: { userId: v.id("users"), storageId: v.id("_storage"), name: v.string() },
  handler: async (ctx, args) => {
    const now = Date.now();
    return await ctx.db.insert("sources", {
      userId: args.userId,
      storageId: args.storageId,
      name: args.name,
      type: "txt",
      subject: "Biology",
      size: 64,
      status: "ready",
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const dropRaceRow = internalMutation({
  args: { sourceId: v.id("sources") },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.sourceId);
  },
});

export const getRow = internalQuery({
  args: { sourceId: v.id("sources") },
  handler: async (ctx, args) => {
    const s = await ctx.db.get(args.sourceId);
    if (!s) return null;
    return {
      geminiDocName: s.geminiDocName ?? null,
      claimAt: s.geminiUploadClaimAt ?? null,
      claimedBy: s.geminiUploadClaimedBy ?? null,
    };
  },
});
