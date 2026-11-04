// Job posting links: parsing what the user pasted, reading a LinkedIn
// posting and company page, and looking for the job on the company's own
// listings.

import { JOB_BOARD_HOSTS, LINKEDIN_DOMAIN } from "./domain-lists";
import { boardKey, compactName, domainLabel, hiringPlatform, hostOf, registrableDomain } from "./domains";
import { isThirdParty } from "./official";
import { linksIn, namesCompanyLoosely, plainText, properName, tidyName } from "./text";
import type { CareersResult, PageRead, SearchHit } from "./types";

export type JobLink =
  // url is always the rebuilt https://www.linkedin.com/jobs/view/<id>, never
  // the link the user pasted (that can hold their search terms and location).
  | { kind: "linkedin"; jobId: string; url: string }
  // url is the posting without its query string; boardUrl is the company's
  // board on the platform (https://jobs.lever.co/<slug>).
  | { kind: "board"; platform: string; slug: string; url: string; boardUrl: string };

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
  return boardLink(url);
}

// True for a link on LinkedIn or a hiring platform that isn't a job posting
// Doubletake can read (a profile, a search page, a board's front page).
export function isUnsupportedJobSiteLink(input: string): boolean {
  if (parseJobLink(input)) return false;
  const host = hostOf(input);
  return host !== null && (registrableDomain(host) === LINKEDIN_DOMAIN || hiringPlatform(host) !== null);
}

// ---- LinkedIn posting ----

export type LinkedInPosting = {
  company: string;
  title: string | null;
  // "2 weeks ago", as the posting says it.
  posted: string | null;
  // The company's LinkedIn page slug, when the posting links to it.
  companySlug: string | null;
};

// Everything from these headings down is about other jobs and other people.
const OTHER_CONTENT = /^.*\b(similar jobs|people also viewed)\b/im;
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
  const cut = OTHER_CONTENT.exec(read.text);
  const body = cut ? read.text.slice(0, cut.index) : read.text;

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
  };
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
): { company: string; title: string | null; site: string | null } {
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
  return { company, title, site };
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
): { result: CareersResult; url: string | null } {
  if (!title) return { result: "couldnt_check", url: null };
  if (posting?.ok && posting.text && saysClosed(posting.text)) {
    return { result: "closed", url: posting.url };
  }
  const readable = pages.filter((p) => p.ok);
  for (const page of readable) {
    const found = titleIndex(page.text, title);
    if (found.at < 0) continue;
    const near = found.text.slice(Math.max(0, found.at - 150), found.at + found.length + 150);
    return { result: saysClosed(near) ? "closed" : "listed", url: page.url };
  }
  if (readable.length) return { result: "not_listed", url: readable[0].url };
  return { result: "couldnt_check", url: null };
}
