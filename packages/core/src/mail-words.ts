/**
 * Words the mails that bring someone in share: an invitation, and the mail that lets someone start
 * an organization. The reader meets each among other mail, maybe from someone they don't know, so
 * it says what WhatBuild is, and where to read more on a deployment with a public site of its own.
 */
export const WHATBUILD_IN_A_SENTENCE = "WhatBuild turns a product team’s discovery material into outcomes, mockups and a Story for stakeholders.";

/** That sentence, then "There’s more at <site>." where the deployment has a public site (WHATBUILD_SITE_URL). */
export function aboutWhatBuild(config: { siteUrl?: string | null }): string {
  return config.siteUrl ? `${WHATBUILD_IN_A_SENTENCE} There’s more at ${config.siteUrl}.` : WHATBUILD_IN_A_SENTENCE;
}
