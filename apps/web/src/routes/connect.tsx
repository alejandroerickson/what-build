import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { api } from "../lib/api.ts";
import { formatDate, relativeTime } from "../lib/format.ts";
import { useMe } from "../lib/session.tsx";
import { useLastProduct } from "../shell/panel.tsx";
import { usePageTitle } from "../shell/slots.tsx";
import {
  AgentFace, Button, Callout, CopyField, Dialog, EmptyState, ErrorCallout, FormGrid, Glyph, Loading, Sheet, SheetBody, SheetHeader, StatusBadge, TextField, useToast,
} from "../ui/index.tsx";
import "../styles/screens/account.css";

interface ConnectInfo {
  mcp_url: string;
  bound_url_template: string;
  skill: { name: string; version: string; markdown_url: string; zip_url: string; install_sh: string; install_ps1: string };
  agent_data_statement: string;
}

interface TokensResponse {
  tokens: { token_id: string; name: string; prefix: string; created_at: string; last_used_at: string | null; revoked_at: string | null }[];
  connected_agents: { client_name: string; family_id: string; last_used_at: string | null; created_at: string }[];
}

function useTokens() {
  return useQuery({ queryKey: ["tokens"], queryFn: () => api<TokensResponse>("GET", "/api/v1/me/tokens") });
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
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

/** `/connect`: how to connect an agent, and the agents connected now. */
export function ConnectPage() {
  const info = useQuery({ queryKey: ["connect"], queryFn: () => api<ConnectInfo>("GET", "/api/v1/connect") });
  const last = useLastProduct();
  const [skillText, setSkillText] = useState<string | null>(null);
  const toast = useToast();
  usePageTitle("Agents");
  useEffect(() => {
    // Fetched before the click, so the clipboard write happens while the click still counts as one.
    if (info.data)
      void fetch(info.data.skill.markdown_url)
        .then((r) => r.text())
        .then(setSkillText)
        .catch(() => setSkillText(null));
  }, [info.data]);
  const c = info.data;
  return (
    <>
      <Sheet className="agents-sheet" labelledBy="agents-title">
        <SheetHeader level={1} id="agents-title" title="Agents" count="Connected over MCP from your own client" />
        <SheetBody className="agents-intro">
          <p className="muted">
            WhatBuild has no agent inside it. Connect the one you already use: it acts as you, with your access, and everything it changes is recorded as yours, through the agent, in Activity.
          </p>
          {c ? <p className="agents-data">{c.agent_data_statement}</p> : null}
        </SheetBody>
        {info.isPending ? (
          <Loading lines={3} variant="lines" label="Loading connection details…" />
        ) : info.isError ? (
          <SheetBody>
            <ErrorCallout inset error={info.error} onRetry={() => info.refetch()} />
          </SheetBody>
        ) : c ? (
          <ol className="agents-steps">
            <Step n={1} title="Add WhatBuild as an MCP server in your client">
              <p>For Claude Code, run this in a terminal. Other clients (Claude, Claude Desktop) take the server address as a custom connector.</p>
              <CopyField label="Claude Code command" value={`claude mcp add --transport http whatbuild ${c.mcp_url}`} />
              <CopyField label="MCP server address" value={c.mcp_url} />
              <details className="agents-more">
                <summary>
                  <Glyph name="chevron-right" size="sm" />
                  Bind it to one product
                </summary>
                <p>A connector bound to one product never needs to be told which product to work in. Replace the parts in braces with a product&rsquo;s path.</p>
                <CopyField label="Address bound to one product" value={c.bound_url_template} />
              </details>
            </Step>
            <Step n={2} title="Sign in when your client asks">
              <p>Your browser opens WhatBuild; approve the connection there. It then appears under Connected below, and you can revoke it at any time.</p>
            </Step>
            <Step n={3} title="Give it the skill">
              <p>
                The skill teaches your agent how to work here: citing passages, uploading files, reviewing honestly. It checks the version (now {c.skill.version}) and offers to update itself.
              </p>
              <div className="agents-actions">
                <Button
                  icon="copy"
                  disabled={!skillText}
                  onClick={() => {
                    if (skillText)
                      void navigator.clipboard
                        .writeText(skillText)
                        .then(() => toast("Skill copied."))
                        .catch(() => toast("Couldn't copy. Download the ZIP instead.", { tone: "negative" }));
                  }}
                >
                  Copy the skill
                </Button>
                <a className="btn btn-secondary btn-md" href={c.skill.zip_url}>
                  <Glyph name="download" />
                  Download ZIP
                </a>
              </div>
              <details className="agents-more">
                <summary>
                  <Glyph name="chevron-right" size="sm" />
                  Install with a script (Claude Code)
                </summary>
                <p>Each script writes one file and prints what it did. Read it before you run it.</p>
                <CopyField label="macOS and Linux" value={`curl -fsSL ${c.skill.install_sh} | sh`} />
                <CopyField label="Windows PowerShell" value={`irm ${c.skill.install_ps1} | iex`} />
              </details>
            </Step>
            <Step n={4} title="Ask it to start">
              <p>
                For example: &ldquo;Add the interview notes in my downloads to {last?.name ?? "my product"} as a source, then list the passages about how people plan their week.&rdquo;
              </p>
            </Step>
          </ol>
        ) : null}
      </Sheet>
      <ConnectedSheet onAgentsPage />
      <p className="agents-foot">
        A script or client that can&rsquo;t sign in in a browser can use a personal access token instead. Create one under <Link to="/account">Account and tokens</Link>.
      </p>
    </>
  );
}

/** Revoking needs a second click: the agent stops working at once. */
function RevokeDialog({ what, detail, onConfirm, onClose, busy, error }: { what: string; detail: string; onConfirm: () => void; onClose: () => void; busy: boolean; error: unknown }) {
  return (
    <Dialog
      open
      onClose={onClose}
      dismissable={!busy}
      title={`Revoke ${what}?`}
      description={detail}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="danger" busy={busy} busyLabel="Revoking…" onClick={onConfirm}>
            Revoke
          </Button>
        </>
      }
    >
      {error ? <ErrorCallout inset error={error} /> : <p className="muted">What it already did stays in Activity, attributed as before.</p>}
    </Dialog>
  );
}

/** Agents signed in with OAuth, account-wide. */
export function ConnectedSheet({ onAgentsPage }: { onAgentsPage?: boolean }) {
  const q = useTokens();
  const me = useMe();
  const qc = useQueryClient();
  const toast = useToast();
  const [target, setTarget] = useState<{ family_id: string; client_name: string } | null>(null);
  const disconnect = useMutation({
    mutationFn: (family: string) => api("DELETE", `/api/v1/me/agents/${family}`),
    onSuccess: () => {
      toast(`${target?.client_name ?? "The agent"} is disconnected.`);
      setTarget(null);
      void qc.invalidateQueries({ queryKey: ["tokens"] });
    },
  });
  const agents = q.data?.connected_agents ?? [];
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
                <span className="account-sub">
                  Acting as {me.data?.display_name ?? "you"} · connected {formatDate(a.created_at)}
                </span>
                <span className="account-sub">Last active {relativeTime(a.last_used_at)}</span>
              </div>
              <Button size="sm" onClick={() => setTarget(a)}>
                Revoke
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState size="inline" title="No agent is connected yet.">
          {onAgentsPage ? "Follow the steps above; " : <>Follow the steps on <Link to="/connect">Agents</Link>; </>}your agent appears here once it signs in.
        </EmptyState>
      )}
      {target ? (
        <RevokeDialog
          what={target.client_name}
          detail={`${target.client_name} stops working in WhatBuild at once. To use it again, connect it again.`}
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

/** Personal access tokens: for clients that cannot sign in in a browser. */
function TokensSheet() {
  const q = useTokens();
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState("");
  const [created, setCreated] = useState<{ name: string; token: string } | null>(null);
  const [target, setTarget] = useState<{ token_id: string; name: string } | null>(null);
  const create = useMutation({
    mutationFn: () => api<{ token: string; name: string }>("POST", "/api/v1/me/tokens", { name: name.trim() }),
    onSuccess: (r) => {
      setCreated({ name: r.name, token: r.token });
      setName("");
      void qc.invalidateQueries({ queryKey: ["tokens"] });
    },
  });
  const revoke = useMutation({
    mutationFn: (id: string) => api("DELETE", `/api/v1/me/tokens/${id}`),
    onSuccess: () => {
      toast(`The token “${target?.name ?? ""}” is revoked.`);
      setTarget(null);
      void qc.invalidateQueries({ queryKey: ["tokens"] });
    },
  });
  const tokens = q.data?.tokens ?? [];
  const live = tokens.filter((t) => !t.revoked_at).length;
  return (
    <Sheet className="account-tokens" labelledBy="tokens-title">
      <SheetHeader id="tokens-title" title="Personal access tokens" count={q.data ? live : undefined} />
      <SheetBody className="stack-sm">
        <p className="muted">For a script or client that can&rsquo;t sign in in a browser. A token acts as you, with exactly your access, until you revoke it.</p>
        <form
          className="token-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) create.mutate();
          }}
        >
          <TextField label="Token name" placeholder="e.g. laptop script" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} />
          <Button type="submit" icon="plus" busy={create.isPending} busyLabel="Creating…" disabled={!name.trim()}>
            Create token
          </Button>
        </form>
        {create.isError ? <ErrorCallout inset error={create.error} /> : null}
        {created ? (
          <div className="token-created" role="status">
            <Callout inset tone="positive" title={`Copy “${created.name}” now: it is shown only once`} action={<Button size="sm" variant="quiet" onClick={() => setCreated(null)}>Done</Button>}>
              Store it where your script reads it. If you lose it, revoke it and create another.
            </Callout>
            <CopyField label={`Token ${created.name}`} value={created.token} />
          </div>
        ) : null}
      </SheetBody>
      {q.isPending ? (
        <Loading lines={2} label="Loading tokens…" />
      ) : q.isError ? (
        <SheetBody>
          <ErrorCallout inset error={q.error} onRetry={() => q.refetch()} />
        </SheetBody>
      ) : tokens.length ? (
        <ul className="account-list account-list-bordered">
          {tokens.map((t) => (
            <li key={t.token_id} className={`account-row${t.revoked_at ? " account-row-revoked" : ""}`}>
              <span className="account-face" aria-hidden="true">
                <Glyph name="key" size="sm" />
              </span>
              <div className="account-main">
                <span className="account-name">{t.name}</span>
                <span className="account-sub">
                  <code className="account-prefix">{t.prefix}…</code> · created {formatDate(t.created_at)} · {t.last_used_at ? `last used ${relativeTime(t.last_used_at)}` : "never used"}
                </span>
              </div>
              {t.revoked_at ? (
                <StatusBadge tone="neutral">Revoked {formatDate(t.revoked_at)}</StatusBadge>
              ) : (
                <Button size="sm" onClick={() => setTarget(t)}>
                  Revoke
                </Button>
              )}
            </li>
          ))}
        </ul>
      ) : null}
      {target ? (
        <RevokeDialog
          what={`“${target.name}”`}
          detail="Anything using this token stops working at once."
          busy={revoke.isPending}
          error={revoke.error}
          onClose={() => {
            setTarget(null);
            revoke.reset();
          }}
          onConfirm={() => revoke.mutate(target.token_id)}
        />
      ) : null}
    </Sheet>
  );
}

/** `/account`: your name, connected agents and tokens. */
export function AccountPage() {
  const me = useMe();
  const qc = useQueryClient();
  const toast = useToast();
  usePageTitle("Account and tokens");
  const [name, setName] = useState(me.data?.display_name ?? "");
  useEffect(() => {
    if (me.data && !name) setName(me.data.display_name);
    // Fill once when the account arrives; never overwrite typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me.data]);
  const save = useMutation({
    mutationFn: () => api("PATCH", "/api/v1/me", { display_name: name.trim() }),
    onSuccess: () => {
      toast("Saved.");
      void qc.invalidateQueries({ queryKey: ["me"] });
    },
  });
  const dirty = Boolean(me.data) && name.trim() !== me.data?.display_name;
  return (
    <>
      <Sheet className="account-sheet" labelledBy="account-title">
        <SheetHeader level={1} id="account-title" title="Account" count={me.data?.email} />
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (dirty && name.trim()) save.mutate();
          }}
        >
          <FormGrid className="account-form">
            <TextField
              label="Display name"
              hint="Shown beside everything you write, and everything your agents write."
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={100}
              required
            />
            <TextField label="Email" value={me.data?.email ?? ""} readOnly hint="You sign in with this address." />
          </FormGrid>
          {save.isError ? (
            <div className="account-note">
              <ErrorCallout inset error={save.error} />
            </div>
          ) : null}
          <div className="account-actions">
            <Button type="submit" variant="primary" busy={save.isPending} busyLabel="Saving…" disabled={!dirty || !name.trim()}>
              Save changes
            </Button>
          </div>
        </form>
      </Sheet>
      <ConnectedSheet />
      <TokensSheet />
    </>
  );
}
