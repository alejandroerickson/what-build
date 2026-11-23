import { useState } from "react";
import { useMe, useProducts } from "../lib/session.tsx";
import { Button, ButtonLink, Callout, Glyph } from "../ui/index.tsx";
import { AskForOrganization } from "./ask-for-organization.tsx";
import { timeLeft, useGuestPass } from "./guest-gate.tsx";
import "../styles/screens/limits.css";

const seenKey = (slug: string) => `whatbuild.example-notice.${slug}`;

function readSeen(slug: string): boolean {
  try {
    return localStorage.getItem(seenKey(slug)) === "seen";
  } catch {
    return false;
  }
}

/**
 * What every screen of the example organization, the demo, says above its content. To a guest with
 * no organization of their own, an invitation: like what you see, start using WhatBuild and engineer
 * your next product; the button starts one where they may, or takes one of the day's places, or puts
 * them in line, and then the banner says it is on its way. To a guest with one: that this is the
 * demo, to read. In full until they press Got it, then as one line that stays, with the same
 * button. To its own people, who may only read: that every account reads what its authors write. It
 * says nothing while it loads, so a screen never waits for it.
 */
export function ExampleBanner({ tenant }: { tenant: { tenant_id: string; slug: string; name: string } }) {
  const me = useMe();
  const products = useProducts();
  const [seen, setSeen] = useState(() => readSeen(tenant.slug));
  const pass = useGuestPass();
  // A guest account has a while in WhatBuild each day; say how much is left.
  const left = pass?.guest && pass.minutes_left !== undefined ? <span className="faint"> · {timeLeft(pass.minutes_left)} left today</span> : null;
  const here = products.data?.tenants.find((t) => t.tenant_id === tenant.tenant_id);
  if (!here || !me.data) return null;
  if (here.your_role !== "guest")
    return (
      <p className="canvas-banner example-line">
        <Glyph name="library" size="sm" />
        <span>
          <b>Example organization.</b> Everyone who signs in sees what its authors change.
        </span>
      </p>
    );
  const ownOrgs = products.data!.tenants.filter((t) => !t.example).length;
  const mayStart = me.data.tenant_allowance.remaining !== 0;
  const waiting = !ownOrgs && !mayStart && Boolean(me.data.asked_for_organization_at);
  const start = ownOrgs || waiting ? null : mayStart ? (
    <ButtonLink to="/welcome" size="sm" variant="primary">
      Start using WhatBuild
    </ButtonLink>
  ) : (
    <AskForOrganization label="Start using WhatBuild" />
  );
  if (seen)
    return (
      <p className="canvas-banner example-line">
        <Glyph name="library" size="sm" />
        <span>
          <b>Demo</b> · read only
          {waiting ? " · your organization is on its way" : null}
          {left}
        </span>
        {start}
      </p>
    );
  const [title, words] = ownOrgs
    ? ["This is the demo", "A demo to learn from. Nothing here can be changed."]
    : waiting
      ? ["Your organization is on its way", `We’ll email ${me.data.email} as soon as it’s ready. Meanwhile, read on: nothing here can be changed.`]
      : ["Like what you see?", "Start using WhatBuild and engineer your next product. This demo is here to read: nothing in it can be changed."];
  return (
    <div className="canvas-banner example-notice">
      <Callout
        tone="info"
        title={title}
        action={
          <>
            {start}
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
        {words}
      </Callout>
    </div>
  );
}
