import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api.ts";
import { Glyph, MenuItem, MenuNote, MenuSeparator } from "../ui/index.tsx";

const SOURCE = "https://github.com/alejandroerickson/what-build";

export interface Release {
  version: string;
  commit: string | null;
  built_at: string | null;
}

const TAG = /^v\d+\.\d+\.\d+/;
const SHA = /^[0-9a-f]{7,40}$/;

/**
 * How the account menu names what this server runs: a tag is a release, and a commit alone is a
 * build of that commit; dev-… is a development server, which has neither. The commit and the build
 * time stay in /api/v1/meta.
 */
export function releaseView(r: Release) {
  if (r.version.startsWith("dev-")) return null;
  const tagged = !SHA.test(r.version);
  const commit = r.commit ?? (tagged ? null : r.version);
  return {
    icon: tagged ? ("tag" as const) : ("git-commit" as const),
    lead: tagged ? "Release" : "Commit",
    name: tagged ? r.version : commit!.slice(0, 7),
    mono: !tagged,
    href: TAG.test(r.version) ? `${SOURCE}/releases/tag/${r.version}` : commit ? `${SOURCE}/commit/${commit}` : null,
  };
}

/** What this WhatBuild runs. Asked for before the menu opens, so the menu is placed at its full height. */
export function useRelease(): Release | undefined {
  return useQuery({ queryKey: ["meta"], queryFn: () => api<{ release?: Release }>("GET", "/api/v1/meta"), staleTime: 60_000 }).data?.release;
}

/** The last row of the account menu: which release this WhatBuild runs, linked to its source. */
export function ReleaseItem({ release }: { release: Release | undefined }) {
  if (!release) return null;
  const view = releaseView(release);
  if (!view)
    return (
      <>
        <MenuSeparator />
        <MenuNote>Development server</MenuNote>
      </>
    );
  const name = (
    <>
      <span className="release-lead">{view.lead}</span> <span className={view.mono ? "mono" : undefined}>{view.name}</span>
    </>
  );
  return (
    <>
      <MenuSeparator />
      {view.href ? (
        <MenuItem icon={view.icon} href={view.href} newTab meta={<Glyph name="external-link" size="sm" />}>
          {name}
        </MenuItem>
      ) : (
        <MenuNote>{name}</MenuNote>
      )}
    </>
  );
}
