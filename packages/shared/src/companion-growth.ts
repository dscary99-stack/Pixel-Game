/**
 * Companion stat growth (chapter 04 §4, P05) and effective level (O02).
 *
 * - Every companion of a species gets the same number of points per level (equal budget); only
 *   where they land is random, by its archetype's weights. No hidden per-stat IVs.
 * - The roll is server-owned: the server picks `growthSeed` once when the companion is created and
 *   stats are a pure function of (seed, archetype, level, Rebirth stage). Reconnects, trades and
 *   recomputes always give the same numbers.
 * - Rebirth keeps the same trajectory and adds its bonus on top (+4/+7/+10% total, not added up).
 * - In a fight a companion uses min(level, player level + gap) (O02); its real level and EXP stay.
 */
import { Rng, seedRng } from "./rng";
import type { RulesConfig } from "./rules";
import type { Archetype, PrimaryStats } from "./schemas";

export const PRIMARY_KEYS = ["STR", "VIT", "INT", "DEX", "AGI", "SPI"] as const;

/** Version of the growth rule stored on each instance (1 = flat start stats before growth existed). */
export const COMPANION_GROWTH_VERSION = 2;

/** Points gained per stat from Lv1 to `level` along this seed's trajectory (before Rebirth bonus). */
export function companionGrowth(rules: RulesConfig, archetype: Archetype, growthSeed: string, level: number): PrimaryStats {
  const weights = rules.provisional.companionGrowthWeights.value[archetype];
  const w = PRIMARY_KEYS.map((k) => weights[k]);
  const out: PrimaryStats = { STR: 0, VIT: 0, INT: 0, DEX: 0, AGI: 0, SPI: 0 };
  const rng = new Rng(seedRng(`growth:${growthSeed}`));
  const per = rules.provisional.companionGrowthPointsPerLevel.value;
  for (let l = 2; l <= level; l++) for (let i = 0; i < per; i++) out[PRIMARY_KEYS[rng.pickWeighted(w)]!]++;
  return out;
}

/** Primary stats at a level: start value + growth, then the Rebirth bonus (integer, floor). */
export function companionPrimaryStats(
  rules: RulesConfig,
  archetype: Archetype,
  growthSeed: string,
  level: number,
  rebirthStage: number,
): PrimaryStats {
  const start = rules.provisional.primaryStatStart.value;
  const grown = companionGrowth(rules, archetype, growthSeed, level);
  const bonus = rebirthBonusPercent(rules, rebirthStage);
  const out = {} as PrimaryStats;
  for (const k of PRIMARY_KEYS) out[k] = Math.floor(((start + grown[k]) * (100 + bonus)) / 100);
  return out;
}

/** Total bonus over base at a Rebirth stage (0 at stage 0). */
export function rebirthBonusPercent(rules: RulesConfig, stage: number): number {
  if (stage <= 0) return 0;
  const table = rules.provisional.rebirthBonusPercent.value;
  return table[Math.min(stage, table.length) - 1]!;
}

/** The level a companion fights at (O02): never above the player's level + gap. */
export function companionEffectiveLevel(rules: RulesConfig, companionLevel: number, playerLevel: number): number {
  return Math.min(companionLevel, playerLevel + rules.provisional.companionEffectiveLevelGap.value);
}

/** What a companion fights with: its effective level and the primary stats at that level. */
export function companionCombatProfile(
  rules: RulesConfig,
  species: { archetype: Archetype },
  inst: { currentLevel: number; primaryStats: PrimaryStats; growthHistoryVersion: number; growthSeed: string; rebirthStage: number },
  playerLevel: number,
): { level: number; primaryStats: PrimaryStats } {
  const level = companionEffectiveLevel(rules, inst.currentLevel, playerLevel);
  if (inst.growthHistoryVersion < COMPANION_GROWTH_VERSION) return { level, primaryStats: inst.primaryStats };
  return { level, primaryStats: companionPrimaryStats(rules, species.archetype, inst.growthSeed, level, inst.rebirthStage) };
}
