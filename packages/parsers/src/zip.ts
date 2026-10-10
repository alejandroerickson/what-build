import { Inflate } from "fflate";
import { TooLargeError } from "./types.ts";

const EOCD = 0x06054b50;
const EOCD64_LOCATOR = 0x07064b50;
const EOCD64 = 0x06064b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;
const ZIP64 = 0xffffffff;
/** Compressed bytes handed to the inflater at a time: one step expands to at most about 1,032 times this. */
const STEP = 16 * 1024;

/**
 * The entries of a ZIP package (DOCX, XLSX) that `wanted` names, unpacked within a budget: together
 * they may hold at most `maxBytes` once inflated. The budget counts the bytes that come out, not
 * the sizes the package declares, so a zip bomb stops at the limit instead of filling memory. A
 * declared size over the budget is refused before anything is inflated.
 */
export function unzipParts(bytes: Uint8Array, wanted: (name: string) => boolean, maxBytes: number): Record<string, Uint8Array> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const check = (at: number, size: number) => {
    if (!Number.isSafeInteger(at) || at < 0 || at + size > bytes.length) throw new Error("invalid zip data");
  };
  const u16 = (at: number) => {
    check(at, 2);
    return view.getUint16(at, true);
  };
  const u32 = (at: number) => {
    check(at, 4);
    return view.getUint32(at, true);
  };
  const u64 = (at: number) => u32(at) + u32(at + 4) * 2 ** 32;

  let end = -1;
  for (let at = bytes.length - 22; at >= 0 && at >= bytes.length - 22 - 0xffff; at--) {
    if (view.getUint32(at, true) === EOCD) {
      end = at;
      break;
    }
  }
  if (end < 0) throw new Error("invalid zip data");
  let count = u16(end + 10);
  let at = u32(end + 16);
  if (end >= 20 && u32(end - 20) === EOCD64_LOCATOR) {
    const z = u64(end - 12);
    if (u32(z) === EOCD64) {
      count = u64(z + 32);
      at = u64(z + 48);
    }
  }

  const parts: Record<string, Uint8Array> = {};
  let left = maxBytes;
  // Every central directory entry is at least 46 bytes, so a bogus count cannot loop past the file.
  for (let i = 0; i < count; i++) {
    if (u32(at) !== CENTRAL) throw new Error("invalid zip data");
    const flags = u16(at + 8);
    const method = u16(at + 10);
    let packed = u32(at + 20);
    let declared = u32(at + 24);
    const nameLength = u16(at + 28);
    const extraLength = u16(at + 30);
    let local = u32(at + 42);
    check(at + 46, nameLength + extraLength + u16(at + 32));
    const nameBytes = bytes.subarray(at + 46, at + 46 + nameLength);
    const name = flags & 0x800 ? new TextDecoder().decode(nameBytes) : String.fromCharCode(...nameBytes);
    if (packed === ZIP64 || declared === ZIP64 || local === ZIP64) {
      for (let e = at + 46 + nameLength; e + 4 <= at + 46 + nameLength + extraLength; e += 4 + u16(e + 2)) {
        if (u16(e) !== 1) continue;
        let p = e + 4;
        if (declared === ZIP64) {
          declared = u64(p);
          p += 8;
        }
        if (packed === ZIP64) {
          packed = u64(p);
          p += 8;
        }
        if (local === ZIP64) local = u64(p);
        break;
      }
    }
    const next = at + 46 + nameLength + extraLength + u16(at + 32);
    if (wanted(name)) {
      if (flags & 1) throw new Error("the file is encrypted (password-protected)");
      if (declared > left) throw tooLarge(maxBytes);
      if (u32(local) !== LOCAL) throw new Error("invalid zip data");
      const start = local + 30 + u16(local + 26) + u16(local + 28);
      check(start, packed);
      const data = bytes.subarray(start, start + packed);
      let part: Uint8Array;
      if (method === 0) part = data.slice();
      else if (method === 8) part = inflateWithin(data, left, maxBytes);
      else throw new Error(`unknown compression type ${method}`);
      if (part.length > left) throw tooLarge(maxBytes);
      left -= part.length;
      parts[name] = part;
    }
    at = next;
  }
  return parts;
}

function tooLarge(maxBytes: number) {
  return new TooLargeError(`the file unpacks to more than ${maxBytes} bytes; files over ${maxBytes} bytes are stored but not parsed`);
}

/** Inflate raw DEFLATE data a step at a time, stopping as soon as the output passes `limit`. */
function inflateWithin(data: Uint8Array, limit: number, maxBytes: number): Uint8Array {
  const chunks: Uint8Array[] = [];
  let size = 0;
  const inflater = new Inflate((chunk) => {
    size += chunk.length;
    if (size > limit) throw tooLarge(maxBytes);
    chunks.push(chunk);
  });
  if (!data.length) inflater.push(data, true);
  for (let i = 0; i < data.length; i += STEP) inflater.push(data.subarray(i, i + STEP), i + STEP >= data.length);
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}
