import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { Infer, v } from "convex/values";

// default user roles. can add / remove based on the project as needed
export const ROLES = {
  ADMIN: "admin",
  USER: "user",
  MEMBER: "member",
} as const;

export const roleValidator = v.union(
  v.literal(ROLES.ADMIN),
  v.literal(ROLES.USER),
  v.literal(ROLES.MEMBER),
);
export type Role = Infer<typeof roleValidator>;

// Document types supported by the source pipeline.
export const sourceTypeValidator = v.union(
  v.literal("pdf"),
  v.literal("docx"),
  v.literal("pptx"),
  v.literal("txt"),
  v.literal("md"),
  v.literal("image"),
  v.literal("unknown"),
);

export const sourceStatusValidator = v.union(
  v.literal("queued"),
  v.literal("processing"),
  v.literal("ready"),
  v.literal("failed"),
);

export const retrievalModeValidator = v.union(
  v.literal("semantic"),
  v.literal("keyword"),
);

export const messageStatusValidator = v.union(
  v.literal("thinking"),
  v.literal("streaming"),
  v.literal("complete"),
  v.literal("error"),
);

const schema = defineSchema(
  {
    // default auth tables using convex auth.
    ...authTables, // do not remove or modify

    // the users table is the default users table that is brought in by the authTables
    users: defineTable({
      name: v.optional(v.string()), // name of the user. do not remove
      image: v.optional(v.string()), // image of the user. do not remove
      email: v.optional(v.string()), // email of the user. do not remove
      emailVerificationTime: v.optional(v.number()), // email verification time. do not remove
      isAnonymous: v.optional(v.boolean()), // is the user anonymous. do not remove

      role: v.optional(roleValidator), // role of the user. do not remove
    }).index("email", ["email"]), // index for the email. do not remove or modify

    // Student profile / onboarding. Lightweight for v1: qualification + focus
    // subject + target grade + exam date.
    profiles: defineTable({
      userId: v.id("users"),
      qualification: v.optional(v.string()),
      subject: v.optional(v.string()),
      targetGrade: v.optional(v.string()),
      examDate: v.optional(v.number()),
      onboarded: v.boolean(),
      createdAt: v.number(),
      updatedAt: v.number(),
    }).index("by_user", ["userId"]),

    // Source collections, e.g. "My Biology Sources", "My Exam Papers".
    collections: defineTable({
      userId: v.id("users"),
      name: v.string(),
      createdAt: v.number(),
    }).index("by_user", ["userId"]),

    // A single uploaded document (PDF, DOCX, PPTX, TXT, MD, ...).
    sources: defineTable({
      userId: v.id("users"),
      storageId: v.id("_storage"),
      name: v.string(),
      type: sourceTypeValidator,
      subject: v.optional(v.string()),
      qualification: v.optional(v.string()),
      collectionId: v.optional(v.id("collections")),
      size: v.number(),
      status: sourceStatusValidator,
      pageCount: v.optional(v.number()),
      chunkCount: v.optional(v.number()),
      topicsDetected: v.optional(v.array(v.string())),
      retrievalMode: v.optional(retrievalModeValidator),
      error: v.optional(v.string()),
      // Resource name of the document inside the Gemini File Search Store
      // (e.g. fileSearchStores/…/documents/xyz). Set once the upload/index
      // step completes; used to remove it from the store on delete.
      geminiDocName: v.optional(v.string()),
      createdAt: v.number(),
      updatedAt: v.number(),
    })
      .index("by_user", ["userId"])
      .index("by_user_status", ["userId", "status"]),

    // One row per grounded File Search query, for per-student usage logging
    // and quota enforcement. `windowStart` is the start of the rolling
    // QUOTA_WINDOW_DAYS window the query counted against.
    aiUsage: defineTable({
      userId: v.id("users"),
      usedAt: v.number(),
      windowStart: v.number(),
      subject: v.optional(v.string()),
    }).index("by_user_used", ["userId", "usedAt"]),

    // Monthly aggregate of grounded queries per student (plus one platform-
    // wide row with userId undefined). The real-usage data used to revisit
    // the quota constants later.
    aiUsageMonthly: defineTable({
      userId: v.optional(v.id("users")),
      month: v.string(), // YYYY-MM
      groundedQueries: v.number(),
      updatedAt: v.number(),
    })
      .index("by_user_month", ["userId", "month"])
      .index("by_month", ["month"]),

    // Upload rate limiting. One row per student; tracks the last large-file
    // upload so `createSource` can enforce the large-file cooldown and the
    // Sources page can show the remaining time.
    uploadCooldowns: defineTable({
      userId: v.id("users"),
      lastLargeUploadAt: v.optional(v.number()),
      updatedAt: v.number(),
    }).index("by_user", ["userId"]),

    // Chunks of extracted source text. Indexed for both semantic (vector)
    // and keyword (full-text) retrieval.
    chunks: defineTable({
      userId: v.id("users"),
      sourceId: v.id("sources"),
      content: v.string(),
      page: v.optional(v.number()),
      position: v.number(),
      embedding: v.optional(v.array(v.float64())),
    })
      .index("by_source", ["sourceId"])
      .searchIndex("search_content", {
        searchField: "content",
        filterFields: ["userId", "sourceId"],
      })
      .vectorIndex("by_embedding", {
        vectorField: "embedding",
        filterFields: ["userId", "sourceId"],
        dimensions: 1536, // OpenAI text-embedding-3-small
      }),

    // A tutoring conversation.
    chats: defineTable({
      userId: v.id("users"),
      title: v.string(),
      subject: v.optional(v.string()),
      qualification: v.optional(v.string()),
      // Sources the student wants this chat grounded in. Empty = all of the
      // student's ready sources when sourceMode is on.
      selectedSourceIds: v.array(v.id("sources")),
      // "ONLY USE MY SOURCES" toggle for this chat.
      sourceMode: v.boolean(),
      createdAt: v.number(),
      updatedAt: v.number(),
    }).index("by_user_updated", ["userId", "updatedAt"]),

    // Spaced-repetition flashcards generated from tutoring answers.
    // Leitner boxes: 0 = new/struggling ... 5 = mastered.
    flashcards: defineTable({
      userId: v.id("users"),
      chatId: v.optional(v.id("chats")),
      subject: v.optional(v.string()),
      front: v.string(),
      back: v.string(),
      box: v.number(),
      mastered: v.boolean(),
      nextDueAt: v.number(),
      lastReviewedAt: v.optional(v.number()),
      createdAt: v.number(),
    }).index("by_user_due", ["userId", "nextDueAt"]),

    // Exam practice: an AI-generated paper for one qualification/subject.
    quizSets: defineTable({
      userId: v.id("users"),
      subject: v.string(),
      qualification: v.optional(v.string()),
      topic: v.optional(v.string()),
      difficulty: v.optional(
        v.union(
          v.literal("foundation"),
          v.literal("standard"),
          v.literal("stretch"),
        ),
      ),
      status: v.union(v.literal("in_progress"), v.literal("complete")),
      // Percentage score, set when the paper is marked complete.
      score: v.optional(v.number()),
      createdAt: v.number(),
      updatedAt: v.number(),
    }).index("by_user_updated", ["userId", "updatedAt"]),

    // One exam-style question in a quiz set. Generation writes the question,
    // marks and model answer; marking fills in the student's result.
    quizQuestions: defineTable({
      userId: v.id("users"),
      quizSetId: v.id("quizSets"),
      position: v.number(),
      question: v.string(),
      marks: v.number(),
      commandWord: v.optional(v.string()),
      modelAnswer: v.string(),
      studentAnswer: v.optional(v.string()),
      // Marking result: earned marks + per-point feedback lines.
      earnedMarks: v.optional(v.number()),
      feedback: v.optional(
        v.array(
          v.object({
            point: v.string(),
            pointType: v.optional(
              v.union(
                v.literal("content"),
                v.literal("structure"),
                v.literal("calculation"),
              ),
            ),
            awarded: v.boolean(),
            comment: v.string(),
          }),
        ),
      ),
      overallComment: v.optional(v.string()),
      answeredAt: v.optional(v.number()),
    })
      .index("by_quiz", ["quizSetId"])
      .index("by_user", ["userId"]),

    // AI-generated interactive visualizations: self-contained HTML sims
    // (canvas/SVG animation + controls) attached to a tutor answer.
    visualizations: defineTable({
      userId: v.id("users"),
      chatId: v.optional(v.id("chats")),
      messageId: v.optional(v.id("messages")),
      title: v.string(),
      html: v.string(),
      createdAt: v.number(),
    })
      .index("by_chat", ["chatId"])
      .index("by_message", ["messageId"])
      .index("by_user", ["userId"]),

    // Chat messages. Assistant messages carry structured citations so the UI
    // can render clickable [Source: ...] chips backed by the actual passage.
    messages: defineTable({
      userId: v.id("users"),
      chatId: v.id("chats"),
      role: v.union(v.literal("user"), v.literal("assistant")),
      content: v.string(),
      citations: v.optional(
        v.array(
          v.object({
            // Set for chunk-level citations from the local RAG fallback.
            sourceId: v.optional(v.id("sources")),
            // Set for document-level citations from Gemini File Search.
            documentTitle: v.optional(v.string()),
            uri: v.optional(v.string()),
            page: v.optional(v.number()),
            snippet: v.optional(v.string()),
          }),
        ),
      ),
      mode: v.optional(v.union(v.literal("sources"), v.literal("outside"))),
      status: messageStatusValidator,
      error: v.optional(v.string()),
      // True when the answer could not be grounded in the selected sources,
      // and the UI should offer an "Allow outside knowledge" action.
      needsPermission: v.optional(v.boolean()),
      // Transparency flag: true when this answer was actually grounded in
      // retrieved source material (Gemini File Search or local RAG chunks).
      // False/null = answered from general knowledge without a source search.
      grounded: v.optional(v.boolean()),
      // Why grounding happened or was skipped ("needed", "acknowledgment",
      // "followup", "forced", "outside", "empty").
      groundingReason: v.optional(v.string()),
      createdAt: v.number(),
    })
      .index("by_chat", ["chatId"])
      .index("by_user", ["userId"]),
  },
  {
    schemaValidation: false,
  },
);

export default schema;
