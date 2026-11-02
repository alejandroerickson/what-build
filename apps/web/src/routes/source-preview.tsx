import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { api, qs } from "../lib/api.ts";
import { attribution, clockLength, fileTypeName, formatBytes, formatDate } from "../lib/format.ts";
import { pictureOfHtml } from "../lib/html-picture.ts";
import { Markdown } from "../lib/markdown.tsx";
import { useProduct } from "../lib/session.tsx";
import type { ListedAttachment, ListedSource } from "../lib/types.ts";
import { frameOf, sendFrame } from "../lib/video-frame.ts";
import { Button, ButtonLink, ErrorCallout, Glyph, IconButton, Loading, Tag } from "../ui/index.tsx";
import { attachmentUrl, attachmentViewUrl, AttachmentPreview, previewKind, RecordingPlayer } from "./source-attachments.tsx";
import { AttachmentFace, attachmentGlyph, DeckCard, extensionLabel } from "./source-face.tsx";

/** What the preview moves through, side to side: the summary, the source's own text when it is no attachment's, then each attachment. */
export type PreviewPage = { kind: "summary" } | { kind: "text" } | { kind: "attachment"; a: ListedAttachment };

export function previewPages(s: ListedSource): PreviewPage[] {
  return [
    ...(s.summary ? [{ kind: "summary" as const }] : []),
    ...(s.first_lines && !s.text_from ? [{ kind: "text" as const }] : []),
    ...s.attachments.map((a) => ({ kind: "attachment" as const, a })),
  ];
}

/** The picture a page shows, for the browser to have ready before someone arrives at it. Costs no call. */
export function previewPicture(page: PreviewPage | undefined): string | null {
  return page?.kind === "attachment" ? (page.a.picture?.preview_url ?? null) : null;
}

const SETTLE_MS = 160;
/** How much of a picture's original the preview loads by itself when it has no small copy yet. */
const ORIGINAL_SHOWN_MAX_BYTES = 4 * 1024 * 1024;
/** How long a list's summary is before it may have been cut (`LIST_SUMMARY_MAX`, and what marks the cut). */
const LISTED_SUMMARY_CHARS = 1000;
/** The most of an HTML page its route frames (`HTML_VIEW_MAX_BYTES`). */
const HTML_SHOWN_MAX_BYTES = 4 * 1024 * 1024;
/** The most of an HTML page this tab fetches to draw a picture of it, which costs a call. */
const HTML_DRAWN_MAX_BYTES = 2 * 1024 * 1024;
/** The pages this tab has tried to draw, so that one that can't be drawn isn't fetched each time someone comes to it. */
const triedToDraw = new Set<string>();

/**
 * True once `key` has stayed the same a moment. What costs a call waits for it, so that moving
 * through a list spends none on the sources someone only passed through.
 */
function useSettled(key: string): boolean {
  const [settled, setSettled] = useState(key);
  useEffect(() => {
    const t = setTimeout(() => setSettled(key), SETTLE_MS);
    return () => clearTimeout(t);
  }, [key]);
  return settled === key;
}

function Words({ query, words }: { query: { isError: boolean; error: unknown; refetch: () => unknown }; words: string | undefined }) {
  if (words !== undefined)
    return (
      <div className="preview-words">
        <Markdown source={words} className="prose" />
      </div>
    );
  if (query.isError)
    return (
      <div className="preview-words">
        <ErrorCallout inset title="This couldn’t be loaded" error={query.error} onRetry={() => query.refetch()} />
      </div>
    );
  return (
    <div className="preview-words">
      <Loading label="Loading…" variant="lines" lines={5} />
    </div>
  );
}

function SummaryPage({ s, settled }: { s: ListedSource; settled: boolean }) {
  const { api: base } = useProduct();
  const cut = (s.summary?.length ?? 0) >= LISTED_SUMMARY_CHARS;
  const whole = useQuery({
    queryKey: ["source-agent-note", base, s.record_id, "summary", s.etag],
    queryFn: () => api<{ content: string }>("GET", `${base}/sources/${s.record_id}/agent-notes/summary`),
    enabled: cut && settled,
    staleTime: 60_000,
  });
  return (
    <div className="preview-scroll preview-summary">
      <Markdown source={whole.data?.content ?? s.summary ?? ""} className="prose" />
      {s.tags.length ? (
        <div className="preview-tags">
          {s.tags.map((t) => (
            <Tag key={t}>{t}</Tag>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** The source's own text, whole: what someone wrote, or kept when they edited what was read. */
function TextPage({ s, settled }: { s: ListedSource; settled: boolean }) {
  const { api: base } = useProduct();
  const q = useQuery({
    queryKey: ["source-preview-text", base, s.record_id, s.etag],
    queryFn: async () => {
      const r = await api<{ text: string }>("GET", `${base}/sources/${s.record_id}/derived/text`);
      return r.text;
    },
    enabled: settled,
    staleTime: 60_000,
  });
  return (
    <div className="preview-scroll">
      <Words query={q} words={q.data ?? s.first_lines ?? undefined} />
    </div>
  );
}

/** The words read from an attachment. A Word document, a workbook, a deck's slides and a transcript all read this way. */
function ReadWords({ s, a, settled }: { s: ListedSource; a: ListedAttachment; settled: boolean }) {
  const { api: base } = useProduct();
  const q = useQuery({
    queryKey: ["attachment-read-text", base, s.record_id, a.file_version_id],
    queryFn: () => api<{ text: string; truncated: boolean; total_chars: number }>("GET", `${base}/sources/${s.record_id}/derived/text${qs({ path: a.path })}`),
    enabled: settled,
    staleTime: 60_000,
  });
  return (
    <>
      <Words query={q} words={q.data?.text ?? (a.path === s.text_from && s.first_lines ? s.first_lines : undefined)} />
      {q.data?.truncated ? <p className="preview-note">This is the start of it, {q.data.total_chars.toLocaleString("en-GB")} characters in all. Its source’s page has the rest.</p> : null}
    </>
  );
}

function NoPreview({ recordId, a, children }: { recordId: string; a: ListedAttachment; children: string }) {
  const { api: base } = useProduct();
  const ext = extensionLabel(a.path);
  return (
    <div className="preview-none">
      <span className="face face-icon">
        <Glyph name={attachmentGlyph(a)} />
        <span aria-hidden="true">{ext}</span>
      </span>
      <b>{a.path}</b>
      <p>{children}</p>
      <a className="btn btn-secondary btn-md" href={attachmentUrl(base, recordId, a.path, true)}>
        <Glyph name="download" />
        Download{a.size ? `, ${formatBytes(a.size)}` : ""}
      </a>
    </div>
  );
}

/** One attachment in the preview: what it looks like when it has a picture, and what it says when it can be read. */
function AttachmentPage({ s, a, settled, canGivePicture }: { s: ListedSource; a: ListedAttachment; settled: boolean; canGivePicture: boolean }) {
  const { api: base } = useProduct();
  const [whole, setWhole] = useState(false);
  const [zoomed, setZoomed] = useState(false);
  const [unshowable, setUnshowable] = useState(false);
  const pic = a.picture;
  // An image stored under an unknown type before WhatBuild named its format still has its picture.
  const kind = pic?.made_from === "image" ? "image" : previewKind(a);
  const url = attachmentUrl(base, s.record_id, a.path);

  // Whoever stops on an HTML page gives it its picture, as they do a video when it plays, and everyone in the product then sees it.
  useEffect(() => {
    if (kind !== "html" || !settled || !canGivePicture || pic?.thumb_url || (a.size ?? 0) > HTML_DRAWN_MAX_BYTES || triedToDraw.has(a.file_version_id)) return;
    triedToDraw.add(a.file_version_id);
    void fetch(url)
      .then((r) => (r.ok ? r.text() : null))
      .then((html) => (html ? pictureOfHtml(html) : null))
      .then((picture) => (picture ? sendFrame(base, s.record_id, a.path, picture) : undefined))
      .catch(() => undefined);
  }, [kind, settled, canGivePicture, pic?.thumb_url, a.size, a.file_version_id, a.path, url, base, s.record_id]);
  const readable = a.text.status === "ready";
  const isDeck = pic?.made_from === "deck" || extensionLabel(a.path) === "PPTX";

  let body;
  if (kind === "image" && unshowable) {
    body = <NoPreview recordId={s.record_id} a={a}>This browser can’t show this image’s format. Download it to open it in another app.</NoPreview>;
  } else if (kind === "image") {
    const shown = pic?.preview_url ?? (whole || (a.size ?? 0) <= ORIGINAL_SHOWN_MAX_BYTES ? url : null);
    body = shown ? (
      settled || pic?.preview_url ? (
        <button type="button" className="preview-stage" onClick={() => setZoomed(true)} title="Show it full size">
          <img src={shown} alt={a.path} decoding="async" onError={() => setUnshowable(true)} />
        </button>
      ) : (
        <div className="preview-stage" />
      )
    ) : (
      <div className="preview-none">
        <p>There is no small copy of this image, which is {formatBytes(a.size)}.</p>
        <Button onClick={() => setWhole(true)}>Show the image</Button>
      </div>
    );
  } else if (kind === "pdf") {
    body = whole ? (
      <iframe title={a.path} src={url} className="preview-frame" />
    ) : pic?.preview_url ? (
      <>
        <div className="preview-stage is-page">
          <img src={pic.preview_url} alt={`Page one of ${a.path}`} decoding="async" />
        </div>
        <p className="preview-note is-action">
          <span>{pic.pages && pic.pages > 1 ? "Page one." : "Its only page."}</span>
          {pic.pages && pic.pages > 1 ? (
            <Button size="sm" onClick={() => setWhole(true)}>
              Show all {pic.pages} pages
            </Button>
          ) : null}
        </p>
      </>
    ) : (
      <>
        <div className="preview-scroll">{readable ? <ReadWords s={s} a={a} settled={settled} /> : null}</div>
        <p className="preview-note is-action">
          <span>{readable ? "Its text, as it was read." : "Its picture isn’t ready yet."}</span>
          <Button size="sm" onClick={() => setWhole(true)}>
            Show the PDF
          </Button>
        </p>
      </>
    );
  } else if (kind === "html" && (a.size ?? 0) <= HTML_SHOWN_MAX_BYTES) {
    body = (
      <>
        {settled ? <iframe title={a.path} sandbox="" referrerPolicy="no-referrer" src={attachmentViewUrl(base, s.record_id, a.path)} className="preview-frame" /> : <div className="preview-frame" />}
        <p className="preview-note">Shown without its scripts, and without anything it loads from elsewhere.</p>
      </>
    );
  } else if (kind === "audio" || kind === "video") {
    body = (
      <RecordingPlayer
        key={a.file_version_id}
        kind={kind}
        url={url}
        downloadUrl={attachmentUrl(base, s.record_id, a.path, true)}
        poster={pic?.preview_url ?? null}
        onPlaying={
          kind === "video" && canGivePicture && !pic?.thumb_url
            ? (video) => {
                void frameOf(video).then((frame) => (frame ? sendFrame(base, s.record_id, a.path, frame) : undefined));
              }
            : undefined
        }
      />
    );
  } else if (isDeck) {
    body = (
      <div className="preview-scroll">
        {pic?.preview_url ? (
          <div className="preview-slide">
            <img src={pic.preview_url} alt={`The first slide of ${a.path}`} decoding="async" />
          </div>
        ) : pic?.card ? (
          <div className="preview-slide">
            <DeckCard large title={pic.card.title} colour={pic.card.colour} />
          </div>
        ) : null}
        {readable ? <ReadWords s={s} a={a} settled={settled} /> : <p className="preview-note">Its text hasn’t been read.</p>}
      </div>
    );
  } else if (readable) {
    body = (
      <div className="preview-scroll">
        <ReadWords s={s} a={a} settled={settled} />
      </div>
    );
  } else if (a.text.status === "pending") {
    body = <NoPreview recordId={s.record_id} a={a}>This attachment is still being read. Its text shows here once it has been.</NoPreview>;
  } else if (a.text.status === "too_large" || a.text.status === "failed") {
    body = <NoPreview recordId={s.record_id} a={a}>{a.text.status === "failed" ? "WhatBuild keeps this attachment, but reading it failed. Its source’s page can read it again." : "WhatBuild keeps this attachment, but it is too large to read."}</NoPreview>;
  } else {
    body = <NoPreview recordId={s.record_id} a={a}>WhatBuild keeps this attachment, but can’t show or read this format. An agent that can open it can add a picture of it to this source, or write what it says.</NoPreview>;
  }

  const length = a.text.duration_ms;
  return (
    <>
      <div className="preview-bar">
        <span className="preview-bar-name" title={a.path}>
          {a.path}
        </span>
        <span className="preview-bar-type num">
          {fileTypeName(a.media_type, a.path)}
          {length ? ` · ${clockLength(length)}` : ` · ${formatBytes(a.size)}`}
        </span>
        <span className="preview-bar-actions">
          {kind === "image" || (kind === "html" && (a.size ?? 0) <= HTML_SHOWN_MAX_BYTES) ? <IconButton icon="maximize" label="Show it full size" onClick={() => setZoomed(true)} /> : null}
          <a className="icon-btn icon-btn-md" href={attachmentUrl(base, s.record_id, a.path, true)} aria-label={`Download ${a.path}`} title="Download">
            <Glyph name="download" />
          </a>
        </span>
      </div>
      {body}
      {zoomed ? <ZoomedImages s={s} path={a.path} onClose={() => setZoomed(false)} /> : null}
    </>
  );
}

function ZoomedImages({ s, path, onClose }: { s: ListedSource; path: string; onClose: () => void }) {
  const [current, setCurrent] = useState(path);
  return <AttachmentPreview record={s} path={current} onSelect={setCurrent} onClose={onClose} />;
}

/**
 * A source beside the list. It shows what the list already holds, so moving through sources costs
 * no call unless someone stops on one that needs its text or its original. Its pages are a list of
 * kinds, so the summary being HTML one day is one more kind of page.
 */
export function SourcePreview({ s, page, onPage, onClose, to, phone }: { s: ListedSource; page: number; onPage: (n: number) => void; onClose: () => void; to: string; phone: boolean }) {
  const { canGivePicture } = useProduct();
  const pages = previewPages(s);
  const at = Math.min(Math.max(0, page), Math.max(0, pages.length - 1));
  const shown = pages[at];
  const settled = useSettled(`${s.record_id}:${at}`);
  const strip = useRef<HTMLDivElement>(null);
  useEffect(() => {
    strip.current?.querySelector("[aria-current]")?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [at, s.record_id]);
  const sub = [s.date ? formatDate(s.date) : null, attribution(s.uploaded_by)].filter(Boolean).join(" · ");
  return (
    <section className="sheet sources-preview" aria-label={`Preview of ${s.title}`}>
      <header className="preview-head">
        {phone ? <IconButton icon="chevron-left" label="Back to the list" onClick={onClose} /> : null}
        <div className="preview-head-main">
          <h2>{s.title}</h2>
          <p className="num">{sub}</p>
        </div>
        <span className="preview-head-actions">
          <ButtonLink to={to}>Open source</ButtonLink>
          {phone ? null : <IconButton icon="x" label="Close the preview" title="Close the preview (Esc)" onClick={onClose} />}
        </span>
      </header>
      {!shown ? (
        <div className="preview-none">
          <p>Nothing to show yet: this source has no summary, text or attachments.</p>
        </div>
      ) : shown.kind === "summary" ? (
        <SummaryPage s={s} settled={settled} />
      ) : shown.kind === "text" ? (
        <TextPage s={s} settled={settled} />
      ) : (
        <AttachmentPage key={shown.a.file_version_id} s={s} a={shown.a} settled={settled} canGivePicture={canGivePicture} />
      )}
      {pages.length > 1 ? (
        <footer className="preview-pager">
          <span className="preview-pager-at">
            <IconButton icon="chevron-left" size="sm" label="Previous page" disabled={at === 0} onClick={() => onPage(at - 1)} />
            <span className="num" aria-live="polite">
              {at + 1} of {pages.length}
            </span>
            <IconButton icon="chevron-right" size="sm" label="Next page" disabled={at === pages.length - 1} onClick={() => onPage(at + 1)} />
          </span>
          <div className="preview-strip" ref={strip} role="group" aria-label={`Pages of ${s.title}`}>
            {pages.map((p, n) => (
              <button key={p.kind === "attachment" ? p.a.path : p.kind} type="button" className="preview-tile" aria-current={n === at ? "true" : undefined} title={p.kind === "attachment" ? p.a.path : p.kind === "summary" ? "Summary" : "Text"} onClick={() => onPage(n)}>
                {p.kind === "attachment" ? (
                  <AttachmentFace a={p.a} />
                ) : (
                  <span className="face face-icon">
                    <Glyph name="file-text" />
                    <span>{p.kind === "summary" ? "Summary" : "Text"}</span>
                  </span>
                )}
              </button>
            ))}
          </div>
        </footer>
      ) : null}
    </section>
  );
}
