/**
 * Word binary fixtures assembled byte by byte from the published formats ([MS-CFB], [MS-DOC]), so
 * the tests need no sample files: a compound file holding a WordDocument stream (and, for Word 97,
 * a table stream) with a piece table, a style sheet and paragraph property pages.
 */

const SECTOR = 512;
const MINI = 64;
const END = 0xfffffffe;
const FREE = 0xffffffff;
const FAT_SECT = 0xfffffffd;

/**
 * A version 3 compound file with the given streams at its root: 512-byte sectors, one FAT sector,
 * and streams under 4096 bytes in the mini stream, as Office writes them. `loopFat` points the
 * first big stream's first sector at itself, a chain that never ends.
 */
export function makeCompoundFile(streams: Record<string, Uint8Array>, options: { loopFat?: boolean } = {}): Uint8Array {
  const names = Object.keys(streams);
  const count = (size: number, unit: number) => Math.max(1, Math.ceil(size / unit));

  // The mini stream: each small stream in whole 64-byte mini sectors, chained in the mini FAT.
  const miniFat: number[] = [];
  const miniStart = new Map<string, number>();
  let miniStream = new Uint8Array(0);
  for (const n of names.filter((n) => streams[n]!.length < 4096)) {
    const k = count(streams[n]!.length, MINI);
    miniStart.set(n, miniFat.length);
    for (let i = 0; i < k; i++) miniFat.push(i === k - 1 ? END : miniFat.length + 1);
    const grown = new Uint8Array(miniStream.length + k * MINI);
    grown.set(miniStream);
    grown.set(streams[n]!, miniStream.length);
    miniStream = grown;
  }
  const miniFatBytes = new Uint8Array(count(miniFat.length * 4, SECTOR) * SECTOR).fill(0xff);
  miniFat.forEach((v, i) => new DataView(miniFatBytes.buffer).setUint32(i * 4, v, true));

  // Sector 0 is the FAT; then the directory, the mini FAT, the mini stream and each big stream.
  const dirBytes = new Uint8Array(count((names.length + 1) * 128, SECTOR) * SECTOR);
  const parts: [string, Uint8Array][] = [
    ["#dir", dirBytes],
    ["#minifat", miniFatBytes],
    ["#mini", miniStream],
    ...names.filter((n) => streams[n]!.length >= 4096).map((n): [string, Uint8Array] => [n, streams[n]!]),
  ];
  const fat: number[] = [FAT_SECT];
  const start = new Map<string, number>();
  for (const [name, bytes] of parts) {
    const k = count(bytes.length, SECTOR);
    start.set(name, fat.length);
    for (let i = 0; i < k; i++) fat.push(i === k - 1 ? END : fat.length + 1);
  }
  if (fat.length > SECTOR / 4) throw new Error("the fixture is too large for one FAT sector");
  const firstBig = parts[3]?.[0];
  if (options.loopFat && firstBig) fat[start.get(firstBig)!] = start.get(firstBig)!;

  // Directory: the root (which holds the mini stream), then each stream, chained as right siblings.
  const dir = new DataView(dirBytes.buffer);
  for (let i = 0; i < dirBytes.length / 128; i++) for (const o of [0x44, 0x48, 0x4c]) dir.setUint32(i * 128 + o, FREE, true);
  const entry = (i: number, name: string, type: number, right: number, child: number, first: number, size: number) => {
    const at = i * 128;
    for (let k = 0; k < name.length; k++) dir.setUint16(at + k * 2, name.charCodeAt(k), true);
    dir.setUint16(at + 0x40, (name.length + 1) * 2, true);
    dirBytes[at + 0x42] = type;
    dir.setUint32(at + 0x48, right, true);
    dir.setUint32(at + 0x4c, child, true);
    dir.setUint32(at + 0x74, first, true);
    dir.setUint32(at + 0x78, size, true);
  };
  entry(0, "Root Entry", 5, FREE, names.length ? 1 : FREE, start.get("#mini")!, miniStream.length);
  names.forEach((n, i) => {
    const first = streams[n]!.length >= 4096 ? start.get(n)! : miniStart.get(n)!;
    entry(i + 1, n, 2, i + 1 < names.length ? i + 2 : FREE, FREE, first, streams[n]!.length);
  });

  const out = new Uint8Array(SECTOR + (fat.length) * SECTOR);
  const view = new DataView(out.buffer);
  out.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  view.setUint16(0x18, 0x3e, true);
  view.setUint16(0x1a, 3, true);
  view.setUint16(0x1c, 0xfffe, true);
  view.setUint16(0x1e, 9, true);
  view.setUint16(0x20, 6, true);
  view.setUint32(0x2c, 1, true);
  view.setUint32(0x30, start.get("#dir")!, true);
  view.setUint32(0x38, 4096, true);
  view.setUint32(0x3c, start.get("#minifat")!, true);
  view.setUint32(0x40, 1, true);
  view.setUint32(0x44, END, true);
  for (let i = 0; i < 109; i++) view.setUint32(0x4c + i * 4, i === 0 ? 0 : FREE, true);
  const sectorAt = (n: number) => SECTOR + n * SECTOR;
  for (let i = 0; i < SECTOR / 4; i++) view.setUint32(sectorAt(0) + i * 4, i < fat.length ? fat[i]! : FREE, true);
  for (const [name, bytes] of parts) out.set(bytes, sectorAt(start.get(name)!));
  return out;
}

/** One paragraph's properties in a Word binary fixture: its style index and table flags. */
export interface WordParagraph {
  istd?: number;
  inTable?: boolean;
  rowEnd?: boolean;
}

export interface WordDocOptions {
  /** Word 6.0 instead of Word 97: one stream, one run of 8-bit text, 2-byte page numbers, 7-byte BX entries. */
  word6?: boolean;
  /** Properties of each paragraph or cell mark, in order. Without them the file has no property pages. */
  paragraphs?: WordParagraph[];
  /** The built-in style id (sti) of each style index, written as the style sheet. */
  styles?: number[];
  /** Text after the main story (footnotes, headers), outside `ccpText`. */
  tail?: string;
  encrypted?: boolean;
  fastSaved?: boolean;
  nFib?: number;
  // Overrides for hostile-file tests.
  ccpText?: number;
  cps?: number[];
  fcShift?: number;
}

const CP1252_HIGH = [
  0x20ac, 0x81, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0x8d, 0x017d, 0x8f,
  0x90, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x9d, 0x017e, 0x0178,
];

function encode(text: string, compressed: boolean): Uint8Array {
  if (!compressed) {
    const b = new Uint8Array(text.length * 2);
    const v = new DataView(b.buffer);
    for (let i = 0; i < text.length; i++) v.setUint16(i * 2, text.charCodeAt(i), true);
    return b;
  }
  return Uint8Array.from(text, (ch) => {
    const c = ch.charCodeAt(0);
    const b = c < 0x80 || (c >= 0xa0 && c <= 0xff) ? c : 0x80 + CP1252_HIGH.indexOf(c);
    if (b < 0x80 && c >= 0x80) throw new Error(`not Windows-1252: ${ch}`);
    return b;
  });
}

const u16 = (v: number) => [v & 0xff, (v >> 8) & 0xff];
const u32 = (v: number) => [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff];

/**
 * A Word binary document whose text is the given pieces, each 8-bit Windows-1252 (`true`) or
 * UTF-16 (`false`). The marks are Word's: `\r` ends a paragraph, `\x07` a cell or a row, and
 * `\x13`, `\x14`, `\x15` begin, separate and end a field.
 */
export function makeWordDoc(pieces: [text: string, compressed: boolean][], o: WordDocOptions = {}): Uint8Array {
  const word6 = Boolean(o.word6);
  const TEXT_AT = 0x800;
  const all: [string, boolean][] = o.tail ? [...pieces, [o.tail, true]] : pieces;
  if (word6 && all.some(([, compressed]) => !compressed)) throw new Error("Word 6 text is 8-bit");

  // The text, piece by piece, and the stream offset just past each paragraph or cell mark.
  const text: number[] = [];
  const pieceStarts: { fc: number; cp: number; compressed: boolean }[] = [];
  const markEnds: number[] = [];
  let cp = 0;
  for (const [t, compressed] of all) {
    const fc = TEXT_AT + text.length;
    pieceStarts.push({ fc, cp, compressed });
    const width = compressed ? 1 : 2;
    for (let i = 0; i < t.length; i++) if (t[i] === "\r" || t[i] === "\x07") markEnds.push(fc + (i + 1) * width);
    text.push(...encode(t, compressed));
    cp += t.length;
  }
  const mainLength = pieces.reduce((n, [t]) => n + t.length, 0);
  const textEnd = TEXT_AT + text.length;

  // One paragraph property page (PapxFkp) at the next 512-byte boundary after the text.
  const fkpAt = Math.ceil(textEnd / 512) * 512;
  const fkp = new Uint8Array(512);
  const paras = o.paragraphs;
  if (paras) {
    if (paras.length !== markEnds.length) throw new Error(`${paras.length} paragraph properties for ${markEnds.length} marks`);
    const fkpView = new DataView(fkp.buffer);
    const bx = word6 ? 7 : 13;
    fkp[511] = paras.length;
    fkpView.setUint32(0, TEXT_AT, true);
    markEnds.forEach((end, i) => fkpView.setUint32((i + 1) * 4, end, true));
    let free = 510;
    paras.forEach((p, i) => {
      const body = [...u16(p.istd ?? 0)];
      if (!word6 && p.inTable) body.push(...u16(0x2416), 1);
      if (!word6 && p.rowEnd) body.push(...u16(0x2417), 1);
      let papx: number[];
      if (word6) {
        if (body.length % 2) body.push(0);
        papx = [body.length / 2, ...body];
      } else papx = body.length % 2 ? [(body.length + 1) / 2, ...body] : [0, body.length / 2, ...body];
      free -= papx.length;
      free -= free % 2;
      fkp.set(papx, free);
      fkp[(paras.length + 1) * 4 + i * bx] = free / 2;
    });
  }

  // Style sheet, bin table and CLX: in the table stream (Word 97) or after the page (Word 6).
  const table: number[] = [];
  const base = word6 ? fkpAt + 512 : 0;
  const stshAt = base + table.length;
  if (o.styles) {
    const stdBase = word6 ? 4 : 10;
    table.push(...u16(4), ...u16(o.styles.length), ...u16(stdBase));
    for (const sti of o.styles) table.push(...u16(stdBase), ...u16(sti), ...new Array(stdBase - 2).fill(0));
  }
  const stshLcb = base + table.length - stshAt;
  const papxAt = base + table.length;
  if (paras) table.push(...u32(TEXT_AT), ...u32(markEnds.at(-1)!), ...(word6 ? u16(fkpAt / 512) : u32(fkpAt / 512)));
  const papxLcb = base + table.length - papxAt;
  const clxAt = base + table.length;
  if (!word6) {
    const cps = o.cps ?? [...pieceStarts.map((p) => p.cp), cp];
    const shift = o.fcShift ?? 0;
    const pcds = pieceStarts.flatMap((p) => [...u16(0), ...u32(p.compressed ? ((p.fc + shift) * 2) | 0x40000000 : p.fc + shift), ...u16(0)]);
    const plc = [...cps.flatMap(u32), ...pcds];
    table.push(0x01, ...u16(2), 0x00, 0x00); // a property modifier (Prc) before the piece table
    table.push(0x02, ...u32(plc.length), ...plc);
  }
  const clxLcb = base + table.length - clxAt;

  const word = new Uint8Array(Math.max(4096, word6 ? base + table.length : fkpAt + 512));
  const view = new DataView(word.buffer);
  word.set(text, TEXT_AT);
  if (paras) word.set(fkp, fkpAt);
  const flags = (o.encrypted ? 0x0100 : 0) | (o.fastSaved ? 0x0004 : 0);
  const ccpText = o.ccpText ?? mainLength;
  const pair = (rgFcLcb: number, index: number, fc: number, lcb: number) => {
    view.setUint32(rgFcLcb + index * 8, fc, true);
    view.setUint32(rgFcLcb + index * 8 + 4, lcb, true);
  };
  if (word6) {
    view.setUint16(0, 0xa5dc, true);
    view.setUint16(2, o.nFib ?? 0x65, true);
    view.setUint16(0x0a, flags, true);
    view.setUint32(0x18, TEXT_AT, true);
    view.setUint32(0x1c, textEnd, true);
    view.setInt32(0x34, ccpText, true);
    pair(0x58, 1, stshAt, stshLcb);
    pair(0x58, 13, papxAt, papxLcb);
    word.set(table, base);
    return makeCompoundFile({ WordDocument: word });
  }
  view.setUint16(0, 0xa5ec, true);
  view.setUint16(2, o.nFib ?? 0xc1, true);
  view.setUint16(0x0a, flags | 0x0200, true); // the table stream is 1Table
  view.setUint16(0x20, 14, true); // csw
  view.setUint16(0x3e, 22, true); // cslw
  view.setInt32(0x4c, ccpText, true);
  view.setUint16(0x98, 93, true); // cbRgFcLcb
  pair(0x9a, 1, stshAt, stshLcb);
  pair(0x9a, 13, papxAt, papxLcb);
  pair(0x9a, 33, clxAt, clxLcb);
  return makeCompoundFile({ WordDocument: word, "1Table": Uint8Array.from(table) });
}
