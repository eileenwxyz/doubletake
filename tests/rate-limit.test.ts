// Rate limits are kept apart per environment: a check on a preview
// deployment never changes production's counters.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---- In-memory Redis that runs the two scripts the module uses ----

const store = new Map<string, number>();

vi.mock("@upstash/redis", () => ({
  Redis: class {
    async eval(script: string, keys: string[], args: number[]) {
      const get = (k: string) => store.get(k) ?? 0;
      if (script.includes("INCR")) {
        const [visitorKey, totalKey] = keys;
        const [daily, monthly] = args;
        if (get(totalKey) >= monthly) return [2, 0];
        if (get(visitorKey) >= daily) return [1, 0];
        store.set(visitorKey, get(visitorKey) + 1);
        store.set(totalKey, get(totalKey) + 1);
        return [0, daily - (get(visitorKey) - 1) - 1];
      }
      for (const k of keys) if (get(k) > 0) store.set(k, get(k) - 1);
      return 0;
    }
  },
}));

const { limitEnvironment, limitKeys, takeCheck } = await import("@/lib/rate-limit");

const ENV_NAMES = [
  "VERCEL_ENV",
  "KV_REST_API_URL",
  "KV_REST_API_TOKEN",
  "IP_HASH_SECRET",
  "DAILY_CHECK_LIMIT",
  "MONTHLY_CHECK_CAP",
] as const;
const saved: Partial<Record<(typeof ENV_NAMES)[number], string | undefined>> = {};

beforeEach(() => {
  store.clear();
  for (const name of ENV_NAMES) saved[name] = process.env[name];
  process.env.KV_REST_API_URL = "https://redis.example";
  process.env.KV_REST_API_TOKEN = "token";
  process.env.IP_HASH_SECRET = "secret";
  process.env.DAILY_CHECK_LIMIT = "2";
  process.env.MONTHLY_CHECK_CAP = "1000";
});

afterEach(() => {
  for (const name of ENV_NAMES) {
    if (saved[name] === undefined) delete process.env[name];
    else process.env[name] = saved[name];
  }
});

const counts = (env: string) =>
  [...store.entries()].filter(([k]) => k.startsWith(`checks:${env}:`)).map(([, v]) => v);

describe("rate limit keys", () => {
  it("start with the environment", () => {
    expect(limitKeys("production", "2026-11-05", "abc")).toEqual([
      "checks:production:visitor:2026-11-05:abc",
      "checks:production:total:2026-11",
    ]);
    expect(limitKeys("preview", "2026-11-05", "abc")[1]).toBe("checks:preview:total:2026-11");
  });

  it("use VERCEL_ENV, or development when it isn't set", () => {
    process.env.VERCEL_ENV = "preview";
    expect(limitEnvironment()).toBe("preview");
    process.env.VERCEL_ENV = "Production";
    expect(limitEnvironment()).toBe("production");
    delete process.env.VERCEL_ENV;
    expect(limitEnvironment()).toBe("development");
    process.env.VERCEL_ENV = "pre:view*";
    expect(limitEnvironment()).toBe("preview");
  });
});

describe("environments don't share limits", () => {
  it("a preview check doesn't change production counts", async () => {
    process.env.VERCEL_ENV = "production";
    await takeCheck("203.0.113.1");
    const before = new Map(store);

    process.env.VERCEL_ENV = "preview";
    await takeCheck("203.0.113.1");
    await takeCheck("203.0.113.1");
    // The visitor has used today's checks on preview...
    expect(await takeCheck("203.0.113.1")).toEqual({ allowed: false, reason: "visitor" });

    // ...but production's counters are as they were.
    for (const [key, value] of before) expect(store.get(key)).toBe(value);
    expect(counts("production")).toEqual([1, 1]);
    expect(counts("preview")).toEqual([2, 2]);

    // And the visitor still has a check left on production.
    process.env.VERCEL_ENV = "production";
    expect(await takeCheck("203.0.113.1")).toMatchObject({ allowed: true, remaining: 0 });
  });

  it("each environment has its own monthly cap", async () => {
    process.env.VERCEL_ENV = "preview";
    process.env.MONTHLY_CHECK_CAP = "1";
    await takeCheck("203.0.113.1");
    expect(await takeCheck("203.0.113.2")).toEqual({ allowed: false, reason: "monthly" });

    process.env.VERCEL_ENV = "production";
    process.env.MONTHLY_CHECK_CAP = "1000";
    expect(await takeCheck("203.0.113.2")).toMatchObject({ allowed: true });
  });

  it("a refund gives the check back in its own environment only", async () => {
    process.env.VERCEL_ENV = "production";
    await takeCheck("203.0.113.1");
    process.env.VERCEL_ENV = "preview";
    const preview = await takeCheck("203.0.113.1");
    if (!preview.allowed) throw new Error("expected allowed");
    await preview.refund();
    expect(counts("preview")).toEqual([0, 0]);
    expect(counts("production")).toEqual([1, 1]);
  });
});
