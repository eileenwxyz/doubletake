import {
  boardKey,
  dedupeByUrl,
  hiringPlatform,
  isFreeEmailProvider,
  isPersonalUrl,
  normalizeUrl,
  registrableDomain,
} from "./domains";
import { findOfficialDomain } from "./official";
import { evaluateSender, type SenderResult } from "./sender";
import { classifySource, type SourceContext } from "./sources";
import {
  displayHost,
  findRecruitingList,
  hasImpersonationNotice,
  hasWarningLanguage,
  isQuestionPost,
  linksIn,
  mentionsDomain,
  namesCompanyExactly,
  type RecruitingList,
} from "./text";
import {
  NEED_MORE_DETAIL_MESSAGE,
  type CheckResponse,
  type CouldntFind,
  type Direction,
  type PageRead,
  type Reason,
  type SearchHit,
  type Source,
  type SourceType,
  type Verdict,
} from "./types";

export type CheckInput = {
  company: string;
  website: string | null;
  // The recruiter's full address. Only used for matching; never returned.
  senderAddress: string | null;
  senderDomain: string | null;
  officialHits: SearchHit[];
  warningHits: SearchHit[];
  reads: PageRead[];
  now: Date;
};

export const SUBTITLES = {
  companyOnly: "Company-only check: no recruiter email was given.",
  pagesUnchecked: "Some pages couldn't be checked.",
  scammersUsedName: "Scammers have used this name.",
  notCompanyChannel: "This address is not one of the company's channels.",
} as const;

const MAX_REASONS = 3;
// Fewer distinct pieces of evidence than this beyond the domain itself is
// too thin for a verdict.
const MIN_EVIDENCE = 2;

type Evidence = {
  url: string;
  title: string | null;
  text: string;
  publishDate: string | null;
  type: SourceType;
};

type Candidate = Omit<Reason, "age"> & { priority: number };

const DAY_MS = 24 * 60 * 60 * 1000;

export function formatAge(publishDate: string | null, now: Date): string {
  if (!publishDate) return "Date unknown";
  const date = new Date(`${publishDate.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return "Date unknown";
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const days = Math.round((today - date.getTime()) / DAY_MS);
  const day = publishDate.slice(0, 10);
  if (days < 0) return `Published ${day}`;
  if (days === 0) return `Published ${day} (today)`;
  if (days < 60) return `Published ${day} (${days} day${days === 1 ? "" : "s"} ago)`;
  if (days < 730) return `Published ${day} (${Math.floor(days / 30)} months ago)`;
  return `Published ${day} (${Math.floor(days / 365)} years ago)`;
}

function officialLinks(reads: PageRead[], officialDomain: string) {
  const linkedBoards = new Set<string>();
  const linkedDomains = new Set<string>();
  const linkedPlatforms = new Set<string>();
  const platformPage = new Map<string, string>();
  for (const read of reads) {
    if (!read.ok || registrableDomain(read.url) !== officialDomain) continue;
    for (const link of linksIn(read.text)) {
      const domain = registrableDomain(link);
      if (!domain || domain === officialDomain) continue;
      linkedDomains.add(domain);
      const platform = hiringPlatform(domain);
      if (platform) {
        linkedPlatforms.add(platform);
        if (!platformPage.has(platform)) platformPage.set(platform, read.url);
        const key = boardKey(link);
        if (key) linkedBoards.add(key);
      }
    }
  }
  return { linkedBoards, linkedDomains, linkedPlatforms, platformPage };
}

export function buildReport(input: CheckInput): CheckResponse {
  const { company, now } = input;
  const found = findOfficialDomain(
    company,
    input.website,
    input.officialHits,
    input.senderDomain,
  );
  if (found.status === "ambiguous") {
    return { status: "need_more_detail", message: NEED_MORE_DETAIL_MESSAGE };
  }
  const officialDomain = found.status === "found" ? found.domain : null;

  const officialReads = officialDomain
    ? input.reads.filter((r) => r.role !== "warning" && registrableDomain(r.url) === officialDomain)
    : [];
  const readOk = officialReads.filter((r) => r.ok);
  const officialUnread = officialReads.some((r) => !r.ok);

  const links = officialDomain
    ? officialLinks(input.reads, officialDomain)
    : {
        linkedBoards: new Set<string>(),
        linkedDomains: new Set<string>(),
        linkedPlatforms: new Set<string>(),
        platformPage: new Map<string, string>(),
      };

  // The company's published recruiting list, from full page text only.
  let list: (RecruitingList & { url: string }) | null = null;
  for (const read of readOk) {
    const found = findRecruitingList(read.text);
    if (!found) continue;
    if (!list) {
      list = { ...found, url: read.url };
    } else {
      list.entries = [...new Set([...list.entries, ...found.entries])];
      if (!list.quote && found.quote) {
        list.quote = found.quote;
        list.url = read.url;
      }
    }
  }
  const fraudNotice = readOk.find(
    (r) => hasImpersonationNotice(r.text) || (r.role === "fraud" && hasWarningLanguage(r.text)),
  );

  const ctx: SourceContext = {
    company,
    officialDomain,
    linkedBoards: links.linkedBoards,
    linkedDomains: links.linkedDomains,
  };

  // All evidence, one entry per distinct URL. Full text replaces excerpts
  // when the page was read; a failed read keeps the search excerpt.
  const readsByUrl = new Map(input.reads.map((r) => [normalizeUrl(r.url), r]));
  const raw: Array<Omit<Evidence, "type">> = [
    ...input.officialHits,
    ...input.warningHits,
    ...input.reads.map((r) => ({ ...r, text: "" })),
  ].map((item) => {
    const read = readsByUrl.get(normalizeUrl(item.url));
    return {
      url: item.url,
      title: read?.title ?? item.title,
      publishDate: read?.publishDate ?? item.publishDate,
      text: read?.ok ? read.text : item.text,
    };
  });
  const evidence: Evidence[] = dedupeByUrl(raw)
    .filter((e) => !isPersonalUrl(e.url))
    .map((e) => ({ ...e, type: classifySource(e.url, e.title, e.text, ctx) }));

  const official = evidence.filter((e) => e.type === "Official");
  const firstOfficialUrl =
    readOk[0]?.url ?? official[0]?.url ?? (officialDomain ? `https://${officialDomain}/` : null);

  // A warning counts only when it names the exact company or domain.
  const isWarning = (e: Evidence) =>
    (e.type === "Authority" || e.type === "Report" || e.type === "Other") &&
    hasWarningLanguage(`${e.title ?? ""}\n${e.text}`) &&
    !isQuestionPost(e.title, e.text);
  const warnings = evidence.filter(isWarning);
  // Only Authority pages and Reports can change the verdict. "Other" pages
  // that name the company still show up as Caution reasons.
  const verdictWarnings = warnings.filter((e) => e.type !== "Other");
  const authorityWarnings = warnings.filter((e) => e.type === "Authority");
  // Warnings that name the sender's own (non-company, non-shared) domain.
  const senderRoot = input.senderDomain ? registrableDomain(input.senderDomain) : null;
  const senderWarnings =
    senderRoot &&
    senderRoot !== officialDomain &&
    !isFreeEmailProvider(senderRoot) &&
    !hiringPlatform(senderRoot)
      ? evidence.filter(
          (e) =>
            e.type !== "Official" &&
            !warnings.includes(e) &&
            mentionsDomain(`${e.title ?? ""}\n${e.text}`, senderRoot) &&
            hasWarningLanguage(`${e.title ?? ""}\n${e.text}`) &&
            !isQuestionPost(e.title, e.text),
        )
      : [];
  const directories = evidence.filter(
    (e) =>
      e.type === "Directory" &&
      namesCompanyExactly(`${e.title ?? ""}\n${e.text}`, company, [officialDomain]),
  );

  const corroboration =
    new Set([...official, ...readOk].map((e) => normalizeUrl(e.url))).size + directories.length;
  const thin = !officialDomain || corroboration < MIN_EVIDENCE;
  const anyUnread = input.reads.some((r) => !r.ok);

  // ---- Verdict and subtitle ----
  let sender: SenderResult | null = null;
  let verdict: Verdict;
  let subtitle: string | null = null;

  if (input.senderDomain) {
    sender = evaluateSender({
      senderAddress: input.senderAddress,
      senderDomain: input.senderDomain,
      company,
      officialDomain,
      recruitingList: list?.entries ?? null,
      officialUnread,
      linkedPlatforms: links.linkedPlatforms,
    });
    if (sender.outcome === "strong_warning") verdict = "strong_warning";
    else if (sender.outcome === "mixed") verdict = "mixed";
    else if (sender.outcome === "not_enough" || thin) verdict = "not_enough";
    else verdict = "no_red_flags";

    const passed = sender.outcome === "passes" || sender.outcome === "neutral";
    if (sender.case === "unrelated_unread") {
      subtitle = SUBTITLES.pagesUnchecked;
    } else if (!passed && sender.case !== "free_no_domain" && sender.case !== "unknown_company") {
      subtitle = SUBTITLES.notCompanyChannel;
    } else if (passed && (verdictWarnings.length || fraudNotice)) {
      subtitle = SUBTITLES.scammersUsedName;
    }
  } else if (thin) {
    verdict = "not_enough";
  } else if (verdictWarnings.length && fraudNotice) {
    // The company itself warns that scammers use its name.
    verdict = "no_red_flags";
    subtitle = SUBTITLES.scammersUsedName;
  } else if (authorityWarnings.length) {
    verdict = "strong_warning";
  } else if (verdictWarnings.length) {
    verdict = "mixed";
  } else {
    verdict = "no_red_flags";
  }
  if (!subtitle && anyUnread) subtitle = SUBTITLES.pagesUnchecked;
  if (!subtitle && !input.senderDomain) subtitle = SUBTITLES.companyOnly;

  // ---- Reasons ----
  const candidates: Candidate[] = [];
  const add = (
    priority: number,
    direction: Direction,
    text: string,
    sourceUrl: string | null,
    sourceType?: SourceType,
  ) => {
    const type =
      sourceType ??
      (sourceUrl ? evidence.find((e) => normalizeUrl(e.url) === normalizeUrl(sourceUrl))?.type : undefined) ??
      (sourceUrl && officialDomain && registrableDomain(sourceUrl) === officialDomain
        ? "Official"
        : "Other");
    candidates.push({ priority, direction, text, sourceUrl, sourceType: type });
  };

  if (sender && input.senderDomain) {
    const d = input.senderDomain;
    const o = officialDomain ?? "";
    const listHost = list ? displayHost(list.url) : "";
    switch (sender.case) {
      case "on_list":
        add(0, "reassures", `The sender's domain ${d} is on the recruiting list ${company} publishes on ${listHost}.`, list!.url, "Official");
        break;
      case "controlled_no_list":
        add(0, "reassures", `The sender's domain ${d} belongs to ${company}'s official domain ${o}.`, firstOfficialUrl, "Official");
        break;
      case "controlled_not_on_list":
        add(0, "caution", `The sender's domain ${d} belongs to ${o}, but it is not on the recruiting list ${company} publishes.`, list!.url, "Official");
        break;
      case "controlled_unread":
        add(0, "reassures", `The sender's domain ${d} belongs to ${o}, but ${company}'s recruiting pages couldn't be read, so this check is incomplete.`, firstOfficialUrl, "Official");
        break;
      case "lookalike":
        if (sender.imitates && sender.imitates !== o) {
          add(0, "caution", `The sender's domain ${d} imitates ${sender.imitates}, a recruiting domain ${company} publishes.`, list?.url ?? firstOfficialUrl, "Official");
        } else {
          add(0, "caution", `The sender's domain ${d} imitates ${company}'s official domain ${o}.`, firstOfficialUrl, "Official");
        }
        break;
      case "hiring_linked":
        add(0, "neutral", `${d} is ${sender.platform} hiring software, and ${company}'s own site links to ${sender.platform}.`, links.platformPage.get(sender.platform!) ?? firstOfficialUrl, "Official");
        break;
      case "hiring_unlinked":
        add(0, "caution", `${d} is ${sender.platform} hiring software, but ${company}'s own site doesn't link to ${sender.platform}.`, firstOfficialUrl, "Official");
        break;
      case "free_with_domain":
        add(0, "caution", `${d} is a free email service, but ${company} has its own domain, ${o}.`, firstOfficialUrl, "Official");
        break;
      case "free_no_domain":
        add(0, "caution", `${d} is a free email service, and no company domain was found to compare it with.`, null, "Other");
        break;
      case "unrelated":
        add(0, "caution", `The sender's domain ${d} is not connected to ${company}'s official domain ${o}.`, firstOfficialUrl, "Official");
        break;
      case "unrelated_unread":
        add(0, "caution", `The sender's domain ${d} is not connected to ${company}'s official domain ${o}, and some of ${company}'s pages couldn't be read to check for other recruiting domains.`, firstOfficialUrl, "Official");
        break;
      case "unknown_company":
        add(0, "neutral", `No official domain for ${company} was found to compare ${d} with.`, null, "Other");
        break;
    }
  }

  for (const w of authorityWarnings) {
    add(1, "caution", `A page on ${displayHost(w.url)} warns about ${company} by name.`, w.url);
  }
  for (const w of warnings.filter((e) => e.type !== "Authority")) {
    const what = w.type === "Report" ? "A post on" : "A page on";
    add(2, "caution", `${what} ${displayHost(w.url)} reports a problem involving ${company} by name.`, w.url);
  }
  for (const w of senderWarnings) {
    add(2, "caution", `A page on ${displayHost(w.url)} names ${input.senderDomain} in a scam warning.`, w.url);
  }
  if (list) {
    add(3, "reassures", `${company} publishes the email domains its recruiters use: ${list.entries.map((e) => e.split("@").pop()).filter((v, i, a) => a.indexOf(v) === i).join(", ")}.`, list.url, "Official");
  }
  if (fraudNotice) {
    add(3, "neutral", `${company} publishes a recruiting fraud notice on its own site.`, fraudNotice.url, "Official");
  }
  if (officialDomain && official.length) {
    add(4, "reassures", `${officialDomain} is ${company}'s official website.`, official[0].url, "Official");
  }
  for (const e of directories) {
    add(5, "reassures", `${company} has a company listing on ${displayHost(e.url)}.`, e.url);
  }
  for (const e of evidence.filter((x) => x.type === "Automated rating")) {
    add(6, "neutral", `${displayHost(e.url)} has an automated rating page; automated scores are not a verdict.`, e.url);
  }

  const seen = new Set<string>();
  const reasons: Reason[] = candidates
    .sort((a, b) => a.priority - b.priority)
    .filter((c) => {
      if (!c.sourceUrl) return true;
      const key = normalizeUrl(c.sourceUrl);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, MAX_REASONS)
    .map(({ direction, text, sourceType, sourceUrl }) => {
      const match = sourceUrl
        ? evidence.find((e) => normalizeUrl(e.url) === normalizeUrl(sourceUrl))
        : undefined;
      return { direction, text, sourceType, sourceUrl, age: formatAge(match?.publishDate ?? null, now) };
    });

  // ---- Couldn't find ----
  const couldntFind: CouldntFind[] = dedupeByUrl(input.reads.filter((r) => !r.ok)).map((r) => ({
    kind: "couldnt_check",
    text: `Couldn't read ${displayHost(r.url)}${pathLabel(r.url)}.`,
    url: r.url,
  }));
  if (!officialDomain) {
    couldntFind.push({
      kind: "not_published",
      text: `No official website for ${company} was found.`,
      url: null,
    });
  } else if (readOk.length) {
    if (!list) {
      couldntFind.push({
        kind: "not_published",
        text: `${company} doesn't say which email domains its recruiters use on the pages checked.`,
        url: null,
      });
    }
    if (!fraudNotice && (input.senderDomain || warnings.length)) {
      couldntFind.push({
        kind: "not_published",
        text: `${company} doesn't publish a recruiting fraud notice on the pages checked.`,
        url: null,
      });
    }
  }

  const sources: Source[] = evidence.map((e) => ({
    url: e.url,
    type: e.type,
    publishDate: e.publishDate,
  }));

  return {
    status: "ok",
    verdict,
    subtitle,
    companySays:
      list && list.quote ? { quote: list.quote, domain: displayHost(list.url) } : null,
    reasons,
    couldntFind,
    sources,
    officialDomain,
  };
}

function pathLabel(url: string): string {
  try {
    const path = new URL(url).pathname.replace(/\/+$/, "");
    return path;
  } catch {
    return "";
  }
}
