/**
 * Where a sign-in returns to, one rule for the server and the web app. Dependency-free, so the web
 * app imports this file alone (`@whatbuild/core/safe-next`).
 */

const NEXT_BASE = "https://next.invalid";

/**
 * Where a sign-in returns to: a path on this origin, or "/". Never an open redirect, so it refuses
 * a scheme or host, any backslash, whitespace or control character (browsers drop tabs and
 * newlines, which turns "/\t/host" into "//host"), and, in the path, an encoded slash, backslash,
 * percent sign or control character, so that no later decoding makes one either.
 */
export function safeNext(next: string | undefined | null): string {
  if (!next || next.length > 2000 || !next.startsWith("/") || /[\\\s\p{Cc}\p{Cf}]/u.test(next)) return "/";
  const path = next.split(/[?#]/, 1)[0]!;
  if (path.startsWith("//") || /%(2f|5c|25|[01][0-9a-f]|7f)/i.test(path)) return "/";
  let url: URL;
  try {
    url = new URL(next, NEXT_BASE);
  } catch {
    return "/";
  }
  // Dot segments can collapse into a leading "//" ("/.//host"), so the normalized path is what is checked and returned.
  const out = `${url.pathname}${url.search}${url.hash}`;
  return url.origin === NEXT_BASE && !out.startsWith("//") ? out : "/";
}
