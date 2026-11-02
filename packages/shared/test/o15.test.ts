/** O15 decided by Nut 2026-10-07: per-skill cooldowns in turns, flee from SPD + monster, revive after 1 turn, no forced end. */
import { describe, expect, it } from "vitest";
import {
  EXAMPLE_SKILLS,
  Rng,
  SkillDefinitionSchema,
  applyCommand,
  createBattle,
  currentActor,
  fleeChance,
  unitFleeBasePct,
  type BattleCommand,
  type BattleEvent,
  type BattleState,
  type KernelResult,
} from "../src/index";
import { baseSetup, companion, content, rules } from "./fixtures";

const ok = (r: KernelResult) => {
  if (!r.ok) throw new Error(`${r.code}: ${r.message}`);
  return r;
};
const c = content();
const unit = (s: BattleState, id: string) => s.units.find((u) => u.unitId === id)!;
const of = <T extends BattleEvent["type"]>(events: BattleEvent[], type: T) => events.filter((e): e is Extract<BattleEvent, { type: T }> => e.type === type);
const run = (s: BattleState, cmd: BattleCommand) => applyCommand(rules, c, s, cmd, { source: "player" });
/** Everyone guards until `who` is up. */
const until = (s: BattleState, who: string) => {
  for (let i = 0; i < 60 && s.status === "active" && currentActor(s)?.unitId !== who; i++) s = ok(run(s, { type: "guard", actorId: currentActor(s)!.unitId })).state;
  return s;
};

describe("cooldowns per skill (O15)", () => {
  it("rules: counted in the owner's turns, CONFIRMED; no OPEN battle rule is left", () => {
    expect(rules.confirmed.cooldownTick).toMatchObject({ value: "owner_turn_start", status: "CONFIRMED", decision: "O15" });
    expect(Object.keys(rules.unresolved)).not.toContain("cooldownTick");
    expect(Object.keys(rules.unresolved)).not.toContain("fleeChance");
    expect(Object.keys(rules.unresolved)).not.toContain("reviveRules");
    expect(Object.keys(rules.unresolved)).not.toContain("stalemateResolution");
  });

  it("every example active skill has its own cooldown, never 1 (that would be every turn)", () => {
    const active = EXAMPLE_SKILLS.filter((s) => s.kind === "active");
    for (const s of active) expect(s.cooldown, s.id).not.toBe(1);
    expect(new Set(active.map((s) => s.cooldown)).size).toBeGreaterThan(2);
    const bad = { ...EXAMPLE_SKILLS.find((s) => s.id === "skill:player_power_strike")!, cooldown: 1 };
    expect(SkillDefinitionSchema.safeParse(bad).success).toBe(false);
  });
});

describe("flee (O15: SPD + the monster's own flee value)", () => {
  const start = (over: Parameters<typeof baseSetup>[0] = {}) => until(ok(createBattle(rules, c, baseSetup(over))).state, "player");

  it("the lowest flee value among living enemies, scaled by player SPD over the fastest enemy SPD", () => {
    const s = start();
    const f = fleeChance(rules, c.species, s, "player");
    if (!f.ok) throw new Error(f.message);
    const spd = (id: string) => unit(s, id).stats.spd;
    expect(f.basePct).toBe(60); // both example species use the NORMAL default
    expect(f.playerSpd).toBe(spd("player"));
    expect(f.enemySpd).toBe(Math.max(spd("e1"), spd("e2")));
    expect(f.chancePct).toBeCloseTo(Math.min(95, Math.max(5, (60 * f.playerSpd) / f.enemySpd)), 10);
  });

  it("a monster's own value counts, an Elite unit is never above the Elite default, a boss is 0", () => {
    const fox = c.species.get("species:ember_fox")!;
    expect(unitFleeBasePct(rules, { ...fox, fleeBasePct: 20 }, { rank: null })).toBe(20);
    expect(unitFleeBasePct(rules, fox, { rank: "ELITE" })).toBe(40);
    expect(unitFleeBasePct(rules, { ...fox, fleeBasePct: 10 }, { rank: "ELITE" })).toBe(10);
    expect(unitFleeBasePct(rules, c.species.get("species:crystal_crab_lord")!, { rank: null })).toBe(0);
  });

  it("bounds: slow players keep 5%, fast ones top out at 95%", () => {
    const s = structuredClone(start());
    unit(s, "player").stats.spd = 1;
    expect(fleeChance(rules, c.species, s, "player")).toMatchObject({ chancePct: 5, capped: "min" });
    unit(s, "player").stats.spd = 10_000;
    expect(fleeChance(rules, c.species, s, "player")).toMatchObject({ chancePct: 95, capped: "max" });
  });

  it("a monster with flee value 0 refuses the command before anything happens; so does a boss fight", () => {
    const c0 = content();
    c0.species.set("species:armor_crab", { ...c0.species.get("species:armor_crab")!, fleeBasePct: 0 });
    const s = until(ok(createBattle(rules, c0, baseSetup())).state, "player");
    const before = JSON.stringify(s);
    expect(applyCommand(rules, c0, s, { type: "flee", actorId: "player" }, { source: "player" })).toMatchObject({ ok: false, code: "FLEE_FORBIDDEN" });
    expect(JSON.stringify(s)).toBe(before);
    expect(fleeChance(rules, c.species, { units: s.units, boss: { bossId: "boss:x" } as BattleState["boss"] }, "player")).toMatchObject({ ok: false, code: "FLEE_FORBIDDEN" });
  });

  it("rolls roll < chance: success ends the fight as fled, failure uses the turn", () => {
    const s = start();
    const f = fleeChance(rules, c.species, s, "player");
    if (!f.ok) throw new Error(f.message);
    const roll = new Rng(s.rng).nextFloat() * 100;
    const r = ok(run(s, { type: "flee", actorId: "player" }));
    const res = of(r.events, "FleeResolved")[0]!;
    expect(res).toMatchObject({ actorId: "player", chancePct: f.chancePct, success: roll < f.chancePct });
    if (res.success) expect(r.state.status).toBe("fled");
    else {
      expect(r.state.status).toBe("active");
      expect(of(r.events, "ActionResolved").find((e) => e.actorId === "player")).toMatchObject({ action: "flee", hit: false });
    }
  });

  it("only the player can flee, and Auto never does", () => {
    const s = until(ok(createBattle(rules, c, baseSetup({ companions: [{ instance: companion("m1", "species:lantern_snail", "WATER"), row: "back", slot: 0 }] }))).state, "ally:m1");
    expect(run(s, { type: "flee", actorId: "ally:m1" }).ok).toBe(false);
  });
});

describe("revive (O15: after 1 turn down, HP % from the skill or item, no limit)", () => {
  const snail = { instance: companion("m1", "species:lantern_snail", "WATER"), row: "back" as const, slot: 0 };
  const start = () => {
    const setup = baseSetup({ companions: [snail], bag: { "item:phoenix_feather": 2 } });
    setup.player.skillIds = ["skill:player_power_strike", "skill:player_rally"];
    return ok(createBattle(rules, c, setup)).state;
  };
  /** The snail falls now (in the current round). */
  const down = (s: BattleState) => {
    const x = structuredClone(s);
    const u = unit(x, "ally:m1");
    u.hp = 0;
    u.ko = true;
    u.downRound = x.round;
    u.fell = true;
    return x;
  };
  const feather = { type: "item" as const, actorId: "player", itemId: "item:phoenix_feather", targetId: "ally:m1" };

  it("not in the round it fell: refused with nothing used", () => {
    const s = down(until(start(), "player"));
    expect(run(s, feather)).toMatchObject({ ok: false, code: "REVIVE_NOT_READY" });
    expect(s.bag["item:phoenix_feather"]).toBe(2);
  });

  it("from the next round: the feather gives 30% max HP, used once; the ally acts again next round", () => {
    let s = down(until(start(), "player"));
    s = ok(run(s, { type: "guard", actorId: "player" })).state;
    s = until(s, "player");
    expect(s.round).toBeGreaterThan(unit(s, "ally:m1").downRound!);
    const r = ok(run(s, feather));
    const m1 = unit(r.state, "ally:m1");
    expect(m1.ko).toBe(false);
    expect(m1.hp).toBe(Math.floor((m1.stats.maxHp * 30) / 100));
    expect(r.state.bag["item:phoenix_feather"]).toBe(1);
    expect(of(r.events, "UnitRevived")).toEqual([expect.objectContaining({ unitId: "ally:m1", sourceId: "item:phoenix_feather", byId: "player" })]);
  });

  it("a revive skill gives its own %, and there is no limit per fight", () => {
    let s = down(until(start(), "player"));
    s = ok(run(s, { type: "guard", actorId: "player" })).state;
    s = until(s, "player");
    const rally = { type: "skill" as const, actorId: "player", skillId: "skill:player_rally", targetId: "ally:m1" };
    s = ok(run(s, rally)).state;
    expect(unit(s, "ally:m1").hp).toBe(Math.floor((unit(s, "ally:m1").stats.maxHp * 25) / 100));
    // Down again, revived again (the feather this time): no cap on revives.
    for (let k = 0; k < 2; k++) {
      s = down(until(s, "player"));
      s = ok(run(s, { type: "guard", actorId: "player" })).state;
      s = until(s, "player");
      s = ok(run(s, feather)).state;
      expect(unit(s, "ally:m1").ko).toBe(false);
    }
  });

  it("only fallen allies: a standing ally or an enemy is refused", () => {
    const s = until(start(), "player");
    expect(run(s, feather)).toMatchObject({ ok: false, code: "INVALID_TARGET" });
    expect(run(s, { ...feather, targetId: "e1" })).toMatchObject({ ok: false, code: "INVALID_TARGET" });
  });

  it("a companion that started the fight down can be revived in round 1", () => {
    const setup = baseSetup({ companions: [{ ...snail, hp: 0 }], bag: { "item:phoenix_feather": 1 } });
    const s0 = ok(createBattle(rules, c, setup)).state;
    expect(unit(s0, "ally:m1").ko).toBe(true);
    expect(s0.round).toBe(1);
    expect(run(until(s0, "player"), feather).ok).toBe(true);
  });
});

describe("no forced end (O15)", () => {
  it("is CONFIRMED and a long stand-off stays active", () => {
    expect(rules.confirmed.forcedFightEnd).toMatchObject({ value: false, status: "CONFIRMED" });
    // Everyone guards for 60 rounds: nobody is made to lose.
    const setup = baseSetup();
    setup.player.gear = { PDEF: 9000, MDEF: 9000, HP: 90_000 };
    let s = ok(createBattle(rules, c, setup)).state;
    for (let i = 0; i < 400 && s.round < 60; i++) s = ok(run(s, { type: "guard", actorId: currentActor(s)!.unitId })).state;
    expect(s.round).toBeGreaterThanOrEqual(60);
    expect(s.status).toBe("active");
  });
});
