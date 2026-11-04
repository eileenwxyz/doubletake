import { parse } from "tldts";
import {
  DEFAULT_LOCALE,
  DIRECTORIES,
  FREE_EMAIL_PROVIDERS,
  HIRING_PLATFORMS,
  LOCALE_SEGMENT,
  PERSONAL_PROFILE_PATHS,
  REPORT_SITES,
  RESERVED_TEST_SUFFIXES,
  TRACKING_PARAMS,
  type SitePages,
} from "./domain-lists";

// Private Public Suffix List entries (vercel.app, github.io, ...) count as
// suffixes, so acme.vercel.app is its own registrable domain and is not
// owned by whoever owns vercel.app.
const PSL_OPTIONS = { allowPrivateDomains: true };

export function hostOf(input: string): string | null {
  const value = input.trim();
  if (value === "") return null;
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`);
    const host = url.hostname.toLowerCase().replace(/\.$/, "");
    return host || null;
  } catch {
    return null;
  }
}

function parseHost(hostOrUrl: string) {
  const host = hostOf(hostOrUrl);
  if (!host) return null;
  const parsed = parse(host, PSL_OPTIONS);
  if (parsed.isIp || !parsed.domain) return null;
  return { host, ...parsed };
}

// The registrable domain ("eTLD+1"): jobs.acme.example.scam.example belongs
// to scam.example, careers.acme.example to acme.example.
export function registrableDomain(hostOrUrl: string): string | null {
  return parseHost(hostOrUrl)?.domain ?? null;
}

// The registrable domain without its public suffix: "acme" for acme.example
// and for acme.vercel.app.
export function domainLabel(hostOrUrl: string): string | null {
  return parseHost(hostOrUrl)?.domainWithoutSuffix ?? null;
}

// True when the public suffix is a known one (or a reserved test suffix),
// so "e.g" or "careers.html" aren't mistaken for domains.
export function isRealDomain(hostOrUrl: string): boolean {
  const parsed = parseHost(hostOrUrl);
  if (!parsed) return false;
  return (
    parsed.isIcann === true ||
    parsed.isPrivate === true ||
    RESERVED_TEST_SUFFIXES.has(parsed.publicSuffix ?? "")
  );
}

// ftc.gov, scamwatch.gov.au: the public suffix itself contains "gov", so a
// host like gov.scam.example doesn't qualify.
export function isGovernment(hostOrUrl: string): boolean {
  const suffix = parseHost(hostOrUrl)?.publicSuffix ?? "";
  return suffix.split(".").includes("gov");
}

export function hiringPlatform(hostOrUrl: string): string | null {
  const domain = registrableDomain(hostOrUrl);
  if (!domain) return null;
  return HIRING_PLATFORMS.find((p) => p.domains.includes(domain))?.name ?? null;
}

export function isFreeEmailProvider(hostOrUrl: string): boolean {
  const domain = registrableDomain(hostOrUrl);
  return domain !== null && FREE_EMAIL_PROVIDERS.has(domain);
}

function pathOf(url: string): string {
  try {
    return new URL(url).pathname.toLowerCase();
  } catch {
    return "";
  }
}

function onSitePages(url: string, sites: ReadonlyArray<SitePages>): boolean {
  const domain = registrableDomain(url);
  const path = pathOf(url);
  return sites.some(
    (d) =>
      d.domain === domain &&
      (!d.pathPrefix || path.startsWith(d.pathPrefix)) &&
      (!d.pathPattern || d.pathPattern.test(path)),
  );
}

export function isDirectory(url: string): boolean {
  return onSitePages(url, DIRECTORIES);
}

// Forums and review sites, including facebook.com group posts.
export function isReportSite(url: string): boolean {
  return onSitePages(url, REPORT_SITES);
}

// True for any page on a site listed in REPORT_SITES, whatever its path.
export function isReportDomain(domain: string): boolean {
  return REPORT_SITES.some((site) => site.domain === domain);
}

export function isPersonalUrl(url: string): boolean {
  if (/^mailto:/i.test(url) || url.includes("@")) return true;
  const domain = registrableDomain(url);
  const path = pathOf(url);
  return PERSONAL_PROFILE_PATHS.some(
    (p) => p.domain === domain && path.startsWith(p.pathPrefix),
  );
}

// Identifies one company's board on a shared hiring platform:
// jobs.lever.co/acme and jobs.lever.co/acme/123 share "jobs.lever.co/acme".
export function boardKey(url: string): string | null {
  try {
    const parsed = new URL(url);
    const first = parsed.pathname.split("/").filter(Boolean)[0] ?? "";
    return `${parsed.hostname.toLowerCase()}/${first.toLowerCase()}`;
  } catch {
    return null;
  }
}

// Normalised form used to spot duplicate URLs: case, trailing slash,
// fragments, "www." and tracking parameters are ignored.
export function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url.trim());
    const params = [...parsed.searchParams.entries()]
      .filter(([key]) => {
        const k = key.toLowerCase();
        return !k.startsWith("utm_") && !TRACKING_PARAMS.has(k);
      })
      .sort(([a], [b]) => a.localeCompare(b));
    const query = params.length
      ? `?${new URLSearchParams(params).toString()}`
      : "";
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    const path = parsed.pathname.replace(/\/+$/, "");
    return `${host}${path}${query}`.toLowerCase();
  } catch {
    return url.trim().toLowerCase().replace(/\/+$/, "");
  }
}

// The language and region segment at the start of a URL's path ("en-gb"
// for acme.example/en-gb/careers), or null.
export function localeOf(url: string): string | null {
  try {
    const first = new URL(url.trim()).pathname.split("/").filter(Boolean)[0] ?? "";
    return LOCALE_SEGMENT.test(first) ? first.toLowerCase() : null;
  } catch {
    return null;
  }
}

// Like normalizeUrl, but language and region copies of a page share a key:
// acme.example/en-us/careers and acme.example/de-de/careers are one page.
export function pageKey(url: string): string {
  const locale = localeOf(url);
  if (!locale) return normalizeUrl(url);
  const parsed = new URL(url.trim());
  parsed.pathname = parsed.pathname.replace(/^\/[^/]+/, "") || "/";
  return normalizeUrl(parsed.toString());
}

// The user's language and region from an Accept-Language header, such as
// "en-gb" for "en-GB,en;q=0.9". Falls back to en-us.
export function preferredLocale(acceptLanguage: string | null | undefined): string {
  const first = (acceptLanguage ?? "").split(",")[0]?.split(";")[0]?.trim() ?? "";
  return LOCALE_SEGMENT.test(first) ? first.toLowerCase() : DEFAULT_LOCALE;
}

// Lower is better: the user's own locale, then their language in another
// region, then the default locale, then a page with no locale, then the rest.
function localeRank(url: string, locale: string): number {
  const own = localeOf(url);
  if (own === locale) return 0;
  if (own && own.slice(0, 2) === locale.slice(0, 2)) return 1;
  if (own === DEFAULT_LOCALE) return 2;
  if (own === null) return 3;
  return 4;
}

// One item per page (see pageKey), in first-seen order. When a page has
// language and region copies, the copy in the user's locale is kept.
export function dedupeByUrl<T extends { url: string }>(
  items: T[],
  locale: string = DEFAULT_LOCALE,
): T[] {
  const best = new Map<string, T>();
  for (const item of items) {
    const key = pageKey(item.url);
    const current = best.get(key);
    if (!current || localeRank(item.url, locale) < localeRank(current.url, locale)) {
      best.set(key, item);
    }
  }
  return [...best.values()];
}

function levenshtein(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const temp = prev[j];
      prev[j] = Math.min(
        prev[j] + 1,
        prev[j - 1] + 1,
        diag + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      diag = temp;
    }
  }
  return prev[b.length];
}

// Lower-case letters and digits only: "Acme Robotics, Inc." -> "acmerobotics".
export function compactName(name: string): string {
  return stripCorporateSuffix(name).toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function stripCorporateSuffix(name: string): string {
  return name
    .trim()
    .replace(
      /[\s,]+(inc|incorporated|llc|ltd|limited|corp|corporation|co|company|gmbh|plc)\.?$/i,
      "",
    )
    .trim();
}

// A near-copy of an official domain: one character off, the official name
// plus extra words or hyphens, the same name on another suffix (including
// private suffixes such as vercel.app), or the official domain placed at the
// front of someone else's domain.
export function isLookalike(
  candidateHost: string,
  officialDomain: string,
  companyName: string,
): boolean {
  const host = hostOf(candidateHost);
  const candidate = registrableDomain(candidateHost);
  if (!host || !candidate || candidate === officialDomain) return false;

  // jobs.acme.example.scam.example
  if (`.${host}.`.includes(`.${officialDomain}.`)) return true;

  const label = domainLabel(candidate) ?? "";
  const flat = label.replace(/-/g, "");
  const officialLabel = (domainLabel(officialDomain) ?? "").replace(/-/g, "");
  const names = [officialLabel, compactName(companyName)].filter(
    (n, i, all) => n.length >= 3 && all.indexOf(n) === i,
  );

  for (const name of names) {
    if (flat === name) return true; // acme.vercel.app, ac-me.example
    if (name.length >= 4 && flat.includes(name)) return true; // careers-acme.example
    if (name.length < 4 && label.split("-").includes(name)) return true;
    if (name.length >= 4 && levenshtein(flat, name) === 1) return true; // acmee.example, acne.example
  }
  return false;
}
