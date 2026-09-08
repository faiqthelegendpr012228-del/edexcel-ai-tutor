import { getAuthUserId } from "@convex-dev/auth/server";
import { v, type GenericId } from "convex/values";
import { action, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { chatCompletion, MODELS } from "./lib/ai";

type Id<T extends string> = GenericId<T>;

// ---------------------------------------------------------------------------
// Structured exam practice: generate an exam-style paper, answer it, and get
// Edexcel-style marking with per-point feedback.
// ---------------------------------------------------------------------------

interface GeneratedQuestion {
  question: string;
  marks: number;
  commandWord: string;
  modelAnswer: string;
}

const GENERATE_SYSTEM_PROMPT = `You are an Edexcel exam paper writer. Produce exam-style questions that match Pearson Edexcel style and command words (State, Define, Describe, Explain, Compare, Evaluate, Calculate, Suggest, Discuss).

Reply with ONLY a JSON array of question objects, each:
{"question": string, "marks": number, "commandWord": string, "modelAnswer": string}

Rules:
- "question" is the full question text as it would appear on a paper, including any stimulus data. Number nothing — the app numbers questions itself.
- "marks" between 1 and 12, appropriate to the command word and depth.
- "commandWord" is the primary Edexcel command word in the question.
- "modelAnswer" is a concise bullet-point marking guide: the specific points a marker would look for, one per line, each starting with "- ". Include mark-worthy specifics (names, formulas, values, mechanisms) — not generic advice.
- No prose, no markdown fences, no numbering around the JSON.`;

const MARK_SYSTEM_PROMPT = `You are an Edexcel examiner marking one student answer against a marking guide.

Reply with ONLY a JSON object:
{"earnedMarks": number, "feedback": [{"point": string, "pointType": "content"|"structure"|"calculation", "awarded": boolean, "comment": string}], "overallComment": string}

Rules:
- "point" is a short label for the marking point (e.g. "Correct units"). "comment" is one specific sentence explaining the award or the miss — quote or paraphrase the student's own words where useful.
- pointType: "content" for subject knowledge points, "structure" for method/command-word demands (e.g. comparison, evaluation balance), "calculation" for numeric working.
- Be fair but exam-accurate: award a point only when the answer genuinely expresses it. Partially-made points can be awarded with a note in the comment.
- earnedMarks must equal the number of awarded points, capped at the question's mark total.
- overallComment: 1-3 sentences on how to reach full marks next time.
- No prose outside the JSON, no markdown fences.`;

function parseJsonLoose(raw: string): unknown {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "");
  try {
    return JSON.parse(cleaned);
  } catch {
    // Tolerate leading/trailing prose around the JSON payload.
    const start = cleaned.search(/[[{]/);
    const endArray = cleaned.lastIndexOf("]");
    const endObject = cleaned.lastIndexOf("}");
    const end = Math.max(endArray, endObject);
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function isQuestion(value: unknown): value is GeneratedQuestion {
  if (typeof value !== "object" || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.question === "string" &&
    obj.question.trim().length > 0 &&
    typeof obj.marks === "number" &&
    obj.marks >= 1 &&
    obj.marks <= 12 &&
    typeof obj.commandWord === "string" &&
    typeof obj.modelAnswer === "string" &&
    obj.modelAnswer.trim().length > 0
  );
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export const getQuizSet = query({
  args: { quizSetId: v.id("quizSets") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null;
    const set = await ctx.db.get(args.quizSetId);
    if (!set || set.userId !== userId) return null;
    const questions = await ctx.db
      .query("quizQuestions")
      .withIndex("by_quiz", (q) => q.eq("quizSetId", args.quizSetId))
      .collect();
    questions.sort((a, b) => a.position - b.position);
    return { set, questions };
  },
});

export const listQuizSets = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return [];
    return await ctx.db
      .query("quizSets")
      .withIndex("by_user_updated", (q) => q.eq("userId", userId))
      .order("desc")
      .collect();
  },
});

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

const DIFFICULTY_HINTS: Record<string, string> = {
  foundation:
    "Pitch at foundation tier / early spec content: accessible recall, simple application, short answers.",
  standard:
    "Pitch at the standard expected grade: a mix of recall, explanation and one multi-step application.",
  stretch:
    "Pitch at top grades: demanding application, synthesis across topics, evaluation and multi-step calculations.",
};

export const generateQuiz = action({
  args: {
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
    count: v.optional(v.number()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ quizSetId: Id<"quizSets"> }> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");

    const count = Math.min(Math.max(args.count ?? 5, 1), 8);

    const res = await chatCompletion(
      [
        { role: "system", content: GENERATE_SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            `Write ${count} exam-style questions for Pearson Edexcel ${args.qualification ?? "GCSE"} ${args.subject}.`,
            args.topic ? `Focus topic: ${args.topic}.` : "",
            args.difficulty
              ? DIFFICULTY_HINTS[args.difficulty]
              : DIFFICULTY_HINTS.standard,
            "Vary the command words and marks across the set (include at least one short low-mark question and one longer high-mark question).",
          ]
            .filter(Boolean)
            .join("\n"),
        },
      ],
      { model: MODELS.quick, temperature: 0.6, maxTokens: 2400 },
    );

    const parsed = parseJsonLoose(res.content);
    const questions = Array.isArray(parsed)
      ? parsed.filter(isQuestion).slice(0, count)
      : [];

    if (questions.length === 0) {
      throw new Error(
        "Couldn't generate a practice paper right now. Please try again.",
      );
    }

    const quizSetId = await ctx.runMutation(internal.quizInternal._insertQuizSet, {
      userId,
      subject: args.subject,
      qualification: args.qualification,
      topic: args.topic,
      difficulty: args.difficulty,
    });

    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      await ctx.runMutation(internal.quizInternal._insertQuestion, {
        userId,
        quizSetId,
        position: i,
        question: q.question.trim(),
        marks: Math.round(q.marks),
        commandWord: q.commandWord.trim(),
        modelAnswer: q.modelAnswer.trim(),
      });
    }

    return { quizSetId };
  },
});

// ---------------------------------------------------------------------------
// Answering + marking
// ---------------------------------------------------------------------------

export const answerQuestion = action({
  args: {
    questionId: v.id("quizQuestions"),
    answer: v.string(),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    earnedMarks: number;
    totalMarks: number;
  }> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");

    const question = await ctx.runQuery(internal.quizInternal._getQuestion, {
      questionId: args.questionId,
    });
    if (!question || question.userId !== userId) {
      throw new Error("Question not found");
    }
    if (question.studentAnswer !== undefined) {
      throw new Error("This question is already answered.");
    }

    const answer = args.answer.trim();
    if (!answer) throw new Error("Answer is empty");
    if (answer.length > 8000) throw new Error("Answer is too long");

    const res = await chatCompletion(
      [
        { role: "system", content: MARK_SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            `Question (${question.marks} marks):`,
            question.question,
            "",
            "Marking guide:",
            question.modelAnswer,
            "",
            "Student answer:",
            answer,
          ].join("\n"),
        },
      ],
      { model: MODELS.quick, temperature: 0.2, maxTokens: 1200 },
    );

    const parsed = parseJsonLoose(res.content) as
      | {
          earnedMarks?: unknown;
          feedback?: unknown;
          overallComment?: unknown;
        }
      | null;

    const feedbackIn = Array.isArray(parsed?.feedback) ? parsed!.feedback : [];
    const feedback = feedbackIn
      .map((f): {
        point: string;
        pointType: "content" | "structure" | "calculation";
        awarded: boolean;
        comment: string;
      } | null => {
        if (typeof f !== "object" || f === null) return null;
        const obj = f as Record<string, unknown>;
        if (typeof obj.point !== "string" || !obj.point.trim()) return null;
        const pointType =
          obj.pointType === "structure" || obj.pointType === "calculation"
            ? obj.pointType
            : "content";
        return {
          point: obj.point.trim().slice(0, 160),
          pointType,
          awarded: obj.awarded === true,
          comment:
            typeof obj.comment === "string"
              ? obj.comment.trim().slice(0, 500)
              : "",
        };
      })
      .filter((f): f is NonNullable<typeof f> => f !== null)
      .slice(0, 12);

    let earned = 0;
    if (typeof parsed?.earnedMarks === "number") {
      earned = Math.max(0, Math.min(Math.round(parsed.earnedMarks), question.marks));
    } else {
      earned = Math.min(
        feedback.filter((f) => f.awarded).length,
        question.marks,
      );
    }

    const overallComment =
      typeof parsed?.overallComment === "string"
        ? parsed.overallComment.trim().slice(0, 800)
        : "";

    await ctx.runMutation(internal.quizInternal._saveAnswer, {
      questionId: args.questionId,
      studentAnswer: answer,
      earnedMarks: earned,
      feedback,
      overallComment: overallComment || undefined,
    });
    await ctx.runMutation(internal.quizInternal._touchQuizSet, {
      quizSetId: question.quizSetId,
    });

    return { earnedMarks: earned, totalMarks: question.marks };
  },
});

// Finish a paper: compute the percentage score and mark it complete.
export const completeQuiz = mutation({
  args: { quizSetId: v.id("quizSets") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    const set = await ctx.db.get(args.quizSetId);
    if (!set || set.userId !== userId) throw new Error("Paper not found");

    const questions = await ctx.db
      .query("quizQuestions")
      .withIndex("by_quiz", (q) => q.eq("quizSetId", args.quizSetId))
      .collect();

    const totalMarks = questions.reduce((sum, q) => sum + q.marks, 0);
    const answered = questions.filter(
      (q) => q.studentAnswer !== undefined && q.earnedMarks !== undefined,
    );
    const earned = answered.reduce((sum, q) => sum + (q.earnedMarks ?? 0), 0);

    const score =
      totalMarks > 0 ? Math.round((earned / totalMarks) * 100) : undefined;

    await ctx.db.patch(args.quizSetId, {
      status: "complete",
      score,
      updatedAt: Date.now(),
    });
    return { score, earned, totalMarks, answered: answered.length };
  },
});

export const deleteQuiz = mutation({
  args: { quizSetId: v.id("quizSets") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    const set = await ctx.db.get(args.quizSetId);
    if (!set || set.userId !== userId) throw new Error("Paper not found");
    await ctx.runMutation(internal.quizInternal._deleteQuizSet, {
      quizSetId: args.quizSetId,
    });
  },
});
