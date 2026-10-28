/**
 * Reading a list of email addresses pasted from wherever people keep them: separated by commas,
 * semicolons, new lines, tabs or spaces; `Name <address>` as Gmail and Apple Mail copy it;
 * `"Last, First" <address>` and `Last, First <address>;` as Outlook does; a spreadsheet's name and
 * address columns (a tab between them); `mailto:` links; `address (Name)`. Each address is read
 * once, with the name written beside it when there is one.
 */

export interface ReadAddress {
  email: string;
  /** The name written beside the address, when the list gives one. */
  name: string | null;
}

export interface AddressList {
  addresses: ReadAddress[];
  /** How many addresses came more than once and are listed once. */
  repeated: number;
  /** Pieces with an @ that aren't an address the server takes, as written. */
  unreadable: string[];
}

/**
 * The address check the server makes (zod's `email()`), so an address read here is never refused
 * there for its shape.
 */
const ADDRESS = /^(?:[A-Za-z0-9_'+\-]+\.)*[A-Za-z0-9_'+\-]*[A-Za-z0-9_+-]@(?:[A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$/;
const MAX_LENGTH = 320;

/**
 * A run of text with an @ in it and none of the characters that separate addresses or wrap them.
 * An apostrophe may be inside one (o'brien@…), so one around it is taken off afterwards.
 */
const CANDIDATE = /[^\s<>()[\]{},;:"`]+@[^\s<>()[\]{},;:"`]*|@[^\s<>()[\]{},;:"`]+/g;

export function isAddress(s: string): boolean {
  return s.length <= MAX_LENGTH && ADDRESS.test(s);
}

/** Whatever wraps or separates a name, taken off both ends: spaces, quotes, brackets, commas, semicolons. */
function cleanName(s: string): string | null {
  const name = s
    .replace(/^[\s,;:<>()[\]{}"'`|]+/, "")
    .replace(/[\s,;:<>()[\]{}"'`|]+$/, "")
    .replace(/\s+/g, " ")
    .trim();
  // A name holds a letter, isn't an address itself, and is a name's length rather than a paragraph's.
  if (!name || !/\p{L}/u.test(name) || name.includes("@") || name.length > 100) return null;
  return name;
}

export function readAddressList(text: string): AddressList {
  const source = text.replace(/mailto:/gi, (m) => " ".repeat(m.length));
  const found: ReadAddress[] = [];
  const unreadable: string[] = [];
  let from = 0;
  for (const m of source.matchAll(CANDIDATE)) {
    const at = m.index;
    // Single quotes around it wrap it, and trailing dots end a sentence.
    const raw = m[0].replace(/^'+/, "").replace(/['.]+$/, "");
    let end = at + m[0].length;
    if (at < from) continue;
    if (!isAddress(raw)) {
      unreadable.push(raw);
      from = end;
      continue;
    }
    // The name is what comes before the address on its own line, since the last address:
    // `Jane Doe <jane@…>`, `"Doe, Jane" <jane@…>`, a spreadsheet's `Jane Doe<tab>jane@…`.
    const before = source.slice(from, at);
    let name = cleanName(before.slice(before.lastIndexOf("\n") + 1));
    // Or, in the older form, in parentheses right after it: `jane@… (Jane Doe)`.
    const after = /^>?[ \t]*\(([^()\n]*)\)/.exec(source.slice(end));
    if (after) {
      name = cleanName(after[1]!) ?? name;
      end += after[0].length;
    }
    found.push({ email: raw, name });
    from = end;
  }
  const byAddress = new Map<string, ReadAddress>();
  let repeated = 0;
  for (const a of found) {
    const key = a.email.toLowerCase();
    const had = byAddress.get(key);
    if (!had) byAddress.set(key, a);
    else {
      repeated += 1;
      if (!had.name && a.name) had.name = a.name;
    }
  }
  return { addresses: [...byAddress.values()], repeated, unreadable: [...new Set(unreadable)] };
}
