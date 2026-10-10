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
  skillLevelMods,
  skillLevelStep,
  skillTrainCost,
  SkillDefinitionSchema,
  type SkillLevelStep,
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
      // A Lv60 companion fights at Lv60 (no battle level cap, O01), where skill Lv5 is the cap.
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
    expect(capped.level).toBe(5);
    expect(one.mpSpent).toBe(4);
    expect(capped.mpSpent).toBe(4);
    expect(one.ev.hit).toBe(true);
    expect(capped.ev.hit).toBe(true);
    expect(capped.ev.breakdown!.base / one.ev.breakdown!.base).toBeCloseTo(1.16, 6);
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
    expect(s.entitlements.some((e) => e.kind === "fight_result")).toBe(false);
  });
});

describe("per-skill level tables (Nut 2026-10-03: each skill grows its own way)", () => {
  const volley = c.skills.get("skill:fox_light_volley")!;

  it("adds what the skill's own table says; other skills get the default power step", () => {
    expect(skillLevelMods(rules, volley, 1)).toEqual({ powerPercent: 0, mpCost: 0, cooldown: 0, extraTargets: 0, statusChance: 0, statusTurns: 0 });
    expect(skillLevelMods(rules, volley, 5)).toEqual({ powerPercent: 15, mpCost: 0, cooldown: 0, extraTargets: 1, statusChance: 0, statusTurns: 0 });
    expect(skillLevelMods(rules, volley, 10)).toEqual({ powerPercent: 35, mpCost: -1, cooldown: 0, extraTargets: 2, statusChance: 0, statusTurns: 0 });
    expect(skillLevelStep(rules, volley, 5)).toEqual({ atLevel: 5, kind: "extra_targets", value: 1 });
    expect(skillLevelMods(rules, c.skills.get("skill:fox_mark_bite")!, 4)).toMatchObject({ powerPercent: 12, extraTargets: 0 });
  });

  it("refuses tables that skip a level, add the wrong way, or take MP below 0", () => {
    const steps = (list: [SkillLevelStep["kind"], number][]) => list.map(([kind, value], i) => ({ atLevel: i + 2, kind, value }));
    const good = steps(Array.from({ length: 9 }, () => ["power", 5] as [SkillLevelStep["kind"], number]));
    expect(SkillDefinitionSchema.safeParse({ ...volley, levelSteps: good }).success).toBe(true);
    expect(SkillDefinitionSchema.safeParse({ ...volley, levelSteps: good.slice(1) }).success).toBe(false);
    expect(SkillDefinitionSchema.safeParse({ ...volley, levelSteps: [...good.slice(0, 8), { atLevel: 10, kind: "mp_cost", value: 2 }] }).success).toBe(false);
    expect(SkillDefinitionSchema.safeParse({ ...volley, levelSteps: [...good.slice(0, 8), { atLevel: 10, kind: "mp_cost", value: -9 }] }).success).toBe(false);
  });

  it("hits more targets at the level that adds them, each with its own roll, and costs less MP", () => {
    const enemies = [
      { unitId: "e1", speciesId: "species:armor_crab", element: "EARTH" as const, row: "front" as const, slot: 0 },
      { unitId: "e2", speciesId: "species:ember_fox", element: "FIRE" as const, row: "front" as const, slot: 1 },
      { unitId: "e3", speciesId: "species:ember_fox", element: "FIRE" as const, row: "back" as const, slot: 0 },
    ];
    const cast = (trained: number) => {
      // A Lv200 companion with a Lv200 character uses every trained level.
      const inst = { ...companion("m1", "species:ember_fox", "FIRE", 200), trainedSkillLevels: { "skill:fox_light_volley": trained } };
      const setup = baseSetup({ enemies, companions: [{ instance: inst, row: "back", slot: 0 }] });
      setup.player.level = 200;
      let s: BattleState = ok(createBattle(rules, c, setup)).state;
      for (let i = 0; i < 20 && currentActor(s)?.unitId !== "ally:m1"; i++) s = ok(applyCommand(rules, c, s, chooseAutoCommand(s)!, { source: "player" })).state;
      const mp = s.units.find((u) => u.unitId === "ally:m1")!.mp;
      const r = ok(applyCommand(rules, c, s, { type: "skill", actorId: "ally:m1", skillId: "skill:fox_light_volley", targetId: "e2" }, { source: "player" }));
      const hits = r.events.filter((e) => e.type === "ActionResolved" && e.actorId === "ally:m1").map((e) => (e.type === "ActionResolved" ? e.targetId : null));
      return { hits, mpSpent: mp - r.state.units.find((u) => u.unitId === "ally:m1")!.mp };
    };
    expect(cast(1)).toEqual({ hits: ["e2"], mpSpent: 5 });
    // Lv5: the chosen target, then the next one in formation order (front row first).
    expect(cast(5).hits).toEqual(["e2", "e1"]);
    expect(cast(10)).toEqual({ hits: ["e2", "e1", "e3"], mpSpent: 4 });
  });
});

describe("Bond goes down when a companion falls (Nut 2026-10-03)", () => {
  it("a companion knocked out loses Bond whatever the outcome; one that stayed up through a win gains", () => {
    // A Lv1 companion with 1 HP left falls at the first enemy hit it takes; Auto plays the fight out.
    const weak = { instance: { ...companion("m1", "species:lantern_snail", "WATER", 1), bond: 100 }, row: "front" as const, slot: 0, hp: 1 };
    const sturdy = { instance: { ...companion("m2", "species:armor_crab", "EARTH", 30), bond: 100 }, row: "front" as const, slot: 2 };
    let s: BattleState = ok(createBattle(rules, c, baseSetup({ companions: [weak, sturdy] }))).state;
    for (let i = 0; i < 500 && s.status === "active"; i++) s = ok(applyCommand(rules, c, s, chooseAutoCommand(s)!, { source: "auto" })).state;
    const result = s.entitlements.find((e) => e.kind === "fight_result");
    const fell = s.units.find((u) => u.unitId === "ally:m1")!.fell === true;
    const m2fell = s.units.find((u) => u.unitId === "ally:m2")!.fell === true;
    expect(result?.kind).toBe("fight_result");
    if (result?.kind !== "fight_result") throw new Error();
    expect(result.companions.m1?.bond).toBe(fell ? -2 : s.status === "victory" ? 2 : 0);
    expect(result.companions.m2?.bond ?? 0).toBe(m2fell ? -2 : s.status === "victory" ? 2 : 0);
    expect(fell).toBe(true);
  });
});
