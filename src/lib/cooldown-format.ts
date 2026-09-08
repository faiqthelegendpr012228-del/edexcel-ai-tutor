// Frontend copy of the large-upload cooldown formatter. The canonical logic
// lives in src/convex/lib/limits.ts; this mirror keeps a tiny pure helper
// available to client components without importing Convex server code.
export function formatRemainingCooldown(ms: number): string {
  const totalMinutes = Math.max(1, Math.ceil(ms / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}
