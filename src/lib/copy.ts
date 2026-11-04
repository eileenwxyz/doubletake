// Every user-facing string Doubletake shows lives in this file, so wording
// can be changed in one place. Keep it free of imports that only work on the
// server: the page imports it too.

import type { Direction, SourceType, Verdict } from "@/lib/check/types";

// ---- Page ----
export const SITE_NAME = "Doubletake";
export const TAGLINE = "Check who's really hiring.";

// ---- Form ----
export const FORM = {
  companyLabel: "Company",
  emailLabel: "Recruiter's email (optional)",
  submit: "Check",
  submitting: "Checking…",
} as const;

// ---- Verdicts, reason labels and source types ----
export const VERDICT_LABELS: Record<Verdict, string> = {
  strong_warning: "Strong warning signs",
  mixed: "Mixed signals",
  no_red_flags: "No red flags found",
  not_enough: "Not enough information",
};

export const DIRECTION_LABELS: Record<Direction, string> = {
  reassures: "Reassures",
  caution: "Caution",
  neutral: "Neutral",
};

export const SOURCE_TYPE_LABELS: Record<SourceType, string> = {
  Official: "Official",
  Authority: "Authority",
  "Automated rating": "Automated rating",
  Directory: "Directory",
  Report: "Report",
  "General advice": "General advice",
  Other: "Other",
};

export const COULDNT_FIND_LABELS = {
  couldnt_check: "Couldn't check",
  not_published: "Not published",
} as const;

// ---- Section headings ----
export const HEADINGS = {
  companySays: "The company says:",
  couldntFind: "Couldn't find",
  sources: "Sources",
} as const;

// ---- Subtitles ----
export const SUBTITLES = {
  companyOnly: "Company-only check: no recruiter email was given.",
  pagesUnchecked: "Some pages couldn't be checked.",
  scammersUsedName: "Scammers have used this name.",
  notCompanyChannel: "This address is not one of the company's channels.",
} as const;

export const NEED_MORE_DETAIL_MESSAGE =
  "Several companies use this name. Add their website or the recruiter's email.";

// ---- Errors and limits ----
export const GENERIC_ERROR = "Something went wrong. Try again.";
export const VISITOR_LIMIT_ERROR = "You've used today's checks. Try again tomorrow.";
export const MONTHLY_CAP_ERROR =
  "Doubletake has reached its limit for this month. Try again on the 1st.";

export const INPUT_ERRORS = {
  noBody: "Send a company name.",
  noCompany: "Enter a company name.",
  companyTooLong: (max: number) => `Company name must be ${max} characters or fewer.`,
  emailInCompany: "Put the recruiter's email in the email field.",
  badWebsite: "Enter a valid website.",
  badEmail: "Enter a valid email address.",
  emailTooLong: (max: number) => `Email must be ${max} characters or fewer.`,
} as const;

// ---- Ages ----
export const AGES = {
  unknown: "Date unknown",
  future: (day: string) => `Published ${day}`,
  today: (day: string) => `Published ${day} (today)`,
  days: (day: string, n: number) => `Published ${day} (${n} day${n === 1 ? "" : "s"} ago)`,
  months: (day: string, n: number) => `Published ${day} (${n} months ago)`,
  years: (day: string, n: number) => `Published ${day} (${n} years ago)`,
} as const;

// ---- Reason templates ----
// d: the sender's domain. o: the official domain. company: the company's
// display name.
export const REASONS = {
  onList: (d: string, company: string, listHost: string) =>
    `The sender's domain ${d} is on the recruiting list ${company} publishes on ${listHost}.`,
  controlledNoList: (d: string, company: string, o: string) =>
    `The sender's domain ${d} belongs to ${company}'s official domain ${o}.`,
  controlledNotOnList: (d: string, company: string, o: string) =>
    `The sender's domain ${d} belongs to ${o}, but it is not on the recruiting list ${company} publishes.`,
  controlledUnread: (d: string, company: string, o: string) =>
    `The sender's domain ${d} belongs to ${o}, but ${company}'s recruiting pages couldn't be read, so this check is incomplete.`,
  imitatesListed: (d: string, company: string, imitated: string) =>
    `The sender's domain ${d} imitates ${imitated}, a recruiting domain ${company} publishes.`,
  imitatesOfficial: (d: string, company: string, o: string) =>
    `The sender's domain ${d} imitates ${company}'s official domain ${o}.`,
  hiringLinked: (d: string, company: string, platform: string) =>
    `${d} is ${platform} hiring software, and ${company}'s own site links to ${platform}.`,
  hiringUnlinked: (d: string, company: string, platform: string) =>
    `${d} is ${platform} hiring software, but ${company}'s own site doesn't link to ${platform}.`,
  freeWithDomain: (d: string, company: string, o: string) =>
    `${d} is a free email service, but ${company} has its own domain, ${o}.`,
  freeNoDomain: (d: string) =>
    `${d} is a free email service, and no company domain was found to compare it with.`,
  unrelated: (d: string, company: string, o: string) =>
    `The sender's domain ${d} is not connected to ${company}'s official domain ${o}.`,
  unrelatedUnread: (d: string, company: string, o: string) =>
    `The sender's domain ${d} is not connected to ${company}'s official domain ${o}, and some of ${company}'s pages couldn't be read to check for other recruiting domains.`,
  unknownCompany: (d: string, company: string) =>
    `No official domain for ${company} was found to compare ${d} with.`,
  authorityWarning: (host: string, company: string) =>
    `A page on ${host} warns about ${company} by name.`,
  reportWarning: (host: string, company: string) =>
    `A post on ${host} reports a problem involving ${company} by name.`,
  pageWarning: (host: string, company: string) =>
    `A page on ${host} reports a problem involving ${company} by name.`,
  senderWarning: (host: string, d: string) =>
    `A page on ${host} names ${d} in a scam warning.`,
  publishesList: (company: string, domains: string) =>
    `${company} publishes the email domains its recruiters use: ${domains}.`,
  fraudNotice: (company: string) =>
    `${company} publishes a recruiting fraud notice on its own site.`,
  officialSite: (o: string, company: string) => `${o} is ${company}'s official website.`,
  directoryListing: (company: string, host: string) =>
    `${company} has a company listing on ${host}.`,
  automatedRating: (host: string) =>
    `${host} has an automated rating page; automated scores are not a verdict.`,
} as const;

// ---- Couldn't find ----
export const COULDNT_FIND = {
  couldntRead: (where: string) => `Couldn't read ${where}.`,
  noOfficialSite: (company: string) => `No official website for ${company} was found.`,
  noRecruitingList: (company: string) =>
    `${company} doesn't say which email domains its recruiters use on the pages checked.`,
  noFraudNotice: (company: string) =>
    `${company} doesn't publish a recruiting fraud notice on the pages checked.`,
} as const;
