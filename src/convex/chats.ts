import { getAuthUserId } from "@convex-dev/auth/server";
import { v, type GenericId } from "convex/values";
import { action, mutation, query, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import {
  embedTexts,
  hasEmbeddingsConfigured,
  streamChatCompletion,
  type ChatMessage,
} from "./lib/ai";

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
// Prompt construction
// ---------------------------------------------------------------------------

const BASE_SYSTEM_PROMPT = `You are Lumen, a patient, precise private tutor for Pearson Edexcel students (GCSE, International GCSE, AS, A Level, International A Level).

Teaching principles:
- Prioritise UNDERSTANDING → PRACTICE → FEEDBACK → RETENTION. Never just hand over an answer without making sure the idea lands.
- Explain step by step, and check the student actually follows before moving on.
- You know Edexcel command words (State, Define, Describe, Explain, Compare, Evaluate, Calculate, Suggest, Discuss) and what each demands. When relevant, teach students how to structure an answer worth the stated marks.
- When you ask the student a question, ask ONE question at a time.
- Format with markdown: short headings, bullet lists, worked examples as numbered steps. Keep paragraphs short. Never dump a wall of text.
- End most answers with one concrete next step, e.g. "Want me to test you with a quick question?"`;

function buildSystemPrompt(opts: {
  qualification?: string;
  subject?: string;
  sourcesMode: boolean;
  context?: Array<{ content: string; sourceName: string; page?: number }>;
}): string {
  const parts = [
    BASE_SYSTEM_PROMPT,
    "",
    "Student context:",
    `- Qualification: ${opts.qualification ?? "not set"}`,
    `- Focus subject: ${opts.subject ?? "not set"}`,
  ];

  if (opts.sourcesMode) {
    parts.push(
      "",
      "STRICT SOURCE MODE is ON. Answer ONLY using the passages below, retrieved from the student's own uploaded materials.",
      "Hard rules:",
      "1. Every factual claim must come from these passages and carry an inline citation: [Source: <source name>, Page <n>] (omit \", Page <n>\" when the passage has no page number).",
      `2. If the passages do not contain enough information to answer accurately, reply with EXACTLY one line first: ${NEEDS_OUTSIDE_KNOWLEDGE}, then write "${INSUFFICIENT_SOURCES_MESSAGE}" and briefly note what was missing. Do NOT fall back to general knowledge and do NOT invent citations.`,
      "3. You may connect ideas across passages and explain them more clearly, but you must not introduce outside facts.",
      "",
      "Retrieved passages:",
    );
    for (const chunk of opts.context ?? []) {
      parts.push(
        `[Source: ${chunk.sourceName}${chunk.page ? `, Page ${chunk.page}` : ""}]`,
        chunk.content,
        "---",
      );
    }
  } else {
    parts.push(
      "",
      "You may use your general knowledge. If the student has uploaded their own sources, you can refer to them at a high level, but never fabricate specific citations or page numbers for them.",
    );
  }

  return parts.join("\n");
}

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

  // 1) Semantic search when embeddings are available.
  if (hasEmbeddingsConfigured()) {
    try {
      const [vector] = await embedTexts([query]);
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
  },
  handler: async (
    ctx: ActionCtx,
    args: { chatId: Id<"chats">; content: string; allowOutside?: boolean },
  ): Promise<{
    needsPermission: boolean;
    messageId: Id<"messages">;
    error?: string;
  }> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    const content = args.content.trim();
    if (!content) throw new Error("Message is empty");
    if (content.length > 8000) throw new Error("Message is too long");

    const chat = await ctx.runQuery(internal.chatsInternal._getChat, {
      chatId: args.chatId,
    });
    if (!chat || chat.userId !== userId) throw new Error("Chat not found");

    const allowOutside = !!args.allowOutside;

    // Insert the user message (skipped when this is the "allow outside
    // knowledge" follow-up for a message we already stored).
    if (!allowOutside) {
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

    let contextChunks: RetrievedChunk[] = [];
    const mode: "sources" | "outside" = sourcesMode ? "sources" : "outside";

    if (sourcesMode) {
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

    // Build the LLM conversation.
    const history = await ctx.runQuery(internal.chatsInternal._getMessages, {
      chatId: args.chatId,
    });

    // Resolve source names for the context block.
    let sourceNames = new Map<Id<"sources">, string>();
    if (sourcesMode && contextChunks.length > 0) {
      const sources = await ctx.runQuery(internal.chatsInternal._getSources, {
        sourceIds: [...new Set(contextChunks.map((c) => c.sourceId))],
      });
      sourceNames = new Map(sources.map((s) => [s._id, s.name]));
    }

    const llmMessages: ChatMessage[] = [
      {
        role: "system",
        content: buildSystemPrompt({
          qualification: chat.qualification,
          subject: chat.subject,
          sourcesMode,
          context: sourcesMode
            ? contextChunks.map((c) => ({
                content: c.content,
                sourceName: sourceNames.get(c.sourceId) ?? "Uploaded source",
                page: c.page,
              }))
            : undefined,
        }),
      },
    ];

    // Past messages (skip empty placeholders); cap for context length.
    const past = history.filter(
      (m) => m._id !== msgId && m.content.trim().length > 0,
    );
    for (const m of past.slice(-10)) {
      llmMessages.push({
        role: m.role === "user" ? "user" : "assistant",
        content: m.content,
      });
    }
    if (!allowOutside) {
      llmMessages.push({ role: "user", content });
    }

    try {
      await ctx.runMutation(internal.chatsInternal._updateMessageStreaming, {
        messageId: msgId,
      });

      let accumulated = "";
      let lastFlushed = 0;
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

      let finalContent = final.content;
      let needsPermission = false;
      if (finalContent.includes(NEEDS_OUTSIDE_KNOWLEDGE)) {
        needsPermission = true;
        finalContent = finalContent.replace(NEEDS_OUTSIDE_KNOWLEDGE, "").trim();
      }

      // Structured citations from the retrieved chunks.
      const citations: Array<{
        sourceId: Id<"sources">;
        sourceName: string;
        page?: number;
        snippet: string;
      }> = [];
      if (sourcesMode) {
        const seen = new Set<string>();
        for (const c of contextChunks) {
          const key = `${c.sourceId}:${c.page ?? 0}`;
          if (seen.has(key)) continue;
          seen.add(key);
          citations.push({
            sourceId: c.sourceId,
            sourceName: sourceNames.get(c.sourceId) ?? "Uploaded source",
            page: c.page,
            snippet: c.content.slice(0, 400),
          });
          if (citations.length >= 6) break;
        }
      }

      await ctx.runMutation(internal.chatsInternal._finalizeMessage, {
        messageId: msgId,
        content: finalContent,
        citations: citations.length > 0 ? citations : undefined,
        mode,
        needsPermission: needsPermission || undefined,
      });

      return { needsPermission: !!needsPermission, messageId: msgId };
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "The AI request failed.";
      await ctx.runMutation(internal.chatsInternal._finalizeMessage, {
        messageId: msgId,
        content:
          "Sorry — I hit a problem generating that answer. Please try again in a moment.",
        error: message,
        mode,
      });
      return { needsPermission: false, messageId: msgId, error: message };
    }
  },
});