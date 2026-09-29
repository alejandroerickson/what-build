import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { api } from "../lib/api.ts";
import { formatDate, relativeTime } from "../lib/format.ts";
import { useMe, useProducts, type ProductsResponse } from "../lib/session.tsx";
import { usePageTitle } from "../shell/slots.tsx";
import {
  Avatar, Button, ButtonLink, Callout, CopyField, Dialog, EmptyState, ErrorCallout, Glyph, ListRow, Loading, Segmented, SelectField, Sheet, SheetBody,
  SheetHeader, StatusBadge, Tag, TextArea, TextField, useToast,
} from "../ui/index.tsx";
import { EntryPage } from "./auth.tsx";
import "../styles/screens/account.css";
import "../styles/screens/org.css";

const ROLE_WORD: Record<string, string> = { owner: "Owner", admin: "Admin", member: "Member", editor: "Editor", viewer: "Viewer" };

// ---- First run ----------------------------------------------------------------------------------

export function Welcome() {
  const me = useMe();
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
  return (
    <EntryPage title="Welcome · WhatBuild" wide>
      <Sheet labelledBy="welcome-title">
        <SheetHeader level={1} id="welcome-title" title={first ? `Welcome, ${first}` : "Welcome"} />
        <form
          className="sheet-body entry-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (org.trim() && product.trim()) create.mutate();
          }}
        >
          <p className="muted">Name your organization and the product you are exploring. You can invite colleagues and connect an agent next.</p>
          <TextField label="Organization" hint="Your company or group. Nothing in it is visible to any other organization." required maxLength={100} value={org} onChange={(e) => setOrg(e.target.value)} />
          <TextField label="Product" hint="The product this discovery is about. You can run several side by side." required maxLength={100} value={product} onChange={(e) => setProduct(e.target.value)} />
          <TextArea label="Product concept" optional hint="Who it is for, the problem they have, and how the product solves it, in a few sentences. It heads the Idea screen." maxLength={2000} rows={3} value={concept} onChange={(e) => setConcept(e.target.value)} />
          {create.isError ? <ErrorCallout inset error={create.error} /> : null}
          <Button type="submit" variant="primary" busy={create.isPending} busyLabel="Creating…" disabled={!org.trim() || !product.trim()}>
            Create and continue
          </Button>
        </form>
      </Sheet>
      <p className="entry-foot">
        Invited by someone? Open the link in their invitation to join their organization instead. Already set up? <Link to="/products">See your products</Link>.
      </p>
    </EntryPage>
  );
}

// ---- Products -----------------------------------------------------------------------------------

type Tenants = ProductsResponse["tenants"];

export function ProductsPage() {
  const [params, setParams] = useSearchParams();
  const showArchived = params.get("archived") === "1";
  const products = useProducts(showArchived);
  const creating = params.get("create") === "1";
  usePageTitle("All products");
  const setCreating = (open: boolean) =>
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        if (open) next.set("create", "1");
        else next.delete("create");
        return next;
      },
      { replace: !open },
    );
  const tenants = products.data?.tenants ?? [];
  const items = products.data?.items ?? [];
  const canCreate = tenants.some((t) => t.teams.some((tm) => tm.your_role === "admin"));
  return (
    <>
      <Sheet className="products-sheet" labelledBy="products-title">
        <SheetHeader
          level={1}
          id="products-title"
          title="Products"
          count={products.data ? items.length : undefined}
          filter={
            <Segmented
              label="Which products"
              value={showArchived ? "all" : "active"}
              items={[
                { id: "active", label: "Active", to: "/products" },
                { id: "all", label: "With archived", to: "/products?archived=1" },
              ]}
            />
          }
          end={
            canCreate ? (
              <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>
                New product
              </Button>
            ) : null
          }
        />
        {products.isPending ? (
          <Loading label="Loading products…" lines={4} />
        ) : products.isError ? (
          <SheetBody>
            <ErrorCallout inset error={products.error} onRetry={() => products.refetch()} />
          </SheetBody>
        ) : !tenants.length ? (
          <EmptyState size="inline" title="You are not in any organization yet." action={<ButtonLink to="/welcome" variant="primary">Set one up</ButtonLink>}>
            Create an organization, or ask a colleague to invite you to theirs.
          </EmptyState>
        ) : (
          tenants.map((t) => (
            <section key={t.tenant_id} className="products-org" aria-labelledby={`org-${t.tenant_id}`}>
              <header className="products-org-head">
                <h2 id={`org-${t.tenant_id}`} className="products-org-name">
                  <Glyph name="building" size="sm" />
                  {t.name}
                </h2>
                {t.your_role ? <Tag>{ROLE_WORD[t.your_role] ?? t.your_role}</Tag> : null}
                <Link to={`/t/${t.slug}/members`} className="quiet-link products-org-link">
                  Members and roles
                </Link>
              </header>
              {t.teams.map((team) => {
                const ps = items.filter((p) => p.team.team_id === team.team_id);
                return (
                  <div key={team.team_id} className="products-team" role="group" aria-label={`Team ${team.name}`}>
                    <div className="products-team-name">{team.name}</div>
                    {ps.length ? (
                      ps.map((p) => (
                        <ListRow
                          key={p.product_id}
                          to={`/t/${p.path}/idea`}
                          className="products-row"
                          title={p.name}
                          sub={p.concept ? <span className="products-concept">{p.concept}</span> : <span className="faint">No product concept written yet</span>}
                          end={
                            <span className="products-end">
                              {p.archived_at ? <StatusBadge tone="neutral">Archived</StatusBadge> : null}
                              <span>{ROLE_WORD[p.your_role]}</span>
                              <span className="num">{relativeTime(p.updated_at)}</span>
                            </span>
                          }
                        />
                      ))
                    ) : (
                      <p className="products-none">{showArchived ? "No products you can see in this team." : "No active products you can see in this team."}</p>
                    )}
                  </div>
                );
              })}
            </section>
          ))
        )}
      </Sheet>
      {creating && products.data ? <CreateProductDialog onClose={() => setCreating(false)} tenants={tenants} /> : null}
    </>
  );
}

function CreateProductDialog({ onClose, tenants }: { onClose: () => void; tenants: Tenants }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const teams = tenants.flatMap((t) => t.teams.filter((tm) => tm.your_role === "admin").map((tm) => ({ key: `${t.slug}/${tm.slug}`, label: `${t.name} · ${tm.name}` })));
  const [team, setTeam] = useState(teams[0]?.key ?? "");
  const [name, setName] = useState("");
  const [concept, setConcept] = useState("");
  const create = useMutation({
    mutationFn: () => api<{ path: string }>("POST", `/api/v1/teams/${team}/products`, { name: name.trim(), concept }),
    onSuccess: async (p) => {
      await qc.invalidateQueries({ queryKey: ["products"] });
      navigate(`/t/${p.path}/idea`);
    },
  });
  return (
    <Dialog
      open
      onClose={onClose}
      dismissable={!create.isPending}
      title="New product"
      description={teams.length ? "Each product is one discovery, with its own outcomes, sources, insights and Story." : undefined}
      footer={
        teams.length ? (
          <>
            <Button onClick={onClose} disabled={create.isPending}>
              Cancel
            </Button>
            <Button variant="primary" busy={create.isPending} busyLabel="Creating…" disabled={!team || !name.trim()} onClick={() => create.mutate()}>
              Create product
            </Button>
          </>
        ) : (
          <Button onClick={onClose}>Close</Button>
        )
      }
    >
      {teams.length ? (
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            if (team && name.trim()) create.mutate();
          }}
        >
          <SelectField label="Team" value={team} onChange={(e) => setTeam(e.target.value)}>
            {teams.map((t) => (
              <option key={t.key} value={t.key}>
                {t.label}
              </option>
            ))}
          </SelectField>
          <TextField label="Name" required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
          <TextArea label="Product concept" optional rows={3} maxLength={2000} value={concept} onChange={(e) => setConcept(e.target.value)} hint="It heads the Idea screen. You can change it later in Settings." />
          {create.isError ? <ErrorCallout inset error={create.error} /> : null}
        </form>
      ) : (
        <Callout inset tone="info">
          Creating a product needs an admin role on a team. Ask a team admin, or <Link to="/welcome">set up your own organization</Link>.
        </Callout>
      )}
    </Dialog>
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
}

function scopeWords(type: string, name: string) {
  return type === "tenant" ? "the organization" : `${type === "team" ? "team" : "product"} ${name}`;
}

export function MembersPage() {
  const { tenant = "" } = useParams();
  const products = useProducts();
  const me = useMe();
  const qc = useQueryClient();
  const toast = useToast();
  const [giving, setGiving] = useState(false);
  const q = useQuery({ queryKey: ["members", tenant], queryFn: () => api<MembersResponse>("GET", `/api/v1/tenants/${tenant}/members`) });
  const t = products.data?.tenants.find((x) => x.slug === tenant);
  const orgName = t?.name ?? tenant;
  usePageTitle(`${orgName} members`);
  const tenantAdmin = t?.your_role === "owner" || t?.your_role === "admin";
  const inOrg = (products.data?.items ?? []).filter((p) => p.tenant.slug === tenant);
  const canManage = (g: { scope_type: string; scope_id: string; role: string }) => {
    if (g.scope_type === "tenant") return g.role === "owner" ? t?.your_role === "owner" : tenantAdmin;
    if (g.scope_type === "team") return tenantAdmin || t?.teams.find((tm) => tm.team_id === g.scope_id)?.your_role === "admin";
    return tenantAdmin || inOrg.find((p) => p.product_id === g.scope_id)?.your_role === "admin";
  };
  const canGive = tenantAdmin || Boolean(t?.teams.some((tm) => tm.your_role === "admin")) || inOrg.some((p) => p.your_role === "admin");
  const refresh = () => void qc.invalidateQueries({ queryKey: ["members", tenant] });
  const revoke = useMutation({
    mutationFn: (v: { account_id: string; name: string; g: MemberGrant }) =>
      api("POST", `/api/v1/tenants/${tenant}/members/revoke`, {
        account_id: v.account_id,
        ...(v.g.scope_type === "team" ? { team: v.g.scope_id } : {}),
        ...(v.g.scope_type === "product" ? { product: v.g.scope_id } : {}),
      }),
    onSuccess: (_r, v) => {
      refresh();
      toast(`Removed ${v.name}'s ${v.g.role} role on ${scopeWords(v.g.scope_type, v.g.scope.name)}.`);
    },
    onError: (e) => toast(`Couldn't remove that role. ${(e as Error).message}`, { tone: "negative" }),
  });
  const cancel = useMutation({
    mutationFn: (id: string) => api("POST", `/api/v1/tenants/${tenant}/invitations/cancel`, { invitation_id: id }),
    onSuccess: () => {
      refresh();
      toast("Invitation cancelled. Its link no longer works.");
    },
    onError: (e) => toast(`Couldn't cancel the invitation. ${(e as Error).message}`, { tone: "negative" }),
  });
  return (
    <>
      <Sheet className="members-sheet" labelledBy="members-title">
        <SheetHeader
          level={1}
          id="members-title"
          title={`${orgName} members`}
          count={q.data?.members.length}
          end={canGive ? <Button variant="primary" icon="user-plus" onClick={() => setGiving(true)}>Give access</Button> : null}
        />
        <SheetBody>
          <p className="muted">
            Roles apply to the organization, to a team (every product in it), or to one product. The highest role that applies wins; someone with no role on a product can&rsquo;t see it.
          </p>
        </SheetBody>
        {q.isPending ? (
          <Loading label="Loading members…" lines={4} />
        ) : q.isError ? (
          <SheetBody>
            <ErrorCallout inset error={q.error} onRetry={() => q.refetch()} />
          </SheetBody>
        ) : (
          <ul className="members-list">
            {q.data.members.map((m) => (
              <li key={m.account_id} className="members-row">
                <Avatar name={m.display_name} />
                <div className="members-person">
                  <span className="members-name">
                    {m.display_name}
                    {m.account_id === me.data?.account_id ? <span className="faint"> (you)</span> : null}
                  </span>
                  <span className="members-email">{m.email}</span>
                </div>
                <ul className="members-grants" aria-label={`${m.display_name}'s roles`}>
                  {m.grants.map((g) => (
                    <li key={g.membership_id} className="members-grant">
                      <span>
                        <b>{ROLE_WORD[g.role] ?? g.role}</b> <span className="muted">on {scopeWords(g.scope_type, g.scope.name)}</span>
                      </span>
                      {canManage(g) ? (
                        <Button
                          size="sm"
                          variant="quiet"
                          aria-label={`Remove ${m.display_name}'s ${g.role} role on ${scopeWords(g.scope_type, g.scope.name)}`}
                          busy={revoke.isPending && revoke.variables?.g.membership_id === g.membership_id}
                          onClick={() => revoke.mutate({ account_id: m.account_id, name: m.display_name, g })}
                        >
                          Remove
                        </Button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </Sheet>
      {q.data?.invitations.length ? (
        <Sheet labelledBy="invites-title">
          <SheetHeader id="invites-title" title="Waiting to join" count={q.data.invitations.length} />
          <ul className="members-list">
            {q.data.invitations.map((i) => (
              <li key={i.invitation_id} className="members-row">
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
      {giving ? <GiveAccessDialog tenant={tenant} orgName={orgName} onClose={() => setGiving(false)} canManage={canManage} tenantAdmin={tenantAdmin} /> : null}
    </>
  );
}

function GiveAccessDialog({ tenant, orgName, onClose, canManage, tenantAdmin }: {
  tenant: string;
  orgName: string;
  onClose: () => void;
  canManage: (g: { scope_type: string; scope_id: string; role: string }) => boolean;
  tenantAdmin: boolean;
}) {
  const products = useProducts();
  const qc = useQueryClient();
  const toast = useToast();
  const t = products.data?.tenants.find((x) => x.slug === tenant);
  const targets = [
    ...(tenantAdmin ? [{ value: "", label: `${orgName} (the whole organization)`, roles: ["member", "admin", "owner"] }] : []),
    ...(t?.teams ?? []).filter((tm) => canManage({ scope_type: "team", scope_id: tm.team_id, role: "editor" })).map((tm) => ({ value: tm.slug, label: `Team ${tm.name} (every product in it)`, roles: ["viewer", "editor", "admin"] })),
    ...(products.data?.items ?? [])
      .filter((p) => p.tenant.slug === tenant && canManage({ scope_type: "product", scope_id: p.product_id, role: "editor" }))
      .map((p) => ({ value: `${p.team.slug}/${p.path.split("/")[2]}`, label: `Product ${p.name}`, roles: ["viewer", "editor", "admin"] })),
  ];
  const [email, setEmail] = useState("");
  const [target, setTarget] = useState(targets[0]?.value ?? "");
  const roles = targets.find((x) => x.value === target)?.roles ?? ["viewer", "editor", "admin"];
  const [role, setRole] = useState(target ? "editor" : "member");
  const [link, setLink] = useState<string | null>(null);
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
        toast(`${email.trim()} now has ${role} access.`);
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
      description="People already in WhatBuild get the role at once. Anyone else gets an invitation link, valid for 7 days."
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
            We email it where email is set up. You can also send the link yourself; it works once, for 7 days.
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
            label="Where"
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
          <SelectField label="Role" value={role} onChange={(e) => setRole(e.target.value)} hint={target ? "Viewers read. Editors also write. Admins also manage people and settings." : "Members see only what they are given. Admins manage the organization; owners also manage admins."}>
            {roles.map((r) => (
              <option key={r} value={r}>
                {ROLE_WORD[r]}
              </option>
            ))}
          </SelectField>
          {grant.isError ? <ErrorCallout inset error={grant.error} /> : null}
        </form>
      )}
    </Dialog>
  );
}
