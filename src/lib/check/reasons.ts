// Choosing which reasons go under "Top reasons". Pure, so it can be tested
// apart from the rest of the check.

import type { Direction, Verdict } from "./types";

// The usual number of top reasons. Reasons that decided the verdict or
// disagree with it are shown even when that makes more.
export const MAX_REASONS = 3;

// Ranks from here on (directory listings, automated ratings) are weak: they
// are left out of the top reasons when anything stronger exists, and stay in
// "See all sources".
export const WEAK_RANK = 5;

export type RankedReason = {
  // 0 is strongest.
  rank: number;
  direction: Direction;
  // The reason is one the verdict was decided on.
  decisive?: boolean;
};

// A reason disagrees with a verdict when it points the other way: anything
// reassuring under a strong warning, any caution under "no red flags".
// "Mixed" already covers both directions and "not enough" leans neither way.
export function disagrees(verdict: Verdict, direction: Direction): boolean {
  if (verdict === "strong_warning") return direction === "reassures";
  if (verdict === "no_red_flags") return direction === "caution";
  return false;
}

// Picks the top reasons from candidates already in rank order:
// 1. Weak reasons (rank 5-6) are left out when anything stronger exists.
//    This also applies to a weak reason that disagrees with the verdict: a
//    directory listing never headlines a strong warning.
// 2. Every reason that decided the verdict or disagrees with it is shown.
// 3. The rest fill up to 3 in rank order. Nothing weak is added as filler,
//    so one strong reason can stand alone.
// The result keeps rank order. `more` counts, per direction, the reasons
// left out that are as strong as a shown reason in that direction.
export function chooseTopReasons<T extends RankedReason>(
  ranked: readonly T[],
  verdict: Verdict,
): { shown: T[]; more: Partial<Record<Direction, number>> } {
  const hasStrong = ranked.some((r) => r.rank < WEAK_RANK);
  const eligible = hasStrong ? ranked.filter((r) => r.rank < WEAK_RANK) : [...ranked];

  const picked = new Set<T>(eligible.filter((r) => r.decisive || disagrees(verdict, r.direction)));
  for (const r of eligible) {
    if (picked.size >= MAX_REASONS) break;
    picked.add(r);
  }
  const shown = eligible.filter((r) => picked.has(r));

  const more: Partial<Record<Direction, number>> = {};
  for (const r of eligible) {
    if (picked.has(r)) continue;
    if (shown.some((s) => s.direction === r.direction && s.rank === r.rank)) {
      more[r.direction] = (more[r.direction] ?? 0) + 1;
    }
  }
  return { shown, more };
}
