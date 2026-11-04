import {
  AUTOMATED_RATING_SITES,
  REGULATORS,
  REPORT_SITES,
} from "./domain-lists";
import {
  boardKey,
  hiringPlatform,
  isDirectory,
  isGovernment,
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
};

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

  if (AUTOMATED_RATING_SITES.has(domain)) return "Automated rating";
  if (isDirectory(url)) return "Directory";

  if (REPORT_SITES.has(domain)) {
    if (!names) return "General advice";
    return isQuestionPost(title, text) ? "Other" : "Report";
  }

  return names ? "Other" : "General advice";
}
