import { useQuery } from "@tanstack/react-query";
import { createContext, useContext, type ReactNode } from "react";
import { Link, useLocation } from "react-router";
import { api } from "../lib/api.ts";
import { untilTime } from "../lib/format.ts";
import { useMe, useSignOut } from "../lib/session.tsx";
import { Button, Glyph, Loading, Sheet, SheetBody, SheetHeader, StatusBadge } from "../ui/index.tsx";
import { EntryPage } from "../routes/auth.tsx";
import { AskForOrganization } from "./ask-for-organization.tsx";
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

/**
 * For a guest account (in no organization, with no allowance), the way in: while there is room it
 * shows the app, and asks again every minute, which keeps their place; when there is none, a
 * waiting page that asks again every few seconds, which keeps their place in line, and lets them in
 * on its own. Anyone else goes straight through.
 */
export function GuestGate({ children }: { children: ReactNode }) {
  const me = useMe();
  const loc = useLocation();
  const guest = Boolean(me.data?.guest);
  const pass = useQuery({
    queryKey: ["guest-pass"],
    queryFn: () => api<GuestPass>("GET", "/api/v1/me/guest-pass"),
    enabled: guest,
    refetchInterval: (q) => (q.state.data?.status === "in" ? 60_000 : Math.max(5, Math.min(60, q.state.data?.retry_after_seconds ?? 20)) * 1000),
    refetchIntervalInBackground: true,
  });
  if (!guest) return <>{children}</>;
  if (pass.isPending) return <div className="center-page"><Loading label="Finding you a place…" /></div>;
  // If the place can't be asked about, the screens themselves say what went wrong.
  if (pass.isError || pass.data.status === "in" || OPEN_WHILE_WAITING.has(loc.pathname))
    return <GuestPassContext.Provider value={pass.data ?? null}>{children}</GuestPassContext.Provider>;
  return <WaitingRoom pass={pass.data} />;
}

/** Hours and minutes, as a person reads a time left: "1 h 40 min", "25 min". */
export function timeLeft(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? `${h} h${m ? ` ${m} min` : ""}` : `${m} min`;
}

function WaitingRoom({ pass }: { pass: GuestPass }) {
  const signOut = useSignOut();
  const resets = pass.resets_at ? untilTime(pass.resets_at) : "at midnight UTC";
  const words =
    pass.reason === "full"
      ? {
          title: "WhatBuild is full right now",
          lead: `${pass.in_now ?? "Every"} ${pass.in_now === 1 ? "guest is" : "guests are"} exploring, the most it lets in at once. You’ll come in on your own as soon as a place frees: keep this page open.`,
          status: <StatusBadge tone="progress">Number {pass.position} in line</StatusBadge>,
        }
      : pass.reason === "new_today"
        ? {
            title: "Today’s places for new guests are taken",
            lead: `WhatBuild lets a few new guests in each day, and today’s have come in. Come back ${resets}, at midnight UTC.`,
            status: <StatusBadge tone="attention">Opens again {resets}</StatusBadge>,
          }
        : pass.reason === "time_today"
          ? {
              title: "You’ve used today’s time",
              lead: `Each guest has a while in WhatBuild each day, and you’ve had yours. It starts again ${resets}, at midnight UTC.`,
              status: <StatusBadge tone="attention">Back {resets}</StatusBadge>,
            }
          : {
              title: "WhatBuild isn’t letting guests in right now",
              lead: "Try again later. This page asks again on its own.",
              status: <StatusBadge tone="neutral">Closed to guests</StatusBadge>,
            };
  return (
    <EntryPage title={`${words.title} · WhatBuild`}>
      <Sheet labelledBy="waiting-title">
        <SheetHeader level={1} id="waiting-title" title={words.title} />
        <SheetBody className="waiting">
          <div className="waiting-status" aria-live="polite">
            {words.status}
          </div>
          <p>{words.lead}</p>
          <p className="muted">As a guest you read the example organization, a real discovery, and can point your agent at it. Organizations of your own open a few at a time.</p>
          <AskForOrganization variant="quiet" />
          <div className="waiting-actions">
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
