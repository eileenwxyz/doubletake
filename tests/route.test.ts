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

  it("rejects an email in the company field", async () => {
    const response = await post({ company: "hr@acme.example" });
    expect(response.status).toBe(400);
  });
});
