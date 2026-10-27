import { ACCOUNT_DELETION } from "@whatbuild/core/account-deletion";
import { useEffect, type ReactNode } from "react";
import { anyPriced } from "../lib/limits.ts";
import { BrandMark } from "../shell/brand.tsx";
import { Callout } from "../ui/feedback.tsx";
import { Sheet, SheetBody, SheetHeader } from "../ui/layout.tsx";
import { ANALYTICS_ID, SiteFrame, sitePath, useSite } from "./SitePage.tsx";

/**
 * When the page's own text last changed in a way that matters to a person: what is kept, why, who
 * handles it, for how long, or what they can do. A change of wording alone leaves it.
 */
const LAST_CHANGED = "October 2026";

/** A contact as the deployment gives it: an address to write to, or a page. */
function Contact({ to }: { to: string }) {
  if (/^[^\s@]+@[^\s@]+$/.test(to)) return <a href={`mailto:${to}`}>{to}</a>;
  if (/^https?:\/\//.test(to)) return <a href={to} target="_blank" rel="noreferrer">{to}</a>;
  return <>{to}</>;
}

function Kept({ lead, children }: { lead: string; children: ReactNode }) {
  return (
    <li>
      <b>{lead}</b> {children}
    </li>
  );
}

/**
 * The site's privacy page, at `/privacy` on its domain, or `/site/privacy/` on the app's origin for a
 * deployment without one (the app links to it by `privacy_url` from `/api/v1/meta`). It says what WhatBuild keeps about a person, why, who else
 * handles it, for how long, and what they can ask, in categories rather than mechanics, so it stays
 * true as the product changes ([decision](okf/decisions/the-privacy-page-is-a-short-notice-written-to-stay-true.md)).
 * Who runs the deployment, how to reach them and who else handles the data are written into the
 * page by whoever serves it; everything else is true of every WhatBuild (okf/spec/09-data-lifecycle.md §9.1).
 * Its links into the app (Settings, Cookies) are plain addresses the site's domain sends on to the app.
 */
export function SitePrivacyPage() {
  const site = useSite();
  useEffect(() => {
    document.title = "Privacy · WhatBuild";
  }, []);
  const p = site?.privacy;
  const operator = p?.operator ?? "Whoever runs this WhatBuild";
  const ask = p?.contact ? <Contact to={p.contact} /> : "whoever runs this WhatBuild";
  // Analytics is named where the app or the site loads it for those who accept it.
  const analytics = Boolean(p?.analytics || ANALYTICS_ID);
  return (
    <SiteFrame>
      <Sheet className="site-plans-intro" labelledBy="privacy-title">
        <a href={sitePath("")} className="site-lockup" aria-label="WhatBuild, home">
          <BrandMark size={22} />
          <span>WhatBuild</span>
        </a>
        <h1 id="privacy-title" className="site-plans-title">
          Privacy
        </h1>
        <p className="site-privacy-changed">Last changed {LAST_CHANGED}</p>
        {p ? (
          <p className="privacy-text">
            This page says what WhatBuild keeps about you, why, who else handles it, how long it stays, and what you can ask. {operator} is responsible for what this
            WhatBuild keeps{p.operator ? "" : ", and has not named themselves here yet"}. Questions and requests go to {ask}.
          </p>
        ) : null}
      </Sheet>
      {p ? (
        <>
          <Sheet labelledBy="privacy-kept">
            <SheetHeader id="privacy-kept" title="What is kept" />
            <SheetBody>
              <ul className="privacy-list">
                <Kept lead="Your account.">The email address you sign in with and your name, and the addresses of the people you invite.</Kept>
                <Kept lead="Your organizations.">
                  The name of each organization you start or join, and the names and emails of the people in it. {operator} sees these, to write to its people
                  {anyPriced(site?.plans) ? " and to bill the organization" : ""}.
                </Kept>
                <Kept lead="What you add.">
                  Everything you, and the agents you connect, put into an organization. It is kept with your name on it, so the people you work with know who added what.
                </Kept>
                <Kept lead="Records of running the service.">
                  Your sessions, the agents you have connected, a log of requests, and how much you use WhatBuild, to keep it within its limits and fair to everyone. WhatBuild
                  also counts how it is used, under a code in place of your name. None of it holds your content.
                </Kept>
                {analytics ? (
                  <Kept lead="Analytics, if you accept it.">
                    Google Analytics sees which screens you open and what you do there, never names or content. <a href="/cookies">Cookies</a> holds your choice.
                  </Kept>
                ) : null}
                <Kept lead="What you send.">Feedback, and a request for an organization of your own, with your name and email.</Kept>
              </ul>
              <p className="privacy-text privacy-after">
                Your account, your organizations, what you add, your sessions, your agents and how much you use WhatBuild are kept because you use it: without them there is
                no service. The log and the counts of use are kept to run WhatBuild safely and make it better, which you may object to. Analytics runs only with your consent.
              </p>
            </SheetBody>
          </Sheet>
          <Sheet labelledBy="privacy-who">
            <SheetHeader id="privacy-who" title="Who else handles it" />
            <SheetBody>
              <p className="privacy-text">{p.providers ?? `${operator} has not said yet which other companies handle it.`}</p>
              <p className="privacy-text">
                They handle it only to do that work, and may be outside your country, under their own data-protection terms. Your content is kept apart per organization and
                encrypted in transit. The people in your organization see what you add there. An agent you connect reads what you let it; what happens to that is up to
                whoever runs the agent. Nothing is sold, there is no advertising, and no model is trained on your content.
              </p>
            </SheetBody>
          </Sheet>
          <Sheet labelledBy="privacy-long">
            <SheetHeader id="privacy-long" title="How long it stays" />
            <SheetBody>
              <p className="privacy-text">
                Your account, and the records about you, until you delete your account or it is removed. An organization, while it exists. What you add, until it is deleted from its organization by you or its
                administrators: {ACCOUNT_DELETION.stays.charAt(0).toLowerCase() + ACCOUNT_DELETION.stays.slice(1)} The log and the counts of use, for a limited time. Backups outlast
                a deletion for a limited time, then they are deleted too.
              </p>
            </SheetBody>
          </Sheet>
          <Sheet labelledBy="privacy-rights">
            <SheetHeader id="privacy-rights" title="What you can do" />
            <SheetBody>
              <p className="privacy-text">
                Take what you added: export is always available and always complete. Delete your account in <a href="/settings?delete=account">Settings</a>, or by asking{" "}
                {ask}. Ask to see what is kept about you, to have it corrected or deleted, or to stop the counting of your use. You may also complain to the data-protection
                authority where you live.
              </p>
            </SheetBody>
          </Sheet>
        </>
      ) : (
        // The deployment's part was not written in (its service did not answer whoever serves the
        // page): the page says so rather than name nobody.
        <Callout tone="attention" title="This page didn’t load">
          It couldn&rsquo;t be told who runs this WhatBuild. Try again in a minute.
        </Callout>
      )}
    </SiteFrame>
  );
}
