import { beforeEach, describe, expect, it, vi } from "vitest";

const takeCheck = vi.fn();
const runCheck = vi.fn();

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
  takeCheck.mockResolvedValue({ allowed: true });
  runCheck.mockResolvedValue({ status: "need_more_detail", message: "m" });
});

describe("POST /api/check", () => {
  it("shows the monthly-cap message", async () => {
    takeCheck.mockResolvedValue({ allowed: false, reason: "monthly" });
    const response = await post({ company: "Acme" });
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({
      error: "Doubletake has reached its limit for this month. Try again on the 1st.",
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
    });
  });

  it("returns the structured result", async () => {
    const response = await post({ company: "Acme" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "need_more_detail", message: "m" });
  });

  it("rejects an email in the company field", async () => {
    const response = await post({ company: "hr@acme.example" });
    expect(response.status).toBe(400);
  });
});
