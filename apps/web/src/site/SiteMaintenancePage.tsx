import { useEffect } from "react";
import { BrandMark } from "../shell/brand.tsx";
import { Sheet } from "../ui/layout.tsx";

const MARK = document.querySelector<HTMLMetaElement>('meta[name="whatbuild-maintenance"]');

/** Whether whoever serves the page marked it down for maintenance (MAINTENANCE in deploy/cloudflare/worker.js). */
export const MAINTENANCE = MARK !== null;

/** The day WhatBuild is expected back, as the mark gives it (2027-01-15); null when it gives none. */
const BACK = (() => {
  const day = MARK?.content ?? "";
  const date = /^\d{4}-\d{2}-\d{2}$/.test(day) ? new Date(`${day}T00:00:00Z`) : null;
  return date && !Number.isNaN(date.getTime()) ? { day, date } : null;
})();

/** A part of the day it names, as written: a calendar day, the same wherever the visitor is. */
const part = (date: Date, options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en", { ...options, timeZone: "UTC" }).format(date);

/**
 * The site's page while WhatBuild is down for maintenance: on both domains, at every address, in
 * place of the site and the app. It asks the service nothing, since the service is what is down.
 */
export function SiteMaintenancePage() {
  useEffect(() => {
    document.title = "Down for maintenance · WhatBuild";
    // The theme follows the system here, as on the rest of the site.
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => document.documentElement.setAttribute("data-theme", media.matches ? "dark" : "light");
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, []);

  return (
    <div className="site">
      <main id="main" className="overview site-main">
        <Sheet className="overview-intro maintenance" labelledBy="maintenance-title">
          <div className="overview-head">
            <p className="overview-lockup">
              <BrandMark size={34} />
              <span>WhatBuild</span>
            </p>
          </div>
          <div className="overview-pitch">
            <h1 id="maintenance-title" className="overview-question">
              Down for maintenance
            </h1>
            <p className="overview-tagline">WhatBuild is taking a short break while we work on it behind the scenes.</p>
            <p className="overview-about">
              Everything your team keeps in it is safe{BACK ? "" : ", and it will be back soon"}. There is nothing you need to do in the
              meantime.
            </p>
          </div>
          {BACK ? (
            <aside className="overview-loop maintenance-back" aria-labelledby="maintenance-back-title">
              <h2 id="maintenance-back-title" className="overview-loop-title">
                Back by
              </h2>
              <time className="maintenance-day" dateTime={BACK.day}>
                <span className="maintenance-day-month">{part(BACK.date, { month: "long" })}</span>
                <span className="maintenance-day-date">{part(BACK.date, { day: "numeric" })}</span>
                <span className="maintenance-day-weekday">{part(BACK.date, { weekday: "long" })}</span>
              </time>
              <p className="maintenance-back-note">Sign in as usual then.</p>
            </aside>
          ) : null}
        </Sheet>
        <footer className="site-foot">
          <span>We’re sorry for the interruption.</span>
          <span className="site-foot-end">
            <a href="https://github.com/alejandroerickson/what-build">Source on GitHub</a>
          </span>
        </footer>
      </main>
    </div>
  );
}
