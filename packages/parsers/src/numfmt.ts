/**
 * Excel number formats (ECMA-376 Part 1, 18.8.30 and 18.8.31): a cell's value as the sheet shows
 * it. A format is read once into sections of tokens, then applied to every cell that has it, in
 * time linear in the format and the value.
 */

/** Excel takes format codes of at most 255 characters; a longer one is read as General. */
export const MAX_FORMAT_CHARS = 255;

/** Decimal places past this are shown as zeros: a number holds 15 significant digits, no more. */
const MAX_PLACES = 30;

type Token =
  | { k: "lit"; s: string }
  | { k: "digit"; c: "0" | "#" | "?" }
  | { k: "point" }
  | { k: "comma" }
  | { k: "percent" }
  | { k: "exp"; s: string }
  | { k: "slash" }
  /** A fraction's fixed denominator: the 8 of `# ?/8`. */
  | { k: "denom"; n: number }
  | { k: "text" }
  | { k: "general" }
  /** A run of one date or time letter, lower-cased: "yyyy", "mm", "d", "ss". */
  | { k: "date"; c: string }
  | { k: "elapsed"; c: "h" | "m" | "s"; n: number }
  | { k: "ampm"; s: string }
  /** Tenths, hundredths or thousandths of a second, after the seconds: `.0`, `.00`, `.000`. */
  | { k: "subsec"; n: number };

interface Section {
  tokens: Token[];
  /** A colour such as [Red]: shown here only by the sign it stands for. */
  color: boolean;
  cond: { op: string; value: number } | null;
  date: boolean;
  text: boolean;
  /** Whether the section writes a sign of its own: a `-` or a `(`. */
  signed: boolean;
  /** How it shows a number or a date, worked out once, the first time a cell needs it. */
  plan?: NumberPlan;
  datePlan?: DatePlan;
}

interface DatePlan {
  /** Which `m` and `mm` runs are minutes. */
  minute: boolean[];
  /** Digits of a second shown: 0 to 3. */
  sub: number;
  /** Whether it shows a year, month or day, as well as or instead of a time. */
  day: boolean;
  /** Where its time is: the first and last token of the time it shows, or null for a date alone. */
  time: [first: number, last: number] | null;
  /** Whether hours count to 12, with AM and PM. */
  twelve: boolean;
}

/** Where a number section's digits go: worked out once per section, then applied to each cell. */
interface NumberPlan {
  general: boolean;
  /** No digit places at all: the section is words. */
  words: boolean;
  /** The slash of a fraction, or -1. */
  slash: number;
  exp: number;
  point: number;
  intSlots: number[];
  fracSlots: number[];
  expSlots: number[];
  grouping: boolean;
  /** Commas that divide by a thousand each. */
  scale: number;
  /** The commas that group or scale, and so show nothing themselves. */
  silent: Set<number>;
  percent: number;
  /** Zeros among the integer places, which a grouped number is padded to. */
  intZeros: number;
  expZeros: number;
  /** The exponent's step: 1, or the integer places in engineering notation (##0.0E+0). */
  step: number;
}

/** A format read into its sections; `iso` marks the formats whose look is the reader's locale's. */
export interface NumberFormat {
  sections: Section[];
  iso?: "date" | "datetime" | "time";
}

const COLORS = /^(?:black|blue|cyan|green|magenta|red|white|yellow|color\s*\d{1,2})$/i;
const CONDITION = /^(<=|>=|<>|<|>|=)\s*(-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)$/i;
const ELAPSED = /^(h+|m+|s+)$/i;

/** The length in UTF-16 units of the code point at `i`, or 0 past the end. */
const unitsAt = (s: string, i: number) => (i >= s.length ? 0 : s.codePointAt(i)! > 0xffff ? 2 : 1);

/** One section of a format code, as tokens. */
function readSection(code: string): Section {
  const tokens: Token[] = [];
  let color = false;
  let cond: Section["cond"] = null;
  const lit = (s: string) => {
    const last = tokens[tokens.length - 1];
    if (last?.k === "lit") last.s += s;
    else if (s) tokens.push({ k: "lit", s });
  };
  for (let i = 0; i < code.length; ) {
    const c = code[i]!;
    if (c === '"') {
      const end = code.indexOf('"', i + 1);
      lit(end < 0 ? code.slice(i + 1) : code.slice(i + 1, end));
      i = end < 0 ? code.length : end + 1;
    } else if (c === "\\") {
      lit(code.slice(i + 1, i + 1 + unitsAt(code, i + 1)));
      i += 1 + unitsAt(code, i + 1);
    } else if (c === "_" || c === "*") {
      // `_x` leaves the width of x, a space here; `*x` fills the cell with x, nothing here.
      if (c === "_") lit(" ");
      i += 1 + unitsAt(code, i + 1);
    } else if (c === "[") {
      const end = code.indexOf("]", i + 1);
      if (end < 0) {
        lit(code.slice(i));
        break;
      }
      const inner = code.slice(i + 1, end).trim();
      i = end + 1;
      const m = CONDITION.exec(inner);
      if (COLORS.test(inner)) color = true;
      else if (m) cond = { op: m[1]!, value: Number(m[2]) };
      else if (ELAPSED.test(inner)) tokens.push({ k: "elapsed", c: inner[0]!.toLowerCase() as "h" | "m" | "s", n: inner.length });
      else if (inner.startsWith("$")) {
        // [$€-407]: a currency symbol, then the locale; [$-409] names only the locale.
        const dash = inner.indexOf("-");
        lit(inner.slice(1, dash < 0 ? undefined : dash));
      }
      // Anything else in brackets (a numeral system, a calendar) changes nothing shown here.
    } else if (c === "@") {
      tokens.push({ k: "text" });
      i++;
    } else if (c === "0" || c === "#" || c === "?") {
      tokens.push({ k: "digit", c });
      i++;
    } else if (c === ".") {
      // After seconds, `.00` is the fraction of a second; anywhere else it is the decimal point.
      const prev = lastNonLiteral(tokens);
      if (code[i + 1] === "0" && prev && ((prev.k === "date" && prev.c[0] === "s") || (prev.k === "elapsed" && prev.c === "s"))) {
        let j = i + 1;
        while (j < code.length && code[j] === "0") j++;
        tokens.push({ k: "subsec", n: Math.min(j - i - 1, 3) });
        i = j;
      } else {
        tokens.push({ k: "point" });
        i++;
      }
    } else if (c === ",") {
      tokens.push({ k: "comma" });
      i++;
    } else if (c === "%") {
      tokens.push({ k: "percent" });
      i++;
    } else if ((c === "E" || c === "e") && (code[i + 1] === "+" || code[i + 1] === "-")) {
      tokens.push({ k: "exp", s: code.slice(i, i + 2) });
      i += 2;
    } else if (c === "/") {
      tokens.push({ k: "slash" });
      i++;
      let j = i;
      while (j < code.length && code[j]! >= "0" && code[j]! <= "9") j++;
      if (j > i && code[i] !== "0") {
        tokens.push({ k: "denom", n: Number(code.slice(i, j)) });
        i = j;
      }
    } else if ((c === "G" || c === "g") && code.slice(i, i + 7).toLowerCase() === "general") {
      tokens.push({ k: "general" });
      i += 7;
    } else if ((c === "A" || c === "a") && code.slice(i, i + 5).toUpperCase() === "AM/PM") {
      tokens.push({ k: "ampm", s: code.slice(i, i + 5) });
      i += 5;
    } else if ((c === "A" || c === "a") && code.slice(i, i + 3).toUpperCase() === "A/P") {
      tokens.push({ k: "ampm", s: code.slice(i, i + 3) });
      i += 3;
    } else if ("yYmMdDhHsS".includes(c)) {
      const lower = c.toLowerCase();
      let j = i;
      while (j < code.length && code[j]!.toLowerCase() === lower) j++;
      tokens.push({ k: "date", c: lower.repeat(j - i) });
      i = j;
    } else {
      lit(code.slice(i, i + unitsAt(code, i)));
      i += unitsAt(code, i);
    }
  }
  const date = tokens.some((t) => t.k === "date" || t.k === "elapsed" || t.k === "ampm" || t.k === "subsec");
  return {
    // In a date, whatever is not a part of the date or time is shown as written: `d.m.yyyy`, `dddd, d mmmm`.
    tokens: date ? tokens.map((t) => (t.k === "date" || t.k === "elapsed" || t.k === "ampm" || t.k === "subsec" || t.k === "lit" ? t : { k: "lit", s: asWritten(t) })) : tokens,
    color,
    cond,
    date,
    text: tokens.some((t) => t.k === "text"),
    signed: tokens.some((t) => t.k === "lit" && (t.s.includes("-") || t.s.includes("("))),
  };
}

/** A number token as it was written in the format code. */
function asWritten(t: Token): string {
  switch (t.k) {
    case "digit": return t.c;
    case "point": return ".";
    case "comma": return ",";
    case "percent": return "%";
    case "exp": return t.s;
    case "slash": return "/";
    case "denom": return String(t.n);
    case "text": return "@";
    case "general": return "General";
    default: return "";
  }
}

function lastNonLiteral(tokens: Token[]): Token | undefined {
  for (let i = tokens.length - 1; i >= 0; i--) if (tokens[i]!.k !== "lit") return tokens[i];
  return undefined;
}

/** A format code's sections: split at each `;` outside quotes, brackets and escapes, in one pass. */
function splitSections(code: string): string[] {
  const out: string[] = [];
  let start = 0;
  for (let i = 0; i < code.length && out.length < 3; i++) {
    const c = code[i];
    if (c === '"' || c === "[") {
      const end = code.indexOf(c === '"' ? '"' : "]", i + 1);
      i = end < 0 ? code.length : end;
    } else if (c === "\\" || c === "_" || c === "*") i++;
    else if (c === ";") {
      out.push(code.slice(start, i));
      start = i + 1;
    }
  }
  out.push(code.slice(start));
  return out;
}

/** Read a format code once, for every cell that has it. A code longer than Excel takes reads as General. */
export function readFormat(code: string): NumberFormat {
  if (code.length > MAX_FORMAT_CHARS) return { sections: [readSection("General")] };
  // The system's own long date and time look as the reader's locale says.
  if (/\[\$-F800\]/i.test(code)) return { sections: [], iso: "date" };
  if (/\[\$-F400\]/i.test(code)) return { sections: [], iso: "time" };
  return { sections: splitSections(code).map(readSection) };
}

/**
 * The built-in formats (ECMA-376 Part 1, 18.8.30). The short date (14) and the date and time (22)
 * look as the reader's locale says, which a file does not record, so they read in ISO 8601. Formats
 * 5 to 8, 42 and 44 show the locale's currency symbol, which a file does not record either, so they
 * read without one. Ids the standard leaves to East Asian locales read as General.
 */
const BUILTIN: Record<number, string> = {
  0: "General", 1: "0", 2: "0.00", 3: "#,##0", 4: "#,##0.00",
  5: "#,##0_);(#,##0)", 6: "#,##0_);[Red](#,##0)", 7: "#,##0.00_);(#,##0.00)", 8: "#,##0.00_);[Red](#,##0.00)",
  9: "0%", 10: "0.00%", 11: "0.00E+00", 12: "# ?/?", 13: "# ??/??",
  15: "d-mmm-yy", 16: "d-mmm", 17: "mmm-yy", 18: "h:mm AM/PM", 19: "h:mm:ss AM/PM", 20: "h:mm", 21: "h:mm:ss",
  37: "#,##0 ;(#,##0)", 38: "#,##0 ;[Red](#,##0)", 39: "#,##0.00;(#,##0.00)", 40: "#,##0.00;[Red](#,##0.00)",
  41: '_(* #,##0_);_(* \\(#,##0\\);_(* "-"_);_(@_)', 42: '_(* #,##0_);_(* \\(#,##0\\);_(* "-"_);_(@_)',
  43: '_(* #,##0.00_);_(* \\(#,##0.00\\);_(* "-"??_);_(@_)', 44: '_(* #,##0.00_);_(* \\(#,##0.00\\);_(* "-"??_);_(@_)',
  45: "mm:ss", 46: "[h]:mm:ss", 47: "mm:ss.0", 48: "##0.0E+0", 49: "@",
};

/** The built-in format with this id, or undefined for one the standard does not define. */
export function builtinFormat(id: number): NumberFormat | undefined {
  if (id === 14) return { sections: [], iso: "date" };
  if (id === 22) return { sections: [], iso: "datetime" };
  const code = BUILTIN[id];
  return code === undefined ? undefined : readFormat(code);
}

/** A number as General shows it: an integer whole, any other to 15 significant digits. */
export function generalNumber(n: number): string {
  if (!Number.isFinite(n) || Number.isInteger(n)) return String(n);
  return String(Number(n.toPrecision(15)));
}

function holds(cond: NonNullable<Section["cond"]>, v: number): boolean {
  switch (cond.op) {
    case "<": return v < cond.value;
    case "<=": return v <= cond.value;
    case ">": return v > cond.value;
    case ">=": return v >= cond.value;
    case "=": return v === cond.value;
    default: return v !== cond.value;
  }
}

/**
 * A number cell as its format shows it, or undefined where the format cannot show it (a negative
 * date, a number past its digits, a number in a text format): the cell then reads as General.
 */
export function formatNumber(fmt: NumberFormat, v: number, date1904: boolean): string | undefined {
  if (!Number.isFinite(v)) return undefined;
  if (fmt.iso) return isoDate(v, fmt.iso, date1904);
  // A last section with @ is for text; the sections before it are for numbers.
  const all = fmt.sections;
  const nums = all.length > 1 && all[all.length - 1]!.text ? all.slice(0, -1) : all;
  const [s0, s1, s2] = nums;
  if (!s0) return undefined;
  const negative = v < 0;
  let section: Section;
  // Whether the chosen section is the one for negatives, which shows the value without a sign.
  let forNegatives = false;
  if (s0.cond || s1?.cond) {
    // Sections chosen by condition; the last takes what neither condition does.
    section = s0.cond && holds(s0.cond, v) ? s0 : s1?.cond && holds(s1.cond, v) ? s1 : s0.cond && s1?.cond ? (s2 ?? s1) : (s1 ?? s0);
    forNegatives = negative && section !== s0 && Boolean(section.cond && section.cond.op.startsWith("<") && section.cond.value <= 0);
  } else if (negative && s1) {
    section = s1;
    forNegatives = true;
  } else section = v === 0 && s2 ? s2 : s0;
  if (section.text) return undefined;
  if (section.date) return negative ? undefined : formatDate(section, v, date1904);
  const shown = renderNumber(section, Math.abs(v));
  if (shown === undefined) return undefined;
  // A negative number has its minus, unless its section writes the sign; a section that shows it
  // only by a colour, with no sign or brackets of its own, gets the minus the colour stood for.
  if (negative && /[1-9]/.test(shown) && (!forNegatives || (section.color && !section.signed))) return "-" + shown;
  return shown;
}

/** A text cell as its format shows it: through the format's text section, when it has one. */
export function formatText(fmt: NumberFormat, text: string): string {
  const section = fmt.sections.length === 4 ? fmt.sections[3]! : fmt.sections.find((s) => s.text);
  if (!section) return text;
  return section.tokens.map((t) => (t.k === "text" ? text : t.k === "lit" ? t.s : "")).join("");
}

/** v ≥ 0 rounded half up to `places` decimals from its 15 significant digits, as Excel rounds it. */
function roundDigits(v: number, places: number): { int: string; frac: string } | undefined {
  if (v >= 1e21) return undefined;
  const p = Math.min(places, MAX_PLACES);
  const m = /^(\d+)(?:\.(\d+))?(?:e([+-]\d+))?$/.exec(v.toPrecision(15));
  if (!m) return undefined;
  let digits = m[1]! + (m[2] ?? "");
  let point = m[1]!.length + (m[3] ? Number(m[3]) : 0);
  if (point < 0) {
    digits = "0".repeat(-point) + digits;
    point = 0;
  }
  if (digits.length <= point + p) digits += "0".repeat(point + p + 1 - digits.length);
  let kept = digits.slice(0, point + p);
  if (digits[point + p]! >= "5") {
    const d = kept.split("");
    let i = d.length - 1;
    while (i >= 0 && d[i] === "9") d[i--] = "0";
    if (i >= 0) d[i] = String(Number(d[i]) + 1);
    else point++;
    kept = (i < 0 ? "1" : "") + d.join("");
  }
  return { int: kept.slice(0, point).replace(/^0+(?=\d)/, "") || "0", frac: kept.slice(point) + "0".repeat(places - p) };
}

/** Digits with a comma between each thousand. */
function grouped(digits: string): string {
  let out = "";
  for (let i = 0; i < digits.length; i++) out += (i > 0 && (digits.length - i) % 3 === 0 ? "," : "") + digits[i];
  return out;
}

const placeholder = (t: Token) => (t as { c: "0" | "#" | "?" }).c;

/** What a token shows when it is not a digit place. */
const words = (x: Token) => (x.k === "lit" ? x.s : x.k === "percent" ? "%" : x.k === "slash" ? "/" : x.k === "denom" ? String(x.n) : "");

/** Where a number section's digits go, worked out in one pass over its tokens. */
function numberPlan(t: Token[]): NumberPlan {
  const digitAt = t.flatMap((x, i) => (x.k === "digit" ? [i] : []));
  const first = digitAt[0] ?? -1;
  const last = digitAt[digitAt.length - 1] ?? -1;
  const slash = first < 0 ? -1 : t.findIndex((x, i) => x.k === "slash" && i > first && (t[i + 1]?.k === "digit" || t[i + 1]?.k === "denom"));
  const exp = t.findIndex((x) => x.k === "exp");
  const point = t.findIndex((x, i) => x.k === "point" && (exp < 0 || i < exp));
  const intEnd = point >= 0 ? point : exp >= 0 ? exp : t.length;
  const intSlots = digitAt.filter((i) => i < intEnd);
  const lastInt = intSlots[intSlots.length - 1] ?? -1;
  // A comma between integer digits groups thousands; one after the last integer digit, or after
  // the last digit of all, divides by a thousand. Any other comma is a comma.
  let grouping = false;
  let scale = 0;
  const silent = new Set<number>();
  for (const [i, x] of t.entries()) {
    if (x.k !== "comma" || first < 0 || i < first) continue;
    if (i < intEnd && i < lastInt) grouping = true;
    else if (i < intEnd || i > last) scale++;
    else continue;
    silent.add(i);
  }
  const expSlots = exp >= 0 ? digitAt.filter((i) => i > exp) : [];
  return {
    general: t.some((x) => x.k === "general"),
    words: !digitAt.length,
    slash,
    exp,
    point,
    intSlots,
    fracSlots: digitAt.filter((i) => i > intEnd && (exp < 0 || i < exp)),
    expSlots,
    grouping,
    scale,
    silent,
    percent: t.filter((x) => x.k === "percent").length,
    intZeros: intSlots.filter((i) => placeholder(t[i]!) === "0").length,
    expZeros: expSlots.filter((i) => placeholder(t[i]!) === "0").length,
    step: intSlots.length > 1 && intSlots.some((i) => placeholder(t[i]!) === "#") ? intSlots.length : 1,
  };
}

/** A number section applied to v ≥ 0. */
function renderNumber(section: Section, v: number): string | undefined {
  const t = section.tokens;
  const plan = (section.plan ??= numberPlan(t));
  if (plan.general) return t.map((x) => (x.k === "general" ? generalNumber(v) : words(x))).join("");
  // No digits: the section is words, shown as written ("-", "n/a").
  if (plan.words) return t.map(words).join("");
  if (plan.slash >= 0) return renderFraction(t, v, plan.slash);
  const { exp, point, intSlots, fracSlots, expSlots, silent } = plan;
  let x = (v * 100 ** plan.percent) / 1000 ** plan.scale;
  let e = 0;
  if (exp >= 0 && x > 0) {
    const ints = Math.max(1, intSlots.length);
    const mag = Math.floor(Math.log10(x));
    e = plan.step > 1 ? Math.floor(mag / plan.step) * plan.step : mag - (ints - 1);
    if ((roundDigits(x / 10 ** e, fracSlots.length)?.int.length ?? 0) > ints) e += plan.step;
    x = x / 10 ** e;
  }
  const r = roundDigits(x, fracSlots.length);
  if (!r) return undefined;
  const out = new Map<number, string>();
  if (plan.grouping) {
    const digits = r.int === "0" ? "0".repeat(plan.intZeros) : r.int.padStart(plan.intZeros, "0");
    intSlots.forEach((i, k) => out.set(i, k === 0 ? grouped(digits) : ""));
  } else {
    // Right to left into their places; the leftmost place takes any digits left over.
    let at = r.int === "0" ? 0 : r.int.length;
    for (let k = intSlots.length - 1; k >= 0; k--) {
      const c = placeholder(t[intSlots[k]!]!);
      let s = at > 0 ? r.int[--at]! : c === "0" ? "0" : c === "?" ? " " : "";
      if (k === 0 && at > 0) s = r.int.slice(0, at) + s;
      out.set(intSlots[k]!, s);
    }
  }
  // Decimals left to right; the trailing zeros a # or ? stands for are dropped or left blank.
  let trailing = true;
  for (let k = fracSlots.length - 1; k >= 0; k--) {
    const c = placeholder(t[fracSlots[k]!]!);
    const d = r.frac[k]!;
    if (trailing && d === "0" && c !== "0") out.set(fracSlots[k]!, c === "?" ? " " : "");
    else {
      trailing = false;
      out.set(fracSlots[k]!, d);
    }
  }
  expSlots.forEach((i, k) => out.set(i, k === 0 ? String(Math.abs(e)).padStart(plan.expZeros, "0") : ""));
  let text = "";
  for (const [i, tok] of t.entries()) {
    if (tok.k === "digit") text += out.get(i) ?? "";
    // With no integer places, the integer digits stand before the point.
    else if (tok.k === "point") text += (i === point && !intSlots.length && r.int !== "0" ? r.int : "") + ".";
    else if (tok.k === "comma") text += silent.has(i) ? "" : ",";
    else if (tok.k === "exp") text += tok.s[0] + (e < 0 ? "-" : tok.s[1] === "+" ? "+" : "");
    else text += words(tok);
  }
  return text;
}

/** The fraction nearest to `x` whose denominator is at most `max`, by continued fractions. */
function nearestFraction(x: number, max: number): [number, number] {
  let [p0, q0, p1, q1] = [0, 1, 1, 0];
  let y = x;
  for (let i = 0; i < 64; i++) {
    const a = Math.floor(y);
    const q2 = q0 + a * q1;
    if (q2 > max) break;
    [p0, q0, p1, q1] = [p1, q1, p0 + a * p1, q2];
    if (y - a < 1e-12) break;
    y = 1 / (y - a);
  }
  if (q1 === 0) return [Math.round(x), 1];
  // The last convergent within the bound, or the semiconvergent past it when that is nearer.
  const k = Math.floor((max - q0) / q1);
  const [ps, qs] = [p0 + k * p1, q0 + k * q1];
  return qs > 0 && Math.abs(x - ps / qs) < Math.abs(x - p1 / q1) ? [ps, qs] : [p1, q1];
}

/** A fraction section ("# ?/?", "?/8") applied to v ≥ 0. */
function renderFraction(t: Token[], v: number, slash: number): string {
  // The numerator's places run back from the slash; the denominator's, or a fixed number, follow it.
  let numStart = slash;
  while (numStart > 0 && t[numStart - 1]!.k === "digit") numStart--;
  const fixedTok = t[slash + 1];
  const fixed = fixedTok?.k === "denom" ? fixedTok.n : undefined;
  let denEnd = slash + 1;
  if (fixed !== undefined) denEnd++;
  else while (denEnd < t.length && t[denEnd]!.k === "digit") denEnd++;
  const intPlace = t.slice(0, numStart).find((x) => x.k === "digit");
  let whole = intPlace ? Math.floor(v) : 0;
  const rest = v - whole;
  let [n, d] = fixed !== undefined ? [Math.round(rest * fixed), fixed] : nearestFraction(rest, 10 ** (denEnd - slash - 1) - 1);
  if (intPlace && n === d) {
    whole++;
    n = 0;
  }
  const fraction = intPlace && n === 0 ? "" : `${n}/${d}`;
  let text = "";
  let wroteWhole = false;
  for (let i = 0; i < t.length; i++) {
    const tok = t[i]!;
    if (i === numStart) text += fraction;
    if (i >= numStart && i < denEnd) continue;
    if (tok.k === "digit") {
      if (!wroteWhole) text += whole || placeholder(tok) === "0" || !fraction ? String(whole) : "";
      wroteWhole = true;
    } else if (tok.k === "lit") text += tok.s;
    else if (tok.k === "percent") text += "%";
  }
  return text;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS = ["Saturday", "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
const DAY_MS = 86_400_000;
const pad = (n: number, w = 2) => String(n).padStart(w, "0");

/**
 * The calendar day of a whole date serial, in the workbook's 1900 or 1904 date system. The 1900
 * system keeps Excel's fictitious 1900-02-29 (serial 60), and with it Excel's weekdays, a day out
 * before March 1900.
 */
function calendar(days: number, date1904: boolean): { y: number; m: number; d: number; weekday: number } {
  const weekday = (days + (date1904 ? 1462 : 0)) % 7;
  if (!date1904 && days === 60) return { y: 1900, m: 2, d: 29, weekday };
  const at = date1904 ? new Date(Date.UTC(1904, 0, 1) + days * DAY_MS) : new Date(Date.UTC(1899, 11, days < 60 ? 31 : 30) + days * DAY_MS);
  return { y: at.getUTCFullYear(), m: at.getUTCMonth() + 1, d: at.getUTCDate(), weekday };
}

/** Whether an `m` or `mm` means minutes: right after the hours, or right before the seconds. */
function isMinute(t: Token[], at: number): boolean {
  for (let i = at - 1; i >= 0; i--) {
    const p = t[i]!;
    if (p.k === "lit") continue;
    if ((p.k === "date" && p.c[0] === "h") || (p.k === "elapsed" && p.c === "h")) return true;
    break;
  }
  for (let i = at + 1; i < t.length; i++) {
    const n = t[i]!;
    if (n.k === "lit") continue;
    return (n.k === "date" && n.c[0] === "s") || (n.k === "elapsed" && n.c === "s");
  }
  return false;
}

function datePlan(t: Token[]): DatePlan {
  const minute = t.map((x, i) => x.k === "date" && x.c[0] === "m" && x.c.length <= 2 && isMinute(t, i));
  const isDay = (x: Token, i: number) => x.k === "date" && "ymd".includes(x.c[0]!) && !minute[i];
  const timeAt = t.flatMap((x, i) => (x.k === "elapsed" || x.k === "ampm" || x.k === "subsec" || (x.k === "date" && !isDay(x, i)) ? [i] : []));
  return {
    minute,
    sub: t.reduce((n, x) => (x.k === "subsec" ? Math.max(n, x.n) : n), 0),
    day: t.some(isDay),
    time: timeAt.length ? [timeAt[0]!, timeAt[timeAt.length - 1]!] : null,
    twelve: t.some((x) => x.k === "ampm"),
  };
}

/**
 * The seconds a date serial counts. A section that shows a time rounds them to the finest part it
 * shows, so 12:00:00.5 is 12:00:01 under h:mm:ss, and 23:59:59.991 the next day's 00:00 under
 * yyyy-mm-dd hh:mm. A date alone is the day the serial falls in, without rounding to the second
 * first, as SheetJS shows 45658.9999999 (23:59:59.991) under yyyy-mm-dd as 2025-01-01; only a serial
 * within a ten-thousandth of a second of midnight, a float's error short of it, is the next day.
 */
function serialSeconds(serial: number, sub: number, time: boolean): { totalSeconds: number; fraction: number } {
  if (!time) return { totalSeconds: Math.floor(serial * 86_400 + 1e-4), fraction: 0 };
  const ticks = Math.round(serial * 86_400 * 10 ** sub);
  const totalSeconds = Math.floor(ticks / 10 ** sub);
  return { totalSeconds, fraction: ticks - totalSeconds * 10 ** sub };
}

/** A date or time section applied to a date serial. */
function formatDate(section: Section, serial: number, date1904: boolean): string | undefined {
  if (serial > 2_958_465) return undefined;
  const t = section.tokens;
  const plan = (section.datePlan ??= datePlan(t));
  const { minute, sub, twelve } = plan;
  // The minutes and hours are counted down from the seconds.
  const { totalSeconds, fraction } = serialSeconds(serial, sub, plan.time !== null);
  const days = Math.floor(totalSeconds / 86_400);
  const secs = totalSeconds - days * 86_400;
  const [H, M, S] = [Math.floor(secs / 3600), Math.floor((secs % 3600) / 60), secs % 60];
  // A day before the 1900 system's first has no date, as Excel shows none for it: a section that
  // shows a time shows the time alone, from its first part to its last (0.5 under m/d/yyyy h:mm is
  // 12:00), and a date alone reads as a number.
  const dateless = !date1904 && days < 1 && plan.day;
  if (dateless && !plan.time) return undefined;
  const [from, to] = dateless ? plan.time! : [0, t.length - 1];
  const cal = calendar(days, date1904);
  let text = "";
  for (const [i, x] of t.entries()) {
    if (i < from || i > to || (dateless && x.k === "date" && "ymd".includes(x.c[0]!) && !minute[i])) continue;
    if (x.k === "lit") text += x.s;
    else if (x.k === "elapsed") text += pad(x.c === "h" ? Math.floor(totalSeconds / 3600) : x.c === "m" ? Math.floor(totalSeconds / 60) : totalSeconds, x.n);
    else if (x.k === "ampm") text += x.s.length === 5 ? x.s.slice(H >= 12 ? 3 : 0, H >= 12 ? 5 : 2) : x.s[H >= 12 ? 2 : 0]!;
    else if (x.k === "subsec") text += "." + pad(fraction, sub).slice(0, x.n);
    else if (x.k === "date") {
      const n = x.c.length;
      const kind = x.c[0];
      if (kind === "y") text += n <= 2 ? pad(cal.y % 100) : String(cal.y);
      else if (kind === "d") text += n === 1 ? String(cal.d) : n === 2 ? pad(cal.d) : n === 3 ? DAYS[cal.weekday]!.slice(0, 3) : DAYS[cal.weekday]!;
      else if (kind === "h") text += n === 1 ? String(twelve ? H % 12 || 12 : H) : pad(twelve ? H % 12 || 12 : H);
      else if (kind === "s") text += n === 1 ? String(S) : pad(S);
      else if (minute[i]) text += n === 1 ? String(M) : pad(M);
      else {
        const name = MONTHS[cal.m - 1]!;
        text += n === 1 ? String(cal.m) : n === 2 ? pad(cal.m) : n === 3 ? name.slice(0, 3) : n === 4 ? name : name[0]!;
      }
    }
  }
  return text;
}

/** The locale's own date and time formats, read in ISO 8601: `2026-04-10`, `2026-04-10 12:00`, `13:30:00`. */
function isoDate(serial: number, kind: "date" | "datetime" | "time", date1904: boolean): string | undefined {
  if (serial < 0 || serial > 2_958_465) return undefined;
  const { totalSeconds } = serialSeconds(serial, 0, kind !== "date");
  const days = Math.floor(totalSeconds / 86_400);
  const secs = totalSeconds - days * 86_400;
  const clock = `${pad(Math.floor(secs / 3600))}:${pad(Math.floor((secs % 3600) / 60))}`;
  if (kind === "time") return `${clock}:${pad(secs % 60)}`;
  if (days < 1 && !date1904) return kind === "datetime" ? clock : undefined;
  const c = calendar(days, date1904);
  const day = `${c.y}-${pad(c.m)}-${pad(c.d)}`;
  return kind === "datetime" ? `${day} ${clock}` : day;
}
