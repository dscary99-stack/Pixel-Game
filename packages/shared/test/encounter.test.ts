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
  packCycle,
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
const spawn = field.spawns[0]!;

describe("pack spawns", () => {
  it("example spawns validate against the species registry", () => {
    expect(validateMaps(EXAMPLE_MAPS, content.species)).toEqual([]);
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
