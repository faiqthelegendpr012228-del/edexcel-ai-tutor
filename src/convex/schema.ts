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
      createdAt: v.number(),
      updatedAt: v.number(),
    })
      .index("by_user", ["userId"])
      .index("by_user_status", ["userId", "status"]),

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
            sourceId: v.id("sources"),
            sourceName: v.string(),
            page: v.optional(v.number()),
            snippet: v.string(),
          }),
        ),
      ),
      mode: v.optional(v.union(v.literal("sources"), v.literal("outside"))),
      status: messageStatusValidator,
      error: v.optional(v.string()),
      // True when the answer could not be grounded in the selected sources,
      // and the UI should offer an "Allow outside knowledge" action.
      needsPermission: v.optional(v.boolean()),
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