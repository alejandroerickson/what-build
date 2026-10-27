import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, ApiError } from "../lib/api.ts";
import { formatDate } from "../lib/format.ts";
import { planWord, usePlans } from "../lib/limits.ts";
import { useMe } from "../lib/session.tsx";
import { usePageTitle } from "../shell/slots.tsx";
import {
  Button, ButtonLink, ChoiceRow, Dialog, EmptyState, ErrorCallout, ListRow, Loading, Sheet, SheetBody, SheetHeader, StatusBadge, TextField, useToast,
} from "../ui/index.tsx";
import { InstanceGuestsSheet, InstanceOrganizationsSheet, InstancePlansSheet } from "./limits.tsx";
import "../styles/screens/instance.css";

interface Allowance {
  email: string;
  allowed: number;
  created: number;
  remaining: number;
  account: { account_id: string; display_name: string } | null;
  note: string;
  etag: string;
  updated_at: string;
  updated_by: { display_name: string };
}
/** Someone who asked for an organization of their own, from the app or the public site, and has no allowance yet. */
interface Asking {
  email: string;
  name: string | null;
  organization: string | null;
  note: string | null;
  asked_at: string;
  account: { account_id: string; display_name: string } | null;
}
interface Allowances {
  instance_owners: string[];
  default_allowed: number;
  /** The plan whose organizations an allowance counts: the one new organizations start on. */
  new_organization_plan: string;
  items: Allowance[];
  waitlist: Asking[];
}

const A = "/api/v1/tenant-allowances";

/** "1 Free organization", "3 organizations": what an allowance counts, named by the plan it counts on, if any. */
function organizations(n: number, kindName?: string | null) {
  const kind = kindName ? `${kindName} ` : "";
  return n === 1 ? `1 ${kind}organization` : `${n.toLocaleString("en-US")} ${kind}organizations`;
}

/**
 * `/instance`: for the owners of this WhatBuild, who decide who may create organizations and how
 * many (being in an organization never lets anyone create one, so this is the only way in), each
 * organization's plan, the plans offered and their limits, and how guests come in.
 */
export function InstancePage() {
  const me = useMe();
  const qc = useQueryClient();
  const toast = useToast();
  usePageTitle("Organizations");
  const owner = me.data?.tenant_allowance.instance_owner ?? false;
  const plans = usePlans();
  const offered = Boolean(plans.data?.plans.length);
  const q = useQuery({ queryKey: ["tenant-allowances"], queryFn: () => api<Allowances>("GET", A), enabled: owner });
  const [editing, setEditing] = useState<Allowance | "new" | null>(null);
  const [removing, setRemoving] = useState<Allowance | null>(null);
  const remove = useMutation({
    mutationFn: (a: Allowance) => api("POST", `${A}/remove`, { email: a.email, expected_etag: a.etag }),
    onSuccess: (_r, a) => {
      void qc.invalidateQueries({ queryKey: ["tenant-allowances"] });
      toast(`${a.email} is back to the default. The organizations they started stay.`);
      setRemoving(null);
    },
  });

  if (me.isPending)
    return (
      <Sheet label="Loading">
        <Loading label="Loading…" lines={3} />
      </Sheet>
    );
  if (!owner)
    return (
      <Sheet labelledBy="instance-title">
        <SheetHeader level={1} id="instance-title" title="Organizations" />
        <EmptyState size="inline" action={<ButtonLink to="/">Your products</ButtonLink>}>
          Only this WhatBuild&rsquo;s owners see every organization and decide who can start one.
        </EmptyState>
      </Sheet>
    );

  const items = q.data?.items ?? [];
  // What an allowance counts: organizations on the plan new ones start on, named, where that is one the deployment defines.
  const start = q.data?.new_organization_plan;
  const kindName = start && start !== "unlimited" && plans.data ? planWord(start, plans.data.plans) : null;
  return (
    <>
    <InstanceOrganizationsSheet />
    {offered ? <InstancePlansSheet /> : null}
    {/* Guests read the example organization, so there are none without one. */}
    {plans.data?.example ? <InstanceGuestsSheet /> : null}
    <Sheet labelledBy="instance-title">
      <SheetHeader
        level={2}
        id="instance-title"
        title="Who can start organizations"
        count={q.data ? items.length : undefined}
        end={
          <Button size="sm" variant="primary" icon="plus" onClick={() => setEditing("new")}>
            Let someone start organizations
          </Button>
        }
      />
      <SheetBody className="instance-intro">
        <p className="muted">
          {kindName
            ? `Each person listed can have as many ${kindName} organizations as they’re given; moving one to another plan frees its place. Owners can start any number.`
            : "Each person listed can start organizations up to the number they’re given. Owners can start any number."}
        </p>
        {q.data ? (
          <p className="muted">
            Everyone else can start {q.data.default_allowed ? organizations(q.data.default_allowed, kindName) : "none"}. Owners: {q.data.instance_owners.join(", ")}. Both are set where the service is deployed.
          </p>
        ) : null}
      </SheetBody>
      {q.isPending ? (
        <Loading label="Loading allowances…" lines={3} />
      ) : q.isError ? (
        <SheetBody>
          <ErrorCallout inset error={q.error} onRetry={() => q.refetch()} />
        </SheetBody>
      ) : !items.length ? (
        <EmptyState size="inline" title="Nobody else can start one yet" />
      ) : (
        <div className="instance-rows">
          {items.map((a) => (
            <ListRow
              key={a.email}
              className="instance-row"
              title={
                <>
                  {a.account ? a.account.display_name : a.email}
                  {a.account ? <span className="muted"> · {a.email}</span> : <span className="faint"> · no account yet</span>}
                </>
              }
              sub={
                <>
                  Can have {a.allowed ? organizations(a.allowed, kindName) : "none"}; has {a.created}. Set by {a.updated_by.display_name}, {formatDate(a.updated_at)}.
                  {a.note ? ` ${a.note}` : ""}
                </>
              }
              end={
                <span className="instance-row-end">
                  {a.allowed && !a.remaining ? <StatusBadge tone="neutral">All used</StatusBadge> : a.remaining ? <StatusBadge tone="positive">{a.remaining} left</StatusBadge> : null}
                  <Button size="sm" variant="quiet" onClick={() => setEditing(a)} aria-label={`Change how many ${a.email} can start`}>
                    Change
                  </Button>
                  <Button size="sm" variant="quiet" onClick={() => setRemoving(a)} aria-label={`Return ${a.email} to the default`}>
                    Remove
                  </Button>
                </span>
              }
            />
          ))}
        </div>
      )}
      {editing ? <AllowanceDialog current={editing === "new" ? null : editing} onClose={() => setEditing(null)} /> : null}
      {removing ? (
        <Dialog
          open
          onClose={() => setRemoving(null)}
          dismissable={!remove.isPending}
          title={`Return ${removing.email} to the default?`}
          description={`They can then have ${q.data?.default_allowed ? organizations(q.data.default_allowed, kindName) : "no organizations"}, counting the ${removing.created} they have. Those stay as they are.`}
          footer={
            <>
              <Button onClick={() => setRemoving(null)} disabled={remove.isPending}>
                Cancel
              </Button>
              <Button variant="danger" busy={remove.isPending} busyLabel="Removing…" onClick={() => remove.mutate(removing)}>
                Remove allowance
              </Button>
            </>
          }
        >
          {remove.isError ? <ErrorCallout inset error={remove.error} /> : null}
        </Dialog>
      ) : null}
    </Sheet>
    {plans.data?.example || q.data?.waitlist.length ? <Waitlist q={q} /> : null}
    </>
  );
}

/**
 * The people who asked for an organization of their own and have no allowance yet, earliest first.
 * Letting one start one gives them an allowance of 1 and emails them where to start.
 */
function Waitlist({ q }: { q: ReturnType<typeof useQuery<Allowances>> }) {
  const qc = useQueryClient();
  const toast = useToast();
  const letIn = useMutation({
    mutationFn: (a: Asking) => api<{ notified: boolean }>("PUT", A, { email: a.email, allowed: 1, notify: true }),
    onSuccess: (r, a) => {
      void qc.invalidateQueries({ queryKey: ["tenant-allowances"] });
      toast(`${a.account?.display_name ?? a.name ?? a.email} can start an organization.${r.notified ? " They’ll get an email." : ""}`);
    },
  });
  const items = q.data?.waitlist ?? [];
  return (
    <Sheet labelledBy="waitlist-title">
      <SheetHeader level={2} id="waitlist-title" title="Waitlist" count={q.data ? items.length : undefined} />
      <SheetBody className="instance-intro">
        <p className="muted">People who asked for an organization of their own, as guests in the app or on the public site, earliest first.</p>
      </SheetBody>
      {q.isPending ? (
        <Loading label="Loading the waitlist…" lines={2} />
      ) : q.isError ? null : !items.length ? (
        <EmptyState size="inline" title="Nobody is waiting" />
      ) : (
        <div className="instance-rows">
          {items.map((a) => (
            <ListRow
              key={a.email}
              className="instance-row"
              title={
                <>
                  {a.account?.display_name ?? a.name ?? a.email}
                  {a.account?.display_name ?? a.name ? <span className="muted"> · {a.email}</span> : null}
                </>
              }
              sub={
                <>
                  {[a.organization, `asked ${formatDate(a.asked_at)}`, a.account ? "signed up" : "no account yet"].filter(Boolean).join(" · ")}
                  {a.note ? <span className="instance-note">{a.note}</span> : null}
                </>
              }
              end={
                <span className="instance-row-end">
                  <Button
                    size="sm"
                    busy={letIn.isPending && letIn.variables?.email === a.email}
                    disabled={letIn.isPending}
                    onClick={() => letIn.mutate(a)}
                    aria-label={`Let ${a.account?.display_name ?? a.name ?? a.email} start an organization`}
                  >
                    Let them start one
                  </Button>
                </span>
              }
            />
          ))}
        </div>
      )}
      {letIn.isError ? (
        <SheetBody>
          <ErrorCallout inset error={letIn.error} />
        </SheetBody>
      ) : null}
    </Sheet>
  );
}

function AllowanceDialog({ current, onClose }: { current: Allowance | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [email, setEmail] = useState(current?.email ?? "");
  const [allowed, setAllowed] = useState(String(current?.allowed ?? 1));
  const [note, setNote] = useState(current?.note ?? "");
  const [notify, setNotify] = useState(true);
  const n = Number(allowed);
  const valid = /\S+@\S+\.\S+/.test(email.trim()) && Number.isInteger(n) && n >= 0 && n <= 1000;
  const save = useMutation({
    mutationFn: () =>
      api<Allowance & { notified: boolean }>("PUT", A, { email: email.trim(), allowed: n, note: note.trim(), notify, ...(current ? { expected_etag: current.etag } : {}) }),
    onSuccess: (a) => {
      void qc.invalidateQueries({ queryKey: ["tenant-allowances"] });
      toast(`${a.email} can start ${a.allowed ? organizations(a.allowed) : "none"}${a.notified ? ", and has been emailed" : ""}.`);
      onClose();
    },
  });
  const taken = save.error instanceof ApiError && save.error.code === "stale_etag" && !current;
  return (
    <Dialog
      open
      onClose={onClose}
      dismissable={!save.isPending}
      title={current ? `How many can ${current.email} start?` : "Let someone start organizations"}
      description="The number counts every organization they’ve started, not ones they’re invited to."
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
        {current ? null : <TextField label="Email" type="email" required maxLength={320} value={email} onChange={(e) => setEmail(e.target.value)} hint="The email they sign in with. They don’t need an account yet." />}
        <TextField label="Organizations they can start" type="number" required min={0} max={1000} step={1} value={allowed} onChange={(e) => setAllowed(e.target.value)} hint={current ? `They’ve started ${current.created}. 0 stops them starting more.` : "0 means none, whatever the default."} />
        <TextField label="Note" optional maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} hint="Only owners see it." />
        <ChoiceRow label="Tell them by email" hint="Sent only when the number goes up and they can still start one." checked={notify} onChange={(e) => setNotify(e.target.checked)} />
        {taken ? <ErrorCallout inset error={new Error("This email already has an allowance. Close this and use Change on its row.")} /> : save.isError ? <ErrorCallout inset error={save.error} /> : null}
      </form>
    </Dialog>
  );
}
