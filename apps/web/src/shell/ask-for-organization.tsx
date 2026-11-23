import { useNavigate } from "react-router";
import { useAskForOrganization, useMe } from "../lib/session.tsx";
import { Button, ErrorCallout, Glyph } from "../ui/index.tsx";
import "../styles/screens/guests.css";

/**
 * For someone who may not start an organization yet: one click gives them one of the day's places,
 * where the deployment gives them and one is left, and takes them to start it; or puts them on the
 * waitlist, and from then on says their organization is on its way, and the address they will hear
 * at. Says nothing to someone who may already start one.
 */
export function AskForOrganization({ variant = "primary", label = "Start your own organization" }: { variant?: "primary" | "quiet"; label?: string }) {
  const me = useMe();
  const ask = useAskForOrganization();
  const navigate = useNavigate();
  if (!me.data || me.data.tenant_allowance.remaining !== 0) return null;
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
      <Button size="sm" variant={variant} icon="plus" busy={ask.isPending} onClick={() => ask.mutate(undefined, { onSuccess: (m) => void (m.tenant_allowance.remaining !== 0 && navigate("/welcome")) })}>
        {label}
      </Button>
      {ask.isError ? <ErrorCallout inset error={ask.error} /> : null}
    </>
  );
}
