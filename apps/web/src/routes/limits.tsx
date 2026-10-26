import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { useParams, useSearchParams } from "react-router";
import { api, ApiError } from "../lib/api.ts";
import { formatBytes, formatDate, formatDateTime, plural, untilTime } from "../lib/format.ts";
import { amount, PLAN_WORDS, useOrganizationLimits, type InstanceOrganization, type InstanceOrganizations, type Plan } from "../lib/limits.ts";
import { useMe } from "../lib/session.tsx";
import { usePageTitle } from "../shell/slots.tsx";
import { Button, ButtonLink, Dialog, EmptyState, ErrorCallout, Glyph, ListRow, Loading, Segmented, Sheet, SheetBody, SheetHeader, StatusBadge, useToast } from "../ui/index.tsx";
import "../styles/screens/limits.css";

const MiB = 1024 * 1024;
const BYTES = new Set(["file_max_bytes", "bytes_per_day", "org_bytes_per_day"]);

// ---- /t/:tenant/limits ----------------------------------------------------------------------------

/**
 * An organization's plan and its limits, for anyone in it: what each limit allows, what they used of
 * it today, and the limits every organization on this deployment has. Nobody changes them here: an
 * instance owner does, on the instance's page.
 */
export function LimitsPage() {
  const { tenant = "" } = useParams();
  const me = useMe();
  const q = useOrganizationLimits(tenant);
  usePageTitle("Plan and limits");
  if (q.isPending)
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
  const l = q.data;
  const guest = l.you_meet_them === "calls_per_minute_only";
  const meets = l.you_meet_them === true;
  const instanceOwner = Boolean(me.data?.tenant_allowance.instance_owner);
  const shown = guest ? l.limits.filter((x) => x.key === "requests_per_minute") : l.limits;
  const counted = shown.filter((x) => x.group !== "switch");
  const switches = shown.filter((x) => x.group === "switch");
  return (
    <>
      <Sheet labelledBy="limits-title">
        <SheetHeader
          level={1}
          id="limits-title"
          title="Plan and limits"
          count={l.organization.name}
          end={me.data?.tenant_allowance.instance_owner ? <ButtonLink to={`/instance?org=${encodeURIComponent(l.organization.slug)}`} size="sm" icon="pencil">Change plan and limits</ButtonLink> : undefined}
        />
        <SheetBody className="limits-about">
          <dl className="limits-facts">
            <div>
              <dt>Plan</dt>
              <dd>
                <StatusBadge tone={l.plan === "free" || guest ? "neutral" : "positive"}>{guest ? "Example organization" : l.plan_name}</StatusBadge>
              </dd>
            </div>
            <div>
              <dt>What it means</dt>
              <dd>
                {guest
                  ? "You can read this organization but not change it, so only the limit on calls applies to you."
                  : meets
                    ? "Everyone here meets these limits, owners included."
                    : l.organization.example
                      ? "Nobody in it meets these limits. Its readers meet only the limit on calls."
                      : "Nobody here meets these limits."}
              </dd>
            </div>
            {meets ? (
              <div>
                <dt>Daily counts</dt>
                <dd>
                  Start over at midnight UTC, <span title={formatDateTime(l.allowances_restart_at)}>{untilTime(l.allowances_restart_at)}</span>.
                </dd>
              </div>
            ) : null}
            <div>
              <dt>Changing them</dt>
              <dd className="muted">Only whoever runs this WhatBuild can change them.</dd>
            </div>
          </dl>
        </SheetBody>
      </Sheet>
      {meets || guest || instanceOwner ? (
        <Sheet labelledBy="your-limits-title">
          <SheetHeader id="your-limits-title" title={guest ? "Your limit here" : meets ? "Limits" : "Limits on the free plan"} count={shown.length} />
          <div className="limits-scroll">
            <Table head={["Limit", "Counted over", { label: "Allowed", num: true }, { label: "Used today", num: true }, "Over the limit"]}>
              {counted.map((a) => (
                <Row key={a.key} label={a.label} help={a.help}>
                  <Cell className="muted">{a.per}</Cell>
                  <Cell label="Allowed" num>{amount(a.value, a.unit)}</Cell>
                  <Cell label="Used today" num>
                    {a.used === undefined ? <NotDaily /> : a.unit === "bytes" ? formatBytes(a.used) : a.used.toLocaleString("en-US")}
                  </Cell>
                  <Cell label="Over the limit" className="limits-refusal"><code>{a.refusal}</code></Cell>
                </Row>
              ))}
              {switches.map((a) => (
                <Row key={a.key} label={a.label} help={a.help}>
                  <Cell className="muted">{a.per}</Cell>
                  <Cell label="Allowed" num>{amount(a.value, a.unit)}</Cell>
                  <Cell label="Used today" num><NotDaily /></Cell>
                  <Cell label="Over the limit" className="limits-refusal"><code>{a.refusal}</code></Cell>
                </Row>
              ))}
            </Table>
          </div>
        </Sheet>
      ) : null}
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

function DeploymentLimits({ limits }: { limits: { label: string; value: number; unit: string; set_by: string | null }[] }) {
  return (
    <Sheet labelledBy="deployment-title">
      <SheetHeader id="deployment-title" title="Limits of this deployment" count={limits.length} />
      <div className="limits-scroll">
        <Table head={["Limit", { label: "Value", num: true }, "Set by"]}>
          {limits.map((l) => (
            <Row key={l.label} label={l.label}>
              <Cell num>{l.unit === "bytes" ? formatBytes(l.value) : `${l.value.toLocaleString("en-US")} ${l.unit}`}</Cell>
              <Cell label="Set by">{l.set_by ? <code>{l.set_by}</code> : <span className="faint">The application</span>}</Cell>
            </Row>
          ))}
        </Table>
      </div>
      <p className="limits-foot">Every organization has these, whatever its plan. Where a plan&rsquo;s limit is lower, that one applies.</p>
    </Sheet>
  );
}

// ---- The instance's organizations -----------------------------------------------------------------

const ORGS = "/api/v1/organizations";

/**
 * On the instance page: every organization with its plan. Each row opens the organization's plan and
 * limits, and so does `?org=<slug>`, the address an organization's Plan and limits page links to.
 */
export function InstanceOrganizationsSheet() {
  const q = useQuery({ queryKey: ["instance-organizations"], queryFn: () => api<InstanceOrganizations>("GET", ORGS) });
  const [params, setParams] = useSearchParams();
  const items = q.data?.items ?? [];
  const editing = items.find((o) => o.slug === params.get("org")) ?? null;
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
                to={`/instance?org=${encodeURIComponent(o.slug)}`}
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
                    <span className="instance-row-open">
                      Plan and limits <Glyph name="chevron-right" size="sm" />
                    </span>
                  </span>
                }
              />
            );
          })}
        </div>
      )}
      {editing && q.data ? <PlanDialog key={editing.slug} org={editing} all={q.data} onClose={close} /> : null}
    </Sheet>
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
