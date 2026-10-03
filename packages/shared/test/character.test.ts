import { describe, expect, it } from "vitest";
import {
  CLASS1_DEFINITIONS,
  CharacterNameSchema,
  CreateCharacterRequestSchema,
  DEV_FIXTURE_RULES,
  PRODUCTION_RULES,
  RACE_DEFINITIONS,
  companionSetups,
  createBattle,
  exampleContentMaps,
  playerSetup,
  teamFormation,
  type CharacterView,
  type MonsterInstance,
  type SpeciesDefinition,
} from "../src";

const rules = PRODUCTION_RULES;
const content = exampleContentMaps();

const character = (over: Partial<CharacterView> = {}): CharacterView => ({
  id: "char:x",
  name: "นัท",
  classId: "class:ranger",
  raceId: "race:human",
  element: "WATER",
  level: 1,
  xp: 0,
  primaryStats: { STR: 10, VIT: 10, INT: 10, DEX: 10, AGI: 10, SPI: 10 },
  hp: null,
  mp: null,
  version: 1,
  team: [],
  ...over,
});

const pet = (id: string, speciesId: string, element: MonsterInstance["element"], hp: number | null = null) => ({
  id,
  speciesId,
  ownerId: "acct:a",
  currentLevel: 1,
  xp: 0,
  rebirthStage: 0,
  element,
  primaryStats: { STR: 10, VIT: 10, INT: 10, DEX: 10, AGI: 10, SPI: 10 },
  growthHistoryVersion: 1,
  growthSeed: "seed:fixture",
  trainedSkillLevels: {},
  bond: 0,
  originRecord: { kind: "capture" as const, at: "2026-10-03T00:00:00Z" },
  ownershipVersion: 1,
  lockState: "free" as const,
  hp,
  mp: null,
});

describe("character contracts", () => {
  it("P16 draft lists: 9 Class1 and 8 races", () => {
    expect(CLASS1_DEFINITIONS).toHaveLength(9);
    expect(RACE_DEFINITIONS).toHaveLength(8);
  });

  it("names: Thai and English, 2–16 characters, single inner spaces, trimmed", () => {
    expect(CharacterNameSchema.parse("  นัท  ")).toBe("นัท");
    expect(CharacterNameSchema.parse("Nut 99")).toBe("Nut 99");
    for (const bad of ["x", "", "a".repeat(17), "a  b", "<script>", "a\nb"]) expect(CharacterNameSchema.safeParse(bad).success, bad).toBe(false);
  });

  it("the starting element is one of the six (NEUTRAL is not a choice)", () => {
    const base = { operationId: "op_12345678", name: "นัท", classId: "class:bard", raceId: "race:skyborn" };
    expect(CreateCharacterRequestSchema.safeParse({ ...base, element: "LIGHT" }).success).toBe(true);
    expect(CreateCharacterRequestSchema.safeParse({ ...base, element: "NEUTRAL" }).success).toBe(false);
  });
});

describe("teamFormation (P15: 3 front, 3 back, player front-centre)", () => {
  const fake = (archetype: SpeciesDefinition["archetype"]) => ({ archetype }) as SpeciesDefinition;
  const species = new Map([
    ["species:t1", fake("tank")],
    ["species:t2", fake("tank")],
    ["species:t3", fake("physical")],
    ["species:s1", fake("support")],
    ["species:m1", fake("magic")],
  ]);

  it("fills all 5 cells around the player without overlap", () => {
    const team = ["species:t1", "species:t2", "species:t3", "species:s1", "species:m1"].map((speciesId, i) => ({ instanceId: `m${i}`, speciesId }));
    const slots = teamFormation(rules, team, species);
    const cells = slots.map((s) => `${s.row}:${s.slot}`);
    expect(new Set([...cells, "front:1"]).size).toBe(6);
    // Two tanks take the free front cells; the third front-liner spills to the back row.
    expect(slots.slice(0, 2).map((s) => s.row)).toEqual(["front", "front"]);
    expect(slots[2]!.row).toBe("back");
  });

  it("a stored character and team make a battle the kernel accepts, with stored HP", () => {
    const team = teamFormation(
      rules,
      [
        { instanceId: "m1", speciesId: "species:armor_crab" },
        { instanceId: "m2", speciesId: "species:lantern_snail" },
        { instanceId: "m3", speciesId: "species:ember_fox" },
      ],
      content.species,
    );
    const instances = new Map([
      ["m1", pet("m1", "species:armor_crab", "EARTH", 0)],
      ["m2", pet("m2", "species:lantern_snail", "LIGHT")],
      ["m3", pet("m3", "species:ember_fox", "FIRE", 12)],
    ]);
    const player = playerSetup("acct:a", character({ hp: 50 }));
    expect(player.basicAttackRange).toBe("ranged");
    const r = createBattle(DEV_FIXTURE_RULES, content, {
      battleId: "battle:c",
      originMode: "manual",
      seed: "s",
      player,
      companions: companionSetups(team, instances),
      enemies: [{ unitId: "e1", speciesId: "species:armor_crab", element: "WATER", row: "front", slot: 2 }],
      bag: {},
    });
    if (!r.ok) throw new Error(r.message);
    const unit = (id: string) => r.state.units.find((u) => u.unitId === id)!;
    expect(unit("player").hp).toBe(50);
    expect(unit("ally:m1")).toMatchObject({ hp: 0, ko: true });
    expect(unit("ally:m3").hp).toBe(12);
    expect(unit("ally:m2").hp).toBe(unit("ally:m2").stats.maxHp);
  });
});
