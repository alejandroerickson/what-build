import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { useParams, useSearchParams } from "react-router";
import { api, ApiError } from "../lib/api.ts";
import { formatBytes, formatDate, formatDateTime, plural, slugProblem, untilTime } from "../lib/format.ts";
import { amount, PLAN_WORDS, useOrganizationLimits, type DeploymentLimit, type InstanceOrganization, type InstanceOrganizations, type LimitValue, type OrganizationLimits, type Plan } from "../lib/limits.ts";
import { useMe } from "../lib/session.tsx";
import { usePageTitle } from "../shell/slots.tsx";
import { Button, ButtonLink, Dialog, EmptyState, ErrorCallout, Glyph, ListRow, Loading, Segmented, Sheet, SheetBody, SheetHeader, StatusBadge, TextField, useToast } from "../ui/index.tsx";
import "../styles/screens/limits.css";

const MiB = 1024 * 1024;
const BYTES = new Set(["file_max_bytes", "bytes_per_day", "org_bytes_per_day"]);

// ---- /t/:tenant/limits ----------------------------------------------------------------------------

/**
 * An organization's plan and limits. Its people see their daily allowances, with what they used of
 * each today, and the few limits on what they add that they can run into. An owner of this WhatBuild,
 * who sets them, sees every limit with the refusal a call over it gets, and the deployment's own with
 * what sets each. Nobody changes them here: an instance owner does, on the instance's page.
 */
export function LimitsPage() {
  const { tenant = "" } = useParams();
  const me = useMe();
  const q = useOrganizationLimits(tenant);
  usePageTitle("Plan and limits");
  if (q.isPending || me.isPending)
    return (
      <Sheet label="Loading the plan and limits">
        <Loading label="Loading the plan and limits…" lines={4} />
      </Sheet>
    );
  if (q.isError)
    return (
      <Sheet labelledBy="limits-missing">
        <SheetHeader level={1} id="limits-missing" title="The plan and limits couldn’t be loaded" />
        <SheetBody>
          <ErrorCallout inset error={q.error} onRetry={() => q.refetch()} />
        </SheetBody>
      </Sheet>
    );
  return me.data?.tenant_allowance.instance_owner ? <InstanceOwnerLimits l={q.data} /> : <PersonLimits l={q.data} />;
}

/** The daily allowances, in the order a person meets them and named as what they do: theirs, then everyone's together. */
const YOURS = [
  { key: "writes_per_day", label: "Changes" },
  { key: "sources_per_day", label: "Sources added" },
  { key: "bytes_per_day", label: "Files uploaded" },
  { key: "exports_per_day", label: "Exports" },
];
const EVERYONES = [
  { key: "org_writes_per_day", label: "Changes" },
  { key: "org_bytes_per_day", label: "Files uploaded" },
];

/** A size as a person reads it: 10 MB, not 10.0 MB. */
const size = (n: number) => formatBytes(n).replace(/\.0+ /, " ");

function PersonLimits({ l }: { l: OrganizationLimits }) {
  const guest = l.you_meet_them === "calls_per_minute_only";
  const meets = l.you_meet_them === true;
  const pick = (list: { key: string; label: string }[]) => list.flatMap((a) => l.limits.filter((x) => x.key === a.key).map((limit) => ({ ...a, limit })));
  const groups = meets
    ? [
        { id: "today-yours", title: "You", items: pick(YOURS) },
        { id: "today-everyone", title: `Everyone in ${l.organization.name}`, items: pick(EVERYONES) },
      ].filter((g) => g.items.length)
    : [];
  return (
    <>
      <Sheet labelledBy="limits-title">
        <SheetHeader level={1} id="limits-title" title="Plan and limits" count={l.organization.name} />
        <SheetBody className="limits-about">
          {guest ? (
            <p>This is the example organization. You can read it but not change it, so you have no allowances here.</p>
          ) : meets ? (
            <>
              <p>
                {l.organization.name} is on the free plan. Everyone here has the same daily allowances, owners included. They start over at midnight UTC,{" "}
                <span title={formatDateTime(l.allowances_restart_at)}>{untilTime(l.allowances_restart_at)}</span>.
              </p>
              <p className="muted">Only whoever runs this WhatBuild can change the plan.</p>
            </>
          ) : (
            <>
              <p>{l.organization.name} has no daily allowances.</p>
              <p className="muted">What everyone does is still counted, day by day, so that if {l.organization.name} moves to the free plan, that day's allowances start from what was already done.</p>
            </>
          )}
        </SheetBody>
      </Sheet>
      {groups.length ? (
        <Sheet labelledBy="today-title">
          <SheetHeader id="today-title" title="Today" />
          {groups.map((g) => (
            <section key={g.id} className="limits-group" aria-labelledby={g.id}>
              <h3 id={g.id} className="limits-group-label">
                {g.title}
              </h3>
              <ul className="limits-allowances">
                {g.items.map((a) => (
                  <Allowance key={a.key} label={a.label} limit={a.limit} />
                ))}
              </ul>
            </section>
          ))}
        </Sheet>
      ) : null}
      {guest ? null : <WhatYouAdd l={l} />}
    </>
  );
}

/** One daily allowance: what is used of it today, as words and a bar, or that the plan switches it off. */
function Allowance({ label, limit }: { label: string; limit: LimitValue }) {
  const allowed = typeof limit.value === "number" ? limit.value : 0;
  const used = limit.used ?? 0;
  const full = allowed > 0 && used >= allowed;
  const show = (n: number) => (limit.unit === "bytes" && n > 0 ? size(n) : n.toLocaleString("en-US"));
  return (
    <li className="limits-allowance">
      <span className="limits-allowance-name">{label}</span>
      {allowed === 0 ? (
        <span className="muted">Off on this plan</span>
      ) : (
        <span className="limits-allowance-used">
          <span className="num">
            {show(used)} of {show(allowed)}
            {full ? ", used up" : ""}
          </span>
          <span className="limits-bar" data-full={full || undefined} aria-hidden="true">
            <span style={{ width: `${Math.min(1, used / allowed) * 100}%` }} />
          </span>
        </span>
      )}
    </li>
  );
}

/**
 * The limits on what someone adds that they can run into, said as sentences. A file's size is the
 * most the web app takes: it uploads through the relay, so the relay's limit applies too.
 */
function WhatYouAdd({ l }: { l: OrganizationLimits }) {
  const meets = l.you_meet_them === true;
  const deployment = (k: string) => l.deployment_limits.find((x) => x.key === k)?.value;
  const planned = (k: string) => (meets ? l.limits.find((x) => x.key === k)?.value : undefined);
  // A file size or a daily upload allowance of 0 switches uploads off.
  const uploadsOff = ["file_max_bytes", "bytes_per_day", "org_bytes_per_day"].some((k) => planned(k) === 0);
  const fileMax = Math.min(...[deployment("file_max_bytes"), deployment("relay_max_bytes"), planned("file_max_bytes")].filter((v): v is number => typeof v === "number"));
  const readCap = deployment("parse_cap_bytes");
  const attachments = deployment("attachments_per_source");
  const mockups = deployment("mockups_per_product");
  const pages = deployment("story_pages_per_product");
  const lines = [
    uploadsOff ? "Uploading files is off on this plan." : Number.isFinite(fileMax) ? `Files up to ${size(fileMax)} each.` : null,
    !uploadsOff && readCap !== undefined && readCap < fileMax ? `Text is read from files up to ${size(readCap)}; a larger file is kept but not read.` : null,
    !uploadsOff && attachments !== undefined ? `Up to ${attachments.toLocaleString("en-US")} attachments on a source.` : null,
    mockups !== undefined && pages !== undefined ? `Up to ${mockups.toLocaleString("en-US")} mockups and ${pages.toLocaleString("en-US")} Story pages in a product.` : null,
    !uploadsOff && planned("documents_only") === true ? "Files must be ones WhatBuild reads: text, Markdown, transcripts, HTML, Word, PDF, spreadsheets or XML." : null,
    !uploadsOff && planned("fetch_url") === false ? "Adding a file from a link is off on this plan." : null,
  ].filter((x): x is string => Boolean(x));
  if (!lines.length) return null;
  return (
    <Sheet labelledBy="adding-title">
      <SheetHeader id="adding-title" title="What you can add" />
      <SheetBody>
        <ul className="limits-lines">
          {lines.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
      </SheetBody>
    </Sheet>
  );
}

/**
 * For an owner of this WhatBuild: who in the organization meets its limits, every limit with the
 * refusal a call over it gets, and what sets each of the deployment's. What they used today is counted
 * on every plan, so it shows on every plan but to a guest of the example organization.
 */
function InstanceOwnerLimits({ l }: { l: OrganizationLimits }) {
  const free = l.plan === "free";
  const counted = l.limits.some((x) => x.used !== undefined);
  return (
    <>
      <Sheet labelledBy="limits-title">
        <SheetHeader
          level={1}
          id="limits-title"
          title="Plan and limits"
          count={l.organization.name}
          end={<ButtonLink to={`/instance?org=${encodeURIComponent(l.organization.slug)}`} size="sm" icon="pencil">Change plan and limits</ButtonLink>}
        />
        <SheetBody className="limits-about">
          <dl className="limits-facts">
            <div>
              <dt>Plan</dt>
              <dd>
                <StatusBadge tone={free ? "neutral" : "positive"}>{l.plan_name}</StatusBadge>
              </dd>
            </div>
            <div>
              <dt>What it means</dt>
              <dd>
                {free ? "Everyone in it meets these limits, owners included." : "Nobody in it meets these limits."}
                {l.organization.example ? " Its guests meet only the limit on calls a minute." : ""}
              </dd>
            </div>
            <div>
              <dt>Daily counts</dt>
              <dd>
                Start over at midnight UTC, <span title={formatDateTime(l.allowances_restart_at)}>{untilTime(l.allowances_restart_at)}</span>.
              </dd>
            </div>
          </dl>
        </SheetBody>
      </Sheet>
      <Sheet labelledBy="your-limits-title">
        <SheetHeader id="your-limits-title" title={free ? "Limits" : "Limits on the free plan"} count={l.limits.length} />
        <div className="limits-scroll">
          <Table head={["Limit", "Counted over", { label: "Allowed", num: true }, ...(counted ? [{ label: "Used today", num: true }] : []), "Over the limit"]}>
            {l.limits.map((a) => (
              <Row key={a.key} label={a.label} help={a.help}>
                <Cell className="muted">{a.per}</Cell>
                <Cell label="Allowed" num>{amount(a.value, a.unit)}</Cell>
                {counted ? (
                  <Cell label="Used today" num>
                    {a.used === undefined ? <NotDaily /> : a.unit === "bytes" ? formatBytes(a.used) : a.used.toLocaleString("en-US")}
                  </Cell>
                ) : null}
                <Cell label="Over the limit" className="limits-refusal"><code>{a.refusal}</code></Cell>
              </Row>
            ))}
          </Table>
        </div>
      </Sheet>
      <DeploymentLimits limits={l.deployment_limits} />
    </>
  );
}

function NotDaily() {
  return (
    <span className="faint" title="Not a daily limit">
      <span aria-hidden="true">–</span>
      <span className="visually-hidden">Not a daily limit</span>
    </span>
  );
}

function DeploymentLimits({ limits }: { limits: DeploymentLimit[] }) {
  return (
    <Sheet labelledBy="deployment-title">
      <SheetHeader id="deployment-title" title="Limits of this deployment" count={limits.length} />
      <div className="limits-scroll">
        <Table head={["Limit", { label: "Value", num: true }, "Set by"]}>
          {limits.map((l) => (
            <Row key={l.key} label={l.label}>
              <Cell num>{l.unit === "bytes" ? formatBytes(l.value) : `${l.value.toLocaleString("en-US")} ${l.unit}`}</Cell>
              <Cell label="Set by">{l.set_by ? <code>{l.set_by}</code> : <span className="faint">The application</span>}</Cell>
            </Row>
          ))}
        </Table>
      </div>
      <p className="limits-foot">Every organization has these, whatever its plan. Where a plan&rsquo;s limit is lower, that one applies. An organization&rsquo;s people see only the few they can run into.</p>
    </Sheet>
  );
}

// ---- The instance's organizations -----------------------------------------------------------------

const ORGS = "/api/v1/organizations";

/**
 * On the instance page: every organization with its plan. Each row renames the organization, and
 * opens its plan and limits, as `?org=<slug>` does, the address an organization's Plan and limits
 * page links to.
 */
export function InstanceOrganizationsSheet() {
  const q = useQuery({ queryKey: ["instance-organizations"], queryFn: () => api<InstanceOrganizations>("GET", ORGS) });
  const [params, setParams] = useSearchParams();
  const [renamingSlug, setRenamingSlug] = useState<string | null>(null);
  const items = q.data?.items ?? [];
  const editing = items.find((o) => o.slug === params.get("org")) ?? null;
  const renaming = items.find((o) => o.slug === renamingSlug) ?? null;
  const close = () =>
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        next.delete("org");
        return next;
      },
      { replace: true },
    );
  return (
    <Sheet labelledBy="organizations-title">
      <SheetHeader level={1} id="organizations-title" title="Organizations" count={q.data ? items.length : undefined} />
      <SheetBody className="instance-intro">
        <p className="muted">
          {q.data?.new_organization_plan === "free"
            ? "New organizations start on the free plan, except ones an owner of this WhatBuild starts, which are unlimited. On the free plan everyone meets the limits, owners included."
            : q.data
              ? "New organizations start unlimited. Put one on the free plan to hold everyone in it to the limits, owners included."
              : null}
        </p>
        <p className="faint">
          The starting plan is set where the service is deployed: <code>WHATBUILD_NEW_ORGANIZATION_PLAN</code>.
        </p>
      </SheetBody>
      {q.isPending ? (
        <Loading label="Loading organizations…" lines={3} />
      ) : q.isError ? (
        <SheetBody>
          <ErrorCallout inset error={q.error} onRetry={() => q.refetch()} />
        </SheetBody>
      ) : !items.length ? (
        <EmptyState size="inline" title="No organizations yet" />
      ) : (
        <div className="instance-rows">
          {items.map((o) => {
            const changed = Object.keys(o.changed_limits).length;
            return (
              <ListRow
                key={o.slug}
                className="instance-row"
                title={
                  <>
                    {o.name}
                    <span className="muted"> · {o.slug}</span>
                  </>
                }
                sub={
                  <>
                    {[
                      o.example ? "Example organization" : null,
                      o.former_slugs?.length ? `formerly ${o.former_slugs.join(", ")}` : null,
                      plural(o.people, "person", "people"),
                      `started by ${o.created_by.display_name}, ${formatDate(o.created_at)}`,
                      o.today.writes ? `${plural(o.today.writes, "write")} today, ${formatBytes(o.today.bytes)} uploaded` : null,
                      changed ? `${plural(changed, "limit")} changed` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </>
                }
                end={
                  <span className="instance-row-end">
                    <StatusBadge tone={o.plan === "free" ? "neutral" : "positive"}>{PLAN_WORDS[o.plan]}</StatusBadge>
                    <Button size="sm" variant="quiet" onClick={() => setRenamingSlug(o.slug)} aria-label={`Rename ${o.name}`}>
                      Rename
                    </Button>
                    <ButtonLink size="sm" variant="quiet" to={`/instance?org=${encodeURIComponent(o.slug)}`} aria-label={`Plan and limits of ${o.name}`}>
                      Plan and limits <Glyph name="chevron-right" size="sm" />
                    </ButtonLink>
                  </span>
                }
              />
            );
          })}
        </div>
      )}
      {editing && q.data ? <PlanDialog key={editing.slug} org={editing} all={q.data} onClose={close} /> : null}
      {renaming ? <RenameDialog org={renaming} onClose={() => setRenamingSlug(null)} /> : null}
    </Sheet>
  );
}

/**
 * Rename an organization or change its short name in links, as an owner of this WhatBuild may for
 * any of them. Links with a short name it had before still lead to it. `org` is the list's current
 * row, so a stale name etag is read again by refreshing the list.
 */
function RenameDialog({ org, onClose }: { org: InstanceOrganization; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState(org.name);
  const [slug, setSlug] = useState(org.slug);
  const renamed = name.trim() !== org.name;
  const moved = slug !== org.slug;
  const slugError = moved ? slugProblem(slug) : null;
  const valid = (renamed || moved) && Boolean(name.trim()) && !slugError;
  const save = useMutation({
    mutationFn: () =>
      api<{ name: string; slug: string }>("PATCH", `/api/v1/tenants/${encodeURIComponent(org.slug)}`, {
        ...(renamed ? { name: name.trim() } : {}),
        ...(moved ? { slug } : {}),
        expected_etag: org.name_etag,
      }),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ["instance-organizations"] });
      void qc.invalidateQueries({ queryKey: ["products"] });
      void qc.invalidateQueries({ queryKey: ["limits"] });
      toast(moved ? `${r.name}’s links now begin /t/${r.slug}/, and links with ${org.slug} still lead there.` : `${org.name} is now ${r.name}.`);
      onClose();
    },
  });
  return (
    <Dialog
      open
      onClose={onClose}
      dismissable={!save.isPending}
      title={`Rename ${org.name}`}
      description="Links with its current short name keep leading to it after a change, and connected agents keep working. Its access log records the change."
      footer={
        <>
          <Button onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button variant="primary" busy={save.isPending} busyLabel="Saving…" disabled={!valid} onClick={() => save.mutate()}>
            Save
          </Button>
        </>
      }
    >
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) save.mutate();
        }}
      >
        <TextField label="Name" required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
        <TextField
          label="Short name in links"
          required
          maxLength={50}
          spellCheck={false}
          autoComplete="off"
          value={slug}
          onChange={(e) => setSlug(e.target.value.toLowerCase())}
          error={slugError}
          hint={org.former_slugs?.length ? `Before: ${org.former_slugs.join(", ")}. Links with those lead here too.` : "Every product’s address begins with it."}
        />
        {save.isError ? <ErrorCallout inset error={save.error} onRetry={save.error instanceof ApiError && save.error.code === "stale_etag" ? () => void qc.invalidateQueries({ queryKey: ["instance-organizations"] }) : undefined} /> : null}
      </form>
    </Dialog>
  );
}

const PLANS: { id: Plan; label: string }[] = [
  { id: "free", label: "Free" },
  { id: "unlimited", label: "Unlimited" },
];

function PlanDialog({ org, all, onClose }: { org: InstanceOrganization; all: InstanceOrganizations; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const current = { ...all.free_limits, ...org.changed_limits };
  const [plan, setPlan] = useState<Plan>(org.plan);
  const [draft, setDraft] = useState<Record<string, number | boolean>>({});
  const value = (k: string) => (draft[k] !== undefined ? draft[k]! : current[k]!);
  const changed = Object.keys(draft).filter((k) => draft[k] !== current[k]);
  const invalid = changed.filter((k) => typeof draft[k] === "number" && (!Number.isFinite(draft[k]) || (draft[k] as number) < 0));
  const set = (k: string, v: number | boolean) => setDraft((d) => ({ ...d, [k]: v }));
  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) => api("PATCH", `${ORGS}/limits`, { tenant: org.slug, ...(org.etag ? { expected_etag: org.etag } : {}), ...body }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["instance-organizations"] });
      void qc.invalidateQueries({ queryKey: ["limits", org.slug] });
      toast(`${org.name} is ${plan === "free" ? "on the free plan" : "unlimited"}${changed.length ? `, with ${plural(changed.length, "limit")} changed` : ""}.`);
      onClose();
    },
  });
  const dirty = plan !== org.plan || changed.length > 0;
  const submit = () => save.mutate({ ...(plan !== org.plan ? { plan } : {}), ...(changed.length ? { limits: Object.fromEntries(changed.map((k) => [k, draft[k]])) } : {}) });
  return (
    <Dialog
      open
      wide
      onClose={onClose}
      dismissable={!save.isPending}
      title={`Plan and limits of ${org.name}`}
      description="Changes apply from the next call anyone makes there."
      footer={
        <>
          {Object.keys(org.changed_limits).length ? (
            <Button variant="quiet" disabled={save.isPending} onClick={() => save.mutate({ reset_limits: true, ...(plan !== org.plan ? { plan } : {}) })}>
              Back to the free plan&rsquo;s limits
            </Button>
          ) : null}
          <Button onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button variant="primary" busy={save.isPending} busyLabel="Saving…" disabled={!dirty || invalid.length > 0} onClick={submit}>
            Save
          </Button>
        </>
      }
    >
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          if (dirty && !invalid.length) submit();
        }}
      >
        <div className="limits-control">
          <Segmented label="Plan" items={PLANS} value={plan} onChange={(v) => setPlan(v as Plan)} />
          <span className="muted">{plan === "free" ? "Everyone in it meets the limits below." : "Nobody in it meets the limits below."}</span>
        </div>
        <div className="limits-scroll">
          <Table className="limits-edit" head={["Limit", "Counted over", "Value", "Free plan"]}>
            {all.limits.map((l) => (
              <Row key={l.key} label={l.label} help={l.help}>
                <Cell className="muted">{l.per}</Cell>
                <Cell className="limits-value">
                  {typeof all.free_limits[l.key] === "boolean" ? (
                    <label className="limits-switch">
                      <input type="checkbox" checked={Boolean(value(l.key))} onChange={(e) => set(l.key, e.target.checked)} />
                      <span>{value(l.key) ? "On" : "Off"}</span>
                    </label>
                  ) : BYTES.has(l.key) ? (
                    <NumberCell label={`${l.label}, ${l.per.toLowerCase()}, in MB`} suffix="MB" step={0.1} value={Number(((value(l.key) as number) / MiB).toFixed(2))} onChange={(v) => set(l.key, Math.round(v * MiB))} />
                  ) : (
                    <NumberCell label={`${l.label}, ${l.per.toLowerCase()}`} value={value(l.key) as number} onChange={(v) => set(l.key, v)} />
                  )}
                </Cell>
                <Cell label="Free plan" className="num muted">{amount(all.free_limits[l.key]!, l.unit)}</Cell>
              </Row>
            ))}
          </Table>
        </div>
        {org.limits_updated_at ? (
          <p className="faint">
            Last changed {formatDateTime(org.limits_updated_at)}
            {org.limits_updated_by ? ` by ${org.limits_updated_by.display_name}` : ""}.
          </p>
        ) : null}
        {save.isError ? <ErrorCallout inset error={save.error} onRetry={save.error instanceof ApiError && save.error.code === "stale_etag" ? () => void qc.invalidateQueries({ queryKey: ["instance-organizations"] }) : undefined} /> : null}
      </form>
    </Dialog>
  );
}

// ---- Tables ---------------------------------------------------------------------------------------

/**
 * A table that stays a table to a screen reader when a phone lays each row out as a block: the
 * roles are written out, because a browser drops them once `display` changes.
 */
function Table({ head, className = "", children }: { head: (string | { label: string; num?: boolean })[]; className?: string; children: ReactNode }) {
  return (
    <table role="table" className={`limits-table ${className}`}>
      <thead role="rowgroup">
        <tr role="row">
          {head.map((h) => {
            const col = typeof h === "string" ? { label: h, num: false } : h;
            return (
              <th key={col.label} role="columnheader" scope="col" className={col.num ? "limits-num" : undefined}>
                {col.label}
              </th>
            );
          })}
        </tr>
      </thead>
      <tbody role="rowgroup">{children}</tbody>
    </table>
  );
}

function Row({ label, help, children }: { label: string; help?: string; children: ReactNode }) {
  return (
    <tr role="row">
      <th role="rowheader" scope="row">
        {label}
        {help ? <span className="limits-help">{help}</span> : null}
      </th>
      {children}
    </tr>
  );
}

/** `label` names the cell on a phone, where the column headings are out of sight. */
function Cell({ label, num, className = "", children }: { label?: string; num?: boolean; className?: string; children: ReactNode }) {
  return (
    <td role="cell" data-label={label} className={`${num ? "limits-num num " : ""}${className}`}>
      {children}
    </td>
  );
}

function NumberCell({ label, value, onChange, suffix, step = 1 }: { label: string; value: number; onChange: (v: number) => void; suffix?: string; step?: number }) {
  return (
    <span className="limits-number">
      <input
        className="input num"
        type="number"
        inputMode={step === 1 ? "numeric" : "decimal"}
        min={0}
        step={step}
        aria-label={label}
        value={Number.isFinite(value) ? value : ""}
        onChange={(e) => onChange(e.target.value === "" ? Number.NaN : Number(e.target.value))}
      />
      {suffix ? <span className="faint">{suffix}</span> : null}
    </span>
  );
}
