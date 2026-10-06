/**
 * Refining / ตีบวก (Nut's REFINEMENT_DESIGN v2.1, 2026-10-07; rules under P07 and O16).
 *
 * - One attempt raises a piece from +n to target +n+1 (cap rules.provisional.refineMaxLevel).
 * - The server rolls 0..9999; the attempt succeeds when the roll is below the target's basis points.
 *   No pity and no chance that grows with failures (CONFIRMED).
 * - A failure below target +6 keeps the level. A failure at target +6 or higher destroys the piece
 *   (CONFIRMED) unless a ward was used: then the piece keeps its level, affixes and Sigils.
 * - A ward fits one target (+6..+10) and one tier of upgrade cost level. It is used up on success and
 *   on failure, never changes the chance, and is never picked for the player. A missing or wrong ward
 *   refuses the whole attempt with nothing spent; it never falls back to a risky attempt.
 * - Coins: round10 half up (base at Lv200 × max(3%, (upgradeCostLevel / 200)^1.5)), in integers.
 * - Stones by tier: basic 1–49, fused 50–99, dense 100–149, star 150–200.
 * - Power: +3% of each refinable base stat per level, not compounded (`refinedBaseStats`,
 *   equipment.ts). Sigils, affixes and unique effects never grow.
 * - What happens to Sigils on a destroyed piece is OPEN (O16): risky attempts on a piece with Sigils
 *   are refused (UNRESOLVED_RULE) until it is decided.
 */
import { z } from "zod";
import { OperationIdSchema } from "./character";
import type { RulesConfig } from "./rules";
import { ItemId, type EquipmentDefinition, type EquipSlot } from "./schemas";

export type RefineTier = 1 | 2 | 3 | 4;

/** Display names of the stone tiers (v2.1 §6, names are placeholders). */
export const REFINE_TIER_NAME_TH: Record<RefineTier, string> = { 1: "พื้นฐาน", 2: "หลอม", 3: "หนาแน่น", 4: "ดารา" };

/** The stone and ward tier for an upgrade cost level. */
export function refineTier(rules: RulesConfig, costLevel: number): RefineTier {
  const tiers = rules.provisional.refineStoneTiers.value;
  const i = tiers.findIndex(([lo, hi]) => costLevel >= lo && costLevel <= hi);
  return (i < 0 ? tiers.length : i + 1) as RefineTier;
}

export const refineStoneItemId = (tier: RefineTier) => `item:refine_stone_t${tier}`;
export const refineWardItemId = (tier: RefineTier, target: number) => `item:refine_ward_t${tier}_p${target}`;

/** The tier and target a ward item is for, or null for any other item. */
export function parseRefineWard(itemId: string): { tier: RefineTier; target: number } | null {
  const m = /^item:refine_ward_t([1-4])_p([0-9]+)$/.exec(itemId);
  return m === null ? null : { tier: Number(m[1]) as RefineTier, target: Number(m[2]) };
}

/**
 * round10 half up (base × max(floor%, (level / 200)^1.5)), exact: compares squares in BigInt so no
 * platform rounds a half differently.
 */
export function refineLevelScaled(rules: RulesConfig, base: number, level: number): number {
  const { exponent, floorPct } = rules.provisional.refineLevelFactor.value;
  if (exponent !== 1.5) throw new Error("refineLevelScaled supports exponent 1.5 only");
  const top = BigInt(rules.confirmed.playerMaxLevel.value);
  const L = BigInt(level);
  const b = BigInt(base);
  // Below the floor: (L/top)^1.5 < floor/100  ⇔  L³·100² < floor²·top³.
  if (L ** 3n * 10_000n < BigInt(floorPct) ** 2n * top ** 3n) return Number(((b * BigInt(floorPct) + 500n) / 1000n) * 10n);
  // v = base·√(L³/top³); want the largest k with 10k − 5 ≤ v  ⇔  (10k − 5)²·top³ ≤ base²·L³.
  const fits = (k: bigint) => k <= 0n || (10n * k - 5n) ** 2n * top ** 3n <= b ** 2n * L ** 3n;
  let k = BigInt(Math.floor((base * Math.pow(level / Number(top), 1.5)) / 10 + 0.5));
  while (fits(k + 1n)) k++;
  while (k > 0n && !fits(k)) k--;
  return Number(k * 10n);
}

/** Coins for one attempt at `target` on a piece of this cost level. */
export function refineFee(rules: RulesConfig, target: number, costLevel: number): number {
  return refineLevelScaled(rules, rules.provisional.refineFeeLv200.value[target - 1]!, costLevel);
}

/** Success chance of one attempt at `target`, in basis points (0..10000). */
export function refineSuccessBp(rules: RulesConfig, target: number): number {
  const from = rules.confirmed.refineBreakFromTarget.value;
  return target < from ? rules.provisional.refineSafeSuccessBp.value[target - 1]! : rules.confirmed.refineRiskySuccessBp.value[target - from]!;
}

/** Whether a failure at `target` can destroy the piece (no ward). */
export const refineIsRisky = (rules: RulesConfig, target: number) => target >= rules.confirmed.refineBreakFromTarget.value;

/** Top level of a tier, used to price that tier's wards. */
export const refineTierTopLevel = (rules: RulesConfig, tier: RefineTier) => rules.provisional.refineStoneTiers.value[tier - 1]![1];

/** What crafting one ward for `target` in `tier` costs in coins (materials are in the recipe). */
export function refineWardCraftCoins(rules: RulesConfig, target: number, tier: RefineTier): number {
  const row = rules.provisional.refineWardCraft.value.find((r) => r.target === target);
  if (row === undefined) throw new Error(`no ward for +${target}`);
  return refineLevelScaled(rules, row.coinsLv200, refineTierTopLevel(rules, tier));
}

export interface RefineQuote {
  from: number;
  target: number;
  successBp: number;
  coins: number;
  stoneItemId: string;
  stones: number;
  /** A failure destroys the piece unless a ward is used. */
  risky: boolean;
  /** The only ward this attempt accepts (risky targets), else null. */
  wardItemId: string | null;
}

export type RefineQuoteResult = { ok: true; quote: RefineQuote } | { ok: false; reason: "NOT_REFINABLE" | "MAX_LEVEL"; message: string };

/** Everything one attempt from `level` costs and risks, shown to the player before they confirm. */
export function refineQuote(rules: RulesConfig, def: EquipmentDefinition, level: number): RefineQuoteResult {
  if (def.upgradeCostLevel === undefined || (def.refinableStats ?? []).length === 0) return { ok: false, reason: "NOT_REFINABLE", message: "this piece cannot be refined" };
  if (level >= rules.provisional.refineMaxLevel.value) return { ok: false, reason: "MAX_LEVEL", message: `already +${level}` };
  const target = level + 1;
  const tier = refineTier(rules, def.upgradeCostLevel);
  const risky = refineIsRisky(rules, target);
  return {
    ok: true,
    quote: {
      from: level,
      target,
      successBp: refineSuccessBp(rules, target),
      coins: refineFee(rules, target, def.upgradeCostLevel),
      stoneItemId: refineStoneItemId(tier),
      stones: rules.provisional.refineStones.value[target - 1]!,
      risky,
      wardItemId: risky ? refineWardItemId(tier, target) : null,
    },
  };
}

/** The attempt succeeds when the server's roll (0..9999) is below the chance. */
export const refineSucceeds = (roll: number, successBp: number) => roll < successBp;

export const RefineRequestSchema = z
  .object({
    operationId: OperationIdSchema,
    equipmentId: z.string().min(1).max(120),
    /** The level and version the player saw; anything else is refused (two racing attempts: one lands). */
    expectedLevel: z.number().int().min(0).max(20),
    expectedVersion: z.number().int().min(1),
    /** The ward the player picked, or null. Never chosen for them. */
    wardItemId: ItemId.nullable(),
    /** The cost the player was shown. */
    expectedCost: z.object({ coins: z.number().int().min(0), stoneItemId: ItemId, stones: z.number().int().min(0) }).strict(),
  })
  .strict();
export type RefineRequest = z.infer<typeof RefineRequestSchema>;

export interface RefineResult {
  equipmentId: string;
  definitionId: string;
  from: number;
  target: number;
  /** success: now +target. kept: failed, level unchanged. destroyed: failed with no ward at +6 or more. */
  outcome: "success" | "kept" | "destroyed";
  /** The server's roll (0..9999) and the chance it was checked against. */
  roll: number;
  successBp: number;
  paid: { coins: number; stoneItemId: string; stones: number; wardItemId: string | null };
  /** The piece's level and version afterwards (null when destroyed). */
  level: number | null;
  version: number | null;
  /** Destroyed only: the slot it was taken off, and its Sigils (lost or back in the bag, per O16). */
  unequipped: EquipSlot | null;
  sigilsLost: string[];
  sigilsReturned: string[];
}
