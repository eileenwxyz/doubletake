// Small pure helpers the result page uses, kept apart from the components
// so they can be tested without a browser.

import type {
  CheckApiError,
  CheckReport,
  Reason,
  Source,
  SourceType,
} from "@/lib/check/types";
import { MONTHLY_CAP_ERROR, SOURCE_TYPE_LABELS } from "@/lib/copy";

// ---- Dates ----

// "Nov 3, 2026, 3:42 PM" in the visitor's own time zone and locale.
export function formatCheckedAt(iso: string, locale?: string, timeZone?: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone }).format(
    date,
  );
}

// ---- Domains and emails inside sentences ----

export type TextPart = { text: string; mono: boolean };

const ADDRESS_OR_DOMAIN =
  /[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+|(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}(?:\/(?:[^\s]*[^\s.,;:!?)”"])?)?/gi;

// Splits a sentence so that domains, web addresses and email addresses can
// be shown in the mono font.
export function splitDomains(text: string): TextPart[] {
  const parts: TextPart[] = [];
  let last = 0;
  for (const match of text.matchAll(ADDRESS_OR_DOMAIN)) {
    const at = match.index ?? 0;
    if (at > last) parts.push({ text: text.slice(last, at), mono: false });
    parts.push({ text: match[0], mono: true });
    last = at + match[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last), mono: false });
  return parts;
}

// "careers.acme.example/jobs" for "https://www.careers.acme.example/jobs/".
export function shortUrl(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/\/+$/, "");
    return `${u.hostname.replace(/^www\./, "")}${path}${u.search}`;
  } catch {
    return url;
  }
}

// ---- Sources ----

const SOURCE_ORDER = Object.keys(SOURCE_TYPE_LABELS) as SourceType[];

export type SourceGroup = { type: SourceType; sources: Source[] };

// Sources grouped by type, in a fixed order, empty groups left out.
export function groupSources(sources: readonly Source[]): SourceGroup[] {
  return SOURCE_ORDER.map((type) => ({
    type,
    sources: sources.filter((s) => s.type === type),
  })).filter((g) => g.sources.length > 0);
}

// How many distinct sources the top reasons cite.
export function citedSources(reasons: readonly Reason[]): number {
  return new Set(reasons.map((r) => r.sourceUrl).filter((u): u is string => u !== null)).size;
}

// ---- API responses ----

export type Outcome =
  | { kind: "result"; report: CheckReport; checksRemaining: number | null }
  | { kind: "need_detail"; message: string; checksRemaining: number | null }
  | { kind: "limit"; which: "daily" | "monthly"; message: string }
  | { kind: "invalid"; message: string }
  | { kind: "error" };

function remaining(data: Record<string, unknown>): number | null {
  return typeof data.checksRemaining === "number" ? data.checksRemaining : null;
}

// Turns a POST /api/check response into what the page shows.
export function interpretResponse(status: number, data: unknown): Outcome {
  if (!data || typeof data !== "object") return { kind: "error" };
  const body = data as Record<string, unknown>;
  if (status === 200 && body.status === "ok") {
    return { kind: "result", report: body as unknown as CheckReport, checksRemaining: remaining(body) };
  }
  if (status === 200 && body.status === "need_more_detail" && typeof body.message === "string") {
    return { kind: "need_detail", message: body.message, checksRemaining: remaining(body) };
  }
  const error = body as CheckApiError;
  if (status === 429 && typeof error.error === "string") {
    const which =
      error.limit ?? (error.error === MONTHLY_CAP_ERROR ? "monthly" : "daily");
    return { kind: "limit", which, message: error.error };
  }
  if (status === 400 && typeof error.error === "string") {
    return { kind: "invalid", message: error.error };
  }
  return { kind: "error" };
}

// The "N checks left today" line shows at 3 or fewer.
export const NEAR_LIMIT = 3;

export function showChecksLeft(checksRemaining: number | null): boolean {
  return checksRemaining !== null && checksRemaining <= NEAR_LIMIT;
}
