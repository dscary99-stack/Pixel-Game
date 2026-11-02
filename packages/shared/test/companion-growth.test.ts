import { describe, expect, it } from "vitest";
import {
  ArchetypeSchema,
  PRIMARY_KEYS,
  companionEffectiveLevel,
  companionGrowth,
  companionPrimaryStats,
  createBattle,
  rebirthBonusPercent,
  type Archetype,
  type PrimaryStats,
} from "../src/index";
import { baseSetup, companion, content, rules } from "./fixtures";

const total = (s: PrimaryStats) => PRIMARY_KEYS.reduce((n, k) => n + s[k], 0);
const archetypes = ArchetypeSchema.options;

describe("companion growth (P05, chapter 04 §4)", () => {
  it("gives every companion the same total at a level; only the split is random", () => {
    for (const a of archetypes) {
      for (const seed of ["a", "b", "c"]) {
        for (const level of [1, 2, 50, 200]) expect(total(companionGrowth(rules, a, seed, level))).toBe(3 * (level - 1));
      }
    }
    expect(companionGrowth(rules, "tank", "a", 200)).not.toEqual(companionGrowth(rules, "tank", "b", 200));
  });

  it("is a pure function of the server's seed: same seed, same stats, and each level only adds", () => {
    expect(companionPrimaryStats(rules, "magic", "s1", 120, 0)).toEqual(companionPrimaryStats(rules, "magic", "s1", 120, 0));
    const lower = companionPrimaryStats(rules, "magic", "s1", 60, 0);
    const higher = companionPrimaryStats(rules, "magic", "s1", 61, 0);
    for (const k of PRIMARY_KEYS) expect(higher[k]).toBeGreaterThanOrEqual(lower[k]);
    expect(companionPrimaryStats(rules, "tank", "x", 1, 0)).toEqual({ STR: 10, VIT: 10, INT: 10, DEX: 10, AGI: 10, SPI: 10 });
  });

  it("follows the archetype order from chapter 04 on average", () => {
    const mean = (a: Archetype) => {
      const sum: Record<string, number> = {};
      for (let i = 0; i < 100; i++) {
        const g = companionGrowth(rules, a, `seed${i}`, 200);
        for (const k of PRIMARY_KEYS) sum[k] = (sum[k] ?? 0) + g[k];
      }
      return sum as PrimaryStats;
    };
    const t = mean("tank");
    expect(t.VIT).toBeGreaterThan(Math.max(t.SPI, t.STR));
    const p = mean("physical");
    expect(p.STR).toBeGreaterThan(Math.max(p.DEX, p.AGI));
    const m = mean("magic");
    expect(m.INT).toBeGreaterThan(Math.max(m.SPI, m.DEX));
    const s = mean("support");
    expect(s.SPI).toBeGreaterThan(Math.max(s.VIT, s.AGI));
    const c = mean("control");
    expect(c.AGI).toBeGreaterThan(Math.max(c.SPI, c.DEX));
  });

  it("adds the Rebirth bonus as a total over base (+4/+7/+10%), never stacked", () => {
    expect([0, 1, 2, 3].map((s) => rebirthBonusPercent(rules, s))).toEqual([0, 4, 7, 10]);
    const base = companionPrimaryStats(rules, "physical", "r", 200, 0);
    const r3 = companionPrimaryStats(rules, "physical", "r", 200, 3);
    for (const k of PRIMARY_KEYS) expect(r3[k]).toBe(Math.floor((base[k] * 110) / 100));
    // Same trajectory after Rebirth: Lv1 again is the start value plus the bonus.
    expect(companionPrimaryStats(rules, "physical", "r", 1, 1).STR).toBe(10);
  });
});

describe("battle level (O01, Nut 2026-10-07: no level limit in battle)", () => {
  it("a companion fights at its real level, however far above the player", () => {
    expect(rules.confirmed.companionBattleLevelCap).toMatchObject({ value: false, status: "CONFIRMED", decision: "O01" });
    expect(companionEffectiveLevel(rules, 50, 20)).toBe(50);
    expect(companionEffectiveLevel(rules, 25, 20)).toBe(25);
    const inst = { ...companion("m1", "species:lantern_snail", "WATER", 50), growthHistoryVersion: 2, growthSeed: "g" };
    const r = createBattle(rules, content(), baseSetup({ companions: [{ instance: inst, row: "back", slot: 0 }] }));
    if (!r.ok) throw new Error(r.message);
    const unit = r.state.units.find((u) => u.instanceId === "m1")!;
    expect(unit.level).toBe(50);
    expect(unit.actualLevel).toBe(50);
    // Stats are the growth path at its own Lv50.
    const at50 = companionPrimaryStats(rules, "support", "g", 50, 0);
    expect(total(at50)).toBe(60 + 3 * 49);
  });
});
