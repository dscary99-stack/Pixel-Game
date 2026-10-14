/**
 * Bond beyond won fights (chapter 04 §6, P35): first visit to a map, first win against a boss, and
 * favourite gifts. One-time sources are kept per companion and owner, so walking in and out of a map
 * never repeats them; a new owner starts over (Bond resets on transfer, C11). Gifts need adventure
 * between them (won fights), never a timer, and are capped.
 */
import { z } from "zod";
import type { RulesConfig } from "./rules";
import { ItemId, type MonsterInstance, type SpeciesDefinition } from "./schemas";
import { OperationIdSchema } from "./character";

import { BOND_MAX } from "./bond";

export const CompanionGiftRequestSchema = z
  .object({ operationId: OperationIdSchema, companionId: z.string().min(1).max(160), itemId: ItemId })
  .strict();
export type CompanionGiftRequest = z.infer<typeof CompanionGiftRequestSchema>;

export type GiftRefusal = "NOT_FAVORITE" | "NEEDS_ADVENTURE" | "GIFT_CAP" | "BOND_FULL";

/** Whether a gift can be given now, and how much Bond it adds (never past the cap or 1000). */
export function favoriteGift(
  rules: RulesConfig,
  species: Pick<SpeciesDefinition, "favoriteItemId">,
  companion: Pick<MonsterInstance, "bond" | "giftBond" | "winsSinceGift">,
  itemId: string,
): { ok: true; gain: number } | { ok: false; code: GiftRefusal; message: string } {
  const b = rules.provisional.bondSources.value;
  if (species.favoriteItemId === undefined || species.favoriteItemId !== itemId) return { ok: false, code: "NOT_FAVORITE", message: "this companion does not care for that" };
  if (companion.bond >= BOND_MAX) return { ok: false, code: "BOND_FULL", message: "Bond is already full" };
  const given = companion.giftBond ?? 0;
  if (given >= b.favoriteGiftCap) return { ok: false, code: "GIFT_CAP", message: "gifts cannot raise Bond any further; fight together instead" };
  const wins = companion.winsSinceGift ?? 0;
  if (wins < b.favoriteWinsBetween) return { ok: false, code: "NEEDS_ADVENTURE", message: `win ${b.favoriteWinsBetween - wins} more fights together first` };
  return { ok: true, gain: Math.min(b.favoriteGift, b.favoriteGiftCap - given, BOND_MAX - companion.bond) };
}
