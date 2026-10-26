#!/usr/bin/env node
// The Cloud Run deployment's alerts, created or brought up to date (a re-run is safe), each mailed
// to one address. Run it from a clone, signed in to gcloud with rights over Cloud Monitoring:
//
//   PROJECT_ID=my-whatbuild node deploy/cloud-run/alerts.mjs
//
// What they watch is in okf/operations/cloud-run.md (Alerts). Nothing here makes a request to the
// service: an uptime check every few minutes would keep an instance, which is billed while it
// lives, running all month.
//
// Settings (environment):
//   PROJECT_ID    required. Deliberately not taken from gcloud's current project.
//   SERVICE       default whatbuild; its jobs are the ones whose names start with it
//   ALERT_EMAIL   where alerts go; default: the gcloud account running this
//   DRY_RUN=1     print the policies instead of writing them
import { execFileSync } from "node:child_process";

const project = process.env.PROJECT_ID?.trim();
if (!project) {
  console.error("Set PROJECT_ID to the Google Cloud project for WhatBuild (it is never taken from the current gcloud project).");
  process.exit(1);
}
const service = process.env.SERVICE?.trim() || "whatbuild";
const gcloud = (...args) => execFileSync("gcloud", args, { encoding: "utf8" }).trim();
const email = process.env.ALERT_EMAIL?.trim() || gcloud("config", "get-value", "account");
if (!/^[^\s@]+@[^\s@]+$/.test(email)) {
  console.error("Set ALERT_EMAIL to the address alerts go to.");
  process.exit(1);
}
const dryRun = process.env.DRY_RUN === "1";
const api = `https://monitoring.googleapis.com/v3/projects/${project}`;
const guide = "okf/operations/cloud-run.md, Alerts, in the WhatBuild repository";

const revision = `resource.type = "cloud_run_revision" AND resource.labels.service_name = "${service}"`;
const threshold = (filter, aggregation, value, duration, period = "300s") => ({
  filter,
  aggregations: [{ alignmentPeriod: period, ...aggregation }],
  comparison: "COMPARISON_GT",
  thresholdValue: value,
  duration,
  trigger: { count: 1 },
});
const doc = (content) => ({ content: `${content}\n\nWhat to do: ${guide}.`, mimeType: "text/markdown" });

/** By display name, which is how a re-run finds the policy it made before. */
const POLICIES = [
  {
    displayName: `${service}: server errors`,
    documentation: doc(`The service answered requests with a 5xx status: an unexpected error in WhatBuild, a request that ran past its timeout, or no instance able to serve it. The service's error lines say which.`),
    conditions: [
      {
        displayName: "5xx responses in five minutes",
        conditionThreshold: threshold(`${revision} AND metric.type = "run.googleapis.com/request_count" AND metric.labels.response_code_class = "5xx"`, { perSeriesAligner: "ALIGN_SUM", crossSeriesReducer: "REDUCE_SUM" }, 0, "0s"),
      },
    ],
    alertStrategy: { autoClose: "1800s" },
    severity: "ERROR",
  },
  {
    displayName: `${service}: errors in the log`,
    documentation: doc(`The service logged a line with severity ERROR: an unexpected error behind a 500 (in an operation, an upload or sign-in), a failure at start-up, or the instance stopped for lack of memory. One mail an hour at most, however many lines follow.`),
    conditions: [
      {
        displayName: "an error line",
        // Cloud Run's own request log is left to the first policy: it holds every 5xx too.
        conditionMatchedLog: { filter: `${revision} AND severity >= ERROR AND NOT log_id("run.googleapis.com/requests")` },
      },
    ],
    alertStrategy: { notificationRateLimit: { period: "3600s" }, autoClose: "1800s" },
    severity: "ERROR",
  },
  {
    displayName: `${service}: memory`,
    documentation: doc(`An instance has used more than 85% of its memory for five minutes. At the limit Cloud Run stops it, with every request it was serving and the upload it was reading.`),
    conditions: [
      {
        displayName: "memory above 85% for five minutes",
        conditionThreshold: threshold(`${revision} AND metric.type = "run.googleapis.com/container/memory/utilizations"`, { perSeriesAligner: "ALIGN_PERCENTILE_99", crossSeriesReducer: "REDUCE_MAX" }, 0.85, "300s"),
      },
    ],
    alertStrategy: { autoClose: "1800s" },
    severity: "WARNING",
  },
  {
    displayName: `${service}: a job failed`,
    documentation: doc(`A run of one of the deployment's Cloud Run jobs failed: the nightly backup (${service}-backup) or a migration (${service}-migrate). A backup that fails leaves the last good dump the newest; a migration that fails stops the deploy before the new version serves.`),
    conditions: [
      {
        displayName: "a failed execution",
        conditionThreshold: threshold(
          `resource.type = "cloud_run_job" AND resource.labels.job_name = starts_with("${service}") AND metric.type = "run.googleapis.com/job/completed_execution_count" AND metric.labels.result = "failed"`,
          { perSeriesAligner: "ALIGN_SUM", crossSeriesReducer: "REDUCE_SUM", groupByFields: ["resource.labels.job_name"] },
          0,
          "0s",
        ),
      },
    ],
    alertStrategy: { autoClose: "86400s" },
    severity: "ERROR",
  },
  // A flood: nothing caps what logs, data sent out and the requests behind them cost, so these
  // mail within minutes, where a budget's mail comes hours later. Each is set far past what a
  // few teams and their agents send.
  {
    displayName: `${service}: a flood of requests`,
    documentation: doc(`More than 3,000 requests reached the service in five minutes, whatever they were answered, refusals included: someone is sending far more than people and agents do. Each is billed in instance time, log lines and data sent out.`),
    conditions: [
      {
        displayName: "over 3,000 requests in five minutes",
        conditionThreshold: threshold(`${revision} AND metric.type = "run.googleapis.com/request_count"`, { perSeriesAligner: "ALIGN_SUM", crossSeriesReducer: "REDUCE_SUM" }, 3000, "0s"),
      },
    ],
    alertStrategy: { autoClose: "3600s" },
    severity: "WARNING",
  },
  {
    displayName: `${service}: data sent out`,
    documentation: doc(`The service sent more than 1 GB to the internet in an hour, about US$0.10 a GB and with no ceiling: downloads repeated by someone, or a flood of requests.`),
    conditions: [
      {
        displayName: "over 1 GB to the internet in an hour",
        conditionThreshold: threshold(
          `${revision} AND metric.type = "run.googleapis.com/container/network/sent_bytes_count" AND metric.labels.kind = "internet"`,
          { perSeriesAligner: "ALIGN_SUM", crossSeriesReducer: "REDUCE_SUM" },
          1e9,
          "0s",
          "3600s",
        ),
      },
    ],
    alertStrategy: { autoClose: "3600s" },
    severity: "WARNING",
  },
  {
    displayName: `${service}: logs written`,
    documentation: doc(`The project wrote more than 100 MB of logs in an hour. Past 50 GB in a month each GB costs US$0.50, with no ceiling: most often a flood of requests, each logged by Cloud Run and by the service.`),
    conditions: [
      {
        displayName: "over 100 MB of logs in an hour",
        conditionThreshold: threshold(`resource.type = "global" AND metric.type = "logging.googleapis.com/billing/bytes_ingested"`, { perSeriesAligner: "ALIGN_SUM", crossSeriesReducer: "REDUCE_SUM" }, 1e8, "0s", "3600s"),
      },
    ],
    alertStrategy: { autoClose: "3600s" },
    severity: "WARNING",
  },
];

const token = gcloud("auth", "print-access-token");
async function call(method, path, body) {
  const r = await fetch(`${api}/${path}`, { method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${path}: ${r.status} ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : {};
}
/** Every page of a list. */
async function list(path, key) {
  const all = [];
  let pageToken = "";
  do {
    const page = await call("GET", `${path}${path.includes("?") ? "&" : "?"}pageSize=100${pageToken ? `&pageToken=${pageToken}` : ""}`);
    all.push(...(page[key] ?? []));
    pageToken = page.nextPageToken ?? "";
  } while (pageToken);
  return all;
}

if (dryRun) {
  console.log(JSON.stringify(POLICIES.map((p) => ({ ...p, combiner: "OR", notificationChannels: [`(email ${email})`] })), null, 2));
  process.exit(0);
}

const channels = await list("notificationChannels", "notificationChannels");
let channel = channels.find((c) => c.type === "email" && c.labels?.email_address === email);
if (!channel) {
  channel = await call("POST", "notificationChannels", { type: "email", displayName: `${service} alerts (${email})`, labels: { email_address: email } });
  console.log(`created the email channel for ${email}`);
}

const existing = await list("alertPolicies", "alertPolicies");
for (const policy of POLICIES) {
  const body = { ...policy, combiner: "OR", enabled: true, notificationChannels: [channel.name] };
  const found = existing.find((p) => p.displayName === policy.displayName);
  // A PATCH without a mask replaces the whole policy, so an edit here is the policy afterwards.
  if (found) await call("PATCH", found.name.replace(`projects/${project}/`, ""), { ...body, name: found.name });
  else await call("POST", "alertPolicies", body);
  console.log(`${found ? "updated" : "created"} "${policy.displayName}"`);
}
console.log(`Alerts go to ${email}. See them at https://console.cloud.google.com/monitoring/alerting?project=${project}`);
