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

/**
 * Auto skill use (chapter 08 rule engine steps 2–6): heal, cleanse, buff, debuff, then damage, each
 * on the best target worth it, while MP stays at or above the reserve; otherwise a basic attack.
 */
export const AutoSkillRuleSchema = z
  .object({
    use: z.boolean().default(true),
    /** Keep at least this percent of max MP; a skill that would go below it is skipped. */
    mpReservePercent: z.number().int().min(0).max(90).default(30),
    /** Heal skills wait until someone is below this percent of max HP. */
    healBelowPercent: z.number().int().min(10).max(95).default(50),
  })
  .strict();
export type AutoSkillRule = z.infer<typeof AutoSkillRuleSchema>;

export const AutoBattlePolicySchema = z
  .object({ itemRules: z.array(AutoItemRuleSchema).max(5).default([]), skills: AutoSkillRuleSchema.prefault({}) })
  .strict();
export type AutoBattlePolicy = z.infer<typeof AutoBattlePolicySchema>;
export type AutoBattlePolicyInput = z.input<typeof AutoBattlePolicySchema>;

/** No items; skills on with the default reserve. */
export const NO_AUTO_POLICY: AutoBattlePolicy = AutoBattlePolicySchema.parse({});
