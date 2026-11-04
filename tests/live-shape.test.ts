// The azjobconnection.gov posting layout that failed live, run through the
// whole check with the real Parallel client (parallel.ts) and a stubbed
// fetch, so response mapping is exercised too. Fictional names only.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseJobLink } from "@/lib/check/job-link";
import { runCheck } from "@/lib/check/run";
import type { CheckReport } from "@/lib/check/types";

const LINK = "https://www.azjobconnection.gov/jobs/7630570";
const SHORT = "https://careers.northwind.example/3869AO";
const FINAL = "https://careers.northwind.example/jobs/product-designer-3869";
const FILLER =
  "Northwind Group places designers and engineers with technology companies across the Southwest. " +
  "Every role we recruit for is listed on our own careers site, and we never charge candidates.";

const POSTING_WITH_TABS = `# Product Designer

at Northwind Group in Phoenix, Arizona, United States

+ Job Details
+ Recommended Jobs
+ Similar Jobs

## Job Description

Our client seeks a product designer to shape its customer apps. Northwind Group places designers and engineers with technology companies across the Southwest.

Shortcut: careers.northwind.example/3869AO

## Recommended Jobs

# Graphic Designer

at Globex in Tempe, Arizona, United States

Please Wait`;

const POSTING = `# Product Designer

at Northwind Group in Phoenix, Arizona, United States

## Job Description

Our client seeks a product designer to shape its customer apps. ${FILLER}

Shortcut: careers.northwind.example/3869AO

[How to Apply](https://www.azjobconnection.gov/jobs/7630570/apply)

Please Wait`;

type ExtractResult = { url: string; title?: unknown; publish_date?: unknown; full_content?: unknown };
type Behaviour = {
  // What a read of the short careers link returns.
  careers: "redirect" | "error" | "loading" | "network";
  // The search API refuses the domain filter even in the right place.
  refuseDomainFilter?: boolean;
  // Search results with missing or wrongly typed fields.
  oddResults?: boolean;
  // The posting has "+ Recommended Jobs" tab labels above its description.
  tabs?: boolean;
};

let bodies: Array<{ url: string; body: Record<string, unknown> }> = [];

function stubParallel(b: Behaviour) {
  vi.stubEnv("PARALLEL_API_KEY", "test-key-123");
  bodies = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    bodies.push({ url, body });
    if (url.endsWith("/search")) {
      const settings = body.advanced_settings as Record<string, unknown> | undefined;
      // Like the real API: source_policy at the top level is refused.
      if (body.source_policy) return new Response("{}", { status: 422 });
      if (b.refuseDomainFilter && settings?.source_policy) return new Response("{}", { status: 422 });
      const queries = body.search_queries as string[];
      if (!queries.some((q) => q.includes("official website"))) return Response.json({ results: [] });
      return Response.json({
        results: [
          { url: "https://www.northwind.example/", title: "Northwind Group | Technology recruiting", excerpts: ["Northwind Group places designers."] },
          { url: "https://www.northwind.example/about", title: "About Northwind Group", excerpts: ["Northwind Group was founded in Phoenix."] },
          // Off-domain results a refused filter lets through.
          { url: "https://northwind-holdings.example/", title: "Northwind Group Holdings", excerpts: ["Northwind Group Holdings"] },
          ...(b.oddResults
            ? [{ url: null, title: 7, excerpts: null }, { title: "No URL" }, { url: "not a url", excerpts: [3] }]
            : []),
        ],
      });
    }
    // Extract
    const urls = body.urls as string[];
    const results: ExtractResult[] = [];
    const errors: Array<{ url: string; error_type: string; http_status_code: number | null }> = [];
    for (const u of urls) {
      if (u === LINK) {
        results.push({ url: u, title: "Product Designer - AZ Job Connection", full_content: b.tabs ? POSTING_WITH_TABS : POSTING });
      }
      else if (u === SHORT) {
        if (b.careers === "network") throw new TypeError("fetch failed");
        if (b.careers === "redirect") {
          results.push({ url: FINAL, title: "Product Designer | Northwind Group", full_content: `# Product Designer\n\n${FILLER}\n\nApply now.` });
        } else if (b.careers === "loading") {
          results.push({ url: u, title: 7, publish_date: 20261101, full_content: `# Careers\n\n${FILLER}\n\nPlease Wait` });
        } else errors.push({ url: u, error_type: "fetch_error", http_status_code: 404 });
      } else if (u.startsWith("https://www.northwind.example/")) {
        results.push({ url: u, full_content: `# Northwind Group\n\n${FILLER}` });
      } else errors.push({ url: u, error_type: "fetch_error", http_status_code: 403 });
    }
    return Response.json({ results, errors });
  });
}

const check = () =>
  runCheck({
    company: null,
    website: null,
    senderAddress: null,
    senderDomain: null,
    locale: "en-us",
    jobLink: parseJobLink(LINK),
    jobTitle: null,
  }) as Promise<CheckReport>;

const UNNAMED =
  "The client company isn't named. Northwind Group posted this job for a client it doesn't name, so only Northwind Group was checked.";

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("the live azjobconnection.gov layout", () => {
  it("follows the bare short link, even when it redirects, and finds the job", async () => {
    stubParallel({ careers: "redirect" });
    const r = await check();
    expect(r.status).toBe("ok");
    expect(r.companyName).toBe("Northwind Group");
    expect(r.officialDomain).toBe("northwind.example");
    expect(r.job).toMatchObject({ site: "azjobconnection.gov", unnamedClient: true, careers: "listed", careersUrl: SHORT });
    expect(r.couldntFind.map((c) => c.text)).toContain(UNNAMED);
    // The search was pinned to the domain the posting links to.
    const official = bodies.find((x) => (x.body.search_queries as string[] | undefined)?.includes("Northwind Group official website careers"));
    expect(official?.body.advanced_settings).toEqual({
      max_results: 10,
      source_policy: { include_domains: ["northwind.example"] },
    });
    // The domain filter worked the first time: no unfiltered retry.
    expect(bodies.filter((x) => (x.body.search_queries as string[] | undefined)?.includes("Northwind Group official website careers"))).toHaveLength(1);
  });

  it("isn't cut off by a '+ Recommended Jobs' tab above the description", async () => {
    stubParallel({ careers: "redirect", tabs: true });
    const r = await check();
    expect(r.status).toBe("ok");
    expect(r.companyName).toBe("Northwind Group");
    expect(r.job).toMatchObject({ unnamedClient: true, careersUrl: SHORT });
    expect(r.couldntFind.map((c) => c.text)).toContain(UNNAMED);
    // The recommended jobs after the description are still left out.
    expect(JSON.stringify(r)).not.toMatch(/globex|graphic designer/i);
  });

  it("still returns the result when the careers read fails", async () => {
    stubParallel({ careers: "error" });
    const r = await check();
    expect(r.status).toBe("ok");
    expect(r.job?.careers).toBe("couldnt_check");
    expect(r.couldntFind).toEqual(
      expect.arrayContaining([
        { kind: "couldnt_check", text: "Couldn't read careers.northwind.example/3869AO.", url: SHORT },
        { kind: "couldnt_check", text: "Couldn't read Northwind Group's own careers page or job board to look for this job.", url: null },
        { kind: "couldnt_check", text: UNNAMED, url: null },
      ]),
    );
  });

  it("still returns the result when the careers read can't reach the API", async () => {
    stubParallel({ careers: "network" });
    const r = await check();
    expect(r.status).toBe("ok");
    expect(r.job?.careers).toBe("couldnt_check");
  });

  it("doesn't call a role missing from a page that was still loading", async () => {
    stubParallel({ careers: "loading" });
    const r = await check();
    expect(r.status).toBe("ok");
    expect(r.job?.careers).toBe("couldnt_check");
    expect(r.reasons.some((x) => x.text.includes("isn't listed"))).toBe(false);
  });

  it("falls back to an unfiltered search, keeping only the claimed domain, when the domain filter is refused", async () => {
    stubParallel({ careers: "redirect", refuseDomainFilter: true });
    const r = await check();
    expect(r.status).toBe("ok");
    expect(r.officialDomain).toBe("northwind.example");
    expect(r.sources.some((s) => s.url.includes("northwind-holdings.example"))).toBe(false);
  });

  it("copes with search results that have missing or wrongly typed fields", async () => {
    stubParallel({ careers: "redirect", oddResults: true });
    const r = await check();
    expect(r.status).toBe("ok");
    expect(r.sources.every((s) => /^https?:\/\//.test(s.url))).toBe(true);
  });
});
