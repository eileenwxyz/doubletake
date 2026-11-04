import { describe, expect, it } from "vitest";
import { diffDomains } from "@/lib/domain-diff";

const marked = (segments: { text: string; changed: boolean }[]) =>
  segments.filter((s) => s.changed).map((s) => s.text);

describe("look-alike domain diff", () => {
  it("describes a hyphen in place of a dot", () => {
    const d = diffDomains("jobs-acme.example", "jobs.acme.example");
    expect(d.description).toBe("A hyphen replaces a dot.");
    expect(marked(d.sender)).toEqual(["-"]);
    expect(marked(d.official)).toEqual(["."]);
    expect(d.sender.map((s) => s.text).join("")).toBe("jobs-acme.example");
  });

  it("describes a swapped letter or digit", () => {
    expect(diffDomains("acrne.example", "acme.example").description).toBe(
      "It uses “rn” that looks like an m.",
    );
    expect(diffDomains("exampie.example", "example.example").description).toBe(
      "The letter i replaces the letter l.",
    );
    expect(diffDomains("examp1e.example", "example.example").description).toBe(
      "The number 1 replaces the letter l.",
    );
  });

  it("describes an added hyphen or added words", () => {
    expect(diffDomains("north-wind.example", "northwind.example").description).toBe(
      "An extra hyphen is added.",
    );
    const words = diffDomains("acme-careers.example", "acme.example");
    expect(words.description).toBe("The extra characters “-careers” are added.");
    expect(marked(words.sender)).toEqual(["-careers"]);
    expect(marked(words.official)).toEqual([]);
  });

  it("describes a missing letter", () => {
    const d = diffDomains("northwnd.example", "northwind.example");
    expect(d.description).toBe("The letter i is missing.");
    expect(marked(d.official)).toEqual(["i"]);
  });

  it("describes the company's domain inside someone else's", () => {
    const d = diffDomains("acme.example.jobs-portal.example", "acme.example");
    expect(d.description).toBe("The extra characters “.jobs-portal.example” are added.");
    const both = diffDomains("jobs.acme.example.portal.example", "acme.example");
    expect(both.description).toBe(
      "“jobs.” is added before the company's domain and “.portal.example” after it.",
    );
  });

  it("ignores case", () => {
    expect(diffDomains("ACME.example", "acme.example").description).toBe(
      "The domains look the same.",
    );
  });
});
