import { describe, expect, it } from "vitest";
import { PRODUCTION_RULES as rules, transferLevelCheck } from "../src/index";

describe("companion transfer level gap (O01, Nut 2026-10-07: +30)", () => {
  it("is CONFIRMED at 30 and no longer OPEN", () => {
    expect(rules.confirmed.tradeLevelGap).toMatchObject({ value: 30, status: "CONFIRMED", decision: "O01" });
    expect(Object.keys(rules.unresolved)).not.toContain("tradeLevelGap");
  });

  it("a Lv20 player can receive up to Lv50, not Lv51, and is told the level needed", () => {
    expect(transferLevelCheck(rules, 20, { currentLevel: 50 }, { fixedWildLevel: 10 })).toEqual({ ok: true });
    expect(transferLevelCheck(rules, 20, { currentLevel: 51 }, { fixedWildLevel: 10 })).toMatchObject({ ok: false, code: "LEVEL_INELIGIBLE", minRecipientLevel: 21 });
  });

  it("the species' wild level counts too, so a Rebirth Lv1 of a high species is still checked", () => {
    expect(transferLevelCheck(rules, 20, { currentLevel: 1 }, { fixedWildLevel: 80 })).toMatchObject({ ok: false, minRecipientLevel: 50 });
    expect(transferLevelCheck(rules, 50, { currentLevel: 1 }, { fixedWildLevel: 80 })).toEqual({ ok: true });
  });
});
