import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { safeNext } from "@whatbuild/core/safe-next";
import { useEffect, useState, type ReactNode } from "react";
import { Link, Navigate, useNavigate, useParams, useSearchParams } from "react-router";
import { api, ApiError, retryRead } from "../lib/api.ts";
import { useMe, useSignOut } from "../lib/session.tsx";
import { BrandMark } from "../shell/brand.tsx";
import { InvitationWords, roleWords, useInvitationAnswer, type Invitation } from "../shell/invitations.tsx";
import { usePageTitle } from "../shell/slots.tsx";
import { Button, ButtonLink, Callout, EmptyState, ErrorCallout, Loading, Sheet, SheetBody, SheetHeader, TextField } from "../ui/index.tsx";
import { PrivacyLink } from "../shell/privacy-link.tsx";
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

/** The sample's people, offered until the server's list of its accounts arrives, or if it doesn't. */
const DEV_PEOPLE = [
  { email: "riley@example.com", display_name: "Riley Chen", about: "Owner of the sample organization" },
  { email: "sam@example.com", display_name: "Sam Okafor", about: "Editor on the sample products" },
  { email: "jordan@example.com", display_name: "Jordan Ellis", about: "Reads only the Crewboard Story" },
];

/** Every account on a development server, the sample's people first, each with what it is there. */
function useDevAccounts(on: boolean) {
  return useQuery({
    queryKey: ["dev-accounts"],
    queryFn: () => api<{ items: { email: string; display_name: string; about: string }[]; more: number }>("GET", "/auth/dev-accounts"),
    enabled: on,
    staleTime: 0,
  });
}

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
  const accounts = useDevAccounts(Boolean(methods.data?.dev));
  const people = accounts.data?.items.length ? accounts.data.items : DEV_PEOPLE;
  const send = useMutation({ mutationFn: () => api<{ received: boolean; dev_note?: string }>("POST", "/auth/email", { email: email.trim(), next }) });
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
  return (
    <EntryPage title="Sign in · WhatBuild">
      <Sheet labelledBy="signin-title">
        <SheetHeader level={1} id="signin-title" title={next.startsWith("/invite/") ? "Sign in to see your invitation" : "Sign in to WhatBuild"} />
        <SheetBody className="entry-form">
          {next.startsWith("/invite/") && !error ? <p className="muted">Use the email your invitation was sent to. You’ll choose whether to join once you’ve signed in.</p> : null}
          {error === "link_expired" ? (
            <Callout inset tone="attention" title="That sign-in link has expired">
              Enter your email for a new one.
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
                If {email.trim()} can sign in here, a sign-in link is on its way. It works once, for 15 minutes. If nothing arrives, check the address, or ask someone who uses WhatBuild to invite you.
                {send.data.dev_note ? ` ${send.data.dev_note}` : ""}
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
            {people.map((p) => (
              <li key={p.email} className="entry-person">
                <Button size="sm" busy={dev.isPending && dev.variables === p.email} onClick={() => dev.mutate(p.email)}>
                  {p.display_name}
                </Button>
                <span className="entry-person-role">
                  {p.about ? <span>{p.about}</span> : null}
                  <span className="entry-person-email">{p.email}</span>
                </span>
              </li>
            ))}
            <li className="entry-person">
              <Button size="sm" onClick={() => email.trim() && dev.mutate(email.trim())} disabled={!email.trim()}>
                As the email above
              </Button>
              <span className="entry-person-role">
                {accounts.data?.more ? `${accounts.data.more} more accounts, or a new one: type its email above` : "Any account, or a new one: type its email above"}
              </span>
            </li>
          </ul>
          {dev.isError ? (
            <SheetBody>
              <ErrorCallout inset error={dev.error} />
            </SheetBody>
          ) : null}
        </Sheet>
      ) : null}
      {/* The one line every sign-in page carries (okf/spec/09-data-lifecycle.md §9.1), with the way to Privacy and Cookies. */}
      <p className="entry-fine">
        WhatBuild is a free preview: don’t keep anything here you can’t afford to lose. <PrivacyLink /> · <Link to="/cookies">Cookies</Link>
      </p>
    </EntryPage>
  );
}

/** A link's invitation: its choice, or `accepted` when this person accepted it before and still holds the role. */
type OpenedInvitation = Invitation & { accepted: boolean };

/**
 * An invitation's link. Opening it changes nothing: it shows the invitation and asks. Someone who
 * accepts opens the overview with a toast; someone who declines stays here, told what it did.
 */
export function AcceptInvite() {
  const { token = "" } = useParams();
  const me = useMe();
  const signOut = useSignOut();
  const opened = useQuery({
    queryKey: ["invitation", token],
    queryFn: () => api<OpenedInvitation>("POST", "/api/v1/invitations/read", { token }),
    retry: retryRead,
    staleTime: Infinity,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });
  const { accept, decline } = useInvitationAnswer();
  const answerError = accept.error ?? decline.error;
  const refusal = [answerError, opened.error].find((e) => e instanceof ApiError && e.status !== 0 && e.status < 500) as ApiError | undefined;
  const wrongAddress = refusal?.code === "invitation_wrong_address";
  const i = opened.data;
  const org = i?.tenant?.name ?? "the organization";
  const title = refusal
    ? wrongAddress
      ? "This invitation is for another email"
      : "This invitation can’t be used"
    : decline.isSuccess
      ? "You declined this invitation"
      : i?.accepted
        ? `You’re already in ${org}`
        : i
          ? `Join ${org}?`
          : opened.isError
            ? "This invitation didn’t load"
            : "Your invitation";
  const pending = accept.isPending || decline.isPending;
  return (
    <EntryPage title="Your invitation · WhatBuild">
      <Sheet labelledBy="invite-title">
        <SheetHeader level={1} id="invite-title" title={title} />
        <SheetBody className="entry-form">
          {refusal ? (
            <>
              <ErrorCallout inset title="" error={refusal} />
              {wrongAddress ? null : <p className="muted">An invitation is for the email it was sent to, and lasts 7 days unless it’s answered or cancelled first.</p>}
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
          ) : decline.isSuccess ? (
            <>
              <p>You won’t join {org}, and its link no longer works. Its admins will see that an invitation was declined, not your name. If you change your mind, ask whoever invited you for a new one.</p>
              <div className="entry-actions">
                <ButtonLink to="/" variant="primary">Go to WhatBuild</ButtonLink>
              </div>
            </>
          ) : i?.accepted ? (
            <>
              <p>You accepted this invitation earlier, and you’re {roleWords(i)}.</p>
              <div className="entry-actions">
                <ButtonLink to="/" variant="primary">Your products</ButtonLink>
              </div>
            </>
          ) : i ? (
            <>
              <p><InvitationWords invitation={i} /></p>
              <p className="faint">The name in quotation marks is the one the inviter gave WhatBuild. You join only if you accept.</p>
              {answerError ? <ErrorCallout inset error={answerError} /> : null}
              <div className="entry-actions">
                <Button variant="primary" busy={accept.isPending} busyLabel="Joining…" disabled={decline.isPending} onClick={() => accept.mutate({ token })}>
                  Accept
                </Button>
                <Button busy={decline.isPending} busyLabel="Declining…" disabled={accept.isPending} onClick={() => decline.mutate({ token })}>
                  Decline
                </Button>
                {pending ? null : <ButtonLink to="/" variant="quiet">Not now</ButtonLink>}
              </div>
            </>
          ) : opened.isError ? (
            <ErrorCallout inset title="" error={opened.error} onRetry={() => opened.refetch()} />
          ) : (
            <Loading label="Opening your invitation…" lines={2} variant="lines" />
          )}
        </SheetBody>
      </Sheet>
      {me.data && !wrongAddress ? <p className="entry-foot">Signed in as {me.data.email}.</p> : null}
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

/**
 * An organization or product the server answered `404` for. It answers the same whether the thing
 * doesn't exist or the person can't see it, so this says both, inside the plain shell.
 */
export function NotVisible({ what }: { what: "organization" | "product" }) {
  usePageTitle(what === "organization" ? "Organization not found" : "Product not found");
  return (
    <Sheet labelledBy="not-visible-title">
      <SheetHeader level={1} id="not-visible-title" title={`This ${what} doesn’t exist, or you can’t see it`} />
      <EmptyState size="inline" action={<ButtonLink to="/">Your products</ButtonLink>}>
        To see it, ask one of its admins for a role.
      </EmptyState>
    </Sheet>
  );
}
