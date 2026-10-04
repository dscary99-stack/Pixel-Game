import { describe, expect, it } from "vitest";
import {
  applyCommand,
  createBattle,
  currentActor,
  PassiveSchema,
  SkillDefinitionSchema,
  type ActiveStatus,
  type BattleCommand,
  type BattleEvent,
  type BattleState,
  type KernelResult,
  type SkillDefinition,
} from "../src/index";
import { baseSetup, companion, content, rules as baseRules } from "./fixtures";

const rules = structuredClone(baseRules);
(rules.provisional.hitChanceClampPct as { value: readonly [number, number] }).value = [100, 100];
// Enemies only basic-attack here, so a test only sees the passives it sets up.
(rules.provisional.enemyAi as { value: { skillChancePct: number; healBelowHpPct: number } }).value = { skillChancePct: 0, healBelowHpPct: 50 };

const ok = (r: KernelResult) => {
  if (!r.ok) throw new Error(`${r.code}: ${r.message}`);
  return r;
};
const of = <T extends BattleEvent["type"]>(events: BattleEvent[], type: T) => events.filter((e): e is Extract<BattleEvent, { type: T }> => e.type === type);
const meta = { version: 1, status: "draft" as const, example: true };
const passive = (id: string, p: unknown): SkillDefinition => ({
  id,
  ...meta,
  name: { th: id },
  kind: "passive",
  ownerKind: "companion",
  targetRule: "none",
  range: "melee",
  mpCost: 0,
  cooldown: 0,
  effectSequence: [],
  tags: [],
  passive: PassiveSchema.parse(p),
});
const st = (statusId: ActiveStatus["statusId"]): ActiveStatus => ({ statusId, sourceId: null, turnsLeft: 3, stacks: 1, fresh: false });

/** The player alone against e1/e2, with these passives on the player; the player is up. */
function world(passives: SkillDefinition[], extraSkills: SkillDefinition[] = []) {
  const c = content();
  for (const p of [...passives, ...extraSkills]) c.skills.set(p.id, p);
  const setup = baseSetup();
  setup.player.skillIds = ["skill:player_power_strike", ...extraSkills.map((s) => s.id)];
  let s = ok(createBattle(rules, c, setup)).state;
  for (let i = 0; i < 20 && currentActor(s)?.unitId !== "player"; i++) s = ok(applyCommand(rules, c, s, { type: "guard", actorId: currentActor(s)!.unitId }, { source: "player" })).state;
  s = structuredClone(s);
  s.units.find((u) => u.unitId === "player")!.passiveIds = passives.map((p) => p.id);
  const run = (state: BattleState, cmd: BattleCommand) => ok(applyCommand(rules, c, state, cmd, { source: "player" }));
  return { c, s, run };
}
const unit = (s: BattleState, id: string) => s.units.find((u) => u.unitId === id)!;
const edit = (s: BattleState, id: string, f: (u: BattleState["units"][number]) => void) => {
  const next = structuredClone(s);
  f(unit(next, id));
  return next;
};
const attack = (targetId = "e1"): BattleCommand => ({ type: "attack", actorId: "player", targetId });

describe("passive schema (catalog §4)", () => {
  const p = (trigger: unknown) => SkillDefinitionSchema.safeParse({ ...passive("skill:t_ok", { triggers: [] }), passive: { triggers: [trigger] } }).success;
  it("keeps harmful effects on the enemy of the event and helpful ones on the owner's side", () => {
    expect(p({ on: "kill", then: [{ kind: "heal", target: "self", pctMaxHp: 5 }] })).toBe(true);
    expect(p({ on: "dealt_damage", then: [{ kind: "status", target: "other", statuses: [{ statusId: "burn", chancePct: 30, turns: 2 }] }] })).toBe(true);
    expect(p({ on: "dealt_damage", then: [{ kind: "status", target: "self", statuses: [{ statusId: "burn", chancePct: 30, turns: 2 }] }] })).toBe(false);
    expect(p({ on: "took_damage", then: [{ kind: "heal", target: "other", pctMaxHp: 5 }] })).toBe(false);
    expect(p({ on: "turn_start", then: [{ kind: "heal", target: "other", pctMaxHp: 5 }] })).toBe(false);
    expect(p({ on: "hp_below", then: [{ kind: "heal", target: "self", pctMaxHp: 5 }] })).toBe(false);
    expect(p({ on: "hp_below", hpBelowPct: 30, then: [{ kind: "heal", target: "self", pctMaxHp: 5 }] })).toBe(true);
    // Only passive skills carry passive effects.
    expect(SkillDefinitionSchema.safeParse({ ...passive("skill:t_x", { triggers: [] }), kind: "active", effectSequence: [{ kind: "heal", coefficient: 1, flat: 0 }] }).success).toBe(false);
  });
});

describe("passives in a fight (catalog §4)", () => {
  it("companions fight with their innate and wild monsters with theirs", () => {
    const c = content();
    const setup = baseSetup({ companions: [{ instance: companion("m1", "species:ember_fox", "FIRE", 10), row: "front", slot: 0 }] });
    setup.enemies = [{ unitId: "e1", speciesId: "species:supply_mole", element: "EARTH", row: "front", slot: 0 }];
    const s = ok(createBattle(rules, c, setup)).state;
    expect(unit(s, "ally:m1").passiveIds).toEqual(["skill:fox_innate_kill_heal"]);
    expect(unit(s, "e1").passiveIds).toEqual(["skill:mole_innate_mp_refund"]);
  });

  it("a kill on a marked target fires the kill passive; an unmarked kill does not", () => {
    const heal = passive("skill:t_kill_heal", { triggers: [{ on: "kill", otherHas: "mark", then: [{ kind: "heal", target: "self", pctMaxHp: 10 }] }] });
    const w = world([heal]);
    const ready = (marked: boolean) =>
      edit(edit(w.s, "e1", (e) => ((e.hp = 1), (e.statuses = marked ? [st("mark")] : []))), "player", (p) => (p.hp = Math.floor(p.stats.maxHp / 2)));
    const r = w.run(ready(true), attack());
    expect(of(r.events, "PassiveTriggered")).toEqual([expect.objectContaining({ unitId: "player", skillId: heal.id, on: "kill" })]);
    expect(of(r.events, "ResourceChanged")).toContainEqual(expect.objectContaining({ unitId: "player", source: "passive", hp: Math.floor(unit(w.s, "player").stats.maxHp / 10) }));
    expect(of(w.run(ready(false), attack()).events, "PassiveTriggered")).toEqual([]);
  });

  it("basic-attack-only passives skip skills; a sealed unit's passives do nothing", () => {
    const mp = passive("skill:t_mp", { triggers: [{ on: "dealt_damage", action: "attack", then: [{ kind: "restore_mp", target: "self", amount: 3 }] }] });
    const w = world([mp]);
    const low = edit(w.s, "player", (p) => (p.mp = 10));
    expect(of(w.run(low, attack()).events, "PassiveTriggered")).toHaveLength(1);
    expect(of(w.run(low, { type: "skill", actorId: "player", skillId: "skill:player_power_strike", targetId: "e1" }).events, "PassiveTriggered")).toEqual([]);
    expect(of(w.run(edit(low, "player", (p) => (p.statuses = [st("seal")])), attack()).events, "PassiveTriggered")).toEqual([]);
  });

  it("an HP-below passive fires when HP crosses the line, not again below it", () => {
    const guard = passive("skill:t_low", { triggers: [{ on: "hp_below", hpBelowPct: 50, then: [{ kind: "status", target: "self", statuses: [{ statusId: "def_up", chancePct: 100, turns: 2 }] }] }] });
    const w = world([guard]);
    // Poison ticks 5% at the start of the player's next turn, so HP goes from 52% to under 50%.
    const at = (pct: number) => edit(w.s, "player", (p) => ((p.hp = Math.floor((p.stats.maxHp * pct) / 100)), (p.statuses = [st("poison")])));
    const cross = w.run(at(52), { type: "guard", actorId: "player" });
    expect(of(cross.events, "PassiveTriggered")).toHaveLength(1);
    expect(unit(cross.state, "player").statuses!.map((x) => x.statusId)).toContain("def_up");
    expect(of(w.run(at(30), { type: "guard", actorId: "player" }).events, "PassiveTriggered")).toEqual([]);
  });

  it("once-per-battle passives fire once; a passive's own effects never fire another passive", () => {
    const cleanse: SkillDefinition = {
      ...passive("skill:t_cleanse", { triggers: [] }),
      kind: "active",
      targetRule: "self",
      range: "ranged",
      effectSequence: [{ kind: "status", statuses: [{ statusId: "cleanse", chancePct: 100, turns: 1 }] }],
    };
    delete (cleanse as { passive?: unknown }).passive;
    const resist = passive("skill:t_resist", {
      triggers: [{ on: "used_skill", skillApplies: "cleanse", oncePerBattle: true, then: [{ kind: "status", target: "other", statuses: [{ statusId: "res_up", chancePct: 100, turns: 2 }] }] }],
    });
    // Would fire on any status landing through a skill; the passive's res_up must not set it off.
    const echo = passive("skill:t_echo", { triggers: [{ on: "used_skill", then: [{ kind: "restore_mp", target: "self", amount: 1 }] }] });
    const w = world([resist, echo], [cleanse]);
    const first = w.run(edit(w.s, "player", (p) => (p.statuses = [st("def_down")])), { type: "skill", actorId: "player", skillId: cleanse.id, targetId: "player" });
    expect(of(first.events, "PassiveTriggered").map((e) => e.skillId)).toEqual([resist.id, echo.id]);
    expect(unit(first.state, "player").statuses!.map((x) => x.statusId)).toContain("res_up");
    let s = first.state;
    for (let i = 0; i < 20 && currentActor(s)?.unitId !== "player"; i++) s = w.run(s, { type: "guard", actorId: currentActor(s)!.unitId }).state;
    const again = w.run(s, { type: "skill", actorId: "player", skillId: cleanse.id, targetId: "player" });
    expect(of(again.events, "PassiveTriggered").map((e) => e.skillId)).toEqual([echo.id]);
  });

  it("modifiers: more damage against a status, more healing on a low target", () => {
    const vsBurn = passive("skill:t_vs_burn", { modifiers: [{ kind: "damage_vs_status", statusId: "burn", bonusPct: 50 }] });
    const w = world([vsBurn]);
    const hit = (s: BattleState) => of(w.run(s, attack()).events, "ActionResolved")[0]!.breakdown!.unrounded;
    const burnedState = edit(w.s, "e1", (e) => (e.statuses = [st("burn")]));
    const plain = world([]).s;
    // Same RNG either way; burn alone does not change the player's damage, so the ratio is the modifier.
    expect(hit(burnedState) / hit(edit(plain, "player", (p) => (p.passiveIds = [vsBurn.id])))).toBeCloseTo(1.5, 6);
    const care = passive("skill:t_care", { modifiers: [{ kind: "heal_low_hp", belowHpPct: 50, bonusPct: 40 }] });
    const healSkill: SkillDefinition = { ...passive("skill:t_heal", {}), kind: "active", targetRule: "self", range: "ranged", mpCost: 1, effectSequence: [{ kind: "heal", coefficient: 1, flat: 50 }] };
    delete (healSkill as { passive?: unknown }).passive;
    const h = world([care], [healSkill]);
    const healed = (pct: number, withCare: boolean) => {
      const s = edit(h.s, "player", (p) => ((p.hp = Math.floor((p.stats.maxHp * pct) / 100)), (p.passiveIds = withCare ? [care.id] : [])));
      return of(h.run(s, { type: "skill", actorId: "player", skillId: healSkill.id, targetId: "player" }).events, "ActionResolved")[0]!.heal!;
    };
    expect(healed(20, true)).toBe(Math.floor((healed(20, false) * 140) / 100));
    expect(healed(80, true)).toBe(healed(80, false));
  });

  it("the crab's innate gives MP back when it takes a hit for an ally", () => {
    const c = content();
    // In the back row, so melee enemies can only swing at the player (and the crab steps in).
    const setup = baseSetup({ companions: [{ instance: companion("m1", "species:armor_crab", "EARTH", 10), row: "back", slot: 0 }] });
    let s = ok(createBattle(rules, c, setup)).state;
    for (let i = 0; i < 20 && currentActor(s)?.unitId !== "player"; i++) s = ok(applyCommand(rules, c, s, { type: "guard", actorId: currentActor(s)!.unitId }, { source: "player" })).state;
    s = edit(s, "player", (p) => (p.statuses = [{ ...st("protect"), sourceId: "ally:m1" }]));
    s = edit(s, "ally:m1", (m) => (m.mp = 0));
    const r = ok(applyCommand(rules, c, s, { type: "guard", actorId: "player" }, { source: "player" }));
    const protects = of(r.events, "PassiveTriggered").filter((e) => e.unitId === "ally:m1" && e.on === "protected_ally");
    expect(protects.length).toBeGreaterThan(0);
    expect(of(r.events, "ResourceChanged")).toContainEqual(expect.objectContaining({ unitId: "ally:m1", source: "passive", mp: 3 }));
  });
});
