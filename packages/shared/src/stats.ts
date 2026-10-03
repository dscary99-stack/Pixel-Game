/**
 * Player stat points and derived stats. Formulas are PROVISIONAL (P03, P04; chapter 03 §4).
 */
import type { RulesConfig } from "./rules";
import type { PrimaryStats } from "./schemas";

export const PRIMARY_STATS = ["STR", "VIT", "INT", "DEX", "AGI", "SPI"] as const;

export interface GearBonuses {
  HP?: number;
  MP?: number;
  PATK?: number;
  MATK?: number;
  SUPPORT?: number;
  PDEF?: number;
  MDEF?: number;
  SPD?: number;
  ACCURACY_PCT?: number;
  EVASION_PCT?: number;
  CRIT_PCT?: number;
  CRIT_DAMAGE?: number;
}

export interface DerivedStats {
  maxHp: number;
  maxMp: number;
  patk: number;
  matk: number;
  support: number;
  pdef: number;
  mdef: number;
  spd: number;
  /** Percent values as in chapter 03 (Accuracy 90 + 0.2*DEX ...). */
  accuracyPct: number;
  evasionPct: number;
  critPct: number;
  critDamageBonus: number;
}

export function deriveStats(level: number, p: PrimaryStats, gear: GearBonuses = {}): DerivedStats {
  const L = level;
  return {
    maxHp: 400 + 30 * (L - 1) + 25 * p.VIT + (gear.HP ?? 0),
    maxMp: 60 + 4 * (L - 1) + 3 * p.INT + 5 * p.SPI + (gear.MP ?? 0),
    patk: 20 + 3 * p.STR + (gear.PATK ?? 0),
    matk: 20 + 3 * p.INT + (gear.MATK ?? 0),
    support: 20 + 3 * p.SPI + (gear.SUPPORT ?? 0),
    pdef: 2 * p.VIT + (gear.PDEF ?? 0),
    mdef: 2 * p.SPI + (gear.MDEF ?? 0),
    spd: 100 + p.AGI + (gear.SPD ?? 0),
    accuracyPct: 90 + 0.2 * p.DEX + (gear.ACCURACY_PCT ?? 0),
    evasionPct: 0.15 * p.AGI + (gear.EVASION_PCT ?? 0),
    critPct: 5 + 0.1 * p.DEX + (gear.CRIT_PCT ?? 0),
    critDamageBonus: gear.CRIT_DAMAGE ?? 0,
  };
}

/** Points to raise one primary stat from `from` to `to` using the P03 cost bands. */
export function statRaiseCost(rules: RulesConfig, from: number, to: number): number {
  const cap = rules.provisional.manualStatCap.value;
  if (to > cap) throw new Error(`stat ${to} exceeds manual cap ${cap}`);
  let cost = 0;
  for (let v = from + 1; v <= to; v++) {
    const band = rules.provisional.statCostBands.value.find(([lo, hi]) => v >= lo && v <= hi);
    if (band === undefined) throw new Error(`no cost band for value ${v}`);
    cost += band[2];
  }
  return cost;
}

export function totalStatPointsAtLevel(rules: RulesConfig, level: number): number {
  return rules.provisional.statPointsPerLevel.value * (level - 1);
}

/** Validates a manual allocation: start value, cap, and total cost within the level budget. */
export function validateAllocation(
  rules: RulesConfig,
  level: number,
  stats: PrimaryStats,
): { ok: true; spent: number } | { ok: false; reason: string } {
  const start = rules.provisional.primaryStatStart.value;
  let spent = 0;
  for (const key of PRIMARY_STATS) {
    const v = stats[key];
    if (v < start) return { ok: false, reason: `${key} below start ${start}` };
    if (v > rules.provisional.manualStatCap.value) return { ok: false, reason: `${key} above cap` };
    spent += statRaiseCost(rules, start, v);
  }
  const budget = totalStatPointsAtLevel(rules, level);
  if (spent > budget) return { ok: false, reason: `spent ${spent} > budget ${budget}` };
  return { ok: true, spent };
}
