// Shapes shared by the check logic, the API route and the page.

// One Search API result.
export type SearchHit = {
  url: string;
  title: string | null;
  publishDate: string | null;
  // Excerpts joined into one string.
  text: string;
};

// "job" is the job posting the user linked to.
export type PageRole = "fraud" | "careers" | "home" | "warning" | "job";

// One Extract API read. ok is false when the page failed to load or came
// back empty or nearly empty; that means "couldn't read", not "nothing there".
export type PageRead = {
  url: string;
  role: PageRole;
  ok: boolean;
  title: string | null;
  publishDate: string | null;
  // Full page text (markdown) when ok, otherwise "".
  text: string;
};

export type SourceType =
  | "Official"
  | "Authority"
  | "Automated rating"
  | "Directory"
  | "Report"
  | "General advice"
  | "Other";

export type Verdict = "strong_warning" | "mixed" | "no_red_flags" | "not_enough";

export type Direction = "reassures" | "caution" | "neutral";

export type Reason = {
  direction: Direction;
  text: string;
  sourceType: SourceType;
  sourceUrl: string | null;
  // "Published 2026-10-28 (6 days ago)" or "Date unknown".
  age: string;
  // The other sources for a reason that states the same fact from more than
  // one page ("Listed on 2 of Acme's own pages"). Absent for single-source
  // reasons and on results saved before merged reasons.
  alsoFrom?: ReasonSource[];
  // Shown instead of the source's address when the address itself would
  // show someone's words (see Source.label).
  sourceLabel?: string;
};

export type ReasonSource = {
  url: string;
  sourceType: SourceType;
  age: string;
  label?: string;
};

export type CouldntFind = {
  kind: "couldnt_check" | "not_published";
  text: string;
  url: string | null;
};

export type Source = {
  url: string;
  type: SourceType;
  publishDate: string | null;
  // Shown instead of the address ("Glassdoor company page" for a Glassdoor
  // review whose address carries the review's title).
  label?: string;
};

// fraud, careers, site: a page on the company's own site.
// ask_email: the recruiter wrote from a free email service although the
// company has its own domain. lookalike: the sender's domain imitates the
// company's. ask_client: a staffing agency didn't name its client.
export type NextStepKind = "fraud" | "careers" | "site" | "ask_email" | "lookalike" | "ask_client";

// A staffing agency and the client company it says it is recruiting for,
// both checked. The agency is named by the posting (or is the owner of the
// sender's domain); the client by the posting (or is the company entered).
export type RecruitingFor = {
  agency: string;
  agencyDomain: string | null;
  client: string;
  clientDomain: string | null;
};

export type CheckReport = {
  status: "ok";
  // The company's proper name, for display.
  companyName: string;
  // When the check ran (ISO 8601, UTC). The page shows it in the visitor's
  // time zone.
  checkedAt: string;
  verdict: Verdict;
  subtitle: string | null;
  companySays: { quote: string; domain: string } | null;
  // The top reasons: every reason that decided the verdict, every reason
  // that disagrees with it, then up to 3 in all by strength. In strength
  // order; the page groups them by direction.
  reasons: Reason[];
  // Every reason, in strength order, for "See all sources". Absent on
  // results saved before it was added.
  allReasons?: Reason[];
  // For "+N more reasons": how many reasons left out of the top reasons are
  // as strong as one shown in the same direction group.
  moreReasons?: Partial<Record<Direction, number>>;
  couldntFind: CouldntFind[];
  sources: Source[];
  officialDomain: string | null;
  // The one step the page puts first. It matches the rule the verdict was
  // decided on: ask for an email from the company's domain, contact the
  // company through its own domain, or ask which company an agency's job is
  // with. Otherwise the company's recruiting fraud page, else its careers
  // page, else its website. url is null for a step that is a question to
  // ask, not a page; domain is the company's official domain. Null without
  // an official domain (and no step to ask).
  nextStep: { url: string | null; kind: NextStepKind; domain?: string } | null;
  // Set when a staffing agency is recruiting for a client it names: both
  // are checked and the header names both. Absent on older results.
  recruitingFor?: RecruitingFor | null;
  // The sender's domain when a recruiter email was given (never the full
  // address).
  senderDomain: string | null;
  // Set when the sender's domain is a near-copy of a company domain.
  lookalike: { sender: string; imitates: string } | null;
  // The exact search queries that ran.
  searches: string[];
  // Set when the check was for a job: a posting link, or a job title given
  // with the company name. Absent on results saved before job checks.
  job?: JobResult | null;
};

// "listed": the job is on the company's own careers page or the job board
// its site links to. "not_listed": those pages were read and the job isn't
// on them. "closed": the page says the job is no longer available.
// "couldnt_check": no careers page or board could be read, or no job title
// is known.
export type CareersResult = "listed" | "not_listed" | "closed" | "couldnt_check";

export type JobResult = {
  title: string | null;
  // The posting link as Doubletake read it (for LinkedIn, the rebuilt
  // https://www.linkedin.com/jobs/view/<id>, never the link the user pasted).
  postingUrl: string | null;
  // Where the posting is: "LinkedIn", a job board such as "Lever", or an
  // aggregator or public job board such as "Indeed" or "azjobconnection.gov".
  // The page shows it as "Posted on <site>" (RESULT.postedOn).
  site: string | null;
  // How long ago LinkedIn says the job was posted ("2 weeks ago").
  posted: string | null;
  // True when the posting is on a job board the company's own site links to.
  postingOfficial: boolean;
  // A staffing agency posted the job for a client it doesn't name; the
  // agency is what was checked.
  unnamedClient: boolean;
  // The client a staffing agency says it is hiring for, when it names one.
  // Absent on older results.
  client?: string | null;
  careers: CareersResult;
  // The page the careers result comes from.
  careersUrl: string | null;
};

export type NeedMoreDetail = {
  status: "need_more_detail";
  message: string;
};

export type CheckResponse = CheckReport | NeedMoreDetail;

// What POST /api/check returns on success: the check plus how many checks
// the visitor has left today (null when limits are off, as in local
// development).
export type CheckApiResponse = CheckResponse & { checksRemaining: number | null };

// What POST /api/check returns on failure. limit is set on 429 responses.
export type CheckApiError = { error: string; limit?: "daily" | "monthly" };
