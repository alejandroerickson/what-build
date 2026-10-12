import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { api, ApiError, qs } from "../lib/api.ts";
import { formatBytes, formatDate, formatDateTime, plural, untilTime } from "../lib/format.ts";
import { resetWords, useSandboxStatus, type SandboxResets, type SandboxStatus } from "../lib/public-sandbox.ts";
import { useMe, useProducts } from "../lib/session.tsx";
import { usePageTitle } from "../shell/slots.tsx";
import {
  Avatar, Button, ButtonLink, Callout, CopyField, Dialog, EmptyState, ErrorCallout, FindField, FormGrid, Loading, Segmented, Sheet, SheetBody, SheetHeader,
  StatusBadge, TextField, useToast, type StatusTone,
} from "../ui/index.tsx";
import { EntryPage } from "./auth.tsx";
import "../styles/screens/account.css";
import "../styles/screens/public-sandbox.css";

const MiB = 1024 * 1024;
const RESET_CONFIRMATION = "reset the sandbox";

type Settings = Record<string, number | boolean | string> & {
  visitor_access: "write" | "read" | "closed";
  visitor_agents: boolean;
  reset_enabled: boolean;
  reset_time: string;
  reset_timezone: string;
  max_visitors: number;
  visitor_idle_days: number;
};

interface Actor {
  display_name: string;
}

interface Baseline {
  baseline_id: string;
  in_use: boolean;
  note: string;
  created_at: string;
  created_by: Actor;
  rows: number;
  holds: { products: number; sources: number; passages: number; outcomes: number; assumptions: number; story_pages: number; mockups: number };
}

interface Limit {
  key: string;
  group: "frequency" | "size" | "switch";
  label: string;
  unit: string;
  per: string;
  refusal: string;
  help: string;
  value: number | boolean;
  default: number | boolean;
}

interface Panel {
  organization: { slug: string; name: string };
  etag: string;
  notice: string;
  settings: Settings;
  defaults: Settings;
  limits: Limit[];
  deployment_limits: { label: string; value: number; unit: string; set_by: string | null }[];
  resets: SandboxResets & { due: boolean; last: { scheduled: boolean; by: Actor; rows: number; blobs_dropped: number; visitors_removed: number } | null };
  baseline: Baseline | null;
  seats: { used: number; limit: number };
  invitations: { open: number; places_left: number };
  today: { since: string; until: string; visitors_writing: number; writes: number; sources: number; exports: number; bytes: number };
  updated_at: string | null;
  updated_by: Actor | null;
}

interface Invite {
  invite_id: string;
  label: string;
  places: number;
  used: number;
  status: "open" | "full" | "expired" | "revoked";
  expires_at: string | null;
  created_at: string;
  created_by: Actor;
}

interface Visitor {
  account_id: string;
  appears_as: string;
  display_name: string;
  email: string;
  joined_at: string;
}

function capital(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** A number as a person reads it: bytes as a size, anything else with its thousands marked. */
function amount(value: number | boolean, unit: string): string {
  if (typeof value === "boolean") return value ? "On" : "Off";
  return unit === "bytes" ? formatBytes(value) : value.toLocaleString("en-US");
}

// ---- /t/:tenant/sandbox -------------------------------------------------------------------------

/**
 * One address for everyone in a public sandbox. Its owners and admins get the control panel: every
 * switch and limit, the baseline, invitations and visitors. A visitor gets what the sandbox is and
 * what is left of each allowance.
 */
export function SandboxPage() {
  const { tenant = "" } = useParams();
  const products = useProducts();
  // An organization the person is in, and that is not a sandbox, is answered here without asking
  // the server, which would refuse with a 404 the browser logs as an error.
  const known = products.data?.tenants.find((t) => t.slug === tenant);
  const notSandbox = Boolean(known && !known.sandbox);
  const status = useSandboxStatus(tenant, !products.isPending && !notSandbox);
  usePageTitle("Public sandbox");
  if (notSandbox) return <NotASandbox />;
  if (status.isPending)
    return (
      <Sheet label="Loading the sandbox">
        <Loading label="Loading the sandbox…" lines={3} />
      </Sheet>
    );
  if (status.isError)
    return status.error instanceof ApiError && status.error.status === 404 ? (
      <NotASandbox />
    ) : (
      <Sheet labelledBy="sandbox-missing">
        <SheetHeader level={1} id="sandbox-missing" title="The sandbox couldn’t be loaded" />
        <EmptyState size="inline" action={<ButtonLink to="/">Your products</ButtonLink>}>
          {status.error instanceof Error ? status.error.message : "Reload the page to try again."}
        </EmptyState>
      </Sheet>
    );
  return status.data.you.role === "staff" ? <ControlPanel tenant={tenant} /> : <VisitorView status={status.data} />;
}

function NotASandbox() {
  return (
    <Sheet labelledBy="sandbox-missing">
      <SheetHeader level={1} id="sandbox-missing" title="This organization isn’t a public sandbox" />
      <EmptyState size="inline" action={<ButtonLink to="/">Your products</ButtonLink>} />
    </Sheet>
  );
}

function VisitorView({ status: s }: { status: SandboxStatus }) {
  const counted = s.allowances.filter((a) => typeof a.limit === "number");
  const off = s.allowances.filter((a) => typeof a.limit === "boolean");
  return (
    <>
      <Sheet labelledBy="sandbox-title">
        <SheetHeader level={1} id="sandbox-title" title="Public sandbox" count={s.organization.name} />
        <SheetBody className="sandbox-about">
          <p>{s.notice}</p>
          <dl className="sandbox-facts">
            {s.you.story_only ? (
              <div>
                <dt>You read</dt>
                <dd>
                  <b>The Story</b>
                  <span className="muted"> You write nothing here. Visitors don’t see one another’s names or emails.</span>
                </dd>
              </div>
            ) : (
              <div>
                <dt>You write as</dt>
                <dd>
                  <b>{s.you.appears_as}</b>
                  <span className="muted"> Visitors don’t see one another’s names or emails.</span>
                </dd>
              </div>
            )}
            <div>
              <dt>You can</dt>
              <dd>{s.you.can}</dd>
            </div>
            <div>
              <dt>Erased</dt>
              <dd>
                {s.resets.next_at ? (
                  <>
                    {capital(resetWords(s.resets))}. Next <span title={formatDateTime(s.resets.next_at)}>{untilTime(s.resets.next_at)}</span>.
                  </>
                ) : (
                  "Whenever its admins reset it."
                )}
              </dd>
            </div>
            {s.visitor_access !== "write" ? (
              <div>
                <dt>Right now</dt>
                <dd>
                  <StatusBadge tone="attention">{s.visitor_access === "read" ? "Visitors can only read" : "Closed to visitors"}</StatusBadge>
                </dd>
              </div>
            ) : null}
          </dl>
        </SheetBody>
      </Sheet>
      <Sheet labelledBy="allowances-title">
        <SheetHeader id="allowances-title" title="Your limits" />
        <div className="sandbox-scroll">
          <Table head={["Limit", "Counted over", { label: "Allowed", num: true }, { label: "Used today", num: true }]}>
            {counted.map((a) => (
              <Row key={a.key} label={a.label}>
                <Cell className="muted">{a.per}</Cell>
                <Cell label="Allowed" num>{a.limit === 0 ? "Off" : amount(a.limit, a.unit)}</Cell>
                <Cell label="Used today" num>{a.used === undefined ? <span className="faint" title="Not a daily limit"><span aria-hidden="true">–</span><span className="visually-hidden">Not a daily limit</span></span> : amount(a.used, a.unit)}</Cell>
              </Row>
            ))}
          </Table>
        </div>
        <p className="sandbox-foot">
          Daily counts start over at the next reset, <span title={formatDateTime(s.allowances_restart_at)}>{untilTime(s.allowances_restart_at)}</span>.
          {off.map((a) => ` ${a.label}: ${a.limit ? "on" : "off"}.`).join("")}
        </p>
      </Sheet>
    </>
  );
}

// ---- The control panel --------------------------------------------------------------------------

const ACCESS: { id: Settings["visitor_access"]; label: string }[] = [
  { id: "write", label: "Read and write" },
  { id: "read", label: "Read only" },
  { id: "closed", label: "Closed" },
];

const BYTES = new Set(["file_max_bytes", "bytes_per_day", "org_bytes_per_day"]);

function ControlPanel({ tenant }: { tenant: string }) {
  const base = `/api/v1/tenants/${tenant}/sandbox`;
  const qc = useQueryClient();
  const toast = useToast();
  const key = ["sandbox", tenant, "settings"];
  const q = useQuery({ queryKey: key, queryFn: () => api<Panel>("GET", `${base}/settings`) });
  const [draft, setDraft] = useState<Record<string, number | boolean | string>>({});
  const [resetting, setResetting] = useState<{ baseline?: Baseline } | null>(null);
  const [saving, setSaving] = useState(false);
  const refreshAll = () => void qc.invalidateQueries({ queryKey: ["sandbox", tenant] });
  const patch = useMutation({
    mutationFn: (changes: Record<string, unknown>) => api<Panel>("PATCH", `${base}/settings`, { expected_etag: q.data!.etag, ...changes }),
    onSuccess: (next) => {
      qc.setQueryData(key, next);
      void qc.invalidateQueries({ queryKey: ["sandbox", tenant, "status"] });
    },
  });
  if (q.isPending)
    return (
      <Sheet label="Loading the sandbox’s controls">
        <Loading label="Loading the sandbox’s controls…" lines={4} />
      </Sheet>
    );
  if (q.isError)
    return (
      <Sheet label="Public sandbox">
        <SheetBody>
          <ErrorCallout inset error={q.error} onRetry={() => q.refetch()} />
        </SheetBody>
      </Sheet>
    );
  const p = q.data;
  const s = p.settings;
  const value = <K extends string>(k: K) => (draft[k] !== undefined ? draft[k]! : s[k]!);
  const changed = Object.keys(draft).filter((k) => draft[k] !== s[k]);
  const invalid = changed.filter((k) => typeof draft[k] === "number" && (!Number.isFinite(draft[k]) || (draft[k] as number) < 0));
  const set = (k: string, v: number | boolean | string) => setDraft((d) => ({ ...d, [k]: v }));
  const now = (changes: Record<string, unknown>, said: string) => patch.mutate(changes, { onSuccess: () => toast(said), onError: (e) => toast(`Couldn’t change that. ${(e as Error).message}`, { tone: "negative" }) });
  const save = () =>
    patch.mutate(Object.fromEntries(changed.map((k) => [k, draft[k]])), {
      onSuccess: () => {
        setDraft({});
        toast("Saved.");
      },
    });
  const t = p.today;
  return (
    <>
      <Sheet labelledBy="sandbox-title">
        <SheetHeader
          level={1}
          id="sandbox-title"
          title="Public sandbox"
          count={p.organization.name}
          end={
            <>
              <Button icon="download" onClick={() => setSaving(true)}>
                Save baseline
              </Button>
              <Button icon="rotate-ccw" disabled={!p.baseline} onClick={() => setResetting({})}>
                Reset now
              </Button>
            </>
          }
        />
        <SheetBody className="sandbox-about">
          <p className="muted">
            Visitors write under made-up names. Owners and admins write under their own, without these limits.
          </p>
          <dl className="sandbox-facts">
            <div>
              <dt>Visitor access</dt>
              <dd className="sandbox-control">
                <Segmented
                  label="What visitors may do"
                  items={ACCESS}
                  value={s.visitor_access}
                  onChange={(v) => v !== s.visitor_access && now({ visitor_access: v }, v === "write" ? "Visitors can write again." : v === "read" ? "Visitors can only read now. Everyone keeps their seat." : "Closed to visitors. Everyone keeps their seat.")}
                />
                {s.visitor_access === "read" ? <span className="muted">Visitors can still export, within the export limit.</span> : null}
              </dd>
            </div>
            <div>
              <dt>Visitors&rsquo; agents</dt>
              <dd className="sandbox-control">
                <Segmented
                  label="Whether visitors’ agents may work here"
                  items={[{ id: "on", label: "Allowed" }, { id: "off", label: "Off" }]}
                  value={s.visitor_agents ? "on" : "off"}
                  onChange={(v) => (v === "on") !== s.visitor_agents && now({ visitor_agents: v === "on" }, v === "on" ? "Visitors’ agents can connect." : "Visitors’ agents are off.")}
                />
                <span className="muted">Under the same limits as the visitor.</span>
              </dd>
            </div>
            <div>
              <dt>Seats</dt>
              <dd>
                <b className="num">{p.seats.used.toLocaleString("en-US")}</b> of <span className="num">{p.seats.limit.toLocaleString("en-US")}</span> taken.{" "}
                <span className="muted">
                  {p.invitations.open ? `${plural(p.invitations.open, "invitation")} open, with ${plural(p.invitations.places_left, "place")} left.` : "No invitation is open, so nobody new can enter."}
                </span>
              </dd>
            </div>
            <div>
              <dt>Next reset</dt>
              <dd>
                {!p.baseline ? (
                  <StatusBadge tone="attention">No baseline saved, so nothing resets</StatusBadge>
                ) : !s.reset_enabled ? (
                  <StatusBadge tone="neutral">Turned off</StatusBadge>
                ) : (
                  <>
                    <span title={formatDateTime(p.resets.next_at)}>{untilTime(p.resets.next_at)}</span>
                    <span className="muted">, {resetWords(p.resets)}.</span>
                  </>
                )}
              </dd>
            </div>
            <div>
              <dt>Last reset</dt>
              <dd>
                {p.resets.last_at ? (
                  <>
                    {formatDateTime(p.resets.last_at)}
                    <span className="muted">
                      {p.resets.last ? `, ${p.resets.last.scheduled ? "on schedule" : `by ${p.resets.last.by.display_name}`}: ${plural(p.resets.last.rows, "row")} restored, ${plural(p.resets.last.blobs_dropped, "stored file")} removed${p.resets.last.visitors_removed ? `, ${plural(p.resets.last.visitors_removed, "idle visitor")} removed` : ""}.` : "."}
                    </span>
                  </>
                ) : (
                  <span className="muted">Never.</span>
                )}
              </dd>
            </div>
            <div>
              <dt>Today</dt>
              <dd>
                {t.writes ? (
                  <>
                    {plural(t.visitors_writing, "visitor")} made {plural(t.writes, "write")}, added {plural(t.sources, "source")} and {formatBytes(t.bytes)}, and asked for {plural(t.exports, "export")}
                  </>
                ) : (
                  "No visitor has written anything"
                )}
                <span className="muted"> since {formatDateTime(t.since)}.</span>
              </dd>
            </div>
          </dl>
          {patch.isError && !changed.length ? <ErrorCallout inset error={patch.error} onRetry={patch.error instanceof ApiError && patch.error.code === "stale_etag" ? () => void q.refetch() : undefined} /> : null}
        </SheetBody>
      </Sheet>

      <Sheet labelledBy="limits-title">
        <SheetHeader id="limits-title" title="Limits" count={p.limits.length + 2} />
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (changed.length && !invalid.length) save();
          }}
        >
        <div className="sandbox-scroll">
          <Table className="sandbox-limits" head={["Limit", "Counted over", "Value", "Default", "Over the limit"]}>
              <LimitRow label="Seats" help="How many visitors the sandbox holds." per="The sandbox" refusal="409 sandbox_full" fallback={amount(p.defaults.max_visitors, "")}>
                <NumberCell label="Seats" value={value("max_visitors") as number} onChange={(v) => set("max_visitors", v)} />
              </LimitRow>
              <LimitRow label="Idle days before a seat is freed" help="A visitor who hasn’t signed in or used an agent for this long loses their seat at the next reset. 0 keeps every seat." per="Each visitor" refusal="" fallback={amount(p.defaults.visitor_idle_days, "")}>
                <NumberCell label="Idle days before a seat is freed" value={value("visitor_idle_days") as number} onChange={(v) => set("visitor_idle_days", v)} />
              </LimitRow>
              {p.limits.map((l) => (
                <LimitRow key={l.key} label={l.label} help={l.help} per={l.per} refusal={l.refusal} fallback={amount(l.default, l.unit)}>
                  {typeof l.value === "boolean" ? (
                    <label className="sandbox-switch">
                      <input type="checkbox" checked={Boolean(value(l.key))} onChange={(e) => set(l.key, e.target.checked)} />
                      <span>{value(l.key) ? "On" : "Off"}</span>
                    </label>
                  ) : BYTES.has(l.key) ? (
                    <NumberCell label={`${l.label}, ${l.per.toLowerCase()}, in MB`} suffix="MB" step={0.1} value={Number(((value(l.key) as number) / MiB).toFixed(2))} onChange={(v) => set(l.key, Math.round(v * MiB))} />
                  ) : (
                    <NumberCell label={`${l.label}, ${l.per.toLowerCase()}`} value={value(l.key) as number} onChange={(v) => set(l.key, v)} />
                  )}
                </LimitRow>
              ))}
          </Table>
        </div>
        <FormGrid className="sandbox-form">
          <TextField
            label="Reset every day at"
            type="time"
            value={String(value("reset_time"))}
            onChange={(e) => e.target.value && set("reset_time", e.target.value)}
          />
          <TextField
            label="Time zone"
            value={String(value("reset_timezone"))}
            onChange={(e) => set("reset_timezone", e.target.value.trim())}
            list="sandbox-zones"
            spellCheck={false}
            hint="An IANA name, such as America/Los_Angeles."
          />
          <div className="field">
            <span className="field-label">Resets</span>
            <div className="field-control">
              <label className="sandbox-switch">
                <input type="checkbox" checked={Boolean(value("reset_enabled"))} onChange={(e) => set("reset_enabled", e.target.checked)} />
                <span>{value("reset_enabled") ? "On" : "Off"}</span>
              </label>
            </div>
          </div>
        </FormGrid>
        <datalist id="sandbox-zones">
          {(typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : ["America/Los_Angeles", "UTC"]).map((z) => (
            <option key={z} value={z} />
          ))}
        </datalist>
        {patch.isError && changed.length ? (
          <SheetBody>
            <ErrorCallout inset error={patch.error} onRetry={patch.error instanceof ApiError && patch.error.code === "stale_etag" ? () => void q.refetch() : undefined} />
          </SheetBody>
        ) : null}
        <div className="sandbox-actions">
          <Button
            type="submit"
            variant="primary"
            busy={patch.isPending && changed.length > 0}
            busyLabel="Saving…"
            disabled={!changed.length || invalid.length > 0}
          >
            {changed.length ? `Save ${plural(changed.length, "change")}` : "Save changes"}
          </Button>
          {changed.length ? (
            <Button
              variant="quiet"
              onClick={() => {
                setDraft({});
                patch.reset();
              }}
            >
              Discard changes
            </Button>
          ) : null}
          {p.updated_at ? (
            <span className="sandbox-saved">
              Last changed {formatDateTime(p.updated_at)}
              {p.updated_by ? ` by ${p.updated_by.display_name}` : ""}
            </span>
          ) : null}
        </div>
        </form>
      </Sheet>

      <Baselines tenant={tenant} inUse={p.baseline} onReset={(b) => setResetting({ baseline: b })} />
      <Invitations tenant={tenant} seats={p.seats} />
      <Visitors tenant={tenant} seats={p.seats} />

      <Sheet labelledBy="deployment-title">
        <SheetHeader id="deployment-title" title="Limits of this deployment" count={p.deployment_limits.length} />
        <div className="sandbox-scroll">
          <Table head={["Limit", { label: "Value", num: true }, "Set by"]}>
            {p.deployment_limits.map((l) => (
              <Row key={l.label} label={l.label}>
                <Cell num>{l.unit === "bytes" ? formatBytes(l.value) : `${l.value.toLocaleString("en-US")} ${l.unit}`}</Cell>
                <Cell label="Set by">{l.set_by ? <code>{l.set_by}</code> : <span className="faint">The application</span>}</Cell>
              </Row>
            ))}
          </Table>
        </div>
        <p className="sandbox-foot">These apply to every organization, admins included, and are set where the service is deployed. Visitors get whichever limit is lower.</p>
      </Sheet>

      {saving ? <SaveBaselineDialog tenant={tenant} today={t} access={s.visitor_access} onClose={() => setSaving(false)} onSaved={refreshAll} /> : null}
      {resetting ? <ResetDialog tenant={tenant} name={p.organization.name} baseline={resetting.baseline ?? p.baseline} today={t} onClose={() => setResetting(null)} onDone={refreshAll} /> : null}
    </>
  );
}

/**
 * A table that stays a table to a screen reader when a phone lays each row out as a block: the
 * roles are written out, because a browser drops them once `display` changes.
 */
function Table({ head, className = "", children }: { head: (string | { label: string; num?: boolean })[]; className?: string; children: ReactNode }) {
  return (
    <table role="table" className={`sandbox-table ${className}`}>
      <thead role="rowgroup">
        <tr role="row">
          {head.map((h) => {
            const col = typeof h === "string" ? { label: h, num: false } : h;
            return (
              <th key={col.label} role="columnheader" scope="col" className={col.num ? "sandbox-num" : undefined}>
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
        {help ? <span className="sandbox-help">{help}</span> : null}
      </th>
      {children}
    </tr>
  );
}

/** `label` names the cell on a phone, where the column headings are out of sight. */
function Cell({ label, num, className = "", children }: { label?: string; num?: boolean; className?: string; children: ReactNode }) {
  return (
    <td role="cell" data-label={label} className={`${num ? "sandbox-num num " : ""}${className}`}>
      {children}
    </td>
  );
}

function LimitRow({ label, help, per, refusal, fallback, children }: { label: string; help: string; per: string; refusal: string; fallback: string; children: ReactNode }) {
  return (
    <Row label={label} help={help}>
      <Cell className="muted">{per}</Cell>
      <Cell className="sandbox-value">{children}</Cell>
      <Cell label="Default" className="num muted">{fallback}</Cell>
      <Cell label="Over the limit" className="sandbox-refusal">{refusal ? <code>{refusal}</code> : <span className="faint">Nothing is refused</span>}</Cell>
    </Row>
  );
}

function NumberCell({ label, value, onChange, suffix, step = 1 }: { label: string; value: number; onChange: (v: number) => void; suffix?: string; step?: number }) {
  return (
    <span className="sandbox-number">
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

// ---- Baselines ----------------------------------------------------------------------------------

function holdsWords(b: Baseline): string {
  const h = b.holds;
  return [plural(h.products, "product"), plural(h.sources, "source"), plural(h.passages, "passage"), plural(h.assumptions, "assumption"), plural(h.mockups, "mockup"), plural(h.story_pages, "Story page")].join(", ");
}

function Baselines({ tenant, inUse, onReset }: { tenant: string; inUse: Baseline | null; onReset: (b: Baseline) => void }) {
  const q = useQuery({ queryKey: ["sandbox", tenant, "baselines"], queryFn: () => api<{ items: Baseline[] }>("GET", `/api/v1/tenants/${tenant}/sandbox/baselines`) });
  return (
    <Sheet labelledBy="baselines-title">
      <SheetHeader id="baselines-title" title="Baselines" count={q.data?.items.length} />
      {q.isPending ? (
        <Loading label="Loading baselines…" lines={2} />
      ) : q.isError ? (
        <SheetBody>
          <ErrorCallout inset error={q.error} onRetry={() => q.refetch()} />
        </SheetBody>
      ) : !q.data.items.length ? (
        <EmptyState size="inline" title="No baseline yet">
          Nothing resets until you save one. Set up the content as visitors should find it, then choose Save baseline.
        </EmptyState>
      ) : (
        <ul className="sandbox-list">
          {q.data.items.map((b) => (
            <li key={b.baseline_id} className="sandbox-row">
              <div className="sandbox-row-main">
                <span className="sandbox-row-title">
                  {formatDateTime(b.created_at)}
                  {b.note ? <span className="muted"> · {b.note}</span> : null}
                </span>
                <span className="sandbox-row-sub">
                  Saved by {b.created_by.display_name}. Holds {holdsWords(b)}.
                </span>
              </div>
              <div className="sandbox-row-end">
                {b.baseline_id === inUse?.baseline_id ? (
                  <StatusBadge tone="positive">In use</StatusBadge>
                ) : (
                  <Button size="sm" variant="quiet" onClick={() => onReset(b)}>
                    Reset to this one…
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="sandbox-foot">The newest 3 are kept.</p>
    </Sheet>
  );
}

function SaveBaselineDialog({ tenant, today, access, onClose, onSaved }: { tenant: string; today: Panel["today"]; access: Settings["visitor_access"]; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [note, setNote] = useState("");
  const save = useMutation({
    mutationFn: () => api<Baseline>("POST", `/api/v1/tenants/${tenant}/sandbox/baselines`, { note: note.trim() }),
    onSuccess: (b) => {
      onSaved();
      toast(`Baseline saved: ${holdsWords(b)}.`);
      onClose();
    },
  });
  return (
    <Dialog
      open
      onClose={onClose}
      dismissable={!save.isPending}
      title="Save a new baseline?"
      description="Every reset from now on returns the organization to its content as it is now."
      footer={
        <>
          <Button onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button variant="primary" busy={save.isPending} busyLabel="Saving…" onClick={() => save.mutate()}>
            Save baseline
          </Button>
        </>
      }
    >
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        {today.writes ? (
          <Callout inset tone="attention" title={`Visitors have made ${plural(today.writes, "write")} today`}>
            The baseline will include what they added. To leave it out, reset first, make your changes, then save.
            {access === "write" ? " Set visitors to Read only while you work." : ""}
          </Callout>
        ) : null}
        <TextField label="Note" optional maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
        {save.isError ? <ErrorCallout inset error={save.error} /> : null}
      </form>
    </Dialog>
  );
}

function ResetDialog({ tenant, name, baseline, today, onClose, onDone }: { tenant: string; name: string; baseline: Baseline | null; today: Panel["today"]; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const reset = useMutation({
    mutationFn: () => api<{ rows: number }>("POST", `/api/v1/tenants/${tenant}/sandbox/reset`, { confirm: RESET_CONFIRMATION, ...(baseline ? { baseline_id: baseline.baseline_id } : {}) }),
    onSuccess: (r) => {
      onDone();
      // Every product in the organization is as the baseline has it.
      void qc.invalidateQueries({ queryKey: ["product"] });
      void qc.invalidateQueries({ queryKey: ["products"] });
      toast(`${name} is back to its baseline.`);
      onClose();
    },
  });
  return (
    <Dialog
      open
      onClose={onClose}
      dismissable={!reset.isPending}
      title={`Reset ${name} now?`}
      description={`Everything added or changed since the baseline${baseline ? ` of ${formatDateTime(baseline.created_at)}` : ""} is erased for everyone. This can’t be undone.`}
      footer={
        <>
          <Button onClick={onClose} disabled={reset.isPending}>
            Cancel
          </Button>
          <Button variant="danger" busy={reset.isPending} busyLabel="Resetting…" onClick={() => reset.mutate()}>
            Reset the sandbox
          </Button>
        </>
      }
    >
      <div className="stack-sm">
        <ul className="sandbox-losing">
          <li>{today.writes ? `What visitors added today: ${plural(today.writes, "write")}, ${plural(today.sources, "source")}, ${formatBytes(today.bytes)}.` : "Visitors have added nothing today."}</li>
          <li>What owners and admins changed since the baseline, unless you save a new baseline first.</li>
          <li>Uploads and exports in progress, and the day&rsquo;s counts.</li>
        </ul>
        {reset.isError ? <ErrorCallout inset error={reset.error} /> : <p className="muted">Visitors keep their seats and everyone keeps their role.</p>}
      </div>
    </Dialog>
  );
}

// ---- Invitations --------------------------------------------------------------------------------

const INVITE_TONE: Record<Invite["status"], StatusTone> = { open: "positive", full: "neutral", expired: "neutral", revoked: "negative" };
const INVITE_WORD: Record<Invite["status"], string> = { open: "Open", full: "Full", expired: "Expired", revoked: "Withdrawn" };

function Invitations({ tenant, seats }: { tenant: string; seats: Panel["seats"] }) {
  const base = `/api/v1/tenants/${tenant}/sandbox/invites`;
  const qc = useQueryClient();
  const toast = useToast();
  const [making, setMaking] = useState(false);
  const q = useQuery({ queryKey: ["sandbox", tenant, "invites"], queryFn: () => api<{ items: Invite[] }>("GET", base) });
  const revoke = useMutation({
    mutationFn: (id: string) => api("POST", `${base}/revoke`, { invite_id: id }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["sandbox", tenant] });
      toast("Invitation withdrawn. Visitors who already entered keep their seats.");
    },
    onError: (e) => toast(`Couldn’t withdraw the invitation. ${(e as Error).message}`, { tone: "negative" }),
  });
  return (
    <Sheet labelledBy="invites-title">
      <SheetHeader
        id="invites-title"
        title="Invitations"
        count={q.data?.items.length}
        end={
          <Button icon="plus" onClick={() => setMaking(true)}>
            New invitation
          </Button>
        }
      />
      {q.isPending ? (
        <Loading label="Loading invitations…" lines={2} />
      ) : q.isError ? (
        <SheetBody>
          <ErrorCallout inset error={q.error} onRetry={() => q.refetch()} />
        </SheetBody>
      ) : !q.data.items.length ? (
        <EmptyState size="inline" title="No invitations yet" />
      ) : (
        <ul className="sandbox-list">
          {q.data.items.map((i) => (
            <li key={i.invite_id} className="sandbox-row">
              <div className="sandbox-row-main">
                <span className="sandbox-row-title">{i.label}</span>
                <span className="sandbox-row-sub">
                  <span className="num">{i.used.toLocaleString("en-US")}</span> of <span className="num">{i.places.toLocaleString("en-US")}</span> {i.places === 1 ? "place" : "places"} taken · created {formatDate(i.created_at)} by {i.created_by.display_name}
                  {i.expires_at ? ` · ${i.status === "expired" ? "expired" : "expires"} ${formatDate(i.expires_at)}` : ""}
                </span>
              </div>
              <div className="sandbox-row-end">
                <StatusBadge tone={INVITE_TONE[i.status]}>{INVITE_WORD[i.status]}</StatusBadge>
                {i.status === "open" ? (
                  <Button size="sm" variant="quiet" busy={revoke.isPending && revoke.variables === i.invite_id} onClick={() => revoke.mutate(i.invite_id)}>
                    Withdraw
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
      {making ? <InviteDialog tenant={tenant} seats={seats} onClose={() => setMaking(false)} /> : null}
    </Sheet>
  );
}

function InviteDialog({ tenant, seats, onClose }: { tenant: string; seats: Panel["seats"]; onClose: () => void }) {
  const qc = useQueryClient();
  const [label, setLabel] = useState("");
  const [places, setPlaces] = useState("25");
  const [days, setDays] = useState("30");
  const n = Number(places);
  const d = days.trim() === "" ? null : Number(days);
  const valid = label.trim().length > 0 && Number.isInteger(n) && n >= 1 && (d === null || (Number.isInteger(d) && d >= 1 && d <= 365));
  const make = useMutation({
    mutationFn: () => api<Invite & { invite_link: string; warnings: string[] }>("POST", `/api/v1/tenants/${tenant}/sandbox/invites`, { label: label.trim(), places: n, ...(d ? { expires_in_days: d } : {}) }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["sandbox", tenant] }),
  });
  const free = Math.max(0, seats.limit - seats.used);
  return (
    <Dialog
      open
      onClose={onClose}
      dismissable={!make.isPending}
      title={make.data ? "Invitation created" : "New invitation"}
      description={make.data ? undefined : "Anyone with the link can enter as a visitor, with any email, until its places run out."}
      footer={
        make.data ? (
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        ) : (
          <>
            <Button onClick={onClose} disabled={make.isPending}>
              Cancel
            </Button>
            <Button variant="primary" busy={make.isPending} busyLabel="Creating…" disabled={!valid} onClick={() => make.mutate()}>
              Create invitation
            </Button>
          </>
        )
      }
    >
      {make.data ? (
        <div className="stack-sm">
          <Callout inset tone="positive" title={`${make.data.label}: ${plural(make.data.places, "place")}`}>
            Copy the link now: it&rsquo;s shown only once. If you lose it, withdraw the invitation and create another.
          </Callout>
          <CopyField label="Invitation link" value={make.data.invite_link} />
          {make.data.warnings.map((w) => (
            <Callout key={w} inset tone="attention">
              {w}
            </Callout>
          ))}
        </div>
      ) : (
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) make.mutate();
          }}
        >
          <TextField label="Where you’ll share it" required maxLength={100} value={label} onChange={(e) => setLabel(e.target.value)} hint="Such as “Launch post” or “Workshop, 12 October”." />
          <TextField
            label="Places"
            type="number"
            inputMode="numeric"
            min={1}
            required
            value={places}
            onChange={(e) => setPlaces(e.target.value)}
            hint={`How many people the link admits. ${free.toLocaleString("en-US")} of ${plural(seats.limit, "seat")} ${free === 1 ? "is" : "are"} free.`}
          />
          <TextField label="Days until it expires" optional type="number" inputMode="numeric" min={1} max={365} value={days} onChange={(e) => setDays(e.target.value)} hint="Leave empty for a link that never expires." />
          {make.isError ? <ErrorCallout inset error={make.error} /> : null}
        </form>
      )}
    </Dialog>
  );
}

// ---- Visitors -----------------------------------------------------------------------------------

function Visitors({ tenant, seats }: { tenant: string; seats: Panel["seats"] }) {
  const base = `/api/v1/tenants/${tenant}/sandbox/visitors`;
  const qc = useQueryClient();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const query = params.get("visitor") ?? "";
  const [removing, setRemoving] = useState<Visitor | null>(null);
  const q = useInfiniteQuery({
    queryKey: ["sandbox", tenant, "visitors", query],
    queryFn: ({ pageParam }) => api<{ items: Visitor[]; next_cursor: string | null }>("GET", `${base}${qs({ query, limit: 50, cursor: pageParam })}`),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  });
  const remove = useMutation({
    mutationFn: (v: Visitor) => api("POST", `${base}/remove`, { account_id: v.account_id }),
    onSuccess: (_r, v) => {
      void qc.invalidateQueries({ queryKey: ["sandbox", tenant] });
      toast(`${v.display_name} no longer has a seat. What they wrote stays until the next reset.`);
      setRemoving(null);
    },
  });
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <Sheet labelledBy="visitors-title">
      <SheetHeader
        id="visitors-title"
        title="Visitors"
        count={`${seats.used.toLocaleString("en-US")} of ${seats.limit.toLocaleString("en-US")} seats`}
        end={
          <FindField
            label="Find a visitor"
            value={query}
            onChange={(e) =>
              setParams(
                (p) => {
                  const next = new URLSearchParams(p);
                  if (e.target.value) next.set("visitor", e.target.value);
                  else next.delete("visitor");
                  return next;
                },
                { replace: true },
              )
            }
          />
        }
      />
      {q.isPending ? (
        <Loading label="Loading visitors…" lines={3} />
      ) : q.isError ? (
        <SheetBody>
          <ErrorCallout inset error={q.error} onRetry={() => q.refetch()} />
        </SheetBody>
      ) : !items.length ? (
        <EmptyState size="inline" title={query ? `No visitor matches “${query}”` : "No visitors yet"}>
          {query ? "Search by name, email, or made-up name, such as Visitor 4F2A9C." : "Create an invitation and share its link."}
        </EmptyState>
      ) : (
        <ul className="sandbox-list">
          {items.map((v) => (
            <li key={v.account_id} className="sandbox-row sandbox-visitor">
              <Avatar name={v.display_name} />
              <div className="sandbox-row-main">
                <span className="sandbox-row-title">{v.display_name}</span>
                <span className="sandbox-row-sub">
                  {v.email} · writes as {v.appears_as} · entered {formatDate(v.joined_at)}
                </span>
              </div>
              <div className="sandbox-row-end">
                <Button size="sm" variant="quiet" aria-label={`Remove ${v.display_name} from the sandbox`} onClick={() => setRemoving(v)}>
                  Remove
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {q.hasNextPage ? (
        <div className="sandbox-more">
          <Button size="sm" busy={q.isFetchingNextPage} busyLabel="Loading…" onClick={() => void q.fetchNextPage()}>
            Show more
          </Button>
        </div>
      ) : null}
      <p className="sandbox-foot">
        The organization&rsquo;s own people are in <Link to={`/t/${tenant}/members`}>Members</Link>.
      </p>
      {removing ? (
        <Dialog
          open
          onClose={() => setRemoving(null)}
          dismissable={!remove.isPending}
          title={`Remove ${removing.display_name} from the sandbox?`}
          description={`They lose their seat and can’t open the sandbox. What they wrote as ${removing.appears_as} stays until the next reset. An invitation with a place left lets them back in.`}
          footer={
            <>
              <Button onClick={() => setRemoving(null)} disabled={remove.isPending}>
                Cancel
              </Button>
              <Button variant="danger" busy={remove.isPending} busyLabel="Removing…" onClick={() => remove.mutate(removing)}>
                Remove from the sandbox
              </Button>
            </>
          }
        >
          {remove.isError ? <ErrorCallout inset error={remove.error} /> : null}
        </Dialog>
      ) : null}
    </Sheet>
  );
}

// ---- /join/:code --------------------------------------------------------------------------------

interface InviteInfo {
  status: "open" | "used_up" | "expired" | "revoked" | "full" | "closed";
  organization: string;
  notice: string;
  resets: { time: string; timezone: string } | null;
  limits: { file_max_bytes: number; sources_per_day: number; writes_per_day: number; bytes_per_day: number };
}

const NOT_OPEN: Record<Exclude<InviteInfo["status"], "open">, { title: string; text: string }> = {
  used_up: { title: "This invitation has no places left", text: "Ask whoever sent it for a new link." },
  expired: { title: "This invitation has expired", text: "Ask whoever sent it for a new link." },
  revoked: { title: "This invitation was withdrawn", text: "Ask whoever sent it for a new link." },
  full: { title: "The sandbox is full for now", text: "Your invitation still works. Try again when a seat is free." },
  closed: { title: "The sandbox is closed to visitors for now", text: "Your invitation still works. Try again later." },
};

/**
 * The page behind an invitation link. It says what the sandbox is before it asks anyone to sign
 * in, and entering takes a press of a button, after the notice, never just the opening of the link.
 */
export function JoinSandbox() {
  const { code = "" } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const me = useMe();
  const info = useQuery({ queryKey: ["sandbox-invite", code], queryFn: () => api<InviteInfo>("GET", `/api/v1/sandbox/invite${qs({ code })}`), retry: false });
  const join = useMutation({
    mutationFn: () => api<{ already: boolean; appears_as: string | null; organization: { slug: string; name: string }; products: { path: string }[] }>("POST", "/api/v1/sandbox/join", { code }),
    onSuccess: async (r) => {
      await qc.invalidateQueries({ queryKey: ["products"] });
      toast(r.appears_as ? `You’re in ${r.organization.name}, writing as ${r.appears_as}.` : `You’re already in ${r.organization.name}.`);
      navigate(r.products[0] ? `/t/${r.products[0].path}/idea` : "/", { replace: true });
    },
  });
  const signedIn = Boolean(me.data);
  const i = info.data;
  return (
    <EntryPage title="Public sandbox · WhatBuild" wide>
      <Sheet labelledBy="join-title">
        {info.isPending ? (
          <Loading label="Looking up the invitation…" lines={2} variant="lines" />
        ) : info.isError ? (
          <>
            <SheetHeader level={1} id="join-title" title="This invitation link didn’t work" />
            <SheetBody className="entry-form">
              <ErrorCallout inset title="" error={info.error} />
              <div className="entry-actions">
                <ButtonLink to="/">Go to WhatBuild</ButtonLink>
              </div>
            </SheetBody>
          </>
        ) : (
          <>
            <SheetHeader level={1} id="join-title" title="You’re invited to try WhatBuild" />
            <SheetBody className="entry-form">
              <p>
                {i!.organization} is a worked example of a product discovery. You can change it by hand or with your own agent.
              </p>
              <Callout inset tone="attention" title="Public, and erased">
                {i!.notice.replace(/^This is a public sandbox\.\s*/, "")}
              </Callout>
              <ul className="join-terms">
                <li>You write under a made-up name, such as Visitor 4F2A9C. Visitors don’t see one another’s names or emails.</li>
                <li>You can edit content, but not manage products or people, or delete anything permanently.</li>
                <li>
                  Each day you can add {plural(i!.limits.sources_per_day, "source")} ({formatBytes(i!.limits.bytes_per_day)} in all, {formatBytes(i!.limits.file_max_bytes)} a file) and make {plural(i!.limits.writes_per_day, "change")}.
                </li>
                <li>Your account works only in the sandbox. It can&rsquo;t start an organization.</li>
              </ul>
              {i!.status !== "open" && !join.isSuccess ? (
                <Callout inset tone="negative" title={NOT_OPEN[i!.status].title}>
                  {NOT_OPEN[i!.status].text}
                  {signedIn ? " If you’ve entered before, you can still open the sandbox." : ""}
                </Callout>
              ) : null}
              {join.isError ? <ErrorCallout inset error={join.error} /> : null}
              <div className="entry-actions">
                {me.isPending ? (
                  <Loading label="Checking your sign-in…" lines={1} variant="lines" />
                ) : signedIn ? (
                  <>
                    <Button variant="primary" busy={join.isPending} busyLabel="Entering…" onClick={() => join.mutate()}>
                      {i!.status === "open" ? "Enter the sandbox" : "Open the sandbox"}
                    </Button>
                    <span className="entry-caption">Signed in as {me.data!.email}</span>
                  </>
                ) : i!.status === "open" ? (
                  <ButtonLink variant="primary" to={`/signin?next=${encodeURIComponent(`/join/${code}`)}`}>
                    Sign in to enter
                  </ButtonLink>
                ) : (
                  <ButtonLink to={`/signin?next=${encodeURIComponent(`/join/${code}`)}`}>Sign in</ButtonLink>
                )}
              </div>
            </SheetBody>
          </>
        )}
      </Sheet>
    </EntryPage>
  );
}
