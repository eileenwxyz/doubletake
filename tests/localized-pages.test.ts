// Translated copies of one page on the official domain count once. Every
// company here is fictional and every company domain uses the reserved
// .example suffix.
import { describe, expect, it } from "vitest";
import { pageKey } from "@/lib/check/domains";
import { planReads } from "@/lib/check/official";
import { buildReport } from "@/lib/check/report";
import type { CheckReport } from "@/lib/check/types";
import { hit, NOW, read } from "./fixtures";

const DE = "https://www.acme.example/de-de/karriere/betrug";
const EN = "https://www.acme.example/en-us/careers/fraud";
const FR = "https://www.acme.example/fr-fr/carrieres/fraude";
const HOME = "https://www.acme.example/";

const FILLER =
  "Acme designs and builds industrial anvils, rockets and other equipment for customers around the world. " +
  "Scammers sometimes impersonate Acme recruiters.";

describe("translated page addresses", () => {
  it("give copies of one page the same key", () => {
    expect(pageKey(DE)).toBe(pageKey(EN));
    expect(pageKey(FR)).toBe(pageKey(EN));
    expect(pageKey("https://www.acme.example/de-de/ueber-uns")).toBe(pageKey("https://www.acme.example/en-gb/about"));
  });

  it("keep different pages apart", () => {
    expect(pageKey("https://www.acme.example/de-de/karriere/jobs/123")).not.toBe(
      pageKey("https://www.acme.example/en-us/careers/jobs/456"),
    );
    expect(pageKey(DE)).not.toBe(pageKey("https://www.acme.example/en-us/careers"));
  });
});

function input(locale: string) {
  return {
    company: "Acme",
    website: null,
    senderAddress: null,
    senderDomain: null,
    officialHits: [
      hit(DE, "Betrugswarnung | Acme", `Acme. ${FILLER}`),
      hit(EN, "Recruiting fraud | Acme", `Acme. ${FILLER}`),
      hit(HOME, "Acme | Industrial equipment", `Acme. ${FILLER}`),
    ],
    warningHits: [],
    reads: [read(HOME, "home" as const, `# Acme\n\n${FILLER}`)],
    now: NOW,
    locale,
  };
}

describe("a page found in several languages", () => {
  it("is counted and shown once, in the user's language", () => {
    const r = buildReport(input("en-us")) as CheckReport;
    const official = r.sources.filter((s) => s.type === "Official").map((s) => s.url);
    expect(official).toEqual([EN, HOME]);
    // Two distinct official pages, not three.
    expect(r.verdict).toBe("no_red_flags");
  });

  it("uses another language only when the user's isn't there", () => {
    const de = buildReport(input("de-de")) as CheckReport;
    expect(de.sources.map((s) => s.url)).toContain(DE);
    expect(de.sources.map((s) => s.url)).not.toContain(EN);

    const onlyGerman = { ...input("en-us"), officialHits: input("en-us").officialHits.filter((h) => h.url !== EN) };
    const r = buildReport(onlyGerman) as CheckReport;
    expect(r.sources.map((s) => s.url)).toContain(DE);
  });

  it("is read once", () => {
    const planned = planReads("Acme", "acme.example", input("en-us").officialHits, [], "en-us");
    expect(planned.map((p) => p.url)).toEqual([EN, HOME]);
  });

  it("isn't enough evidence on its own", () => {
    const thin = { ...input("en-us"), officialHits: input("en-us").officialHits.filter((h) => h.url !== HOME), reads: [] };
    expect((buildReport(thin) as CheckReport).verdict).toBe("not_enough");
  });
});
