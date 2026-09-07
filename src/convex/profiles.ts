import { getAuthUserId } from "@convex-dev/auth/server";
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const getMyProfile = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null;
    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();
    return profile ?? null;
  },
});

export const upsertProfile = mutation({
  args: {
    qualification: v.optional(v.string()),
    subject: v.optional(v.string()),
    targetGrade: v.optional(v.string()),
    examDate: v.optional(v.number()),
    onboarded: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");

    const existing = await ctx.db
      .query("profiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();

    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, {
        ...(args.qualification !== undefined && {
          qualification: args.qualification,
        }),
        ...(args.subject !== undefined && { subject: args.subject }),
        ...(args.targetGrade !== undefined && {
          targetGrade: args.targetGrade,
        }),
        ...(args.examDate !== undefined && { examDate: args.examDate }),
        ...(args.onboarded !== undefined && { onboarded: args.onboarded }),
        updatedAt: now,
      });
      return existing._id;
    }

    const id = await ctx.db.insert("profiles", {
      userId,
      qualification: args.qualification,
      subject: args.subject,
      targetGrade: args.targetGrade,
      examDate: args.examDate,
      onboarded: args.onboarded ?? true,
      createdAt: now,
      updatedAt: now,
    });
    return id;
  },
});