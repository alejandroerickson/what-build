/**
 * What the `unlimited` plan lifts and what it keeps, in the words `products.limits`' `plan_about`, an
 * organization's Plan page and Instance admin's choice of plan share. Its numbers are the ones that
 * apply on it (`unlimitedProductTotal`), so they are never typed twice. Pure, so the web app imports it
 * as `@whatbuild/core/unlimited-plan`.
 */
import { type ProductTotal, unlimitedProductTotal } from "./plans.ts";

/** What applies on `unlimited` for each of a product's totals, where a caller already has it. */
export type UnlimitedValues = Partial<Record<ProductTotal, unknown>>;

const MiB = 1024 * 1024;

/** A limit as it applies on `unlimited`: the value given, or the one `unlimitedProductTotal` sets. */
function kept(key: ProductTotal, values: UnlimitedValues): number | null {
  const given = values[key];
  return typeof given === "number" ? given : unlimitedProductTotal(key);
}

/** "each product’s Playbook keeps to 2,000 files and 32 MB, and each mockup and Story page keeps its newest 10 versions". */
export function unlimitedKeeps(values: UnlimitedValues = {}): string {
  const files = kept("playbook_files_max", values);
  const bytes = kept("playbook_bytes_max", values);
  const mockups = kept("mockup_versions_max", values);
  const pages = kept("story_page_versions_max", values);
  const versions = (n: number) => `its newest ${n.toLocaleString("en-US")} ${n === 1 ? "version" : "versions"}`;
  const playbook = [files === null ? null : `${files.toLocaleString("en-US")} files`, bytes === null ? null : `${Number((bytes / MiB).toFixed(2))} MB`].filter(Boolean).join(" and ");
  const parts = [
    playbook ? `each product’s Playbook keeps to ${playbook}` : null,
    mockups !== null && mockups === pages
      ? `each mockup and Story page keeps ${versions(mockups)}`
      : [mockups === null ? null : `each mockup keeps ${versions(mockups)}`, pages === null ? null : `each Story page keeps ${versions(pages)}`].filter(Boolean).join(", and "),
  ].filter(Boolean);
  return parts.join(", and ");
}

/** What `unlimited` lifts, then what it keeps: "No limit on what people and their agents do, …". */
export function unlimitedLifts(values: UnlimitedValues = {}): string {
  const keeps = unlimitedKeeps(values);
  return `No limit on what people and their agents do, nor on how many mockups and Story pages a product holds${keeps ? `; ${keeps}` : ""}.`;
}

/** What `unlimited` is for, in the sentences `plan_about` gives and Instance admin's choice of plan shows. */
export function aboutUnlimited(): string {
  return `${unlimitedLifts()} For this WhatBuild’s own organizations; never offered.`;
}
