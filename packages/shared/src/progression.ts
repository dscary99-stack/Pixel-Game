/**
 * EXP, levels and stat points (chapter 03 §4, chapter 04 §3–§4, P03). The curve and EXP amounts are
 * prototype values (tagged P03/P05 in rules.ts): the design has no tested EXP table yet.
 *
 * - Level is derived from cumulative EXP; the stored level is only a cache the server re-syncs.
 * - The player character and every companion that started the fight each get the full EXP of a kill
 *   or capture, KO'd included; nothing is split (chapter 04 §4). Auto battles give the same EXP (P01).
 * - Players spend +3 points per level with the P03 cost bands; stats only go up (no free respec).
 * - Companion primary-stat growth weights are OPEN (chapter 04 §4), so a companion's level raises
 *   only its level-based HP/MP for now.
 */
import { z } from "zod";
import type { Rank, RulesConfig } from "./rules";
import { PrimaryStatsSchema, type PrimaryStats } from "./schemas";
import { PRIMARY_STATS, statRaiseCost, totalStatPointsAtLevel, validateAllocation } from "./stats";

/** EXP needed to go from `level` to `level + 1`. */
export function expToNext(rules: RulesConfig, level: number): number {
  const { base, exponent } = rules.provisional.expCurve.value;
  return Math.round(base * Math.pow(level, exponent));
}

/** Cumulative EXP needed to reach `level` from Lv1. */
export function expForLevel(rules: RulesConfig, level: number): number {
  let total = 0;
  for (let l = 1; l < level; l++) total += expToNext(rules, l);
  return total;
}

/** The level a cumulative EXP total reaches, capped. */
export function levelForExp(rules: RulesConfig, exp: number, cap: number): number {
  let level = 1;
  let need = expToNext(rules, 1);
  let left = exp;
  while (level < cap && left >= need) {
    left -= need;
    level++;
    need = expToNext(rules, level);
  }
  return level;
}

/** Progress inside the current level, for an EXP bar. */
export function expProgress(rules: RulesConfig, exp: number, cap: number): { level: number; into: number; need: number | null } {
  const level = levelForExp(rules, exp, cap);
  if (level >= cap) return { level, into: 0, need: null };
  return { level, into: exp - expForLevel(rules, level), need: expToNext(rules, level) };
}

/** EXP from defeating (or capturing) one wild enemy. Wild level never scales by map (C01). */
export function killExp(rules: RulesConfig, wildLevel: number, rank: Rank | null): number {
  return rules.provisional.killExpPerWildLevel.value * wildLevel * rules.provisional.rankExpMultiplier.value[rank ?? "NORMAL"];
}

/** EXP a companion gets from the same reward. */
export function companionExp(rules: RulesConfig, exp: number): number {
  return Math.floor(exp * rules.provisional.companionExpMultiplier.value);
}

export const AllocateStatsRequestSchema = z
  .object({ expectedVersion: z.number().int().min(1), stats: PrimaryStatsSchema })
  .strict();
export type AllocateStatsRequest = z.infer<typeof AllocateStatsRequestSchema>;

export type AllocationPlan =
  | { ok: true; spent: number; unspent: number }
  | { ok: false; code: "STAT_DECREASE" | "OVER_BUDGET"; message: string };

/** New stats must not lower any stat and must fit the level's point budget (P03). */
export function planAllocation(rules: RulesConfig, level: number, current: PrimaryStats, next: PrimaryStats): AllocationPlan {
  for (const k of PRIMARY_STATS) if (next[k] < current[k]) return { ok: false, code: "STAT_DECREASE", message: `${k} cannot go down` };
  const v = validateAllocation(rules, level, next);
  if (!v.ok) return { ok: false, code: "OVER_BUDGET", message: v.reason };
  return { ok: true, spent: v.spent, unspent: totalStatPointsAtLevel(rules, level) - v.spent };
}

/** Points left to spend at this level. */
export function unspentPoints(rules: RulesConfig, level: number, stats: PrimaryStats): number {
  const start = rules.provisional.primaryStatStart.value;
  let spent = 0;
  for (const k of PRIMARY_STATS) spent += statRaiseCost(rules, start, stats[k]);
  return totalStatPointsAtLevel(rules, level) - spent;
}
