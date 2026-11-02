import "server-only";

import { createHmac } from "node:crypto";
import { Redis } from "@upstash/redis";

// Limits for POST /api/check, stored in Upstash Redis (Vercel Marketplace).
//
// - Each visitor gets DAILY_LIMIT checks per UTC day, keyed by a one-way
//   HMAC-SHA256 hash of their IP address. The IP itself is never stored.
// - All visitors together get MONTHLY_CAP checks per UTC calendar month.
//
// A check is only counted when it is allowed, and both counters are checked
// and updated in one Lua script, so concurrent requests cannot overshoot.

const DAILY_LIMIT = 10;
const DEFAULT_MONTHLY_CAP = 1000;

export type LimitResult =
  | { allowed: true }
  | { allowed: false; reason: "visitor" | "monthly" };

// Thrown when limits cannot be checked (storage missing or unreachable).
export class RateLimitError extends Error {}

// Returns 0 when allowed, 1 when the visitor is over the daily limit,
// 2 when the monthly cap for everyone is reached.
const SCRIPT = `
local visitor = tonumber(redis.call("GET", KEYS[1]) or "0")
local total = tonumber(redis.call("GET", KEYS[2]) or "0")
if total >= tonumber(ARGV[2]) then return 2 end
if visitor >= tonumber(ARGV[1]) then return 1 end
redis.call("INCR", KEYS[1])
redis.call("EXPIRE", KEYS[1], ARGV[3])
redis.call("INCR", KEYS[2])
redis.call("EXPIRE", KEYS[2], ARGV[4])
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

function monthlyCap(): number {
  const value = Number(process.env.MONTHLY_CHECK_CAP);
  return Number.isInteger(value) && value >= 0 ? value : DEFAULT_MONTHLY_CAP;
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
      return { allowed: true };
    }
    // Fail closed in production so Parallel is never called without limits.
    throw new RateLimitError("Rate limiting is not configured.");
  }

  const now = new Date();
  const day = now.toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
  const month = day.slice(0, 7); // YYYY-MM (UTC)

  const nextDay = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
  );
  const nextMonth = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
  // Keep keys a little past their period so a slow clock can't reset early.
  const dayTtl = Math.ceil((nextDay - now.getTime()) / 1000) + 3600;
  const monthTtl = Math.ceil((nextMonth - now.getTime()) / 1000) + 86400;

  let code: unknown;
  try {
    code = await store.eval(
      SCRIPT,
      [`checks:visitor:${day}:${hashIp(ip, secret)}`, `checks:total:${month}`],
      [DAILY_LIMIT, monthlyCap(), dayTtl, monthTtl],
    );
  } catch {
    throw new RateLimitError("Rate limit storage could not be reached.");
  }

  if (code === 0) return { allowed: true };
  if (code === 1) return { allowed: false, reason: "visitor" };
  if (code === 2) return { allowed: false, reason: "monthly" };
  throw new RateLimitError("Unexpected rate limit response.");
}
