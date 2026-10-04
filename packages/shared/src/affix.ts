/**
 * Gear rarity and random affixes (chapter 05 §2–§3, P09).
 *
 * A piece's base stats are fixed by its definition; on top it carries up to 3 random affixes, the
 * count set by its rarity. Affixes come from the pool for that type of gear, one stat at most once
 * per piece, with values scaled by the piece's required level. Rolled once by the server when the
 * piece is made and stored with it.
 *
 * Reroll (chapter 05 §3): pick one affix, pay coins and the pool's material, see a new roll for that
 * slot only, then keep the old or the new one. The resources are spent on the roll, whichever is kept.
 */
import { z } from "zod";
import type { Rng } from "./rng";
import type { RulesConfig } from "./rules";
import type { AffixPool, EquipmentDefinition, Rarity, RolledAffix } from "./schemas";
import { RaritySchema, RolledAffixSchema } from "./schemas";
import { GEAR_STAT_KEYS } from "./equipment";
import type { ValidationIssue } from "./validators";

export const RARITIES = RaritySchema.options;

export const RARITY_NAME_TH: Record<Rarity, string> = {
  COMMON: "ธรรมดา",
  UNCOMMON: "ดี",
  RARE: "หายาก",
  EPIC: "มหากาพย์",
  LEGENDARY: "ตำนาน",
};

/** Value of one affix at this item level: the Lv1 roll scaled up, never below 1. */
export function scaleAffix(rules: RulesConfig, lv1Value: number, requiredLevel: number): number {
  const per = rules.provisional.affixLevelScalePct.value;
  return Math.max(1, Math.round(lv1Value * (1 + ((requiredLevel - 1) * per) / 100)));
}

/** Rarity and affixes for a newly made piece. */
export function rollGear(
  rules: RulesConfig,
  def: EquipmentDefinition,
  pool: AffixPool | undefined,
  rng: Rng,
): { rarity: Rarity; affixes: RolledAffix[] } {
  const weights = rules.provisional.gearRarityWeights.value;
  const rarity = RARITIES[rng.pickWeighted(RARITIES.map((r) => weights[r]))]!;
  const count = Math.min(rules.provisional.affixCountByRarity.value[rarity], pool?.entries.length ?? 0);
  const left = [...(pool?.entries ?? [])];
  const affixes: RolledAffix[] = [];
  for (let i = 0; i < count; i++) {
    const at = rng.pickWeighted(left.map((e) => e.weight));
    const e = left.splice(at, 1)[0]!;
    affixes.push({ stat: e.stat, value: scaleAffix(rules, e.min + rng.nextInt(e.max - e.min + 1), def.requiredLevel) });
  }
  return { rarity, affixes };
}

/** Content check: pools only roll stats the formulas know, ranges are sane, every gear names a real pool. */
export function validateAffixPools(
  rules: RulesConfig,
  pools: readonly AffixPool[],
  defs: readonly EquipmentDefinition[],
  items?: ReadonlyMap<string, unknown>,
): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  const issue = (message: string, path: string) => out.push({ code: "INVALID_COMMAND", message, path });
  const most = Math.max(...Object.values(rules.provisional.affixCountByRarity.value));
  const ids = new Set<string>();
  for (const p of pools) {
    ids.add(p.id);
    const stats = new Set<string>();
    for (const e of p.entries) {
      if (!(GEAR_STAT_KEYS as readonly string[]).includes(e.stat)) issue(`${p.id} rolls unknown stat ${e.stat}`, p.id);
      if (e.max < e.min) issue(`${p.id} ${e.stat} max < min`, p.id);
      if (stats.has(e.stat)) issue(`${p.id} lists ${e.stat} twice`, p.id);
      stats.add(e.stat);
    }
    if (items !== undefined && !items.has(p.rerollItemId)) issue(`${p.id} rerolls with missing item ${p.rerollItemId}`, p.id);
    if (p.entries.length < most) issue(`${p.id} has ${p.entries.length} stats; the top rarity rolls ${most} different ones`, p.id);
  }
  for (const d of defs) if (!ids.has(d.affixPoolId)) issue(`${d.id} names missing affix pool ${d.affixPoolId}`, d.id);
  return out;
}

// ---------------------------------------------------------------- reroll

export const AffixRerollRequestSchema = z
  .object({
    operationId: z.string().min(8).max(120),
    equipmentId: z.string().min(1).max(120),
    /** Which affix to replace (0-based). */
    slot: z.number().int().min(0).max(2),
    /** The affixes the player saw; the server refuses if the piece changed. */
    expectedAffixes: z.array(RolledAffixSchema).max(3),
    expectedCost: z.object({ coins: z.number().int().min(0), itemId: z.string().min(1), quantity: z.number().int().min(0) }).strict(),
  })
  .strict();
export type AffixRerollRequest = z.infer<typeof AffixRerollRequestSchema>;

export const AffixChooseRequestSchema = z
  .object({
    operationId: z.string().min(8).max(120),
    equipmentId: z.string().min(1).max(120),
    /** The reroll this choice answers. */
    rerollOperationId: z.string().min(8).max(120),
    keep: z.enum(["old", "new"]),
  })
  .strict();
export type AffixChooseRequest = z.infer<typeof AffixChooseRequestSchema>;

/** A rolled replacement waiting for the player's choice, stored on the piece. */
export interface PendingAffix {
  operationId: string;
  slot: number;
  affix: RolledAffix;
}

/** What one reroll of this piece costs, shown before confirming. */
export function affixRerollCost(rules: RulesConfig, def: EquipmentDefinition, pool: AffixPool): { coins: number; itemId: string; quantity: number } {
  const c = rules.provisional.affixRerollCost.value;
  return {
    coins: c.coinsBase + c.coinsPerLevel * def.requiredLevel,
    itemId: pool.rerollItemId,
    quantity: c.materialBase + Math.floor(def.requiredLevel / 10) * c.materialPerTenLevels,
  };
}

/**
 * A new affix for `slot`: any pool stat not already on another slot (the current one may come back
 * with a new value), at this piece's level. Null when the slot does not exist.
 */
export function rerollAffix(rules: RulesConfig, def: EquipmentDefinition, pool: AffixPool, current: readonly RolledAffix[], slot: number, rng: Rng): RolledAffix | null {
  if (slot < 0 || slot >= current.length) return null;
  const taken = new Set(current.filter((_, i) => i !== slot).map((a) => a.stat));
  const left = pool.entries.filter((e) => !taken.has(e.stat));
  const e = left[rng.pickWeighted(left.map((x) => x.weight))]!;
  return { stat: e.stat, value: scaleAffix(rules, e.min + rng.nextInt(e.max - e.min + 1), def.requiredLevel) };
}
