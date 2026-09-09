// Frontend copy of the large-upload cooldown formatter. The canonical logic
// lives in src/convex/lib/limits.ts; this mirror keeps a tiny pure helper
// available to client components without importing Convex server code.
export function formatRemainingCooldown(ms: number): string {
  const totalMinutes = Math.max(1, Math.ceil(ms / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

/** "3d 4h" / "5h 12m" / "43m" — mirrors formatResetIn in src/convex/lib/limits.ts. */
export function formatResetIn(ms: number): string {
  if (ms >= 86_400_000) {
    const days = Math.floor(ms / 86_400_000);
    const hours = Math.floor((ms % 86_400_000) / 3_600_000);
    return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  }
  return formatRemainingCooldown(ms);
}
