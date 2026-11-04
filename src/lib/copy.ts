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

// ---- Result page ----
export const RESULT = {
  example: "Example",
  checkedAt: (when: string) => `Checked ${when}`,
  notThisOne: "Not this one?",
  disclaimer: "About the evidence we found, not a guarantee.",
  nextStepLabel: "Your next step",
  nextStep: {
    fraud: (company: string) => `Read ${company}'s recruiting fraud page`,
    careers: (company: string) => `Find the job on ${company}'s careers page`,
    site: (company: string) => `Go to ${company}'s official website`,
  },
  companySaysFrom: (domain: string) => `From ${domain} · Official`,
  topReasons: "Top reasons",
  sourcesCount: (shown: number, total: number) =>
    `${shown} of ${total} source${total === 1 ? "" : "s"}`,
  noSourceLink: "No source page",
  lookalikeSender: "Sender",
  lookalikeCompany: "Company",
  lookalikeHeading: "How the domains differ",
  couldntFind: "What we couldn't find",
  whatNext: "What to do next",
  replyToTip: (domain: string) =>
    `Before you reply, check the reply-to address. If it isn't at ${domain}, your answer would go to someone else.`,
  checkYourself: "Things to check yourself",
  checkYourselfItems: [
    "Find the same job on the company's own careers page.",
    "Contact the company using details from its official website, not from the message.",
    "Never pay for equipment, training or a background check to get a job.",
    "Be wary of interviews held only by text message or chat app.",
    "Don't send ID or bank details until you've confirmed the offer with the company.",
  ],
  allSources: "See all sources",
  sourceGroup: (label: string, count: number) => `${label} (${count})`,
  howWeChecked: "How we checked",
  searchesIntro: "We ran these searches, then read the most relevant pages in full:",
  noSearches: "No searches are recorded for this result.",
  checkAnother: "Check another company",
} as const;

// ---- Look-alike domains ----
// Sentences a screen reader can read, describing how a sender's domain
// differs from the company's. "char" is a character name from
// DIFF.charName, such as "a hyphen" or "the letter l".
export const DIFF = {
  charName: (c: string) => {
    if (c === ".") return "a dot";
    if (c === "-") return "a hyphen";
    if (c === "_") return "an underscore";
    if (/[0-9]/.test(c)) return `the number ${c}`;
    if (/[a-z]/i.test(c)) return `the letter ${c}`;
    return `the character “${c}”`;
  },
  // Without an article: "hyphen", "letter l".
  charNoun: (c: string) => {
    if (c === ".") return "dot";
    if (c === "-") return "hyphen";
    if (c === "_") return "underscore";
    if (/[0-9]/.test(c)) return `number ${c}`;
    if (/[a-z]/i.test(c)) return `letter ${c}`;
    return `character “${c}”`;
  },
  replacesChar: (added: string, removed: string) => `${added} replaces ${removed}.`,
  replacesText: (added: string, removed: string) => `“${added}” replaces “${removed}”.`,
  extraChar: (noun: string) => `An extra ${noun} is added.`,
  extraText: (added: string) => `The extra characters “${added}” are added.`,
  extraAround: (before: string, after: string) =>
    `“${before}” is added before the company's domain and “${after}” after it.`,
  missingChar: (name: string) => `${name} is missing.`,
  missingText: (removed: string) => `The characters “${removed}” are missing.`,
  same: "The domains look the same.",
} as const;

// ---- Screen states ----
export const STATUS = {
  checking: "Usually 15 to 30 seconds",
  slow: "Still checking. Some sites are slow to read.",
  retry: "Try again",
  notCounted: "This didn't use one of your checks.",
  checksLeft: (n: number) => `${n} check${n === 1 ? "" : "s"} left today`,
} as const;

// ---- Examples ----
export const EXAMPLES = {
  heading: "Example results",
  intro: "See what a result looks like. These companies are made up.",
  label: "Example",
  open: (company: string, verdict: string) => `${company}: ${verdict}`,
} as const;

// ---- Footer ----
export const FOOTER =
  "Doubletake is an independent project built on Parallel's API. It is not affiliated with Parallel or with any company it checks, and its results are not legal, financial or career advice.";
