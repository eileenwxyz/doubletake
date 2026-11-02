import { checkCompany } from "@/lib/parallel";
import { clientIp, takeCheck } from "@/lib/rate-limit";

const MAX_LENGTH = 200;
const GENERIC_ERROR = "Something went wrong. Try again.";
const VISITOR_LIMIT_ERROR = "You've used today's checks. Try again tomorrow.";
const MONTHLY_CAP_ERROR = "Daily checks are used up. Try again tomorrow.";

function badRequest(error: string) {
  return Response.json({ error }, { status: 400 });
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest("Send a company name.");
  }

  const { company, email } = (body ?? {}) as {
    company?: unknown;
    email?: unknown;
  };

  if (typeof company !== "string" || company.trim() === "") {
    return badRequest("Enter a company name.");
  }
  const name = company.trim();
  if (name.length > MAX_LENGTH) {
    return badRequest(`Company name must be ${MAX_LENGTH} characters or fewer.`);
  }

  let emailDomain: string | null = null;
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
      emailDomain = match[1].toLowerCase();
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
    const results = await checkCompany(name, emailDomain);
    return Response.json({ results });
  } catch {
    // Deliberately no details: never surface upstream errors or secrets.
    return Response.json({ error: GENERIC_ERROR }, { status: 502 });
  }
}
