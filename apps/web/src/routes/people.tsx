import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";
import { api, ApiError } from "../lib/api.ts";
import { formatBytes, formatDate, plural, relativeTime, ROLE_WORD } from "../lib/format.ts";
import { useMe } from "../lib/session.tsx";
import { usePageTitle } from "../shell/slots.tsx";
import { Avatar, Button, ButtonLink, Callout, Dialog, EmptyState, ErrorCallout, FindField, ListRow, Loading, Sheet, SheetBody, SheetHeader, StatusBadge, TextField, useToast } from "../ui/index.tsx";
import { listed } from "./delete-dialog.tsx";
import type { OrganizationImpact } from "./org.tsx";
import "../styles/screens/instance.css";

const DELETE_CONFIRMATION = "delete permanently";

interface Account {
  account_id: string;
  display_name: string;
  email: string;
  created_at: string;
  last_seen_at: string | null;
  sessions: number;
  agents: number;
  instance_owner: boolean;
  you: boolean;
  allowance: { allowed: number; created: number } | null;
  /** only_owner: nobody else owns it, so removing the account deletes it. */
  organizations: { slug: string; name: string; role: string | null; roles: number; example?: true; only_owner?: true }[];
}

/** Where someone stands in each organization, in a line: "Owner of Acme, 2 roles in Harbor Labs". */
function organizationsWords(a: Account): string {
  if (!a.organizations.length) return "No organization";
  const words = a.organizations
    .map((o) => (o.role ? `${(ROLE_WORD[o.role] ?? o.role).toLowerCase()} of ${o.name}` : `${plural(o.roles, "role")} in ${o.name}`))
    .join(", ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * `/people`: every account on this WhatBuild, for its owners: where each person is, when they were
 * last seen, and removing an account. Anyone else is told only the instance's owners see it.
 */
export function PeoplePage() {
  const me = useMe();
  const owner = me.data?.tenant_allowance.instance_owner ?? false;
  const [find, setFind] = useState("");
  const [removing, setRemoving] = useState<Account | null>(null);
  usePageTitle("People");
  const q = useQuery({ queryKey: ["accounts"], queryFn: () => api<{ instance_owners: string[]; items: Account[] }>("GET", "/api/v1/accounts"), enabled: owner });
  if (me.isPending)
    return (
      <Sheet label="Loading">
        <Loading label="Loading…" lines={3} />
      </Sheet>
    );
  if (!owner)
    return (
      <Sheet labelledBy="people-title">
        <SheetHeader level={1} id="people-title" title="People" />
        <EmptyState size="inline" action={<ButtonLink to="/">Your products</ButtonLink>}>
          Only this WhatBuild&rsquo;s owners see everyone who has an account.
        </EmptyState>
      </Sheet>
    );
  const needle = find.trim().toLowerCase();
  const all = q.data?.items ?? [];
  const items = needle ? all.filter((a) => a.display_name.toLowerCase().includes(needle) || a.email.toLowerCase().includes(needle)) : all;
  return (
    <Sheet labelledBy="people-title">
      <SheetHeader level={1} id="people-title" title="People" count={q.data ? all.length : undefined} />
      <SheetBody className="instance-intro">
        <p className="muted">
          Everyone with an account here. To let someone in, give their address an allowance on <Link to="/instance">Organizations</Link>.
        </p>
        {all.length > 8 ? <FindField label="Find a person by name or address" value={find} onChange={(e) => setFind(e.target.value)} /> : null}
      </SheetBody>
      {q.isPending ? (
        <Loading label="Loading people…" lines={4} />
      ) : q.isError ? (
        <SheetBody>
          <ErrorCallout inset error={q.error} onRetry={() => q.refetch()} />
        </SheetBody>
      ) : !items.length ? (
        <EmptyState size="inline" title={needle ? "Nobody matches" : "Nobody has an account yet"} />
      ) : (
        <div className="instance-rows">
          {items.map((a) => (
            <ListRow
              key={a.account_id}
              className="instance-row"
              lead={<Avatar name={a.display_name} />}
              title={
                <>
                  {a.display_name}
                  <span className="muted"> · {a.email}</span>
                </>
              }
              sub={[
                organizationsWords(a),
                `joined ${formatDate(a.created_at)}`,
                a.last_seen_at ? `seen ${relativeTime(a.last_seen_at)}` : null,
                a.agents ? `${plural(a.agents, "agent")} connected` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
              end={
                <span className="instance-row-end">
                  {a.you ? <StatusBadge tone="neutral">You</StatusBadge> : null}
                  {a.instance_owner ? <StatusBadge tone="positive">Owns this WhatBuild</StatusBadge> : null}
                  {!a.instance_owner ? (
                    <Button size="sm" variant="quiet" onClick={() => setRemoving(a)} aria-label={`Remove ${a.display_name}’s account`}>
                      Remove
                    </Button>
                  ) : null}
                </span>
              }
            />
          ))}
        </div>
      )}
      {removing ? <RemoveDialog account={removing} onClose={() => setRemoving(null)} /> : null}
    </Sheet>
  );
}

/** What an organization that goes with its only owner's account holds, in a line, and who else loses their roles there. */
function holdsWords(c: OrganizationImpact["contents"]): string {
  const products = c.products.length ? `${c.products.length === 1 ? "its product" : `${c.products.length} products`} (${c.products.map((p) => p.name).join(", ")})` : "no products";
  const held = listed([products, c.sources > 0 && plural(c.sources, "source"), c.stored_files > 0 && `${plural(c.stored_files, "file")} (${formatBytes(c.bytes)})`]);
  const others = c.people - 1;
  return `${held}${others > 0 ? `; ${others === 1 ? "1 other person loses their role" : `${others} other people lose their roles`} there` : ""}.`;
}

function RemoveDialog({ account: a, onClose }: { account: Account; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [typed, setTyped] = useState("");
  const matches = typed.trim().toLowerCase() === a.email.toLowerCase();
  // The organizations nobody else owns go with the account; the example organization never does.
  const alone = a.organizations.filter((o) => o.only_owner);
  const blocked = alone.find((o) => o.example);
  const impacts = useQueries({
    queries: alone.map((o) => ({ queryKey: ["delete-impact", `/api/v1/tenants/${o.slug}/delete-impact`], queryFn: () => api<OrganizationImpact>("GET", `/api/v1/tenants/${o.slug}/delete-impact`) })),
  });
  const kept = a.organizations.length - alone.length;
  const remove = useMutation({
    mutationFn: () =>
      api<{ organizations_left: number }>("POST", "/api/v1/accounts/remove", {
        account_id: a.account_id,
        email: typed.trim(),
        confirm: DELETE_CONFIRMATION,
        ...(alone.length ? { delete_organizations: alone.map((o) => o.slug) } : {}),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["accounts"] });
      void qc.invalidateQueries({ queryKey: ["tenant-allowances"] });
      void qc.invalidateQueries({ queryKey: ["instance-organizations"] });
      void qc.invalidateQueries({ queryKey: ["products"] });
      toast(alone.length ? `${a.display_name}’s account is removed, and ${listed(alone.map((o) => o.name))} ${alone.length === 1 ? "is" : "are"} deleted.` : `${a.display_name}’s account is removed.`);
      onClose();
    },
  });
  return (
    <Dialog
      open
      onClose={onClose}
      dismissable={!remove.isPending}
      title={`Remove ${a.display_name}’s account?`}
      description="This can’t be undone."
      footer={
        <>
          <Button onClick={onClose} disabled={remove.isPending}>
            Cancel
          </Button>
          <Button variant="danger" busy={remove.isPending} busyLabel="Removing…" disabled={!matches || Boolean(blocked)} onClick={() => remove.mutate()}>
            {alone.length ? `Remove account and delete ${alone.length === 1 ? alone[0]!.name : plural(alone.length, "organization")}` : "Remove account"}
          </Button>
        </>
      }
    >
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          if (matches && !blocked) remove.mutate();
        }}
      >
        {blocked ? (
          <Callout inset tone="attention" title={`${a.display_name} is the only owner of the example organization`}>
            It can&rsquo;t be deleted, so the account can&rsquo;t be removed until someone else owns {blocked.name}.
          </Callout>
        ) : alone.length ? (
          <Callout inset tone="attention" title={alone.length === 1 ? `${alone[0]!.name} is deleted too` : `${plural(alone.length, "organization")} are deleted too`}>
            <p>
              {a.display_name} is {alone.length === 1 ? "its" : "their"} only owner, so {alone.length === 1 ? "it goes" : "they go"} with the account, with everything in{" "}
              {alone.length === 1 ? "it" : "them"}:
            </p>
            <ul className="remove-orgs">
              {alone.map((o, i) => (
                <li key={o.slug}>
                  <b>{o.name}</b>
                  {": "}
                  {impacts[i]?.data ? holdsWords(impacts[i]!.data!.contents) : impacts[i]?.isError ? "what it holds couldn’t be read" : "reading what it holds…"}
                </li>
              ))}
            </ul>
          </Callout>
        ) : null}
        <ul className="instance-consequences">
          <li>They&rsquo;re signed out everywhere, and their agents are disconnected.</li>
          {kept ? <li>They lose access to {plural(kept, "organization")}{alone.length ? " they share" : ""}, and each one&rsquo;s access log records it.</li> : null}
          <li>Their {a.allowance ? "invitations and allowance are" : "invitations are"} cancelled, and their email address and usage data are deleted.</li>
          {kept || !alone.length ? <li>Anything they added {alone.length ? "to the others " : ""}stays, with their name on it.</li> : null}
          <li>We email them a confirmation{alone.length ? ` that says what was deleted with the account` : ""}.</li>
        </ul>
        <TextField label={`Type ${a.email} to confirm`} autoComplete="off" spellCheck={false} value={typed} onChange={(e) => setTyped(e.target.value)} />
        {remove.isError ? (
          <ErrorCallout inset error={remove.error} title={remove.error instanceof ApiError && remove.error.code === "last_owner" ? "Their organizations changed: close this and try again" : undefined} />
        ) : null}
      </form>
    </Dialog>
  );
}
