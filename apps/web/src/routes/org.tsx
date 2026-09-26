import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { api } from "../lib/api.ts";
import { formatDate, relativeTime } from "../lib/format.ts";
import { useMe, useProducts } from "../lib/session.tsx";
import { Badge, Button, Callout, Card, Dialog, EmptyState, ErrorCallout, Loading, PageHeader, SelectField, TextArea, TextField, useToast } from "../ui/index.tsx";

// ---- First run ----------------------------------------------------------------------------------

export function Welcome() {
  const me = useMe();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [org, setOrg] = useState("");
  const [product, setProduct] = useState("");
  const [idea, setIdea] = useState("");
  const create = useMutation({
    mutationFn: async () => {
      const t = await api<{ tenant: { slug: string }; team: { slug: string } }>("POST", "/api/v1/tenants", { name: org.trim() });
      const p = await api<{ path: string }>("POST", `/api/v1/teams/${t.tenant.slug}/${t.team.slug}/products`, { name: product.trim(), idea });
      return p.path;
    },
    onSuccess: async (path) => {
      await qc.invalidateQueries({ queryKey: ["products"] });
      navigate(`/t/${path}/objectives`);
    },
  });
  return (
    <div className="center-page stack-lg" style={{ maxWidth: "36rem" }}>
      <div className="stack-sm">
        <h1>Welcome{me.data ? `, ${me.data.display_name.split(" ")[0]}` : ""}</h1>
        <p className="muted">Name your organization and the product you are exploring. You can invite colleagues and connect an agent next.</p>
      </div>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        <TextField label="Organization" hint="Your company or group. Nothing in it is visible to any other organization." required maxLength={100} value={org} onChange={(e) => setOrg(e.target.value)} />
        <TextField label="Product" hint="The product this discovery is about. You can run several discoveries side by side." required maxLength={100} value={product} onChange={(e) => setProduct(e.target.value)} />
        <TextArea label="The idea" optional hint="What you think the product could be, in a few sentences. It heads the Objectives screen." maxLength={2000} value={idea} onChange={(e) => setIdea(e.target.value)} />
        {create.isError ? <ErrorCallout error={create.error} /> : null}
        <Button type="submit" variant="primary" busy={create.isPending} busyLabel="Creating…" disabled={!org.trim() || !product.trim()}>
          Create and continue
        </Button>
      </form>
    </div>
  );
}

// ---- Products -----------------------------------------------------------------------------------

export function ProductsPage() {
  const [params, setParams] = useSearchParams();
  const showArchived = params.get("archived") === "1";
  const products = useProducts(showArchived);
  const [creating, setCreating] = useState(params.get("create") === "1");
  if (products.isPending) return <Loading />;
  if (products.isError) return <ErrorCallout error={products.error} onRetry={() => products.refetch()} />;
  const { items, tenants } = products.data;
  return (
    <div className="stack-lg">
      <PageHeader
        title="Products"
        description="Each product is one discovery, with its own objectives, sources, insights and Story."
        actions={
          <>
            <Button onClick={() => setParams(showArchived ? {} : { archived: "1" })}>{showArchived ? "Hide archived" : "Show archived"}</Button>
            <Button variant="primary" onClick={() => setCreating(true)}>
              New product
            </Button>
          </>
        }
      />
      {!tenants.length ? (
        <EmptyState title="You are not in any organization yet" action={<Link className="btn btn-primary btn-md" to="/welcome">Set one up</Link>}>
          Create an organization, or ask a colleague to invite you to theirs.
        </EmptyState>
      ) : null}
      {tenants.map((t) => (
        <section key={t.tenant_id} className="stack" aria-labelledby={`t-${t.tenant_id}`}>
          <div className="row-between">
            <h2 id={`t-${t.tenant_id}`}>{t.name}</h2>
            <Link to={`/t/${t.slug}/members`} className="small">
              People and roles
            </Link>
          </div>
          {t.teams.map((team) => {
            const ps = items.filter((p) => p.team.team_id === team.team_id);
            return (
              <div key={team.team_id} className="stack-sm">
                <h3 className="muted" style={{ fontSize: "var(--text-md)" }}>
                  {team.name}
                </h3>
                {ps.length ? (
                  <ul className="product-list">
                    {ps.map((p) => (
                      <li key={p.product_id}>
                        <Link to={`/t/${p.path}/objectives`} className="product-row">
                          <span className="grow">
                            <strong>{p.name}</strong>
                            {p.idea ? <span className="muted small product-idea">{p.idea}</span> : null}
                          </span>
                          <span className="row small">
                            {p.archived_at ? <Badge tone="warning">Archived</Badge> : null}
                            <Badge>{p.your_role}</Badge>
                            <span className="faint">{relativeTime(p.updated_at)}</span>
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="small faint">No products you can see in this team yet.</p>
                )}
              </div>
            );
          })}
        </section>
      ))}
      <CreateProductDialog open={creating} onClose={() => setCreating(false)} tenants={tenants} />
    </div>
  );
}

function CreateProductDialog({ open, onClose, tenants }: { open: boolean; onClose: () => void; tenants: { slug: string; name: string; your_role: string | null; teams: { slug: string; name: string; your_role: string | null }[] }[] }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const teams = tenants.flatMap((t) => t.teams.filter((tm) => tm.your_role === "admin").map((tm) => ({ key: `${t.slug}/${tm.slug}`, label: `${t.name} / ${tm.name}` })));
  const [team, setTeam] = useState(teams[0]?.key ?? "");
  const [name, setName] = useState("");
  const [idea, setIdea] = useState("");
  const create = useMutation({
    mutationFn: () => api<{ path: string }>("POST", `/api/v1/teams/${team}/products`, { name, idea }),
    onSuccess: async (p) => {
      await qc.invalidateQueries({ queryKey: ["products"] });
      onClose();
      navigate(`/t/${p.path}/objectives`);
    },
  });
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="New product"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" busy={create.isPending} busyLabel="Creating…" disabled={!team || !name.trim()} onClick={() => create.mutate()}>
            Create product
          </Button>
        </>
      }
    >
      {teams.length ? (
        <>
          <SelectField label="Team" value={team} onChange={(e) => setTeam(e.target.value)}>
            {teams.map((t) => (
              <option key={t.key} value={t.key}>
                {t.label}
              </option>
            ))}
          </SelectField>
          <TextField label="Name" required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
          <TextArea label="The idea" optional maxLength={2000} value={idea} onChange={(e) => setIdea(e.target.value)} />
          {create.isError ? <ErrorCallout error={create.error} /> : null}
        </>
      ) : (
        <Callout tone="info">Creating a product needs an admin role on a team. Ask a team admin, or create your own organization.</Callout>
      )}
    </Dialog>
  );
}

// ---- Members ------------------------------------------------------------------------------------

interface MembersResponse {
  members: { account_id: string; display_name: string; email: string; grants: { membership_id: string; scope_type: string; scope_id: string; scope: { name: string; slug: string }; role: string; since: string }[] }[];
  invitations: { invitation_id: string; email: string; scope_type: string; scope: { name: string }; role: string; expires_at: string }[];
}

export function MembersPage() {
  const { tenant = "" } = useParams();
  const products = useProducts();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ["members", tenant], queryFn: () => api<MembersResponse>("GET", `/api/v1/tenants/${tenant}/members`) });
  const t = products.data?.tenants.find((x) => x.slug === tenant);
  const [email, setEmail] = useState("");
  const [target, setTarget] = useState("");
  const [role, setRole] = useState("editor");
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const grant = useMutation({
    mutationFn: () => {
      const [team, product] = target.split("/");
      return api<{ invited: boolean; invite_link?: string }>("POST", `/api/v1/tenants/${tenant}/members`, { email, role, ...(team ? { team } : {}), ...(product ? { product } : {}) });
    },
    onSuccess: (r) => {
      toast(r.invited ? `Invitation created for ${email}.` : `${email} now has ${role} access.`);
      setInviteLink(r.invite_link ?? null);
      setEmail("");
      void qc.invalidateQueries({ queryKey: ["members", tenant] });
    },
  });
  const revoke = useMutation({
    mutationFn: (g: { account_id: string; scope_type: string; scope_id: string }) =>
      api("POST", `/api/v1/tenants/${tenant}/members/revoke`, { account_id: g.account_id, ...(g.scope_type === "team" ? { team: g.scope_id } : {}), ...(g.scope_type === "product" ? { product: g.scope_id } : {}) }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["members", tenant] }),
    onError: (e) => toast((e as Error).message, { tone: "danger" }),
  });
  const targets = [
    { value: "", label: `${t?.name ?? "The organization"} (organization role)`, roles: ["member", "admin", "owner"] },
    ...(t?.teams ?? []).map((tm) => ({ value: tm.slug, label: `Team: ${tm.name}`, roles: ["viewer", "editor", "admin"] })),
    ...(products.data?.items ?? []).filter((p) => p.tenant.slug === tenant).map((p) => ({ value: `${p.team.slug}/${p.path.split("/")[2]}`, label: `Product: ${p.name}`, roles: ["viewer", "editor", "admin"] })),
  ];
  const roles = targets.find((x) => x.value === target)?.roles ?? ["viewer", "editor", "admin"];
  return (
    <div className="stack-lg">
      <PageHeader
        crumbs={[{ label: "Products", to: "/products" }, { label: t?.name ?? tenant }]}
        title="People and roles"
        description="Roles apply at the organization, a team (every product in it), or one product. The highest role that applies wins; someone with no role on a product cannot see it."
      />
      <Card>
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            grant.mutate();
          }}
        >
          <h2 style={{ fontSize: "var(--text-lg)" }}>Give someone access</h2>
          <div className="form-grid">
            <TextField label="Email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} hint="People without an account get an invitation, valid 7 days." />
            <SelectField label="Where" value={target} onChange={(e) => {
              setTarget(e.target.value);
              setRole(e.target.value ? "editor" : "member");
            }}>
              {targets.map((x) => (
                <option key={x.value} value={x.value}>
                  {x.label}
                </option>
              ))}
            </SelectField>
            <SelectField label="Role" value={role} onChange={(e) => setRole(e.target.value)} hint="Viewers read. Editors also write. Admins also manage people and settings.">
              {roles.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </SelectField>
          </div>
          {grant.isError ? <ErrorCallout error={grant.error} /> : null}
          {inviteLink ? (
            <Callout tone="success" title="Invitation link">
              We emailed it where email is set up. You can also send it yourself; it works once, for 7 days: <code style={{ wordBreak: "break-all" }}>{inviteLink}</code>
            </Callout>
          ) : null}
          <div>
            <Button type="submit" variant="primary" busy={grant.isPending} busyLabel="Saving…">
              Give access
            </Button>
          </div>
        </form>
      </Card>
      {q.isPending ? <Loading /> : q.isError ? <ErrorCallout error={q.error} onRetry={() => q.refetch()} /> : (
        <>
          <section className="stack" aria-labelledby="members-h">
            <h2 id="members-h">Members</h2>
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Person</th>
                  <th scope="col">Access</th>
                </tr>
              </thead>
              <tbody>
                {q.data.members.map((m) => (
                  <tr key={m.account_id}>
                    <td>
                      <strong>{m.display_name}</strong>
                      <div className="small muted">{m.email}</div>
                    </td>
                    <td>
                      <ul className="grant-list">
                        {m.grants.map((g) => (
                          <li key={g.membership_id} className="row">
                            <Badge tone={g.role === "owner" || g.role === "admin" ? "accent" : "neutral"}>{g.role}</Badge>
                            <span className="small">
                              {g.scope_type === "tenant" ? "organization" : g.scope_type} {g.scope.name}
                            </span>
                            <Button size="sm" variant="quiet" onClick={() => revoke.mutate({ account_id: m.account_id, scope_type: g.scope_type, scope_id: g.scope_id })}>
                              Remove
                            </Button>
                          </li>
                        ))}
                      </ul>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
          {q.data.invitations.length ? (
            <section className="stack" aria-labelledby="inv-h">
              <h2 id="inv-h">Waiting to join</h2>
              <ul className="grant-list">
                {q.data.invitations.map((i) => (
                  <li key={i.invitation_id} className="row">
                    <strong>{i.email}</strong>
                    <Badge>{i.role}</Badge>
                    <span className="small muted">
                      {i.scope_type === "tenant" ? "organization" : i.scope_type} {i.scope.name} · expires {formatDate(i.expires_at)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}
