import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ACCOUNT_DELETION } from "@whatbuild/core/account-deletion";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, Navigate, useSearchParams } from "react-router";
import { api, ApiError } from "../lib/api.ts";
import { forgetPersonalState } from "../lib/local-state.ts";
import { useMe } from "../lib/session.tsx";
import { Button, ButtonLink, Callout, ErrorCallout, Loading, OneLine, Sheet, SheetBody, SheetHeader, TextField } from "../ui/index.tsx";
import { EntryPage } from "./auth.tsx";
import { PrivacyLink } from "../shell/privacy-link.tsx";
import "../styles/screens/account.css";

/** What `confirm` says on every permanent delete; the server refuses anything else. */
const CONFIRM = "delete permanently";
/** Settings with this section open: where signing in again comes back to. */
const OPEN = { key: "delete", value: "account" } as const;
const HERE = `/settings?${OPEN.key}=${OPEN.value}`;

/** `products.delete_account_impact`: what deleting this account would do, and what stops it. */
export interface AccountDeleteImpact {
  email: string;
  display_name: string;
  instance_owner: boolean;
  organizations: { slug: string; name: string; role: string | null; roles: number; only_owner: boolean; example?: true }[];
  only_owner_of: { slug: string; name: string }[];
  sessions: number;
  agents: number;
  invitations: number;
  allowance: boolean;
  signed_in_at: string | null;
  /** Until when this browser's sign-in is recent enough to delete; null: sign in again first. */
  recent_until: string | null;
  recent_sign_in_minutes: number;
  record_mailed: boolean;
}

/** "a, b and c". */
const listed = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}` : (xs[0] ?? ""));

/** Refusals that change what the section shows: it reads again, and says the account is still there. */
const STEP_CHANGES = ["sign_in_again", "last_owner", "instance_owner"];

/**
 * Delete account, the last section of Settings. Closed, it says what it is and offers the one
 * button that opens it; open (`?delete=account`, so signing in again comes back to it), it says
 * what deleting will do, then whatever stands in the way, and only then asks for the address
 * typed and offers Delete account.
 */
export function DeleteAccount() {
  const [params, setParams] = useSearchParams();
  const open = params.get(OPEN.key) === OPEN.value;
  const setOpen = (on: boolean) =>
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        if (on) next.set(OPEN.key, OPEN.value);
        else next.delete(OPEN.key);
        return next;
      },
      { replace: true },
    );
  // Opened, the section comes into view with focus at its start; closed again, focus goes back to its button.
  const wasOpen = useRef(open);
  useEffect(() => {
    const target = document.getElementById(open ? "delete-account-region" : "delete-account-open");
    if (open) target?.scrollIntoView?.({ block: "nearest" });
    if (open || wasOpen.current) target?.focus();
    wasOpen.current = open;
  }, [open]);
  return (
    <Sheet className="account-sheet" labelledBy="delete-account-title">
      <SheetHeader id="delete-account-title" title="Delete account" />
      <SheetBody className="farewell">
        {open ? (
          <Opened onCancel={() => setOpen(false)} />
        ) : (
          <>
            <p className="muted">Permanently delete your account. You&rsquo;ll see what happens before anything is deleted.</p>
            <div>
              <Button id="delete-account-open" aria-expanded={false} aria-controls="delete-account-region" onClick={() => setOpen(true)}>
                Delete account…
              </Button>
            </div>
          </>
        )}
      </SheetBody>
    </Sheet>
  );
}

function Opened({ onCancel }: { onCancel: () => void }) {
  const impact = useQuery({ queryKey: ["account-delete-impact"], queryFn: () => api<AccountDeleteImpact>("GET", "/api/v1/me/delete-impact") });
  const d = impact.data;
  const { refetch } = impact;
  // What the server said when it refused a delete, shown where the form was.
  const [refused, setRefused] = useState<string | null>(null);
  // A recent sign-in lapses while the section is open: read again then, so it asks to sign in again.
  useEffect(() => {
    if (!d?.recent_until) return;
    const t = setTimeout(() => void refetch(), Math.max(0, Date.parse(d.recent_until) - Date.now()) + 1000);
    return () => clearTimeout(t);
  }, [d?.recent_until, refetch]);
  const step = !d ? "loading" : d.instance_owner || d.only_owner_of.length ? "blocked" : d.recent_until ? "confirm" : "sign-in";
  // When the step changes under the person (a refusal, a lapsed sign-in), focus goes to it rather than nowhere.
  const shown = useRef<string | null>(null);
  useEffect(() => {
    if (step === "loading") return;
    if (shown.current && shown.current !== step) document.getElementById("delete-account-step")?.focus();
    shown.current = step;
  }, [step]);
  const cancel = <Button onClick={onCancel}>Cancel</Button>;
  if (impact.isPending)
    return (
      <div id="delete-account-region" tabIndex={-1} className="farewell-region">
        <Loading label="Checking your account…" lines={2} />
      </div>
    );
  if (impact.isError)
    return (
      <div id="delete-account-region" tabIndex={-1} className="farewell-region">
        <ErrorCallout inset error={impact.error} onRetry={() => void refetch()} />
        <div className="farewell-actions">{cancel}</div>
      </div>
    );
  const orgs = d!.organizations;
  // Which organizations, by name, rather than every organization in general.
  const access = orgs.length
    ? `You’ll lose access to ${listed(orgs.map((o) => o.name))}${d!.invitations ? ", and pending invitations will be cancelled" : ""}.`
    : d!.invitations
      ? "Pending invitations will be cancelled."
      : null;
  const owned = orgs.filter((o) => o.only_owner);
  return (
    <div id="delete-account-region" tabIndex={-1} className="farewell-region">
      <p>If you delete your account:</p>
      <ul className="farewell-list">
        <li>{ACCOUNT_DELETION.will[0]}</li>
        {access ? <li>{access}</li> : null}
        <li>{ACCOUNT_DELETION.will[2]}</li>
      </ul>
      <p className="muted">
        {ACCOUNT_DELETION.stays} {ACCOUNT_DELETION.content}
      </p>
      <div id="delete-account-step" tabIndex={-1} className="farewell-step">
        {refused ? (
          <Callout inset tone="attention" title="Your account wasn’t deleted">
            {/* The title already says nothing changed. */}
            {refused.replace(/\s*Nothing was changed\.$/, "")}
          </Callout>
        ) : null}
        {step === "blocked" ? (
          <>
            {d!.instance_owner ? (
              <Callout inset tone="attention" title="You own this WhatBuild">
                Owners can&rsquo;t delete their accounts. Remove your email address from <code>WHATBUILD_INSTANCE_OWNERS</code> where WhatBuild is deployed, then come back.
              </Callout>
            ) : null}
            {owned.length ? <OnlyOwner orgs={owned} /> : null}
            <div className="farewell-actions">{cancel}</div>
          </>
        ) : step === "sign-in" ? (
          <SignInAgain impact={d!} cancel={cancel} />
        ) : (
          <Confirm
            impact={d!}
            cancel={cancel}
            onRefused={(message) => {
              setRefused(message);
              void refetch();
            }}
          />
        )}
      </div>
    </div>
  );
}

/** The organizations only this person owns, each with its two ways out. */
function OnlyOwner({ orgs }: { orgs: AccountDeleteImpact["organizations"] }) {
  return (
    <div className="farewell-owned">
      <Callout inset tone="attention" title={orgs.length === 1 ? `You’re the only owner of ${orgs[0]!.name}` : `You’re the only owner of ${orgs.length} organizations`}>
        Every organization needs an owner. Make someone else owner, or delete the organization.
      </Callout>
      <ul className="farewell-blocks">
        {orgs.map((o) => (
          <li key={o.slug} className="farewell-block">
            <OneLine className="farewell-block-name" text={o.name} />
            <div className="farewell-block-actions">
              <ButtonLink size="sm" to={`/t/${o.slug}/members`} aria-label={`Make someone else owner of ${o.name}`}>
                Make someone else owner
              </ButtonLink>
              {o.example ? null : (
                <ButtonLink size="sm" variant="quiet" to={`/t/${o.slug}/members#delete-org-title`} aria-label={`Delete organization ${o.name}`}>
                  Delete organization
                </ButtonLink>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A sign-in that is not recent: sign in again, by any way this WhatBuild offers, and come back here. */
function SignInAgain({ impact: d, cancel }: { impact: AccountDeleteImpact; cancel: ReactNode }) {
  const methods = useQuery({ queryKey: ["auth-methods"], queryFn: () => api<{ email_link: boolean; google: boolean; microsoft?: boolean }>("GET", "/auth/methods") });
  const send = useMutation({ mutationFn: () => api<{ sent: boolean; dev_note?: string }>("POST", "/auth/email", { email: d.email, next: HERE }) });
  const back = encodeURIComponent(HERE);
  const m = methods.data;
  return (
    <>
      {send.isSuccess ? (
        <Callout inset tone="positive" title="Check your email">
          We sent a sign-in link to {d.email}. It works once, for 15 minutes.{send.data.dev_note ? ` ${send.data.dev_note}` : ""}
        </Callout>
      ) : (
        <Callout inset tone="info" title="Sign in again to continue">
          Deleting your account needs a sign-in from the last {d.recent_sign_in_minutes} minutes. You&rsquo;ll come back here.
        </Callout>
      )}
      {send.isError ? <ErrorCallout inset error={send.error} /> : null}
      {methods.isError ? <ErrorCallout inset error={methods.error} onRetry={() => void methods.refetch()} /> : null}
      <div className="farewell-actions">
        {cancel}
        {m?.email_link && !send.isSuccess ? (
          <Button busy={send.isPending} busyLabel="Sending…" onClick={() => send.mutate()}>
            Email me a sign-in link
          </Button>
        ) : null}
        {m?.microsoft ? (
          <a className="btn btn-secondary btn-md" href={`/auth/microsoft?next=${back}`}>
            Continue with Microsoft
          </a>
        ) : null}
        {m?.google ? (
          <a className="btn btn-secondary btn-md" href={`/auth/google?next=${back}`}>
            Continue with Google
          </a>
        ) : null}
      </div>
    </>
  );
}

/** The last step: the address typed exactly, and the one button that names the act. */
function Confirm({ impact: d, cancel, onRefused }: { impact: AccountDeleteImpact; cancel: ReactNode; onRefused: (message: string) => void }) {
  const qc = useQueryClient();
  const [typed, setTyped] = useState("");
  const [left, setLeft] = useState(false);
  const matches = typed.trim().toLowerCase() === d.email.toLowerCase();
  const del = useMutation({
    mutationFn: () => api<{ notice_sent: boolean }>("POST", "/api/v1/me/delete", { email: typed.trim(), confirm: CONFIRM }),
    onSuccess: (r) => {
      // Every session is gone with the account: leave nothing of it in this browser.
      forgetPersonalState();
      qc.clear();
      window.location.assign(`/account-deleted${r.notice_sent ? "?mailed=1" : ""}`);
    },
    onError: (e) => {
      if (e instanceof ApiError && STEP_CHANGES.includes(e.code)) onRefused(e.message);
    },
  });
  return (
    <form
      className="farewell-step"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (matches) del.mutate();
        else setLeft(true);
      }}
    >
      <TextField
        label={`Type ${d.email} to confirm`}
        hint={`This can’t be undone.${d.record_mailed ? " We’ll email you a confirmation." : ""}`}
        error={left && typed.trim() && !matches ? "That doesn’t match your email address." : undefined}
        type="email"
        inputMode="email"
        autoCapitalize="none"
        autoCorrect="off"
        autoComplete="off"
        spellCheck={false}
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
        onBlur={() => setLeft(true)}
      />
      {del.isError && !(del.error instanceof ApiError && STEP_CHANGES.includes(del.error.code)) ? <ErrorCallout inset error={del.error} /> : null}
      <div className="farewell-actions">
        {cancel}
        <Button type="submit" variant="danger" icon="trash" busy={del.isPending} busyLabel="Deleting…" disabled={!matches}>
          Delete account
        </Button>
      </div>
    </form>
  );
}

/** `/account-deleted`, signed out: what just happened. */
export function AccountDeletedPage() {
  const me = useMe();
  const [params] = useSearchParams();
  if (me.data) return <Navigate to="/" replace />;
  return (
    <EntryPage title="Your account has been deleted · WhatBuild">
      <Sheet labelledBy="deleted-title">
        <SheetHeader level={1} id="deleted-title" title="Your account has been deleted" />
        <SheetBody className="farewell-step">
          <p>{ACCOUNT_DELETION.did[0]}</p>
          <p className="muted">{ACCOUNT_DELETION.stays}</p>
          <p className="muted">{ACCOUNT_DELETION.again}</p>
          {params.get("mailed") ? <p className="muted">We&rsquo;ve emailed you a confirmation.</p> : null}
        </SheetBody>
      </Sheet>
      <p className="entry-fine">
        <PrivacyLink /> · <Link to="/signin">Sign in</Link>
      </p>
    </EntryPage>
  );
}
