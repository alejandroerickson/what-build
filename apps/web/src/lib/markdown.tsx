import { Lexer, type Token, type Tokens } from "marked";
import { Fragment, type ReactNode } from "react";
import { Link, useInRouterContext } from "react-router";

/**
 * Safe Markdown: a GitHub-flavoured lexer mapped to React elements. No HTML string from the
 * source ever reaches the DOM; raw HTML is shown as text, images become links and never load, and
 * only web, mail, fragment and same-origin links are live.
 *
 * Evidence reads as "Source title ¶5": a link to a source or one of its passages gets the quiet
 * evidence style, and, when the caller knows the source titles, a source mentioned by its id —
 * "source 01K…, segments 4–6", as a digest or an agent's notes may write it — becomes that same
 * linked token.
 */

/**
 * What a caller knows for resolving source mentions: the product's app path, titles by id, and
 * optionally chip labels already worked out across a larger page (see `mentionLabels`).
 */
export interface EvidenceContext {
  app: string;
  titles: Record<string, string | undefined>;
  labels?: Record<string, string>;
}

const ULID = "[0-9A-HJKMNP-TV-Z]{26}";
const SOURCE_MENTION = new RegExp(`\\bsource (${ULID})(?:(?:,\\s*(?:segments?\\s+|¶\\s?)|\\s+¶\\s?)(\\d+)(?:\\s*[–-]\\s*(\\d+))?)?`, "g");
const EVIDENCE_PATH = new RegExp(`/evidence/${ULID}(?:[?#]|$)`);

const SAFE_HREF = /^(https?:\/\/|mailto:|#|\/(?![/\\]))/i;

function safeHref(href: string | undefined): string | null {
  if (!href) return null;
  const cleaned = href.replace(/[\t\n\r]/g, "").trim();
  return SAFE_HREF.test(cleaned) ? cleaned : null;
}

const PRODUCT_PATH = /^\/t\/[^/?#]+\/[^/?#]+\/[^/?#]+/;
const ABSOLUTE = /^https?:\/\/[^/?#]+(\/[^?#]*)?([?#].*)?$/i;

/**
 * Absolute links that open in place, as in-app paths: any on this origin, and any into the product
 * being read on another origin. An agent writes the address it was given, so a copy of a deployment
 * (the dev deployment, a local copy of production) holds links to the original's records; those
 * records are here under the same path, and the link must not send the reader to the original.
 */
export function inAppHref(href: string, here: { origin: string; pathname: string }): string {
  if (href.startsWith(here.origin + "/")) return href.slice(here.origin.length);
  const product = PRODUCT_PATH.exec(here.pathname)?.[0];
  const m = product ? ABSOLUTE.exec(href) : null;
  const path = m?.[1] ?? "";
  if (!m || (path !== product && !path.startsWith(product + "/"))) return href;
  return path + (m[2] ?? "");
}

function inApp(href: string): string {
  return typeof window === "undefined" ? href : inAppHref(href, window.location);
}


/** "Title ¶5" with the ¶ kept on the title's line. */
function evidenceText(title: string, start?: string, end?: string): string {
  if (!start) return title;
  return `${title}\u00a0¶${start}${end && end !== start ? `–${end}` : ""}`;
}

/** Each source a text mentions by its id ("source 01K…, segments 4–6"), in order. */
export function sourceMentions(text: string): { id: string; start?: string; end?: string }[] {
  if (!text.includes("source ")) return [];
  return [...text.matchAll(SOURCE_MENTION)].map((m) => ({ id: m[1]!, start: m[2], end: m[3] }));
}

/** The sources a text mentions by id, in order of first mention. */
export function mentionedSourceIds(text: string): string[] {
  return [...new Set(sourceMentions(text).map((c) => c.id))];
}

/** A mention's chip text: "Label ¶4–6". */
export function mentionText(label: string, start?: string, end?: string): string {
  return evidenceText(label, start, end);
}

/**
 * Chip labels that tell sources apart on one page. A label starts as the title's part before an
 * em-dash qualifier ("Usability study"). Where mentioned sources would share a label, each adds its
 * next qualifier in brackets ("Usability study (crew)") until they differ; sources whose whole
 * titles match are numbered in order of mention.
 */
export function mentionLabels(ids: string[], titles: Record<string, string | undefined>): Record<string, string> {
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
 * Turn "source <id>, segment N" mentions in a run of text into evidence links; or, where the text
 * already sits inside a link or a button (a search hit, a passage), into the same token without a
 * link of its own.
 */
export function evidenceLinks(text: string, key: string, ev: EvidenceContext | undefined, asLink = true): ReactNode {
  if (!ev || !text.includes("source ")) return text;
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(SOURCE_MENTION)) {
    const [whole, id, start, end] = m;
    const known = ev.titles[id!];
    const label = evidenceText(ev.labels?.[id!] ?? mentionLabels([id!], ev.titles)[id!]!, start, end);
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
        return (t as Tokens.Text).tokens ? <Fragment key={k}>{inline((t as Tokens.Text).tokens, k, ev)}</Fragment> : <Fragment key={k}>{evidenceLinks(decode(t.text), k, ev)}</Fragment>;
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
  const ev = evidence && !evidence.labels ? { ...evidence, labels: mentionLabels(mentionedSourceIds(source ?? ""), evidence.titles) } : evidence;
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
