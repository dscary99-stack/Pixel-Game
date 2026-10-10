/**
 * Refining rules (REFINEMENT_DESIGN v2.1): fee table by cost level, stones, chances, tiers, wards,
 * and refined stats in fights.
 */
import { describe, expect, it } from "vitest";
import {
  EXAMPLE_WARD_RECIPES,
  PRODUCTION_RULES as R,
  exampleContentMaps,
  parseRefineWard,
  refineFee,
  refineIsRisky,
  refineLevelScaled,
  refineQuote,
  refineSuccessBp,
  refineSucceeds,
  refineTier,
  refineWardCraftCoins,
  refineWardItemId,
  refinedBaseStats,
  wornBonuses,
  type EquipmentDefinition,
} from "../src";

const { equipment } = exampleContentMaps();
const targets = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

describe("refine fees and chances", () => {
  it("match the v2.1 table at Lv50, Lv120 and Lv200", () => {
    expect(targets.map((t) => refineFee(R, t, 50))).toEqual([130, 250, 500, 880, 1500, 2500, 4380, 6880, 10630, 16250]);
    expect(targets.map((t) => refineFee(R, t, 120))).toEqual([460, 930, 1860, 3250, 5580, 9300, 16270, 25560, 39500, 60420]);
    expect(targets.map((t) => refineFee(R, t, 200))).toEqual([1000, 2000, 4000, 7000, 12000, 20000, 35000, 55000, 85000, 130000]);
  });

  it("agree with the float formula at every level away from an exact half, and never drop under the 3% floor", () => {
    for (let level = 1; level <= 200; level++) {
      for (const base of R.provisional.refineFeeLv200.value) {
        const v = base * Math.max(0.03, Math.pow(level / 200, 1.5));
        const exact = refineLevelScaled(R, base, level);
        if (Math.abs((v / 10) % 1 - 0.5) > 1e-6) expect(exact).toBe(Math.round(v / 10) * 10);
        expect(exact).toBeGreaterThanOrEqual(Math.round((base * 0.03) / 10) * 10);
      }
    }
  });

  it("chances are 95/90/85/80/75 then the confirmed 60/50/40/20/10, and only +6 and up can break", () => {
    expect(targets.map((t) => refineSuccessBp(R, t))).toEqual([9500, 9000, 8500, 8000, 7500, 6000, 5000, 4000, 2000, 1000]);
    expect(targets.filter((t) => refineIsRisky(R, t))).toEqual([6, 7, 8, 9, 10]);
    expect(refineSucceeds(999, 1000)).toBe(true);
    expect(refineSucceeds(1000, 1000)).toBe(false);
    expect(R.provisional.refineStones.value).toEqual([1, 1, 2, 2, 3, 4, 5, 6, 8, 10]);
  });

  it("tiers are 1–49, 50–99, 100–149, 150–200", () => {
    expect([1, 49, 50, 99, 100, 149, 150, 200].map((l) => refineTier(R, l))).toEqual([1, 1, 2, 2, 3, 3, 4, 4]);
  });
});

describe("wards", () => {
  it("cost the Lv200 table in the top tier and the tier's top level below it", () => {
    expect([6, 7, 8, 9, 10].map((t) => refineWardCraftCoins(R, t, 4))).toEqual([50_000, 100_000, 200_000, 400_000, 800_000]);
    expect(refineWardCraftCoins(R, 6, 1)).toBe(refineLevelScaled(R, 50_000, 49));
    expect(refineWardCraftCoins(R, 10, 3)).toBe(refineLevelScaled(R, 800_000, 149));
  });

  it("have one recipe per tier and target, always with coins and monster materials", () => {
    expect(EXAMPLE_WARD_RECIPES).toHaveLength(20);
    for (const r of EXAMPLE_WARD_RECIPES) {
      expect(r.coins).toBeGreaterThan(0);
      expect(r.inputs.length).toBeGreaterThanOrEqual(2);
      expect(r.output).toMatchObject({ kind: "item", quantity: 1 });
    }
    const top = EXAMPLE_WARD_RECIPES.find((r) => r.id === "recipe:refine_ward_t4_p10")!;
    expect(top.inputs.map((i) => i.quantity)).toEqual([160, 32, 8]);
    expect(parseRefineWard(refineWardItemId(3, 8))).toEqual({ tier: 3, target: 8 });
    expect(parseRefineWard("item:crab_shell")).toBeNull();
  });

  it("a quote names the one ward that fits, and none below +6", () => {
    const def = equipment.get("equip:wooden_sword")!;
    expect(refineQuote(R, def, 4)).toMatchObject({ ok: true, quote: { target: 5, wardItemId: null, risky: false } });
    expect(refineQuote(R, def, 7)).toMatchObject({ ok: true, quote: { target: 8, wardItemId: "item:refine_ward_t1_p8", risky: true } });
    const plain: EquipmentDefinition = { ...def, refinableStats: [] };
    expect(refineQuote(R, plain, 0)).toMatchObject({ ok: false, reason: "NOT_REFINABLE" });
  });
});

describe("refined stats", () => {
  it("+3% per level of refinable base stats only, half up, +30% at +10", () => {
    const staff = equipment.get("equip:apprentice_staff")!; // MATK 12, MP 10 (MP not refinable)
    expect(refinedBaseStats(staff, 0)).toEqual({ MATK: 12, MP: 10 });
    expect(refinedBaseStats(staff, 2)).toEqual({ MATK: 13, MP: 10 }); // 12 × 6% = 0.72 → 1
    expect(refinedBaseStats(staff, 10)).toEqual({ MATK: 16, MP: 10 }); // 12 × 30% = 3.6 → 4
    const tunic = equipment.get("equip:cloth_tunic")!; // PDEF 4, HP 30
    expect(refinedBaseStats(tunic, 10)).toEqual({ PDEF: 5, HP: 39 });
  });

  it("worn refined pieces fight with the refined numbers; affixes are not raised", () => {
    const piece = { id: "s", definitionId: "equip:apprentice_staff", lockState: "free" as const, slot: "MAIN_HAND" as const, sigils: [], rarity: "RARE" as const, affixes: [{ stat: "MATK", value: 4 }] };
    expect(wornBonuses([{ ...piece, refineLevel: 0 }], equipment)).toMatchObject({ MATK: 16, MP: 10 });
    expect(wornBonuses([{ ...piece, refineLevel: 10 }], equipment)).toMatchObject({ MATK: 20, MP: 10 });
  });
});
