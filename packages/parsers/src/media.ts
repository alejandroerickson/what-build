/**
 * The playing time of a recording, read from its container headers without decoding any audio:
 * MP4, M4A and MOV (the `mvhd` box), WAV (the data chunk over the byte rate), FLAC (STREAMINFO)
 * and MP3 (a Xing, Info or VBRI frame count, else the constant bitrate). Other containers, and any
 * file whose headers do not add up, give null.
 *
 * It reads through `read(start, end)` (end exclusive) rather than taking the whole file, so a
 * caller can serve ranges of a recording too large to download. It does no I/O itself.
 */
export type ByteReader = (start: number, end: number) => Promise<Uint8Array>;

/** A reader over bytes already in memory. */
export const bytesReader = (bytes: Uint8Array): ByteReader => async (start, end) => bytes.subarray(start, Math.min(end, bytes.byteLength));

const ascii = (b: Uint8Array, at: number, n: number) => String.fromCharCode(...b.subarray(at, at + n));
const u16le = (b: Uint8Array, at: number) => b[at]! | (b[at + 1]! << 8);
const u32le = (b: Uint8Array, at: number) => (b[at]! | (b[at + 1]! << 8) | (b[at + 2]! << 16)) + b[at + 3]! * 0x1000000;
const u32be = (b: Uint8Array, at: number) => b[at]! * 0x1000000 + ((b[at + 1]! << 16) | (b[at + 2]! << 8) | b[at + 3]!);
const u64be = (b: Uint8Array, at: number) => u32be(b, at) * 0x100000000 + u32be(b, at + 4);

/** Duration in whole milliseconds, or null when it cannot be read. Never throws. */
export async function recordingDurationMs(read: ByteReader, size: number): Promise<number | null> {
  try {
    const head = await read(0, Math.min(size, 64));
    if (head.byteLength < 12) return null;
    let seconds: number | null = null;
    if (ascii(head, 0, 4) === "RIFF" && ascii(head, 8, 4) === "WAVE") seconds = await wavSeconds(read, size);
    else if (ascii(head, 0, 4) === "fLaC") seconds = flacSeconds(head);
    else if (MP4_TOP.has(ascii(head, 4, 4))) seconds = await mp4Seconds(read, size);
    else seconds = await mp3Seconds(read, size, head);
    return seconds !== null && Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds * 1000) : null;
  } catch {
    return null;
  }
}

// ---- MP4, M4A, MOV --------------------------------------------------------------------------------

const MP4_TOP = new Set(["ftyp", "moov", "mdat", "free", "skip", "wide", "pnot"]);

/** Walk the top-level boxes to `moov` (often after `mdat` when the file is not fast-start), then read `mvhd`. */
async function mp4Seconds(read: ByteReader, size: number): Promise<number | null> {
  const moov = await findBox(read, 0, size, "moov");
  if (!moov) return null;
  const mvhd = await findBox(read, moov.body, moov.end, "mvhd");
  if (!mvhd) return null;
  const b = await read(mvhd.body, Math.min(mvhd.end, mvhd.body + 32));
  if (b[0] === 1) {
    if (b.byteLength < 32) return null;
    const timescale = u32be(b, 20);
    const duration = u64be(b, 24);
    return timescale && duration !== 2 ** 64 - 1 ? duration / timescale : null;
  }
  if (b.byteLength < 20) return null;
  const timescale = u32be(b, 12);
  const duration = u32be(b, 16);
  return timescale && duration !== 0xffffffff ? duration / timescale : null;
}

async function findBox(read: ByteReader, start: number, end: number, type: string): Promise<{ body: number; end: number } | null> {
  let at = start;
  for (let i = 0; i < 256 && at + 8 <= end; i++) {
    const h = await read(at, Math.min(end, at + 16));
    if (h.byteLength < 8) return null;
    let boxSize = u32be(h, 0);
    let header = 8;
    if (boxSize === 1) {
      if (h.byteLength < 16) return null;
      boxSize = u64be(h, 8);
      header = 16;
    } else if (boxSize === 0) boxSize = end - at;
    if (boxSize < header || !/^[\x20-\x7e]{4}$/.test(ascii(h, 4, 4))) return null;
    if (ascii(h, 4, 4) === type) return { body: at + header, end: Math.min(end, at + boxSize) };
    at += boxSize;
  }
  return null;
}

// ---- WAV --------------------------------------------------------------------------------------------

async function wavSeconds(read: ByteReader, size: number): Promise<number | null> {
  let at = 12;
  let byteRate = 0;
  for (let i = 0; i < 64 && at + 8 <= size; i++) {
    const h = await read(at, Math.min(size, at + 24));
    if (h.byteLength < 8) return null;
    const id = ascii(h, 0, 4);
    const chunkSize = u32le(h, 4);
    if (id === "fmt " && h.byteLength >= 20) byteRate = u32le(h, 16);
    if (id === "data") {
      if (!byteRate) return null;
      const available = size - (at + 8);
      return Math.min(chunkSize, available) / byteRate;
    }
    at += 8 + chunkSize + (chunkSize % 2);
  }
  return null;
}

// ---- FLAC -------------------------------------------------------------------------------------------

function flacSeconds(head: Uint8Array): number | null {
  // "fLaC", a 4-byte block header, then STREAMINFO: sample rate (20 bits) at byte 18, total samples (36 bits) after.
  if (head.byteLength < 26 || (head[4]! & 0x7f) !== 0) return null;
  const rate = (head[18]! << 12) | (head[19]! << 4) | (head[20]! >> 4);
  const samples = (head[21]! & 0x0f) * 2 ** 32 + u32be(head, 22);
  return rate && samples ? samples / rate : null;
}

// ---- MP3 --------------------------------------------------------------------------------------------

const MP3_BITRATES_V1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const MP3_BITRATES_V2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
const MP3_RATES: Record<number, number[]> = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };

/** An MPEG audio Layer III frame header at `at`, or null. */
function mp3Frame(b: Uint8Array, at: number) {
  if (at + 4 > b.byteLength || b[at] !== 0xff || (b[at + 1]! & 0xe0) !== 0xe0) return null;
  const version = (b[at + 1]! >> 3) & 3;
  const layer = (b[at + 1]! >> 1) & 3;
  const bitrateIndex = b[at + 2]! >> 4;
  const rateIndex = (b[at + 2]! >> 2) & 3;
  if (version === 1 || layer !== 1 || bitrateIndex === 0 || bitrateIndex === 15 || rateIndex === 3) return null;
  const v1 = version === 3;
  const bitrate = (v1 ? MP3_BITRATES_V1 : MP3_BITRATES_V2)[bitrateIndex]! * 1000;
  const sampleRate = MP3_RATES[version]![rateIndex]!;
  const padding = (b[at + 2]! >> 1) & 1;
  const mono = b[at + 3]! >> 6 === 3;
  return {
    bitrate,
    sampleRate,
    samplesPerFrame: v1 ? 1152 : 576,
    length: Math.floor(((v1 ? 144 : 72) * bitrate) / sampleRate) + padding,
    sideInfo: v1 ? (mono ? 17 : 32) : mono ? 9 : 17,
  };
}

async function mp3Seconds(read: ByteReader, size: number, head: Uint8Array): Promise<number | null> {
  let start = 0;
  if (ascii(head, 0, 3) === "ID3") {
    const tagSize = ((head[6]! & 0x7f) << 21) | ((head[7]! & 0x7f) << 14) | ((head[8]! & 0x7f) << 7) | (head[9]! & 0x7f);
    start = 10 + tagSize + (head[5]! & 0x10 ? 10 : 0);
  }
  const b = await read(start, Math.min(size, start + 16384));
  for (let i = 0; i + 4 <= b.byteLength; i++) {
    const f = mp3Frame(b, i);
    // A real frame is followed by another; this skips stray 0xFF bytes.
    if (!f || (i + f.length + 4 <= b.byteLength && !mp3Frame(b, i + f.length))) continue;
    const xing = i + 4 + f.sideInfo;
    const tag = ascii(b, xing, 4);
    if ((tag === "Xing" || tag === "Info") && xing + 12 <= b.byteLength && u32be(b, xing + 4) & 1) {
      return (u32be(b, xing + 8) * f.samplesPerFrame) / f.sampleRate;
    }
    if (ascii(b, i + 36, 4) === "VBRI" && i + 54 <= b.byteLength) return (u32be(b, i + 50) * f.samplesPerFrame) / f.sampleRate;
    return ((size - (start + i)) * 8) / f.bitrate;
  }
  return null;
}
