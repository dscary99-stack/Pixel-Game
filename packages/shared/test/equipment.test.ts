import { describe, expect, it } from "vitest";
import {
  DEV_STARTER_EQUIPMENT,
  EXAMPLE_EQUIPMENT,
  EXAMPLE_LOOT_TABLES,
  EquipmentDefinitionSchema,
  PRODUCTION_RULES,
  deriveStats,
  exampleContentMaps,
  gearBonuses,
  planEquip,
  playerSetup,
  validateEquipmentDefinitions,
  weaponRange,
  wornGear,
  type CharacterView,
  type Loadout,
} from "../src";

const { equipment: defs, sigils } = exampleContentMaps();
const piece = (id: string, definitionId: string) => [id, { id, definitionId, sigilSockets: [] as string[] }] as const;
const owned = new Map([
  piece("sword", "equip:wooden_sword"),
  piece("dagger", "equip:ember_fang_dagger"),
  piece("bow", "equip:training_bow"),
  piece("buckler", "equip:crab_buckler"),
  piece("charm", "equip:glow_charm"),
  piece("tunic", "equip:cloth_tunic"),
  piece("cap", "equip:bell_feather_cap"),
]);
const plan = (current: Loadout, slot: Parameters<typeof planEquip>[2], id: string | null, level = 10) =>
  planEquip(PRODUCTION_RULES, current, slot, id, owned, defs, sigils, level);

describe("equipment content (EXAMPLE)", () => {
  it("parses, stays draft, and only uses stats the formulas know", () => {
    for (const d of EXAMPLE_EQUIPMENT) EquipmentDefinitionSchema.parse(d);
    expect(EXAMPLE_EQUIPMENT.every((d) => d.example && d.status === "draft")).toBe(true);
    expect(validateEquipmentDefinitions(EXAMPLE_EQUIPMENT)).toEqual([]);
    expect(validateEquipmentDefinitions([{ ...EXAMPLE_EQUIPMENT[0]!, baseStats: { LUCK: 3 } as never }])).toHaveLength(1);
    expect(DEV_STARTER_EQUIPMENT.every((id) => defs.has(id))).toBe(true);
  });

  it("every loot table's gear line points at real equipment", () => {
    const gearIds = EXAMPLE_LOOT_TABLES.flatMap((t) => t.pools.flatMap((p) => p.entries.map((e) => e.itemId))).filter((i) => i.startsWith("equip:"));
    expect(gearIds.length).toBe(EXAMPLE_LOOT_TABLES.length);
    expect(gearIds.every((id) => defs.has(id))).toBe(true);
  });
});

describe("planEquip", () => {
  it("puts a weapon in either hand and refuses the wrong slot", () => {
    expect(plan({}, "MAIN_HAND", "sword")).toMatchObject({ ok: true, loadout: { MAIN_HAND: "sword" } });
    expect(plan({ MAIN_HAND: "sword" }, "OFF_HAND", "dagger")).toMatchObject({ ok: true, loadout: { MAIN_HAND: "sword", OFF_HAND: "dagger" } });
    expect(plan({}, "HEAD_TOP", "sword")).toMatchObject({ ok: false, code: "SLOT_MISMATCH" });
    expect(plan({}, "OFF_HAND", "bow")).toMatchObject({ ok: false, code: "SLOT_MISMATCH" });
  });

  it("a two-hand weapon takes the off hand off, and blocks a new off-hand item", () => {
    const r = plan({ MAIN_HAND: "sword", OFF_HAND: "buckler" }, "MAIN_HAND", "bow");
    expect(r).toEqual({ ok: true, loadout: { MAIN_HAND: "bow" }, removed: ["sword", "buckler"] });
    expect(plan({ MAIN_HAND: "bow" }, "OFF_HAND", "buckler")).toMatchObject({ ok: false, code: "TWO_HAND_BLOCKS_OFFHAND" });
  });

  it("checks the required level", () => {
    expect(plan({}, "OFF_HAND", "buckler", 3)).toMatchObject({ ok: false, code: "LEVEL_TOO_LOW" });
    expect(plan({}, "OFF_HAND", "buckler", 4)).toMatchObject({ ok: true });
  });

  it("moves a worn piece instead of wearing it twice, and empties a slot", () => {
    expect(plan({ ACCESSORY_1: "charm" }, "ACCESSORY_2", "charm")).toEqual({ ok: true, loadout: { ACCESSORY_2: "charm" }, removed: [] });
    expect(plan({ ARMOR: "tunic", HEAD_TOP: "cap" }, "ARMOR", null)).toEqual({ ok: true, loadout: { HEAD_TOP: "cap" }, removed: ["tunic"] });
    expect(plan({}, "ARMOR", "nope")).toMatchObject({ ok: false, code: "MISSING_REFERENCE" });
  });
});

describe("gear in battle stats", () => {
  const character: CharacterView = {
    id: "char:x",
    name: "นัท",
    classId: "class:arcanist",
    raceId: "race:human",
    element: "WATER",
    level: 1,
    xp: 0,
    primaryStats: { STR: 10, VIT: 10, INT: 10, DEX: 10, AGI: 10, SPI: 10 },
    hp: null,
    mp: null,
    version: 1,
    team: [],
  };

  it("sums worn base stats into derived stats", () => {
    const g = gearBonuses([defs.get("equip:wooden_sword")!, defs.get("equip:cloth_tunic")!]);
    expect(g).toEqual({ PATK: 8, PDEF: 4, HP: 30 });
    const base = deriveStats(1, character.primaryStats);
    const geared = deriveStats(1, character.primaryStats, g);
    expect(geared.patk - base.patk).toBe(8);
    expect(geared.maxHp - base.maxHp).toBe(30);
  });

  it("the main-hand weapon decides basic attack reach", () => {
    expect(weaponRange(undefined, "ranged")).toBe("ranged");
    expect(weaponRange(defs.get("equip:wooden_sword"), "ranged")).toBe("melee");
    expect(weaponRange(defs.get("equip:training_bow"), "melee")).toBe("ranged");
    const worn = wornGear(
      [
        { id: "sword", definitionId: "equip:wooden_sword", refineLevel: 0, lockState: "free", slot: "MAIN_HAND", sigils: [], rarity: "COMMON", affixes: [] },
        { id: "bag", definitionId: "equip:cloth_tunic", refineLevel: 0, lockState: "free", slot: null, sigils: [], rarity: "COMMON", affixes: [] },
      ],
      defs,
    );
    const p = playerSetup("acct:a", character, worn);
    expect(p.gear).toEqual({ PATK: 8 });
    expect(p.basicAttackRange).toBe("melee");
    expect(playerSetup("acct:a", character).basicAttackRange).toBe("ranged");
  });
});
