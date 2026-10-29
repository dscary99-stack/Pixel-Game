/**
 * NPC Orders (chapter 09 "NPC Orders").
 *
 * - Each town has a short list of orders with the reward announced up front.
 * - Orders are finite: each can be filled a set number of times per character per week (the quest
 *   week, P13), so the NPC never buys everything at a premium without limit.
 * - Filling one takes the materials for real (a sink); rewards are fixed coins and items, never pegged
 *   to a player market price that could be pushed around.
 * - An order running out never blocks selling to the base NPC, trading or crafting.
 * Orders and numbers here are EXAMPLE / P12.
 */
import { z } from "zod";
import { OperationIdSchema } from "./character";
import { ItemId, type ItemDefinition } from "./schemas";

const meta = { version: 1, status: "draft", example: true } as const;

export const NpcOrderId = z.string().regex(/^order:[a-z0-9_]+$/);

export const NpcOrderSchema = z
  .object({
    id: NpcOrderId,
    version: z.number().int().min(1),
    status: z.enum(["draft", "validated", "published", "retired"]),
    example: z.boolean(),
    /** Who asks, and the town they stand in. */
    npc: z.object({ th: z.string().min(1) }).strict(),
    mapId: z.string().regex(/^map:[a-z0-9_]+$/),
    note: z.object({ th: z.string().min(1) }).strict(),
    wants: z.array(z.object({ itemId: ItemId, quantity: z.number().int().min(1).max(99) }).strict()).min(1).max(4),
    reward: z
      .object({
        coins: z.number().int().min(0),
        items: z.array(z.object({ itemId: ItemId, quantity: z.number().int().min(1).max(99) }).strict()).max(3),
      })
      .strict(),
    /** Fills per character per quest week. */
    weeklyLimit: z.number().int().min(1).max(20),
  })
  .strict();
export type NpcOrder = z.infer<typeof NpcOrderSchema>;

export const FillOrderRequestSchema = z.object({ operationId: OperationIdSchema, orderId: NpcOrderId }).strict();
export type FillOrderRequest = z.infer<typeof FillOrderRequestSchema>;

/** Most an order may pay over the base NPC price of what it takes (×). */
export const ORDER_MAX_PREMIUM = 3;

export interface OrderIssue {
  orderId: string;
  message: string;
}

/**
 * Content check: items exist and are materials (no Sigils, no gear); the order pays more than the
 * base NPC price (or it would be pointless) but at most ×3 of it; rewards are not Sigils.
 */
export function validateNpcOrders(orders: readonly NpcOrder[], items: ReadonlyMap<string, ItemDefinition>, townIds: readonly string[]): OrderIssue[] {
  const out: OrderIssue[] = [];
  const ids = new Set<string>();
  for (const o of orders) {
    const issue = (message: string) => out.push({ orderId: o.id, message });
    if (ids.has(o.id)) issue("order id used twice");
    ids.add(o.id);
    if (!townIds.includes(o.mapId)) issue(`${o.mapId} is not a town`);
    let base = 0;
    for (const w of o.wants) {
      const it = items.get(w.itemId);
      if (it === undefined) issue(`unknown item ${w.itemId}`);
      else if (it.kind !== "material") issue(`${w.itemId} is not a material`);
      else base += it.vendorPrice * w.quantity;
    }
    let paid = o.reward.coins;
    for (const r of o.reward.items) {
      const it = items.get(r.itemId);
      if (it === undefined) issue(`unknown reward ${r.itemId}`);
      else if (it.kind === "sigil") issue("orders never pay Sigils");
      else paid += it.vendorPrice * r.quantity;
    }
    if (paid <= base) issue(`pays ${paid}, not more than the base NPC price ${base}`);
    if (paid > base * ORDER_MAX_PREMIUM) issue(`pays ${paid}, over ×${ORDER_MAX_PREMIUM} the base NPC price ${base}`);
  }
  return out;
}

/** EXAMPLE orders for the starting village (coast-and-meadow flavour). */
export const EXAMPLE_NPC_ORDERS: NpcOrder[] = [
  {
    id: "order:shell_roof",
    ...meta,
    npc: { th: "ช่างมุงหลังคา" },
    mapId: "map:dawn_town",
    note: { th: "ซ่อมหลังคาด้วยกระดองปูก่อนฝนมา" },
    wants: [{ itemId: "item:crab_shell", quantity: 8 }],
    reward: { coins: 90, items: [] },
    weeklyLimit: 3,
  },
  {
    id: "order:warm_blankets",
    ...meta,
    npc: { th: "ยายทอผ้า" },
    mapId: "map:dawn_town",
    note: { th: "ทอผ้าห่มขนตุ่นให้เด็ก ๆ" },
    wants: [
      { itemId: "item:mole_fur", quantity: 10 },
      { itemId: "item:bell_feather", quantity: 4 },
    ],
    reward: { coins: 40, items: [{ itemId: "item:small_potion", quantity: 1 }] },
    weeklyLimit: 3,
  },
  {
    id: "order:night_lamps",
    ...meta,
    npc: { th: "ยามหมู่บ้าน" },
    mapId: "map:dawn_town",
    note: { th: "เติมตะเกียงทางเดินด้วยเมือกเรืองแสง" },
    wants: [{ itemId: "item:snail_glow_slime", quantity: 6 }],
    reward: { coins: 55, items: [] },
    weeklyLimit: 2,
  },
  {
    id: "order:forge_ash",
    ...meta,
    npc: { th: "ช่างตีเหล็ก" },
    mapId: "map:dawn_town",
    note: { th: "เถ้าหางจิ้งจอกทำให้เตาร้อนนาน" },
    wants: [
      { itemId: "item:fox_tail_ash", quantity: 5 },
      { itemId: "item:river_pebble", quantity: 10 },
    ],
    reward: { coins: 80, items: [] },
    weeklyLimit: 2,
  },
];

export const exampleNpcOrderRegistry = (): Map<string, NpcOrder> => new Map(EXAMPLE_NPC_ORDERS.map((o) => [o.id, o]));
