/**
 * EXP, levels and stat points (chapter 03 §4, chapter 04 §3–§4, P03).
 *
 * - Players follow Nut's EXP table (exp-proposal-1.0, PROVISIONAL; see rules.ts playerExpTable).
 *   Companions follow Nut's companion table (companion-exp-proposal-1.0): 25% of the player's
 *   per-level EXP in the first cycle, and less EXP from enemies far above the companion (§5).
 * - Level is derived from cumulative EXP; the stored level is only a cache the server re-syncs.
 *   EXP stops at the cap's cumulative total (no banking toward Lv201) and `need` is null at the cap.
 * - A kill or capture gives the reference EXP of the enemy's fixed species level; never scaled by map
 *   or by the player's level (C01).
 * - The player character and every companion that started the fight each get their own award for a
 *   kill or capture, KO'd included; nothing is split (chapter 04 §4). Auto battles give the same EXP (P01).
 * - Players spend +3 points per level with the P03 cost bands; stats only go up (no free respec).
 * - Companion primary-stat growth weights are OPEN (chapter 04 §4), so a companion's level raises
 *   only its level-based HP/MP for now.
 */
import { z } from "zod";
import type { RulesConfig } from "./rules";
import { PrimaryStatsSchema, type PrimaryStats } from "./schemas";
import { PRIMARY_STATS, statRaiseCost, totalStatPointsAtLevel, validateAllocation } from "./stats";

export type ExpCurve = "player" | "companion";

/** Reference EXP of one normal wild enemy at fixed species level `m`: 20 + 6M + 2M². */
export function referenceNormalExp(rules: RulesConfig, m: number): number {
  const { base, linear, quadratic } = rules.provisional.referenceNormalExp.value;
  return base + linear * m + quadratic * m * m;
}

const roundHalfUpTo10 = (x: number) => 10 * Math.floor(x / 10 + 0.5);

/** Target minutes from level L to L+1, linear between adjacent anchors. */
function targetMinutes(anchors: readonly (readonly [number, number])[], level: number): number {
  for (let i = 1; i < anchors.length; i++) {
    const [l0, m0] = anchors[i - 1]!;
    const [l1, m1] = anchors[i]!;
    if (level <= l1) return m0 + ((m1 - m0) * (level - l0)) / (l1 - l0);
  }
  return anchors[anchors.length - 1]![1];
}

/** Per-level EXP and cumulative totals for one curve, built once per rules object. */
interface Table {
  cap: number;
  /** toNext[L] for 1 <= L < cap. */
  toNext: number[];
  /** cumulative[L] = EXP to reach L from Lv1, for 1 <= L <= cap. */
  cumulative: number[];
}
const tables = new WeakMap<RulesConfig, Record<ExpCurve, Table>>();

function build(cap: number, need: (level: number) => number): Table {
  const toNext = [0];
  const cumulative = [0, 0];
  for (let l = 1; l < cap; l++) {
    toNext[l] = need(l);
    cumulative[l + 1] = cumulative[l]! + toNext[l]!;
  }
  return { cap, toNext, cumulative };
}

function table(rules: RulesConfig, curve: ExpCurve): Table {
  let t = tables.get(rules);
  if (t === undefined) {
    const { anchors, killsPerMinute } = rules.provisional.playerExpTable.value;
    const percent = rules.provisional.companionExpTable.value.percentOfPlayer;
    const player = build(rules.confirmed.playerMaxLevel.value, (l) => roundHalfUpTo10(targetMinutes(anchors, l) * killsPerMinute * referenceNormalExp(rules, l)));
    // Companion rows are rounded from the delivered player rows, not from the time targets (§8).
    const playerNeed = (l: number) => player.toNext[Math.min(l, player.cap - 1)]!;
    t = { player, companion: build(rules.provisional.companionMaxLevel.value, (l) => roundHalfUpTo10((playerNeed(l) * percent) / 100)) };
    tables.set(rules, t);
  }
  return t[curve];
}

/** The curve's level cap. */
export function maxLevel(rules: RulesConfig, curve: ExpCurve): number {
  return table(rules, curve).cap;
}

/** EXP needed to go from `level` to `level + 1`; null at (or past) the cap. */
export function expToNext(rules: RulesConfig, curve: ExpCurve, level: number): number | null {
  const t = table(rules, curve);
  return level >= 1 && level < t.cap ? t.toNext[level]! : null;
}

/** Cumulative EXP needed to reach `level` from Lv1 (clamped to the cap). */
export function expForLevel(rules: RulesConfig, curve: ExpCurve, level: number): number {
  const t = table(rules, curve);
  return t.cumulative[Math.max(1, Math.min(t.cap, level))]!;
}

/** Most EXP a curve can hold: the cap's cumulative total. Grants beyond it are dropped. */
export function expCap(rules: RulesConfig, curve: ExpCurve): number {
  return expForLevel(rules, curve, maxLevel(rules, curve));
}

/** The level a cumulative EXP total reaches. */
export function levelForExp(rules: RulesConfig, curve: ExpCurve, exp: number): number {
  const { cap, cumulative } = table(rules, curve);
  let lo = 1;
  let hi = cap;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (cumulative[mid]! <= exp) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** Progress inside the current level, for an EXP bar. */
export function expProgress(rules: RulesConfig, curve: ExpCurve, exp: number): { level: number; into: number; need: number | null } {
  const level = levelForExp(rules, curve, exp);
  const need = expToNext(rules, curve, level);
  return { level, into: need === null ? 0 : exp - expForLevel(rules, curve, level), need };
}

/** EXP from defeating (or capturing) one wild enemy at its fixed species level (C01). */
export function killExp(rules: RulesConfig, wildLevel: number): number {
  return referenceNormalExp(rules, wildLevel);
}

/**
 * EXP one companion gets from one defeated or captured enemy (proposal §5): the enemy's award scaled by
 * min(1, E(min(cap, C + gap)) / E(M)), with C the companion's level at fight start and M the enemy's
 * wild level. Enemies up to C + gap give the full award; lower ones are never cut further.
 */
export function companionExp(rules: RulesConfig, award: number, companionLevel: number, wildLevel: number): number {
  const training = Math.min(maxLevel(rules, "companion"), companionLevel + rules.provisional.companionTrainingLevelGap.value);
  const num = referenceNormalExp(rules, training);
  const den = referenceNormalExp(rules, wildLevel);
  // Multiply before dividing so whole results stay exact (81,220 × 328 / 81,220 = 328, not 327.999…).
  return num >= den ? award : Math.floor((award * num) / den);
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
