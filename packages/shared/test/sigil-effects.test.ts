import { describe, expect, it } from "vitest";
import {
  applyCommand,
  createBattle,
  currentActor,
  equipmentDisplayName,
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
      { id: "e1", definitionId: sword.id, refineLevel: 0, lockState: "free", slot: "MAIN_HAND", sigils: ["sigil:ember_fox", "sigil:ember_fox"] },
      { id: "e2", definitionId: sword.id, refineLevel: 0, lockState: "free", slot: null, sigils: ["sigil:armor_crab"] },
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

  it("a trigger Sigil fires once however many copies are worn; seal turns Sigils off", () => {
    const two = fight(["sigil:bell_bird", "sigil:bell_bird"]);
    expect(of(two.start.events, "PassiveTriggered")).toEqual([expect.objectContaining({ unitId: "player", sourceId: "sigil:bell_bird", on: "battle_start" })]);
    const w = fight(["sigil:supply_mole"]);
    const s = structuredClone(w.s);
    unit(s, "player").mp = 0;
    expect(of(w.run(s, { type: "attack", actorId: "player", targetId: "e1" }).events, "PassiveTriggered")).toHaveLength(1);
    unit(s, "player").statuses = [{ statusId: "seal", sourceId: null, turnsLeft: 3, stacks: 1, fresh: false }];
    expect(of(w.run(s, { type: "attack", actorId: "player", targetId: "e1" }).events, "PassiveTriggered")).toEqual([]);
  });
});
