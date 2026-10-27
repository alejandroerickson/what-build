import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { READ_ONLY_ALLOWS } from "@whatbuild/core/read-only";
import { useState, type ReactNode } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { api, ApiError } from "../lib/api.ts";
import { formatBytes, formatDate, formatDateTime, plural, slugProblem, untilTime } from "../lib/format.ts";
import {
  amount, anyPriced, fullness, keptLine, planWord, size, totalsInWords, useOrganizationLimits, usePlans,
  type Amount, type DeploymentLimit, type Holdings, type InstanceOrganization, type InstanceOrganizations, type LimitValue, type OrganizationLimits, type Plan, type PlanEntry, type ReadOnly,
} from "../lib/limits.ts";
import { useMe, useProducts } from "../lib/session.tsx";
import { usePageTitle } from "../shell/slots.tsx";
import { Button, ButtonLink, Callout, ChoiceRow, Dialog, EmptyState, ErrorCallout, Glyph, ListRow, Loading, Sheet, SheetBody, SheetHeader, StatusBadge, TextField, useToast } from "../ui/index.tsx";
import { NotVisible } from "./auth.tsx";
import { OrganizationDeleteDialog } from "./org.tsx";
import { PlanComparison } from "./plan-comparison.tsx";
import { PrivacyLink } from "../shell/privacy-link.tsx";
import "../styles/screens/limits.css";

// ---- /t/:tenant/plan ------------------------------------------------------------------------------

/**
 * An organization's plan: what it is, what the organization holds against the plan's totals, each
 * person's daily allowances with what they used today, and the plans side by side. Limits belong to
 * plans, so nobody changes one here: an owner of this WhatBuild moves the organization to another
 * plan, on the instance's page, and sees every limit with the refusal a call over it gets.
 */
export function PlanPage() {
  const { tenant = "" } = useParams();
  const me = useMe();
  const q = useOrganizationLimits(tenant);
  // An organization the person can't see answers as one that doesn't exist, and so does this page.
  const notVisible = q.error instanceof ApiError && q.error.status === 404;
  usePageTitle(notVisible ? null : "Plan");
  if (notVisible) return <NotVisible what="organization" />;
  if (q.isPending || me.isPending)
    return (
      <Sheet label="Loading the plan">
        <Loading label="Loading the plan…" lines={4} />
      </Sheet>
    );
  if (q.isError)
    return (
      <Sheet labelledBy="plan-missing">
        <SheetHeader level={1} id="plan-missing" title="The plan couldn’t be loaded" />
        <SheetBody>
          <ErrorCallout inset error={q.error} onRetry={() => q.refetch()} />
        </SheetBody>
      </Sheet>
    );
  const l = q.data;
  const owner = Boolean(me.data?.tenant_allowance.instance_owner);
  const guest = l.you_meet_them === "calls_per_minute_only";
  return (
    <>
      <PlanSummary l={l} owner={owner} />
      {l.holds ? <Holds l={l} holds={l.holds} /> : null}
      {l.you_meet_them === true ? <Today l={l} /> : null}
      {guest || l.read_only ? null : <WhatYouAdd l={l} />}
      {owner ? <EveryLimit l={l} /> : null}
      {owner ? <DeploymentLimits limits={l.deployment_limits} /> : null}
      <ComparePlans l={l} />
    </>
  );
}

/** Kept for the address the page had before plans set every limit. */
export const LimitsPage = PlanPage;

/** The plan in a line, what it means for the people in the organization, and how to move to another. */
function PlanSummary({ l, owner }: { l: OrganizationLimits; owner: boolean }) {
  const plans = usePlans();
  const guest = l.you_meet_them === "calls_per_minute_only";
  const entry = l.plans.find((p) => p.id === l.plan);
  const contact = plans.data?.contact ?? null;
  const org = l.organization.name;
  const offered = l.plans.length > 0;
  const start = plans.data?.starting_plan;
  const startName = start ? planWord(start, l.plans) : "";
  const ask = contact ? <>write to <Contact to={contact} /></> : "ask whoever runs this WhatBuild";
  return (
    <Sheet labelledBy="plan-title">
      <SheetHeader
        level={1}
        id="plan-title"
        title="Plan"
        count={org}
        end={
          owner && offered ? (
            <ButtonLink to={`/instance?org=${encodeURIComponent(l.organization.slug)}`} size="sm" icon="pencil">
              Change plan
            </ButtonLink>
          ) : null
        }
      />
      <SheetBody className="plan-summary">
        {guest ? (
          <p>This is the example organization. You can read it but not change it, so its plan sets nothing for you but how often you can call.</p>
        ) : (
          <>
            <p className="plan-line">
              <span className="plan-word">{l.plan_name}</span>
              {l.read_only ? <StatusBadge tone="attention">Read-only</StatusBadge> : entry?.price ? <span className="plan-price">{entry.price}</span> : null}
            </p>
            {l.read_only ? (
              <Callout tone="attention" title={keptLine(l.read_only)}>
                {org} went back to the {startName} plan while whoever started it already has a {startName} organization, so nothing new can be added.{" "}
                {READ_ONLY_ALLOWS} To work in it again, {ask} to move it to another plan.
              </Callout>
            ) : (
              <p>
                {l.undefined_plan
                  ? `${org} is on a plan this WhatBuild no longer defines, so no limit applies until whoever runs it moves ${org} to another.`
                  : l.plan === "unlimited"
                    ? `${org} has no limits: nobody in it meets any.${offered ? " This plan is for this WhatBuild’s own organizations." : ""}`
                    : `${l.plan_about} Everyone in ${org} meets its limits, owners and their agents included.`}
              </p>
            )}
            {offered && l.plan === start && !owner && !l.read_only && l.plans.length > 1 ? (
              <p className="muted">
                To move {org} to another plan, {ask}. Each organization has a plan of its own{anyPriced(l.plans) ? ", billed on its own" : ""}.
              </p>
            ) : null}
            {offered ? (
              <p className="faint plan-visibility">
                <Glyph name="info" size="sm" />
                <span>
                  {org}&rsquo;s name and plan, and the name and email of everyone in it, are visible to whoever runs this WhatBuild, who uses them to{" "}
                  {anyPriced(l.plans) ? "bill the organization and to " : ""}write to its people. <PrivacyLink />
                </span>
              </p>
            ) : null}
          </>
        )}
      </SheetBody>
    </Sheet>
  );
}

/** A contact as the deployment gives it: an address to write to, or a page. */
function Contact({ to }: { to: string }) {
  if (/^[^\s@]+@[^\s@]+$/.test(to)) return <a href={`mailto:${to}`}>{to}</a>;
  if (/^https?:\/\//.test(to)) return <a href={to} target="_blank" rel="noreferrer">{to}</a>;
  return <>{to}</>;
}

const value = (l: OrganizationLimits, key: string): Amount => l.limits.find((x) => x.key === key)?.value ?? null;

/** What the organization holds against the plan's totals: how full each is, and how to make room. */
function Holds({ l, holds }: { l: OrganizationLimits; holds: Holdings }) {
  const s = holds.storage;
  const rows = [
    {
      label: "People",
      used: holds.members + holds.invited,
      limit: value(l, "members_max"),
      unit: "",
      note: holds.invited ? `Counts ${plural(holds.invited, "invitation")} not yet accepted. Readers of the Story don’t count.` : "Readers of the Story don’t count.",
    },
    { label: "Products", used: holds.products, limit: value(l, "products_max"), unit: "", note: "Archived ones don’t count." },
    { label: "Sources", used: holds.sources, limit: value(l, "sources_max"), unit: "", note: "Archived ones don’t count." },
    {
      label: "Storage",
      used: s.total,
      limit: value(l, "storage_max_bytes"),
      unit: "bytes",
      note: `${size(s.files)} of files (attachments, the text read from each, kept as a file of its own, and prototypes), ${size(s.text)} of text. Archiving keeps it; deleting frees it.`,
    },
  ];
  return (
    <Sheet labelledBy="holds-title">
      <SheetHeader id="holds-title" title={`What ${l.organization.name} holds`} />
      <ul className="limits-allowances">
        {rows.map((r) => (
          <Meter key={r.label} {...r} />
        ))}
      </ul>
    </Sheet>
  );
}

/** One total or allowance: what is used of it, as words and a bar, and a mark and word as it fills. */
function Meter({ label, used, limit, unit, note }: { label: string; used: number; limit: Amount; unit: string; note?: string }) {
  const f = fullness(used, limit);
  const show = (n: number) => (unit === "bytes" ? (n > 0 ? size(n) : "0 MB") : n.toLocaleString("en-US"));
  const off = limit === 0;
  return (
    <li className="limits-allowance">
      <span className="limits-allowance-what">
        <span className="limits-allowance-name">{label}</span>
        {note ? <span className="limits-help">{note}</span> : null}
      </span>
      {off ? (
        <span className="muted">Off on this plan</span>
      ) : (
        <span className="limits-allowance-used">
          <span className="limits-allowance-count">
            <span className="num">
              {show(used)} {typeof limit === "number" ? <>of {show(limit)}</> : <span className="faint">· no limit</span>}
            </span>
            {f === "full" ? <StatusBadge tone="attention">Full</StatusBadge> : f === "near" ? <StatusBadge tone="neutral">Nearly full</StatusBadge> : null}
          </span>
          {typeof limit === "number" ? (
            <span className="limits-bar" data-state={f} aria-hidden="true">
              <span style={{ width: `${Math.min(1, used / limit) * 100}%` }} />
            </span>
          ) : null}
        </span>
      )}
    </li>
  );
}

/** The daily allowances, in the order a person meets them and named as what they do: theirs, then everyone's together. */
const YOURS = [
  { key: "writes_per_day", label: "Changes" },
  { key: "sources_per_day", label: "Sources added" },
  { key: "bytes_per_day", label: "Files uploaded" },
  { key: "sent_bytes_per_day", label: "Data sent to you", note: "Attachments, exports and downloads opened. An export is always sent." },
  { key: "exports_per_day", label: "Exports" },
];
const EVERYONES = [
  { key: "org_writes_per_day", label: "Changes" },
  { key: "org_bytes_per_day", label: "Files uploaded" },
];

function Today({ l }: { l: OrganizationLimits }) {
  const pick = (list: { key: string; label: string; note?: string }[]) => list.flatMap((a) => l.limits.filter((x) => x.key === a.key).map((limit) => ({ ...a, limit })));
  const groups = [
    { id: "today-yours", title: "You", items: pick(YOURS) },
    { id: "today-everyone", title: `Everyone in ${l.organization.name}`, items: pick(EVERYONES) },
  ].filter((g) => g.items.length);
  return (
    <Sheet labelledBy="today-title">
      <SheetHeader
        id="today-title"
        title="Today"
        end={
          <span className="faint limits-restart" title={formatDateTime(l.allowances_restart_at)}>
            Starts over at midnight UTC, {untilTime(l.allowances_restart_at)}
          </span>
        }
      />
      {groups.map((g) => (
        <section key={g.id} className="limits-group" aria-labelledby={g.id}>
          <h3 id={g.id} className="limits-group-label">
            {g.title}
          </h3>
          <ul className="limits-allowances">
            {g.items.map((a) => (
              <Meter key={a.key} label={a.label} note={a.note} used={a.limit.used ?? 0} limit={a.limit.value} unit={a.limit.unit} />
            ))}
          </ul>
        </section>
      ))}
    </Sheet>
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
  const fileMax = Math.min(...[deployment("file_max_bytes"), deployment("relay_max_bytes"), planned("file_max_bytes")].filter((v): v is number => typeof v === "number"));
  const readCap = deployment("parse_cap_bytes");
  const attachments = deployment("attachments_per_source");
  const mockups = deployment("mockups_per_product");
  const pages = deployment("story_pages_per_product");
  const lines = [
    Number.isFinite(fileMax) ? `Files up to ${size(fileMax)} each.` : null,
    readCap !== undefined && readCap < fileMax ? `Text is read from files up to ${size(readCap)}; a larger file is kept but not read.` : null,
    attachments !== undefined ? `Up to ${attachments.toLocaleString("en-US")} attachments on a source.` : null,
    mockups !== undefined && pages !== undefined ? `Up to ${mockups.toLocaleString("en-US")} mockups and ${pages.toLocaleString("en-US")} Story pages in a product.` : null,
    planned("documents_only") === true ? "Files must be ones WhatBuild reads: text, Markdown, transcripts, HTML, Word, PDF, spreadsheets or XML. Pro keeps recordings, images and any other file too." : null,
    planned("fetch_url") === false ? "Adding a file from a link is off on this plan." : null,
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

/** The plans side by side, this organization's marked. */
function ComparePlans({ l }: { l: OrganizationLimits }) {
  const plans = usePlans();
  if (!l.plans.length) return null;
  return (
    <Sheet labelledBy="compare-title">
      <SheetHeader id="compare-title" title="Plans" />
      <PlanComparison plans={l.plans} limits={l.limits} fileMaxBytes={plans.data?.file_max_bytes ?? Number.POSITIVE_INFINITY} current={l.plan} />
    </Sheet>
  );
}

/**
 * For an owner of this WhatBuild: every limit of the organization's plan with what is used of it and
 * the refusal a call over it gets.
 */
function EveryLimit({ l }: { l: OrganizationLimits }) {
  const counted = l.limits.some((x) => x.used !== undefined);
  return (
    <Sheet labelledBy="every-limit-title">
      <SheetHeader id="every-limit-title" title={l.plan === "unlimited" ? "Limits (none on this plan)" : `Limits of the ${l.plan_name} plan`} count={l.limits.length} />
      <div className="limits-scroll">
        <Table head={["Limit", "Counted over", { label: "Allowed", num: true }, ...(counted ? [{ label: "Used", num: true }] : []), "Over the limit"]}>
          {l.limits.map((a: LimitValue) => (
            <Row key={a.key} label={a.label} help={a.help}>
              <Cell className="muted">{a.per}</Cell>
              <Cell label="Allowed" num>{l.plan === "unlimited" ? <span className="faint">None</span> : amount(a.value, a.unit)}</Cell>
              {counted ? (
                <Cell label="Used" num>
                  {a.used === undefined ? <NotCounted /> : a.unit === "bytes" ? formatBytes(a.used) : a.used.toLocaleString("en-US")}
                </Cell>
              ) : null}
              <Cell label="Over the limit" className="limits-refusal"><code>{a.refusal}</code></Cell>
            </Row>
          ))}
        </Table>
      </div>
    </Sheet>
  );
}

function NotCounted() {
  return (
    <span className="faint" title="Not counted">
      <span aria-hidden="true">–</span>
      <span className="visually-hidden">Not counted</span>
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

/** What an organization holds, in a line: the numbers its plan's totals count. */
function heldLine(h: Holdings) {
  return [plural(h.members, "person", "people") + (h.invited ? ` (+${h.invited} invited)` : ""), plural(h.products, "product"), plural(h.sources, "source"), size(h.storage.total)].join(" · ");
}

/**
 * On the instance page: every organization with its plan and what it holds. Each row renames the
 * organization, and moves it to another plan, as `?org=<slug>` does, the address an organization's
 * Plan page links to.
 */
export function InstanceOrganizationsSheet() {
  const q = useQuery({ queryKey: ["instance-organizations"], queryFn: () => api<InstanceOrganizations>("GET", ORGS) });
  // Its Plan page opens only for its own people: the others' names link nowhere.
  const mine = new Set(useProducts().data?.tenants.map((t) => t.slug));
  const [params, setParams] = useSearchParams();
  const [renamingSlug, setRenamingSlug] = useState<string | null>(null);
  const [deletingSlug, setDeletingSlug] = useState<string | null>(null);
  const items = q.data?.items ?? [];
  const editing = items.find((o) => o.slug === params.get("org")) ?? null;
  const renaming = items.find((o) => o.slug === renamingSlug) ?? null;
  const deleting = items.find((o) => o.slug === deletingSlug) ?? null;
  const close = () =>
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        next.delete("org");
        return next;
      },
      { replace: true },
    );
  const offered = Boolean(q.data?.plans.length);
  const start = q.data?.new_organization_plan;
  const starts = q.data && start ? planWord(start, q.data.plan_names) : null;
  return (
    <Sheet labelledBy="organizations-title">
      <SheetHeader level={1} id="organizations-title" title="Organizations" count={q.data ? items.length : undefined} />
      <SheetBody className="instance-intro">
        <p className="muted">
          {!q.data
            ? null
            : !offered
              ? "This WhatBuild offers no plans, so every organization is Unlimited."
              : `Each organization is on a plan of its own. New ones start on ${start === "unlimited" ? "no plan’s limits (Unlimited)" : `the ${starts} plan`}, except ones an owner of this WhatBuild starts, which are Unlimited.`}
          {offered && start !== "unlimited"
            ? ` Each person has one ${starts} organization: moving it to another plan lets them start another, and one moved back while they have another is read-only for a year.`
            : null}
        </p>
        <p className="faint">
          The plans, and the one new organizations start on, are set where the service is deployed: <code>WHATBUILD_PLANS</code> and{" "}
          <code>WHATBUILD_NEW_ORGANIZATION_PLAN</code>.
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
          {items.map((o) => (
            <ListRow
              key={o.slug}
              className="instance-row"
              title={
                <>
                  {mine.has(o.slug) ? (
                    <Link to={`/t/${encodeURIComponent(o.slug)}/plan`} className="instance-row-link">
                      {o.name}
                    </Link>
                  ) : (
                    o.name
                  )}
                  <span className="muted"> · {o.slug}</span>
                </>
              }
              sub={
                <>
                  {[
                    o.example ? "Example organization" : null,
                    o.read_only ? keptLine(o.read_only) : null,
                    heldLine(o.holds),
                    o.former_slugs?.length ? `formerly ${o.former_slugs.join(", ")}` : null,
                    `started by ${o.created_by.display_name}, ${formatDate(o.created_at)}`,
                    o.today.writes ? `${plural(o.today.writes, "write")} today` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </>
              }
              end={
                <span className="instance-row-end">
                  {o.read_only ? <StatusBadge tone="attention">Read-only</StatusBadge> : null}
                  {o.undefined_plan ? <StatusBadge tone="attention">Plan no longer defined</StatusBadge> : null}
                  {offered ? <StatusBadge tone={o.plan === start ? "neutral" : "positive"}>{planWord(o.plan, q.data?.plan_names)}</StatusBadge> : null}
                  <Button size="sm" variant="quiet" onClick={() => setRenamingSlug(o.slug)} aria-label={`Rename ${o.name}`}>
                    Rename
                  </Button>
                  {offered ? (
                    <ButtonLink size="sm" variant="quiet" to={`/instance?org=${encodeURIComponent(o.slug)}`} aria-label={`Change the plan of ${o.name}`}>
                      Change plan
                    </ButtonLink>
                  ) : null}
                  {o.example ? null : (
                    <Button size="sm" variant="quiet" onClick={() => setDeletingSlug(o.slug)} aria-label={`Delete ${o.name}`}>
                      Delete
                    </Button>
                  )}
                </span>
              }
            />
          ))}
        </div>
      )}
      {editing && q.data ? <PlanDialog key={editing.slug} org={editing} all={q.data} onClose={close} /> : null}
      {renaming ? <RenameDialog org={renaming} onClose={() => setRenamingSlug(null)} /> : null}
      {deleting ? <OrganizationDeleteDialog tenant={deleting.slug} orgName={deleting.name} tellsOwners onClose={() => setDeletingSlug(null)} /> : null}
    </Sheet>
  );
}

/**
 * On the instance page: the plans this WhatBuild offers, side by side, each with **Edit** to change
 * its limits and price for every organization on it. Limits belong to plans, never to one
 * organization.
 */
export function InstancePlansSheet() {
  const q = usePlans();
  const orgs = useQuery({ queryKey: ["instance-organizations"], queryFn: () => api<InstanceOrganizations>("GET", ORGS) });
  const [editing, setEditing] = useState<string | null>(null);
  return (
    <Sheet labelledBy="instance-plans-title">
      <SheetHeader
        level={2}
        id="instance-plans-title"
        title="Plans"
        count={q.data ? q.data.plans.length : undefined}
        end={
          orgs.data ? (
            <span className="instance-row-end">
              {orgs.data.plans.map((p) => (
                <Button key={p.id} size="sm" icon="pencil" onClick={() => setEditing(p.id)} aria-label={`Edit the ${p.name} plan`}>
                  {p.name}
                </Button>
              ))}
            </span>
          ) : null
        }
      />
      <SheetBody className="instance-intro">
        <p className="muted">
          Limits belong to plans, never to one organization: raise a plan&rsquo;s as WhatBuild grows, and move an organization to another plan to change what it may do.
          Unlimited, for this WhatBuild&rsquo;s own organizations, is never offered.
        </p>
      </SheetBody>
      {q.isPending ? (
        <Loading label="Loading plans…" lines={3} />
      ) : q.isError ? (
        <SheetBody>
          <ErrorCallout inset error={q.error} onRetry={() => q.refetch()} />
        </SheetBody>
      ) : (
        <PlanComparison plans={q.data.plans} limits={q.data.limits} fileMaxBytes={q.data.file_max_bytes} />
      )}
      {editing && orgs.data ? <PlanLimitsDialog key={editing} plan={editing} all={orgs.data} onClose={() => setEditing(null)} /> : null}
    </Sheet>
  );
}

const MiB = 1024 * 1024;

/** A limit's value in a field: bytes as MB, switches as on or off, a total or bytes sent possibly no limit. */
function LimitField({ limit, value, onChange }: { limit: { key: string; label: string; unit: string; group: string; per: string }; value: Amount; onChange: (v: Amount) => void }) {
  const nullable = limit.group === "total" || limit.key === "sent_bytes_per_day";
  if (limit.group === "switch")
    return (
      <label className="limits-switch">
        <input type="checkbox" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} />
        <span>{value ? "On" : "Off"}</span>
      </label>
    );
  const bytes = limit.unit === "bytes";
  const shown = typeof value === "number" ? (bytes ? Number((value / MiB).toFixed(2)) : value) : "";
  return (
    <span className="limits-number">
      <input
        className="input num"
        type="number"
        inputMode={bytes ? "decimal" : "numeric"}
        min={0}
        step={bytes ? 0.1 : 1}
        disabled={value === null}
        aria-label={`${limit.label}, ${limit.per.toLowerCase()}${bytes ? ", in MB" : ""}`}
        value={shown}
        onChange={(e) => onChange(e.target.value === "" ? Number.NaN : bytes ? Math.round(Number(e.target.value) * MiB) : Number(e.target.value))}
      />
      {bytes ? <span className="faint">MB</span> : null}
      {nullable ? (
        <label className="limits-switch limits-nolimit">
          <input type="checkbox" checked={value === null} onChange={(e) => onChange(e.target.checked ? null : 0)} />
          <span>No limit</span>
        </label>
      ) : null}
    </span>
  );
}

const valid = (v: Amount) => v === null || typeof v === "boolean" || (Number.isFinite(v) && v >= 0);

/** Change a plan's limits and price, for every organization on it, from the next call. */
function PlanLimitsDialog({ plan, all, onClose }: { plan: string; all: InstanceOrganizations; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const entry = all.plans.find((p) => p.id === plan)!;
  const record = all.plan_records[plan] ?? { etag: null, updated_at: null, updated_by: null, changed: {} };
  const defaults = all.plan_defaults[plan] ?? {};
  const [draft, setDraft] = useState<Record<string, Amount>>({});
  const [price, setPrice] = useState(entry.price ?? "");
  const value = (k: string): Amount => (k in draft ? draft[k]! : (entry.limits[k] ?? null));
  const changed = Object.keys(draft).filter((k) => draft[k] !== entry.limits[k]);
  const invalid = changed.some((k) => !valid(draft[k]!));
  const priceChanged = price.trim() !== (entry.price ?? "");
  const dirty = changed.length > 0 || priceChanged;
  const onPlan = all.items.filter((o) => o.plan === plan).length;
  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) => api("PATCH", "/api/v1/plans", { plan, ...(record.etag ? { expected_etag: record.etag } : {}), ...body }),
    onSuccess: () => {
      for (const key of [["instance-organizations"], ["plans"], ["limits"]]) void qc.invalidateQueries({ queryKey: key });
      toast(`The ${entry.name} plan is changed, for ${plural(onPlan, "organization")} on it.`);
      onClose();
    },
  });
  const submit = () =>
    save.mutate({
      ...(changed.length ? { limits: Object.fromEntries(changed.map((k) => [k, draft[k]])) } : {}),
      ...(priceChanged ? { price: price.trim() || null } : {}),
    });
  return (
    <Dialog
      open
      wide
      onClose={onClose}
      dismissable={!save.isPending}
      title={`The ${entry.name} plan`}
      description={`A change applies from the next call to every organization on it: ${plural(onPlan, "organization")} now. An organization already past a new total keeps what it has.`}
      footer={
        <>
          {Object.keys(record.changed).length || record.etag ? (
            <Button variant="quiet" disabled={save.isPending} onClick={() => save.mutate({ reset: true })}>
              Back to the configured limits
            </Button>
          ) : null}
          <Button onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button variant="primary" busy={save.isPending} busyLabel="Saving…" disabled={!dirty || invalid} onClick={submit}>
            Save
          </Button>
        </>
      }
    >
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          if (dirty && !invalid) submit();
        }}
      >
        <TextField label="Price" optional maxLength={60} value={price} onChange={(e) => setPrice(e.target.value)} hint="As people read it on the plans pages, such as “$20 a month”. Empty shows none. Nothing takes payment." />
        <div className="limits-scroll">
          <Table className="limits-edit" head={["Limit", "Counted over", "Value", "Default"]}>
            {all.limits.map((l) => (
              <Row key={l.key} label={l.label} help={l.help}>
                <Cell className="muted">{l.per}</Cell>
                <Cell className="limits-value">
                  <LimitField limit={l} value={value(l.key)} onChange={(v) => setDraft((d) => ({ ...d, [l.key]: v }))} />
                </Cell>
                <Cell label="Default" className="num muted">{amount(defaults[l.key] ?? null, l.unit)}</Cell>
              </Row>
            ))}
          </Table>
        </div>
        {record.updated_at ? (
          <p className="faint">
            Last changed {formatDateTime(record.updated_at)}
            {record.updated_by ? ` by ${record.updated_by.display_name}` : ""}.
          </p>
        ) : null}
        {save.isError ? <ErrorCallout inset error={save.error} onRetry={save.error instanceof ApiError && save.error.code === "stale_etag" ? () => void qc.invalidateQueries({ queryKey: ["instance-organizations"] }) : undefined} /> : null}
      </form>
    </Dialog>
  );
}

/** The guests' settings and how many are in, as the instance's owners read them: `products.guests`. */
interface GuestsView {
  settings: Record<string, number | boolean>;
  defaults: Record<string, number | boolean>;
  fields: { key: string; label: string; unit: "switch" | "guests" | "minutes" | "calls" | "bytes"; help: string }[];
  etag: string | null;
  updated_at: string | null;
  updated_by: { display_name: string } | null;
  now: { in_now: number; waiting: number; new_today: number; ever: number };
}

/**
 * On the instance page: guests, the accounts in no organization that read the example
 * organization. How many are in, waiting and new today, and every setting that lets them in and
 * holds them, to raise as WhatBuild grows.
 */
export function InstanceGuestsSheet() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ["instance-guests"], queryFn: () => api<GuestsView>("GET", "/api/v1/guests"), refetchInterval: 30_000 });
  const [draft, setDraft] = useState<Record<string, number | boolean>>({});
  const value = (k: string) => (k in draft ? draft[k]! : q.data!.settings[k]!);
  const changed = q.data ? Object.keys(draft).filter((k) => draft[k] !== q.data!.settings[k]) : [];
  const invalid = changed.some((k) => typeof draft[k] === "number" && !(Number.isFinite(draft[k]) && (draft[k] as number) >= 0));
  const save = useMutation({
    mutationFn: () => api("PATCH", "/api/v1/guests", { ...Object.fromEntries(changed.map((k) => [k, draft[k]])), ...(q.data?.etag ? { expected_etag: q.data.etag } : {}) }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["instance-guests"] });
      void qc.invalidateQueries({ queryKey: ["plans"] });
      setDraft({});
      toast("The guests’ settings are saved. They apply from the next call.");
    },
  });
  const s = q.data?.settings;
  return (
    <Sheet labelledBy="instance-guests-title">
      <SheetHeader
        level={2}
        id="instance-guests-title"
        title="Guests"
        end={s ? <StatusBadge tone={s["at_once"] === 0 ? "neutral" : s["self_serve"] ? "positive" : "neutral"}>{s["at_once"] === 0 ? "Closed" : s["self_serve"] ? "Anyone can sign up" : "Invited only"}</StatusBadge> : null}
      />
      <SheetBody className="instance-intro">
        <p className="muted">
          A guest is an account in no organization: they read the example organization, and point their agent at it, and nothing else. Each holds a place while they
          work; past the places, they wait in line and come in on their own. People in an organization never wait.
        </p>
        {q.data ? (
          <dl className="guests-now">
            <div>
              <dt>In now</dt>
              <dd className="num">
                {q.data.now.in_now} <span className="faint">of {String(s!["at_once"])}</span>
              </dd>
            </div>
            <div>
              <dt>Waiting</dt>
              <dd className="num">{q.data.now.waiting}</dd>
            </div>
            <div>
              <dt>New today</dt>
              <dd className="num">
                {q.data.now.new_today} <span className="faint">of {String(s!["new_per_day"])}</span>
              </dd>
            </div>
            <div>
              <dt>Ever</dt>
              <dd className="num">{q.data.now.ever}</dd>
            </div>
          </dl>
        ) : null}
      </SheetBody>
      {q.isPending ? (
        <Loading label="Loading guests…" lines={3} />
      ) : q.isError ? (
        <SheetBody>
          <ErrorCallout inset error={q.error} onRetry={() => q.refetch()} />
        </SheetBody>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (changed.length && !invalid) save.mutate();
          }}
        >
          <div className="limits-scroll">
            <Table className="limits-edit" head={["Setting", "Value", "Default"]}>
              {q.data.fields.map((f) => (
                <Row key={f.key} label={f.label} help={f.help}>
                  <Cell className="limits-value">
                    <LimitField
                      limit={{ key: f.key, label: f.label, unit: f.unit === "bytes" ? "bytes" : f.unit, group: f.unit === "switch" ? "switch" : "frequency", per: f.unit === "switch" ? "" : f.unit }}
                      value={value(f.key)}
                      onChange={(v) => setDraft((d) => ({ ...d, [f.key]: v as number | boolean }))}
                    />
                  </Cell>
                  <Cell label="Default" className="num muted">
                    {f.unit === "switch" ? (q.data.defaults[f.key] ? "On" : "Off") : f.unit === "bytes" ? size(q.data.defaults[f.key] as number) : `${String(q.data.defaults[f.key])} ${f.unit}`}
                  </Cell>
                </Row>
              ))}
            </Table>
          </div>
          <div className="guests-actions">
            {q.data.updated_at ? (
              <span className="faint">
                Last changed {formatDateTime(q.data.updated_at)}
                {q.data.updated_by ? ` by ${q.data.updated_by.display_name}` : ""}.
              </span>
            ) : null}
            {changed.length ? (
              <Button type="button" variant="quiet" onClick={() => setDraft({})} disabled={save.isPending}>
                Undo changes
              </Button>
            ) : null}
            <Button type="submit" variant="primary" busy={save.isPending} busyLabel="Saving…" disabled={!changed.length || invalid}>
              Save
            </Button>
          </div>
          {save.isError ? (
            <SheetBody>
              <ErrorCallout inset error={save.error} onRetry={save.error instanceof ApiError && save.error.code === "stale_etag" ? () => void qc.invalidateQueries({ queryKey: ["instance-guests"] }) : undefined} />
            </SheetBody>
          ) : null}
        </form>
      )}
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

/** What an organization holds past a plan's totals, if it moved there now. */
function overOn(h: Holdings, p: PlanEntry | undefined): string[] {
  if (!p) return [];
  const over = (used: number, k: string, words: (n: number) => string) => {
    const v = p.limits[k];
    return typeof v === "number" && used > v ? `${words(used)}, where ${p.name} allows ${words(v)}` : null;
  };
  return [
    over(h.members + h.invited, "members_max", (n) => plural(n, "person", "people")),
    over(h.products, "products_max", (n) => plural(n, "product")),
    over(h.sources, "sources_max", (n) => plural(n, "source")),
    over(h.storage.total, "storage_max_bytes", (n) => size(n)),
  ].filter((x): x is string => Boolean(x));
}

/** Move an organization to another plan. Limits belong to plans, so there is nothing else to set. */
function PlanDialog({ org, all, onClose }: { org: InstanceOrganization; all: InstanceOrganizations; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [plan, setPlan] = useState<Plan>(org.plan);
  const choices: Plan[] = [...all.plans.map((p) => p.id), "unlimited"];
  const entry = (id: Plan) => all.plans.find((p) => p.id === id);
  const start = all.new_organization_plan;
  const startName = planWord(start, all.plan_names);
  // The starting plan is read-only instead when whoever started it has no room there for it.
  const readOnly = plan === start && Boolean(org.starting_plan_is_read_only);
  const over = plan === "unlimited" || readOnly ? [] : overOn(org.holds, entry(plan));
  const save = useMutation({
    mutationFn: () => api<{ read_only?: ReadOnly; owners_notified: number }>("PATCH", `${ORGS}/plan`, { tenant: org.slug, plan, ...(org.etag ? { expected_etag: org.etag } : {}) }),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ["instance-organizations"] });
      void qc.invalidateQueries({ queryKey: ["limits", org.slug] });
      void qc.invalidateQueries({ queryKey: ["products"] });
      // A move on or off the starting plan frees or takes its creator's place.
      void qc.invalidateQueries({ queryKey: ["tenant-allowances"] });
      void qc.invalidateQueries({ queryKey: ["me"] });
      toast(
        r.read_only
          ? `${org.name} is read-only. ${keptLine(r.read_only)}.${r.owners_notified ? ` ${r.owners_notified === 1 ? "Its owner was" : "Its owners were"} told by email.` : ""}`
          : `${org.name} is on the ${planWord(plan, all.plan_names)} plan.`,
      );
      onClose();
    },
  });
  // A read-only organization moved to the starting plan once its creator has room becomes writable.
  const writable = plan === start && Boolean(org.read_only) && !readOnly;
  const dirty = plan !== org.plan || writable;
  return (
    <Dialog
      open
      onClose={onClose}
      dismissable={!save.isPending}
      title={`Plan of ${org.name}`}
      description={`It holds ${heldLine(org.holds)}. A new plan applies from the next call anyone makes there.`}
      footer={
        <>
          <Button onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button variant="primary" busy={save.isPending} busyLabel="Saving…" disabled={!dirty} onClick={() => save.mutate()}>
            {writable ? "Make it writable" : dirty ? `Move to ${planWord(plan, all.plan_names)}` : "Save"}
          </Button>
        </>
      }
    >
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          if (dirty) save.mutate();
        }}
      >
        <fieldset className="plan-choices">
          <legend className="visually-hidden">Plan</legend>
          {choices.map((id) => (
            <ChoiceRow
              key={id}
              type="radio"
              variant="boxed"
              name="plan"
              checked={plan === id}
              onChange={() => setPlan(id)}
              label={
                <>
                  {planWord(id, all.plan_names)}
                  {entry(id)?.price ? <span className="muted"> · {entry(id)!.price}</span> : null}
                  {org.plan === id ? <span className="faint"> · {org.read_only ? "its plan now, read-only" : "its plan now"}</span> : null}
                </>
              }
              hint={id === "unlimited" ? "No limits. For this WhatBuild’s own organizations; never offered." : `${entry(id)?.about ?? ""} ${totalsInWords(entry(id))}.`}
            />
          ))}
        </fieldset>
        {org.read_only ? (
          <p className="muted">
            Read-only since {formatDate(org.read_only.since.slice(0, 10))}. {keptLine(org.read_only)}.
          </p>
        ) : null}
        {readOnly && !org.read_only ? (
          <Callout inset tone="attention" title={`${org.name} will be read-only`}>
            {org.created_by.display_name} already has a {startName} organization, with no room for another, so nothing new can be added to {org.name}. {READ_ONLY_ALLOWS} It is kept for a year, and its owners are told by email. Moving it to another plan makes it writable again.
          </Callout>
        ) : null}
        {over.length ? (
          <Callout inset tone="attention" title={`${org.name} already holds more than ${planWord(plan, all.plan_names)} allows`}>
            {over.join("; ")}. Nothing is removed: its people can still read, search, archive, delete and export, and can add more once enough is archived or deleted.
          </Callout>
        ) : null}
        {org.plan_changed_at ? (
          <p className="faint">
            Plan last changed {formatDateTime(org.plan_changed_at)}
            {org.plan_changed_by ? ` by ${org.plan_changed_by.display_name}` : ""}.
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
