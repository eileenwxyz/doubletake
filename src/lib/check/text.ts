import { FREE_EMAIL_PROVIDERS } from "./domain-lists";
import {
  compactName,
  hostOf,
  isRealDomain,
  registrableDomain,
  stripCorporateSuffix,
} from "./domains";

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

// What the user typed, with spacing tidied and, when it is all lower case,
// each word capitalised: "  acme   robotics" -> "Acme Robotics". Anything
// with capitals already ("eBay", "IBM") is kept as typed.
export function tidyName(company: string): string {
  const flat = company.trim().replace(/\s+/g, " ");
  if (/\p{Lu}/u.test(flat)) return flat;
  return flat.replace(/(^|\s)(\p{Ll})/gu, (_, space: string, letter: string) =>
    `${space}${letter.toUpperCase()}`,
  );
}

const TITLE_PARTS = /\s+-\s+|\s*[|–—·]\s*|:\s+/;

// The name as one page title writes it: a title part that is the company's
// name spaced, punctuated or cased differently ("AT&T" for "att"), or else
// the typed name found inside the title, in the title's capitalisation.
function nameInTitle(title: string, company: string): string | null {
  const target = compactName(company);
  if (target.length < 2) return null;
  for (const part of title.split(TITLE_PARTS)) {
    const clean = stripCorporateSuffix(part).replace(/[\s,]+$/, "");
    if (clean !== "" && compactName(clean) === target) return clean.replace(/\s+/g, " ");
  }
  const name = stripCorporateSuffix(company).replace(/\s+/g, " ");
  if (name.length < 2) return null;
  const match = new RegExp(
    `(?<![\\p{L}\\p{N}])${escapeRegExp(name).replace(/ /g, "\\s+")}(?![\\p{L}\\p{N}])`,
    "iu",
  ).exec(title);
  return match ? match[0].replace(/\s+/g, " ") : null;
}

// The company's proper name, taken from its official pages' titles (page
// title or site name), most common spelling first and ties going to the
// earlier title. Falls back to tidyName.
export function properName(company: string, titles: ReadonlyArray<string | null>): string {
  const votes = new Map<string, number>();
  for (const title of titles) {
    const found = title ? nameInTitle(title, company) : null;
    if (found) votes.set(found, (votes.get(found) ?? 0) + 1);
  }
  let best: string | null = null;
  for (const [name, count] of votes) {
    if (best === null || count > (votes.get(best) ?? 0)) best = name;
  }
  return best ?? tidyName(company);
}

// A site's name from its page titles when only its domain is known: the
// title part that contains the domain's name ("Brightpath Staffing" in
// "Brightpath Staffing | Staffing agency" for brightpath.example), most
// common first. Null when no title part does.
export function properNameFromTitles(label: string, titles: ReadonlyArray<string | null>): string | null {
  const target = label.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (target.length < 3) return null;
  const votes = new Map<string, number>();
  for (const title of titles) {
    for (const part of (title ?? "").split(TITLE_PARTS)) {
      const clean = stripCorporateSuffix(part).replace(/[\s,]+$/, "").replace(/\s+/g, " ");
      if (clean.length < 2 || clean.length > 60) continue;
      if (!compactName(clean).includes(target)) continue;
      votes.set(clean, (votes.get(clean) ?? 0) + 1);
      break;
    }
  }
  let best: string | null = null;
  for (const [name, count] of votes) {
    if (best === null || count > (votes.get(best) ?? 0)) best = name;
  }
  return best;
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

// Wording that reports a recruiting scam specifically, not just a bad job:
// "fake recruiter", "job offer scam", "scammers posing as ...".
const RECRUITING_SCAM =
  /\b(recruit\w* (scam|fraud)|(job|interview|offer|employment|hiring) (scam|fraud)|fake (recruiters?|job offers?|offers?|interviews?|jobs?)|scammers? (posing|pretending|impersonating)|impersonat\w* (a |an |our |the )?(recruiters?|hiring managers?|company))\b/i;

export function reportsRecruitingScam(title: string | null, text: string): boolean {
  return RECRUITING_SCAM.test(`${title ?? ""}\n${plainText(text)}`);
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
const LIMIT_WORDS =
  /\b(only|exclusively|verified|official|always|solely|legitimate|genuine|authentic)\b/i;
// "Emails from our recruiters come from ...", "will be sent from ...",
// "end in ...": saying where the emails come from limits them too.
const SOURCE_PHRASE = /\b(?:come|comes|coming|be sent|are sent|is sent|originate|originates) from\b|\bends? (?:in|with)\b/i;
// How far back a recruiting word may be for a sentence that doesn't name
// recruiting itself ("Globex will only contact you from ...", under a
// "Recruiting scams" heading).
const CONTEXT_LINES = 3;
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
    // The lines just above, and the sentences before this one on its line.
    let context = lines.slice(Math.max(0, i - CONTEXT_LINES), i).join(" ");
    for (const sentence of sentences) {
      const recruiting = RECRUIT_WORDS.test(sentence) || RECRUIT_WORDS.test(context);
      context += ` ${sentence}`;
      if (
        !CONTACT_WORDS.test(sentence) ||
        !recruiting ||
        !(LIMIT_WORDS.test(sentence) || SOURCE_PHRASE.test(sentence))
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
