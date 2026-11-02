import { describe, expect, it } from "vitest";
import {
  EXAMPLE_RECIPES,
  RecipeSchema,
  craftQuote,
  exampleContentMaps,
  exampleShopRegistry,
  masteryAfter,
  validateRecipes,
  type Recipe,
} from "../src";

const content = { ...exampleContentMaps(), shops: exampleShopRegistry() };
const potion = EXAMPLE_RECIPES.find((r) => r.id === "recipe:small_potion")!;
const plate = EXAMPLE_RECIPES.find((r) => r.id === "recipe:crystal_shell_plate")!;

describe("crafting recipes (chapter 05 §6, chapter 09)", () => {
  it("example recipes parse and pass the content check", () => {
    for (const r of EXAMPLE_RECIPES) expect(RecipeSchema.safeParse(r).success).toBe(true);
    expect(validateRecipes(EXAMPLE_RECIPES, content)).toEqual([]);
  });

  it("refuses Sigil outputs, output-as-input, unknown ids and a capture item without the species' material", () => {
    const sigilItem = [...content.items.values()].find((i) => i.kind === "sigil")!;
    const bad: Recipe[] = [
      { ...potion, id: "recipe:sigil", output: { kind: "item", itemId: sigilItem.id, quantity: 1 } },
      { ...potion, id: "recipe:loop_self", inputs: [{ itemId: "item:small_potion", quantity: 1 }] },
      { ...potion, id: "recipe:unknown", inputs: [{ itemId: "item:nope", quantity: 1 }] },
      { ...potion, id: "recipe:capture", profession: "tamer", inputs: [{ itemId: "item:river_pebble", quantity: 3 }], output: { kind: "item", itemId: "item:armor_crab_capture", quantity: 1 } },
      { ...plate, id: "recipe:gear_unknown", output: { kind: "equipment", definitionId: "equip:nope" } },
    ];
    const msgs = validateRecipes(bad, content).map((i) => `${i.recipeId} ${i.message}`);
    expect(msgs.some((m) => m.startsWith("recipe:sigil") && m.includes("Sigils"))).toBe(true);
    expect(msgs.some((m) => m.startsWith("recipe:loop_self") && m.includes("also an input"))).toBe(true);
    expect(msgs.some((m) => m.startsWith("recipe:unknown") && m.includes("unknown input"))).toBe(true);
    expect(msgs.some((m) => m.startsWith("recipe:capture") && m.includes("needs that species' material"))).toBe(true);
    expect(msgs.some((m) => m.startsWith("recipe:gear_unknown") && m.includes("unknown output"))).toBe(true);
  });

  it("refuses an NPC buy → craft → sell profit loop and gear made by the wrong profession", () => {
    // Small potion sells back for 10; buying two capture items to make 10 potions is a loop.
    const loop: Recipe = { ...potion, id: "recipe:npc_loop", coins: 0, inputs: [{ itemId: "item:supply_mole_capture", quantity: 1 }], output: { kind: "item", itemId: "item:small_potion", quantity: 10 } };
    expect(validateRecipes([loop], content)[0]?.message).toContain("profit loop");
    const wrong: Recipe = { ...plate, id: "recipe:wrong_prof", profession: "weaponsmith" };
    expect(validateRecipes([wrong], content)[0]?.message).toContain("made by armorsmith");
  });

  it("quotes times × inputs and coins; mastery grows to the cap and stops there", () => {
    expect(craftQuote(plate, 3)).toEqual({ coins: 1200, inputs: [{ itemId: "item:crystal_shard", quantity: 12 }, { itemId: "item:crab_shell", quantity: 18 }, { itemId: "item:river_pebble", quantity: 18 }] });
    expect(masteryAfter(plate, 30, 2)).toBe(46);
    expect(masteryAfter(plate, 145, 10)).toBe(150);
    expect(masteryAfter(plate, 200, 5)).toBe(200);
  });
});
