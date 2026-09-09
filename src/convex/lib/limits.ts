// Large-upload rate limiting. Shared between `sources.ts` (enforcement at
// upload time) and `processSource.ts` (page-count stamping) so both sides
// agree on what "large" means. Kept in its own module to avoid a circular
// import between the two.

/** Files over this size are "large" at upload time (scanned textbooks). */
export const LARGE_FILE_BYTES = 25 * 1024 * 1024; // 25 MB

/** Extracted documents over this many pages are "large" too (text-heavy books). */
export const LARGE_PAGE_COUNT = 100;

/** One large file per student per window; small files are unlimited. */
export const LARGE_COOLDOWN_MS = 90 * 60 * 1000; // 90 minutes

/** A source still "processing" after this long is considered dead; the
 * watchdog cron marks it failed so it can never hang in "Processing". */
export const SOURCE_STUCK_AFTER_MS = 15 * 60 * 1000; // 15 minutes

export function largeUploadRemainingMs(
  lastLargeUploadAt: number | undefined,
  now: number,
): number {
  if (!lastLargeUploadAt) return 0;
  return Math.max(0, lastLargeUploadAt + LARGE_COOLDOWN_MS - now);
}

/** "1h 12m" / "43m" — for student-facing messages. */
export function formatRemainingCooldown(ms: number): string {
  const totalMinutes = Math.max(1, Math.ceil(ms / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

// ---------------------------------------------------------------------------
// AI usage quota + free-tier planning (SINGLE SOURCE OF TRUTH — tune here)
//
// Google changes free-tier limits from time to time; re-verify at
// https://ai.google.dev/gemini-api/docs/pricing and adjust these numbers.
// Nothing else in the codebase hardcodes them.
// ---------------------------------------------------------------------------

/** Grounded (source-searched) tutor answers allowed per student per rolling window. */
export const TUTOR_GROUNDED_QUOTA_PER_WEEK = 10;

/** Length of the rolling quota window in days ("weekly" quota, rolling so bursts smooth out). */
export const QUOTA_WINDOW_DAYS = 7;

/** Gemini File Search free monthly query allowance for the whole API key (Google's published limit). */
export const GEMINI_FILE_SEARCH_FREE_QUERIES_PER_MONTH = 5000;

/** Fraction of the free monthly allowance to plan against (headroom for retries, errors, spikes). */
export const FREE_TIER_PLANNING_HEADROOM = 0.8;

/**
 * Rough student count at which 10 grounded answers/week each still fits the
 * free tier: students <= allowance / (quota * weeks-per-month).
 */
export const FREE_TIER_COMFORTABLE_STUDENT_CAP = Math.floor(
  (GEMINI_FILE_SEARCH_FREE_QUERIES_PER_MONTH * FREE_TIER_PLANNING_HEADROOM) /
    ((TUTOR_GROUNDED_QUOTA_PER_WEEK * 52) / 12),
);

/** "3d 4h" / "5h 12m" / "43m" — for quota reset messages. */
export function formatResetIn(ms: number): string {
  if (ms >= 86_400_000) {
    const days = Math.floor(ms / 86_400_000);
    const hours = Math.floor((ms % 86_400_000) / 3_600_000);
    return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  }
  return formatRemainingCooldown(ms);
}

// ---------------------------------------------------------------------------
// Retrieval gating: which tutor turns genuinely need a source search?
//
// Deliberately conservative — the DEFAULT is to search. Only turns that are
// unambiguously conversational (acknowledgments, bare follow-ups, requests to
// continue) skip retrieval. Anything phrased as a question, any content request
// ("explain osmosis", "define entropy"), and anything ambiguous gets grounded.
// ---------------------------------------------------------------------------

/** Full-match acknowledgments that never need retrieval. */
const ACKNOWLEDGMENT_PATTERNS: RegExp[] = [
  /^(thanks|thank you|thank u|ty|thx|cheers)[\s!.?]*$/i,
  /^(ok|okay|kk|k|cool|nice|nice one|great|awesome|perfect|sweet|lovely|brilliant)[\s!.?]*$/i,
  /^(got it|gotcha|makes sense|understood|will do|sounds good|sure thing|fair enough|ah i see|oh i see)[\s!.?]*$/i,
];

/** Full-match follow-ups that reuse the previous (already grounded) context. */
const FOLLOWUP_PATTERNS: RegExp[] = [
  /^(go on|keep going|continue|carry on|next|next question|and\?|and then\?|so\?|what else|tell me more|more|elaborate|expand|go deeper)[\s!.?]*$/i,
  /^(again|repeat|one more|another( one)?|example( please)?|give me an example)[\s!.?]*$/i,
  /^(test me|quiz me|try me|give me a question|ask me)[\s!.?]*$/i,
  /^(hmm+|hm+|wow|omg|really\?)[\s!.?]*$/i,
];

export interface GroundingDecision {
  ground: boolean;
  /** Why this turn was grounded or skipped — stored on the message for transparency. */
  reason:
    | "needed"
    | "acknowledgment"
    | "followup"
    | "forced"
    | "outside"
    | "empty";
}

/**
 * Decide whether a tutor turn should spend a File Search query.
 * Fail-safe: anything not clearly conversational is grounded.
 */
export function decideGrounding(opts: {
  userMessage: string;
  hasPriorAssistantTurn: boolean;
}): GroundingDecision {
  const text = opts.userMessage.trim();
  if (!text) return { ground: false, reason: "empty" };
  // Any question — even a short one — gets grounded.
  if (/\?\s*$/.test(text)) return { ground: true, reason: "needed" };
  const normalized = text.replace(/[\s!.]+$/, "");
  if (ACKNOWLEDGMENT_PATTERNS.some((re) => re.test(normalized))) {
    return { ground: false, reason: "acknowledgment" };
  }
  if (
    opts.hasPriorAssistantTurn &&
    FOLLOWUP_PATTERNS.some((re) => re.test(normalized))
  ) {
    return { ground: false, reason: "followup" };
  }
  return { ground: true, reason: "needed" };
}
