// A stepped load test of one WhatBuild deployment, run with k6 (https://grafana.com/docs/k6/), which
// is installed on its own and is not one of the repository's dependencies. It is for a dev
// deployment, never production (okf/operations/load-testing.md):
//
//   k6 run -e BASE=https://<the service's address> -e TOKENS=<folder>/tokens.json \
//     -e PRODUCT=<organization>/<product> -e SCENARIO=reader -e RATES=5,10,20,30,40 -e STEP=45 \
//     scripts/load-test/load.js
//
// Each iteration is one request, so a step's rate is requests a second. Each step is a scenario of
// its own, so the summary gives every step's latency, failures and refusals, and the test stops at
// the first step whose 95th percentile passes MAX_P95_MS or whose failures pass MAX_FAILED.
//
// TOKENS is the file scripts/load-test/accounts.mjs writes: synthetic people's sessions and agents'
// tokens. PRODUCT is a product every one of them reads, such as the example organization's.
//
// SCENARIO, what each request is:
//   site     a page of the public site, as the service serves it (SITE_BASE, SITE_A and SITE_B
//            choose the pages; behind the Cloudflare Worker the site is served at the edge instead)
//   signin   what the sign-in page asks of the service: the page, the session, the sign-in methods
//            and the release (its scripts and styles come from the edge behind the Worker)
//   reader   what the app's pages ask while someone reads PRODUCT, as a person in an organization
//   guest    the same, as a guest account, which comes in only while a guest's place is free
//   mcp      an agent's calls: initialize, the tool list, reads and a search
//   mix      all four, weighted by MIX (default signin:2,reader:4,guest:1,mcp:3)
//
// STREAMS=<n> with STREAM_PRODUCT=<organization>/<product> also holds n live streams open, as n
// open tabs of people in that organization do; each holds one of the instance's concurrent requests.
import http from "k6/http";
import { Counter } from "k6/metrics";

const BASE = __ENV.BASE;
const PRODUCT = __ENV.PRODUCT || "";
const STREAM_PRODUCT = __ENV.STREAM_PRODUCT || "";
const SCENARIO = __ENV.SCENARIO || "reader";
const RATES = (__ENV.RATES || "5,10,20").split(",").map(Number);
const STEP = parseInt(__ENV.STEP || "45", 10);
const STREAMS = parseInt(__ENV.STREAMS || "0", 10);
const MAX_P95_MS = parseInt(__ENV.MAX_P95_MS || "4000", 10);
const MAX_FAILED = parseFloat(__ENV.MAX_FAILED || "0.1");
const MIX = (__ENV.MIX || "signin:2,reader:4,guest:1,mcp:3").split(",").map((p) => {
  const [kind, weight] = p.split(":");
  return [kind, Number(weight)];
});
const T = JSON.parse(open(__ENV.TOKENS));

const refused = new Counter("refused_429");
const failed5xx = new Counter("failed_5xx");
const failedOther = new Counter("failed_other");

const scenarios = {};
const thresholds = {};
RATES.forEach((rate, i) => {
  const name = `step${String(i).padStart(2, "0")}_${rate}rps`;
  scenarios[name] = {
    executor: "constant-arrival-rate",
    rate,
    timeUnit: "1s",
    duration: `${STEP}s`,
    startTime: `${i * STEP}s`,
    preAllocatedVUs: Math.max(10, rate),
    maxVUs: Math.max(50, rate * 15),
    gracefulStop: "15s",
    tags: { step: String(rate) },
    exec: "step",
  };
  // A threshold on a step's metrics makes the summary report that step.
  thresholds[`http_req_duration{step:${rate}}`] = [{ threshold: `p(95)<${MAX_P95_MS}`, abortOnFail: true, delayAbortEval: "20s" }];
  thresholds[`http_req_failed{step:${rate}}`] = [{ threshold: `rate<${MAX_FAILED}`, abortOnFail: true, delayAbortEval: "20s" }];
  thresholds[`http_reqs{step:${rate}}`] = ["count>=0"];
  thresholds[`refused_429{step:${rate}}`] = ["count>=0"];
  thresholds[`failed_5xx{step:${rate}}`] = ["count>=0"];
  thresholds[`failed_other{step:${rate}}`] = ["count>=0"];
  thresholds[`dropped_iterations{scenario:${name}}`] = ["count>=0"];
});
if (STREAMS > 0) {
  scenarios.streams = { executor: "constant-vus", vus: STREAMS, duration: `${RATES.length * STEP}s`, exec: "stream", tags: { step: "stream" }, gracefulStop: "5s" };
}

export const options = {
  scenarios,
  thresholds,
  discardResponseBodies: true,
  summaryTrendStats: ["med", "p(90)", "p(95)", "p(99)", "max", "count"],
  userAgent: "whatbuild-load-test (k6)",
};

const pick = (a) => a[Math.floor(Math.random() * a.length)];
const weighted = (list) => {
  const total = list.reduce((s, [, w]) => s + w, 0);
  let r = Math.random() * total;
  for (const [x, w] of list) if ((r -= w) < 0) return x;
  return list[list.length - 1][0];
};

export function setup() {
  if (!PRODUCT) return { records: [], pages: [] };
  // The sources and Story pages the reads choose from, read once as one of the synthetic people.
  const h = { headers: { Cookie: `__Host-wb_session=${T.members[0]}` }, responseType: "text" };
  const records = [];
  let cursor = "";
  for (let n = 0; n < 20; n++) {
    const r = http.get(`${BASE}/api/v1/p/${PRODUCT}/sources?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, h);
    if (r.status !== 200) throw new Error(`reading ${PRODUCT}'s sources answered ${r.status}: is it a product the synthetic people read?`);
    const d = r.json();
    records.push(...d.records.map((x) => x.record_id));
    if (!d.next_cursor) break;
    cursor = d.next_cursor;
  }
  const pages = http.get(`${BASE}/api/v1/p/${PRODUCT}/story/pages`, h).json().items.map((x) => x.page_id);
  return { records, pages };
}

const WORDS = ["import", "pilot", "release", "field", "map", "approval", "sample", "budget", "team", "plan"];
const get = (url, name, params = {}) => http.get(url, Object.assign({ tags: { name }, timeout: "30s" }, params));

/** What a page of the app asks of the service while someone reads PRODUCT. */
function readerRequest(data, tok) {
  const p = `${BASE}/api/v1/p/${PRODUCT}`;
  const o = { headers: { Cookie: `__Host-wb_session=${tok}` } };
  const choices = [
    [() => get(`${BASE}/auth/session`, "session", o), 2],
    [() => get(`${BASE}/api/v1/me/guest-pass`, "guest-pass", o), 1],
    [() => get(`${BASE}/api/v1/me/products`, "my-products", o), 1],
    [() => get(p, "product", o), 2],
    [() => get(`${p}/outcomes`, "outcomes", o), 1],
    [() => get(`${p}/sources?include_summary=true&include_preview=true&limit=50`, "sources", o), 1],
    [() => get(`${p}/story/pages`, "story-pages", o), 1],
    [() => get(`${p}/mockups`, "mockups", o), 1],
    [() => get(`${p}/search?query=${pick(WORDS)}`, "search", o), 1],
    [() => get(`${BASE}/api/v1/plans`, "plans"), 0.5],
  ];
  if (data.records.length) choices.push([() => get(`${p}/sources/${pick(data.records)}`, "source", o), 2]);
  if (data.pages.length) choices.push([() => get(`${p}/story/pages/${pick(data.pages)}`, "story-page", o), 1]);
  return weighted(choices)();
}

/** What an agent's client sends: starting a conversation, the tool list, reads and a search. */
function mcpRequest(data, tok) {
  const call = (name, args) => ({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: Object.assign({ product: PRODUCT }, args) } });
  const choices = [
    [["initialize", { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "k6", version: "1" } } }], 1],
    [["tools/list", { jsonrpc: "2.0", id: 1, method: "tools/list" }], 2],
    [["products_read.get", call("products_read", { action: "get" })], 2],
    [["sources_read.list", call("sources_read", { action: "list", params: { limit: 20 } })], 2],
    [["outcomes_read.list", call("outcomes_read", { action: "list" })], 1],
    [["story_read.list_pages", call("story_read", { action: "list_pages" })], 1],
    [["search", call("search", { query: pick(WORDS) })], 1],
  ];
  if (data.records.length) choices.push([["sources_read.get", call("sources_read", { action: "get", params: { record_id: pick(data.records) } })], 2]);
  const [name, body] = weighted(choices);
  return http.post(`${BASE}/mcp`, JSON.stringify(body), {
    headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    tags: { name: `mcp ${name}` },
    timeout: "30s",
  });
}

function signInRequest() {
  return weighted([
    [() => get(`${BASE}/sign-in`, "sign-in page"), 1],
    [() => get(`${BASE}/auth/session`, "session (signed out)"), 1],
    [() => get(`${BASE}/auth/methods`, "methods"), 1],
    [() => get(`${BASE}/api/v1/meta`, "meta"), 1],
  ])();
}

function siteRequest() {
  const path = Math.random() < 0.5 ? __ENV.SITE_A || "/site/" : __ENV.SITE_B || "/site/what-to-build/";
  return get(`${__ENV.SITE_BASE || BASE}${path}`, "site page");
}

export function step(data) {
  const kind = SCENARIO === "mix" ? weighted(MIX) : SCENARIO;
  let res;
  if (kind === "site") res = siteRequest();
  else if (kind === "signin") res = signInRequest();
  else if (kind === "reader") res = readerRequest(data, pick(T.members));
  else if (kind === "guest") res = readerRequest(data, pick(T.guests));
  else if (kind === "mcp") res = mcpRequest(data, pick(T.agents));
  else throw new Error(`unknown scenario ${kind}`);
  if (res.status === 429) refused.add(1);
  else if (res.status >= 500 || res.status === 0) failed5xx.add(1);
  else if (res.status >= 400) failedOther.add(1);
}

export function stream() {
  // One tab's stream, held until the server ends it (WHATBUILD_LIVE_STREAM_MINUTES) or the test does.
  const tok = T.members[T.members.length - 1 - ((__VU - 1) % T.members.length)];
  http.get(`${BASE}/api/v1/p/${STREAM_PRODUCT}/live`, {
    headers: { Cookie: `__Host-wb_session=${tok}`, Origin: BASE, "Sec-Fetch-Site": "same-origin" },
    tags: { name: "live stream" },
    timeout: `${RATES.length * STEP + 30}s`,
  });
}

/** One line a step: the rate asked for and served, latency as the test machine saw it, and what went wrong. */
export function handleSummary(data) {
  const m = data.metrics;
  const v = (name) => (m[name] ? m[name].values : {});
  const pad = (x, n = 7) => String(x).padStart(n);
  const lines = [["target", "got/s", "p50 ms", "p90 ms", "p95 ms", "p99 ms", "max ms", "fail %", "429", "5xx", "4xx", "drop"].map((x) => pad(x)).join("")];
  RATES.forEach((rate, i) => {
    const n = v(`http_reqs{step:${rate}}`).count || 0;
    if (!n) return;
    const d = v(`http_req_duration{step:${rate}}`);
    const drop = v(`dropped_iterations{scenario:step${String(i).padStart(2, "0")}_${rate}rps}`).count || 0;
    lines.push(
      [rate, (n / STEP).toFixed(1), d.med, d["p(90)"], d["p(95)"], d["p(99)"], d.max]
        .map((x, j) => pad(j > 1 ? Math.round(x || 0) : x))
        .concat([(100 * (v(`http_req_failed{step:${rate}}`).rate || 0)).toFixed(1), v(`refused_429{step:${rate}}`).count || 0, v(`failed_5xx{step:${rate}}`).count || 0, v(`failed_other{step:${rate}}`).count || 0, drop].map((x) => pad(x)))
        .join(""),
    );
  });
  const out = { stdout: lines.join("\n") + "\n" };
  if (__ENV.SUMMARY) out[__ENV.SUMMARY] = JSON.stringify(data.metrics, null, 1);
  return out;
}
