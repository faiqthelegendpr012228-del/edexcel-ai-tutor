"use node";

import { GoogleGenAI } from "@google/genai";

/**
 * Gemini File Search integration.
 *
 * All tutor answers are grounded in a Gemini File Search Store containing the
 * student's uploaded Edexcel documents (specs, past papers, mark schemes).
 * Gemini handles chunking, embedding and semantic retrieval automatically —
 * no local RAG pipeline is needed for the main answer path.
 *
 * Error mapping: Gemini's free tier signals rate limits with HTTP 429 (not
 * 402 like OpenRouter), and auth problems with 400 API_KEY_INVALID / 403.
 */

/**
 * Tutor model: verified against the live models list AND end-to-end with the
 * fileSearch tool (grounded answer from the real store in ~5s).
 * gemini-3.8-flash was dropped: during an availability incident it returned
 * 503 "high demand" on plain calls and hung indefinitely over fileSearch
 * streaming (no HTTP error at all) — see geminiFileSearchStream for the
 * deadline guards that make this failure mode survivable.
 */
export const GEMINI_TUTOR_MODEL = "gemini-3.7-flash";

/**
 * Tutor fallbacks, tried in order when the primary model is unavailable.
 * Both verified working with fileSearch against the same store.
 */
export const GEMINI_TUTOR_FALLBACK_MODELS = [
  "gemini-3.5-flash",
  "gemini-2.5-flash",
] as const;

/** Lightweight tasks (flashcards, topic detection, marking). */
export const GEMINI_QUICK_MODEL = "gemini-2.5-flash-lite";

/** Quick-task fallback when the lite model rate-limits or is unavailable. */
export const GEMINI_QUICK_FALLBACK_MODELS = ["gemini-2.5-flash"] as const;

/** Display name of the File Search Store used as the knowledge base. */
export const GEMINI_STORE_DISPLAY_NAME = "edexcel-knowledge-base";

/** Required system prompt for the tutor. */
export const EDEXCEL_TUTOR_SYSTEM_PROMPT = `You are an AI tutor for Edexcel exam board students. Always search the provided source documents before answering — do not rely on general knowledge for spec-specific content (exam board wording, required formulas, assessment objectives, topic order). Base answers strictly on the retrieved documents, and if they don't cover the question, say so instead of guessing. Cite which document/section each answer is drawn from. Explain concepts step-by-step in language suitable for a student revising for exams. If the qualification level (GCSE vs A-Level) is ambiguous, ask before answering. Never invent exam questions, mark scheme answers, or grade boundaries not present in the source documents.`;

let cached: GoogleGenAI | null = null;
let cachedKey: string | undefined;

export function hasGeminiKey(): boolean {
  return !!process.env.GEMINI_API_KEY;
}

/**
 * Resolve the File Search Store to ground answers against. GEMINI_FILE_SEARCH_STORE
 * (a resource name like `fileSearchStores/abc123`) wins when set; otherwise the
 * store created by scripts/gemini-file-search.mjs is looked up by display name.
 */
export async function resolveGeminiStoreName(): Promise<string> {
  const envName = process.env.GEMINI_FILE_SEARCH_STORE;
  if (envName) return envName;
  const ai = getGeminiClient();
  // The API caps pageSize at 20.
  const pager = await ai.fileSearchStores.list({ config: { pageSize: 20 } });
  for await (const store of pager) {
    if (store.displayName === GEMINI_STORE_DISPLAY_NAME && store.name) {
      return store.name;
    }
  }
  throw new Error(
    "No Edexcel File Search Store found. Run `bun scripts/gemini-file-search.mjs create-store` and upload your documents, then try again.",
  );
}

export function getGeminiClient(): GoogleGenAI {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not configured");
  if (cached && cachedKey === key) return cached;
  cached = new GoogleGenAI({ apiKey: key });
  cachedKey = key;
  return cached;
}

export interface GeminiGroundingCitation {
  /** Document title as registered in the store (display name). */
  title: string;
  /** Raw source pointer emitted by Gemini, e.g. a document/segment URI. */
  uri?: string;
  /** Snippet of the retrieved passage the answer drew from. */
  snippet?: string;
}

export interface GeminiChatResult {
  content: string;
  citations: GeminiGroundingCitation[];
}

/** Map Gemini HTTP errors to student-friendly messages. */
export function friendlyGeminiError(status: number, body: string): string {
  if (status === 429) {
    return "Gemini rate limit reached (429). The free tier has per-minute and per-day caps — wait a moment and try again, or check quotas at https://aistudio.google.com/apikey";
  }
  if (status === 403) {
    return "Gemini rejected the request (403). Check that GEMINI_API_KEY in the Keys panel is valid and has the Generative Language API enabled.";
  }
  if (status === 400 && /API_KEY_INVALID|API key not valid/i.test(body)) {
    return "Your GEMINI_API_KEY was rejected (API_KEY_INVALID). Paste a fresh key from https://aistudio.google.com/api-keys into the Keys panel.";
  }
  if (status === 404) {
    return "Gemini couldn't find the File Search Store or model. Run `bun scripts/gemini-file-search.mjs create-store` and check the store name in the Keys/instructions.";
  }
  if (status === 503) {
    return "Gemini is temporarily overloaded (503). Try again in a moment.";
  }
  return `Gemini request failed (${status}): ${body.slice(0, 300)}`;
}

/**
 * Extract grounded citations from a generateContent response's grounding
 * metadata. Grounding chunks carry retrieved document titles/URIs; segments
 * map answer spans to chunks.
 */
export function extractGroundingCitations(
  groundingMetadata: unknown,
): GeminiGroundingCitation[] {
  const meta = groundingMetadata as
    | {
        groundingChunks?: Array<{
          retrievedContext?: { title?: string; uri?: string; text?: string };
        }>;
      }
    | undefined;
  const out: GeminiGroundingCitation[] = [];
  const seen = new Set<string>();
  for (const chunk of meta?.groundingChunks ?? []) {
    const rc = chunk.retrievedContext;
    if (!rc) continue;
    const title = rc.title || rc.uri || "Uploaded document";
    const key = `${title}|${rc.uri ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      title,
      uri: rc.uri,
      snippet: rc.text?.slice(0, 400),
    });
    if (out.length >= 6) break;
  }
  return out;
}/**
 * Tutor answer with File Search grounding. Streams text deltas as they
 * arrive and returns the final content plus document citations.
 *
 * Resilience (shaped by a live incident where gemini-3.8-flash returned 503
 * on plain calls and HUNG forever over fileSearch streaming — no HTTP error,
 * no bytes, ever):
 * - Primary model first, then a verified fallback chain.
 * - Hard wall-clock deadlines: a stream that produces no text quickly fails
 *   over to the next model; a stream that runs absurdly long is aborted.
 * - If an attempt dies AFTER text reached the student, the partial answer is
 *   returned as-is rather than retrying (a retry would duplicate or replace
 *   text already on screen — same policy as lib/ai.ts).
 */
const TUTOR_STREAM_FIRST_TEXT_TIMEOUT_MS = 45_000;
const TUTOR_STREAM_TOTAL_TIMEOUT_MS = 120_000;

function withDeadline<T>(
  p: Promise<T>,
  deadlineMs: number,
  label: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () =>
        reject(
          new Error(
            `${label} timed out after ${Math.round(deadlineMs / 1000)}s — no response`,
          ),
        ),
      Math.max(deadlineMs, 1),
    );
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

export async function geminiFileSearchStream(
  opts: {
    contents: Array<{ role: "user" | "model"; text: string }>;
    storeName: string;
    model?: string;
    systemPrompt?: string;
    /** Optional AIP-160 filter, e.g. `subject = "Biology" AND owner = "user_123"`. */
    metadataFilter?: string;
    onDelta: (delta: string) => void;
  },
): Promise<GeminiChatResult> {
  const ai = getGeminiClient();
  const primary = opts.model ?? GEMINI_TUTOR_MODEL;
  const chain = [
    primary,
    ...GEMINI_TUTOR_FALLBACK_MODELS.filter((m) => m !== primary),
  ];

  let lastError: Error | null = null;

  for (const model of chain) {
    // Only forward deltas while this attempt is live, so an abandoned
    // hanging stream from a previous attempt can never interleave text
    // with the next one.
    let live = true;
    let content = "";
    let groundingMetadata: unknown;
    const forwardDelta = (t: string) => {
      if (!live) return;
      content += t;
      opts.onDelta(t);
    };

    const runAttempt = async (): Promise<GeminiChatResult> => {
      const started = Date.now();
      const response = await withDeadline(
        ai.models.generateContentStream({
          model,
          contents: opts.contents.map((c) => ({
            role: c.role,
            parts: [{ text: c.text }],
          })),
          config: {
            systemInstruction: opts.systemPrompt ?? EDEXCEL_TUTOR_SYSTEM_PROMPT,
            tools: [
              {
                fileSearch: {
                  fileSearchStoreNames: [opts.storeName],
                  ...(opts.metadataFilter
                    ? { metadataFilter: opts.metadataFilter }
                    : {}),
                },
              },
            ],
          },
        }),
        TUTOR_STREAM_FIRST_TEXT_TIMEOUT_MS,
        `Gemini ${model} (stream open)`,
      );

      const iterator = (
        response as AsyncIterable<{
          text?: string;
          candidates?: Array<{ groundingMetadata?: unknown }>;
        }>
      )[Symbol.asyncIterator]();
      let firstTextSeen = false;
      for (;;) {
        const now = Date.now();
        const totalLeft = started + TUTOR_STREAM_TOTAL_TIMEOUT_MS - now;
        if (totalLeft <= 0) {
          throw new Error(
            `Gemini ${model} stream exceeded ${TUTOR_STREAM_TOTAL_TIMEOUT_MS / 1000}s — aborted`,
          );
        }
        const firstLeft = started + TUTOR_STREAM_FIRST_TEXT_TIMEOUT_MS - now;
        if (!firstTextSeen && firstLeft <= 0) {
          throw new Error(
            `Gemini ${model} produced no text within ${TUTOR_STREAM_FIRST_TEXT_TIMEOUT_MS / 1000}s (likely overloaded)`,
          );
        }
        const chunk = await withDeadline(
          iterator.next(),
          firstTextSeen ? totalLeft : firstLeft,
          `Gemini ${model} stream`,
        );
        if (chunk.done) break;
        const text = chunk.value?.text;
        if (text) {
          firstTextSeen = true;
          forwardDelta(text);
        }
        const gm = chunk.value?.candidates?.[0]?.groundingMetadata;
        if (gm) groundingMetadata = gm;
      }

      if (!content.trim()) {
        throw new Error("Gemini returned an empty response.");
      }
      return {
        content,
        citations: extractGroundingCitations(groundingMetadata),
      };
    };

    try {
      const result = await runAttempt();
      live = false;
      return result;
    } catch (err) {
      live = false;
      let e = err instanceof Error ? err : new Error(String(err));
      const status = (err as { status?: number }).status;
      if (typeof status === "number") {
        e = new Error(friendlyGeminiError(status, e.message));
      }
      lastError = e;
      console.warn(
        `[gemini] tutor fileSearch stream on ${model} failed: ${e.message}`,
      );
      if (content.trim().length > 0) {
        // Partial answer already visible — return it rather than restarting
        // with a different model and duplicating/replacing on-screen text.
        return {
          content,
          citations: extractGroundingCitations(groundingMetadata),
        };
      }
    }
  }

  throw (
    lastError ?? new Error("Gemini File Search stream failed with no response.")
  );
}

/**
 * Upload a file into the File Search Store with per-user/per-subject custom
 * metadata so retrieval can be scoped per student and subject. Returns the
 * document resource name once indexing completes.
 */
export async function uploadToGeminiStore(
  opts: {
    storeName: string;
    // The file blob is passed straight through to the SDK. undici (Node's
    // blob implementation) stores nested Blob parts by reference, so this
    // never materializes a second copy of a 150MB file in the 512MB action.
    file: Blob;
    displayName: string;
    ownerUserId: string;
    subject?: string;
  },
): Promise<string> {
  const ai = getGeminiClient();
  const operation = await ai.fileSearchStores.uploadToFileSearchStore({
    file: opts.file,
    fileSearchStoreName: opts.storeName,
    config: {
      displayName: opts.displayName,
      customMetadata: [
        { key: "owner", stringValue: opts.ownerUserId },
        ...(opts.subject ? [{ key: "subject", stringValue: opts.subject }] : []),
      ],
    },
  });
  let op = operation;
  let waited = 0;
  // Big files (scanned textbooks) can take several minutes to index; a fixed
  // 2-minute wait silently dropped them. Scale the patience to the upload.
  const waitCap = opts.file.size > 25 * 1024 * 1024 ? 480_000 : 120_000;
  while (!op.done && waited < waitCap) {
    await new Promise((r) => setTimeout(r, 2000));
    waited += 2000;
    op = await ai.operations.get({ operation: op });
  }
  if (!op.done) {
    throw new Error("Gemini indexing timed out — retry from the Sources page.");
  }
  const response = op.response as
    | { documentName?: string; document?: { name?: string } }
    | undefined;
  // The REST API returns { parent, documentName } (verified empirically with
  // a live upload); older SDK typings suggested document.name — read both so
  // a SDK update can't silently break the "already indexed" guard again.
  const docName = response?.documentName ?? response?.document?.name;
  if (!docName) {
    throw new Error("Gemini indexing finished but no document name was returned.");
  }
  return docName;
}

/** Remove a document from the File Search Store (best effort). */
export async function deleteFromGeminiStore(docName: string): Promise<void> {
  const ai = getGeminiClient();
  await ai.fileSearchStores.documents.delete({
    name: docName,
    config: { force: true },
  });
}

/**
 * Plain-text completion (no grounding) for lightweight structured tasks:
 * flashcards, topic detection, quiz marking, visualization HTML.
 */
export async function geminiTextCompletion(
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
  opts?: { model?: string; temperature?: number; maxTokens?: number },
): Promise<{ content: string; promptTokens: number; completionTokens: number }> {
  const ai = getGeminiClient();
  const model = opts?.model ?? GEMINI_QUICK_MODEL;

  const system = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n\n");
  const contents = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role === "assistant" ? ("model" as const) : ("user" as const),
      parts: [{ text: m.content }],
    }));

  try {
    const res = await ai.models.generateContent({
      model,
      contents,
      config: {
        ...(system ? { systemInstruction: system } : {}),
        ...(opts?.temperature !== undefined
          ? { temperature: opts.temperature }
          : {}),
        ...(opts?.maxTokens !== undefined
          ? { maxOutputTokens: opts.maxTokens }
          : {}),
        // Quick tasks use small maxTokens budgets; default thinking would
        // consume them and produce empty responses.
        thinkingConfig: { thinkingBudget: 0 },
      },
    });
    const content = res.text ?? "";
    if (!content.trim()) {
      throw new Error("The model returned an empty response.");
    }
    const usage = res.usageMetadata;
    return {
      content,
      promptTokens: usage?.promptTokenCount ?? 0,
      completionTokens: usage?.candidatesTokenCount ?? 0,
    };
  } catch (err) {
    if (err instanceof Error && "status" in (err as object)) {
      const status = (err as { status?: number }).status;
      if (typeof status === "number") {
        throw new Error(friendlyGeminiError(status, err.message));
      }
    }
    throw err;
  }
}
