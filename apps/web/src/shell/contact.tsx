import { usePlans } from "../lib/limits.ts";

/**
 * Whom to write to on this deployment, if it names someone (WHATBUILD_PRIVACY_CONTACT, as `contact`
 * in `GET /api/v1/plans`): the Plan page and the screens that say who to ask take it from here, and
 * keep their own words for whoever runs this WhatBuild when it is null.
 */
export function useContact(): string | null {
  return usePlans().data?.contact ?? null;
}

/** A contact as the deployment gives it: an address to write to, or a page. */
export function Contact({ to }: { to: string }) {
  if (/^[^\s@]+@[^\s@]+$/.test(to)) return <a href={`mailto:${to}`}>{to}</a>;
  if (/^https?:\/\//.test(to)) return <a href={to} target="_blank" rel="noreferrer">{to}</a>;
  return <>{to}</>;
}
