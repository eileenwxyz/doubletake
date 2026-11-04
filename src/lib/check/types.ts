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

export type CheckReport = {
  status: "ok";
  verdict: Verdict;
  subtitle: string | null;
  companySays: { quote: string; domain: string } | null;
  reasons: Reason[];
  couldntFind: CouldntFind[];
  sources: Source[];
  officialDomain: string | null;
};

export type NeedMoreDetail = {
  status: "need_more_detail";
  message: string;
};

export type CheckResponse = CheckReport | NeedMoreDetail;

export const NEED_MORE_DETAIL_MESSAGE =
  "Several companies use this name. Add their website or the recruiter's email.";
