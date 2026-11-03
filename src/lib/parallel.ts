import "server-only";

import { normalizeUrl } from "@/lib/check/domains";
import type { PageRead, PageRole, SearchHit } from "@/lib/check/types";

// Parallel Search API: POST https://api.parallel.ai/v1/search
// Parallel Extract API: POST https://api.parallel.ai/v1/extract
// Request and response fields follow the parallel-web SDK
// (SearchParams / ExtractParams and their responses).

const SEARCH_URL = "https://api.parallel.ai/v1/search";
const EXTRACT_URL = "https://api.parallel.ai/v1/extract";
const EXCERPT_LENGTH = 300;
const FULL_CONTENT_CHARS = 20_000;
// A read with less text than this is treated as "couldn't read".
export const MIN_READ_CHARS = 200;

type ParallelSearchResponse = {
  results: Array<{
    url: string;
    title?: string | null;
    publish_date?: string | null;
    excerpts: string[];
  }>;
};

type ParallelExtractResponse = {
  results: Array<{
    url: string;
    title?: string | null;
    publish_date?: string | null;
    excerpts?: string[];
    full_content?: string | null;
  }>;
  errors: Array<{ url: string; error_type: string; http_status_code: number | null }>;
};

// Thrown for any failed call. The message never includes the API key or
// the upstream response body.
export class SearchError extends Error {}

function apiKey(): string {
  const key = process.env.PARALLEL_API_KEY;
  if (!key) throw new SearchError("Search is not configured.");
  return key;
}

function shorten(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > EXCERPT_LENGTH
    ? `${flat.slice(0, EXCERPT_LENGTH).trimEnd()}…`
    : flat;
}

async function post(url: string, body: unknown, label: string): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey() },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    if (error instanceof SearchError) throw error;
    throw new SearchError(`The ${label} could not be reached.`);
  }
  if (!response.ok) {
    throw new SearchError(`The ${label} failed with status ${response.status}.`);
  }
  return response.json();
}

export function toSearchHits(data: ParallelSearchResponse): SearchHit[] {
  return (data.results ?? []).map((result) => ({
    url: result.url,
    title: result.title || null,
    publishDate: result.publish_date ?? null,
    text: shorten(result.excerpts?.join(" ") ?? ""),
  }));
}

export async function search(objective: string, queries: string[]): Promise<SearchHit[]> {
  const data = (await post(
    SEARCH_URL,
    {
      objective,
      search_queries: queries,
      mode: "advanced",
      advanced_settings: { max_results: 10 },
    },
    "search",
  )) as ParallelSearchResponse;
  return toSearchHits(data);
}

// Maps an Extract response onto the pages that were asked for. Errors,
// missing pages and empty or near-empty text all become ok: false.
export function toPageReads(
  pages: ReadonlyArray<{ url: string; role: PageRole }>,
  data: ParallelExtractResponse | null,
): PageRead[] {
  return pages.map(({ url, role }) => {
    const result = data?.results?.find((r) => normalizeUrl(r.url) === normalizeUrl(url));
    const text = result?.full_content?.trim() ?? "";
    const ok = text.length >= MIN_READ_CHARS;
    return {
      url,
      role,
      ok,
      title: result?.title || null,
      publishDate: result?.publish_date ?? null,
      text: ok ? text : "",
    };
  });
}

// Reads full page text. maxAgeSeconds sets how old cached content may be
// before Parallel fetches the page live (minimum 600 seconds). A failed call
// is reported as unreadable pages rather than thrown.
export async function extract(
  pages: ReadonlyArray<{ url: string; role: PageRole }>,
  maxAgeSeconds: number,
  objective: string,
): Promise<PageRead[]> {
  if (pages.length === 0) return [];
  let data: ParallelExtractResponse | null = null;
  try {
    data = (await post(
      EXTRACT_URL,
      {
        urls: pages.map((p) => p.url),
        objective,
        advanced_settings: {
          full_content: { max_chars_per_result: FULL_CONTENT_CHARS },
          fetch_policy: { max_age_seconds: maxAgeSeconds },
        },
      },
      "page read",
    )) as ParallelExtractResponse;
  } catch (error) {
    if (error instanceof SearchError && error.message === "Search is not configured.") {
      throw error;
    }
    data = null;
  }
  return toPageReads(pages, data);
}
