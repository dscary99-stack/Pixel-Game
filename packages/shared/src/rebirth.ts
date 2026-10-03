/**
 * Companion Rebirth (chapter 04 §7; O03/O04 delegated to Claude by Nut on 2026-10-03, PROVISIONAL).
 *
 * - Any species can be reborn at max level (C: "every species ... Rebirth"), up to `maxRebirths`.
 * - It costs coins and the species' own material, at an NPC in town, outside fights; the owner's
 *   character level is the licence (O04). The trial (บททดสอบ) is not built yet.
 * - Level goes back to 1 and EXP to 0; species, element, history, Bond, owner and growth seed stay,
 *   so the same growth path repeats with the stage's bonus on top (+4/+7/+10% total).
 * - Skill variants per stage (R1 skill, R2 innate, R3 extra + cosmetic) wait on the skill system.
 */
import { z } from "zod";
import { OperationIdSchema } from "./character";
import { expForLevel } from "./progression";
import type { RulesConfig } from "./rules";
import type { ItemDefinition, LootTable, SpeciesDefinition } from "./schemas";

export const RebirthRequestSchema = z
  .object({
    operationId: OperationIdSchema,
    companionId: z.string().min(1).max(120),
    /** The stage the player saw; a second click after the first landed is refused, not repeated. */
    expectedStage: z.number().int().min(0),
  })
  .strict();
export type RebirthRequest = z.infer<typeof RebirthRequestSchema>;

/** The species' own material: the first material in its loot table's species pool. */
export function speciesMaterialItem(
  species: SpeciesDefinition,
  lootTables: ReadonlyMap<string, LootTable>,
  items: ReadonlyMap<string, ItemDefinition>,
): string | null {
  const table = lootTables.get(species.lootTableId);
  const pool = table?.pools.find((p) => p.id === "species") ?? table?.pools[0];
  return pool?.entries.find((e) => items.get(e.itemId)?.kind === "material")?.itemId ?? null;
}

export interface RebirthCost {
  nextStage: number;
  coins: number;
  materialItemId: string;
  materialQty: number;
  /** The owner's character must be at least this level (licence, O04). */
  playerLevel: number;
  /** The companion must be at this level. */
  companionLevel: number;
  /** EXP totals behind those levels: the server checks EXP, the source of truth. */
  playerExp: number;
  companionExp: number;
}

export type RebirthPlan =
  | ({ ok: true } & RebirthCost)
  | { ok: false; code: "MAX_REBIRTH" | "NO_MATERIAL"; message: string; cost?: RebirthCost };

/** What the next Rebirth of this companion costs, or why there is none. */
export function rebirthCost(
  rules: RulesConfig,
  species: SpeciesDefinition,
  stage: number,
  content: { lootTables: ReadonlyMap<string, LootTable>; items: ReadonlyMap<string, ItemDefinition> },
): RebirthPlan {
  const max = rules.provisional.maxRebirths.value;
  if (stage >= max) return { ok: false, code: "MAX_REBIRTH", message: `already at Rebirth ${stage} of ${max}` };
  const req = rules.provisional.rebirthRequirements.value;
  const materialItemId = speciesMaterialItem(species, content.lootTables, content.items);
  if (materialItemId === null) return { ok: false, code: "NO_MATERIAL", message: `${species.id} has no material in its loot table` };
  const playerLevel = req.playerLevel[stage]!;
  return {
    ok: true,
    nextStage: stage + 1,
    coins: req.coins[stage]!,
    materialItemId,
    materialQty: req.speciesMaterial[stage]!,
    playerLevel,
    companionLevel: req.companionLevel,
    playerExp: expForLevel(rules, "player", playerLevel),
    companionExp: expForLevel(rules, "companion", req.companionLevel),
  };
}
