import { useQuery } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { api } from "../lib/api.ts";
import { useProduct } from "../lib/session.tsx";
import { Button, ButtonLink, useToast } from "../ui/index.tsx";

/**
 * A list in a product with nothing in it yet: what belongs here, then how an agent fills it, with a
 * request to copy and, until one is connected, Connect an agent. Every destination uses it the same
 * way. Adding an item yourself stays in the sheet header, where it is once the list has items, so
 * the empty list offers one path in its body and the other where it always is.
 *
 * `ask` is the request for an agent. It is left out for people who cannot write here.
 */
export function FirstUse({ title, children, ask }: { title: string; children: ReactNode; ask?: string }) {
  const { app, canWrite } = useProduct();
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  // The person's connected agents are account-wide; the Connect page shares this query.
  const agents = useQuery({
    queryKey: ["agents"],
    enabled: Boolean(ask && canWrite),
    queryFn: () => api<{ items: unknown[] }>("GET", "/api/v1/me/agents"),
  });
  const connected = Boolean(agents.data?.items.length);
  const request = canWrite ? ask : undefined;
  const copy = () =>
    navigator.clipboard
      .writeText(request ?? "")
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
        toast("Copied. Paste it to your agent.");
      })
      .catch(() => toast("Couldn't copy. Select the text and copy it yourself.", { tone: "negative" }));
  return (
    <div className="empty empty-inline first-use">
      <p className="empty-title">{title}</p>
      <div className="empty-text">{children}</div>
      {request ? (
        <div className="first-use-agent">
          <p className="first-use-lead">{connected ? "Ask your agent:" : "Connect an agent and ask it:"}</p>
          <p className="first-use-request">
            <q>{request}</q>
          </p>
          <div className="empty-action">
            {connected ? null : (
              <ButtonLink to={`${app}/connect`} variant="primary" icon="bot">
                Connect an agent
              </ButtonLink>
            )}
            <Button icon={copied ? "check" : "copy"} onClick={copy} aria-label="Copy the request for your agent">
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
