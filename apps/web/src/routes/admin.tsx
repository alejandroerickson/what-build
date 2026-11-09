import { Outlet } from "react-router";
import { usePlans } from "../lib/limits.ts";
import { useMe } from "../lib/session.tsx";
import { AdminShell, PlainShell } from "../shell/Shell.tsx";
import { usePageTitle } from "../shell/slots.tsx";
import { EmptyState, Loading, Sheet, SheetHeader } from "../ui/index.tsx";
import { NotFound } from "./auth.tsx";
import { InstanceGuestsSheet, InstanceLimitsSheets, InstanceOrganizationsSheet, InstancePlansSheet } from "./limits.tsx";

/**
 * Instance admin (`/admin/…`), for the owners of this WhatBuild: anyone else is told the page wasn't
 * found, so nobody else learns it exists.
 */
export function AdminGate() {
  const me = useMe();
  if (me.isPending) return <div className="center-page"><Loading /></div>;
  if (!me.data?.tenant_allowance.instance_owner)
    return (
      <PlainShell>
        <NotFound />
      </PlainShell>
    );
  return (
    <AdminShell>
      <Outlet />
    </AdminShell>
  );
}

/** Instance admin → Organizations: each with its plan, renamed, moved to another plan, or deleted. */
export function AdminOrganizations() {
  usePageTitle("Organizations");
  return <InstanceOrganizationsSheet />;
}

/** Instance admin → Plans: the plans side by side, each limit with its refusal, and the deployment's own limits. */
export function AdminPlans() {
  const plans = usePlans();
  usePageTitle("Plans");
  if (plans.isPending)
    return (
      <Sheet label="Loading plans">
        <Loading lines={3} />
      </Sheet>
    );
  if (!plans.data?.plans.length)
    return (
      <Sheet labelledBy="admin-plans-title">
        <SheetHeader level={1} id="admin-plans-title" title="Plans" />
        <EmptyState size="inline" title="This WhatBuild offers no plans">
          Every organization is Unlimited. Plans are set where the service is deployed (<code>WHATBUILD_PLANS</code>).
        </EmptyState>
      </Sheet>
    );
  return (
    <>
      <InstancePlansSheet />
      <InstanceLimitsSheets />
    </>
  );
}

/** Instance admin → Guests: how guests come into the example organization, where there is one. */
export function AdminGuests() {
  const plans = usePlans();
  usePageTitle("Guests");
  if (plans.isPending)
    return (
      <Sheet label="Loading">
        <Loading lines={3} />
      </Sheet>
    );
  if (!plans.data?.example)
    return (
      <Sheet labelledBy="admin-guests-title">
        <SheetHeader level={1} id="admin-guests-title" title="Guests" />
        <EmptyState size="inline" title="No example organization">
          Guests read the example organization, so there are none without one.
        </EmptyState>
      </Sheet>
    );
  return <InstanceGuestsSheet />;
}
