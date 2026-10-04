import { describe, expect, it } from "vitest";
import {
  applyCommand,
  BossDefinitionSchema,
  bossEnemies,
  createBattle,
  currentActor,
  EXAMPLE_BOSSES,
  AutoHuntSettingsSchema,
  exampleMapRegistry,
  packAllowed,
  validateMaps,
  visibleBoss,
  type ActiveStatus,
  type BattleCommand,
  type BattleEvent,
  type BattleSetup,
  type BattleState,
  type BossDefinition,
  type KernelResult,
} from "../src/index";
import { baseSetup, content, rules as baseRules } from "./fixtures";

const rules = structuredClone(baseRules);
(rules.provisional.hitChanceClampPct as { value: readonly [number, number] }).value = [100, 100];
(rules.provisional.enemyAi as { value: { skillChancePct: number; healBelowHpPct: number } }).value = { skillChancePct: 0, healBelowHpPct: 50 };

const LORD = EXAMPLE_BOSSES[0]!;
const ok = (r: KernelResult) => {
  if (!r.ok) throw new Error(`${r.code}: ${r.message}`);
  return r;
};
const of = <T extends BattleEvent["type"]>(events: BattleEvent[], type: T) => events.filter((e): e is Extract<BattleEvent, { type: T }> => e.type === type);
const st = (statusId: ActiveStatus["statusId"], extra: Partial<ActiveStatus> = {}): ActiveStatus => ({ statusId, sourceId: null, turnsLeft: 3, stacks: 1, fresh: false, ...extra });
const unit = (s: BattleState, id: string) => s.units.find((u) => u.unitId === id)!;

function world(over: (s: BattleSetup) => void = () => {}, def: BossDefinition = LORD) {
  const c = content();
  c.bosses.set(def.id, def);
  const setup = baseSetup({ enemies: [], boss: { bossId: def.id } });
  setup.player.level = 200;
  setup.player.gear = { PDEF: 600, MDEF: 600, HP: 80_000, PATK: 10 };
  setup.bag = { ...setup.bag, "item:crystal_crab_lord_capture": 2 };
  over(setup);
  const start = ok(createBattle(rules, c, setup));
  const run = (s: BattleState, cmd: BattleCommand) => ok(applyCommand(rules, c, s, cmd, { source: "player" }));
  /** Every ally guards until `round` has started; returns all events seen. */
  const until = (state: BattleState, round: number) => {
    let s = state;
    const events: BattleEvent[] = [];
    for (let i = 0; i < 300 && s.status === "active" && s.round < round; i++) {
      const r = run(s, { type: "guard", actorId: currentActor(s)!.unitId });
      events.push(...r.events);
      s = r.state;
    }
    return { s, events };
  };
  return { c, start, run, until };
}

describe("boss definitions (chapter 07 §5)", () => {
  it("the first phase has no trigger, later ones do, and some phase opens capture", () => {
    expect(BossDefinitionSchema.safeParse(LORD).success).toBe(true);
    const [p1, p2] = LORD.phases as [BossDefinition["phases"][number], BossDefinition["phases"][number]];
    expect(BossDefinitionSchema.safeParse({ ...LORD, phases: [{ ...p1, enterWhen: [{ kind: "hp_below", pct: 50 }] }, p2] }).success).toBe(false);
    expect(BossDefinitionSchema.safeParse({ ...LORD, phases: [p1, { ...p2, enterWhen: [] }] }).success).toBe(false);
    expect(BossDefinitionSchema.safeParse({ ...LORD, phases: [p1, { ...p2, captureBelowHpPct: undefined }] }).success).toBe(false);
  });

  it("the boss is e1 front-centre; adds take their row's free slots", () => {
    expect(bossEnemies(LORD)).toEqual([
      { unitId: "e1", speciesId: "species:crystal_crab_lord", element: "WATER", row: "front", slot: 2 },
      { unitId: "e2", speciesId: "species:lantern_snail", element: "WATER", row: "back", slot: 2, lootEligible: true },
      { unitId: "e3", speciesId: "species:lantern_snail", element: "LIGHT", row: "back", slot: 1, lootEligible: true },
    ]);
  });
});

describe("boss fights", () => {
  it("starts in phase 1 with its HP multiplier, two actions and the crystal shell; refuses a pack or an unknown boss", () => {
    const w = world();
    const boss = unit(w.start.state, "e1");
    const plain = createBattle(rules, content(), baseSetup({ enemies: [{ unitId: "e1", speciesId: "species:crystal_crab_lord", element: "WATER", row: "front", slot: 2 }] }));
    const plainHp = ok(plain).state.units.find((u) => u.unitId === "e1")!.stats.maxHp;
    expect(boss.stats.maxHp).toBe(Math.floor(plainHp * 4));
    expect(boss.actionsPerRound).toBe(2);
    expect(boss.captureWindowOpen).toBe(false);
    expect(of(w.start.events, "BossPhaseChanged")).toEqual([expect.objectContaining({ unitId: "e1", phase: 0, phaseId: "shell" })]);
    expect(of(w.start.events, "ShieldChanged")[0]).toMatchObject({ unitId: "e1", change: "gained", amount: Math.floor((boss.stats.maxHp * 30) / 100) });
    expect(w.start.state.boss).toMatchObject({ bossId: LORD.id, phase: 0, telegraph: null });
    const c = content();
    expect(createBattle(rules, c, baseSetup({ boss: { bossId: LORD.id } }))).toMatchObject({ ok: false, code: "INVALID_COMMAND" });
    expect(createBattle(rules, c, baseSetup({ enemies: [], boss: { bossId: "boss:nope" } }))).toMatchObject({ ok: false, code: "MISSING_REFERENCE" });
  });

  it("warns of the shockwave at a round's start and uses it on its first action next round, on every ally", () => {
    const w = world();
    const { s, events } = w.until(w.start.state, 5);
    const tg = of(events, "BossTelegraph");
    expect(tg[0]).toMatchObject({ change: "announced", skillId: "skill:lord_shockwave", firesRound: 4 });
    expect(tg[1]).toMatchObject({ change: "fired", firesRound: 4 });
    // Announced right after round 3 starts, so everyone has a turn before it lands.
    const round3 = events.findIndex((e) => e.type === "RoundStarted" && e.round === 3);
    expect(events.indexOf(tg[0]!)).toBe(round3 + 1);
    const fired = events.indexOf(tg[1]!);
    const hits = events.slice(fired).filter((e): e is Extract<BattleEvent, { type: "ActionResolved" }> => e.type === "ActionResolved" && e.skillId === "skill:lord_shockwave");
    expect(hits.map((h) => h.targetId)).toEqual(["player"]);
    // The AI never uses the move unannounced.
    const before = events.slice(0, fired).filter((e) => e.type === "ActionResolved" && e.skillId === "skill:lord_shockwave");
    expect(before).toEqual([]);
    expect(s.boss!.telegraph).toBeNull();
  });

  it("breaking the shell starts phase 2: it takes more, hits harder, and the pending warning is called off", () => {
    const w = world();
    const { s } = w.until(w.start.state, 3);
    expect(s.boss!.telegraph).not.toBeNull();
    const cracked = structuredClone(s);
    unit(cracked, "e1").statuses = unit(cracked, "e1").statuses!.map((x) => (x.statusId === "shield" ? { ...x, shieldHp: 1 } : x));
    const actor = currentActor(cracked)!;
    expect(actor.unitId).toBe("player");
    const r = w.run(cracked, { type: "attack", actorId: "player", targetId: "e1" });
    expect(of(r.events, "ShieldChanged")).toContainEqual(expect.objectContaining({ unitId: "e1", change: "broken" }));
    expect(of(r.events, "BossTelegraph")).toContainEqual(expect.objectContaining({ change: "cancelled" }));
    expect(of(r.events, "BossPhaseChanged")).toContainEqual(expect.objectContaining({ phase: 1, phaseId: "broken" }));
    const ids = unit(r.state, "e1").statuses!.map((x) => x.statusId);
    expect(ids).toEqual(expect.arrayContaining(["vulnerable", "atk_up"]));
  });

  it("half HP also starts phase 2 (and takes the shell off); capture opens only below 30%", () => {
    const w = world();
    const s = structuredClone(w.start.state);
    expect(currentActor(s)!.unitId).toBe("player");
    const boss = unit(s, "e1");
    boss.hp = Math.floor(boss.stats.maxHp * 0.45);
    const refused = w.run(s, { type: "guard", actorId: "player" });
    expect(of(refused.events, "BossPhaseChanged")).toContainEqual(expect.objectContaining({ phase: 1 }));
    expect(unit(refused.state, "e1").statuses!.some((x) => x.statusId === "shield")).toBe(false);
    expect(unit(refused.state, "e1").captureWindowOpen).toBe(false);
    const low = structuredClone(refused.state);
    const lb = unit(low, "e1");
    lb.hp = Math.floor(lb.stats.maxHp * 0.25);
    const { s: after, events } = w.until(low, low.round + 1);
    expect(of(events, "CaptureWindowOpened")).toEqual([expect.objectContaining({ unitId: "e1" })]);
    expect(unit(after, "e1").captureWindowOpen).toBe(true);
  });

  it("the capture item is refused while the window is shut", () => {
    const w = world();
    const r = applyCommand(rules, w.c, w.start.state, { type: "capture", actorId: "player", targetId: "e1", itemId: "item:crystal_crab_lord_capture" }, { source: "player" });
    expect(r).toMatchObject({ ok: false, code: "NO_VALID_CAPTURE_WINDOW" });
  });

  it("silence on the boss calls the warned move off", () => {
    const w = world();
    const { s } = w.until(w.start.state, 4);
    expect(s.boss!.telegraph).toMatchObject({ firesRound: 4 });
    const quiet = structuredClone(s);
    unit(quiet, "e1").statuses!.push(st("silence"));
    const { events } = w.until(quiet, 5);
    expect(of(events, "BossTelegraph")).toContainEqual(expect.objectContaining({ change: "cancelled" }));
    expect(events.some((e) => e.type === "ActionResolved" && e.skillId === "skill:lord_shockwave")).toBe(false);
  });

  it("adds without loot eligibility give EXP but no items", () => {
    const def: BossDefinition = { ...LORD, id: "boss:t_noloot", adds: LORD.adds.map((a) => ({ ...a, lootEligible: false })) };
    const w = world((setup) => (setup.player.basicAttackRange = "ranged"), def);
    const s = structuredClone(w.start.state);
    unit(s, "e2").hp = 1;
    const r = w.run(s, { type: "attack", actorId: "player", targetId: "e2" });
    const kill = of(r.events, "RewardEntitled").map((e) => e.entitlement).find((e) => e.kind === "kill" && e.enemyUnitId === "e2");
    expect(kill).toMatchObject({ kind: "kill", items: [] });
    expect(kill!.exp).toBeGreaterThan(0);
  });
});

describe("boss lairs on the map (P17, C14, C30)", () => {
  it("the field shows its boss as a BOSS target that Auto Hunt never picks; towns have none and fields need one", () => {
    const c = content();
    const maps = exampleMapRegistry();
    const field = maps.get("map:dawn_field")!;
    const v = visibleBoss(field, c.bosses, c.species)!;
    expect(v).toMatchObject({ packId: "map:dawn_field#boss", rank: "BOSS", sizeRange: [3, 3], bossId: LORD.id, leader: { speciesId: LORD.speciesId, level: 8 } });
    expect(packAllowed(AutoHuntSettingsSchema.parse({}), v)).toBe(false);
    expect(visibleBoss(maps.get("map:dawn_town")!, c.bosses, c.species)).toBeNull();
    const noBoss = { ...field, bossLair: undefined };
    expect(validateMaps([noBoss, maps.get("map:dawn_town")!]).map((i) => i.message)).toContain("every hunting map has a boss (C30)");
    expect(validateMaps([field, maps.get("map:dawn_town")!], c.species, new Map())).toContainEqual(expect.objectContaining({ message: `boss lair uses unknown boss ${LORD.id}` }));
  });
});
