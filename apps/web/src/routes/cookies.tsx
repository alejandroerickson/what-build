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
            WhatBuild uses cookies and storage in your browser to keep you signed in and remember your settings
            {analytics ? ", and, if you accept, to understand how WhatBuild is used so we can make it better" : ""}.
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
      <section className="entry-fine" aria-labelledby="cookies-clear">
        <h2 id="cookies-clear">Clearing them</h2>
        <p>Signing out removes the sign-in cookie. Clearing this site&rsquo;s data in your browser removes the rest; your work in WhatBuild is not affected.</p>
      </section>
      <div className="cookie-back">
        <ButtonLink to="/" size="sm" icon="arrow-left">
          Go to WhatBuild
        </ButtonLink>
      </div>
    </EntryPage>
  );
}
