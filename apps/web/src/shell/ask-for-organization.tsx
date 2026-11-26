import { useNavigate } from "react-router";
import { mayStartOrganization, useAskForOrganization, useMe } from "../lib/session.tsx";
import { Button, ButtonLink, ErrorCallout, Glyph } from "../ui/index.tsx";
import "../styles/screens/guests.css";

/**
 * For someone who may not start an organization yet. Where one of the day's places is open to them,
 * a link to `/welcome`, which takes no place: starting the organization does. Otherwise one click
 * asks: it takes them to `/welcome` where a place held for them from the waitlist, or one of the
 * day's places, is there; or it puts them on the waitlist, and from then on says their organization
 * is on its way, and the address they will hear at. Says nothing to someone who may already start one.
 */
export function AskForOrganization({ variant = "primary", label = "Start your own organization" }: { variant?: "primary" | "quiet"; label?: string }) {
  const me = useMe();
  const ask = useAskForOrganization();
  const navigate = useNavigate();
  if (!me.data || me.data.tenant_allowance.remaining !== 0) return null;
  if (me.data.place_open)
    return (
      <ButtonLink to="/welcome" size="sm" variant={variant} icon="plus">
        {label}
      </ButtonLink>
    );
  const asked = me.data.asked_for_organization_at;
  if (asked)
    return (
      <p className="ask-org-waiting">
        <Glyph name="check" size="sm" />
        <span>
          Your organization is on its way. We&rsquo;ll email {me.data.email} as soon as it&rsquo;s ready.
        </span>
      </p>
    );
  return (
    <>
      <Button size="sm" variant={variant} icon="plus" busy={ask.isPending} onClick={() => ask.mutate(undefined, { onSuccess: (m) => void (mayStartOrganization(m) && navigate("/welcome")) })}>
        {label}
      </Button>
      {ask.isError ? <ErrorCallout inset error={ask.error} /> : null}
    </>
  );
}
