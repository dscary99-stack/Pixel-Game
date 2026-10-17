/**
 * Letting go of gear and companions (chapter 09 "Sources / Sinks", chapter 10 "review before confirm").
 *
 * - Gear: sell to the town NPC for a fixed price by item level and rarity, or salvage it into the
 *   material its affix pool rerolls with. Never a worn piece, a piece in a fight, a piece carrying
 *   Sigils (take them out first; what Sigil salvage gives is OPEN), or a protected piece.
 * - Companions: release is voluntary and gives nothing back (research / adoption rewards are a
 *   proposal, not built). Never one in the team, in a fight or protected.
 * - Protect: a flag the player sets on a piece or a companion so no sell, salvage or release (and no
 *   future auto-sell) can touch it.
 * - Nickname: free, cosmetic, any number of companions may share one (no unique-name rule).
 * Prices and yields are P12 assumptions (rules.provisional.gearDisposal).
 */
import { z } from "zod";
import { OperationIdSchema } from "./character";
import type { RulesConfig } from "./rules";
import type { AffixPool, EquipmentDefinition, ItemDefinition, Rarity } from "./schemas";
import type { Recipe } from "./craft";

const EquipmentInstanceId = z.string().min(1).max(128);

export const GearDisposeRequestSchema = z
  .object({
    operationId: OperationIdSchema,
    mode: z.enum(["sell", "salvage"]),
    equipmentIds: z
      .array(EquipmentInstanceId)
      .min(1)
      .max(20)
      .refine((ids) => new Set(ids).size === ids.length, "each piece once"),
    /** What the player was shown; the server refuses if it no longer matches. */
    expected: z
      .object({
        coins: z.number().int().min(0),
        items: z.array(z.object({ itemId: z.string(), quantity: z.number().int().min(1) }).strict()),
      })
      .strict(),
  })
  .strict();
export type GearDisposeRequest = z.infer<typeof GearDisposeRequestSchema>;

export const ReleaseRequestSchema = z.object({ operationId: OperationIdSchema, companionId: z.string().min(1).max(128) }).strict();
export type ReleaseRequest = z.infer<typeof ReleaseRequestSchema>;

export const ProtectRequestSchema = z
  .object({ kind: z.enum(["equipment", "companion"]), id: z.string().min(1).max(128), protected: z.boolean() })
  .strict();
export type ProtectRequest = z.infer<typeof ProtectRequestSchema>;

export const NICKNAME_MAX = 16;
/** Letters, marks, digits, spaces and a few joiners; no control or markup characters. */
const NICKNAME_RE = /^[\p{L}\p{M}\p{N} _.'-]+$/u;

export const NicknameRequestSchema = z
  .object({
    companionId: z.string().min(1).max(128),
    nickname: z
      .string()
      .transform((s) => s.normalize("NFC").replace(/\s+/g, " ").trim())
      .pipe(z.string().min(1).max(NICKNAME_MAX).regex(NICKNAME_RE, "letters, digits, spaces and _ . ' - only"))
      .nullable(),
  })
  .strict();
export type NicknameRequest = z.infer<typeof NicknameRequestSchema>;

/** Coins the town NPC pays for one piece. */
export function gearSellPrice(rules: RulesConfig, def: EquipmentDefinition, rarity: Rarity): number {
  const c = rules.provisional.gearDisposal.value;
  return Math.floor((c.sellBase + c.sellPerLevel * def.requiredLevel) * c.sellRarityPct[rarity] / 100);
}

/** Material salvage gives for one piece: its affix pool's reroll material. */
export function salvageYield(rules: RulesConfig, def: EquipmentDefinition, pool: AffixPool, rarity: Rarity): { itemId: string; quantity: number } {
  const c = rules.provisional.gearDisposal.value;
  return { itemId: pool.rerollItemId, quantity: c.salvageBase[rarity] + Math.floor(def.requiredLevel / 10) * c.salvagePerTenLevels };
}

export interface DisposeQuote {
  coins: number;
  items: { itemId: string; quantity: number }[];
}

/** Total for a set of pieces, items merged and sorted (the same shape the request echoes back). */
export function disposeQuote(
  rules: RulesConfig,
  mode: "sell" | "salvage",
  pieces: readonly { def: EquipmentDefinition; pool: AffixPool; rarity: Rarity }[],
): DisposeQuote {
  if (mode === "sell") return { coins: pieces.reduce((n, p) => n + gearSellPrice(rules, p.def, p.rarity), 0), items: [] };
  const by = new Map<string, number>();
  for (const p of pieces) {
    const y = salvageYield(rules, p.def, p.pool, p.rarity);
    by.set(y.itemId, (by.get(y.itemId) ?? 0) + y.quantity);
  }
  return { coins: 0, items: [...by].sort(([a], [b]) => (a < b ? -1 : 1)).map(([itemId, quantity]) => ({ itemId, quantity })) };
}

/**
 * Content check: crafting a piece and then selling or salvaging it (even at the best rarity) must
 * never pay more than the recipe took at NPC prices, or crafting becomes a coin printer.
 */
export function validateDisposalLoops(
  rules: RulesConfig,
  recipes: readonly Recipe[],
  equipment: ReadonlyMap<string, EquipmentDefinition>,
  pools: ReadonlyMap<string, AffixPool>,
  items: ReadonlyMap<string, ItemDefinition>,
): string[] {
  const out: string[] = [];
  const best: Rarity = "EPIC";
  for (const r of recipes) {
    if (r.output.kind !== "equipment") continue;
    const def = equipment.get(r.output.definitionId);
    const pool = def === undefined ? undefined : pools.get(def.affixPoolId);
    if (def === undefined || pool === undefined) continue;
    const cost = r.coins + r.inputs.reduce((n, i) => n + (items.get(i.itemId)?.vendorPrice ?? 0) * i.quantity, 0);
    const sell = gearSellPrice(rules, def, best);
    const y = salvageYield(rules, def, pool, best);
    const salvage = (items.get(y.itemId)?.vendorPrice ?? 0) * y.quantity;
    if (Math.max(sell, salvage) >= cost) out.push(`${r.id}: costs ${cost} but an EPIC result sells for ${sell} / salvages for ${salvage}`);
  }
  return out;
}
