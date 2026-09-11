"use node";

/**
 * TEMPORARY diagnostic driver — investigating the
 * '[gateway:gpt-4o-mini] Unauthorized' failure on grounded turns.
 * Delete after diagnosis.
 */
import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import {
  geminiFileSearchStream,
  geminiPlainStream,
  resolveGeminiStoreName,
  GEMINI_TUTOR_MODEL,
  GEMINI_TUTOR_FALLBACK_MODELS,
  EDEXCEL_TUTOR_SYSTEM_PROMPT,
} from "./lib/gemini";
import { chatCompletion } from "./lib/ai";

// ── 1. Read the REAL stored errors from recent failed tutor messages ───────
// (declared in the V8 file diag3Data.ts)

// ── 2. Time each leg of the grounded chain exactly as the app calls it ─────

export const probeChain = internalAction({
  args: { query: v.optional(v.string()) },
  handler: async (_ctx, args): Promise<Record<string, unknown>> => {
    const query = args.query ?? "What is osmosis?";
    const storeName = await resolveGeminiStoreName();
    if (!storeName) return { error: "no store configured" };

    const models = [GEMINI_TUTOR_MODEL, ...GEMINI_TUTOR_FALLBACK_MODELS];
    const attempts: Array<Record<string, unknown>> = [];

    for (const model of models) {
      const t0 = Date.now();
      try {
        const result = await geminiFileSearchStream({
          contents: [{ role: "user", text: query }],
          storeName,
          model,
          systemPrompt:
            "You are a tutor. Answer briefly from the sources. Cite the document.",
          onDelta: () => {},
        });
        attempts.push({
          model,
          ms: Date.now() - t0,
          ok: true,
          answerHead: result.content.slice(0, 80),
          citations: result.citations.length,
        });
        break; // chain stops at first success, like the real call
      } catch (err) {
        attempts.push({
          model,
          ms: Date.now() - t0,
          ok: false,
          error: String(err instanceof Error ? err.message : err).slice(0, 200),
        });
      }
    }

    return { attempts, storeName };
  },
});

// ── 3. Bare Gemini sweep: is this a Gemini-wide incident right now? ────────

export const probeBareSweep = internalAction({
  args: {},
  handler: async (_ctx, _args): Promise<Record<string, unknown>> => {
    const models = [GEMINI_TUTOR_MODEL, ...GEMINI_TUTOR_FALLBACK_MODELS];
    const results: Array<Record<string, unknown>> = [];

    for (const model of models) {
      const t0 = Date.now();
      try {
        const r = await geminiPlainStream({
          messages: [{ role: "user", content: "Reply with the single word: OK" }],
          model,
          onDelta: () => {},
        });
        results.push({
          model,
          ms: Date.now() - t0,
          ok: true,
          head: r.content.slice(0, 40),
        });
      } catch (err) {
        results.push({
          model,
          ms: Date.now() - t0,
          ok: false,
          error: String(err instanceof Error ? err.message : err).slice(0, 200),
        });
      }
    }

    // Also probe the two quick-chain models (flashcards' first choices)
    for (const model of ["gemini-2.5-flash-lite", "gemini-2.5-flash"]) {
      const t0 = Date.now();
      try {
        const r = await geminiPlainStream({
          messages: [{ role: "user", content: "Reply with the single word: OK" }],
          model,
          onDelta: () => {},
        });
        results.push({
          model: `${model} (quick)`,
          ms: Date.now() - t0,
          ok: true,
          head: r.content.slice(0, 40),
        });
      } catch (err) {
        results.push({
          model: `${model} (quick)`,
          ms: Date.now() - t0,
          ok: false,
          error: String(err instanceof Error ? err.message : err).slice(0, 200),
        });
      }
    }

    return { results };
  },
});

// ── 4. Flashcards' actual chain end-to-end ─────────────────────────────────

export const probeFlashcardsChain = internalAction({
  args: {},
  handler: async (_ctx, _args): Promise<Record<string, unknown>> => {
    const messages = [
      { role: "system" as const, content: "Return only JSON." },
      {
        role: "user" as const,
        content:
          'Make 1 flashcard about osmosis. Return JSON array like [{"question":"...","answer":"..."}]',
      },
    ];
    const t0 = Date.now();
    try {
      const r = await chatCompletion(messages, { temperature: 0.3 });
      return { ms: Date.now() - t0, ok: true, head: r.content.slice(0, 80) };
    } catch (err) {
      return {
        ms: Date.now() - t0,
        ok: false,
        error: String(err instanceof Error ? err.message : err).slice(0, 300),
      };
    }
  },
});

// ── 6. Replay the REAL grounded request: exact metadata filter, real store,
// real system prompt, fileSearch tool — mirrors chats.ts:502-541 1:1.
export const probeRealGrounded = internalAction({
  args: { subject: v.string(), userId: v.string() },
  handler: async (_ctx, args): Promise<Record<string, unknown>> => {
    void _ctx;
    const storeName = await resolveGeminiStoreName();
    const esc = args.subject.replace(/"/g, '\\"');
    const filter = `(owner = "${args.userId}" AND subject = "${esc}") OR (owner = "shared" AND (subject = "All" OR subject = "${esc}"))`;
    const contents: Array<{ role: "user" | "model"; text: string }> = [
      {
        role: "user",
        text: "Explain the lock and key model of enzyme action.",
      },
    ];
    const attempts: Array<Record<string, unknown>> = [];
    for (const model of [GEMINI_TUTOR_MODEL, ...GEMINI_TUTOR_FALLBACK_MODELS]) {
      const t0 = Date.now();
      try {
        const r = await geminiFileSearchStream({
          contents,
          storeName,
          metadataFilter: filter,
          systemPrompt: EDEXCEL_TUTOR_SYSTEM_PROMPT,
          onDelta: () => {},
        });
        attempts.push({ model, ms: Date.now() - t0, ok: true, cites: r.citations.length });
        break;
      } catch (err) {
        attempts.push({
          model,
          ms: Date.now() - t0,
          ok: false,
          error: String(err instanceof Error ? err.message : err).slice(0, 250),
        });
      }
    }
    return { filter, storeName, attempts };
  },
});

// ── 7. Replay the REAL non-grounded request: system + history + current msg,
// exactly as streamChatCompletion passes them to geminiPlainStream.
export const probeRealPlain = internalAction({
  args: {},
  handler: async (_ctx, _args): Promise<Record<string, unknown>> => {
    void _ctx;
    const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
      {
        role: "system",
        content:
          "You are an AI tutor for Edexcel exam board students. Explain concepts step-by-step in language suitable for a student revising for exams.",
      },
      { role: "user", content: "Hi" },
      { role: "assistant", content: "Hi! Ready to revise? What shall we look at today?" },
      { role: "user", content: "Give me a quick summary of osmosis." },
    ];
    const attempts: Array<Record<string, unknown>> = [];
    for (const model of [GEMINI_TUTOR_MODEL, ...GEMINI_TUTOR_FALLBACK_MODELS]) {
      const t0 = Date.now();
      try {
        const r = await geminiPlainStream({
          messages,
          temperature: 0.7,
          maxTokens: 4000,
          onDelta: () => {},
        });
        attempts.push({
          model,
          ms: Date.now() - t0,
          ok: true,
          head: r.content.slice(0, 60),
        });
        break;
      } catch (err) {
        attempts.push({
          model,
          ms: Date.now() - t0,
          ok: false,
          error: String(err instanceof Error ? err.message : err).slice(0, 250),
        });
      }
    }
    return { attempts };
  },
});


