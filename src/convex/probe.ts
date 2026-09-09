//
// TEMPORARY diagnostic probe — deleted after use. Reads the deployment's
// _scheduled_functions system table (the API mirror of the dashboard's
// function log) and the recent large source rows, to establish what actually
// happened to the 135MB file's scheduled processing runs.
//
import { v } from "convex/values";
import { internalQuery } from "./_generated/server";

export const _probeScheduled = internalQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.system
      .query("_scheduled_functions")
      .order("desc")
      .take(40);
    return rows.map((r) => ({
      id: r._id,
      name: r.name,
      state: r.state,
      scheduledTime: r.scheduledTime,
      completedTime: r.completedTime ?? null,
      // args[0].sourceId lets us tie invocations to the big source row
      sourceId:
        Array.isArray(r.args) && r.args[0] && typeof r.args[0] === "object"
          ? ((r.args[0] as { sourceId?: string }).sourceId ?? null)
          : null,
    }));
  },
});

export const _probeBigSources = internalQuery({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db.query("sources").order("desc").take(25);
    return all.map((s) => ({
      id: s._id,
      name: s.name,
      sizeBytes: s.size,
      status: s.status,
      stage: s.stage ?? null,
      stageDetail: s.stageDetail ?? null,
      requeuedAt: s.requeuedAt ?? null,
      error: s.error ?? null,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      ageMinutes: Math.round((Date.now() - s.createdAt) / 60_000),
      staleMinutes: Math.round((Date.now() - s.updatedAt) / 60_000),
    }));
  },
});
