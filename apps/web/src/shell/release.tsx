import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api.ts";
import { formatDate, formatDateTime } from "../lib/format.ts";
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
 * How the account menu names what this server runs. A tag is a release, with its commit beside it;
 * a commit alone is a build of that commit; dev-… is a development server, which has neither.
 */
export function releaseView(r: Release) {
  if (r.version.startsWith("dev-")) return null;
  const tagged = !SHA.test(r.version);
  const commit = r.commit ?? (tagged ? null : r.version);
  const short = commit?.slice(0, 7) ?? null;
  return {
    icon: tagged ? ("tag" as const) : ("git-commit" as const),
    lead: tagged ? "Release" : "Commit",
    name: tagged ? r.version : short!,
    mono: !tagged,
    /** Under a tag, the commit it names; under either, the day the image was built. */
    detailCommit: tagged ? short : null,
    built: r.built_at ? `Built ${formatDate(r.built_at)}` : null,
    href: TAG.test(r.version) ? `${SOURCE}/releases/tag/${r.version}` : commit ? `${SOURCE}/commit/${commit}` : null,
    title: [commit ? `Commit ${commit}` : null, r.built_at ? `built ${formatDateTime(r.built_at)}` : null].filter(Boolean).join(", "),
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
        <MenuNote>Development server, running from source</MenuNote>
      </>
    );
  const name = (
    <>
      <span className="release-lead">{view.lead}</span> <span className={view.mono ? "mono" : undefined}>{view.name}</span>
    </>
  );
  const detail =
    view.detailCommit || view.built ? (
      <span title={view.title || undefined}>
        {view.detailCommit ? <span className="mono">{view.detailCommit}</span> : null}
        {view.detailCommit && view.built ? " · " : null}
        {view.built}
      </span>
    ) : null;
  return (
    <>
      <MenuSeparator />
      {view.href ? (
        <MenuItem icon={view.icon} href={view.href} newTab detail={detail} meta={<Glyph name="external-link" size="sm" />}>
          {name}
        </MenuItem>
      ) : (
        <MenuNote>{name}</MenuNote>
      )}
    </>
  );
}
