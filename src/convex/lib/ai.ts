"use node";

import { vly } from "../../lib/vly-integrations";

/**
 * Provider abstraction for the AI services the platform uses in v1.
 *
 * - Chat: routed through the Freebuff/VLY AI gateway (zero configuration,
 *   billed automatically). Model routing can be tuned per call.
 * - Embeddings: OpenAI `text-embedding-3-small` via direct API. Requires the
 *   student/deployment to add an `OPENAI_API_KEY` in the Keys UI. When it is
 *   missing, the RAG pipeline gracefully falls back to keyword search.
 *
 * Later versions can swap in other providers (Anthropic, Google, local models)
 * behind these same function signatures.
 */

export const EMBEDDING_MODEL = "text-embedding-3-small";
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
  constructor() {
    super("OPENAI_API_KEY is not configured");
    this.name = "EmbeddingsNotConfiguredError";
  }
}

export function hasEmbeddingsConfigured(): boolean {
  return !!process.env.OPENAI_API_KEY;
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
 * these models the temperature must be omitted entirely.
 */
function isReasoningModel(model: string): boolean {
  return /^(gpt-5|o[134])/i.test(model);
}

function temperatureFor(model: string, requested?: number): number | undefined {
  if (isReasoningModel(model)) return undefined;
  return requested ?? 0.7;
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
    lastError = err instanceof Error ? err.message : String(err);
  }

  // If some text already streamed to the student, don't retry — a fresh
  // answer would duplicate what is already on screen. Return what arrived.
  if (streamed.trim().length > 0) {
    return { content: streamed, promptTokens: 0, completionTokens: 0 };
  }

  // 2) The stream died before producing anything (gateway hiccup, model
  //    rejection, empty stream). Retry without streaming on the same model,
  //    then on the reliable fallback model.
  const attempts: string[] = [model];
  if (MODELS.fallback !== model) attempts.push(MODELS.fallback);

  for (const attemptModel of attempts) {
    try {
      const res = await vly.ai.completion(
        {
          model: attemptModel,
          messages,
          temperature: temperatureFor(attemptModel, opts?.temperature),
          maxTokens: opts?.maxTokens ?? 4000,
        },
        { timeout: 120_000 },
      );
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
      lastError = err instanceof Error ? err.message : String(err);
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
  throw new Error(lastError);
}

/**
 * Embed a batch of texts. Returns one vector per input, in the same order.
 * Throws EmbeddingsNotConfiguredError when OPENAI_API_KEY is absent.
 */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    throw new EmbeddingsNotConfiguredError();
  }
  if (texts.length === 0) return [];

  const BATCH_SIZE = 32;
  const all: number[][] = [];
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const res = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({ model: EMBEDDING_MODEL, input: batch }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(
        `Embeddings request failed (${res.status}): ${body.slice(0, 300)}`,
      );
    }
    const data = (await res.json()) as {
      data: Array<{ index: number; embedding: number[] }>;
    };
    const ordered = [...data.data]
      .sort((a, b) => a.index - b.index)
      .map((d) => d.embedding);
    for (const vec of ordered) {
      if (vec.length !== EMBEDDING_DIMENSIONS) {
        throw new Error(
          `Unexpected embedding dimension ${vec.length} (expected ${EMBEDDING_DIMENSIONS})`,
        );
      }
    }
    all.push(...ordered);
  }
  return all;
}
