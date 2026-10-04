import { describe, expect, it } from "vitest";
import {
  EXAMPLE_AFFIX_POOLS,
  EXAMPLE_EQUIPMENT,
  PRODUCTION_RULES as R,
  RARITIES,
  Rng,
  deriveStats,
  gearBonuses,
  rollGear,
  scaleAffix,
  seedRng,
  validateAffixPools,
  type AffixPool,
} from "../src";

const dagger = EXAMPLE_EQUIPMENT.find((d) => d.id === "equip:ember_fang_dagger")!;
const pool = EXAMPLE_AFFIX_POOLS.find((p) => p.id === dagger.affixPoolId)!;
const base = { STR: 10, VIT: 10, INT: 10, DEX: 10, AGI: 10, SPI: 10 };

describe("gear rarity and affixes (chapter 05 §2–§3)", () => {
  it("example pools pass and every example piece names one by its type", () => {
    expect(validateAffixPools(R, EXAMPLE_AFFIX_POOLS, EXAMPLE_EQUIPMENT)).toEqual([]);
    expect(dagger.affixPoolId).toBe("affix:weapon_physical");
    expect(EXAMPLE_EQUIPMENT.find((d) => d.id === "equip:apprentice_staff")!.affixPoolId).toBe("affix:weapon_magic");
    expect(EXAMPLE_EQUIPMENT.find((d) => d.id === "equip:crab_buckler")!.affixPoolId).toBe("affix:defense");
  });

  it("the validator refuses unknown stats, repeats, too-small pools and missing pools", () => {
    const bad: AffixPool = { ...pool, entries: [{ stat: "DROP_RATE", weight: 1, min: 1, max: 2 }, { stat: "PATK", weight: 1, min: 1, max: 2 }, { stat: "PATK", weight: 1, min: 3, max: 2 }] };
    const msgs = validateAffixPools(R, [bad], [{ ...dagger, affixPoolId: "affix:nope" }]).map((i) => i.message);
    expect(msgs.some((m) => m.includes("unknown stat DROP_RATE"))).toBe(true);
    expect(msgs.some((m) => m.includes("twice"))).toBe(true);
    expect(msgs.some((m) => m.includes("max < min"))).toBe(true);
    expect(msgs.some((m) => m.includes("missing affix pool"))).toBe(true);
  });

  it("rolls the affix count of its rarity, each stat at most once, inside the scaled range", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i++) {
      const g = rollGear(R, dagger, pool, new Rng(seedRng(`roll:${i}`)));
      seen.add(g.rarity);
      expect(g.affixes).toHaveLength(R.provisional.affixCountByRarity.value[g.rarity]);
      expect(new Set(g.affixes.map((a) => a.stat)).size).toBe(g.affixes.length);
      for (const a of g.affixes) {
        const e = pool.entries.find((x) => x.stat === a.stat)!;
        expect(a.value).toBeGreaterThanOrEqual(scaleAffix(R, e.min, dagger.requiredLevel));
        expect(a.value).toBeLessThanOrEqual(scaleAffix(R, e.max, dagger.requiredLevel));
      }
    }
    // Legendary has weight 0 until gear has unique effects.
    expect([...seen].sort()).toEqual(RARITIES.filter((r) => r !== "LEGENDARY").sort());
  });

  it("the same seed gives the same piece; values grow with item level", () => {
    const a = rollGear(R, dagger, pool, new Rng(seedRng("same")));
    expect(rollGear(R, dagger, pool, new Rng(seedRng("same")))).toEqual(a);
    expect(scaleAffix(R, 5, 1)).toBe(5);
    expect(scaleAffix(R, 5, 51)).toBe(10);
    expect(scaleAffix(R, 1, 1)).toBe(1);
  });

  it("affixes add to gear stats, and primary-stat affixes flow through the formulas", () => {
    const g = gearBonuses([dagger], [{ stat: "PATK", value: 3 }, { stat: "STR", value: 2 }]);
    expect(g).toMatchObject({ PATK: 17, CRIT_PCT: 3, STR: 2 });
    const plain = deriveStats(5, base, gearBonuses([dagger]));
    const boosted = deriveStats(5, base, g);
    expect(boosted.patk - plain.patk).toBe(3 + 3 * 2);
  });
});
