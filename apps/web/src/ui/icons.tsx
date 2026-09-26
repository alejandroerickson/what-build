import type { SVGProps } from "react";

/** A small authored icon set: 20px grid, 1.6 stroke, round caps. Provisional like the rest of the look. */
function Icon({ children, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...props}>
      {children}
    </svg>
  );
}

export const IconChevronDown = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M5 8l5 5 5-5" />
  </Icon>
);
export const IconChevronLeft = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M12 5l-5 5 5 5" />
  </Icon>
);
export const IconChevronRight = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M8 5l5 5-5 5" />
  </Icon>
);
export const IconPlus = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M10 4v12M4 10h12" />
  </Icon>
);
export const IconSearch = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <circle cx="8.5" cy="8.5" r="5" />
    <path d="M12.5 12.5L16 16" />
  </Icon>
);
export const IconClose = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M5 5l10 10M15 5L5 15" />
  </Icon>
);
export const IconMenu = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M3.5 6h13M3.5 10h13M3.5 14h13" />
  </Icon>
);
export const IconClock = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <circle cx="10" cy="10" r="6.5" />
    <path d="M10 6.5V10l2.5 1.5" />
  </Icon>
);
export const IconPlug = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M7 3v4M13 3v4M5 7h10v3a5 5 0 01-10 0V7zM10 15v2.5" />
  </Icon>
);
export const IconExternal = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M11 4h5v5M16 4l-7 7M14 12v3.5a.5.5 0 01-.5.5h-9a.5.5 0 01-.5-.5v-9a.5.5 0 01.5-.5H8" />
  </Icon>
);
export const IconUpload = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M10 13V4M6.5 7.5L10 4l3.5 3.5M4 13v2.5a.5.5 0 00.5.5h11a.5.5 0 00.5-.5V13" />
  </Icon>
);
export const IconDownload = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M10 4v9M6.5 9.5L10 13l3.5-3.5M4 13v2.5a.5.5 0 00.5.5h11a.5.5 0 00.5-.5V13" />
  </Icon>
);
export const IconMore = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <circle cx="5" cy="10" r="0.9" fill="currentColor" />
    <circle cx="10" cy="10" r="0.9" fill="currentColor" />
    <circle cx="15" cy="10" r="0.9" fill="currentColor" />
  </Icon>
);
export const IconAgent = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <rect x="4" y="6" width="12" height="9" rx="2.5" />
    <path d="M10 3.5V6M7.5 10.5h.01M12.5 10.5h.01" />
  </Icon>
);
