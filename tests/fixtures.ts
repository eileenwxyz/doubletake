// Fixture data for the check logic. Every company here is fictional and
// every company domain uses the reserved .example suffix.
import type { CheckInput } from "@/lib/check/report";
import type { PageRead, PageRole, SearchHit } from "@/lib/check/types";

export const NOW = new Date("2026-11-03T12:00:00Z");

export function hit(url: string, title: string | null, text: string, publishDate: string | null = null): SearchHit {
  return { url, title, text, publishDate };
}

export function read(url: string, role: PageRole, text: string, publishDate: string | null = null): PageRead {
  return { url, role, ok: true, title: null, publishDate, text };
}

export function unreadable(url: string, role: PageRole): PageRead {
  return { url, role, ok: false, title: null, publishDate: null, text: "" };
}

const FILLER =
  "We design and build industrial anvils, rockets and other equipment for customers around the world. " +
  "Our teams work in offices and remotely, and we publish every open role on this site.";

// Official search results for "Acme", whose site is acme.example.
export const ACME_OFFICIAL_HITS: SearchHit[] = [
  hit("https://www.acme.example/", "Acme | Industrial equipment", `Acme makes anvils. ${FILLER}`),
  hit("https://careers.acme.example/", "Careers at Acme", "Join Acme. See open roles and how we hire.", "2026-10-30"),
  hit(
    "https://www.acme.example/recruiting-fraud",
    "Recruiting fraud notice | Acme",
    "Scammers sometimes impersonate Acme recruiters.",
    "2026-09-01",
  ),
  hit("https://www.linkedin.com/company/acme-example", "Acme | LinkedIn", "Acme. Industrial equipment. 500 employees."),
  hit("https://www.crunchbase.com/organization/acme-example", "Acme - Crunchbase Company Profile", "Acme is an equipment maker."),
];

// The fraud page publishes the recruiting list.
export const ACME_FRAUD_TEXT = `# Recruiting fraud notice

Scammers sometimes impersonate Acme recruiters and send fake job offers. ${FILLER}

Acme recruiters only contact candidates from the @acme.example domain. We will never ask you to pay for equipment, and we never use gmail.com or other free email services.

If you are unsure, write to security@acme.example.`;

export const ACME_FRAUD_TEXT_NO_LIST = `# Recruiting fraud notice

Scammers sometimes impersonate Acme recruiters and send fake job offers. ${FILLER}

We will never ask you to pay for equipment. Report anything suspicious to our security team.`;

export const ACME_CAREERS_TEXT_WITH_LEVER = `# Careers at Acme

${FILLER}

See every open role on our job board: [Open roles](https://jobs.lever.co/acme).`;

export const ACME_CAREERS_TEXT_PLAIN = `# Careers at Acme

${FILLER}

See every open role below and apply on this site.`;

export function acmeReads(options: {
  fraudText?: string;
  careersText?: string;
  fraudUnreadable?: boolean;
} = {}): PageRead[] {
  return [
    options.fraudUnreadable
      ? unreadable("https://www.acme.example/recruiting-fraud", "fraud")
      : read("https://www.acme.example/recruiting-fraud", "fraud", options.fraudText ?? ACME_FRAUD_TEXT, "2026-09-01"),
    read("https://careers.acme.example/", "careers", options.careersText ?? ACME_CAREERS_TEXT_PLAIN, "2026-10-30"),
    read("https://www.acme.example/", "home", `# Acme\n\n${FILLER}`),
  ];
}

export function acmeInput(overrides: Partial<CheckInput> = {}): CheckInput {
  return {
    company: "Acme",
    website: null,
    senderAddress: null,
    senderDomain: null,
    officialHits: ACME_OFFICIAL_HITS,
    warningHits: [],
    reads: acmeReads(),
    now: NOW,
    ...overrides,
  };
}

export function withSender(address: string, overrides: Partial<CheckInput> = {}): CheckInput {
  return acmeInput({
    senderAddress: address,
    senderDomain: address.split("@")[1],
    ...overrides,
  });
}
