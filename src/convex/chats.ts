import { getAuthUserId } from "@convex-dev/auth/server";
import { v, type GenericId } from "convex/values";
import { action, mutation, query, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import {
  EMBEDDING_MODEL,
  embedTexts,
  hasEmbeddingsConfigured,
  streamChatCompletion,
  type ChatMessage,
} from "./lib/ai";
import {
  EDEXCEL_TUTOR_SYSTEM_PROMPT,
  geminiFileSearchStream,
  hasGeminiKey,
  resolveGeminiStoreName,
} from "./lib/gemini";
import {
  decideGrounding,
  formatResetIn,
  TUTOR_GROUNDED_QUOTA_PER_WEEK,
} from "./lib/limits";
import { buildSystemPrompt as buildLumenSystemPrompt } from "./lib/prompt";
import { QUALIFICATIONS } from "../lib/curriculum";

type Id<T extends string> = GenericId<T>;

// Marker the model emits when it can't answer from the retrieved passages.
const NEEDS_OUTSIDE_KNOWLEDGE = "[NEEDS_OUTSIDE_KNOWLEDGE]";
const INSUFFICIENT_SOURCES_MESSAGE =
  "I couldn't find enough information in your selected sources to answer this accurately.";

// ---------------------------------------------------------------------------
// Public chat queries + mutations
// ---------------------------------------------------------------------------

export const listChats = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return [];
    return await ctx.db
      .query("chats")
      .withIndex("by_user_updated", (q) => q.eq("userId", userId))
      .order("desc")
      .collect();
  },
});

export const getChat = query({
  args: { chatId: v.id("chats") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null;
    const chat = await ctx.db.get(args.chatId);
    if (!chat || chat.userId !== userId) return null;
    const messages = await ctx.db
      .query("messages")
      .withIndex("by_chat", (q) => q.eq("chatId", args.chatId))
      .collect();
    messages.sort((a, b) => a.createdAt - b.createdAt);
    return { chat, messages };
  },
});

export const createChat = mutation({
  args: {
    subject: v.optional(v.string()),
    qualification: v.optional(v.string()),
    selectedSourceIds: v.optional(v.array(v.id("sources"))),
    sourceMode: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");

    const selectedSourceIds: Array<Id<"sources">> = [];
    if (args.selectedSourceIds && args.selectedSourceIds.length > 0) {
      for (const id of args.selectedSourceIds) {
        const source = await ctx.db.get(id);
        if (source && source.userId === userId && source.status === "ready") {
          selectedSourceIds.push(id);
        }
      }
    }

    const now = Date.now();
    return await ctx.db.insert("chats", {
      userId,
      title: "New lesson",
      subject: args.subject,
      qualification: args.qualification,
      selectedSourceIds,
      sourceMode:
        args.sourceMode ?? (selectedSourceIds.length > 0 ? true : false),
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const updateChat = mutation({
  args: {
    chatId: v.id("chats"),
    title: v.optional(v.string()),
    subject: v.optional(v.string()),
    qualification: v.optional(v.string()),
    selectedSourceIds: v.optional(v.array(v.id("sources"))),
    sourceMode: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    const chat = await ctx.db.get(args.chatId);
    if (!chat || chat.userId !== userId) throw new Error("Chat not found");

    let selectedSourceIds: Array<Id<"sources">> | undefined;
    if (args.selectedSourceIds) {
      selectedSourceIds = [];
      for (const id of args.selectedSourceIds) {
        const source = await ctx.db.get(id);
        if (source && source.userId === userId && source.status === "ready") {
          selectedSourceIds.push(id);
        }
      }
    }

    await ctx.db.patch(args.chatId, {
      ...(args.title !== undefined && { title: args.title }),
      ...(args.subject !== undefined && { subject: args.subject }),
      ...(args.qualification !== undefined && {
        qualification: args.qualification,
      }),
      ...(selectedSourceIds !== undefined && { selectedSourceIds }),
      ...(args.sourceMode !== undefined && { sourceMode: args.sourceMode }),
      updatedAt: Date.now(),
    });
  },
});

export const deleteChat = mutation({
  args: { chatId: v.id("chats") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    const chat = await ctx.db.get(args.chatId);
    if (!chat || chat.userId !== userId) throw new Error("Chat not found");
    const messages = await ctx.db
      .query("messages")
      .withIndex("by_chat", (q) => q.eq("chatId", args.chatId))
      .collect();
    for (const message of messages) {
      await ctx.db.delete(message._id);
    }
    await ctx.db.delete(args.chatId);
  },
});

// ---------------------------------------------------------------------------
// Prompt construction — the Lumen template lives in lib/prompt.ts (finalized
// spec copy). This file only adds the strict-source rules that drive the
// NEEDS_OUTSIDE_KNOWLEDGE protocol on the local-RAG chain.
// ---------------------------------------------------------------------------

const STRICT_SOURCE_RULES = `Additional rules for the "Retrieved passages" section above:
1. Every factual claim must come from those passages and carry an inline citation: [Source: <source name>, Page <n>] (omit ", Page <n>" when the passage has no page number).
2. If the passages do not contain enough information to answer accurately, reply with EXACTLY one line first: ${NEEDS_OUTSIDE_KNOWLEDGE}, then write "${INSUFFICIENT_SOURCES_MESSAGE}" and briefly note what was missing. Do NOT fall back to general knowledge and do NOT invent citations.
3. You may connect ideas across passages and explain them more clearly, but you must not introduce outside facts.`;

// ---------------------------------------------------------------------------
// Retrieval
// ---------------------------------------------------------------------------

interface RetrievedChunk {
  chunkId: Id<"chunks">;
  content: string;
  page?: number;
  sourceId: Id<"sources">;
}

async function retrieveChunks(
  ctx: ActionCtx,
  opts: {
    userId: Id<"users">;
    query: string;
    sourceIds: Array<Id<"sources">>;
  },
): Promise<RetrievedChunk[]> {
  const { userId, query, sourceIds } = opts;

  // 1) Semantic search when embeddings are available. Skipped when ANY
  //    selected source still holds vectors from an older embedding model —
  //    those hits would land in the wrong vector space. The pipeline
  //    re-embeds such sources on their next process/retry, after which
  //    semantic search resumes automatically.
  if (hasEmbeddingsConfigured() && sourceIds.length > 0) {
    try {
      const sources = await ctx.runQuery(internal.chatsInternal._getSourcesByIds, {
        ids: sourceIds,
      });
      const staleModel = sources.some(
        (s) => s?.retrievalMode === "semantic" && s.embeddingModel !== EMBEDDING_MODEL,
      );
      if (!staleModel) {
      const [vector] = await embedTexts([query], { taskType: "RETRIEVAL_QUERY" });
      const hits = await ctx.vectorSearch("chunks", "by_embedding", {
        vector,
        limit: 12,
        filter:
          sourceIds.length === 1
            ? (q) => q.eq("sourceId", sourceIds[0])
            : (q) => q.or(...sourceIds.map((id) => q.eq("sourceId", id))),
      });
      const docs = await ctx.runQuery(internal.chatsInternal._getChunksByIds, {
        ids: hits.map((h) => h._id),
      });
      const byId = new Map(docs.map((d) => [d._id, d]));
      return hits
        .map((h) => byId.get(h._id))
        .filter((d): d is NonNullable<typeof d> => !!d)
        .map((d) => ({
          chunkId: d._id,
          content: d.content,
          page: d.page,
          sourceId: d.sourceId,
        }));
      }
    } catch (err) {
      console.warn("[chats] Semantic retrieval failed, falling back:", err);
    }
  }

  // 2) Keyword fallback (no API key, or embedding failure).
  const hits = await ctx.runQuery(internal.chatsInternal._searchChunks, {
    userId,
    query,
    limit: 16,
  });
  const allowed = new Set(sourceIds);
  return hits
    .filter((h) => allowed.has(h.sourceId))
    .slice(0, 10)
    .map((h) => ({
      chunkId: h._id,
      content: h.content,
      page: h.page,
      sourceId: h.sourceId,
    }));
}

// ---------------------------------------------------------------------------
// askTutor — the main tutoring action
// ---------------------------------------------------------------------------

export const askTutor = action({
  args: {
    chatId: v.id("chats"),
    content: v.string(),
    allowOutside: v.optional(v.boolean()),
    // Re-run the last user message through retrieval ("Check my sources").
    // No new user bubble is inserted; the flagged assistant message is
    // replaced by a fresh answer.
    reground: v.optional(v.boolean()),
  },
  handler: async (
    ctx: ActionCtx,
    args: {
      chatId: Id<"chats">;
      content: string;
      allowOutside?: boolean;
      reground?: boolean;
    },
  ): Promise<{
    needsPermission: boolean;
    messageId: Id<"messages">;
    error?: string;
  }> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    const reground = !!args.reground;
    const content = args.content.trim();
    if (!content) throw new Error("Message is empty");
    if (content.length > 8000) throw new Error("Message is too long");

    const chat = await ctx.runQuery(internal.chatsInternal._getChat, {
      chatId: args.chatId,
    });
    if (!chat || chat.userId !== userId) throw new Error("Chat not found");

    const allowOutside = !!args.allowOutside;

    // Insert the user message (skipped for reground / allow-outside
    // follow-ups, which reuse the last stored user message).
    if (!allowOutside && !reground) {
      await ctx.runMutation(internal.chatsInternal._insertMessage, {
        userId,
        chatId: args.chatId,
        role: "user",
        content,
        status: "complete",
      });
      await ctx.runMutation(internal.chatsInternal._updateChatTitle, {
        chatId: args.chatId,
        title: content.length > 48 ? `${content.slice(0, 48)}…` : content,
      });
    }

    const msgId = await ctx.runMutation(internal.chatsInternal._insertMessage, {
      userId,
      chatId: args.chatId,
      role: "assistant",
      content: "",
      status: "thinking",
    });

    const sourcesMode = chat.sourceMode && !allowOutside;
    // Retrieval gating: only turns that genuinely need sources spend a File
    // Search query. Conservative — anything not clearly conversational is
    // grounded. The decision is stored on the message for transparency, and
    // the UI offers a "Check my sources" re-ground action either way.
    const priorMessages = await ctx.runQuery(internal.chatsInternal._getMessages, {
      chatId: args.chatId,
    });
    const hasPriorAssistantTurn = priorMessages.some(
      (m) =>
        m.role === "assistant" &&
        m._id !== msgId &&
        m.content.trim().length > 0,
    );
    // Reground always forces retrieval — the student explicitly asked for a
    // source-checked answer for the last turn.
    const gating = reground
      ? ({ ground: true, reason: "forced" } as const)
      : allowOutside
        ? ({ ground: false, reason: "outside" } as const)
        : decideGrounding({ userMessage: content, hasPriorAssistantTurn });

    // Quota: consumed by grounded turns; also injected into the system
    // prompt ({{quota_remaining}}) and surfaced in the quota-exhausted note.
    let quotaNote: string | undefined;
    let quotaRemaining = TUTOR_GROUNDED_QUOTA_PER_WEEK;
    if (sourcesMode) {
      const quota = await ctx.runQuery(internal.chatsInternal._getQuotaStatus, {
        userId,
      });
      quotaRemaining = Math.max(0, quota.limit - quota.used);
      if (gating.ground && quota.used >= quota.limit) {
        const resetIn = formatResetIn(quota.resetsInMs);
        quotaNote = `You've used all ${quota.limit} source-checked answers for this week — they reset in ${resetIn}. Here's the best answer I can give without checking your sources this time.`;
      }
    }

    const skipRetrieval = !!quotaNote || !gating.ground;
    const groundedThisTurn = sourcesMode && !skipRetrieval;

    let contextChunks: RetrievedChunk[] = [];
    const mode: "sources" | "outside" = groundedThisTurn ? "sources" : "outside";

    if (sourcesMode && !skipRetrieval) {
      // Which sources are allowed for this chat? Explicit selection wins;
      // empty selection means all of the student's ready sources.
      let allowedSourceIds: Array<Id<"sources">>;
      if (chat.selectedSourceIds.length > 0) {
        const selected = await ctx.runQuery(internal.chatsInternal._getSources, {
          sourceIds: chat.selectedSourceIds,
        });
        allowedSourceIds = selected
          .filter((s) => s && s.userId === userId && s.status === "ready")
          .map((s) => s._id);
      } else {
        const ready = await ctx.runQuery(
          internal.chatsInternal._getUserReadySources,
          { userId },
        );
        allowedSourceIds = ready.map((s) => s._id);
      }

      if (allowedSourceIds.length === 0) {
        const noSourcesMessage =
          chat.selectedSourceIds.length > 0
            ? `${INSUFFICIENT_SOURCES_MESSAGE}\n\nYour selected sources aren't ready to search yet. Check them in Sources, or allow outside knowledge for this answer.`
            : "Source Mode is on, but you don't have any sources ready yet. Upload your textbook, notes or past papers in Sources — or allow outside knowledge for this answer.";
        await ctx.runMutation(internal.chatsInternal._finalizeMessage, {
          messageId: msgId,
          content: noSourcesMessage,
          mode: "sources",
          needsPermission: true,
        });
        return { needsPermission: true, messageId: msgId };
      }

      contextChunks = await retrieveChunks(ctx, {
        userId,
        query: content,
        sourceIds: allowedSourceIds,
      });

      if (contextChunks.length === 0) {
        await ctx.runMutation(internal.chatsInternal._finalizeMessage, {
          messageId: msgId,
          content: `${INSUFFICIENT_SOURCES_MESSAGE}\n\nYour sources were searched but nothing relevant turned up. Try rephrasing your question, selecting different sources, or allowing outside knowledge for this answer.`,
          mode: "sources",
          needsPermission: true,
        });
        return { needsPermission: true, messageId: msgId };
      }
    }

    // Build the LLM conversation. (priorMessages already includes everything
    // up to the just-inserted user message.)
    const history = priorMessages;

    // Resolve source names for the context block.
    let sourceNames = new Map<Id<"sources">, string>();
    if (sourcesMode && contextChunks.length > 0) {
      const sources = await ctx.runQuery(internal.chatsInternal._getSources, {
        sourceIds: [...new Set(contextChunks.map((c) => c.sourceId))],
      });
      sourceNames = new Map(sources.map((s) => [s._id, s.name]));
    }

    // Resolve the qualification id (e.g. "igcse") to a display name for the
    // prompt template; fall back to the raw value when unknown.
    const qualDisplay =
      QUALIFICATIONS.find((q) => q.id === chat.qualification)?.shortName ??
      chat.qualification;

    const systemPrompt = buildLumenSystemPrompt({
      qualification: qualDisplay,
      subject: chat.subject,
      mode: groundedThisTurn ? "grounded" : "fallback",
      quotaRemaining,
      retriever: groundedThisTurn
        ? {
            toolName: sourceNames.size > 0 ? "your uploaded sources (local search)" : "your uploaded sources",
            passages:
              contextChunks.length > 0
                ? contextChunks.map((c) => ({
                    content: c.content,
                    sourceName:
                      sourceNames.get(c.sourceId) ?? "Uploaded source",
                    page: c.page,
                  }))
                : undefined,
          }
        : undefined,
    });

    const llmMessages: ChatMessage[] = [
      {
        role: "system",
        content:
          groundedThisTurn && contextChunks.length > 0
            ? `${systemPrompt}\n\n${STRICT_SOURCE_RULES}`
            : systemPrompt,
      },
    ];

    // Past messages (skip empty placeholders and the streaming placeholder
    // itself, and skip prior assistant turns that ended in ERROR — a stored
    // failure bubble would otherwise be replayed as assistant context on
    // every later turn. Verified from function logs: one real transient
    // failure poisons the whole chat from then on, ending every subsequent
    // Gemini request with a model turn (400 "Requests ending with a model
    // turn are not supported") and pushing the request through to the
    // gateway's "Unauthorized" error forever after. Cap for context length.
    // The just-asked question is added last when it isn't already in history
    // (reground / allow-outside reuse the stored one).
    const past = history.filter(
      (m) =>
        m._id !== msgId &&
        m.content.trim().length > 0 &&
        m.status !== "error",
    );
    const lastStoredUser = [...past]
      .reverse()
      .find((m) => m.role === "user");
    const questionAlreadyStored =
      lastStoredUser !== undefined && lastStoredUser.content === content;
    for (const m of past.slice(-10)) {
      llmMessages.push({
        role: m.role === "user" ? "user" : "assistant",
        content: m.content,
      });
    }
    if (!allowOutside && !questionAlreadyStored) {
      llmMessages.push({ role: "user", content });
    }

    try {
      await ctx.runMutation(internal.chatsInternal._updateMessageStreaming, {
        messageId: msgId,
      });

      let accumulated = "";
      let lastFlushed = 0;
      let finalContent = "";
      let citations: Array<{
        documentTitle: string;
        uri?: string;
        snippet?: string;
      }> = [];
      let needsPermission = false;

      // Primary path: Gemini File Search — only for turns that genuinely
      // need grounding (retrieval gating). Everything else (acknowledgments,
      // follow-ups, quota-gated turns, outside-knowledge mode) uses the
      // general chain and does not spend a File Search query.
      if (hasGeminiKey() && groundedThisTurn) {
        try {
          const storeName = await resolveGeminiStoreName();
          // Scope retrieval to the active subject and this student's own
          // uploads, plus shared board documents. Personal documents must
          // match the subject exactly — an untagged personal file would match
          // nothing, never everything. Shared docs are board-wide: unscoped
          // ones are tagged subject="All" by the setup script and surface in
          // every subject; subject-scoped shared docs only match their tag.
          const subjectTag = chat.subject;
          const esc = subjectTag?.replace(/"/g, '\\"') ?? "";
          const filter = subjectTag
            ? `(owner = "${userId}" AND subject = "${esc}") OR (owner = "shared" AND (subject = "All" OR subject = "${esc}"))`
            : `owner = "${userId}" OR owner = "shared"`;
          const contents: Array<{ role: "user" | "model"; text: string }> = [];
          for (const m of past.slice(-10)) {
            contents.push({
              role: m.role === "user" ? "user" : "model",
              text: m.content,
            });
          }
          // Skip re-adding the question when it's already the last stored
          // user message (normal path / reground); otherwise it lands twice.
          if (!allowOutside && !questionAlreadyStored) {
            contents.push({ role: "user", text: content });
          }
          const gem = await geminiFileSearchStream({
            contents,
            storeName,
            metadataFilter: filter,
            onDelta: (delta) => {
              accumulated += delta;
              if (accumulated.length - lastFlushed >= 60) {
                lastFlushed = accumulated.length;
                void ctx.runMutation(internal.chatsInternal._updateMessageDelta, {
                  messageId: msgId,
                  content: accumulated,
                });
              }
            },
          });
          finalContent = gem.content;
          citations = gem.citations.map((c) => ({
            documentTitle: c.title,
            uri: c.uri,
            snippet: c.snippet,
          }));
          needsPermission = false;
          // Log the grounded query: rolling-window quota + monthly usage,
          // and prune rows that have fallen out of the window.
          await ctx.runMutation(internal.chatsInternal._recordAiUsage, {
            userId,
            subject: chat.subject,
          });
          await ctx.runMutation(internal.chatsInternal._pruneStaleUsage, {
            userId,
          });
          await ctx.runMutation(internal.usage._recordMonthly, {
            userId,
            subject: chat.subject,
          });
        } catch (gemErr) {
          const msg =
            gemErr instanceof Error ? gemErr.message : String(gemErr);
          console.warn(
            `[chats] Gemini fileSearch failed, falling back to gateway chain: ${msg}`,
          );
          // Partial-stream guard: if the grounded call died mid-stream, some
          // partial text may already be visible in the message bubble. Reset
          // the buffer and overwrite the stored content from scratch so the
          // fallback answer replaces (not concatenates onto) the partial one.
          accumulated = "";
          lastFlushed = 0;
          await ctx.runMutation(internal.chatsInternal._resetMessageContent, {
            messageId: msgId,
          });
          const final = await streamChatCompletion(llmMessages, (delta) => {
            accumulated += delta;
            if (accumulated.length - lastFlushed >= 60) {
              lastFlushed = accumulated.length;
              void ctx.runMutation(internal.chatsInternal._updateMessageDelta, {
                messageId: msgId,
                content: accumulated,
              });
            }
          });
          finalContent = final.content;
          if (finalContent.includes(NEEDS_OUTSIDE_KNOWLEDGE)) {
            needsPermission = true;
            finalContent = finalContent
              .replace(NEEDS_OUTSIDE_KNOWLEDGE, "")
              .trim();
          }
        }
      } else {
        const final = await streamChatCompletion(llmMessages, (delta) => {
          accumulated += delta;
          if (accumulated.length - lastFlushed >= 60) {
            lastFlushed = accumulated.length;
            void ctx.runMutation(internal.chatsInternal._updateMessageDelta, {
              messageId: msgId,
              content: accumulated,
            });
          }
        });
        finalContent = final.content;
        if (finalContent.includes(NEEDS_OUTSIDE_KNOWLEDGE)) {
          needsPermission = true;
          finalContent = finalContent.replace(NEEDS_OUTSIDE_KNOWLEDGE, "").trim();
        }
      }

      // Structured citations from the retrieved chunks (fallback path only —
      // the Gemini path returns document citations from grounding metadata).
      if (citations.length === 0 && sourcesMode) {
        const seen = new Set<string>();
        for (const c of contextChunks) {
          const key = `${c.sourceId}:${c.page ?? 0}`;
          if (seen.has(key)) continue;
          seen.add(key);
          citations.push({
            documentTitle: sourceNames.get(c.sourceId) ?? "Uploaded source",
            snippet: c.content.slice(0, 400),
          });
          if (citations.length >= 6) break;
        }
      }

      await ctx.runMutation(internal.chatsInternal._finalizeMessage, {
        messageId: msgId,
        content: quotaNote ? `${quotaNote}\n\n${finalContent}` : finalContent,
        citations: citations.length > 0 ? citations : undefined,
        mode,
        needsPermission: needsPermission || undefined,
        grounded: groundedThisTurn,
        groundingReason: quotaNote ? "quota" : gating.reason,
      });

      return { needsPermission: !!needsPermission, messageId: msgId };
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "The AI request failed.";
      // The bubble shows a friendly apology PLUS the real underlying reason
      // (rate limit, model overload, gateway auth failure…). Hiding the
      // reason behind a generic message made failures impossible to
      // diagnose from the UI — the error is also persisted on the row.
      const reason = message.length > 280 ? `${message.slice(0, 280)}…` : message;
      await ctx.runMutation(internal.chatsInternal._finalizeMessage, {
        messageId: msgId,
        content: `Sorry — I hit a problem generating that answer. Please try again in a moment.\n\n*Reason: ${reason}*`,
        error: message,
        mode,
      });
      return { needsPermission: false, messageId: msgId, error: message };
    }
  },
});