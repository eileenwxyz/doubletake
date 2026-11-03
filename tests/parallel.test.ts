import { afterEach, describe, expect, it, vi } from "vitest";
import { extract, toPageReads } from "@/lib/parallel";

const LONG = "Acme recruiters only contact candidates from the @acme.example domain. ".repeat(5);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("Extract results", () => {
  const pages = [
    { url: "https://careers.acme.example/", role: "careers" as const },
    { url: "https://www.acme.example/recruiting-fraud", role: "fraud" as const },
    { url: "https://www.acme.example/", role: "home" as const },
  ];

  it("treats errors, missing pages and near-empty text as couldn't read", () => {
    const reads = toPageReads(pages, {
      results: [
        { url: "https://careers.acme.example", full_content: LONG, publish_date: "2026-10-30" },
        { url: "https://www.acme.example/recruiting-fraud", full_content: "  Loading…  " },
      ],
      errors: [{ url: "https://www.acme.example/", error_type: "fetch_error", http_status_code: 403 }],
    });
    expect(reads.map((r) => r.ok)).toEqual([true, false, false]);
    expect(reads[0].publishDate).toBe("2026-10-30");
    expect(reads[1].text).toBe("");
  });

  it("treats a failed call as every page unreadable", () => {
    expect(toPageReads(pages, null).every((r) => !r.ok)).toBe(true);
  });

  it("sends the SDK's request format with the freshness limit", async () => {
    vi.stubEnv("PARALLEL_API_KEY", "test-key");
    const fetchMock = vi.fn(async () =>
      Response.json({ results: [], errors: [], extract_id: "x", session_id: "y" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await extract([pages[0]], 600, "objective");

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.parallel.ai/v1/extract");
    expect(JSON.parse(init.body as string)).toEqual({
      urls: ["https://careers.acme.example/"],
      objective: "objective",
      advanced_settings: {
        full_content: { max_chars_per_result: 20000 },
        fetch_policy: { max_age_seconds: 600 },
      },
    });
  });

  it("reports an upstream failure as unreadable pages", async () => {
    vi.stubEnv("PARALLEL_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("boom", { status: 500 })));
    const reads = await extract([pages[1]], 86400, "objective");
    expect(reads).toEqual([
      { url: pages[1].url, role: "fraud", ok: false, title: null, publishDate: null, text: "" },
    ]);
  });
});
