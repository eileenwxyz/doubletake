# Doubletake

**Check who's really hiring.**

Doubletake helps job seekers check whether a company, website, or recruiter
email is legitimate before they reply. You give it a company name, a URL, or a
recruiter's email, and it looks the details up and returns an honest, sourced
verdict.

Lookups will use [Parallel](https://parallel.ai)'s Search API. Right now the app
is only a placeholder home page and does not make any API calls yet.

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
