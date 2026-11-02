# Doubletake

**Check who's really hiring.**

Doubletake helps job seekers check whether a company, website, or recruiter
email is legitimate before they reply. You give it a company name, a URL, or a
recruiter's email, and it looks the details up and returns an honest, sourced
verdict.

## How it works

You enter a company name (and, optionally, the recruiter's email), and the
server runs two [Parallel](https://parallel.ai) Search API queries at once: one
for the company's official website and careers page, and one for scam warnings
about the company or the email's domain. The results are listed as links with
their sources; there is no verdict yet.

> Doubletake is an independent project built on Parallel's API. It is not
> affiliated with, endorsed by, or sponsored by Parallel.

## Tech stack

- [Next.js](https://nextjs.org) (App Router) with TypeScript
- [Tailwind CSS](https://tailwindcss.com)

## Getting started

You need Node.js 20.9 or newer.

Install dependencies:

```bash
npm install
```

Start the dev server, then open http://localhost:3000:

```bash
npm run dev
```

Build and run a production version:

```bash
npm run build
```

```bash
npm start
```

Check the code with the linter:

```bash
npm run lint
```

## Project layout

- `src/app/`: pages and layout (App Router)
- `data/fixtures/`: saved example API responses, for development and tests

## Environment variables and secrets

API keys go in a local `.env` file (for example `.env.local`). Every `.env*`
file is listed in `.gitignore` so secrets are never committed. The only
exception is `.env.example`, which may be committed with placeholder values to
show which variables are needed.

On the deployed site, `PARALLEL_API_KEY` is set in Vercel's environment
variables and only used on the server, so visitors never need a key or see it.

## Rate limits

`POST /api/check` is limited before it calls Parallel:

- Each visitor gets 10 checks per day (UTC), keyed by an HMAC-SHA256 hash of
  their IP address. The IP itself is never stored. Over the limit, the API
  returns 429 with "You've used today's checks. Try again tomorrow."
- All visitors together get 1,000 checks per calendar month (UTC). After that,
  every check returns 429 with "Daily checks are used up. Try again tomorrow."
  and Parallel is not called. Change the cap with `MONTHLY_CHECK_CAP`.

Only checks that pass input validation count. Counters live in Upstash Redis
(added through the Vercel Marketplace). These server-side variables are needed:

- `KV_REST_API_URL` and `KV_REST_API_TOKEN`: set by the Upstash integration
  (`UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` also work).
- `IP_HASH_SECRET`: a long random string used to hash IP addresses.
- `MONTHLY_CHECK_CAP` (optional): defaults to 1000.

In production, if storage or `IP_HASH_SECRET` is missing or Redis can't be
reached, checks fail with a generic error instead of calling Parallel without
limits. In local development without these variables, limits are skipped.
