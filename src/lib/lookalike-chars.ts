// Internationalised domains and characters that look like Latin letters.
// Pure and free of server-only imports: the page uses it to describe how a
// sender's domain differs from the company's.

// ---- Punycode (RFC 3492) ----

const BASE = 36;
const TMIN = 1;
const TMAX = 26;
const SKEW = 38;
const DAMP = 700;
const INITIAL_BIAS = 72;
const INITIAL_N = 128;

function adapt(delta: number, points: number, first: boolean): number {
  let d = first ? Math.floor(delta / DAMP) : delta >> 1;
  d += Math.floor(d / points);
  let k = 0;
  while (d > ((BASE - TMIN) * TMAX) >> 1) {
    d = Math.floor(d / (BASE - TMIN));
    k += BASE;
  }
  return k + Math.floor(((BASE - TMIN + 1) * d) / (d + SKEW));
}

function digitOf(code: number): number {
  if (code >= 48 && code <= 57) return code - 22; // 0-9 -> 26-35
  if (code >= 65 && code <= 90) return code - 65; // A-Z
  if (code >= 97 && code <= 122) return code - 97; // a-z
  return BASE;
}

// One label without its "xn--" prefix, or null when it isn't valid punycode.
function decodeLabel(input: string): string | null {
  const output: number[] = [];
  const basic = input.lastIndexOf("-");
  for (let j = 0; j < Math.max(basic, 0); j++) {
    const code = input.charCodeAt(j);
    if (code >= 0x80) return null;
    output.push(code);
  }
  let n = INITIAL_N;
  let bias = INITIAL_BIAS;
  let i = 0;
  for (let at = basic > 0 ? basic + 1 : 0; at < input.length; ) {
    const oldI = i;
    let w = 1;
    for (let k = BASE; ; k += BASE) {
      if (at >= input.length) return null;
      const digit = digitOf(input.charCodeAt(at++));
      if (digit >= BASE) return null;
      i += digit * w;
      const t = k <= bias ? TMIN : k >= bias + TMAX ? TMAX : k - bias;
      if (digit < t) break;
      w *= BASE - t;
    }
    const length = output.length + 1;
    bias = adapt(i - oldI, length, oldI === 0);
    n += Math.floor(i / length);
    i %= length;
    if (n > 0x10ffff) return null;
    output.splice(i, 0, n);
    i++;
  }
  return String.fromCodePoint(...output);
}

// "xn--cme-8cd.example" -> "аcme.example" (with a Cyrillic а). Labels that
// aren't punycode, or don't decode, are kept as they are.
export function toUnicodeDomain(domain: string): string {
  return domain
    .split(".")
    .map((label) => {
      if (!/^xn--/i.test(label)) return label;
      return decodeLabel(label.slice(4).toLowerCase()) ?? label;
    })
    .join(".");
}

// ---- Look-alike characters ----

type Confusable = { latin: string; script: string };

// Characters from other scripts that look like a Latin letter.
const CONFUSABLES: Record<string, Confusable> = {
  // Cyrillic
  "а": { latin: "a", script: "Cyrillic" },
  "е": { latin: "e", script: "Cyrillic" },
  "о": { latin: "o", script: "Cyrillic" },
  "р": { latin: "p", script: "Cyrillic" },
  "с": { latin: "c", script: "Cyrillic" },
  "у": { latin: "y", script: "Cyrillic" },
  "х": { latin: "x", script: "Cyrillic" },
  "і": { latin: "i", script: "Cyrillic" },
  "ј": { latin: "j", script: "Cyrillic" },
  "ѕ": { latin: "s", script: "Cyrillic" },
  "ԁ": { latin: "d", script: "Cyrillic" },
  "һ": { latin: "h", script: "Cyrillic" },
  "ӏ": { latin: "l", script: "Cyrillic" },
  "ԛ": { latin: "q", script: "Cyrillic" },
  "ԝ": { latin: "w", script: "Cyrillic" },
  "ү": { latin: "y", script: "Cyrillic" },
  // Greek
  "α": { latin: "a", script: "Greek" },
  "ο": { latin: "o", script: "Greek" },
  "ν": { latin: "v", script: "Greek" },
  "ρ": { latin: "p", script: "Greek" },
  "ι": { latin: "i", script: "Greek" },
  "κ": { latin: "k", script: "Greek" },
  "υ": { latin: "u", script: "Greek" },
  "χ": { latin: "x", script: "Greek" },
  "ε": { latin: "e", script: "Greek" },
  "τ": { latin: "t", script: "Greek" },
  // Armenian
  "օ": { latin: "o", script: "Armenian" },
  "ս": { latin: "u", script: "Armenian" },
  "հ": { latin: "h", script: "Armenian" },
  "ո": { latin: "n", script: "Armenian" },
  "ց": { latin: "g", script: "Armenian" },
  // Latin letters that pass for others
  "ı": { latin: "i", script: "dotless" },
  "ɑ": { latin: "a", script: "Latin alpha" },
};

// Runs of Latin letters that read as one letter at a glance.
const SEQUENCES: ReadonlyArray<{ seq: string; looksLike: string }> = [
  { seq: "rn", looksLike: "m" },
  { seq: "vv", looksLike: "w" },
];

const SCRIPTS: ReadonlyArray<[string, RegExp]> = [
  ["Latin", /\p{Script=Latin}/u],
  ["Cyrillic", /\p{Script=Cyrillic}/u],
  ["Greek", /\p{Script=Greek}/u],
  ["Armenian", /\p{Script=Armenian}/u],
];

function scriptOf(char: string): string | null {
  if (!/\p{L}/u.test(char)) return null;
  return SCRIPTS.find(([, re]) => re.test(char))?.[0] ?? "other";
}

// The scripts a domain's letters come from.
export function scriptsIn(text: string): string[] {
  const found = new Set<string>();
  for (const char of text) {
    const script = scriptOf(char);
    if (script) found.add(script);
  }
  return [...found];
}

// What a domain looks like to a reader: every look-alike character replaced
// by the Latin letter it imitates, and "rn" read as "m". Lower case.
export function skeleton(text: string): string {
  let out = "";
  for (const char of text.toLowerCase()) out += CONFUSABLES[char]?.latin ?? char;
  for (const { seq, looksLike } of SEQUENCES) out = out.split(seq).join(looksLike);
  return out;
}

export type LookalikeChar =
  // A character from another script: a Cyrillic а for a Latin a.
  | { kind: "script"; char: string; script: string; latin: string }
  // Latin letters that read as another letter: "rn" for "m".
  | { kind: "sequence"; seq: string; looksLike: string };

// The character in the sender's domain that makes it look like the
// company's, or null. Both domains may be punycode or Unicode.
export function lookalikeChar(senderDomain: string, officialDomain: string): LookalikeChar | null {
  const sender = toUnicodeDomain(senderDomain).toLowerCase();
  const official = toUnicodeDomain(officialDomain).toLowerCase();

  // A character from another script, or a domain that mixes scripts.
  for (const char of sender) {
    const known = CONFUSABLES[char];
    if (known) return { kind: "script", char, script: known.script, latin: known.latin };
  }
  const scripts = scriptsIn(sender);
  if (scripts.length > 1) {
    const odd = [...sender].find((c) => {
      const s = scriptOf(c);
      return s !== null && s !== "Latin";
    });
    if (odd) return { kind: "script", char: odd, script: scriptOf(odd) ?? "other", latin: "" };
  }

  // "rn" where the company's domain has "m".
  for (const { seq, looksLike } of SEQUENCES) {
    if (!sender.includes(seq)) continue;
    const read = sender.split(seq).join(looksLike);
    const officialLabel = official.split(".")[0];
    if (read === official || (officialLabel.length >= 3 && read.includes(officialLabel) && !sender.includes(officialLabel))) {
      return { kind: "sequence", seq, looksLike };
    }
  }
  return null;
}
