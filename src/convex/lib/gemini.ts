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
 * Tutor model: strong, fast, and fileSearch-tool capable. Kept on the
 * current Flash generation (supersedes gemini-2.5-flash / gemini-2.0-flash);
 * the official File Search docs use 3.x models with the fileSearch tool.
 */
export const GEMINI_TUTOR_MODEL = "gemini-3.8-flash";

/** Lightweight tasks (flashcards, topic detection, marking). */
export const GEMINI_QUICK_MODEL = "gemini-2.5-flash-lite";

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
}

/**
 * Tutor answer with File Search grounding. Streams text deltas as they
 * arrive and returns the final content plus document citations.
 */
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
  const model = opts.model ?? GEMINI_TUTOR_MODEL;

  const response = await ai.models.generateContentStream({
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
  });

  let content = "";
  let groundingMetadata: unknown;
  for await (const chunk of response) {
    const text = chunk.text;
    if (text) {
      content += text;
      opts.onDelta(text);
    }
    if (chunk.candidates?.[0]?.groundingMetadata) {
      groundingMetadata = chunk.candidates[0].groundingMetadata;
    }
  }

  if (!content.trim()) {
    throw new Error("Gemini returned an empty response.");
  }
  return {
    content,
    citations: extractGroundingCitations(groundingMetadata),
  };
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
    | { document?: { name?: string } }
    | undefined;
  const docName = response?.document?.name;
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
