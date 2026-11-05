// The next step matches the rule the verdict was decided on. Every company
// here is fictional and every company domain uses the reserved .example
// suffix.
import { describe, expect, it } from "vitest";
import { buildReport } from "@/lib/check/report";
import type { CheckReport } from "@/lib/check/types";
import { acmeInput, withSender } from "./fixtures";

const ok = (input: Parameters<typeof buildReport>[0]) => buildReport(input) as CheckReport;

describe("next step", () => {
  it("asks for an email from the company's domain when the recruiter used a free email service", () => {
    const r = ok(withSender("acme.hiring@gmail.com"));
    expect(r.verdict).toBe("strong_warning");
    expect(r.nextStep).toEqual({ url: null, kind: "ask_email", domain: "acme.example" });
  });

  it("says not to reply and to use the official domain for a look-alike", () => {
    const r = ok(withSender("recruiter@acme-careers.example"));
    expect(r.lookalike).not.toBeNull();
    expect(r.nextStep).toEqual({ url: "https://www.acme.example/", kind: "lookalike", domain: "acme.example" });
  });

  it("asks which company the job is with when an agency doesn't name its client", () => {
    const r = ok(
      acmeInput({
        job: { title: null, postingUrl: null, site: null, posted: null, unnamedClient: true },
      }),
    );
    expect(r.nextStep).toEqual({ url: null, kind: "ask_client" });
  });

  it("keeps the fraud page otherwise", () => {
    const r = ok(withSender("recruiter@acme.example"));
    expect(r.nextStep).toEqual({ url: "https://www.acme.example/recruiting-fraud", kind: "fraud" });
    expect(ok(acmeInput()).nextStep?.kind).toBe("fraud");
  });
});
