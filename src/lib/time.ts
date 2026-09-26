export function formatClock(seconds: number, withMs = false) {
  const safe = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = Math.floor(safe % 60);
  const ms = Math.floor((safe % 1) * 100);
  const core =
    h > 0
      ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
      : `${m}:${String(s).padStart(2, "0")}`;
  return withMs ? `${core}.${String(ms).padStart(2, "0")}` : core;
}

export function formatRelative(ts: number) {
  const delta = Date.now() - ts;
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (delta < hour) return `${Math.max(1, Math.floor(delta / minute))} minutes ago`;
  if (delta < day) return `${Math.floor(delta / hour)} hours ago`;
  if (delta < 7 * day) return `${Math.floor(delta / day)} days ago`;
  if (delta < 14 * day) return "1 week ago";
  return `${Math.floor(delta / (7 * day))} weeks ago`;
}

export function formatDate(ts: number) {
  return new Date(ts).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

export function formatBytes(bytes: number) {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
