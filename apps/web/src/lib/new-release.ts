/**
 * A tab keeps the app it loaded, and a release can come while it is open. The server then answers in
 * shapes this app may not know, and a screen that reads a field the release took away fails. Every
 * response names the commit the server was built from in `X-WhatBuild-Commit`, and the app knows its
 * own: once they differ, the next screen loads the release the server runs (main.tsx), and so does
 * an error. Never sooner, so nobody loses what they are typing.
 */

/** Where a tab notes the release it last loaded for itself. */
const LOADED_FOR = "whatbuild-loaded-for";

let server: string | null = null;

/** Notes the commit a response came from. A response that names none (a proxy's error, a development server) changes nothing. */
export function noteServerCommit(commit: string | null) {
  if (commit) server = commit;
}

/** Whether an app built from `ours` is not what a server built from `theirs` runs: never in development, which has no commit. */
export function replaced(ours: string, theirs: string | null): boolean {
  return Boolean(ours && theirs && theirs !== ours);
}

/** Whether a release replaced this page's app while it was open. */
export function releasedSinceLoad(): boolean {
  return replaced(__WHATBUILD_COMMIT__, server);
}

/**
 * Whether a tab should load the release built from `commit`: once only, so a page that is still old
 * once loaded (a cache kept the old app) is not loaded again at every screen.
 */
export function firstLoadFor(storage: Pick<Storage, "getItem" | "setItem">, commit: string): boolean {
  if (storage.getItem(LOADED_FOR) === commit) return false;
  storage.setItem(LOADED_FOR, commit);
  return true;
}

/** Loads the release the server runs, when one replaced this page's app. Whether it is loading. */
export function loadNewRelease(): boolean {
  if (!releasedSinceLoad()) return false;
  try {
    if (!firstLoadFor(sessionStorage, server!)) return false;
  } catch {
    // Without storage a second load cannot be told from a first, so the page stays as it is.
    return false;
  }
  location.reload();
  return true;
}
