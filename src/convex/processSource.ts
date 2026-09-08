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
import {
  hasGeminiKey,
  resolveGeminiStoreName,
  uploadToGeminiStore,
} from "./lib/gemini";

// Internal source-processing pipeline (scheduled from `createSource` and
// `retrySource`). Lives in its own module so `sources.ts` can reference these
// through `internal.processSource.*` without circular type inference.

// Sanity caps so a single upload can't blow through action timeouts/costs.
// 600 pages covers full textbooks; chunking keeps ~1500 chars per passage.
const MAX_PAGES_PROCESSED = 600;
const MAX_CHUNKS = 2000;
// Chunks are written in small batches so large books stay well under the
// per-transaction document-size limit.
const CHUNK_WRITE_BATCH = 50;
// PDF pages are extracted in parallel slices to cut wall-clock time on
// multi-hundred-page textbooks (text extraction is CPU-bound per page).
const PDF_EXTRACT_CONCURRENCY = 6;

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

      // Parallel page extraction inside extractText (PDF pages are pulled in
      // slices of PDF_EXTRACT_CONCURRENCY).
      const extracted = await extractText(args.type, bytes, {
        pageConcurrency: PDF_EXTRACT_CONCURRENCY,
      });
      const pages = extracted.pages.slice(0, MAX_PAGES_PROCESSED);
      const text = normalizeExtractedText(extracted.text);
      if (!text) {
        await fail(
          "We couldn't find any readable text in this file. It may be a scanned document or contain only images.",
        );
        return;
      }

      // Surface the page count immediately so the card shows progress while
      // embeddings are still being generated.
      await ctx.runMutation(internal.processSource.markSourceProgress, {
        sourceId: args.sourceId,
        userId: args.userId,
        pageCount: pages.length,
      });

      const chunks = chunkDocument({ ...extracted, pages }).slice(0, MAX_CHUNKS);

      // -------------------------------------------------------------------
      // Embed + write as one pipeline: while the DB write for batch N runs,
      // the embedding request for batch N+1 is already in flight. This hides
      // embedding latency behind writes and is the main wall-clock win for
      // big books. If an embed batch fails, the source falls back to keyword
      // mode with whatever was written so far.
      // -------------------------------------------------------------------
      let retrievalMode: "semantic" | "keyword" = "keyword";
      let pipelineSucceeded = false;
      const hasEmbeddings = hasEmbeddingsConfigured();
      let topics: string[] | undefined;

      if (hasEmbeddings && chunks.length > 0) {
        try {
          const EMBED_BATCH = 32;
          let nextEmbed = 0;
          let inFlight: Promise<number[][]> | null = null;

          const startNextEmbed = (): boolean => {
            if (nextEmbed >= chunks.length) return false;
            const slice = chunks.slice(nextEmbed, nextEmbed + EMBED_BATCH);
            nextEmbed += EMBED_BATCH;
            inFlight = embedTexts(slice.map((c) => c.content)).then(
              (vecs) => vecs,
              () => {
                failedEmbed = true;
                return [] as number[][];
              },
            );
            return true;
          };

          let pending: number[][] = [];
          let failed = false;
          let failedEmbed = false;

          for (let i = 0; i < chunks.length && !failed; i += CHUNK_WRITE_BATCH) {
            const writeBatch = chunks.slice(i, i + CHUNK_WRITE_BATCH);
            const writeBatchEmbeds: number[][] = [];

            while (writeBatchEmbeds.length < writeBatch.length) {
              if (pending.length > 0) {
                const take = Math.min(
                  pending.length,
                  writeBatch.length - writeBatchEmbeds.length,
                );
                writeBatchEmbeds.push(...pending.splice(0, take));
              } else if (inFlight) {
                const arrived = await inFlight;
                inFlight = null;
                if (failedEmbed) {
                  failed = true;
                  break;
                }
                pending = arrived;
              } else if (!startNextEmbed()) {
                break;
              }
            }

            if (failed) break;

            await ctx.runMutation(internal.processSource.writeChunks, {
              sourceId: args.sourceId,
              userId: args.userId,
              chunks: writeBatch,
              embeddings: writeBatchEmbeds,
              replaceExisting: i === 0,
              pageCount: i === 0 ? pages.length : undefined,
            });

            // Kick off the next embed batch while nothing else is pending.
            startNextEmbed();
          }

          pipelineSucceeded = !failed;
        } catch (err) {
          console.warn(
            `[sources] Embedding pipeline failed for ${args.sourceId}, falling back to keyword: ${err instanceof Error ? err.message : err}`,
          );
        }
      }

      if (pipelineSucceeded) {
        retrievalMode = "semantic";
      } else {
        try {
          topics = await detectTopics(text.slice(0, 6000));
        } catch {
          topics = undefined;
        }
      }

      await ctx.runMutation(internal.processSource.markSourceReady, {
        sourceId: args.sourceId,
        userId: args.userId,
        chunkCount: chunks.length,
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
  },
  handler: async (ctx, args) => {
    const source = await ctx.db.get(args.sourceId);
    if (!source || source.userId !== args.userId) return;
    await ctx.db.patch(args.sourceId, {
      status: "ready",
      chunkCount: args.chunkCount,
      pageCount: args.pageCount,
      topicsDetected: args.topicsDetected,
      retrievalMode: args.retrievalMode,
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

/**
 * Push the uploaded file into the Gemini File Search Store tagged with the
 * owner and subject metadata, so tutor answers can be scoped per student and
 * per subject. Runs alongside (not inside) the local extraction pipeline.
 */
export const uploadToGemini = internalAction({
  args: {
    sourceId: v.id("sources"),
    userId: v.id("users"),
    storageId: v.id("_storage"),
  },
  handler: async (ctx, args) => {
    if (!hasGeminiKey()) return;
    const source = await ctx.runQuery(internal.processSource._getSource, {
      sourceId: args.sourceId,
    });
    if (!source || source.userId !== args.userId) return;
    if (source.geminiDocName) return; // already indexed

    try {
      const storeName = await resolveGeminiStoreName();
      const file = await ctx.storage.get(args.storageId);
      if (!file) return;
      const bytes = new Uint8Array(await file.arrayBuffer());
      const mimeType = geminiMimeForType(source.type);
      const docName = await uploadToGeminiStore({
        storeName,
        bytes,
        mimeType,
        displayName: source.name,
        ownerUserId: args.userId,
        subject: source.subject,
      });
      await ctx.runMutation(internal.processSource.setGeminiDocName, {
        sourceId: args.sourceId,
        userId: args.userId,
        geminiDocName: docName,
      });
    } catch (err) {
      // Non-fatal: local keyword search still works without the Gemini copy.
      console.error(
        `[sources] Gemini upload failed for ${args.sourceId}: ${err instanceof Error ? err.message : err}`,
      );
    }
  },
});

function geminiMimeForType(type: string): string {
  switch (type) {
    case "pdf":
      return "application/pdf";
    case "docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    case "pptx":
      return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
    case "txt":
      return "text/plain";
    case "md":
      return "text/markdown";
    default:
      return "application/octet-stream";
  }
}
