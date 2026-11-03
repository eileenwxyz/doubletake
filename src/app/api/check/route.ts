import { domainLabel, hostOf, isRealDomain } from "@/lib/check/domains";
import { runCheck } from "@/lib/check/run";
import {
  GENERIC_ERROR,
  MONTHLY_CAP_ERROR,
  VISITOR_LIMIT_ERROR,
} from "@/lib/messages";
import { clientIp, takeCheck } from "@/lib/rate-limit";

const MAX_LENGTH = 200;

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
    return badRequest("Send a company name.");
  }

  const { company, email, website } = (body ?? {}) as {
    company?: unknown;
    email?: unknown;
    website?: unknown;
  };

  if (typeof company !== "string" || company.trim() === "") {
    return badRequest("Enter a company name.");
  }
  let name = company.trim();
  if (name.length > MAX_LENGTH) {
    return badRequest(`Company name must be ${MAX_LENGTH} characters or fewer.`);
  }
  if (name.includes("@")) {
    return badRequest("Put the recruiter's email in the email field.");
  }

  let site: string | null = null;
  if (website !== undefined && website !== null && website !== "") {
    if (typeof website !== "string" || website.trim().length > MAX_LENGTH) {
      return badRequest("Enter a valid website.");
    }
    site = websiteFrom(website.trim());
    if (!site) return badRequest("Enter a valid website.");
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
      return badRequest("Enter a valid email address.");
    }
    const address = email.trim();
    if (address.length > MAX_LENGTH) {
      return badRequest(`Email must be ${MAX_LENGTH} characters or fewer.`);
    }
    if (address !== "") {
      const match = /^[^@\s]+@([^@\s]+\.[^@\s]+)$/.exec(address);
      if (!match) {
        return badRequest("Enter a valid email address.");
      }
      senderAddress = address.toLowerCase();
      senderDomain = match[1].toLowerCase().replace(/\.$/, "");
    }
  }

  // Limits run after validation, so a typo doesn't cost a check.
  try {
    const limit = await takeCheck(clientIp(request));
    if (!limit.allowed) {
      const error =
        limit.reason === "monthly" ? MONTHLY_CAP_ERROR : VISITOR_LIMIT_ERROR;
      return Response.json({ error }, { status: 429 });
    }
  } catch {
    // Fail closed: never call Parallel when limits can't be checked.
    return Response.json({ error: GENERIC_ERROR }, { status: 503 });
  }

  try {
    const result = await runCheck({
      company: name,
      website: site,
      senderAddress,
      senderDomain,
    });
    return Response.json(result);
  } catch {
    // Deliberately no details: never surface upstream errors or secrets.
    return Response.json({ error: GENERIC_ERROR }, { status: 502 });
  }
}
