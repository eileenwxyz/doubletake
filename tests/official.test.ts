import { describe, expect, it } from "vitest";
import {
  dedupeByUrl,
  isLookalike,
  normalizeUrl,
  pageKey,
  preferredLocale,
  registrableDomain,
} from "@/lib/check/domains";
import { findOfficialDomain, planReads } from "@/lib/check/official";
import { buildReport } from "@/lib/check/report";
import { ACME_OFFICIAL_HITS, hit, NOW } from "./fixtures";

describe("registrable domain (Public Suffix List)", () => {
  it("gives a scam domain with the official domain at the front to its real owner", () => {
    expect(registrableDomain("jobs.acme.example.scam.example")).toBe("scam.example");
  });

  it("gives each vercel.app site its own owner", () => {
    expect(registrableDomain("https://acme.vercel.app/careers")).toBe("acme.vercel.app");
    expect(registrableDomain("anything.vercel.app")).toBe("anything.vercel.app");
  });

  it("handles subdomains and multi-part suffixes", () => {
    expect(registrableDomain("careers.acme.example")).toBe("acme.example");
    expect(registrableDomain("www.scamwatch.gov.au")).toBe("scamwatch.gov.au");
  });
});

describe("look-alikes", () => {
  it.each([
    "careers-acme.example",
    "acme-jobs.example",
    "acmecareers.example",
    "acmee.example",
    "acme.vercel.app",
    "jobs.acme.example.scam.example",
  ])("%s imitates acme.example", (host) => {
    expect(isLookalike(host, "acme.example", "Acme")).toBe(true);
  });

  it.each(["acme.example", "careers.acme.example", "globex.example", "lever.co"])(
    "%s does not",
    (host) => {
      expect(isLookalike(host, "acme.example", "Acme")).toBe(false);
    },
  );
});

describe("duplicate URLs", () => {
  it("ignores case, trailing slashes, www and tracking parameters", () => {
    expect(normalizeUrl("https://WWW.Acme.example/Careers/?utm_source=x&gclid=1")).toBe(
      normalizeUrl("https://acme.example/careers"),
    );
    expect(normalizeUrl("https://acme.example/a?id=1")).not.toBe(normalizeUrl("https://acme.example/a?id=2"));
    expect(
      dedupeByUrl([
        { url: "https://acme.example/careers/" },
        { url: "https://acme.example/Careers?utm_medium=email" },
        { url: "https://acme.example/about" },
      ]),
    ).toHaveLength(2);
  });

  it("strips inav and intlink parameters", () => {
    expect(normalizeUrl("https://acme.example/careers?inav=menu&intlink=footer")).toBe(
      normalizeUrl("https://acme.example/careers"),
    );
    expect(normalizeUrl("https://acme.example/careers?INAV=1&team=eng")).toBe(
      normalizeUrl("https://acme.example/careers?team=eng"),
    );
  });

  it("treats language and region copies of a page as one source", () => {
    expect(pageKey("https://www.acme.example/en-us/careers/security")).toBe(
      pageKey("https://acme.example/DE-DE/careers/security/"),
    );
    // A different remaining path is a different page.
    expect(pageKey("https://acme.example/en-us/careers")).not.toBe(pageKey("https://acme.example/en-us/about"));
    // Only a leading xx-yy segment is a locale.
    expect(pageKey("https://acme.example/blog/en-us")).not.toBe(pageKey("https://acme.example/blog"));

    const copies = [
      { url: "https://acme.example/de-de/careers/security" },
      { url: "https://acme.example/en-gb/careers/security" },
      { url: "https://acme.example/en-us/careers/security?inav=nav" },
      { url: "https://acme.example/about" },
    ];
    // Defaults to en-us and keeps first-seen order.
    expect(dedupeByUrl(copies).map((c) => c.url)).toEqual([
      "https://acme.example/en-us/careers/security?inav=nav",
      "https://acme.example/about",
    ]);
    expect(dedupeByUrl(copies, "en-gb")[0].url).toBe("https://acme.example/en-gb/careers/security");
    expect(dedupeByUrl(copies, "de-de")[0].url).toBe("https://acme.example/de-de/careers/security");
    // Same language, other region, before the default.
    expect(dedupeByUrl(copies, "de-at")[0].url).toBe("https://acme.example/de-de/careers/security");
  });

  it("reads the user's locale from Accept-Language, defaulting to en-us", () => {
    expect(preferredLocale("en-GB,en;q=0.9")).toBe("en-gb");
    expect(preferredLocale("de-DE")).toBe("de-de");
    expect(preferredLocale("fr")).toBe("en-us");
    expect(preferredLocale(null)).toBe("en-us");
  });

  it("plans one read per localised page, in the user's locale", () => {
    const hits = [
      hit("https://acme.example/en-us/recruiting-fraud", "Recruiting fraud | Acme", "Acme"),
      hit("https://acme.example/en-gb/recruiting-fraud", "Recruiting fraud | Acme", "Acme"),
      hit("https://acme.example/de-de/recruiting-fraud", "Recruiting fraud | Acme", "Acme"),
    ];
    expect(planReads("Acme", "acme.example", hits, [])).toEqual([
      { url: "https://acme.example/en-us/recruiting-fraud", role: "fraud" },
    ]);
    expect(planReads("Acme", "acme.example", hits, [], "en-gb")).toEqual([
      { url: "https://acme.example/en-gb/recruiting-fraud", role: "fraud" },
    ]);
  });

  it("lists localised copies once in a report's sources", () => {
    const r = buildReport({
      company: "Acme",
      website: null,
      senderAddress: null,
      senderDomain: null,
      officialHits: [
        ...ACME_OFFICIAL_HITS,
        hit("https://www.acme.example/en-gb/recruiting-fraud", "Recruiting fraud notice | Acme", "Acme"),
        hit("https://www.acme.example/de-de/recruiting-fraud?intlink=1", "Recruiting fraud notice | Acme", "Acme"),
      ],
      warningHits: [],
      reads: [],
      now: NOW,
    });
    if (r.status !== "ok") throw new Error("expected a report");
    expect(r.sources.filter((s) => s.url.includes("recruiting-fraud"))).toHaveLength(1);
  });
});

describe("finding the official domain", () => {
  it("uses the website the user entered", () => {
    expect(findOfficialDomain("Acme", "https://careers.acme.example/x", [])).toEqual({
      status: "found",
      domain: "acme.example",
      from: "website",
    });
  });

  it("uses the domain most official results share, not the top result", () => {
    const hits = [
      hit("https://acme-careers.example/apply", "Acme careers - apply now", "Acme jobs"),
      ...ACME_OFFICIAL_HITS,
    ];
    expect(findOfficialDomain("Acme", null, hits)).toMatchObject({
      status: "found",
      domain: "acme.example",
    });
  });

  it("ignores pages that don't name the company and third-party sites", () => {
    const hits = [
      hit("https://www.linkedin.com/company/acme", "Acme", "Acme"),
      hit("https://www.reddit.com/r/x/acme", "Acme", "Acme"),
      hit("https://acme.example/", "Home", "Welcome"),
    ];
    expect(findOfficialDomain("Acme", null, hits)).toEqual({ status: "none" });
  });

  it("asks for more detail when several companies use the name", () => {
    const hits = [
      hit("https://acmerobotics.example/", "Acme Robotics", "Acme builds robots."),
      hit("https://acmerobotics.example/careers", "Careers | Acme", "Join Acme."),
      hit("https://acmebakery.example/", "Acme Bakery", "Acme bakes bread."),
      hit("https://acmebakery.example/jobs", "Jobs at Acme", "Acme is hiring bakers."),
    ];
    expect(findOfficialDomain("Acme", null, hits)).toEqual({ status: "ambiguous" });
    expect(
      buildReport({
        company: "Acme",
        website: null,
        senderAddress: null,
        senderDomain: null,
        officialHits: hits,
        warningHits: [],
        reads: [],
        now: NOW,
      }),
    ).toEqual({
      status: "need_more_detail",
      message: "Several companies use this name. Add their website or the recruiter's email.",
    });
    // The recruiter's domain settles which company is meant.
    expect(findOfficialDomain("Acme", null, hits, "talent.acmebakery.example")).toMatchObject({
      status: "found",
      domain: "acmebakery.example",
    });
  });
});

describe("choosing pages to read", () => {
  it("reads up to 3 official pages, fraud and careers first, and up to 2 named warnings", () => {
    const warnings = [
      hit("https://www.reddit.com/r/scams/1", "Fake Acme recruiter scam", "Acme scam"),
      hit("https://www.reddit.com/r/scams/2", "Is Acme legit?", "scam?"),
      hit("https://forum.example/3", "Acme fraud warning", "Acme fraud"),
      hit("https://forum.example/4", "Another Acme scam", "Acme scam"),
      hit("https://forum.example/5", "Job scams in general", "scam"),
    ];
    const planned = planReads("Acme", "acme.example", ACME_OFFICIAL_HITS, warnings);
    expect(planned).toEqual([
      { url: "https://www.acme.example/recruiting-fraud", role: "fraud" },
      { url: "https://careers.acme.example/", role: "careers" },
      { url: "https://www.acme.example/", role: "home" },
      { url: "https://www.reddit.com/r/scams/1", role: "warning" },
      { url: "https://forum.example/3", role: "warning" },
    ]);
  });

  it("falls back to the home page of an entered website", () => {
    expect(planReads("Acme", "acme.example", [], [])).toEqual([
      { url: "https://acme.example/", role: "home" },
    ]);
  });
});
