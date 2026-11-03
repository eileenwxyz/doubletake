import { describe, expect, it } from "vitest";
import { buildReport } from "@/lib/check/report";
import { evaluateSender } from "@/lib/check/sender";
import type { CheckReport } from "@/lib/check/types";
import {
  ACME_CAREERS_TEXT_PLAIN,
  ACME_CAREERS_TEXT_WITH_LEVER,
  ACME_FRAUD_TEXT_NO_LIST,
  acmeReads,
  hit,
  NOW,
  withSender,
} from "./fixtures";

function report(input: Parameters<typeof buildReport>[0]): CheckReport {
  const result = buildReport(input);
  if (result.status !== "ok") throw new Error(`expected ok, got ${result.status}`);
  return result;
}

describe("rule 1: sender on the published recruiting list", () => {
  it("passes and quotes the company", () => {
    const r = report(withSender("recruiter@acme.example"));
    expect(r.verdict).toBe("no_red_flags");
    expect(r.reasons[0].direction).toBe("reassures");
    expect(r.reasons[0].text).toBe(
      "The sender's domain acme.example is on the recruiting list Acme publishes on acme.example.",
    );
    expect(r.reasons[0].sourceType).toBe("Official");
    expect(r.reasons[0].age).toBe("Published 2026-09-01 (2 months ago)");
    expect(r.companySays).toEqual({
      quote: "Acme recruiters only contact candidates from the @acme.example domain.",
      domain: "acme.example",
    });
    // The company's own fraud notice: scammers have used this name.
    expect(r.subtitle).toBe("Scammers have used this name.");
  });
});

describe("rule 2: company-controlled domain not on the list", () => {
  it("is mixed when a list exists", () => {
    const r = report(withSender("recruiter@talent.acme.example"));
    expect(r.verdict).toBe("mixed");
    expect(r.subtitle).toBe("This address is not one of the company's channels.");
    expect(r.reasons[0].direction).toBe("caution");
  });

  it("passes when the company publishes no list", () => {
    const r = report(
      withSender("recruiter@talent.acme.example", {
        reads: acmeReads({ fraudText: ACME_FRAUD_TEXT_NO_LIST }),
      }),
    );
    expect(r.verdict).toBe("no_red_flags");
    expect(r.couldntFind).toContainEqual({
      kind: "not_published",
      text: "Acme doesn't say which email domains its recruiters use on the pages checked.",
      url: null,
    });
  });

  it("passes with an incomplete note when an official page couldn't be read", () => {
    const input = withSender("recruiter@acme.example", {
      reads: acmeReads({ fraudUnreadable: true }),
    });
    const result = evaluateSender({
      senderAddress: input.senderAddress,
      senderDomain: "acme.example",
      company: "Acme",
      officialDomain: "acme.example",
      recruitingList: null,
      officialUnread: true,
      linkedPlatforms: new Set(),
    });
    expect(result).toMatchObject({ rule: 2, outcome: "passes", case: "controlled_unread" });

    const r = report(input);
    expect(r.verdict).toBe("no_red_flags");
    expect(r.subtitle).toBe("Some pages couldn't be checked.");
    expect(r.reasons[0].text).toContain("couldn't be read, so this check is incomplete");
    expect(r.couldntFind).toContainEqual({
      kind: "couldnt_check",
      text: "Couldn't read acme.example/recruiting-fraud.",
      url: "https://www.acme.example/recruiting-fraud",
    });
  });
});

describe("rule 3: look-alike domains", () => {
  it("flags a hyphen look-alike of the careers subdomain", () => {
    const r = report(withSender("recruiter@careers-acme.example"));
    expect(r.verdict).toBe("strong_warning");
    expect(r.reasons[0].text).toBe(
      "The sender's domain careers-acme.example imitates Acme's official domain acme.example.",
    );
  });

  it("flags the official domain at the front of a scam domain", () => {
    const r = report(withSender("recruiter@jobs.acme.example.scam.example"));
    expect(r.verdict).toBe("strong_warning");
    expect(r.subtitle).toBe("This address is not one of the company's channels.");
  });

  it("flags a vercel.app look-alike", () => {
    const r = report(withSender("recruiter@acme.vercel.app"));
    expect(r.verdict).toBe("strong_warning");
    expect(r.reasons[0].text).toContain("imitates");
  });

  it("flags a domain one character off", () => {
    expect(report(withSender("hr@acmee.example")).verdict).toBe("strong_warning");
  });
});

describe("rule 4: hiring software", () => {
  it("is neutral when the company's site links to the platform", () => {
    const r = report(
      withSender("no-reply@hire.lever.co", {
        reads: acmeReads({ careersText: ACME_CAREERS_TEXT_WITH_LEVER }),
      }),
    );
    expect(r.verdict).toBe("no_red_flags");
    expect(r.reasons[0]).toMatchObject({
      direction: "neutral",
      text: "hire.lever.co is Lever hiring software, and Acme's own site links to Lever.",
      sourceUrl: "https://careers.acme.example/",
    });
  });

  it("is mixed when the company's site doesn't link to it", () => {
    const r = report(
      withSender("no-reply@hire.lever.co", {
        reads: acmeReads({ careersText: ACME_CAREERS_TEXT_PLAIN }),
      }),
    );
    expect(r.verdict).toBe("mixed");
    expect(r.reasons[0].direction).toBe("caution");
  });

  it("treats a board the company links to as an official source", () => {
    const r = report(
      withSender("no-reply@hire.lever.co", {
        reads: acmeReads({ careersText: ACME_CAREERS_TEXT_WITH_LEVER }),
        officialHits: [
          ...withSender("x@acme.example").officialHits,
          hit("https://jobs.lever.co/acme/123", "Acme - Engineer", "Acme is hiring an engineer."),
          hit("https://jobs.lever.co/other-co/9", "Other - Engineer", "Acme partner role."),
        ],
      }),
    );
    const types = Object.fromEntries(r.sources.map((s) => [s.url, s.type]));
    expect(types["https://jobs.lever.co/acme/123"]).toBe("Official");
    expect(types["https://jobs.lever.co/other-co/9"]).not.toBe("Official");
  });
});

describe("rule 5: free email providers", () => {
  it("is a strong warning when the company has its own domain", () => {
    const r = report(withSender("acme.hiring.team@gmail.com"));
    expect(r.verdict).toBe("strong_warning");
    expect(r.reasons[0].text).toBe(
      "gmail.com is a free email service, but Acme has its own domain, acme.example.",
    );
  });

  it("is mixed for a tiny company with no domain", () => {
    const r = report({
      company: "Crumbwell Bakery",
      website: null,
      senderAddress: "crumbwellbakery@gmail.com",
      senderDomain: "gmail.com",
      officialHits: [
        hit("https://www.reviews.example/biz/crumbwell-bakery", "Crumbwell Bakery - Reviews", "Crumbwell Bakery, a tiny bakery."),
      ],
      warningHits: [],
      reads: [],
      now: NOW,
    });
    expect(r.officialDomain).toBeNull();
    expect(r.verdict).toBe("mixed");
    expect(r.subtitle).toBeNull();
    expect(r.couldntFind).toContainEqual({
      kind: "not_published",
      text: "No official website for Crumbwell Bakery was found.",
      url: null,
    });
  });
});

describe("rule 6: anything else", () => {
  it("is a strong warning", () => {
    const r = report(withSender("talent@unrelated-staffing.example"));
    expect(r.verdict).toBe("strong_warning");
  });

  it("is not enough when there is no official domain to compare with", () => {
    const r = report({
      company: "Crumbwell Bakery",
      website: null,
      senderAddress: "orders@crumbs.example",
      senderDomain: "crumbs.example",
      officialHits: [],
      warningHits: [],
      reads: [],
      now: NOW,
    });
    expect(r.verdict).toBe("not_enough");
  });
});

describe("rule order", () => {
  it("lets a published list include a domain that would otherwise look alike", () => {
    const list = `# Recruiting fraud notice\n\n${"Acme is an equipment maker. ".repeat(10)}\n\nAcme recruiters only email candidates from acme.example or acme-careers.example.`;
    const r = report(
      withSender("hr@acme-careers.example", { reads: acmeReads({ fraudText: list }) }),
    );
    expect(r.verdict).toBe("no_red_flags");
  });
});
