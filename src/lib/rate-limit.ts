import "server-only";

import { createHmac } from "node:crypto";
import { Redis } from "@upstash/redis";

// Limits for POST /api/check, stored in Upstash Redis (Vercel Marketplace).
//
// - Each visitor gets DAILY_CHECK_LIMIT checks per UTC day, keyed by a one-way
//   HMAC-SHA256 hash of their IP address. The IP itself is never stored.
// - All visitors together get MONTHLY_CHECK_CAP checks per UTC calendar month.
//
// Keys start with the deployment's environment (VERCEL_ENV: production,
// preview or development), so checks on a preview deployment never use up
// production's limits. Each environment has its own monthly cap
// (MONTHLY_CHECK_CAP is set per environment in Vercel).
//
// A check is only counted when it is allowed, and both counters are checked
// and updated in one Lua script, so concurrent requests cannot overshoot.

const DEFAULT_DAILY_LIMIT = 10;
const DEFAULT_MONTHLY_CAP = 1000;

export type LimitResult =
  | {
      allowed: true;
      // Checks the visitor has left today after this one; null when limits
      // are off.
      remaining: number | null;
      // Gives the check back, for a check that failed and returned nothing.
      refund: () => Promise<void>;
    }
  | { allowed: false; reason: "visitor" | "monthly" };

// Thrown when limits cannot be checked (storage missing or unreachable).
export class RateLimitError extends Error {}

// Returns {0, checks left today} when allowed, {1, 0} when the visitor is
// over the daily limit, {2, 0} when the monthly cap for everyone is reached.
const SCRIPT = `
local visitor = tonumber(redis.call("GET", KEYS[1]) or "0")
local total = tonumber(redis.call("GET", KEYS[2]) or "0")
if total >= tonumber(ARGV[2]) then return {2, 0} end
if visitor >= tonumber(ARGV[1]) then return {1, 0} end
redis.call("INCR", KEYS[1])
redis.call("EXPIRE", KEYS[1], ARGV[3])
redis.call("INCR", KEYS[2])
redis.call("EXPIRE", KEYS[2], ARGV[4])
return {0, tonumber(ARGV[1]) - visitor - 1}
`;

// Takes back one check from both counters, never going below zero.
const REFUND_SCRIPT = `
for _, key in ipairs(KEYS) do
  if tonumber(redis.call("GET", key) or "0") > 0 then redis.call("DECR", key) end
end
return 0
`;

let client: Redis | null = null;

function redis(): Redis | null {
  if (client) return client;
  // The Vercel Marketplace Upstash integration sets KV_REST_API_*; a database
  // created directly on upstash.com uses UPSTASH_REDIS_REST_*.
  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
  const token =
    process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  client = new Redis({ url, token });
  return client;
}

// Reads a non-negative integer from the environment, or returns the fallback
// when the variable is unset or not a valid number.
function envLimit(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value >= 0 ? value : fallback;
}

function dailyLimit(): number {
  return envLimit("DAILY_CHECK_LIMIT", DEFAULT_DAILY_LIMIT);
}

function monthlyCap(): number {
  return envLimit("MONTHLY_CHECK_CAP", DEFAULT_MONTHLY_CAP);
}

// The deployment's environment, for key names: VERCEL_ENV on Vercel,
// "development" elsewhere. Anything unexpected is reduced to letters,
// digits and hyphens so it can't change a key's shape.
export function limitEnvironment(): string {
  const value = (process.env.VERCEL_ENV ?? "").toLowerCase().replace(/[^a-z0-9-]/g, "");
  return value || "development";
}

// The two counters a check uses: the visitor's for the day and everyone's
// for the month, in this environment.
export function limitKeys(env: string, day: string, ipHash: string): [string, string] {
  return [`checks:${env}:visitor:${day}:${ipHash}`, `checks:${env}:total:${day.slice(0, 7)}`];
}

function hashIp(ip: string, secret: string): string {
  return createHmac("sha256", secret).update(ip).digest("hex");
}

// On Vercel, x-forwarded-for is set by the platform; the first entry is the
// visitor's address.
export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  return first || request.headers.get("x-real-ip")?.trim() || "unknown";
}

export async function takeCheck(ip: string): Promise<LimitResult> {
  const store = redis();
  const secret = process.env.IP_HASH_SECRET;

  if (!store || !secret) {
    if (process.env.NODE_ENV !== "production") {
      // Local development without storage: skip limits rather than block.
      console.warn("Rate limits are off: storage or IP_HASH_SECRET is not set.");
      return { allowed: true, remaining: null, refund: async () => {} };
    }
    // Fail closed in production so Parallel is never called without limits.
    throw new RateLimitError("Rate limiting is not configured.");
  }

  const now = new Date();
  const day = now.toISOString().slice(0, 10); // YYYY-MM-DD (UTC)

  const nextDay = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
  );
  const nextMonth = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
  // Keep keys a little past their period so a slow clock can't reset early.
  const dayTtl = Math.ceil((nextDay - now.getTime()) / 1000) + 3600;
  const monthTtl = Math.ceil((nextMonth - now.getTime()) / 1000) + 86400;

  const keys = limitKeys(limitEnvironment(), day, hashIp(ip, secret));
  let reply: unknown;
  try {
    reply = await store.eval(SCRIPT, keys, [dailyLimit(), monthlyCap(), dayTtl, monthTtl]);
  } catch {
    throw new RateLimitError("Rate limit storage could not be reached.");
  }

  const [code, left] = Array.isArray(reply) ? reply : [reply, null];
  if (code === 0) {
    return {
      allowed: true,
      remaining: typeof left === "number" ? Math.max(0, left) : null,
      refund: async () => {
        try {
          await store.eval(REFUND_SCRIPT, keys, []);
        } catch {
          // A lost refund only costs the visitor one check.
        }
      },
    };
  }
  if (code === 1) return { allowed: false, reason: "visitor" };
  if (code === 2) return { allowed: false, reason: "monthly" };
  throw new RateLimitError("Unexpected rate limit response.");
}
