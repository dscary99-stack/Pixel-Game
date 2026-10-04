/**
 * Gear rarity and random affixes (chapter 05 §2–§3, P09).
 *
 * A piece's base stats are fixed by its definition; on top it carries up to 3 random affixes, the
 * count set by its rarity. Affixes come from the pool for that type of gear, one stat at most once
 * per piece, with values scaled by the piece's required level. Rolled once by the server when the
 * piece is made and stored with it; nothing re-rolls (a paid reroll is later work).
 */
import type { Rng } from "./rng";
import type { RulesConfig } from "./rules";
import type { AffixPool, EquipmentDefinition, Rarity, RolledAffix } from "./schemas";
import { RaritySchema } from "./schemas";
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
export function validateAffixPools(rules: RulesConfig, pools: readonly AffixPool[], defs: readonly EquipmentDefinition[]): ValidationIssue[] {
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
    if (p.entries.length < most) issue(`${p.id} has ${p.entries.length} stats; the top rarity rolls ${most} different ones`, p.id);
  }
  for (const d of defs) if (!ids.has(d.affixPoolId)) issue(`${d.id} names missing affix pool ${d.affixPoolId}`, d.id);
  return out;
}
