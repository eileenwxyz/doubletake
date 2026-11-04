// Shapes shared by the check logic, the API route and the page.

// One Search API result.
export type SearchHit = {
  url: string;
  title: string | null;
  publishDate: string | null;
  // Excerpts joined into one string.
  text: string;
};

export type PageRole = "fraud" | "careers" | "home" | "warning";

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
};

export type NextStepKind = "fraud" | "careers" | "site";

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
  reasons: Reason[];
  couldntFind: CouldntFind[];
  sources: Source[];
  officialDomain: string | null;
  // The one link the page puts first: the company's recruiting fraud page,
  // else its careers page, else its website. Null without an official domain.
  nextStep: { url: string; kind: NextStepKind } | null;
  // The sender's domain when a recruiter email was given (never the full
  // address).
  senderDomain: string | null;
  // Set when the sender's domain is a near-copy of a company domain.
  lookalike: { sender: string; imitates: string } | null;
  // The exact search queries that ran.
  searches: string[];
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
