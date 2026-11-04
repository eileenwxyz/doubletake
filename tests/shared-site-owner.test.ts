// A large shared site can still be the official domain of the company it is
// named after. The shared-site list is extended here with a fictional
// network, chirpline.example, so no real company appears in the fixtures.
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/check/domain-lists", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/check/domain-lists")>();
  return { ...actual, SHARED_SITES: new Set([...actual.SHARED_SITES, "chirpline.example"]) };
});

const { buildReport } = await import("@/lib/check/report");
const { findOfficialDomain, ownsSharedSite } = await import("@/lib/check/official");
const { hit, read, NOW } = await import("./fixtures");
import type { CheckReport } from "@/lib/check/types";

const FILLER = "Chirpline is a social network for short posts, used by millions of people every day. ";

const CHIRPLINE_HITS = [
  hit("https://chirpline.example/", "Chirpline", `Chirpline. ${FILLER}`),
  hit("https://careers.chirpline.example/", "Careers at Chirpline", "Join Chirpline. See open roles."),
  hit("https://chirpline.example/about", "About Chirpline", `About Chirpline. ${FILLER}`),
];

describe("the owner of a shared site", () => {
  it("owns the shared site whose label is its core name, and no one else does", () => {
    expect(ownsSharedSite("chirpline.example", "Chirpline")).toBe(true);
    expect(ownsSharedSite("chirpline.example", "Chirpline Inc.")).toBe(true);
    expect(ownsSharedSite("chirpline.example", "Chirpline Bakery")).toBe(false);
    expect(ownsSharedSite("chirpline-fans.example", "Chirpline")).toBe(false);
  });

  it("finds the shared site as the official domain for its owner", () => {
    expect(findOfficialDomain("Chirpline", null, CHIRPLINE_HITS)).toEqual({
      status: "found",
      domain: "chirpline.example",
      from: "search",
    });
  });

  it("still skips the shared site for another company that has pages on it", () => {
    const hits = [
      hit("https://chirpline.example/acmebakery", "Acme Bakery (@acmebakery) | Chirpline", "Acme Bakery posts."),
      hit("https://chirpline.example/acmebakery/status/1", "Acme Bakery on Chirpline", "Acme Bakery is hiring."),
    ];
    expect(findOfficialDomain("Acme Bakery", null, hits).status).toBe("none");
  });

  it("is a strong warning when a free email claims to be from that company", () => {
    const r = buildReport({
      company: "Chirpline",
      website: null,
      senderAddress: "chirpline@gmail.com",
      senderDomain: "gmail.com",
      officialHits: CHIRPLINE_HITS,
      warningHits: [],
      reads: [
        read("https://careers.chirpline.example/", "careers", `# Careers at Chirpline\n\n${FILLER.repeat(3)}`),
        read("https://chirpline.example/", "home", `# Chirpline\n\n${FILLER.repeat(3)}`),
      ],
      now: NOW,
    }) as CheckReport;
    expect(r.officialDomain).toBe("chirpline.example");
    expect(r.verdict).toBe("strong_warning");
    expect(r.reasons[0].text).toBe(
      "gmail.com is a free email service, but Chirpline has its own domain, chirpline.example.",
    );
  });
});
