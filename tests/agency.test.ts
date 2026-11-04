// Staffing agencies recruiting for a client. Every company here is
// fictional and every company domain uses the reserved .example suffix;
// LinkedIn appears only as the platform that hosts postings.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { agencyClient, looksLikeAgency, senderAgency } from "@/lib/check/agency";
import { parseJobLink, parseLinkedInPosting } from "@/lib/check/job-link";
import { buildReport } from "@/lib/check/report";
import type { CheckReport, PageRead, PageRole, SearchHit } from "@/lib/check/types";
import { hit, NOW, read } from "./fixtures";

// ---- Fake Parallel API ----

type SearchCall = { objective: string; queries: string[]; options?: { includeDomains?: string[] } };
const calls: { search: SearchCall[] } = { search: [] };
let pages: Record<string, { title?: string | null; text: string }> = {};
let searchResults: (call: SearchCall) => SearchHit[] = () => [];

vi.mock("@/lib/parallel", () => ({
  search: async (objective: string, queries: string[], options?: { includeDomains?: string[] }) => {
    const call = { objective, queries, options };
    calls.search.push(call);
    return searchResults(call);
  },
  extract: async (wanted: ReadonlyArray<{ url: string; role: PageRole }>): Promise<PageRead[]> =>
    wanted.map(({ url, role }) => {
      const page = pages[url];
      return page
        ? { url, role, ok: true, title: page.title ?? null, publishDate: null, text: page.text }
        : { url, role, ok: false, title: null, publishDate: null, text: "" };
    }),
}));

const { runCheck } = await import("@/lib/check/run");

// ---- The fictional world ----

const LINK = "https://www.linkedin.com/jobs/view/4088888888";
const AGENCY = "https://www.brightpathstaffing.example/";
const AGENCY_JOBS = "https://www.brightpathstaffing.example/jobs";
const GLOBEX = "https://www.globex.example/";
const GLOBEX_CAREERS = "https://www.globex.example/careers";
const SENDER_SITE = "https://www.brightpath.example/";

const AGENCY_FILLER =
  "Brightpath Staffing is a staffing agency that places analysts and engineers with employers across the region. " +
  "We have placed thousands of candidates since we opened, and every open role is listed on our site.";
const GLOBEX_FILLER =
  "Globex insures homes, cars and small businesses across the region. " +
  "Our people work in offices and remotely, and every open role is listed on our careers site.";

function posting(clientWords: string) {
  return {
    title: "Brightpath Staffing hiring Claims Analyst in Springfield | LinkedIn",
    text: `# Claims Analyst\n\n[Brightpath Staffing](https://www.linkedin.com/company/brightpath-staffing) Springfield 3 days ago\n\n${clientWords} ${AGENCY_FILLER}`,
  };
}

const REPORT_URL = "https://www.reddit.com/r/scams/comments/abc123/globex_fake_offer";

type World = {
  clientWords?: string;
  globexFound?: boolean;
  globexWarnings?: SearchHit[];
  senderSite?: SearchHit[];
};

function world(options: World = {}) {
  const { clientWords = "Brightpath Staffing is recruiting a Claims Analyst for our client, Globex, a regional insurer.", globexFound = true } = options;
  pages = {
    [LINK]: posting(clientWords),
    "https://www.linkedin.com/company/brightpath-staffing/": {
      text: "# Brightpath Staffing\n\nWebsite\n: https://www.brightpathstaffing.example/\n\nIndustry\n: Staffing and Recruiting",
    },
    [AGENCY_JOBS]: { text: `# Open jobs at Brightpath Staffing\n\n${AGENCY_FILLER}\n\n- Claims Analyst · Springfield` },
    [AGENCY]: { text: `# Brightpath Staffing\n\n${AGENCY_FILLER}` },
    [GLOBEX]: { title: "Globex | Insurance", text: `# Globex\n\n${GLOBEX_FILLER}` },
    [GLOBEX_CAREERS]: { title: "Careers | Globex", text: `# Careers at Globex\n\n${GLOBEX_FILLER}` },
  };
  searchResults = (call) => {
    const pinned = call.options?.includeDomains ?? [];
    if (pinned.includes("linkedin.com")) {
      return [hit("https://www.linkedin.com/company/brightpath-staffing", "Brightpath Staffing | LinkedIn", "Brightpath Staffing. Staffing and Recruiting.")];
    }
    if (pinned.includes("brightpathstaffing.example")) {
      return [
        hit(AGENCY, "Brightpath Staffing | Staffing agency", "Brightpath Staffing places analysts."),
        hit(AGENCY_JOBS, "Jobs | Brightpath Staffing", "Open jobs at Brightpath Staffing."),
      ];
    }
    if (pinned.includes("brightpath.example")) return options.senderSite ?? [];
    if (call.queries.some((q) => q.startsWith("Globex official website"))) {
      return globexFound
        ? [
            hit(GLOBEX, "Globex | Insurance", `Globex. ${GLOBEX_FILLER}`),
            hit(GLOBEX_CAREERS, "Careers | Globex", "Join Globex. See open roles."),
          ]
        : [];
    }
    if (call.queries.some((q) => q.startsWith("Globex job scam"))) return options.globexWarnings ?? [];
    return [];
  };
}

beforeEach(() => {
  calls.search = [];
  world();
});

const fromPosting = async () =>
  (await runCheck({
    company: null,
    website: null,
    senderAddress: null,
    senderDomain: null,
    locale: "en-us",
    jobLink: parseJobLink(LINK),
    jobTitle: null,
  })) as CheckReport;

// ---- Detection ----

describe("spotting the client an agency names", () => {
  it("reads the client's name after 'our client'", () => {
    expect(agencyClient("Brightpath Staffing", "Our client, Globex Corp, is hiring an analyst.")).toEqual({ client: "Globex Corp" });
    expect(agencyClient("Fabrikam Partners", "One of our clients, Globex, needs an analyst.")).toEqual({ client: "Globex" });
    expect(agencyClient("Brightpath", "We are a staffing agency hiring for our client Initech.")).toEqual({ client: "Initech" });
  });

  it("says the client isn't named when it isn't", () => {
    expect(agencyClient("Brightpath Staffing", "Our client, a leading insurer, is hiring.")).toEqual({ client: null });
    expect(agencyClient("Brightpath Staffing", "The client's name is kept confidential.")).toEqual({ client: null });
  });

  it("isn't an agency job without agency signals or client wording", () => {
    expect(agencyClient("Acme", "You will support a client, Globex, in the energy sector.")).toBeNull();
    expect(agencyClient("Brightpath Staffing", "We place analysts in permanent roles.")).toBeNull();
  });

  it("carries the client through a LinkedIn posting", () => {
    const parsed = parseLinkedInPosting({ ok: true, ...posting("Recruiting for our client, Globex, a regional insurer.") });
    expect(parsed).toMatchObject({ company: "Brightpath Staffing", client: "Globex", unnamedClient: false });
  });

  it("spots an agency by its name, its wording or 'our client'", () => {
    expect(looksLikeAgency("Brightpath Staffing", "")).toBe(true);
    expect(looksLikeAgency("Brightpath", "Brightpath is a staffing agency.")).toBe(true);
    expect(looksLikeAgency("Brightpath", "We find people for employers.")).toBe(false);
    expect(looksLikeAgency("Brightpath", "Our client is hiring.")).toBe(true);
  });
});

// ---- A posting by an agency that names its client ----

describe("an agency posting that names its client", () => {
  it("checks both and says we couldn't confirm they work together", async () => {
    const r = await fromPosting();
    expect(r.verdict).toBe("no_red_flags");
    expect(r.subtitle).toBe("We couldn't confirm Brightpath Staffing works with Globex.");
    expect(r.recruitingFor).toEqual({
      agency: "Brightpath Staffing",
      agencyDomain: "brightpathstaffing.example",
      client: "Globex",
      clientDomain: "globex.example",
    });
    expect(r.job?.client).toBe("Globex");
    expect(r.couldntFind).toContainEqual({
      kind: "couldnt_check",
      text: "We couldn't confirm that Brightpath Staffing works with Globex.",
      url: null,
    });
    // The client's searches ran and its site is an official source.
    expect(r.searches).toContain("Globex official website careers");
    expect(r.sources).toContainEqual(expect.objectContaining({ url: GLOBEX, type: "Official" }));
    expect(r.allReasons?.map((x) => x.text)).toContain("globex.example is Globex's official website.");
  });

  it("is mixed when a report names the client", async () => {
    world({
      globexWarnings: [hit(REPORT_URL, "Globex fake job offer scam", "Scammers posing as Globex recruiters sent me a fake offer.")],
    });
    const r = await fromPosting();
    expect(r.verdict).toBe("mixed");
    expect(r.subtitle).not.toBe("We couldn't confirm Brightpath Staffing works with Globex.");
    expect(r.reasons).toContainEqual(
      expect.objectContaining({
        direction: "caution",
        text: "A post on reddit.com reports a problem involving Globex by name.",
      }),
    );
  });

  it("is mixed when the client's own site can't be found", async () => {
    world({ globexFound: false });
    const r = await fromPosting();
    expect(r.verdict).toBe("mixed");
    expect(r.recruitingFor?.clientDomain).toBeNull();
    expect(r.reasons.map((x) => x.text)).toContain("Globex's official website couldn't be confirmed.");
  });
});

// ---- An agency posting that doesn't name its client ----

describe("an agency posting that doesn't name its client", () => {
  it("checks the agency only and asks which company the job is with", async () => {
    world({ clientWords: "Brightpath Staffing is recruiting a Claims Analyst on behalf of a confidential client." });
    const r = await fromPosting();
    expect(r.recruitingFor).toBeNull();
    expect(r.job?.unnamedClient).toBe(true);
    expect(r.searches.some((q) => q.startsWith("Globex"))).toBe(false);
    expect(r.nextStep).toEqual({ url: null, kind: "ask_client" });
    expect(r.couldntFind.some((c) => c.text.startsWith("The client company isn't named"))).toBe(true);
  });
});

// ---- A recruiter email from an agency's own domain ----

const BRIGHTPATH_SITE = [
  hit(SENDER_SITE, "Brightpath Staffing | Staffing agency", "Brightpath Staffing places analysts and engineers with employers."),
  hit(`${SENDER_SITE}about`, "About us | Brightpath Staffing", "Brightpath Staffing is a recruiting agency founded in Springfield."),
];

const fromEmail = async () =>
  (await runCheck({
    company: "Globex",
    website: null,
    senderAddress: "recruiter@brightpath.example",
    senderDomain: "brightpath.example",
    locale: "en-us",
  })) as CheckReport;

describe("a recruiter email from a staffing agency's own domain", () => {
  it("applies the agency rule instead of 'unrelated domain'", async () => {
    world({ senderSite: BRIGHTPATH_SITE });
    const r = await fromEmail();
    expect(r.verdict).toBe("no_red_flags");
    expect(r.subtitle).toBe("We couldn't confirm Brightpath Staffing works with Globex.");
    expect(r.recruitingFor).toEqual({
      agency: "Brightpath Staffing",
      agencyDomain: "brightpath.example",
      client: "Globex",
      clientDomain: "globex.example",
    });
    expect(r.reasons[0]).toMatchObject({
      direction: "neutral",
      text: "The sender's domain brightpath.example belongs to Brightpath Staffing, a staffing agency. Agencies often recruit for other companies.",
      sourceType: "Official",
      sourceUrl: SENDER_SITE,
    });
    // Only the sender's own domain was searched for the agency check.
    const pinned = calls.search.find((c) => c.options?.includeDomains?.includes("brightpath.example"));
    expect(pinned?.queries).toEqual(["brightpath.example staffing agency recruiting"]);
    expect(r.searches).toContain("brightpath.example staffing agency recruiting");
  });

  it("stays a strong warning when the sender's site isn't an agency", async () => {
    world({
      senderSite: [hit(SENDER_SITE, "Brightpath Bakery | Fresh bread", "Brightpath Bakery bakes bread daily.")],
    });
    const r = await fromEmail();
    expect(r.verdict).toBe("strong_warning");
    expect(r.recruitingFor).toBeNull();
  });

  it("is mixed when a report names the agency's domain", () => {
    const input = {
      company: "Globex",
      website: null,
      senderAddress: "recruiter@brightpath.example",
      senderDomain: "brightpath.example",
      officialHits: [
        hit(GLOBEX, "Globex | Insurance", `Globex. ${GLOBEX_FILLER}`),
        hit(GLOBEX_CAREERS, "Careers | Globex", "Join Globex. See open roles."),
      ],
      warningHits: [
        hit(
          "https://www.reddit.com/r/scams/comments/def456/brightpath_example",
          "Recruiter from brightpath.example is a scam",
          "A recruiter emailing from brightpath.example sent me a fake offer.",
        ),
      ],
      reads: [read(GLOBEX, "home", `# Globex\n\n${GLOBEX_FILLER}`), read(GLOBEX_CAREERS, "careers", `# Careers\n\n${GLOBEX_FILLER}`)],
      now: NOW,
      senderSiteHits: BRIGHTPATH_SITE,
    };
    const r = buildReport(input) as CheckReport;
    expect(r.verdict).toBe("mixed");
    expect(r.reasons).toContainEqual(
      expect.objectContaining({
        direction: "caution",
        sourceType: "Report",
        text: "A page on reddit.com names brightpath.example in a scam warning.",
      }),
    );
  });

  it("names the agency from its own page titles", () => {
    expect(senderAgency("brightpath.example", BRIGHTPATH_SITE)).toMatchObject({
      name: "Brightpath Staffing",
      confirmed: true,
    });
  });
});
