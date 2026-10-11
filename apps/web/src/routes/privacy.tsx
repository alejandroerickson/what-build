import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { api } from "../lib/api.ts";
import { ButtonLink, ErrorCallout, Loading, Sheet, SheetBody, SheetHeader } from "../ui/index.tsx";
import { EntryPage } from "./auth.tsx";
import "../styles/screens/cookies.css";

interface Privacy {
  operator: string | null;
  contact: string | null;
  providers: { name: string; purpose: string }[];
  analytics: boolean;
  session_days: number;
  agent_access_days: number;
  usage_people_months: number;
}

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
 * `/privacy`, public: what this WhatBuild keeps about a person, why, for how long, who else handles
 * it, and whom to ask. The fixed text is true of every deployment; who runs it, how to reach them
 * and their providers come from the deployment (`privacy` in `/api/v1/meta`).
 */
export function PrivacyPage() {
  const q = useQuery({ queryKey: ["meta"], queryFn: () => api<{ privacy: Privacy }>("GET", "/api/v1/meta"), staleTime: Infinity });
  const p = q.data?.privacy;
  const ask = p?.contact ? <Contact to={p.contact} /> : "whoever runs this WhatBuild";
  return (
    <EntryPage title="Privacy · WhatBuild" wide>
      <Sheet labelledBy="privacy-title">
        <SheetHeader level={1} id="privacy-title" title="Privacy" />
        <SheetBody className="entry-form">
          {q.isPending ? (
            <Loading label="Loading…" lines={2} />
          ) : q.isError || !p ? (
            <ErrorCallout title="This page didn’t load" error={q.error} onRetry={() => q.refetch()} />
          ) : (
            <>
              <p>What this WhatBuild keeps about you, why, for how long, and whom to ask.</p>
              <p className="cookie-kind">
                {p.operator ? `${p.operator} runs this WhatBuild and decides what happens to what it keeps.` : "Whoever runs this WhatBuild decides what happens to what it keeps. They have not named themselves here yet."}{" "}
                {p.contact ? (
                  <>
                    To ask about your data, write to <Contact to={p.contact} />.
                  </>
                ) : null}
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
                <Kept lead="Your account.">
                  Your email address, your name, and how you sign in (an email link, Google or Microsoft). To sign you in and show your name on what you add. Kept while you have
                  the account.
                </Kept>
                <Kept lead="What you add.">
                  Sources and their files, passages, notes and comments, assumptions and reviews, outcomes, mockups, the Story, and a log of who changed what. To run WhatBuild for
                  your organization, which decides who may see it. Kept until it is deleted; in a public sandbox, until its next daily reset.
                </Kept>
                <Kept lead="Signing in and agents.">
                  Your sessions, with the browser each began in, and the agents you connect, by the name each gives itself. To keep you signed in and let your agents work. A session
                  lasts {p.session_days} days; an agent stays connected while it is used at least every {p.agent_access_days} days, or until you disconnect it.
                </Kept>
                <Kept lead="Request logs.">
                  For each request: what was asked, its address with names and ids taken out, the answer and how long it took. The host may also record the internet address the
                  request came from and the browser (on Google Cloud, not for a search or a sign-in link). To keep WhatBuild running and secure. Deleted after a short time (30 days
                  on Google Cloud).
                </Kept>
                <Kept lead="How WhatBuild is used.">
                  Which features are used, in the app and by agents, and how many people come back, counted under a code in place of your account that only this deployment can work
                  out. To understand and improve WhatBuild. Kept {p.usage_people_months} months.
                </Kept>
                {p.analytics ? (
                  <Kept lead="Analytics, if you accept.">
                    Google Analytics sees the screens you open and what you do, never names or content. Kept up to 14 months by Google. <Link to="/cookies">Cookies</Link> holds your
                    choice.
                  </Kept>
                ) : null}
                <Kept lead="What you send.">
                  Feedback from you or your agent, and a request on the public site to hear when WhatBuild opens. To answer it and improve WhatBuild. Kept until it is no longer
                  needed, or until you ask for it to be removed.
                </Kept>
                <Kept lead="Backups.">Copies of the database, to recover from a failure. Kept for a limited time, then deleted.</Kept>
              </ul>
              <p className="cookie-kind privacy-grounds">
                Your account, what you add, your sessions and your agents are kept because you use WhatBuild. Request logs and the counts of use are kept because running WhatBuild
                safely and making it better needs them; you may object to them. Analytics runs only if you accept it.
              </p>
            </SheetBody>
          </Sheet>
          <Sheet labelledBy="privacy-who">
            <SheetHeader id="privacy-who" title="Who else handles it" />
            <SheetBody>
              {p.providers.length ? (
                <ul className="privacy-list">
                  {p.providers.map((v) => (
                    <Kept key={v.name} lead={v.purpose ? `${v.name}:` : v.name}>
                      {v.purpose}
                    </Kept>
                  ))}
                </ul>
              ) : (
                <p className="cookie-kind">This WhatBuild has not listed the providers it uses yet.</p>
              )}
              <p className="cookie-kind privacy-grounds">
                Providers may handle it outside your country, under their own data-protection terms. An agent you connect reads what you let it; what happens to that is up to
                whoever runs the agent. Nothing is sold, there are no ads, and no model is trained on your content.
              </p>
            </SheetBody>
          </Sheet>
          <Sheet labelledBy="privacy-rights">
            <SheetHeader id="privacy-rights" title="What you can do" />
            <SheetBody>
              <ul className="privacy-list">
                <Kept lead="Take it.">Export takes everything in a product, at any time.</Kept>
                <Kept lead="Ask.">
                  To see what is kept about you, have it corrected or deleted, stop the counting of your use, or take it with you, write to {ask}.
                </Kept>
                <Kept lead="Complain.">You may also complain to the data-protection authority where you live.</Kept>
              </ul>
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
