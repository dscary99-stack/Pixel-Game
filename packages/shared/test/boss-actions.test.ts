import { describe, expect, it } from "vitest";
import {
  applyCommand,
  createBattle,
  currentActor,
  SpeciesDefinitionSchema,
  type ActiveStatus,
  type BattleEvent,
  type BattleSetup,
  type BattleState,
  type KernelResult,
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
const st = (statusId: ActiveStatus["statusId"], extra: Partial<ActiveStatus> = {}): ActiveStatus => ({ statusId, sourceId: null, turnsLeft: 3, stacks: 1, fresh: false, ...extra });
const unit = (s: BattleState, id: string) => s.units.find((u) => u.unitId === id)!;

/** The crab as a boss with `actions` per round. */
function bossContent(actions: number | undefined) {
  const c = content();
  const crab = c.species.get("species:armor_crab")!;
  c.species.set(crab.id, { ...crab, rank: "BOSS", ...(actions === undefined ? {} : { bossActionsPerRound: actions }) });
  return c;
}

function world(actions: number | undefined, over: (s: BattleSetup) => void = () => {}) {
  const c = bossContent(actions);
  const setup = baseSetup();
  setup.player.level = 200;
  setup.player.gear = { PDEF: 400, MDEF: 400, HP: 50_000 };
  over(setup);
  const start = ok(createBattle(rules, c, setup));
  /** Guards with every ally until `n` more rounds have started; returns all events seen. */
  const rounds = (state: BattleState, n: number) => {
    let s = state;
    const events: BattleEvent[] = [];
    const target = s.round + n;
    for (let i = 0; i < 200 && s.status === "active" && s.round < target; i++) {
      const r = ok(applyCommand(rules, c, s, { type: "guard", actorId: currentActor(s)!.unitId }, { source: "player" }));
      events.push(...r.events);
      s = r.state;
    }
    return { s, events };
  };
  return { c, start, rounds };
}

describe("boss actions per round (chapter 03, P15 bossActions)", () => {
  it("only a BOSS species may act more than once, up to the rule's max", () => {
    const crab = content().species.get("species:armor_crab")!;
    expect(SpeciesDefinitionSchema.safeParse({ ...crab, rank: "BOSS", bossActionsPerRound: 3 }).success).toBe(true);
    expect(SpeciesDefinitionSchema.safeParse({ ...crab, bossActionsPerRound: 2 }).success).toBe(false);
    expect(SpeciesDefinitionSchema.safeParse({ ...crab, rank: "BOSS", bossActionsPerRound: 4 }).success).toBe(false);
    expect(SpeciesDefinitionSchema.safeParse({ ...crab, rank: "BOSS", bossActionsPerRound: 1 }).success).toBe(false);
  });

  it("a 3-action boss has 3 slots in the round's shown order, spread by SPD; each turn says which action it is", () => {
    const w = world(3);
    const order = of(w.start.events, "RoundStarted")[0]!.order;
    expect(order.filter((id) => id === "e1")).toHaveLength(3);
    expect(order.filter((id) => id === "e2")).toHaveLength(1);
    expect(order.filter((id) => id === "player")).toHaveLength(1);
    const { events } = w.rounds(w.start.state, 2);
    const turns = of([...w.start.events, ...events], "TurnStarted").filter((e) => e.unitId === "e1");
    expect(turns.slice(0, 3).map((e) => [e.action, e.actionsThisRound])).toEqual([[1, 3], [2, 3], [3, 3]]);
    expect(of(events, "TurnStarted").filter((e) => e.unitId !== "e1").every((e) => e.action === undefined)).toBe(true);
    const enemyActs = of([...w.start.events, ...events], "ActionResolved").filter((e) => e.actorId === "e1");
    expect(enemyActs.length).toBeGreaterThanOrEqual(3);
  });

  it("a boss without the field, and a non-boss, act once", () => {
    const w = world(undefined);
    expect(of(w.start.events, "RoundStarted")[0]!.order.filter((id) => id === "e1")).toHaveLength(1);
  });

  it("never carries over to a companion of that species", () => {
    const w = world(3, (s) => (s.companions = [{ instance: companion("m1", "species:armor_crab", "EARTH", 50), row: "back", slot: 0 }]));
    expect(unit(w.start.state, "ally:m1").actionsPerRound).toBeUndefined();
    expect(of(w.start.events, "RoundStarted")[0]!.order.filter((id) => id === "ally:m1")).toHaveLength(1);
  });

  it("statuses tick and count down once a round, not once per action", () => {
    const w = world(3);
    const s = structuredClone(w.start.state);
    unit(s, "e1").statuses = [st("poison", { turnsLeft: 3 })];
    const { s: after, events } = w.rounds(s, 1);
    // The round already in progress plus one full round: at most 2 ticks, never 3 per round.
    const ticks = of(events, "StatusTick").filter((e) => e.unitId === "e1" && e.statusId === "poison");
    const roundsSeen = 1 + (after.round - s.round);
    expect(ticks.length).toBeLessThanOrEqual(roundsSeen);
    const poison = unit(after, "e1").statuses?.find((x) => x.statusId === "poison");
    expect(poison === undefined ? 0 : poison.turnsLeft).toBe(3 - ticks.length);
  });

  it("a turn-skip roll costs only that action; each action rolls its own", () => {
    const w = world(3);
    const s = structuredClone(w.start.state);
    // Placed directly: a boss is immune to hard control when it is applied, so this tests the per-action roll only.
    unit(s, "e1").statuses = [st("stun", { turnsLeft: 1 })];
    const { events } = w.rounds(s, 2);
    const skipped = of(events, "TurnSkipped").filter((e) => e.unitId === "e1");
    const turnsBeforeExpiry: BattleEvent[] = [];
    for (const e of events) {
      if (e.type === "StatusChanged" && e.unitId === "e1" && e.statusId === "stun" && e.change === "expired") break;
      if (e.type === "TurnStarted" && e.unitId === "e1") turnsBeforeExpiry.push(e);
    }
    expect(skipped.length).toBe(turnsBeforeExpiry.length);
    expect(skipped.length).toBeGreaterThanOrEqual(1);
    // After it wears off at the end of the boss's round, the boss acts again.
    expect(of(events, "ActionResolved").some((e) => e.actorId === "e1")).toBe(true);
  });

  it("a knock-out ends the boss's remaining actions", () => {
    const w = world(3);
    const s = structuredClone(w.start.state);
    const e1 = unit(s, "e1");
    e1.hp = 0;
    e1.ko = true;
    const { events } = w.rounds(s, 2);
    expect(of(events, "TurnStarted").some((e) => e.unitId === "e1")).toBe(false);
  });

  it("delay moves only the boss's next slot to the end, not all of them", () => {
    const w = world(3);
    const s = structuredClone(w.start.state);
    const before = s.turnOrder.map((id, i) => (id === "e1" && i > s.turnIndex ? i : -1)).filter((i) => i >= 0);
    expect(before.length).toBeGreaterThanOrEqual(1);
    // Use the kernel's own instant effect through a fixture skill.
    const c = w.c;
    c.skills.set("skill:t_delay", {
      id: "skill:t_delay",
      version: 1,
      status: "draft",
      example: true,
      name: { th: "t" },
      kind: "active",
      ownerKind: "player",
      targetRule: "single_enemy",
      range: "ranged",
      mpCost: 1,
      cooldown: 0,
      effectSequence: [{ kind: "status", statuses: [{ statusId: "delay", chancePct: 100, turns: 1 }] }],
      tags: [],
    });
    unit(s, "player").skillIds = ["skill:t_delay"];
    unit(s, "player").skillLevels = { "skill:t_delay": 1 };
    expect(currentActor(s)!.unitId).toBe("player");
    const pending = s.turnOrder.filter((id, i) => id === "e1" && i > s.turnIndex).length;
    expect(pending).toBeGreaterThanOrEqual(2);
    const r = ok(applyCommand(rules, c, s, { type: "skill", actorId: "player", skillId: "skill:t_delay", targetId: "e1" }, { source: "player" }));
    const changed = of(r.events, "StatusChanged").find((e) => e.statusId === "delay");
    expect(changed).toBeDefined();
    // Same round: the boss still has every pending action it had.
    const turnsThisRound = of(r.events, "TurnStarted").filter((e) => e.unitId === "e1" && e.seq < (of(r.events, "RoundStarted")[0]?.seq ?? Infinity));
    expect(turnsThisRound.length).toBe(pending);
  });
});
