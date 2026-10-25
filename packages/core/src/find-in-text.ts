import { Lexer, type Token, type Tokens } from "marked";

/**
 * Finding words in a source's derived text, as its Find in the text does in the web app
 * (apps/web/src/routes/source-text.tsx), and counting what it marks, so the number of matches plain
 * search gives a source agrees with the count that find shows for the same words. Pure: the web app
 * imports it as `@whatbuild/core/find-in-text`.
 */

const SUFFIXES = ["ations", "ation", "ments", "ment", "ings", "ing", "ers", "er", "ies", "ied", "ed", "es", "ly", "s"];

/** A word's root, so a find also marks its other endings, as search reads words ("pricing" marks "priced"). */
function root(word: string): string {
  const w = word.toLowerCase();
  for (const s of SUFFIXES) if (w.endsWith(s) && w.length - s.length >= 4) return w.slice(0, -s.length).replace(/e$/, "");
  return w.length > 4 ? w.replace(/e$/, "") : w;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** What a find marks: each word at the start of a word, with any ending, and each "quoted phrase" as written. */
export function findPattern(find: string): RegExp | undefined {
  const parts = [...find.matchAll(/"([^"]+)"|(\S+)/g)]
    .map((m) => (m[1] !== undefined ? escape(m[1].trim()).replace(/\s+/g, "\\s+") : `${escape(root(m[2]!))}[\\p{L}\\p{N}]*`))
    .filter((p) => p && p !== "[\\p{L}\\p{N}]*");
  if (!parts.length) return undefined;
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${parts.join("|")})`, "giu");
}

/** The words a plain search read, as a find takes them: each word, and each phrase in quotes. */
export function findWords(terms: readonly { text: string; phrase: boolean }[]): string {
  return terms.map((t) => (t.phrase ? `"${t.text}"` : t.text)).join(" ");
}

/** The entities the web app's Markdown turns back into characters, `&amp;` last as it does. */
function decode(s: string): string {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
}

/**
 * The runs of text the web app's Markdown shows for `markdown` (apps/web/src/lib/markdown.tsx),
 * each of which a find marks on its own: what a reader sees, without link addresses, images,
 * HTML tags or a code fence's language. Kept in step with that renderer, as a test checks.
 */
export function shownRuns(markdown: string): string[] {
  const runs: string[] = [];
  const inline = (tokens: Token[] | undefined): void => {
    for (const t of tokens ?? []) {
      switch (t.type) {
        case "text":
          if ((t as Tokens.Text).tokens) inline((t as Tokens.Text).tokens);
          else runs.push(decode(t.text));
          break;
        case "escape":
        case "codespan":
          runs.push(decode((t as Tokens.Escape | Tokens.Codespan).text));
          break;
        case "strong":
        case "em":
        case "del":
        case "link":
          inline((t as Tokens.Strong | Tokens.Em | Tokens.Del | Tokens.Link).tokens);
          break;
        case "br":
        case "image":
          break;
        case "html":
          runs.push(t.raw.replace(/<br\s*\/?>/gi, "\n").replace(/<\/?[a-z][^>]*>/gi, ""));
          break;
        default:
          if ("raw" in t) runs.push(decode(String(t.raw)));
      }
    }
  };
  const block = (tokens: Token[]): void => {
    for (const t of tokens) {
      switch (t.type) {
        case "heading":
        case "paragraph":
          inline((t as Tokens.Heading | Tokens.Paragraph).tokens);
          break;
        case "list":
          for (const it of (t as Tokens.List).items) {
            const own = it.tokens.filter((c) => c.type !== "checkbox");
            if ((t as Tokens.List).loose) block(own);
            else if (own.length === 1 && own[0]!.type === "text") inline((own[0] as Tokens.Text).tokens ?? [own[0]!]);
            else block(own);
          }
          break;
        case "blockquote":
          block((t as Tokens.Blockquote).tokens);
          break;
        case "code":
          runs.push((t as Tokens.Code).text);
          break;
        case "table":
          for (const c of (t as Tokens.Table).header) inline(c.tokens);
          for (const r of (t as Tokens.Table).rows) for (const c of r) inline(c.tokens);
          break;
        case "html":
          runs.push(t.raw.replace(/<(script|style|iframe|object|svg|template)[\s\S]*?<\/\1>/gi, "").replace(/<\/?[a-z][^>]*>/gi, ""));
          break;
        case "text":
          inline((t as Tokens.Text).tokens ?? [t]);
          break;
      }
    }
  };
  block(new Lexer({ gfm: true }).lex(markdown ?? ""));
  return runs;
}

/** Markdown that may show other words than it holds, or split them apart: links, images, HTML, entities, code. */
const MARKUP = /[[<&`~]/;

/** How many matches of `pattern` in a run of text a find marks: the empty ones it skips are not counted. */
function inRun(run: string, pattern: RegExp): number {
  let n = 0;
  for (const m of run.matchAll(pattern)) if (m[0]) n++;
  return n;
}

/**
 * How many places a find with `pattern` marks in `markdown` as the web app shows it. A text without
 * markup that changes its words, sought without a phrase (which could span the blocks the text is
 * shown in), is counted as written, which comes to the same; any other is counted in the runs the
 * app shows.
 */
export function findCount(markdown: string, pattern: RegExp): number {
  if (!MARKUP.test(markdown) && !pattern.source.includes("\\s+")) return inRun(markdown, pattern);
  return shownRuns(markdown).reduce((n, run) => n + inRun(run, pattern), 0);
}
