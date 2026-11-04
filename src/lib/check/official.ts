import {
  ADVICE_SITES,
  AUTOMATED_RATING_SITES,
  DEFAULT_LOCALE,
  REGULATORS,
  SHARED_SITES,
} from "./domain-lists";
import {
  compactName,
  dedupeByUrl,
  domainLabel,
  hiringPlatform,
  isDirectory,
  isFreeEmailProvider,
  isGovernment,
  isReportDomain,
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

// Domains that can't be a company's own site.
export function isThirdParty(domain: string): boolean {
  return (
    SHARED_SITES.has(domain) ||
    isReportDomain(domain) ||
    ADVICE_SITES.has(domain) ||
    AUTOMATED_RATING_SITES.has(domain) ||
    REGULATORS.has(domain) ||
    isGovernment(domain) ||
    isDirectory(`https://${domain}/`) ||
    hiringPlatform(domain) !== null ||
    isFreeEmailProvider(domain)
  );
}

function labelMatchesName(domain: string, company: string): boolean {
  const label = (domainLabel(domain) ?? "").replace(/-/g, "");
  const name = compactName(company);
  if (label.length < 2 || name.length < 2) return false;
  return label.includes(name) || name.includes(label);
}

// Picks the company's official registrable domain.
//
// - A website the user entered always wins.
// - Otherwise, count official-search results per registrable domain, keeping
//   only results whose title or excerpt names the company and skipping
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
    if (!domain || isThirdParty(domain)) continue;
    if (!namesCompanyLoosely(`${hit.title ?? ""}\n${hit.text}`, company)) continue;
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
  const fraud = byRole("fraud");
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
