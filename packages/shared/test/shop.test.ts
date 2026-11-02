import { describe, expect, it } from "vitest";
import {
  DEV_FIXTURE_RULES as R,
  EXAMPLE_SHOPS,
  STARTER_KIT,
  buyQuote,
  exampleContentMaps,
  gearBands,
  gearBuyQuote,
  gearSellPrice,
  ShopDefinitionSchema,
  validateShops,
  type ShopDefinition,
} from "../src/index";

const c = exampleContentMaps();
const towns = ["map:dawn_town"];

describe("shops (chapter 06)", () => {
  it("the example shop validates: listed goods cost more than the NPC pays back", () => {
    expect(validateShops(EXAMPLE_SHOPS, c.items, c.species, towns, { rules: R, equipment: c.equipment, pools: c.affixPools })).toEqual([]);
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

  it("the armory sells plain gear by level band, each above what selling or salvaging it pays back", () => {
    const armory = EXAMPLE_SHOPS.find((s) => s.id === "shop:dawn_armory")!;
    expect(ShopDefinitionSchema.safeParse(armory).success).toBe(true);
    const bands = gearBands(armory, c.equipment);
    expect(bands.map((b) => b.level)).toEqual([1, 10, 20, 30, 40]);
    for (const b of bands) {
      // Every band has a weapon of each kind, body armour, a cap, boots and a shield.
      const kinds = b.pieces.map((p) => p.def.weaponKind ?? p.def.category).sort();
      expect(kinds).toEqual(["ARMOR", "FEET", "HEAD_TOP", "OFFHAND", "magic", "physical_melee", "physical_ranged", "support"]);
      for (const p of b.pieces) expect(p.price).toBeGreaterThan(gearSellPrice(R, p.def, "COMMON"));
    }
    expect(gearBuyQuote(armory, "equip:shop_sword_10", 2)).toEqual({ ok: true, price: 190, total: 380 });
    expect(gearBuyQuote(armory, "equip:ember_fang_dagger", 1)).toMatchObject({ ok: false, code: "NOT_SOLD_HERE" });
    const cheap: ShopDefinition = { ...armory, gear: [{ definitionId: "equip:shop_sword_40", price: 100 }, { definitionId: "equip:nope", price: 9 }] };
    expect(validateShops([cheap], c.items, c.species, towns, { rules: R, equipment: c.equipment, pools: c.affixPools }).map((i) => i.message)).toEqual([
      "equip:shop_sword_40 sells for 100 but pays back 164",
      "unknown equipment equip:nope",
    ]);
  });

  it("the starter kit only names things that exist", () => {
    for (const id of Object.keys(STARTER_KIT.items)) expect(c.items.has(id)).toBe(true);
    for (const id of STARTER_KIT.equipment) expect(c.equipment.has(id)).toBe(true);
  });
});
