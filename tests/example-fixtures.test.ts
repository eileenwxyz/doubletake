import { describe, expect, it } from "vitest";
import { EXAMPLE_RESULTS } from "@/lib/examples";
import { hostOf } from "@/lib/check/domains";

describe("example results", () => {
  it("has one example per verdict", () => {
    expect(EXAMPLE_RESULTS.map((e) => e.report.verdict)).toEqual([
      "strong_warning",
      "mixed",
      "no_red_flags",
      "not_enough",
    ]);
    for (const { id, report } of EXAMPLE_RESULTS) expect(report.verdict).toBe(id);
  });

  it("uses only fictional .example domains", () => {
    for (const { report } of EXAMPLE_RESULTS) {
      const json = JSON.stringify(report);
      const urls = [...json.matchAll(/https?:\/\/[^"\s]+/g)].map((m) => m[0]);
      expect(urls.length).toBeGreaterThan(0);
      for (const url of urls) expect(hostOf(url)).toMatch(/\.example$/);
      const domains = [...json.matchAll(/\b(?:[a-z0-9-]+\.)+[a-z]{2,}\b/gi)].map((m) => m[0]);
      for (const domain of domains) expect(domain.toLowerCase()).toMatch(/\.example$/);
    }
  });

  it("has every field the result page reads", () => {
    for (const { report } of EXAMPLE_RESULTS) {
      expect(report.status).toBe("ok");
      expect(report.companyName).not.toBe("");
      expect(Number.isNaN(new Date(report.checkedAt).getTime())).toBe(false);
      expect(report.reasons.length).toBeGreaterThan(0);
      expect(report.reasons.length).toBeLessThanOrEqual(3);
      expect(report.searches.length).toBeGreaterThan(0);
      expect(Array.isArray(report.sources)).toBe(true);
      expect(Array.isArray(report.couldntFind)).toBe(true);
      for (const r of report.reasons) {
        expect(["reassures", "caution", "neutral"]).toContain(r.direction);
        if (r.sourceUrl) expect(report.sources.map((s) => s.url)).toContain(r.sourceUrl);
      }
      if (report.nextStep) expect(["fraud", "careers", "site"]).toContain(report.nextStep.kind);
    }
  });

  it("shows a look-alike domain in the strong-warning example", () => {
    const strong = EXAMPLE_RESULTS[0].report;
    expect(strong.lookalike).toEqual({
      sender: "northwind-freight.example",
      imitates: "northwindfreight.example",
    });
  });
});
