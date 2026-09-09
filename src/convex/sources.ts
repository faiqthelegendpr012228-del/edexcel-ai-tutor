import { getAuthUserId } from "@convex-dev/auth/server";
import { v, type GenericId } from "convex/values";
import {
  action,
  internalMutation,
  mutation,
  query,
  type MutationCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { QUALIFICATIONS } from "../lib/curriculum";
import {
  LARGE_FILE_BYTES,
  LARGE_COOLDOWN_MS,
  largeUploadRemainingMs,
  formatRemainingCooldown,
  SOURCE_STUCK_AFTER_MS,
} from "./lib/limits";

type Id<T extends string> = GenericId<T>;

// Every subject name the curriculum defines, across all qualifications.
// Personal uploads must carry one of these tags — enforced here on the
// backend, not just in the UI, so no path can save an untagged file.
const KNOWN_SUBJECTS = new Set(
  QUALIFICATIONS.flatMap((q) => q.subjects.map((s) => s.name)),
);

function validateSubject(subject: string): string {
  const trimmed = subject.trim();
  if (!trimmed) {
    throw new Error("A subject tag is required for uploads.");
  }
  if (!KNOWN_SUBJECTS.has(trimmed)) {
    throw new Error(
      `Unknown subject "${trimmed}" — pick one from your qualification's subject list.`,
    );
  }
  return trimmed;
}

// ---------------------------------------------------------------------------
// Upload + source lifecycle
// ---------------------------------------------------------------------------

/**
 * Upload-url gate: small files pass freely; a "large" file (> 25 MB, the
 * scanned-textbook case we can detect before processing) requires the
 * per-student cooldown window to have passed. Page-count-based large files
 * (100+ text pages, small on disk) are stamped in processSource so the
 * cooldown also covers them for the next upload.
 */
export const generateUploadUrl = mutation({
  args: { size: v.number() },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");

    if (args.size > LARGE_FILE_BYTES) {
      const row = await ctx.db
        .query("uploadCooldowns")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .first();
      const remaining = largeUploadRemainingMs(
        row?.lastLargeUploadAt,
        Date.now(),
      );
      if (remaining > 0) {
        throw new Error(
          `That file is large (over 25 MB). To keep processing fast for everyone, large uploads are limited to one every 90 minutes — try again in ${formatRemainingCooldown(remaining)}. Small files are unaffected.`,
        );
      }
    }

    return await ctx.storage.generateUploadUrl();
  },
});

/** Stamp the cooldown when a large upload lands. */
async function stampLargeUpload(
  ctx: MutationCtx,
  userId: Id<"users">,
): Promise<void> {
  const row = await ctx.db
    .query("uploadCooldowns")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .first();
  const now = Date.now();
  if (row) {
    await ctx.db.patch(row._id, { lastLargeUploadAt: now, updatedAt: now });
  } else {
    await ctx.db.insert("uploadCooldowns", {
      userId,
      lastLargeUploadAt: now,
      updatedAt: now,
    });
  }
}

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
    // Required and validated server-side: personal uploads always carry
    // exactly one subject tag, which drives per-subject retrieval scoping.
    subject: v.string(),
    qualification: v.optional(v.string()),
    collectionId: v.optional(v.id("collections")),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");

    const subject = validateSubject(args.subject);

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
      subject,
      qualification: args.qualification,
      collectionId: args.collectionId,
      size: args.size,
      status: "queued",
      createdAt: now,
      updatedAt: now,
    });

    // Large uploads start the cooldown window immediately.
    if (args.size > LARGE_FILE_BYTES) {
      await stampLargeUpload(ctx, userId);
    }

    await ctx.scheduler.runAfter(0, internal.processSourceActions.processSource, {
      sourceId,
      userId,
      storageId: args.storageId,
      type: args.type,
    });

    // Mirror the file into the Gemini File Search Store (when configured) so
    // tutor answers can ground against it, scoped by subject metadata.
    await ctx.scheduler.runAfter(0, internal.processSourceActions.uploadToGemini, {
      sourceId,
      userId,
      storageId: args.storageId,
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
      stage: "queued",
      stageDetail: undefined,
      error: undefined,
      // Fresh manual run: restore the one-shot automatic requeue budget.
      requeuedAt: undefined,
      updatedAt: Date.now(),
    });

    await ctx.scheduler.runAfter(0, internal.processSourceActions.processSource, {
      sourceId: args.sourceId,
      userId,
      storageId: source.storageId,
      type: source.type,
    });

    // Retry the Gemini mirror too — the action no-ops when the key is
    // missing or the document is already indexed.
    await ctx.scheduler.runAfter(0, internal.processSourceActions.uploadToGemini, {
      sourceId: args.sourceId,
      userId,
      storageId: source.storageId,
    });
  },
});

/**
 * Find the real error (if any) a scheduled processing run recorded for this
 * source. `_scheduled_functions` is the API mirror of the dashboard's
 * function log, so we can surface the actual failure (OOM, timeout, …) on
 * the source row instead of a generic "interrupted" message. Returns null
 * when no failed invocation was found.
 */
async function lastInvocationError(
  ctx: MutationCtx,
  sourceId: string,
): Promise<string | null> {
  const rows = await ctx.db.system
    .query("_scheduled_functions")
    .order("desc")
    .take(200);
  for (const row of rows) {
    if (!row.name.includes("processSourceActions")) continue;
    const arg = (row.args as unknown[] | undefined)?.[0] as
      | { sourceId?: unknown }
      | undefined;
    if (arg?.sourceId !== sourceId) continue;
    const state = row.state as { kind?: string; error?: string };
    if (state?.kind === "failed") {
      return state.error?.split("\n")[0].slice(0, 220) ?? "Unknown action failure";
    }
  }
  return null;
}

/**
 * Watchdog (runs every 5 min from crons.ts): a source whose processing
 * action died mid-run would hang in queued/processing forever — no catch
 * block runs when the action itself is killed.
 *
 * Two cases, handled differently:
 *  - queued (the scheduled action never started — nothing happened yet):
 *    automatically re-schedule the run ONCE. Convex executes actions at
 *    most once, so a scheduler miss would otherwise hang the upload forever
 *    with only a manual Retry as recourse. A second miss flips it to failed.
 *  - processing (the action started and died mid-run): flip to failed,
 *    keeping the last-known stage so the card shows where it stopped.
 *    Re-running automatically could overlap real partial work, so these
 *    stay manual (Retry) on purpose.
 *
 * Both failure paths record the REAL error from the invocation log when one
 * exists (e.g. the 512MB Node memory limit), so students and operators see
 * the actual cause instead of a vague interruption notice.
 */
export const failStaleProcessingSources = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - SOURCE_STUCK_AFTER_MS;
    const stale = await ctx.db
      .query("sources")
      .withIndex("by_status_updated", (q) =>
        q.eq("status", "processing").lt("updatedAt", cutoff),
      )
      .collect();
    // queued sources can get stuck too (e.g. the scheduled action never ran).
    const staleQueued = await ctx.db
      .query("sources")
      .withIndex("by_status_updated", (q) =>
        q.eq("status", "queued").lt("updatedAt", cutoff),
      )
      .collect();

    for (const source of stale) {
      const realError = await lastInvocationError(ctx, source._id);
      const message = realError
        ? /out of memory|512 MB/i.test(realError)
          ? "This file is too large to process in one pass — the server ran out of memory (a hard 512 MB limit per job). Split it into smaller files (e.g. by unit or chapter) and upload them separately: same content, and every other feature works."
          : `Processing failed inside the run: ${realError} — hit Retry to try again.`
        : "Processing didn't complete (the run was interrupted). Nothing was lost — hit Retry to re-run it from the same file.";
      await ctx.db.patch(source._id, {
        status: "failed",
        error: message,
        updatedAt: Date.now(),
      });
    }

    for (const source of staleQueued) {
      // Already re-scheduled once and it STILL never started: stop trying.
      if (source.requeuedAt !== undefined) {
        const realError = await lastInvocationError(ctx, source._id);
        await ctx.db.patch(source._id, {
          status: "failed",
          error: realError
            ? `Processing never started: ${realError} — hit Retry to try again.`
            : "Processing never started after an automatic retry. Hit Retry to try again from the same file.",
          updatedAt: Date.now(),
        });
        continue;
      }
      // One free automatic requeue: cheap (no partial data to conflict with)
      // and turns a scheduler miss into a self-healing blip for the student.
      await ctx.db.patch(source._id, {
        requeuedAt: Date.now(),
        updatedAt: Date.now(),
      });
      await ctx.scheduler.runAfter(0, internal.processSourceActions.processSource, {
        sourceId: source._id,
        userId: source.userId,
        storageId: source.storageId,
        type: source.type,
      });
    }
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

    // Best-effort removal from the Gemini File Search Store.
    if (source.geminiDocName) {
      try {
        const { deleteFromGeminiStore } = await import("./lib/gemini");
        await deleteFromGeminiStore(source.geminiDocName);
      } catch (err) {
        console.warn(
          `[sources] Gemini delete failed for ${args.sourceId}: ${err instanceof Error ? err.message : err}`,
        );
      }
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

/** Remaining large-upload cooldown (ms), for the Sources page hint. */
export const getCooldown = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return { remainingMs: 0 };
    const row = await ctx.db
      .query("uploadCooldowns")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();
    return {
      remainingMs: largeUploadRemainingMs(row?.lastLargeUploadAt, Date.now()),
    };
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
    // Subject can be re-tagged but never cleared or set to an unknown value,
    // so scoping metadata stays consistent for every source.
    subject: v.optional(v.string()),
    qualification: v.optional(v.string()),
    collectionId: v.optional(v.union(v.id("collections"), v.null())),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    const source = await ctx.db.get(args.sourceId);
    if (!source || source.userId !== userId) throw new Error("Not found");

    if (args.subject !== undefined) {
      validateSubject(args.subject);
    }

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