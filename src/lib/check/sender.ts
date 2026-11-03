import {
  hiringPlatform,
  isFreeEmailProvider,
  isLookalike,
  registrableDomain,
} from "./domains";
import { listCovers } from "./text";

export type SenderOutcome =
  | "passes"
  | "neutral"
  | "mixed"
  | "strong_warning"
  | "not_enough";

export type SenderCase =
  | "on_list"
  | "controlled_no_list"
  | "controlled_not_on_list"
  | "controlled_unread"
  | "lookalike"
  | "hiring_linked"
  | "hiring_unlinked"
  | "free_with_domain"
  | "free_no_domain"
  | "unrelated"
  | "unrelated_unread"
  | "unknown_company";

export type SenderResult = {
  rule: 1 | 2 | 3 | 4 | 5 | 6;
  outcome: SenderOutcome;
  case: SenderCase;
  platform: string | null;
};

export type SenderInput = {
  senderAddress: string | null;
  senderDomain: string;
  company: string;
  officialDomain: string | null;
  // Entries from the company's published recruiting list, or null if none.
  recruitingList: readonly string[] | null;
  // True when at least one official page failed to read.
  officialUnread: boolean;
  // Hiring platforms the company's own site links to.
  linkedPlatforms: ReadonlySet<string>;
};

// Sender-domain rules, first match wins.
export function evaluateSender(input: SenderInput): SenderResult {
  const { senderDomain, officialDomain, recruitingList } = input;
  const result = (
    rule: SenderResult["rule"],
    outcome: SenderOutcome,
    kind: SenderCase,
    platform: string | null = null,
  ): SenderResult => ({ rule, outcome, case: kind, platform });

  // 1. On the company's published recruiting list.
  if (recruitingList && listCovers(recruitingList, input.senderAddress, senderDomain)) {
    return result(1, "passes", "on_list");
  }

  // 2. Controlled by the company but not on its list.
  if (officialDomain && registrableDomain(senderDomain) === officialDomain) {
    if (recruitingList) return result(2, "mixed", "controlled_not_on_list");
    if (input.officialUnread) return result(2, "passes", "controlled_unread");
    return result(2, "passes", "controlled_no_list");
  }

  // 3. A near-copy of the official domain.
  if (officialDomain && isLookalike(senderDomain, officialDomain, input.company)) {
    return result(3, "strong_warning", "lookalike");
  }

  // 4. Hiring software.
  const platform = hiringPlatform(senderDomain);
  if (platform) {
    return input.linkedPlatforms.has(platform)
      ? result(4, "neutral", "hiring_linked", platform)
      : result(4, "mixed", "hiring_unlinked", platform);
  }

  // 5. Free email provider.
  if (isFreeEmailProvider(senderDomain)) {
    return officialDomain
      ? result(5, "strong_warning", "free_with_domain")
      : result(5, "mixed", "free_no_domain");
  }

  // 6. Anything else. Without an official domain there is nothing to compare
  // the sender with, so the answer is "not enough" rather than a warning.
  // When official pages couldn't be read and no recruiting list was found,
  // the company may publish other recruiting domains we couldn't see, so the
  // answer is "mixed" rather than a strong warning.
  if (!officialDomain) return result(6, "not_enough", "unknown_company");
  if (input.officialUnread && !recruitingList) {
    return result(6, "mixed", "unrelated_unread");
  }
  return result(6, "strong_warning", "unrelated");
}
