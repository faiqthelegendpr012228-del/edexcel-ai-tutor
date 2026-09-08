import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

// Internal quiz helpers live in their own module so `quiz.ts` can reference
// them through `internal.quizInternal.*` without creating a circular type
// graph (same pattern as chats.ts / chatsInternal.ts).

export const _insertQuizSet = internalMutation({
  args: {
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
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    return await ctx.db.insert("quizSets", {
      userId: args.userId,
      subject: args.subject,
      qualification: args.qualification,
      topic: args.topic,
      difficulty: args.difficulty,
      status: "in_progress",
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const _insertQuestion = internalMutation({
  args: {
    userId: v.id("users"),
    quizSetId: v.id("quizSets"),
    position: v.number(),
    question: v.string(),
    marks: v.number(),
    commandWord: v.optional(v.string()),
    modelAnswer: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("quizQuestions", {
      userId: args.userId,
      quizSetId: args.quizSetId,
      position: args.position,
      question: args.question,
      marks: args.marks,
      commandWord: args.commandWord,
      modelAnswer: args.modelAnswer,
    });
  },
});

export const _getQuestion = internalQuery({
  args: { questionId: v.id("quizQuestions") },
  handler: async (ctx, args) => await ctx.db.get(args.questionId),
});

export const _saveAnswer = internalMutation({
  args: {
    questionId: v.id("quizQuestions"),
    studentAnswer: v.string(),
    earnedMarks: v.number(),
    feedback: v.array(
      v.object({
        point: v.string(),
        pointType: v.union(
          v.literal("content"),
          v.literal("structure"),
          v.literal("calculation"),
        ),
        awarded: v.boolean(),
        comment: v.string(),
      }),
    ),
    overallComment: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.questionId, {
      studentAnswer: args.studentAnswer,
      earnedMarks: args.earnedMarks,
      feedback: args.feedback,
      overallComment: args.overallComment,
      answeredAt: Date.now(),
    });
  },
});

export const _finalizeQuizSet = internalMutation({
  args: { quizSetId: v.id("quizSets") },
  handler: async (ctx, args) => {
    const set = await ctx.db.get(args.quizSetId);
    if (!set) return;
    await ctx.db.patch(args.quizSetId, { updatedAt: Date.now() });
  },
});

export const _touchQuizSet = internalMutation({
  args: { quizSetId: v.id("quizSets") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.quizSetId, { updatedAt: Date.now() });
  },
});

export const _deleteQuizSet = internalMutation({
  args: { quizSetId: v.id("quizSets") },
  handler: async (ctx, args) => {
    const questions = await ctx.db
      .query("quizQuestions")
      .withIndex("by_quiz", (q) => q.eq("quizSetId", args.quizSetId))
      .collect();
    for (const q of questions) {
      await ctx.db.delete(q._id);
    }
    await ctx.db.delete(args.quizSetId);
  },
});
