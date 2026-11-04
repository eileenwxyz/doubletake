import { beforeEach, describe, expect, it, vi } from "vitest";

const takeCheck = vi.fn();
const runCheck = vi.fn();
const refund = vi.fn();

vi.mock("@/lib/rate-limit", () => ({
  clientIp: () => "203.0.113.1",
  takeCheck: (...args: unknown[]) => takeCheck(...args),
}));
vi.mock("@/lib/check/run", () => ({
  runCheck: (...args: unknown[]) => runCheck(...args),
}));

const { POST } = await import("@/app/api/check/route");

function post(body: unknown) {
  return POST(
    new Request("http://localhost/api/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  takeCheck.mockReset();
  runCheck.mockReset();
  refund.mockReset();
  takeCheck.mockResolvedValue({ allowed: true, remaining: null, refund });
  runCheck.mockResolvedValue({ status: "need_more_detail", message: "m" });
});

describe("POST /api/check", () => {
  it("shows the monthly-cap message", async () => {
    takeCheck.mockResolvedValue({ allowed: false, reason: "monthly" });
    const response = await post({ company: "Acme" });
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({
      error: "Doubletake has reached its limit for this month. Try again on the 1st.",
      limit: "monthly",
    });
    expect(runCheck).not.toHaveBeenCalled();
  });

  it("passes the sender's domain and a typed website to the check", async () => {
    await post({ company: "https://careers.acme.example/jobs", email: "HR@Acme.example" });
    expect(runCheck).toHaveBeenCalledWith({
      company: "acme",
      website: "careers.acme.example",
      senderAddress: "hr@acme.example",
      senderDomain: "acme.example",
      locale: "en-us",
      jobLink: null,
      jobTitle: null,
    });
  });

  it("accepts an email with a display name, uppercase and extra spaces", async () => {
    const response = await post({ company: "Acme", email: "  Jane Doe <JANE@Acme.example> " });
    expect(response.status).toBe(200);
    expect(runCheck).toHaveBeenCalledWith({
      company: "Acme",
      website: null,
      senderAddress: "jane@acme.example",
      senderDomain: "acme.example",
      locale: "en-us",
      jobLink: null,
      jobTitle: null,
    });
    // The display name is never passed on.
    expect(JSON.stringify(runCheck.mock.calls)).not.toMatch(/doe/i);
  });

  it("rejects a display name without an address", async () => {
    expect((await post({ company: "Acme", email: "Jane Doe" })).status).toBe(400);
  });

  it("returns the structured result", async () => {
    const response = await post({ company: "Acme" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "need_more_detail",
      message: "m",
      checksRemaining: null,
    });
  });

  it("shows the daily-limit message", async () => {
    takeCheck.mockResolvedValue({ allowed: false, reason: "visitor" });
    const response = await post({ company: "Acme" });
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({
      error: "You've used today's checks. Try again tomorrow.",
      limit: "daily",
    });
  });

  it("passes on how many checks are left today", async () => {
    takeCheck.mockResolvedValue({ allowed: true, remaining: 2, refund });
    const response = await post({ company: "Acme" });
    expect((await response.json()).checksRemaining).toBe(2);
  });

  it("gives the check back when the check fails", async () => {
    runCheck.mockRejectedValue(new Error("upstream down"));
    const response = await post({ company: "Acme" });
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "Something went wrong. Try again." });
    expect(refund).toHaveBeenCalledTimes(1);
  });

  it("gives up and gives the check back after 55 seconds", async () => {
    vi.useFakeTimers();
    try {
      runCheck.mockReturnValue(new Promise(() => {}));
      const pending = post({ company: "Acme" });
      await vi.advanceTimersByTimeAsync(55_000);
      const response = await pending;
      expect(response.status).toBe(504);
      expect(refund).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("doesn't count a check that fails validation", async () => {
    await post({ company: "" });
    expect(takeCheck).not.toHaveBeenCalled();
  });

  it("passes on only the clean LinkedIn job link, never the search terms in a pasted link", async () => {
    const messy =
      "https://www.linkedin.com/jobs/search/?currentJobId=4012345678&keywords=night%20shift%20welder" +
      "&location=Shelbyville%2C%20Ohio&geoId=90000123&origin=JOBS_HOME_SEARCH_BUTTON&refresh=true";
    const response = await post({ company: messy });
    expect(response.status).toBe(200);
    expect(runCheck).toHaveBeenCalledWith({
      company: null,
      website: null,
      senderAddress: null,
      senderDomain: null,
      locale: "en-us",
      jobLink: { kind: "linkedin", jobId: "4012345678", url: "https://www.linkedin.com/jobs/view/4012345678" },
      jobTitle: null,
    });
    expect(JSON.stringify(runCheck.mock.calls)).not.toMatch(/welder|shelbyville|keywords|geoId/i);
  });

  it("accepts a job board link and a typed job title", async () => {
    await post({ company: "https://jobs.lever.co/acme/1a2b3c4d-aaaa-bbbb-cccc-1234567890ab?lever-source=x" });
    expect(runCheck.mock.calls[0][0]).toMatchObject({
      company: null,
      website: null,
      jobLink: { kind: "board", platform: "Lever", url: "https://jobs.lever.co/acme/1a2b3c4d-aaaa-bbbb-cccc-1234567890ab" },
    });
    await post({ company: "Acme", jobTitle: "  Senior   Anvil Engineer " });
    expect(runCheck.mock.calls[1][0]).toMatchObject({ company: "Acme", jobLink: null, jobTitle: "Senior Anvil Engineer" });
  });

  it("passes on a state job board link without the search terms", async () => {
    await post({ company: "https://www.azjobconnection.gov/jobs/jobdetails?jobid=12345678&keywords=designer&location=Tempe" });
    expect(runCheck.mock.calls[0][0]).toMatchObject({
      company: null,
      website: null,
      jobLink: { kind: "aggregator", site: "azjobconnection.gov", url: "https://www.azjobconnection.gov/jobs/jobdetails?jobid=12345678" },
    });
    expect(JSON.stringify(runCheck.mock.calls)).not.toMatch(/keywords|tempe/i);
  });

  it("rejects a LinkedIn or job board link that isn't a posting", async () => {
    for (const company of ["https://www.linkedin.com/company/acme-example", "jobs.lever.co/acme", "https://www.indeed.com/jobs?q=welder"]) {
      const response = await post({ company });
      expect(response.status).toBe(400);
    }
    expect(takeCheck).not.toHaveBeenCalled();
  });

  it("rejects an email in the company field", async () => {
    const response = await post({ company: "hr@acme.example" });
    expect(response.status).toBe(400);
  });
});
