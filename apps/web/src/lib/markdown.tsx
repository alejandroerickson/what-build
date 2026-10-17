import { Lexer, type Token, type Tokens } from "marked";
import { Fragment, type ReactNode } from "react";
import { Link, useInRouterContext } from "react-router";

/**
 * Safe Markdown: a GitHub-flavoured lexer mapped to React elements. No HTML string from the
 * source ever reaches the DOM; raw HTML is shown as text, images become links and never load, and
 * only web, mail, fragment and same-origin links are live.
 *
 * Evidence reads as the source's title: a link to a source gets the quiet evidence style, and,
 * when the caller knows the source titles, a source mentioned by its id — "source 01K…", as a
 * digest or an agent's notes may write it — becomes that same linked token. With `mark`, the words
 * it matches are highlighted wherever they appear in the text.
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


/**
 * Each source a text mentions by its id ("source 01K…"), in order. A mention written while sources
 * had passages ("source 01K…, segments 4–6") is the source's too: the numbers point at nothing now.
 */
export function sourceMentions(text: string): { id: string }[] {
  if (!text.includes("source ")) return [];
  return [...text.matchAll(SOURCE_MENTION)].map((m) => ({ id: m[1]! }));
}

/** The sources a text mentions by id, in order of first mention. */
export function mentionedSourceIds(text: string): string[] {
  return [...new Set(sourceMentions(text).map((c) => c.id))];
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

/** An in-app link to a source. */
export function sourceHref(app: string, recordId: string): string {
  return `${app}/evidence/${recordId}`;
}

/** What a renderer threads through the text: who mentions resolve to, and which words to mark. */
interface Cx {
  ev?: EvidenceContext | undefined;
  mark?: RegExp | undefined;
}

/** The words `mark` matches in a run of text, highlighted. */
function marked(text: string, key: string, mark: RegExp | undefined): ReactNode {
  if (!mark || !text) return text;
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(mark)) {
    if (!m[0]) continue;
    out.push(text.slice(last, m.index));
    out.push(
      <mark key={`${key}.m${m.index}`} className="text-find">
        {m[0]}
      </mark>,
    );
    last = m.index! + m[0].length;
  }
  if (!out.length) return text;
  out.push(text.slice(last));
  return out;
}

/** The highlighting of `marked` over the strings among nodes, leaving elements as they are. */
function markedNodes(nodes: ReactNode, key: string, mark: RegExp | undefined): ReactNode {
  if (!mark) return nodes;
  if (typeof nodes === "string") return marked(nodes, key, mark);
  if (Array.isArray(nodes)) return nodes.map((n, i) => (typeof n === "string" ? <Fragment key={`${key}.s${i}`}>{marked(n, `${key}.s${i}`, mark)}</Fragment> : n));
  return nodes;
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
 * Turn "source <id>" mentions in a run of text into evidence links; or, where the text already sits
 * inside a link or a button (a search hit), into the same token without a link of its own.
 */
export function evidenceLinks(text: string, key: string, ev: EvidenceContext | undefined, asLink = true): ReactNode {
  if (!ev || !text.includes("source ")) return text;
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(SOURCE_MENTION)) {
    const [whole, id] = m;
    const known = ev.titles[id!];
    const label = ev.labels?.[id!] ?? mentionLabels([id!], ev.titles)[id!]!;
    out.push(text.slice(last, m.index));
    out.push(
      asLink ? (
        <AppLink key={`${key}.c${m.index}`} href={sourceHref(ev.app, id!)} className="evidence-link" title={known ?? undefined}>
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

function inline(tokens: Token[] | undefined, key = "i", cx: Cx = {}): ReactNode {
  if (!tokens) return null;
  return tokens.map((t, i) => {
    const k = `${key}.${i}`;
    switch (t.type) {
      case "text":
        return (t as Tokens.Text).tokens ? (
          <Fragment key={k}>{inline((t as Tokens.Text).tokens, k, cx)}</Fragment>
        ) : (
          <Fragment key={k}>{markedNodes(evidenceLinks(decode(t.text), k, cx.ev), k, cx.mark)}</Fragment>
        );
      case "escape":
        return <Fragment key={k}>{marked(decode(t.text), k, cx.mark)}</Fragment>;
      case "strong":
        return <strong key={k}>{inline((t as Tokens.Strong).tokens, k, cx)}</strong>;
      case "em":
        return <em key={k}>{inline((t as Tokens.Em).tokens, k, cx)}</em>;
      case "del":
        return <del key={k}>{inline((t as Tokens.Del).tokens, k, cx)}</del>;
      case "codespan":
        return <code key={k}>{marked(decode((t as Tokens.Codespan).text), k, cx.mark)}</code>;
      case "br":
        return <br key={k} />;
      case "link": {
        const safe = safeHref((t as Tokens.Link).href);
        const children = inline((t as Tokens.Link).tokens, k, { mark: cx.mark });
        if (!safe) return <Fragment key={k}>{children}</Fragment>;
        const href = inApp(safe);
        const lt = (t as Tokens.Link).tokens ?? [];
        // A link to a source is evidence: the quiet accent token.
        if (href.startsWith("/") && EVIDENCE_PATH.test(href)) {
          const plain = lt.every((c) => c.type === "text" && !(c as Tokens.Text).tokens);
          return (
            <AppLink key={k} href={href} className="evidence-link">
              {plain ? marked(decode(lt.map((c) => c.raw).join("")), k, cx.mark) : children}
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
        return <Fragment key={k}>{marked(t.raw.replace(/<br\s*\/?>/gi, "\n").replace(/<\/?[a-z][^>]*>/gi, ""), k, cx.mark)}</Fragment>;
      default:
        return <Fragment key={k}>{"raw" in t ? marked(decode(String(t.raw)), k, cx.mark) : ""}</Fragment>;
    }
  });
}

function block(tokens: Token[], key = "b", headingShift = 0, cx: Cx = {}): ReactNode {
  return tokens.map((t, i) => {
    const k = `${key}.${i}`;
    switch (t.type) {
      case "heading": {
        const level = Math.min(4, (t as Tokens.Heading).depth + headingShift);
        const H = `h${level}` as "h2";
        return <H key={k}>{inline((t as Tokens.Heading).tokens, k, cx)}</H>;
      }
      case "paragraph":
        return <p key={k}>{inline((t as Tokens.Paragraph).tokens, k, cx)}</p>;
      case "list": {
        const l = t as Tokens.List;
        const items = l.items.map((it, j) => (
          <li key={`${k}.${j}`}>
            {it.task ? <input type="checkbox" checked={Boolean(it.checked)} readOnly disabled aria-label={it.checked ? "done" : "not done"} /> : null}{" "}
            {l.loose ? block(it.tokens, `${k}.${j}`, headingShift, cx) : inlineOrBlock(it.tokens, `${k}.${j}`, cx)}
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
        return <blockquote key={k}>{block((t as Tokens.Blockquote).tokens, k, headingShift, cx)}</blockquote>;
      case "code":
        return (
          <pre key={k}>
            <code>{marked((t as Tokens.Code).text, k, cx.mark)}</code>
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
                      {inline(c.tokens, `${k}.h${j}`, cx)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tb.rows.map((r, ri) => (
                  <tr key={ri}>
                    {r.map((c, j) => (
                      <td key={j} style={{ textAlign: tb.align[j] ?? undefined }}>
                        {inline(c.tokens, `${k}.${ri}.${j}`, cx)}
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
        return <p key={k}>{marked(t.raw.replace(/<(script|style|iframe|object|svg|template)[\s\S]*?<\/\1>/gi, "").replace(/<\/?[a-z][^>]*>/gi, ""), k, cx.mark)}</p>;
      case "space":
        return null;
      case "text":
        return <p key={k}>{inline((t as Tokens.Text).tokens ?? [t], k, cx)}</p>;
      default:
        return null;
    }
  });
}

function inlineOrBlock(tokens: Token[], key: string, cx: Cx): ReactNode {
  if (tokens.length === 1 && tokens[0]!.type === "text") return inline((tokens[0] as Tokens.Text).tokens ?? [tokens[0]!], key, cx);
  return block(tokens, key, 0, cx);
}

export function Markdown({
  source,
  className = "prose",
  headingShift = 1,
  evidence,
  mark,
}: {
  source: string;
  className?: string;
  headingShift?: number;
  evidence?: EvidenceContext;
  /** Highlight what this global pattern matches, as a find does. */
  mark?: RegExp;
}) {
  const tokens = new Lexer({ gfm: true }).lex(source ?? "");
  // Chip labels are worked out across the whole text, so two sources never read alike on one page.
  const ev = evidence && !evidence.labels ? { ...evidence, labels: mentionLabels(mentionedSourceIds(source ?? ""), evidence.titles) } : evidence;
  return <div className={className}>{block(tokens, "md", headingShift, { ev, mark })}</div>;
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
