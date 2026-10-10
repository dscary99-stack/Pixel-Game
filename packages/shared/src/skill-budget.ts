/**
 * Power budget for player tree skills (Nut 2026-10-09: "ต้องคิดจริงจัง และคำนึงถึงสมดุล").
 *
 * Every active skill is measured in one unit: damage-equivalent coefficient on one target, where a
 * basic attack is 1.0. A skill's value at Lv1 should match the budget its cost buys:
 *
 *   budget = tierMult × (1 + perMp × mp / mpUnit + perCooldown × cooldown)
 *
 * and value = Σ over its effects of (what the effect does × how many targets it covers). Damage counts
 * its coefficient (with small factors for penetration, crit, accuracy, execute, lifesteal, recoil and a
 * bonus against a status); heals count their coefficient; statuses count a per-status weight × chance
 * × turns (one-time statuses count once); a revive counts two hits plus its HP share. Targets count by a factor, not
 * by head count, because a row or the whole side is rarely full and area hits split threat.
 *
 * The content helpers (content/class-trees.ts) derive each damage or heal coefficient from
 * this budget after the statuses are paid for, so a skill that also stuns hits softer. The balance
 * test keeps every skill within its band. Every number here is a first pass (P30).
 */
import type { DamageEffect, EffectTarget, SkillDefinition, StatusApplication, TargetRule } from "./schemas";
import type { StatusId } from "./status";
import type { JobTier } from "./job";

export const BUDGET = {
  tierMult: { 1: 1, 2: 1.2, 3: 1.4 } as Record<JobTier, number>,
  /** MP costs grow with the tier because max MP does. */
  mpUnit: { 1: 1, 2: 1.6, 3: 2.4 } as Record<JobTier, number>,
  perMp: 0.045,
  perCooldown: 0.12,
  /** How much covering more targets is worth (P30). */
  targetFactor: { single_enemy: 1, enemy_row: 1.7, all_enemies: 2.3, single_ally: 1, all_allies: 3.2, self: 0.8, none: 0 } as Record<TargetRule, number>,
  secondaryFactor: { self: 0.8, all_allies: 3.2, lowest_ally: 1, all_enemies: 2.3 } as Record<Exclude<EffectTarget, "primary">, number>,
  /** Turns beyond this are not worth more (fights are short). */
  maxValuedTurns: 4,
} as const;

/**
 * Damage-equivalent value of one status for one turn at 100% on one target (one-time ones: once).
 * Anchors (statusTuning): a basic hit takes about 12% of an even enemy's max HP, so a DoT of P% max HP
 * is worth P/12 a turn; a ±20% stat step is worth about a fifth of the hits it touches; a lost enemy
 * turn is worth about one hit; a shield of 1% max HP about 1/14 of a hit.
 */
export const STATUS_WEIGHT: Readonly<Record<StatusId, number>> = {
  stun: 1, sleep: 0.8, freeze: 1, petrify: 1, paralyze: 0.45, fear: 0.45, silence: 0.35, disarm: 0.35, root: 0.15,
  confuse: 0.6, charm: 1, berserk: 0.2, taunt: 0.35, mini: 0.7, doom: 2.5,
  poison: 0.42, toxic: 0.22, burn: 0.35, bleed: 0.15, frostbite: 0.2, shock: 0.25, corrode: 0.2, leech: 0.35, mana_burn: 0.15,
  blind: 0.3, atk_down: 0.2, matk_down: 0.2, def_down: 0.45, mdef_down: 0.45, spd_down: 0.15, evasion_down: 0.1, crit_down: 0.08,
  res_down: 0.1, vulnerable: 0.5, mark: 0.45, anti_heal: 0.15, unbuffable: 0.15, seal: 0.3, skill_lock: 0.3, mp_cost_up: 0.15,
  link: 0.3, zombie: 0.3, wet: 0.1, oil: 0.1,
  atk_up: 0.25, matk_up: 0.25, def_up: 0.15, mdef_up: 0.15, spd_up: 0.2, evasion_up: 0.12, accuracy_up: 0.08, crit_up: 0.12,
  res_up: 0.08, regen: 0.4, mp_regen: 0.15, dmg_reduction: 0.3, reflect: 0.25, thorns: 0.15, immunity: 0.4, endure: 0.5,
  invincible: 1.2, stealth: 0.4, counter: 0.4, protect: 0.3, shield: 0.07, focus: 0.6, imbue: 0.1, element_ward: 0.12,
  lifesteal_up: 0.15, rage: 0.12,
  knockback: 0.15, pull: 0.15, delay: 0.5, dispel: 0.5, steal_buff: 0.6, invert: 0.6, advance: 0.7, cleanse: 0.5, extend: 0.4,
};

/** One-time statuses: valued once, not per turn (instants, shields by size, focus is used up). */
const ONCE = new Set<StatusId>(["knockback", "pull", "delay", "dispel", "steal_buff", "invert", "advance", "cleanse", "extend", "shield", "focus", "doom"]);

export function skillBudget(tier: JobTier, mpCost: number, cooldown: number): number {
  return BUDGET.tierMult[tier] * (1 + (BUDGET.perMp * mpCost) / BUDGET.mpUnit[tier] + BUDGET.perCooldown * cooldown);
}

/** The MP a skill worth `value` should cost at this cooldown (the inverse of skillBudget, unrounded). */
export function mpForValue(tier: JobTier, value: number, cooldown: number): number {
  return ((value / BUDGET.tierMult[tier] - 1 - BUDGET.perCooldown * cooldown) * BUDGET.mpUnit[tier]) / BUDGET.perMp;
}

/** The cheapest MP a tier's active may cost. */
export const minMp = (tier: JobTier): number => Math.ceil(3 * BUDGET.mpUnit[tier]);

export const valuedOnce = (id: StatusId): boolean => ONCE.has(id);

export function statusValue(a: StatusApplication): number {
  const w = STATUS_WEIGHT[a.statusId];
  const chance = a.chancePct / 100;
  if (a.statusId === "shield") return w * (a.shieldPct ?? 0) * chance;
  const turns = ONCE.has(a.statusId) ? 1 : Math.min(a.turns, BUDGET.maxValuedTurns);
  return w * chance * turns * (a.stacks ?? 1);
}

/** How much a damage effect's riders multiply its coefficient's worth. */
export function damageRiderMult(e: Pick<DamageEffect, "penetrationPct" | "critBonusPct" | "accuracyBonusPct" | "execute" | "lifestealPct" | "recoilPct" | "bonusVsStatus">): number {
  let m = 1;
  m *= 1 + (e.penetrationPct ?? 0) / 250;
  m *= 1 + (e.critBonusPct ?? 0) / 300;
  m *= 1 + (e.accuracyBonusPct ?? 0) / 400;
  if (e.execute !== undefined) m *= 1 + ((e.execute.bonusPct / 100) * (e.execute.belowHpPct / 100)) * 0.6;
  if (e.bonusVsStatus !== undefined) m *= 1 + (e.bonusVsStatus.bonusPct / 100) * (e.bonusVsStatus.consume ? 0.25 : 0.35);
  m += (e.lifestealPct ?? 0) / 200;
  m -= ((e.recoilPct ?? 0) / 100) * 0.6;
  return m;
}

/** Hits land about this often; riders on a hit are worth that much less. */
const HIT_SHARE = 0.9;

function effectFactor(skill: Pick<SkillDefinition, "targetRule">, target: EffectTarget | undefined): number {
  if (target === undefined || target === "primary") return BUDGET.targetFactor[skill.targetRule];
  return BUDGET.secondaryFactor[target];
}

/** What a skill is worth at Lv1, in the budget's unit. */
export function skillValue(skill: Pick<SkillDefinition, "targetRule" | "effectSequence">): number {
  let v = 0;
  for (const e of skill.effectSequence) {
    const f = effectFactor(skill, "target" in e ? e.target : undefined);
    if (e.kind === "damage") v += f * (e.coefficient * damageRiderMult(e) + HIT_SHARE * (e.statuses ?? []).reduce((n, a) => n + statusValue(a), 0));
    else if (e.kind === "heal") v += f * (e.coefficient + e.flat / 200 + (e.restoreMp ?? 0) / 100 + (e.statuses ?? []).reduce((n, a) => n + statusValue(a), 0));
    else if (e.kind === "status") v += f * e.statuses.reduce((n, a) => n + statusValue(a), 0);
    // A revive brings a whole unit back: worth two hits plus the HP it comes back with.
    else v += 2 + (e.hpPct / 100) * 1.6;
  }
  return v;
}
