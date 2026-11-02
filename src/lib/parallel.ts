import "server-only";

// Parallel Search API: POST https://api.parallel.ai/v1/search
// Request and response fields follow Parallel's Search API reference.

const SEARCH_URL = "https://api.parallel.ai/v1/search";
const EXCERPT_LENGTH = 300;

export type SearchSource = "official" | "warnings";

export type CheckResult = {
  title: string;
  url: string;
  publishDate: string | null;
  excerpt: string;
  source: SearchSource;
};

type ParallelSearchResponse = {
  results: Array<{
    url: string;
    title?: string | null;
    publish_date?: string | null;
    excerpts: string[];
  }>;
};

// Thrown for any failed call. The message never includes the API key or
// the upstream response body.
export class SearchError extends Error {}

function shorten(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > EXCERPT_LENGTH
    ? `${flat.slice(0, EXCERPT_LENGTH).trimEnd()}…`
    : flat;
}

async function search(
  objective: string,
  queries: string[],
  source: SearchSource,
): Promise<CheckResult[]> {
  const apiKey = process.env.PARALLEL_API_KEY;
  if (!apiKey) {
    throw new SearchError("Search is not configured.");
  }

  let response: Response;
  try {
    response = await fetch(SEARCH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
      },
      body: JSON.stringify({
        objective,
        search_queries: queries,
        mode: "advanced",
        advanced_settings: { max_results: 10 },
      }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new SearchError(`The ${source} search could not be reached.`);
  }

  if (!response.ok) {
    throw new SearchError(
      `The ${source} search failed with status ${response.status}.`,
    );
  }

  const data = (await response.json()) as ParallelSearchResponse;
  return (data.results ?? []).map((result) => ({
    title: result.title || result.url,
    url: result.url,
    publishDate: result.publish_date ?? null,
    excerpt: shorten(result.excerpts?.join(" ") ?? ""),
    source,
  }));
}

export async function checkCompany(
  company: string,
  emailDomain: string | null,
): Promise<CheckResult[]> {
  const warningQueries = [`${company} recruitment fraud`];
  if (emailDomain) {
    warningQueries.push(emailDomain);
  }

  const [official, warnings] = await Promise.all([
    search(
      "Find the company's official website, careers page, and any page where the company says which email addresses its recruiters use",
      [`${company} official website careers`],
      "official",
    ),
    search(
      "find job scams or warnings about this company or this website",
      warningQueries,
      "warnings",
    ),
  ]);

  return [...official, ...warnings];
}
