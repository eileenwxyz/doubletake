import { describe, expect, it } from "vitest";
import { buildReport } from "@/lib/check/report";
import type { CheckReport } from "@/lib/check/types";
import { ACME_OFFICIAL_HITS, acmeInput, acmeReads, hit, read, withSender, NOW } from "./fixtures";

const ok = (input: Parameters<typeof buildReport>[0]) => buildReport(input) as CheckReport;

describe("result page fields", () => {
  it("adds the display name, check time and searches", () => {
    const r = ok(acmeInput({ company: "acme", searches: ["acme official website careers"] }));
    expect(r.companyName).toBe("Acme");
    expect(r.checkedAt).toBe(NOW.toISOString());
    expect(r.searches).toEqual(["acme official website careers"]);
    expect(r.senderDomain).toBeNull();
    expect(r.lookalike).toBeNull();
  });

  it("returns the sender's domain but never the full address", () => {
    const r = ok(withSender("jordan.lee@acme.example"));
    expect(r.senderDomain).toBe("acme.example");
    expect(JSON.stringify(r)).not.toContain("jordan.lee");
  });

  it("points the next step at the fraud page first", () => {
    const r = ok(acmeInput());
    expect(r.nextStep).toEqual({ url: "https://www.acme.example/recruiting-fraud", kind: "fraud" });
  });

  it("falls back to the careers page, then the website", () => {
    const noFraudHits = ACME_OFFICIAL_HITS.filter((h) => !h.url.includes("fraud"));
    const careers = ok(
      acmeInput({ officialHits: noFraudHits, reads: acmeReads().filter((p) => p.role !== "fraud") }),
    );
    expect(careers.nextStep).toEqual({ url: "https://careers.acme.example/", kind: "careers" });

    const site = ok(
      acmeInput({
        officialHits: [
          hit("https://www.acme.example/", "Acme | Industrial equipment", "Acme makes anvils."),
          hit("https://www.acme.example/about", "About Acme", "Acme was founded long ago."),
        ],
        reads: [read("https://www.acme.example/", "home", `# Acme\n\n${"Acme makes anvils. ".repeat(20)}`)],
      }),
    );
    expect(site.nextStep).toEqual({ url: "https://www.acme.example/", kind: "site" });
  });

  it("has no next step without an official domain", () => {
    const r = ok(
      acmeInput({
        company: "Globex",
        officialHits: [hit("https://news.example/x", "Something", "Unrelated")],
        reads: [],
      }),
    );
    expect(r.nextStep).toBeNull();
  });

  it("names the domain a look-alike sender imitates", () => {
    const r = ok(withSender("hr@acme-careers.example"));
    expect(r.verdict).toBe("strong_warning");
    expect(r.lookalike).toEqual({ sender: "acme-careers.example", imitates: "acme.example" });
  });
});
