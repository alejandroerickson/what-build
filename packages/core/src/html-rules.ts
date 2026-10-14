import { HtmlLimitError, parseHtml } from "@whatbuild/parsers";
import { MOCKUP_PAGE_SANDBOX, STORY_PAGE_SANDBOX } from "./page-sandbox.ts";

/**
 * The rules agent-written HTML is held to, one set for each surface that shows it: a Story page and
 * a mockup page. At publish they are a courtesy to authors: every refusal names the surface, the
 * rule, the limit where there is one and the element where there is one, and every problem is
 * listed at once, so a page can be fixed in one pass. They are not the security boundary. That is
 * the sandboxed frame and the CSP on the response that serves a page (pageResponseHeaders in
 * story-html.ts, from each surface's sandbox), which hold whatever a stored page holds: no network,
 * an opaque origin, and no form submission that goes anywhere (form-action 'none').
 *
 * What every surface refuses keeps a page self-contained: nothing loaded from elsewhere, no frames,
 * no <base>, no <meta http-equiv>. What differs is in PageRules.
 */
export interface PageRules {
  /** The surface, as a refusal names it: "Story page", "mockup page". */
  surface: string;
  /** The most characters a page holds. */
  maxChars: number;
  /** The most inline scripts a page holds, or null for any number. */
  maxScripts: number | null;
  /** What inline scripts, event handlers and javascript: URLs may total in characters, or null for no budget. */
  scriptBudget: number | null;
  /** Said after a refusal over the budget: why the surface keeps one. */
  scriptBudgetReason?: string;
  /** Elements a page may not hold, each with the reason its refusal gives. */
  refusedElements: Readonly<Record<string, string>>;
  /** What the sandbox the page is served and framed in allows (page-sandbox.ts). */
  sandbox: string;
}

const FRAMES = "a page frames and embeds no other document";
/** What every surface refuses by element. */
const SELF_CONTAINED: Record<string, string> = {
  iframe: FRAMES,
  frame: FRAMES,
  frameset: FRAMES,
  embed: FRAMES,
  object: FRAMES,
  portal: FRAMES,
  base: "it would change where the page's links and resources point",
  link: "it loads a resource from elsewhere; put CSS in a <style> block, and fonts and images in data: URIs",
};

export const STORY_HTML_MAX = 1_000_000;
export const STORY_SCRIPT_BUDGET = 32_000;
export const STORY_MAX_SCRIPTS = 10;

/** A Story page is for reading: bounded scripts, and no forms. */
export const STORY_PAGE_RULES: PageRules = {
  surface: "Story page",
  maxChars: STORY_HTML_MAX,
  maxScripts: STORY_MAX_SCRIPTS,
  scriptBudget: STORY_SCRIPT_BUDGET,
  scriptBudgetReason: "since the Story is for reading; an interactive prototype belongs on a mockup's canvas, which has no script budget",
  refusedElements: { ...SELF_CONTAINED, form: "a Story page is for reading, so it holds no forms" },
  sandbox: STORY_PAGE_SANDBOX,
};

/**
 * A mockup page may be a working prototype: scripts of any number and length, and forms, whose
 * submit handlers run (its sandbox allows forms) and whose submissions go nowhere (every response
 * that serves it says form-action 'none'). The maintainer chose these rules on 2026-10-14.
 */
export const MOCKUP_PAGE_RULES: PageRules = {
  surface: "mockup page",
  maxChars: STORY_HTML_MAX,
  maxScripts: null,
  scriptBudget: null,
  refusedElements: SELF_CONTAINED,
  sandbox: MOCKUP_PAGE_SANDBOX,
};

/**
 * A CSS url() that is neither a data: URI nor a fragment. The quote is optional, and the lookahead
 * sits before it, so a quoted data: URI (the usual way to embed a font or an SVG) is accepted.
 */
export const EXTERNAL_URL = /url\(\s*(?!['"]?\s*(?:data:|#))/i;
/** The same for a style attribute, where only a data: URI is accepted. */
const EXTERNAL_URL_INLINE = /url\(\s*(?!['"]?\s*data:)/i;
const MEDIA_ATTRS = new Set(["src", "srcset", "poster", "data", "background", "xlink:href"]);

type Node = {
  nodeName: string;
  tagName?: string;
  attrs?: { name: string; value: string }[];
  childNodes?: Node[];
  content?: Node;
  value?: string;
};

/** At most 60 characters of what a page holds, to name it in a refusal. */
const clip = (s: string) => (s.length > 60 ? `${s.slice(0, 59)}…` : s);
/** The first match of a pattern in CSS, from where it starts, to name it in a refusal. */
const found = (css: string, re: RegExp) => {
  const at = css.search(re);
  const rest = css.slice(at);
  const end = rest.search(/[);\n]/);
  return clip(end >= 0 ? rest.slice(0, end + 1) : rest);
};

/** Check a page against a surface's rules: every problem, or none. */
export function inspectPageHtml(html: string, rules: PageRules): string[] {
  const { surface } = rules;
  const problems: string[] = [];
  if (html.length > rules.maxChars) problems.push(`The ${surface} is ${html.length} characters; a ${surface} holds at most ${rules.maxChars}.`);
  let doc: Node;
  try {
    // Bounded: a page nested too deep, or one that makes far more elements than it has tags, is refused.
    doc = parseHtml(html) as unknown as Node;
  } catch (e) {
    return [...problems, e instanceof HtmlLimitError ? `${e.message.replace(/^the HTML/, `The ${surface}'s HTML`)}.` : `The ${surface}'s HTML could not be parsed.`];
  }
  let scripts = 0;
  let budget = 0;
  const seen = new Set<string>();
  const add = (p: string) => {
    if (!seen.has(p)) {
      seen.add(p);
      problems.push(p);
    }
  };
  const walk = (node: Node) => {
    const tag = node.tagName?.toLowerCase();
    if (tag) {
      const refused = rules.refusedElements[tag];
      if (refused) add(`<${tag}> is not allowed in a ${surface}: ${refused}.`);
      const equiv = node.attrs?.find((a) => a.name.toLowerCase() === "http-equiv");
      if (tag === "meta" && equiv) add(`<meta http-equiv="${clip(equiv.value)}"> is not allowed in a ${surface}: no refresh, redirect or policy metadata.`);
      if (tag === "script") {
        scripts++;
        const src = node.attrs?.find((a) => a.name.toLowerCase() === "src");
        if (src) add(`<script src> is not allowed in a ${surface}: scripts must be inline (this one loads ${clip(src.value.trim())}).`);
        budget += (node.childNodes ?? []).map((c) => c.value ?? "").join("").length;
      }
      for (const a of node.attrs ?? []) {
        const name = a.name.toLowerCase();
        const value = a.value.trim();
        if (name.startsWith("on")) budget += value.length;
        if (/^javascript:/i.test(value)) budget += value.length;
        if (MEDIA_ATTRS.has(name) && tag !== "script" && value && !/^data:/i.test(value) && !(name === "srcset" && value.split(",").every((p) => /^\s*data:/i.test(p))))
          add(`<${tag} ${name}="${clip(value)}"> loads an external resource, which a ${surface} may not: embed images, fonts and media as data: URIs.`);
        if (name === "style" && EXTERNAL_URL_INLINE.test(value)) add(`A style attribute on <${tag}> loads an external resource with ${found(value, EXTERNAL_URL_INLINE)}, which a ${surface} may not: use data: URIs.`);
      }
      if (tag === "style") {
        const css = (node.childNodes ?? []).map((c) => c.value ?? "").join("");
        if (/@import/i.test(css)) add(`@import is not allowed in a ${surface}'s <style> block (${found(css, /@import/i)}): keep the page self-contained.`);
        if (EXTERNAL_URL.test(css)) add(`A <style> block loads an external resource with ${found(css, EXTERNAL_URL)}, which a ${surface} may not: use data: URIs.`);
      }
    }
    for (const c of node.childNodes ?? []) walk(c);
    if (node.content) walk(node.content);
  };
  walk(doc);
  if (rules.maxScripts !== null && scripts > rules.maxScripts) problems.push(`The ${surface} has ${scripts} inline scripts; a ${surface} holds at most ${rules.maxScripts}.`);
  if (rules.scriptBudget !== null && budget > rules.scriptBudget)
    problems.push(`Inline scripts and event handlers total ${budget} characters; a ${surface} allows at most ${rules.scriptBudget}${rules.scriptBudgetReason ? `, ${rules.scriptBudgetReason}` : ""}.`);
  return problems;
}

/** Validate a Story page (or a style's specimen) at publish. */
export function inspectStoryHtml(html: string): string[] {
  return inspectPageHtml(html, STORY_PAGE_RULES);
}

/** Validate a mockup page at publish. */
export function inspectMockupHtml(html: string): string[] {
  return inspectPageHtml(html, MOCKUP_PAGE_RULES);
}
