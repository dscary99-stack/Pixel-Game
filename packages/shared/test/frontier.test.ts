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
  FRONTIER_MODIFIER_IDS,
  frontierElementPool,
  frontierModifierCount,
  frontierModifierStats,
  frontierNextFloor,
  frontierReinforcementCount,
  frontierSpeciesPool,
  publicView,
  scaleWildStats,
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

  it("second round: named floors, 10 monsters a floor, harder every floor, a gimmick each, reinforcements later", () => {
    const k = R.confirmed;
    expect([k.frontierFloorNames.value, k.frontierMonstersPerFloor.value, k.frontierHarderEveryFloor.value, k.frontierFloorGimmicks.value, k.frontierReinforcements.value]).toEqual([true, 10, true, true, true]);
    for (const r of [k.frontierFloorNames, k.frontierMonstersPerFloor, k.frontierHarderEveryFloor, k.frontierFloorGimmicks, k.frontierReinforcements]) {
      expect(r.status).toBe("CONFIRMED");
      expect(r.note).toContain("Nut 2026-10-06");
    }
  });
});

describe("floor numbers", () => {
  it("stat % grows 4 per floor; gimmicks 1/2/3 from floors 50/80; reinforcements 2 → 30 from floor 31; bosses on every 10th floor", () => {
    expect([1, 10, 50, 100].map((f) => frontierStatPct(R, f))).toEqual([104, 140, 300, 500]);
    expect([1, 49, 50, 79, 80, 100].map((f) => frontierModifierCount(R, f))).toEqual([1, 1, 2, 2, 3, 3]);
    expect([1, 30, 31, 65, 100].map((f) => frontierReinforcementCount(R, f, []))).toEqual([0, 0, 2, 16, 30]);
    expect(frontierReinforcementCount(R, 100, ["reserves"])).toBe(45);
    expect(frontierReinforcementCount(R, 31, ["reserves"])).toBe(3);
    for (let f = 32; f <= 100; f++) expect(frontierReinforcementCount(R, f, [])).toBeGreaterThanOrEqual(frontierReinforcementCount(R, f - 1, []));
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

  it("normal floors field 10 monsters from the floor's species; elite leaders only from floor 5", () => {
    let elites = 0;
    for (let run = 0; run < 40; run++)
      for (const f of [1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 45, 77]) {
        const floor = rollFrontierFloor(R, T, c, `frun_${run}`, f);
        if (floor.kind !== "normal") throw new Error("not a normal floor");
        expect(floor.members).toHaveLength(10);
        const def = T.floors[f - 1]!;
        const pool = (def.element === undefined ? frontierSpeciesPool(R, c.species, f) : frontierElementPool(R, c.species, f, def.element)).map((s) => s.id);
        for (const m of [...floor.members, ...floor.reinforcements]) {
          expect(pool).toContain(m.speciesId);
          expect(c.species.get(m.speciesId)!.allowedElements).toContain(m.element);
          if (def.element !== undefined) expect(m.element).toBe(def.element);
        }
        expect(floor.modifiers).toEqual(def.modifiers);
        expect(floor.reinforcements).toHaveLength(frontierReinforcementCount(R, f, def.modifiers));
        expect(floor.members.slice(1).every((m) => m.elite === undefined)).toBe(true);
        if (floor.members[0]!.elite !== undefined) {
          expect(f).toBeGreaterThanOrEqual(5);
          elites += 1;
        }
      }
    expect(elites).toBeGreaterThan(20);
  });

  it("boss floors take the guardians in turn", () => {
    expect([10, 20, 30, 100].map((f) => rollFrontierFloor(R, T, c, "frun_a", f))).toMatchObject([
      { floor: 10, statPct: 140, kind: "boss", bossId: "boss:rift_spire_warden" },
      { floor: 20, statPct: 180, kind: "boss", bossId: "boss:rift_spire_tyrant" },
      { floor: 30, statPct: 220, kind: "boss", bossId: "boss:rift_spire_warden" },
      { floor: 100, statPct: 500, kind: "boss", bossId: "boss:rift_spire_tyrant" },
    ]);
    // Guardian + adds + escorts = 10 (warden has 2 adds, tyrant 4).
    for (const [f, escorts] of [[10, 7], [20, 5]] as const) {
      const b = rollFrontierFloor(R, T, c, "frun_a", f);
      if (b.kind !== "boss") throw new Error("boss floor expected");
      expect(b.escorts).toHaveLength(escorts);
    }
    const boss = rollFrontierFloor(R, T, c, "frun_a", 20);
    expect(frontierFloorSpecies(boss, c.bosses).slice(0, 5).map((s) => s.speciesId)).toEqual(["species:crystal_crab_lord", "species:ember_fox", "species:armor_crab", "species:bell_bird", "species:lantern_snail"]);
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
    for (const floor of [3, 12, 66]) {
      const { f, s } = fight(floor);
      if (f.kind !== "normal") throw new Error("normal floor expected");
      const pct = frontierStatPct(R, floor);
      expect(s.frontier).toMatchObject({ floor, statPct: pct, modifiers: T.floors[floor - 1]!.modifiers });
      expect(s.units.filter((x) => x.side === "enemy")).toHaveLength(10);
      for (const u of s.units.filter((x) => x.side === "enemy")) {
        const sp = c.species.get(u.speciesId!)!;
        const base = deriveStats(sp.fixedWildLevel, sp.wildPrimaryStats);
        expect(u.level).toBe(sp.fixedWildLevel);
        const ranked = u.elite !== undefined ? scaleWildStats(base, 250, 115) : base;
        const want = frontierModifierStats(R, scaleWildStats(ranked, pct, pct), f.modifiers);
        expect(u.stats).toEqual(want);
        expect(u.stats.maxHp).toBe(Math.floor((ranked.maxHp * pct) / 100));
      }
    }
  });

  it("a boss floor is a boss fight: two actions, phases, adds, its own rare loot table, a closed capture window", () => {
    const { s } = fight(10);
    const boss = unit(s, "e1");
    const sp = c.species.get("species:crystal_crab_lord")!;
    expect(s.boss).toMatchObject({ bossId: "boss:rift_spire_warden", phase: 0 });
    expect(s.frontier).toMatchObject({ floor: 10, statPct: 140 });
    expect(boss.stats.maxHp).toBe(Math.floor((Math.floor(deriveStats(sp.fixedWildLevel, sp.wildPrimaryStats).maxHp * 4) * 140) / 100));
    expect(boss.actionsPerRound).toBe(2);
    expect(boss.lootTableId).toBe("loot:rift_spire_guardian");
    expect(boss.captureWindowOpen).toBe(false);
    expect(unit(s, "e2").lootTableId).toBe("loot:armor_crab");
    // Escorts fill the other 7 cells: 10 enemies, every cell once.
    const enemies = s.units.filter((u) => u.side === "enemy");
    expect(enemies).toHaveLength(10);
    expect(new Set(enemies.map((u) => `${u.row}${u.slot}`)).size).toBe(10);
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

describe("floor gimmicks (Nut 2026-10-06: each floor its own)", () => {
  const enemies = [
    { unitId: "e1", speciesId: "species:supply_mole", element: "EARTH" as const, row: "front" as const, slot: 2 },
    { unitId: "e2", speciesId: "species:supply_mole", element: "WATER" as const, row: "back" as const, slot: 2 },
  ];
  const start = (modifiers: (typeof FRONTIER_MODIFIER_IDS)[number][], over: Parameters<typeof baseSetup>[0] = {}) =>
    ok(createBattle(R, c, baseSetup({ enemies, frontier: { floor: 7, modifiers }, ...over }))).state;

  it("stat gimmicks raise ATK, DEF/MDEF, MATK, SPD by their %, never HP or level", () => {
    const plain = unit(start([]), "e1").stats;
    const m = R.provisional.frontier.value.modifiers;
    const up = (v: number, pct: number) => Math.floor((v * (100 + pct)) / 100);
    expect(unit(start(["fierce"]), "e1").stats).toEqual({ ...plain, patk: up(plain.patk, m.fierceAtkPct) });
    expect(unit(start(["tough"]), "e1").stats).toEqual({ ...plain, pdef: up(plain.pdef, m.toughDefPct), mdef: up(plain.mdef, m.toughDefPct) });
    expect(unit(start(["arcane", "swift"]), "e1").stats).toEqual({ ...plain, matk: up(plain.matk, m.arcaneMatkPct), spd: up(plain.spd, m.swiftSpdPct) });
    expect(unit(start(["fierce"]), "e1").level).toBe(unit(start([]), "e1").level);
  });

  it("regen and crystal shield go on every enemy at the start", () => {
    const s = start(["regen", "crystal_shield"]);
    for (const id of ["e1", "e2"]) {
      const ids = unit(s, id).statuses!.map((x) => x.statusId);
      expect(ids).toEqual(expect.arrayContaining(["regen", "shield"]));
      expect(unit(s, id).statuses!.find((x) => x.statusId === "shield")!.shieldHp).toBe(Math.max(1, Math.floor((unit(s, id).stats.maxHp * 15) / 100)));
    }
    expect(unit(start([]), "e1").statuses).toEqual([]);
  });

  it("venom and disrupt: enemy hits that land may poison or confuse (never their own side)", () => {
    const seen = new Set<string>();
    for (let k = 0; k < 30 && seen.size < 2; k++) {
      let s = start(["venom", "disrupt"], { seed: `g${k}`, player: { ...baseSetup().player, gear: { HP: 5000, PATK: 1 } } });
      for (let i = 0; i < 40 && s.status === "active"; i++) {
        const r = ok(applyCommand(R, c, s, { type: "guard", actorId: "player" }, { source: "player" }));
        s = r.state;
        for (const e of r.events) if (e.type === "StatusChanged" && e.unitId === "player" && e.change === "applied") seen.add(e.statusId);
        for (const e of r.events) if (e.type === "StatusChanged" && e.unitId.startsWith("e") && (e.statusId === "poison" || e.statusId === "confuse")) throw new Error("own side poisoned");
      }
    }
    expect([...seen]).toEqual(expect.arrayContaining(["confuse", "poison"]));
  });

  it("refuses unknown or repeated gimmicks and an oversized reinforcement queue", () => {
    expect(createBattle(R, c, baseSetup({ enemies, frontier: { floor: 7, modifiers: ["nope" as "fierce"] } }))).toMatchObject({ ok: false, code: "INVALID_COMMAND" });
    expect(createBattle(R, c, baseSetup({ enemies, frontier: { floor: 7, modifiers: ["fierce", "fierce"] } }))).toMatchObject({ ok: false, code: "INVALID_COMMAND" });
    const many = Array.from({ length: 46 }, () => ({ speciesId: "species:supply_mole", element: "EARTH" as const }));
    expect(createBattle(R, c, baseSetup({ enemies, frontier: { floor: 99, reinforcements: many } }))).toMatchObject({ ok: false, code: "INVALID_COMMAND" });
    expect(createBattle(R, c, baseSetup({ enemies, frontier: { floor: 9, escorts: [{ speciesId: "species:supply_mole", element: "EARTH" }] } }))).toMatchObject({ ok: false, code: "INVALID_COMMAND" });
  });

  it("every floor is named, fixed in content (the same for everyone) and shown before it starts", () => {
    expect(T.floors).toHaveLength(100);
    expect(new Set(T.floors.map((f) => f.name.th)).size).toBe(100);
    for (const f of T.floors) expect(f.modifiers).toHaveLength(frontierModifierCount(R, f.floor));
    expect(T.floors.filter((f) => f.guardianTitle !== undefined).map((f) => f.floor)).toEqual([10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
    // Different runs meet the same floor 37 (gimmicks and name), only the monsters differ.
    expect(rollFrontierFloor(R, T, c, "frun_x", 37).modifiers).toEqual(rollFrontierFloor(R, T, c, "frun_y", 37).modifiers);
    const used = new Set(T.floors.flatMap((f) => f.modifiers));
    expect([...used].sort()).toEqual([...FRONTIER_MODIFIER_IDS].sort());
    expect(frontierNextFloor(R, T, 37)).toEqual({
      floor: 37,
      name: T.floors[36]!.name.th,
      guardianTitle: null,
      modifiers: T.floors[36]!.modifiers.map((id) => expect.objectContaining({ id })),
      element: T.floors[36]!.element ?? null,
      monsters: 10,
      reinforcements: frontierReinforcementCount(R, 37, T.floors[36]!.modifiers),
    });
    expect(frontierNextFloor(R, T, 100)!.guardianTitle).toBe("ผู้เฝ้ารอยแยกปฐมกาล");
  });

  it("the floor check flags wrong counts, missing titles, a stray element, early reserves, repeats and a missing floor", () => {
    const floors = T.floors.map((f) => ({ ...f, modifiers: [...f.modifiers] }));
    floors[0] = { ...floors[0]!, modifiers: ["fierce", "tough"] };
    floors[9] = { ...floors[9]!, guardianTitle: undefined };
    floors[10] = { ...floors[10]!, element: "FIRE" };
    floors[20] = { ...floors[20]!, modifiers: ["reserves"] };
    floors[22] = { ...floors[22]!, modifiers: [...floors[21]!.modifiers] };
    const msgs = validateFrontier(R, { ...T, floors: floors.slice(0, 99) }, fc).map((i) => i.message);
    for (const want of ["floor 1 has 2 gimmicks, needs 1", "floor 10 is a boss floor without a guardian title", "floor 11: an element without mono_element", "floor 21: reserves before reinforcements start", "floor 23 repeats the gimmicks of the floor below", "99 floors in content, the tower has 100"])
      expect(msgs.some((m) => m.includes(want)), want).toBe(true);
  });
});

describe("reinforcements (Nut 2026-10-06: later floors replace the fallen)", () => {
  const strong = (setup: ReturnType<typeof baseSetup>) => ({ ...setup, player: { ...setup.player, level: 80, gear: { PATK: 4000, HP: 60000, SPD: 200 } } });
  const play = (floor: number, run: string, seed = "seed-r") => {
    const f = rollFrontierFloor(R, T, c, run, floor);
    let s = ok(createBattle(R, c, strong(baseSetup({ ...frontierFloorSetup(f), seed, bag: {} })))).state;
    const events: BattleEvent[] = [];
    for (let i = 0; i < 4000 && s.status === "active"; i++) {
      const r = ok(applyCommand(R, c, s, chooseAutoCommand(s)!, { source: "auto" }));
      s = r.state;
      events.push(...r.events);
    }
    return { f, s, events };
  };

  it("none below floor 31; from floor 31 each fallen enemy's cell takes the next of a finite queue until it is empty", () => {
    expect(play(12, "frun_r").events.some((e) => e.type === "ReinforcementArrived")).toBe(false);
    const { f, s, events } = play(31, "frun_r");
    expect(s.status).toBe("victory");
    const arrived = events.filter((e) => e.type === "ReinforcementArrived");
    expect(arrived).toHaveLength(f.reinforcements.length);
    expect(f.reinforcements.length).toBe(2);
    for (const [i, e] of arrived.entries()) {
      if (e.type !== "ReinforcementArrived") continue;
      const old = unit(s, e.replaces);
      expect(old.ko || old.retired).toBe(true);
      expect(old.replacedBy).toBe(e.unitId);
      expect([e.row, e.slot]).toEqual([old.row, old.slot]);
      expect(e.speciesId).toBe(f.reinforcements[i]!.speciesId);
      expect(e.left).toBe(f.reinforcements.length - i - 1);
      // A real unit: the floor's stat % and gimmicks, capture window open, its species' loot.
      const u = unit(s, e.unitId);
      expect(u).toMatchObject({ side: "enemy", rank: "NORMAL", captureWindowOpen: true, lootTableId: c.species.get(e.speciesId)!.lootTableId });
    }
    // Rewards stay bounded: one kill entitlement per enemy, 10 + the queue.
    expect(s.entitlements.filter((x) => x.kind === "kill")).toHaveLength(10 + f.reinforcements.length);
    expect(s.frontier!.reinforcementsLeft).toBe(0);
  });

  it("arrive at the end of the round (before the next order), or at once when no enemy is left standing", () => {
    const { events } = play(69, "frun_t");
    const side = new Set(["ReinforcementArrived", "StatusChanged", "ShieldChanged", "PassiveTriggered"]);
    let endOfRound = 0;
    let atOnce = 0;
    for (const [i, e] of events.entries()) {
      if (e.type !== "ReinforcementArrived" || events[i - 1]?.type === "ReinforcementArrived" || side.has(events[i - 1]?.type ?? "") && events.slice(0, i).reverse().find((x) => !side.has(x.type))?.type === "ReinforcementArrived") continue;
      const after = events.slice(i).find((x) => !side.has(x.type));
      const before = events.slice(0, i).reverse().find((x) => !side.has(x.type));
      if (after?.type === "RoundStarted") endOfRound += 1;
      else {
        // At once: the block follows the last standing enemy's defeat (its reward), mid-round.
        expect(before?.type).toBe("RewardEntitled");
        atOnce += 1;
      }
    }
    expect(endOfRound + atOnce).toBeGreaterThan(0);
    expect(endOfRound).toBeGreaterThan(0);
  });

  it("are deterministic: the same run, floor and seed replay the same arrivals; the queue never reaches the client", () => {
    const a = play(45, "frun_d");
    const b = play(45, "frun_d");
    expect(b.events).toEqual(a.events);
    expect(a.s.frontier!.queue).toBeDefined();
    const v = publicView(a.s);
    expect(v.frontier!.queue).toBeUndefined();
    expect(v.frontier!.nextUnit).toBeUndefined();
    expect(v.frontier!.reinforcementsLeft).toBe(0);
  });

  it("a reinforcement can be captured like any wild monster (by hand)", () => {
    const f = rollFrontierFloor(R, T, c, "frun_c", 31);
    let s = ok(createBattle(fixtureRules, c, strong(baseSetup({ ...frontierFloorSetup(f), bag: Object.fromEntries([...c.species.values()].map((sp) => [sp.captureItemId, 5]).slice(0, 4)) })))).state;
    let target: string | undefined;
    for (let i = 0; i < 4000 && s.status === "active" && target === undefined; i++) {
      const r = ok(applyCommand(fixtureRules, c, s, chooseAutoCommand(s)!, { source: "auto" }));
      s = r.state;
      const e = r.events.find((x) => x.type === "ReinforcementArrived");
      if (e?.type === "ReinforcementArrived") target = e.unitId;
    }
    expect(target).toBeDefined();
    const u = unit(s, target!);
    expect(u.captureWindowOpen).toBe(true);
    expect(u.level).toBe(c.species.get(u.speciesId!)!.fixedWildLevel);
  });
});
