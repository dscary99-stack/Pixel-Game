/** Elite packs (chapter 07 §3, elite.ts): the leader's numbers, its modifiers in the kernel, rewards and the pack roll. */
import { describe, expect, it } from "vitest";
import {
  ELITE_ALLOWED_PAIRS,
  ELITE_MODIFIERS,
  Rng,
  applyCommand,
  chooseAutoCommand,
  createBattle,
  currentActor,
  eliteModifierIssues,
  exampleMapRegistry,
  packEnemies,
  rollEliteModifiers,
  rollPack,
  seedRng,
  visiblePack,
  type BattleEvent,
  type BattleSetup,
  type BattleState,
  type EliteModifier,
  type KernelResult,
  type RulesConfig,
} from "../src/index";
import { baseSetup, companion, content, rules as R } from "./fixtures";

const ok = (r: KernelResult) => {
  if (!r.ok) throw new Error(`${r.code}: ${r.message}`);
  return r;
};
const of = <T extends BattleEvent["type"]>(events: BattleEvent[], type: T) => events.filter((e): e is Extract<BattleEvent, { type: T }> => e.type === type);
const sureHits = (base: RulesConfig, skillChancePct = 0): RulesConfig => {
  const r = structuredClone(base);
  (r.provisional.hitChanceClampPct as { value: readonly [number, number] }).value = [100, 100];
  (r.provisional.enemyAi as { value: { skillChancePct: number; healBelowHpPct: number } }).value = { skillChancePct, healBelowHpPct: 50 };
  return r;
};

/** An elite crab (front) with a fox behind it; a companion-free player at the front. */
function eliteFight(modifiers: EliteModifier[], rules = sureHits(R), over: (s: BattleSetup) => void = () => {}) {
  const c = content();
  const setup = baseSetup();
  setup.player.primaryStats = { STR: 35, VIT: 80, INT: 40, DEX: 17, AGI: 40, SPI: 10 };
  setup.enemies = [
    { unitId: "e1", speciesId: "species:armor_crab", element: "EARTH", row: "front", slot: 0, elite: { modifiers } },
    { unitId: "e2", speciesId: "species:ember_fox", element: "FIRE", row: "back", slot: 1 },
  ];
  over(setup);
  const r = ok(createBattle(rules, c, setup));
  return { c, rules, r, s: r.state };
}
const unit = (s: BattleState, id: string) => s.units.find((u) => u.unitId === id)!;

describe("elite modifiers roll", () => {
  it("one modifier below the level line, an allowed pair from it", () => {
    for (let i = 0; i < 30; i++) {
      const one = rollEliteModifiers(R, 5, new Rng(seedRng(`a${i}`)));
      expect(one).toHaveLength(1);
      expect(ELITE_MODIFIERS).toContain(one[0]);
      const two = rollEliteModifiers(R, 80, new Rng(seedRng(`b${i}`)));
      expect(eliteModifierIssues(two)).toEqual([]);
      expect(two).toHaveLength(2);
    }
    expect(eliteModifierIssues(["crystal_shield", "morale"])).toHaveLength(1);
    expect(eliteModifierIssues([])).toHaveLength(1);
    for (const [a, b] of ELITE_ALLOWED_PAIRS) expect(a).not.toBe(b);
  });

  it("an ELITE spawn gives its leader modifiers, shown before engaging and carried into the fight", () => {
    const c = content();
    const spawn = exampleMapRegistry().get("map:dawn_field")!.spawns.find((sp) => sp.rank === "ELITE")!;
    const p = rollPack(spawn, "p1", new Rng(seedRng("elite")), { rules: R, species: c.species });
    expect(p.members[0]!.elite).toHaveLength(1);
    expect(p.members.slice(1).every((m) => m.elite === undefined)).toBe(true);
    expect(visiblePack(p, c.species)).toMatchObject({ rank: "ELITE", leader: { elite: p.members[0]!.elite } });
    expect(packEnemies(p)[0]).toMatchObject({ unitId: "e1", elite: { modifiers: p.members[0]!.elite } });
    expect(() => rollPack(spawn, "p2", new Rng(seedRng("x")))).toThrow();
  });
});

describe("elite leader in a fight", () => {
  it("has more HP and power than its species, ranks ELITE, and gives more EXP", () => {
    const normal = ok(createBattle(R, content(), baseSetup())).state;
    const { s } = eliteFight(["backline_hunter"], R);
    const base = unit(normal, "e1");
    const elite = unit(s, "e1");
    const el = R.provisional.elite.value;
    expect(elite.stats.maxHp).toBe(Math.floor(base.stats.maxHp * el.hpMultiplier));
    expect(elite.stats.patk).toBe(Math.floor((base.stats.patk * el.powerPct) / 100));
    expect(elite.rank).toBe("ELITE");
    const kill = (st: BattleState) => {
      const next = structuredClone(st);
      unit(next, "e1").hp = 1;
      let cur = next;
      for (let i = 0; i < 20 && cur.status === "active" && cur.resolutions["e1"] === undefined; i++) {
        const actor = currentActor(cur)!;
        const cmd = actor.unitId === "player" ? { type: "attack" as const, actorId: "player", targetId: "e1" } : chooseAutoCommand(cur)!;
        cur = ok(applyCommand(sureHits(R), content(), cur, cmd, { source: "player" })).state;
      }
      return cur.entitlements.find((e) => e.kind === "kill" && e.enemyUnitId === "e1")!;
    };
    expect(kill(s).exp).toBe(kill(normal).exp! * (el.expPct / 100));
  });

  it("refuses a boss as elite and a pair that is not allowed", () => {
    const c = content();
    const setup = baseSetup();
    setup.enemies[0] = { ...setup.enemies[0]!, elite: { modifiers: ["crystal_shield", "morale"] } };
    expect(createBattle(R, c, setup)).toMatchObject({ ok: false, code: "INVALID_COMMAND" });
  });

  it("crystal shield: starts behind a shield of its max HP share", () => {
    const { r, s } = eliteFight(["crystal_shield"]);
    const e1 = unit(s, "e1");
    const shield = e1.statuses!.find((x) => x.statusId === "shield")!;
    expect(shield.shieldHp).toBe(Math.floor((e1.stats.maxHp * R.provisional.elite.value.crystalShieldPct) / 100));
    expect(of(r.events, "EliteTrait")).toEqual([expect.objectContaining({ unitId: "e1", modifier: "crystal_shield", change: "active" })]);
  });

  it("morale: the pack fights buffed until the elite falls, then the buff ends", () => {
    const { c, rules, s } = eliteFight(["morale"]);
    const fox = unit(s, "e2");
    expect(fox.statuses!.map((x) => x.statusId).sort()).toEqual(["atk_up", "matk_up"]);
    expect(unit(s, "e1").statuses ?? []).toEqual([]);
    const low = structuredClone(s);
    unit(low, "e1").hp = 1;
    let cur = low;
    for (let i = 0; i < 20 && currentActor(cur)?.unitId !== "player"; i++) cur = ok(applyCommand(rules, c, cur, chooseAutoCommand(cur)!, { source: "player" })).state;
    const r = ok(applyCommand(rules, c, cur, { type: "attack", actorId: "player", targetId: "e1" }, { source: "player" }));
    expect(of(r.events, "EliteTrait")).toContainEqual(expect.objectContaining({ modifier: "morale", change: "broken" }));
    expect(unit(r.state, "e2").statuses!.some((x) => x.statusId === "atk_up" || x.statusId === "matk_up")).toBe(false);
  });

  it("low HP enrage: once under the line it gets ATK and SPD up, only once", () => {
    const { c, rules, s } = eliteFight(["low_hp_enrage"]);
    let cur = structuredClone(s);
    const e1 = unit(cur, "e1");
    e1.hp = Math.floor((e1.stats.maxHp * R.provisional.elite.value.enrageBelowHpPct) / 100) + 5;
    for (let i = 0; i < 20 && currentActor(cur)?.unitId !== "player"; i++) cur = ok(applyCommand(rules, c, cur, chooseAutoCommand(cur)!, { source: "player" })).state;
    const r = ok(applyCommand(rules, c, cur, { type: "skill", actorId: "player", skillId: "skill:player_power_strike", targetId: "e1" }, { source: "player" }));
    const enraged = of(r.events, "EliteTrait").filter((e) => e.change === "enraged");
    expect(enraged).toHaveLength(1);
    expect(unit(r.state, "e1").statuses!.map((x) => x.statusId)).toEqual(expect.arrayContaining(["atk_up", "spd_up"]));
    expect(unit(r.state, "e1").elite!.enraged).toBe(true);
  });

  it("backline hunter: hits the back row while the front row stands; a normal leader cannot", () => {
    const run = (mods: EliteModifier[] | null) => {
      const c = content();
      const rules = sureHits(R, 0);
      const setup = baseSetup();
      setup.player.primaryStats = { STR: 35, VIT: 80, INT: 10, DEX: 17, AGI: 1, SPI: 10 };
      setup.companions = [{ instance: companion("m1", "species:lantern_snail", "LIGHT", 20), row: "back", slot: 1 }];
      setup.enemies = [{ unitId: "e1", speciesId: "species:armor_crab", element: "EARTH", row: "front", slot: 0, ...(mods === null ? {} : { elite: { modifiers: mods } }) }];
      let st = ok(createBattle(rules, c, setup)).state;
      const targets: string[] = [];
      for (let i = 0; i < 30 && targets.length < 4 && st.status === "active"; i++) {
        const actor = currentActor(st)!;
        const r = ok(applyCommand(rules, c, st, { type: "guard", actorId: actor.unitId }, { source: "player" }));
        for (const e of of(r.events, "ActionResolved")) if (e.actorId === "e1" && e.targetId !== null) targets.push(e.targetId);
        st = r.state;
      }
      return targets;
    };
    expect(run(null).every((t) => t === "player")).toBe(true);
    const hunter = run(["backline_hunter"]);
    expect(hunter.length).toBeGreaterThan(0);
    expect(hunter.every((t) => t === "ally:m1")).toBe(true);
  });

  it("magic counter: magic on it warns, then its next action is a heavy magic strike on the caster", () => {
    const { c, rules, s } = eliteFight(["magic_counter"], sureHits(R), (setup) => {
      setup.player.skillIds = ["skill:player_power_strike", "skill:snail_glare"];
    });
    let cur = s;
    for (let i = 0; i < 20 && currentActor(cur)?.unitId !== "player"; i++) cur = ok(applyCommand(rules, c, cur, chooseAutoCommand(cur)!, { source: "player" })).state;
    const hit = ok(applyCommand(rules, c, cur, { type: "skill", actorId: "player", skillId: "skill:snail_glare", targetId: "e1" }, { source: "player" }));
    const warned = of(hit.events, "EliteTrait").find((e) => e.change === "warned");
    expect(warned).toMatchObject({ unitId: "e1", modifier: "magic_counter", targetId: "player" });
    // The counter fires on e1's next action (it may already be in the same command's enemy turns).
    let events = hit.events;
    let st = hit.state;
    for (let i = 0; i < 10 && !events.some((e) => e.type === "EliteTrait" && e.change === "fired") && st.status === "active"; i++) {
      const r = ok(applyCommand(rules, c, st, { type: "guard", actorId: currentActor(st)!.unitId }, { source: "player" }));
      events = [...events, ...r.events];
      st = r.state;
    }
    const fired = events.findIndex((e) => e.type === "EliteTrait" && e.change === "fired");
    expect(fired).toBeGreaterThan(-1);
    const strike = events.slice(fired).find((e) => e.type === "ActionResolved" && e.actorId === "e1");
    expect(strike).toMatchObject({ targetId: "player", action: "attack" });
    expect((strike as Extract<BattleEvent, { type: "ActionResolved" }>).breakdown).toBeTruthy();
    expect(unit(st, "e1").elite!.counterOn).toBeNull();
  });
});
