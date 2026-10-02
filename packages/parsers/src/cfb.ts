/**
 * A reader for the compound file format (OLE2, [MS-CFB]) that Word 97-2003, Excel 97-2003 and other
 * legacy Office files are stored in: a small file system of sectors with a FAT, a directory and a
 * mini stream for short streams. It reads only the streams at the root, which is where a Word
 * document keeps its text; embedded objects live in sub-storages and are never opened.
 *
 * Every chain is bounded by the file: a sector outside the file, a chain that loops back on
 * itself, or a stream larger than the file is an error, so a hostile file cannot make the reader
 * spin or allocate without limit.
 */

export const CFB_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

const END_OF_CHAIN = 0xfffffffe;
const FREE_SECTOR = 0xffffffff;
const NO_STREAM = 0xffffffff;
const HEADER_DIFAT_ENTRIES = 109;
const DIR_ENTRY_BYTES = 128;
const TYPE_STREAM = 2;
const TYPE_ROOT = 5;

interface DirEntry {
  name: string;
  type: number;
  left: number;
  right: number;
  child: number;
  start: number;
  size: number;
}

export function isCompoundFile(bytes: Uint8Array): boolean {
  return bytes.length >= 512 && CFB_SIGNATURE.every((b, i) => bytes[i] === b);
}

/** The streams at the root of a compound file, read on demand by name (case-insensitive, as in the format). */
export interface CompoundFile {
  stream(name: string): Uint8Array | undefined;
}

export function readCompoundFile(bytes: Uint8Array): CompoundFile {
  if (!isCompoundFile(bytes)) throw new Error("not a compound file: the OLE2 signature is missing");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u32 = (offset: number) => {
    if (offset < 0 || offset + 4 > bytes.length) throw new Error("the compound file is truncated");
    return view.getUint32(offset, true);
  };
  if (view.getUint16(0x1c, true) !== 0xfffe) throw new Error("the compound file has an unknown byte order");
  const sectorShift = view.getUint16(0x1e, true);
  const miniShift = view.getUint16(0x20, true);
  if (sectorShift !== 9 && sectorShift !== 12) throw new Error("the compound file has an unsupported sector size");
  if (miniShift !== 6) throw new Error("the compound file has an unsupported mini sector size");
  const sectorSize = 1 << sectorShift;
  const miniSize = 1 << miniShift;
  const sectorCount = Math.ceil(bytes.length / sectorSize) - 1;
  const sectorOffset = (n: number) => {
    if (n >= sectorCount) throw new Error("the compound file points to a sector outside the file");
    return (n + 1) * sectorSize;
  };
  const sector = (n: number) => {
    const at = sectorOffset(n);
    return bytes.subarray(at, Math.min(at + sectorSize, bytes.length));
  };

  // The FAT's own sectors: 109 listed in the header, the rest in a chain of DIFAT sectors.
  const fatSectorCount = u32(0x2c);
  if (fatSectorCount > sectorCount) throw new Error("the compound file declares more FAT sectors than it has");
  const fatSectors: number[] = [];
  for (let i = 0; i < HEADER_DIFAT_ENTRIES && fatSectors.length < fatSectorCount; i++) fatSectors.push(u32(0x4c + i * 4));
  const perDifat = sectorSize / 4 - 1;
  const seenDifat = new Set<number>();
  for (let next = u32(0x44); fatSectors.length < fatSectorCount && next !== END_OF_CHAIN && next !== FREE_SECTOR; ) {
    if (seenDifat.has(next)) throw new Error("the compound file's DIFAT chain loops");
    seenDifat.add(next);
    const at = sectorOffset(next);
    for (let i = 0; i < perDifat && fatSectors.length < fatSectorCount; i++) fatSectors.push(u32(at + i * 4));
    next = u32(at + perDifat * 4);
  }
  const fat: number[] = [];
  for (const s of fatSectors) {
    const at = sectorOffset(s);
    for (let i = 0; i < sectorSize / 4; i++) fat.push(u32(at + i * 4));
  }

  /** The sectors of a chain from `start`, refusing loops and sectors outside the table. */
  const chain = (start: number, table: number[], limit: number): number[] => {
    const out: number[] = [];
    const seen = new Set<number>();
    for (let n = start; n !== END_OF_CHAIN; n = table[n]!) {
      if (n >= table.length || n === FREE_SECTOR) throw new Error("the compound file has a broken sector chain");
      if (seen.has(n) || out.length >= limit) throw new Error("the compound file has a sector chain that loops");
      seen.add(n);
      out.push(n);
    }
    return out;
  };
  const readChain = (start: number, size: number): Uint8Array => {
    const sectors = chain(start, fat, sectorCount);
    const out = new Uint8Array(Math.min(size, sectors.length * sectorSize));
    sectors.forEach((s, i) => {
      const at = i * sectorSize;
      if (at < out.length) out.set(sector(s).subarray(0, out.length - at), at);
    });
    if (out.length < size) throw new Error("a stream of the compound file is shorter than its declared size");
    return out;
  };

  const dirSectors = chain(u32(0x30), fat, sectorCount);
  const dirBytes = new Uint8Array(dirSectors.length * sectorSize);
  dirSectors.forEach((s, i) => dirBytes.set(sector(s), i * sectorSize));
  const entries: DirEntry[] = [];
  const dir = new DataView(dirBytes.buffer, dirBytes.byteOffset, dirBytes.byteLength);
  for (let at = 0; at + DIR_ENTRY_BYTES <= dirBytes.length; at += DIR_ENTRY_BYTES) {
    const nameBytes = Math.min(dir.getUint16(at + 0x40, true), 64);
    let name = "";
    for (let i = 0; i + 1 < nameBytes - 1; i += 2) name += String.fromCharCode(dir.getUint16(at + i, true));
    entries.push({
      name,
      type: dirBytes[at + 0x42]!,
      left: dir.getUint32(at + 0x44, true),
      right: dir.getUint32(at + 0x48, true),
      child: dir.getUint32(at + 0x4c, true),
      start: dir.getUint32(at + 0x74, true),
      // The high half of the size is reserved in version 3 files; a stream larger than the file is refused below.
      size: dir.getUint32(at + 0x78, true),
    });
  }
  const root = entries[0];
  if (!root || root.type !== TYPE_ROOT) throw new Error("the compound file has no root directory entry");

  // The root's children form a tree through their left and right siblings.
  const children = new Map<string, DirEntry>();
  const stack = [root.child];
  const visited = new Set<number>();
  while (stack.length) {
    const id = stack.pop()!;
    if (id === NO_STREAM || id >= entries.length || visited.has(id)) continue;
    visited.add(id);
    const e = entries[id]!;
    if (e.type === TYPE_STREAM) children.set(e.name.toLowerCase(), e);
    stack.push(e.left, e.right);
  }

  const cutoff = u32(0x38);
  let mini: { fat: number[]; stream: Uint8Array } | undefined;
  const miniStream = () => {
    if (mini) return mini;
    if (root.size > bytes.length) throw new Error("the compound file's mini stream is larger than the file");
    const miniFat: number[] = [];
    const first = u32(0x3c);
    if (first !== END_OF_CHAIN && first !== FREE_SECTOR) {
      for (const s of chain(first, fat, sectorCount)) {
        const at = sectorOffset(s);
        for (let i = 0; i < sectorSize / 4; i++) miniFat.push(u32(at + i * 4));
      }
    }
    mini = { fat: miniFat, stream: root.start === END_OF_CHAIN ? new Uint8Array(0) : readChain(root.start, root.size) };
    return mini;
  };

  return {
    stream(name) {
      const e = children.get(name.toLowerCase());
      if (!e) return undefined;
      if (e.size > bytes.length) throw new Error(`the ${e.name} stream is larger than the file`);
      if (e.size === 0) return new Uint8Array(0);
      if (e.size >= cutoff) return readChain(e.start, e.size);
      const m = miniStream();
      const sectors = chain(e.start, m.fat, Math.ceil(m.stream.length / miniSize));
      const out = new Uint8Array(e.size);
      sectors.forEach((s, i) => {
        const at = i * miniSize;
        if (at >= out.length) return;
        const from = s * miniSize;
        const take = Math.min(miniSize, out.length - at);
        if (from + take > m.stream.length) throw new Error("the compound file points outside its mini stream");
        out.set(m.stream.subarray(from, from + take), at);
      });
      if (sectors.length * miniSize < e.size) throw new Error(`the ${e.name} stream is shorter than its declared size`);
      return out;
    },
  };
}
