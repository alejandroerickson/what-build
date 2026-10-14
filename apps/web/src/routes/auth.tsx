import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { safeNext } from "@whatbuild/core/safe-next";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, Navigate, useNavigate, useParams, useSearchParams } from "react-router";
import { api, ApiError } from "../lib/api.ts";
import { aRole, scopeWords } from "../lib/format.ts";
import { useMe, useSignOut } from "../lib/session.tsx";
import { BrandMark } from "../shell/brand.tsx";
import { usePageTitle } from "../shell/slots.tsx";
import { Button, ButtonLink, Callout, EmptyState, ErrorCallout, Loading, Sheet, SheetBody, SheetHeader, TextField, useToast } from "../ui/index.tsx";
import "../styles/screens/account.css";

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
  { email: "jordan@example.com", name: "Jordan Ellis", role: "Reads only the Crewboard Story" },
];

/** The form of the reference the server gives a refused sign-in (`signInReference` in apps/server/src/auth/routes.ts). */
const SIGN_IN_REFERENCE = /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/;

export function SignIn() {
  const [params] = useSearchParams();
  // The server's rule: a path on this origin, or home.
  const next = safeNext(params.get("next"));
  const [email, setEmail] = useState("");
  const methods = useQuery({ queryKey: ["auth-methods"], queryFn: () => api<{ email_link: boolean; google: boolean; microsoft?: boolean; dev: boolean }>("GET", "/auth/methods") });
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
  // The server's reference for a refused sign-in, shown only in its own form, so a crafted link cannot put words here.
  const ref = params.get("ref");
  const reference = ref && SIGN_IN_REFERENCE.test(ref) ? ref : null;
  const emailLink = !methods.data || methods.data.email_link;
  // A refused Microsoft sign-in the person can do nothing about but pass on.
  const tellOperator = (
    <>
      tell whoever runs WhatBuild here
      {reference ? (
        <>
          , with the reference <strong className="entry-reference">{reference}</strong>
        </>
      ) : null}
      .{emailLink ? " Meanwhile, you can use an email link." : null}
    </>
  );
  // An invitation to the public sandbox admits whoever holds it, with any address.
  const toSandbox = next.startsWith("/join/");
  return (
    <EntryPage title="Sign in · WhatBuild">
      <Sheet labelledBy="signin-title">
        <SheetHeader level={1} id="signin-title" title={next.startsWith("/invite/") ? "Sign in to accept your invitation" : toSandbox ? "Sign in to enter the sandbox" : "Sign in to WhatBuild"} />
        <SheetBody className="entry-form">
          {next.startsWith("/invite/") && !error ? <p className="muted">Use the email your invitation was sent to.</p> : null}
          {toSandbox && !error ? <p className="muted">Any email works. Others in the sandbox see a made-up name.</p> : null}
          {error === "link_expired" ? (
            <Callout inset tone="attention" title="That sign-in link has expired">
              Enter your email for a new one.
            </Callout>
          ) : error === "invite_only" && toSandbox ? (
            <Callout inset tone="attention" title="That invitation has no places left">
              Ask whoever sent it for a new link.
            </Callout>
          ) : error === "invite_only" ? (
            <Callout inset tone="attention" title="WhatBuild is invite-only for now">
              Ask someone who uses it to invite you.
            </Callout>
          ) : error === "microsoft_no_verified_email" ? (
            <Callout inset tone="attention" title="WhatBuild couldn’t confirm your email with Microsoft">
              Microsoft signed you in, but didn’t send what this server needs to confirm your address. That’s usually the server’s setup, not your account: {tellOperator}
            </Callout>
          ) : error === "microsoft_wrong_directory" ? (
            <Callout inset tone="attention" title="That Microsoft sign-in came from another directory">
              WhatBuild here takes accounts from one organization’s directory. If you used your work account in it, the server’s setup may be wrong: {tellOperator}
            </Callout>
          ) : error === "microsoft_unverified" ? (
            // From a link made before the two refusals had codes of their own.
            <Callout inset tone="attention" title="That Microsoft sign-in didn’t work here">
              If you used your work account, the server’s setup may be at fault: {tellOperator}
            </Callout>
          ) : error ? (
            <Callout inset tone="attention" title="That sign-in didn’t work">
              {emailLink ? "Try again, or use an email link." : "Try again."}
            </Callout>
          ) : null}
          {emailLink ? (
            send.isSuccess ? (
              <Callout inset tone="positive" title="Check your email" action={<Button size="sm" variant="quiet" onClick={() => send.reset()}>Use another email</Button>}>
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
                <TextField label="Email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
                {send.isError ? <ErrorCallout inset error={send.error} /> : null}
                <Button type="submit" variant="primary" wide busy={send.isPending} busyLabel="Sending…">
                  Email me a sign-in link
                </Button>
              </form>
            )
          ) : null}
          {methods.data?.microsoft ? (
            <>
              {emailLink ? <div className="entry-or">or</div> : null}
              <a className={`btn ${emailLink ? "btn-secondary" : "btn-primary"} btn-md btn-wide`} href={`/auth/microsoft?next=${encodeURIComponent(next)}`}>
                Continue with Microsoft
              </a>
            </>
          ) : null}
          {methods.data?.google ? (
            <>
              {emailLink && !methods.data.microsoft ? <div className="entry-or">or</div> : null}
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
              <span className="entry-person-role">Any account: type its email above</span>
            </li>
          </ul>
          {dev.isError ? (
            <SheetBody>
              <ErrorCallout inset error={dev.error} />
            </SheetBody>
          ) : null}
        </Sheet>
      ) : null}
      {/* The data statement (okf/spec/09-data-lifecycle.md §9.1): its first line here, all of it on Privacy. */}
      <p className="entry-fine">
        WhatBuild is a free preview: don’t keep anything here you can’t afford to lose. <Link to="/privacy">Privacy</Link> · <Link to="/cookies">Cookies</Link>
      </p>
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
      toast(r.scope_type === "tenant" || !r.scope ? `You’re ${aRole(r.role)} of ${org}.` : `You’re in ${org}, as ${aRole(r.role)} on ${scopeWords(r.scope_type, r.scope)}.`);
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
        <SheetHeader level={1} id="invite-title" title={accept.isError ? (wrongAddress ? "This invitation is for another email" : "This invitation didn’t work") : "Joining…"} />
        <SheetBody className="entry-form">
          {accept.isError ? (
            <>
              <ErrorCallout inset title="" error={accept.error} />
              {wrongAddress ? null : <p className="muted">An invitation works once, within 7 days, for the email it was sent to.</p>}
              <div className="entry-actions">
                {wrongAddress ? (
                  <>
                    <Button variant="primary" onClick={() => void signOut(`/invite/${token}`)}>
                      Sign in with that email
                    </Button>
                    <ButtonLink to="/" variant="quiet">Your products</ButtonLink>
                  </>
                ) : (
                  <>
                    <ButtonLink to="/">Your products</ButtonLink>
                    <Button variant="quiet" onClick={() => void signOut(`/invite/${token}`)}>
                      Sign in with another email
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
      <SheetHeader level={1} id="notfound-title" title="Page not found" />
      <EmptyState size="inline" action={<ButtonLink to="/" variant="primary">Go to your products</ButtonLink>}>
        The link may be mistyped, or you may not have access to its product.
      </EmptyState>
    </Sheet>
  );
}
