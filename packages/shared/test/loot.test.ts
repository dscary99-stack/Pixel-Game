import { describe, expect, it } from "vitest";
import { EXAMPLE_LOOT_TABLES, PRODUCTION_RULES as rules, Rng, rollLoot, seedRng, type LootTable } from "../src/index";

/** Synthetic table for statistics only (high sigil p so the sample is small). */
const table: LootTable = {
  ...EXAMPLE_LOOT_TABLES[0]!,
  sigilRoll: { ...EXAMPLE_LOOT_TABLES[0]!.sigilRoll, probability: 0.2 },
  emptySlotWeight: 0,
  pools: [
    {
      id: "many",
      weight: 1,
      entries: Array.from({ length: 12 }, (_, i) => ({ itemId: `item:mat_${i}`, weight: 1, minQty: 1, maxQty: 1 })),
    },
  ],
};

describe("loot roll (chapter 06 algorithm)", () => {
  it("never yields more than 5 item types per enemy (C19)", () => {
    const rng = new Rng(seedRng("types"));
    for (let i = 0; i < 2000; i++) expect(rollLoot(rules, table, "manual", rng).length).toBeLessThanOrEqual(5);
  });

  it("is deterministic for the same RNG state", () => {
    const a = rollLoot(rules, table, "auto_hunt", new Rng(seedRng("same")));
    const b = rollLoot(rules, table, "auto_hunt", new Rng(seedRng("same")));
    expect(a).toEqual(b);
  });

  it("keeps the sigil at p * q: manual 1.0x, Auto Hunt 0.70x applied once", () => {
    const n = 40_000;
    const sigilItem = table.sigilRoll.itemId;
    const rate = (mode: "manual" | "auto_hunt" | "manual_start_auto") => {
      const rng = new Rng(seedRng(`rate-${mode}`));
      let hits = 0;
      for (let i = 0; i < n; i++) if (rollLoot(rules, table, mode, rng).some((l) => l.itemId === sigilItem)) hits++;
      return hits / n;
    };
    // 4-sigma bounds around p = 0.2 and p*q = 0.14.
    expect(Math.abs(rate("manual") - 0.2)).toBeLessThan(4 * Math.sqrt((0.2 * 0.8) / n));
    expect(Math.abs(rate("manual_start_auto") - 0.2)).toBeLessThan(4 * Math.sqrt((0.2 * 0.8) / n));
    expect(Math.abs(rate("auto_hunt") - 0.14)).toBeLessThan(4 * Math.sqrt((0.14 * 0.86) / n));
  });

  it("does not refill discarded Auto slots: mean ordinary quantity drops to 0.70x", () => {
    const n = 20_000;
    const qty = (mode: "manual" | "auto_hunt") => {
      const rng = new Rng(seedRng(`qty-${mode}`));
      let sum = 0;
      for (let i = 0; i < n; i++)
        for (const l of rollLoot(rules, table, mode, rng)) if (l.itemId !== table.sigilRoll.itemId) sum += l.quantity;
      return sum / n;
    };
    const ratio = qty("auto_hunt") / qty("manual");
    expect(ratio).toBeGreaterThan(0.68);
    expect(ratio).toBeLessThan(0.72);
  });
});

describe("party material bonus (P02)", () => {
  const t = EXAMPLE_LOOT_TABLES[0]!;
  const isMaterial = (id: string) => id === "item:crab_shell" || id === "item:river_pebble";
  const count = (bonus: number, origin: "manual" | "auto_hunt", seeds = 4000) => {
    let mats = 0;
    let other = 0;
    for (let i = 0; i < seeds; i++) {
      for (const l of rollLoot(rules, t, origin, new Rng(seedRng(`p${i}`)), { percent: bonus, isMaterial })) {
        if (isMaterial(l.itemId)) mats += l.quantity;
        else other += l.quantity;
      }
    }
    return { mats, other };
  };

  it("no bonus is the same roll as before (same RNG use)", () => {
    for (let i = 0; i < 50; i++) {
      expect(rollLoot(rules, t, "auto_hunt", new Rng(seedRng(`s${i}`)), { percent: 0, isMaterial })).toEqual(rollLoot(rules, t, "auto_hunt", new Rng(seedRng(`s${i}`))));
    }
  });

  it("raises expected materials by about the bonus, relative, and nothing else", () => {
    const base = count(0, "manual");
    const plus = count(6, "manual");
    expect(plus.mats / base.mats).toBeGreaterThan(1.03);
    expect(plus.mats / base.mats).toBeLessThan(1.09);
    expect(plus.other).toBe(base.other);
  });
});
