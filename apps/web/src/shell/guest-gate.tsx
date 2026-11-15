import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useEffect, type ReactNode } from "react";
import { Link, useLocation } from "react-router";
import { api, setGuestWaitingHandler } from "../lib/api.ts";
import { untilTime } from "../lib/format.ts";
import { useMe, useSignOut } from "../lib/session.tsx";
import { Button, Glyph, Loading, Sheet, SheetBody, SheetHeader, StatusBadge } from "../ui/index.tsx";
import { EntryPage } from "../routes/auth.tsx";
import { AskForOrganization } from "./ask-for-organization.tsx";
import { InvitationsSheet } from "./invitations.tsx";
import "../styles/screens/guests.css";

/** A guest account's place, as `GET /api/v1/me/guest-pass` gives it. */
export interface GuestPass {
  guest: boolean;
  status: "in" | "waiting" | "closed";
  reason?: "full" | "new_today" | "time_today" | "closed";
  position?: number;
  in_now?: number;
  retry_after_seconds?: number;
  resets_at?: string;
  minutes_left?: number;
}

const GuestPassContext = createContext<GuestPass | null>(null);

/** A guest account's place while they are in, for the screens that say how long they have left; null for anyone else. */
export function useGuestPass(): GuestPass | null {
  return useContext(GuestPassContext);
}

/** Screens a guest reaches while waiting: their own settings, where they sign out. */
const OPEN_WHILE_WAITING = new Set(["/settings"]);

/** How long a guest's place, as last asked, is taken as it stands before a new screen or a return to the tab asks again. */
const PASS_FRESH_MS = 60_000;

/**
 * For a guest account (in no organization, with no allowance), the way in: while there is room it
 * shows the app, and when there is none a waiting page. It asks only when the guest does something
 * (opens the app, moves to another screen, comes back to the tab, or asks again on the waiting
 * page), never on a timer, so an open tab nobody looks at neither holds a place nor keeps the
 * database awake. The server decides the place on every call the guest makes, and a call refused
 * because they are not in brings the waiting page at once. An invitation waiting for them shows on
 * either, since accepting one ends the wait. Anyone else goes straight through.
 */
export function GuestGate({ children }: { children: ReactNode }) {
  const me = useMe();
  const loc = useLocation();
  const qc = useQueryClient();
  const guest = Boolean(me.data?.guest);
  const pass = useQuery({
    queryKey: ["guest-pass"],
    queryFn: () => api<GuestPass>("GET", "/api/v1/me/guest-pass"),
    enabled: guest,
    staleTime: PASS_FRESH_MS,
    refetchOnWindowFocus: true,
  });
  useEffect(() => {
    if (!guest) return;
    setGuestWaitingHandler((refused) => qc.setQueryData<GuestPass>(["guest-pass"], { ...(refused as Omit<GuestPass, "guest">), guest: true }));
    return () => setGuestWaitingHandler(null);
  }, [guest, qc]);
  const { isStale, refetch } = pass;
  useEffect(() => {
    if (guest && isStale) void refetch();
    // Only a move to another screen asks again; the place going stale on its own does not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loc.pathname]);
  if (!guest) return <>{children}</>;
  if (pass.isPending) return <div className="center-page"><Loading label="Finding you a place…" /></div>;
  // If the place can't be asked about, the screens themselves say what went wrong.
  if (pass.isError || pass.data.status === "in" || OPEN_WHILE_WAITING.has(loc.pathname))
    return <GuestPassContext.Provider value={pass.data ?? null}>{children}</GuestPassContext.Provider>;
  return <WaitingRoom pass={pass.data} asking={pass.isFetching} askAgain={() => void refetch()} />;
}

/** Hours and minutes, as a person reads a time left: "1 h 40 min", "25 min". */
export function timeLeft(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? `${h} h${m ? ` ${m} min` : ""}` : `${m} min`;
}

/**
 * The waiting page. It asks again only when the guest does: with Try again while a place may free,
 * or by coming back to the tab. The title and the badge say why and until when; a line follows only
 * where there is something to do.
 */
function WaitingRoom({ pass, asking, askAgain }: { pass: GuestPass; asking: boolean; askAgain: () => void }) {
  const signOut = useSignOut();
  const resets = pass.resets_at ? untilTime(pass.resets_at) : "at midnight UTC";
  const words =
    pass.reason === "full"
      ? {
          title: "WhatBuild is full right now",
          lead: "Try again within two minutes to keep your place.",
          status: <StatusBadge tone="progress">Number {pass.position} in line</StatusBadge>,
        }
      : pass.reason === "new_today"
        ? {
            title: "Today’s places for new guests are taken",
            lead: null,
            status: <StatusBadge tone="attention">Opens again {resets}</StatusBadge>,
          }
        : pass.reason === "time_today"
          ? {
              title: "You’ve used today’s time",
              lead: null,
              status: <StatusBadge tone="attention">Back {resets}</StatusBadge>,
            }
          : {
              title: "WhatBuild isn’t letting guests in right now",
              lead: "Try again later.",
              status: <StatusBadge tone="neutral">Closed to guests</StatusBadge>,
            };
  return (
    <EntryPage title={`${words.title} · WhatBuild`}>
      <InvitationsSheet />
      <Sheet labelledBy="waiting-title">
        <SheetHeader level={1} id="waiting-title" title={words.title} />
        <SheetBody className="waiting">
          <div className="waiting-status" aria-live="polite">
            {words.status}
          </div>
          {words.lead ? <p>{words.lead}</p> : null}
          <AskForOrganization variant="quiet" />
          <div className="waiting-actions">
            {/* Today's limits change only at midnight UTC, so only a full or closed WhatBuild offers to ask again now. */}
            {pass.reason === "full" || pass.reason === "closed" ? (
              <Button size="sm" variant="primary" icon="rotate-ccw" busy={asking} busyLabel="Asking…" onClick={askAgain}>
                Try again
              </Button>
            ) : null}
            <Button size="sm" variant="quiet" icon="log-out" onClick={() => void signOut()}>
              Sign out
            </Button>
            <Link to="/settings" className="waiting-link">
              <Glyph name="settings" size="sm" /> Settings
            </Link>
          </div>
        </SheetBody>
      </Sheet>
    </EntryPage>
  );
}
