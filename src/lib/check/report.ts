import {
  AGES,
  COULDNT_FIND,
  NEED_MORE_DETAIL_MESSAGE,
  REASONS,
  SUBTITLES,
} from "@/lib/copy";
import { DEFAULT_LOCALE } from "./domain-lists";
import {
  boardKey,
  dedupeByUrl,
  hiringPlatform,
  isFreeEmailProvider,
  isPersonalUrl,
  pageKey,
  registrableDomain,
} from "./domains";
import { checkCareers } from "./job-link";
import { findOfficialDomain, officialPageRole } from "./official";
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
  properName,
  tidyName,
  type RecruitingList,
} from "./text";
import {
  type CheckResponse,
  type CouldntFind,
  type Direction,
  type JobResult,
  type NextStepKind,
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
  // The user's language and region ("en-us"); picks which copy of a
  // localised page to keep.
  locale?: string;
  // The search queries that ran, shown under "How we checked".
  searches?: string[];
  // Set for a job check. The posting itself, when one was linked, is in
  // reads with role "job"; its text is only used to see whether it says
  // the job has closed.
  job?: JobInput | null;
};

export type JobInput = {
  title: string | null;
  postingUrl: string | null;
  // "LinkedIn", or the job board's name ("Lever").
  site: string | null;
  posted: string | null;
  // The registrable domain of the aggregator or job board the posting is
  // on, when it isn't the employer's own site or a hiring platform.
  siteDomain?: string | null;
  // A staffing agency posted the job for a client it doesn't name. The
  // agency is what gets checked; the unnamed client is not a warning sign
  // (agencies often keep clients confidential).
  unnamedClient?: boolean;
};

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

// keep: shown even when an earlier reason cites the same page.
type Candidate = Omit<Reason, "age"> & { priority: number; keep?: boolean };

const DAY_MS = 24 * 60 * 60 * 1000;

export function formatAge(publishDate: string | null, now: Date): string {
  if (!publishDate) return AGES.unknown;
  const date = new Date(`${publishDate.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return AGES.unknown;
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const days = Math.round((today - date.getTime()) / DAY_MS);
  const day = publishDate.slice(0, 10);
  if (days < 0) return AGES.future(day);
  if (days === 0) return AGES.today(day);
  if (days < 60) return AGES.days(day, days);
  if (days < 730) return AGES.months(day, Math.floor(days / 30));
  return AGES.years(day, Math.floor(days / 365));
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
  const locale = input.locale ?? DEFAULT_LOCALE;
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

  const senderRoot = input.senderDomain ? registrableDomain(input.senderDomain) : null;
  const ctx: SourceContext = {
    company,
    officialDomain,
    linkedBoards: links.linkedBoards,
    linkedDomains: links.linkedDomains,
    senderDomain: senderRoot,
    jobSite:
      input.job?.siteDomain && input.job.postingUrl
        ? { domain: input.job.siteDomain, postingUrl: input.job.postingUrl }
        : null,
  };

  // All evidence, one entry per distinct URL. Full text replaces excerpts
  // when the page was read; a failed read keeps the search excerpt.
  const readsByUrl = new Map(input.reads.map((r) => [pageKey(r.url), r]));
  const raw: Array<Omit<Evidence, "type">> = [
    ...input.officialHits,
    ...input.warningHits,
    ...input.reads.map((r) => ({ ...r, text: "" })),
  ].map((item) => {
    const read = readsByUrl.get(pageKey(item.url));
    return {
      url: item.url,
      title: read?.title ?? item.title,
      publishDate: read?.publishDate ?? item.publishDate,
      // A job posting's own text never becomes evidence: LinkedIn pages
      // carry other jobs and people, and a board posting is the claim being
      // checked.
      text: read?.role === "job" ? "" : read?.ok ? read.text : item.text,
    };
  });
  const evidence: Evidence[] = dedupeByUrl(raw, locale)
    .filter((e) => !isPersonalUrl(e.url))
    .map((e) => ({ ...e, type: classifySource(e.url, e.title, e.text, ctx) }));

  const official = evidence.filter((e) => e.type === "Official");

  // The company's proper name as its own site writes it, for display only;
  // matching keeps using what the user typed.
  const name = officialDomain
    ? properName(company, [
        ...[...readOk].sort((a, b) => roleOrder(a.role) - roleOrder(b.role)).map((r) => r.title),
        ...official.map((e) => e.title),
      ])
    : tidyName(company);
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
    new Set([...official, ...readOk].map((e) => pageKey(e.url))).size + directories.length;
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
    keep = false,
  ) => {
    const type =
      sourceType ??
      (sourceUrl ? evidence.find((e) => pageKey(e.url) === pageKey(sourceUrl))?.type : undefined) ??
      (sourceUrl && officialDomain && registrableDomain(sourceUrl) === officialDomain
        ? "Official"
        : "Other");
    candidates.push({ priority, direction, text, sourceUrl, sourceType: type, keep });
  };

  if (sender && input.senderDomain) {
    const d = input.senderDomain;
    const o = officialDomain ?? "";
    const listHost = list ? displayHost(list.url) : "";
    switch (sender.case) {
      case "on_list":
        add(0, "reassures", REASONS.onList(d, name, listHost), list!.url, "Official");
        break;
      case "controlled_no_list":
        add(0, "reassures", REASONS.controlledNoList(d, name, o), firstOfficialUrl, "Official");
        break;
      case "controlled_not_on_list":
        add(0, "caution", REASONS.controlledNotOnList(d, name, o), list!.url, "Official");
        break;
      case "controlled_unread":
        add(0, "reassures", REASONS.controlledUnread(d, name, o), firstOfficialUrl, "Official");
        break;
      case "lookalike":
        if (sender.imitates && sender.imitates !== o) {
          add(0, "caution", REASONS.imitatesListed(d, name, sender.imitates), list?.url ?? firstOfficialUrl, "Official");
        } else {
          add(0, "caution", REASONS.imitatesOfficial(d, name, o), firstOfficialUrl, "Official");
        }
        break;
      case "hiring_linked":
        add(0, "neutral", REASONS.hiringLinked(d, name, sender.platform!), links.platformPage.get(sender.platform!) ?? firstOfficialUrl, "Official");
        break;
      case "hiring_unlinked":
        add(0, "caution", REASONS.hiringUnlinked(d, name, sender.platform!), firstOfficialUrl, "Official");
        break;
      case "free_with_domain":
        add(0, "caution", REASONS.freeWithDomain(d, name, o), firstOfficialUrl, "Official");
        break;
      case "free_no_domain":
        add(0, "caution", REASONS.freeNoDomain(d), null, "Other");
        break;
      case "unrelated":
        add(0, "caution", REASONS.unrelated(d, name, o), firstOfficialUrl, "Official");
        break;
      case "unrelated_unread":
        add(0, "caution", REASONS.unrelatedUnread(d, name, o), firstOfficialUrl, "Official");
        break;
      case "unknown_company":
        add(0, "neutral", REASONS.unknownCompany(d, name), null, "Other");
        break;
    }
  }

  for (const w of authorityWarnings) {
    add(1, "caution", REASONS.authorityWarning(displayHost(w.url), name), w.url);
  }
  // ---- Job ----
  let job: JobResult | null = null;
  if (input.job) {
    const posting =
      input.reads.find((r) => r.role === "job" && input.job?.postingUrl && pageKey(r.url) === pageKey(input.job.postingUrl)) ??
      null;
    const postingType = posting
      ? evidence.find((e) => pageKey(e.url) === pageKey(posting.url))?.type ?? null
      : null;
    // The company's own careers pages and the job boards its site links to.
    const listings = input.reads.filter(
      (r) =>
        r.role === "careers" &&
        ((officialDomain && registrableDomain(r.url) === officialDomain) ||
          (hiringPlatform(r.url) !== null && links.linkedBoards.has(boardKey(r.url) ?? ""))),
    );
    const careers = checkCareers(input.job.title, listings, posting);
    const isLinkedIn = input.job.site === "LinkedIn";
    job = {
      title: input.job.title,
      postingUrl: input.job.postingUrl,
      site: input.job.site,
      posted: input.job.posted,
      postingOfficial: postingType === "Official",
      unnamedClient: input.job.unnamedClient ?? false,
      careers: careers.result,
      careersUrl: careers.url,
    };

    const title = input.job.title ?? "";
    const host = careers.url ? displayHost(careers.url) : "";
    if (careers.result === "closed") {
      add(1, "neutral", REASONS.jobClosed(host), careers.url, undefined, true);
    } else if (careers.result === "listed") {
      add(1, "reassures", REASONS.jobListed(title, name, host), careers.url, "Official", true);
    } else if (careers.result === "not_listed") {
      add(1, "caution", REASONS.jobNotListed(title, name, host), careers.url, "Official", true);
    }

    // Hiring-platform boards only: employers don't link to their postings
    // on aggregators or public job boards, so that isn't a caution there.
    if (posting && !isLinkedIn && !input.job.siteDomain && input.job.site) {
      if (postingType === "Official") {
        add(2, "reassures", REASONS.boardLinked(displayHost(posting.url), name, input.job.site), posting.url);
      } else if (officialDomain && readOk.length) {
        add(2, "caution", REASONS.boardUnlinked(name, input.job.site), posting.url);
      }
    }
    if (posting && isLinkedIn) {
      // Supporting evidence at most: LinkedIn doesn't verify postings.
      add(4, "neutral", REASONS.linkedinPosting(name, input.job.posted), posting.url);
    }
  }

  for (const w of warnings.filter((e) => e.type !== "Authority")) {
    const text =
      w.type === "Report"
        ? REASONS.reportWarning(displayHost(w.url), name)
        : REASONS.pageWarning(displayHost(w.url), name);
    add(2, "caution", text, w.url);
  }
  for (const w of senderWarnings) {
    add(2, "caution", REASONS.senderWarning(displayHost(w.url), input.senderDomain!), w.url);
  }
  if (list) {
    add(3, "reassures", REASONS.publishesList(name, list.entries.map((e) => e.split("@").pop()).filter((v, i, a) => a.indexOf(v) === i).join(", ")), list.url, "Official");
  }
  if (fraudNotice) {
    add(3, "neutral", REASONS.fraudNotice(name), fraudNotice.url, "Official");
  }
  if (officialDomain && official.length) {
    add(4, "reassures", REASONS.officialSite(officialDomain, name), official[0].url, "Official");
  }
  for (const e of directories) {
    add(5, "reassures", REASONS.directoryListing(name, displayHost(e.url)), e.url);
  }
  for (const e of evidence.filter((x) => x.type === "Automated rating")) {
    add(6, "neutral", REASONS.automatedRating(displayHost(e.url)), e.url);
  }

  const seen = new Set<string>();
  const reasons: Reason[] = candidates
    .sort((a, b) => a.priority - b.priority)
    .filter((c) => {
      if (!c.sourceUrl) return true;
      const key = pageKey(c.sourceUrl);
      if (seen.has(key) && !c.keep) return false;
      seen.add(key);
      return true;
    })
    .slice(0, MAX_REASONS)
    .map(({ direction, text, sourceType, sourceUrl }) => {
      const match = sourceUrl
        ? evidence.find((e) => pageKey(e.url) === pageKey(sourceUrl))
        : undefined;
      return { direction, text, sourceType, sourceUrl, age: formatAge(match?.publishDate ?? null, now) };
    });

  // ---- Couldn't find ----
  const couldntFind: CouldntFind[] = dedupeByUrl(input.reads.filter((r) => !r.ok), locale).map((r) => ({
    kind: "couldnt_check",
    text: COULDNT_FIND.couldntRead(`${displayHost(r.url)}${pathLabel(r.url)}`),
    url: r.url,
  }));
  if (!officialDomain) {
    couldntFind.push({
      kind: "not_published",
      text: COULDNT_FIND.noOfficialSite(name),
      url: null,
    });
  } else if (readOk.length) {
    if (!list) {
      couldntFind.push({
        kind: "not_published",
        text: COULDNT_FIND.noRecruitingList(name),
        url: null,
      });
    }
    if (!fraudNotice && (input.senderDomain || warnings.length)) {
      couldntFind.push({
        kind: "not_published",
        text: COULDNT_FIND.noFraudNotice(name),
        url: null,
      });
    }
  }

  if (job?.unnamedClient) {
    couldntFind.push({ kind: "couldnt_check", text: COULDNT_FIND.clientNotNamed(name), url: null });
  }
  if (job && job.title && job.careers === "couldnt_check") {
    couldntFind.push({ kind: "couldnt_check", text: COULDNT_FIND.noJobListings(name), url: null });
  }

  // ---- Primary next step ----
  let nextStep: { url: string; kind: NextStepKind } | null = null;
  if (officialDomain) {
    const ownHits = dedupeByUrl(input.officialHits, locale).filter(
      (h) => registrableDomain(h.url) === officialDomain,
    );
    const pageFor = (role: "fraud" | "careers") =>
      readOk.find((r) => r.role === role)?.url ??
      officialReads.find((r) => r.role === role)?.url ??
      ownHits.find((h) => officialPageRole(h) === role)?.url ??
      null;
    const fraudUrl = fraudNotice?.url ?? pageFor("fraud");
    const careersUrl = pageFor("careers");
    if (fraudUrl) nextStep = { url: fraudUrl, kind: "fraud" };
    else if (careersUrl) nextStep = { url: careersUrl, kind: "careers" };
    else {
      const home = readOk.find((r) => r.role === "home")?.url ?? `https://${officialDomain}/`;
      nextStep = { url: home, kind: "site" };
    }
  }

  const lookalike =
    sender?.case === "lookalike" && input.senderDomain
      ? { sender: input.senderDomain, imitates: sender.imitates ?? officialDomain ?? "" }
      : null;

  const sources: Source[] = evidence.map((e) => ({
    url: e.url,
    type: e.type,
    publishDate: e.publishDate,
  }));

  return {
    status: "ok",
    companyName: name,
    checkedAt: now.toISOString(),
    verdict,
    subtitle,
    companySays:
      list && list.quote ? { quote: list.quote, domain: displayHost(list.url) } : null,
    reasons,
    couldntFind,
    sources,
    officialDomain,
    nextStep,
    senderDomain: input.senderDomain,
    lookalike: lookalike && lookalike.imitates ? lookalike : null,
    searches: input.searches ?? [],
    job,
  };
}

function roleOrder(role: PageRead["role"]): number {
  return ["home", "careers", "fraud", "warning"].indexOf(role);
}

function pathLabel(url: string): string {
  try {
    const path = new URL(url).pathname.replace(/\/+$/, "");
    return path;
  } catch {
    return "";
  }
}
