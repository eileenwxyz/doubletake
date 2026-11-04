import { describe, expect, it } from "vitest";
import { buildReport, formatAge } from "@/lib/check/report";
import { findRecruitingList, properName, tidyName } from "@/lib/check/text";
import type { CheckReport } from "@/lib/check/types";
import { acmeInput, acmeReads, hit, read, unreadable, withSender, NOW } from "./fixtures";

const ok = (input: Parameters<typeof buildReport>[0]) => buildReport(input) as CheckReport;

describe("recruiting list", () => {
  it("reads 'only verified email domains' with a bulleted list", () => {
    const text =
      "Our recruiters only use these verified email domains:\n- acme.example\n- acmejobs.example\n\nThanks for your interest.";
    expect(findRecruitingList(text)).toEqual({
      entries: ["acme.example", "acmejobs.example"],
      quote: "Our recruiters only use these verified email domains: acme.example acmejobs.example",
    });
  });

  it("keeps role addresses but never a person's address", () => {
    const list = findRecruitingList(
      "Recruiters only email candidates from recruiting@acme.example or jordan.lee@acme.example.",
    );
    expect(list?.entries).toEqual(["recruiting@acme.example", "acme.example"]);
    expect(list?.quote).toBeNull();
  });

  it("skips free email domains and negated domains", () => {
    expect(
      findRecruitingList(
        "Acme only contacts candidates from @acme.example, never from gmail.com or outlook.com.",
      )?.entries,
    ).toEqual(["acme.example"]);
  });

  it("needs a recruiting context and a limiting word", () => {
    expect(findRecruitingList("Email us at press@acme.example for media questions.")).toBeNull();
  });
});

describe("verdict without an email", () => {
  it("is no red flags with the company-only subtitle", () => {
    const r = ok(acmeInput({ reads: acmeReads().filter((p) => p.role !== "fraud") }));
    expect(r.verdict).toBe("no_red_flags");
    expect(r.subtitle).toBe("Company-only check: no recruiter email was given.");
  });

  it("is not enough when nothing official was found", () => {
    const r = ok(
      acmeInput({
        company: "Globex",
        officialHits: [hit("https://news.example/x", "Something", "Unrelated")],
        reads: [],
      }),
    );
    expect(r.verdict).toBe("not_enough");
    expect(r.officialDomain).toBeNull();
  });

  it("is not enough when there is little beyond the domain itself", () => {
    const r = ok(
      withSender("hr@acme.example", {
        website: "acme.example",
        officialHits: [],
        reads: [read("https://acme.example/", "home", `# Acme\n\n${"Acme sells things. ".repeat(20)}`)],
      }),
    );
    expect(r.verdict).toBe("not_enough");
  });
});

describe("unreadable official page", () => {
  it("lists it under couldn't check and never as 'nothing there'", () => {
    const r = ok(
      acmeInput({
        reads: [
          unreadable("https://www.acme.example/recruiting-fraud", "fraud"),
          unreadable("https://careers.acme.example/", "careers"),
          unreadable("https://www.acme.example/", "home"),
        ],
      }),
    );
    expect(r.couldntFind.map((c) => c.kind)).toEqual([
      "couldnt_check",
      "couldnt_check",
      "couldnt_check",
    ]);
    // No page was read, so nothing is reported as "not published".
    expect(r.couldntFind.some((c) => c.kind === "not_published")).toBe(false);
    expect(r.subtitle).toBe("Some pages couldn't be checked.");
    expect(r.companySays).toBeNull();
  });

  it("never lists 'no scam reports found'", () => {
    const r = ok(withSender("recruiter@acme.example"));
    expect(JSON.stringify(r.couldntFind).toLowerCase()).not.toContain("scam report");
  });
});

describe("reasons and sources", () => {
  it("returns at most 3 reasons with unique URLs, ranked sender first", () => {
    const r = ok(withSender("recruiter@acme.example"));
    expect(r.reasons).toHaveLength(3);
    const urls = r.reasons.map((x) => x.sourceUrl);
    expect(new Set(urls).size).toBe(urls.length);
    for (const reason of r.reasons) {
      expect(["reassures", "caution", "neutral"]).toContain(reason.direction);
      expect(reason.age).toMatch(/^(Published \d{4}-\d{2}-\d{2}.*|Date unknown)$/);
    }
  });

  it("removes duplicate source URLs", () => {
    const r = ok(
      acmeInput({
        officialHits: [
          ...acmeInput().officialHits,
          hit("https://careers.acme.example/?utm_source=newsletter", "Careers at Acme", "Acme"),
          hit("https://CAREERS.acme.example", "Careers at Acme", "Acme"),
        ],
      }),
    );
    const careers = r.sources.filter((s) => s.url.toLowerCase().includes("careers.acme.example"));
    expect(careers).toHaveLength(1);
  });

  it("never includes personal email addresses or profile pages", () => {
    const r = ok(
      withSender("jordan.lee@gmail.com", {
        officialHits: [
          ...acmeInput().officialHits,
          hit("https://www.linkedin.com/in/jordan-lee", "Jordan Lee - Recruiter at Acme", "Acme"),
        ],
        reads: acmeReads({
          fraudText:
            "# Fraud\n\n" +
            "Scammers impersonate Acme. ".repeat(10) +
            "\n\nAcme recruiters only contact candidates from @acme.example, such as jordan.lee@acme.example.",
        }),
      }),
    );
    const json = JSON.stringify(r);
    expect(json).not.toContain("jordan");
    expect(json).not.toContain("Jordan");
    expect(r.companySays).toBeNull();
  });

  it("fills reasons from templates, not page text", () => {
    const r = ok(withSender("recruiter@acme.example"));
    for (const reason of r.reasons) {
      expect(reason.text).not.toContain("Scammers sometimes impersonate");
    }
  });
});

describe("content age", () => {
  it("formats publish dates and unknown dates", () => {
    expect(formatAge(null, NOW)).toBe("Date unknown");
    expect(formatAge("2026-11-03", NOW)).toBe("Published 2026-11-03 (today)");
    expect(formatAge("2026-10-30", NOW)).toBe("Published 2026-10-30 (4 days ago)");
    expect(formatAge("2023-01-01", NOW)).toBe("Published 2023-01-01 (3 years ago)");
    expect(formatAge("not a date", NOW)).toBe("Date unknown");
  });
});

describe("recruiting list wording", () => {
  it("reads 'only contact candidates from' with bare domains", () => {
    expect(
      findRecruitingList(
        "Acme recruiters only contact candidates from acme.example or talentbridge-hiring.example.",
      )?.entries,
    ).toEqual(["acme.example", "talentbridge-hiring.example"]);
  });
});

describe("the company's proper name", () => {
  const nimbus = (titles: { home?: string | null; careers?: string | null } = {}) =>
    withSender("recruiter@nimbuslabs.example", {
      company: "nimbus labs",
      website: "nimbuslabs.example",
      officialHits: [
        hit("https://nimbuslabs.example/", titles.home ?? null, "NimbusLabs builds cloud tools."),
        hit("https://nimbuslabs.example/careers", titles.careers ?? null, "Join NimbusLabs."),
      ],
      reads: [
        { ...read("https://nimbuslabs.example/", "home", `# NimbusLabs\n\n${"NimbusLabs builds cloud tools. ".repeat(10)}`), title: titles.home ?? null },
        { ...read("https://nimbuslabs.example/careers", "careers", `# Careers\n\n${"Join NimbusLabs. ".repeat(15)}`), title: titles.careers ?? null },
      ],
    });

  it("uses the name from the official site's page titles in reasons", () => {
    const r = ok(nimbus({ home: "NimbusLabs | Cloud tools", careers: "Careers at NimbusLabs" }));
    expect(r.reasons[0].text).toBe(
      "The sender's domain nimbuslabs.example belongs to NimbusLabs's official domain nimbuslabs.example.",
    );
    expect(JSON.stringify(r)).not.toContain("nimbus labs");
  });

  it("falls back to the typed name with its capitalisation tidied", () => {
    const r = ok(nimbus());
    expect(r.reasons[0].text).toContain("Nimbus Labs's official domain");
    const none = ok(acmeInput({ company: "globex   robotics", officialHits: [], reads: [] }));
    expect(none.couldntFind).toContainEqual(
      expect.objectContaining({ text: "No official website for Globex Robotics was found." }),
    );
  });

  it("picks the spelling titles agree on and ignores other names", () => {
    expect(properName("att", ["AT&T Careers", "Home | AT&T", "Contact us"])).toBe("AT&T");
    expect(properName("acme", ["Careers at ACME", "Acme | Home", "Acme: news"])).toBe("Acme");
    expect(properName("acme", ["Acme Robotics, Inc. | Home"])).toBe("Acme");
    expect(properName("acme", ["Globex | Home", null])).toBe("Acme");
    expect(tidyName("eBay")).toBe("eBay");
    expect(tidyName("IBM")).toBe("IBM");
    expect(tidyName("  acme   robotics ")).toBe("Acme Robotics");
  });
});
