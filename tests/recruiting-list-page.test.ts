// Finding the company's recruiting list when the first reads miss it, and
// what "Couldn't find" says about it. Every company here is fictional and
// every company domain uses the reserved .example suffix.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildReport } from "@/lib/check/report";
import { fraudPageScore, planReads } from "@/lib/check/official";
import type { CheckReport, PageRead, PageRole, SearchHit } from "@/lib/check/types";
import { hit, read, NOW } from "./fixtures";

// ---- Fake Parallel API ----

type SearchCall = { objective: string; queries: string[]; options?: { includeDomains?: string[] } };
const calls: { search: SearchCall[]; extract: string[][] } = { search: [], extract: [] };
let pages: Record<string, { title?: string | null; text: string }> = {};
let searchResults: (call: SearchCall) => SearchHit[] = () => [];

vi.mock("@/lib/parallel", () => ({
  search: async (objective: string, queries: string[], options?: { includeDomains?: string[] }) => {
    const call = { objective, queries, options };
    calls.search.push(call);
    return searchResults(call);
  },
  extract: async (wanted: ReadonlyArray<{ url: string; role: PageRole }>): Promise<PageRead[]> => {
    if (wanted.length === 0) return [];
    calls.extract.push(wanted.map((p) => p.url));
    return wanted.map(({ url, role }) => {
      const page = pages[url];
      return page
        ? { url, role, ok: true, title: page.title ?? null, publishDate: null, text: page.text }
        : { url, role, ok: false, title: null, publishDate: null, text: "" };
    });
  },
}));

const { runCheck } = await import("@/lib/check/run");

const FILLER =
  "Brightwater Bank offers checking, savings and small business loans across the region. " +
  "Our people work in branches and offices, and we post every open role on our careers site.";

const HOME = "https://www.brightwater.example/";
const CONTACT = "https://www.brightwater.example/careers/contact-us";
const FRAUD = "https://www.brightwater.example/careers/recruitment-fraud";

const FRAUD_TEXT = `# Recruitment fraud

Scammers sometimes impersonate Brightwater Bank recruiters. ${FILLER}

Brightwater Bank recruiters only contact candidates from these verified email domains:
- brightwatertalent.example

We will never ask you to pay for equipment.`;

// The first search finds the home page and the careers contact page, which
// mentions security but carries no recruiting list.
function brightwaterSearch(call: SearchCall): SearchHit[] {
  const pinned = call.options?.includeDomains ?? [];
  if (pinned.includes("brightwater.example")) {
    // The search limited to the official domain: the contact page ranks
    // first, the fraud page second.
    return [
      hit(CONTACT, "Contact recruiting and security | Brightwater Bank", "Contact Brightwater Bank recruiting."),
      hit(FRAUD, "Recruitment fraud | Brightwater Bank", "Brightwater Bank recruiters only use verified email domains."),
    ];
  }
  if (call.queries.some((q) => q.includes("official website"))) {
    return [
      hit(HOME, "Brightwater Bank | Banking for the region", `Brightwater Bank. ${FILLER}`),
      hit(CONTACT, "Contact recruiting and security | Brightwater Bank", "Contact Brightwater Bank recruiting."),
    ];
  }
  return [];
}

beforeEach(() => {
  calls.search = [];
  calls.extract = [];
  searchResults = brightwaterSearch;
  pages = {
    [HOME]: { title: "Brightwater Bank", text: `# Brightwater Bank\n\n${FILLER}` },
    [CONTACT]: { title: "Contact recruiting", text: `# Contact recruiting\n\n${FILLER}\n\nFor security questions, call us.` },
    [FRAUD]: { title: "Recruitment fraud", text: FRAUD_TEXT },
  };
});

const check = (address: string) =>
  runCheck({
    company: "Brightwater Bank",
    website: null,
    senderAddress: address,
    senderDomain: address.split("@")[1],
    locale: "en-us",
  }) as Promise<CheckReport>;

describe("looking for the recruiting list on the company's own domain", () => {
  it("reads the recruitment fraud page when the first reads have no list", async () => {
    const r = await check("recruitment@brightwater.example");
    const listSearch = calls.search.find((c) => c.options?.includeDomains?.includes("brightwater.example"));
    expect(listSearch?.queries[0]).toMatch(/recruitment fraud/);
    expect(calls.extract.flat()).toContain(FRAUD);
    // The sender's domain isn't on the list the company publishes.
    expect(r.verdict).toBe("mixed");
    expect(r.companySays?.quote).toContain("brightwatertalent.example");
    expect(r.couldntFind.map((c) => c.text).join(" ")).not.toMatch(/recruiting email domains|doesn't say which/);
    expect(r.searches).toContain(listSearch?.queries[0]);
  });

  it("gives the same answer for any address at the company's domain", async () => {
    const a = await check("recruitment@brightwater.example");
    const b = await check("recruit@brightwater.example");
    expect(b.verdict).toBe(a.verdict);
    expect(b.reasons.map((x) => x.direction)).toEqual(a.reasons.map((x) => x.direction));
  });

  it("looks for the list for any recruiter email, a free email address too", async () => {
    const r = await check("brightwater.recruiting@gmail.com");
    const listSearch = calls.search.find((c) => c.options?.includeDomains?.includes("brightwater.example"));
    expect(listSearch?.queries[0]).toMatch(/recruitment fraud/);
    expect(r.verdict).toBe("strong_warning");
    expect(r.companySays?.quote).toContain("brightwatertalent.example");
    // The list exists, so it isn't "Not published".
    expect(r.couldntFind.some((c) => c.kind === "not_published" && c.text.includes("doesn't say which"))).toBe(false);
  });

  // The first search also finds a careers page, so a notice page was read.
  const CAREERS = "https://www.brightwater.example/careers";
  function withCareersPage(listSearch: (call: SearchCall) => SearchHit[]) {
    pages[CAREERS] = { title: "Careers | Brightwater Bank", text: `# Careers at Brightwater Bank\n\n${FILLER}` };
    searchResults = (call) => {
      // The list search, with its domain filter or (after a failure) without.
      if (call.queries.some((q) => q.includes("verified recruiter email domains"))) return listSearch(call);
      if (call.queries.some((q) => q.includes("official website"))) {
        return [...brightwaterSearch(call), hit(CAREERS, "Careers | Brightwater Bank", "Careers at Brightwater Bank.")];
      }
      return [];
    };
  }

  it("says Not published only when the targeted search still finds no list", async () => {
    withCareersPage(() => []);
    const r = await check("brightwater.recruiting@gmail.com");
    expect(r.couldntFind).toContainEqual({
      kind: "not_published",
      text: "Brightwater Bank doesn't say which email domains its recruiters use on the pages checked.",
      url: null,
    });
  });

  it("says Couldn't check when the targeted search fails", async () => {
    withCareersPage(() => {
      throw new Error("Search timed out");
    });
    const r = await check("brightwater.recruiting@gmail.com");
    expect(r.couldntFind).toContainEqual({
      kind: "couldnt_check",
      text: "We couldn't find a list of recruiting email domains on the pages we read.",
      url: null,
    });
    expect(r.searches.some((q) => q.includes("verified recruiter email domains"))).toBe(false);
  });

  it("doesn't search again when the first reads already found the list", async () => {
    searchResults = (call) =>
      call.queries.some((q) => q.includes("official website"))
        ? [hit(HOME, "Brightwater Bank", `Brightwater Bank. ${FILLER}`), hit(FRAUD, "Recruitment fraud | Brightwater Bank", "Brightwater Bank recruiters.")]
        : [];
    await check("recruitment@brightwater.example");
    expect(calls.search.some((c) => c.options?.includeDomains?.includes("brightwater.example"))).toBe(false);
  });
});

describe("choosing the fraud notice page", () => {
  it("scores fraud and scam pages above other pages, and contact pages lowest", () => {
    expect(fraudPageScore(FRAUD, null)).toBe(2);
    expect(fraudPageScore("https://x.example/careers/scam-alert", null)).toBe(2);
    expect(fraudPageScore("https://x.example/security", "Security")).toBe(1);
    expect(fraudPageScore(CONTACT, "Contact recruiting and security")).toBe(0);
  });

  it("plans to read the recruitment fraud page before a contact page", () => {
    const planned = planReads(
      "Brightwater Bank",
      "brightwater.example",
      [
        hit(CONTACT, "Contact recruiting and security | Brightwater Bank", "Brightwater Bank"),
        hit(FRAUD, "Recruitment fraud | Brightwater Bank", "Brightwater Bank"),
      ],
      [],
    );
    expect(planned[0]).toEqual({ url: FRAUD, role: "fraud" });
  });
});

describe("what couldn't be found about the recruiting list", () => {
  const input = (reads: PageRead[]) => ({
    company: "Brightwater Bank",
    website: null,
    senderAddress: "recruitment@brightwater.example",
    senderDomain: "brightwater.example",
    officialHits: [
      hit(HOME, "Brightwater Bank | Banking", `Brightwater Bank. ${FILLER}`),
      hit("https://www.brightwater.example/about", "About Brightwater Bank", "Brightwater Bank history."),
    ],
    warningHits: [],
    reads,
    now: NOW,
  });
  const listItem = (r: CheckReport) => r.couldntFind.find((c) => /recruit/.test(c.text));

  it("says Couldn't check when no fraud or careers notice page was read", () => {
    const r = buildReport(input([read(HOME, "home", `# Brightwater Bank\n\n${FILLER}`)])) as CheckReport;
    expect(listItem(r)).toEqual({
      kind: "couldnt_check",
      text: "We couldn't find a list of recruiting email domains on the pages we read.",
      url: null,
    });
  });

  it("doesn't count a contact page as a notice page", () => {
    const r = buildReport(
      input([read(CONTACT, "fraud", `# Contact recruiting\n\n${FILLER}\n\nFor security questions, call us.`)]),
    ) as CheckReport;
    expect(listItem(r)?.kind).toBe("couldnt_check");
  });

  it("says Not published when a careers notice page was read and has no list", () => {
    const r = buildReport(
      input([read("https://www.brightwater.example/careers", "careers", `# Careers\n\n${FILLER}`)]),
    ) as CheckReport;
    expect(listItem(r)).toEqual({
      kind: "not_published",
      text: "Brightwater Bank doesn't say which email domains its recruiters use on the pages checked.",
      url: null,
    });
  });
});
