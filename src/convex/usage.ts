import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, query } from "./_generated/server";
import { QUOTA_WINDOW_DAYS, TUTOR_GROUNDED_QUOTA_PER_WEEK } from "./lib/limits";

/**
 * The signed-in student's grounded-query quota over the rolling window.
 * Consumed by the Tutor page to show "N of M grounded answers remaining".
 */
export const getMyQuota = query({
  args: {},
  handler: async (ctx): Promise<{
    used: number;
    limit: number;
    resetsInMs: number;
    windowDays: number;
  }> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      return {
        used: 0,
        limit: TUTOR_GROUNDED_QUOTA_PER_WEEK,
        resetsInMs: 0,
        windowDays: QUOTA_WINDOW_DAYS,
      };
    }
    const status = await ctx.runQuery(internal.chatsInternal._getQuotaStatus, {
      userId,
    });
    return { ...status, windowDays: QUOTA_WINDOW_DAYS };
  },
});

/**
 * One row per (student, calendar month): how many grounded File Search
 * queries they made. Plus one platform-wide row (userId undefined) per month
 * for quick totals. This is the real-usage data used to revisit the quota
 * constants in lib/limits.ts later.
 */
export const _recordMonthly = internalMutation({
  args: {
    userId: v.id("users"),
    subject: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const monthKey = new Date().toISOString().slice(0, 7); // YYYY-MM
    const existing = await ctx.db
      .query("aiUsageMonthly")
      .withIndex("by_user_month", (q) =>
        q.eq("userId", args.userId).eq("month", monthKey),
      )
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, {
        groundedQueries: existing.groundedQueries + 1,
        updatedAt: Date.now(),
      });
    } else {
      await ctx.db.insert("aiUsageMonthly", {
        userId: args.userId,
        month: monthKey,
        groundedQueries: 1,
        updatedAt: Date.now(),
      });
    }

    // Platform-wide aggregate row for quick dashboards.
    const globalRows = await ctx.db
      .query("aiUsageMonthly")
      .withIndex("by_month", (q) => q.eq("month", monthKey))
      .collect();
    const global = globalRows.find((r) => r.userId === undefined);
    if (global) {
      await ctx.db.patch(global._id, {
        groundedQueries: global.groundedQueries + 1,
        updatedAt: Date.now(),
      });
    } else {
      await ctx.db.insert("aiUsageMonthly", {
        userId: undefined,
        month: monthKey,
        groundedQueries: 1,
        updatedAt: Date.now(),
      });
    }
  },
});

/** Per-student monthly usage history (for a future admin/settings view). */
export const getMyMonthlyUsage = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return [];
    return await ctx.db
      .query("aiUsageMonthly")
      .withIndex("by_user_month", (q) => q.eq("userId", userId))
      .collect();
  },
});
