/**
 * Companion skill levels (chapter 04 §5, P06; numbers are Claude's proposal, PROVISIONAL).
 *
 * - Each of the 3 skills and the innate has its own trained level 1–10. Level N needs the companion
 *   at `skillLevelUnlocks[N-1]` (the chapter 04 §5 table).
 * - Mastery comes from combat success only: every companion that started a won fight gets
 *   `skillMasteryPerEnemy` per enemy defeated or captured in it (Auto included, no daily cap; heals or
 *   buffs in a loop earn nothing). It is one pool per companion; the player picks which skill to train.
 * - Training spends mastery + coins + the species' material, at the town NPC, outside fights, and
 *   always succeeds once paid.
 * - Each level adds one thing, set per skill (Nut 2026-10-03): power, cheaper MP, shorter cooldown or
 *   more targets (`levelSteps`). A skill without its own table gets the default power step.
 * - Rebirth and trade keep trained levels, but a fight uses min(trained, the cap at the level the
 *   companion fights at), so a Lv1 companion after Rebirth cannot use skill Lv10.
 */
import { z } from "zod";
import { OperationIdSchema } from "./character";
import { expForLevel } from "./progression";
import { speciesMaterialItem } from "./rebirth";
import type { RulesConfig } from "./rules";
import type { ItemDefinition, LootTable, SkillDefinition, SkillLevelStep, SpeciesDefinition } from "./schemas";

export const SKILL_MAX_LEVEL = 10;

export const SkillTrainRequestSchema = z
  .object({
    operationId: OperationIdSchema,
    companionId: z.string().min(1).max(120),
    skillId: z.string().min(1).max(80),
    /** The level the player saw; a second click after the first landed is refused, not repeated. */
    expectedLevel: z.number().int().min(1).max(SKILL_MAX_LEVEL),
  })
  .strict();
export type SkillTrainRequest = z.infer<typeof SkillTrainRequestSchema>;

/** The 3 skills and the innate, in the order the UI shows them. */
export function speciesSkillSlots(species: SpeciesDefinition): string[] {
  return [...species.skillIds, species.innatePassiveId];
}

export function trainedSkillLevel(trained: Readonly<Record<string, number>>, skillId: string): number {
  return trained[skillId] ?? 1;
}

/** Highest skill level a companion at this level may use (chapter 04 §5 table). */
export function skillLevelCap(rules: RulesConfig, companionLevel: number): number {
  const unlocks = rules.provisional.skillLevelUnlocks.value;
  let cap = 1;
  unlocks.forEach((need, i) => {
    if (companionLevel >= need) cap = i + 1;
  });
  return cap;
}

/** The level a skill works at in a fight: trained, but never above what the fighting level allows. */
export function effectiveSkillLevel(rules: RulesConfig, trained: number, fightingLevel: number): number {
  return Math.max(1, Math.min(trained, skillLevelCap(rules, fightingLevel)));
}

/** The one step a skill gains when it reaches `level` (2–10). */
export function skillLevelStep(rules: RulesConfig, skill: Pick<SkillDefinition, "levelSteps">, level: number): SkillLevelStep {
  return (
    skill.levelSteps?.find((x) => x.atLevel === level) ?? { atLevel: level, kind: "power", value: rules.provisional.skillPowerPercentPerLevel.value }
  );
}

export interface SkillLevelMods {
  /** +% on the coefficient. */
  powerPercent: number;
  /** Change to MP cost and cooldown (≤ 0). */
  mpCost: number;
  cooldown: number;
  extraTargets: number;
}

/** Everything a skill has gained by this level (Lv1 = nothing). */
export function skillLevelMods(rules: RulesConfig, skill: Pick<SkillDefinition, "levelSteps">, level: number): SkillLevelMods {
  const m: SkillLevelMods = { powerPercent: 0, mpCost: 0, cooldown: 0, extraTargets: 0 };
  for (let l = 2; l <= Math.min(level, SKILL_MAX_LEVEL); l++) {
    const x = skillLevelStep(rules, skill, l);
    if (x.kind === "power") m.powerPercent += x.value;
    else if (x.kind === "mp_cost") m.mpCost += x.value;
    else if (x.kind === "cooldown") m.cooldown += x.value;
    else m.extraTargets += x.value;
  }
  return m;
}

/** Mastery each companion that started a won fight gets for it. */
export function masteryForVictory(rules: RulesConfig, enemiesResolved: number): number {
  return enemiesResolved * rules.provisional.skillMasteryPerEnemy.value;
}

export interface SkillTrainCost {
  nextLevel: number;
  mastery: number;
  coins: number;
  materialItemId: string;
  materialQty: number;
  /** The companion's real level must be at least this (the gate for nextLevel). */
  companionLevel: number;
  /** EXP total behind that level: the server checks EXP, the source of truth. */
  companionExp: number;
}

export type SkillTrainPlan =
  | ({ ok: true } & SkillTrainCost)
  | { ok: false; code: "MAX_SKILL_LEVEL" | "NOT_SPECIES_SKILL" | "NO_MATERIAL"; message: string };

/** What training this skill from `level` to the next costs, or why it cannot be trained. */
export function skillTrainCost(
  rules: RulesConfig,
  species: SpeciesDefinition,
  skillId: string,
  level: number,
  content: { lootTables: ReadonlyMap<string, LootTable>; items: ReadonlyMap<string, ItemDefinition> },
): SkillTrainPlan {
  if (!speciesSkillSlots(species).includes(skillId)) {
    return { ok: false, code: "NOT_SPECIES_SKILL", message: `${skillId} is not one of ${species.id}'s skills` };
  }
  if (level >= SKILL_MAX_LEVEL) return { ok: false, code: "MAX_SKILL_LEVEL", message: `already at skill level ${SKILL_MAX_LEVEL}` };
  const materialItemId = speciesMaterialItem(species, content.lootTables, content.items);
  if (materialItemId === null) return { ok: false, code: "NO_MATERIAL", message: `${species.id} has no material in its loot table` };
  const t = rules.provisional.skillTrainCost.value;
  const i = level - 1;
  const companionLevel = rules.provisional.skillLevelUnlocks.value[level]!;
  return {
    ok: true,
    nextLevel: level + 1,
    mastery: t.mastery[i]!,
    coins: t.coins[i]!,
    materialItemId,
    materialQty: t.speciesMaterial[i]!,
    companionLevel,
    companionExp: expForLevel(rules, "companion", companionLevel),
  };
}
