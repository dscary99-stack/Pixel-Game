import { describe, expect, it } from "vitest";
import { EXAMPLE_NPC_ORDERS, NpcOrderSchema, exampleContentMaps, exampleMapRegistry, validateNpcOrders, type NpcOrder } from "../src";

const { items } = exampleContentMaps();
const towns = [...exampleMapRegistry().values()].filter((m) => m.kind === "town").map((m) => m.id);
const roof = EXAMPLE_NPC_ORDERS[0]!;

describe("NPC orders (chapter 09)", () => {
  it("example orders parse and pass the content check", () => {
    for (const o of EXAMPLE_NPC_ORDERS) expect(NpcOrderSchema.safeParse(o).success).toBe(true);
    expect(validateNpcOrders(EXAMPLE_NPC_ORDERS, items, towns)).toEqual([]);
  });

  it("refuses non-materials, Sigil rewards, no premium, too much premium and field maps", () => {
    const sigil = [...items.values()].find((i) => i.kind === "sigil")!;
    const bad: NpcOrder[] = [
      { ...roof, id: "order:potion", wants: [{ itemId: "item:small_potion", quantity: 1 }] },
      { ...roof, id: "order:sigil", reward: { coins: 90, items: [{ itemId: sigil.id, quantity: 1 }] } },
      { ...roof, id: "order:cheap", reward: { coins: 40, items: [] } },
      { ...roof, id: "order:rich", reward: { coins: 500, items: [] } },
      { ...roof, id: "order:field", mapId: "map:dawn_field" },
    ];
    const msgs = validateNpcOrders(bad, items, towns).map((i) => `${i.orderId} ${i.message}`);
    expect(msgs.some((m) => m.startsWith("order:potion") && m.includes("not a material"))).toBe(true);
    expect(msgs.some((m) => m.startsWith("order:sigil") && m.includes("never pay Sigils"))).toBe(true);
    expect(msgs.some((m) => m.startsWith("order:cheap") && m.includes("not more than"))).toBe(true);
    expect(msgs.some((m) => m.startsWith("order:rich") && m.includes("over ×3"))).toBe(true);
    expect(msgs.some((m) => m.startsWith("order:field") && m.includes("not a town"))).toBe(true);
  });
});
