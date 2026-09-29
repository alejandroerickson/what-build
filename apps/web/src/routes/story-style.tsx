import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api.ts";
import { attribution, relativeTime } from "../lib/format.ts";
import { useProduct } from "../lib/session.tsx";
import { Button, CopyField, Dialog, Glyph, Loading } from "../ui/index.tsx";
import type { Actor } from "./story-model.ts";

/** A house style as story.get_style lists it. */
export interface HouseStyleSummary {
  id: string;
  name: string;
  summary: string;
  best_for: string;
  character: string;
  signature: string[];
}

/** story.get_style without the stylesheet. */
export interface StyleView {
  style: {
    name: string;
    summary: string;
    based_on: string | null;
    based_on_name: string | null;
    kind: "house" | "team";
    updated_at: string;
    updated_by: Actor | null;
  } | null;
  house_styles: HouseStyleSummary[];
}

export function useStoryStyle() {
  const { api: base } = useProduct();
  return useQuery({ queryKey: ["story-style", base], queryFn: () => api<StyleView>("GET", `${base}/story/style?include_stylesheet=false`) });
}

/** How the style reads in one line: "Broadsheet, a house style" or "Acme reports, your design system". */
export function styleLine(s: NonNullable<StyleView["style"]>): string {
  if (s.kind === "team") return "Your design system";
  return s.based_on_name && s.based_on_name !== s.name ? `Adapted from ${s.based_on_name}` : "A house style";
}

/** Desktop width a preview is laid out at, then scaled to fit, so a style shows its real composition. */
const PREVIEW_WIDTH = 1280;

/**
 * A style's specimen in the same sandbox as a Story page. Wide enough boxes show the desktop layout
 * scaled down; a narrow box shows the page as a phone would.
 */
function Specimen({ src, title }: { src: string; title: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(e!.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const scale = width >= 560 && width < PREVIEW_WIDTH ? width / PREVIEW_WIDTH : 1;
  return (
    <div ref={box} className="style-specimen">
      {width ? (
        <iframe
          key={src}
          title={title}
          className="style-specimen-frame"
          sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
          referrerPolicy="no-referrer"
          src={src}
          onLoad={() => setLoaded(true)}
          style={scale < 1 ? { width: PREVIEW_WIDTH, height: `${100 / scale}%`, transform: `scale(${scale})` } : undefined}
        />
      ) : null}
      {loaded ? null : (
        <div className="style-specimen-status">
          <Loading variant="lines" lines={5} label="Loading the preview…" />
        </div>
      )}
    </div>
  );
}

/**
 * The Story style: which design system the Story's pages follow, and the house styles an agent can
 * adopt, each previewed on the same sample page. People choose; their agent makes the change, so
 * the dialog gives them the words to ask with.
 */
export function StyleDialog({ view, scheme, onClose }: { view: StyleView; scheme: "light" | "dark"; onClose: () => void }) {
  const { api: base } = useProduct();
  const current = view.style;
  const [picked, setPicked] = useState<string>(current ? "current" : (view.house_styles[0]?.id ?? ""));
  const house = view.house_styles.find((h) => h.id === picked);
  const src = picked === "current" ? `${base}/story/style/specimen?theme=${scheme}` : `${base}/story/house-styles/${picked}/specimen?theme=${scheme}`;
  const title = picked === "current" ? current?.name ?? "Current style" : house?.name ?? "";
  const ask = house
    ? `Adopt the ${house.name} house style for our WhatBuild Story.`
    : "";
  return (
    <Dialog
      open
      wide
      onClose={onClose}
      title="Story style"
      description="Every Story page follows one design system for this product: your company's own, or a house style. Preview them here. Your agent makes the change."
      footer={<Button onClick={onClose}>Close</Button>}
    >
      <div className="style-picker">
        <div className="style-list" role="group" aria-label="Styles">
          {current ? (
            <>
              <p className="style-list-label">In use</p>
              <button type="button" className="style-option" aria-pressed={picked === "current"} onClick={() => setPicked("current")}>
                <span className="style-option-name">{current.name}</span>
                <span className="style-option-sub">{styleLine(current)}</span>
              </button>
            </>
          ) : null}
          <p className="style-list-label">House styles</p>
          {view.house_styles.map((h) => (
            <button key={h.id} type="button" className="style-option" aria-pressed={picked === h.id} onClick={() => setPicked(h.id)}>
              <span className="style-option-name">
                {h.name}
                {current?.based_on === h.id ? <span className="style-option-tag">in use</span> : null}
              </span>
              <span className="style-option-sub">{h.summary}</span>
            </button>
          ))}
        </div>
        <div className="style-detail">
          <Specimen src={src} title={`${title}, a sample Story page`} />
          <div className="style-about">
            {picked === "current" && current ? (
              <p className="small muted">
                {styleLine(current)}. Set by {attribution(current.updated_by)}, <time dateTime={current.updated_at}>{relativeTime(current.updated_at)}</time>.
              </p>
            ) : house ? (
              <>
                <p className="style-about-lead">
                  <strong>Best for</strong> {house.best_for.charAt(0).toLowerCase() + house.best_for.slice(1)}
                </p>
                <p className="small muted">{house.character}</p>
                <p className="style-ask-label">To use it, ask your agent:</p>
                <CopyField value={ask} label={`What to ask your agent to adopt ${house.name}`} />
              </>
            ) : null}
            <a className="style-open small" href={src} target="_blank" rel="noopener noreferrer">
              Open the preview in a new tab <Glyph name="external-link" size="sm" />
            </a>
          </div>
        </div>
      </div>
      <div className="style-own">
        <p className="style-ask-label">Have a design system or brand guide of your own? Share it with your agent and ask:</p>
        <CopyField value="Make our WhatBuild Story follow our design system." label="What to ask your agent to use your design system" />
      </div>
    </Dialog>
  );
}
