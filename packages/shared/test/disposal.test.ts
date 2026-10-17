/** Selling / salvaging gear and companion names (chapter 09 sinks, disposal.ts). */
import { describe, expect, it } from "vitest";
import {
  EXAMPLE_RECIPES,
  GearDisposeRequestSchema,
  NicknameRequestSchema,
  PRODUCTION_RULES as R,
  disposeQuote,
  exampleContentMaps,
  gearSellPrice,
  salvageYield,
  validateDisposalLoops,
  type Recipe,
} from "../src";

const content = exampleContentMaps();
const def = (id: string) => content.equipment.get(id)!;
const pool = (id: string) => content.affixPools.get(def(id).affixPoolId)!;

describe("gear prices", () => {
  it("sell price grows with item level and rarity; salvage gives the reroll material", () => {
    expect(gearSellPrice(R, def("equip:wooden_sword"), "COMMON")).toBe(8);
    expect(gearSellPrice(R, def("equip:crystal_shell_plate"), "COMMON")).toBe(28);
    expect(gearSellPrice(R, def("equip:crystal_shell_plate"), "RARE")).toBe(70);
    expect(salvageYield(R, def("equip:crystal_shell_plate"), pool("equip:crystal_shell_plate"), "EPIC")).toEqual({ itemId: "item:river_pebble", quantity: 5 });
  });

  it("a quote merges salvage material across pieces", () => {
    const pieces = [
      { def: def("equip:wooden_sword"), pool: pool("equip:wooden_sword"), rarity: "COMMON" as const },
      { def: def("equip:cloth_tunic"), pool: pool("equip:cloth_tunic"), rarity: "RARE" as const },
    ];
    expect(disposeQuote(R, "salvage", pieces)).toEqual({ coins: 0, items: [{ itemId: "item:river_pebble", quantity: 4 }] });
    expect(disposeQuote(R, "sell", pieces)).toEqual({ coins: 8 + 20, items: [] });
  });

  it("crafting then selling or salvaging never pays more than the recipe cost", () => {
    expect(validateDisposalLoops(R, EXAMPLE_RECIPES, content.equipment, content.affixPools, content.items)).toEqual([]);
    const cheap: Recipe = { ...EXAMPLE_RECIPES.find((r) => r.id === "recipe:mole_sandals")!, coins: 0, inputs: [{ itemId: "item:river_pebble", quantity: 1 }] };
    expect(validateDisposalLoops(R, [cheap], content.equipment, content.affixPools, content.items)).toHaveLength(1);
  });

  it("a request names each piece once", () => {
    const base = { operationId: "dispose_001", mode: "sell", expected: { coins: 8, items: [] } };
    expect(GearDisposeRequestSchema.safeParse({ ...base, equipmentIds: ["a", "a"] }).success).toBe(false);
    expect(GearDisposeRequestSchema.safeParse({ ...base, equipmentIds: ["a"] }).success).toBe(true);
  });
});

describe("nicknames", () => {
  const parse = (nickname: string | null) => NicknameRequestSchema.safeParse({ companionId: "m", nickname });
  it("trims and collapses spaces, keeps Thai, refuses markup, empty and over 16", () => {
    expect(parse("  เจ้า   ปู  ").data?.nickname).toBe("เจ้า ปู");
    expect(parse("Mr. O'Crab-2").success).toBe(true);
    expect(parse(null).data?.nickname).toBeNull();
    for (const bad of ["", "   ", "<i>", "a\u0000b", "x".repeat(17)]) expect(parse(bad).success).toBe(false);
  });
});
