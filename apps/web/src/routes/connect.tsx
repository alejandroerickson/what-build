import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api } from "../lib/api.ts";
import { relativeTime } from "../lib/format.ts";
import { useMe } from "../lib/session.tsx";
import { Badge, Button, Callout, Card, ErrorCallout, Loading, PageHeader, TextField, useToast } from "../ui/index.tsx";

interface ConnectInfo {
  mcp_url: string;
  bound_url_template: string;
  skill: { name: string; version: string; markdown_url: string; zip_url: string; install_sh: string; install_ps1: string };
  agent_data_statement: string;
}

function CopyBlock({ label, text }: { label: string; text: string }) {
  const toast = useToast();
  return (
    <div className="copy-block">
      <div className="row-between">
        <span className="small muted">{label}</span>
        <Button
          size="sm"
          variant="quiet"
          onClick={() => {
            void navigator.clipboard.writeText(text).then(() => toast("Copied."));
          }}
        >
          Copy
        </Button>
      </div>
      <pre>
        <code>{text}</code>
      </pre>
    </div>
  );
}

export function ConnectPage() {
  const info = useQuery({ queryKey: ["connect"], queryFn: () => api<ConnectInfo>("GET", "/api/v1/connect") });
  const [skillText, setSkillText] = useState<string | null>(null);
  const toast = useToast();
  useEffect(() => {
    // Fetched before the click, so the clipboard write happens while the click still counts as one.
    if (info.data) void fetch(info.data.skill.markdown_url).then((r) => r.text()).then(setSkillText);
  }, [info.data]);
  if (info.isPending) return <Loading />;
  if (info.isError) return <ErrorCallout error={info.error} onRetry={() => info.refetch()} />;
  const c = info.data;
  return (
    <div className="stack-lg">
      <PageHeader title="Connect an agent" description="Your agent works in WhatBuild as you: it can do what you can, and everything it changes is recorded as yours, through the agent." />
      <Callout tone="info" title="About your data">
        {c.agent_data_statement}
      </Callout>
      <Card>
        <div className="stack">
          <h2 style={{ fontSize: "var(--text-lg)" }}>1. Add WhatBuild to your agent</h2>
          <p>Paste this URL as a custom connector (Claude, Claude Desktop) or MCP server. You will sign in in your browser the first time.</p>
          <CopyBlock label="MCP server URL" text={c.mcp_url} />
          <CopyBlock label="Claude Code" text={`claude mcp add --transport http whatbuild ${c.mcp_url}`} />
          <details>
            <summary>Bind it to one product</summary>
            <p className="small muted">A connector bound to one product never needs to be told which product to work in. Replace the parts in braces with a product's path from the product switcher.</p>
            <CopyBlock label="Bound URL" text={c.bound_url_template} />
          </details>
        </div>
      </Card>
      <Card>
        <div className="stack">
          <div className="row-between">
            <h2 style={{ fontSize: "var(--text-lg)" }}>2. Give it the skill</h2>
            <Badge>version {c.skill.version}</Badge>
          </div>
          <p>The skill teaches an agent how to work here: citing passages, uploading files, reviewing honestly. Agents check its version and offer to update it themselves.</p>
          <div className="row">
            <Button
              disabled={!skillText}
              onClick={() => {
                if (skillText) void navigator.clipboard.writeText(skillText).then(() => toast("Skill copied."));
              }}
            >
              Copy the skill
            </Button>
            <a className="btn btn-secondary btn-md" href={c.skill.zip_url}>
              Download ZIP
            </a>
          </div>
          <details>
            <summary>Install with a script (Claude Code)</summary>
            <p className="small muted">Each script writes one file and prints what it did. Read it before you run it.</p>
            <CopyBlock label="macOS and Linux" text={`curl -fsSL ${c.skill.install_sh} | sh`} />
            <CopyBlock label="Windows PowerShell" text={`irm ${c.skill.install_ps1} | iex`} />
          </details>
        </div>
      </Card>
      <TokensCard />
    </div>
  );
}

interface TokensResponse {
  tokens: { token_id: string; name: string; prefix: string; created_at: string; last_used_at: string | null; revoked_at: string | null }[];
  connected_agents: { client_name: string; family_id: string; last_used_at: string | null; created_at: string }[];
}

export function TokensCard() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["tokens"], queryFn: () => api<TokensResponse>("GET", "/api/v1/me/tokens") });
  const [name, setName] = useState("");
  const [created, setCreated] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: () => api<{ token: string }>("POST", "/api/v1/me/tokens", { name }),
    onSuccess: (r) => {
      setCreated(r.token);
      setName("");
      void qc.invalidateQueries({ queryKey: ["tokens"] });
    },
  });
  const revoke = useMutation({ mutationFn: (id: string) => api("DELETE", `/api/v1/me/tokens/${id}`), onSuccess: () => void qc.invalidateQueries({ queryKey: ["tokens"] }) });
  const disconnect = useMutation({ mutationFn: (family: string) => api("DELETE", `/api/v1/me/agents/${family}`), onSuccess: () => void qc.invalidateQueries({ queryKey: ["tokens"] }) });
  return (
    <Card>
      <div className="stack">
        <h2 style={{ fontSize: "var(--text-lg)" }}>Connected agents and tokens</h2>
        {q.isPending ? <Loading /> : q.isError ? <ErrorCallout error={q.error} /> : (
          <>
            {q.data.connected_agents.length ? (
              <ul className="grant-list">
                {q.data.connected_agents.map((a) => (
                  <li key={a.family_id} className="row">
                    <strong>{a.client_name}</strong>
                    <span className="small muted">last used {relativeTime(a.last_used_at)}</span>
                    <Button size="sm" variant="quiet" onClick={() => disconnect.mutate(a.family_id)}>
                      Disconnect
                    </Button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="small muted">No agents have signed in with OAuth yet.</p>
            )}
            <p className="small muted">For a client that cannot sign in in a browser, create a personal access token. It acts as you, with exactly your access.</p>
            {created ? (
              <Callout tone="success" title="Copy this token now — it is shown once">
                <code style={{ wordBreak: "break-all" }}>{created}</code>
              </Callout>
            ) : null}
            <form
              className="row"
              onSubmit={(e) => {
                e.preventDefault();
                create.mutate();
              }}
            >
              <div className="grow">
                <TextField label="Token name" placeholder="e.g. laptop script" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <Button type="submit" busy={create.isPending} busyLabel="Creating…" disabled={!name.trim()} style={{ alignSelf: "end" }}>
                Create token
              </Button>
            </form>
            <ul className="grant-list">
              {q.data.tokens.map((t) => (
                <li key={t.token_id} className="row">
                  <strong>{t.name}</strong>
                  <code className="small">{t.prefix}…</code>
                  {t.revoked_at ? <Badge>revoked</Badge> : <span className="small muted">last used {relativeTime(t.last_used_at)}</span>}
                  {!t.revoked_at ? (
                    <Button size="sm" variant="quiet" onClick={() => revoke.mutate(t.token_id)}>
                      Revoke
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </Card>
  );
}

export function AccountPage() {
  const me = useMe();
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState(me.data?.display_name ?? "");
  const save = useMutation({
    mutationFn: () => api("PATCH", "/api/v1/me", { display_name: name }),
    onSuccess: () => {
      toast("Saved.");
      void qc.invalidateQueries({ queryKey: ["me"] });
    },
  });
  return (
    <div className="stack-lg">
      <PageHeader title="Account" description={me.data?.email} />
      <Card>
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <TextField label="Display name" hint="Shown beside everything you write, and everything your agents write." value={name} onChange={(e) => setName(e.target.value)} maxLength={100} required />
          {save.isError ? <ErrorCallout error={save.error} /> : null}
          <div>
            <Button type="submit" variant="primary" busy={save.isPending} busyLabel="Saving…">
              Save
            </Button>
          </div>
        </form>
      </Card>
      <TokensCard />
    </div>
  );
}
