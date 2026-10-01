import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api.ts";
import { COOKIE_NOTICE_KEY } from "../shell/CookieNotice.tsx";
import { ButtonLink, Sheet, SheetBody, SheetHeader } from "../ui/index.tsx";
import { EntryPage } from "./auth.tsx";
import "../styles/screens/cookies.css";

interface Item {
  name: string;
  purpose: string;
  lasts?: string;
}

function Items({ id, title, end, items }: { id: string; title: string; end: string; items: Item[] }) {
  return (
    <Sheet labelledBy={id}>
      <SheetHeader id={id} title={title} count={items.length} end={<span className="entry-caption">{end}</span>} />
      <ul className="cookie-items">
        {items.map((it) => (
          <li key={it.name} className="cookie-item">
            <code className="cookie-item-name">{it.name}</code>
            {it.lasts ? <span className="cookie-item-lasts">{it.lasts}</span> : null}
            <p className="cookie-item-purpose">{it.purpose}</p>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}

/**
 * `/cookies`, public: every cookie the server sets and everything the app keeps in the browser,
 * with what each is for. Keep it in step with the code; the notice in the corner points here.
 */
export function CookiesPage() {
  const methods = useQuery({ queryKey: ["auth-methods"], queryFn: () => api<{ session_days?: number }>("GET", "/auth/methods") });
  const days = methods.data?.session_days;
  return (
    <EntryPage title="Cookies and browser storage · WhatBuild" wide>
      <Sheet labelledBy="cookies-title">
        <SheetHeader level={1} id="cookies-title" title="Cookies and browser storage" />
        <SheetBody className="entry-form">
          <p>
            WhatBuild keeps only what it needs to work: one cookie that keeps you signed in, two that protect a sign-in while it happens, and the display choices you make, kept in this
            browser. Nothing here tracks you, measures you or is shared with anyone else.
          </p>
          <p className="muted">Each one is needed for WhatBuild to work or remembers something you chose, so there is nothing to switch off.</p>
        </SheetBody>
      </Sheet>
      <Items
        id="cookies-set"
        title="Cookies"
        end="Readable only by the server"
        items={[
          { name: "wb_session", purpose: "Keeps you signed in.", lasts: days ? `Until you sign out, at most ${days} days` : "Until you sign out" },
          { name: "wb_oidc", purpose: "Checks that a Google sign-in coming back is the one you started.", lasts: "10 minutes" },
          { name: "wb_consent", purpose: "Checks that approving an agent’s connection came from you.", lasts: "15 minutes" },
        ]}
      />
      <Items
        id="cookies-stored"
        title="Stored in this browser"
        end="Never sent to the server"
        items={[
          { name: "whatbuild.theme", purpose: "Light, dark, or following your system." },
          { name: "whatbuild.nav, whatbuild.inspector", purpose: "Whether you hid the panel or the inspector." },
          { name: "whatbuild.last-product", purpose: "The product you had open last." },
          { name: "whatbuild.story.…", purpose: "The Story page you were reading in each product, whether focus mode is on, and which Story sections you collapsed." },
          { name: "whatbuild.sandbox-notice.…", purpose: "That you have read a public sandbox’s notice." },
          { name: COOKIE_NOTICE_KEY, purpose: "That you have read the notice about cookies." },
        ]}
      />
      <section className="entry-fine" aria-labelledby="cookies-clear">
        <h2 id="cookies-clear">Clearing them</h2>
        <p>Signing out deletes the sign-in cookie. Clearing this site&rsquo;s data in your browser removes everything: you are signed out and WhatBuild forgets your display choices. Your work is kept on the server and is not affected.</p>
      </section>
      <section className="entry-fine" aria-labelledby="cookies-change">
        <h2 id="cookies-change">If this changes</h2>
        <p>If WhatBuild ever adds anything optional, such as analytics, it will stay off until you agree to it, and you will be able to change your mind at any time.</p>
      </section>
      <div className="cookie-back">
        <ButtonLink to="/" size="sm" icon="arrow-left">
          Go to WhatBuild
        </ButtonLink>
      </div>
    </EntryPage>
  );
}
