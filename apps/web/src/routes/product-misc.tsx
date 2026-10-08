import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router";
import { api, ApiError, qs } from "../lib/api.ts";
import { aRole, formatBytes, formatDate, formatDateTime, relativeTime, scopeWords } from "../lib/format.ts";
import { useProduct, useProducts } from "../lib/session.tsx";
import { ActivityFeed, ENTITY_LABEL, useActivity, type ActivityFilter } from "../shell/ActivityFeed.tsx";
import { usePageTitle } from "../shell/slots.tsx";
import {
  Avatar, Button, Callout, CopyField, Dialog, ErrorCallout, FormGrid, Glyph, Loading, Menu, MenuGroup, MenuItem, MenuRadio,
  MenuSeparator, Segmented, SelectField, Sheet, SheetBody, SheetHeader, StatusBadge, TextArea, TextField, useToast,
} from "../ui/index.tsx";
import "../styles/screens/activity.css";
import "../styles/screens/settings.css";

// ---- Activity -----------------------------------------------------------------------------------

const TYPE_FILTERS = [
  { id: "", label: "Everything" },
  { id: "source", label: "Sources" },
  { id: "outcome", label: "Outcomes" },
  { id: "insight", label: "Insights" },
  { id: "assumption", label: "Assumptions" },
  { id: "decision", label: "Decisions" },
  { id: "story_page", label: "Story pages" },
  { id: "story_hierarchy", label: "Story tree" },
  { id: "story_style", label: "Story style" },
  { id: "membership", label: "People and roles" },
  { id: "product", label: "Product settings" },
];

/**
 * The product's log: one feed of what people and agents changed, reached from the account menu
 * and from a source's details. URL: ?entity_type and ?entity_id.
 */
export function ActivityPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const loc = useLocation();
  usePageTitle("Activity");
  const entityType = params.get("entity_type") ?? undefined;
  const entityId = params.get("entity_id") ?? undefined;
  const filter: ActivityFilter = { entityType, entityId };
  const q = useActivity(filter);
  const href = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    const s = next.toString();
    return `${loc.pathname}${s ? `?${s}` : ""}`;
  };
  const firstTitle = q.data?.pages[0]?.items.find((i) => i.entity_title)?.entity_title;
  const scopeName = entityId ? (firstTitle ?? `this ${(entityType ?? "item").replace(/_/g, " ")}`) : entityType ? (ENTITY_LABEL[entityType] ?? entityType) : null;
  const typeLabel = TYPE_FILTERS.find((t) => t.id === (entityType ?? ""))?.label ?? "Everything";
  return (
    <Sheet className="activity-sheet" labelledBy="activity-title">
      <SheetHeader
        level={1}
        id="activity-title"
        title="Activity"
        end={
          entityId ? null : (
            <Menu
              label={`Show changes to: ${typeLabel}`}
              triggerClassName="btn btn-quiet btn-sm"
              trigger={
                <>
                  {typeLabel}
                  <Glyph name="chevron-down" size="sm" />
                </>
              }
            >
              <MenuGroup label="Show changes to">
                {TYPE_FILTERS.map((t) => (
                  <MenuRadio key={t.id} checked={(entityType ?? "") === t.id} onSelect={() => navigate(href({ entity_type: t.id || null, entity_id: null }))}>
                    {t.label}
                  </MenuRadio>
                ))}
              </MenuGroup>
            </Menu>
          )
        }
      />
      {scopeName ? (
        <p className="activity-scope">
          <span>
            Showing activity on <b>{scopeName}</b>
          </span>
          <span className="sep-dot"> </span>
          <Link to={href({ entity_type: null, entity_id: null })}>Show all</Link>
        </p>
      ) : (
        <p className="activity-scope activity-scope-quiet">People and agents share one log.</p>
      )}
      <ActivityFeed {...filter} query={q} />
    </Sheet>
  );
}

// ---- Settings -----------------------------------------------------------------------------------

export function ProductSettingsPage() {
  const { isAdmin } = useProduct();
  const loc = useLocation();
  usePageTitle("Settings");
  useEffect(() => {
    if (!loc.hash) return;
    const t = setTimeout(() => document.getElementById(loc.hash.slice(1))?.scrollIntoView({ block: "start" }), 300);
    return () => clearTimeout(t);
  }, [loc.hash]);
  return (
    <div className="settings">
      <ProductDetails />
      <PeopleSheet />
      <ExportSheet />
      <OrganizationSheet />
      {isAdmin ? <ArchiveSheet /> : null}
      <p className="settings-foot">
        These settings belong to this product. Your display name is in <Link to="/settings">your own settings</Link>.
      </p>
    </div>
  );
}

function ProductDetails() {
  const { product, api: base, isAdmin } = useProduct();
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const [name, setName] = useState(product.name);
  const [slug, setSlug] = useState(product.slug);
  const [concept, setConcept] = useState(product.concept ?? "");
  const archived = Boolean(product.archived_at);
  const editable = isAdmin && !archived;
  const dirty = name !== product.name || slug !== product.slug || concept !== (product.concept ?? "");
  const save = useMutation({
    mutationFn: () =>
      api<{ path: string }>("PATCH", base, {
        expected_etag: product.etag,
        ...(name !== product.name ? { name } : {}),
        ...(slug !== product.slug ? { slug } : {}),
        ...(concept !== (product.concept ?? "") ? { concept } : {}),
      }),
    onSuccess: (p) => {
      toast("Saved.");
      void qc.invalidateQueries({ queryKey: ["products"] });
      if (slug !== product.slug) navigate(`/t/${p.path}/settings`, { replace: true });
      else void qc.invalidateQueries({ queryKey: ["product"] });
    },
  });
  const slugError = slug && !/^[a-z0-9-]{3,50}$/.test(slug) ? "Use 3 to 50 lower-case letters, digits and hyphens." : null;
  return (
    <Sheet className="settings-sheet" labelledBy="settings-title">
      <SheetHeader level={1} id="settings-title" title="Settings" count={product.name} />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (editable && dirty && name.trim() && !slugError) save.mutate();
        }}
      >
      {!isAdmin ? (
        <div className="settings-note">
          <Callout inset tone="info">
            Only admins of this product can change these. You are {product.your_role === "editor" ? "an editor" : "a viewer"} here.
          </Callout>
        </div>
      ) : archived ? (
        <div className="settings-note">
          <Callout inset tone="attention">This product is archived and read-only. Restore it below to change it.</Callout>
        </div>
      ) : null}
      <FormGrid className="settings-form">
        <TextField label="Product name" value={name} onChange={(e) => setName(e.target.value)} readOnly={!editable} maxLength={100} required />
        <TextField
          label="Short name in links"
          hint={editable ? "Changing it changes every link to this product." : undefined}
          value={slug}
          onChange={(e) => setSlug(e.target.value.toLowerCase())}
          readOnly={!editable}
          error={slugError}
          spellCheck={false}
        />
        <TextField label="Team" value={`${product.team.name} · ${product.tenant.name}`} readOnly />
        <TextArea
          label="Product concept"
          hint={editable ? "Who it is for, the problem they have, and how the product solves it, in a few sentences. It heads the Idea screen." : undefined}
          value={concept}
          onChange={(e) => setConcept(e.target.value)}
          readOnly={!editable}
          maxLength={2000}
          rows={3}
        />
      </FormGrid>
      {save.isError ? (
        <div className="settings-note">
          <ErrorCallout inset error={save.error} onRetry={save.error instanceof ApiError && save.error.code === "stale_etag" ? () => void qc.invalidateQueries({ queryKey: ["product"] }) : undefined} />
        </div>
      ) : null}
      {editable ? (
        <div className="settings-actions">
          <Button
            type="submit"
            variant="primary"
            busy={save.isPending}
            busyLabel="Saving…"
            disabled={!dirty || !name.trim() || Boolean(slugError)}
          >
            Save changes
          </Button>
          {dirty ? (
            <Button
              variant="quiet"
              onClick={() => {
                setName(product.name);
                setSlug(product.slug);
                setConcept(product.concept ?? "");
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

// ---- People on this product ---------------------------------------------------------------------

type Role = "admin" | "editor" | "viewer" | "reader";
const ROLES: Role[] = ["admin", "editor", "viewer", "reader"];
const ROLE_WORD: Record<string, string> = { admin: "Admin", editor: "Editor", viewer: "Viewer", reader: "Reader", owner: "Owner", member: "Member", visitor: "Visitor" };
const ROLE_HINT: Record<Role, string> = { admin: "Also manages people and settings", editor: "Reads and writes", viewer: "Reads", reader: "Reads only the Story" };

interface Grant {
  membership_id: string;
  scope_type: "tenant" | "team" | "product";
  scope_id: string;
  scope: { name: string; slug: string };
  role: string;
  since: string;
}
interface ProductMember {
  account_id: string;
  display_name: string;
  email: string;
  grants: Grant[];
  product_access: { role: Role; via: "product" | "team" | "tenant" };
}
interface Invitation {
  invitation_id: string;
  email: string;
  scope_type: "tenant" | "team" | "product";
  scope_id: string;
  role: string;
  expires_at: string;
  created_at: string;
  scope: { name: string; slug: string };
}
interface ProductMembers {
  product: { product_id: string; name: string; team_id: string; team: string | null };
  members: ProductMember[];
  invitations: Invitation[];
  /** In a public sandbox a visitor is shown only themselves. */
  sandbox?: { only_you: boolean; visitors?: number };
}
interface OrgMembers {
  members: { account_id: string; display_name: string; email: string; grants: Grant[] }[];
}

function useProductMembers() {
  const { product } = useProduct();
  const key = ["members", product.tenant.slug, "product", product.product_id];
  const q = useQuery({
    queryKey: key,
    queryFn: () => api<ProductMembers>("GET", `/api/v1/tenants/${product.tenant.slug}/members${qs({ product: product.product_id })}`),
  });
  return { q, key };
}

function PeopleSheet() {
  const { product, isAdmin } = useProduct();
  const { q } = useProductMembers();
  const qc = useQueryClient();
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const tenant = product.tenant.slug;
  const membersLink = `/t/${tenant}/members`;
  const refresh = () => void qc.invalidateQueries({ queryKey: ["members", tenant] });
  const grant = useMutation({
    mutationFn: (v: { email: string; role: Role }) => api<{ invited: boolean; invite_link?: string }>("POST", `/api/v1/tenants/${tenant}/members`, { product: product.product_id, ...v }),
    onSuccess: refresh,
    onError: (e) => toast(`Couldn’t change the role. ${(e as Error).message}`, { tone: "negative" }),
  });
  const revoke = useMutation({
    mutationFn: (m: ProductMember) => api("POST", `/api/v1/tenants/${tenant}/members/revoke`, { product: product.product_id, account_id: m.account_id }),
    onSuccess: (_r, m) => {
      refresh();
      const role = m.grants.find((g) => g.scope_type === "product")?.role as Role | undefined;
      toast(`Removed ${m.display_name}’s role on ${product.name}.`, role ? { action: { label: "Undo", onClick: () => grant.mutate({ email: m.email, role }) } } : undefined);
    },
    onError: (e) => toast(`Couldn’t remove that role. ${(e as Error).message}`, { tone: "negative" }),
  });
  const cancel = useMutation({
    mutationFn: (id: string) => api("POST", `/api/v1/tenants/${tenant}/invitations/cancel`, { invitation_id: id }),
    onSuccess: () => {
      refresh();
      toast("Invitation cancelled. Its link no longer works.");
    },
    onError: (e) => toast(`Couldn’t cancel the invitation. ${(e as Error).message}`, { tone: "negative" }),
  });
  const count = q.data ? q.data.members.length : undefined;
  return (
    <Sheet className="people-sheet" labelledBy="people-title">
      <span id="people" className="settings-anchor" />
      <SheetHeader
        id="people-title"
        title="People on this product"
        count={count}
        end={
          isAdmin ? (
            <Button icon="user-plus" onClick={() => setAdding(true)}>Add people</Button>
          ) : q.data?.sandbox?.only_you ? (
            <Link className="quiet-link" to={`/t/${tenant}/sandbox`}>About this sandbox</Link>
          ) : (
            <Link className="quiet-link" to={membersLink}>Organization members</Link>
          )
        }
      />
      {q.isPending ? (
        <Loading label="Loading people…" lines={3} />
      ) : q.isError ? (
        <div className="settings-note">
          <ErrorCallout inset error={q.error} onRetry={() => q.refetch()} />
        </div>
      ) : (
        <>
          <ul className="people-list">
            {q.data.members.map((m) => {
              const own = m.grants.find((g) => g.scope_type === "product");
              const via = m.product_access.via;
              const from = m.grants.find((g) => g.scope_type === via);
              const inherited = via !== "product" && from;
              return (
                <li key={m.account_id} className="people-row">
                  <Avatar name={m.display_name} />
                  <div className="people-main">
                    <span className="people-name">{m.display_name}</span>
                    <span className="people-sub">{m.email}</span>
                    <span className="people-sub">
                      {inherited ? (
                        <>
                          {ROLE_WORD[m.product_access.role]} through{" "}
                          <Link to={membersLink} title={`Change it in ${product.tenant.name} members`}>
                            {from.scope.name}
                          </Link>
                          {via === "tenant" ? ` (${from.role})` : ""}
                          {own ? `, which outranks the product role ${own.role}` : ""}
                        </>
                      ) : (
                        "Role on this product"
                      )}
                    </span>
                  </div>
                  <div className="people-end">
                    {isAdmin && own ? (
                      <Menu
                        label={`Product role for ${m.display_name}: ${ROLE_WORD[own.role]}`}
                        triggerClassName="field-button people-role"
                        minWidth={220}
                        trigger={
                          <>
                            <span>{ROLE_WORD[own.role]}</span>
                            <Glyph name="chevron-down" size="sm" />
                          </>
                        }
                      >
                        <MenuGroup label={`Role on ${product.name}`}>
                          {ROLES.map((r) => (
                            <MenuRadio key={r} checked={own.role === r} meta={ROLE_HINT[r]} onSelect={() => own.role !== r && grant.mutate({ email: m.email, role: r })}>
                              {ROLE_WORD[r]}
                            </MenuRadio>
                          ))}
                        </MenuGroup>
                        <MenuSeparator />
                        <MenuItem icon="x" tone="danger" onSelect={() => revoke.mutate(m)}>
                          Remove from {product.name}
                        </MenuItem>
                      </Menu>
                    ) : (
                      <span className="people-role-text">{ROLE_WORD[m.product_access.role]}</span>
                    )}
                  </div>
                </li>
              );
            })}
            {q.data.invitations.map((i) => (
              <li key={i.invitation_id} className="people-row people-invited">
                <span className="people-face-empty" aria-hidden="true">
                  <Glyph name="clock" size="sm" />
                </span>
                <div className="people-main">
                  <span className="people-name">{i.email}</span>
                  <span className="people-sub">
                    Invited as {i.role}
                    {i.scope_type !== "product" ? ` on ${i.scope_type === "team" ? scopeWords("team", i.scope.name) : i.scope.name}` : ""} · expires {formatDate(i.expires_at)}
                  </span>
                </div>
                <div className="people-end">
                  {isAdmin && i.scope_type === "product" ? (
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
          {q.data.sandbox?.only_you ? (
            <p className="people-foot">{product.tenant.name} is a public sandbox. Visitors never see each other, so only you are listed, under your made-up name.</p>
          ) : (
            <p className="people-foot">
              Admins also manage people and settings, editors read and write, viewers read, and readers read only the Story. Team and organization roles cover every product in them; change those in{" "}
              <Link to={membersLink}>{product.tenant.name} members</Link>.
              {q.data.sandbox ? ` ${product.tenant.name} is a public sandbox, so its ${(q.data.sandbox.visitors ?? 0).toLocaleString("en-US")} visitors can edit this product too. They’re listed in Sandbox controls.` : ""}
            </p>
          )}
        </>
      )}
      {isAdmin && adding ? <AddPeopleDialog onClose={() => setAdding(false)} existing={q.data?.members.map((m) => m.account_id) ?? []} /> : null}
    </Sheet>
  );
}

function AddPeopleDialog({ onClose, existing }: { onClose: () => void; existing: string[] }) {
  const { product } = useProduct();
  const tenant = product.tenant.slug;
  const qc = useQueryClient();
  const toast = useToast();
  const org = useQuery({ queryKey: ["members", tenant], queryFn: () => api<OrgMembers>("GET", `/api/v1/tenants/${tenant}/members`) });
  const candidates = (org.data?.members ?? []).filter((m) => !existing.includes(m.account_id));
  const [mode, setMode] = useState<"org" | "email">("org");
  const [person, setPerson] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("editor");
  const [link, setLink] = useState<string | null>(null);
  useEffect(() => {
    if (org.data && !candidates.length) setMode("email");
    // Only once the organization list arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [org.data]);
  const target = mode === "org" ? candidates.find((m) => m.account_id === person) : null;
  const add = useMutation({
    mutationFn: () => api<{ invited: boolean; invite_link?: string }>("POST", `/api/v1/tenants/${tenant}/members`, { product: product.product_id, email: target ? target.email : email.trim(), role }),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ["members", tenant] });
      if (r.invited) {
        setLink(r.invite_link ?? null);
        toast(`Invitation created for ${email.trim()}.`);
      } else {
        toast(`${target?.display_name ?? email.trim()} is now ${aRole(role)} on ${product.name}.`);
        onClose();
      }
    },
  });
  const ready = mode === "org" ? Boolean(target) : /\S+@\S+\.\S+/.test(email.trim());
  return (
    <Dialog
      open
      onClose={onClose}
      title={`Add people to ${product.name}`}
      description="They get this role on this product only. Someone without an account gets an invitation link that works for 7 days."
      footer={
        link ? (
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        ) : (
          <>
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" busy={add.isPending} busyLabel="Adding…" disabled={!ready} onClick={() => add.mutate()}>
              Add to {product.name}
            </Button>
          </>
        )
      }
    >
      {link ? (
        <div className="stack-sm">
          <Callout inset tone="positive" title="Invitation created">
            We email it where email is set up. You can also share the link yourself: it works once, within 7 days.
          </Callout>
          <CopyField label="Invitation link" value={link} />
        </div>
      ) : (
        <div className="people-add">
          <Segmented
            label="Who to add"
            equal
            value={mode}
            onChange={(id) => setMode(id as "org" | "email")}
            items={[
              { id: "org", label: "From the organization", disabled: Boolean(org.data) && !candidates.length },
              { id: "email", label: "By email" },
            ]}
          />
          {mode === "org" ? (
            org.isPending ? (
              <Loading lines={1} variant="lines" />
            ) : org.isError ? (
              <ErrorCallout inset error={org.error} onRetry={() => org.refetch()} />
            ) : (
              <SelectField label="Person" value={person} onChange={(e) => setPerson(e.target.value)} hint={`People in ${product.tenant.name} who have no access to ${product.name} yet.`}>
                <option value="">Choose someone…</option>
                {candidates.map((m) => (
                  <option key={m.account_id} value={m.account_id}>
                    {m.display_name} ({m.email})
                  </option>
                ))}
              </SelectField>
            )
          ) : (
            <TextField label="Email" type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} hint="People already on WhatBuild get access right away. Anyone else gets an invitation." />
          )}
          <SelectField label="Role" value={role} onChange={(e) => setRole(e.target.value as Role)}>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_WORD[r]}: {ROLE_HINT[r].toLowerCase()}
              </option>
            ))}
          </SelectField>
          {add.isError ? <ErrorCallout inset error={add.error} /> : null}
        </div>
      )}
    </Dialog>
  );
}

// ---- Export, organization, archive --------------------------------------------------------------

interface ExportItem {
  export_id: string;
  status: string;
  size: number | null;
  file_count: number | null;
  created_at: string;
  error: string | null;
}

function ExportSheet() {
  const { api: base } = useProduct();
  const qc = useQueryClient();
  const list = useQuery({
    queryKey: ["exports", base],
    queryFn: () => api<{ items: ExportItem[] }>("GET", `${base}/exports`),
    refetchInterval: (q) => (q.state.data?.items.some((i) => i.status === "pending") ? 1500 : false),
  });
  const start = useMutation({ mutationFn: () => api("POST", `${base}/exports`, {}), onSuccess: () => void qc.invalidateQueries({ queryKey: ["exports", base] }) });
  const items = list.data?.items ?? [];
  return (
    <Sheet labelledBy="export-title">
      <SheetHeader
        id="export-title"
        title="Export"
        end={
          <Button icon="download" onClick={() => start.mutate()} busy={start.isPending} busyLabel="Starting…">
            Export this product
          </Button>
        }
      />
      <SheetBody>
        <p className="muted">
          Everything in this product as one ZIP: every source file and version, passages, notes, insights with their earlier versions, assumptions and decisions with their reviews, every Story version, and
          the activity log. It&rsquo;s plain JSON, Markdown and HTML, readable without WhatBuild. Anyone with access can export, at any time.
        </p>
        {start.isError ? <ErrorCallout inset error={start.error} /> : null}
        {list.isError ? <ErrorCallout inset error={list.error} onRetry={() => list.refetch()} /> : null}
      </SheetBody>
      {items.length ? (
        <ul className="export-list">
          {items.map((e) => (
            <li key={e.export_id} className="export-row">
              <Glyph name="file-text" size="sm" />
              <span className="export-when" title={formatDateTime(e.created_at)}>
                Requested {relativeTime(e.created_at)}
              </span>
              <span className="export-state">
                {e.status === "ready" ? (
                  <a href={`${base}/exports/${e.export_id}/file`}>
                    Download ({formatBytes(e.size)}, {e.file_count} files)
                  </a>
                ) : e.status === "pending" ? (
                  <StatusBadge tone="progress">Building</StatusBadge>
                ) : (
                  <StatusBadge tone="negative">Failed{e.error ? `: ${e.error}` : ""}</StatusBadge>
                )}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </Sheet>
  );
}

function OrganizationSheet() {
  const { product } = useProduct();
  const products = useProducts();
  const t = products.data?.tenants.find((x) => x.tenant_id === product.tenant.tenant_id);
  const inOrg = (products.data?.items ?? []).filter((p) => p.tenant.tenant_id === product.tenant.tenant_id);
  const list = (names: string[]) => (names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`);
  return (
    <Sheet labelledBy="org-title">
      <span id="organization" className="settings-anchor" />
      <SheetHeader id="org-title" title="Organization" count={product.tenant.name} end={<Link className="quiet-link" to={`/t/${product.tenant.slug}/members`}>Members and roles</Link>} />
      <SheetBody>
        {t ? (
          <p className="muted">
            {t.name} has {t.teams.length === 1 ? "one team" : `${t.teams.length} teams`}
            {t.teams.length ? `, ${list(t.teams.map((x) => x.name))}` : ""}. You can see {inOrg.length === 1 ? "one product" : `${inOrg.length} products`} in it: {list(inOrg.map((p) => p.name))}.
          </p>
        ) : products.isError ? (
          <ErrorCallout inset error={products.error} onRetry={() => products.refetch()} />
        ) : (
          <Loading lines={1} variant="lines" />
        )}
      </SheetBody>
    </Sheet>
  );
}

function ArchiveSheet() {
  const { product, api: base } = useProduct();
  const qc = useQueryClient();
  const toast = useToast();
  const archived = Boolean(product.archived_at);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["product"] });
    void qc.invalidateQueries({ queryKey: ["products"] });
  };
  const change = useMutation({
    mutationFn: (restore: boolean) => api<{ etag?: string }>("POST", `${base}/${restore ? "restore" : "archive"}`, { expected_etag: product.etag }),
    onSuccess: (_r, restore) => {
      refresh();
      toast(restore ? `${product.name} is restored.` : `${product.name} is archived and read-only.`);
    },
  });
  return (
    <Sheet labelledBy="archive-title">
      <SheetHeader id="archive-title" title={archived ? "Restore this product" : "Archive this product"} />
      <SheetBody className="stack-sm">
        <p className="muted">
          {archived
            ? `Restoring puts ${product.name} back in product lists and makes it writable again.`
            : `Archiving hides ${product.name} from product lists and makes it read-only. Every source, passage and Story page is kept, and it still counts toward storage. You can restore it later.`}
        </p>
        {change.isError ? (
          <ErrorCallout inset error={change.error} onRetry={change.error instanceof ApiError && change.error.code === "stale_etag" ? refresh : undefined} />
        ) : null}
        <div>
          <Button icon={archived ? "archive-restore" : "archive"} onClick={() => change.mutate(archived)} busy={change.isPending} busyLabel={archived ? "Restoring…" : "Archiving…"}>
            {archived ? `Restore ${product.name}` : `Archive ${product.name}`}
          </Button>
        </div>
      </SheetBody>
    </Sheet>
  );
}
