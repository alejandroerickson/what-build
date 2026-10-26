import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { api, ApiError, qs } from "../lib/api.ts";
import { aRole, formatBytes, formatDate, plural, ROLE_WORD, scopeWords } from "../lib/format.ts";
import { useMe, useProducts } from "../lib/session.tsx";
import { ActivityLog, type ActivityItem } from "../shell/ActivityFeed.tsx";
import { usePageTitle } from "../shell/slots.tsx";
import {
  Avatar, Button, ButtonLink, Callout, CopyField, Dialog, EmptyState, ErrorCallout, FormGrid, Glyph, Loading, Menu, MenuGroup, MenuItem, MenuRadio, MenuSeparator,
  SelectField, Sheet, SheetBody, SheetHeader, StatusBadge, TextArea, TextField, useToast,
} from "../ui/index.tsx";
import { EntryPage } from "./auth.tsx";
import { DeleteDialog, listed } from "./delete-dialog.tsx";
import "../styles/screens/account.css";
import "../styles/screens/activity.css";
import "../styles/screens/org.css";
import "../styles/screens/settings.css";



// ---- First run ----------------------------------------------------------------------------------

export function Welcome() {
  const me = useMe();
  const products = useProducts();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [org, setOrg] = useState("");
  const [product, setProduct] = useState("");
  const [concept, setConcept] = useState("");
  const create = useMutation({
    mutationFn: async () => {
      const t = await api<{ tenant: { slug: string }; team: { slug: string } }>("POST", "/api/v1/tenants", { name: org.trim() });
      const p = await api<{ path: string }>("POST", `/api/v1/teams/${t.tenant.slug}/${t.team.slug}/products`, { name: product.trim(), concept });
      return p.path;
    },
    onSuccess: async (path) => {
      await qc.invalidateQueries({ queryKey: ["products"] });
      navigate(`/t/${path}/idea`);
    },
  });
  const first = me.data?.display_name.split(" ")[0];
  const allowance = me.data?.tenant_allowance;
  // The example organization is everyone's to read, not one of theirs.
  const hasOrgs = Boolean(products.data?.tenants.some((t) => !t.example));
  const example = products.data?.tenants.find((t) => t.example);
  // Nothing here for them to set up: only the people who run this WhatBuild let anyone start an organization.
  if (me.data && allowance?.remaining === 0) {
    return (
      <EntryPage title="Welcome · WhatBuild" wide>
        <Sheet labelledBy="welcome-title">
          <SheetHeader level={1} id="welcome-title" title={hasOrgs ? "You can’t start another organization" : first ? `Welcome, ${first}` : "Welcome"} />
          <SheetBody className="entry-form">
            {!hasOrgs ? (
              <>
                <p>You&rsquo;re not in an organization yet. Ask someone who uses WhatBuild to invite you.</p>
                <p className="muted">To start an organization of your own, ask this WhatBuild&rsquo;s owners.</p>
              </>
            ) : (
              <p className="muted">
                {allowance.allowed ? `You’ve started ${allowance.created === 1 ? "1 organization" : `${allowance.created} organizations`}, the most this account can. ` : ""}
                To start another, ask this WhatBuild&rsquo;s owners.
              </p>
            )}
          </SheetBody>
        </Sheet>
        <p className="entry-foot">
          Signed in as {me.data.email}. {hasOrgs || example ? <Link to="/">See {hasOrgs ? "your products" : "the example organization"}</Link> : <Link to="/settings">Your settings</Link>}.
        </p>
      </EntryPage>
    );
  }
  return (
    <EntryPage title="Welcome · WhatBuild" wide>
      <Sheet labelledBy="welcome-title">
        <SheetHeader level={1} id="welcome-title" title={hasOrgs ? "New organization" : first ? `Welcome, ${first}` : "Welcome"} />
        <form
          className="sheet-body entry-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (org.trim() && product.trim()) create.mutate();
          }}
        >
          <p className="muted">
            Name your organization and its first product.
            {allowance?.remaining
              ? ` This account can start ${allowance.remaining}${allowance.created ? " more" : ""} organization${allowance.remaining === 1 ? "" : "s"}.`
              : ""}
            {me.data?.new_organization_plan === "free" ? " It starts on the free plan, which limits how much is added each day." : ""}
          </p>
          <TextField label="Organization" hint="Your company or group." required maxLength={100} value={org} onChange={(e) => setOrg(e.target.value)} />
          <TextField label="Product" hint="What this discovery is about." required maxLength={100} value={product} onChange={(e) => setProduct(e.target.value)} />
          <TextArea label="Product concept" optional hint="Who it’s for, their problem, and how the product solves it." maxLength={2000} rows={3} value={concept} onChange={(e) => setConcept(e.target.value)} />
          {create.isError ? <ErrorCallout inset error={create.error} /> : null}
          <Button type="submit" variant="primary" busy={create.isPending} busyLabel="Starting…" disabled={!org.trim() || !product.trim()}>
            Start organization
          </Button>
        </form>
      </Sheet>
      <p className="entry-foot">
        Have an invitation? Open its link instead.{hasOrgs || example ? <> <Link to="/">Back to {hasOrgs ? "your products" : "the example organization"}</Link></> : null}
      </p>
    </EntryPage>
  );
}

// ---- Members ------------------------------------------------------------------------------------

interface MemberGrant {
  membership_id: string;
  scope_type: "tenant" | "team" | "product";
  scope_id: string;
  scope: { name: string; slug: string };
  role: string;
  since: string;
}
interface MembersResponse {
  members: { account_id: string; display_name: string; email: string; grants: MemberGrant[] }[];
  invitations: { invitation_id: string; email: string; scope_type: "tenant" | "team" | "product"; scope_id: string; scope: { name: string }; role: string; expires_at: string }[];
  /** A guest of the example organization, who sees none of its people. */
  guest?: true;
  /** Below an owner or admin of the organization: only the people, roles and invitations on what this person reads. */
  partial?: boolean;
}

type Member = MembersResponse["members"][number];

/** The request body that names a grant's scope; the organization itself needs neither team nor product. */
function scopeBody(g: { scope_type: string; scope_id: string }) {
  return g.scope_type === "team" ? { team: g.scope_id } : g.scope_type === "product" ? { product: g.scope_id } : {};
}

/** Everyone listed is in the organization; with no organization role of their own, they are a member through their team and product roles. */
function orgRoleOf(m: Member) {
  return m.grants.find((g) => g.scope_type === "tenant")?.role ?? "member";
}

const ORG_ROLE_HINT: Record<string, string> = {
  owner: "Admin of everything, and can make other owners",
  admin: "Admin of every team and product",
  member: "Opens only what they have a role on",
};

export function MembersPage() {
  const { tenant = "" } = useParams();
  const products = useProducts();
  const me = useMe();
  const qc = useQueryClient();
  const toast = useToast();
  const [giving, setGiving] = useState<{ email?: string } | null>(null);
  const [removing, setRemoving] = useState<{ m: Member; g?: MemberGrant } | null>(null);
  const t = products.data?.tenants.find((x) => x.slug === tenant);
  const q = useQuery({
    queryKey: ["members", tenant],
    // Asked only once the products say whether this person may see the members, so someone who
    // reads only the Story is never refused (and their browser logs no refusal).
    enabled: !products.isPending && !t?.story_only,
    retry: (n, e) => !(e instanceof ApiError && e.status === 403) && n < 2,
    queryFn: () => api<MembersResponse>("GET", `/api/v1/tenants/${tenant}/members`),
  });
  // Someone who reads only the Story here sees none of the organization's people.
  const storyOnly = Boolean(t?.story_only) || (q.error instanceof ApiError && q.error.status === 403);
  const orgName = t?.name ?? tenant;
  const guest = Boolean(q.data?.guest);
  usePageTitle("Members");
  const tenantAdmin = t?.your_role === "owner" || t?.your_role === "admin";
  const inOrg = (products.data?.items ?? []).filter((p) => p.tenant.slug === tenant);
  const canManage = (g: { scope_type: string; scope_id: string; role: string }) => {
    if (g.scope_type === "tenant") return g.role === "owner" ? t?.your_role === "owner" : tenantAdmin;
    if (g.scope_type === "team") return tenantAdmin || t?.teams.find((tm) => tm.team_id === g.scope_id)?.your_role === "admin";
    return tenantAdmin || inOrg.find((p) => p.product_id === g.scope_id)?.your_role === "admin";
  };
  const canGive = tenantAdmin || Boolean(t?.teams.some((tm) => tm.your_role === "admin")) || inOrg.some((p) => p.your_role === "admin");
  const refresh = () => void qc.invalidateQueries({ queryKey: ["members", tenant] });
  const grant = useMutation({
    mutationFn: (v: { email: string; role: string; scope_type: string; scope_id: string }) =>
      api("POST", `/api/v1/tenants/${tenant}/members`, { email: v.email, role: v.role, ...scopeBody(v) }),
    onSuccess: refresh,
    onError: (e) => toast(`Couldn’t change the role. ${(e as Error).message}`, { tone: "negative" }),
  });
  const revoke = useMutation({
    mutationFn: (v: { m: Member; g: MemberGrant }) => api("POST", `/api/v1/tenants/${tenant}/members/revoke`, { account_id: v.m.account_id, ...scopeBody(v.g) }),
    onSuccess: (_r, { m, g }) => {
      refresh();
      toast(`Removed ${m.display_name}’s ${g.role} role on ${scopeWords(g.scope_type, g.scope.name)}.`, {
        action: { label: "Undo", onClick: () => grant.mutate({ email: m.email, role: g.role, scope_type: g.scope_type, scope_id: g.scope_id }) },
      });
    },
    onError: (e) => toast(`Couldn’t remove that role. ${(e as Error).message}`, { tone: "negative" }),
  });
  // A person's last role is their place in the organization: removing it takes them out, so it asks
  // first. A partial list may not show every role they hold, so it never claims one is their last.
  const removeGrant = (m: Member, g: MemberGrant) => (m.grants.length === 1 && !q.data?.partial ? setRemoving({ m, g }) : revoke.mutate({ m, g }));
  const setOrgRole = (m: Member, role: string) => {
    const was = orgRoleOf(m);
    if (role === was) return;
    grant.mutate(
      { email: m.email, role, scope_type: "tenant", scope_id: "" },
      {
        onSuccess: () =>
          toast(`${m.display_name} is now ${aRole(role)} of ${orgName}.`, {
            action: { label: "Undo", onClick: () => grant.mutate({ email: m.email, role: was, scope_type: "tenant", scope_id: "" }) },
          }),
      },
    );
  };
  const cancel = useMutation({
    mutationFn: (id: string) => api("POST", `/api/v1/tenants/${tenant}/invitations/cancel`, { invitation_id: id }),
    onSuccess: () => {
      refresh();
      toast("Invitation cancelled. Its link no longer works.");
    },
    onError: (e) => toast(`Couldn’t cancel the invitation. ${(e as Error).message}`, { tone: "negative" }),
  });
  if (storyOnly)
    return (
      <Sheet className="members-sheet" labelledBy="members-title">
        <SheetHeader level={1} id="members-title" title="Members" />
        <SheetBody>
          <EmptyState title="Members aren’t shown to Story readers" action={<ButtonLink to="/">Go to your products</ButtonLink>}>
            An admin of one of its products can give you more access.
          </EmptyState>
        </SheetBody>
      </Sheet>
    );
  return (
    <>
      <Sheet className="members-sheet" labelledBy="members-title">
        <SheetHeader
          level={1}
          id="members-title"
          title="Members"
          count={q.data?.members.length}
          end={canGive ? <Button variant="primary" icon="user-plus" onClick={() => setGiving({})}>Give access</Button> : null}
        />
        <SheetBody className="members-intro">
          {guest ? (
            <Callout inset tone="info" title={`${orgName} is the example organization`}>
              Its people aren&rsquo;t shown to its readers.
            </Callout>
          ) : null}
          {guest ? null : (
          <>
          {q.data?.partial ? <p className="muted">You see the people on the teams and products you can open, and the organization&rsquo;s owners and admins.</p> : null}
          <div className="members-legend">
            <div className="members-legend-group">
              <p id="legend-org" className="members-legend-head">Roles in the organization</p>
              <dl aria-labelledby="legend-org">
                {["owner", "admin", "member"].map((r) => (
                  <div key={r}>
                    <dt>{ROLE_WORD[r]}</dt>
                    <dd>{ORG_ROLE_HINT[r]}</dd>
                  </div>
                ))}
              </dl>
            </div>
            <div className="members-legend-group">
              <p id="legend-scope" className="members-legend-head">Roles on a team or product</p>
              <dl aria-labelledby="legend-scope">
                <div><dt>Admin</dt><dd>Also manages its settings and people</dd></div>
                <div><dt>Editor</dt><dd>Reads and writes</dd></div>
                <div><dt>Viewer</dt><dd>Reads</dd></div>
                <div><dt>Reader</dt><dd>Reads only the Story</dd></div>
              </dl>
            </div>
          </div>
          <p className="members-legend-foot">
            A team role covers every product in the team, and the highest role wins.
          </p>
          </>
          )}
        </SheetBody>
        {q.isPending ? (
          <Loading label="Loading members…" lines={4} />
        ) : q.isError ? (
          <SheetBody>
            <ErrorCallout inset error={q.error} onRetry={() => q.refetch()} />
          </SheetBody>
        ) : (
          <ul className="members-list">
            {q.data.members.map((m) => {
              const self = m.account_id === me.data?.account_id;
              const orgRole = orgRoleOf(m);
              const orgAdmin = orgRole === "owner" || orgRole === "admin";
              const access = m.grants.filter((g) => g.scope_type !== "tenant");
              const manageOrg = !self && canManage({ scope_type: "tenant", scope_id: "", role: orgRole });
              return (
                <li key={m.account_id} className="members-row">
                  <Avatar name={m.display_name} />
                  <div className="members-person">
                    <span className="members-name">
                      {m.display_name}
                      {self ? <span className="faint"> (you)</span> : null}
                    </span>
                    <span className="members-email">{m.email}</span>
                  </div>
                  <dl className="members-roles">
                    <div className="members-roles-line">
                      <dt>Organization</dt>
                      <dd>
                        <b>{ROLE_WORD[orgRole]}</b>
                      </dd>
                    </div>
                    <div className="members-roles-line">
                      <dt>Access</dt>
                      <dd>
                        {orgAdmin ? <span className="members-grant muted">Admin of every team and product, as an organization {orgRole}</span> : null}
                        {access.length ? (
                          <ul className="members-grants" aria-label={`${m.display_name}’s team and product roles`}>
                            {access.map((g) => (
                              <li key={g.membership_id} className="members-grant">
                                <span>
                                  <b>{ROLE_WORD[g.role] ?? g.role}</b> <span className="muted">on {scopeWords(g.scope_type, g.scope.name)}</span>
                                </span>
                                {canManage(g) ? (
                                  <Button
                                    size="sm"
                                    variant="quiet"
                                    aria-label={`Remove ${m.display_name}’s ${g.role} role on ${scopeWords(g.scope_type, g.scope.name)}`}
                                    busy={revoke.isPending && revoke.variables?.g.membership_id === g.membership_id}
                                    onClick={() => removeGrant(m, g)}
                                  >
                                    Remove
                                  </Button>
                                ) : null}
                              </li>
                            ))}
                          </ul>
                        ) : orgAdmin ? null : (
                          <span className="members-grant members-none">
                            <span>No team or product yet, so {self ? "you can’t" : "they can’t"} open anything.</span>
                            {canGive ? (
                              <Button size="sm" variant="quiet" onClick={() => setGiving({ email: m.email })}>
                                Give access
                              </Button>
                            ) : null}
                          </span>
                        )}
                      </dd>
                    </div>
                  </dl>
                  <div className="members-actions">
                    {manageOrg ? (
                      <Menu label={`Actions for ${m.display_name}`} triggerClassName="icon-btn icon-btn-sm" trigger={<Glyph name="ellipsis" />} align="end" minWidth={260}>
                        <MenuItem icon="user-plus" onSelect={() => setGiving({ email: m.email })}>
                          Give access to a team or product…
                        </MenuItem>
                        <MenuSeparator />
                        <MenuGroup label={`Role in ${orgName}`}>
                          {(t?.your_role === "owner" ? ["member", "admin", "owner"] : ["member", "admin"]).map((r) => (
                            <MenuRadio key={r} checked={orgRole === r} meta={ORG_ROLE_HINT[r]} onSelect={() => setOrgRole(m, r)}>
                              {ROLE_WORD[r]}
                            </MenuRadio>
                          ))}
                        </MenuGroup>
                        <MenuSeparator />
                        <MenuItem icon="x" tone="danger" onSelect={() => setRemoving({ m })}>
                          Remove from {orgName}…
                        </MenuItem>
                      </Menu>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Sheet>
      {q.data?.invitations.length ? (
        <Sheet labelledBy="invites-title">
          <SheetHeader id="invites-title" title="Waiting to join" count={q.data.invitations.length} />
          <ul className="members-list">
            {q.data.invitations.map((i) => (
              <li key={i.invitation_id} className="members-row members-invite">
                <span className="members-face-empty" aria-hidden="true">
                  <Glyph name="clock" size="sm" />
                </span>
                <div className="members-person">
                  <span className="members-name">{i.email}</span>
                  <span className="members-email">
                    Invited as {i.role} on {scopeWords(i.scope_type, i.scope.name)} · expires {formatDate(i.expires_at)}
                  </span>
                </div>
                <div className="members-grants">
                  {canManage(i) ? (
                    <Button size="sm" variant="quiet" busy={cancel.isPending && cancel.variables === i.invitation_id} onClick={() => cancel.mutate(i.invitation_id)}>
                      Cancel invitation
                    </Button>
                  ) : (
                    <StatusBadge tone="attention">Invited</StatusBadge>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </Sheet>
      ) : null}
      {tenantAdmin ? <AccessChanges tenant={tenant} /> : null}
      {t && tenantAdmin ? <OrganizationNameSheet key={t.name_etag} slug={t.slug} name={t.name} etag={t.name_etag} owner={t.your_role === "owner"} /> : null}
      {t?.your_role === "owner" && !t.example ? <DeleteOrganizationSheet tenant={tenant} orgName={orgName} /> : null}
      {giving ? (
        <GiveAccessDialog tenant={tenant} orgName={orgName} initialEmail={giving.email} onClose={() => setGiving(null)} canManage={canManage} tenantAdmin={tenantAdmin} ownerHere={t?.your_role === "owner"} />
      ) : null}
      {removing ? <RemoveMemberDialog tenant={tenant} orgName={orgName} member={removing.m} lastGrant={removing.g} tenantAdmin={tenantAdmin} onClose={() => setRemoving(null)} /> : null}
    </>
  );
}

/**
 * The organization's name, which its owners change here, and its admins read. Its short name in
 * links stays, so every product's address, a connected agent and a link to its Story keep working.
 * Keyed by the name's etag, so a rename made elsewhere starts the form again from the new name.
 */
function OrganizationNameSheet({ slug, name, etag, owner }: { slug: string; name: string; etag: string; owner: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [draft, setDraft] = useState(name);
  const dirty = draft.trim() !== name;
  const save = useMutation({
    mutationFn: () => api<{ name: string }>("PATCH", `/api/v1/tenants/${slug}`, { name: draft.trim(), expected_etag: etag }),
    onSuccess: (r) => {
      toast(`Renamed to ${r.name}.`);
      void qc.invalidateQueries({ queryKey: ["products"] });
      void qc.invalidateQueries({ queryKey: ["product"] });
      void qc.invalidateQueries({ queryKey: ["members", slug] });
      void qc.invalidateQueries({ queryKey: ["limits", slug] });
    },
  });
  return (
    <Sheet className="settings-sheet" labelledBy="org-name-title">
      <SheetHeader id="org-name-title" title="Organization name" />
      {owner ? null : (
        <div className="settings-note">
          <Callout inset tone="info">Only its owners can rename it.</Callout>
        </div>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (owner && dirty && draft.trim()) save.mutate();
        }}
      >
        <FormGrid className="settings-form">
          <TextField label="Name" value={draft} onChange={(e) => setDraft(e.target.value)} readOnly={!owner} maxLength={100} required />
          <TextField label="Short name in links" value={slug} readOnly spellCheck={false} hint="Stays the same when it’s renamed, so links and connected agents keep working." />
        </FormGrid>
        {save.isError ? (
          <div className="settings-note">
            <ErrorCallout inset error={save.error} onRetry={save.error instanceof ApiError && save.error.code === "stale_etag" ? () => void qc.invalidateQueries({ queryKey: ["products"] }) : undefined} />
          </div>
        ) : null}
        {owner ? (
          <div className="settings-actions">
            <Button type="submit" variant="primary" busy={save.isPending} busyLabel="Renaming…" disabled={!dirty || !draft.trim()}>
              Rename
            </Button>
            {dirty ? (
              <Button
                variant="quiet"
                onClick={() => {
                  setDraft(name);
                  save.reset();
                }}
              >
                Discard changes
              </Button>
            ) : null}
          </div>
        ) : null}
      </form>
    </Sheet>
  );
}

/** What deleting an organization destroys, as products.delete_tenant_impact reports it. */
interface OrganizationImpact {
  contents: { teams: number; products: { product_id: string; name: string; archived: boolean }[]; sources: number; stored_files: number; bytes: number; people: number; pending_invitations: number };
}

/**
 * What deleting an organization takes, as its dialog says it, leaving out a count of none: what
 * goes (its teams and products, with their sources and stored files), and who loses what (the
 * people with roles here, and the invitations still open), or null when nobody does.
 */
export function organizationImpactWords(name: string, c: OrganizationImpact["contents"]): { goes: string; people: string | null } {
  const held = listed([
    c.teams > 0 && (c.teams === 1 ? "its team" : `its ${c.teams} teams`),
    c.products.length > 0 && (c.products.length === 1 ? "its product" : `all ${c.products.length} of its products`),
  ]);
  const within = listed([c.sources > 0 && plural(c.sources, "source"), c.stored_files > 0 && `${plural(c.stored_files, "stored file")} (${formatBytes(c.bytes)})`]);
  const lose = c.people > 0 && `${c.people === 1 ? "1 person loses" : `${c.people} people lose`} their roles here`;
  const stop = c.pending_invitations > 0 && (c.pending_invitations === 1 ? "1 invitation stops working" : `${c.pending_invitations} invitations stop working`);
  return {
    goes: `Everything in ${name} goes at once${held ? `: ${held}${within ? `, with ${within}` : ""}` : ""}.`,
    people: lose ? `${lose}${stop ? `, and ${stop}` : ""}. Their accounts, and their roles in other organizations, stay.` : stop ? `${stop}.` : null,
  };
}

/**
 * Delete the whole organization: an owner's act in the web app alone, never an agent's, with the
 * organization's name typed to confirm.
 */
function DeleteOrganizationSheet({ tenant, orgName }: { tenant: string; orgName: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  return (
    <Sheet labelledBy="delete-org-title">
      <SheetHeader id="delete-org-title" title="Delete this organization" />
      <SheetBody className="stack-sm">
        <p className="muted">Deleting {orgName} erases every team and product in it, and every role and invitation. It can’t be undone.</p>
        <div>
          <Button variant="danger" icon="trash" onClick={() => setOpen(true)}>
            Delete {orgName} permanently…
          </Button>
        </div>
      </SheetBody>
      {open ? (
        <DeleteDialog<OrganizationImpact>
          title={`Delete ${orgName} permanently?`}
          impactPath={`/api/v1/tenants/${tenant}/delete-impact`}
          deletePath={`/api/v1/tenants/${tenant}`}
          typeToConfirm={{ what: "organization", name: orgName }}
          renderImpact={({ contents: c }) => {
            const words = organizationImpactWords(orgName, c);
            return (
              <>
                <p>{words.goes}</p>
                {c.products.length ? (
                  <ul className="delete-impact-list">
                    {c.products.map((p) => (
                      <li key={p.product_id}>
                        {p.name}
                        {p.archived ? <span className="faint"> · archived</span> : null}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {words.people ? <p>{words.people}</p> : null}
              </>
            );
          }}
          onDeleted={() => {
            void qc.invalidateQueries({ queryKey: ["products"] });
            try {
              if (localStorage.getItem("whatbuild.last-product")?.startsWith(`${tenant}/`)) localStorage.removeItem("whatbuild.last-product");
            } catch {
              // Storage may be blocked.
            }
            toast(`Deleted ${orgName}.`);
            navigate("/");
          }}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </Sheet>
  );
}

/**
 * The organization's access log, for its owners and admins: who gave, changed or removed whose
 * access. A product's own Activity leaves these out.
 */
function AccessChanges({ tenant }: { tenant: string }) {
  const q = useInfiniteQuery({
    queryKey: ["members", tenant, "activity"],
    queryFn: ({ pageParam }) =>
      api<{ items: ActivityItem[]; next_cursor: string | null }>("GET", `/api/v1/tenants/${tenant}/members/activity${qs({ cursor: pageParam, limit: 50 })}`),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  });
  return (
    <Sheet labelledBy="access-changes-title">
      <SheetHeader id="access-changes-title" title="Access changes" />
      <ActivityLog
        query={q}
        linkOf={() => null}
        empty={<EmptyState size="inline" title="No access changes yet" />}
      />
    </Sheet>
  );
}

/**
 * Taking someone out of the organization asks first and says what they lose. It comes from "Remove
 * from the organization", or from removing a person's only role, which has the same effect.
 */
function RemoveMemberDialog({ tenant, orgName, member: m, lastGrant, tenantAdmin, onClose }: {
  tenant: string;
  orgName: string;
  member: Member;
  lastGrant?: MemberGrant;
  tenantAdmin: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const remove = useMutation({
    mutationFn: async (keepAsMember: boolean) => {
      if (lastGrant && keepAsMember) await api("POST", `/api/v1/tenants/${tenant}/members`, { email: m.email, role: "member" });
      if (lastGrant) return api("POST", `/api/v1/tenants/${tenant}/members/revoke`, { account_id: m.account_id, ...scopeBody(lastGrant) });
      return api("POST", `/api/v1/tenants/${tenant}/members/revoke`, { account_id: m.account_id, whole_tenant: true });
    },
    onSuccess: (_r, keepAsMember) => {
      void qc.invalidateQueries({ queryKey: ["members", tenant] });
      toast(keepAsMember ? `Removed ${m.display_name}’s role. They stay in ${orgName} as a member.` : `Removed ${m.display_name} from ${orgName}.`);
      onClose();
    },
  });
  const grantWords = (g: MemberGrant) => (g.scope_type === "tenant" ? `${ROLE_WORD[g.role]} of the organization` : `${ROLE_WORD[g.role]} on ${scopeWords(g.scope_type, g.scope.name)}`);
  return (
    <Dialog
      open
      onClose={onClose}
      dismissable={!remove.isPending}
      title={`Remove ${m.display_name} from ${orgName}?`}
      description={
        lastGrant
          ? `${grantWords(lastGrant)} is ${m.display_name}’s only role here, so removing it removes them from the organization.`
          : `${m.display_name} loses every role here.`
      }
      footer={
        <>
          <Button onClick={onClose} disabled={remove.isPending}>
            Cancel
          </Button>
          {lastGrant && tenantAdmin ? (
            <Button disabled={remove.isPending} busy={remove.isPending && remove.variables} busyLabel="Removing…" onClick={() => remove.mutate(true)}>
              Remove role, keep as member
            </Button>
          ) : null}
          <Button variant="danger" disabled={remove.isPending} busy={remove.isPending && !remove.variables} busyLabel="Removing…" onClick={() => remove.mutate(false)}>
            Remove from organization
          </Button>
        </>
      }
    >
      <div className="stack-sm">
        {!lastGrant ? (
          <ul className="members-losing" aria-label="Roles they lose">
            {m.grants.map((g) => (
              <li key={g.membership_id}>{grantWords(g)}</li>
            ))}
          </ul>
        ) : null}
        {remove.isError ? (
          <ErrorCallout inset error={remove.error} />
        ) : (
          <p className="muted">What they wrote stays, attributed to them.</p>
        )}
      </div>
    </Dialog>
  );
}

const ROLE_MEANING: Record<string, string> = {
  owner: "Admin of every team and product, and can make other owners.",
  admin: "Admin of every team and product in the organization.",
  member: "Can’t open any product until they also have a team or product role.",
};
const SCOPE_ROLE_MEANING: Record<string, string> = {
  viewer: "Reads everything, changes nothing.",
  reader: "Reads only the Story.",
  editor: "Reads and writes everything, including the Story.",
  admin: "Reads and writes, and also manages settings and people.",
};

function GiveAccessDialog({ tenant, orgName, initialEmail, onClose, canManage, tenantAdmin, ownerHere }: {
  tenant: string;
  orgName: string;
  initialEmail?: string | undefined;
  onClose: () => void;
  canManage: (g: { scope_type: string; scope_id: string; role: string }) => boolean;
  tenantAdmin: boolean;
  ownerHere: boolean;
}) {
  const products = useProducts();
  const qc = useQueryClient();
  const toast = useToast();
  const t = products.data?.tenants.find((x) => x.slug === tenant);
  // Teams and products first: they are what lets someone open a product. The organization role comes last.
  const targets = [
    ...(t?.teams ?? []).filter((tm) => canManage({ scope_type: "team", scope_id: tm.team_id, role: "editor" })).map((tm) => ({ value: tm.slug, label: `Team: ${tm.name} (every product in it)`, words: scopeWords("team", tm.name), roles: ["reader", "viewer", "editor", "admin"] })),
    ...(products.data?.items ?? [])
      .filter((p) => p.tenant.slug === tenant && canManage({ scope_type: "product", scope_id: p.product_id, role: "editor" }))
      .map((p) => ({ value: `${p.team.slug}/${p.path.split("/")[2]}`, label: `Product: ${p.name}`, words: p.name, roles: ["reader", "viewer", "editor", "admin"] })),
    ...(tenantAdmin ? [{ value: "", label: `Organization: ${orgName}`, words: orgName, roles: ownerHere ? ["member", "admin", "owner"] : ["member", "admin"] }] : []),
  ];
  const [email, setEmail] = useState(initialEmail ?? "");
  const [target, setTarget] = useState(targets[0]?.value ?? "");
  const roles = targets.find((x) => x.value === target)?.roles ?? ["reader", "viewer", "editor", "admin"];
  const [role, setRole] = useState(target ? "editor" : "member");
  const [link, setLink] = useState<string | null>(null);
  const meaning = (target ? SCOPE_ROLE_MEANING : ROLE_MEANING)[role];
  const grant = useMutation({
    mutationFn: () => {
      const [team, product] = target.split("/");
      return api<{ invited: boolean; invite_link?: string }>("POST", `/api/v1/tenants/${tenant}/members`, { email: email.trim(), role, ...(team ? { team } : {}), ...(product ? { product } : {}) });
    },
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ["members", tenant] });
      if (r.invited) {
        setLink(r.invite_link ?? null);
        toast(`Invitation created for ${email.trim()}.`);
      } else {
        const where = targets.find((x) => x.value === target)?.words ?? orgName;
        toast(`${email.trim()} is now ${aRole(role)} ${target ? "on" : "of"} ${where}.`);
        onClose();
      }
    },
  });
  const valid = /\S+@\S+\.\S+/.test(email.trim());
  return (
    <Dialog
      open
      onClose={onClose}
      dismissable={!grant.isPending}
      title="Give someone access"
      description="People already on WhatBuild get the role right away. Anyone else gets an invitation link that works for 7 days."
      footer={
        link ? (
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        ) : (
          <>
            <Button onClick={onClose} disabled={grant.isPending}>
              Cancel
            </Button>
            <Button variant="primary" busy={grant.isPending} busyLabel="Saving…" disabled={!valid || !targets.length} onClick={() => grant.mutate()}>
              Give access
            </Button>
          </>
        )
      }
    >
      {link ? (
        <div className="stack-sm">
          <Callout inset tone="positive" title="Invitation created">
            We email it where email is set up. You can also share the link: it works once, within 7 days, and only for {email.trim()}.
          </Callout>
          <CopyField label="Invitation link" value={link} />
        </div>
      ) : (
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) grant.mutate();
          }}
        >
          <TextField label="Email" type="email" required autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} />
          <SelectField
            label="Give access to"
            value={target}
            onChange={(e) => {
              setTarget(e.target.value);
              setRole(e.target.value ? "editor" : "member");
            }}
          >
            {targets.map((x) => (
              <option key={x.value} value={x.value}>
                {x.label}
              </option>
            ))}
          </SelectField>
          <SelectField label="Role" value={role} onChange={(e) => setRole(e.target.value)} hint={target || role !== "member" ? meaning : undefined}>
            {roles.map((r) => (
              <option key={r} value={r}>
                {ROLE_WORD[r]}
              </option>
            ))}
          </SelectField>
          {!target && role === "member" ? (
            <Callout inset tone="attention" title="A member can’t open any product yet">
              To let them read or write, choose a team or product under Give access to.
            </Callout>
          ) : null}
          {grant.isError ? <ErrorCallout inset error={grant.error} /> : null}
        </form>
      )}
    </Dialog>
  );
}
