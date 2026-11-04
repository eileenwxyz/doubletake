import { domainLabel, hostOf, isRealDomain, preferredLocale } from "@/lib/check/domains";
import { runCheck } from "@/lib/check/run";
import {
  GENERIC_ERROR,
  INPUT_ERRORS,
  MONTHLY_CAP_ERROR,
  VISITOR_LIMIT_ERROR,
} from "@/lib/copy";
import { clientIp, takeCheck, type LimitResult } from "@/lib/rate-limit";
import type { CheckApiError, CheckApiResponse } from "@/lib/check/types";

const MAX_LENGTH = 200;

// The page gives up after 60 seconds; the server stops a little sooner so
// the visitor gets the check back.
export const maxDuration = 60;
const CHECK_DEADLINE_MS = 55_000;

class DeadlineError extends Error {}

function withDeadline<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new DeadlineError()), ms);
  });
  return Promise.race([work, deadline]).finally(() => clearTimeout(timer));
}

function badRequest(error: string) {
  return Response.json({ error }, { status: 400 });
}

const LOOKS_LIKE_WEBSITE = /^(https?:\/\/)?[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?(\/\S*)?$/i;

// Accepts a website typed into the company field ("acme.example" or
// "https://acme.example/careers").
function websiteFrom(value: string): string | null {
  if (!LOOKS_LIKE_WEBSITE.test(value)) return null;
  const host = hostOf(value);
  return host && isRealDomain(host) ? host : null;
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest(INPUT_ERRORS.noBody);
  }

  const { company, email, website } = (body ?? {}) as {
    company?: unknown;
    email?: unknown;
    website?: unknown;
  };

  if (typeof company !== "string" || company.trim() === "") {
    return badRequest(INPUT_ERRORS.noCompany);
  }
  let name = company.trim();
  if (name.length > MAX_LENGTH) {
    return badRequest(INPUT_ERRORS.companyTooLong(MAX_LENGTH));
  }
  if (name.includes("@")) {
    return badRequest(INPUT_ERRORS.emailInCompany);
  }

  let site: string | null = null;
  if (website !== undefined && website !== null && website !== "") {
    if (typeof website !== "string" || website.trim().length > MAX_LENGTH) {
      return badRequest(INPUT_ERRORS.badWebsite);
    }
    site = websiteFrom(website.trim());
    if (!site) return badRequest(INPUT_ERRORS.badWebsite);
  }
  const typedSite = websiteFrom(name);
  if (typedSite) {
    site = site ?? typedSite;
    name = domainLabel(typedSite) ?? name;
  }

  let senderAddress: string | null = null;
  let senderDomain: string | null = null;
  if (email !== undefined && email !== null && email !== "") {
    if (typeof email !== "string") {
      return badRequest(INPUT_ERRORS.badEmail);
    }
    // Accepts "Name <address>" as pasted from a mail client; the display
    // name is dropped and never stored or returned.
    const raw = email.trim();
    const bracketed = /<([^<>]+)>$/.exec(raw);
    const address = (bracketed ? bracketed[1] : raw).trim();
    if (raw.length > MAX_LENGTH) {
      return badRequest(INPUT_ERRORS.emailTooLong(MAX_LENGTH));
    }
    if (address !== "") {
      const match = /^[^@\s]+@([^@\s]+\.[^@\s]+)$/.exec(address);
      if (!match) {
        return badRequest(INPUT_ERRORS.badEmail);
      }
      senderAddress = address.toLowerCase();
      senderDomain = match[1].toLowerCase().replace(/\.$/, "");
    }
  }

  // Limits run after validation, so a typo doesn't cost a check.
  let limit: LimitResult;
  try {
    limit = await takeCheck(clientIp(request));
  } catch {
    // Fail closed: never call Parallel when limits can't be checked.
    return Response.json({ error: GENERIC_ERROR } satisfies CheckApiError, { status: 503 });
  }
  if (!limit.allowed) {
    const body: CheckApiError =
      limit.reason === "monthly"
        ? { error: MONTHLY_CAP_ERROR, limit: "monthly" }
        : { error: VISITOR_LIMIT_ERROR, limit: "daily" };
    return Response.json(body, { status: 429 });
  }

  try {
    const result = await withDeadline(
      runCheck({
        company: name,
        website: site,
        senderAddress,
        senderDomain,
        locale: preferredLocale(request.headers.get("accept-language")),
      }),
      CHECK_DEADLINE_MS,
    );
    const body: CheckApiResponse = { ...result, checksRemaining: limit.remaining ?? null };
    return Response.json(body);
  } catch (error) {
    // A check that returns nothing doesn't count against the limit.
    await limit.refund?.();
    // Deliberately no details: never surface upstream errors or secrets.
    return Response.json({ error: GENERIC_ERROR } satisfies CheckApiError, {
      status: error instanceof DeadlineError ? 504 : 502,
    });
  }
}
