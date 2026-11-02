import { describe, expect, it } from "vitest";
import {
  EXAMPLE_ITEMS,
  EXAMPLE_LOOT_TABLES,
  EXAMPLE_SIGILS,
  EXAMPLE_SKILLS,
  EXAMPLE_SPECIES,
  EquipmentDefinitionSchema,
  ItemDefinitionSchema,
  LootTableSchema,
  PRODUCTION_RULES as rules,
  SigilDefinitionSchema,
  SkillDefinitionSchema,
  SpawnEntrySchema,
  SpeciesDefinitionSchema,
  exampleContentMaps,
  validateEnemyCount,
  validateLoadout,
  validateLootTable,
  validateSigilSockets,
  validateSpecies,
  validateTeam,
  type EquipmentDefinition,
  type EquipmentInstance,
} from "../src/index";

describe("schemas", () => {
  it("parses all EXAMPLE content, which stays draft and flagged example", () => {
    for (const s of EXAMPLE_SPECIES) expect(SpeciesDefinitionSchema.parse(s).example).toBe(true);
    for (const s of EXAMPLE_SKILLS) SkillDefinitionSchema.parse(s);
    for (const s of EXAMPLE_ITEMS) ItemDefinitionSchema.parse(s);
    for (const s of EXAMPLE_SIGILS) SigilDefinitionSchema.parse(s);
    for (const s of EXAMPLE_LOOT_TABLES) LootTableSchema.parse(s);
    expect([...EXAMPLE_SPECIES, ...EXAMPLE_SKILLS, ...EXAMPLE_ITEMS].every((c) => c.status === "draft")).toBe(true);
  });

  it("rejects a per-map wildLevel override on a spawn entry (C29)", () => {
    const entry = { speciesId: "species:ember_fox", weight: 10, elementWeights: { FIRE: 3 }, groupRules: { min: 1, max: 3 } };
    expect(SpawnEntrySchema.safeParse(entry).success).toBe(true);
    expect(SpawnEntrySchema.safeParse({ ...entry, wildLevel: 40 }).success).toBe(false);
  });

  it("requires exactly 3 skills per species (C06)", () => {
    const sp = { ...EXAMPLE_SPECIES[0]!, skillIds: EXAMPLE_SPECIES[0]!.skillIds.slice(0, 2) };
    expect(SpeciesDefinitionSchema.safeParse(sp).success).toBe(false);
  });

  it("rejects a sigil probability written as a percent (0.05 instead of 0.0005)", () => {
    expect(SigilDefinitionSchema.safeParse({ ...EXAMPLE_SIGILS[0]!, baseDropProbability: 0.05 }).success).toBe(false);
    expect(SigilDefinitionSchema.safeParse({ ...EXAMPLE_SIGILS[0]!, baseDropProbability: 0.00005 }).success).toBe(true);
  });

  it("caps sigil slots: weapon 4, everything else 1 (C23)", () => {
    expect(EquipmentDefinitionSchema.safeParse(sword({ maxSigilSlots: 4 })).success).toBe(true);
    expect(EquipmentDefinitionSchema.safeParse(sword({ maxSigilSlots: 5 })).success).toBe(false);
    expect(EquipmentDefinitionSchema.safeParse(shield({ maxSigilSlots: 2 })).success).toBe(false);
  });
});

describe("team and encounter validators", () => {
  const m = (i: number, sp = `species:s${i}`) => ({ instanceId: `m${i}`, speciesId: sp });
  it("allows 5 companions and rejects 6 (C04)", () => {
    expect(validateTeam(rules, [1, 2, 3, 4, 5].map((i) => m(i)))).toEqual([]);
    expect(validateTeam(rules, [1, 2, 3, 4, 5, 6].map((i) => m(i)))[0]?.code).toBe("TEAM_TOO_LARGE");
  });
  it("treats the same species with a different element as a duplicate (C04)", () => {
    const issues = validateTeam(rules, [m(1, "species:ember_fox"), m(2, "species:ember_fox")]);
    expect(issues.map((i) => i.code)).toEqual(["DUPLICATE_SPECIES"]);
  });
  it("allows 10 enemy units and rejects 11 (C05)", () => {
    expect(validateEnemyCount(rules, 10)).toEqual([]);
    expect(validateEnemyCount(rules, 11)[0]?.code).toBe("TOO_MANY_ENEMIES");
  });
});

describe("sigil and loadout validators (chapter 12 validator 5)", () => {
  const sigils = new Map([
    ...EXAMPLE_SIGILS.map((s) => [s.id, s] as const),
    ["sigil:dream_shroom", { ...EXAMPLE_SIGILS[0]!, id: "sigil:dream_shroom", sourceSpeciesId: "species:dream_shroom", equipGroups: ["HEADGEAR"] }] as const,
  ]);
  const defs = new Map<string, EquipmentDefinition>(
    [sword({}), sword({ id: "equip:dagger" }), shield({}), hat("HEAD_TOP"), hat("HEAD_MID"), hat("HEAD_LOW"), greatsword()].map((d) => [d.id, d]),
  );
  const inst = (definitionId: string, sockets: (string | null)[]): EquipmentInstance => ({
    id: `inst:${definitionId}`,
    definitionId,
    ownerId: "acct:1",
    refineLevel: 0,
    rarity: "COMMON",
    rolledAffixes: [],
    sigilSockets: sockets,
    lockState: "free",
  });
  const fox = "sigil:ember_fox";

  it("accepts dual weapons with 4 + 4 duplicate compatible sigils (8 total)", () => {
    const issues = validateLoadout(
      rules,
      { MAIN_HAND: inst("equip:sword", [fox, fox, fox, fox]), OFF_HAND: inst("equip:dagger", [fox, fox, fox, fox]) },
      defs,
      sigils,
    );
    expect(issues).toEqual([]);
  });

  it("rejects 5 sigils on one weapon and 2 on a shield", () => {
    const w = validateSigilSockets(rules, defs.get("equip:sword")!, inst("equip:sword", [fox, fox, fox, fox, fox]), sigils);
    expect(w.map((i) => i.code)).toContain("SIGIL_SLOTS_EXCEEDED");
    const crab = "sigil:armor_crab";
    const s = validateSigilSockets(rules, defs.get("equip:shield")!, inst("equip:shield", [crab, crab]), sigils);
    expect(s.map((i) => i.code)).toContain("SIGIL_SLOTS_EXCEEDED");
  });

  it("accepts one HEADGEAR sigil on each of the three head slots (C24)", () => {
    const shroom = "sigil:dream_shroom";
    const issues = validateLoadout(
      rules,
      { HEAD_TOP: inst("equip:hat_head_top", [shroom]), HEAD_MID: inst("equip:hat_head_mid", [shroom]), HEAD_LOW: inst("equip:hat_head_low", [shroom]) },
      defs,
      sigils,
    );
    expect(issues).toEqual([]);
  });

  it("rejects a sigil in the wrong equipment group", () => {
    const issues = validateSigilSockets(rules, defs.get("equip:shield")!, inst("equip:shield", [fox]), sigils);
    expect(issues.map((i) => i.code)).toEqual(["SIGIL_INCOMPATIBLE"]);
  });

  it("rejects an off-hand item next to a two-hand weapon", () => {
    const issues = validateLoadout(rules, { MAIN_HAND: inst("equip:greatsword", []), OFF_HAND: inst("equip:shield", []) }, defs, sigils);
    expect(issues.map((i) => i.code)).toContain("SLOT_MISMATCH");
  });
});

describe("species and loot validators", () => {
  const maps = exampleContentMaps();
  it("example species kits are complete: 3 skills + 1 innate passive + own sigil", () => {
    for (const sp of EXAMPLE_SPECIES) expect(validateSpecies(rules, sp, maps.skills, maps.sigils)).toEqual([]);
  });
  it("flags example loot tables for having fewer than 50 candidates instead of padding them", () => {
    for (const t of EXAMPLE_LOOT_TABLES) {
      expect(validateLootTable(rules, t, maps.sigils).map((i) => i.code)).toEqual(["LOOT_CANDIDATE_COUNT"]);
    }
  });
  it("flags a sigil dropped by the wrong species (C22)", () => {
    const t = { ...EXAMPLE_LOOT_TABLES[0]!, sigilRoll: { ...EXAMPLE_LOOT_TABLES[1]!.sigilRoll } };
    expect(validateLootTable(rules, t, maps.sigils).map((i) => i.code)).toContain("LOOT_SIGIL_SOURCE");
  });
});

// ---------------------------------------------------------------- helpers

function base(id: string): Pick<EquipmentDefinition, "id" | "version" | "status" | "example" | "name" | "requiredLevel" | "baseStats" | "affixPoolId" | "visualSetId"> {
  return { id, version: 1, status: "draft", example: true, name: { th: id }, requiredLevel: 1, baseStats: {}, affixPoolId: "affix:basic", visualSetId: "visual:basic" };
}
function sword(over: Partial<EquipmentDefinition>): EquipmentDefinition {
  return { ...base("equip:sword"), category: "WEAPON", weaponKind: "physical_melee", handedness: "one_hand", maxSigilSlots: 4, ...over };
}
function greatsword(): EquipmentDefinition {
  return { ...base("equip:greatsword"), category: "WEAPON", weaponKind: "physical_melee", handedness: "two_hand", maxSigilSlots: 4 };
}
function shield(over: Partial<EquipmentDefinition>): EquipmentDefinition {
  return { ...base("equip:shield"), category: "OFFHAND", offhandKind: "shield", maxSigilSlots: 1, ...over };
}
function hat(category: "HEAD_TOP" | "HEAD_MID" | "HEAD_LOW"): EquipmentDefinition {
  return { ...base(`equip:hat_${category.toLowerCase()}`), category, maxSigilSlots: 1 };
}
