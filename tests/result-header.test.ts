import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import Result from "@/app/result";
import { EXAMPLE_RESULTS } from "@/lib/examples";
import type { CheckReport } from "@/lib/check/types";

const base = EXAMPLE_RESULTS[2].report;

function header(report: CheckReport): string {
  const html = renderToStaticMarkup(
    createElement(Result, { report, isExample: false, onNotThisOne: () => {} }),
  );
  return /<header[^>]*>([\s\S]*?)<\/header>/.exec(html)?.[1] ?? "";
}

const text = (html: string) => html.replace(/<[^>]+>/g, "").replace(/&#x27;/g, "'").replace(/&amp;/g, "&");

describe("result header", () => {
  it("shows where the job was posted, under the company name", () => {
    const html = header({
      ...base,
      job: {
        title: "Product Designer",
        postingUrl: "https://jobs.board.example/jobs/1",
        site: "jobs.board.example",
        posted: null,
        postingOfficial: false,
        unnamedClient: false,
        careers: "listed",
        careersUrl: null,
      },
    });
    expect(text(html)).toContain("Posted on jobs.board.example");
    expect(html.indexOf("Posted on")).toBeGreaterThan(html.indexOf(base.companyName));
    expect(html.indexOf("Posted on")).toBeLessThan(html.indexOf("Checked"));
  });

  it("leaves it out without a job site", () => {
    expect(text(header(base))).not.toContain("Posted on");
    expect(text(header({ ...base, job: null }))).not.toContain("Posted on");
  });
});

function page(report: CheckReport): string {
  return renderToStaticMarkup(createElement(Result, { report, isExample: false, onNotThisOne: () => {} }));
}

describe("result header for a staffing agency and its client", () => {
  const report: CheckReport = {
    ...base,
    companyName: "Brightpath Staffing",
    officialDomain: "brightpathstaffing.example",
    recruitingFor: {
      agency: "Brightpath Staffing",
      agencyDomain: "brightpathstaffing.example",
      client: "Globex",
      clientDomain: "globex.example",
    },
  };

  it("names both companies and both domains", () => {
    const html = header(report);
    expect(/<h1[^>]*>([\s\S]*?)<\/h1>/.exec(html)?.[1]).toBe("Brightpath Staffing, recruiting for Globex");
    expect(text(html)).toContain("brightpathstaffing.example · globex.example");
    expect(page(report)).toContain('aria-label="Brightpath Staffing, recruiting for Globex"');
  });

  it("leaves out a client domain that wasn't found", () => {
    const html = header({ ...report, recruitingFor: { ...report.recruitingFor!, clientDomain: null } });
    expect(text(html)).toContain("brightpathstaffing.example");
    expect(text(html)).not.toContain("·  globex");
    expect(text(html)).not.toContain("globex.example");
  });

  it("shows the company name alone otherwise", () => {
    expect(/<h1[^>]*>([\s\S]*?)<\/h1>/.exec(header(base))?.[1]).toBe(base.companyName);
  });
});

// The next step block, between the verdict and the rest.
function nextStep(report: CheckReport): string {
  const html = page(report);
  return /<(a|div) class="next-step[^"]*"[\s\S]*?<\/\1>/.exec(html)?.[0] ?? "";
}

describe("next step", () => {
  it("asks for an email from the company's domain, without a link", () => {
    const html = nextStep({ ...base, nextStep: { url: null, kind: "ask_email", domain: "northwind.example" } });
    expect(html.startsWith("<div")).toBe(true);
    expect(html).not.toContain("href");
    expect(text(html)).toContain("Ask them to email you from their @northwind.example address.");
  });

  it("says not to reply to a look-alike and links the official site", () => {
    const html = nextStep({
      ...base,
      nextStep: { url: "https://www.northwind.example/", kind: "lookalike", domain: "northwind.example" },
    });
    expect(html).toContain('href="https://www.northwind.example/"');
    expect(text(html)).toContain(`Don't reply. Contact ${base.companyName} through northwind.example instead.`);
  });

  it("names the staffing agency a look-alike imitates, not the company checked", () => {
    const html = nextStep({
      ...base,
      nextStep: { url: "https://brightpath.example/", kind: "lookalike", domain: "brightpath.example", name: "Brightpath Staffing" },
    });
    expect(text(html)).toContain("Don't reply. Contact Brightpath Staffing through brightpath.example instead.");
    expect(text(html)).not.toContain(base.companyName);
  });

  it("asks which company an agency's job is with", () => {
    const html = nextStep({ ...base, nextStep: { url: null, kind: "ask_client" } });
    expect(html).not.toContain("href");
    expect(text(html)).toContain("Ask the recruiter which company this job is with, then check that company.");
  });

  it("still links the company's own page", () => {
    const html = nextStep({ ...base, nextStep: { url: "https://www.northwind.example/careers", kind: "careers" } });
    expect(html).toContain('href="https://www.northwind.example/careers"');
    expect(text(html)).toContain(`Find the job on ${base.companyName}'s careers page`);
  });
});

describe("labelled sources", () => {
  it("shows a Glassdoor review as 'Glassdoor company page', not its address", () => {
    const url = "https://www.glassdoor.com/Reviews/Employee-Review-Acme-Terrible-managers-avoid-RVW98765.htm";
    const html = page({
      ...base,
      sources: [{ url, type: "Directory", publishDate: null, label: "Glassdoor company page" }],
    });
    expect(html).toContain(`href="${url}"`);
    expect(text(html)).toContain("Glassdoor company page");
    expect(text(html)).not.toContain("Terrible-managers");
  });
});
