import { describe, expect, it } from "vitest";
import { EXAMPLE_SHOPS, STARTER_KIT, buyQuote, exampleContentMaps, validateShops, type ShopDefinition } from "../src/index";

const c = exampleContentMaps();
const towns = ["map:dawn_town"];

describe("shops (chapter 06)", () => {
  it("the example shop validates: listed goods cost more than the NPC pays back", () => {
    expect(validateShops(EXAMPLE_SHOPS, c.items, c.species, towns)).toEqual([]);
    for (const l of EXAMPLE_SHOPS[0]!.listings) expect(l.price).toBeGreaterThan(c.items.get(l.itemId)!.vendorPrice);
  });

  it("flags a buy-sell loop, materials, Sigils, boss capture items, unknown items and a shop outside town", () => {
    const bad: ShopDefinition = {
      ...EXAMPLE_SHOPS[0]!,
      mapId: "map:dawn_field",
      listings: [
        { itemId: "item:small_potion", price: 10 },
        { itemId: "item:crab_shell", price: 50 },
        { itemId: "item:ember_fox_sigil", price: 5000 },
        { itemId: "item:crystal_crab_lord_capture", price: 500 },
        { itemId: "item:nope", price: 5 },
      ],
    };
    const messages = validateShops([bad], c.items, c.species, towns).map((i) => i.message);
    expect(messages).toEqual([
      "map:dawn_field is not a town",
      "item:small_potion sells for 10 but the NPC buys it back for 10",
      "item:crab_shell: shops do not sell materials",
      "item:ember_fox_sigil: shops do not sell sigils",
      "item:crystal_crab_lord_capture: boss capture items are not sold",
      "unknown item item:nope",
    ]);
  });

  it("quotes the listed price and refuses duplicates or unlisted goods", () => {
    const shop = EXAMPLE_SHOPS[0]!;
    expect(buyQuote(shop, [{ itemId: "item:small_potion", quantity: 3 }])).toMatchObject({ ok: true, total: 90 });
    expect(buyQuote(shop, [{ itemId: "item:small_potion", quantity: 1 }, { itemId: "item:small_potion", quantity: 1 }])).toMatchObject({ ok: false, code: "INVALID_REQUEST" });
    expect(buyQuote(shop, [{ itemId: "item:crab_shell", quantity: 1 }])).toMatchObject({ ok: false, code: "NOT_SOLD_HERE" });
  });

  it("the starter kit only names things that exist", () => {
    for (const id of Object.keys(STARTER_KIT.items)) expect(c.items.has(id)).toBe(true);
    for (const id of STARTER_KIT.equipment) expect(c.equipment.has(id)).toBe(true);
  });
});
