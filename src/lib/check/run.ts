import "server-only";

import { extract, search } from "@/lib/parallel";
import { findOfficialDomain, planReads } from "./official";
import { buildReport } from "./report";
import { NEED_MORE_DETAIL_MESSAGE } from "@/lib/copy";
import type { CheckResponse, PageRead } from "./types";

// Freshness for full-page reads (seconds of cache age allowed).
const CAREERS_MAX_AGE = 10 * 60;
const FRAUD_MAX_AGE = 24 * 60 * 60;

export type CheckRequest = {
  company: string;
  website: string | null;
  senderAddress: string | null;
  senderDomain: string | null;
  // The user's language and region, such as "en-us".
  locale: string;
};

export async function runCheck(req: CheckRequest): Promise<CheckResponse> {
  const { company, senderDomain } = req;
  const subject = req.website ? `${company} (${req.website})` : company;

  const warningQueries = [`${company} recruitment fraud`, `${company} job scam`];
  if (senderDomain) warningQueries.push(`${senderDomain} recruiter scam`);

  const officialQueries = [`${company} official website careers`, `${company} recruiting fraud notice email`];

  const [officialHits, warningHits] = await Promise.all([
    search(
      `Find ${subject}'s official website, careers page, and any page where the company says which email addresses or domains its recruiters use or warns about recruiting fraud`,
      officialQueries,
    ),
    search(
      `Find job scam reports or warnings that name ${subject} or the email domain ${senderDomain ?? "(none)"}`,
      warningQueries,
    ),
  ]);

  const found = findOfficialDomain(company, req.website, officialHits, senderDomain);
  if (found.status === "ambiguous") {
    return { status: "need_more_detail", message: NEED_MORE_DETAIL_MESSAGE };
  }

  let reads: PageRead[] = [];
  if (found.status === "found") {
    const planned = planReads(company, found.domain, officialHits, warningHits, req.locale);
    const objective = `Which email addresses or domains ${company}'s recruiters use, and any recruiting fraud notice`;
    const batches = await Promise.all([
      extract(planned.filter((p) => p.role === "careers"), CAREERS_MAX_AGE, objective),
      extract(planned.filter((p) => p.role !== "careers"), FRAUD_MAX_AGE, objective),
    ]);
    reads = batches.flat();
  }

  return buildReport({
    company,
    website: req.website,
    senderAddress: req.senderAddress,
    senderDomain,
    officialHits,
    warningHits,
    reads,
    now: new Date(),
    locale: req.locale,
    searches: [...officialQueries, ...warningQueries],
  });
}
