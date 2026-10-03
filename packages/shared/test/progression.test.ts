import { describe, expect, it } from "vitest";
import {
  PRODUCTION_RULES as R,
  companionExp,
  expForLevel,
  expProgress,
  expToNext,
  killExp,
  levelForExp,
  planAllocation,
  unspentPoints,
} from "../src";

const base = { STR: 10, VIT: 10, INT: 10, DEX: 10, AGI: 10, SPI: 10 };

describe("EXP curve (prototype, P03)", () => {
  it("grows with level and is reversible from cumulative EXP", () => {
    expect(expToNext(R, 1)).toBe(30);
    expect(expToNext(R, 2)).toBe(Math.round(30 * 2 ** 1.8));
    for (const L of [1, 2, 5, 37, 120, 199]) {
      expect(levelForExp(R, expForLevel(R, L), 200)).toBe(L);
      expect(levelForExp(R, expForLevel(R, L) - 1, 200)).toBe(Math.max(1, L - 1));
    }
  });

  it("caps at the max level and shows progress inside a level", () => {
    expect(levelForExp(R, 10 ** 12, 200)).toBe(200);
    expect(expProgress(R, 10 ** 12, 200)).toEqual({ level: 200, into: 0, need: null });
    expect(expProgress(R, 40, 200)).toEqual({ level: 2, into: 10, need: expToNext(R, 2) });
  });

  it("a kill gives 10 EXP per wild level times the rank multiplier; companions get the same", () => {
    expect(killExp(R, 2, "NORMAL")).toBe(20);
    expect(killExp(R, 6, null)).toBe(60);
    expect(killExp(R, 6, "ELITE")).toBe(180);
    expect(killExp(R, 6, "BOSS")).toBe(600);
    expect(companionExp(R, 60)).toBe(60);
  });
});

describe("stat points (P03)", () => {
  it("3 points per level, never down, cost bands apply", () => {
    expect(unspentPoints(R, 1, base)).toBe(0);
    expect(unspentPoints(R, 3, base)).toBe(6);
    expect(planAllocation(R, 3, base, { ...base, STR: 14, VIT: 12 })).toEqual({ ok: true, spent: 6, unspent: 0 });
    expect(planAllocation(R, 3, base, { ...base, STR: 17 })).toMatchObject({ ok: false, code: "OVER_BUDGET" });
    expect(planAllocation(R, 3, { ...base, STR: 12 }, { ...base, VIT: 12 })).toMatchObject({ ok: false, code: "STAT_DECREASE" });
    // 61+ costs 2 per point.
    expect(unspentPoints(R, 200, { ...base, STR: 62 })).toBe(597 - 50 - 4);
  });
});
