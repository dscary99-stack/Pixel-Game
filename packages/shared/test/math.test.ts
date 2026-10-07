import { describe, expect, it } from "vitest";
import {
  PRODUCTION_RULES,
  RULES,
  armorMultiplier,
  computeDamage,
  computeHeal,
  critChanceBp,
  deriveStats,
  elementMultiplier,
  hitChanceBp,
  roundHalfUp,
  statRaiseCost,
  validateAllocation,
  withFixtureOverrides,
} from "../src/index";

const rules = PRODUCTION_RULES;

describe("decision register in config", () => {
  it("keeps CONFIRMED values from chapter 00", () => {
    const c = RULES.confirmed;
    expect(c.playerMaxLevel).toMatchObject({ value: 200, decision: "C12", status: "CONFIRMED" });
    expect(c.maxCompanions.value).toBe(5);
    expect(c.maxEnemyUnits.value).toBe(10);
    expect(c.captureWildLevelGap.value).toBe(5);
    expect(c.capturedInitialLevel.value).toBe(1);
    expect(c.autoCapture.value).toBe(false);
    expect(c.energySystem.value).toBe(false);
    expect(c.offlineFarming.value).toBe(false);
    expect(c.globalFarmRewardCap.value).toBe(false);
    expect(c.premiumPower.value).toBe(false);
    expect(c.maxSigilsPerWeapon.value).toBe(4);
    expect(c.maxSigilsPerNonWeapon.value).toBe(1);
    expect(c.allowDuplicateSigils.value).toBe(true);
  });

  it("marks every PROVISIONAL value with a P decision id", () => {
    for (const [k, r] of Object.entries(RULES.provisional)) {
      expect(r.status, k).toBe("PROVISIONAL");
      expect(r.decision, k).toMatch(/^P\d\d$/);
    }
  });

  it("leaves every OPEN rule null in production config", () => {
    for (const [k, r] of Object.entries(RULES.unresolved)) {
      expect(r.status, k).toBe("OPEN");
      expect(r.value, k).toBeNull();
    }
    expect(PRODUCTION_RULES.fixtureOverrides).toEqual([]);
  });

  it("has no OPEN rule left (Nut 2026-10-07), and a fixture can only name an OPEN rule", () => {
    expect(Object.keys(RULES.unresolved)).toEqual([]);
    expect(() => withFixtureOverrides(rules, { weeklyExpiredClaim: true as never })).toThrow(/Unknown unresolved rule/);
    expect(withFixtureOverrides(rules, {}).fixtureOverrides).toEqual([]);
  });
});

describe("stats (P03)", () => {
  it("prices stat points by band: 10->60=50, ->100=130, ->150=280", () => {
    expect(statRaiseCost(rules, 10, 60)).toBe(50);
    expect(statRaiseCost(rules, 10, 100)).toBe(130);
    expect(statRaiseCost(rules, 10, 150)).toBe(280);
    expect(() => statRaiseCost(rules, 10, 151)).toThrow();
  });

  it("accepts the chapter 03 Lv200 example that spends exactly 597 points", () => {
    const r = validateAllocation(rules, 200, { STR: 150, VIT: 150, DEX: 47, INT: 10, AGI: 10, SPI: 10 });
    expect(r).toEqual({ ok: true, spent: 597 });
    expect(validateAllocation(rules, 200, { STR: 150, VIT: 150, DEX: 48, INT: 10, AGI: 10, SPI: 10 }).ok).toBe(false);
  });

  it("accepts the Lv20 example (117 = 60 + 57 points)", () => {
    const r = validateAllocation(rules, 20, { STR: 35, VIT: 25, INT: 10, DEX: 17, AGI: 20, SPI: 10 });
    expect(r).toEqual({ ok: true, spent: 57 });
  });

  it("derives Lv200 VIT150 HP = 10120 with no gear", () => {
    const s = deriveStats(200, { STR: 150, VIT: 150, DEX: 47, INT: 10, AGI: 10, SPI: 10 });
    expect(s.maxHp).toBe(10120);
  });
});

describe("damage (P04, chapter 03 §5)", () => {
  it("reproduces the armor table 50/100/200/400/800 -> 20/33.33/50/66.67/80%", () => {
    const pct = [50, 100, 200, 400, 800].map((d) => Math.round((1 - armorMultiplier(rules, d)) * 10000) / 100);
    expect(pct).toEqual([20, 33.33, 50, 66.67, 80]);
  });

  it("reproduces the Lv20 worked example: 312 -> 173.33 -> 217 -> 325 -> 195", () => {
    const stats = deriveStats(20, { STR: 35, VIT: 25, INT: 10, DEX: 17, AGI: 20, SPI: 10 }, { PATK: 70 });
    expect(stats.patk).toBe(195);
    const base = { attackPower: stats.patk, skillCoefficient: 1.6, skillFlat: 0, defense: 160, critDamageBonus: 0 } as const;
    const plain = computeDamage(rules, { ...base, attackElement: "NEUTRAL", defenderElement: "NEUTRAL", crit: false, guarding: false });
    expect(plain.base).toBeCloseTo(312, 9);
    expect(plain.unrounded).toBeCloseTo(173.33, 2);
    const strong = computeDamage(rules, { ...base, attackElement: "FIRE", defenderElement: "WIND", crit: false, guarding: false });
    expect(strong.final).toBe(217);
    const crit = computeDamage(rules, { ...base, attackElement: "FIRE", defenderElement: "WIND", crit: true, guarding: false });
    expect(crit.final).toBe(325);
    const guarded = computeDamage(rules, { ...base, attackElement: "FIRE", defenderElement: "WIND", crit: true, guarding: true });
    expect(guarded.final).toBe(195);
  });

  it("rounds once, half-up", () => {
    expect(roundHalfUp(172.5)).toBe(173);
    expect(roundHalfUp(172.49)).toBe(172);
    expect(roundHalfUp(324.99999999999994)).toBe(325);
  });

  it("caps percent armor reduction at 50% and penetration at 40%", () => {
    const d = computeDamage(rules, {
      attackPower: 100,
      skillCoefficient: 1,
      skillFlat: 0,
      defense: 200,
      defenseModifiers: { armorReductionPct: 90, penetrationPct: 90 },
      attackElement: "NEUTRAL",
      defenderElement: "NEUTRAL",
      crit: false,
      critDamageBonus: 0,
      guarding: false,
    });
    // 200 * 0.5 * 0.6 = 60 effective defense -> 200/260
    expect(d.armorMultiplier).toBeCloseTo(200 / 260, 12);
  });

  it("applies the element chart: cycle, Light/Shadow both ways, neutral 1.0", () => {
    expect(elementMultiplier(rules, "FIRE", "WIND")).toBe(1.25);
    expect(elementMultiplier(rules, "FIRE", "WATER")).toBe(0.8);
    expect(elementMultiplier(rules, "WIND", "EARTH")).toBe(1.25);
    expect(elementMultiplier(rules, "EARTH", "WATER")).toBe(1.25);
    expect(elementMultiplier(rules, "WATER", "FIRE")).toBe(1.25);
    expect(elementMultiplier(rules, "LIGHT", "SHADOW")).toBe(1.25);
    expect(elementMultiplier(rules, "SHADOW", "LIGHT")).toBe(1.25);
    expect(elementMultiplier(rules, "FIRE", "FIRE")).toBe(1);
    expect(elementMultiplier(rules, "NEUTRAL", "FIRE")).toBe(1);
    expect(elementMultiplier(rules, "LIGHT", "FIRE")).toBe(1);
  });

  it("clamps hit to 20–98% and crit to 0–60%, in basis points", () => {
    expect(hitChanceBp(rules, 200, 0)).toBe(9800);
    expect(hitChanceBp(rules, 10, 50)).toBe(2000);
    expect(hitChanceBp(rules, 93.4, 3)).toBe(9040);
    expect(critChanceBp(rules, 99)).toBe(6000);
    expect(critChanceBp(rules, 6.7)).toBe(670);
  });

  it("heals with Support and no crit", () => {
    expect(computeHeal(80, 1.2, 20)).toBe(116);
  });
});
