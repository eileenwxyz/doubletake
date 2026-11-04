import {
  ADVICE_SITES,
  AUTOMATED_RATING_SITES,
  DEFAULT_LOCALE,
  REGULATORS,
  SHARED_SITES,
} from "./domain-lists";
import {
  compactName,
  coreName,
  dedupeByUrl,
  domainLabel,
  hiringPlatform,
  isDirectory,
  isFreeEmailProvider,
  isGovernment,
  jobAggregator,
  isReportDomain,
  pageKey,
  registrableDomain,
} from "./domains";
import {
  hasWarningLanguage,
  isQuestionPost,
  namesCompanyExactly,
  namesCompanyLoosely,
} from "./text";
import type { PageRole, SearchHit } from "./types";

export type OfficialDomain =
  | { status: "found"; domain: string; from: "website" | "search" | "email" }
  | { status: "ambiguous" }
  | { status: "none" };

// A large shared site still belongs to the company it is named after: the
// company's core name is exactly the domain's label (Google and google.com,
// LinkedIn and linkedin.com). Only shared sites get this; a free email
// provider, hiring platform or directory never becomes a company's domain.
export function ownsSharedSite(domain: string, company: string): boolean {
  if (!SHARED_SITES.has(domain)) return false;
  const label = (domainLabel(domain) ?? "").replace(/-/g, "");
  const name = compactName(coreName(company));
  return label.length >= 2 && label === name;
}

// Domains that can't be a company's own site. With the company's name, a
// shared site named after that company is allowed (see ownsSharedSite).
export function isThirdParty(domain: string, company?: string): boolean {
  return (
    (SHARED_SITES.has(domain) && !(company && ownsSharedSite(domain, company))) ||
    isReportDomain(domain) ||
    ADVICE_SITES.has(domain) ||
    AUTOMATED_RATING_SITES.has(domain) ||
    REGULATORS.has(domain) ||
    isGovernment(domain) ||
    isDirectory(`https://${domain}/`) ||
    hiringPlatform(domain) !== null ||
    jobAggregator(domain) !== null ||
    isFreeEmailProvider(domain)
  );
}

function labelMatchesName(domain: string, company: string): boolean {
  const label = (domainLabel(domain) ?? "").replace(/-/g, "");
  const name = compactName(coreName(company));
  if (label.length < 2 || name.length < 2) return false;
  return label.includes(name) || name.includes(label);
}

// Picks the company's official registrable domain.
//
// - A website the user entered always wins.
// - Otherwise, count official-search results per registrable domain, keeping
//   only results whose title or excerpt names the company (its core name,
//   without suffixes such as Group or Inc; see coreName) and skipping
//   third-party sites. Domains whose name matches the company's are preferred.
// - Two or more domains whose name matches the company's (premise.example,
//   premisehealth.example, premise-one.example) mean namesakes: the answer
//   is "ambiguous" however the counts compare, unless the sender's domain is
//   one of them.
// - The leader must have at least twice as many naming results as the
//   runner-up when the runner-up has two or more; otherwise the results point
//   to more than one company and the answer is "ambiguous". If the sender's
//   domain is one of the competing domains, it settles the tie.
// - The top search result alone is never enough to decide.
export function findOfficialDomain(
  company: string,
  website: string | null,
  hits: SearchHit[],
  senderDomain: string | null = null,
): OfficialDomain {
  if (website) {
    const domain = registrableDomain(website);
    if (domain) return { status: "found", domain, from: "website" };
  }

  const counts = new Map<string, number>();
  for (const hit of dedupeByUrl(hits)) {
    const domain = registrableDomain(hit.url);
    if (!domain || isThirdParty(domain, company)) continue;
    // The company's own pages may leave off "Group", "Inc" and the like.
    if (!namesCompanyLoosely(`${hit.title ?? ""}\n${hit.text}`, coreName(company))) continue;
    counts.set(domain, (counts.get(domain) ?? 0) + 1);
  }

  const all = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const named = all.filter(([domain]) => labelMatchesName(domain, company));
  const senderRoot = senderDomain ? registrableDomain(senderDomain) : null;
  if (named.length >= 2) {
    if (senderRoot && named.some(([d]) => d === senderRoot)) {
      return { status: "found", domain: senderRoot, from: "email" };
    }
    return { status: "ambiguous" };
  }
  const pool = named.length ? named : all.filter(([, n]) => n >= 2);
  if (pool.length === 0) return { status: "none" };

  const [leader, runnerUp] = pool;
  const contested =
    runnerUp !== undefined &&
    (runnerUp[1] === leader[1] || (runnerUp[1] >= 2 && leader[1] < 2 * runnerUp[1]));
  if (!contested) return { status: "found", domain: leader[0], from: "search" };

  const competing = pool.filter(([, n]) => n * 2 > leader[1]).map(([d]) => d);
  if (senderRoot && competing.includes(senderRoot)) {
    return { status: "found", domain: senderRoot, from: "email" };
  }
  return { status: "ambiguous" };
}

const FRAUD_PAGE =
  /(fraud|scam|phishing|impersonat|beware|security|recruit\w*[-_ ]?(notice|warning|alert))/i;
const CAREERS_PAGE = /(careers?|jobs?|join[-_ ]?us|work[-_ ]with[-_ ]us|opportunities|hiring)/i;

// How strongly a page looks like the company's recruiting fraud or verified
// email page: 2 when its path or title says fraud, scam, phishing or
// impersonation (/careers/recruitment-fraud), 0 for a contact page, 1
// otherwise. Used to prefer the real notice over a contact page that only
// mentions security.
const STRONG_FRAUD = /(fraud|scam|phishing|impersonat)/i;
const CONTACT_PAGE = /contact/i;

export function fraudPageScore(url: string, title: string | null): number {
  let path = url;
  try {
    path = new URL(url).pathname;
  } catch {
    // keep the raw string
  }
  if (STRONG_FRAUD.test(path) || STRONG_FRAUD.test(title ?? "")) return 2;
  if (CONTACT_PAGE.test(path)) return 0;
  return 1;
}

// The pages in order of fraudPageScore, best first; ties keep their order.
export function byFraudScore<T extends { url: string; title: string | null }>(pages: readonly T[]): T[] {
  return pages
    .map((page, index) => ({ page, index, score: fraudPageScore(page.url, page.title) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((x) => x.page);
}

// From a search limited to the official domain, the page to read for the
// company's recruiting list: the best-looking fraud or verified-email page
// not read yet.
export function pickListPage(
  hits: readonly SearchHit[],
  officialDomain: string,
  alreadyRead: readonly string[],
): string | null {
  const read = new Set(alreadyRead.map(pageKey));
  const fresh = dedupeByUrl([...hits]).filter(
    (h) => registrableDomain(h.url) === officialDomain && !read.has(pageKey(h.url)),
  );
  return byFraudScore(fresh)[0]?.url ?? null;
}

export function officialPageRole(hit: SearchHit): PageRole {
  const label = `${hit.url} ${hit.title ?? ""}`;
  if (FRAUD_PAGE.test(label)) return "fraud";
  if (CAREERS_PAGE.test(label)) return "careers";
  return "home";
}

export type PlannedRead = { url: string; role: PageRole };

export const MAX_OFFICIAL_READS = 3;
export const MAX_WARNING_READS = 2;

// Chooses which pages to read in full: up to 3 official pages (fraud or
// recruiting notice first, then careers) and up to 2 company-specific
// warning pages. Of a page's language and region copies, the one in the
// user's locale is read.
export function planReads(
  company: string,
  officialDomain: string,
  officialHits: SearchHit[],
  warningHits: SearchHit[],
  locale: string = DEFAULT_LOCALE,
): PlannedRead[] {
  const own = dedupeByUrl(officialHits, locale).filter(
    (hit) => registrableDomain(hit.url) === officialDomain,
  );
  const byRole = (role: PageRole) =>
    own.filter((hit) => officialPageRole(hit) === role).map((hit) => ({ url: hit.url, role }));
  // The real fraud notice before a contact page that only mentions security.
  const fraud = byFraudScore(own.filter((hit) => officialPageRole(hit) === "fraud")).map((hit) => ({
    url: hit.url,
    role: "fraud" as const,
  }));
  const careers = byRole("careers");
  const home = byRole("home");

  const ordered = [fraud[0], careers[0], ...fraud.slice(1), ...careers.slice(1), ...home].filter(
    (p): p is PlannedRead => p !== undefined,
  );
  const official = ordered.slice(0, MAX_OFFICIAL_READS);
  if (official.length === 0) {
    official.push({ url: `https://${officialDomain}/`, role: "home" });
  }

  const warnings = dedupeByUrl(warningHits, locale)
    .filter((hit) => registrableDomain(hit.url) !== officialDomain)
    .filter((hit) => {
      const text = `${hit.title ?? ""}\n${hit.text}`;
      return (
        namesCompanyExactly(text, company, [officialDomain]) &&
        hasWarningLanguage(text) &&
        !isQuestionPost(hit.title, hit.text)
      );
    })
    .slice(0, MAX_WARNING_READS)
    .map((hit) => ({ url: hit.url, role: "warning" as const }));

  return [...official, ...warnings];
}
