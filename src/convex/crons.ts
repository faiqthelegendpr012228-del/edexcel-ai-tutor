import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Watchdog: a source whose processing action died mid-run (OOM, timeout,
// deploy) would otherwise hang in "Processing" forever — no catch block runs
// when the action itself is killed. Every 5 minutes, flip any source that has
// been queued/processing for too long to failed, preserving its last-known
// stage so the card shows where it stopped.
crons.interval(
  "sources-stuck-watchdog",
  { minutes: 5 },
  internal.sources.failStaleProcessingSources,
);

export default crons;
