import { escapeHtml } from "@whatbuild/core";
import type { Context } from "hono";

/**
 * The few pages sign-in and OAuth render on the server, outside the web app: one panel on the
 * canvas, in Studio's tokens for light and dark, with no script and nothing loaded from anywhere.
 */
const STYLE = `:root{color-scheme:light dark;--canvas:#f0f0f0;--panel:#ffffff;--text:#1e1e1e;--muted:#555555;--line:#e6e6e6;--line-2:#d5d5d5;--hover:#f2f2f2;--accent:#5a53e8;--accent-hover:#4a43d6;--accent-text:#ffffff;--shadow:0 2px 5px rgb(0 0 0 / .08),0 0 0 .5px rgb(0 0 0 / .12)}
@media (prefers-color-scheme:dark){:root{--canvas:#1b1b1b;--panel:#2a2a2a;--text:#ededed;--muted:#bdbdbd;--line:#383838;--line-2:#474747;--hover:#353535;--accent:#8b85ff;--accent-hover:#a09bff;--accent-text:#15142b;--shadow:0 2px 5px rgb(0 0 0 / .4),0 0 0 .5px rgb(255 255 255 / .08)}}
body{margin:0;background:var(--canvas);color:var(--text);font:13px/1.55 "Inter Variable","Inter",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:30rem;margin:12vh auto;padding:24px;background:var(--panel);border-radius:12px;box-shadow:var(--shadow)}
@media (max-width:32rem){main{margin:16px 10px}}
h1{font-size:20px;font-weight:600;line-height:1.25;letter-spacing:-.01em;margin:0 0 16px}
p{margin:0 0 12px}.muted{color:var(--muted);font-size:12px}
.row{display:flex;gap:8px;margin-top:20px;flex-wrap:wrap}
button{font:inherit;font-weight:500;height:28px;padding:0 12px;border-radius:6px;border:1px solid var(--line-2);background:var(--panel);color:var(--text);cursor:pointer}
button:hover{background:var(--hover)}
button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
button.primary{background:var(--accent);border-color:var(--accent);color:var(--accent-text)}
button.primary:hover{background:var(--accent-hover);border-color:var(--accent-hover)}
fieldset{border:0;margin:16px 0 0;padding:0;min-width:0}legend{font-weight:600;margin:0 0 8px;padding:0}
.choice{display:flex;gap:10px;align-items:flex-start;padding:8px 10px;border:1px solid var(--line);border-radius:8px;margin:0 0 6px;cursor:pointer}
.choice:hover{background:var(--hover)}.choice:has(input:checked){border-color:var(--accent)}
.choice input{margin:3px 0 0;accent-color:var(--accent)}input:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.choice b{display:block;font-weight:500;font-size:13px;color:var(--text)}.choice span{color:var(--muted);font-size:12px}`;

/** A page: `title` for the tab, `body` the panel's HTML, already escaped. */
export function authPage(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} · WhatBuild</title>
<style>
${STYLE}
</style></head><body><main>
${body}
</main></body></html>`;
}

/**
 * The headers every such page is sent with: never framed, never cached, and nothing but its own
 * style; its form posts to WhatBuild, and to `formTargets` as well. No referrer leaves the origin
 * (an address here can carry a credential); `same-origin` rather than `no-referrer`, under which
 * browsers send `Origin: null` with the form's own POST, which the origin check then refuses.
 */
export function authPageHeaders(c: Context, formTargets = "") {
  c.header("X-Frame-Options", "DENY");
  c.header("Cache-Control", "no-store");
  c.header("Referrer-Policy", "same-origin");
  c.header("Content-Security-Policy", `frame-ancestors 'none'; default-src 'none'; style-src 'unsafe-inline'; form-action 'self'${formTargets ? ` ${formTargets}` : ""}; base-uri 'none'`);
}
