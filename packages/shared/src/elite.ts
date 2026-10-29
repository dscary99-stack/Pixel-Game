/**
 * Elite packs (chapter 07 §3 "Elite proposal"): the leader of an ELITE spawn is tougher and carries
 * one modifier early on and two at higher levels, picked from allowed pairs. Players see the rank and
 * the modifiers before engaging. A captured elite is its species/element at Lv1 without any of this.
 *
 * Modifiers (what each does in the kernel):
 * - crystal_shield: starts the fight behind a shield (% of its max HP).
 * - backline_hunter: its attacks and skills reach the back row, and it goes for the back row first.
 * - morale: the rest of the pack fights with ATK/MATK up while it stands; when it falls the buff ends.
 * - magic_counter: hit by magic, it warns and answers on its next action with a heavy magic strike on
 *   that attacker (guard or a control status on it is the answer).
 * - low_hp_enrage: once under the HP line it gets ATK and SPD up for a few turns.
 * Numbers live in rules.provisional.elite (P12); the pairs are EXAMPLE content.
 */
import { z } from "zod";
import type { Rng } from "./rng";
import type { RulesConfig } from "./rules";

export const ELITE_MODIFIERS = ["crystal_shield", "backline_hunter", "morale", "magic_counter", "low_hp_enrage"] as const;
export const EliteModifierSchema = z.enum(ELITE_MODIFIERS);
export type EliteModifier = z.infer<typeof EliteModifierSchema>;

export const ELITE_MODIFIER_TH: Record<EliteModifier, { name: string; hint: string }> = {
  crystal_shield: { name: "โล่ผลึก", hint: "เริ่มไฟต์มีโล่ ต้องทุบโล่ก่อน" },
  backline_hunter: { name: "นักล่าแนวหลัง", hint: "ตีถึงแถวหลังและเล็งแถวหลังก่อน" },
  morale: { name: "ขวัญกำลังใจ", hint: "ลูกฝูงพลังโจมตีเพิ่มจนกว่าจ่าฝูงจะล้ม" },
  magic_counter: { name: "สวนเวท", hint: "โดนเวทแล้วเตือน จากนั้นสวนเวทแรงใส่คนร่าย" },
  low_hp_enrage: { name: "คลั่งใกล้ตาย", hint: "HP ต่ำแล้วโจมตีและความเร็วเพิ่ม" },
};

/** EXAMPLE: which two modifiers may come together (no pair that only stacks raw damage). */
export const ELITE_ALLOWED_PAIRS: readonly (readonly [EliteModifier, EliteModifier])[] = [
  ["crystal_shield", "backline_hunter"],
  ["crystal_shield", "magic_counter"],
  ["morale", "low_hp_enrage"],
  ["morale", "backline_hunter"],
  ["backline_hunter", "low_hp_enrage"],
  ["magic_counter", "low_hp_enrage"],
];

/** How many modifiers an elite of this wild level carries. */
export const eliteModifierCount = (rules: RulesConfig, wildLevel: number) => (wildLevel >= rules.provisional.elite.value.twoModifiersFromLevel ? 2 : 1);

/** Server roll: one modifier, or one allowed pair. Sorted so the same roll always reads the same. */
export function rollEliteModifiers(rules: RulesConfig, wildLevel: number, rng: Rng): EliteModifier[] {
  if (eliteModifierCount(rules, wildLevel) === 1) return [ELITE_MODIFIERS[rng.nextInt(ELITE_MODIFIERS.length)]!];
  const pair = ELITE_ALLOWED_PAIRS[rng.nextInt(ELITE_ALLOWED_PAIRS.length)]!;
  return [...pair].sort((a, b) => ELITE_MODIFIERS.indexOf(a) - ELITE_MODIFIERS.indexOf(b));
}

/** Content check for a set of modifiers on one elite. */
export function eliteModifierIssues(mods: readonly EliteModifier[]): string[] {
  if (mods.length === 0 || mods.length > 2) return [`an elite has 1 or 2 modifiers, not ${mods.length}`];
  if (mods.length === 2) {
    const ok = ELITE_ALLOWED_PAIRS.some(([a, b]) => (a === mods[0] && b === mods[1]) || (a === mods[1] && b === mods[0]));
    if (!ok) return [`${mods.join(" + ")} is not an allowed pair`];
  }
  return [];
}
