/**
 * Account vault (คลังข้ามตัวละคร, Nut 2026-10-08): one store shared by every character of the same
 * login. A character puts items, gear and coins in at the town NPC, and any character of that login
 * takes them out there; looking inside works anywhere. ห้ามฝากคลัง (noStore) keeps a thing out.
 * Characters of the same login cannot trade with each other or buy each other's listings: the vault
 * is how things move between them. Companions do not go in (not decided yet).
 *
 * Numbers are P25.
 */
import { z } from "zod";
import { OperationIdSchema } from "./character";
import type { RulesConfig } from "./rules";
import type { AssetSnapshot } from "./market";

const AssetId = z.string().min(1).max(128);

/** A definition flag or the piece's own flag forbids it. */
export const storable = (def: { noStore?: boolean } | undefined, instanceNoStore = false) => def !== undefined && def.noStore !== true && !instanceNoStore;

export const VaultMoveRequestSchema = z
  .object({
    operationId: OperationIdSchema,
    items: z
      .array(z.object({ itemId: AssetId, quantity: z.number().int().min(1).max(99_999) }).strict())
      .default([])
      .refine((ls) => new Set(ls.map((l) => l.itemId)).size === ls.length, "each item once"),
    equipmentIds: z.array(AssetId).default([]).refine((ids) => new Set(ids).size === ids.length, "each piece once"),
    coins: z.number().int().min(0).max(1_000_000_000).default(0),
  })
  .strict();
export type VaultMoveRequest = z.input<typeof VaultMoveRequestSchema>;
export type VaultMove = z.infer<typeof VaultMoveRequestSchema>;

/** Shape rules shared by client and server. */
export function vaultMoveIssue(rules: RulesConfig, move: VaultMove): string | null {
  const v = rules.provisional.vault.value;
  if (move.items.length + move.equipmentIds.length > v.maxLines) return `at most ${v.maxLines} lines per request`;
  if (move.items.length + move.equipmentIds.length === 0 && move.coins === 0) return "nothing to move";
  return null;
}

export interface VaultView {
  items: { itemId: string; name: string; quantity: number }[];
  /** Pieces in the vault (snapshots carry the piece id). */
  equipment: Extract<AssetSnapshot, { kind: "equipment" }>[];
  coins: number;
  usedSlots: number;
  slots: number;
  /** False for a dev account that is not part of a login: its vault is its own. */
  shared: boolean;
}
