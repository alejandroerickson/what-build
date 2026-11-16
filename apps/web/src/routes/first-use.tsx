import { useState, type ReactNode } from "react";
import { Link } from "react-router";
import { useConnectedAgentCount } from "../lib/agents.ts";
import { useProduct } from "../lib/session.tsx";
import { useSettingsTo } from "../shell/settings-link.ts";
import { Button, useToast } from "../ui/index.tsx";

/**
 * A list in a product with nothing in it yet: what belongs here, then the request that gets an agent
 * to fill it, with Copy. Every destination uses it the same way. Adding an item yourself stays in the
 * sheet header, where it is once the list has items, so the empty list offers one path in its body
 * and the other where it always is.
 *
 * The line over the request says where to ask it. With no agent connected it starts from connecting
 * one: from Connect your agent above it on Idea (`connectAbove`), or, elsewhere, from a link to
 * Settings at Agents. Nothing here is a button to connect: that is the sheet's, and the panel's.
 *
 * `ask` is the request for an agent. It is left out for people who cannot write here.
 */
export function FirstUse({ title, children, ask, connectAbove = false }: { title: string; children: ReactNode; ask?: string; connectAbove?: boolean }) {
  const { canWrite } = useProduct();
  const settingsTo = useSettingsTo();
  // The person's connected agents are account-wide; Connect an agent and the panel share this query.
  const connected = Boolean(useConnectedAgentCount(Boolean(ask && canWrite)));
  const request = canWrite ? ask : undefined;
  return (
    <div className="empty empty-inline first-use">
      <p className="empty-title">{title}</p>
      <div className="empty-text">{children}</div>
      {request ? (
        <AgentRequest
          className="first-use-agent"
          request={request}
          lead={
            connected ? (
              "In your agent, ask:"
            ) : connectAbove ? (
              "Then, in your agent, ask:"
            ) : (
              <>
                <Link to={settingsTo("agents")}>Connect an agent</Link>, then ask it:
              </>
            )
          }
        />
      ) : null}
    </div>
  );
}

/**
 * A request for the person's agent, as every one is shown: the line saying where to ask it, the
 * request in quotation marks in its well, and Copy under it. A first-use list and a card on Idea
 * with no picture yet both use it, so the requests look alike.
 */
export function AgentRequest({ lead, request, className = "" }: { lead: ReactNode; request: string; className?: string }) {
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  const copy = () =>
    navigator.clipboard
      .writeText(request)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
        toast("Copied. Paste it to your agent.");
      })
      .catch(() => toast("Couldn’t copy. Select the text and copy it.", { tone: "negative" }));
  return (
    <div className={`agent-request ${className}`}>
      <p className="first-use-lead">{lead}</p>
      <p className="first-use-request">
        <q>{request}</q>
      </p>
      <div className="empty-action">
        <Button icon={copied ? "check" : "copy"} onClick={copy} aria-label="Copy the request for your agent">
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
    </div>
  );
}
