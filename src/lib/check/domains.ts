import { parse } from "tldts";
import {
  DIRECTORIES,
  FREE_EMAIL_PROVIDERS,
  HIRING_PLATFORMS,
  PERSONAL_PROFILE_PATHS,
  RESERVED_TEST_SUFFIXES,
  TRACKING_PARAMS,
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

export function isDirectory(url: string): boolean {
  const domain = registrableDomain(url);
  const path = pathOf(url);
  return DIRECTORIES.some(
    (d) => d.domain === domain && (!d.pathPrefix || path.startsWith(d.pathPrefix)),
  );
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

export function dedupeByUrl<T extends { url: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = normalizeUrl(item.url);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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
