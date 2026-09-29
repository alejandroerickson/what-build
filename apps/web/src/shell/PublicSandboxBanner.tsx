import { useState } from "react";
import { formatDateTime, untilTime } from "../lib/format.ts";
import { resetWords, useSandboxStatus } from "../lib/public-sandbox.ts";
import { Button, ButtonLink, Callout, Glyph } from "../ui/index.tsx";
import "../styles/screens/public-sandbox.css";

const seenKey = (slug: string) => `whatbuild.sandbox-notice.${slug}`;

function readSeen(slug: string): boolean {
  try {
    return localStorage.getItem(seenKey(slug)) === "seen";
  } catch {
    return false;
  }
}

/**
 * What every screen of a public sandbox says above its content: that it is public, that it is
 * erased, and the name the person writes under. In full until the person has read it, then as one
 * line that stays. It says nothing while it loads, so a screen never waits for it.
 */
export function SandboxBanner({ tenant }: { tenant: { slug: string; name: string } }) {
  const q = useSandboxStatus(tenant.slug);
  const [seen, setSeen] = useState(() => readSeen(tenant.slug));
  if (!q.data) return null;
  const s = q.data;
  const staff = s.you.role === "staff";
  const about = `/t/${tenant.slug}/sandbox`;
  const erased = s.resets.next_at ? `Erased ${untilTime(s.resets.next_at)}` : "May be erased at any time";
  if (seen)
    return (
      <p className="canvas-banner sandbox-line">
        <Glyph name="flask" size="sm" />
        <span>
          <b>Public sandbox.</b> {staff ? "Visitors work here." : `You write as ${s.you.appears_as}.`}{" "}
          <span title={s.resets.next_at ? formatDateTime(s.resets.next_at) : undefined}>{erased}.</span>
          {s.visitor_access === "read" ? " Visitors are reading only for now." : s.visitor_access === "closed" ? " Closed to visitors for now." : ""}
        </span>
        <ButtonLink to={about} size="sm" variant="quiet">
          {staff ? "Sandbox controls" : "What you can do"}
        </ButtonLink>
      </p>
    );
  return (
    <div className="canvas-banner sandbox-notice">
      <Callout
        tone="attention"
        title={`${tenant.name} is a public sandbox`}
        action={
          <>
            <ButtonLink to={about} size="sm" variant="quiet">
              {staff ? "Sandbox controls" : "What you can do"}
            </ButtonLink>
            <Button
              size="sm"
              onClick={() => {
                try {
                  localStorage.setItem(seenKey(tenant.slug), "seen");
                } catch {
                  // The notice comes back on the next visit.
                }
                setSeen(true);
              }}
            >
              Got it
            </Button>
          </>
        }
      >
        {staff ? (
          <>
            Visitors read and write here under made-up names. Everything added since the baseline is erased{" "}
            {s.resets.next_at ? `${resetWords(s.resets)} (next ${untilTime(s.resets.next_at)})` : "when you reset it"}, your own changes too, unless you save a new baseline first.
          </>
        ) : (
          <>
            Other visitors see what you add, under the name <b>{s.you.appears_as}</b>, and nobody here sees who you are. Everything added is erased{" "}
            {s.resets.next_at ? `${resetWords(s.resets)} (next ${untilTime(s.resets.next_at)})` : "whenever the sandbox is put back as it was"}. Don&rsquo;t add anything private.
          </>
        )}
      </Callout>
    </div>
  );
}
