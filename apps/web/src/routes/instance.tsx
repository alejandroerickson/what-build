import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, ApiError } from "../lib/api.ts";
import { formatDate } from "../lib/format.ts";
import { useMe } from "../lib/session.tsx";
import { usePageTitle } from "../shell/slots.tsx";
import {
  Button, ButtonLink, ChoiceRow, Dialog, EmptyState, ErrorCallout, ListRow, Loading, Sheet, SheetBody, SheetHeader, StatusBadge, TextField, useToast,
} from "../ui/index.tsx";
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
interface Allowances {
  instance_owners: string[];
  default_allowed: number;
  items: Allowance[];
}

const A = "/api/v1/tenant-allowances";

function organizations(n: number) {
  return n === 1 ? "1 organization" : `${n.toLocaleString("en-US")} organizations`;
}

/**
 * `/instance`: for the owners of this WhatBuild, who decides who may create organizations and how
 * many. Being in an organization never lets anyone create one, so this is the only way in.
 */
export function InstancePage() {
  const me = useMe();
  const qc = useQueryClient();
  const toast = useToast();
  usePageTitle("Organization creators");
  const owner = me.data?.tenant_allowance.instance_owner ?? false;
  const q = useQuery({ queryKey: ["tenant-allowances"], queryFn: () => api<Allowances>("GET", A), enabled: owner });
  const [editing, setEditing] = useState<Allowance | "new" | null>(null);
  const [removing, setRemoving] = useState<Allowance | null>(null);
  const remove = useMutation({
    mutationFn: (a: Allowance) => api("POST", `${A}/remove`, { email: a.email, expected_etag: a.etag }),
    onSuccess: (_r, a) => {
      void qc.invalidateQueries({ queryKey: ["tenant-allowances"] });
      toast(`${a.email} is back to the default. The organizations it created stay.`);
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
        <SheetHeader level={1} id="instance-title" title="Organization creators" />
        <EmptyState size="inline" action={<ButtonLink to="/">Your products</ButtonLink>}>
          Only the owners of this WhatBuild decide who may create organizations. The deployment names them.
        </EmptyState>
      </Sheet>
    );

  const items = q.data?.items ?? [];
  return (
    <Sheet labelledBy="instance-title">
      <SheetHeader
        level={1}
        id="instance-title"
        title="Organization creators"
        count={q.data ? items.length : undefined}
        end={
          <Button size="sm" variant="primary" icon="plus" onClick={() => setEditing("new")}>
            Let someone create organizations
          </Button>
        }
      />
      <SheetBody className="instance-intro">
        <p className="muted">
          You own this WhatBuild. Belonging to an organization never lets anyone create one: only its owners may create any number, and the addresses below as many as each is given, counting the ones they already created. The organizations they are invited to don&rsquo;t count.
        </p>
        {q.data ? (
          <p className="muted">
            Every other address may create {q.data.default_allowed ? organizations(q.data.default_allowed) : "none"}. Owners of this instance: {q.data.instance_owners.join(", ")}. Both are set where the service is deployed.
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
        <EmptyState size="inline" title="Nobody else may create one yet">
          Give an address an allowance to let its owner start organizations of their own. They needn&rsquo;t have an account: while sign-up is limited, an allowance also lets them sign up.
        </EmptyState>
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
                  May create {a.allowed ? organizations(a.allowed) : "none"}, has created {a.created}. Given by {a.updated_by.display_name}, {formatDate(a.updated_at)}.
                  {a.note ? ` ${a.note}` : ""}
                </>
              }
              end={
                <span className="instance-row-end">
                  {a.allowed && !a.remaining ? <StatusBadge tone="neutral">All used</StatusBadge> : a.remaining ? <StatusBadge tone="positive">{a.remaining} left</StatusBadge> : null}
                  <Button size="sm" variant="quiet" onClick={() => setEditing(a)} aria-label={`Change how many ${a.email} may create`}>
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
          description={`It may then create ${q.data?.default_allowed ? organizations(q.data.default_allowed) : "no organization"}, counting the ${removing.created} it created. Those stay as they are.`}
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
      toast(`${a.email} may create ${a.allowed ? organizations(a.allowed) : "none"}${a.notified ? ", and was told by email" : ""}.`);
      onClose();
    },
  });
  const taken = save.error instanceof ApiError && save.error.code === "stale_etag" && !current;
  return (
    <Dialog
      open
      onClose={onClose}
      dismissable={!save.isPending}
      title={current ? `How many may ${current.email} create?` : "Let someone create organizations"}
      description="Counted against every organization the address's account created. Organizations it is invited to don't count."
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
        {current ? null : <TextField label="Email" type="email" required maxLength={320} value={email} onChange={(e) => setEmail(e.target.value)} hint="The address they sign in with. They needn't have an account yet." />}
        <TextField label="Organizations they may create" type="number" required min={0} max={1000} step={1} value={allowed} onChange={(e) => setAllowed(e.target.value)} hint={current ? `They have created ${current.created}. 0 lets them create none.` : "0 lets them create none, whatever the default."} />
        <TextField label="Note" optional maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} hint="Why, for the owners of this instance. They don't see it." />
        <ChoiceRow label="Tell them by email" hint="Only when the number goes up and they have one left to create." checked={notify} onChange={(e) => setNotify(e.target.checked)} />
        {taken ? <ErrorCallout inset error={new Error("This address already has an allowance. Close this and use Change on its row.")} /> : save.isError ? <ErrorCallout inset error={save.error} /> : null}
      </form>
    </Dialog>
  );
}
