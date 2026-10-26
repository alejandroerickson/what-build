// WhatBuild's kill switch: it closes Cloud Run services to the internet when the month's spending
// reaches its cap, or when an alert says a flood is running up a cost nothing caps
// (okf/operations/cloud-run.md, A hard limit on the bill). Pub/Sub pushes it each message from the
// topic the budget and those alerts publish to; server.mjs answers the push.
//
// Closing takes the public (allUsers, allAuthenticatedUsers) off the service's invoker role. Google's
// front end then refuses every request from the internet (403) before any instance starts, so they
// cost nothing, and every row, file, setting and revision is kept. It needs only the right to change
// the service's access policy: changing its ingress would need the right to act as the service's
// runtime identity, which reads the database and the files. A budget's message is compared with the
// budget's own amount, so after raising the budget a service may be opened again and stays open.

/** The members that make a service public, taken off its invoker role to close it. */
export const PUBLIC = ["allUsers", "allAuthenticatedUsers"];
const INVOKER = "roles/run.invoker";

/** What a message from the topic asks: to close, and why, or nothing. */
export function decide(message) {
  let data;
  try {
    data = JSON.parse(Buffer.from(message?.data ?? "", "base64").toString("utf8"));
  } catch {
    return { close: false, reason: "a message that is not JSON" };
  }
  // A budget's notification: what the month has cost so far, and the budget's amount.
  if (typeof data?.costAmount === "number" && typeof data?.budgetAmount === "number") {
    const spent = `${data.costAmount} of ${data.budgetAmount} ${data.currencyCode ?? ""}`.trim();
    return data.costAmount >= data.budgetAmount
      ? { close: true, reason: `the month's spending reached its cap: ${spent}` }
      : { close: false, reason: `the month's spending is under its cap: ${spent}` };
  }
  // An incident of one of the kill switch's alert policies.
  if (data?.incident) {
    const policy = data.incident.policy_name ?? "an alert";
    return data.incident.state === "open" ? { close: true, reason: `${policy} opened` } : { close: false, reason: `${policy} is ${data.incident.state ?? "not open"}` };
  }
  return { close: false, reason: "neither a budget's notification nor an alert" };
}

/** The services to close, from `project/region/service`, comma-separated. */
export function parseServices(text) {
  const services = (text ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  for (const s of services) if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]\/[a-z0-9-]+\/[a-z][a-z0-9-]{0,62}$/.test(s)) throw new Error(`SERVICES: "${s}" is not project/region/service.`);
  if (!services.length) throw new Error("SERVICES must name at least one service, as project/region/service.");
  return services;
}

/** Close each service to the internet, leaving one already closed as it is; every one is tried before a failure is thrown. */
export async function closeAll(services, token, fetch = globalThis.fetch) {
  const results = [];
  const failures = [];
  for (const s of services) {
    const [project, region, name] = s.split("/");
    const url = `https://run.googleapis.com/v2/projects/${project}/locations/${region}/services/${name}`;
    const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
    try {
      const got = await fetch(`${url}:getIamPolicy`, { headers });
      if (!got.ok) throw new Error(`reading its access: ${got.status} ${(await got.text()).slice(0, 300)}`);
      const policy = await got.json();
      const bindings = policy.bindings ?? [];
      if (!bindings.some((b) => b.role === INVOKER && b.members?.some((m) => PUBLIC.includes(m)))) {
        results.push(`${s}: already closed`);
        continue;
      }
      const closed = bindings
        .map((b) => (b.role === INVOKER ? { ...b, members: b.members.filter((m) => !PUBLIC.includes(m)) } : b))
        .filter((b) => b.members?.length);
      // The policy's etag makes a change made in between fail rather than be overwritten.
      const set = await fetch(`${url}:setIamPolicy`, { method: "POST", headers, body: JSON.stringify({ policy: { ...policy, bindings: closed } }) });
      if (!set.ok) throw new Error(`closing it: ${set.status} ${(await set.text()).slice(0, 300)}`);
      results.push(`${s}: closed`);
    } catch (e) {
      failures.push(`${s}: ${e instanceof Error ? e.message : e}`);
    }
  }
  if (failures.length) throw new Error(`${failures.join("; ")}${results.length ? ` (${results.join("; ")})` : ""}`);
  return results;
}

/** The access token of the service's own identity, from the metadata server. */
export async function metadataToken(fetch = globalThis.fetch) {
  const r = await fetch("http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token", { headers: { "Metadata-Flavor": "Google" } });
  if (!r.ok) throw new Error(`the metadata server gave no token: ${r.status}`);
  return (await r.json()).access_token;
}

/** One push from Pub/Sub: decide, close when asked, and log what was done. */
export async function handle(push, { services, token, fetch = globalThis.fetch, log }) {
  const decision = decide(push?.message);
  if (!decision.close) {
    log({ severity: "INFO", message: `nothing closed: ${decision.reason}` });
    return { ...decision, results: [] };
  }
  const results = await closeAll(services, await token(), fetch);
  log({ severity: "WARNING", message: `closed to the internet, because ${decision.reason}: ${results.join("; ")}` });
  return { ...decision, results };
}
