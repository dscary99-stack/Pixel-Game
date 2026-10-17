/**
 * The attainment quest เควสบรรลุ (Nut 2026-10-05: "Lv200 มีเควสบรรลุ แล้วมีเควสลับ"; Claude's draft,
 * STATUS A150). It is what opens a character's hidden secret quests in normal play (until now only the
 * dev reveal did). Its steps are the end of the class road, all already built: Lv200, a Class3 and the
 * divine awakening (ascension.ts). With all three, the character reports in town once and the set
 * opens. Nothing is paid or granted besides the opening, so the claim only needs to be idempotent on
 * its operation id; a second report (another id) finds the set already open.
 *
 * The steps are public (anyone may read what the attainment quest asks); the secret set itself stays
 * `{ locked: true }` until opened.
 */
import { z } from "zod";
import { OperationIdSchema } from "./character";
import type { RulesConfig } from "./rules";

export type AttainmentStepId = "level" | "class3" | "ascended";

export const AttainRequestSchema = z.object({ operationId: OperationIdSchema }).strict();
export type AttainRequest = z.infer<typeof AttainRequestSchema>;

export interface AttainmentView {
  steps: { id: AttainmentStepId; th: string; done: boolean }[];
  /** Every step done and the set still closed: the report in town may be made. */
  ready: boolean;
  /** The secret set is open (by this quest, or the dev route). */
  opened: boolean;
}

export interface AttainmentCharacter {
  level: number;
  class3Id?: string | null;
  ascensionId?: string | null;
}

/** The level step uses the ascension level (P31), so the two never drift apart. */
export const attainmentLevel = (rules: RulesConfig): number => rules.provisional.ascension.value.level;

export function attainmentView(rules: RulesConfig, c: AttainmentCharacter, opened: boolean): AttainmentView {
  const lv = attainmentLevel(rules);
  const steps: AttainmentView["steps"] = [
    { id: "level", th: `ถึง Lv${lv}`, done: c.level >= lv },
    { id: "class3", th: "รับอาชีพขั้นสาม (Class3)", done: c.class3Id != null },
    { id: "ascended", th: "ผ่านบททดสอบเผ่าและจุติเทพ", done: c.ascensionId != null },
  ];
  return { steps, ready: !opened && steps.every((s) => s.done), opened };
}

/** The first step not done, as the refusal the server gives; null when all are done. */
export function attainmentMissing(rules: RulesConfig, c: AttainmentCharacter): null | "LEVEL_TOO_LOW" | "NO_CLASS3" | "NOT_ASCENDED" {
  if (c.level < attainmentLevel(rules)) return "LEVEL_TOO_LOW";
  if (c.class3Id == null) return "NO_CLASS3";
  if (c.ascensionId == null) return "NOT_ASCENDED";
  return null;
}
