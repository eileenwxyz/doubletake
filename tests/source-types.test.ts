import { describe, expect, it } from "vitest";
import { buildReport } from "@/lib/check/report";
import { classifySource, type SourceContext } from "@/lib/check/sources";
import type { CheckReport } from "@/lib/check/types";
import { acmeInput, hit } from "./fixtures";

const ctx: SourceContext = {
  company: "Acme",
  officialDomain: "acme.example",
  linkedBoards: new Set(["jobs.lever.co/acme"]),
  linkedDomains: new Set(["lever.co", "foundry-ventures.example"]),
};

const type = (url: string, title: string | null, text: string) =>
  classifySource(url, title, text, ctx);

describe("source types, first match wins", () => {
  it("Official: company domain and its linked job board", () => {
    expect(type("https://careers.acme.example/jobs", "Careers", "")).toBe("Official");
    expect(type("https://jobs.lever.co/acme/42", "Engineer", "")).toBe("Official");
  });

  it("Authority: .gov, regulators and linked investor portfolio pages that name the company", () => {
    expect(type("https://consumer.ftc.gov/alerts/acme", "Alert", "Scammers pretend to be Acme recruiters.")).toBe("Authority");
    expect(type("https://www.fca.org.uk/news/warning", "Warning", "Acme is not authorised.")).toBe("Authority");
    expect(type("https://foundry-ventures.example/portfolio", "Portfolio", "Our companies: Acme, Globex Robotics.")).toBe("Authority");
    // A portfolio page the company doesn't link to is not an authority.
    expect(type("https://random-fund.example/portfolio", "Portfolio", "Acme")).toBe("Other");
    // A host that only contains "gov" is not government.
    expect(type("https://gov.scam.example/acme", "Acme warning", "Acme")).toBe("Other");
  });

  it("Automated rating, Directory", () => {
    expect(type("https://www.scamadviser.com/check-website/acme.example", "acme.example", "Trust score")).toBe("Automated rating");
    expect(type("https://www.linkedin.com/company/acme-example", "Acme", "Acme")).toBe("Directory");
    expect(type("https://www.indeed.com/cmp/Acme", "Acme", "Acme")).toBe("Directory");
    expect(type("https://www.bbb.org/us/acme", "Acme", "Acme")).toBe("Directory");
    expect(type("https://tracxn.com/d/companies/acme", "Acme", "Acme")).toBe("Directory");
    expect(type("https://www.crunchbase.com/organization/acme", "Acme", "Acme")).toBe("Directory");
    // Only the company section of LinkedIn is a directory.
    expect(type("https://www.linkedin.com/pulse/job-scams", "Job scams", "How to spot scams")).toBe("General advice");
  });

  it("Report: forum posts that name the exact company", () => {
    expect(type("https://www.reddit.com/r/scams/comments/1/acme_offer", "Fake Acme recruiter asked me to buy equipment", "They said Acme would refund me.")).toBe("Report");
    expect(type("https://www.teamblind.com/post/abc", "Recruiter scam using acme.example", "Got an offer...")).toBe("Report");
    // Doesn't name the company: general advice.
    expect(type("https://www.reddit.com/r/scams/comments/2/tips", "How to spot fake recruiters", "Never pay for equipment.")).toBe("General advice");
  });

  it("an 'Is this legit?' question post is not a report", () => {
    expect(type("https://www.reddit.com/r/jobs/comments/3/acme", "Is Acme legit?", "Got an email from Acme, is this real?")).toBe("Other");
    expect(type("https://www.reddit.com/r/jobs/comments/4/acme", "Anyone heard of Acme recruiting", "Thoughts?")).toBe("Other");
  });

  it("General advice and Other", () => {
    expect(type("https://news.example/job-scams", "Five job scams", "Fake recruiters are common.")).toBe("General advice");
    expect(type("https://news.example/acme-expands", "Acme opens a new office", "Acme is hiring.")).toBe("Other");
  });
});

describe("a warning counts only if it names the exact company", () => {
  it("ignores a regulator warning about a similarly named company", () => {
    const warning = hit(
      "https://www.fca.org.uk/news/warnings/acme-talent-partners",
      "Acme Talent Partners Ltd: unauthorised firm",
      "Warning: Acme Talent Partners Ltd is a clone firm running a recruitment scam.",
    );
    expect(type(warning.url, warning.title, warning.text)).toBe("General advice");

    const r = buildReport(acmeInput({ warningHits: [warning] })) as CheckReport;
    expect(r.verdict).toBe("no_red_flags");
    expect(r.reasons.every((reason) => reason.direction !== "caution")).toBe(true);
  });

  it("counts a regulator warning that names the exact company", () => {
    const warning = hit(
      "https://www.fca.org.uk/news/warnings/acme",
      "Acme: unauthorised firm",
      "Warning: Acme (acme.example) is running a recruitment scam.",
    );
    const r = buildReport(
      acmeInput({
        warningHits: [warning],
        reads: acmeInput().reads.filter((p) => p.role !== "fraud"),
      }),
    ) as CheckReport;
    expect(r.verdict).toBe("strong_warning");
    expect(r.reasons[0]).toMatchObject({
      direction: "caution",
      text: "A page on fca.org.uk warns about Acme by name.",
      sourceType: "Authority",
      age: "Date unknown",
    });
  });

  it("does not count a question post as a warning", () => {
    const question = hit(
      "https://www.reddit.com/r/jobs/comments/5/acme",
      "Is this Acme recruiter legit? Possible scam?",
      "Got a message from an Acme recruiter. Is this a scam?",
    );
    const r = buildReport(
      acmeInput({
        warningHits: [question],
        reads: acmeInput().reads.filter((p) => p.role !== "fraud"),
      }),
    ) as CheckReport;
    expect(r.verdict).toBe("no_red_flags");
    expect(r.sources.find((s) => s.url === question.url)?.type).toBe("Other");
  });

  it("treats a named report as mixed for a company-only check", () => {
    const post = hit(
      "https://www.reddit.com/r/scams/comments/6/acme",
      "Acme sent me a fake check",
      "I was scammed by someone at Acme who asked me to buy equipment.",
    );
    const r = buildReport(
      acmeInput({
        warningHits: [post],
        reads: acmeInput().reads.filter((p) => p.role !== "fraud"),
      }),
    ) as CheckReport;
    expect(r.verdict).toBe("mixed");
    expect(r.subtitle).toBe("Company-only check: no recruiter email was given.");
  });
});

describe("directory listings", () => {
  it("only reassure when they name the exact company", () => {
    const r = buildReport(
      acmeInput({
        officialHits: [
          ...acmeInput().officialHits.filter((h) => !h.url.includes("linkedin") && !h.url.includes("crunchbase")),
          hit("https://www.linkedin.com/company/acme-talent-partners", "Acme Talent Partners | LinkedIn", "Acme Talent Partners Ltd"),
        ],
      }),
    ) as CheckReport;
    expect(r.reasons.some((x) => x.sourceType === "Directory")).toBe(false);
  });
});

describe("automated rating sites and 'Other' pages", () => {
  it("types the added rating sites as Automated rating", () => {
    for (const host of ["www.thesentari.com", "hastrust.com", "gridinsoft.com"]) {
      expect(type(`https://${host}/check/acme.example`, "Is acme.example a scam?", "Acme trust score")).toBe(
        "Automated rating",
      );
    }
  });

  it("a scam-checker guide that names the company doesn't make a company-only check mixed", () => {
    const guide = hit(
      "https://scam-guides.example/acme-recruiter-scam-checker",
      "How to check an Acme recruiter email for scams",
      "Use this checker to spot fake Acme recruiters before you reply.",
    );
    expect(type(guide.url, guide.title, guide.text)).toBe("Other");

    const r = buildReport(
      acmeInput({
        warningHits: [guide],
        reads: acmeInput().reads.filter((p) => p.role !== "fraud"),
      }),
    ) as CheckReport;
    expect(r.verdict).toBe("no_red_flags");
    expect(r.subtitle).toBe("Company-only check: no recruiter email was given.");
    // It can still appear as a Caution reason.
    expect(r.reasons).toContainEqual(
      expect.objectContaining({ direction: "caution", sourceType: "Other", sourceUrl: guide.url }),
    );
  });
});
