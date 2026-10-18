import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent } from "react";
import { EmptyState, Glyph, IconButton } from "../ui/index.tsx";

const MIN_SCALE = 0.05;
const MAX_SCALE = 8;
const ZOOM_STEP = 1.25;

export interface Size {
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface ViewerImage {
  path: string;
  url: string;
}

export function clampScale(scale: number) {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

/** The largest scale that shows the whole image inside the stage, never enlarging a small one. */
export function fitScale(natural: Size, stage: Size) {
  if (natural.width <= 0 || natural.height <= 0 || stage.width <= 0 || stage.height <= 0) return 1;
  return Math.min(1, stage.width / natural.width, stage.height / natural.height);
}

/** Keeps the scaled image covering the stage edge it overflows, and centred on an axis it fits. */
export function clampOffset(offset: Point, natural: Size, stage: Size, scale: number): Point {
  const maxX = Math.max(0, (natural.width * scale - stage.width) / 2);
  const maxY = Math.max(0, (natural.height * scale - stage.height) / 2);
  // `|| 0` folds -0 into 0 so a centred axis compares equal to zero.
  return { x: Math.min(maxX, Math.max(-maxX, offset.x)) || 0, y: Math.min(maxY, Math.max(-maxY, offset.y)) || 0 };
}

/** `fit` follows the stage as it resizes; a number is a scale the person chose. */
interface View {
  zoom: number | "fit";
  offset: Point;
}
const FIT: View = { zoom: "fit", offset: { x: 0, y: 0 } };

/**
 * One of a source's images with zoom, pan and full screen, and every other image of the source a
 * step away: arrow keys, the previous and next buttons, or a strip of thumbnails. A format the
 * browser can't decode falls back to a download. `inline` is the viewer on a source's page rather
 * than in a dialog: it names the image and offers its download itself.
 */
export function ImageViewer({ images, current, onSelect, downloadUrl, inline = false }: { images: ViewerImage[]; current: string; onSelect: (path: string) => void; downloadUrl: string; inline?: boolean }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const index = Math.max(0, images.findIndex((x) => x.path === current));
  const image = images[index]!;

  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [natural, setNatural] = useState<Size>({ width: 0, height: 0 });
  const [stage, setStage] = useState<Size>({ width: 0, height: 0 });
  const [view, setViewState] = useState<View>(FIT);
  // Pointer moves can outrun renders, so gestures read the view from here, not from a closure.
  const viewRef = useRef(view);
  const setView = (next: View) => {
    viewRef.current = next;
    setViewState(next);
  };
  const [dragging, setDragging] = useState(false);
  // Button and keyboard zooms ease; wheel, pinch and drag follow the pointer directly.
  const [easing, setEasing] = useState(false);
  const easingTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [fullscreen, setFullscreen] = useState(false);
  const [broken, setBroken] = useState<ReadonlySet<string>>(new Set());
  const canFullscreen = typeof document !== "undefined" && Boolean(document.fullscreenEnabled);
  const pointers = useRef(new Map<number, Point>());
  const gesture = useRef<{ distance: number; scale: number; offset: Point; midpoint: Point }>(undefined);

  // A new image starts loading, fitted to the stage.
  const [shown, setShown] = useState(image.url);
  if (shown !== image.url) {
    setShown(image.url);
    setStatus("loading");
    setNatural({ width: 0, height: 0 });
    setView(FIT);
  }

  const fit = fitScale(natural, stage);
  const scaleOf = (v: View) => (v.zoom === "fit" ? fit : v.zoom);
  const scale = scaleOf(view);
  const atFit = view.zoom === "fit" || Math.abs(scale - fit) < 0.001;
  const pannable = natural.width * scale > stage.width + 0.5 || natural.height * scale > stage.height + 0.5;
  const offset = clampOffset(view.offset, natural, stage, scale);
  const zoomLabel = `${Math.round(scale * 100)}%`;
  const ready = status === "ready";
  const hasPrevious = index > 0;
  const hasNext = index < images.length - 1;

  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => setStage({ width: entry!.contentRect.width, height: entry!.contentRect.height }));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === rootRef.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      clearTimeout(easingTimer.current);
    };
  }, []);

  // An image already in the cache can finish before React listens for its load.
  useEffect(() => {
    const img = imageRef.current;
    if (img?.complete && img.naturalWidth) onLoad(img);
  }, [image.url]);

  // Keep the current thumbnail in view by scrolling the strip alone, never the page.
  useEffect(() => {
    const strip = stripRef.current;
    const thumb = strip?.querySelectorAll<HTMLElement>(".image-viewer-thumb")[index];
    if (!strip || !thumb) return;
    const left = thumb.offsetLeft - strip.offsetLeft;
    if (left < strip.scrollLeft) strip.scrollLeft = left;
    else if (left + thumb.offsetWidth > strip.scrollLeft + strip.clientWidth) strip.scrollLeft = left + thumb.offsetWidth - strip.clientWidth;
  }, [index]);

  function onLoad(img: HTMLImageElement) {
    setNatural({ width: img.naturalWidth, height: img.naturalHeight });
    setStatus("ready");
  }

  function ease() {
    setEasing(true);
    clearTimeout(easingTimer.current);
    easingTimer.current = setTimeout(() => setEasing(false), 240);
  }

  function toStage(client: Point): Point {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return { x: client.x - rect.left - rect.width / 2, y: client.y - rect.top - rect.height / 2 };
  }

  /**
   * Zooms so the image point under `anchor` (stage-centred coordinates) stays where it is; with no
   * anchor, zooms about the stage centre.
   */
  function zoomTo(target: number, anchor: Point | undefined, eased: boolean, from = viewRef.current, fromScale = scaleOf(viewRef.current)) {
    if (!ready) return;
    const next = clampScale(target);
    const point = anchor ?? { x: 0, y: 0 };
    const start = clampOffset(from.offset, natural, stage, fromScale);
    const ratio = next / fromScale;
    if (eased) ease();
    setView({ zoom: next, offset: clampOffset({ x: point.x - (point.x - start.x) * ratio, y: point.y - (point.y - start.y) * ratio }, natural, stage, next) });
  }

  function fitToStage() {
    ease();
    setView(FIT);
  }

  const previous = () => hasPrevious && onSelect(images[index - 1]!.path);
  const next = () => hasNext && onSelect(images[index + 1]!.path);
  const zoomIn = () => zoomTo(scale * ZOOM_STEP, undefined, true);
  const zoomOut = () => zoomTo(scale / ZOOM_STEP, undefined, true);
  const toggleFit = () => (atFit ? zoomTo(1, undefined, true) : fitToStage());

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement === rootRef.current) await document.exitFullscreen();
      else await rootRef.current?.requestFullscreen();
    } catch {
      // The browser refused (an embedding frame without permission); the inline view still works.
    }
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    if ((e.target as HTMLElement).closest("input, textarea, select, [contenteditable='true']")) return;
    const handled: Record<string, () => unknown> = {
      ArrowLeft: previous,
      ArrowRight: next,
      "+": zoomIn,
      "=": zoomIn,
      "-": zoomOut,
      _: zoomOut,
      "0": fitToStage,
      "1": () => zoomTo(1, undefined, true),
      ...(canFullscreen ? { f: toggleFullscreen, F: toggleFullscreen } : {}),
    };
    const run = handled[e.key];
    if (!run) return;
    e.preventDefault();
    void run();
  }

  // Pinch on a trackpad arrives as a wheel event with ctrlKey; in full screen a plain wheel zooms
  // too. React listens to wheel passively, so this listener is attached by hand to cancel the scroll.
  const onWheel = useRef<(e: WheelEvent) => void>(() => {});
  onWheel.current = (e) => {
    if (!ready || !(e.ctrlKey || e.metaKey || fullscreen)) return;
    e.preventDefault();
    const factor = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.002));
    zoomTo(scale * factor, toStage({ x: e.clientX, y: e.clientY }), false);
  };
  useEffect(() => {
    const el = stageRef.current;
    const listener = (e: WheelEvent) => onWheel.current(e);
    el?.addEventListener("wheel", listener, { passive: false });
    return () => el?.removeEventListener("wheel", listener);
  }, []);

  function onDoubleClick(e: MouseEvent) {
    if (!ready) return;
    if (atFit) zoomTo(Math.max(1, fit * 2), toStage({ x: e.clientX, y: e.clientY }), true);
    else fitToStage();
  }

  function beginGesture() {
    if (pointers.current.size < 2) {
      gesture.current = undefined;
      return;
    }
    const [a, b] = [...pointers.current.values()] as [Point, Point];
    gesture.current = {
      distance: Math.hypot(a.x - b.x, a.y - b.y),
      scale: scaleOf(viewRef.current),
      offset: viewRef.current.offset,
      midpoint: toStage({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }),
    };
  }

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    if (!ready || e.button !== 0) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    beginGesture();
  }

  function onPointerMove(e: PointerEvent) {
    const last = pointers.current.get(e.pointerId);
    if (!last) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    if (pointers.current.size >= 2 && g) {
      const [a, b] = [...pointers.current.values()] as [Point, Point];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      if (g.distance > 0) zoomTo(g.scale * (distance / g.distance), g.midpoint, false, { zoom: g.scale, offset: g.offset }, g.scale);
      return;
    }
    if (!pannable) return;
    setDragging(true);
    const v = viewRef.current;
    const s = scaleOf(v);
    const at = clampOffset(v.offset, natural, stage, s);
    setView({ zoom: v.zoom, offset: clampOffset({ x: at.x + e.clientX - last.x, y: at.y + e.clientY - last.y }, natural, stage, s) });
  }

  function onPointerUp(e: PointerEvent) {
    pointers.current.delete(e.pointerId);
    setDragging(false);
    beginGesture();
  }

  const name = image.path;
  const named = inline || fullscreen;
  return (
    <div ref={rootRef} className={`image-viewer${inline ? " image-viewer-inline" : ""}${fullscreen ? " image-viewer-fullscreen" : ""}`} onKeyDown={onKeyDown}>
      <div className="image-viewer-toolbar">
        <div className="image-viewer-group">
          {images.length > 1 ? (
            <>
              <IconButton size="sm" icon="chevron-left" label="Previous image" title="Previous image (←)" disabled={!hasPrevious} onClick={previous} />
              <span className="image-viewer-position num" aria-live="polite">
                {index + 1} of {images.length}
              </span>
              <IconButton size="sm" icon="chevron-right" label="Next image" title="Next image (→)" disabled={!hasNext} onClick={next} />
            </>
          ) : null}
          {named ? (
            <span className="image-viewer-name ellipsis" title={name}>
              {name}
            </span>
          ) : null}
        </div>
        <div className="image-viewer-group">
          <IconButton size="sm" icon="minus" label="Zoom out" title="Zoom out (−)" disabled={!ready} onClick={zoomOut} />
          <button
            type="button"
            className="btn btn-quiet btn-sm image-viewer-zoom num"
            aria-label={atFit ? `Zoom ${zoomLabel}, show actual size` : `Zoom ${zoomLabel}, fit to view`}
            title={atFit ? "Actual size (1)" : "Fit to view (0)"}
            disabled={!ready}
            onClick={toggleFit}
          >
            {ready ? zoomLabel : "—"}
          </button>
          <IconButton size="sm" icon="plus" label="Zoom in" title="Zoom in (+)" disabled={!ready} onClick={zoomIn} />
          {canFullscreen ? (
            <>
              <span className="image-viewer-divider" aria-hidden="true" />
              <IconButton
                size="sm"
                icon={fullscreen ? "minimize" : "maximize"}
                label={fullscreen ? "Exit full screen" : "Full screen"}
                title={fullscreen ? "Exit full screen (F)" : "Full screen (F)"}
                aria-pressed={fullscreen}
                onClick={() => void toggleFullscreen()}
              />
            </>
          ) : null}
          {named ? (
            <a className="icon-btn icon-btn-sm" href={downloadUrl} aria-label={`Download ${name}`} title="Download">
              <Glyph name="download" />
            </a>
          ) : null}
        </div>
      </div>

      <div
        ref={stageRef}
        className={`image-viewer-stage${pannable ? " image-viewer-pannable" : ""}${dragging ? " image-viewer-dragging" : ""}`}
        tabIndex={0}
        role="group"
        aria-label={`${name}. Arrow keys move between images, plus and minus zoom, drag to pan.`}
        onDoubleClick={onDoubleClick}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {status !== "error" ? (
          <img
            key={image.url}
            ref={imageRef}
            className={`image-viewer-image${ready ? " image-viewer-ready" : ""}${easing ? " image-viewer-easing" : ""}`}
            src={image.url}
            alt={name}
            style={{
              width: natural.width || undefined,
              height: natural.height || undefined,
              transform: `translate(-50%, -50%) translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
            }}
            draggable={false}
            onLoad={(e) => onLoad(e.currentTarget)}
            onError={() => setStatus("error")}
          />
        ) : null}
        {status === "loading" ? (
          <div className="image-viewer-overlay muted" role="status">
            <Glyph name="loader" className="spin" /> Loading the image…
          </div>
        ) : status === "error" ? (
          <div className="image-viewer-overlay">
            <EmptyState size="inline" title="This browser can’t display this image format" action={<a className="btn btn-secondary btn-sm" href={downloadUrl}>Download</a>} />
          </div>
        ) : null}
      </div>

      {images.length > 1 ? (
        <div ref={stripRef} className="image-viewer-strip" role="list" aria-label="Images in this source">
          {images.map((x, i) => (
            <div role="listitem" key={x.path}>
              <button
                type="button"
                className={`image-viewer-thumb${i === index ? " image-viewer-thumb-current" : ""}`}
                aria-current={i === index ? "true" : undefined}
                aria-label={x.path}
                title={x.path}
                onClick={() => onSelect(x.path)}
              >
                {broken.has(x.path) ? (
                  <Glyph name="image" />
                ) : (
                  <img src={x.url} alt="" loading="lazy" decoding="async" onError={() => setBroken((b) => new Set(b).add(x.path))} />
                )}
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
