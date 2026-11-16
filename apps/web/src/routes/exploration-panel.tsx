import { Outlet } from "react-router";
import { PanelContext } from "../shell/slots.tsx";
import { useTutorial } from "../tutorial/provider.tsx";
import { TutorialExploration, TutorialExplorationPanel } from "../tutorial/screens.tsx";
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

/** Every Exploration screen: the panel, and the screen; while the tutorial shows its examples, its example canvas. */
export function ExplorationSection() {
  if (useTutorial()?.showing)
    return (
      <>
        <TutorialExplorationPanel />
        <TutorialExploration />
      </>
    );
  return (
    <>
      <ExplorationPanel />
      <Outlet />
    </>
  );
}
