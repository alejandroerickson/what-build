import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ACCOUNT_DELETION } from "@whatbuild/core/account-deletion";
import { useEffect, useRef, useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router";
import { api, ApiError } from "../lib/api.ts";
import { formatTime, plural, ROLE_WORD } from "../lib/format.ts";
import { forgetPersonalState } from "../lib/local-state.ts";
import { useMe } from "../lib/session.tsx";
import { usePageTitle } from "../shell/slots.tsx";
import { Button, ButtonLink, Callout, ErrorCallout, Glyph, Loading, Sheet, SheetBody, SheetHeader, TextField, type GlyphName } from "../ui/index.tsx";
import { EntryPage } from "./auth.tsx";
import "../styles/screens/account.css";

/** What `confirm` says on every permanent delete; the server refuses anything else. */
const CONFIRM = "delete permanently";
const HERE = "/settings/delete-account";

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

/** One line of the terms: a glyph, the fixed words, and what they mean for this person. */
function Term({ icon, children, detail }: { icon: GlyphName; children: string; detail?: string | null }) {
  return (
    <li className="farewell-term">
      <Glyph name={icon} className="farewell-term-icon" />
      <div>
        <p>{children}</p>
        {detail ? <p className="farewell-term-detail">{detail}</p> : null}
      </div>
    </li>
  );
}

/** "a, b and c". */
const listed = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}` : (xs[0] ?? ""));

/** "Owen Co (a role on a team or product) and Shared Co (owner)": each organization with the role held across it. */
function organizationWords(orgs: AccountDeleteImpact["organizations"]): string {
  return listed(orgs.map((o) => `${o.name} (${o.role ? (ROLE_WORD[o.role]?.toLowerCase() ?? o.role) : o.roles === 1 ? "a role on a team or product" : `roles on ${o.roles} teams and products`})`));
}

/** "2 browsers and 1 agent signed in as you now", leaving out a count of none. */
function signedInWords(d: AccountDeleteImpact): string {
  const held = listed([d.sessions > 0 ? plural(d.sessions, "browser") : "", d.agents > 0 ? plural(d.agents, "agent") : ""].filter(Boolean));
  return held ? `${held} signed in as you now.` : "";
}

/** "2 hours ago", in words a sentence can hold. */
function agoWords(iso: string, now = Date.now()): string {
  const min = Math.max(1, Math.round((now - Date.parse(iso)) / 60_000));
  if (min < 60) return `${plural(min, "minute")} ago`;
  if (min < 48 * 60) return `${plural(Math.round(min / 60), "hour")} ago`;
  return `${plural(Math.round(min / 1440), "day")} ago`;
}

/** What a refused delete leaves: the step that replaces the form says the account is still there, and why. */
function Refused({ message }: { message: string | null }) {
  return message ? (
    <Callout inset tone="attention" title="Your account wasn’t deleted">
      {message}
    </Callout>
  ) : null;
}

/**
 * `/settings/delete-account`: a person deletes their own account. The terms come first, in the
 * words the privacy page and the record mail use too; then whatever stands in the way (owning the
 * instance, being an organization's only owner, a sign-in that is not recent), all of it at once,
 * and only then the typed address and the one button that names the act.
 */
export function DeleteAccountPage() {
  usePageTitle("Delete your account");
  const impact = useQuery({ queryKey: ["account-delete-impact"], queryFn: () => api<AccountDeleteImpact>("GET", "/api/v1/me/delete-impact") });
  const d = impact.data;
  const { refetch } = impact;
  // What the server said when it refused a delete, carried into the step that takes the form's place.
  const [refused, setRefused] = useState<string | null>(null);
  // A recent sign-in lapses while the page is open: read again then, so the page asks to sign in again.
  useEffect(() => {
    if (!d?.recent_until) return;
    const t = setTimeout(() => void refetch(), Math.max(0, Date.parse(d.recent_until) - Date.now()) + 1000);
    return () => clearTimeout(t);
  }, [d?.recent_until, refetch]);
  const blocked = d ? d.instance_owner || d.only_owner_of.length > 0 : false;
  const step = !d ? "loading" : blocked ? "blocked" : d.recent_until ? "confirm" : "sign-in";
  // When the step changes under the person (a refusal, a lapsed sign-in), focus goes to its heading rather than nowhere.
  const shown = useRef<string | null>(null);
  useEffect(() => {
    if (step === "loading") return;
    if (shown.current && shown.current !== step) {
      const h = document.getElementById("farewell-step");
      h?.setAttribute("tabindex", "-1");
      h?.focus();
    }
    shown.current = step;
  }, [step]);
  const owned = d ? d.organizations.filter((o) => o.only_owner) : [];
  return (
    <div className="farewell">
      <div className="farewell-back">
        <ButtonLink to="/settings" variant="quiet" size="sm" icon="arrow-left">
          Settings
        </ButtonLink>
      </div>
      <Sheet labelledBy="farewell-title">
        <SheetHeader level={1} id="farewell-title" title="Delete your account" end={d ? <span className="farewell-who">{d.email}</span> : null} />
        <SheetBody className="farewell-intro">
          <p className="farewell-lead">Deleting your account can&rsquo;t be undone. {ACCOUNT_DELETION.final}</p>
          {d?.instance_owner ? (
            <p className="farewell-lead">Before it can go, your address has to come off this WhatBuild&rsquo;s owners: see below.</p>
          ) : owned.length ? (
            <p className="farewell-lead">Before it can go, someone else has to own {listed(owned.map((o) => o.name))}: see below.</p>
          ) : null}
        </SheetBody>
        <h2 className="farewell-group">What goes, at once</h2>
        <ul className="farewell-terms">
          <Term icon="log-out" detail={d ? signedInWords(d) : null}>
            {ACCOUNT_DELETION.goes[0]}
          </Term>
          <Term
            icon="users"
            detail={
              d
                ? [d.organizations.length ? `In ${organizationWords(d.organizations)}.` : "You hold no role in any organization.", d.invitations ? `${plural(d.invitations, "invitation")} waiting.` : null, d.allowance ? "Your allowance to start organizations goes too." : null]
                    .filter(Boolean)
                    .join(" ")
                : null
            }
          >
            {ACCOUNT_DELETION.goes[1]}
          </Term>
          <Term icon="user-x" detail={d ? `${d.display_name}, ${d.email}.` : null}>
            {ACCOUNT_DELETION.goes[2]}
          </Term>
        </ul>
        <h2 className="farewell-group">What stays</h2>
        <ul className="farewell-terms">
          <Term icon="file-text" detail={ACCOUNT_DELETION.content}>
            {ACCOUNT_DELETION.stays}
          </Term>
        </ul>
        <div className="sheet-body farewell-after">
          <p>{ACCOUNT_DELETION.again}</p>
        </div>
      </Sheet>
      {impact.isPending ? (
        <Sheet label="Checking your account">
          <SheetBody>
            <Loading label="Checking what stands in the way…" lines={2} />
          </SheetBody>
        </Sheet>
      ) : impact.isError ? (
        <ErrorCallout error={impact.error} onRetry={() => void impact.refetch()} />
      ) : blocked ? (
        <>
          {d!.instance_owner ? <InstanceOwner id="farewell-step" refused={refused} /> : null}
          {owned.length ? <OnlyOwner id={d!.instance_owner ? "farewell-step-owned" : "farewell-step"} orgs={owned} refused={d!.instance_owner ? null : refused} /> : null}
        </>
      ) : !d!.recent_until ? (
        <SignInAgain impact={d!} refused={refused} />
      ) : (
        <Confirm
          impact={d!}
          onRefused={(message) => {
            setRefused(message);
            void impact.refetch();
          }}
        />
      )}
    </div>
  );
}

function InstanceOwner({ id, refused }: { id: string; refused: string | null }) {
  return (
    <Sheet labelledBy={id}>
      <SheetHeader id={id} title="You own this WhatBuild" />
      <SheetBody className="farewell-step">
        <Refused message={refused} />
        <p>
          Your address is one of this WhatBuild&rsquo;s owners (<code>WHATBUILD_INSTANCE_OWNERS</code>), so the account can&rsquo;t be deleted here. Whoever runs this WhatBuild can
          take your address off that list; then come back to delete it.
        </p>
      </SheetBody>
    </Sheet>
  );
}

/** The organizations only this person owns, each with its two ways out. */
function OnlyOwner({ id, orgs, refused }: { id: string; orgs: AccountDeleteImpact["organizations"]; refused: string | null }) {
  return (
    <Sheet labelledBy={id}>
      <SheetHeader id={id} title={orgs.length === 1 ? `You’re the only owner of ${orgs[0]!.name}` : `You’re the only owner of ${orgs.length} organizations`} />
      <SheetBody className="farewell-step">
        <Refused message={refused} />
        <p>An organization always keeps an owner. Make someone else owner of {orgs.length === 1 ? "it" : "each"}, or delete {orgs.length === 1 ? "it" : "them"}, and your account can go.</p>
      </SheetBody>
      <ul className="farewell-blocks">
        {orgs.map((o) => (
          <li key={o.slug} className="farewell-block">
            <div className="farewell-block-name">
              <span className="ellipsis">{o.name}</span>
              <span className="farewell-term-detail">You&rsquo;re its only owner</span>
            </div>
            <div className="farewell-block-actions">
              <ButtonLink size="sm" to={`/t/${o.slug}/members`} aria-label={`Make someone else owner of ${o.name}`}>
                Make someone else owner
              </ButtonLink>
              {o.example ? null : (
                <ButtonLink size="sm" variant="quiet" to={`/t/${o.slug}/members#delete-org-title`} aria-label={`Delete ${o.name}`}>
                  Delete it
                </ButtonLink>
              )}
            </div>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}

/** A sign-in that is not recent: sign in again, by any way this WhatBuild offers, and come back here. */
function SignInAgain({ impact: d, refused }: { impact: AccountDeleteImpact; refused: string | null }) {
  const methods = useQuery({ queryKey: ["auth-methods"], queryFn: () => api<{ email_link: boolean; google: boolean; microsoft?: boolean }>("GET", "/auth/methods") });
  const send = useMutation({ mutationFn: () => api<{ sent: boolean; dev_note?: string }>("POST", "/auth/email", { email: d.email, next: HERE }) });
  const back = encodeURIComponent(HERE);
  const m = methods.data;
  return (
    <Sheet labelledBy="farewell-step">
      <SheetHeader id="farewell-step" title="Sign in again to continue" />
      <SheetBody className="farewell-step">
        <Refused message={refused} />
        <p>
          This browser signed in {d.signed_in_at ? agoWords(d.signed_in_at) : "a while ago"}. Before an account is deleted, WhatBuild asks for a sign-in from the last{" "}
          {d.recent_sign_in_minutes} minutes, so a browser someone left signed in isn&rsquo;t enough. You&rsquo;ll come back to this page.
        </p>
        {send.isSuccess ? (
          <Callout inset tone="positive" title="Check your email">
            We sent a sign-in link to {d.email}. It works once, for 15 minutes.{send.data.dev_note ? ` ${send.data.dev_note}` : ""}
          </Callout>
        ) : null}
        {send.isError ? <ErrorCallout inset error={send.error} /> : null}
        {methods.isError ? <ErrorCallout inset error={methods.error} onRetry={() => void methods.refetch()} /> : null}
        {m && ((m.email_link && !send.isSuccess) || m.microsoft || m.google) ? (
          <div className="farewell-actions">
            {m.email_link && !send.isSuccess ? (
              <Button busy={send.isPending} busyLabel="Sending…" onClick={() => send.mutate()}>
                Email me a sign-in link
              </Button>
            ) : null}
            {m.microsoft ? (
              <a className="btn btn-secondary btn-md" href={`/auth/microsoft?next=${back}`}>
                Continue with Microsoft
              </a>
            ) : null}
            {m.google ? (
              <a className="btn btn-secondary btn-md" href={`/auth/google?next=${back}`}>
                Continue with Google
              </a>
            ) : null}
          </div>
        ) : null}
      </SheetBody>
    </Sheet>
  );
}

/** Refusals that change the step itself: the page reads again and shows it, with the server's words. */
const STEP_CHANGES = ["sign_in_again", "last_owner", "instance_owner"];

/** The last step: the address typed exactly, and the one button that names the act. */
function Confirm({ impact: d, onRefused }: { impact: AccountDeleteImpact; onRefused: (message: string) => void }) {
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
    <Sheet labelledBy="farewell-step">
      <SheetHeader id="farewell-step" title="Confirm with your email address" />
      <form
        className="sheet-body farewell-step"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (matches) del.mutate();
          else setLeft(true);
        }}
      >
        <TextField
          label={`Type ${d.email} to confirm`}
          hint={`You can delete from this sign-in until ${formatTime(d.recent_until)}.${d.record_mailed ? " A record of the deletion goes to this address." : ""}`}
          error={left && typed.trim() && !matches ? `That isn’t your address. Type ${d.email}.` : undefined}
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
        <div className="farewell-actions farewell-actions-end">
          <ButtonLink to="/settings">Keep my account</ButtonLink>
          <Button type="submit" variant="danger" icon="trash" busy={del.isPending} busyLabel="Deleting…" disabled={!matches}>
            Delete my account
          </Button>
        </div>
      </form>
    </Sheet>
  );
}

/** `/account-deleted`, signed out: what just happened, in the same words. */
export function AccountDeletedPage() {
  const me = useMe();
  const [params] = useSearchParams();
  if (me.data) return <Navigate to="/" replace />;
  return (
    <EntryPage title="Your account is deleted · WhatBuild">
      <Sheet labelledBy="deleted-title">
        <SheetHeader level={1} id="deleted-title" title="Your account is deleted" />
        <SheetBody className="farewell-step">
          <p>What went:</p>
          <ul className="farewell-went">
            {ACCOUNT_DELETION.goes.map((g) => (
              <li key={g}>{g}</li>
            ))}
          </ul>
          <p className="muted">
            {ACCOUNT_DELETION.stays} {ACCOUNT_DELETION.final}
          </p>
          <p className="muted">{ACCOUNT_DELETION.again}</p>
          {params.get("mailed") ? <p className="muted">A record of it went to your address.</p> : null}
        </SheetBody>
      </Sheet>
      <p className="entry-fine">
        <Link to="/privacy">Privacy</Link> · <Link to="/signin">Sign in</Link>
      </p>
    </EntryPage>
  );
}
