/**
 * Builders for player tree skills (skill-budget.ts). A skill names its cost, targets and what it does;
 * the damage or heal coefficient of its first effect is derived from the tier's budget after every
 * status and later effect is paid for, so extra control or reach always costs raw power. Later
 * damage or heal effects take a stated share of the budget. Coefficients are rounded to 0.05.
 *
 * A skill made only of statuses has nothing to scale, so its MP cost is derived instead: the MP the
 * budget asks for what the statuses are worth. One too weak to fill even the cheapest cost at its
 * cooldown is strengthened instead: chances go up 5 points at a time (to 100), then turns one at a time
 * (to 4), status by status in turn, until it reaches 90% of that budget. The written numbers are the
 * floor; the built skill says what it really does.
 */
import { z } from "zod";
import { BUDGET, damageRiderMult, minMp, mpForValue, skillBudget, statusValue, valuedOnce } from "../skill-budget";
import type { JobTier } from "../job";
import { PassiveSchema, PassiveTriggerSchema, type DamageEffect, type EffectTarget, type Element, type PassiveModifier, type SkillDefinition, type SkillLevelStep, type StatusApplication, type TargetRule } from "../schemas";
import type { StatusId } from "../status";

const meta = { version: 1, status: "draft", example: true } as const;
type Effect = SkillDefinition["effectSequence"][number];
type Riders = Partial<Pick<DamageEffect, "penetrationPct" | "accuracyBonusPct" | "critBonusPct" | "execute" | "lifestealPct" | "recoilPct" | "bonusVsStatus">>;

export const st = (statusId: StatusId, chancePct: number, turns: number, more: Partial<StatusApplication> = {}): StatusApplication => ({ statusId, chancePct, turns, ...more });

/** How a skill grows with its level (steps for levels 2–10; the tree caps the level). */
export type Growth = "dmg" | "heal" | "mixed" | "buff" | "debuff";

function steps(g: Growth, mpCost: number): SkillLevelStep[] {
  const plan: [SkillLevelStep["kind"], number][] =
    g === "dmg"
      ? Array(9).fill(["power", 7])
      : g === "heal"
        ? Array(9).fill(["power", 8])
        : g === "mixed"
          ? [["power", 6], ["status_chance", 3], ["power", 6], ["status_turns", 1], ["power", 6], ["status_chance", 3], ["power", 6], ["status_chance", 3], ["power", 6]]
          : g === "debuff"
            ? [["status_chance", 4], ["status_chance", 4], ["status_turns", 1], ["status_chance", 4], ["status_chance", 4], ["status_turns", 1], ["status_chance", 4], ["status_chance", 4], ["status_turns", 1]]
            : [["mp_cost", -1], ["status_turns", 1], ["power", 10], ["mp_cost", -1], ["status_turns", 1], ["power", 10], ["mp_cost", -1], ["status_turns", 1], ["power", 10]];
  // A cheap buff cannot drop its MP cost below a third: those steps become power instead.
  let mp = mpCost;
  return plan.map(([kind, value], i) => {
    if (kind === "mp_cost" && mp - 1 < Math.ceil(mpCost * 0.67)) return { atLevel: i + 2, kind: "power", value: 10 };
    if (kind === "mp_cost") mp -= 1;
    return { atLevel: i + 2, kind, value };
  });
}

/** The first effect: damage, heal or statuses. */
export type Primary =
  | { kind: "damage"; damageType: "physical" | "magic"; element?: Element; own?: true; riders?: Riders; statuses?: StatusApplication[] }
  | { kind: "heal"; flat?: number; restoreMp?: number; statuses?: StatusApplication[] }
  | { kind: "status"; statuses: StatusApplication[] }
  | { kind: "revive"; hpPct: number };

/** A later effect: statuses, or damage/heal with a share of the budget. */
export type Then =
  | { kind: "status"; target: EffectTarget; statuses: StatusApplication[] }
  | { kind: "heal"; target: EffectTarget; share: number; statuses?: StatusApplication[] }
  | { kind: "damage"; target: EffectTarget; share: number; damageType: "physical" | "magic"; own?: true; element?: Element; statuses?: StatusApplication[] };

export const D = (damageType: "physical" | "magic", o: Omit<Extract<Primary, { kind: "damage" }>, "kind" | "damageType"> = {}): Primary => ({ kind: "damage", damageType, ...o });
export const H = (o: Omit<Extract<Primary, { kind: "heal" }>, "kind"> = {}): Primary => ({ kind: "heal", ...o });
export const S = (...statuses: StatusApplication[]): Primary => ({ kind: "status", statuses });
export const R = (hpPct: number): Primary => ({ kind: "revive", hpPct });
export const tS = (target: EffectTarget, ...statuses: StatusApplication[]): Then => ({ kind: "status", target, statuses });
export const tH = (target: EffectTarget, share: number, statuses?: StatusApplication[]): Then => ({ kind: "heal", target, share, ...(statuses ? { statuses } : {}) });
export const tD = (target: EffectTarget, damageType: "physical" | "magic", share: number, o: { own?: true; element?: Element; statuses?: StatusApplication[] } = {}): Then => ({ kind: "damage", target, share, damageType, ...o });

const round05 = (x: number) => Math.max(0.3, Math.round(x * 20) / 20);
const factorOf = (rule: TargetRule, t: EffectTarget) => (t === "primary" ? BUDGET.targetFactor[rule] : BUDGET.secondaryFactor[t]);
const sumStatus = (l: readonly StatusApplication[] | undefined) => (l ?? []).reduce((n, a) => n + statusValue(a), 0);

const statusOnly = (x: SkillSpec) => x.primary.kind === "status" && (x.then ?? []).every((t) => t.kind === "status");

function derivedMp(x: SkillSpec): number {
  const value = statusOnlyValue(x);
  return Math.max(minMp(x.tier), Math.round(mpForValue(x.tier, value, x.cd)));
}

function statusOnlyValue(x: SkillSpec): number {
  const f = BUDGET.targetFactor[x.target];
  return (x.primary.kind === "status" ? f * sumStatus(x.primary.statuses) : 0) + (x.then ?? []).reduce((n, t) => n + factorOf(x.target, t.target) * sumStatus(t.statuses), 0);
}

/** Raise a too-weak status-only skill to 90% of the cheapest budget at its cooldown. */
function fill(spec: SkillSpec): SkillSpec {
  const goal = 0.9 * skillBudget(spec.tier, minMp(spec.tier), spec.cd);
  const lists = [spec.primary.kind === "status" ? spec.primary.statuses.map((a) => ({ ...a })) : [], ...(spec.then ?? []).map((t) => t.statuses?.map((a) => ({ ...a })) ?? [])];
  const rebuilt = (): SkillSpec => ({
    ...spec,
    primary: spec.primary.kind === "status" ? { kind: "status", statuses: lists[0]! } : spec.primary,
    ...(spec.then ? { then: spec.then.map((t, i) => ({ ...t, statuses: lists[i + 1]! })) as Then[] } : {}),
  });
  const all = lists.flat();
  for (let guard = 0; guard < 200 && statusOnlyValue(rebuilt()) < goal; guard++) {
    const a = all[guard % all.length]!;
    if (a.chancePct < 100) a.chancePct = Math.min(100, a.chancePct + 5);
    else if (!valuedOnce(a.statusId) && a.turns < BUDGET.maxValuedTurns) a.turns += 1;
    else if (all.every((b) => b.chancePct >= 100 && (valuedOnce(b.statusId) || b.turns >= BUDGET.maxValuedTurns))) break;
  }
  return rebuilt();
}

export interface SkillSpec {
  id: string;
  th: string;
  tier: JobTier;
  target: TargetRule;
  range?: "melee" | "ranged";
  mp: number;
  cd: number;
  grow: Growth;
  primary: Primary;
  then?: Then[];
}

export function skill(spec: SkillSpec): SkillDefinition {
  const filled = statusOnly(spec) ? fill(spec) : spec;
  const x = { ...filled, mp: statusOnly(filled) ? derivedMp(filled) : filled.mp };
  const budget = skillBudget(x.tier, x.mp, x.cd);
  const later: Effect[] = (x.then ?? []).map((t) => {
    const f = factorOf(x.target, t.target);
    if (t.kind === "status") return { kind: "status", target: t.target, statuses: t.statuses };
    if (t.kind === "heal") return { kind: "heal", target: t.target, coefficient: round05((budget * t.share) / f), flat: 0, ...(t.statuses ? { statuses: t.statuses } : {}) };
    return { kind: "damage", target: t.target, damageType: t.damageType, coefficient: round05((budget * t.share) / f), flat: 0, element: t.element ?? "NEUTRAL", ...(t.own ? { ownElement: true as const } : {}), ...(t.statuses ? { statuses: t.statuses } : {}) };
  });
  const laterValue = (x.then ?? []).reduce((n, t) => {
    const f = factorOf(x.target, t.target);
    if (t.kind === "status") return n + f * sumStatus(t.statuses);
    return n + budget * t.share + (t.kind === "damage" ? 0.9 : 1) * f * sumStatus(t.statuses);
  }, 0);
  const f = BUDGET.targetFactor[x.target];
  const left = budget - laterValue;
  const p = x.primary;
  let first: Effect;
  if (p.kind === "damage") {
    const riders = p.riders ?? {};
    const coefficient = round05((left - f * 0.9 * sumStatus(p.statuses)) / (f * damageRiderMult(riders)));
    first = { kind: "damage", damageType: p.damageType, coefficient, flat: 0, element: p.element ?? "NEUTRAL", ...(p.own ? { ownElement: true as const } : {}), ...riders, ...(p.statuses ? { statuses: p.statuses } : {}) };
  } else if (p.kind === "heal") {
    const coefficient = round05((left - (p.restoreMp ?? 0) / 100 * f - f * sumStatus(p.statuses) - (p.flat ?? 0) / 200 * f) / f);
    first = { kind: "heal", coefficient, flat: p.flat ?? 0, ...(p.restoreMp ? { restoreMp: p.restoreMp } : {}), ...(p.statuses ? { statuses: p.statuses } : {}) };
  } else if (p.kind === "status") first = { kind: "status", statuses: p.statuses };
  else first = { kind: "revive", hpPct: p.hpPct };
  return {
    id: x.id,
    ...meta,
    name: { th: x.th },
    kind: "active",
    ownerKind: "player",
    targetRule: x.target,
    range: x.range ?? "ranged",
    mpCost: x.mp,
    cooldown: x.cd,
    effectSequence: [first, ...later],
    tags: ["class", `tier${x.tier}`],
    levelSteps: steps(x.grow, x.mp),
  };
}

export function passive(id: string, th: string, triggers: z.input<typeof PassiveTriggerSchema>[], modifiers: PassiveModifier[] = [], tier: JobTier = 1): SkillDefinition {
  return {
    id,
    ...meta,
    name: { th },
    kind: "passive",
    ownerKind: "player",
    targetRule: "none",
    range: "melee",
    mpCost: 0,
    cooldown: 0,
    effectSequence: [],
    tags: ["class", `tier${tier}`],
    passive: PassiveSchema.parse({ triggers, modifiers }),
  };
}
