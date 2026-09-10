"use node";

import { internalAction } from "./_generated/server";
import { v } from "convex/values";
import {
  GEMINI_TUTOR_MODEL,
  GEMINI_QUICK_MODEL,
  geminiFileSearchStream,
  geminiTextCompletion,
  hasGeminiKey,
  resolveGeminiStoreName,
} from "./lib/gemini";
import { chatCompletion, MODELS } from "./lib/ai";

// TEMPORARY diagnostic driver — each probe is a SEPARATE action with a hard
// Promise.race timeout so one hanging layer can't block the others (the
// combined probe timed out, which itself points at a hanging call).

function describe(label: string, err: unknown): Record<string, unknown> {
  const e = err as {
    name?: string;
    message?: string;
    status?: number | string;
    code?: unknown;
    stack?: string;
  };
  return {
    probe: label,
    name: e?.name,
    message: e?.message?.slice(0, 600),
    status: e?.status,
    code: typeof e?.code === "object" ? JSON.stringify(e.code) : e?.code,
    stackFirstLines: e?.stack?.split("\n").slice(0, 4).join(" | "),
  };
}

function withTimeout<T>(ms: number, p: Promise<T>): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`PROBE TIMEOUT after ${ms}ms — call hung, no response`)), ms),
    ),
  ]);
}

// Probe 1: does the Gemini key authenticate at all (model list)?
export const _probeAuth = internalAction({
  args: {},
  handler: async (): Promise<Record<string, unknown>> => {
    const out: Record<string, unknown> = { hasGeminiKey: hasGeminiKey() };
    if (!hasGeminiKey()) return out;
    const { getGeminiClient } = await import("./lib/gemini");
    try {
      const ai = getGeminiClient();
      const res = await withTimeout(30_000, ai.models.list({ config: { pageSize: 5 } }));
      const names: string[] = [];
      for await (const m of res) {
        names.push(m.name ?? "?");
        if (names.length >= 5) break;
      }
      out.modelsListed = names;
      out.ok = true;
    } catch (err) {
      out.ok = false;
      Object.assign(out, describe("auth.models.list", err));
    }
    return out;
  },
});

// Probe 2: store resolution (File Search store lookup).
export const _probeStore = internalAction({
  args: {},
  handler: async (): Promise<Record<string, unknown>> => {
    try {
      const storeName = await withTimeout(30_000, resolveGeminiStoreName());
      return { ok: true, storeName };
    } catch (err) {
      return describe("tutor.resolveGeminiStoreName", err);
    }
  },
});

// Probe 3: the exact Tutor grounded call (fileSearch streaming).
export const _probeTutorStream = internalAction({
  args: { subjectFilter: v.optional(v.string()) },
  handler: async (ctx, args): Promise<Record<string, unknown>> => {
    try {
      const storeName = await resolveGeminiStoreName();
      const res = await withTimeout(
        90_000,
        geminiFileSearchStream({
          contents: [
            { role: "user", text: "In one sentence: what is active transport?" },
          ],
          storeName,
          metadataFilter:
            args.subjectFilter ?? `owner = "shared" OR subject = "All"`,
          onDelta: () => {},
        }),
      );
      return { ok: true, model: GEMINI_TUTOR_MODEL, contentPreview: res.content.slice(0, 200) };
    } catch (err) {
      return describe(`tutor.geminiFileSearchStream(${GEMINI_TUTOR_MODEL})`, err);
    }
  },
});

// Probe 4: the exact Flashcards call through chatCompletion (full chain).
export const _probeFlashcards = internalAction({
  args: {},
  handler: async (): Promise<Record<string, unknown>> => {
    try {
      const res = await withTimeout(
        90_000,
        chatCompletion(
          [
            {
              role: "system",
              content:
                'Reply with ONLY a JSON array like [{"front":"q","back":"a"}]. One card only.',
            },
            { role: "user", content: "Make one flashcard about osmosis." },
          ],
          { model: MODELS.quick, temperature: 0.3, maxTokens: 1000 },
        ),
      );
      return { ok: true, contentPreview: res.content.slice(0, 200) };
    } catch (err) {
      return describe("flashcards.chatCompletion(full chain)", err);
    }
  },
});

// Probe 5: bare Gemini quick call, isolating it from the VLY chain.
export const _probeQuickBare = internalAction({
  args: {},
  handler: async (): Promise<Record<string, unknown>> => {
    try {
      const res = await withTimeout(
        60_000,
        geminiTextCompletion(
          [
            { role: "system", content: "Say OK." },
            { role: "user", content: "ping" },
          ],
          { model: GEMINI_QUICK_MODEL, temperature: 0.3, maxTokens: 500 },
        ),
      );
      return { ok: true, model: GEMINI_QUICK_MODEL, contentPreview: res.content.slice(0, 100) };
    } catch (err) {
      return describe(`bare.geminiTextCompletion(${GEMINI_QUICK_MODEL})`, err);
    }
  },
});

// Probe 7: model-name verification — list gemini-family models this key can
// see, and bare-call the tutor model WITHOUT fileSearch to separate "model
// hangs" from "fileSearch hangs".
export const _probeModelCheck = internalAction({
  args: {},
  handler: async (): Promise<Record<string, unknown>> => {
    const out: Record<string, unknown> = {};
    const { getGeminiClient, GEMINI_TUTOR_MODEL } = await import("./lib/gemini");
    const ai = getGeminiClient();
    // (a) List models (paginate a few pages).
    try {
      const pager = await withTimeout(
        30_000,
        ai.models.list({ config: { pageSize: 100 } }),
      );
      const gemini: string[] = [];
      for await (const m of pager) {
        if (m.name?.includes("gemini")) gemini.push(m.name);
        if (gemini.length >= 60) break;
      }
      out.geminiModels = gemini;
      out.tutorModelInList = gemini.some((n) => n.includes(GEMINI_TUTOR_MODEL.replace("models/", "")));
    } catch (err) {
      out.modelsListError = describe("auth.models.list(100)", err);
    }
    // (b) Bare generateContent on the tutor model, NO tools.
    try {
      const res = await withTimeout(
        45_000,
        ai.models.generateContent({
          model: GEMINI_TUTOR_MODEL,
          contents: "Say OK.",
        }),
      );
      out.bareTutorModel = { ok: true, preview: (res.text ?? "").slice(0, 80) };
    } catch (err) {
      out.bareTutorModel = describe(`bare.generateContent(${GEMINI_TUTOR_MODEL})`, err);
    }
    return out;
  },
});

// Probe 8: VLY key presence (boolean only — never expose the value).
export const _probeEnv = internalAction({
  args: {},
  handler: async (): Promise<Record<string, unknown>> => {
    return {
      vlyIntegrationKeySet: !!process.env.VLY_INTEGRATION_KEY,
      geminiKeySet: !!process.env.GEMINI_API_KEY,
      openaiKeySet: !!process.env.OPENAI_API_KEY,
    };
  },
});

// Probe 9: isolate the hang — bare tutor model vs fileSearch across model
// candidates, each with a hard timeout, to find a working (model, fileSearch)
// pairing for the tutor path.
export const _probeFileSearchMatrix = internalAction({
  args: {},
  handler: async (): Promise<Record<string, unknown>> => {
    const out: Record<string, unknown> = {};
    const { getGeminiClient } = await import("./lib/gemini");
    const ai = getGeminiClient();
    const storeName = await resolveGeminiStoreName();
    out.storeName = storeName;

    const candidates = [
      "gemini-3.8-flash",
      "gemini-3.7-flash",
      "gemini-3.5-flash",
      "gemini-2.5-flash",
    ];

    // (a) Bare generateContent (no tools) on the current tutor model.
    try {
      const res = await withTimeout(
        45_000,
        ai.models.generateContent({
          model: "gemini-3.8-flash",
          contents: "Say OK.",
        }),
      );
      out.bareTutorModel = { ok: true, preview: (res.text ?? "").slice(0, 80) };
    } catch (err) {
      out.bareTutorModel = describe("bare.generateContent(gemini-3.8-flash)", err);
    }

    // (b) fileSearch on each candidate model, 45s hard timeout each.
    const matrix: Record<string, unknown> = {};
    for (const model of candidates) {
      const started = Date.now();
      try {
        const stream = await withTimeout(
          45_000,
          ai.models.generateContentStream({
            model,
            contents: "In one sentence: what is active transport?",
            config: {
              tools: [
                {
                  fileSearch: {
                    fileSearchStoreNames: [storeName],
                  },
                },
              ],
            },
          }),
        );
        let text = "";
        for await (const chunk of stream) {
          text += chunk.text ?? "";
          if (text.length > 200) break;
        }
        matrix[model] = {
          ok: text.trim().length > 0,
          ms: Date.now() - started,
          preview: text.slice(0, 120),
        };
      } catch (err) {
        matrix[model] = { ...describe("fileSearchStream", err), ms: Date.now() - started };
      }
    }
    out.fileSearchMatrix = matrix;
    return out;
  },
});

// Probe 6: bare VLY gateway call (is the platform gateway itself failing?).
export const _probeVly = internalAction({
  args: {},
  handler: async (): Promise<Record<string, unknown>> => {
    try {
      const { vly } = await import("../lib/vly-integrations");
      const res = await withTimeout(
        60_000,
        vly.ai.completion(
          {
            model: MODELS.quick,
            messages: [
              { role: "system", content: "Say OK." },
              { role: "user", content: "ping" },
            ],
            temperature: 0.3,
            maxTokens: 100,
          },
          { timeout: 45_000 },
        ),
      );
      const content = (res.data as { choices?: Array<{ message?: { content?: string } }> } | undefined)?.choices?.[0]?.message?.content ?? "";
      return { ok: res.success, successFlag: res.success, error: res.error, contentPreview: content.slice(0, 100) };
    } catch (err) {
      return describe("vly.ai.completion", err);
    }
  },
});
