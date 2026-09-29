/** The W mark: one source for the panel, the pill and (as the same geometry) public/favicon.svg. */
export const MARK_PATH = "M8 10l3.2 12L16 12l4.8 10L24 10";

export function BrandMark({ size = 20 }: { size?: number }) {
  return (
    <svg className="brand-mark" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <rect width="32" height="32" rx="7" />
      <path d={MARK_PATH} />
    </svg>
  );
}
