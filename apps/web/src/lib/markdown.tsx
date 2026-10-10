import { Lexer, type Token, type Tokens } from "marked";
import { Fragment, type ReactNode } from "react";
import { Link, useInRouterContext } from "react-router";

/**
 * Safe Markdown: a GitHub-flavoured lexer mapped to React elements. No HTML string from the
 * source ever reaches the DOM; raw HTML is shown as text, images become links and never load, and
 * only web, mail, fragment and same-origin links are live.
 *
 * Evidence reads as "Source title ¶5": a link to a source or one of its passages gets the quiet
 * evidence style, and, when the caller knows the source titles, a bare citation written the way the
 * agent guidance asks — "source 01K…, segments 4–6" — becomes that same linked token.
 */

/**
 * What a caller knows for resolving bare citations: the product's app path, titles by id, and
 * optionally chip labels already worked out across a larger page (see `citationLabels`).
 */
export interface EvidenceContext {
  app: string;
  titles: Record<string, string | undefined>;
  labels?: Record<string, string>;
}

const ULID = "[0-9A-HJKMNP-TV-Z]{26}";
const BARE_CITATION = new RegExp(`\\bsource (${ULID})(?:(?:,\\s*(?:segments?\\s+|¶\\s?)|\\s+¶\\s?)(\\d+)(?:\\s*[–-]\\s*(\\d+))?)?`, "g");
const EVIDENCE_PATH = new RegExp(`/evidence/${ULID}(?:[?#]|$)`);

const SAFE_HREF = /^(https?:\/\/|mailto:|#|\/(?![/\\]))/i;

function safeHref(href: string | undefined): string | null {
  if (!href) return null;
  const cleaned = href.replace(/[\t\n\r]/g, "").trim();
  return SAFE_HREF.test(cleaned) ? cleaned : null;
}

/** Same-origin absolute links become in-app paths, so they open in place. */
function inApp(href: string): string {
  if (typeof window === "undefined" || !href.startsWith(window.location.origin + "/")) return href;
  return href.slice(window.location.origin.length);
}


/** "Title ¶5" with the ¶ kept on the title's line. */
function evidenceText(title: string, start?: string, end?: string): string {
  if (!start) return title;
  return `${title}\u00a0¶${start}${end && end !== start ? `–${end}` : ""}`;
}

/** Each bare citation in a text ("source 01K…, segments 4–6"), in order. */
export function bareCitations(text: string): { id: string; start?: string; end?: string }[] {
  if (!text.includes("source ")) return [];
  return [...text.matchAll(BARE_CITATION)].map((m) => ({ id: m[1]!, start: m[2], end: m[3] }));
}

/** The sources a text cites the bare way, in order of first mention. */
export function citedSourceIds(text: string): string[] {
  return [...new Set(bareCitations(text).map((c) => c.id))];
}

/** A citation's chip text: "Label ¶4–6". */
export function citationText(label: string, start?: string, end?: string): string {
  return evidenceText(label, start, end);
}

/**
 * Chip labels that tell sources apart on one page. A label starts as the title's part before an
 * em-dash qualifier ("Usability study"). Where cited sources would share a label, each adds its
 * next qualifier in brackets ("Usability study (crew)") until they differ; sources whose whole
 * titles match are numbered in order of mention.
 */
export function citationLabels(ids: string[], titles: Record<string, string | undefined>): Record<string, string> {
  const parts = new Map(ids.map((id) => [id, (titles[id] ?? "Source").split(" — ").map((p) => p.trim()).filter(Boolean)]));
  const depth = new Map(ids.map((id) => [id, 1]));
  const label = (id: string) => {
    const p = parts.get(id)!;
    const n = depth.get(id)!;
    if (!p.length) return "Source";
    return n <= 1 ? p[0]! : `${p[0]} (${p.slice(1, n).join(", ")})`;
  };
  const groups = () => {
    const by = new Map<string, string[]>();
    for (const id of ids) by.set(label(id), [...(by.get(label(id)) ?? []), id]);
    return by;
  };
  for (let grew = true; grew; ) {
    grew = false;
    for (const group of groups().values()) {
      if (group.length < 2) continue;
      for (const id of group) {
        if (depth.get(id)! >= parts.get(id)!.length) continue;
        depth.set(id, depth.get(id)! + 1);
        grew = true;
      }
    }
  }
  const out: Record<string, string> = {};
  for (const [l, group] of groups()) group.forEach((id, i) => (out[id] = group.length > 1 ? `${l} (${i + 1})` : l));
  return out;
}

/** An in-app link to a passage, or to a range of passages as `?seq=45&to=50`. */
export function passageHref(app: string, recordId: string, start?: number | string | null, end?: number | string | null): string {
  if (start === undefined || start === null || start === "") return `${app}/evidence/${recordId}`;
  const range = end !== undefined && end !== null && end !== "" && String(end) !== String(start);
  return `${app}/evidence/${recordId}?seq=${start}${range ? `&to=${end}` : ""}`;
}

function AppLink({ href, className, title, children }: { href: string; className?: string; title?: string; children: ReactNode }) {
  const routed = useInRouterContext();
  if (routed && href.startsWith("/")) {
    return (
      <Link to={href} className={className} title={title}>
        {children}
      </Link>
    );
  }
  return (
    <a href={href} className={className} title={title} target={href.startsWith("/") || href.startsWith("#") ? undefined : "_blank"} rel="noopener noreferrer">
      {children}
    </a>
  );
}

/**
 * Turn bare "source <id>, segment N" citations in a run of text into evidence links; or, where the
 * text already sits inside a link (a search hit), into the same token without a link of its own.
 */
export function citations(text: string, key: string, ev: EvidenceContext | undefined, asLink = true): ReactNode {
  if (!ev || !text.includes("source ")) return text;
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(BARE_CITATION)) {
    const [whole, id, start, end] = m;
    const known = ev.titles[id!];
    const label = evidenceText(ev.labels?.[id!] ?? citationLabels([id!], ev.titles)[id!]!, start, end);
    out.push(text.slice(last, m.index));
    out.push(
      asLink ? (
        <AppLink key={`${key}.c${m.index}`} href={passageHref(ev.app, id!, start, end)} className="evidence-link" title={known ?? undefined}>
          {label}
        </AppLink>
      ) : (
        <span key={`${key}.c${m.index}`} className="evidence-link" title={known ?? undefined}>
          {label}
        </span>
      ),
    );
    last = m.index! + whole.length;
  }
  if (!out.length) return text;
  out.push(text.slice(last));
  return out;
}

function decode(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function inline(tokens: Token[] | undefined, key = "i", ev?: EvidenceContext): ReactNode {
  if (!tokens) return null;
  return tokens.map((t, i) => {
    const k = `${key}.${i}`;
    switch (t.type) {
      case "text":
        return (t as Tokens.Text).tokens ? <Fragment key={k}>{inline((t as Tokens.Text).tokens, k, ev)}</Fragment> : <Fragment key={k}>{citations(decode(t.text), k, ev)}</Fragment>;
      case "escape":
        return <Fragment key={k}>{decode(t.text)}</Fragment>;
      case "strong":
        return <strong key={k}>{inline((t as Tokens.Strong).tokens, k, ev)}</strong>;
      case "em":
        return <em key={k}>{inline((t as Tokens.Em).tokens, k, ev)}</em>;
      case "del":
        return <del key={k}>{inline((t as Tokens.Del).tokens, k, ev)}</del>;
      case "codespan":
        return <code key={k}>{decode((t as Tokens.Codespan).text)}</code>;
      case "br":
        return <br key={k} />;
      case "link": {
        const safe = safeHref((t as Tokens.Link).href);
        const children = inline((t as Tokens.Link).tokens, k);
        if (!safe) return <Fragment key={k}>{children}</Fragment>;
        const href = inApp(safe);
        const lt = (t as Tokens.Link).tokens ?? [];
        // A link to a source or a passage is evidence: quiet accent token, ¶ kept with its title.
        if (href.startsWith("/") && EVIDENCE_PATH.test(href)) {
          const plain = lt.every((c) => c.type === "text" && !(c as Tokens.Text).tokens);
          return (
            <AppLink key={k} href={href} className="evidence-link">
              {plain ? decode(lt.map((c) => c.raw).join("")).replace(/ ¶/g, "\u00a0¶") : children}
            </AppLink>
          );
        }
        return (
          <AppLink key={k} href={href}>
            {children}
          </AppLink>
        );
      }
      case "image": {
        const href = safeHref((t as Tokens.Image).href);
        const label = (t as Tokens.Image).text || "image";
        return href ? (
          <a key={k} href={href} target="_blank" rel="noopener noreferrer">
            [{label}]
          </a>
        ) : (
          <Fragment key={k}>[{label}]</Fragment>
        );
      }
      case "html":
        return <Fragment key={k}>{t.raw.replace(/<br\s*\/?>/gi, "\n").replace(/<\/?[a-z][^>]*>/gi, "")}</Fragment>;
      default:
        return <Fragment key={k}>{"raw" in t ? decode(String(t.raw)) : ""}</Fragment>;
    }
  });
}

function block(tokens: Token[], key = "b", headingShift = 0, ev?: EvidenceContext): ReactNode {
  return tokens.map((t, i) => {
    const k = `${key}.${i}`;
    switch (t.type) {
      case "heading": {
        const level = Math.min(4, (t as Tokens.Heading).depth + headingShift);
        const H = `h${level}` as "h2";
        return <H key={k}>{inline((t as Tokens.Heading).tokens, k, ev)}</H>;
      }
      case "paragraph":
        return <p key={k}>{inline((t as Tokens.Paragraph).tokens, k, ev)}</p>;
      case "list": {
        const l = t as Tokens.List;
        const items = l.items.map((it, j) => (
          <li key={`${k}.${j}`}>
            {it.task ? <input type="checkbox" checked={Boolean(it.checked)} readOnly disabled aria-label={it.checked ? "done" : "not done"} /> : null}{" "}
            {l.loose ? block(it.tokens, `${k}.${j}`, headingShift, ev) : inlineOrBlock(it.tokens, `${k}.${j}`, ev)}
          </li>
        ));
        return l.ordered ? (
          <ol key={k} start={typeof l.start === "number" && l.start !== 1 ? l.start : undefined}>
            {items}
          </ol>
        ) : (
          <ul key={k}>{items}</ul>
        );
      }
      case "blockquote":
        return <blockquote key={k}>{block((t as Tokens.Blockquote).tokens, k, headingShift, ev)}</blockquote>;
      case "code":
        return (
          <pre key={k}>
            <code>{(t as Tokens.Code).text}</code>
          </pre>
        );
      case "hr":
        return <hr key={k} />;
      case "table": {
        const tb = t as Tokens.Table;
        return (
          <div key={k} className="table-wrap" role="region" aria-label="Table" tabIndex={0}>
            <table>
              <thead>
                <tr>
                  {tb.header.map((c, j) => (
                    <th key={j} style={{ textAlign: tb.align[j] ?? undefined }}>
                      {inline(c.tokens, `${k}.h${j}`, ev)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tb.rows.map((r, ri) => (
                  <tr key={ri}>
                    {r.map((c, j) => (
                      <td key={j} style={{ textAlign: tb.align[j] ?? undefined }}>
                        {inline(c.tokens, `${k}.${ri}.${j}`, ev)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      }
      case "html":
        return <p key={k}>{t.raw.replace(/<(script|style|iframe|object|svg|template)[\s\S]*?<\/\1>/gi, "").replace(/<\/?[a-z][^>]*>/gi, "")}</p>;
      case "space":
        return null;
      case "text":
        return <p key={k}>{inline((t as Tokens.Text).tokens ?? [t], k, ev)}</p>;
      default:
        return null;
    }
  });
}

function inlineOrBlock(tokens: Token[], key: string, ev?: EvidenceContext): ReactNode {
  if (tokens.length === 1 && tokens[0]!.type === "text") return inline((tokens[0] as Tokens.Text).tokens ?? [tokens[0]!], key, ev);
  return block(tokens, key, 0, ev);
}

export function Markdown({ source, className = "prose", headingShift = 1, evidence }: { source: string; className?: string; headingShift?: number; evidence?: EvidenceContext }) {
  const tokens = new Lexer({ gfm: true }).lex(source ?? "");
  // Chip labels are worked out across the whole text, so two sources never read alike on one page.
  const ev = evidence && !evidence.labels ? { ...evidence, labels: citationLabels(citedSourceIds(source ?? ""), evidence.titles) } : evidence;
  return <div className={className}>{block(tokens, "md", headingShift, ev)}</div>;
}

/**
 * The words of a Markdown text without its markers, on one line, for a summary that is clamped to a
 * line or two (a product card's concept): the same lexer as `Markdown`, so what reads as emphasis
 * or a heading there reads as plain words here, never as asterisks and hashes.
 */
export function markdownText(source: string): string {
  const words = (tokens: Token[] | undefined): string =>
    (tokens ?? [])
      .map((t) => {
        switch (t.type) {
          case "space":
          case "hr":
          case "br":
            return " ";
          case "html":
            return " " + t.raw.replace(/<(script|style|iframe|object|svg|template)[\s\S]*?<\/\1>/gi, "").replace(/<\/?[a-z][^>]*>/gi, "") + " ";
          case "list":
            return (t as Tokens.List).items.map((it) => ` ${words(it.tokens)} `).join("");
          case "table": {
            const tb = t as Tokens.Table;
            return [tb.header, ...tb.rows].map((r) => r.map((c) => ` ${words(c.tokens)} `).join("")).join("");
          }
          case "code":
          case "codespan":
          case "escape":
          case "image":
            return decode((t as { text: string }).text);
          default: {
            const inner = (t as { tokens?: Token[] }).tokens;
            if (inner) return t.type === "heading" || t.type === "paragraph" || t.type === "blockquote" ? ` ${words(inner)} ` : words(inner);
            return "text" in t ? decode(String(t.text)) : "";
          }
        }
      })
      .join("");
  return words(new Lexer({ gfm: true }).lex(source ?? "")).replace(/\s+/g, " ").trim();
}
