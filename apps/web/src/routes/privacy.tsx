import { useQuery } from "@tanstack/react-query";
import { ACCOUNT_DELETION } from "@whatbuild/core/account-deletion";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { api } from "../lib/api.ts";
import { ButtonLink, ErrorCallout, Loading, Sheet, SheetBody, SheetHeader } from "../ui/index.tsx";
import { EntryPage } from "./auth.tsx";
import "../styles/screens/cookies.css";

/** What the privacy page says that only the deployment knows (`privacy` in `/api/v1/meta`). */
interface Privacy {
  operator: string | null;
  contact: string | null;
  /** Who else handles it, as a paragraph the deployment wrote; null when it has said nothing. */
  providers: string | null;
  analytics: boolean;
}

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
 * `/privacy`, public: the privacy notice. It says what WhatBuild keeps about a person, why, who
 * else handles it, for how long, and what they can ask, in categories rather than mechanics, so it
 * stays true as the product changes ([decision](okf/decisions/the-privacy-page-is-a-short-notice-written-to-stay-true.md)).
 * Who runs the deployment, how to reach them and who else handles the data come from the
 * deployment; everything else is true of every WhatBuild (okf/spec/09-data-lifecycle.md §9.1).
 */
export function PrivacyPage() {
  const q = useQuery({ queryKey: ["meta"], queryFn: () => api<{ privacy: Privacy }>("GET", "/api/v1/meta"), staleTime: Infinity });
  const p = q.data?.privacy;
  const operator = p?.operator ?? "Whoever runs this WhatBuild";
  const ask = p?.contact ? <Contact to={p.contact} /> : "whoever runs this WhatBuild";
  return (
    <EntryPage title="Privacy · WhatBuild" wide>
      <Sheet labelledBy="privacy-title">
        <SheetHeader level={1} id="privacy-title" title="Privacy" end={<span className="entry-caption">Last changed {LAST_CHANGED}</span>} />
        <SheetBody className="entry-form">
          {q.isPending ? (
            <Loading label="Loading…" lines={2} />
          ) : q.isError || !p ? (
            <ErrorCallout title="This page didn’t load" error={q.error} onRetry={() => q.refetch()} />
          ) : (
            <>
              <p className="privacy-text">
                This page says what WhatBuild keeps about you, why, who else handles it, how long it stays, and what you can ask. {operator} is responsible for what this
                WhatBuild keeps{p.operator ? "" : ", and has not named themselves here yet"}. Questions and requests go to {ask}.
              </p>
            </>
          )}
        </SheetBody>
      </Sheet>
      {p ? (
        <>
          <Sheet labelledBy="privacy-kept">
            <SheetHeader id="privacy-kept" title="What is kept" />
            <SheetBody>
              <ul className="privacy-list">
                <Kept lead="Your account.">The email address you sign in with and your name, and the addresses of the people you invite.</Kept>
                <Kept lead="What you add.">
                  Everything you, and the agents you connect, put into an organization. It is kept with your name on it, so the people you work with know who added what.
                </Kept>
                <Kept lead="Records of running the service.">
                  Your sessions, the agents you have connected, a log of requests, and counts of how WhatBuild is used. None of it holds your content, and the counts name
                  nobody.
                </Kept>
                {p.analytics ? (
                  <Kept lead="Analytics, if you accept it.">
                    Google Analytics sees which screens you open and what you do there, never names or content. <Link to="/cookies">Cookies</Link> holds your choice.
                  </Kept>
                ) : null}
                <Kept lead="What you send.">Feedback, and a request on the public site to hear when WhatBuild opens.</Kept>
              </ul>
              <p className="privacy-text privacy-after">
                Your account, what you add, your sessions and your agents are kept because you use WhatBuild: without them there is no service. The log and the counts are kept
                to run WhatBuild safely and make it better, which you may object to. Analytics runs only with your consent.
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
                Your account, and the records about you, until you delete your account or it is removed. What you add, until it is deleted from its organization by you or its
                administrators: {ACCOUNT_DELETION.stays.charAt(0).toLowerCase() + ACCOUNT_DELETION.stays.slice(1)} The log and the counts, for a limited time. Backups outlast
                a deletion for a limited time, then they are deleted too.
              </p>
            </SheetBody>
          </Sheet>
          <Sheet labelledBy="privacy-rights">
            <SheetHeader id="privacy-rights" title="What you can do" />
            <SheetBody>
              <p className="privacy-text">
                Take what you added: export is always available and always complete. Delete your account in <Link to="/settings?delete=account">Settings</Link>, or by asking{" "}
                {ask}. Ask to see what is kept about you, to have it corrected or deleted, or to stop the counting of your use. You may also complain to the data-protection
                authority where you live.
              </p>
            </SheetBody>
          </Sheet>
        </>
      ) : null}
      <div className="cookie-back">
        <ButtonLink to="/" size="sm" icon="arrow-left">
          Go to WhatBuild
        </ButtonLink>
      </div>
    </EntryPage>
  );
}
