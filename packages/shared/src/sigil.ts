/**
 * Installing and removing Monster Sigils (chapter 05 §4–§5, C22–C25, P08) and selling to NPCs
 * (chapter 06: NPC sale is the coin source). Pure rules; the server applies them in D1.
 *
 * - A Sigil item from the bag goes into a free socket of a compatible piece. Duplicate names are
 *   allowed (C24). Socket count = min(item's maxSigilSlots, 4 for weapons / 1 for everything else).
 * - Removal always succeeds and returns the Sigil to the bag (P08), costs coins by the item's level
 *   tier, happens in town outside fights, and the cost is shown before confirming.
 * - Sigil effects are not built yet (no effect engine); an installed Sigil changes no numbers.
 */
import { z } from "zod";
import type { RulesConfig } from "./rules";
import { ItemId, type EquipmentDefinition, type ItemDefinition, type SigilDefinition } from "./schemas";
import { sigilGroupsOf } from "./validators";
import { OperationIdSchema } from "./character";

export const InstallSigilRequestSchema = z
  .object({ operationId: OperationIdSchema, equipmentId: z.string().min(1).max(120), sigilItemId: ItemId })
  .strict();
export type InstallSigilRequest = z.infer<typeof InstallSigilRequestSchema>;

export const RemoveSigilRequestSchema = z
  .object({
    operationId: OperationIdSchema,
    equipmentId: z.string().min(1).max(120),
    socket: z.number().int().min(0).max(3),
    /** The cost the player was shown; a different current cost is refused instead of charged. */
    expectedCost: z.number().int().min(0),
  })
  .strict();
export type RemoveSigilRequest = z.infer<typeof RemoveSigilRequestSchema>;

export const SellRequestSchema = z
  .object({
    operationId: OperationIdSchema,
    lines: z
      .array(z.object({ itemId: ItemId, quantity: z.number().int().min(1).max(9999) }).strict())
      .min(1)
      .max(20),
  })
  .strict();
export type SellRequest = z.infer<typeof SellRequestSchema>;

/** How many Sigils this piece can hold. */
export function sigilCapacity(rules: RulesConfig, def: EquipmentDefinition): number {
  const cap = def.category === "WEAPON" ? rules.confirmed.maxSigilsPerWeapon.value : rules.confirmed.maxSigilsPerNonWeapon.value;
  return Math.min(def.maxSigilSlots, cap);
}

export function sigilFits(def: EquipmentDefinition, sigil: SigilDefinition): boolean {
  const groups = new Set(sigilGroupsOf(def));
  return sigil.equipGroups.some((g) => groups.has(g));
}

export type SigilInstallPlan =
  | { ok: true; sigilId: string; sockets: string[] }
  | { ok: false; code: "NOT_A_SIGIL" | "SIGIL_INCOMPATIBLE" | "SIGIL_SLOTS_FULL"; message: string };

/** The sockets after adding this Sigil item to a piece that holds `sockets` now. */
export function planSigilInstall(
  rules: RulesConfig,
  def: EquipmentDefinition,
  sockets: readonly string[],
  item: ItemDefinition | undefined,
  sigils: ReadonlyMap<string, SigilDefinition>,
): SigilInstallPlan {
  const sigil = item?.kind === "sigil" && item.sigilId !== undefined ? sigils.get(item.sigilId) : undefined;
  if (sigil === undefined) return { ok: false, code: "NOT_A_SIGIL", message: "that item is not a Sigil" };
  if (!sigilFits(def, sigil)) return { ok: false, code: "SIGIL_INCOMPATIBLE", message: `${sigil.name.th} does not fit ${def.name.th}` };
  if (sockets.length >= sigilCapacity(rules, def)) return { ok: false, code: "SIGIL_SLOTS_FULL", message: "no free Sigil socket" };
  return { ok: true, sigilId: sigil.id, sockets: [...sockets, sigil.id] };
}

/** Coins to remove one Sigil from this piece: the highest tier at or below its required level. */
export function sigilRemovalCost(rules: RulesConfig, def: EquipmentDefinition): number {
  let cost = 0;
  for (const [from, coins] of rules.provisional.sigilRemovalCostTiers.value) if (def.requiredLevel >= from) cost = coins;
  return cost;
}

/** The item a Sigil goes back to the bag as. */
export function sigilItemFor(sigilId: string, items: ReadonlyMap<string, ItemDefinition>): ItemDefinition | undefined {
  for (const it of items.values()) if (it.kind === "sigil" && it.sigilId === sigilId) return it;
  return undefined;
}

export type SellQuote =
  | { ok: true; lines: { itemId: string; quantity: number; coins: number }[]; total: number }
  | { ok: false; code: "NOT_SELLABLE" | "INVALID_REQUEST"; message: string };

/** What an NPC pays. Items with vendorPrice 0 (capture items, Sigils) are not bought. */
export function sellQuote(lines: SellRequest["lines"], items: ReadonlyMap<string, ItemDefinition>): SellQuote {
  if (new Set(lines.map((l) => l.itemId)).size !== lines.length) return { ok: false, code: "INVALID_REQUEST", message: "an item is listed twice" };
  const out: { itemId: string; quantity: number; coins: number }[] = [];
  for (const l of lines) {
    const def = items.get(l.itemId);
    if (def === undefined || def.vendorPrice <= 0) return { ok: false, code: "NOT_SELLABLE", message: `the shop does not buy ${def?.name.th ?? l.itemId}` };
    out.push({ itemId: l.itemId, quantity: l.quantity, coins: def.vendorPrice * l.quantity });
  }
  return { ok: true, lines: out, total: out.reduce((n, l) => n + l.coins, 0) };
}
