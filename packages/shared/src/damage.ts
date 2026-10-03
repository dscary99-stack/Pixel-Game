/**
 * Hit / crit / armor / element / damage (chapter 03 §5). PROVISIONAL formulas (P04, P15).
 * No damage variance; round once, half-up, on the result.
 */
import type { RulesConfig } from "./rules";
import type { Element } from "./schemas";

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Half-up rounding with a tiny epsilon so 216.6666 and 324.99999999 land where a human expects. */
export function roundHalfUp(x: number): number {
  return Math.floor(x + 0.5 + 1e-9);
}

/** Chance in basis points (0–10000) so RNG comparisons are integer. */
export function hitChanceBp(rules: RulesConfig, accuracyPct: number, evasionPct: number, skillModifierPct = 0): number {
  const [lo, hi] = rules.provisional.hitChanceClampPct.value;
  return Math.round(clamp(accuracyPct - evasionPct + skillModifierPct, lo, hi) * 100);
}

export function critChanceBp(rules: RulesConfig, critPct: number): number {
  const [lo, hi] = rules.provisional.critChanceClampPct.value;
  return Math.round(clamp(critPct, lo, hi) * 100);
}

export function critMultiplier(rules: RulesConfig, critDamageBonus: number): number {
  return Math.min(rules.provisional.critBaseMultiplier.value + critDamageBonus, rules.provisional.critMaxMultiplier.value);
}

export interface DefenseModifiers {
  /** Percent armor reduction debuff (capped by P04, 50%). */
  armorReductionPct?: number;
  /** Percent penetration (capped by P04, 40%). */
  penetrationPct?: number;
  flatPenetration?: number;
}

/** Order: reduction debuff, then percent pen, then flat pen, then max(0, ...). */
export function effectiveDefense(rules: RulesConfig, defense: number, m: DefenseModifiers = {}): number {
  const red = clamp(m.armorReductionPct ?? 0, 0, rules.provisional.armorReductionCapPct.value) / 100;
  const pen = clamp(m.penetrationPct ?? 0, 0, rules.provisional.armorPenetrationCapPct.value) / 100;
  return Math.max(0, defense * (1 - red) * (1 - pen) - (m.flatPenetration ?? 0));
}

export function armorMultiplier(rules: RulesConfig, effectiveDef: number): number {
  const K = rules.provisional.armorK.value;
  return K / (K + effectiveDef);
}

/** Classic cycle Fire>Wind>Earth>Water>Fire; Light and Shadow beat each other. */
const STRONG_AGAINST: Partial<Record<Element, readonly Element[]>> = {
  FIRE: ["WIND"],
  WIND: ["EARTH"],
  EARTH: ["WATER"],
  WATER: ["FIRE"],
  LIGHT: ["SHADOW"],
  SHADOW: ["LIGHT"],
};

/** Attack element (from the skill) vs. defender element (from the unit). */
export function elementMultiplier(rules: RulesConfig, attack: Element, defender: Element): number {
  if (attack === "NEUTRAL" || defender === "NEUTRAL") return 1;
  if (STRONG_AGAINST[attack]?.includes(defender)) return rules.provisional.elementStrong.value;
  if (STRONG_AGAINST[defender]?.includes(attack)) {
    return rules.provisional.elementWeak.value;
  }
  return 1;
}

export interface DamageInput {
  attackPower: number;
  skillCoefficient: number;
  skillFlat: number;
  defense: number;
  defenseModifiers?: DefenseModifiers;
  attackElement: Element;
  defenderElement: Element;
  crit: boolean;
  critDamageBonus: number;
  /** Same-group bonuses already summed, groups multiplied (chapter 03 §5). */
  outgoingMultiplier?: number;
  incomingMultiplier?: number;
  guarding: boolean;
}

export interface DamageBreakdown {
  base: number;
  armorMultiplier: number;
  elementMultiplier: number;
  critMultiplier: number;
  guardMultiplier: number;
  unrounded: number;
  final: number;
}

export function computeDamage(rules: RulesConfig, i: DamageInput): DamageBreakdown {
  const base = i.attackPower * i.skillCoefficient + i.skillFlat;
  const arm = armorMultiplier(rules, effectiveDefense(rules, i.defense, i.defenseModifiers));
  const elem = elementMultiplier(rules, i.attackElement, i.defenderElement);
  const crit = i.crit ? critMultiplier(rules, i.critDamageBonus) : 1;
  const guard = i.guarding ? rules.provisional.guardDamageMultiplier.value : 1;
  const unrounded = base * arm * elem * crit * (i.outgoingMultiplier ?? 1) * (i.incomingMultiplier ?? 1) * guard;
  return {
    base,
    armorMultiplier: arm,
    elementMultiplier: elem,
    critMultiplier: crit,
    guardMultiplier: guard,
    unrounded,
    final: Math.max(0, roundHalfUp(unrounded)),
  };
}

/** Heal (chapter 03 §6): no miss, no crit, no revive. Overheal is discarded by the caller. */
export function computeHeal(support: number, coefficient: number, flat: number, healingMultiplier = 1): number {
  return roundHalfUp((support * coefficient + flat) * healingMultiplier);
}
