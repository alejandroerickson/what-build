import { Outlet } from "react-router";
import { PanelContext } from "../shell/slots.tsx";
import { MockupTree } from "./mockup-tree.tsx";

/** Exploration holds the mockups. The panel lists them in their folders (mockup-tree.tsx), and each opens its canvas. */

/** The Exploration panel context: the mockups. */
export function ExplorationPanel() {
  return (
    <PanelContext label="Mockups">
      <MockupTree />
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
