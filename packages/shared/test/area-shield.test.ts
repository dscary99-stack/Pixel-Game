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
  type BattleSetup,
  type BattleState,
  type KernelResult,
  type SkillDefinition,
} from "../src/index";
import { baseSetup, companion, content, rules as baseRules } from "./fixtures";

const rules = structuredClone(baseRules);
(rules.provisional.hitChanceClampPct as { value: readonly [number, number] }).value = [100, 100];
(rules.provisional.enemyAi as { value: { skillChancePct: number; healBelowHpPct: number } }).value = { skillChancePct: 0, healBelowHpPct: 50 };

const ok = (r: KernelResult) => {
  if (!r.ok) throw new Error(`${r.code}: ${r.message}`);
  return r;
};
const of = <T extends BattleEvent["type"]>(events: BattleEvent[], type: T) => events.filter((e): e is Extract<BattleEvent, { type: T }> => e.type === type);
const meta = { version: 1, status: "draft" as const, example: true };
const st = (statusId: ActiveStatus["statusId"], extra: Partial<ActiveStatus> = {}): ActiveStatus => ({ statusId, sourceId: null, turnsLeft: 3, stacks: 1, fresh: false, ...extra });
const unit = (s: BattleState, id: string) => s.units.find((u) => u.unitId === id)!;
const edit = (s: BattleState, id: string, f: (u: BattleState["units"][number]) => void) => {
  const next = structuredClone(s);
  f(unit(next, id));
  return next;
};

function world(skills: SkillDefinition[] = [], over: (s: BattleSetup) => void = () => {}) {
  const c = content();
  for (const s of skills) c.skills.set(s.id, s);
  const setup = baseSetup();
  setup.player.skillIds = ["skill:player_sweep", ...skills.filter((s) => s.kind === "active").map((s) => s.id)];
  over(setup);
  let s = ok(createBattle(rules, c, setup)).state;
  for (let i = 0; i < 20 && currentActor(s)?.unitId !== "player"; i++) s = ok(applyCommand(rules, c, s, { type: "guard", actorId: currentActor(s)!.unitId }, { source: "player" })).state;
  const run = (state: BattleState, cmd: BattleCommand) => ok(applyCommand(rules, c, state, cmd, { source: "player" }));
  return { c, s, run };
}
const skill = (skillId: string, targetId = "e1"): BattleCommand => ({ type: "skill", actorId: "player", skillId, targetId });

describe("shield (Nut 2026-10-04: after damage reduction)", () => {
  it("soaks what is left after every reduction, then HP takes the rest; it breaks at 0", () => {
    const w = world();
    const attack: BattleCommand = { type: "attack", actorId: "player", targetId: "e1" };
    const plain = w.run(w.s, attack);
    const final = of(plain.events, "ActionResolved")[0]!.breakdown!.final;
    const hpBefore = unit(w.s, "e1").hp;
    // Same RNG: a shield smaller than the hit soaks its whole size and breaks.
    const small = w.run(edit(w.s, "e1", (e) => (e.statuses = [st("shield", { shieldHp: 5 })])), attack);
    expect(of(small.events, "ActionResolved")[0]).toMatchObject({ damage: final - 5, targetHpAfter: hpBefore - (final - 5) });
    expect(of(small.events, "ShieldChanged")[0]).toMatchObject({ unitId: "e1", change: "broken", amount: 5, shieldLeft: 0 });
    expect(of(small.events, "StatusChanged")[0]).toMatchObject({ statusId: "shield", change: "removed" });
    // A shield bigger than the hit keeps the rest.
    const big = w.run(edit(w.s, "e1", (e) => (e.statuses = [st("shield", { shieldHp: 9999 })])), attack);
    expect(of(big.events, "ActionResolved")[0]).toMatchObject({ damage: 0, targetHpAfter: hpBefore });
    expect(of(big.events, "ShieldChanged")[0]).toMatchObject({ change: "absorbed", amount: final, shieldLeft: 9999 - final });
  });

  it("damage over time goes past the shield", () => {
    const w = world();
    const r = w.run(edit(w.s, "e1", (e) => (e.statuses = [st("shield", { shieldHp: 9999 }), st("poison")])), { type: "guard", actorId: "player" });
    expect(of(r.events, "StatusTick").find((e) => e.unitId === "e1")!.hp).toBeLessThan(0);
  });

  it("a shield skill sizes it by the target's max HP; a second one keeps the bigger", () => {
    const self: SkillDefinition = {
      id: "skill:t_shield",
      ...meta,
      name: { th: "t" },
      kind: "active",
      ownerKind: "player",
      targetRule: "self",
      range: "ranged",
      mpCost: 1,
      cooldown: 0,
      effectSequence: [{ kind: "status", statuses: [{ statusId: "shield", chancePct: 100, turns: 2, shieldPct: 20 }] }],
      tags: [],
    };
    const w = world([self]);
    const max = unit(w.s, "player").stats.maxHp;
    const r = w.run(w.s, skill(self.id, "player"));
    expect(of(r.events, "ShieldChanged")[0]).toMatchObject({ unitId: "player", change: "gained", amount: Math.floor(max / 5), shieldLeft: Math.floor(max / 5) });
    const bigger = w.run(edit(w.s, "player", (p) => (p.statuses = [st("shield", { shieldHp: max })])), skill(self.id, "player"));
    expect(of(bigger.events, "ShieldChanged")[0]).toMatchObject({ change: "gained", shieldLeft: max });
    expect(SkillDefinitionSchema.safeParse({ ...self, effectSequence: [{ kind: "status", statuses: [{ statusId: "shield", chancePct: 100, turns: 2 }] }] }).success).toBe(false);
  });

  it("a shield that runs out of time fires its caster's shield_expired passive", () => {
    const back: SkillDefinition = {
      id: "skill:t_back",
      ...meta,
      name: { th: "t" },
      kind: "passive",
      ownerKind: "companion",
      targetRule: "none",
      range: "melee",
      mpCost: 0,
      cooldown: 0,
      effectSequence: [],
      tags: [],
      passive: PassiveSchema.parse({ triggers: [{ on: "shield_expired", then: [{ kind: "restore_mp", target: "self", amount: 4 }] }] }),
    };
    const w = world([back]);
    const s = edit(w.s, "player", (p) => ((p.passiveIds = [back.id]), (p.mp = 0), (p.statuses = [st("shield", { sourceId: "player", shieldHp: 1, turnsLeft: 1 })])));
    const r = w.run(s, { type: "guard", actorId: "player" });
    expect(of(r.events, "PassiveTriggered")).toContainEqual(expect.objectContaining({ unitId: "player", on: "shield_expired" }));
  });
});

describe("area skills (Nut 2026-10-04)", () => {
  it("a row skill hits the chosen enemy's whole row, each with its own roll; the back row is spared", () => {
    const front = world();
    const r = front.run(front.s, skill("skill:player_sweep"));
    expect(of(r.events, "ActionResolved").filter((e) => e.actorId === "player").map((e) => e.targetId)).toEqual(["e1", "e2"]);
    const split = world([], (s) => (s.enemies[1] = { ...s.enemies[1]!, row: "back", slot: 0 }));
    const r2 = split.run(split.s, skill("skill:player_sweep"));
    expect(of(r2.events, "ActionResolved").filter((e) => e.actorId === "player").map((e) => e.targetId)).toEqual(["e1"]);
  });

  it("an all-enemies ranged skill reaches both rows; area hits ignore protect", () => {
    const blast: SkillDefinition = {
      id: "skill:t_blast",
      ...meta,
      name: { th: "t" },
      kind: "active",
      ownerKind: "player",
      targetRule: "all_enemies",
      range: "ranged",
      mpCost: 1,
      cooldown: 0,
      effectSequence: [{ kind: "damage", damageType: "magic", coefficient: 0.2, flat: 0, element: "NEUTRAL" }],
      tags: [],
    };
    const w = world([blast], (s) => (s.enemies[1] = { ...s.enemies[1]!, row: "back", slot: 0 }));
    const guarded = edit(w.s, "e2", (e) => (e.statuses = [st("protect", { sourceId: "e1" })]));
    const r = w.run(guarded, skill(blast.id, "e2"));
    expect(of(r.events, "ActionResolved").filter((e) => e.actorId === "player").map((e) => e.targetId).sort()).toEqual(["e1", "e2"]);
    expect(SkillDefinitionSchema.safeParse({ ...blast, targetRule: "all_allies" }).success).toBe(false);
  });

  it("a team shield covers every living ally", () => {
    const c = content();
    const setup = baseSetup({ companions: [{ instance: { ...companion("m1", "species:armor_crab", "EARTH", 200), rebirthStage: 1, rebirthChoices: { "1": "B" } }, row: "back", slot: 0 }] });
    setup.player.level = 200;
    let s = ok(createBattle(rules, c, setup)).state;
    for (let i = 0; i < 20 && currentActor(s)?.unitId !== "ally:m1"; i++) s = ok(applyCommand(rules, c, s, { type: "guard", actorId: currentActor(s)!.unitId }, { source: "player" })).state;
    expect(unit(s, "ally:m1").skillIds).toContain("skill:crab_shield_shared");
    const r = ok(applyCommand(rules, c, s, { type: "skill", actorId: "ally:m1", skillId: "skill:crab_shield_shared", targetId: "ally:m1" }, { source: "player" }));
    expect(of(r.events, "ShieldChanged").filter((e) => e.change === "gained").map((e) => e.unitId).sort()).toEqual(["ally:m1", "player"]);
  });
});
