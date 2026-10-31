import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { api } from "../lib/api.ts";
import { aRole, formatDate, plural, scopeWords } from "../lib/format.ts";
import { useMe } from "../lib/session.tsx";
import { Button, Callout, ErrorCallout, Sheet, SheetBody, SheetHeader, useToast } from "../ui/index.tsx";
import "../styles/screens/account.css";

/** An invitation as the person it was sent to reads it. `invited_by` is already in quotation marks. */
export interface Invitation {
  invitation_id: string;
  tenant: { slug: string; name: string } | null;
  scope_type: "tenant" | "team" | "product";
  scope: string | null;
  role: string;
  invited_by: string;
  expires_at: string;
}

/** How an invitation is named in a request: its id from the person's list, or its link's token. */
type Named = { invitation_id: string } | { token: string };

/** The invitations waiting for this person's answer. Nothing is asked until someone is signed in. */
export function useInvitations() {
  const me = useMe();
  return useQuery({
    queryKey: ["invitations"],
    queryFn: () => api<{ items: Invitation[] }>("GET", "/api/v1/me/invitations"),
    enabled: Boolean(me.data),
    staleTime: 60_000,
  });
}

/** What the role lets them do there, said before they choose. */
const ROLE_MEANS: Record<string, string> = {
  owner: "You could run the organization with its other owners.",
  admin: "You could manage its people and permanently delete what’s in it.",
  editor: "You could add and change what’s there.",
  viewer: "You could read everything there.",
  reader: "You could read the Story and nothing else.",
  member: "You’d be in the organization, and its admins give roles on its teams and products.",
};

const orgOf = (i: Pick<Invitation, "tenant">) => i.tenant?.name ?? "the organization";

/** The role and where it applies: "an admin of the organization", "an editor on the Core team". */
export function roleWords(i: Pick<Invitation, "scope_type" | "scope" | "role">): string {
  return i.scope_type === "tenant" || !i.scope ? `${aRole(i.role)} of the organization` : `${aRole(i.role)} on ${scopeWords(i.scope_type, i.scope)}`;
}

/** The choice in words: who asks, for what role and where, what it lets them do, and until when. */
export function InvitationWords({ invitation: i }: { invitation: Invitation }) {
  return (
    <>
      {i.invited_by} invited you as {roleWords(i)}. {ROLE_MEANS[i.role] ?? ""} It’s open until {formatDate(i.expires_at)}.
    </>
  );
}

/**
 * Accept or decline, from the person's list or the link. Each settles the person's standing, so
 * whatever depends on it asks again: their organizations, and whether they are still a guest.
 */
export function useInvitationAnswer() {
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const settle = async () => {
    await Promise.all([qc.invalidateQueries({ queryKey: ["invitations"] }), qc.invalidateQueries({ queryKey: ["me"] }), qc.invalidateQueries({ queryKey: ["products"] }), qc.invalidateQueries({ queryKey: ["guest-pass"] })]);
  };
  const accept = useMutation({
    mutationFn: (named: Named) => api<{ already: boolean } & Invitation>("POST", "/api/v1/invitations/accept", named),
    onSuccess: async (r) => {
      toast(r.scope_type === "tenant" || !r.scope ? `You’re ${aRole(r.role)} of ${orgOf(r)}.` : `You’re in ${orgOf(r)}, as ${roleWords(r)}.`);
      await settle();
      navigate("/", { replace: true });
    },
  });
  const decline = useMutation({
    mutationFn: (named: Named) => api<{ declined: true } & Invitation>("POST", "/api/v1/invitations/decline", named),
    onSuccess: settle,
  });
  return { accept, decline };
}

/** One invitation in the person's list: its words, Accept and Decline. A refusal says why, and the list is asked for again. */
function InvitationRow({ invitation: i, inset, onAnswered }: { invitation: Invitation; inset?: boolean; onAnswered: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { accept, decline } = useInvitationAnswer();
  const titleId = useId();
  const org = orgOf(i);
  const refused = (e: unknown, what: string) => {
    toast(`Couldn’t ${what} the invitation to ${org}. ${(e as Error).message}`, { tone: "negative" });
    void qc.invalidateQueries({ queryKey: ["invitations"] });
  };
  return (
    <li className="invitation-row" aria-labelledby={titleId}>
      <Callout
        inset={inset}
        title={<span id={titleId}>Join {org}?</span>}
        action={
          <>
            <Button
              variant="quiet"
              aria-label={`Decline the invitation to ${org}`}
              disabled={accept.isPending}
              busy={decline.isPending}
              busyLabel="Declining…"
              // The promise, not mutate's own callbacks: answering takes this row off the list, and those wouldn't run once it's gone.
              onClick={() =>
                void decline.mutateAsync({ invitation_id: i.invitation_id }).then(
                  () => {
                    toast(`You declined the invitation to ${org}. They’ll see one was declined, not your name.`);
                    onAnswered();
                  },
                  (e: unknown) => refused(e, "decline"),
                )
              }
            >
              Decline
            </Button>
            <Button
              aria-label={`Accept the invitation to ${org}`}
              disabled={decline.isPending}
              busy={accept.isPending}
              busyLabel="Joining…"
              onClick={() => void accept.mutateAsync({ invitation_id: i.invitation_id }).catch((e: unknown) => refused(e, "accept"))}
              data-invitation-accept=""
            >
              Accept
            </Button>
          </>
        }
      >
        <InvitationWords invitation={i} />
      </Callout>
    </li>
  );
}

/** How many a screen shows until asked for the rest, so a flood of invitations never buries it. */
const SHOWN = 3;

function InvitationList({ items, inset }: { items: Invitation[]; inset?: boolean }) {
  const [all, setAll] = useState(false);
  const list = useRef<HTMLUListElement>(null);
  // The answered row goes: focus moves to the next one's Accept, or to the screen once none is left.
  const moveFocus = () =>
    requestAnimationFrame(() => {
      const next = list.current?.querySelector<HTMLElement>("[data-invitation-accept]") ?? document.getElementById("main");
      next?.focus({ preventScroll: true });
    });
  const shown = all ? items : items.slice(0, SHOWN);
  return (
    <>
      <ul className="invitation-list" ref={list}>
        {shown.map((i) => (
          <InvitationRow key={i.invitation_id} invitation={i} inset={inset} onAnswered={moveFocus} />
        ))}
      </ul>
      {items.length > shown.length ? (
        <Button size="sm" variant="quiet" className="invitation-more" onClick={() => setAll(true)}>
          Show {plural(items.length - shown.length, "more invitation")}
        </Button>
      ) : null}
    </>
  );
}

/**
 * Above every screen in the shell: the invitations waiting for an answer, wherever someone lands.
 * It says nothing while it loads, or when there are none, so a screen never waits for it.
 */
export function InvitationsBanner() {
  const q = useInvitations();
  if (q.data?.items.length)
    return (
      <section className="canvas-banner" aria-label="Invitations waiting for your answer">
        <InvitationList items={q.data.items} />
      </section>
    );
  if (!q.isError) return null;
  return (
    <div className="canvas-banner">
      <ErrorCallout title="Your invitations couldn’t be loaded" error={q.error} onRetry={() => q.refetch()} />
    </div>
  );
}

/** The same on the screens outside the shell: first run, and the guests' waiting page. */
export function InvitationsSheet() {
  const q = useInvitations();
  const titleId = useId();
  if (q.data?.items.length)
    return (
      <Sheet labelledBy={titleId}>
        <SheetHeader id={titleId} title="Invitations for you" count={q.data.items.length} />
        <SheetBody>
          <InvitationList items={q.data.items} inset />
        </SheetBody>
      </Sheet>
    );
  if (!q.isError) return null;
  return (
    <Sheet label="Your invitations">
      <SheetBody>
        <ErrorCallout inset title="Your invitations couldn’t be loaded" error={q.error} onRetry={() => q.refetch()} />
      </SheetBody>
    </Sheet>
  );
}
