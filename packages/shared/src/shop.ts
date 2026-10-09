/**
 * NPC shop and the new-character starter kit (chapter 06: vendors sell ordinary goods; chapter 07
 * §5 / ch. 04: a starter has what it needs to learn capture).
 *
 * - Prices are fixed per listing and shown before buying; the request carries the total the player
 *   saw, so a price change is refused instead of charging something else.
 * - Every listing costs more than the NPC pays back (`vendorPrice`), so buying and selling to the
 *   NPC is never a profit loop (chapter 14 §7). Boss capture items are not sold (chapter 07 §5).
 * - The starter kit is granted once per character, in the same batch that creates it.
 * Shops, prices and the kit are EXAMPLE content / P12 assumptions.
 */
import { z } from "zod";
import { OperationIdSchema } from "./character";
import { ItemId, type ItemDefinition, type SpeciesDefinition } from "./schemas";

const meta = { version: 1, status: "draft", example: true } as const;

export const ShopId = z.string().regex(/^shop:[a-z0-9_]+$/);

export const ShopDefinitionSchema = z
  .object({
    id: ShopId,
    version: z.number().int().min(1),
    status: z.enum(["draft", "validated", "published", "retired"]),
    example: z.boolean(),
    name: z.object({ th: z.string().min(1), en: z.string().min(1).optional() }).strict(),
    /** The town map the shop stands in; buying needs the player there. */
    mapId: z.string().regex(/^map:[a-z0-9_]+$/),
    listings: z.array(z.object({ itemId: ItemId, price: z.number().int().min(1) }).strict()).min(1).max(40),
  })
  .strict();
export type ShopDefinition = z.infer<typeof ShopDefinitionSchema>;

export const BuyRequestSchema = z
  .object({
    operationId: OperationIdSchema,
    shopId: ShopId,
    lines: z.array(z.object({ itemId: ItemId, quantity: z.number().int().min(1).max(99) }).strict()).min(1).max(10),
    /** The total the player was shown; a different total now is refused (COST_CHANGED). */
    expectedTotal: z.number().int().min(0),
  })
  .strict();
export type BuyRequest = z.infer<typeof BuyRequestSchema>;

export type BuyQuote =
  | { ok: true; lines: { itemId: string; quantity: number; coins: number }[]; total: number }
  | { ok: false; code: "INVALID_REQUEST" | "NOT_SOLD_HERE"; message: string };

export function buyQuote(shop: ShopDefinition, lines: BuyRequest["lines"]): BuyQuote {
  if (new Set(lines.map((l) => l.itemId)).size !== lines.length) return { ok: false, code: "INVALID_REQUEST", message: "an item is listed twice" };
  const out: { itemId: string; quantity: number; coins: number }[] = [];
  for (const l of lines) {
    const listing = shop.listings.find((x) => x.itemId === l.itemId);
    if (listing === undefined) return { ok: false, code: "NOT_SOLD_HERE", message: `${shop.name.th} does not sell ${l.itemId}` };
    out.push({ itemId: l.itemId, quantity: l.quantity, coins: listing.price * l.quantity });
  }
  return { ok: true, lines: out, total: out.reduce((n, l) => n + l.coins, 0) };
}

export interface ShopIssue {
  shopId: string;
  message: string;
}

/** Registry checks: items exist, no buy-then-sell profit, only ordinary goods, no boss capture items. */
export function validateShops(
  shops: readonly ShopDefinition[],
  items: ReadonlyMap<string, ItemDefinition>,
  species: ReadonlyMap<string, SpeciesDefinition>,
  townMapIds: readonly string[],
): ShopIssue[] {
  const issues: ShopIssue[] = [];
  for (const s of shops) {
    const parsed = ShopDefinitionSchema.safeParse(s);
    if (!parsed.success) issues.push({ shopId: s.id, message: parsed.error.issues.map((i) => i.message).join("; ") });
    if (!townMapIds.includes(s.mapId)) issues.push({ shopId: s.id, message: `${s.mapId} is not a town` });
    const seen = new Set<string>();
    for (const l of s.listings) {
      if (seen.has(l.itemId)) issues.push({ shopId: s.id, message: `${l.itemId} is listed twice` });
      seen.add(l.itemId);
      const it = items.get(l.itemId);
      if (it === undefined) {
        issues.push({ shopId: s.id, message: `unknown item ${l.itemId}` });
        continue;
      }
      if (l.price <= it.vendorPrice) issues.push({ shopId: s.id, message: `${l.itemId} sells for ${l.price} but the NPC buys it back for ${it.vendorPrice}` });
      if (it.kind === "sigil" || it.kind === "material") issues.push({ shopId: s.id, message: `${l.itemId}: shops do not sell ${it.kind}s` });
      if (it.kind === "capture" && species.get(it.captureSpeciesId ?? "")?.rank === "BOSS") issues.push({ shopId: s.id, message: `${l.itemId}: boss capture items are not sold` });
    }
  }
  return issues;
}

export const EXAMPLE_SHOPS: ShopDefinition[] = [
  {
    id: "shop:dawn_general",
    ...meta,
    name: { th: "ร้านของใช้หมู่บ้านรุ่งอรุณ" },
    mapId: "map:dawn_town",
    // P12 assumptions: potions at 3× what the NPC pays back; capture items 20 + 10 × wild level.
    listings: [
      { itemId: "item:small_potion", price: 30 },
      { itemId: "item:phoenix_feather", price: 600 },
      { itemId: "item:mana_potion", price: 45 },
      { itemId: "item:cleansing_herb", price: 45 },
      { itemId: "item:power_tonic", price: 75 },
      { itemId: "item:supply_mole_capture", price: 40 },
      { itemId: "item:bell_bird_capture", price: 50 },
      { itemId: "item:lantern_snail_capture", price: 70 },
      { itemId: "item:armor_crab_capture", price: 80 },
      { itemId: "item:ember_fox_capture", price: 100 },
    ],
  },
];

export const exampleShopRegistry = (): Map<string, ShopDefinition> => new Map(EXAMPLE_SHOPS.map((s) => [s.id, s]));

/**
 * What every new character starts with (EXAMPLE/P12): a few potions, capture items for the two
 * starter species by the field gate (chapter 04: a starter can learn capture), a little coin, and a
 * weapon and shirt in the bag.
 */
export const STARTER_KIT = {
  items: { "item:small_potion": 5, "item:supply_mole_capture": 3, "item:bell_bird_capture": 3 } as Readonly<Record<string, number>>,
  coins: 100,
  equipment: ["equip:wooden_sword", "equip:cloth_tunic"] as readonly string[],
} as const;
