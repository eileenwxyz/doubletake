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
]);

// Company directories. A path prefix limits the match to company pages on
// sites that also host other content.
export const DIRECTORIES: ReadonlyArray<{ domain: string; pathPrefix?: string }> = [
  { domain: "linkedin.com", pathPrefix: "/company/" },
  { domain: "indeed.com", pathPrefix: "/cmp/" },
  { domain: "bbb.org" },
  { domain: "tracxn.com" },
  { domain: "crunchbase.com" },
];

// Forums and review sites where people post first-hand reports.
export const REPORT_SITES: ReadonlySet<string> = new Set([
  "reddit.com",
  "teamblind.com",
  "quora.com",
  "trustpilot.com",
]);

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
]);

// Reserved test suffixes (RFC 2606) that tldts treats as unknown but that we
// accept as real domains, so fixtures can use .example.
export const RESERVED_TEST_SUFFIXES: ReadonlySet<string> = new Set(["example", "test"]);
