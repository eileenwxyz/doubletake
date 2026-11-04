# Doubletake

**Check who's really hiring.**

Doubletake helps job seekers check whether a company, website, or recruiter
email is legitimate before they reply. You give it a company name, a URL, or a
recruiter's email, and it looks the details up and returns an honest, sourced
verdict.

## How it works

You enter a company name or website (and, optionally, the recruiter's email).
The server then:

1. Runs two [Parallel](https://parallel.ai) Search API queries at once: one for
   the company's official website, careers page and recruiting-fraud notice,
   and one for scam warnings about the company or the email's domain.
2. Works out the company's official domain: the website you entered, or the
   registrable domain (via the Public Suffix List) that most official results
   share and whose pages name the company. If the results point to more than
   one company, it asks for the website or the recruiter's email.
3. Reads up to 3 official pages and up to 2 company-specific warning pages in
   full with Parallel's Extract API (careers pages no older than 10 minutes,
   other pages no older than 1 day). An empty or near-empty read counts as
   "couldn't read", never as "nothing there".
4. Applies fixed rules to the sender's domain and to each source, and returns a
   verdict ("strong_warning", "mixed", "no_red_flags" or "not_enough"), an
   optional subtitle, the company's own words about its recruiting addresses,
   the top 3 reasons, what couldn't be found, and every source.

The rules live in `src/lib/check/`; every hard-coded domain list (hiring
software, free email providers, regulators, rating sites, directories, forums)
is in `src/lib/check/domain-lists.ts`.

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

Run the unit tests (no live API calls; they use fixture data):

```bash
npm test
```

## Project layout

- `src/app/`: pages and layout (App Router)
- `src/lib/check/`: verdict rules, source types and domain lists
- `src/lib/parallel.ts`: Parallel Search and Extract API calls
- `tests/`: unit tests and fixtures (fictional companies on `.example` domains)
- `data/fixtures/`: saved example API responses (one per verdict), shown as
  "Example" results on the empty page and used in tests
- `src/lib/copy.ts`: every user-facing string
- `src/app/globals.css`: every color, font and spacing value, as CSS variables
- `docs/screenshots/`: phone-width screenshots of each screen state

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
  Change the limit with `DAILY_CHECK_LIMIT`.
- All visitors together get 1,000 checks per calendar month (UTC). After that,
  every check returns 429 with "Doubletake has reached its limit for this
  month. Try again on the 1st."
  and Parallel is not called. Change the cap with `MONTHLY_CHECK_CAP`.

Only checks that pass input validation count, and a check that fails or
runs past 55 seconds is given back. Successful responses include
`checksRemaining` so the page can show "N checks left today" at 3 or fewer. Counters live in Upstash Redis
(added through the Vercel Marketplace). These server-side variables are needed:

- `KV_REST_API_URL` and `KV_REST_API_TOKEN`: set by the Upstash integration
  (`UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` also work).
- `IP_HASH_SECRET`: a long random string used to hash IP addresses.
- `DAILY_CHECK_LIMIT` (optional): checks per visitor per day, defaults to 10.
- `MONTHLY_CHECK_CAP` (optional): checks for everyone per month, defaults to 1000.

In production, if storage or `IP_HASH_SECRET` is missing or Redis can't be
reached, checks fail with a generic error instead of calling Parallel without
limits. In local development without these variables, limits are skipped.
