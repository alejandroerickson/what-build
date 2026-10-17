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

/** How long until a moment, coarse enough to stay true while it is on screen: "in 25 min", "in 5 h". */
export function untilTime(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "—";
  const s = Math.round((Date.parse(iso) - now) / 1000);
  if (s < 45) return "in a moment";
  if (s < 3600) return `in ${Math.round(s / 60)} min`;
  if (s < 86400) return `in ${Math.round(s / 3600)} h`;
  return `in ${Math.round(s / 86400)} d`;
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

export const ROLE_WORD: Record<string, string> = { owner: "Owner", admin: "Admin", member: "Member", visitor: "Visitor", editor: "Editor", viewer: "Viewer", reader: "Reader" };

/** A role with its article, for sentences: "an editor", "a viewer". */
export function aRole(role: string): string {
  return `${/^[aeiou]/.test(role) ? "an" : "a"} ${role}`;
}

/**
 * Where a role applies, for sentences: "the organization", "the Core team" (a team already named
 * "Product team" is not called a team twice), or a product by its name alone.
 */
export function scopeWords(type: string, name: string): string {
  if (type === "tenant") return "the organization";
  if (type === "team") return /\bteam$/i.test(name.trim()) ? `the ${name}` : `the ${name} team`;
  return name;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * A passage's text as a person reads it. Parsers keep a heading's Markdown markers ("## Scope") in
 * the stored text, which search and agents read; the reader shows the heading without them.
 */
export function passageText(text: string, headingLevel: number | null | undefined): string {
  return headingLevel ? text.replace(/^#{1,6}[ \t]+/, "") : text;
}

/**
 * A quotation's text ready to sit inside the app's own quotation marks (a <q> element). Quotation
 * marks already in the text become the inner, single kind, so `Sam: "It's slow."` reads
 * “Sam: ‘It's slow.’”; when the whole text is one quotation, its own marks are dropped.
 */
export function nestQuotes(text: string): string {
  const t = text.trim();
  const marks = t.match(/["“”]/g)?.length ?? 0;
  if (!marks) return text;
  if (marks === 2 && /^["“]/.test(t) && /["”]$/.test(t)) return t.slice(1, -1);
  return t.replace(/["“”]/g, (m, i: number) => {
    if (m === "“") return "‘";
    if (m === "”") return "’";
    return i === 0 || /[\s([{—–/-]/.test(t[i - 1]!) ? "‘" : "’";
  });
}

const FILE_TYPES: Record<string, string> = {
  "application/pdf": "PDF document",
  "application/msword": "Word document",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "Word document",
  "application/vnd.ms-excel": "Excel workbook",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "Excel workbook",
  "application/vnd.ms-powerpoint": "PowerPoint presentation",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "PowerPoint presentation",
  "application/vnd.oasis.opendocument.text": "OpenDocument text",
  "application/vnd.oasis.opendocument.spreadsheet": "OpenDocument spreadsheet",
  "application/vnd.oasis.opendocument.presentation": "OpenDocument presentation",
  "application/rtf": "Rich text document",
  "application/json": "JSON file",
  "application/zip": "ZIP archive",
  "application/x-subrip": "SRT subtitles",
  "text/plain": "Plain text",
  "text/markdown": "Markdown",
  "text/html": "Web page (HTML)",
  "text/csv": "CSV spreadsheet",
  "text/tab-separated-values": "TSV spreadsheet",
  "text/vtt": "WebVTT transcript",
  "image/svg+xml": "SVG image",
};

/**
 * A file's type in words ("Word document"), not its media type. An unknown type falls back to its
 * family ("Audio (MPEG)"), then the file's extension, and only then to the media type itself.
 */
export function fileTypeName(mediaType: string | null | undefined, path?: string): string {
  const t = (mediaType ?? "").split(";")[0]!.trim().toLowerCase();
  const known = FILE_TYPES[t];
  if (known) return known;
  const [family, sub] = t.split("/");
  const words: Record<string, string> = { audio: "Audio", video: "Video", image: "Image" };
  if (family && sub && words[family]) return `${words[family]} (${sub.replace(/^x-/, "").toUpperCase()})`;
  const ext = path?.match(/\.([a-z0-9]{1,8})$/i)?.[1];
  if (ext) return `${ext.toUpperCase()} file`;
  return t || "Unknown type";
}
