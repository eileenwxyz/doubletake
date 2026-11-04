import {
  ADVICE_SITES,
  AUTOMATED_RATING_SITES,
  REGULATORS,
} from "./domain-lists";
import {
  boardKey,
  hiringPlatform,
  isDirectory,
  isGovernment,
  isReportSite,
  pageKey,
  registrableDomain,
} from "./domains";
import { isQuestionPost, namesCompanyExactly } from "./text";
import type { SourceType } from "./types";

export type SourceContext = {
  company: string;
  officialDomain: string | null;
  // Boards on hiring platforms that the official pages link to (boardKey).
  linkedBoards: ReadonlySet<string>;
  // Registrable domains the official pages link to.
  linkedDomains: ReadonlySet<string>;
  // The sender's registrable domain, when a recruiter email was given.
  senderDomain?: string | null;
  // The job aggregator or public job board a linked posting is on. The
  // posting itself is "Other"; every other page on that site (its own fraud
  // notice, say) is general advice, never official and never an authority.
  jobSite?: { domain: string; postingUrl: string } | null;
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// A rating site's page about one of the checked domains, such as
// scamadviser.com/check-website/acme.example. The domain may be written with
// dashes for dots (acme-example). Any other page on a rating site (articles,
// lists, pages about other sites) is general advice.
export function isRatingPageFor(url: string, domains: ReadonlyArray<string | null | undefined>): boolean {
  let where: string;
  try {
    const parsed = new URL(url);
    where = decodeURIComponent(`${parsed.pathname}${parsed.search}`).toLowerCase();
  } catch {
    return false;
  }
  return domains.some((domain) => {
    if (!domain) return false;
    return [domain, domain.replace(/\./g, "-")].some((form) =>
      new RegExp(`(?<![a-z0-9-])${escapeRegExp(form)}(?![a-z0-9]|\\.[a-z0-9])`).test(where),
    );
  });
}

function isPortfolioPage(url: string): boolean {
  try {
    return /portfolio|investments?|companies/i.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

// Source types, first match wins:
// Official, Authority, Automated rating, Directory, Report, General advice, Other.
// An authority page that doesn't name the company is general advice, and a
// forum post only counts as a report when it names the exact company and
// isn't just a question.
export function classifySource(
  url: string,
  title: string | null,
  text: string,
  ctx: SourceContext,
): SourceType {
  const domain = registrableDomain(url);
  if (!domain) return "Other";

  if (ctx.officialDomain && domain === ctx.officialDomain) return "Official";
  if (hiringPlatform(domain) && ctx.linkedBoards.has(boardKey(url) ?? "")) {
    return "Official";
  }

  if (ctx.jobSite && domain === ctx.jobSite.domain) {
    return pageKey(url) === pageKey(ctx.jobSite.postingUrl) ? "Other" : "General advice";
  }

  const names = namesCompanyExactly(`${title ?? ""}\n${text}`, ctx.company, [
    ctx.officialDomain,
  ]);

  const authority =
    isGovernment(domain) ||
    REGULATORS.has(domain) ||
    // Investor portfolio pages count only when the company itself links to
    // the investor, so anyone can't publish a "portfolio" page.
    (isPortfolioPage(url) && ctx.linkedDomains.has(domain));
  if (authority && names) return "Authority";

  if (AUTOMATED_RATING_SITES.has(domain)) {
    return isRatingPageFor(url, [ctx.officialDomain, ctx.senderDomain])
      ? "Automated rating"
      : "General advice";
  }
  if (isDirectory(url)) return "Directory";
  if (ADVICE_SITES.has(domain)) return "General advice";

  if (isReportSite(url)) {
    if (!names) return "General advice";
    return isQuestionPost(title, text) ? "Other" : "Report";
  }

  return names ? "Other" : "General advice";
}
