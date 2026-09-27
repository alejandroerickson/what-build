const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "June", "July", "Aug", "Sept", "Oct", "Nov", "Dec"];

/** "2 Sept 2026": day, short month, year. A plain date keeps its day; a timestamp shows the local day. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  if (iso.length > 10) {
    const t = new Date(iso);
    if (!Number.isNaN(t.getTime())) return `${t.getDate()} ${MONTHS[t.getMonth()]} ${t.getFullYear()}`;
  }
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return iso;
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** "2:18 PM" (or "14:18" where the locale uses a 24-hour clock): local time, hour not zero-padded. */
export function formatTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/** "26 Sept 2026, 2:18 PM": the app's date, then the local time. */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return `${formatDate(iso)}, ${formatTime(iso)}`;
}

/** Coarse enough to stay true while it is on screen. */
export function relativeTime(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "—";
  const s = Math.round((now - Date.parse(iso)) / 1000);
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  if (s < 7 * 86400) return `${Math.round(s / 86400)} d ago`;
  return formatDate(new Date(iso).toISOString());
}

export function formatBytes(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/** Cue time: m:ss.t, or h:mm:ss.t past an hour. */
export function formatCue(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "";
  const t = Math.floor(ms / 100);
  const tenths = t % 10;
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}.${tenths}` : `${m}:${ss}.${tenths}`;
}

export function formatDuration(ms: number | null | undefined): string {
  if (!ms) return "—";
  const min = Math.round(ms / 60000);
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${min % 60} min`;
}

export function actorName(actor: { display_name?: string; surface?: string | null; client?: string | null } | null | undefined): string {
  if (!actor) return "Someone";
  return actor.display_name || "Someone";
}

/** "Sam · via claude-code" when an agent did it. */
export function attribution(actor: { display_name?: string; surface?: string | null; client?: string | null } | null | undefined): string {
  const name = actorName(actor);
  if (actor?.surface === "mcp") return `${name} · via ${actor.client || "an agent"}`;
  return name;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * A passage's text as a person reads it. Parsers keep a heading's Markdown markers ("## Scope") in
 * the stored text, which citations quote; the reader shows the heading without them.
 */
export function passageText(text: string, headingLevel: number | null | undefined): string {
  return headingLevel ? text.replace(/^#{1,6}[ \t]+/, "") : text;
}
