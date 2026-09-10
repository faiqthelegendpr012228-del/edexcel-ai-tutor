"use node";

import { vly } from "../../lib/vly-integrations";
import {
  GEMINI_QUICK_FALLBACK_MODELS,
  GEMINI_QUICK_MODEL,
  GEMINI_TUTOR_MODEL,
  geminiPlainStream,
  geminiTextCompletion,
  hasGeminiKey,
} from "./gemini";

/**
 * Provider abstraction for the AI services the platform uses in v1.
 *
 * - Chat: routed through the Freebuff/VLY AI gateway (zero configuration,
 *   billed automatically). Model routing can be tuned per call.
 * - Fallback chat: when the gateway rejects a request, we retry directly
 *   against the key stored in OPENAI_API_KEY. That key may be a real OpenAI
 *   key (api.openai.com) OR an OpenRouter key (`sk-or-v1…`, openrouter.ai) —
 *   both speak the same chat-completions protocol, so both are supported and
 *   routed to the right host automatically. OpenRouter 402 (low credits) is
 *   handled by retrying with the token budget the account can actually
 *   afford.
 * - Embeddings: Gemini `gemini-embedding-001` via the same GEMINI_API_KEY
 *   used for the tutor (one provider to manage). Embeddings are only used by
 *   the local-RAG fallback chain — the primary tutor path uses Gemini File
 *   Search. When unavailable, the RAG pipeline gracefully falls back to
 *   keyword search.
 */

/**
 * Embedding model for the local RAG fallback chain.
 *
 * Verified 2026-09 against https://ai.google.dev/gemini-api/docs/embeddings:
 * `gemini-embedding-001` (NOT the newer gemini-embedding-2 — that one
 * aggregates multiple inputs into a single embedding, which is wrong for
 * one-vector-per-chunk retrieval). Native output is 3072 dims; we request
 * 1536 via outputDimensionality, which happens to match the previous OpenAI
 * index size so the Convex vector index needed no dimension change.
 */
export const EMBEDDING_MODEL = "gemini-embedding-001";
export const EMBEDDING_DIMENSIONS = 1536;

// Model routing (v1): cheap model for lightweight tasks, flagship for tutoring.
// `fallback` is the reliability net when the primary tutor model is
// unavailable or rejects a request.
export const MODELS = {
  quick: "gpt-4o-mini",
  tutor: "gpt-5",
  fallback: "gpt-4o-mini",
} as const;

export class EmbeddingsNotConfiguredError extends Error {
  constructor(reason?: string) {
    super(reason ?? "GEMINI_API_KEY is not configured");
    this.name = "EmbeddingsNotConfiguredError";
  }
}

/**
 * OpenRouter keys start with `sk-or-` (e.g. `sk-or-v1-…`). They authenticate
 * against openrouter.ai, not api.openai.com, and cannot be used for the
 * embeddings API.
 */
export function isOpenRouterKey(key: string | undefined): boolean {
  return !!key && key.startsWith("sk-or-");
}

/** OpenRouter model slugs are vendor-prefixed: `openai/gpt-4o-mini`. */
function openRouterModelName(model: string): string {
  return model.includes("/") ? model : `openai/${model}`;
}

/**
 * Embeddings run on the same Gemini key as everything else, so the check is
 * simply whether that key exists.
 */
export function hasEmbeddingsConfigured(): boolean {
  return hasGeminiKey();
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatResult {
  content: string;
  promptTokens: number;
  completionTokens: number;
}

/**
 * Reasoning-style models (gpt-5*, o1/o3/o4*) only accept their default
 * sampling temperature. Sending a custom value makes the gateway reject the
 * request and the stream dies before producing any output — which surfaces to
 * students as "No output generated. Check the stream for errors." So for
 * these models the temperature must be omitted entirely. The vendor prefix
 * used by OpenRouter (`openai/gpt-5`) is tolerated here.
 */
function isReasoningModel(model: string): boolean {
  return /^(?:[a-z0-9-]+\/)?(gpt-5|o[134])/i.test(model);
}

function temperatureFor(model: string, requested?: number): number | undefined {
  if (isReasoningModel(model)) return undefined;
  return requested ?? 0.7;
}

/** HTTP error from a direct AI call, carrying the status and response body. */
class AIHttpError extends Error {
  status: number;
  body: string;
  constructor(status: number, body: string) {
    super(`AI request failed (${status}): ${body.slice(0, 300)}`);
    this.name = "AIHttpError";
    this.status = status;
    this.body = body;
  }
}

/**
 * OpenRouter 402 responses state the affordable budget, e.g.
 * "You requested up to 16384 tokens, but can only afford 3447."
 * Extract that number so the request can be retried within budget.
 */
function parseAffordableTokens(body: string): number | null {
  const m = body.match(/can only afford (\d+)/i);
  if (!m) return null;
  const n = Number.parseInt(m[1], 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

type DirectProvider = "openai" | "openrouter";

function friendlyAuthError(provider: DirectProvider): string {
  switch (provider) {
    case "openrouter":
      return "Your OpenRouter key was rejected (401). Check OPENAI_API_KEY in the Keys panel — it must be a valid `sk-or-…` key with credit available.";
    default:
      return "Your OPENAI_API_KEY was rejected (401 invalid_api_key). Check it in the Keys panel — it must be a real OpenAI key starting with `sk-`, not an OpenRouter key (`sk-or-…`).";
  }
}

function outOfCreditsError(provider: DirectProvider): string {
  if (provider === "openrouter") {
    return "Your OpenRouter account doesn't have enough credits for this request. Top up at https://openrouter.ai/settings/credits, or replace the key in the Keys panel.";
  }
  return "Your AI account doesn't have enough quota for this request. Check the key in the Keys panel.";
}

/**
 * Direct chat completion against the key in OPENAI_API_KEY. Used as a
 * reliability fallback when the VLY gateway rejects the request so the
 * product keeps working with the student's own key.
 *
 * - Real OpenAI key → api.openai.com. Reasoning-style models need
 *   `max_completion_tokens` and no custom temperature; standard models take
 *   `max_tokens` + `temperature`.
 * - OpenRouter key (`sk-or-…`) → openrouter.ai with vendor-prefixed model
 *   slugs and `max_tokens`. A 402 (credits too low for the requested token
 *   budget) is automatically retried with the affordable budget parsed from
 *   the error, so small/medium answers still go through on a low-balance
 *   account.
 */
async function directOpenAIChat(
  messages: ChatMessage[],
  model: string,
  temperature: number | undefined,
  maxTokens: number | undefined,
): Promise<ChatResult> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    throw new Error("No OPENAI_API_KEY configured for direct fallback");
  }
  const provider: DirectProvider = isOpenRouterKey(key)
    ? "openrouter"
    : "openai";
  const endpoint =
    provider === "openrouter"
      ? "https://openrouter.ai/api/v1/chat/completions"
      : "https://api.openai.com/v1/chat/completions";

  const buildBody = (tokenBudget?: number): Record<string, unknown> => {
    const effective = tokenBudget ?? maxTokens;
    const body: Record<string, unknown> = {
      model:
        provider === "openrouter" ? openRouterModelName(model) : model,
      messages,
    };
    if (provider === "openrouter") {
      if (effective !== undefined) body.max_tokens = effective;
      if (!isReasoningModel(model) && temperature !== undefined) {
        body.temperature = temperature;
      }
    } else if (isReasoningModel(model)) {
      if (effective !== undefined) body.max_completion_tokens = effective;
    } else {
      if (temperature !== undefined) body.temperature = temperature;
      if (effective !== undefined) body.max_tokens = effective;
    }
    return body;
  };

  const post = async (
    body: Record<string, unknown>,
  ): Promise<{
    content: string;
    promptTokens: number;
    completionTokens: number;
  }> => {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
        ...(provider === "openrouter" && { "X-Title": "Lumen Tutor" }),
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      if (res.status === 401) {
        throw new Error(friendlyAuthError(provider));
      }
      throw new AIHttpError(res.status, text);
    }
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const content = data.choices?.[0]?.message?.content ?? "";
    if (!content.trim()) {
      throw new Error("The model returned an empty response.");
    }
    return {
      content,
      promptTokens: data.usage?.prompt_tokens ?? 0,
      completionTokens: data.usage?.completion_tokens ?? 0,
    };
  };

  try {
    return await post(buildBody());
  } catch (err) {
    const isLowCredits =
      provider === "openrouter" &&
      err instanceof AIHttpError &&
      (err.status === 402 ||
        (err.status === 400 && /insufficient|credits/i.test(err.body)));
    if (!isLowCredits) throw err;

    // Retry within the budget the account can actually afford.
    const affordable = parseAffordableTokens(err.body);
    if (affordable !== null && affordable >= 256) {
      try {
        return await post(buildBody(affordable));
      } catch {
        throw new Error(outOfCreditsError(provider));
      }
    }
    throw new Error(outOfCreditsError(provider));
  }
}

export async function streamChatCompletion(
  messages: ChatMessage[],
  onDelta: (delta: string) => void,
  opts?: { model?: string; temperature?: number; maxTokens?: number },
): Promise<ChatResult> {
  const model = opts?.model ?? MODELS.tutor;
  const temperature = temperatureFor(model, opts?.temperature);

  let streamed = "";
  let lastError = "AI request failed";

  // 1) Preferred path: true streaming on the requested model.
  try {
    const res = await vly.ai.streamCompletion(
      { model, messages, temperature, maxTokens: opts?.maxTokens },
      (delta) => {
        streamed += delta;
        onDelta(delta);
      },
    );
    if (!res.success || !res.data) {
      throw new Error(res.error || "AI request failed");
    }
    const content = res.data.choices?.[0]?.message?.content ?? streamed;
    if (content.trim().length === 0) {
      throw new Error("The model returned an empty response.");
    }
    return {
      content,
      promptTokens: res.data.usage?.promptTokens ?? 0,
      completionTokens: res.data.usage?.completionTokens ?? 0,
    };
  } catch (err) {
    lastError = `[gateway-stream:${model}] ${err instanceof Error ? err.message : String(err)}`;
  }

  // If some text already streamed to the student, don't retry — a fresh
  // answer would duplicate what is already on screen. Return what arrived.
  if (streamed.trim().length > 0) {
    return { content: streamed, promptTokens: 0, completionTokens: 0 };
  }

  // 1.5) Gemini direct: the primary AI provider for tutor-style turns, tried
  // BEFORE any gateway retry. The platform gateway has been returning
  // "Unauthorized" (verified by direct probe) — a failure here must never be
  // the whole story while Gemini is available. Tool-free streaming → no
  // File Search quota is spent on these turns.
  if (hasGeminiKey()) {
    try {
      return await geminiPlainStream({
        messages,
        model: GEMINI_TUTOR_MODEL,
        temperature,
        maxTokens: opts?.maxTokens ?? 4000,
        onDelta,
      });
    } catch (err) {
      lastError = `[Gemini] ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  // 2) The stream died before producing anything (gateway hiccup, model
  //    rejection, empty stream). Retry without streaming on the same model,
  //    then on the reliable fallback model — with a hard deadline so a
  //    wedged gateway call can't hang the student's answer forever.
  const VLY_DEADLINE_MS = 45_000;
  const attempts: string[] = [model];
  if (MODELS.fallback !== model) attempts.push(MODELS.fallback);

  for (const attemptModel of attempts) {
    try {
      const res = await Promise.race([
        vly.ai.completion(
          {
            model: attemptModel,
            messages,
            temperature: temperatureFor(attemptModel, opts?.temperature),
            maxTokens: opts?.maxTokens ?? 4000,
          },
          { timeout: 120_000 },
        ),
        new Promise<never>((_, reject) =>
          setTimeout(
            () =>
              reject(
                new Error(
                  `Gateway completion timed out after ${VLY_DEADLINE_MS / 1000}s`,
                ),
              ),
            VLY_DEADLINE_MS,
          ),
        ),
      ]);
      if (!res.success || !res.data) {
        throw new Error(res.error || "AI request failed");
      }
      const content = res.data.choices?.[0]?.message?.content ?? "";
      if (content.trim().length === 0) {
        throw new Error("The model returned an empty response.");
      }
      // Simulate streaming so the UI behaves exactly as before.
      for (const piece of content.match(/[\s\S]{1,120}/g) ?? [content]) {
        onDelta(piece);
      }
      return {
        content,
        promptTokens: res.data.usage?.promptTokens ?? 0,
        completionTokens: res.data.usage?.completionTokens ?? 0,
      };
    } catch (err) {
      lastError = `[gateway:${attemptModel}] ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  // 3) Direct fallback: the gateway is rejecting the key but the student's
  //    own OPENAI_API_KEY (OpenAI or OpenRouter) still works. Simulate
  //    streaming so the UI behaves exactly as before.
  if (process.env.OPENAI_API_KEY) {
    for (const attemptModel of attempts) {
      try {
        const res = await directOpenAIChat(
          messages,
          attemptModel,
          temperatureFor(attemptModel, opts?.temperature),
          opts?.maxTokens,
        );
        for (const piece of res.content.match(/[\s\S]{1,120}/g) ?? [
          res.content,
        ]) {
          onDelta(piece);
        }
        return res;
      } catch (err) {
        lastError = `[direct:${attemptModel}] ${err instanceof Error ? err.message : String(err)}`;
      }
    }
  }

  throw new Error(lastError);
}

export async function chatCompletion(
  messages: ChatMessage[],
  opts?: { model?: string; temperature?: number; maxTokens?: number },
): Promise<ChatResult> {
  const model = opts?.model ?? MODELS.quick;
  const temperature = temperatureFor(model, opts?.temperature ?? 0.5);

  // Gemini-first: quick tasks run on Gemini's free-tier lite model, with a
  // second Gemini model absorbing transient rate limits (429) and model
  // unavailability (503) before anything touches the platform gateway —
  // which has its own availability/auth problems and must be a last resort,
  // not the first fallback.
  if (hasGeminiKey()) {
    const geminiModels = [GEMINI_QUICK_MODEL, ...GEMINI_QUICK_FALLBACK_MODELS];
    for (const gModel of geminiModels) {
      try {
        return await geminiTextCompletion(messages, {
          model: gModel,
          temperature: opts?.temperature ?? 0.5,
          maxTokens: opts?.maxTokens,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(
          `[ai] Gemini quick completion on ${gModel} failed: ${message}`,
        );
      }
    }
  }

  let lastError = "AI request failed";
  // One retry covers transient gateway hiccups on the lightweight tasks
  // (flashcards, topic detection) without meaningfully slowing them down.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await vly.ai.completion(
        { model, messages, temperature, maxTokens: opts?.maxTokens ?? 200 },
        { timeout: 60_000 },
      );
      if (!res.success || !res.data) {
        throw new Error(res.error || "AI request failed");
      }
      const content = res.data.choices?.[0]?.message?.content ?? "";
      if (content.trim().length === 0) {
        throw new Error("The model returned an empty response.");
      }
      return {
        content,
        promptTokens: res.data.usage?.promptTokens ?? 0,
        completionTokens: res.data.usage?.completionTokens ?? 0,
      };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }

  // Direct fallback when the gateway rejects the key entirely.
  if (process.env.OPENAI_API_KEY) {
    const attempts: string[] = [model];
    if (MODELS.fallback !== model) attempts.push(MODELS.fallback);
    for (const attemptModel of attempts) {
      try {
        return await directOpenAIChat(
          messages,
          attemptModel,
          temperatureFor(attemptModel, opts?.temperature ?? 0.5),
          opts?.maxTokens ?? 200,
        );
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
      }
    }
  }

  throw new Error(lastError);
}

/**
 * Embed a batch of texts with Gemini embeddings. Returns one vector per
 * input, in the same order. Throws EmbeddingsNotConfiguredError when no
 * Gemini key is present.
 *
 * Batch input via the `requests` array form of embedContent (one request per
 * text). Asymmetric retrieval formatting: queries are prefixed with the
 * RETRIEVAL_QUERY task instruction, documents with RETRIEVAL_DOCUMENT —
 * matching the formats Google documents for search use cases.
 */
export async function embedTexts(
  texts: string[],
  opts?: { taskType?: "RETRIEVAL_QUERY" | "RETRIEVAL_DOCUMENT" },
): Promise<number[][]> {
  if (!hasGeminiKey()) {
    throw new EmbeddingsNotConfiguredError();
  }
  if (texts.length === 0) return [];

  const task = opts?.taskType ?? "RETRIEVAL_DOCUMENT";
  const { getGeminiClient } = await import("./gemini");
  const ai = getGeminiClient();

  // Gemini embeds up to 100 texts per request; 32 keeps request payloads
  // modest and matches the caller's existing batch cadence.
  const BATCH_SIZE = 32;
  const all: number[][] = [];
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    // For gemini-embedding-001 an array under `contents` returns one
    // embedding per input, in order. Task type rides in `config` (the
    // text-prefix convention is for embedding-2, which we deliberately
    // don't use — it aggregates multi-input requests into one vector).
    const res = await ai.models.embedContent({
      model: EMBEDDING_MODEL,
      contents: batch,
      config: {
        taskType: task,
        outputDimensionality: EMBEDDING_DIMENSIONS,
      },
    });
    const embeddings = res.embeddings ?? [];
    if (embeddings.length !== batch.length) {
      throw new Error(
        `Embeddings response count mismatch: got ${embeddings.length}, expected ${batch.length}`,
      );
    }
    for (const emb of embeddings) {
      const vec = emb.values ?? [];
      if (vec.length !== EMBEDDING_DIMENSIONS) {
        throw new Error(
          `Unexpected embedding dimension ${vec.length} (expected ${EMBEDDING_DIMENSIONS})`,
        );
      }
      all.push(vec);
    }
  }
  return all;
}
