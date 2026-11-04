// Compares a sender's domain with the company domain it imitates, for the
// side-by-side view: which characters differ, and a sentence describing the
// difference that a screen reader can read.

import { DIFF, LOOKALIKE_CHARS } from "@/lib/copy";
import { lookalikeChar, toUnicodeDomain } from "@/lib/lookalike-chars";

export type Segment = { text: string; changed: boolean };

export type DomainDiff = {
  sender: Segment[];
  official: Segment[];
  description: string;
};

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function segments(...parts: Array<[string, boolean]>): Segment[] {
  return parts.filter(([text]) => text !== "").map(([text, changed]) => ({ text, changed }));
}

export function diffDomains(senderDomain: string, officialDomain: string): DomainDiff {
  // Punycode (xn--) is shown as the characters it stands for.
  const a = toUnicodeDomain(senderDomain).toLowerCase();
  const b = toUnicodeDomain(officialDomain).toLowerCase();
  // A character from another script, or "rn" for "m", is named outright.
  const odd = lookalikeChar(a, b);

  if (a === b) {
    return { sender: segments([a, false]), official: segments([b, false]), description: DIFF.same };
  }

  // The company's domain inside the sender's: jobs.acme.example.scam.example
  const at = a.indexOf(b);
  if (at >= 0) {
    const before = a.slice(0, at);
    const after = a.slice(at + b.length);
    const description =
      before && after
        ? DIFF.extraAround(before, after)
        : (before || after).length === 1
          ? DIFF.extraChar(DIFF.charNoun(before || after))
          : DIFF.extraText(before || after);
    return {
      sender: segments([before, true], [b, false], [after, true]),
      official: segments([b, false]),
      description,
    };
  }

  // Trim the shared start and end; what is left is the difference.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let end = 0;
  while (
    end < a.length - start &&
    end < b.length - start &&
    a[a.length - 1 - end] === b[b.length - 1 - end]
  ) {
    end++;
  }
  const prefix = a.slice(0, start);
  const suffix = a.slice(a.length - end);
  const added = a.slice(start, a.length - end);
  const removed = b.slice(start, b.length - end);

  let description: string;
  if (odd) {
    description = DIFF.lookalike(LOOKALIKE_CHARS.describe(odd));
  } else if (removed === "") {
    description = added.length === 1 ? DIFF.extraChar(DIFF.charNoun(added)) : DIFF.extraText(added);
  } else if (added === "") {
    description =
      removed.length === 1
        ? DIFF.missingChar(capitalize(DIFF.charName(removed)))
        : DIFF.missingText(removed);
  } else if (added.length === 1 && removed.length === 1) {
    description = DIFF.replacesChar(capitalize(DIFF.charName(added)), DIFF.charName(removed));
  } else {
    description = DIFF.replacesText(added, removed);
  }

  return {
    sender: segments([prefix, false], [added, true], [suffix, false]),
    official: segments([prefix, false], [removed, true], [suffix, false]),
    description,
  };
}
