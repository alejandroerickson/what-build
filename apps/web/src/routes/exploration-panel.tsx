import { Outlet, useLocation } from "react-router";
import { useProduct } from "../lib/session.tsx";
import { PanelContext, PanelFilter, PanelSection } from "../shell/slots.tsx";
import { useMockupList } from "./mockups.tsx";

/** Exploration holds the mockups. The panel lists them, and each opens its canvas. */

/** The mockups, flat, most recently changed first: each opens its canvas. */
function MockupsSection() {
  const { app } = useProduct();
  const { pathname } = useLocation();
  // The panel sits above the screen's route, so it reads the open mockup from the path.
  const mockupId = /\/exploration\/mockups\/([^/]+)/.exec(pathname)?.[1];
  const list = useMockupList();
  const items = list.data?.items;
  const onIndex = /\/exploration\/mockups\/?$/.test(pathname);
  return (
    <PanelSection title="Mockups">
      {items?.length ? (
        items.map((e) => (
          <PanelFilter key={e.mockup_id} to={`${app}/exploration/mockups/${e.mockup_id}`} current={e.mockup_id === mockupId} replace={false}>
            {e.title}
          </PanelFilter>
        ))
      ) : (
        <PanelFilter to={`${app}/exploration/mockups`} current={onIndex} replace={false}>
          {list.isPending ? "Loading…" : "None yet"}
        </PanelFilter>
      )}
    </PanelSection>
  );
}

/** The Exploration panel context: the mockups. */
export function ExplorationPanel() {
  return (
    <PanelContext label="Mockups">
      <MockupsSection />
    </PanelContext>
  );
}

/** Every Exploration screen: the panel, and the screen. */
export function ExplorationSection() {
  return (
    <>
      <ExplorationPanel />
      <Outlet />
    </>
  );
}
