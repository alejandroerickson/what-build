import { Lexer, type Token, type Tokens } from "marked";
import { Fragment, type ReactNode } from "react";
import { Link, useInRouterContext } from "react-router";

/**
 * Safe Markdown: a GitHub-flavoured lexer mapped to React elements. No HTML string from the
 * source ever reaches the DOM; raw HTML is shown as text, images become links and never load, and
 * only web, mail, fragment and same-origin links are live.
 *
 * A link to a source gets the quiet evidence style. A source mentioned by its id alone ("source
 * 01K…") stays as written: nothing turns it into a link. With `mark`, the words it matches are
 * highlighted wherever they appear in the text.
 */

const ULID = "[0-9A-HJKMNP-TV-Z]{26}";
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

/** What a renderer threads through the text: which words to mark. */
interface Cx {
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
          <Fragment key={k}>{marked(decode(t.text), k, cx.mark)}</Fragment>
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
        const children = inline((t as Tokens.Link).tokens, k, cx);
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
        const items = l.items.map((it, j) => {
          // The box is drawn from `task`; marked also lists it as the item's first token.
          const tokens = it.tokens.filter((c) => c.type !== "checkbox");
          return (
            <li key={`${k}.${j}`}>
              {it.task ? <input type="checkbox" checked={Boolean(it.checked)} readOnly disabled aria-label={it.checked ? "done" : "not done"} /> : null}{" "}
              {l.loose ? block(tokens, `${k}.${j}`, headingShift, cx) : inlineOrBlock(tokens, `${k}.${j}`, cx)}
            </li>
          );
        });
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
  mark,
}: {
  source: string;
  className?: string;
  headingShift?: number;
  /** Highlight what this global pattern matches, as a find does. */
  mark?: RegExp;
}) {
  const tokens = new Lexer({ gfm: true }).lex(source ?? "");
  return <div className={className}>{block(tokens, "md", headingShift, { mark })}</div>;
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
