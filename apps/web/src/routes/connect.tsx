import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { useParams, useSearchParams } from "react-router";
import { api } from "../lib/api.ts";
import { formatDate, relativeTime } from "../lib/format.ts";
import { useProducts } from "../lib/session.tsx";
import { useLastProduct } from "../shell/panel.tsx";
import { usePageTitle } from "../shell/slots.tsx";
import { AgentFace, Button, ChoiceRow, CopyField, Dialog, EmptyState, ErrorCallout, Loading, SelectField, Sheet, SheetBody, SheetHeader, useToast } from "../ui/index.tsx";
import "../styles/screens/account.css";

interface ConnectInfo {
  mcp_url: string;
  /** The address scoped to one organization, with `{tenant}` to fill in. */
  tenant_url_template: string;
  /** The address scoped to one product, with `{tenant}/{team}/{product}` to fill in. */
  bound_url_template: string;
  skill: { name: string; version: string; zip_url: string };
}

/** What a connection may reach: names where the person can see them, else the address's path. */
type Reach =
  | { kind: "all" }
  | { kind: "tenant"; path: string; name: string | null }
  | { kind: "product"; path: string; name: string | null; tenant_name: string | null };

interface ConnectedAgent {
  client_name: string;
  family_id: string;
  reach: Reach;
  /** Where the agent's client receives its connection: web hosts, or an app on the computer that connected it. */
  returns_to: { hosts: string[]; local: boolean };
  last_used_at: string | null;
  created_at: string;
}

type ReachKind = "product" | "organization" | "all";

function reachLabel(r: Reach): string {
  if (r.kind === "all") return "Every product you can open";
  if (r.kind === "tenant") return `Only the organization ${r.name ?? r.path}`;
  return `Only the product ${r.name ?? r.path}${r.name && r.tenant_name ? ` in ${r.tenant_name}` : ""}`;
}

/** Who holds a connection, since an agent's name is whatever it called itself. */
function heldBy(r: ConnectedAgent["returns_to"]): string {
  const places = [...r.hosts, ...(r.local ? ["an app on your computer"] : [])];
  return places.length ? `Held by ${places.join(" or ")}` : "";
}

function Step({ n, title, children }: { n: number; title: string; children?: ReactNode }) {
  return (
    <li className="agents-step">
      <span className="agents-step-n num" aria-hidden="true">
        {n}
      </span>
      <div className="agents-step-body">
        <h3 className="agents-step-title">
          <span className="visually-hidden">Step {n}: </span>
          {title}
        </h3>
        {children}
      </div>
    </li>
  );
}

/**
 * `/connect`, and `…/connect` inside a product: the one address an MCP client needs, and the agents
 * connected now. The person chooses what the agent can reach (one product, one organization, or
 * everything) and gets the address for it. A scoped address is a fence: the server refuses every
 * call outside it. Inside a product that product is chosen first; elsewhere, the organization of the
 * last product opened. The client finds sign-in on its own (OAuth discovery), and the server tells
 * the agent which skill version to use.
 */
export function ConnectPage() {
  const info = useQuery({ queryKey: ["connect"], queryFn: () => api<ConnectInfo>("GET", "/api/v1/connect") });
  const products = useProducts();
  const last = useLastProduct();
  const here = useParams();
  const [params, setParams] = useSearchParams();
  usePageTitle("Connect an agent");
  const c = info.data;
  const items = products.data?.items ?? [];
  const tenants = products.data?.tenants ?? [];
  const orgs = new Set(items.map((p) => p.tenant.tenant_id)).size;
  const herePath = here["product"] ? `${here["tenant"]}/${here["team"]}/${here["product"]}` : null;
  // The URL holds the choice: ?reach=product|organization|all, with ?product=<path> or ?org=<slug>.
  // An older ?product=all means everything.
  const productParam = params.get("product");
  const orgParam = params.get("org");
  const reachParam = params.get("reach");
  const reach: ReachKind =
    reachParam === "product" || reachParam === "organization" || reachParam === "all"
      ? reachParam
      : productParam === "all"
        ? "all"
        : productParam || herePath
          ? "product"
          : orgParam || last || items.length
            ? "organization"
            : "all";
  const product = items.find((p) => p.path === (productParam && productParam !== "all" ? productParam : herePath)) ?? (herePath ? undefined : last) ?? items[0];
  const org = tenants.find((t) => t.slug === orgParam) ?? tenants.find((t) => t.tenant_id === (product ?? last)?.tenant.tenant_id) ?? tenants[0];
  const url = !c
    ? ""
    : reach === "product" && product
      ? c.bound_url_template.replace("{tenant}/{team}/{product}", product.path)
      : reach === "organization" && org
        ? c.tenant_url_template.replace("{tenant}", org.slug)
        : c.mcp_url;
  const pick = (next: Record<string, string>) =>
    setParams(
      (p) => {
        const q = new URLSearchParams(p);
        for (const [k, v] of Object.entries(next)) q.set(k, v);
        if (q.get("reach") !== "product") q.delete("product");
        if (q.get("reach") !== "organization") q.delete("org");
        return q;
      },
      { replace: true },
    );
  const scopedName = reach === "product" && product ? product.name : reach === "organization" && org ? org.name : null;
  const named = (reach === "product" ? product : undefined) ?? (reach === "organization" ? items.find((p) => p.tenant.tenant_id === org?.tenant_id) : undefined) ?? product ?? last;
  return (
    <>
      <Sheet className="agents-sheet" labelledBy="agents-title">
        <SheetHeader level={1} id="agents-title" title="Connect an agent" />
        <SheetBody className="agents-intro">
          <p className="muted">What your agent reads goes to whoever runs it, under their terms.</p>
        </SheetBody>
        {info.isPending ? (
          <Loading lines={3} variant="lines" label="Loading the MCP server URL…" />
        ) : info.isError ? (
          <SheetBody>
            <ErrorCallout inset error={info.error} onRetry={() => info.refetch()} />
          </SheetBody>
        ) : c ? (
          <ol className="agents-steps">
            <Step n={1} title="Choose what it can reach">
              <fieldset className="agents-reach">
                <legend className="visually-hidden">What your agent can reach</legend>
                <ChoiceRow
                  type="radio"
                  variant="boxed"
                  name="reach"
                  checked={reach === "product"}
                  disabled={!items.length}
                  onChange={() => pick({ reach: "product", ...(product ? { product: product.path } : {}) })}
                  label="One product"
                  hint={items.length ? undefined : "You have no product yet."}
                />
                <ChoiceRow
                  type="radio"
                  variant="boxed"
                  name="reach"
                  checked={reach === "organization"}
                  disabled={!tenants.length}
                  onChange={() => pick({ reach: "organization", ...(org ? { org: org.slug } : {}) })}
                  label="One organization"
                  hint="Every product in the organization you choose."
                />
                <ChoiceRow
                  type="radio"
                  variant="boxed"
                  name="reach"
                  checked={reach === "all"}
                  onChange={() => pick({ reach: "all" })}
                  label="Everything you can reach"
                  hint="Every product you can open, including in organizations you join later."
                />
              </fieldset>
              {reach === "product" && product ? (
                <div className="agents-address">
                  <SelectField label="Product" value={product.path} onChange={(e) => pick({ reach: "product", product: e.target.value })}>
                    {orgs > 1
                      ? tenants.map((t) => (
                          <optgroup key={t.tenant_id} label={t.name}>
                            {items
                              .filter((p) => p.tenant.tenant_id === t.tenant_id)
                              .map((p) => (
                                <option key={p.product_id} value={p.path}>
                                  {p.name}
                                </option>
                              ))}
                          </optgroup>
                        ))
                      : items.map((p) => (
                          <option key={p.product_id} value={p.path}>
                            {p.name}
                          </option>
                        ))}
                  </SelectField>
                </div>
              ) : reach === "organization" && org ? (
                <div className="agents-address">
                  <SelectField label="Organization" value={org.slug} onChange={(e) => pick({ reach: "organization", org: e.target.value })}>
                    {tenants.map((t) => (
                      <option key={t.tenant_id} value={t.slug}>
                        {t.name}
                      </option>
                    ))}
                  </SelectField>
                </div>
              ) : null}
            </Step>
            <Step n={2} title="Add this MCP server to your agent">
              <div className="agents-address">
                <CopyField label="MCP server URL" value={url} />
              </div>
              <p className="agents-fence" aria-live="polite">
                {scopedName ? (
                  <>
                    Name the connector after <strong>{scopedName}</strong>.
                  </>
                ) : null}
              </p>
            </Step>
            <Step n={3} title="Sign in when it asks" />
            <Step n={4} title="Ask it to start">
              <p>
                For example: &ldquo;Add the interview notes in my downloads to {named?.name ?? "my product"} as a source.&rdquo;
              </p>
            </Step>
          </ol>
        ) : null}
      </Sheet>
      <ConnectedSheet />
      {c ? (
        <p className="agents-foot">
          To install the {c.skill.name} skill (version {c.skill.version}) yourself, <a href={c.skill.zip_url}>download it</a>.
        </p>
      ) : null}
    </>
  );
}

/** Disconnecting needs a second click: the agent stops working at once. */
function DisconnectDialog({ name, onConfirm, onClose, busy, error }: { name: string; onConfirm: () => void; onClose: () => void; busy: boolean; error: unknown }) {
  return (
    <Dialog
      open
      onClose={onClose}
      dismissable={!busy}
      title={`Disconnect ${name}?`}
      description={`${name} stops working in WhatBuild right away. You can connect it again later.`}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="danger" busy={busy} busyLabel="Disconnecting…" onClick={onConfirm}>
            Disconnect
          </Button>
        </>
      }
    >
      {error ? <ErrorCallout inset error={error} /> : null}
    </Dialog>
  );
}

/** Agents signed in with OAuth, account-wide. */
function ConnectedSheet() {
  const q = useQuery({ queryKey: ["agents"], queryFn: () => api<{ items: ConnectedAgent[] }>("GET", "/api/v1/me/agents") });
  const qc = useQueryClient();
  const toast = useToast();
  const [target, setTarget] = useState<{ family_id: string; client_name: string } | null>(null);
  const disconnect = useMutation({
    mutationFn: (family: string) => api("DELETE", `/api/v1/me/agents/${family}`),
    onSuccess: () => {
      toast(`${target?.client_name ?? "The agent"} is disconnected.`);
      setTarget(null);
      void qc.invalidateQueries({ queryKey: ["agents"] });
    },
  });
  const agents = q.data?.items ?? [];
  return (
    <Sheet className="agents-connected" labelledBy="connected-title">
      <SheetHeader id="connected-title" title="Connected" count={q.data ? agents.length : undefined} />
      {q.isPending ? (
        <Loading lines={2} label="Loading connected agents…" />
      ) : q.isError ? (
        <SheetBody>
          <ErrorCallout inset error={q.error} onRetry={() => q.refetch()} />
        </SheetBody>
      ) : agents.length ? (
        <ul className="account-list">
          {agents.map((a) => (
            <li key={a.family_id} className="account-row">
              <AgentFace />
              <div className="account-main">
                <span className="account-name">{a.client_name}</span>
                <span className="account-reach">{reachLabel(a.reach)}</span>
                {heldBy(a.returns_to) ? <span className="account-sub">{heldBy(a.returns_to)}</span> : null}
                <span className="account-sub">Connected {formatDate(a.created_at)}</span>
                <span className="account-sub">Last active {relativeTime(a.last_used_at)}</span>
              </div>
              <Button size="sm" onClick={() => setTarget(a)}>
                Disconnect
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState size="inline" title="No agent connected yet" />
      )}
      {target ? (
        <DisconnectDialog
          name={target.client_name}
          busy={disconnect.isPending}
          error={disconnect.error}
          onClose={() => {
            setTarget(null);
            disconnect.reset();
          }}
          onConfirm={() => disconnect.mutate(target.family_id)}
        />
      ) : null}
    </Sheet>
  );
}
