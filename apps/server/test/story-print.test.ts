import { composePrintDocument, headingLevel, HOUSE_STYLES, prepareStoryPage, printCsp, printOrder, scopeStoryCss } from "@whatbuild/core";
import { describe, expect, it } from "vitest";

const page = (title: string, body: string, head = "") =>
  `<!doctype html><html lang="en" class="theme"><head><meta charset="utf-8"><title>${title}</title>${head}</head><body class="wb" data-mode="print">${body}</body></html>`;

describe("print order", () => {
  const tree = [
    { page_id: "a", children: [{ page_id: "b", children: [{ page_id: "c", children: [] }] }] },
    { page_id: "d", children: [] },
  ];

  it("walks the hierarchy depth-first, then unplaced pages by title", () => {
    const order = printOrder(tree, [
      { page_id: "y", title: "Beta" },
      { page_id: "c", title: "C" },
      { page_id: "d", title: "D" },
      { page_id: "x", title: "Alpha" },
      { page_id: "a", title: "A" },
    ]);
    expect(order.map((o) => o.page_id)).toEqual(["a", "c", "d", "x", "y"]);
  });

  it("levels count only chosen ancestors, so the outline never skips a level", () => {
    const order = printOrder(tree, [
      { page_id: "a", title: "A" },
      { page_id: "c", title: "C" },
    ]);
    expect(order).toEqual([
      { page_id: "a", depth: 1, level: 1 },
      { page_id: "c", depth: 3, level: 2 },
    ]);
    expect(printOrder(tree, [{ page_id: "c", title: "C" }])).toEqual([{ page_id: "c", depth: 3, level: 1 }]);
  });

  it("maps levels to headings under the document's h1, capped at h6", () => {
    expect([1, 2, 3, 4, 5, 6, 9].map(headingLevel)).toEqual([2, 3, 4, 5, 6, 6, 6]);
  });
});

describe("stylesheet scoping", () => {
  it("rewrites :root, html and body to :host", () => {
    expect(scopeStoryCss(":root { --x: 1 }")).toBe(":host { --x: 1 }");
    expect(scopeStoryCss("html, body { margin: 0 }")).toBe(":host, :host { margin: 0 }");
    expect(scopeStoryCss("body > main p { color: red }")).toBe(":host > main p { color: red }");
    expect(scopeStoryCss("html body .x { a: b }")).toBe(":host .x { a: b }");
    expect(scopeStoryCss("body.dark p { a: b }")).toBe(":host(.dark) p { a: b }");
    expect(scopeStoryCss(':root[data-theme="dark"] { a: b }')).toBe(':host([data-theme="dark"]) { a: b }');
  });

  it("keeps what a selector's arguments say, attribute selectors and arguments within arguments included", () => {
    expect(scopeStoryCss(':root:not([data-wb-theme="light"]) { --x: 2 }')).toBe(':host(:not([data-wb-theme="light"])) { --x: 2 }');
    expect(scopeStoryCss(".lines > li > :last-child:not(strong):not(:nth-child(2)) { a: b }")).toBe(".lines > li > :last-child:not(strong):not(:nth-child(2)) { a: b }");
    expect(scopeStoryCss("section.wide > :is(.timeline, .lines) { a: b }")).toBe("section.wide > :is(.timeline, .lines) { a: b }");
    expect(scopeStoryCss('body:has(a[href="x,y"]) p { a: b }')).toBe(':host(:has(a[href="x,y"])) p { a: b }');
    for (const s of HOUSE_STYLES) expect(scopeStoryCss(s.stylesheet), s.id).not.toContain("undefined");
  });

  it("leaves classes, ids, attribute values and declarations alone", () => {
    const css = '.body, #html, a[href*="body"], .x:not(.body) { content: "html body" }';
    expect(scopeStoryCss(css)).toBe(css);
  });

  it("recurses into @media and @supports, keeps @font-face and @keyframes, and keeps dark rules off paper", () => {
    expect(scopeStoryCss("@media (max-width: 40rem) { body { a: b } }")).toBe("@media (max-width: 40rem) { :host { a: b } }");
    expect(scopeStoryCss("@media (prefers-color-scheme: dark) { :root { --x: 2 } }")).toBe("@media screen and (prefers-color-scheme: dark) { :host { --x: 2 } }");
    const kept = "@keyframes k { from { opacity: 0 } to { opacity: 1 } } @font-face { font-family: body; src: url(data:font/woff2;base64,AA) }";
    expect(scopeStoryCss(kept)).toBe(kept);
    expect(scopeStoryCss("/* body { } */ body{a:b}")).toBe("/* body { } */ :host{a:b}");
  });
});

describe("page preparation", () => {
  it("drops scripts and event handlers, and carries html and body attributes to the host", () => {
    const p = prepareStoryPage(page("Plan", `<p onclick="steal()">Hi</p><script>document.body.innerHTML = "drawn"</script>`, "<style>:root{--a:1}</style>"), "Plan");
    expect(p.body).toContain("<p>Hi</p>");
    expect(p.body).not.toContain("script");
    expect(p.body).not.toContain("onclick");
    expect(p.styles).toEqual([":host{--a:1}"]);
    expect(p.host).toEqual(expect.arrayContaining([{ name: "lang", value: "en" }, { name: "class", value: "theme wb" }, { name: "data-mode", value: "print" }]));
  });

  it("drops refresh metadata, frames, forms and links a stored page should never hold", () => {
    const p = prepareStoryPage(
      page("Plan", `<meta http-equiv="refresh" content="0;url=https://example.com"><p>Hi</p><iframe src="https://example.com"></iframe><form><input></form><link rel="stylesheet" href="https://example.com/a.css"><base href="https://example.com/">`),
      "Plan",
    );
    expect(p.body).toContain("<p>Hi</p>");
    for (const tag of ["<meta", "<iframe", "<form", "<link", "<base"]) expect(p.body).not.toContain(tag);
  });

  it("drops a leading h1 only when it repeats the page title", () => {
    const same = prepareStoryPage(page("The hand-off test", "<main><h1>The  Hand-off test</h1><p>Body</p></main>"), "The hand-off test");
    expect(same.dropped_title).toBe(true);
    expect(same.body).not.toContain("<h1>");
    const different = prepareStoryPage(page("Overview", "<main><h1>The costly part is sending the plan</h1></main>"), "Overview");
    expect(different.dropped_title).toBe(false);
    expect(different.body).toContain("<h1>");
    const notLeading = prepareStoryPage(page("Plan", "<p>Intro first.</p><h1>Plan</h1>"), "Plan");
    expect(notLeading.dropped_title).toBe(false);
  });

  it("nests the page's own headings under its title in the outline, keeping their tags for the stylesheet", () => {
    const p = prepareStoryPage(page("Plan", '<main><h1>Plan</h1><h2>Why</h2><h3 aria-level="1">Detail</h3><h2>How</h2></main>'), "Plan", 3);
    expect(p.body).toContain('<h2 aria-level="4">Why</h2>');
    expect(p.body).toContain('<h3 aria-level="5">Detail</h3>');
    expect(p.body).toContain('<h2 aria-level="4">How</h2>');
    const kept = prepareStoryPage(page("Overview", "<h1>Where we stand</h1><h2>Next</h2>"), "Overview", 2);
    expect(kept.body).toContain('<h1 aria-level="3">Where we stand</h1>');
    expect(kept.body).toContain('<h2 aria-level="4">Next</h2>');
    expect(prepareStoryPage(page("Plan", "<h2>Why</h2>"), "Plan").body).toContain("<h2>Why</h2>");
  });
});

describe("the composed document", () => {
  const nonce = "n0nce-value";
  const html = composePrintDocument({
    productName: "Crewboard <beta>",
    exportedAt: "2026-09-26T10:00:00.000Z",
    nonce,
    pages: [
      { page_id: "overview", title: "Overview", version: 3, published_at: "2026-09-20T08:00:00.000Z", level: 1, html: page("Overview", "<h1>Overview</h1><p>Top.</p><script>alert(1)</script>", "<style>body{margin:0}</style>") },
      { page_id: "detail", title: "Detail", version: 1, published_at: "2026-09-21T08:00:00.000Z", level: 2, html: page("Detail", "<p>Child.</p>") },
      { page_id: "other", title: "Other", version: 2, published_at: "2026-09-22T08:00:00.000Z", level: 1, html: page("Other", "<p>Unplaced.</p>") },
    ],
  });

  it("has a title block with the product and export date, then contents in the given order", () => {
    expect(html).toContain("<h1>Crewboard &lt;beta&gt;</h1>");
    // Dates are written in UTC and rewritten by the print script in the reader's time zone.
    expect(html).toContain('exported <time datetime="2026-09-26T10:00:00.000Z">26 September 2026</time> · 3 pages');
    expect(html).toMatch(/<script nonce="[^"]+">var local = new Intl\.DateTimeFormat\("en-GB", \{"day":"numeric","month":"long","year":"numeric"\}\);document\.querySelectorAll\("time\[datetime\]"\)/);
    const contents = html.slice(html.indexOf("<nav"), html.indexOf("</nav>"));
    expect([...contents.matchAll(/href="#page-([a-z-]+)"/g)].map((m) => m[1])).toEqual(["overview", "detail", "other"]);
  });

  it("gives each page a heading at its level, in order, with its version", () => {
    const headings = [...html.matchAll(/<h(\d) class="print-heading" id="title-([a-z-]+)">/g)].map((m) => `${m[2]}:h${m[1]}`);
    expect(headings).toEqual(["overview:h2", "detail:h3", "other:h2"]);
    expect(html).toContain('Version 3 · published <time datetime="2026-09-20T08:00:00.000Z">20 September 2026</time>');
    // The page's own leading h1 repeated the title, so only the section heading remains.
    expect(html.match(/>Overview</g)).toHaveLength(2); // contents link and section heading
  });

  it("isolates each page in a declarative shadow root with its styles scoped to the host", () => {
    expect(html.match(/<template shadowrootmode="open">/g)).toHaveLength(3);
    expect(html).toContain('<template shadowrootmode="open"><style>:host{margin:0}</style>');
    expect(html).toContain('data-print-page="overview" lang="en" data-mode="print" class="theme wb"');
  });

  it("keeps what a page fixes on its own page, in its stylesheets and its style attributes", () => {
    expect(scopeStoryCss(".veil { position: fixed; inset: 0 }")).toBe(".veil { position:absolute; inset: 0 }");
    expect(scopeStoryCss(".a{color:red;POSITION:FIXED!important}")).toBe(".a{color:red;position:absolute!important}");
    expect(scopeStoryCss("@media screen { .a { position: fixed } }")).toBe("@media screen { .a { position:absolute } }");
    expect(scopeStoryCss(".a { background-position: fixed; position: sticky }")).toBe(".a { background-position: fixed; position: sticky }");
    const prepared = prepareStoryPage(page("T", '<div style="position: fixed; top: 0">Dialog</div><style>.b { position: fixed }</style>'), "T");
    expect(prepared.body).toContain('style="position:absolute; top: 0"');
    expect(prepared.body).toContain(".b { position:absolute }");
  });

  it("survives a stored stylesheet holding the characters its masks are made of", () => {
    expect(() => prepareStoryPage(page("T", "<style>\u00015\u0001{color:red}\u00005\u0000{color:blue}</style><p>Words.</p>"), "T")).not.toThrow();
  });

  it("answers what a mockup page's media queries ask of the width for its frame, not the paper", () => {
    expect(scopeStoryCss("@media (max-width: 900px) { .a { order: 1 } }", { width: 1440, height: 900 })).toContain("@media (max-width:0) {");
    expect(scopeStoryCss("@media (min-width: 900px) { .a { order: 1 } }", { width: 1440, height: 900 })).toContain("@media (min-width:0) {");
    expect(scopeStoryCss("@media screen and (min-width: 60em) { .a { order: 1 } }", { width: 800, height: 600 })).toContain("@media screen and (max-width:0) {");
    expect(scopeStoryCss("@media (width <= 48rem) { .a { order: 1 } }", { width: 390, height: 844 })).toContain("@media (min-width:0) {");
    expect(scopeStoryCss("@media (width > 500px), print { .a { order: 1 } }", { width: 390, height: 844 })).toContain("@media (max-width:0), print {");
    expect(scopeStoryCss("@media (900px <= width) { .a { order: 1 } }", { width: 1440, height: 900 })).toContain("@media (min-width:0) {");
    expect(scopeStoryCss("@media (600px <= width <= 1000px) { .a { order: 1 } }", { width: 1440, height: 900 })).toContain("@media (max-width:0) {");
    expect(scopeStoryCss(".a { @media (max-width: 900px) { order: 1 } }", { width: 1440, height: 900 })).toContain("@media (max-width:0)");
    // The viewport is the frame, in calculations and shorthand too, and only where a number is one.
    expect(scopeStoryCss(".a { width: 100vw; min-height: 100vh; height: calc(50dvh - 2px); margin: 0 5vw; }", { width: 1000, height: 800 })).toBe(".a { width: 1000px; min-height: 800px; height: calc(400px - 2px); margin: 0 50px; }");
    expect(scopeStoryCss(".a { color: #100vw; width: 100vw }")).toBe(".a { color: #100vw; width: 100vw }");
    expect(scopeStoryCss(".a { grid-area: a100vw; width: 1vw }", { width: 1000, height: 800 })).toBe(".a { grid-area: a100vw; width: 10px }");
    // A page with no frame answers to the paper, and a query about anything else is left alone.
    expect(scopeStoryCss("@media (max-width: 900px) { .a { order: 1 } }")).toContain("@media (max-width: 900px)");
    expect(scopeStoryCss("@media (orientation: landscape) { .a { order: 1 } }", { width: 1440, height: 900 })).toContain("(orientation: landscape)");
  });

  it("lays a mockup page out at its frame's width and scales it to the paper, and leaves other pages alone", () => {
    const framed = composePrintDocument({
      productName: "Crewboard",
      exportedAt: "2026-09-26T10:00:00.000Z",
      nonce,
      pages: [
        { page_id: "wide", title: "Wide", version: 1, published_at: "2026-09-20T08:00:00.000Z", level: 1, html: page("Wide", "<p>Wide.</p>"), frame: { width: 1280, height: 800 } },
        { page_id: "phone", title: "Phone", version: 1, published_at: "2026-09-20T08:00:00.000Z", level: 1, html: page("Phone", "<p>Phone.</p>"), frame: { width: 390, height: 844 } },
        { page_id: "plain", title: "Plain", version: 1, published_at: "2026-09-20T08:00:00.000Z", level: 1, html: page("Plain", "<p>Plain.</p>") },
      ],
    });
    expect(framed).toContain('<div class="print-frame" data-print-frame="1280" style="width:1280px;min-height:800px;--print-fit:0.5250"><div data-print-page="wide"');
    // A page narrower than the paper keeps its size.
    expect(framed).toContain('<div class="print-frame" data-print-frame="390" style="width:390px;min-height:844px;--print-fit:1.0000"><div data-print-page="phone"');
    expect(framed).toMatch(/<\/p>\n<div data-print-page="plain"/);
  });

  it("runs only the nonce'd print script", () => {
    const scripts = [...html.matchAll(/<script([^>]*)>/g)];
    expect(scripts).toHaveLength(1);
    expect(scripts[0]![1]).toBe(` nonce="${nonce}"`);
    expect(html).toContain("window.print()");
    expect(html).not.toContain("alert(1)");
    expect(html).toContain("@page");
    expect(html).toMatch(/\.print-section\[data-level="1"\] \{ break-before: page;/);
  });

  it("sends a policy that blocks every other script and keeps the view in an opaque origin", () => {
    const csp = printCsp(nonce);
    const directives = Object.fromEntries(csp.split(";").map((d) => d.trim().split(/\s+/)).map(([k, ...v]) => [k, v]));
    expect(directives["script-src"]).toEqual([`'nonce-${nonce}'`]);
    expect(directives["default-src"]).toEqual(["'none'"]);
    expect(directives["style-src"]).toEqual(["'unsafe-inline'"]);
    expect(directives["img-src"]).toEqual(["data:"]);
    expect(directives["sandbox"]).toEqual(["allow-modals", "allow-scripts"]);
    expect(csp).not.toContain("allow-same-origin");
  });
});
