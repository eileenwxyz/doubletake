// Job-link checks. Every company here is fictional and every company domain
// uses the reserved .example suffix; LinkedIn and the job boards appear only
// as the platforms that host postings.
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  boardPostingInfo,
  checkCareers,
  cutAtOtherJobs,
  forUnnamedClient,
  isUnsupportedJobSiteLink,
  parseAggregatorPosting,
  parseJobLink,
  parseLinkedInPosting,
  unwrapLinkedInRedirect,
  websiteFieldDomain,
} from "@/lib/check/job-link";
import type { CheckReport, PageRead, PageRole, SearchHit } from "@/lib/check/types";
import { RESULT } from "@/lib/copy";
import { ACME_FRAUD_TEXT, ACME_OFFICIAL_HITS, hit, read, unreadable } from "./fixtures";

// ---- Fake Parallel API ----

type SearchCall = { objective: string; queries: string[]; options?: { includeDomains?: string[] } };
type ExtractCall = { urls: string[]; objective: string };

const calls: { search: SearchCall[]; extract: ExtractCall[] } = { search: [], extract: [] };
let pages: Record<string, { title?: string | null; text: string } | null> = {};
let searchResults: (call: SearchCall) => SearchHit[] = () => [];
// Extract calls that include one of these URLs throw.
const throwFor = new Set<string>();

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
    if (wanted.some((p) => throwFor.has(p.url))) throw new Error("Extract exploded");
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
  throwFor.clear();
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
      unnamedClient: false,
      client: null,
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

// ---- Staffing agencies hiring for an unnamed client ----

describe("staffing agency posting for an unnamed client", () => {
  it("spots an agency hiring for a client it doesn't name", () => {
    expect(forUnnamedClient("Brightpath Staffing", "Our client, a leading insurer, is hiring an analyst.")).toBe(true);
    expect(forUnnamedClient("Brightpath", "We are a staffing agency hiring on behalf of a confidential client.")).toBe(true);
    expect(forUnnamedClient("Brightpath Recruiting", "One of our clients in Springfield needs an analyst.")).toBe(true);
    expect(forUnnamedClient("Brightpath Staffing", "The client's name is kept confidential until interview.")).toBe(true);
  });

  it("doesn't count a named client or a company that isn't an agency", () => {
    expect(forUnnamedClient("Brightpath Staffing", "Our client, Globex Corp, is hiring an analyst.")).toBe(false);
    expect(forUnnamedClient("Brightpath Staffing", "We place analysts in permanent roles.")).toBe(false);
    // An ordinary employer talking about its customers.
    expect(forUnnamedClient("Acme", "You will support a client in the energy sector.")).toBe(false);
  });

  const AGENCY_LINK = "https://www.linkedin.com/jobs/view/4099999999";
  const AGENCY_FILLER =
    "Brightpath Staffing is a staffing agency that places analysts and engineers with employers across the region. " +
    "We have placed thousands of candidates since we opened, and every open role is listed on our site.";

  function agencyPages() {
    pages = {
      [AGENCY_LINK]: {
        title: "Brightpath Staffing hiring Claims Analyst in Springfield | LinkedIn",
        text: `# Claims Analyst\n\n[Brightpath Staffing](https://www.linkedin.com/company/brightpath-staffing) Springfield 3 days ago\n\nBrightpath Staffing is recruiting a Claims Analyst on behalf of a confidential client, a regional insurer. ${AGENCY_FILLER}\n\n## Similar jobs\n\n# Analyst\n\n[Globex](https://www.linkedin.com/company/globex-example)`,
      },
      "https://www.linkedin.com/company/brightpath-staffing/": {
        text: "# Brightpath Staffing\n\nWebsite\n: https://www.brightpathstaffing.example/\n\nIndustry\n: Staffing and Recruiting",
      },
      "https://www.brightpathstaffing.example/jobs": { text: `# Open jobs at Brightpath Staffing\n\n${AGENCY_FILLER}\n\n- Claims Analyst · Springfield` },
      "https://www.brightpathstaffing.example/": { text: `# Brightpath Staffing\n\n${AGENCY_FILLER}` },
    };
    searchResults = (call) => {
      const pinned = call.options?.includeDomains ?? [];
      if (pinned.includes("linkedin.com")) {
        return [hit("https://www.linkedin.com/company/brightpath-staffing", "Brightpath Staffing | LinkedIn", "Brightpath Staffing. Staffing and Recruiting.")];
      }
      if (pinned.includes("brightpathstaffing.example")) {
        return [
          hit("https://www.brightpathstaffing.example/", "Brightpath Staffing | Staffing agency", "Brightpath Staffing places analysts."),
          hit("https://www.brightpathstaffing.example/jobs", "Jobs | Brightpath Staffing", "Open jobs at Brightpath Staffing."),
        ];
      }
      return [];
    };
  }

  it("checks the agency and says the client couldn't be checked, without treating it as a warning", async () => {
    agencyPages();
    const r = (await runCheck(req(null, parseJobLink(AGENCY_LINK)))) as CheckReport;

    expect(r.status).toBe("ok");
    expect(r.companyName).toBe("Brightpath Staffing");
    expect(r.officialDomain).toBe("brightpathstaffing.example");
    expect(r.job).toMatchObject({ unnamedClient: true, careers: "listed" });
    expect(r.couldntFind).toContainEqual({
      kind: "couldnt_check",
      text: "The client company isn't named. Brightpath Staffing posted this job for a client it doesn't name, so only Brightpath Staffing was checked.",
      url: null,
    });
    expect(r.reasons.every((x) => x.direction !== "caution")).toBe(true);
    expect(["strong_warning", "mixed"]).not.toContain(r.verdict);
  });

  it("adds no such item when the employer posts its own job", async () => {
    acmePages(careersText("Open roles: Senior Anvil Engineer."));
    const r = (await runCheck(req(null))) as CheckReport;
    expect(r.job?.unnamedClient).toBe(false);
    expect(r.couldntFind.some((c) => c.text.startsWith("The client company isn't named"))).toBe(false);
  });
});

// ---- Plain-named agencies ----

describe("first-person client wording is an agency signal on its own", () => {
  it("spots agencies whose names have no agency word", () => {
    expect(forUnnamedClient("Fabrikam Partners", "On behalf of our client, we are hiring a Claims Analyst.")).toBe(true);
    expect(forUnnamedClient("Northwind Group", "Our client is seeking a Product Designer.")).toBe(true);
    expect(forUnnamedClient("Northwind Group", "One of our clients needs a Product Designer.")).toBe(true);
  });

  it("still needs more than 'a client' or 'our clients'", () => {
    expect(forUnnamedClient("Northwind Group", "You will support a client in the energy sector.")).toBe(false);
    expect(forUnnamedClient("Northwind Group", "Our clients include insurers and banks.")).toBe(false);
    expect(forUnnamedClient("Northwind Group", "Our client, Globex Corp, is seeking a Product Designer.")).toBe(false);
  });
});

// ---- Job aggregators and public job boards ----

describe("aggregator links", () => {
  it("keeps only the job's ID, dropping search terms and location", () => {
    expect(
      parseJobLink("https://www.azjobconnection.gov/jobs/jobdetails?jobid=12345678&keywords=welder&location=Tempe&radius=25"),
    ).toEqual({
      kind: "aggregator",
      site: "azjobconnection.gov",
      domain: "azjobconnection.gov",
      url: "https://www.azjobconnection.gov/jobs/jobdetails?jobid=12345678",
    });
    expect(parseJobLink("https://www.indeed.com/q-welder-l-shelbyville-jobs.html?vjk=0a1b2c3d4e5f6a7b&from=serp")).toMatchObject({
      site: "Indeed",
      url: "https://www.indeed.com/viewjob?jk=0a1b2c3d4e5f6a7b",
    });
    expect(parseJobLink("https://www.glassdoor.com/Job/shelbyville-welder-jobs-SRCH_IL.0,11.htm?jl=1009876543210")).toMatchObject({
      site: "Glassdoor",
      url: "https://www.glassdoor.com/job-listing/j?jl=1009876543210",
    });
    expect(parseJobLink("https://www.ziprecruiter.com/c/Northwind-Group/Job/Product-Designer/-in-Phoenix,AZ?jid=ab12cd34ef&lvk=x")).toMatchObject({
      site: "ZipRecruiter",
      url: "https://www.ziprecruiter.com/c/Northwind-Group/Job/Product-Designer/-in-Phoenix,AZ?jid=ab12cd34ef",
    });
    expect(parseJobLink("https://www.monster.com/job-openings/product-designer-phoenix-az--0a1b2c3d?mstr_dist=true")).toMatchObject({
      site: "Monster",
      url: "https://www.monster.com/job-openings/product-designer-phoenix-az--0a1b2c3d",
    });
    expect(parseJobLink("https://www.usajobs.gov/GetJob/ViewDetails/812345600?keyword=designer")).toMatchObject({
      site: "USAJOBS",
      url: "https://www.usajobs.gov/job/812345600",
    });
    // Another state's job board, recognised by its job-posting link.
    expect(parseJobLink("https://www.jobs.state.nm.us/jobs/jobdetails?jobid=998877&keywords=x")).toBeNull();
    expect(parseJobLink("https://www.worksourcewa.gov/jobsearch/detail.aspx?jobid=998877&keywords=x")).toMatchObject({
      site: "worksourcewa.gov",
      url: "https://www.worksourcewa.gov/jobsearch/detail.aspx?jobid=998877",
    });
  });

  it("refuses aggregator links that aren't a posting", () => {
    for (const link of ["https://www.indeed.com/jobs?q=welder&l=Shelbyville", "https://www.monster.com/jobs/search?q=welder"]) {
      expect(parseJobLink(link)).toBeNull();
      expect(isUnsupportedJobSiteLink(link)).toBe(true);
    }
  });
});

describe("a state job board posting by a staffing agency with a plain name", () => {
  const MESSY = "https://www.azjobconnection.gov/jobs/jobdetails?jobid=12345678&keywords=product%20designer&location=Tempe&radius=25";
  const CLEAN = "https://www.azjobconnection.gov/jobs/jobdetails?jobid=12345678";
  const CAREERS = "https://careers.northwind.example/jobs/product-designer";
  const FRAUD_ALERT = "https://www.azjobconnection.gov/fraud-alert";
  const NW_FILLER =
    "Northwind Group places designers and engineers with technology companies across the Southwest. " +
    "Every role we recruit for is listed on our own careers site, and we never charge candidates.";

  const posting = (intro: string) => `# Product Designer

**Employer:** Northwind Group

Location: Phoenix, AZ · Full time

${intro} ${NW_FILLER}

Apply on the employer's site: ${CAREERS}?src=azjc

## Similar jobs

# Graphic Designer

**Employer:** Globex`;

  function northwind(intro: string) {
    pages = {
      [CLEAN]: { title: "Product Designer | Arizona Job Connection", text: posting(intro) },
      [CAREERS]: { text: `# Product Designer at Northwind Group\n\n${NW_FILLER}\n\nApply now.` },
      "https://careers.northwind.example/": { text: `# Careers at Northwind Group\n\n${NW_FILLER}\n\n- Product Designer\n- Data Engineer` },
      "https://www.northwind.example/": { text: `# Northwind Group\n\n${NW_FILLER}` },
    };
    searchResults = (call) => {
      if (call.options?.includeDomains?.includes("northwind.example")) {
        return [
          hit("https://www.northwind.example/", "Northwind Group | Technology recruiting", "Northwind Group places designers."),
          hit("https://careers.northwind.example/", "Careers at Northwind Group", "Open roles at Northwind Group."),
        ];
      }
      if (call.queries.some((q) => q.includes("job scam"))) {
        // The board's own fraud notice names the employer and uses scam words.
        return [hit(FRAUD_ALERT, "Job seeker fraud alert", "Beware of scammers posing as employers such as Northwind Group.")];
      }
      return [];
    };
  }

  it("checks Northwind, says where it was posted, and adds the unnamed-client item", async () => {
    northwind("Our client is seeking a Product Designer to join their in-house team.");
    const r = (await runCheck(req(null, parseJobLink(MESSY)))) as CheckReport;

    expect(calls.extract[0].urls).toEqual([CLEAN]);
    expect(JSON.stringify(calls)).not.toMatch(/keywords|tempe|radius/i);

    expect(r.status).toBe("ok");
    expect(r.companyName).toBe("Northwind Group");
    expect(r.officialDomain).toBe("northwind.example");
    expect(calls.search.find((c) => c.queries.includes("Northwind Group official website careers"))?.options).toEqual({
      includeDomains: ["northwind.example"],
    });
    expect(r.job).toMatchObject({
      site: "azjobconnection.gov",
      postingUrl: CLEAN,
      title: "Product Designer",
      unnamedClient: true,
      careers: "listed",
      careersUrl: CAREERS,
    });
    expect(RESULT.postedOn(r.job!.site!)).toBe("Posted on azjobconnection.gov");
    expect(r.couldntFind).toContainEqual({
      kind: "couldnt_check",
      text: "The client company isn't named. Northwind Group posted this job for a client it doesn't name, so only Northwind Group was checked.",
      url: null,
    });
    // Nothing from the other jobs the board lists.
    expect(JSON.stringify(r)).not.toMatch(/globex|graphic designer/i);
  });

  it("treats the board's own pages as general advice, never official or the next step", async () => {
    northwind("Our client is seeking a Product Designer.");
    const r = (await runCheck(req(null, parseJobLink(MESSY)))) as CheckReport;
    expect(r.sources.find((s) => s.url === FRAUD_ALERT)?.type).toBe("General advice");
    expect(r.sources.find((s) => s.url === CLEAN)?.type).toBe("Other");
    expect(r.sources.filter((s) => s.url.includes("azjobconnection.gov")).every((s) => s.type !== "Official")).toBe(true);
    expect(r.reasons.some((x) => x.sourceUrl?.includes("azjobconnection.gov") && x.direction === "caution")).toBe(false);
    // The agency didn't name its client: the next step is to ask which
    // company the job is with, not a link.
    expect(r.nextStep).toEqual({ url: null, kind: "ask_client" });
  });

  it("doesn't change the verdict because of the unnamed client", async () => {
    northwind("Our client is seeking a Product Designer.");
    const withClient = (await runCheck(req(null, parseJobLink(MESSY)))) as CheckReport;
    northwind("Northwind Group is seeking a Product Designer.");
    const without = (await runCheck(req(null, parseJobLink(MESSY)))) as CheckReport;
    expect(without.job?.unnamedClient).toBe(false);
    expect(without.couldntFind.some((c) => c.text.startsWith("The client company isn't named"))).toBe(false);
    expect(withClient.verdict).toBe(without.verdict);
    expect(withClient.reasons).toEqual(without.reasons);
  });

  it("asks for the company name when the posting names no employer", async () => {
    pages = { [CLEAN]: { title: "Product Designer | Arizona Job Connection", text: `# Product Designer\n\n${NW_FILLER}` } };
    expect(await runCheck(req(null, parseJobLink(MESSY)))).toEqual({
      status: "need_more_detail",
      message: "That job posting doesn't name the employer. Enter the company's name instead.",
    });
    expect(calls.search).toHaveLength(0);
  });

  it("reads the employer from Indeed's company link", () => {
    const link = parseJobLink("https://www.indeed.com/viewjob?jk=0a1b2c3d4e5f6a7b");
    if (link?.kind !== "aggregator") throw new Error("expected an aggregator link");
    expect(
      parseAggregatorPosting(
        { ok: true, title: "Product Designer - Phoenix, AZ - Indeed.com", text: "# Product Designer\n\n[Northwind Group](https://www.indeed.com/cmp/Northwind-Group?from=x)\n\nPhoenix, AZ" },
        link,
      ),
    ).toMatchObject({ employer: "Northwind Group", title: "Product Designer", site: null });
  });
});

// ---- Matching the employer's name against its own pages ----

describe("an employer whose own pages leave off the suffix", () => {
  const LINK = "https://www.azjobconnection.gov/jobs/jobdetails?jobid=55500011";
  const CAREERS = "https://careers.northwind.example/jobs/product-designer";
  const FILLER_NW =
    "Northwind designs software for logistics companies across the Southwest. " +
    "We list every open role on our careers site and we never ask candidates to pay for anything.";

  it("matches pages that say only Northwind for the employer Northwind Group", async () => {
    pages = {
      [LINK]: {
        title: "Product Designer | Arizona Job Connection",
        text: `# Product Designer\n\n**Employer:** Northwind Group\n\nNorthwind Group is hiring a Product Designer. ${FILLER_NW}\n\nApply: ${CAREERS}`,
      },
      [CAREERS]: { text: `# Product Designer\n\n${FILLER_NW}\n\nApply now.` },
      "https://careers.northwind.example/": { text: `# Careers at Northwind\n\n${FILLER_NW}\n\n- Product Designer` },
      "https://www.northwind.example/": { text: `# Northwind\n\n${FILLER_NW}` },
    };
    searchResults = (call) =>
      call.options?.includeDomains?.includes("northwind.example")
        ? [
            hit("https://www.northwind.example/", "Northwind | Logistics software", "Northwind designs logistics software."),
            hit("https://careers.northwind.example/", "Careers at Northwind", "Open roles at Northwind."),
          ]
        : [];

    const r = (await runCheck(req(null, parseJobLink(LINK)))) as CheckReport;
    expect(r.status).toBe("ok");
    expect(r.officialDomain).toBe("northwind.example");
    // The employer's own name from the posting is kept for display.
    expect(r.companyName).toBe("Northwind Group");
    expect(r.job).toMatchObject({ site: "azjobconnection.gov", careers: "listed", careersUrl: CAREERS });
    expect(r.verdict).not.toBe("not_enough");
  });
});

// ---- Employer on a plain "at <Name> in <place>" line ----

describe("a state job board that names the employer under the title heading", () => {
  const LINK = "https://www.azjobconnection.gov/jobs/7630570";
  const FILLER_NW =
    "Northwind Group places designers and engineers with technology companies across the Southwest. " +
    "Every role we recruit for is listed on our own careers site, and we never charge candidates.";
  const text = `# Product Designer

at Northwind Group in Phoenix, Arizona, United States

Our client seeks a product designer to shape its customer apps. ${FILLER_NW}`;

  it("reads the employer from the line under the heading", () => {
    const link = parseJobLink(LINK);
    expect(link).toEqual({ kind: "aggregator", site: "azjobconnection.gov", domain: "azjobconnection.gov", url: LINK });
    if (link?.kind !== "aggregator") throw new Error("expected an aggregator link");
    const parsed = (variant: string) =>
      parseAggregatorPosting({ ok: true, title: "Product Designer - AZ Job Connection", text: variant }, link)?.employer ?? null;

    expect(parsed(text)).toBe("Northwind Group");
    expect(parsed("# Product Designer\n\nat Northwind Group, Phoenix")).toBe("Northwind Group");
    expect(parsed("# Product Designer\n\nat Northwind Group - Full time")).toBe("Northwind Group");
    expect(parsed("# Product Designer\n\nat Northwind Group")).toBe("Northwind Group");
    // Too far below the heading, or the site's own name: not the employer.
    expect(parsed("# Product Designer\n\nPhoenix\n\nFull time\n\nRemote\n\nat Northwind Group")).toBeNull();
    expect(parsed("# Product Designer\n\nat AZ Job Connection in Phoenix")).toBeNull();
    expect(parsed("# Product Designer\n\nat azjobconnection.gov in Phoenix")).toBeNull();
  });

  it("checks Northwind Group, says where it was posted, and shows the unnamed-client item", async () => {
    pages = {
      [LINK]: { title: "Product Designer - AZ Job Connection", text },
      "https://www.northwind.example/": { text: `# Northwind Group\n\n${FILLER_NW}` },
    };
    searchResults = (call) =>
      call.queries.includes("Northwind Group official website careers")
        ? [
            hit("https://www.northwind.example/", "Northwind Group | Technology recruiting", "Northwind Group places designers."),
            hit("https://www.northwind.example/about", "About Northwind Group", "Northwind Group was founded in Phoenix."),
          ]
        : [];

    const r = (await runCheck(req(null, parseJobLink(LINK)))) as CheckReport;
    expect(r.status).toBe("ok");
    expect(r.companyName).toBe("Northwind Group");
    expect(r.officialDomain).toBe("northwind.example");
    expect(r.job).toMatchObject({ site: "azjobconnection.gov", title: "Product Designer", unnamedClient: true });
    expect(RESULT.postedOn(r.job!.site!)).toBe("Posted on azjobconnection.gov");
    expect(r.couldntFind).toContainEqual({
      kind: "couldnt_check",
      text: "The client company isn't named. Northwind Group posted this job for a client it doesn't name, so only Northwind Group was checked.",
      url: null,
    });
  });
});

describe("optional careers reads", () => {
  it("returns the rest of the result when the linked job board read throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    acmePages(careersText("See every open role and apply: [Open roles](https://jobs.ashbyhq.com/acme)."));
    throwFor.add("https://jobs.ashbyhq.com/acme");
    const r = (await runCheck(req(null))) as CheckReport;
    expect(r.status).toBe("ok");
    expect(r.officialDomain).toBe("acme.example");
    expect(r.couldntFind).toContainEqual({
      kind: "couldnt_check",
      text: "Couldn't read jobs.ashbyhq.com/acme.",
      url: "https://jobs.ashbyhq.com/acme",
    });
    // The careers page itself was still read; the job isn't on it.
    expect(r.job?.careers).toBe("not_listed");
    vi.restoreAllMocks();
  });

  it("reads a bare short link in an aggregator posting as the employer's careers page", () => {
    const link = parseJobLink("https://www.azjobconnection.gov/jobs/7630570");
    if (link?.kind !== "aggregator") throw new Error("expected an aggregator link");
    expect(
      parseAggregatorPosting(
        {
          ok: true,
          title: "Product Designer - AZ Job Connection",
          text: "# Product Designer\n\nat Northwind Group in Phoenix, Arizona, United States\n\nShortcut: careers.northwind.example/3869AO\n\nEmail jobs@northwind.example",
        },
        link,
      ),
    ).toMatchObject({ employer: "Northwind Group", site: "northwind.example", careersUrl: "https://careers.northwind.example/3869AO" });
  });
});

describe("cutting off the other jobs a site lists", () => {
  const MARKER = /\b(similar jobs|recommended jobs)\b/i;
  const DESCRIPTION = "Our client seeks a product designer to shape its customer apps and design system.";

  it("ignores tab labels above the description", () => {
    const text = `# Product Designer\n\n+ Recommended Jobs\n\nRecommended Jobs\n\n${DESCRIPTION}\n\n## Similar jobs\n\n# Other job`;
    expect(cutAtOtherJobs(text, MARKER)).toBe(`# Product Designer\n\n+ Recommended Jobs\n\nRecommended Jobs\n\n${DESCRIPTION}\n`);
  });

  it("ignores a '+' tab label or a bare short label after the description", () => {
    const text = `# Product Designer\n\n${DESCRIPTION}\n\n+ Similar Jobs\n\nApply by Friday.\n\nRecommended Jobs`;
    expect(cutAtOtherJobs(text, MARKER)).toBe(text);
  });

  it("cuts at a section that follows the description", () => {
    const text = `# Product Designer\n\n${DESCRIPTION}\n\nRecommended Jobs\nGraphic Designer at Globex\nTempe`;
    expect(cutAtOtherJobs(text, MARKER)).toBe(`# Product Designer\n\n${DESCRIPTION}\n`);
  });
});

// ---- Screenshot fixture ----
// The result docs/screenshots shows for this check. Run `npx vitest -u`
// after a change to the check output, then `npm run screenshots`.
describe("screenshot fixture", () => {
  it("matches data/fixtures/screens/job-link.json", async () => {
    acmePages(careersText("Open roles: Senior Anvil Engineer, Rocket Technician."));
    const report = (await runCheck(req(null))) as CheckReport;
    const fixed = { ...report, checkedAt: "2026-11-05T15:12:00.000Z" };
    await expect(JSON.stringify(fixed, null, 2) + "\n").toMatchFileSnapshot("../data/fixtures/screens/job-link.json");
  });
});
