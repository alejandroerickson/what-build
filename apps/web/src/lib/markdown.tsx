import { Lexer, type Token, type Tokens } from "marked";
import { Fragment, type ReactNode } from "react";

/**
 * Safe Markdown: a GitHub-flavoured lexer mapped to React elements. No HTML string from the
 * source ever reaches the DOM; raw HTML is shown as text, images become links and never load, and
 * only web, mail, fragment and same-origin links are live.
 */

const SAFE_HREF = /^(https?:\/\/|mailto:|#|\/(?![/\\]))/i;

function safeHref(href: string | undefined): string | null {
  if (!href) return null;
  const cleaned = href.replace(/[\t\n\r]/g, "").trim();
  return SAFE_HREF.test(cleaned) ? cleaned : null;
}

function decode(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function inline(tokens: Token[] | undefined, key = "i"): ReactNode {
  if (!tokens) return null;
  return tokens.map((t, i) => {
    const k = `${key}.${i}`;
    switch (t.type) {
      case "text":
        return (t as Tokens.Text).tokens ? <Fragment key={k}>{inline((t as Tokens.Text).tokens, k)}</Fragment> : <Fragment key={k}>{decode(t.text)}</Fragment>;
      case "escape":
        return <Fragment key={k}>{decode(t.text)}</Fragment>;
      case "strong":
        return <strong key={k}>{inline((t as Tokens.Strong).tokens, k)}</strong>;
      case "em":
        return <em key={k}>{inline((t as Tokens.Em).tokens, k)}</em>;
      case "del":
        return <del key={k}>{inline((t as Tokens.Del).tokens, k)}</del>;
      case "codespan":
        return <code key={k}>{decode((t as Tokens.Codespan).text)}</code>;
      case "br":
        return <br key={k} />;
      case "link": {
        const href = safeHref((t as Tokens.Link).href);
        const children = inline((t as Tokens.Link).tokens, k);
        return href ? (
          <a key={k} href={href} target={href.startsWith("/") || href.startsWith("#") ? undefined : "_blank"} rel="noopener noreferrer">
            {children}
          </a>
        ) : (
          <Fragment key={k}>{children}</Fragment>
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

function block(tokens: Token[], key = "b", headingShift = 0): ReactNode {
  return tokens.map((t, i) => {
    const k = `${key}.${i}`;
    switch (t.type) {
      case "heading": {
        const level = Math.min(4, (t as Tokens.Heading).depth + headingShift);
        const H = `h${level}` as "h2";
        return <H key={k}>{inline((t as Tokens.Heading).tokens, k)}</H>;
      }
      case "paragraph":
        return <p key={k}>{inline((t as Tokens.Paragraph).tokens, k)}</p>;
      case "list": {
        const l = t as Tokens.List;
        const items = l.items.map((it, j) => (
          <li key={`${k}.${j}`}>
            {it.task ? <input type="checkbox" checked={Boolean(it.checked)} readOnly disabled aria-label={it.checked ? "done" : "not done"} /> : null}{" "}
            {l.loose ? block(it.tokens, `${k}.${j}`, headingShift) : inlineOrBlock(it.tokens, `${k}.${j}`)}
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
        return <blockquote key={k}>{block((t as Tokens.Blockquote).tokens, k, headingShift)}</blockquote>;
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
                      {inline(c.tokens, `${k}.h${j}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tb.rows.map((r, ri) => (
                  <tr key={ri}>
                    {r.map((c, j) => (
                      <td key={j} style={{ textAlign: tb.align[j] ?? undefined }}>
                        {inline(c.tokens, `${k}.${ri}.${j}`)}
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
        return <p key={k}>{inline((t as Tokens.Text).tokens ?? [t], k)}</p>;
      default:
        return null;
    }
  });
}

function inlineOrBlock(tokens: Token[], key: string): ReactNode {
  if (tokens.length === 1 && tokens[0]!.type === "text") return inline((tokens[0] as Tokens.Text).tokens ?? [tokens[0]!], key);
  return block(tokens, key);
}

export function Markdown({ source, className = "prose", headingShift = 1 }: { source: string; className?: string; headingShift?: number }) {
  const tokens = new Lexer({ gfm: true }).lex(source ?? "");
  return <div className={className}>{block(tokens, "md", headingShift)}</div>;
}
