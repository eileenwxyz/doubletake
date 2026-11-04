// Job-link checks. Every company here is fictional and every company domain
// uses the reserved .example suffix; LinkedIn and the job boards appear only
// as the platforms that host postings.
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  boardPostingInfo,
  checkCareers,
  isUnsupportedJobSiteLink,
  parseJobLink,
  parseLinkedInPosting,
  unwrapLinkedInRedirect,
  websiteFieldDomain,
} from "@/lib/check/job-link";
import type { CheckReport, PageRead, PageRole, SearchHit } from "@/lib/check/types";
import { ACME_FRAUD_TEXT, ACME_OFFICIAL_HITS, hit, read, unreadable } from "./fixtures";

// ---- Fake Parallel API ----

type SearchCall = { objective: string; queries: string[]; options?: { includeDomains?: string[] } };
type ExtractCall = { urls: string[]; objective: string };

const calls: { search: SearchCall[]; extract: ExtractCall[] } = { search: [], extract: [] };
let pages: Record<string, { title?: string | null; text: string } | null> = {};
let searchResults: (call: SearchCall) => SearchHit[] = () => [];

vi.mock("@/lib/parallel", () => ({
  search: async (objective: string, queries: string[], options?: { includeDomains?: string[] }) => {
    const call = { objective, queries, options };
    calls.search.push(call);
    return searchResults(call);
  },
  extract: async (
    wanted: ReadonlyArray<{ url: string; role: PageRole }>,
    _maxAge: number,
    objective: string,
  ): Promise<PageRead[]> => {
    if (wanted.length === 0) return [];
    calls.extract.push({ urls: wanted.map((p) => p.url), objective });
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
  "We design and build industrial anvils, rockets and other equipment for customers around the world. " +
  "Our teams work in offices and remotely, and every open role is listed on our job board.";

// A LinkedIn search link as copied from the address bar: it carries the
// user's search terms and location.
const MESSY_LINKEDIN =
  "https://www.linkedin.com/jobs/search/?currentJobId=4012345678&distance=25&geoId=90000123" +
  "&keywords=night%20shift%20welder&location=Shelbyville%2C%20Ohio&origin=JOBS_HOME_SEARCH_BUTTON&refresh=true";
const CLEAN_LINKEDIN = "https://www.linkedin.com/jobs/view/4012345678";
const PRIVATE_TERMS = /welder|shelbyville|keywords|geoId|currentJobId|distance/i;

const POSTING_TEXT = `Skip to main content

# Senior Anvil Engineer

[Acme](https://www.linkedin.com/company/acme-example?trk=public_jobs_topcard-org-name) Springfield 2 weeks ago 41 applicants

Apply

Acme is hiring a Senior Anvil Engineer to design heavy-duty anvils. ${FILLER}

## Similar jobs

# Rocket Technician

[Globex](https://www.linkedin.com/company/globex-example) Springfield 1 day ago

## People also viewed

[Jordan Lee](https://www.linkedin.com/in/jordan-lee-example) Recruiter at Globex`;

const COMPANY_PAGE_TEXT = `# Acme

Industrial equipment · 500 employees

## About us

${FILLER}

Website
: [External link for Acme](https://www.linkedin.com/redir/redirect?url=https%3A%2F%2Fwww.acme.example%2F&urlhash=Ab12&trk=about_website)

Industry
: Machinery Manufacturing`;

const careersText = (extra: string) => `# Careers at Acme\n\n${FILLER}\n\n${extra}`;

function acmePages(careers: string, board?: { url: string; text: string }) {
  pages = {
    [CLEAN_LINKEDIN]: { title: "Acme hiring Senior Anvil Engineer in Springfield | LinkedIn", text: POSTING_TEXT },
    "https://www.linkedin.com/company/acme-example/": { title: "Acme | LinkedIn", text: COMPANY_PAGE_TEXT },
    "https://www.acme.example/recruiting-fraud": { text: ACME_FRAUD_TEXT },
    "https://careers.acme.example/": { text: careers },
    "https://www.acme.example/": { text: `# Acme\n\n${FILLER}` },
    ...(board ? { [board.url]: { text: board.text } } : {}),
  };
}

// Search: the LinkedIn company page for a search pinned to linkedin.com,
// Acme's own pages for a search pinned to acme.example, and namesakes for
// an unpinned official search.
function acmeSearch(call: SearchCall): SearchHit[] {
  const pinned = call.options?.includeDomains ?? [];
  if (pinned.includes("linkedin.com")) {
    return [hit("https://www.linkedin.com/company/acme-example", "Acme | LinkedIn", "Acme. Industrial equipment. 500 employees.")];
  }
  if (pinned.includes("acme.example")) return ACME_OFFICIAL_HITS.filter((h) => h.url.includes("acme.example"));
  if (call.queries.some((q) => q.includes("official website"))) {
    return [
      ...ACME_OFFICIAL_HITS,
      hit("https://acme-anvils.example/", "Acme Anvils", "Acme Anvils sells anvils."),
    ];
  }
  return [];
}

beforeEach(() => {
  calls.search = [];
  calls.extract = [];
  pages = {};
  searchResults = acmeSearch;
});

const req = (company: string | null, jobLink = parseJobLink(MESSY_LINKEDIN)) => ({
  company,
  website: null,
  senderAddress: null,
  senderDomain: null,
  locale: "en-us",
  jobLink,
  jobTitle: null,
});

// ---- Parsing links ----

describe("job links", () => {
  it("rebuilds a messy LinkedIn search link as the clean job link", () => {
    expect(parseJobLink(MESSY_LINKEDIN)).toEqual({ kind: "linkedin", jobId: "4012345678", url: CLEAN_LINKEDIN });
    expect(parseJobLink("https://www.linkedin.com/jobs/view/senior-anvil-engineer-at-acme-4012345678/?trk=public_jobs&refId=abc")).toEqual({
      kind: "linkedin",
      jobId: "4012345678",
      url: CLEAN_LINKEDIN,
    });
    expect(parseJobLink("uk.linkedin.com/jobs/view/4012345678")?.url).toBe(CLEAN_LINKEDIN);
    expect(parseJobLink("https://www.linkedin.com/jobs/collections/recommended/?currentJobId=4012345678")?.url).toBe(CLEAN_LINKEDIN);
  });

  it("reads Ashby, Greenhouse, Lever and Workable posting links", () => {
    expect(parseJobLink("https://jobs.ashbyhq.com/acme/0a1b2c3d-1111-2222-3333-444455556666/application?utm_source=x")).toEqual({
      kind: "board",
      platform: "Ashby",
      slug: "acme",
      url: "https://jobs.ashbyhq.com/acme/0a1b2c3d-1111-2222-3333-444455556666",
      boardUrl: "https://jobs.ashbyhq.com/acme",
    });
    expect(parseJobLink("https://job-boards.greenhouse.io/acme/jobs/4567890?gh_src=abc")).toMatchObject({
      platform: "Greenhouse",
      url: "https://boards.greenhouse.io/acme/jobs/4567890",
    });
    expect(parseJobLink("https://boards.greenhouse.io/embed/job_app?for=acme&token=4567890")).toMatchObject({
      slug: "acme",
      url: "https://boards.greenhouse.io/acme/jobs/4567890",
    });
    expect(parseJobLink("https://jobs.lever.co/acme/1a2b3c4d-aaaa-bbbb-cccc-1234567890ab/apply")).toMatchObject({
      platform: "Lever",
      url: "https://jobs.lever.co/acme/1a2b3c4d-aaaa-bbbb-cccc-1234567890ab",
    });
    expect(parseJobLink("https://apply.workable.com/acme/j/AB12CD34EF/")).toMatchObject({
      platform: "Workable",
      url: "https://apply.workable.com/acme/j/AB12CD34EF",
    });
  });

  it("refuses LinkedIn and job board links that aren't a posting", () => {
    for (const link of [
      "https://www.linkedin.com/company/acme-example",
      "https://www.linkedin.com/jobs/search/?keywords=welder",
      "https://jobs.lever.co/acme",
      "jobs.ashbyhq.com",
    ]) {
      expect(parseJobLink(link)).toBeNull();
      expect(isUnsupportedJobSiteLink(link)).toBe(true);
    }
    expect(isUnsupportedJobSiteLink("https://careers.acme.example/jobs/42")).toBe(false);
    expect(parseJobLink("https://careers.acme.example/jobs/42")).toBeNull();
  });
});

describe("LinkedIn posting", () => {
  it("keeps only the company name, job title and age, ignoring Similar jobs and People also viewed", () => {
    expect(parseLinkedInPosting({ ok: true, title: null, text: POSTING_TEXT })).toEqual({
      company: "Acme",
      title: "Senior Anvil Engineer",
      posted: "2 weeks ago",
      companySlug: "acme-example",
    });
  });

  it("falls back to the page title and gives up on a sign-in wall", () => {
    expect(
      parseLinkedInPosting({ ok: true, title: "Acme hiring Senior Anvil Engineer in Springfield | LinkedIn", text: "Posted 3 days ago" }),
    ).toMatchObject({ company: "Acme", title: "Senior Anvil Engineer", posted: "3 days ago" });
    expect(parseLinkedInPosting({ ok: true, title: "Sign in | LinkedIn", text: "# Sign in\n\nJoin now" })).toBeNull();
    expect(parseLinkedInPosting({ ok: false, title: null, text: "" })).toBeNull();
  });

  it("reads the company page's Website field, unwrapping LinkedIn's redirect", () => {
    expect(unwrapLinkedInRedirect("https://www.linkedin.com/redir/redirect?url=https%3A%2F%2Facme.example&urlhash=x")).toBe(
      "https://acme.example",
    );
    expect(websiteFieldDomain(COMPANY_PAGE_TEXT)).toBe("acme.example");
    expect(websiteFieldDomain("Website: acme.example\nIndustry: Machinery")).toBe("acme.example");
    // A Website field pointing at a shared site is no claim at all.
    expect(websiteFieldDomain("Website https://www.facebook.com/acme")).toBeNull();
  });
});

// ---- The whole check ----

describe("checking a LinkedIn job link", () => {
  it("reads only the clean link, never passes on the search terms, and finds the website via the company page", async () => {
    acmePages(careersText("Open roles: Senior Anvil Engineer, Rocket Technician."));
    const r = (await runCheck(req(null))) as CheckReport;

    expect(calls.extract[0].urls).toEqual([CLEAN_LINKEDIN]);
    const sent = JSON.stringify(calls);
    expect(sent).not.toMatch(PRIVATE_TERMS);
    expect(sent).not.toContain(MESSY_LINKEDIN);
    expect(JSON.stringify(r)).not.toMatch(PRIVATE_TERMS);
    // Nothing from the other jobs or people on the page is used.
    expect(JSON.stringify(r)).not.toMatch(/globex|jordan|rocket technician/i);

    // The company page search, then its Website field, then a search pinned
    // to that domain.
    expect(calls.search.find((c) => c.options?.includeDomains?.includes("linkedin.com"))?.queries).toEqual([
      "Acme LinkedIn company page",
    ]);
    expect(calls.extract.some((c) => c.urls.includes("https://www.linkedin.com/company/acme-example/"))).toBe(true);
    const official = calls.search.find((c) => c.queries.includes("Acme official website careers"));
    expect(official?.options).toEqual({ includeDomains: ["acme.example"] });

    expect(r.status).toBe("ok");
    expect(r.officialDomain).toBe("acme.example");
    expect(r.job).toMatchObject({
      title: "Senior Anvil Engineer",
      postingUrl: CLEAN_LINKEDIN,
      site: "LinkedIn",
      posted: "2 weeks ago",
      postingOfficial: false,
      careers: "listed",
      careersUrl: "https://careers.acme.example/",
    });
    expect(r.reasons[0]).toMatchObject({ direction: "reassures", sourceType: "Official" });
    expect(r.reasons[0].text).toContain("Senior Anvil Engineer");
  });

  it("treats the LinkedIn posting as supporting evidence at most", async () => {
    acmePages(careersText("Open roles: Senior Anvil Engineer."));
    const r = (await runCheck(req(null))) as CheckReport;
    const posting = r.sources.find((s) => s.url === CLEAN_LINKEDIN);
    expect(posting?.type).not.toBe("Official");
    expect(r.reasons.filter((x) => x.sourceUrl === CLEAN_LINKEDIN).every((x) => x.direction === "neutral")).toBe(true);
  });

  it("cautions when the role isn't on the company's own listings", async () => {
    acmePages(careersText("Open roles: Rocket Technician, Anvil Polisher."));
    const r = (await runCheck(req(null))) as CheckReport;
    expect(r.job?.careers).toBe("not_listed");
    const reason = r.reasons.find((x) => x.text.includes("isn't listed"));
    expect(reason).toMatchObject({ direction: "caution", sourceType: "Official", sourceUrl: "https://careers.acme.example/" });
    expect(reason?.text).toContain("It may be filled, stale or copied.");
  });

  it("follows the careers page's own Apply link to its job board", async () => {
    acmePages(careersText("See every open role and apply: [Open roles](https://jobs.ashbyhq.com/acme)."), {
      url: "https://jobs.ashbyhq.com/acme",
      text: `# Acme jobs\n\n${FILLER}\n\n- Senior Anvil Engineer · Springfield\n- Rocket Technician`,
    });
    const r = (await runCheck(req(null))) as CheckReport;
    expect(calls.extract.at(-1)?.urls).toEqual(["https://jobs.ashbyhq.com/acme"]);
    expect(r.job).toMatchObject({ careers: "listed", careersUrl: "https://jobs.ashbyhq.com/acme" });
    expect(r.sources.find((s) => s.url === "https://jobs.ashbyhq.com/acme")?.type).toBe("Official");
  });

  it("says the role has closed when the listing says it is no longer available", async () => {
    acmePages(careersText("Apply on our board: https://jobs.ashbyhq.com/acme"), {
      url: "https://jobs.ashbyhq.com/acme",
      text: `# Acme jobs\n\n${FILLER}\n\nSenior Anvil Engineer\n\nThis job is no longer available.`,
    });
    const r = (await runCheck(req(null))) as CheckReport;
    expect(r.job?.careers).toBe("closed");
    const reason = r.reasons.find((x) => x.text.startsWith("This role has closed"));
    expect(reason).toMatchObject({ direction: "neutral", sourceUrl: "https://jobs.ashbyhq.com/acme" });
  });

  it("asks for the company name and job title when LinkedIn can't be read", async () => {
    pages = {};
    const r = await runCheck(req(null));
    expect(r).toEqual({
      status: "need_more_detail",
      message: "We couldn't read that LinkedIn job posting. Enter the company's name and the job title instead.",
    });
    expect(calls.search).toHaveLength(0);
  });
});

describe("checking a job board link", () => {
  const LEVER = "https://jobs.lever.co/acme/1a2b3c4d-aaaa-bbbb-cccc-1234567890ab";
  const posting = {
    title: "Acme - Senior Anvil Engineer",
    text: `# Senior Anvil Engineer\n\nSpringfield · Engineering\n\n${FILLER}\n\n[Acme home page](https://www.acme.example/)\n\n[Apply for this job](${LEVER}/apply)`,
  };

  it("takes the company from the board's slug and the posting's link back", () => {
    const link = parseJobLink(LEVER);
    if (link?.kind !== "board") throw new Error("expected a board link");
    expect(boardPostingInfo(link, read(LEVER, "job", posting.text))).toMatchObject({
      company: "Acme",
      title: "Senior Anvil Engineer",
      site: "acme.example",
    });
  });

  it("isn't Official when the company's site doesn't link to the board", async () => {
    acmePages(careersText("See every open role below and apply on this site. Senior Anvil Engineer."));
    pages[LEVER] = posting;
    const r = (await runCheck(req(null, parseJobLink(LEVER)))) as CheckReport;

    expect(calls.search.find((c) => c.queries.includes("Acme official website careers"))?.options).toEqual({
      includeDomains: ["acme.example"],
    });
    expect(r.officialDomain).toBe("acme.example");
    expect(r.sources.find((s) => s.url === LEVER)?.type).not.toBe("Official");
    expect(r.job).toMatchObject({ site: "Lever", postingOfficial: false });
    expect(r.reasons.find((x) => x.sourceUrl === LEVER)).toMatchObject({
      direction: "caution",
      text: "The posting is on Lever, but Acme's own site doesn't link to this job board.",
    });
  });

  it("is Official when the company's site links to the board", async () => {
    acmePages(careersText("See every open role: [Open roles](https://jobs.lever.co/acme)."), {
      url: "https://jobs.lever.co/acme",
      text: `# Acme\n\n${FILLER}\n\nSenior Anvil Engineer — Springfield`,
    });
    pages[LEVER] = posting;
    const r = (await runCheck(req(null, parseJobLink(LEVER)))) as CheckReport;
    expect(r.sources.find((s) => s.url === LEVER)?.type).toBe("Official");
    expect(r.job).toMatchObject({ postingOfficial: true, careers: "listed" });
  });

  it("says the role has closed when the posting says so", async () => {
    acmePages(careersText("Open roles below."));
    pages[LEVER] = { title: posting.title, text: `${posting.text}\n\nThis position has been filled.` };
    const r = (await runCheck(req(null, parseJobLink(LEVER)))) as CheckReport;
    expect(r.job?.careers).toBe("closed");
  });
});

describe("careers check", () => {
  it("can't check without a readable careers page", () => {
    expect(checkCareers("Senior Anvil Engineer", [unreadable("https://careers.acme.example/", "careers")], null)).toEqual({
      result: "couldnt_check",
      url: null,
    });
    expect(checkCareers(null, [read("https://careers.acme.example/", "careers", "x")], null).result).toBe("couldnt_check");
  });

  it("matches the title regardless of punctuation and case", () => {
    const page = read("https://careers.acme.example/", "careers", "Roles: SENIOR ANVIL ENGINEER - Payments");
    expect(checkCareers("Senior Anvil Engineer – Payments", [page], null).result).toBe("listed");
    expect(checkCareers("Senior Anvil Engineer (Remote)", [page], null).result).toBe("listed");
  });
});
