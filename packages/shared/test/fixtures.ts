/** Test fixtures. OPEN rules are filled only through withFixtureOverrides, never as defaults. */
import {
  DEV_FIXTURE_RULES,
  PRODUCTION_RULES,
  exampleContentMaps,
  type BattleContent,
  type BattleSetup,
  type MonsterInstance,
  type SpeciesDefinition,
} from "../src/index";

export const rules = PRODUCTION_RULES;

/** Explicit TEST FIXTURE values for OPEN rules (shared with the dev server). Not decisions. */
export const fixtureRules = DEV_FIXTURE_RULES;

export function content(extraSpecies: SpeciesDefinition[] = []): BattleContent & ReturnType<typeof exampleContentMaps> {
  const maps = exampleContentMaps();
  for (const s of extraSpecies) maps.species.set(s.id, s);
  return maps;
}

/** A copy of an example species at another fixed wild level, for level-gate tests. */
export function speciesAtLevel(base: SpeciesDefinition, id: string, level: number, rank: SpeciesDefinition["rank"] = "NORMAL"): SpeciesDefinition {
  return { ...base, id, fixedWildLevel: level, rank };
}

export function companion(id: string, speciesId: string, element: MonsterInstance["element"], level = 10): MonsterInstance {
  return {
    id,
    speciesId,
    ownerId: "acct:1",
    currentLevel: level,
    xp: 0,
    rebirthStage: 0,
    element,
    primaryStats: { STR: 18, VIT: 16, INT: 12, DEX: 14, AGI: 14, SPI: 14 },
    growthHistoryVersion: 1,
    growthSeed: "seed:fixture",
    trainedSkillLevels: {},
    skillMastery: 0,
    bond: 0,
    originRecord: { kind: "starter", at: "2026-10-03T00:00:00Z" },
    ownershipVersion: 1,
    lockState: "in_battle",
  };
}

export function baseSetup(over: Partial<BattleSetup> = {}): BattleSetup {
  return {
    battleId: "battle:test",
    originMode: "manual",
    seed: "seed-1",
    player: {
      accountId: "acct:1",
      name: "Nut",
      level: 20,
      element: "FIRE",
      primaryStats: { STR: 35, VIT: 25, INT: 10, DEX: 17, AGI: 20, SPI: 10 },
      gear: { PATK: 70 },
      skillIds: ["skill:player_power_strike"],
      basicAttackRange: "melee",
      row: "front",
      slot: 1,
    },
    companions: [],
    enemies: [
      { unitId: "e1", speciesId: "species:armor_crab", element: "EARTH", row: "front", slot: 0 },
      { unitId: "e2", speciesId: "species:ember_fox", element: "FIRE", row: "front", slot: 1 },
    ],
    bag: { "item:small_potion": 3, "item:armor_crab_capture": 2, "item:ember_fox_capture": 2 },
    ...over,
  };
}
