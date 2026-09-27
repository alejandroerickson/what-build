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

/** What a caller knows for resolving bare citations: the product's app path and titles by id. */
export interface EvidenceContext {
  app: string;
  titles: Record<string, string | undefined>;
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

/** A title short enough to sit in a sentence: the part before an em-dash qualifier. */
function shortTitle(title: string): string {
  return title.split(" — ")[0]!.trim() || title;
}

/** "Title ¶5" with the ¶ kept on the title's line. */
function evidenceText(title: string, start?: string, end?: string): string {
  if (!start) return title;
  return `${title}\u00a0¶${start}${end && end !== start ? `–${end}` : ""}`;
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

/** Turn bare "source <id>, segment N" citations in a run of text into evidence links. */
function citations(text: string, key: string, ev: EvidenceContext | undefined): ReactNode {
  if (!ev || !text.includes("source ")) return text;
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(BARE_CITATION)) {
    const [whole, id, start, end] = m;
    const known = ev.titles[id!];
    out.push(text.slice(last, m.index));
    out.push(
      <AppLink key={`${key}.c${m.index}`} href={`${ev.app}/evidence/${id}${start ? `?seq=${start}` : ""}`} className="evidence-link" title={known ?? undefined}>
        {evidenceText(known ? shortTitle(known) : "Source", start, end)}
      </AppLink>,
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
  return <div className={className}>{block(tokens, "md", headingShift, evidence)}</div>;
}
