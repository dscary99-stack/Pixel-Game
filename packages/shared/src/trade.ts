/**
 * Companion transfer level gap (O01, Nut 2026-10-07): whoever receives a companion from someone else
 * (trade, market, gift, any channel) may be at most 30 levels below it. Both the companion's current
 * level and its species' wild level are checked, so a companion that was reset to Lv1 by Rebirth still
 * cannot carry a high-level species to a new player. Taking a companion you already own into battle has
 * no level limit (rules.confirmed.companionBattleLevelCap = false).
 *
 * No transfer channel is built yet (O10); this is the check every one of them must call before it moves
 * the companion, on the server, at the moment of the transfer.
 */
import type { RulesConfig } from "./rules";
import type { SpeciesDefinition } from "./schemas";

export type TransferLevelCheck =
  | { ok: true }
  | { ok: false; code: "LEVEL_INELIGIBLE"; message: string; /** The recipient level needed. */ minRecipientLevel: number };

export function transferLevelCheck(
  rules: RulesConfig,
  recipientLevel: number,
  companion: { currentLevel: number },
  species: Pick<SpeciesDefinition, "fixedWildLevel">,
): TransferLevelCheck {
  const gap = rules.confirmed.tradeLevelGap.value;
  const top = Math.max(companion.currentLevel, species.fixedWildLevel);
  if (top <= recipientLevel + gap) return { ok: true };
  return { ok: false, code: "LEVEL_INELIGIBLE", message: `Lv${top} > recipient Lv${recipientLevel} + ${gap}`, minRecipientLevel: top - gap };
}
