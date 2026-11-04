import "server-only";

import { extract, search } from "@/lib/parallel";
import {
  boardPostingInfo,
  linkedBoardPages,
  linkedInCompanyPageUrl,
  parseAggregatorPosting,
  parseLinkedInPosting,
  pickCompanyPage,
  websiteFieldDomain,
  type JobLink,
} from "./job-link";
import { CheckStepError, step } from "./errors";
import { findOfficialDomain, pickListPage, planReads } from "./official";
import { findRecruitingList } from "./text";
import { buildReport, type JobInput } from "./report";
import { LINKEDIN_DOMAIN } from "./domain-lists";
import { pageKey, registrableDomain } from "./domains";
import {
  LINKEDIN_UNREADABLE_MESSAGE,
  NEED_MORE_DETAIL_MESSAGE,
  NO_EMPLOYER_MESSAGE,
} from "@/lib/copy";
import type { CheckResponse, PageRead, SearchHit } from "./types";

// Freshness for full-page reads (seconds of cache age allowed).
const CAREERS_MAX_AGE = 10 * 60;
const FRAUD_MAX_AGE = 24 * 60 * 60;

export type CheckRequest = {
  // The company name the user typed. Null when a job link gives it.
  company: string | null;
  website: string | null;
  senderAddress: string | null;
  senderDomain: string | null;
  // The user's language and region, such as "en-us".
  locale: string;
  // A job posting link from the company field, already cleaned (see
  // parseJobLink). The link the user pasted is never passed on.
  jobLink?: JobLink | null;
  // A job title the user typed with the company name.
  jobTitle?: string | null;
};

function warningSearch(company: string, subject: string, senderDomain: string | null) {
  const queries = [`${company} recruitment fraud`, `${company} job scam`];
  if (senderDomain) queries.push(`${senderDomain} recruiter scam`);
  const hits = search(
    `Find job scam reports or warnings that name ${subject} or the email domain ${senderDomain ?? "(none)"}`,
    queries,
  );
  // Awaited later; until then a failure must not be an unhandled rejection.
  hits.catch(() => {});
  return { queries, hits };
}

// A missing API key fails the whole check; any other failure of an optional
// step is survivable.
function isConfigError(error: unknown): boolean {
  const inner = error instanceof CheckStepError ? error.cause : error;
  return inner instanceof Error && inner.message === "Search is not configured.";
}

// A search limited to one domain. If the API refuses the domain filter, the
// search runs without it. Either way only results on that domain are kept,
// so a claimed website is still only checked against its own pages.
async function pinnedSearch(objective: string, queries: string[], domain: string): Promise<SearchHit[]> {
  let hits: SearchHit[];
  try {
    hits = await search(objective, queries, { includeDomains: [domain] });
  } catch (error) {
    if (isConfigError(error)) throw error;
    console.error("Domain-limited search failed; retrying without the domain filter", {
      name: error instanceof Error ? error.name : typeof error,
      message: error instanceof Error ? error.message.slice(0, 200) : "",
    });
    hits = await search(objective, queries);
  }
  return hits.filter((h) => registrableDomain(h.url) === domain);
}

// Reads pages for the careers check. These reads are optional: if the call
// throws, the pages count as unreadable and the check goes on.
async function optionalReads(
  pages: ReadonlyArray<{ url: string; role: PageRead["role"] }>,
  objective: string,
  maxAge = CAREERS_MAX_AGE,
): Promise<PageRead[]> {
  try {
    return await extract(pages, maxAge, objective);
  } catch (error) {
    if (isConfigError(error)) throw error;
    console.error("Careers read failed; continuing without it", {
      name: error instanceof Error ? error.name : typeof error,
    });
    return pages.map(({ url, role }) => ({ url, role, ok: false, title: null, publishDate: null, text: "" }));
  }
}

// The company's website as its LinkedIn company page states it (the Website
// field), from the search excerpt or else from reading the page.
async function linkedInWebsite(
  company: string,
  slug: string | null,
  hits: SearchHit[],
): Promise<{ domain: string | null; page: SearchHit | null }> {
  const page = pickCompanyPage(company, slug, hits);
  const fromExcerpt = page ? websiteFieldDomain(page.text) : null;
  if (fromExcerpt) return { domain: fromExcerpt, page };
  const pageSlug = page ? /\/company\/([^/?#]+)/i.exec(page.url)?.[1] ?? slug : slug;
  if (!pageSlug) return { domain: null, page };
  const [about] = await extract(
    [{ url: linkedInCompanyPageUrl(decodeURIComponent(pageSlug)), role: "home" }],
    FRAUD_MAX_AGE,
    `${company}'s website, as given in the Website field`,
  );
  return { domain: about.ok ? websiteFieldDomain(about.text) : null, page };
}

export async function runCheck(req: CheckRequest): Promise<CheckResponse> {
  const { senderDomain } = req;
  const link = req.jobLink ?? null;
  let company = req.company ?? "";
  let jobTitle = req.jobTitle ?? null;
  // A domain the job posting or LinkedIn says is the company's. It is only a
  // claim: the official-presence search is pinned to it and has to confirm it.
  let claimed: string | null = null;
  const jobReads: PageRead[] = [];
  const extraHits: SearchHit[] = [];
  const extraSearches: string[] = [];
  let job: JobInput | null = null;
  let warnings: ReturnType<typeof warningSearch> | null = null;
  // The employer's own careers page, when an aggregator posting links to it.
  let careersLink: string | null = null;

  if (link?.kind === "linkedin") {
    const [posting] = await step("read LinkedIn posting", () =>
      extract([{ url: link.url, role: "job" }], CAREERS_MAX_AGE, "The company name, the job title and when the job was posted"),
    );
    const parsed = parseLinkedInPosting(posting);
    if (!parsed) return { status: "need_more_detail", message: LINKEDIN_UNREADABLE_MESSAGE };
    company = parsed.company;
    jobTitle = parsed.title;
    job = {
      title: parsed.title,
      postingUrl: link.url,
      site: "LinkedIn",
      posted: parsed.posted,
      unnamedClient: parsed.unnamedClient,
    };
    // Only the name and title are kept; nothing else from the page.
    jobReads.push({
      url: link.url,
      role: "job",
      ok: true,
      title: parsed.title ? `${parsed.title} · ${parsed.company}` : parsed.company,
      publishDate: posting.publishDate,
      text: "",
    });

    if (!req.website) {
      warnings = warningSearch(company, company, senderDomain);
      const pageQuery = `${company} LinkedIn company page`;
      extraSearches.push(pageQuery);
      // Optional: without the company page there is just no website claim.
      try {
        const pageHits = await step("search LinkedIn company page", () =>
          pinnedSearch(`Find ${company}'s company page on LinkedIn`, [pageQuery], LINKEDIN_DOMAIN),
        );
        const site = await step("read LinkedIn company page", () =>
          linkedInWebsite(company, parsed.companySlug, pageHits),
        );
        claimed = site.domain;
        if (site.page) extraHits.push(site.page);
      } catch (error) {
        if (isConfigError(error)) throw error;
        console.error("LinkedIn company page lookup failed; continuing without a website claim", {
          name: error instanceof CheckStepError && error.cause instanceof Error ? error.cause.name : "unknown",
        });
      }
    }
  } else if (link?.kind === "board") {
    const [posting] = await step("read job board posting", () =>
      extract(
        [{ url: link.url, role: "job" }],
        CAREERS_MAX_AGE,
        "The job title, the company name, its website, and whether the job is still open",
      ),
    );
    const info = await step("parse job board posting", () => boardPostingInfo(link, posting));
    company = info.company;
    jobTitle = jobTitle ?? info.title;
    claimed = info.site;
    job = {
      title: jobTitle,
      postingUrl: link.url,
      site: link.platform,
      posted: null,
      unnamedClient: info.unnamedClient,
    };
    jobReads.push(posting);
  } else if (link?.kind === "aggregator") {
    // Check the employer the posting names, never the site it is on.
    const [posting] = await step("read aggregator posting", () =>
      extract(
        [{ url: link.url, role: "job" }],
        CAREERS_MAX_AGE,
        "The employer's name, the job title, the employer's own website or careers page, and whether the job is still open",
      ),
    );
    const info = await step("parse aggregator posting", () => parseAggregatorPosting(posting, link));
    if (!info) return { status: "need_more_detail", message: NO_EMPLOYER_MESSAGE };
    company = info.employer;
    jobTitle = jobTitle ?? info.title;
    claimed = info.site;
    careersLink = info.careersUrl;
    job = {
      title: jobTitle,
      postingUrl: link.url,
      site: link.site,
      posted: null,
      siteDomain: link.domain,
      unnamedClient: info.unnamedClient,
    };
    // Only the posting itself, not the other jobs the site lists.
    jobReads.push({ ...posting, text: info.body });
  } else if (jobTitle) {
    job = { title: jobTitle, postingUrl: null, site: null, posted: null };
  }

  const pin = !req.website && claimed ? claimed : null;
  const subject = req.website
    ? `${company} (${req.website})`
    : pin
      ? `${company} (${pin})`
      : company;
  warnings ??= warningSearch(company, subject, senderDomain);

  const officialQueries = [`${company} official website careers`, `${company} recruiting fraud notice email`];
  const officialObjective = `Find ${subject}'s official website, careers page, and any page where the company says which email addresses or domains its recruiters use or warns about recruiting fraud`;
  const [officialHits, warningHits] = await Promise.all([
    step("search official presence", () =>
      pin ? pinnedSearch(officialObjective, officialQueries, pin) : search(officialObjective, officialQueries),
    ),
    step("search warnings", () => warnings!.hits),
  ]);

  const found = await step("find official domain", () =>
    findOfficialDomain(company, req.website, officialHits, senderDomain),
  );
  if (found.status === "ambiguous") {
    return { status: "need_more_detail", message: NEED_MORE_DETAIL_MESSAGE };
  }

  let reads: PageRead[] = [];
  const listHits: SearchHit[] = [];
  const listSearches: string[] = [];
  if (found.status === "found") {
    const domain = found.domain;
    const planned = await step("plan page reads", () =>
      planReads(company, domain, officialHits, warningHits, req.locale),
    );
    const objective = `Which email addresses or domains ${company}'s recruiters use, and any recruiting fraud notice${
      jobTitle ? `, and whether the job "${jobTitle}" is listed` : ""
    }`;
    // The careers page the posting links to is read for the careers check,
    // on its own so a failure there can't take the other reads with it.
    const postingCareers =
      careersLink &&
      registrableDomain(careersLink) === domain &&
      !planned.some((p) => pageKey(p.url) === pageKey(careersLink!))
        ? careersLink
        : null;
    const batches = await step("read official pages", () =>
      Promise.all([
        extract(planned.filter((p) => p.role === "careers"), CAREERS_MAX_AGE, objective),
        extract(planned.filter((p) => p.role !== "careers"), FRAUD_MAX_AGE, objective),
        postingCareers ? optionalReads([{ url: postingCareers, role: "careers" }], objective) : [],
      ]),
    );
    // The posting's own careers link first: it is the page for this job.
    reads = [...batches[2], ...batches[0], ...batches[1]];

    // The sender uses the company's own domain but the pages read carry no
    // recruiting list: look once more, on the official domain only, for the
    // recruiting fraud or verified email page and read the top result, so
    // the answer doesn't depend on which page the first search surfaced.
    // Optional: a failure here leaves the result as it was.
    const hasList = reads.some(
      (r) => r.ok && registrableDomain(r.url) === domain && findRecruitingList(r.text),
    );
    if (senderDomain && registrableDomain(senderDomain) === domain && !hasList) {
      const query = `${company} recruitment fraud verified recruiter email domains`;
      listSearches.push(query);
      try {
        const hits = await step("search recruiting list page", () =>
          pinnedSearch(
            `Find ${company}'s page about recruiting fraud that says which email domains its recruiters use`,
            [query],
            domain,
          ),
        );
        listHits.push(...hits);
        const page = pickListPage(hits, domain, reads.map((r) => r.url));
        if (page) {
          reads.push(...(await optionalReads([{ url: page, role: "fraud" }], objective, FRAUD_MAX_AGE)));
        }
      } catch (error) {
        if (isConfigError(error)) throw error;
        console.error("Recruiting list search failed; continuing without it", {
          name: error instanceof CheckStepError && error.cause instanceof Error ? error.cause.name : "unknown",
        });
      }
    }

    // Follow the company's own links to its job board to look for the job.
    // Optional: a failure here only means the careers check can't be done.
    if (jobTitle) {
      try {
        const seen = new Set([...reads, ...jobReads].map((r) => pageKey(r.url)));
        const board = linkedBoardPages(reads, domain, link).find((url) => !seen.has(pageKey(url)));
        if (board) {
          reads.push(...(await optionalReads([{ url: board, role: "careers" }], `Whether the job "${jobTitle}" is listed`)));
        }
      } catch (error) {
        if (isConfigError(error)) throw error;
        console.error("Following the job board link failed; continuing without it", {
          name: error instanceof Error ? error.name : typeof error,
        });
      }
    }
  }

  return step("build report", () => buildReport({
    company,
    website: req.website,
    senderAddress: req.senderAddress,
    senderDomain,
    officialHits: [...officialHits, ...extraHits, ...listHits],
    warningHits,
    reads: [...jobReads, ...reads],
    now: new Date(),
    locale: req.locale,
    searches: [...extraSearches, ...officialQueries, ...warnings.queries, ...listSearches],
    job,
  }));
}
