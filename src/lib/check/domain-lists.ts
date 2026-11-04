// Every hard-coded domain list Doubletake uses lives in this file.
// Entries are registrable domains (see registrableDomain in domains.ts) unless
// a comment says otherwise.

// Hiring software. A sender on one of these is neutral only when the
// company's own site links to the same platform.
export const HIRING_PLATFORMS: ReadonlyArray<{
  name: string;
  domains: readonly string[];
}> = [
  { name: "Ashby", domains: ["ashbyhq.com"] },
  { name: "Greenhouse", domains: ["greenhouse.io", "greenhouse-mail.io"] },
  { name: "Lever", domains: ["lever.co"] },
  { name: "Workday", domains: ["myworkday.com", "myworkdayjobs.com", "workday.com"] },
  { name: "SmartRecruiters", domains: ["smartrecruiters.com"] },
  { name: "iCIMS", domains: ["icims.com"] },
  { name: "Jobvite", domains: ["jobvite.com"] },
  { name: "Workable", domains: ["workable.com", "workablemail.com"] },
  { name: "BambooHR", domains: ["bamboohr.com"] },
  { name: "Recruitee", domains: ["recruitee.com"] },
  { name: "Teamtailor", domains: ["teamtailor.com", "teamtailor-mail.com"] },
  { name: "JazzHR", domains: ["jazzhr.com", "applytojob.com"] },
  { name: "Breezy HR", domains: ["breezy.hr"] },
];

// Free email providers anyone can sign up for.
export const FREE_EMAIL_PROVIDERS: ReadonlySet<string> = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "msn.com",
  "yahoo.com",
  "ymail.com",
  "aol.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "proton.me",
  "protonmail.com",
  "gmx.com",
  "gmx.net",
  "mail.com",
  "zoho.com",
  "yandex.com",
  "yandex.ru",
  "qq.com",
  "163.com",
  "tutanota.com",
  "fastmail.com",
]);

// Regulators and fraud-reporting authorities outside the .gov suffixes
// (any public suffix containing "gov", such as gov or gov.au, already counts).
export const REGULATORS: ReadonlySet<string> = new Set([
  "actionfraud.police.uk",
  "fca.org.uk",
  "finra.org",
  "antifraudcentre-centreantifraude.ca",
  "europol.europa.eu",
]);

// Sites that publish automated trust scores for websites.
export const AUTOMATED_RATING_SITES: ReadonlySet<string> = new Set([
  "scamadviser.com",
  "scam-detector.com",
  "scamdoc.com",
  "urlvoid.com",
  "thesentari.com",
  "hastrust.com",
  "gridinsoft.com",
  "jobscamscore.com",
]);

// A site, optionally limited to some of its pages. pathPrefix and pathPattern
// are matched against the lower-case URL path.
export type SitePages = { domain: string; pathPrefix?: string; pathPattern?: RegExp };

// Company directories. A path limits the match to company pages on sites
// that also host other content.
export const DIRECTORIES: ReadonlyArray<SitePages> = [
  { domain: "linkedin.com", pathPrefix: "/company/" },
  { domain: "indeed.com", pathPrefix: "/cmp/" },
  // Company profiles only: /us/<state>/<city>/profile/<category>/<name>.
  { domain: "bbb.org", pathPattern: /^\/us\/(?:[^/]+\/)+profile\// },
  { domain: "tracxn.com" },
  { domain: "crunchbase.com" },
];

// Forums and review sites where people post first-hand reports.
export const REPORT_SITES: ReadonlyArray<SitePages> = [
  { domain: "reddit.com" },
  { domain: "teamblind.com" },
  { domain: "quora.com" },
  { domain: "trustpilot.com" },
  { domain: "facebook.com", pathPrefix: "/groups/" },
];

// Sites whose pages are general advice unless another rule matched first
// (bbb.org scam studies and articles; its company profiles are directories).
export const ADVICE_SITES: ReadonlySet<string> = new Set(["bbb.org"]);

// Large shared sites that are never a company's own official domain, even
// when many of their pages name the company.
export const SHARED_SITES: ReadonlySet<string> = new Set([
  "wikipedia.org",
  "youtube.com",
  "facebook.com",
  "instagram.com",
  "x.com",
  "twitter.com",
  "tiktok.com",
  "medium.com",
  "github.com",
  "glassdoor.com",
  "linkedin.com",
  "indeed.com",
  "google.com",
  "apple.com",
  "bloomberg.com",
  "wellfound.com",
  "ycombinator.com",
]);

// URL paths that point at one person rather than an organisation. Sources on
// these paths are dropped so no one's name ends up in the output.
export const PERSONAL_PROFILE_PATHS: ReadonlyArray<{ domain: string; pathPrefix: string }> = [
  { domain: "linkedin.com", pathPrefix: "/in/" },
  { domain: "linkedin.com", pathPrefix: "/pub/" },
  { domain: "reddit.com", pathPrefix: "/user/" },
  { domain: "reddit.com", pathPrefix: "/u/" },
];

// Query parameters that only track clicks; removed before comparing URLs.
export const TRACKING_PARAMS: ReadonlySet<string> = new Set([
  "gclid",
  "fbclid",
  "msclkid",
  "mc_cid",
  "mc_eid",
  "ref",
  "ref_src",
  "igshid",
  "_hsenc",
  "_hsmi",
  "inav",
  "intlink",
]);

// A leading path segment that only picks a language and region, such as
// /en-us/ or /de-de/. Copies of a page that differ only in this segment are
// one source.
export const LOCALE_SEGMENT = /^[a-z]{2}-[a-z]{2}$/i;
export const DEFAULT_LOCALE = "en-us";

// Reserved test suffixes (RFC 2606) that tldts treats as unknown but that we
// accept as real domains, so fixtures can use .example.
export const RESERVED_TEST_SUFFIXES: ReadonlySet<string> = new Set(["example", "test"]);

// Job boards whose posting links Doubletake accepts in the company field.
// hosts are full host names; the company's slug is the first path segment
// unless the platform's own rules (in job-link.ts) say otherwise.
export const JOB_BOARD_HOSTS: ReadonlyArray<{ platform: string; hosts: readonly string[] }> = [
  { platform: "Ashby", hosts: ["jobs.ashbyhq.com"] },
  {
    platform: "Greenhouse",
    hosts: ["boards.greenhouse.io", "job-boards.greenhouse.io", "boards.eu.greenhouse.io", "job-boards.eu.greenhouse.io"],
  },
  { platform: "Lever", hosts: ["jobs.lever.co", "jobs.eu.lever.co"] },
  { platform: "Workable", hosts: ["apply.workable.com"] },
];

// LinkedIn: job postings are rebuilt as https://www.linkedin.com/jobs/view/<id>.
export const LINKEDIN_DOMAIN = "linkedin.com";

// Job aggregators and public job boards: sites that carry other employers'
// postings. A posting there is checked against the employer it names, never
// the site. keepParams are the only query parameters kept when the link is
// cleaned (the job's ID); everything else, such as search terms and
// location, is dropped. Government job boards (any gov suffix) that aren't
// listed here are recognised by their job-posting paths (see job-link.ts).
export const JOB_AGGREGATORS: ReadonlyArray<{
  name: string;
  domains: readonly string[];
  keepParams: readonly string[];
}> = [
  { name: "Indeed", domains: ["indeed.com", "indeed.co.uk", "indeed.ca", "indeed.com.au"], keepParams: ["jk", "vjk"] },
  { name: "ZipRecruiter", domains: ["ziprecruiter.com", "ziprecruiter.co.uk"], keepParams: ["jid"] },
  { name: "Glassdoor", domains: ["glassdoor.com", "glassdoor.co.uk", "glassdoor.ca"], keepParams: ["jl", "joblistingid"] },
  { name: "Monster", domains: ["monster.com", "monster.co.uk", "monster.ca"], keepParams: ["jobid", "job_id"] },
  { name: "USAJOBS", domains: ["usajobs.gov"], keepParams: [] },
  // State job boards, shown by their domain.
  { name: "azjobconnection.gov", domains: ["azjobconnection.gov"], keepParams: ["jobid", "id", "jo"] },
];

// Query parameters that hold a job's ID on government job boards not listed
// above (lower case).
export const GOV_JOB_ID_PARAMS: ReadonlySet<string> = new Set([
  "jobid", "job_id", "id", "jo", "joborderid", "jobordernumber", "jobno", "posting", "postingid",
]);
