// A check whose scam-warnings search fails still comes back, marked
// partial; one whose official search fails doesn't. Every company here is
// fictional and every company domain uses the reserved .example suffix.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CheckReport, PageRead, PageRole, SearchHit } from "@/lib/check/types";
import { ACME_FRAUD_TEXT, ACME_OFFICIAL_HITS } from "./fixtures";

type SearchCall = { objective: string; queries: string[] };
let failWarnings = false;
let failOfficial = false;

vi.mock("@/lib/parallel", () => ({
  search: async (objective: string, queries: string[]): Promise<SearchHit[]> => {
    const call: SearchCall = { objective, queries };
    const isWarnings = call.queries.some((q) => q.includes("job scam"));
    if (isWarnings && failWarnings) throw new Error("Search timed out");
    if (!isWarnings && failOfficial) throw new Error("Search timed out");
    return isWarnings ? [] : ACME_OFFICIAL_HITS;
  },
  extract: async (wanted: ReadonlyArray<{ url: string; role: PageRole }>): Promise<PageRead[]> =>
    wanted.map(({ url, role }) => ({
      url,
      role,
      ok: true,
      title: null,
      publishDate: null,
      text: url.includes("fraud")
        ? ACME_FRAUD_TEXT
        : "# Acme\n\nAcme makes anvils, rockets and other equipment for customers around the world, and lists every open role here.",
    })),
}));

const { runCheck } = await import("@/lib/check/run");

const check = () =>
  runCheck({ company: "Acme", website: null, senderAddress: null, senderDomain: null, locale: "en-us" });

beforeEach(() => {
  failWarnings = false;
  failOfficial = false;
});

describe("partial results", () => {
  it("returns a result when only the warnings search fails, and says so", async () => {
    failWarnings = true;
    const r = (await check()) as CheckReport;
    expect(r.status).toBe("ok");
    expect(r.officialDomain).toBe("acme.example");
    expect(r.subtitle).toBe("Part of the check didn't finish.");
    expect(r.couldntFind).toContainEqual({
      kind: "couldnt_check",
      text: "We couldn't finish searching for scam reports.",
      url: null,
    });
    // The failed search isn't listed under "How we checked".
    expect(r.searches.some((q) => q.includes("job scam") || q.includes("recruitment fraud"))).toBe(false);
  });

  it("says nothing about a partial check when every search works", async () => {
    const r = (await check()) as CheckReport;
    expect(r.subtitle).not.toBe("Part of the check didn't finish.");
    expect(r.couldntFind.some((c) => c.text.includes("scam reports"))).toBe(false);
    expect(r.searches).toContain("Acme job scam");
  });

  it("fails the check when the official search fails", async () => {
    failOfficial = true;
    await expect(check()).rejects.toThrow();
  });
});
