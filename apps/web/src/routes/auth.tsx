import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { Navigate, useNavigate, useParams, useSearchParams } from "react-router";
import { api } from "../lib/api.ts";
import { lastProduct, useMe, useProducts, useSignOut } from "../lib/session.tsx";
import { BrandMark } from "../shell/brand.tsx";
import { usePageTitle } from "../shell/slots.tsx";
import { Button, ButtonLink, Callout, EmptyState, ErrorCallout, Loading, Sheet, SheetBody, SheetHeader, TextField } from "../ui/index.tsx";
import "../styles/screens/account.css";

const DATA_STATEMENT =
  "WhatBuild is a free, pre-1.0 demonstration service. Your content sits in a managed Postgres database and an object store we rent from providers named on our sub-processors page. It is encrypted in transit, encrypted at rest as far as those providers do it, and isolated per organization by the application and by the database. We take no analytics about what you do in the app, show no ads, sell nothing, and train no model on your content; there is no AI in the product to train one with. We do not promise uptime or durability, and we cannot promise anything on behalf of our providers. Export is always available and always complete. Please don't put anything here whose loss or exposure would hurt.";

/**
 * A screen outside the shell (sign-in, first run, accepting an invitation): the mark and wordmark
 * above one narrow column of sheets on the canvas.
 */
export function EntryPage({ title, wide, children }: { title: string; wide?: boolean; children: ReactNode }) {
  useEffect(() => {
    document.title = title;
  }, [title]);
  return (
    <div className="entry">
      <main id="main" className={`entry-main${wide ? " entry-main-wide" : ""}`} tabIndex={-1}>
        <div className="entry-brand">
          <BrandMark />
          <span className="brand-word">WhatBuild</span>
        </div>
        {children}
      </main>
    </div>
  );
}

const DEV_PEOPLE = [
  { email: "riley@example.com", name: "Riley Chen", role: "Owner of the sample organization" },
  { email: "sam@example.com", name: "Sam Okafor", role: "Editor on the sample products" },
];

export function SignIn() {
  const [params] = useSearchParams();
  const next = params.get("next") ?? "/";
  const [email, setEmail] = useState("");
  const methods = useQuery({ queryKey: ["auth-methods"], queryFn: () => api<{ email_link: boolean; google: boolean; dev: boolean }>("GET", "/auth/methods") });
  const me = useMe();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const send = useMutation({ mutationFn: () => api<{ sent: boolean; dev_note?: string }>("POST", "/auth/email", { email: email.trim(), next }) });
  const dev = useMutation({
    mutationFn: (e: string) => api("POST", "/auth/dev-sign-in", { email: e, next }),
    onSuccess: async () => {
      await qc.invalidateQueries();
      navigate(next, { replace: true });
    },
  });
  if (me.data) return <Navigate to={next} replace />;
  const error = params.get("error");
  const emailLink = !methods.data || methods.data.email_link;
  return (
    <EntryPage title="Sign in · WhatBuild">
      <Sheet labelledBy="signin-title">
        <SheetHeader level={1} id="signin-title" title="Sign in to WhatBuild" />
        <SheetBody className="entry-form">
          {error ? (
            <Callout inset tone="attention" title="That sign-in did not work">
              {error === "link_expired"
                ? "The link expired or was already used. Ask for a new one."
                : error === "invite_only"
                  ? "WhatBuild is invite-only for now. Ask someone who uses it to invite you."
                  : "Try again, or use the email link."}
            </Callout>
          ) : null}
          {emailLink ? (
            send.isSuccess ? (
              <Callout inset tone="positive" title="Check your email" action={<Button size="sm" variant="quiet" onClick={() => send.reset()}>Use another address</Button>}>
                We sent a sign-in link to {email.trim()}. It works once, for 15 minutes.{send.data.dev_note ? ` ${send.data.dev_note}` : ""}
              </Callout>
            ) : (
              <form
                className="entry-form-inner"
                onSubmit={(e) => {
                  e.preventDefault();
                  send.mutate();
                }}
              >
                <p className="muted">We email you a link that signs you in. There is no password to remember.</p>
                <TextField label="Email address" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
                {send.isError ? <ErrorCallout inset error={send.error} /> : null}
                <Button type="submit" variant="primary" wide busy={send.isPending} busyLabel="Sending…">
                  Email me a sign-in link
                </Button>
              </form>
            )
          ) : null}
          {methods.data?.google ? (
            <>
              {emailLink ? <div className="entry-or">or</div> : null}
              <a className="btn btn-secondary btn-md btn-wide" href={`/auth/google?next=${encodeURIComponent(next)}`}>
                Continue with Google
              </a>
            </>
          ) : null}
          {methods.isError ? <ErrorCallout inset error={methods.error} onRetry={() => methods.refetch()} /> : null}
        </SheetBody>
      </Sheet>
      {methods.data?.dev ? (
        <Sheet labelledBy="dev-signin">
          <SheetHeader id="dev-signin" title="Development sign-in" end={<span className="entry-caption">Only on a development server</span>} />
          <ul className="entry-people">
            {DEV_PEOPLE.map((p) => (
              <li key={p.email} className="entry-person">
                <Button size="sm" busy={dev.isPending && dev.variables === p.email} onClick={() => dev.mutate(p.email)}>
                  {p.name}
                </Button>
                <span className="entry-person-role">{p.role}</span>
              </li>
            ))}
            <li className="entry-person">
              <Button size="sm" onClick={() => email.trim() && dev.mutate(email.trim())} disabled={!email.trim()}>
                As the email above
              </Button>
              <span className="entry-person-role">Any account: type its address above</span>
            </li>
          </ul>
          {dev.isError ? (
            <SheetBody>
              <ErrorCallout inset error={dev.error} />
            </SheetBody>
          ) : null}
        </Sheet>
      ) : null}
      <section className="entry-fine" aria-labelledby="data-h">
        <h2 id="data-h">What we do with your data</h2>
        <p>{DATA_STATEMENT}</p>
      </section>
    </EntryPage>
  );
}

/** `/`: the last product this browser used, else the first product, else first-run setup. */
export function Home() {
  const products = useProducts();
  if (products.isPending)
    return (
      <EntryPage title="WhatBuild">
        <Loading label="Opening your last product…" />
      </EntryPage>
    );
  if (products.isError)
    return (
      <EntryPage title="WhatBuild">
        <h1 className="visually-hidden">WhatBuild</h1>
        <ErrorCallout title="Your products could not be loaded" error={products.error} onRetry={() => products.refetch()} />
      </EntryPage>
    );
  const last = lastProduct();
  const items = products.data.items;
  if (last && items.some((p) => p.path === last)) return <Navigate to={`/t/${last}/idea`} replace />;
  if (items[0]) return <Navigate to={`/t/${items[0].path}/idea`} replace />;
  if (products.data.tenants.length) return <Navigate to="/products" replace />;
  return <Navigate to="/welcome" replace />;
}

export function AcceptInvite() {
  const { token = "" } = useParams();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const me = useMe();
  const signOut = useSignOut();
  const accept = useMutation({
    mutationFn: () => api<{ tenant: { slug: string; name: string }; role: string }>("POST", "/api/v1/invitations/accept", { token }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["products"] });
      navigate("/products", { replace: true });
    },
  });
  useEffect(() => {
    accept.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);
  return (
    <EntryPage title="Accept invitation · WhatBuild">
      <Sheet labelledBy="invite-title">
        <SheetHeader level={1} id="invite-title" title={accept.isError ? "This invitation could not be used" : "Joining…"} />
        <SheetBody className="entry-form">
          {accept.isError ? (
            <>
              <ErrorCallout inset title="The link did not work" error={accept.error} />
              <p className="muted">
                Invitations work once, for 7 days, and only for the address they were sent to{me.data ? ` (you are signed in as ${me.data.email})` : ""}. Ask whoever invited you for a new link.
              </p>
              <div className="entry-actions">
                <ButtonLink to="/products">Your products</ButtonLink>
                <Button variant="quiet" onClick={() => void signOut()}>
                  Sign in with another address
                </Button>
              </div>
            </>
          ) : (
            <Loading label="Accepting the invitation…" lines={1} variant="lines" />
          )}
        </SheetBody>
      </Sheet>
    </EntryPage>
  );
}

/** Any address the app doesn't know, inside the plain shell. */
export function NotFound() {
  usePageTitle("Not found");
  return (
    <Sheet labelledBy="notfound-title">
      <SheetHeader level={1} id="notfound-title" title="Nothing lives here" />
      <EmptyState size="inline" action={<ButtonLink to="/" variant="primary">Go to your products</ButtonLink>}>
        The address may be mistyped, or the page may have moved. Links to sources, insights and Story pages keep working as long as you have access to their product.
      </EmptyState>
    </Sheet>
  );
}
