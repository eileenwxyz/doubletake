import { FREE_EMAIL_PROVIDERS } from "./domain-lists";
import { hostOf, isRealDomain, registrableDomain, stripCorporateSuffix } from "./domains";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Words that may follow a company's name without turning it into a
// different, longer name ("Acme Careers" is Acme; "Acme Talent Partners" isn't).
const NAME_FOLLOWERS = new Set([
  "inc", "incorporated", "llc", "ltd", "limited", "corp", "corporation", "co",
  "company", "gmbh", "plc", "careers", "career", "jobs", "job", "recruiter",
  "recruiters", "hiring", "scam", "scams", "fraud", "email", "emails", "offer",
  "offers", "interview", "interviews", "review", "reviews",
]);

// Mentions of the exact domain or a subdomain of it, but not
// notacme.example or acme.example.scam.example.
export function mentionsDomain(text: string, domain: string): boolean {
  const pattern = new RegExp(
    `(?<![a-z0-9-])${escapeRegExp(domain)}(?![a-z0-9-]|\\.[a-z0-9])`,
    "i",
  );
  return pattern.test(text);
}

// The page names this exact company: its whole name not followed by more
// name words, or one of its exact domains. Used for warnings and reports.
export function namesCompanyExactly(
  text: string,
  company: string,
  domains: ReadonlyArray<string | null>,
): boolean {
  for (const domain of domains) {
    if (domain && mentionsDomain(text, domain)) return true;
  }
  const name = stripCorporateSuffix(company).replace(/\s+/g, " ");
  if (name.length < 2) return false;
  const pattern = new RegExp(
    `(?<![\\p{L}\\p{N}])${escapeRegExp(name).replace(/ /g, "\\s+")}(?![\\p{L}\\p{N}])`,
    "giu",
  );
  for (const match of text.matchAll(pattern)) {
    const after = text.slice((match.index ?? 0) + match[0].length);
    const next = /^[ \t]+(\p{Lu}[\p{L}\p{N}&'-]*)/u.exec(after);
    if (!next || NAME_FOLLOWERS.has(next[1].toLowerCase().replace(/[^a-z]/g, ""))) {
      return true;
    }
  }
  return false;
}

// Looser check used to find the official site: the whole name appears.
export function namesCompanyLoosely(text: string, company: string): boolean {
  const name = stripCorporateSuffix(company).replace(/\s+/g, " ");
  if (name.length < 2) return false;
  return new RegExp(
    `(?<![\\p{L}\\p{N}])${escapeRegExp(name).replace(/ /g, "\\s+")}(?![\\p{L}\\p{N}])`,
    "iu",
  ).test(text);
}

const WARNING_WORDS =
  /\b(scam|scams|scammer|scammers|scammed|fraud|fraudulent|fake|impersonat\w*|phishing|beware|stole|stolen)\b/i;

export function hasWarningLanguage(text: string): boolean {
  return WARNING_WORDS.test(text);
}

// A company's own notice that scammers pose as its recruiters.
const IMPERSONATION =
  /(impersonat\w*|pretend\w* to be|posing as|recruit\w* (fraud|scam)|fraudulent (job|recruit\w*|offer|email)|fake (job|recruit\w*|offer))/i;

export function hasImpersonationNotice(text: string): boolean {
  return IMPERSONATION.test(text);
}

// "Is Acme legit?" and similar posts ask a question; they aren't reports.
export function isQuestionPost(title: string | null, text: string): boolean {
  const heading = (title ?? text.split("\n").find((l) => l.trim() !== "") ?? "")
    .replace(/^[#\s]+/, "")
    .trim();
  if (heading === "") return false;
  if (/\?\s*(\||-|–|:|$)/.test(heading)) return true;
  return /^(is|are|has|have|does|did|do|anyone|any one|can|should|was)\b/i.test(heading);
}

// Turns markdown into plain text: links keep their text, emphasis and
// heading marks are dropped.
export function plainText(markdown: string): string {
  return markdown
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__|`)/g, "")
    .replace(/^\s{0,3}#{1,6}\s*/gm, "")
    .replace(/^\s{0,3}>\s?/gm, "");
}

// Every absolute link in a page's markdown.
export function linksIn(markdown: string): string[] {
  return [...markdown.matchAll(/https?:\/\/[^\s<>()[\]"'`]+/gi)].map((m) =>
    m[0].replace(/[.,;:!?]+$/, ""),
  );
}

const EMAIL = /[a-z0-9._%+-]+@([a-z0-9-]+(?:\.[a-z0-9-]+)+)/gi;

// Role mailboxes (recruiting@, careers@) are company channels; anything else
// may be a person's address and is never kept.
const ROLE_LOCAL_PART =
  /^(recruit\w*|careers?|jobs?|talent\w*|hr|hiring|people|no-?reply|donotreply|do-not-reply|notifications?|apply|applications?|staffing|security|fraud)$/i;

export function isRoleAddress(address: string): boolean {
  const local = address.split("@")[0] ?? "";
  return ROLE_LOCAL_PART.test(local);
}

export function containsPersonalEmail(text: string): boolean {
  return [...text.matchAll(EMAIL)].some((m) => !isRoleAddress(m[0]));
}

export type RecruitingList = {
  // Lower-case domains ("acme.example") or role addresses ("recruiting@acme.example").
  entries: string[];
  // A short exact sentence from the page, or null when the sentence can't be
  // shown (for example because it contains a person's address).
  quote: string | null;
};

const CONTACT_WORDS = /(\b(e-?mails?|domains?|address(es)?|contact\w*|reach out)\b|@)/i;
const RECRUIT_WORDS = /(recruit|candidate|applicant|hiring|talent|job seeker|interview)/i;
const LIMIT_WORDS = /\b(only|exclusively|verified|official|always|solely)\b/i;
const NEGATION = /\b(never|not|don't|do not|won't|will not)\b/i;
const MAX_QUOTE = 220;

function domainsInSentence(sentence: string): string[] {
  const found: string[] = [];
  const consumed: Array<[number, number]> = [];
  for (const match of sentence.matchAll(EMAIL)) {
    const start = match.index ?? 0;
    consumed.push([start, start + match[0].length]);
    const address = match[0].toLowerCase();
    found.push(isRoleAddress(address) ? address : match[1].toLowerCase());
  }
  for (const match of sentence.matchAll(/@?\b((?:[a-z0-9-]+\.)+[a-z]{2,})\b/gi)) {
    const start = match.index ?? 0;
    if (consumed.some(([a, b]) => start >= a && start < b)) continue;
    // Skip domains mentioned after a negation: "never from gmail.com".
    const clause = sentence.slice(0, start).split(/[,;]|\bbut\b/i).pop() ?? "";
    if (NEGATION.test(clause)) continue;
    const domain = match[1].toLowerCase();
    if (isRealDomain(domain)) found.push(domain);
  }
  return found.filter((entry) => {
    const domain = entry.includes("@") ? entry.split("@")[1] : entry;
    return !FREE_EMAIL_PROVIDERS.has(registrableDomain(domain) ?? domain);
  });
}

function shortQuote(sentence: string): string {
  const flat = sentence.replace(/\s+/g, " ").trim();
  if (flat.length <= MAX_QUOTE) return flat;
  const cut = flat.slice(0, MAX_QUOTE);
  return `${cut.slice(0, cut.lastIndexOf(" ")).trimEnd()}…`;
}

// Finds where a company says which addresses or domains its recruiters use,
// such as "We only contact candidates from the @acme.example domain."
export function findRecruitingList(markdown: string): RecruitingList | null {
  const lines = plainText(markdown).split(/\n+/);
  const entries = new Set<string>();
  let quote: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const sentences = lines[i].split(/(?<=[.!?])\s+(?=[A-Z])/);
    for (const sentence of sentences) {
      if (
        !CONTACT_WORDS.test(sentence) ||
        !RECRUIT_WORDS.test(sentence) ||
        !LIMIT_WORDS.test(sentence)
      ) {
        continue;
      }
      let scope = sentence;
      // "...uses only these domains:" followed by a bulleted list.
      if (/:\s*$/.test(sentence)) {
        for (let j = i + 1; j < lines.length && /^\s*([-*•]|\d+[.)])\s+/.test(lines[j]); j++) {
          scope += ` ${lines[j]}`;
        }
      }
      const found = domainsInSentence(scope);
      if (found.length === 0) continue;
      found.forEach((entry) => entries.add(entry));
      if (!quote && !containsPersonalEmail(scope)) {
        quote = shortQuote(scope.replace(/\s*([-*•]|\d+[.)])\s+/g, " "));
      }
    }
  }

  return entries.size ? { entries: [...entries], quote } : null;
}

// True when an entry on a recruiting list covers this sender.
export function listCovers(
  entries: readonly string[],
  senderAddress: string | null,
  senderDomain: string,
): boolean {
  const address = senderAddress?.toLowerCase() ?? null;
  return entries.some((entry) =>
    entry.includes("@") ? entry === address : entry === senderDomain,
  );
}

export function displayHost(url: string): string {
  return (hostOf(url) ?? url).replace(/^www\./, "");
}
