/**
 * Mailbox (กล่องจดหมาย, Nut 2026-10-09 picked it from the list of systems to build): the server puts
 * messages and things into a character's mailbox, and the player takes them out with one claim.
 * Each character has its own (like the companion box). Mail never comes from other players yet: the
 * senders are the game itself (system / GM mail), a secret-quest companion that finds the box full,
 * and the market's "your listing sold" notice.
 *
 * - A claim moves everything in the chosen letters at once, anywhere except during a fight. It is
 *   idempotent by operation id; a letter is claimed once, whoever asks.
 * - Companions in a letter need room in the companion box (P26) when claimed; until then the letter
 *   waits and the companion does not count in the box.
 * - Letters are kept `keepDays` (P27); an unclaimed letter is lost after that, like unclaimed weekly
 *   rewards (Nut 2026-10-07).
 */
import { z } from "zod";
import { OperationIdSchema } from "./character";
import type { Element, PrimaryStats } from "./schemas";
import type { RulesConfig } from "./rules";

export const MailIdSchema = z.string().regex(/^mail:[A-Za-z0-9:_.-]{1,160}$/);

export type MailSource = "system" | "secret_reward" | "market_sale";

/** A piece made when the letter is claimed (it does not exist before). */
export interface MailPiece {
  id: string;
  definitionId: string;
  rarity: "COMMON" | "GOOD" | "RARE" | "EPIC";
  affixes: unknown[];
  noSell?: boolean;
  noTrade?: boolean;
  noStore?: boolean;
}

/** A companion made when the letter is claimed (it does not exist before, so it is not in the box). */
export interface MailCompanion {
  id: string;
  speciesId: string;
  level: number;
  element: Element;
  primaryStats: PrimaryStats;
  origin: Record<string, unknown>;
  growthSeed: string;
  growthVersion: number;
  noSell?: boolean;
  noTrade?: boolean;
}

export interface MailPayload {
  items: Record<string, number>;
  coins: number;
  equipment: MailPiece[];
  companions: MailCompanion[];
}

export const EMPTY_MAIL: MailPayload = { items: {}, coins: 0, equipment: [], companions: [] };

export const hasAttachments = (p: MailPayload) => Object.values(p.items).some((n) => n > 0) || p.coins > 0 || p.equipment.length > 0 || p.companions.length > 0;

export const MailClaimRequestSchema = z
  .object({
    operationId: OperationIdSchema,
    mailIds: z.array(MailIdSchema).min(1).max(20).refine((ids) => new Set(ids).size === ids.length, "each letter once"),
  })
  .strict();
export type MailClaimRequest = z.input<typeof MailClaimRequestSchema>;

export interface MailLetter {
  mailId: string;
  source: MailSource;
  title: string;
  body: string;
  createdAt: string;
  expiresAt: string;
  claimedAt: string | null;
  items: { itemId: string; name: string; quantity: number }[];
  coins: number;
  equipment: { definitionId: string; name: string; rarity: string }[];
  companions: { speciesId: string; name: string; level: number }[];
}

export interface MailView {
  letters: MailLetter[];
  /** Letters with something still to claim. */
  unclaimed: number;
  keepDays: number;
}

/** When a letter sent at `at` is lost if unclaimed. */
export function mailExpiry(rules: RulesConfig, at: string): string {
  return new Date(Date.parse(at) + rules.provisional.mail.value.keepDays * 86_400_000).toISOString();
}
