// Internationalised (xn--) domains and look-alike characters. Every company
// here is fictional and every company domain uses the reserved .example
// suffix.
import { domainToASCII, domainToUnicode } from "node:url";
import { describe, expect, it } from "vitest";
import { hostOf, isLookalike } from "@/lib/check/domains";
import { buildReport } from "@/lib/check/report";
import type { CheckReport } from "@/lib/check/types";
import { diffDomains } from "@/lib/domain-diff";
import { lookalikeChar, skeleton, toUnicodeDomain } from "@/lib/lookalike-chars";
import { withSender } from "./fixtures";

// "аcme.example" with a Cyrillic а (U+0430) in place of the Latin a.
const CYRILLIC_ACME = "аcme.example";
const CYRILLIC_ACME_ASCII = domainToASCII(CYRILLIC_ACME);

describe("punycode", () => {
  it("decodes xn-- labels the same way Node does", () => {
    expect(CYRILLIC_ACME_ASCII.startsWith("xn--")).toBe(true);
    for (const domain of [CYRILLIC_ACME, "bücher.example", "münchen-jobs.example", "αcme.example"]) {
      const ascii = domainToASCII(domain);
      expect(toUnicodeDomain(ascii)).toBe(domainToUnicode(ascii));
    }
  });

  it("keeps labels that aren't punycode, or don't decode", () => {
    expect(toUnicodeDomain("acme.example")).toBe("acme.example");
    expect(toUnicodeDomain("xn--!!.example")).toBe("xn--!!.example");
  });

  it("is how a typed internationalised domain is compared", () => {
    expect(hostOf(CYRILLIC_ACME)).toBe(CYRILLIC_ACME_ASCII);
  });
});

describe("look-alike characters", () => {
  it("reads other scripts and 'rn' as the Latin letters they imitate", () => {
    expect(skeleton(CYRILLIC_ACME)).toBe("acme.example");
    expect(skeleton("acrne.example")).toBe("acme.example");
  });

  it("names the character that makes the domain look the same", () => {
    expect(lookalikeChar(CYRILLIC_ACME_ASCII, "acme.example")).toEqual({
      kind: "script",
      char: "а",
      script: "Cyrillic",
      latin: "a",
    });
    expect(lookalikeChar("acrne.example", "acme.example")).toEqual({ kind: "sequence", seq: "rn", looksLike: "m" });
    expect(lookalikeChar("acme-careers.example", "acme.example")).toBeNull();
  });

  it("spots a domain with a character from another script, in either form", () => {
    expect(isLookalike(CYRILLIC_ACME_ASCII, "acme.example", "Acme")).toBe(true);
    expect(isLookalike(CYRILLIC_ACME, "acme.example", "Acme")).toBe(true);
    // Two characters off as written, one look-alike as read.
    expect(isLookalike("acrne.example", "acme.example", "Acme")).toBe(true);
    expect(isLookalike("globex.example", "acme.example", "Acme")).toBe(false);
  });
});

describe("look-alike reasons", () => {
  it("says which character imitates which, and shows the domain decoded", () => {
    const r = buildReport(withSender(`recruiter@${CYRILLIC_ACME_ASCII}`)) as CheckReport;
    expect(r.verdict).toBe("strong_warning");
    expect(r.senderDomain).toBe(CYRILLIC_ACME);
    expect(r.lookalike).toEqual({ sender: CYRILLIC_ACME, imitates: "acme.example" });
    expect(r.reasons[0].text).toBe(
      `The sender's domain ${CYRILLIC_ACME} imitates Acme's official domain acme.example: it uses a Cyrillic а that looks like a Latin a.`,
    );
  });

  it("says when 'rn' stands in for 'm'", () => {
    const r = buildReport(withSender("recruiter@acrne.example")) as CheckReport;
    expect(r.reasons[0].text).toBe(
      "The sender's domain acrne.example imitates Acme's official domain acme.example: it uses “rn” that looks like an m.",
    );
  });

  it("describes the difference in the side-by-side view", () => {
    expect(diffDomains(CYRILLIC_ACME_ASCII, "acme.example")).toMatchObject({
      sender: [
        { text: "а", changed: true },
        { text: "cme.example", changed: false },
      ],
      description: "It uses a Cyrillic а that looks like a Latin a.",
    });
    expect(diffDomains("acrne.example", "acme.example").description).toBe("It uses “rn” that looks like an m.");
  });

  it("names a mixed-script domain's odd character", () => {
    // A Cyrillic б (not a look-alike of any Latin letter) in a Latin name.
    expect(lookalikeChar("acmeб.example", "acme.example")).toEqual({
      kind: "script",
      char: "б",
      script: "Cyrillic",
      latin: "",
    });
  });
});
