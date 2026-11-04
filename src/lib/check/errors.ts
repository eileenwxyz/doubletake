// Errors a check can fail with, and how they are logged.

// Wraps an error with the step of the check that failed, so the server log
// says where it happened.
export class CheckStepError extends Error {
  readonly step: string;
  readonly cause: unknown;
  constructor(step: string, cause: unknown) {
    super(`Check failed at step: ${step}`);
    this.name = "CheckStepError";
    this.step = step;
    this.cause = cause;
  }
}

// Runs one step of a check, labelling any error with the step's name.
export async function step<T>(name: string, work: () => Promise<T> | T): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof CheckStepError) throw error;
    throw new CheckStepError(name, error);
  }
}

const MAX_MESSAGE = 300;
const MAX_STACK = 2_000;

// Removes what must never reach a log: the API key, email addresses, and
// URL query strings and fragments (which can hold search terms). Long text
// is cut, so page text can't spill into the log.
export function redactForLog(text: string, secrets: ReadonlyArray<string | undefined> = []): string {
  let out = text;
  for (const secret of secrets) {
    if (secret && secret.length >= 4) out = out.split(secret).join("[redacted]");
  }
  return out
    .replace(/[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+/gi, "[email]")
    .replace(/(https?:\/\/[^\s?#"'<>)]*)[?#][^\s"'<>)]*/gi, "$1?[redacted]")
    .replace(/(\/[^\s?#"'<>)]*)\?[^\s"'<>)]*/g, "$1?[redacted]");
}

export type CheckFailureLog = { step: string; name: string; message: string; stack: string | null };

// What the route logs when a check fails: the step, the error's name and
// message, and its stack, all redacted. Never the request, the recruiter's
// email, or page text.
export function describeFailure(error: unknown, secrets: ReadonlyArray<string | undefined> = []): CheckFailureLog {
  const stepName = error instanceof CheckStepError ? error.step : "unknown";
  const inner = error instanceof CheckStepError ? error.cause : error;
  const err = inner instanceof Error ? inner : null;
  const message = redactForLog(err?.message ?? String(inner), secrets).slice(0, MAX_MESSAGE);
  const stack = err?.stack ? redactForLog(err.stack, secrets).slice(0, MAX_STACK) : null;
  return { step: stepName, name: err?.name ?? typeof inner, message, stack };
}
