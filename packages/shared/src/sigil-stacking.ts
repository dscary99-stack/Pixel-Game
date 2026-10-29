/**
 * How copies of one trigger Sigil combine (chapter 05 §5, P34): one roll with a combined chance and a
 * stronger effect, never one roll per copy. Used by the battle kernel and shown before installing.
 */
import type { RulesConfig } from "./rules";
import type { PassiveAction, PassiveModifier } from "./schemas";

/** Chance in basis points that one roll for `copies` copies of a `chancePct` trigger succeeds (P34). */
export function sigilTriggerChanceBp(chancePct: number, copies: number): number {
  return Math.round(10_000 * (1 - Math.pow(1 - chancePct / 100, Math.max(1, copies))));
}

/** A trigger Sigil's effect with `copies` worn (P34): each copy past the first adds a share of it. */
export function scaleSigilAction(rules: RulesConfig, a: PassiveAction, copies: number): PassiveAction {
  if (copies <= 1) return a;
  const f = 1 + ((copies - 1) * rules.provisional.sigilTriggerStacking.value.extraCopyStrengthPct) / 100;
  if (a.kind === "heal") return { ...a, pctMaxHp: Math.min(50, Math.floor(a.pctMaxHp * f)) };
  if (a.kind === "restore_mp") return { ...a, amount: Math.floor(a.amount * f) };
  return { ...a, statuses: a.statuses.map((x) => ({ ...x, chancePct: Math.max(1, Math.min(100, Math.round(sigilTriggerChanceBp(x.chancePct, f) / 100))) })) };
}


/**
 * What `copies` of one always-on modifier add in total, in % (the kernel multiplies copies, Nut 2026-10-04):
 * more damage / more healing as +%, guard as % less taken. For the before-install preview (chapter 05 §5).
 */
export function sigilModifierTotalPct(m: PassiveModifier, copies: number): number {
  const n = Math.max(0, copies);
  if (m.kind === "guard_reduction") return Math.round(1000 * (1 - Math.pow(1 - m.reductionPct / 100, n))) / 10;
  return Math.round(1000 * (Math.pow(1 + m.bonusPct / 100, n) - 1)) / 10;
}
