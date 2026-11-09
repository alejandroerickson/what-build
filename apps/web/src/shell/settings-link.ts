import { useCallback } from "react";
import { useLocation } from "react-router";

/**
 * A section of Settings, the dialog that opens over whatever screen the person is on, addressed by
 * `?settings=<section>`: the product's (General, People, Export), its organization's (General,
 * People, Plan, Access changes) and the person's own (Account, Agents).
 */
export type SettingsKey =
  | "product"
  | "product/people"
  | "product/export"
  | "organization"
  | "organization/people"
  | "organization/plan"
  | "organization/access"
  | "account"
  | "agents";

export const SETTINGS_PARAM = "settings";

/** Parameters a section keeps in the address while it is open (Agents' choice of reach, Delete account opened), which closing Settings drops. */
export const SECTION_PARAMS = ["reach", "product", "org", "delete"];

/** The query string with Settings open at `key`, or closed when `key` is null, everything else in it kept. */
export function settingsSearch(search: string, key: SettingsKey | null, extra?: Record<string, string>): string {
  const next = new URLSearchParams(search);
  const was = next.get(SETTINGS_PARAM);
  // Another section starts with nothing of the one before it; closing drops it too.
  if (key === null || was !== key) for (const p of SECTION_PARAMS) next.delete(p);
  if (key === null) next.delete(SETTINGS_PARAM);
  else next.set(SETTINGS_PARAM, key);
  for (const [k, v] of Object.entries(extra ?? {})) next.set(k, v);
  // A slash needs no escaping in a query, and `?settings=organization/plan` reads as what it is.
  const s = next.toString().replace(/%2F/gi, "/");
  return s ? `?${s}` : "";
}

/** Where a link opens Settings at a section over the screen the person is on, which stays as it is. */
export function useSettingsTo(): (key: SettingsKey, extra?: Record<string, string>) => string {
  const { pathname, search } = useLocation();
  return useCallback((key: SettingsKey, extra?: Record<string, string>) => `${pathname}${settingsSearch(search, key, extra)}`, [pathname, search]);
}
