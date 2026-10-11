import { Inflate } from "fflate";

/**
 * A ZIP that someone uploaded, read as hostile input. The central directory is read without
 * inflating anything, so the number of entries, their names and their declared sizes are refused
 * before any bytes are expanded. Each entry is then inflated in small steps and stopped as soon
 * as it gives more than it declared, so a bomb costs no more memory or time than the limits allow,
 * whatever its headers claim. Names that climb out of the archive, absolute names, duplicates
 * (including names that differ only in capitals), encrypted entries and split or ZIP64 archives
 * are refused, and each entry's CRC must match.
 */

export interface ZipLimits {
  /** Entries, folders included. */
  maxEntries: number;
  /** Bytes one entry may expand to. */
  maxEntryBytes: number;
  /** Bytes every entry together may expand to. */
  maxTotalBytes: number;
}

export interface ZipEntry {
  name: string;
  bytes: Uint8Array;
}

/** Either every file entry (folders left out), or every problem found before reading could go on. */
export type ZipResult = { entries: ZipEntry[]; problems: [] } | { entries: null; problems: string[] };

/** Compressed bytes inflated at a time: DEFLATE expands at most about 1,032 times, so one step gives at most about 4 MB. */
const STEP = 4096;

const u16 = (d: Uint8Array, o: number) => d[o]! | (d[o + 1]! << 8);
const u32 = (d: Uint8Array, o: number) => (d[o]! | (d[o + 1]! << 8) | (d[o + 2]! << 16) | (d[o + 3]! << 24)) >>> 0;

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Why a name may not be unpacked, or null when it may. A folder's name ends with `/`. */
export function unsafeEntryName(name: string): string | null {
  if (!name) return "has no name";
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(name)) return "has a control character in its name";
  if (name.includes("\\")) return "uses \\ in its name; a ZIP separates folders with /";
  if (name.startsWith("/") || /^[A-Za-z]:/.test(name)) return "has an absolute name";
  const segments = name.replace(/\/$/, "").split("/");
  if (segments.some((s) => s === "..")) return "climbs out of the archive with ..";
  if (segments.some((s) => s === "" || s === ".")) return "has an empty or . folder in its name";
  return null;
}

/** Inflate one entry, stopping the moment it gives more than `size` bytes. */
function inflateBounded(compressed: Uint8Array, size: number): Uint8Array | "more" | "corrupt" {
  const out = new Uint8Array(size);
  let n = 0;
  let over = false;
  const inflate = new Inflate((chunk) => {
    if (over) return;
    if (n + chunk.length > size) {
      over = true;
      return;
    }
    out.set(chunk, n);
    n += chunk.length;
  });
  try {
    if (!compressed.length) inflate.push(compressed, true);
    for (let i = 0; i < compressed.length && !over; i += STEP) inflate.push(compressed.subarray(i, i + STEP), i + STEP >= compressed.length);
  } catch {
    return "corrupt";
  }
  if (over) return "more";
  return n === size ? out : "corrupt";
}

export function readZip(data: Uint8Array, limits: ZipLimits): ZipResult {
  const fail = (...problems: string[]): ZipResult => ({ entries: null, problems });

  // The end-of-central-directory record: 22 bytes, then a comment of up to 65,535.
  let eocd = -1;
  for (let o = data.length - 22; o >= 0 && o >= data.length - 22 - 0xffff; o--) {
    if (u32(data, o) === 0x06054b50) {
      eocd = o;
      break;
    }
  }
  if (eocd < 0) return fail("The upload is not a ZIP archive.");
  const disk = u16(data, eocd + 4);
  const cdDisk = u16(data, eocd + 6);
  const onDisk = u16(data, eocd + 8);
  const count = u16(data, eocd + 10);
  const cdSize = u32(data, eocd + 12);
  const cdOffset = u32(data, eocd + 16);
  if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) return fail("The archive is a ZIP64 archive, which is not read here; a canvas is far smaller than ZIP64 is for.");
  if (disk !== 0 || cdDisk !== 0 || onDisk !== count) return fail("The archive is split across several files; send it as one.");
  if (cdOffset + cdSize > eocd) return fail("The archive's central directory is damaged.");
  if (count > limits.maxEntries) return fail(`The archive holds ${count} entries; at most ${limits.maxEntries} are read.`);

  const problems: string[] = [];
  const entries: ZipEntry[] = [];
  const seen = new Map<string, string>();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let declared = 0;
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    if (p + 46 > eocd || u32(data, p) !== 0x02014b50) return fail("The archive's central directory is damaged.");
    const flags = u16(data, p + 8);
    const method = u16(data, p + 10);
    const crc = u32(data, p + 16);
    const csize = u32(data, p + 20);
    const usize = u32(data, p + 24);
    const nameLen = u16(data, p + 28);
    const local = u32(data, p + 42);
    const rawName = data.subarray(p + 46, p + 46 + nameLen);
    p += 46 + nameLen + u16(data, p + 30) + u16(data, p + 32);
    if (p > eocd) return fail("The archive's central directory is damaged.");

    let name: string;
    try {
      name = decoder.decode(rawName);
    } catch {
      problems.push(`Entry ${i + 1}'s name is not UTF-8.`);
      continue;
    }
    const unsafe = unsafeEntryName(name);
    if (unsafe) {
      problems.push(`${JSON.stringify(name)} ${unsafe}.`);
      continue;
    }
    const key = name.replace(/\/$/, "").toLowerCase();
    const before = seen.get(key);
    if (before !== undefined) {
      problems.push(before === name ? `${name} appears more than once.` : `${name} and ${before} differ only in capitals, and would overwrite each other when unpacked.`);
      continue;
    }
    seen.set(key, name);
    if (flags & 1) {
      problems.push(`${name} is encrypted; send the archive without a password.`);
      continue;
    }
    if (name.endsWith("/")) continue;
    if (method !== 0 && method !== 8) {
      problems.push(`${name} uses a compression method other than deflate or none.`);
      continue;
    }
    if (usize > limits.maxEntryBytes) {
      problems.push(`${name} expands to ${usize} bytes; one entry may expand to at most ${limits.maxEntryBytes}.`);
      continue;
    }
    declared += usize;
    if (declared > limits.maxTotalBytes) return fail(`The archive expands to more than ${limits.maxTotalBytes} bytes, the most that is read.`);
    if (local + 30 > cdOffset || u32(data, local) !== 0x04034b50) {
      problems.push(`${name}'s entry is damaged.`);
      continue;
    }
    const start = local + 30 + u16(data, local + 26) + u16(data, local + 28);
    if (start + csize > cdOffset) {
      problems.push(`${name}'s entry is damaged.`);
      continue;
    }
    const stored = data.subarray(start, start + csize);
    const bytes = method === 0 ? (csize === usize ? stored.slice() : "corrupt") : inflateBounded(stored, usize);
    if (bytes === "more") problems.push(`${name} expands to more than the ${usize} bytes it declares.`);
    else if (bytes === "corrupt" || crc32(bytes) !== crc) problems.push(`${name} is damaged: its bytes do not match its size or checksum.`);
    else entries.push({ name, bytes });
  }
  return problems.length ? { entries: null, problems } : { entries, problems: [] };
}
