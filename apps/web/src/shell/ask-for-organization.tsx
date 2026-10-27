import { formatDate } from "../lib/format.ts";
import { useAskForOrganization, useMe } from "../lib/session.tsx";
import { Button, ErrorCallout, Glyph } from "../ui/index.tsx";
import "../styles/screens/guests.css";

/**
 * For someone who may not start an organization yet: one click puts them on the waitlist the
 * instance's owners read, and from then on it says they are on it. They hear by email when they may
 * start one. Says nothing to someone who may already start one.
 */
export function AskForOrganization({ variant = "primary" }: { variant?: "primary" | "quiet" }) {
  const me = useMe();
  const ask = useAskForOrganization();
  if (!me.data || me.data.tenant_allowance.remaining !== 0) return null;
  const asked = me.data.asked_for_organization_at;
  if (asked)
    return (
      <p className="ask-org-waiting">
        <Glyph name="check" size="sm" />
        <span>
          On the waitlist since {formatDate(asked)}. You&rsquo;ll get an email when you can start your organization.
        </span>
      </p>
    );
  return (
    <>
      <Button size="sm" variant={variant} icon="plus" busy={ask.isPending} onClick={() => ask.mutate()}>
        Ask for your own organization
      </Button>
      {ask.isError ? <ErrorCallout inset error={ask.error} /> : null}
    </>
  );
}
