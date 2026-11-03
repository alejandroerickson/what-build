import { IDEA_CARD_SANDBOX } from "@whatbuild/core/page-sandbox";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { qs } from "../lib/api.ts";
import { useFrameReturn } from "../lib/minute.ts";
import { useScheme } from "../shell/theme.ts";
import { FrameStopped } from "../ui/index.tsx";

/**
 * A source's card: a picture of the source an agent drew, on a board of one size (the server's
 * SOURCE_CARD_FRAME), which every place that shows it scales to fit. It is served in the card kit's
 * document under the Idea cards' sandbox, so nothing in it runs but WhatBuild's own script.
 */
export const SOURCE_CARD_BOARD = { width: 640, height: 480 } as const;

/** The address of a source's card, which changes with it (its etag) and with the theme. */
export function useSourceCardUrl(base: string, recordId: string, etag: string | null | undefined): string | null {
  const scheme = useScheme();
  return etag ? `${base}/sources/${recordId}/card${qs({ theme: scheme, v: etag })}` : null;
}

/** How far the board is scaled to fill the element's width. */
function useBoardScale() {
  const box = useRef<HTMLSpanElement>(null);
  const [scale, setScale] = useState(0);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setScale(el.clientWidth / SOURCE_CARD_BOARD.width);
    measure();
    const watch = new ResizeObserver(measure);
    watch.observe(el);
    return () => watch.disconnect();
  }, []);
  return { box, scale };
}

/**
 * A card as a source's face, in the list or a preview's strip: small, out of the way of the pointer
 * and the keyboard, and loaded only once it comes into view. Should it not load, `fallback` (the
 * next thing the source can show) stands in.
 */
export function SourceCardFace({ src, mark, fallback }: { src: string; mark?: ReactNode; fallback: ReactNode }) {
  const { box, scale } = useBoardScale();
  const [failed, setFailed] = useState(false);
  if (failed) return <>{fallback}</>;
  return (
    <span ref={box} className="face face-source-card">
      {scale ? (
        <iframe
          className="source-card-frame"
          title=""
          aria-hidden="true"
          tabIndex={-1}
          loading="lazy"
          sandbox={IDEA_CARD_SANDBOX}
          referrerPolicy="no-referrer"
          src={src}
          style={{ transform: `scale(${scale})` }}
          onError={() => setFailed(true)}
        />
      ) : null}
      {mark}
    </span>
  );
}

/** A card shown large, in the preview and at the head of a source's page: as wide as it is given. */
export function SourceCardStage({ src, title }: { src: string; title: string }) {
  const { box, scale } = useBoardScale();
  const frame = useRef<HTMLIFrameElement>(null);
  const [reloads, setReloads] = useState(0);
  const refusal = useFrameReturn(frame, () => setReloads((n) => n + 1));
  if (refusal.stopped) return <FrameStopped what="This picture" refusal={refusal} />;
  return (
    <span ref={box} className="source-card-stage">
      {scale ? (
        <iframe
          key={reloads}
          ref={frame}
          className="source-card-frame"
          title={`Card: ${title}`}
          sandbox={IDEA_CARD_SANDBOX}
          referrerPolicy="no-referrer"
          src={src}
          style={{ transform: `scale(${scale})` }}
        />
      ) : null}
    </span>
  );
}
