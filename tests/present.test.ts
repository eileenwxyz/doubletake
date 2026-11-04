import { describe, expect, it } from "vitest";
import {
  citedSources,
  formatCheckedAt,
  groupSources,
  interpretResponse,
  shortUrl,
  showChecksLeft,
  splitDomains,
} from "@/lib/present";
import { STATUS } from "@/lib/copy";

describe("domains in sentences", () => {
  it("marks domains and email addresses for the mono font", () => {
    expect(
      splitDomains("The sender's domain acme-careers.example imitates acme.example."),
    ).toEqual([
      { text: "The sender's domain ", mono: false },
      { text: "acme-careers.example", mono: true },
      { text: " imitates ", mono: false },
      { text: "acme.example", mono: true },
      { text: ".", mono: false },
    ]);
    expect(splitDomains("Write to security@acme.example today.")[1]).toEqual({
      text: "security@acme.example",
      mono: true,
    });
  });

  it("keeps a path but not the full stop after it", () => {
    expect(splitDomains("Couldn't read acme.example/jobs.")).toEqual([
      { text: "Couldn't read ", mono: false },
      { text: "acme.example/jobs", mono: true },
      { text: ".", mono: false },
    ]);
  });

  it("leaves ordinary sentences alone", () => {
    expect(splitDomains("Scammers have used this name.")).toEqual([
      { text: "Scammers have used this name.", mono: false },
    ]);
  });
});

describe("formatting", () => {
  it("shows the check time in the given time zone", () => {
    const iso = "2026-11-03T15:42:00.000Z";
    // Some ICU versions put a narrow no-break space before AM/PM.
    const at = (tz: string) => formatCheckedAt(iso, "en-US", tz).replace(/\s/g, " ");
    expect(at("America/New_York")).toBe("Nov 3, 2026, 10:42 AM");
    expect(at("Asia/Tokyo")).toBe("Nov 4, 2026, 12:42 AM");
  });

  it("shortens source links", () => {
    expect(shortUrl("https://www.acme.example/recruiting-fraud/")).toBe(
      "acme.example/recruiting-fraud",
    );
    expect(shortUrl("https://careers.acme.example/")).toBe("careers.acme.example");
  });

  it("groups sources by type in a fixed order with counts", () => {
    const groups = groupSources([
      { url: "https://r.example/1", type: "Report", publishDate: null },
      { url: "https://acme.example/", type: "Official", publishDate: null },
      { url: "https://r.example/2", type: "Report", publishDate: null },
    ]);
    expect(groups.map((g) => [g.type, g.sources.length])).toEqual([
      ["Official", 1],
      ["Report", 2],
    ]);
  });

  it("counts the distinct sources the reasons cite", () => {
    const reason = (sourceUrl: string | null) => ({
      direction: "neutral" as const,
      text: "x",
      sourceType: "Other" as const,
      sourceUrl,
      age: "Date unknown",
    });
    expect(citedSources([reason("https://a.example"), reason("https://a.example"), reason(null)])).toBe(1);
  });
});

describe("near the limit", () => {
  it("shows the line at 3 or fewer checks left", () => {
    expect(showChecksLeft(null)).toBe(false);
    expect(showChecksLeft(4)).toBe(false);
    expect(showChecksLeft(3)).toBe(true);
    expect(showChecksLeft(0)).toBe(true);
    expect(STATUS.checksLeft(3)).toBe("3 checks left today");
    expect(STATUS.checksLeft(1)).toBe("1 check left today");
  });
});

describe("API responses", () => {
  it("reads a result and the checks left", () => {
    const outcome = interpretResponse(200, { status: "ok", verdict: "mixed", checksRemaining: 2 });
    expect(outcome.kind).toBe("result");
    expect(outcome.kind === "result" && outcome.checksRemaining).toBe(2);
  });

  it("reads need-more-detail", () => {
    expect(interpretResponse(200, { status: "need_more_detail", message: "m", checksRemaining: null })).toEqual({
      kind: "need_detail",
      message: "m",
      checksRemaining: null,
    });
  });

  it("tells the daily limit from the monthly cap", () => {
    expect(interpretResponse(429, { error: "e", limit: "daily" })).toEqual({
      kind: "limit",
      which: "daily",
      message: "e",
    });
    expect(
      interpretResponse(429, {
        error: "Doubletake has reached its limit for this month. Try again on the 1st.",
      }),
    ).toMatchObject({ kind: "limit", which: "monthly" });
  });

  it("shows input errors and treats everything else as a retryable error", () => {
    expect(interpretResponse(400, { error: "Enter a valid email address." })).toEqual({
      kind: "invalid",
      message: "Enter a valid email address.",
    });
    expect(interpretResponse(502, { error: "Something went wrong. Try again." })).toEqual({ kind: "error" });
    expect(interpretResponse(503, null)).toEqual({ kind: "error" });
  });
});
