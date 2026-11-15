import { useQuery } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { useConnectedAgentCount } from "../lib/agents.ts";
import { api } from "../lib/api.ts";
import { useProduct } from "../lib/session.tsx";
import { CopyField, ErrorCallout, keepFocusAt, Loading, Segmented, SheetBody, SheetHeader, StatusBadge, useToast } from "../ui/index.tsx";
import "../styles/screens/connect-steps.css";

/** The addresses an agent connects to: the plain one and the templates for one organization or product. */
export interface ConnectInfo {
  mcp_url: string;
  /** The address scoped to one organization, with `{tenant}` to fill in. */
  tenant_url_template: string;
  /** The address scoped to one product, with `{tenant}/{product}` to fill in. */
  bound_url_template: string;
}

export const CONNECT_KEY = ["connect"] as const;

export function useConnectInfo(enabled = true) {
  return useQuery({ queryKey: CONNECT_KEY, enabled, queryFn: () => api<ConnectInfo>("GET", "/api/v1/connect") });
}

/** What the steps fill in: the address, and the names the agent is told to give it. */
export interface ConnectTarget {
  url: string;
  /** What a connector is named in Claude. */
  connector: string;
  /** What the server is called in Claude Code's command. */
  server: string;
}

export type AgentKind = "claude" | "claude-code" | "other";

/**
 * Each agent's steps, kept here and nowhere else, so they are easy to keep true to what the agent
 * shows. Steps 1 and 2 are the agent's own; 3 and 4 are the same for every agent, naming it.
 *
 * Claude: Customize, then Connectors, then Add, then Add custom connector, which asks for a name
 * and the address (support.claude.com, "Getting started with custom connectors using remote MCP").
 * On a Team or Enterprise plan only an owner adds one, in Organization settings, then Connectors,
 * and each member then chooses Connect beside it.
 *
 * Claude Code: `claude mcp add` registers a server for the current project only unless it is given
 * `--scope user`; in a session, `/mcp`, then the server, then Authenticate opens the browser to sign
 * in (code.claude.com/docs, "Connect Claude Code to tools via MCP").
 */
export const AGENTS: Record<AgentKind, {
  label: string;
  /** Step 1: what to copy. */
  copy: { lead: string; label: string; value: (t: ConnectTarget) => string };
  /** Step 2: where it goes, and a note under it. */
  add: (t: ConnectTarget) => ReactNode;
  note?: string;
  /** The agent as steps 3 and 4 name it, inside a sentence and starting one. */
  name: string;
  Name: string;
}> = {
  claude: {
    label: "Claude",
    copy: { lead: "Copy WhatBuild’s address:", label: "WhatBuild’s address", value: (t) => t.url },
    add: (t) => `In Claude, open Customize, then Connectors. Choose Add, then Add custom connector, name it ${t.connector} and paste the address.`,
    note: "On a Team or Enterprise plan, ask an owner to add it in Organization settings, then Connectors. Then choose Connect beside it.",
    name: "Claude",
    Name: "Claude",
  },
  "claude-code": {
    label: "Claude Code",
    copy: { lead: "Copy this command:", label: "Command for Claude Code", value: (t) => `claude mcp add --scope user --transport http ${t.server} ${t.url}` },
    add: (t) => (
      <>
        Run it in a terminal, then start Claude Code, type <code>/mcp</code>, choose <code>{t.server}</code> and choose Authenticate.
      </>
    ),
    name: "Claude Code",
    Name: "Claude Code",
  },
  other: {
    label: "Another agent",
    copy: { lead: "Copy WhatBuild’s address:", label: "WhatBuild’s address", value: (t) => t.url },
    add: () => "In your agent’s settings, add it as a remote MCP server. Some call this a custom connector or an integration.",
    name: "your agent",
    Name: "Your agent",
  },
};

const KINDS = Object.keys(AGENTS) as AgentKind[];

/**
 * The agent the person chose, kept on this device (`whatbuild.agent`, a choice about the device, kept
 * at sign-out), and shared by every set of steps on the screen, so Settings over Idea and the sheet
 * under it agree.
 */
const AGENT_KEY = "whatbuild.agent";
const listeners = new Set<() => void>();
/** The choice while storage is blocked, for as long as the page is open. */
let unstored: AgentKind | null = null;

function readAgent(): AgentKind {
  try {
    const v = localStorage.getItem(AGENT_KEY);
    return v && (KINDS as string[]).includes(v) ? (v as AgentKind) : "claude";
  } catch {
    return unstored ?? "claude";
  }
}

function chooseAgent(kind: AgentKind) {
  try {
    localStorage.setItem(AGENT_KEY, kind);
  } catch {
    unstored = kind;
  }
  for (const l of listeners) l();
}

function subscribe(l: () => void) {
  listeners.add(l);
  const fromAnotherTab = (e: StorageEvent) => {
    if (e.key === AGENT_KEY || e.key === null) l();
  };
  window.addEventListener("storage", fromAnotherTab);
  return () => {
    listeners.delete(l);
    window.removeEventListener("storage", fromAnotherTab);
  };
}

export function useAgentKind(): [AgentKind, (kind: AgentKind) => void] {
  return [useSyncExternalStore(subscribe, readAgent, () => "claude" as AgentKind), chooseAgent];
}

function Step({ n, children }: { n: number; children: ReactNode }) {
  return (
    <li className="agents-step">
      <span className="agents-step-n num" aria-hidden="true">
        {n}
      </span>
      <div className="agents-step-body">{children}</div>
    </li>
  );
}

/**
 * Connecting an agent, step by step: a choice of agent, then four numbered steps for it, each saying
 * where it happens, since the person goes to their agent, meets a WhatBuild page it opens, and comes
 * back. Connect your agent on Idea and Settings → Agents both use it, so the two never differ;
 * Settings adds to steps 1, 3 and 4 what only it does (limiting the agent, its levels, a first request).
 */
export function ConnectSteps({ target, addressExtra, signInExtra, doneExtra }: {
  target: ConnectTarget;
  /** Under the address or command, given the chosen agent. */
  addressExtra?: (kind: AgentKind) => ReactNode;
  signInExtra?: ReactNode;
  doneExtra?: ReactNode;
}) {
  const [kind, setKind] = useAgentKind();
  const a = AGENTS[kind];
  return (
    <>
      <div className="connect-choice">
        <Segmented label="Your agent" items={KINDS.map((k) => ({ id: k, label: AGENTS[k].label }))} value={kind} onChange={(id) => setKind(id as AgentKind)} />
      </div>
      <ol className="agents-steps" aria-label={`Steps for ${a.label}`}>
        <Step n={1}>
          <p className="agents-step-text">
            <span className="visually-hidden">Step 1: </span>
            {a.copy.lead}
          </p>
          <div className="agents-address">
            <CopyField label={a.copy.label} value={a.copy.value(target)} />
          </div>
          {addressExtra?.(kind)}
        </Step>
        <Step n={2}>
          <p className="agents-step-text">
            <span className="visually-hidden">Step 2: </span>
            {a.add(target)}
          </p>
          {a.note ? <p className="agents-step-note">{a.note}</p> : null}
        </Step>
        <Step n={3}>
          <p className="agents-step-text">
            <span className="visually-hidden">Step 3: </span>
            {a.Name} opens a WhatBuild page in your browser. Sign in there and choose what {a.name} may do.
          </p>
          {signInExtra}
        </Step>
        <Step n={4}>
          <p className="agents-step-text">
            <span className="visually-hidden">Step 4: </span>
            Come back to this page. It says Connected once {a.name} is in.
          </p>
          {doneExtra}
        </Step>
      </ol>
    </>
  );
}

/**
 * Connect your agent, at the top of Idea for someone who can write in the product and has no agent
 * connected: with none, connecting one is the first thing to do there, so nothing dismisses it. It
 * gives the plain address (Settings → Agents limits it to one organization or product). Once an
 * agent is connected, which the shared query hears when the person comes back, it goes, saying so,
 * and does not come back while they have one.
 */
export function ConnectYourAgent() {
  const { canWrite } = useProduct();
  const count = useConnectedAgentCount(canWrite);
  const info = useConnectInfo(canWrite && count === 0);
  const toast = useToast();
  const id = useId();
  const sheet = useRef<HTMLElement>(null);
  // Shown on this visit with no agent: when one connects, it says so before it goes.
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (count === 0) setShown(true);
    else if (count && shown) {
      // Focus stays on the screen, not lost with the sheet.
      if (sheet.current?.contains(document.activeElement)) keepFocusAt(sheet.current.parentElement);
      toast("Connected. Ask your agent to start.");
      setShown(false);
    }
  }, [count, shown, toast]);
  if (!canWrite || !(count === 0 || (count && shown))) return null;
  return (
    <section ref={sheet} className="sheet connect-sheet" aria-labelledby={id} data-connect-sheet="">
      <SheetHeader id={id} title="Connect your agent" end={<StatusBadge tone="neutral">Not connected yet</StatusBadge>} />
      <SheetBody className="connect-lead">
        <p>Your agent does the writing here: it reads your material and drafts outcomes, mockups and the Story.</p>
      </SheetBody>
      {info.isPending ? (
        <SheetBody>
          <Loading lines={3} variant="lines" label="Loading WhatBuild’s address…" />
        </SheetBody>
      ) : info.isError ? (
        <SheetBody>
          <ErrorCallout inset error={info.error} onRetry={() => info.refetch()} />
        </SheetBody>
      ) : (
        <ConnectSteps target={{ url: info.data.mcp_url, connector: "WhatBuild", server: "whatbuild" }} />
      )}
    </section>
  );
}
