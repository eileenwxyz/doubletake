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

const text = (html: string) => html.replace(/<[^>]+>/g, "");

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
