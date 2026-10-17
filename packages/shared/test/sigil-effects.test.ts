import { describe, expect, it } from "vitest";
import {
  applyCommand,
  createBattle,
  currentActor,
  equipmentDisplayName,
  scaleSigilAction,
  sigilModifierTotalPct,
  sigilTriggerChanceBp,
  wornGear,
  type BattleCommand,
  type BattleEvent,
  type BattleSetup,
  type BattleState,
  type EquipmentView,
  type KernelResult,
} from "../src/index";
import { baseSetup, content, rules as baseRules } from "./fixtures";

const rules = structuredClone(baseRules);
(rules.provisional.hitChanceClampPct as { value: readonly [number, number] }).value = [100, 100];
(rules.provisional.enemyAi as { value: { skillChancePct: number; healBelowHpPct: number } }).value = { skillChancePct: 0, healBelowHpPct: 50 };

const ok = (r: KernelResult) => {
  if (!r.ok) throw new Error(`${r.code}: ${r.message}`);
  return r;
};
const of = <T extends BattleEvent["type"]>(events: BattleEvent[], type: T) => events.filter((e): e is Extract<BattleEvent, { type: T }> => e.type === type);
const unit = (s: BattleState, id: string) => s.units.find((u) => u.unitId === id)!;

function fight(sigilIds: string[], over: (s: BattleSetup) => void = () => {}) {
  const c = content();
  const setup = baseSetup();
  if (sigilIds.length > 0) setup.player.sigilIds = sigilIds;
  over(setup);
  const start = ok(createBattle(rules, c, setup));
  let s = start.state;
  for (let i = 0; i < 20 && currentActor(s)?.unitId !== "player"; i++) s = ok(applyCommand(rules, c, s, { type: "guard", actorId: currentActor(s)!.unitId }, { source: "player" })).state;
  const run = (state: BattleState, cmd: BattleCommand) => ok(applyCommand(rules, c, state, cmd, { source: "player" }));
  return { c, s, start, run };
}

describe("Sigil names (Nut 2026-10-04: a prefix before the piece's name)", () => {
  it("puts each kind's prefix in socket order; copies read ทวิ/ตรี/จตุ", () => {
    const c = content();
    const sword = [...c.equipment.values()].find((d) => d.category === "WEAPON")!;
    expect(equipmentDisplayName(sword, [], c.sigils)).toBe(sword.name.th);
    expect(equipmentDisplayName(sword, ["sigil:ember_fox"], c.sigils)).toBe(`เพลิงจิ้งจอก ${sword.name.th}`);
    expect(equipmentDisplayName(sword, ["sigil:ember_fox", "sigil:armor_crab", "sigil:ember_fox"], c.sigils)).toBe(`ทวิเพลิงจิ้งจอก กระดอง ${sword.name.th}`);
    expect(equipmentDisplayName(sword, Array(4).fill("sigil:ember_fox"), c.sigils)).toBe(`จตุเพลิงจิ้งจอก ${sword.name.th}`);
  });

  it("the worn pieces' Sigils go into the fight, one entry per copy; an unknown one is refused", () => {
    const c = content();
    const sword = [...c.equipment.values()].find((d) => d.category === "WEAPON")!;
    const owned: EquipmentView[] = [
      { id: "e1", definitionId: sword.id, refineLevel: 0, lockState: "free", slot: "MAIN_HAND", sigils: ["sigil:ember_fox", "sigil:ember_fox"], rarity: "COMMON", affixes: [] },
      { id: "e2", definitionId: sword.id, refineLevel: 0, lockState: "free", slot: null, sigils: ["sigil:armor_crab"], rarity: "COMMON", affixes: [] },
    ];
    expect(wornGear(owned, c.equipment).sigilIds).toEqual(["sigil:ember_fox", "sigil:ember_fox"]);
    expect(unit(fight(["sigil:ember_fox", "sigil:ember_fox"]).s, "player").sigils).toEqual({ "sigil:ember_fox": 2 });
    const setup = baseSetup();
    setup.player.sigilIds = ["sigil:nope"];
    expect(createBattle(rules, c, setup)).toMatchObject({ ok: false, code: "MISSING_REFERENCE" });
  });
});

describe("Sigil effects in a fight", () => {
  it("copies of a % Sigil stack % on % (Nut 2026-10-04): fox ×1.10, two foxes ×1.21 against burn", () => {
    const hit = (sigils: string[]) => {
      const w = fight(sigils);
      const s = structuredClone(w.s);
      unit(s, "e1").statuses = [{ statusId: "burn", sourceId: null, turnsLeft: 3, stacks: 1, fresh: false }];
      return of(w.run(s, { type: "attack", actorId: "player", targetId: "e1" }).events, "ActionResolved")[0]!.breakdown!.unrounded;
    };
    const base = hit([]);
    expect(hit(["sigil:ember_fox"]) / base).toBeCloseTo(1.1, 6);
    expect(hit(["sigil:ember_fox", "sigil:ember_fox"]) / base).toBeCloseTo(1.21, 6);
  });

  it("the crab Sigil cuts damage again while guarding", () => {
    const taken = (sigils: string[]) => {
      const w = fight(sigils);
      const r = w.run(w.s, { type: "guard", actorId: "player" });
      return of(r.events, "ActionResolved").filter((e) => e.targetId === "player" && e.hit).map((e) => e.breakdown!.unrounded);
    };
    const plain = taken([]);
    const crab = taken(["sigil:armor_crab"]);
    expect(plain.length).toBeGreaterThan(0);
    expect(crab.length).toBe(plain.length);
    crab.forEach((d, i) => expect(d / plain[i]!).toBeCloseTo(0.9, 6));
  });

  it("copies of a trigger Sigil roll once, with a stronger effect; seal turns Sigils off (P34)", () => {
    const two = fight(["sigil:bell_bird", "sigil:bell_bird"]);
    expect(of(two.start.events, "PassiveTriggered")).toEqual([expect.objectContaining({ unitId: "player", sourceId: "sigil:bell_bird", on: "battle_start" })]);
    const mp = (ids: string[]) => {
      const w = fight(ids);
      const s = structuredClone(w.s);
      unit(s, "player").mp = 0;
      const r = w.run(s, { type: "attack", actorId: "player", targetId: "e1" });
      expect(of(r.events, "PassiveTriggered")).toHaveLength(1);
      return unit(r.state, "player").mp;
    };
    expect(mp(["sigil:supply_mole"])).toBe(1);
    // The second accessory copy doubles the MP (extraCopyStrengthPct 100).
    expect(mp(["sigil:supply_mole", "sigil:supply_mole"])).toBe(2);
    const w = fight(["sigil:supply_mole"]);
    const s = structuredClone(w.s);
    unit(s, "player").statuses = [{ statusId: "seal", sourceId: null, turnsLeft: 3, stacks: 1, fresh: false }];
    expect(of(w.run(s, { type: "attack", actorId: "player", targetId: "e1" }).events, "PassiveTriggered")).toEqual([]);
  });

  it("combined chance is 1 − (1 − p)^n, and strength scales per copy", () => {
    expect(sigilTriggerChanceBp(30, 1)).toBe(3000);
    expect(sigilTriggerChanceBp(30, 2)).toBe(5100);
    expect(sigilTriggerChanceBp(30, 3)).toBe(6570);
    expect(sigilTriggerChanceBp(100, 4)).toBe(10_000);
    expect(scaleSigilAction(rules, { kind: "heal", target: "self", pctMaxHp: 5 }, 3)).toEqual({ kind: "heal", target: "self", pctMaxHp: 15 });
    expect(scaleSigilAction(rules, { kind: "heal", target: "self", pctMaxHp: 30 }, 3)).toMatchObject({ pctMaxHp: 50 });
    expect(scaleSigilAction(rules, { kind: "status", target: "other", statuses: [{ statusId: "burn", chancePct: 40, turns: 2 }] }, 2)).toMatchObject({ statuses: [{ chancePct: 64 }] });
    expect(scaleSigilAction(rules, { kind: "restore_mp", target: "self", amount: 3 }, 1)).toEqual({ kind: "restore_mp", target: "self", amount: 3 });
    // The preview's totals for always-on copies match what the kernel multiplies (fox ×1.21 above).
    expect(sigilModifierTotalPct({ kind: "damage_vs_status", statusId: "burn", bonusPct: 10 }, 2)).toBe(21);
    expect(sigilModifierTotalPct({ kind: "guard_reduction", reductionPct: 10 }, 1)).toBe(10);
    expect(sigilModifierTotalPct({ kind: "guard_reduction", reductionPct: 10 }, 2)).toBe(19);
    expect(sigilModifierTotalPct({ kind: "heal_low_hp", belowHpPct: 40, bonusPct: 15 }, 0)).toBe(0);
  });

  it("a Sigil procs once per turn slot, however many hits a skill lands (P34 proc budget)", () => {
    const c = content();
    c.sigils.set("sigil:test_echo", { ...c.sigils.get("sigil:supply_mole")!, id: "sigil:test_echo", effect: { modifiers: [], triggers: [{ on: "dealt_damage", chancePct: 100, oncePerBattle: false, then: [{ kind: "restore_mp", target: "self", amount: 1 }] }] } });
    const skillId = "skill:c2_beast_marshal_maul";
    const setup = baseSetup({ battleId: "battle:sigil-budget", seed: "budget" });
    setup.player = { ...setup.player, skillIds: [skillId], mp: 200, sigilIds: ["sigil:test_echo"], primaryStats: { ...setup.player.primaryStats, DEX: 60 } };
    let st: BattleState = ok(createBattle(rules, c, setup)).state;
    for (let i = 0; i < 30 && currentActor(st)?.unitId !== "player"; i++) st = ok(applyCommand(rules, c, st, { type: "guard", actorId: currentActor(st)!.unitId }, { source: "player" })).state;
    const r = ok(applyCommand(rules, c, st, { type: "skill", actorId: "player", skillId, targetId: "e2" }, { source: "player" }));
    const hits = r.events.filter((e) => e.type === "ActionResolved" && e.actorId === "player" && e.skillId === skillId && (e.damage ?? 0) > 0).length;
    expect(hits).toBeGreaterThan(1);
    expect(of(r.events, "PassiveTriggered").filter((e) => e.sourceId === "sigil:test_echo")).toHaveLength(1);
  });

  it("Sigils of one group share a cooldown counted in the owner's turns (chapter 05 §5)", () => {
    const c = content();
    const base = c.sigils.get("sigil:supply_mole")!;
    const echo = (id: string) => ({ ...base, id, stackingGroup: "group:echo", cooldownTurns: 2, effect: { modifiers: [], triggers: [{ on: "dealt_damage" as const, chancePct: 100, oncePerBattle: false, then: [{ kind: "restore_mp" as const, target: "self" as const, amount: 1 }] }] } });
    c.sigils.set("sigil:echo_a", echo("sigil:echo_a"));
    c.sigils.set("sigil:echo_b", echo("sigil:echo_b"));
    const setup = baseSetup({ battleId: "battle:sigil-cd", seed: "cd", enemies: [{ unitId: "e1", speciesId: "species:armor_crab", element: "EARTH", row: "front", slot: 0 }] });
    setup.player = { ...setup.player, sigilIds: ["sigil:echo_a", "sigil:echo_b"] };
    let st: BattleState = ok(createBattle(rules, c, setup)).state;
    unit(st, "e1").hp = 999_999;
    const procs: number[] = [];
    for (let turn = 0; turn < 4; turn++) {
      for (let i = 0; i < 30 && currentActor(st)?.unitId !== "player"; i++) st = ok(applyCommand(rules, c, st, { type: "guard", actorId: currentActor(st)!.unitId }, { source: "player" })).state;
      const r = ok(applyCommand(rules, c, st, { type: "attack", actorId: "player", targetId: "e1" }, { source: "player" }));
      procs.push(of(r.events, "PassiveTriggered").filter((e) => e.unitId === "player" && e.sourceId.startsWith("sigil:echo")).length);
      st = r.state;
    }
    // One of the two fires, then the group waits two of the player's turns.
    expect(procs).toEqual([1, 0, 1, 0]);
  });
});
