/** A size in bytes in a message's usual short form, with `places` decimal places (one unless given) where it has any. */
export type SizeFormat = (bytes: number, places?: number) => string;

/**
 * Two sizes a message sets side by side (a size and the limit or the room it is held to), in the
 * usual short form unless they would read alike while they differ: then with up to three decimal
 * places, and failing that in bytes, so a size just past a limit never reads as within it.
 */
export function sizesApart(format: SizeFormat, size: number, against: number): [string, string] {
  if (size === against) return [format(size, 1), format(against, 1)];
  for (let places = 1; places <= 3; places++) {
    const a = format(size, places);
    const b = format(against, places);
    if (a !== b) return [a, b];
  }
  return [bytesWords(size), bytesWords(against)];
}

/** A size in bytes, exactly. */
export const bytesWords = (bytes: number) => `${bytes.toLocaleString("en-US")} ${bytes === 1 ? "byte" : "bytes"}`;
