/**
 * Bond (chapter 04 §6; C11 confirmed, numbers P06 PROVISIONAL, Claude's proposal).
 *
 * - 0–1000 in five tiers of 200. The bonus is small, capped, shown in the UI, and lands on the
 *   archetype's stat: tank HP, physical ATK, magic MATK, support Support power, control SPD
 *   (a stand-in until effect hit/resist exists).
 * - Gained from won fights (every companion that started it, KO'd or not). Never lost to defeat or
 *   time offline. A sale resets it to 0 (C11); there is no transfer path yet.
 */
import type { RulesConfig } from "./rules";
import type { Archetype } from "./schemas";
import type { DerivedStats } from "./stats";

export const BOND_MAX = 1000;

export const BOND_TIER_NAMES = ["รู้จัก", "คุ้นเคย", "ไว้ใจ", "คู่หู", "ลึกซึ้ง"] as const;

/** The stat each archetype's Bond bonus raises. */
export const BOND_STAT: Record<Archetype, keyof Pick<DerivedStats, "maxHp" | "patk" | "matk" | "support" | "spd">> = {
  tank: "maxHp",
  physical: "patk",
  magic: "matk",
  support: "support",
  control: "spd",
};

export function bondTier(rules: RulesConfig, bond: number): number {
  const top = rules.provisional.bondTierBonusPercent.value.length - 1;
  return Math.max(0, Math.min(top, Math.floor(bond / rules.provisional.bondTierSize.value)));
}

export function bondBonusPercent(rules: RulesConfig, bond: number): number {
  return rules.provisional.bondTierBonusPercent.value[bondTier(rules, bond)]!;
}

/** Combat stats with the Bond bonus applied to the archetype's stat. */
export function applyBond(rules: RulesConfig, archetype: Archetype, bond: number, stats: DerivedStats): DerivedStats {
  const pct = bondBonusPercent(rules, bond);
  if (pct === 0) return stats;
  const key = BOND_STAT[archetype];
  return { ...stats, [key]: Math.floor((stats[key] * (100 + pct)) / 100) };
}
