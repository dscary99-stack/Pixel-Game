/**
 * Auto Battle item rules (chapter 08 "allowed items / max spend", rule engine step 1).
 * The player picks which items Auto may use, on whom, below which HP, and how many per fight.
 * Rules run in the listed order before the basic attack; a rule that cannot apply is skipped.
 * They never capture (C15) and never touch anything outside the reserved combat bag.
 */
import { z } from "zod";

export const AutoItemRuleSchema = z
  .object({
    itemId: z.string().regex(/^item:[a-z0-9_]+$/),
    /** "self": only the character; "ally": the living ally (character or companion) with the lowest HP%. */
    target: z.enum(["self", "ally"]).default("ally"),
    /** Use when the target's HP is below this percent of max. */
    hpBelowPercent: z.number().int().min(1).max(95).default(40),
    /** At most this many of this item in one fight. */
    maxPerFight: z.number().int().min(1).max(20).default(3),
  })
  .strict();
export type AutoItemRule = z.infer<typeof AutoItemRuleSchema>;

export const AutoBattlePolicySchema = z
  .object({ itemRules: z.array(AutoItemRuleSchema).max(5).default([]) })
  .strict();
export type AutoBattlePolicy = z.infer<typeof AutoBattlePolicySchema>;

export const NO_AUTO_POLICY: AutoBattlePolicy = { itemRules: [] };
