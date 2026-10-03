import { describe, expect, it } from "vitest";
import {
  applyBond,
  applyCommand,
  bondTier,
  chooseAutoCommand,
  createBattle,
  currentActor,
  deriveStats,
  effectiveSkillLevel,
  skillLevelCap,
  skillTrainCost,
  type BattleState,
  type KernelResult,
} from "../src/index";
import { baseSetup, companion, content, rules } from "./fixtures";

const c = content();
const ok = (r: KernelResult) => {
  if (!r.ok) throw new Error(`${r.code}: ${r.message}`);
  return r;
};

describe("skill levels (chapter 04 §5, P06)", () => {
  it("follows the companion-level gate table", () => {
    expect([1, 9, 10, 34, 35, 189, 190, 200].map((l) => skillLevelCap(rules, l))).toEqual([1, 1, 2, 3, 4, 9, 10, 10]);
  });

  it("caps trained levels by the level the companion fights at (a Lv1 after Rebirth cannot use skill 10)", () => {
    expect(effectiveSkillLevel(rules, 10, 1)).toBe(1);
    expect(effectiveSkillLevel(rules, 10, 120)).toBe(7);
    expect(effectiveSkillLevel(rules, 3, 200)).toBe(3);
  });

  it("prices each step from the table and refuses other species' skills and level 10", () => {
    const crab = c.species.get("species:armor_crab")!;
    expect(skillTrainCost(rules, crab, "skill:crab_shield_bash", 1, c)).toMatchObject({
      ok: true,
      nextLevel: 2,
      mastery: 10,
      coins: 100,
      materialItemId: "item:crab_shell",
      materialQty: 1,
      companionLevel: 10,
    });
    // The innate trains too.
    expect(skillTrainCost(rules, crab, "skill:crab_innate_mp_refund", 9, c)).toMatchObject({ ok: true, nextLevel: 10, companionLevel: 190 });
    expect(skillTrainCost(rules, crab, "skill:fox_mark_bite", 1, c)).toMatchObject({ ok: false, code: "NOT_SPECIES_SKILL" });
    expect(skillTrainCost(rules, crab, "skill:crab_shield_bash", 10, c)).toMatchObject({ ok: false, code: "MAX_SKILL_LEVEL" });
  });

  it("adds power only: same rolls, bigger coefficient, same MP cost", () => {
    const cmd = { type: "skill" as const, actorId: "ally:m1", skillId: "skill:fox_mark_bite", targetId: "e1" };
    const fight = (trained: number) => {
      // Lv60 companion with a Lv20 character fights at Lv30, where skill Lv3 is the cap.
      const inst = { ...companion("m1", "species:ember_fox", "FIRE", 60), trainedSkillLevels: { "skill:fox_mark_bite": trained } };
      let s: BattleState = ok(createBattle(rules, c, baseSetup({ companions: [{ instance: inst, row: "front", slot: 0 }] }))).state;
      for (let i = 0; i < 20 && currentActor(s)?.unitId !== "ally:m1"; i++) s = ok(applyCommand(rules, c, s, chooseAutoCommand(s)!, { source: "player" })).state;
      const before = s.units.find((u) => u.unitId === "ally:m1")!;
      const r = ok(applyCommand(rules, c, s, cmd, { source: "player" }));
      const ev = r.events.find((e) => e.type === "ActionResolved");
      if (ev?.type !== "ActionResolved") throw new Error("no action");
      return { level: before.skillLevels?.["skill:fox_mark_bite"], mpSpent: before.mp - r.state.units.find((u) => u.unitId === "ally:m1")!.mp, ev };
    };
    const one = fight(1);
    const capped = fight(9);
    expect(one.level).toBe(1);
    expect(capped.level).toBe(3);
    expect(one.mpSpent).toBe(4);
    expect(capped.mpSpent).toBe(4);
    expect(one.ev.hit).toBe(true);
    expect(capped.ev.hit).toBe(true);
    expect(capped.ev.breakdown!.base / one.ev.breakdown!.base).toBeCloseTo(1.08, 6);
  });
});

describe("Bond (chapter 04 §6, C11, P06)", () => {
  it("has five tiers and a small bonus on the archetype's stat", () => {
    expect([0, 199, 200, 599, 800, 1000].map((b) => bondTier(rules, b))).toEqual([0, 0, 1, 2, 4, 4]);
    const s = deriveStats(50, { STR: 50, VIT: 50, INT: 50, DEX: 50, AGI: 50, SPI: 50 });
    expect(applyBond(rules, "tank", 1000, s)).toEqual({ ...s, maxHp: Math.floor((s.maxHp * 105) / 100) });
    expect(applyBond(rules, "physical", 450, s)).toEqual({ ...s, patk: Math.floor((s.patk * 102) / 100) });
    expect(applyBond(rules, "magic", 100, s)).toEqual(s);
  });

  it("applies in the fight and shows the % on the unit", () => {
    const inst = (bond: number) => ({ ...companion("m1", "species:armor_crab", "EARTH", 10), bond });
    const unit = (bond: number) =>
      ok(createBattle(rules, c, baseSetup({ companions: [{ instance: inst(bond), row: "front", slot: 0 }] }))).state.units.find((u) => u.unitId === "ally:m1")!;
    const plain = unit(0);
    const close = unit(900);
    expect(close.bondPercent).toBe(5);
    expect(close.stats.maxHp).toBe(Math.floor((plain.stats.maxHp * 105) / 100));
    expect(close.stats.patk).toBe(plain.stats.patk);
  });

  it("gives no victory reward for a lost fight or a fight without companions", () => {
    const solo = ok(createBattle(rules, c, baseSetup()));
    let s = solo.state;
    for (let i = 0; i < 500 && s.status === "active"; i++) {
      const cmd = chooseAutoCommand(s);
      if (cmd === null) break;
      s = ok(applyCommand(rules, c, s, cmd, { source: "auto" })).state;
    }
    expect(s.entitlements.some((e) => e.kind === "victory")).toBe(false);
  });
});
