import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  PRODUCTION_RULES as R,
  companionExp,
  expCap,
  expForLevel,
  expProgress,
  expToNext,
  killExp,
  levelForExp,
  maxLevel,
  planAllocation,
  referenceNormalExp,
  unspentPoints,
} from "../src";

const base = { STR: 10, VIT: 10, INT: 10, DEX: 10, AGI: 10, SPI: 10 };
const nut = JSON.parse(readFileSync(new URL("../../../docs/design/PLAYER_EXP_001_200.json", import.meta.url), "utf8")) as {
  max_level: number;
  levels: { level: number; xp_to_next: number | null; cumulative_xp_to_reach_level: number; reference_normal_xp_per_kill: number }[];
};

describe("player EXP table (Nut's exp-proposal-1.0)", () => {
  it("matches every row of the supplied table", () => {
    expect(maxLevel(R, "player")).toBe(nut.max_level);
    expect(nut.levels).toHaveLength(200);
    for (const row of nut.levels) {
      expect(expToNext(R, "player", row.level), `Lv${row.level} to next`).toBe(row.xp_to_next);
      expect(expForLevel(R, "player", row.level), `Lv${row.level} cumulative`).toBe(row.cumulative_xp_to_reach_level);
      expect(referenceNormalExp(R, row.level), `M=${row.level}`).toBe(row.reference_normal_xp_per_kill);
    }
    expect(expCap(R, "player")).toBe(5_465_771_910);
  });

  it("levels come from cumulative EXP; several levels at once keep the remainder", () => {
    expect(levelForExp(R, "player", 0)).toBe(1);
    expect(levelForExp(R, "player", 59)).toBe(1);
    expect(levelForExp(R, "player", 60)).toBe(2);
    expect(expProgress(R, "player", 200)).toEqual({ level: 3, into: 30, need: 190 });
    for (const L of [2, 50, 120, 199, 200]) {
      expect(levelForExp(R, "player", expForLevel(R, "player", L))).toBe(L);
      expect(levelForExp(R, "player", expForLevel(R, "player", L) - 1)).toBe(L - 1);
    }
  });

  it("stops at Lv200 with no next level", () => {
    expect(levelForExp(R, "player", 10 ** 12)).toBe(200);
    expect(expToNext(R, "player", 200)).toBeNull();
    expect(expProgress(R, "player", expCap(R, "player"))).toEqual({ level: 200, into: 0, need: null });
  });
});

describe("companion EXP (separate prototype curve)", () => {
  it("does not reuse the player table", () => {
    expect(expToNext(R, "companion", 1)).toBe(30);
    expect(expToNext(R, "companion", 2)).toBe(Math.round(30 * 2 ** 1.8));
    expect(levelForExp(R, "companion", expForLevel(R, "companion", 37))).toBe(37);
    expect(expToNext(R, "companion", maxLevel(R, "companion"))).toBeNull();
  });
});

describe("kill EXP", () => {
  it("is the reference EXP of the wild level, the same for every rank; companions get the same", () => {
    expect(killExp(R, 1)).toBe(28);
    expect(killExp(R, 2)).toBe(40);
    expect(killExp(R, 6)).toBe(128);
    expect(companionExp(R, 128)).toBe(128);
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
