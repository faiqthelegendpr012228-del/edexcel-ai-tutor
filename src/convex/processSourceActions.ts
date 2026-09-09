//
// Node-runtime actions for the source-processing pipeline. Split from
// `processSource.ts` because Convex only allows actions in "use node" files,
// while that module also hosts the mutations/queries these actions call
// (internal.processSource.*).
//
// Runs in Node: file parsing (Buffer via lib/extract) and the Gemini SDK both
// require it. Without the directive the action lands in the V8 runtime where
// `Buffer` is undefined and every upload dies with "Buffer is not defined".
"use node";

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import {
  EMBEDDING_MODEL,
  chatCompletion,
  embedTexts,
  hasEmbeddingsConfigured,
} from "./lib/ai";
import {
  chunkDocument,
  extractText,
  normalizeExtractedText,
  type Chunk,
} from "./lib/extract";
import {
  deleteFromGeminiStore,
  hasGeminiKey,
  resolveGeminiStoreName,
  uploadToGeminiStore,
} from "./lib/gemini";
import { LARGE_PAGE_COUNT } from "./lib/limits";

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
      // Stage is written BEFORE the file is loaded: pulling a 150MB blob into
      // memory is the first memory-heavy step (OOM here used to leave the row
      // stuck on the initial "queued" stage with no diagnosis).
      await ctx.runMutation(internal.processSource.markSourceStage, {
        sourceId: args.sourceId,
        userId: args.userId,
        stage: "extracting",
      });
      // -------------------------------------------------------------
      // Stage: extracting. PDFs parse page by page, so report real
      // progress ("212/430") as each parallel slice completes. Writes are
      // throttled and fire-and-forget: they must never slow or break the
      // pipeline itself. Each write also refreshes updatedAt, which is the
      // liveness signal the stuck-source watchdog reads.
      // -------------------------------------------------------------
      let lastProgressWrite = 0;
      let progressWrite: Promise<unknown> = Promise.resolve();
      const reportProgress = (done: number, total: number) => {
        const now = Date.now();
        if (now - lastProgressWrite < 2000) return;
        lastProgressWrite = now;
        progressWrite = progressWrite
          .then(() =>
            ctx.runMutation(internal.processSource.markSourceStage, {
              sourceId: args.sourceId,
              userId: args.userId,
              stage: "extracting",
              stageDetail: `${done}/${total}`,
            }),
          )
          .catch(() => undefined);
      };

      const extracted = await (async () => {
        const file = await ctx.storage.get(args.storageId);
        if (file === null) return null;
        // Stream the blob into ONE owned buffer. `file.arrayBuffer()` would
        // briefly hold two full copies (the Blob's internal + the returned
        // buffer), and pdf.js's fake-worker loopback port clones the data
        // AGAIN on the way in — three copies of a 150MB file overflow the
        // hard 512MB Node action limit. This keeps the peak at two.
        const buf = Buffer.allocUnsafe(file.size);
        let offset = 0;
        for await (const chunk of file.stream() as unknown as AsyncIterable<Uint8Array>) {
          buf.set(chunk, offset);
          offset += chunk.byteLength;
        }
        // Node actions get a hard 512MB. The raw bytes already sit in memory,
        // so parallel page parsing multiplies on top of that — big files get
        // a lower slice size to keep the pdf.js working set bounded.
        const pageConcurrency =
          file.size > 50 * 1024 * 1024 ? 3 : PDF_EXTRACT_CONCURRENCY;
        return await extractText(args.type, buf, {
          pageConcurrency,
          onProgress: reportProgress,
        });
      })();
      await progressWrite.catch(() => undefined);

      if (extracted === null) {
        await fail("The uploaded file could not be found in storage.");
        return;
      }
      const pages = extracted.pages.slice(0, MAX_PAGES_PROCESSED);
      const text = normalizeExtractedText(extracted.text);
      if (!text) {
        await fail(
          "This PDF has no selectable text — it's a scanned/image-only book (which is also why it's so large). Lumen can't index pages it can't read. Try a text-based copy of the book, or split it and check whether your copy of Pearson ActiveLearn provides the digital text version.",
        );
        return;
      }

      // -----------------------------------------------------------------
      // Stage: chunking. Pure CPU over already-extracted text — typically
      // fast, so it's persisted as a distinct but brief stage rather than
      // faked with progress counts.
      // -----------------------------------------------------------------
      await ctx.runMutation(internal.processSource.markSourceStage, {
        sourceId: args.sourceId,
        userId: args.userId,
        stage: "chunking",
      });
      const chunks = chunkDocument({ ...extracted, pages }).slice(0, MAX_CHUNKS);

      // Surface the page count immediately so the card shows progress while
      // embeddings are still being generated.
      await ctx.runMutation(internal.processSource.markSourceProgress, {
        sourceId: args.sourceId,
        userId: args.userId,
        pageCount: pages.length,
      });

      // -------------------------------------------------------------------
      // Embed + write as one pipeline: while the DB write for batch N runs,
      // the embedding request for batch N+1 is already in flight. This hides
      // embedding latency behind writes and is the main wall-clock win for
      // big books. If an embed batch fails, the source falls back to keyword
      // mode with whatever was written so far.
      // -------------------------------------------------------------------
      let retrievalMode: "semantic" | "keyword" = "keyword";
      let pipelineSucceeded = false;
      // Re-embed when the stored vectors came from a different embedding
      // model (or predate model stamping) — mixing vector spaces would
      // silently break semantic search for older uploads.
      const stored = await ctx.runQuery(internal.processSource._getSource, {
        sourceId: args.sourceId,
      });
      const needsEmbedding = stored?.embeddingModel !== EMBEDDING_MODEL;
      const hasEmbeddings = hasEmbeddingsConfigured() && needsEmbedding;
      let topics: string[] | undefined;

      if (hasEmbeddings && chunks.length > 0) {
        try {
          // -------------------------------------------------------------
          // Stage: embedding. The write loop below lands chunks in small
          // batches, so progress is real: writtenChunks/chunks.length is
          // persisted after every batch write.
          // -------------------------------------------------------------
          await ctx.runMutation(internal.processSource.markSourceStage, {
            sourceId: args.sourceId,
            userId: args.userId,
            stage: "embedding",
            stageDetail: `0/${chunks.length}`,
          });
          let writtenChunks = 0;
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
            writtenChunks += writeBatch.length;
            await ctx.runMutation(internal.processSource.markSourceStage, {
              sourceId: args.sourceId,
              userId: args.userId,
              stage: "embedding",
              stageDetail: `${Math.min(writtenChunks, chunks.length)}/${chunks.length}`,
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
      } else if (
        !needsEmbedding &&
        chunks.length > 0 &&
        hasEmbeddingsConfigured()
      ) {
        // Vectors already match the current model (e.g. a retry after a
        // stuck run) — keep the existing semantic chunks intact.
        retrievalMode = "semantic";
      } else {
        try {
          topics = await detectTopics(text.slice(0, 6000));
        } catch {
          topics = undefined;
        }
      }

      // Stage: finalizing — topic detection + the ready write. Brief, but
      // distinct from embedding so a hang here is attributable.
      await ctx.runMutation(internal.processSource.markSourceStage, {
        sourceId: args.sourceId,
        userId: args.userId,
        stage: "finalizing",
      });

      await ctx.runMutation(internal.processSource.markSourceReady, {
        sourceId: args.sourceId,
        userId: args.userId,
        chunkCount: chunks.length,
        pageCount: pages.length,
        topicsDetected: topics,
        retrievalMode,
        embeddingModel:
          retrievalMode === "semantic" ? EMBEDDING_MODEL : undefined,
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

/**
 * Push the uploaded file into the Gemini File Search Store tagged with the
 * owner and subject metadata, so tutor answers can be scoped per student and
 * per subject. Runs alongside (not inside) the local extraction pipeline.
 *
 * Race safety: eligibility is decided by an ATOMIC claim mutation before any
 * bytes move, and the claim is released on every exit path. Two concurrent
 * runs (create + retry, or a watchdog requeue) can therefore never both
 * upload — the loser aborts with zero store writes. As a second layer, the
 * row is re-checked after the upload completes and any document created by a
 * racing winner is deleted, so no duplicate can survive even if claims were
 * bypassed.
 */
export const uploadToGemini = internalAction({
  args: {
    sourceId: v.id("sources"),
    userId: v.id("users"),
    storageId: v.id("_storage"),
  },
  handler: async (ctx, args) => {
    if (!hasGeminiKey()) return;
    const runId = `${args.sourceId}@${Date.now()}`;

    const source = await ctx.runQuery(internal.processSource._getSource, {
      sourceId: args.sourceId,
    });
    if (!source || source.userId !== args.userId) return;
    if (source.geminiDocName) return; // already indexed

    // ---------------------------------------------------------------
    // Atomic claim. Anything but "ok" means someone else owns the
    // upload (or it already exists) — abort with no store writes.
    // ---------------------------------------------------------------
    const claim = await ctx.runMutation(internal.processSource.claimGeminiUpload, {
      sourceId: args.sourceId,
      runId,
    });
    if (!claim.claimed) return;

    try {
      const storeName = await resolveGeminiStoreName();
      const file = await ctx.storage.get(args.storageId);
      if (!file) return;
      // Pass the storage blob straight through (wrapped to attach the mime
      // type) — no full-file copy in memory.
      const blob = new Blob([file], { type: geminiMimeForType(source.type) });
      const displayName = source.name;
      const docName = await uploadToGeminiStore({
        storeName,
        file: blob,
        displayName,
        ownerUserId: args.userId,
        subject: source.subject,
      });

      // Cross-row dedupe: if a racing run's doc with the same owner +
      // displayName is already recorded, keep it, register it here too, and
      // delete OUR redundant copy. Belt-and-braces on top of the claim.
      const dup = await ctx.runQuery(
        internal.processSource._findGeminiDuplicate,
        {
          userId: args.userId,
          name: displayName,
          excludeSourceId: args.sourceId,
        },
      );
      if (dup) {
        try {
          await deleteFromGeminiStore(docName);
        } catch {
          // Non-fatal: the extra doc costs retrieval noise, not correctness.
        }
        await ctx.runMutation(internal.processSource.setGeminiDocName, {
          sourceId: args.sourceId,
          userId: args.userId,
          geminiDocName: dup,
        });
        return;
      }

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
    } finally {
      // Our run is done (success, skip, or failure) — drop the claim so a
      // future retry isn't blocked by it. Never clears another run's claim.
      await ctx.runMutation(internal.processSource.releaseGeminiClaim, {
        sourceId: args.sourceId,
        runId,
      });
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
