import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, Navigate, useNavigate, useParams, useSearchParams } from "react-router";
import { api, ApiError } from "../lib/api.ts";
import { aRole } from "../lib/format.ts";
import { useMe, useSignOut } from "../lib/session.tsx";
import { BrandMark } from "../shell/brand.tsx";
import { usePageTitle } from "../shell/slots.tsx";
import { Button, ButtonLink, Callout, EmptyState, ErrorCallout, Loading, Sheet, SheetBody, SheetHeader, TextField, useToast } from "../ui/index.tsx";
import "../styles/screens/account.css";

const DATA_STATEMENT =
  "WhatBuild is a free, pre-1.0 demonstration service. Your content sits in a managed Postgres database and an object store we rent from providers named on our sub-processors page. It is encrypted in transit, encrypted at rest as far as those providers do it, and isolated per organization by the application and by the database. We show no ads, sell nothing, and train no model on your content; there is no AI in the product to train one with. We do not promise uptime or durability, and we cannot promise anything on behalf of our providers. Export is always available and always complete. Please don't put anything here whose loss or exposure would hurt.";

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
  // An invitation to the public sandbox admits whoever holds it, with any address.
  const toSandbox = next.startsWith("/join/");
  return (
    <EntryPage title="Sign in · WhatBuild">
      <Sheet labelledBy="signin-title">
        <SheetHeader level={1} id="signin-title" title={next.startsWith("/invite/") ? "Sign in to accept your invitation" : toSandbox ? "Sign in to enter the sandbox" : "Sign in to WhatBuild"} />
        <SheetBody className="entry-form">
          {next.startsWith("/invite/") && !error ? <p className="muted">Use the address the invitation was sent to, and you join as soon as you&rsquo;re signed in.</p> : null}
          {toSandbox && !error ? <p className="muted">Any address of yours will do. Nobody in the sandbox sees it: there you write under a made-up name.</p> : null}
          {error ? (
            <Callout inset tone="attention" title="That sign-in did not work">
              {error === "link_expired"
                ? "The link expired or was already used. Ask for a new one."
                : error === "invite_only"
                  ? toSandbox
                    ? "The invitation you came with has no place left, so it could not make you an account. Ask whoever sent it for a new link."
                    : "WhatBuild is invite-only for now. Ask someone who uses it to invite you."
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
        <p className="entry-fine-more">
          WhatBuild uses cookies to keep you signed in. <Link to="/cookies">Cookies</Link>.
        </p>
      </section>
    </EntryPage>
  );
}

export function AcceptInvite() {
  const { token = "" } = useParams();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const me = useMe();
  const signOut = useSignOut();
  const toast = useToast();
  const accept = useMutation({
    mutationFn: () =>
      api<{ already: boolean; tenant: { slug: string; name: string } | null; scope_type: "tenant" | "team" | "product"; scope: string | null; role: string }>("POST", "/api/v1/invitations/accept", { token }),
    onSuccess: async (r) => {
      await qc.invalidateQueries({ queryKey: ["products"] });
      const org = r.tenant?.name ?? "the organization";
      toast(r.scope_type === "tenant" || !r.scope ? `You’re ${aRole(r.role)} of ${org}.` : `You’re in ${org}, as ${aRole(r.role)} on ${r.scope_type} ${r.scope}.`);
      navigate("/", { replace: true });
    },
  });
  const wrongAddress = accept.error instanceof ApiError && accept.error.code === "invitation_wrong_address";
  // Once per token, even when a development build mounts the page twice.
  const sent = useRef<string | null>(null);
  useEffect(() => {
    if (sent.current === token) return;
    sent.current = token;
    accept.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);
  return (
    <EntryPage title="Accept invitation · WhatBuild">
      <Sheet labelledBy="invite-title">
        <SheetHeader level={1} id="invite-title" title={accept.isError ? "This invitation can’t be used" : "Joining…"} />
        <SheetBody className="entry-form">
          {accept.isError ? (
            <>
              <ErrorCallout inset title={wrongAddress ? "This invitation is for another address" : "The link didn’t work"} error={accept.error} />
              <p className="muted">
                {wrongAddress
                  ? "Invitations work only for the address they were sent to. If that address is yours, sign in with it and you join at once."
                  : "Invitations work once, within 7 days, and only for the address they were sent to."}
              </p>
              <div className="entry-actions">
                {wrongAddress ? (
                  <>
                    <Button variant="primary" onClick={() => void signOut(`/invite/${token}`)}>
                      Sign in with another address
                    </Button>
                    <ButtonLink to="/" variant="quiet">Your products</ButtonLink>
                  </>
                ) : (
                  <>
                    <ButtonLink to="/">Your products</ButtonLink>
                    <Button variant="quiet" onClick={() => void signOut(`/invite/${token}`)}>
                      Sign in with another address
                    </Button>
                  </>
                )}
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
