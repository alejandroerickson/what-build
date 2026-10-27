import { usePlans } from "../lib/limits.ts";
import { ButtonLink, ErrorCallout, Loading, Sheet, SheetBody, SheetHeader } from "../ui/index.tsx";
import { EntryPage } from "./auth.tsx";
import { PlanComparison } from "./plan-comparison.tsx";
import "../styles/screens/cookies.css";

/**
 * `/plans`, public: the plans this WhatBuild offers, side by side, for anyone deciding, signed in or
 * not. An organization's own plan, with what it holds, is on its Plan page.
 */
export function PlansPage() {
  const q = usePlans();
  return (
    <EntryPage title="Plans · WhatBuild" wide>
      <Sheet labelledBy="plans-title">
        <SheetHeader level={1} id="plans-title" title="Plans" />
        {q.isPending ? (
          <SheetBody>
            <Loading label="Loading the plans…" lines={4} />
          </SheetBody>
        ) : q.isError ? (
          <SheetBody>
            <ErrorCallout title="The plans didn’t load" error={q.error} onRetry={() => q.refetch()} />
          </SheetBody>
        ) : !q.data.plans.length ? (
          <SheetBody>
            <p className="muted">This WhatBuild offers no plans: every organization here has no limits but the ones the deployment sets for all.</p>
          </SheetBody>
        ) : (
          <PlanComparison plans={q.data.plans} limits={q.data.limits} fileMaxBytes={q.data.file_max_bytes} />
        )}
      </Sheet>
      <div className="cookie-back">
        <ButtonLink to="/" size="sm" icon="arrow-left">
          Go to WhatBuild
        </ButtonLink>
      </div>
    </EntryPage>
  );
}
