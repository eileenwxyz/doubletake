// Job posting links: parsing what the user pasted, reading a LinkedIn
// posting and company page, and looking for the job on the company's own
// listings.

import { GOV_JOB_ID_PARAMS, JOB_BOARD_HOSTS, LINKEDIN_DOMAIN } from "./domain-lists";
import {
  boardKey,
  compactName,
  coreName,
  domainLabel,
  hiringPlatform,
  hostOf,
  isGovernment,
  isRealDomain,
  jobAggregator,
  registrableDomain,
} from "./domains";
import { agencyClient } from "./agency";
import { isThirdParty } from "./official";
import { linksIn, namesCompanyLoosely, plainText, properName, tidyName } from "./text";
import type { CareersResult, PageRead, SearchHit } from "./types";

export type JobLink =
  // url is always the rebuilt https://www.linkedin.com/jobs/view/<id>, never
  // the link the user pasted (that can hold their search terms and location).
  | { kind: "linkedin"; jobId: string; url: string }
  // url is the posting without its query string; boardUrl is the company's
  // board on the platform (https://jobs.lever.co/<slug>).
  | { kind: "board"; platform: string; slug: string; url: string; boardUrl: string }
  // A job aggregator or public job board (Indeed, USAJOBS, a state job
  // board). url keeps only the job's ID, never search terms or location.
  // site is the name shown as "Posted on <site>"; domain is the site's
  // registrable domain.
  | { kind: "aggregator"; site: string; domain: string; url: string };

function parseUrl(input: string): URL | null {
  const value = input.trim();
  try {
    return new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`);
  } catch {
    return null;
  }
}

const ID = /^[A-Za-z0-9-]{3,}$/;

function boardLink(url: URL): JobLink | null {
  const host = url.hostname.toLowerCase();
  const entry = JOB_BOARD_HOSTS.find((b) => b.hosts.includes(host));
  if (!entry) return null;
  const parts = url.pathname.split("/").filter(Boolean);
  let slug: string | undefined;
  let path: string[] | null = null;

  switch (entry.platform) {
    case "Ashby":
      // jobs.ashbyhq.com/<slug>/<id>[/application]
      if (parts.length >= 2 && ID.test(parts[1])) [slug, path] = [parts[0], parts.slice(0, 2)];
      break;
    case "Lever":
      // jobs.lever.co/<slug>/<id>[/apply]
      if (parts.length >= 2 && ID.test(parts[1])) [slug, path] = [parts[0], parts.slice(0, 2)];
      break;
    case "Greenhouse":
      // boards.greenhouse.io/<slug>/jobs/<id>, or the embed form
      // boards.greenhouse.io/embed/job_app?for=<slug>&token=<id>
      if (parts[0]?.toLowerCase() === "embed") {
        const forSlug = url.searchParams.get("for");
        const token = url.searchParams.get("token");
        if (forSlug && token && /^\d+$/.test(token)) [slug, path] = [forSlug, [forSlug, "jobs", token]];
      } else if (parts.length >= 3 && parts[1] === "jobs" && /^\d+$/.test(parts[2])) {
        [slug, path] = [parts[0], parts.slice(0, 3)];
      }
      break;
    case "Workable":
      // apply.workable.com/<slug>/j/<id>
      if (parts.length >= 3 && parts[1] === "j" && ID.test(parts[2])) [slug, path] = [parts[0], parts.slice(0, 3)];
      break;
  }
  if (!slug || !path || !/^[A-Za-z0-9_.-]+$/.test(slug)) return null;
  const base = `https://${host.replace(/^job-boards\./, "boards.")}`;
  return {
    kind: "board",
    platform: entry.platform,
    slug: slug.toLowerCase(),
    url: `${base}/${path.join("/")}`,
    boardUrl: `${base}/${slug.toLowerCase()}`,
  };
}

// A job posting link on LinkedIn (any linkedin.com link with currentJobId=
// or /jobs/view/<id>) or on Ashby, Greenhouse, Lever or Workable, or null.
export function parseJobLink(input: string): JobLink | null {
  const url = parseUrl(input);
  if (!url || !/^https?:$/.test(url.protocol)) return null;

  if (registrableDomain(url.hostname) === LINKEDIN_DOMAIN) {
    const current = url.searchParams.get("currentJobId");
    const fromPath = /\/jobs\/view\/(?:[^/]*?-)?(\d+)\/?$/i.exec(url.pathname)?.[1];
    const jobId = current && /^\d+$/.test(current) ? current : fromPath;
    if (!jobId || jobId.length < 5 || jobId.length > 20) return null;
    return { kind: "linkedin", jobId, url: `https://www.linkedin.com/jobs/view/${jobId}` };
  }
  return boardLink(url) ?? aggregatorLink(url);
}

const SAFE_ID = /^[A-Za-z0-9_-]{2,64}$/;

function aggregatorLink(url: URL): JobLink | null {
  const domain = registrableDomain(url.hostname);
  if (!domain) return null;
  const listed = jobAggregator(domain);
  if (!listed && !isGovernment(domain)) return null;
  const host = url.hostname.toLowerCase() === domain ? `www.${domain}` : url.hostname.toLowerCase();
  const path = url.pathname.replace(/\/+$/, "");
  const keep = new Set((listed?.keepParams ?? [...GOV_JOB_ID_PARAMS]).map((k) => k.toLowerCase()));
  const params = [...url.searchParams.entries()].filter(
    ([k, v]) => keep.has(k.toLowerCase()) && SAFE_ID.test(v),
  );
  const param = (...names: string[]) => params.find(([k]) => names.includes(k.toLowerCase()))?.[1] ?? null;
  const site = listed?.name ?? domain;
  const make = (clean: string): JobLink => ({ kind: "aggregator", site, domain, url: clean });
  const withParams = (p: string) =>
    `https://${host}${p}${params.length ? `?${new URLSearchParams(params).toString()}` : ""}`;

  switch (listed?.name) {
    case "Indeed": {
      const jk = param("jk", "vjk");
      return jk ? make(`https://${host}/viewjob?jk=${jk}`) : null;
    }
    case "Glassdoor": {
      // Search page paths carry the search terms, so with a listing ID only
      // the ID is kept.
      const jl = param("jl", "joblistingid");
      if (jl) return make(`https://${host}/job-listing/j?jl=${jl}`);
      return /^\/job-listing\/[^/]+$/i.test(path) ? make(`https://${host}${path}`) : null;
    }
    case "ZipRecruiter": {
      const jid = param("jid");
      if (/^\/c\/[^/]+\/job\//i.test(path)) return make(withParams(path));
      return jid ? make(`https://${host}/jobs?jid=${jid}`) : null;
    }
    case "Monster":
      return /^\/job-openings\/[^/]+$/i.test(path) ? make(`https://${host}${path}`) : null;
    case "USAJOBS": {
      const id = /^\/(?:job|getjob\/viewdetails)\/(\d+)$/i.exec(path)?.[1];
      return id ? make(`https://www.usajobs.gov/job/${id}`) : null;
    }
  }
  // State and other government job boards: a job-posting path with the
  // job's ID in the query or the path.
  if (!/job/i.test(path)) return null;
  if (params.length === 0 && !/\/\d{4,}(\/|$)/.test(path)) return null;
  return make(withParams(path));
}

// True for a link on LinkedIn or a hiring platform that isn't a job posting
// Doubletake can read (a profile, a search page, a board's front page).
export function isUnsupportedJobSiteLink(input: string): boolean {
  if (parseJobLink(input)) return false;
  const host = hostOf(input);
  return (
    host !== null &&
    (registrableDomain(host) === LINKEDIN_DOMAIN || hiringPlatform(host) !== null || jobAggregator(host) !== null)
  );
}

// ---- LinkedIn posting ----

export type LinkedInPosting = {
  company: string;
  title: string | null;
  // "2 weeks ago", as the posting says it.
  posted: string | null;
  // The company's LinkedIn page slug, when the posting links to it.
  companySlug: string | null;
  // True when the poster is a staffing agency hiring for a client it
  // doesn't name (see forUnnamedClient).
  unnamedClient: boolean;
  // The client a staffing agency says it is hiring for, when it names one.
  client: string | null;
};

// Everything from these headings down is about other jobs and other people.
const OTHER_CONTENT = /\b(similar jobs|people also viewed)\b/i;

const wordCount = (line: string) => line.split(/\s+/).filter(Boolean).length;
// A line of the description: a sentence of at least eight words.
const isSentence = (line: string) => wordCount(line) >= 8 && /[.!?](\s|$)/.test(line);
const isHeading = (line: string) => /^\s{0,3}#{1,6}\s/.test(line);

// The posting without the other jobs and people a site lists after it.
// Cuts only at a line naming that content ("## Similar jobs") that comes
// after the posting's description has started, so a "+ Recommended Jobs"
// tab above the description doesn't cut the description off. Tab and
// navigation labels (a line starting with "+", or a short line with
// nothing after it) never cut. Without a description sentence, any such
// line after the first heading cuts.
export function cutAtOtherJobs(text: string, marker: RegExp): string {
  const lines = text.split("\n");
  const clean = lines.map((l) => cleanText(l));
  let start = clean.findIndex((l, i) => !isHeading(lines[i]) && isSentence(l));
  if (start < 0) start = lines.findIndex((l) => isHeading(l));
  if (start < 0) start = 0;

  for (let i = start + 1; i < lines.length; i++) {
    const line = clean[i];
    if (!marker.test(line)) continue;
    if (/^\s*\+/.test(lines[i])) continue;
    const short = wordCount(line) < 4;
    const hasMore = clean.slice(i + 1, i + 4).some((l) => l !== "");
    if (short && !isHeading(lines[i]) && !hasMore) continue;
    return lines.slice(0, i).join("\n");
  }
  return text;
}
const TITLE_FORMAT = /^(.+?)\s+hiring\s+(.+?)(?:\s+in\s+[^|]+)?\s*\|\s*LinkedIn\s*$/i;
const POSTED =
  /\b(?:re)?posted\s+(\d+|an?|one)\s+(minute|hour|day|week|month|year)s?\s+ago\b|\b(\d+|an?|one)\s+(minute|hour|day|week|month|year)s?\s+ago\b/i;
const SIGN_IN = /^(sign in|join now|linkedin|log in|skip to main content)$/i;

function cleanText(value: string): string {
  return plainText(value).replace(/\s+/g, " ").trim();
}

function plausibleName(value: string | null | undefined): string | null {
  const text = value ? cleanText(value) : "";
  if (text.length < 2 || text.length > 100 || /https?:|www\./i.test(text) || SIGN_IN.test(text)) {
    return null;
  }
  return text;
}

// The only parts of a LinkedIn posting Doubletake keeps: the company's
// name, the job title and how long ago it was posted. Text from "Similar
// jobs" or "People also viewed" down is ignored. Null when the posting
// couldn't be read or doesn't name a company.
export function parseLinkedInPosting(read: Pick<PageRead, "ok" | "title" | "text">): LinkedInPosting | null {
  if (!read.ok) return null;
  const body = cutAtOtherJobs(read.text, OTHER_CONTENT);

  const fromTitle = read.title ? TITLE_FORMAT.exec(read.title.trim()) : null;
  const companyLink =
    /\[([^\]]+)\]\((https?:\/\/(?:[a-z]{2,3}\.)?linkedin\.com\/company\/([a-z0-9_.%-]+)[^)\s]*)\)/i.exec(body);
  const heading = [...body.matchAll(/^\s{0,3}#{1,3}\s+(.+)$/gm)]
    .map((m) => plausibleName(m[1]))
    .find((h): h is string => h !== null);

  const company = plausibleName(companyLink?.[1]) ?? plausibleName(fromTitle?.[1]);
  if (!company) return null;
  const title = heading && compactName(heading) !== compactName(company) ? heading : plausibleName(fromTitle?.[2]);

  const posted = POSTED.exec(body);
  const amount = posted ? (posted[1] ?? posted[3]).toLowerCase() : null;
  const unit = posted ? (posted[2] ?? posted[4]).toLowerCase() : null;
  const n = amount === null ? 0 : /^\d+$/.test(amount) ? Number(amount) : 1;

  return {
    company,
    title,
    posted: posted ? `${n} ${unit}${n === 1 ? "" : "s"} ago` : null,
    companySlug: companyLink ? decodeURIComponent(companyLink[3]).toLowerCase() : null,
    ...clientOf(company, body),
  };
}

// ---- Staffing agencies ----

// Agency detection lives in agency.ts; re-exported for callers of this file.
export { forUnnamedClient } from "./agency";

// Whether a staffing agency posted the job for a client, and the client's
// name when the posting gives it.
function clientOf(poster: string, text: string): { unnamedClient: boolean; client: string | null } {
  const found = agencyClient(poster, text);
  return { unnamedClient: found !== null && found.client === null, client: found?.client ?? null };
}

// ---- LinkedIn company page ----

function companySlugOf(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (registrableDomain(parsed.hostname) !== LINKEDIN_DOMAIN) return null;
    const match = /^\/company\/([^/]+)/i.exec(parsed.pathname);
    return match ? decodeURIComponent(match[1]).toLowerCase() : null;
  } catch {
    return null;
  }
}

export function linkedInCompanyPageUrl(slug: string): string {
  return `https://www.linkedin.com/company/${encodeURIComponent(slug)}/`;
}

// The company's LinkedIn page among search results: the one the posting
// links to, else the first that names the company.
export function pickCompanyPage(
  company: string,
  slug: string | null,
  hits: SearchHit[],
): SearchHit | null {
  const pages = hits.filter((h) => companySlugOf(h.url) !== null);
  return (
    (slug ? pages.find((h) => companySlugOf(h.url) === slug) : undefined) ??
    pages.find((h) => namesCompanyLoosely(`${h.title ?? ""}\n${h.text}`, company)) ??
    null
  );
}

// linkedin.com/redir/redirect?url=https%3A%2F%2Facme.example -> https://acme.example
export function unwrapLinkedInRedirect(link: string): string {
  try {
    const parsed = new URL(link);
    if (
      registrableDomain(parsed.hostname) === LINKEDIN_DOMAIN &&
      parsed.pathname.toLowerCase().startsWith("/redir/redirect")
    ) {
      return parsed.searchParams.get("url") ?? link;
    }
  } catch {
    // Not a URL: return it as it was.
  }
  return link;
}

// The registrable domain in a LinkedIn company page's Website field, or
// null. It is only the company's claim: the caller still has to check it.
export function websiteFieldDomain(text: string): string | null {
  for (const match of text.matchAll(/\bwebsite\b/gi)) {
    const after = text.slice((match.index ?? 0) + match[0].length, (match.index ?? 0) + 300);
    const candidates = [
      ...linksIn(after).map(unwrapLinkedInRedirect),
      // "Website: acme.example" without a scheme.
      ...(/^[\s:*_|>-]*((?:[a-z0-9-]+\.)+[a-z]{2,})\b/i.exec(after)?.slice(1, 2) ?? []),
    ];
    for (const candidate of candidates) {
      const domain = registrableDomain(candidate);
      if (domain && !isThirdParty(domain)) return domain;
    }
  }
  return null;
}

// ---- Job aggregators ----

// Aggregators list other employers' jobs below the posting.
const AGGREGATOR_OTHER_CONTENT =
  /\b(similar jobs|people also viewed|people also searched|jobs you may (?:also )?like|recommended jobs|related jobs|more jobs|other jobs)\b/i;
const EMPLOYER_LABEL =
  /^[ \t]*(?:[-*][ \t]+)?(?:\*\*|__)?(?:company|company name|employer|employer name|hiring (?:company|organi[sz]ation)|organi[sz]ation|posted by)(?:\*\*|__)?[ \t]*[:：]?[ \t]*(?:\*\*|__)?[ \t]*(.*)$/gim;
const TITLE_LABEL =
  /^[ \t]*(?:[-*][ \t]+)?(?:\*\*|__)?(?:job title|title|position|position title)(?:\*\*|__)?[ \t]*[:：][ \t]*(?:\*\*|__)?[ \t]*(.+)$/im;
const CAREERS_PATH = /(careers?|jobs?|join|work-with-us|opportunities|hiring)/i;

// "at Northwind Group in Phoenix, Arizona" -> "Northwind Group". The name
// stops before " in <place>", a comma, " - " or the end of the line.
const AT_EMPLOYER = /^at\s+(.+?)(?=\s+in\s+|\s*,|\s+[-–—]\s+|\s*$)/i;
const LINES_AFTER_HEADING = 3;

function employerUnderHeading(lines: string[]): string | null {
  const heading = lines.findIndex((l) => /^\s{0,3}#{1,3}\s+\S/.test(l));
  if (heading < 0) return null;
  const next = lines
    .slice(heading + 1)
    .map((l) => cleanText(l))
    .filter((l) => l !== "")
    .slice(0, LINES_AFTER_HEADING);
  for (const line of next) {
    const match = AT_EMPLOYER.exec(line);
    if (match) return match[1];
  }
  return null;
}

// Links written without a scheme ("Shortcut: careers.northwind.example/3869AO"),
// as https:// links. Email addresses and links already written with a
// scheme are skipped.
function bareLinksIn(markdown: string): string[] {
  const text = plainText(markdown);
  const out: string[] = [];
  for (const m of text.matchAll(/(?<![\w@/.:-])((?:[a-z0-9-]+\.)+[a-z]{2,})(\/[^\s<>()[\]"'`]*)?/gi)) {
    const host = m[1].toLowerCase();
    if (!isRealDomain(host)) continue;
    out.push(`https://${host}${(m[2] ?? "").replace(/[.,;:!?]+$/, "")}`);
  }
  return out;
}

export type AggregatorPosting = {
  // The employer the posting names, never the site it is on.
  employer: string;
  title: string | null;
  // The employer's own domain, when the posting links to it. A claim only.
  site: string | null;
  // The employer's own careers page, when the posting links to it.
  careersUrl: string | null;
  unnamedClient: boolean;
  client: string | null;
  // The posting text above the other jobs the site lists.
  body: string;
};

// Reads a posting on a job aggregator or public job board for the employer
// it names. Null when the posting couldn't be read or names no employer.
export function parseAggregatorPosting(
  read: Pick<PageRead, "ok" | "title" | "text">,
  link: Extract<JobLink, { kind: "aggregator" }>,
): AggregatorPosting | null {
  if (!read.ok) return null;
  const body = cutAtOtherJobs(read.text, AGGREGATOR_OTHER_CONTENT);
  const lines = body.split("\n");

  const notSite = (name: string | null) =>
    name && compactName(name) !== compactName(link.site) && compactName(name) !== compactName(domainLabel(link.domain) ?? "")
      ? name
      : null;

  let employer: string | null = null;
  for (const match of body.matchAll(EMPLOYER_LABEL)) {
    let value = match[1]?.trim() ?? "";
    if (value === "") {
      // The value on the next non-empty line.
      const at = body.slice(0, match.index ?? 0).split("\n").length;
      value = lines.slice(at).find((l) => l.trim() !== "")?.trim() ?? "";
    }
    employer = notSite(plausibleName(value));
    if (employer) break;
  }
  // "at <Employer> in <place>" on a plain line just under the job title
  // heading, as some state job boards write it.
  employer ??= notSite(plausibleName(employerUnderHeading(lines)));
  // Indeed's company link, or "... at <Employer>" in the page title.
  employer ??= notSite(plausibleName(/\[([^\]]+)\]\(https?:\/\/[^)\s]*\/cmp\/[^)\s]+\)/i.exec(body)?.[1]));
  employer ??= notSite(plausibleName(read.title ? /\bat\s+(.+?)\s*(?:\||\s[-–—]\s|$)/i.exec(read.title)?.[1] : null));
  if (!employer) return null;

  const heading = [...body.matchAll(/^\s{0,3}#{1,3}\s+(.+)$/gm)]
    .map((m) => notSite(plausibleName(m[1])))
    .find((h): h is string => h !== null && compactName(h) !== compactName(employer!));
  const title = plausibleName(TITLE_LABEL.exec(body)?.[1]) ?? heading ?? null;

  // The employer's own site: a link whose domain name matches the employer.
  const target = compactName(coreName(employer));
  let site: string | null = null;
  let careersUrl: string | null = null;
  for (const href of [...linksIn(body), ...bareLinksIn(body)]) {
    const domain = registrableDomain(href);
    if (!domain || domain === link.domain || isThirdParty(domain)) continue;
    const label = (domainLabel(domain) ?? "").replace(/-/g, "");
    if (label.length < 2 || !(label.includes(target) || target.includes(label))) continue;
    if (site && site !== domain) continue;
    site = domain;
    if (!careersUrl) {
      let clean: URL | null = null;
      try {
        clean = new URL(href);
      } catch {
        // Not a usable link; it still counts for the domain.
      }
      if (clean && CAREERS_PATH.test(`${clean.hostname}${clean.pathname}`)) {
        clean.search = "";
        clean.hash = "";
        careersUrl = clean.toString();
      }
    }
  }

  return { employer, title, site, careersUrl, ...clientOf(employer, body), body };
}

// ---- Job boards ----

const BOARD_TITLE = [
  /^job application for\s+(.+?)\s+at\s+(.+)$/i, // Greenhouse
  /^(.+?)\s+@\s+(.+)$/, // Ashby
];

// The company's name and site from a board posting: the name from the
// board's slug (written the way the posting's title writes it), the site
// from the posting's own link back to a domain whose name matches.
export function boardPostingInfo(
  link: Extract<JobLink, { kind: "board" }>,
  posting: PageRead | null,
): { company: string; title: string | null; site: string | null; unnamedClient: boolean; client: string | null } {
  const slugName = tidyName(link.slug.replace(/[-_.]+/g, " "));
  const titles = posting?.title ? [posting.title] : [];
  const company = properName(slugName, titles);

  let title: string | null = null;
  if (posting?.ok) {
    const heading = [...posting.text.matchAll(/^\s{0,3}#{1,3}\s+(.+)$/gm)]
      .map((m) => plausibleName(m[1]))
      .find((h): h is string => h !== null && compactName(h) !== compactName(company));
    title = heading ?? null;
  }
  if (!title && posting?.title) {
    for (const pattern of BOARD_TITLE) {
      const m = pattern.exec(posting.title.trim());
      if (m) {
        title = plausibleName(m[1]);
        break;
      }
    }
    if (!title) {
      // Lever and Workable: "Acme - Senior Engineer" or "Senior Engineer - Acme".
      const parts = posting.title.split(/\s+[-–|]\s+/).map((p) => p.trim());
      const other = parts.filter((p) => compactName(p) !== compactName(company));
      if (parts.length >= 2 && other.length === parts.length - 1) title = plausibleName(other[0]);
    }
  }

  let site: string | null = null;
  if (posting?.ok) {
    const target = compactName(link.slug);
    for (const href of linksIn(posting.text)) {
      const domain = registrableDomain(href);
      if (!domain || isThirdParty(domain)) continue;
      const label = (domainLabel(domain) ?? "").replace(/-/g, "");
      if (label.length >= 2 && target.length >= 2 && (label.includes(target) || target.includes(label))) {
        site = domain;
        break;
      }
    }
  }
  return {
    company,
    title,
    site,
    ...(posting?.ok ? clientOf(company, posting.text) : { unnamedClient: false, client: null }),
  };
}

// The job boards the company's own pages link to ("Apply" or "Open roles"
// links), as board front pages to read, the job's own board first.
export function linkedBoardPages(
  reads: PageRead[],
  officialDomain: string,
  job: JobLink | null,
): string[] {
  const boards = new Map<string, string>();
  for (const read of reads) {
    if (!read.ok || registrableDomain(read.url) !== officialDomain) continue;
    for (const href of linksIn(read.text)) {
      if (!hiringPlatform(href)) continue;
      const key = boardKey(href);
      if (!key || key.endsWith("/") || boards.has(key)) continue;
      boards.set(key, `https://${key}`);
    }
  }
  const own = job?.kind === "board" ? boardKey(job.url) : null;
  return [...boards.entries()]
    .sort(([a], [b]) => (a === own ? -1 : b === own ? 1 : 0))
    .map(([, url]) => url);
}

// ---- Careers check ----

const CLOSED =
  /\b(no longer (?:available|accepting applications|open|active|being accepted|posted)|(?:position|job|role|posting|vacancy|opening) (?:has been|is|was) (?:filled|closed|expired|removed)|(?:job|role|position|posting) (?:has )?(?:closed|expired)|applications (?:are |have )?closed)\b/i;

const LOADING = /\b(please wait|loading\s*(?:\.\.\.|…)|enable javascript|javascript is (?:required|disabled))/i;

// True for a page whose listings hadn't loaded when it was read.
export function looksUnloaded(text: string): boolean {
  return LOADING.test(plainText(text));
}

export function saysClosed(text: string): boolean {
  return CLOSED.test(plainText(text));
}

function normalize(text: string): string {
  return ` ${plainText(text)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9+#]+/g, " ")
    .trim()} `;
}

// Where the job title appears in a page, as an index into the normalised
// text, or -1. A trailing note in brackets ("(Remote)") may be left out.
function titleIndex(pageText: string, title: string): { at: number; text: string; length: number } {
  const text = normalize(pageText);
  const variants = [title, title.replace(/\s*[([][^)\]]*[)\]]\s*$/, "")]
    .map(normalize)
    .filter((v, i, all) => v.trim().length >= 3 && all.indexOf(v) === i);
  for (const v of variants) {
    const at = text.indexOf(v);
    if (at >= 0) return { at, text, length: v.length };
  }
  return { at: -1, text, length: 0 };
}

// Looks for the job title on the company's own careers pages and the job
// boards its site links to. The posting itself saying the job is no longer
// available, or a listing saying so next to the title, means "closed".
export function checkCareers(
  title: string | null,
  pages: PageRead[],
  posting: PageRead | null,
): { result: CareersResult; url: string | null; urls?: string[] } {
  if (!title) return { result: "couldnt_check", url: null };
  if (posting?.ok && posting.text && saysClosed(posting.text)) {
    return { result: "closed", url: posting.url };
  }
  const readable = pages.filter((p) => p.ok);
  // Whether the job is listed open on a page: true, false (closed there) or
  // null (not on it).
  const openOn = (page: PageRead): boolean | null => {
    const found = titleIndex(page.text, title);
    if (found.at < 0) return null;
    const near = found.text.slice(Math.max(0, found.at - 150), found.at + found.length + 150);
    return !saysClosed(near);
  };
  for (const page of readable) {
    const open = openOn(page);
    if (open === null) continue;
    if (!open) return { result: "closed", url: page.url };
    // Every page that lists it open, so one reason can link them all.
    const urls = readable.filter((p) => openOn(p) === true).map((p) => p.url);
    return { result: "listed", url: page.url, urls };
  }
  // A page still showing a loading spinner hasn't shown its listings, so it
  // can't show the job is missing.
  const loaded = readable.filter((p) => !looksUnloaded(p.text));
  if (loaded.length) return { result: "not_listed", url: loaded[0].url };
  return { result: "couldnt_check", url: null };
}
