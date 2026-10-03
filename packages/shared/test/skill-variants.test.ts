import { describe, expect, it } from "vitest";
import {
  applyCommand,
  chooseAutoCommand,
  companionKit,
  createBattle,
  currentActor,
  validateSpecies,
  type BattleEvent,
  type BattleState,
  type KernelResult,
  type MonsterInstance,
  type RulesConfig,
} from "../src/index";
import { baseSetup, companion, content, fixtureRules, rules } from "./fixtures";

const c = content();
const ok = (r: KernelResult) => {
  if (!r.ok) throw new Error(`${r.code}: ${r.message}`);
  return r;
};
const fox = c.species.get("species:ember_fox")!;

/** Puts a fox companion at its turn, optionally edits the state, then casts `skillId` on e1. */
function cast(r: RulesConfig, inst: MonsterInstance, skillId: string, prep: (s: BattleState) => void = () => undefined, hp?: number) {
  const setup = baseSetup({ companions: [{ instance: inst, row: "front", slot: 0, ...(hp === undefined ? {} : { hp }) }] });
  setup.player.level = 200;
  let s: BattleState = ok(createBattle(r, c, setup)).state;
  for (let i = 0; i < 20 && currentActor(s)?.unitId !== "ally:m1"; i++) s = ok(applyCommand(r, c, s, chooseAutoCommand(s)!, { source: "player" })).state;
  prep(s);
  const res = ok(applyCommand(r, c, s, { type: "skill", actorId: "ally:m1", skillId, targetId: "e1" }, { source: "player" }));
  const act = res.events.find((e) => e.type === "ActionResolved") as Extract<BattleEvent, { type: "ActionResolved" }>;
  return { res, act, before: s };
}
const reborn = (stage: number, choices: MonsterInstance["rebirthChoices"], level = 120): MonsterInstance => ({
  ...companion("m1", "species:ember_fox", "FIRE", level),
  rebirthStage: stage,
  rebirthChoices: choices,
});

describe("Rebirth variants in the kit (chapter 04 §7)", () => {
  it("swaps a stage's chosen branch in once the companion fights at the unlock level (20/50/100)", () => {
    const kit = (stage: number, level: number) => companionKit(rules, fox, { rebirthStage: stage, rebirthChoices: { "1": "A", "2": "B", "3": "A" } }, level).map((k) => k.skillId);
    expect(kit(0, 200)).toEqual(["skill:fox_mark_bite", "skill:fox_light_volley", "skill:fox_consume_mark", "skill:fox_innate_kill_heal"]);
    expect(kit(3, 19)).toEqual(kit(0, 200));
    expect(kit(3, 20)).toEqual(["skill:fox_blood_bite", "skill:fox_light_volley", "skill:fox_consume_mark", "skill:fox_innate_kill_heal"]);
    expect(kit(3, 100)).toEqual(["skill:fox_blood_bite", "skill:fox_light_volley", "skill:fox_final_blaze", "skill:fox_innate_kill_mp"]);
    // A stage not reached does nothing even with a stored choice.
    expect(kit(1, 200)[2]).toBe("skill:fox_consume_mark");
  });

  it("in a fight the variant replaces the base skill and keeps its trained level", () => {
    const inst = { ...reborn(1, { "1": "A" }), trainedSkillLevels: { "skill:fox_mark_bite": 4 } };
    const unit = ok(createBattle(rules, c, baseSetup({ companions: [{ instance: inst, row: "front", slot: 0 }] }))).state.units.find((u) => u.unitId === "ally:m1")!;
    expect(unit.skillIds).toContain("skill:fox_blood_bite");
    expect(unit.skillIds).not.toContain("skill:fox_mark_bite");
    // Lv120 companion with a Lv20 character fights at Lv30: skill cap 3.
    expect(unit.skillLevels?.["skill:fox_blood_bite"]).toBe(3);
  });

  it("the validator checks the variant rules", () => {
    const bad = { ...fox, rebirthVariants: [{ stage: 2, replaces: "skill:fox_mark_bite", options: fox.rebirthVariants![0]!.options }] };
    expect(validateSpecies(rules, bad, c.skills, c.sigils).map((i) => i.code)).toContain("SPECIES_KIT_INVALID");
    expect(validateSpecies(rules, fox, c.skills, c.sigils)).toEqual([]);
  });
});

describe("damage primitives (docs/design/SKILL_PRIMITIVES_CATALOG.md)", () => {
  it("lifesteal heals the user by a share of the damage that landed", () => {
    const { res, act } = cast(rules, reborn(1, { "1": "A" }), "skill:fox_blood_bite", () => undefined, 50);
    const steal = res.events.find((e) => e.type === "ResourceChanged");
    expect(act.hit).toBe(true);
    expect(steal).toMatchObject({ unitId: "ally:m1", source: "lifesteal", hp: Math.floor((act.damage! * 30) / 100) });
  });

  it("penetration lowers the target's armor; execute adds damage on a low-HP target; recoil costs the user", () => {
    const crab = (stage: number, choices: MonsterInstance["rebirthChoices"]) => ({
      ...companion("m1", "species:armor_crab", "EARTH", 200),
      rebirthStage: stage,
      rebirthChoices: choices,
    });
    const bash = cast(rules, crab(0, {}), "skill:crab_shield_bash").act;
    const pierce = cast(rules, crab(3, { "3": "A" }), "skill:crab_pierce_bash").act;
    expect(bash.hit && pierce.hit).toBe(true);
    expect(pierce.breakdown!.armorMultiplier).toBeGreaterThan(bash.breakdown!.armorMultiplier);
    // Execute: below 35% HP the hit is +60% (R3 A, cooldown needs the O15 fixture).
    const low = (s: BattleState) => {
      const e1 = s.units.find((u) => u.unitId === "e1")!;
      e1.hp = Math.floor(e1.stats.maxHp * 0.3);
    };
    const blaze = cast(fixtureRules, reborn(3, { "3": "A" }), "skill:fox_final_blaze", low).act;
    const plain = cast(fixtureRules, reborn(3, { "3": "A" }), "skill:fox_final_blaze").act;
    expect(blaze.hit && plain.hit).toBe(true);
    expect(blaze.breakdown!.unrounded / plain.breakdown!.unrounded).toBeCloseTo(1.6, 6);
    const dash = cast(fixtureRules, reborn(3, { "3": "B" }), "skill:fox_reckless_dash");
    const recoil = dash.res.events.find((e) => e.type === "ResourceChanged");
    expect(dash.act.hit).toBe(true);
    expect(recoil).toMatchObject({ source: "recoil", hp: -Math.floor((dash.act.damage! * 20) / 100) });
    const me = dash.res.state.units.find((u) => u.unitId === "ally:m1")!;
    expect(me.hp).toBeGreaterThanOrEqual(1);
  });
});
