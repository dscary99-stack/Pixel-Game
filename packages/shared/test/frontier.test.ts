/** Weekly tower (frontier.ts): Nut's confirmed rules, floor rolls, kernel scaling, boss floors, capture, loot, HP between floors. */
import { describe, expect, it } from "vitest";
import {
  EXAMPLE_FRONTIER as T,
  EXAMPLE_FRONTIER_BOSSES,
  FrontierDefinitionSchema,
  applyCommand,
  chooseAutoCommand,
  createBattle,
  currentActor,
  deriveStats,
  dropChance,
  exampleMapRegistry,
  frontierFloorSetup,
  frontierFloorSpecies,
  frontierPackSize,
  frontierSpeciesPool,
  frontierStatPct,
  frontierVitalsAfter,
  isFrontierBossFloor,
  isRareDrop,
  rollFrontierFloor,
  validateFrontier,
  type BattleEvent,
  type BattleState,
  type KernelResult,
} from "../src/index";
import { baseSetup, content, fixtureRules, rules as R } from "./fixtures";

const ok = (r: KernelResult) => {
  if (!r.ok) throw new Error(`${r.code}: ${r.message}`);
  return r;
};
const c = content();
const fc = { ...c, maps: exampleMapRegistry() };
const unit = (s: BattleState, id: string) => s.units.find((u) => u.unitId === id)!;

describe("Nut's decisions are CONFIRMED rules", () => {
  it("floor by floor, once a week, stronger each floor, a boss every 10, 100 floors, rare boss items, capture", () => {
    const k = R.confirmed;
    expect([k.frontierFloorByFloor.value, k.frontierEntriesPerWeek.value, k.frontierEnemiesGrowPerFloor.value, k.frontierBossEveryFloors.value, k.frontierFloors.value, k.frontierForBossRareItems.value, k.frontierCapture.value]).toEqual([true, 1, true, 10, 100, true, true]);
    for (const r of [k.frontierFloorByFloor, k.frontierEntriesPerWeek, k.frontierBossEveryFloors, k.frontierFloors, k.frontierCapture]) {
      expect(r.status).toBe("CONFIRMED");
      expect(r.note).toContain("Nut 2026-10-06");
    }
    // The weekly entry is Nut's tower rule, not the banned energy/stamina system.
    expect(k.energySystem.value).toBe(false);
  });
});

describe("floor numbers", () => {
  it("stat % grows 4 per floor; packs grow 2 → 6; bosses on every 10th floor", () => {
    expect([1, 10, 50, 100].map((f) => frontierStatPct(R, f))).toEqual([104, 140, 300, 500]);
    const sizes = Array.from({ length: 100 }, (_, i) => frontierPackSize(R, i + 1));
    expect(sizes[0]).toBe(2);
    expect(sizes[99]).toBe(6);
    for (let i = 1; i < 100; i++) expect(sizes[i]!).toBeGreaterThanOrEqual(sizes[i - 1]!);
    expect(Array.from({ length: 100 }, (_, i) => i + 1).filter((f) => isFrontierBossFloor(R, f))).toEqual([10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
  });

  it("species climb by wild level and the top one repeats once content runs out; levels are never changed", () => {
    const ids = (f: number) => frontierSpeciesPool(R, c.species, f).map((s) => s.id);
    expect(ids(1)).toEqual(["species:supply_mole"]);
    expect(ids(15)).toEqual(["species:supply_mole", "species:bell_bird"]);
    expect(ids(41)).toEqual(["species:armor_crab", "species:ember_fox"]);
    expect(ids(99)).toEqual(ids(41));
    const avg = (f: number) => frontierSpeciesPool(R, c.species, f).reduce((a, s) => a + s.fixedWildLevel, 0) / ids(f).length;
    for (let f = 2; f <= 100; f++) expect(avg(f)).toBeGreaterThanOrEqual(avg(f - 1));
    expect(frontierSpeciesPool(R, c.species, 1).every((s) => s.rank === "NORMAL")).toBe(true);
  });
});

describe("rolling a floor", () => {
  it("same run and floor give the same floor (a reload never rerolls); another run differs", () => {
    for (const f of [1, 7, 23, 64, 99]) expect(rollFrontierFloor(R, T, c, "frun_a", f)).toEqual(rollFrontierFloor(R, T, c, "frun_a", f));
    const a = JSON.stringify([3, 6, 12, 33].map((f) => rollFrontierFloor(R, T, c, "frun_a", f)));
    const b = JSON.stringify([3, 6, 12, 33].map((f) => rollFrontierFloor(R, T, c, "frun_b", f)));
    expect(a).not.toBe(b);
  });

  it("normal floors field the floor's pack size from the floor's species; elite leaders only from floor 5", () => {
    let elites = 0;
    for (let run = 0; run < 40; run++)
      for (const f of [1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 45, 77]) {
        const floor = rollFrontierFloor(R, T, c, `frun_${run}`, f);
        if (floor.kind !== "normal") throw new Error("not a normal floor");
        expect(floor.members).toHaveLength(frontierPackSize(R, f));
        const pool = frontierSpeciesPool(R, c.species, f).map((s) => s.id);
        for (const m of floor.members) {
          expect(pool).toContain(m.speciesId);
          expect(c.species.get(m.speciesId)!.allowedElements).toContain(m.element);
        }
        expect(floor.members.slice(1).every((m) => m.elite === undefined)).toBe(true);
        if (floor.members[0]!.elite !== undefined) {
          expect(f).toBeGreaterThanOrEqual(5);
          elites += 1;
        }
      }
    expect(elites).toBeGreaterThan(20);
  });

  it("boss floors take the guardians in turn", () => {
    expect([10, 20, 30, 100].map((f) => rollFrontierFloor(R, T, c, "frun_a", f))).toEqual([
      { floor: 10, statPct: 140, kind: "boss", bossId: "boss:rift_spire_warden" },
      { floor: 20, statPct: 180, kind: "boss", bossId: "boss:rift_spire_tyrant" },
      { floor: 30, statPct: 220, kind: "boss", bossId: "boss:rift_spire_warden" },
      { floor: 100, statPct: 500, kind: "boss", bossId: "boss:rift_spire_tyrant" },
    ]);
    const boss = rollFrontierFloor(R, T, c, "frun_a", 20);
    expect(frontierFloorSpecies(boss, c.bosses).map((s) => s.speciesId)).toEqual(["species:crystal_crab_lord", "species:ember_fox", "species:armor_crab", "species:bell_bird", "species:lantern_snail"]);
    expect(() => rollFrontierFloor(R, T, c, "frun_a", 0)).toThrow();
    expect(() => rollFrontierFloor(R, T, c, "frun_a", 101)).toThrow();
  });
});

describe("tower fights in the kernel", () => {
  const fight = (floor: number, run = "frun_k", rules = R) => {
    const f = rollFrontierFloor(rules, T, c, run, floor);
    const setup = baseSetup({ ...frontierFloorSetup(f), bag: { "item:small_potion": 3, "item:supply_mole_capture": 3, "item:crystal_crab_lord_capture": 2 } });
    setup.player.level = 30;
    return { f, s: ok(createBattle(rules, c, setup)).state };
  };

  it("every enemy carries the floor's stat % on HP and ATK/MATK; wild level and DEF stay the species' own", () => {
    const { f, s } = fight(3);
    if (f.kind !== "normal") throw new Error("normal floor expected");
    expect(s.frontier).toEqual({ floor: 3, statPct: 112 });
    for (const u of s.units.filter((x) => x.side === "enemy")) {
      const sp = c.species.get(u.speciesId!)!;
      const base = deriveStats(sp.fixedWildLevel, sp.wildPrimaryStats);
      expect(u.level).toBe(sp.fixedWildLevel);
      const elite = u.elite !== undefined;
      const hp = elite ? Math.floor((base.maxHp * 250) / 100) : base.maxHp;
      expect(u.stats.maxHp).toBe(Math.floor((hp * 112) / 100));
      expect(u.hp).toBe(u.stats.maxHp);
      expect(u.stats.patk).toBe(Math.floor(((elite ? Math.floor((base.patk * 115) / 100) : base.patk) * 112) / 100));
      expect(u.stats.pdef).toBe(base.pdef);
      expect(u.stats.spd).toBe(base.spd);
    }
  });

  it("a boss floor is a boss fight: two actions, phases, adds, its own rare loot table, a closed capture window", () => {
    const { s } = fight(10);
    const boss = unit(s, "e1");
    const sp = c.species.get("species:crystal_crab_lord")!;
    expect(s.boss).toMatchObject({ bossId: "boss:rift_spire_warden", phase: 0 });
    expect(s.frontier).toEqual({ floor: 10, statPct: 140 });
    expect(boss.stats.maxHp).toBe(Math.floor((Math.floor(deriveStats(sp.fixedWildLevel, sp.wildPrimaryStats).maxHp * 4) * 140) / 100));
    expect(boss.actionsPerRound).toBe(2);
    expect(boss.lootTableId).toBe("loot:rift_spire_guardian");
    expect(boss.captureWindowOpen).toBe(false);
    expect(unit(s, "e2").lootTableId).toBe("loot:armor_crab");
    expect(s.units.filter((u) => u.side === "enemy")).toHaveLength(3);
  });

  it("refuses a floor outside the tower", () => {
    const setup = baseSetup({ frontier: { floor: 101 } });
    expect(createBattle(R, c, setup)).toMatchObject({ ok: false, code: "INVALID_COMMAND" });
  });

  it("capture on a tower floor is a normal capture: by hand, the species at Lv1, nothing of the tower carried", () => {
    const { s: start } = fight(1, "frun_cap", fixtureRules);
    let s = start;
    for (let i = 0; i < 50 && s.status === "active" && currentActor(s)?.kind !== "player"; i++) s = ok(applyCommand(fixtureRules, c, s, chooseAutoCommand(s)!, { source: "player" })).state;
    const target = s.units.find((u) => u.side === "enemy" && !u.ko)!;
    const cmd = { type: "capture", actorId: "player", targetId: target.unitId, itemId: "item:supply_mole_capture" } as const;
    expect(applyCommand(fixtureRules, c, s, cmd, { source: "auto" })).toMatchObject({ ok: false });
    let caught: BattleEvent[] = [];
    for (let tries = 0; tries < 3 && caught.length === 0; tries++) {
      const r = ok(applyCommand(fixtureRules, c, s, cmd, { source: "player" }));
      caught = r.events.filter((e) => e.type === "RewardEntitled" && e.entitlement.kind === "capture");
      s = r.state;
      for (let i = 0; i < 50 && s.status === "active" && currentActor(s)?.kind !== "player"; i++) s = ok(applyCommand(fixtureRules, c, s, chooseAutoCommand(s)!, { source: "player" })).state;
      if (s.status !== "active" || unit(s, target.unitId).ko) break;
    }
    expect(caught).toHaveLength(1);
    const e = caught[0]!;
    if (e.type !== "RewardEntitled" || e.entitlement.kind !== "capture") throw new Error("capture expected");
    expect(e.entitlement).toMatchObject({ speciesId: "species:supply_mole", element: target.element, level: 1 });
    expect(Object.keys(e.entitlement).sort()).toEqual(["companionExp", "element", "enemyUnitId", "entitlementId", "exp", "kind", "level", "speciesId"]);
  });

  it("the fight's end reports each ally's max HP/MP (for the checkpoint)", () => {
    const { s: start } = fight(2, "frun_end");
    let s = start;
    let ended: BattleEvent | undefined;
    for (let i = 0; i < 2000 && s.status === "active"; i++) {
      const r = ok(applyCommand(R, c, s, chooseAutoCommand(s)!, { source: "auto" }));
      s = r.state;
      ended = r.events.find((e) => e.type === "BattleEnded") ?? ended;
    }
    if (ended?.type !== "BattleEnded") throw new Error("no end");
    expect(ended.allies[0]).toMatchObject({ unitId: "player", maxHp: unit(s, "player").stats.maxHp, maxMp: unit(s, "player").stats.maxMp });
  });
});

describe("HP/MP between floors", () => {
  const allies = [
    { unitId: "player", instanceId: null, hp: 100, mp: 5, ko: false, maxHp: 1000, maxMp: 50 },
    { unitId: "ally:m1", instanceId: "m1", hp: 0, mp: 0, ko: true, maxHp: 400, maxMp: 40 },
    { unitId: "ally:m2", instanceId: "m2", hp: 390, mp: 39, ko: false, maxHp: 400, maxMp: 40 },
  ];
  it("carries as is between floors; every 5th floor cleared gives 30% back to those standing, capped", () => {
    expect(frontierVitalsAfter(R, 4, allies)).toEqual({ player: { hp: 100, mp: 5 }, companions: { m1: { hp: 0, mp: 0 }, m2: { hp: 390, mp: 39 } } });
    expect(frontierVitalsAfter(R, 5, allies)).toEqual({ player: { hp: 400, mp: 20 }, companions: { m1: { hp: 0, mp: 0 }, m2: { hp: 400, mp: 40 } } });
  });
});

describe("tower content (EXAMPLE)", () => {
  it("parses as a draft, passes the content check, and the guardians' table has rare drops", () => {
    expect(FrontierDefinitionSchema.parse(T)).toMatchObject({ status: "draft", example: true, name: { th: "หอคอยรอยแยก" } });
    expect(validateFrontier(R, T, fc)).toEqual([]);
    const table = c.lootTables.get("loot:rift_spire_guardian")!;
    expect(isRareDrop(R, table, "item:rift_core")).toBe(true);
    expect(isRareDrop(R, table, "equip:crystal_shell_plate")).toBe(true);
    expect(isRareDrop(R, table, "item:crystal_shard")).toBe(false);
    expect(dropChance(R, table, "item:rift_core")).toBeGreaterThan(0.005);
    for (const b of EXAMPLE_FRONTIER_BOSSES) expect(b).toMatchObject({ status: "draft", example: true, lootTableId: "loot:rift_spire_guardian" });
  });

  it("flags a field as entry town, an unknown boss, a guardian without a rare drop besides its Sigil", () => {
    const guardian = c.lootTables.get("loot:rift_spire_guardian")!;
    const lootTables = new Map(fc.lootTables);
    lootTables.set("loot:plain", { ...guardian, id: "loot:plain", pools: guardian.pools.filter((p) => p.id !== "rare") });
    const bosses = new Map(fc.bosses);
    bosses.set("boss:rift_spire_warden", { ...bosses.get("boss:rift_spire_warden")!, lootTableId: "loot:plain" });
    const bad = { ...T, townMapIds: ["map:dawn_field"], bossIds: [...T.bossIds, "boss:nope"] };
    const msgs = validateFrontier(R, bad, { ...fc, bosses, lootTables }).map((i) => i.message);
    for (const want of ["map:dawn_field is not a town", "unknown boss boss:nope", "boss:rift_spire_warden's loot table has no rare drop besides its Sigil"]) expect(msgs.some((m) => m.includes(want)), want).toBe(true);
    expect(msgs.some((m) => m.includes("rift_spire_tyrant"))).toBe(false);
  });
});
