// Retakes docs/screenshots: every screen state at phone width, plus one
// desktop shot. Run with `npm run screenshots`, which builds first.
//
// It serves the production build (the dev server adds its own badge and
// toasts) and mocks POST /api/check, so no real check runs and no API key
// is needed. Results come from data/fixtures: the four example results and,
// in data/fixtures/screens, results saved for the job-link, staffing agency
// and partial-check screens.
//
// Retake only some: `npm run screenshots -- 07 17` (matches by prefix).
// The first time, install the browser: `npx playwright install chromium`.

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const OUT = `${ROOT}docs/screenshots`;
const PORT = Number(process.env.PORT ?? 3123);
const BASE = `http://localhost:${PORT}/`;
const only = process.argv.slice(2);

const json = (path) => JSON.parse(readFileSync(`${ROOT}${path}`, "utf8"));
const fixture = (name) => json(`data/fixtures/${name}.json`);
const screen = (name) => json(`data/fixtures/screens/${name}.json`);

// Messages the API returns, read from copy.ts so they stay in step.
const copy = readFileSync(`${ROOT}src/lib/copy.ts`, "utf8");
function message(name) {
  const match = copy.match(new RegExp(`${name}\\s*[:=]\\s*"([^"]+)"`));
  if (!match) throw new Error(`No string ${name} in copy.ts`);
  return match[1];
}

const PHONE = { viewport: { width: 360, height: 640 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const DESKTOP = { viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 };

// ---- Server ----

async function startServer() {
  const server = spawn(`${ROOT}node_modules/.bin/next`, ["start", "-p", String(PORT)], { cwd: ROOT, stdio: "ignore" });
  for (let i = 0; i < 60; i++) {
    try {
      await fetch(BASE);
      return server;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  server.kill();
  throw new Error(`The server didn't start on port ${PORT}. Run \`npm run build\` first.`);
}

// ---- Helpers ----

let browser;

async function open(device = PHONE, { clock = false } = {}) {
  const context = await browser.newContext({ ...device, timezoneId: "America/New_York", locale: "en-US" });
  const page = await context.newPage();
  if (clock) await page.clock.install();
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  return { context, page };
}

// respond: { status, body }, or "hang" for a check that never answers.
async function mockCheck(page, respond) {
  await page.route("**/api/check", (route) =>
    respond === "hang"
      ? undefined
      : route.fulfill({
          status: respond.status ?? 200,
          contentType: "application/json",
          body: JSON.stringify(respond.body),
        }),
  );
}

const result = (report, checksRemaining = null) => ({ body: { ...report, checksRemaining } });
const emailFor = (report) => (report.senderDomain ? `talent@${report.senderDomain}` : "");

async function fill(page, company, email = "") {
  await page.fill("#company", company);
  if (email) await page.fill("#email", email);
}

async function submit(page) {
  await page.click("button[type=submit]");
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(200);
}

async function blur(page) {
  await page.evaluate(() => document.activeElement?.blur());
}

async function shoot(page, name, options = {}) {
  await page.waitForTimeout(150);
  await page.screenshot({ path: `${OUT}/${name}.png`, ...options });
  console.log(`saved docs/screenshots/${name}.png`);
}

// ---- Shots ----
// Keyed by the first screenshot each one takes.

const shots = {
  async "01-empty"() {
    const { context, page } = await open();
    await shoot(page, "01-empty");
    await shoot(page, "01-empty-full", { fullPage: true });
    await context.close();
  },

  // Checking, then still checking at 30 seconds, then giving up at 60.
  async "02-checking"() {
    const { context, page } = await open(PHONE, { clock: true });
    await mockCheck(page, "hang");
    await fill(page, "Northwind Freight", "talent@northwind-freight.example");
    await page.click("button[type=submit]");
    await page.waitForSelector(".checking");
    await shoot(page, "02-checking");
    await page.clock.fastForward(30_000);
    await page.waitForTimeout(100);
    await shoot(page, "03-taking-longer");
    await page.clock.fastForward(30_000);
    await page.waitForSelector(".notice--error");
    await blur(page);
    await shoot(page, "04-gave-up-error");
    await context.close();
  },

  async "05-need-more-detail"() {
    const { context, page } = await open();
    await mockCheck(page, {
      body: { status: "need_more_detail", message: message("NEED_MORE_DETAIL_MESSAGE"), checksRemaining: null },
    });
    await fill(page, "Acme");
    await submit(page);
    await shoot(page, "05-need-more-detail");
    await context.close();
  },

  async "06-error"() {
    const { context, page } = await open();
    await mockCheck(page, { status: 500, body: { error: message("GENERIC_ERROR") } });
    await fill(page, "Quillmark Studio");
    await submit(page);
    await blur(page);
    await shoot(page, "06-error");
    await context.close();
  },

  async "07-result-strong-warning"() {
    const report = fixture("strong-warning");
    const { context, page } = await open();
    await mockCheck(page, result(report));
    await fill(page, report.companyName, emailFor(report));
    await submit(page);
    await shoot(page, "07-result-strong-warning");

    for (const button of await page.$$(".collapsible-button[aria-expanded=false]")) await button.click();
    await page.evaluate(() => window.scrollTo(0, 0));
    await shoot(page, "07-result-strong-warning-full-expanded", { fullPage: true });

    await page.reload({ waitUntil: "networkidle" });
    await fill(page, report.companyName, emailFor(report));
    await submit(page);
    await page.getByRole("button", { name: "Not this one?" }).click();
    await page.waitForTimeout(300);
    await shoot(page, "11-not-this-one");
    await context.close();
  },

  async "08-results"() {
    const results = [
      ["08-result-mixed", fixture("mixed")],
      ["09-result-no-red-flags", fixture("no-red-flags")],
      ["10-result-not-enough", fixture("not-enough")],
      ["17-result-job-link", screen("job-link"), "https://www.linkedin.com/jobs/view/4012345678"],
      ["18-result-staffing-agency", screen("agency"), "https://www.linkedin.com/jobs/view/4088888888"],
      ["19-result-partial", screen("partial")],
    ];
    for (const [name, report, input] of results) {
      if (only.length && !only.some((o) => name.startsWith(o))) continue;
      const { context, page } = await open();
      await mockCheck(page, result(report));
      await fill(page, input ?? report.companyName, emailFor(report));
      await submit(page);
      await shoot(page, name);
      await context.close();
    }
  },

  async "12-near-limit"() {
    const { context, page } = await open();
    await mockCheck(page, result(fixture("mixed"), 2));
    await fill(page, "Quillmark Studio");
    await submit(page);
    await page.locator("#company").focus();
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await shoot(page, "12-near-limit");
    await context.close();
  },

  async "13-daily-limit"() {
    for (const [name, limit, error] of [
      ["13-daily-limit", "daily", message("VISITOR_LIMIT_ERROR")],
      ["14-monthly-cap", "monthly", message("MONTHLY_CAP_ERROR")],
    ]) {
      const { context, page } = await open();
      await mockCheck(page, { status: 429, body: { error, limit } });
      await fill(page, "Acme");
      await submit(page);
      await blur(page);
      await shoot(page, name);
      await context.close();
    }
  },

  async "15-example-strong-warning"() {
    const phone = await open();
    await phone.page.locator(".example--strong_warning").click();
    await phone.page.waitForTimeout(200);
    await shoot(phone.page, "15-example-strong-warning");
    await phone.context.close();

    const desktop = await open(DESKTOP);
    await desktop.page.locator(".example--mixed").click();
    await desktop.page.waitForTimeout(200);
    await shoot(desktop.page, "16-desktop-example-mixed");
    await desktop.context.close();
  },

  async "20-not-a-job-link"() {
    const { context, page } = await open();
    await mockCheck(page, { status: 400, body: { error: message("notAJobLink") } });
    await fill(page, "https://www.indeed.example/companies/acme");
    await submit(page);
    await shoot(page, "20-not-a-job-link");
    await context.close();
  },
};

// ---- Run ----

const server = await startServer();
try {
  browser = await chromium.launch();
  // The other screenshots each shot takes ("08-results" filters inside).
  const alsoTakes = {
    "02-checking": ["03", "04"],
    "07-result-strong-warning": ["11"],
    "13-daily-limit": ["14"],
    "15-example-strong-warning": ["16"],
  };
  for (const [key, take] of Object.entries(shots)) {
    const names = [key, ...(alsoTakes[key] ?? [])];
    const wanted =
      !only.length || key === "08-results" || only.some((o) => names.some((n) => n.startsWith(o)));
    if (wanted) await take();
  }
} finally {
  await browser?.close();
  server.kill();
}
