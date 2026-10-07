/**
 * Party (chapter 08 "Party", P02): up to 5 players (Nut 2026-10-07). While partners are on the same map and channel
 * and have started a fight recently (Auto Hunt counts; standing still does not), each player's own
 * fights get a small bonus, locked when the fight starts. Fights stay private (O05); nobody gets
 * rewards for standing next to someone.
 *
 * - EXP +5% per eligible partner, at most +15%.
 * - Ordinary materials +2% relative per partner, at most +6% (1% becomes 1.06%, not 7%); never
 *   Sigils, capture items or gear. Combined with the Auto Hunt multiplier once.
 *
 * Party boss fights (Nut 2026-10-07): members standing at a field boss go into one fight together,
 * each with 1 companion, so 5 players fill the 10 ally places (players front, companions back).
 */
import { z } from "zod";
import type { RulesConfig } from "./rules";
import type { BattleSetup, CompanionSetup, PlayerSetup } from "./battle/types";

export interface PartyBonus {
  /** Eligible partners counted at fight start (not including the player). */
  partners: number;
  expPercent: number;
  materialDropPercent: number;
}

export const NO_PARTY_BONUS: PartyBonus = { partners: 0, expPercent: 0, materialDropPercent: 0 };

export function partyBonus(rules: RulesConfig, eligiblePartners: number): PartyBonus {
  const P = rules.provisional;
  const n = Math.max(0, Math.min(eligiblePartners, rules.confirmed.partyMaxMembers.value - 1));
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

/**
 * One member's part of a party boss fight: their character in front cell `index` (0 = whoever started
 * the fight) and one companion behind it: the first in their team order still standing, else the first.
 */
export function partyBossMember(rules: RulesConfig, index: number, player: PlayerSetup, team: BattleSetup["companions"]): { player: PlayerSetup; companions: CompanionSetup[] } {
  if (index < 0 || index >= rules.provisional.partyBoss.value.rowSlots) throw new Error(`party place ${index} out of range`);
  const each = rules.confirmed.partyBossCompanionsEach.value;
  const standing = team.filter((c) => c.hp === undefined || c.hp > 0);
  const picked = (standing.length > 0 ? standing : team).slice(0, each);
  return { player: { ...player, row: "front", slot: index }, companions: picked.map((c) => ({ ...c, row: "back", slot: index })) };
}
