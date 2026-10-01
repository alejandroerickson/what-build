import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { api } from "../lib/api.ts";
import { aRole, formatDate, ROLE_WORD, scopeWords } from "../lib/format.ts";
import { useMe, useProducts } from "../lib/session.tsx";
import { usePageTitle } from "../shell/slots.tsx";
import {
  Avatar, Button, ButtonLink, Callout, CopyField, Dialog, ErrorCallout, Glyph, Loading, Menu, MenuGroup, MenuItem, MenuRadio, MenuSeparator,
  SelectField, Sheet, SheetBody, SheetHeader, StatusBadge, TextArea, TextField, useToast,
} from "../ui/index.tsx";
import { EntryPage } from "./auth.tsx";
import "../styles/screens/account.css";
import "../styles/screens/org.css";



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
  const hasOrgs = Boolean(products.data?.tenants.length);
  // Nothing here for them to set up: only the people who run this WhatBuild let anyone start an organization.
  if (me.data && allowance?.remaining === 0) {
    const sandboxOnly = me.data.sandbox_only && !hasOrgs;
    return (
      <EntryPage title="Welcome · WhatBuild" wide>
        <Sheet labelledBy="welcome-title">
          <SheetHeader level={1} id="welcome-title" title={sandboxOnly ? "You’re not in the sandbox right now" : hasOrgs ? "You can’t start another organization" : first ? `Welcome, ${first}` : "Welcome"} />
          <SheetBody className="entry-form">
            {sandboxOnly ? (
              <p>
                Your account works only in the public sandbox. To enter, open your invitation link. If you were in before, your seat was freed after a long time away, or removed by the sandbox&rsquo;s admins.
              </p>
            ) : !hasOrgs ? (
              <>
                <p>You&rsquo;re signed in, but not in an organization yet. Ask someone who uses WhatBuild to invite you, and their products appear here.</p>
                <p className="muted">To start an organization of your own, ask this WhatBuild&rsquo;s owners.</p>
              </>
            ) : (
              <p className="muted">
                {allowance.allowed ? `You’ve started ${allowance.created === 1 ? "one organization" : `${allowance.created} organizations`}, the most this account can. ` : ""}
                This WhatBuild&rsquo;s owners decide who can start organizations, and how many.
              </p>
            )}
          </SheetBody>
        </Sheet>
        <p className="entry-foot">
          Signed in as {me.data.email}. {hasOrgs ? <Link to="/">See your products</Link> : <Link to="/settings">Your settings</Link>}.
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
            Name your organization and the first product you&rsquo;re exploring. You can invite colleagues and connect an agent next.
            {allowance?.remaining
              ? ` This account can start ${allowance.remaining === 1 ? "one" : allowance.remaining}${allowance.created ? " more" : ""} organization${allowance.remaining === 1 ? "" : "s"}.`
              : ""}
          </p>
          <TextField label="Organization" hint="Your company or group. Other organizations can’t see anything in it." required maxLength={100} value={org} onChange={(e) => setOrg(e.target.value)} />
          <TextField label="Product" hint="What this discovery is about. You can add more products later." required maxLength={100} value={product} onChange={(e) => setProduct(e.target.value)} />
          <TextArea label="Product concept" optional hint="Who it’s for, the problem they have, and how the product solves it. Shown at the top of Idea." maxLength={2000} rows={3} value={concept} onChange={(e) => setConcept(e.target.value)} />
          {create.isError ? <ErrorCallout inset error={create.error} /> : null}
          <Button type="submit" variant="primary" busy={create.isPending} busyLabel="Creating…" disabled={!org.trim() || !product.trim()}>
            Create organization
          </Button>
        </form>
      </Sheet>
      <p className="entry-foot">
        Have an invitation? Open its link to join that organization instead.{hasOrgs ? <> <Link to="/">Back to your products</Link></> : null}
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
  /** In a public sandbox: a visitor is shown only themselves, and its staff get its visitors as a count. */
  sandbox?: { only_you: boolean; visitors?: number };
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
  visitor: "In a public sandbox: edits every product, sees no people",
};

export function MembersPage() {
  const { tenant = "" } = useParams();
  const products = useProducts();
  const me = useMe();
  const qc = useQueryClient();
  const toast = useToast();
  const [giving, setGiving] = useState<{ email?: string } | null>(null);
  const [removing, setRemoving] = useState<{ m: Member; g?: MemberGrant } | null>(null);
  const q = useQuery({ queryKey: ["members", tenant], queryFn: () => api<MembersResponse>("GET", `/api/v1/tenants/${tenant}/members`) });
  const t = products.data?.tenants.find((x) => x.slug === tenant);
  const orgName = t?.name ?? tenant;
  const sandbox = q.data?.sandbox;
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
  // A person's last role is their place in the organization: removing it takes them out, so it asks first.
  const removeGrant = (m: Member, g: MemberGrant) => (m.grants.length === 1 ? setRemoving({ m, g }) : revoke.mutate({ m, g }));
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
          {sandbox?.only_you ? (
            <Callout inset tone="info" title={`${orgName} is a public sandbox`}>
              Visitors never see each other, so only you are listed, under your made-up name. <Link to={`/t/${tenant}/sandbox`}>About this sandbox</Link>
            </Callout>
          ) : sandbox ? (
            <Callout inset tone="info" title={`${orgName} is a public sandbox`} action={<ButtonLink size="sm" to={`/t/${tenant}/sandbox`}>Sandbox controls</ButtonLink>}>
              {!sandbox.visitors ? "No visitors yet" : sandbox.visitors === 1 ? "1 visitor has a seat" : `${sandbox.visitors.toLocaleString("en-US")} visitors have seats`}. Visitors are managed in Sandbox controls, and can&rsquo;t see this list.
            </Callout>
          ) : null}
          {sandbox?.only_you ? null : (
          <>
          <p className="muted">
            People join {orgName} only when someone gives them access. Everyone has an organization role; team and product roles decide which products they can open.
          </p>
          <div className="members-legend">
            <div className="members-legend-group">
              <p id="legend-org" className="members-legend-head">Roles in the organization</p>
              <dl aria-labelledby="legend-org">
                {["owner", "admin", "member", ...(sandbox ? ["visitor"] : [])].map((r) => (
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
              </dl>
            </div>
          </div>
          <p className="members-legend-foot">
            A team role covers every product in the team, and the highest role wins. With no role on a product, a person can&rsquo;t see it.
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
                        {orgRole === "visitor" ? <span className="members-grant muted">Editor of every product, as a visitor to the sandbox</span> : null}
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
                        ) : orgAdmin || orgRole === "visitor" ? null : (
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
      {giving ? (
        <GiveAccessDialog tenant={tenant} orgName={orgName} initialEmail={giving.email} onClose={() => setGiving(null)} canManage={canManage} tenantAdmin={tenantAdmin} ownerHere={t?.your_role === "owner"} />
      ) : null}
      {removing ? <RemoveMemberDialog tenant={tenant} orgName={orgName} member={removing.m} lastGrant={removing.g} tenantAdmin={tenantAdmin} onClose={() => setRemoving(null)} /> : null}
    </>
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
          ? `${grantWords(lastGrant)} is ${m.display_name}’s only role here, so removing it removes them from the organization. They can no longer open any of its products.`
          : `${m.display_name} loses every role here and can no longer open any of its products.`
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
          <p className="muted">
            What they wrote stays, attributed to them. You can give them access again any time.
            {lastGrant && tenantAdmin ? " To keep them in the organization with no product access, choose Remove role, keep as member." : ""}
          </p>
        )}
      </div>
    </Dialog>
  );
}

const ROLE_MEANING: Record<string, string> = {
  owner: "Admin of every team and product, and can make other owners.",
  admin: "Admin of every team and product in the organization.",
  member: "Belongs to the organization but can’t open any product until they also have a team or product role.",
};
const SCOPE_ROLE_MEANING: Record<string, string> = {
  viewer: "Reads everything, changes nothing.",
  editor: "Reads and writes everything in the product, including the Story.",
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
    ...(t?.teams ?? []).filter((tm) => canManage({ scope_type: "team", scope_id: tm.team_id, role: "editor" })).map((tm) => ({ value: tm.slug, label: `Team: ${tm.name} (every product in it)`, words: scopeWords("team", tm.name), roles: ["viewer", "editor", "admin"] })),
    ...(products.data?.items ?? [])
      .filter((p) => p.tenant.slug === tenant && canManage({ scope_type: "product", scope_id: p.product_id, role: "editor" }))
      .map((p) => ({ value: `${p.team.slug}/${p.path.split("/")[2]}`, label: `Product: ${p.name}`, words: p.name, roles: ["viewer", "editor", "admin"] })),
    ...(tenantAdmin ? [{ value: "", label: `Organization: ${orgName}`, words: orgName, roles: ownerHere ? ["member", "admin", "owner"] : ["member", "admin"] }] : []),
  ];
  const [email, setEmail] = useState(initialEmail ?? "");
  const [target, setTarget] = useState(targets[0]?.value ?? "");
  const roles = targets.find((x) => x.value === target)?.roles ?? ["viewer", "editor", "admin"];
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
      description={`People already on WhatBuild get the role right away. Anyone else gets an invitation link that works for 7 days. Either way, they join ${orgName}.`}
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
            We email it where email is set up. You can also share the link yourself: it works once, within 7 days, and only for {email.trim()}.
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
              To let them read or write, choose a team or product under Give access to instead.
            </Callout>
          ) : null}
          {grant.isError ? <ErrorCallout inset error={grant.error} /> : null}
        </form>
      )}
    </Dialog>
  );
}
