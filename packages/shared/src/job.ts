/**
 * Job levels (P29; Nut 2026-10-09): base level gives stat points, job level gives skill points.
 *
 * - Each class tier (Class1, Class2, Class3) has its own job track starting at Job 1, capped per tier.
 *   The tier a character is in now earns job EXP; a finished tier keeps its job level.
 * - Every kill or capture gives job EXP = base EXP × jobExpPct; past the tier's cap it is dropped.
 * - Job EXP to reach Job N follows the base EXP table between the tier's `baseFrom` and `baseTo`
 *   (linearly placed), so the job cap comes at about base `baseTo` when the tier started at `baseFrom`.
 * - Skill points = sum over tiers of job level × pointsPerJobLevel; spent on the skill trees
 *   (skill-tree.ts) of every tier the character has reached.
 */
import { expForLevel } from "./progression";
import type { RulesConfig } from "./rules";

export type JobTier = 1 | 2 | 3;

const tierOf = (rules: RulesConfig, tier: JobTier) => rules.provisional.jobLevels.value.tiers[tier - 1]!;

export function jobCap(rules: RulesConfig, tier: JobTier): number {
  return tierOf(rules, tier).cap;
}

/** Cumulative job EXP to reach Job `level` in this tier (Job 1 = 0). */
export function jobExpForLevel(rules: RulesConfig, tier: JobTier, level: number): number {
  const t = tierOf(rules, tier);
  const j = Math.max(1, Math.min(t.cap, level));
  const x = t.baseFrom + ((j - 1) * (t.baseTo - t.baseFrom)) / (t.cap - 1);
  const lo = Math.floor(x);
  const a = expForLevel(rules, "player", lo);
  const b = expForLevel(rules, "player", lo + 1);
  return Math.round(a + (b - a) * (x - lo)) - expForLevel(rules, "player", t.baseFrom);
}

/** Most job EXP a tier holds. */
export function jobExpCap(rules: RulesConfig, tier: JobTier): number {
  return jobExpForLevel(rules, tier, jobCap(rules, tier));
}

export function jobLevelForExp(rules: RulesConfig, tier: JobTier, exp: number): number {
  let lo = 1;
  let hi = jobCap(rules, tier);
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (jobExpForLevel(rules, tier, mid) <= exp) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** Job EXP from a base EXP award (integer, rounded down). */
export function jobExpFromBase(rules: RulesConfig, baseExp: number): number {
  return Math.floor((baseExp * rules.provisional.jobLevels.value.jobExpPct) / 100);
}

export interface JobState {
  /** The tier earning job EXP now (1 before Class2). */
  tier: JobTier;
  /** Job level per tier reached (index 0 = Class1). */
  levels: number[];
  /** Job EXP per tier reached. */
  exp: number[];
  /** Skill points earned in all tiers. */
  points: number;
}

/** Job levels and points from the stored job EXP of each tier reached. */
export function jobState(rules: RulesConfig, tier: JobTier, exp: readonly number[]): JobState {
  const tiers = Array.from({ length: tier }, (_, i) => (i + 1) as JobTier);
  const levels = tiers.map((t) => jobLevelForExp(rules, t, exp[t - 1] ?? 0));
  const per = rules.provisional.jobLevels.value.pointsPerJobLevel;
  return { tier, levels, exp: tiers.map((t) => exp[t - 1] ?? 0), points: levels.reduce((n, l) => n + l * per, 0) };
}
