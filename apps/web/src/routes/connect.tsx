import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { api } from "../lib/api.ts";
import { formatDate, relativeTime } from "../lib/format.ts";
import { useMe } from "../lib/session.tsx";
import { useLastProduct } from "../shell/panel.tsx";
import { usePageTitle } from "../shell/slots.tsx";
import { AgentFace, Button, CopyField, Dialog, EmptyState, ErrorCallout, Loading, Sheet, SheetBody, SheetHeader, useToast } from "../ui/index.tsx";
import "../styles/screens/account.css";

interface ConnectInfo {
  mcp_url: string;
  skill: { name: string; version: string; zip_url: string };
}

interface ConnectedAgent {
  client_name: string;
  family_id: string;
  last_used_at: string | null;
  created_at: string;
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

/**
 * `/connect`: the one address an MCP client needs, and the agents connected now. The client finds
 * sign-in on its own (OAuth discovery), and the server tells the agent which skill version to use.
 */
export function ConnectPage() {
  const info = useQuery({ queryKey: ["connect"], queryFn: () => api<ConnectInfo>("GET", "/api/v1/connect") });
  const last = useLastProduct();
  usePageTitle("Connect an agent");
  const c = info.data;
  return (
    <>
      <Sheet className="agents-sheet" labelledBy="agents-title">
        <SheetHeader level={1} id="agents-title" title="Connect an agent" />
        <SheetBody className="agents-intro">
          <p className="muted">Your agent works as you, with your access, and Activity shows what it changes. What it reads goes to whoever runs it, under their terms.</p>
        </SheetBody>
        {info.isPending ? (
          <Loading lines={3} variant="lines" label="Loading the server address…" />
        ) : info.isError ? (
          <SheetBody>
            <ErrorCallout inset error={info.error} onRetry={() => info.refetch()} />
          </SheetBody>
        ) : c ? (
          <ol className="agents-steps">
            <Step n={1} title="Add this MCP server to your agent">
              <CopyField label="MCP server URL" value={c.mcp_url} />
            </Step>
            <Step n={2} title="Sign in when it asks">
              <p>Your browser opens WhatBuild so you can approve the connection.</p>
            </Step>
            <Step n={3} title="Ask it to start">
              <p>
                For example: &ldquo;Add the interview notes in my downloads to {last?.name ?? "my product"} as a source, then list the passages about how people plan their week.&rdquo;
              </p>
            </Step>
          </ol>
        ) : null}
      </Sheet>
      <ConnectedSheet />
      {c ? (
        <p className="agents-foot">
          The server offers your agent the {c.skill.name} skill, version {c.skill.version}. Optional: <a href={c.skill.zip_url}>download it</a> to install it yourself.
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
      description={`${name} stops working in WhatBuild at once. To use it again, connect it again.`}
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
      {error ? <ErrorCallout inset error={error} /> : <p className="muted">What it already did stays in Activity, attributed as before.</p>}
    </Dialog>
  );
}

/** Agents signed in with OAuth, account-wide. */
function ConnectedSheet() {
  const q = useQuery({ queryKey: ["agents"], queryFn: () => api<{ items: ConnectedAgent[] }>("GET", "/api/v1/me/agents") });
  const me = useMe();
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
                <span className="account-sub">
                  Acting as {me.data?.display_name ?? "you"} · connected {formatDate(a.created_at)}
                </span>
                <span className="account-sub">Last active {relativeTime(a.last_used_at)}</span>
              </div>
              <Button size="sm" onClick={() => setTarget(a)}>
                Disconnect
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState size="inline" title="No agent is connected yet.">
          Your agent appears here once it signs in.
        </EmptyState>
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
