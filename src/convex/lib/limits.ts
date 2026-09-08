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
