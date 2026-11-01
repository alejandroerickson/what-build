import { useMutation } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router";
import { api } from "../lib/api.ts";
import { useMe } from "../lib/session.tsx";
import { Button, ChoiceRow, Dialog, ErrorCallout, Segmented, TextArea, tooLong, useToast } from "../ui/index.tsx";
import { productSection } from "./panel.tsx";
import { releaseView, useRelease, type Release } from "./release.tsx";

type Kind = "issue" | "improvement" | "feature_request" | "other";

/** The kinds a person chooses between, with what the message is then asked for. Choosing none sends "other". */
const KINDS: { id: Kind; label: string; ask: string; prompt: string }[] = [
  { id: "issue", label: "Bug", ask: "What happened?", prompt: "What you did, what happened, and what you expected instead." },
  { id: "improvement", label: "Improvement", ask: "What could be better?", prompt: "What works, but could work better, and how." },
  { id: "feature_request", label: "Feature request", ask: "What should WhatBuild do?", prompt: "What you would like to do, and what it would help with." },
  { id: "other", label: "Other", ask: "Your feedback", prompt: "Anything you would like the developer of WhatBuild to know." },
];
const NONE = { ask: "Your feedback", prompt: "What broke, what could be better, or what you wish WhatBuild did." };

const MAX = 4000;
/** The count shows once a message nears the limit. */
const COUNT_FROM = 3600;

/**
 * The part of the app a path is, in words that name no organization, product or item: what a
 * report says about where it was sent from.
 */
export function screenOf(pathname: string): string | null {
  const parts = pathname.split("/").filter(Boolean);
  if (!parts.length) return "Overview";
  if (parts[0] === "t" && parts.length === 3 && parts[2] === "members") return "Members";
  if (parts[0] === "t" && parts.length === 3 && (parts[2] === "plan" || parts[2] === "limits")) return "Plan";
  if (parts[0] === "t" && parts.length >= 4) {
    const [segment, sub, item] = parts.slice(4);
    if (segment === "search") return "Search";
    if (segment === "evidence" && sub) return sub === "new" ? "Evidence, adding a source" : "Evidence, a source";
    if (segment === "exploration" && sub === "mockups") return item ? "Exploration, a mockup" : "Exploration, mockups";
    if (segment === "exploration" && sub === "assumptions") return item ? "Exploration, an assumption" : "Exploration, assumptions";
    if (segment === "story" && sub) return "Story, a page";
    return productSection(segment).label;
  }
  const top: Record<string, string> = { connect: "Connect an agent", settings: "Settings", instance: "Organizations", people: "People", welcome: "Welcome" };
  return top[parts[0]!] ?? null;
}

/** How "what's sent" names the release: the tag, the commit, or a development server. */
function releasePhrase(release: Release | undefined): string {
  if (!release) return "the version this WhatBuild runs";
  const view = releaseView(release);
  if (!view) return "that it is a development server";
  return view.lead === "Release" ? `release ${view.name}` : `commit ${view.name}`;
}

const list = (items: string[]) => (items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`);

/**
 * Submit feedback, from the account menu. The person chooses a kind (or none), writes, and sees
 * exactly what is sent: their words, the kind, the release and the screen they are on, and their
 * address only if they share it. The address itself is never shown. It stays mounted once opened,
 * so a draft survives closing it.
 */
export function FeedbackDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const me = useMe();
  const release = useRelease();
  const { pathname } = useLocation();
  const toast = useToast();
  const [kind, setKind] = useState<Kind | null>(null);
  const [message, setMessage] = useState("");
  const [reply, setReply] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const screen = screenOf(pathname);
  const asked = KINDS.find((k) => k.id === kind) ?? NONE;
  const email = me.data?.email ?? "";
  const send = useMutation({
    mutationFn: () => api("POST", "/api/v1/feedback", { category: kind ?? "other", message: message.trim(), ...(screen ? { screen } : {}), ...(reply ? { reply: true } : {}) }),
    onSuccess: () => {
      onClose();
      setKind(null);
      setMessage("");
      setReply(false);
      toast(reply ? "Thank you. Your feedback was sent, with your address." : "Thank you. Your feedback was sent.");
    },
  });
  const busy = send.isPending;
  const chars = message.trim().length;
  const ready = chars > 0 && !tooLong(message, MAX) && !busy;

  // The message takes focus once the dialog is open (its own effect has opened it by now).
  useEffect(() => {
    if (open) area.current?.focus();
    else send.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const sent = ["your feedback", ...(kind ? ["its kind"] : []), releasePhrase(release), ...(screen ? [`the screen you are on (${screen})`] : []), ...(reply && email ? ["your email address"] : [])];
  const kept = ["your name", ...(reply ? [] : ["your email address"]), "your organizations, products and anything in them"];

  return (
    <Dialog
      open={open}
      onClose={onClose}
      dismissable={!busy}
      title="Submit feedback"
      description="Tell the developer of WhatBuild what broke, what could be better, or what you wish it did."
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" busy={busy} busyLabel="Sending…" disabled={!ready} onClick={() => send.mutate()}>
            Send feedback
          </Button>
        </>
      }
    >
      <Segmented
        label="Kind of feedback"
        equal
        className="feedback-kinds"
        items={KINDS.map((k) => ({ id: k.id, label: k.label }))}
        value={kind ?? ""}
        onChange={(id) => setKind((now) => (now === id ? null : (id as Kind)))}
      />
      <TextArea
        ref={area}
        label={asked.ask}
        className="feedback-message"
        value={message}
        maxLength={MAX}
        placeholder={asked.prompt}
        hint={chars >= COUNT_FROM ? <span className="num">{chars.toLocaleString()} of {MAX.toLocaleString()} characters</span> : null}
        onChange={(e) => setMessage(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && ready) {
            e.preventDefault();
            send.mutate();
          }
        }}
      />
      <section className="feedback-sent" aria-label="What is sent">
        <dl className="kv">
          <div className="kv-row">
            <dt>Sent</dt>
            <dd>{capitalize(list(sent))}.</dd>
          </div>
          <div className="kv-row">
            <dt>Not sent</dt>
            <dd>{capitalize(list(kept))}.</dd>
          </div>
        </dl>
        {email ? (
          <ChoiceRow
            className="feedback-reply"
            label="Share my email address with the developer of WhatBuild, so they can reply"
            checked={reply}
            onChange={(e) => setReply(e.target.checked)}
          />
        ) : null}
      </section>
      {send.isError ? <ErrorCallout inset error={send.error} title="Your feedback wasn’t sent" /> : null}
    </Dialog>
  );
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
