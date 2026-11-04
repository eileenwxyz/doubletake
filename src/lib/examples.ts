// The four example results shown on the empty page, one per verdict. They
// are saved API responses for fictional companies on .example domains.

import type { CheckReport, Verdict } from "@/lib/check/types";
import strongWarning from "../../data/fixtures/strong-warning.json";
import mixed from "../../data/fixtures/mixed.json";
import noRedFlags from "../../data/fixtures/no-red-flags.json";
import notEnough from "../../data/fixtures/not-enough.json";

export const EXAMPLE_RESULTS: ReadonlyArray<{ id: Verdict; report: CheckReport }> = [
  { id: "strong_warning", report: strongWarning as CheckReport },
  { id: "mixed", report: mixed as CheckReport },
  { id: "no_red_flags", report: noRedFlags as CheckReport },
  { id: "not_enough", report: notEnough as CheckReport },
];
