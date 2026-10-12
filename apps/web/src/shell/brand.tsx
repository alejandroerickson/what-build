/**
 * The W mark: a rounded tile with a title-bar line across its top and a W below it, like one of the
 * app's panels. One source for the panel, the pill and (as the same geometry) public/favicon.svg.
 */
export const MARK_RULE = "M0 7.5H32";
export const MARK_PATH = "M8 11.8l3.2 12L16 13.8l4.8 10L24 11.8";

export function BrandMark({ size = 20 }: { size?: number }) {
  return (
    <svg className="brand-mark" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <rect width="32" height="32" rx="7" />
      <path className="brand-mark-rule" d={MARK_RULE} />
      <path d={MARK_PATH} />
    </svg>
  );
}
