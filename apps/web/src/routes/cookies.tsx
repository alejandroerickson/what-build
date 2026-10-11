import { Link } from "react-router";
import { setCookieChoice, useCookieChoice } from "../lib/analytics.ts";
import { useAnalyticsId } from "../shell/CookieNotice.tsx";
import { Button, ButtonLink, Sheet, SheetBody, SheetHeader } from "../ui/index.tsx";
import { EntryPage } from "./auth.tsx";
import "../styles/screens/cookies.css";

/**
 * `/cookies`, public: what cookies are for, by kind, and the person's analytics choice, which they
 * can change here at any time. The notice in the corner points here.
 */
export function CookiesPage() {
  const analytics = Boolean(useAnalyticsId());
  const choice = useCookieChoice();
  return (
    <EntryPage title="Cookies · WhatBuild" wide>
      <Sheet labelledBy="cookies-title">
        <SheetHeader level={1} id="cookies-title" title="Cookies" />
        <SheetBody className="entry-form">
          <p>
            WhatBuild uses cookies and browser storage to keep you signed in and remember your settings
            {analytics ? ", and, if you accept, to see how WhatBuild is used" : ""}.
          </p>
        </SheetBody>
      </Sheet>
      <Sheet labelledBy="cookies-needed">
        <SheetHeader id="cookies-needed" title="Needed for WhatBuild to work" end={<span className="entry-caption">Always on</span>} />
        <SheetBody>
          <p className="cookie-kind">These keep you signed in, keep signing in secure, and remember choices such as the theme and the product you had open.</p>
        </SheetBody>
      </Sheet>
      {analytics ? (
        <Sheet labelledBy="cookies-analytics">
          <SheetHeader id="cookies-analytics" title="Analytics" end={<span className="entry-caption">{choice === "accepted" ? "Accepted" : choice === "declined" ? "Declined" : "Your choice"}</span>} />
          <SheetBody>
            <p className="cookie-kind">
              Google Analytics tells us how many people use WhatBuild, which parts they use and whether they come back. Its cookies last up to two years.{" "}
              <a href="https://policies.google.com/technologies/partner-sites" target="_blank" rel="noreferrer">
                How Google uses this information
              </a>
              .
            </p>
            <div className="cookie-choice">
              {choice !== "declined" ? (
                <Button size="sm" onClick={() => setCookieChoice("declined")}>
                  Decline
                </Button>
              ) : null}
              {choice !== "accepted" ? (
                <Button size="sm" onClick={() => setCookieChoice("accepted")}>
                  Accept
                </Button>
              ) : null}
            </div>
          </SheetBody>
        </Sheet>
      ) : null}
      <section className="entry-fine" aria-labelledby="cookies-counting">
        <h2 id="cookies-counting">Counting without cookies</h2>
        <p>Whatever you choose, WhatBuild&rsquo;s server counts which of its features are used, in the app and by agents, and how many people come back. It needs no cookie for that and keeps no names: each person is counted under a code only this deployment can work out, kept for 14 months, and whoever runs WhatBuild sees only totals. <Link to="/privacy">Privacy</Link> says what else is kept, and whom to ask.</p>
      </section>
      <section className="entry-fine" aria-labelledby="cookies-clear">
        <h2 id="cookies-clear">Clearing them</h2>
        <p>Signing out removes the sign-in cookie and what this browser remembers of your work, such as the product you had open; the theme and panel choices stay for whoever uses it next. Clearing this site&rsquo;s data in your browser removes the rest. Your work in WhatBuild isn&rsquo;t affected.</p>
      </section>
      <div className="cookie-back">
        <ButtonLink to="/" size="sm" icon="arrow-left">
          Go to WhatBuild
        </ButtonLink>
      </div>
    </EntryPage>
  );
}
