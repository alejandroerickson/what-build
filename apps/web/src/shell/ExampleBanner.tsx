import { useState } from "react";
import { useMe, useProducts } from "../lib/session.tsx";
import { Button, ButtonLink, Callout, Glyph } from "../ui/index.tsx";
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
 * What every screen of the example organization says above its content. To a guest: that it is a
 * worked example to read, that nothing in it changes, and where their own work goes; in full until
 * they have read it, then as one line that stays. To its own people: that every account reads what
 * they write. It says nothing while it loads, so a screen never waits for it.
 */
export function ExampleBanner({ tenant }: { tenant: { tenant_id: string; slug: string; name: string } }) {
  const me = useMe();
  const products = useProducts();
  const [seen, setSeen] = useState(() => readSeen(tenant.slug));
  const here = products.data?.tenants.find((t) => t.tenant_id === tenant.tenant_id);
  if (!here || !me.data) return null;
  if (here.your_role !== "guest")
    return (
      <p className="canvas-banner example-line">
        <Glyph name="library" size="sm" />
        <span>
          <b>Example organization.</b> You&rsquo;re an author here: everyone who signs in sees what you change.
        </span>
      </p>
    );
  const ownOrgs = products.data!.tenants.filter((t) => !t.example).length;
  const mayStart = me.data.tenant_allowance.remaining !== 0;
  const start = !ownOrgs && mayStart ? (
    <ButtonLink to="/welcome" size="sm" variant={seen ? "quiet" : "primary"}>
      Start your organization
    </ButtonLink>
  ) : null;
  if (seen)
    return (
      <p className="canvas-banner example-line">
        <Glyph name="library" size="sm" />
        <span>
          <b>Example organization</b> · read only
        </span>
        {start}
      </p>
    );
  return (
    <div className="canvas-banner example-notice">
      <Callout
        tone="info"
        title="This is the example organization"
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
        A worked discovery to learn from. Read it, search it and point your agent at it; nothing here can be changed.
        {!ownOrgs && !mayStart ? " For an organization of your own, ask whoever runs this WhatBuild." : ""}
      </Callout>
    </div>
  );
}
