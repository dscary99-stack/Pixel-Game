import { describe, expect, it } from "vitest";
import {
  DEV_FIXTURE_RULES,
  EXAMPLE_ITEMS,
  EXAMPLE_MAPS,
  MapChannel,
  PRODUCTION_RULES,
  Rng,
  createBattle,
  defaultCombatBag,
  exampleContentMaps,
  exampleMapRegistry,
  huntingAllowed,
  inEngageRange,
  inWanderEngageRange,
  isWalkable,
  packCycle,
  packPositionAt,
  packWanderStep,
  portalAt,
  packEnemies,
  packInstanceId,
  rollPack,
  seedRng,
  validateMaps,
  visiblePack,
  type MapDefinition,
} from "../src";

const rules = PRODUCTION_RULES;
const content = exampleContentMaps();
const maps = exampleMapRegistry();
const field = maps.get("map:dawn_field")!;
const town = maps.get("map:dawn_town")!;
const spawn = field.spawns.find((s) => s.id === "pond_crabs")!;

describe("pack spawns", () => {
  it("example spawns validate against the species registry", () => {
    expect(validateMaps(EXAMPLE_MAPS, content.species, content.bosses)).toEqual([]);
  });

  it("catches spawns that break chapter 07 / C05 / C07", () => {
    const bad: MapDefinition = {
      ...town,
      spawns: [
        { ...spawn, id: "a", packSize: [3, 11] },
        { ...spawn, id: "a", at: { x: 0, y: 0 } },
        {
          ...spawn,
          id: "b",
          entries: [{ speciesId: "species:ember_fox", weight: 1, elementWeights: { WATER: 1 }, groupRules: { min: 1, max: 1 } }],
        },
        { ...spawn, id: "c", entries: [{ speciesId: "species:nope", weight: 1, elementWeights: { FIRE: 1 }, groupRules: { min: 1, max: 1 } }] },
      ],
    };
    const messages = validateMaps([bad, field], content.species).map((i) => i.message);
    expect(messages).toEqual(
      expect.arrayContaining([
        "towns have no hunting spawns",
        "spawn a pack can exceed 10 enemies",
        "spawn a id is duplicated",
        "spawn a is not on open ground",
        "spawn b species:ember_fox cannot be WATER",
        "spawn c uses unknown species species:nope",
      ]),
    );
  });

  it("rolls packs inside the size range from the spawn's species and elements", () => {
    const rng = new Rng(seedRng("packs"));
    const sizes = new Set<number>();
    for (let i = 0; i < 200; i++) {
      const p = rollPack(spawn, `p${i}`, rng);
      sizes.add(p.members.length);
      for (const m of p.members) {
        const entry = spawn.entries.find((e) => e.speciesId === m.speciesId)!;
        expect(entry).toBeDefined();
        expect((entry.elementWeights as Record<string, number>)[m.element]).toBeGreaterThan(0);
      }
    }
    expect([...sizes].sort()).toEqual([1, 2]);
  });

  it("shows the leader that is really in the fight, with its fixed wild level (C29)", () => {
    const p = rollPack(spawn, "p1", new Rng(seedRng("leader")));
    const v = visiblePack(p, content.species);
    expect(v.leader).toEqual({ ...p.members[0], level: content.species.get(p.members[0]!.speciesId)!.fixedWildLevel });
    expect(v.sizeRange).toEqual(spawn.packSize);
    const enemies = packEnemies(p);
    expect(enemies[0]).toMatchObject({ speciesId: v.leader.speciesId, element: v.leader.element, row: "front" });
  });

  it("builds a formation the kernel accepts for every pack size up to 10", () => {
    for (let n = 1; n <= 10; n++) {
      const p = { ...rollPack(spawn, "p", new Rng(seedRng("f"))), members: Array.from({ length: n }, () => ({ speciesId: "species:ember_fox", element: "FIRE" as const })) };
      const r = createBattle(DEV_FIXTURE_RULES, content, {
        battleId: "battle:f",
        originMode: "manual",
        seed: "s",
        player: { accountId: "acct:a", name: "A", level: 10, element: "FIRE", primaryStats: { STR: 20, VIT: 20, INT: 10, DEX: 10, AGI: 10, SPI: 10 }, skillIds: [], basicAttackRange: "melee", row: "front", slot: 1 },
        companions: [],
        enemies: packEnemies(p),
        bag: {},
      });
      expect(r.ok, `size ${n}`).toBe(true);
    }
  });

  it("pack ids change every respawn cycle and differ per channel", () => {
    const ms = rules.provisional.packRespawnMs.value;
    expect(packCycle(rules, ms - 1)).toBe(0);
    expect(packCycle(rules, ms)).toBe(1);
    expect(packInstanceId(field.id, 1, "a", 5)).not.toBe(packInstanceId(field.id, 2, "a", 5));
  });

  it("engage range is next to or on the pack; towns never hunt", () => {
    expect(inEngageRange(rules, { x: 8, y: 5 }, spawn.at)).toBe(true);
    expect(inEngageRange(rules, { x: 9, y: 6 }, spawn.at)).toBe(true);
    expect(inEngageRange(rules, { x: 7, y: 6 }, spawn.at)).toBe(false);
    expect(huntingAllowed(town)).toBe(false);
    expect(huntingAllowed(field)).toBe(true);
  });
});

describe("default combat bag", () => {
  const kind = (id: string) => EXAMPLE_ITEMS.find((i) => i.id === id)?.kind;
  it("takes combat items up to their stack caps and skips materials", () => {
    const bag = defaultCombatBag(rules, { "item:small_potion": 25, "item:ember_fox_capture": 3, "item:crab_shell": 9, "item:unknown": 4 }, kind);
    expect(bag).toEqual({ "item:small_potion": 10, "item:ember_fox_capture": 3 });
  });

  it("never exceeds the type limit", () => {
    const owned = Object.fromEntries(EXAMPLE_ITEMS.map((i) => [i.id, 1]));
    expect(Object.keys(defaultCombatBag(rules, owned, kind)).length).toBeLessThanOrEqual(rules.provisional.combatBagMaxTypes.value);
  });

  it("packs the items Auto Hunt's rules name first, so a full bag still holds them", () => {
    const owned = Object.fromEntries(EXAMPLE_ITEMS.map((i) => [i.id, 1]));
    const plain = defaultCombatBag(rules, owned, kind);
    expect(plain["item:power_tonic"]).toBeUndefined();
    const auto = defaultCombatBag(rules, owned, kind, ["item:power_tonic", "item:phoenix_feather"]);
    expect(auto).toMatchObject({ "item:power_tonic": 1, "item:phoenix_feather": 1 });
    expect(Object.keys(auto).length).toBe(rules.provisional.combatBagMaxTypes.value);
  });
});

describe("MapChannel during a fight", () => {
  it("a player in a fight cannot walk, and engage/resume go to the server", () => {
    const ch = new MapChannel(rules, field, 1, [], () => "s1");
    ch.join("acct:a", "A", field.spawn, 0);
    expect(ch.handle("acct:a", { t: "engage", packId: "x" }, 0).kind).toBe("intent");
    ch.setBattle("acct:a", "battle:1");
    expect(ch.handle("acct:a", { t: "step", seq: 1, dir: "E" }, 0).out[0]!.msg).toMatchObject({ t: "correct", reason: "IN_BATTLE" });
    expect(ch.handle("acct:a", { t: "resume" }, 0).kind).toBe("intent");
    ch.setBattle("acct:a", null);
    expect(ch.handle("acct:a", { t: "step", seq: 2, dir: "E" }, 0).kind).toBe("moved");
  });
});

describe("wandering packs (P33)", () => {
  const { stepMs, radiusTiles } = rules.provisional.packWander.value;
  const respawn = rules.provisional.packRespawnMs.value;
  const pack = { packId: packInstanceId(field.id, 1, spawn.id, 7), at: spawn.at };

  it("steps line up with the respawn cycle", () => {
    expect(respawn % stepMs).toBe(0);
    expect(packWanderStep(rules, 7 * respawn)).toBe(0);
    expect(packWanderStep(rules, 7 * respawn + stepMs - 1)).toBe(0);
    expect(packWanderStep(rules, 7 * respawn + stepMs)).toBe(1);
    expect(packWanderStep(rules, 8 * respawn - 1)).toBe(respawn / stepMs - 1);
  });

  it("starts on its spawn point and stays on walkable, non-portal tiles near it", () => {
    expect(packPositionAt(rules, field, pack, 0)).toEqual(spawn.at);
    const seen = new Set<string>();
    for (const sp of field.spawns) {
      for (let cycle = 0; cycle < 20; cycle++) {
        const p = { packId: packInstanceId(field.id, 1, sp.id, cycle), at: sp.at };
        let prev = sp.at;
        for (let step = 0; step < respawn / stepMs; step++) {
          const at = packPositionAt(rules, field, p, step);
          expect(Math.max(Math.abs(at.x - sp.at.x), Math.abs(at.y - sp.at.y))).toBeLessThanOrEqual(radiusTiles);
          expect(isWalkable(field, at.x, at.y)).toBe(true);
          if (step > 0) expect(portalAt(field, at.x, at.y)).toBeNull();
          // One orthogonal tile at most per step.
          expect(Math.abs(at.x - prev.x) + Math.abs(at.y - prev.y)).toBeLessThanOrEqual(1);
          prev = at;
          seen.add(`${sp.id}:${at.x},${at.y}`);
        }
      }
    }
    // They really move: more tiles than spawn points.
    expect(seen.size).toBeGreaterThan(field.spawns.length * 3);
  });

  it("is the same on every call and differs between packs", () => {
    const a = Array.from({ length: 15 }, (_, i) => packPositionAt(rules, field, pack, i));
    expect(Array.from({ length: 15 }, (_, i) => packPositionAt(rules, field, pack, i))).toEqual(a);
    const other = { ...pack, packId: packInstanceId(field.id, 2, spawn.id, 7) };
    expect(Array.from({ length: 15 }, (_, i) => packPositionAt(rules, field, other, i))).not.toEqual(a);
  });

  it("engaging counts where the pack is now or one step ago, not two", () => {
    let found = 0;
    for (let cycle = 0; cycle < 40; cycle++) {
      const p = { packId: packInstanceId(field.id, 1, spawn.id, cycle), at: spawn.at };
      for (let step = 2; step < respawn / stepMs; step++) {
        const now = packPositionAt(rules, field, p, step);
        const one = packPositionAt(rules, field, p, step - 1);
        const two = packPositionAt(rules, field, p, step - 2);
        const t = cycle * respawn + step * stepMs;
        expect(inWanderEngageRange(rules, field, now, p, t)).toBe(true);
        expect(inWanderEngageRange(rules, field, one, p, t)).toBe(true);
        // Next to where the pack was two steps ago, but out of reach of both newer spots.
        for (const [dx, dy] of [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]] as const) {
          const stand = { x: two.x + dx, y: two.y + dy };
          if (inEngageRange(rules, stand, now) || inEngageRange(rules, stand, one)) continue;
          expect(inWanderEngageRange(rules, field, stand, p, t)).toBe(false);
          found++;
        }
      }
    }
    expect(found).toBeGreaterThan(0);
  });

  it("visible packs show where the pack stands now", () => {
    const p = rollPack(spawn, pack.packId, new Rng(seedRng("w")));
    const at = packPositionAt(rules, field, p, 9);
    expect(visiblePack(p, content.species, at)).toMatchObject({ x: at.x, y: at.y });
    expect(visiblePack(p, content.species)).toMatchObject({ x: spawn.at.x, y: spawn.at.y });
  });
});
