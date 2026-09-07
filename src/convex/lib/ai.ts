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
export const MODELS = {
  quick: "gpt-4o-mini",
  tutor: "gpt-5",
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

export async function streamChatCompletion(
  messages: ChatMessage[],
  onDelta: (delta: string) => void,
  opts?: { model?: string; temperature?: number; maxTokens?: number },
): Promise<ChatResult> {
  const res = await vly.ai.streamCompletion(
    {
      model: opts?.model ?? MODELS.tutor,
      messages,
      temperature: opts?.temperature ?? 0.7,
      maxTokens: opts?.maxTokens,
    },
    onDelta,
  );
  if (!res.success || !res.data) {
    throw new Error(res.error || "AI request failed");
  }
  return {
    content: res.data.choices?.[0]?.message?.content ?? "",
    promptTokens: res.data.usage?.promptTokens ?? 0,
    completionTokens: res.data.usage?.completionTokens ?? 0,
  };
}

export async function chatCompletion(
  messages: ChatMessage[],
  opts?: { model?: string; temperature?: number; maxTokens?: number },
): Promise<ChatResult> {
  const res = await vly.ai.completion(
    {
      model: opts?.model ?? MODELS.quick,
      messages,
      temperature: opts?.temperature ?? 0.5,
      maxTokens: opts?.maxTokens ?? 200,
    },
    { timeout: 30000 },
  );
  if (!res.success || !res.data) {
    throw new Error(res.error || "AI request failed");
  }
  return {
    content: res.data.choices?.[0]?.message?.content ?? "",
    promptTokens: res.data.usage?.promptTokens ?? 0,
    completionTokens: res.data.usage?.completionTokens ?? 0,
  };
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