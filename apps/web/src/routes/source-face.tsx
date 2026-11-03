import { memo, useState, type ReactNode } from "react";
import { clockLength } from "../lib/format.ts";
import { useProduct } from "../lib/session.tsx";
import type { ListedAttachment, ListedSource } from "../lib/types.ts";
import { Glyph, type GlyphName } from "../ui/index.tsx";
import { SourceCardFace, useSourceCardUrl } from "./source-card.tsx";

/** The letters of an attachment's name after its last dot, for a small label: "PDF". */
export function extensionLabel(path: string): string {
  const name = path.split("/").pop() ?? path;
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(i + 1, i + 6).toUpperCase() : "";
}

/** The icon that says what kind of attachment this is, when it has no picture and no words to show. */
export function attachmentGlyph(a: Pick<ListedAttachment, "path" | "media_type">): GlyphName {
  const type = a.media_type ?? "";
  const ext = extensionLabel(a.path);
  if (type.startsWith("video/")) return "file-video";
  if (type.startsWith("audio/")) return "file-audio";
  if (type.startsWith("image/")) return "image";
  if (["PPTX", "PPT", "KEY", "ODP"].includes(ext)) return "presentation";
  if (["XLSX", "XLS", "CSV", "TSV", "ODS"].includes(ext)) return "file-spreadsheet";
  const words = type.startsWith("text/") || ["DOCX", "DOC", "PDF", "MD", "TXT", "HTML", "HTM", "RTF", "JSON", "VTT", "SRT", "LOG"].includes(ext);
  return words ? "file-text" : "file";
}

/** A line of Markdown as a small page sets it: how it reads, without the marks. */
function PageLine({ line }: { line: string }) {
  const plain = (s: string) => s.replace(/\*\*|__|`/g, "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
  const heading = /^#{1,6}\s+(.*)$/.exec(line);
  if (heading) return <span className="page-line is-heading">{plain(heading[1]!)}</span>;
  if (/^\|/.test(line)) {
    if (/^\|[\s:|-]+\|?$/.test(line)) return null;
    const cells = line.split("|").slice(1, -1);
    return (
      <span className="page-line is-row">
        {cells.slice(0, 4).map((c, i) => (
          <span key={i}>{plain(c.trim())}</span>
        ))}
      </span>
    );
  }
  const item = /^\s*(?:[-*+]|\d+\.)\s+(.*)$/.exec(line);
  if (item) return <span className="page-line is-item">{plain(item[1]!)}</span>;
  return <span className="page-line">{plain(line)}</span>;
}

/** The start of a text as a small page, for someone to recognise its shape rather than read it. */
export const SmallPage = memo(function SmallPage({ text, mark }: { text: string; mark?: ReactNode }) {
  const lines = text.split("\n").filter((l) => l.trim()).slice(0, 12);
  return (
    <span className="face face-page">
      <span className="face-page-in" aria-hidden="true">
        {lines.map((line, i) => (
          <PageLine key={i} line={line} />
        ))}
      </span>
      {mark}
    </span>
  );
});

/** A deck's first slide, drawn from its title and its theme's colour, for a deck that carries no picture of itself. */
export function DeckCard({ title, colour, mark, large }: { title: string; colour: string | null; mark?: ReactNode; large?: boolean }) {
  return (
    <span className={`face face-card${large ? " is-large" : ""}`} style={colour ? { ["--card" as string]: `#${colour}` } : undefined}>
      <span>{title}</span>
      {mark}
    </span>
  );
}

function IconFace({ a, mark }: { a: Pick<ListedAttachment, "path" | "media_type">; mark?: ReactNode }) {
  return (
    <span className="face face-icon">
      <Glyph name={attachmentGlyph(a)} />
      <span aria-hidden="true">{extensionLabel(a.path)}</span>
      {mark}
    </span>
  );
}

/** A picture in a face. Should it not load (its address has expired, say), the next thing is shown instead. */
function PictureFace({ url, fallback, mark }: { url: string; fallback: ReactNode; mark?: ReactNode }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <>{fallback}</>;
  return (
    <span className="face">
      <img src={url} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} />
      {mark}
    </span>
  );
}

/** One attachment as a small tile: its picture, its card, or its icon. */
export function AttachmentFace({ a, words, mark }: { a: ListedAttachment; words?: string | null; mark?: ReactNode }) {
  const next = a.picture?.card ? <DeckCard title={a.picture.card.title} colour={a.picture.card.colour} mark={mark} /> : words ? <SmallPage text={words} mark={mark} /> : <IconFace a={a} mark={mark} />;
  // Keyed by its address: a list loaded again gives a new one, and a picture that failed gets another try.
  return a.picture?.thumb_url ? <PictureFace key={a.picture.thumb_url} url={a.picture.thumb_url} fallback={next} mark={mark} /> : next;
}

/** The attachment a source is known by, with a picture to show: its first image, then a PDF's page, a deck's slide or a video's frame. */
function pictured(atts: ListedAttachment[]): ListedAttachment | undefined {
  const by = (from: string) => atts.find((a) => a.picture?.thumb_url && a.picture.made_from === from);
  return by("image") ?? by("pdf") ?? by("deck") ?? by("frame");
}

/**
 * What a source looks like in the list: the first it can show of a picture of the thing itself (an
 * image, a PDF's page, a deck's slide or card, a video's frame), the card an agent drew of it, a
 * small page of its own words, and an icon of what it holds.
 */
export const SourceFace = memo(function SourceFace({ s, compact }: { s: ListedSource; compact: boolean }) {
  const { api: base } = useProduct();
  const card = useSourceCardUrl(base, s.record_id, s.card_etag);
  const atts = s.attachments;
  const length = atts.find((a) => a.text.duration_ms && /^(audio|video)\//.test(a.media_type ?? ""))?.text.duration_ms;
  const shown = pictured(atts) ?? atts.find((a) => a.picture?.card);
  const words = s.first_lines ?? s.summary;
  let mark: ReactNode = null;
  if (length) {
    mark = (
      <span className="face-mark is-play">
        <Glyph name="play" size="sm" />
        {clockLength(length)}
      </span>
    );
  } else if (compact && atts.length > 1) {
    mark = (
      <span className="face-mark">
        <Glyph name="images" size="sm" />
        {atts.length}
      </span>
    );
  } else if (shown?.picture?.made_from === "pdf") {
    mark = <span className="face-mark">PDF</span>;
  } else if (!shown && s.text_from) {
    // A small page looks the same whatever it was read from; a label says when that was not a page of text.
    const ext = extensionLabel(s.text_from);
    if (ext && !["MD", "TXT", "MARKDOWN"].includes(ext)) mark = <span className="face-mark">{ext}</span>;
  }
  if (shown) return <AttachmentFace a={shown} words={words} mark={mark} />;
  const page = words ? <SmallPage text={words} mark={mark} /> : null;
  if (card) return <SourceCardFace key={card} src={card} mark={mark} fallback={page ?? <IconFace a={atts[0] ?? { path: "", media_type: null }} mark={mark} />} />;
  if (page) return page;
  if (atts[0]) return <IconFace a={atts[0]} mark={mark} />;
  return (
    <span className="face face-icon">
      <Glyph name="file" />
    </span>
  );
});
