/**
 * Party (chapter 08 "Party", P02): up to 4 players. While partners are on the same map and channel
 * and have started a fight recently (Auto Hunt counts; standing still does not), each player's own
 * fights get a small bonus, locked when the fight starts. Fights stay private (O05); nobody gets
 * rewards for standing next to someone.
 *
 * - EXP +5% per eligible partner, at most +15%.
 * - Ordinary materials +2% relative per partner, at most +6% (1% becomes 1.06%, not 7%); never
 *   Sigils, capture items or gear. Combined with the Auto Hunt multiplier once.
 */
import { z } from "zod";
import type { RulesConfig } from "./rules";

export interface PartyBonus {
  /** Eligible partners counted at fight start (not including the player). */
  partners: number;
  expPercent: number;
  materialDropPercent: number;
}

export const NO_PARTY_BONUS: PartyBonus = { partners: 0, expPercent: 0, materialDropPercent: 0 };

export function partyBonus(rules: RulesConfig, eligiblePartners: number): PartyBonus {
  const P = rules.provisional;
  const n = Math.max(0, Math.min(eligiblePartners, P.partyMaxMembers.value - 1));
  return {
    partners: n,
    expPercent: Math.min(P.partyExpPercentCap.value, n * P.partyExpPercentPerMember.value),
    materialDropPercent: Math.min(P.partyMaterialDropPercentCap.value, n * P.partyMaterialDropPercentPerMember.value),
  };
}

export const PartyIdSchema = z.string().regex(/^pt_[a-z0-9]{10}$/);
export const JoinPartyRequestSchema = z.object({ partyId: PartyIdSchema }).strict();

export interface PartyView {
  partyId: string;
  members: { accountId: string; name: string; mapId: string | null; channel: number | null }[];
}
