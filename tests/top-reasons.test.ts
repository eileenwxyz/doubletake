import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import Result from "@/app/result";
import { buildReport, type CheckInput } from "@/lib/check/report";
import { chooseTopReasons } from "@/lib/check/reasons";
import type { CheckReport, Direction, Reason, Verdict } from "@/lib/check/types";
import { EXAMPLE_RESULTS } from "@/lib/examples";
import { hit, read, withSender, NOW } from "./fixtures";

const ok = (input: CheckInput) => buildReport(input) as CheckReport;
const text = (html: string) => html.replace(/<[^>]+>/g, "").replace(/&#x27;/g, "'").replace(/&quot;/g, '"');

function render(report: CheckReport): string {
  return renderToStaticMarkup(
    createElement(Result, { report, isExample: false, onNotThisOne: () => {} }),
  );
}

// The Top reasons section and the "See all sources" body, as HTML.
function topReasons(html: string): string {
  const start = html.indexOf("Top reasons");
  const end = html.indexOf("</section>", start);
  return html.slice(start, end);
}
function allSources(html: string): string {
  const start = html.indexOf("See all sources");
  return html.slice(start, html.indexOf("How we checked", start));
}
const groupHeadings = (html: string) =>
  [...html.matchAll(/<h3 class="reason-group-heading">([\s\S]*?)<\/h3>/g)].map((m) => text(m[1]));

// ---- Small companies ----

const HOME = `# Tinyco\n\n${"Tinyco makes bakery software for small shops. ".repeat(6)}\n\n[Open roles](https://jobs.lever.co/tinyco)`;
const BOARD = "# Tinyco jobs\n\nBackend Engineer\nRemote\n\nApply now.";
// A page outside Tinyco's own site that names it.
const LINKEDIN = hit("https://www.linkedin.com/company/tinyco-example", "Tinyco | LinkedIn", "Tinyco. Bakery software. 12 employees.");

function tinyco(overrides: Partial<CheckInput> = {}): CheckInput {
  return {
    company: "Tinyco",
    website: null,
    senderAddress: null,
    senderDomain: null,
    // One page, found by the search and naming the company.
    officialHits: [hit("https://tinyco.example/", "Tinyco | Bakery software", "Tinyco makes bakery software.")],
    warningHits: [],
    reads: [read("https://tinyco.example/", "home", HOME), read("https://jobs.lever.co/tinyco", "careers", BOARD)],
    now: NOW,
    job: { title: "Backend Engineer", postingUrl: null, site: null, posted: null },
    ...overrides,
  };
}

describe("the job listing meets the evidence minimum", () => {
  it("is not enough when nothing outside the company's own pages names it", () => {
    // Its own site and its own job board can't vouch for it on their own.
    const r = ok(tinyco());
    expect(r.officialDomain).toBe("tinyco.example");
    expect(r.verdict).toBe("not_enough");
    expect(r.subtitle).toBe("We found almost nothing about this company outside its own website.");
  });

  it("is no red flags for a one-page company whose linked job board lists the role", () => {
    const r = ok(tinyco({ officialHits: [...tinyco().officialHits, LINKEDIN] }));
    expect(r.officialDomain).toBe("tinyco.example");
    expect(r.verdict).toBe("no_red_flags");
    // It decided the verdict, so it is a top reason.
    expect(r.reasons.map((x) => x.text)).toContain(
      "“Backend Engineer” is listed on jobs.lever.co, Tinyco's own job listings.",
    );
  });

  it("is not enough without the job listing", () => {
    expect(ok(tinyco({ job: null })).verdict).toBe("not_enough");
    expect(ok(tinyco({ reads: [read("https://tinyco.example/", "home", HOME), read("https://jobs.lever.co/tinyco", "careers", "# Tinyco jobs\n\nOffice Manager")] })).verdict).toBe("not_enough");
  });

  it("is not enough when the domain only came from the posting and search didn't confirm it", () => {
    // A job board posting claimed tinyco.example, but the search limited to
    // that domain found nothing naming the company.
    const r = ok(
      tinyco({
        officialHits: [hit("https://tinyco.example/", "Welcome", "Bakery software for small shops.")],
        reads: [
          { ...read("https://jobs.lever.co/tinyco/123", "job", BOARD) },
          read("https://jobs.lever.co/tinyco", "careers", BOARD),
        ],
        job: { title: "Backend Engineer", postingUrl: "https://jobs.lever.co/tinyco/123", site: "Lever", posted: null },
      }),
    );
    expect(r.verdict).toBe("not_enough");
  });

  it("is not enough on a website the search doesn't confirm", () => {
    const r = ok(tinyco({ website: "tinyco.example", officialHits: [] }));
    expect(r.officialDomain).toBe("tinyco.example");
    expect(r.verdict).toBe("not_enough");
  });

  it("counts on a typed website the search confirms", () => {
    expect(ok(tinyco({ website: "tinyco.example", officialHits: [...tinyco().officialHits, LINKEDIN] })).verdict).toBe(
      "no_red_flags",
    );
  });
});

// ---- Choosing ----

describe("choosing top reasons", () => {
  const r = (rank: number, direction: Direction, decisive = false) => ({ rank, direction, decisive });

  it("shows every reason that decided the verdict, even past 3", () => {
    const ranked = [r(1, "caution", true), r(1, "caution", true), r(1, "caution", true), r(1, "caution", true), r(4, "reassures")];
    const { shown } = chooseTopReasons(ranked, "strong_warning");
    expect(shown).toHaveLength(5); // the reassuring one disagrees, so it shows too
  });

  it("always shows a reason that disagrees with the verdict", () => {
    const ranked = [r(0, "reassures", true), r(1, "reassures"), r(2, "reassures"), r(3, "neutral"), r(4, "caution")];
    const { shown } = chooseTopReasons(ranked, "no_red_flags");
    // The decisive one and the disagreeing one, then one more to make 3.
    expect(shown.map((x) => x.rank)).toEqual([0, 1, 4]);
  });

  it("lets one strong reason stand alone rather than adding weak ones", () => {
    const ranked = [r(0, "reassures", true), r(5, "reassures"), r(6, "neutral")];
    expect(chooseTopReasons(ranked, "no_red_flags").shown).toEqual([ranked[0]]);
    // With nothing stronger, weak reasons are all there is.
    expect(chooseTopReasons(ranked.slice(1), "not_enough").shown).toHaveLength(2);
  });

  it("counts left-out reasons as strong as a shown one in the same group", () => {
    const ranked = [r(2, "caution"), r(2, "caution"), r(2, "caution"), r(2, "caution"), r(2, "caution"), r(3, "caution")];
    const { shown, more } = chooseTopReasons(ranked, "not_enough");
    expect(shown).toHaveLength(3);
    expect(more).toEqual({ caution: 2 });
  });
});

// ---- Rendering ----

const reason = (direction: Direction, words: string, url: string): Reason => ({
  direction,
  text: words,
  sourceType: "Other",
  sourceUrl: url,
  age: "Date unknown",
});
const MIXED_REASONS = [
  reason("neutral", "A neutral fact.", "https://n.example/"),
  reason("reassures", "A reassuring fact.", "https://r.example/"),
  reason("caution", "A cautionary fact.", "https://c.example/"),
];
const base = EXAMPLE_RESULTS[2].report;
const withReasons = (verdict: Verdict, reasons: Reason[], extra: Partial<CheckReport> = {}): CheckReport => ({
  ...base,
  verdict,
  reasons,
  lookalike: null,
  ...extra,
});

describe("top reasons on the page", () => {
  it.each(["strong_warning", "mixed", "not_enough"] as const)(
    "groups %s reasons as Caution, Reassures, Neutral",
    (verdict) => {
      const html = topReasons(render(withReasons(verdict, MIXED_REASONS)));
      expect(groupHeadings(html)).toEqual(["Caution", "Reassures", "Neutral"]);
      const t = text(html);
      expect(t.indexOf("A cautionary fact.")).toBeLessThan(t.indexOf("A reassuring fact."));
      expect(t.indexOf("A reassuring fact.")).toBeLessThan(t.indexOf("A neutral fact."));
    },
  );

  it("groups no red flags reasons as Reassures, Neutral, Caution, each label once", () => {
    const html = topReasons(
      render(withReasons("no_red_flags", [...MIXED_REASONS, reason("reassures", "Another reassuring fact.", "https://r2.example/")])),
    );
    expect(groupHeadings(html)).toEqual(["Reassures", "Neutral", "Caution"]);
    const t = text(html);
    // Rank order within a group.
    expect(t.indexOf("A reassuring fact.")).toBeLessThan(t.indexOf("Another reassuring fact."));
    expect(t.match(/Reassures/g)).toHaveLength(1);
  });

  it("groups reasons in See all sources the same way", () => {
    const html = allSources(
      render(withReasons("no_red_flags", MIXED_REASONS, { allReasons: MIXED_REASONS })),
    );
    const headings = [...html.matchAll(/<h4[^>]*>([\s\S]*?)<\/h4>/g)].map((m) => text(m[1]));
    expect(headings.slice(0, 3)).toEqual(["Reassures (1)", "Neutral (1)", "Caution (1)"]);
  });

  it("ends a group with +N more reasons pointing at that group in See all sources", () => {
    const cautions = [1, 2, 3, 4, 5].map((n) => reason("caution", `Caution ${n}.`, `https://c${n}.example/`));
    const html = render(
      withReasons("mixed", cautions.slice(0, 3), { allReasons: cautions, moreReasons: { caution: 2 } }),
    );
    const top = topReasons(html);
    expect(text(top)).toMatch(/Caution 3\.[\s\S]*\+2 more reasons$/);
    expect(text(top)).not.toContain("Caution 4.");
    const all = allSources(html);
    expect(all).toMatch(/<h4 id="[^"]+-all-caution" tabindex="-1"[^>]*>Caution \(5\)<\/h4>/);
    expect(text(all)).toContain("Caution 5.");
  });

  it("leaves out +N more on saved results without every reason", () => {
    const html = render(withReasons("mixed", MIXED_REASONS, { allReasons: undefined, moreReasons: { caution: 2 } }));
    expect(text(html)).not.toContain("more reason");
  });

  it("merges the same fact from two of the company's pages into one line with both links", () => {
    const careers = `# Careers at Tinyco\n\n${"We hire bakers of code. ".repeat(6)}\n\nBackend Engineer, Remote\n\n[Open roles](https://jobs.lever.co/tinyco)`;
    const r = ok(
      tinyco({
        reads: [
          read("https://tinyco.example/careers", "careers", careers),
          read("https://tinyco.example/", "home", HOME),
          read("https://jobs.lever.co/tinyco", "careers", BOARD),
        ],
      }),
    );
    const listed = r.reasons.filter((x) => x.text.includes("Backend Engineer"));
    expect(listed.map((x) => x.text)).toEqual(["“Backend Engineer” is listed on 2 of Tinyco's own pages."]);
    expect([listed[0].sourceUrl, ...(listed[0].alsoFrom ?? []).map((s) => s.url)]).toEqual([
      "https://tinyco.example/careers",
      "https://jobs.lever.co/tinyco",
    ]);

    const top = topReasons(render(r));
    expect(text(top)).toContain("“Backend Engineer” is listed on 2 of Tinyco's own pages.");
    expect(top).toContain('href="https://tinyco.example/careers"');
    expect(top).toContain('href="https://jobs.lever.co/tinyco"');
  });

  it("drops a Glassdoor-only third reason when stronger reasons exist", () => {
    const r = ok(
      withSender("recruiter@acme.example", {
        officialHits: [
          hit("https://www.acme.example/", "Acme | Industrial equipment", "Acme makes anvils and rockets."),
          hit("https://careers.acme.example/", "Careers at Acme", "Join Acme. See open roles.", "2026-10-30"),
          hit("https://www.acme.example/recruiting-fraud", "Recruiting fraud notice | Acme", "Scammers impersonate Acme recruiters.", "2026-09-01"),
          hit("https://www.glassdoor.com/reviews/Acme-Reviews-E1.htm", "Acme Reviews | Glassdoor", "Acme employee reviews."),
        ],
      }),
    );
    expect(r.reasons.map((x) => x.text)).toEqual([
      "The sender's domain acme.example is on the recruiting list Acme publishes on acme.example.",
      "acme.example is Acme's official website.",
    ]);
    expect(r.allReasons?.map((x) => x.text)).toContain("Acme has a company listing on glassdoor.com.");

    const html = render(r);
    expect(text(topReasons(html))).not.toContain("glassdoor");
    expect(text(allSources(html))).toContain("Acme has a company listing on glassdoor.com.");
  });
});

describe("links on a merged reason", () => {
  const urls = [1, 2, 3, 4, 5].map((n) => `https://forum${n}.example/post`);
  const merged: Reason = {
    ...reason("caution", "Posts on five forums report a problem involving Acme by name.", urls[0]),
    alsoFrom: urls.slice(1).map((url) => ({ url, sourceType: "Report", age: "Date unknown" })),
  };

  it("shows at most 3 links under Top reasons, then 'and N more', and every link in See all sources", () => {
    const html = render(withReasons("mixed", [merged], { allReasons: [merged] }));
    const top = topReasons(html);
    for (const url of urls.slice(0, 3)) expect(top).toContain(`href="${url}"`);
    for (const url of urls.slice(3)) expect(top).not.toContain(`href="${url}"`);
    expect(text(top)).toContain("and 2 more");
    expect(top).toMatch(/<button[^>]*>and 2 more<\/button>/);

    const all = allSources(html);
    const reasonsPart = all.slice(0, all.indexOf("Every source"));
    for (const url of urls) expect(reasonsPart).toContain(`href="${url}"`);
    expect(text(all)).not.toContain("and 2 more");
  });

  it("shows every link when there are 3 or fewer", () => {
    const three: Reason = { ...merged, alsoFrom: merged.alsoFrom!.slice(0, 2) };
    const top = topReasons(render(withReasons("mixed", [three], { allReasons: [three] })));
    expect(text(top)).not.toContain("more");
  });
});
