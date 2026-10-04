/**
 * Crafting (chapter 05 §6, chapter 09 "Crafting professions", P09).
 *
 * - Every character can learn every profession; each has its own mastery (no alts, no energy).
 * - A recipe always succeeds when its materials, coins and mastery are there. Gear comes out with a
 *   rarity and affixes rolled from its type's pool (shown before confirming), sockets as declared.
 * - A recipe stops giving mastery once mastery reaches its cap, but can still be made without limit.
 * - Sigils are never an ordinary craft; a species capture item needs that species' material.
 * - No NPC buy → craft → NPC sell profit loop (`validateRecipes`).
 * - Inputs and outputs change in one batch on the server (atomic).
 *
 * Recipes, numbers and professions' outputs here are EXAMPLE / P12 assumptions.
 */
import { z } from "zod";
import { OperationIdSchema } from "./character";
import { ItemId, type EquipmentDefinition, type ItemDefinition, type LootTable, type SpeciesDefinition } from "./schemas";
import type { ShopDefinition } from "./shop";

const meta = { version: 1, status: "draft", example: true } as const;

export const PROFESSIONS = ["weaponsmith", "armorsmith", "jeweler", "alchemist", "tamer", "tailor"] as const;
export const ProfessionSchema = z.enum(PROFESSIONS);
export type Profession = z.infer<typeof ProfessionSchema>;

export const PROFESSION_NAME_TH: Record<Profession, string> = {
  weaponsmith: "ช่างอาวุธ",
  armorsmith: "ช่างเกราะ",
  jeweler: "ช่างเครื่องประดับ",
  alchemist: "นักปรุงยา",
  tamer: "ผู้ดูแลคู่ใจ",
  tailor: "ช่างแฟชั่น",
};

/** Mastery is 0..this per profession. */
export const CRAFT_MASTERY_MAX = 1000;

export const RecipeId = z.string().regex(/^recipe:[a-z0-9_]+$/);

export const RecipeSchema = z
  .object({
    id: RecipeId,
    version: z.number().int().min(1),
    status: z.enum(["draft", "validated", "published", "retired"]),
    example: z.boolean(),
    name: z.object({ th: z.string().min(1), en: z.string().min(1).optional() }).strict(),
    profession: ProfessionSchema,
    inputs: z.array(z.object({ itemId: ItemId, quantity: z.number().int().min(1).max(99) }).strict()).min(1).max(6),
    coins: z.number().int().min(0),
    output: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("item"), itemId: ItemId, quantity: z.number().int().min(1).max(99) }).strict(),
      z.object({ kind: z.literal("equipment"), definitionId: z.string().regex(/^equip:[a-z0-9_]+$/) }).strict(),
    ]),
    requiredMastery: z.number().int().min(0).max(CRAFT_MASTERY_MAX),
    /** Mastery gained per craft while below `masteryCap`. */
    masteryGain: z.number().int().min(0).max(100),
    masteryCap: z.number().int().min(0).max(CRAFT_MASTERY_MAX),
  })
  .strict()
  .refine((r) => r.masteryCap >= r.requiredMastery, "masteryCap below requiredMastery");
export type Recipe = z.infer<typeof RecipeSchema>;

export const CraftRequestSchema = z
  .object({
    operationId: OperationIdSchema,
    recipeId: RecipeId,
    /** How many times to make it in one go. */
    times: z.number().int().min(1).max(10),
    /** The coins the player was shown (times × recipe coins); a change is refused. */
    expectedCoins: z.number().int().min(0),
  })
  .strict();
export type CraftRequest = z.infer<typeof CraftRequestSchema>;

/** What `times` crafts take and give. */
export function craftQuote(recipe: Recipe, times: number): { coins: number; inputs: { itemId: string; quantity: number }[] } {
  return { coins: recipe.coins * times, inputs: recipe.inputs.map((i) => ({ itemId: i.itemId, quantity: i.quantity * times })) };
}

/** Mastery after `times` crafts: grows by the gain each time, never past the recipe's cap. */
export function masteryAfter(recipe: Recipe, current: number, times: number): number {
  if (current >= recipe.masteryCap) return current;
  return Math.min(recipe.masteryCap, current + recipe.masteryGain * times);
}

export interface RecipeIssue {
  recipeId: string;
  message: string;
}

/**
 * Content check: inputs and outputs exist; no Sigil output; a species capture item needs one of that
 * species' own drops; gear goes to the right profession; and buying every input from an NPC shop
 * then selling the output back never pays (chapter 14 §7).
 */
export function validateRecipes(
  recipes: readonly Recipe[],
  content: {
    items: ReadonlyMap<string, ItemDefinition>;
    equipment: ReadonlyMap<string, EquipmentDefinition>;
    species: ReadonlyMap<string, SpeciesDefinition>;
    lootTables: ReadonlyMap<string, LootTable>;
    shops?: ReadonlyMap<string, ShopDefinition>;
  },
): RecipeIssue[] {
  const out: RecipeIssue[] = [];
  const issue = (r: Recipe, message: string) => out.push({ recipeId: r.id, message });
  // Cheapest NPC price for each item any shop sells.
  const shopPrice = new Map<string, number>();
  for (const s of content.shops?.values() ?? []) for (const l of s.listings) shopPrice.set(l.itemId, Math.min(shopPrice.get(l.itemId) ?? Infinity, l.price));
  const ids = new Set<string>();
  for (const r of recipes) {
    if (ids.has(r.id)) issue(r, "recipe id used twice");
    ids.add(r.id);
    for (const i of r.inputs) if (!content.items.has(i.itemId)) issue(r, `unknown input ${i.itemId}`);
    if (new Set(r.inputs.map((i) => i.itemId)).size !== r.inputs.length) issue(r, "an input is listed twice");
    const o = r.output;
    if (o.kind === "item") {
      const it = content.items.get(o.itemId);
      if (it === undefined) issue(r, `unknown output ${o.itemId}`);
      else {
        if (it.kind === "sigil") issue(r, "Sigils are never an ordinary craft");
        if (r.inputs.some((i) => i.itemId === o.itemId)) issue(r, "the output is also an input");
        if (it.kind === "capture") {
          const sp = it.captureSpeciesId === undefined ? undefined : content.species.get(it.captureSpeciesId);
          const table = sp === undefined ? undefined : content.lootTables.get(sp.lootTableId);
          const own = new Set(table?.pools.filter((p) => p.id === "species").flatMap((p) => p.entries.map((e) => e.itemId)) ?? []);
          if (!r.inputs.some((i) => own.has(i.itemId))) issue(r, `a capture item for ${it.captureSpeciesId} needs that species' material`);
        }
        // NPC loop: every input buyable at a shop, and selling the output back pays more than it cost.
        const buyable = r.inputs.every((i) => shopPrice.has(i.itemId));
        if (buyable) {
          const cost = r.coins + r.inputs.reduce((s, i) => s + shopPrice.get(i.itemId)! * i.quantity, 0);
          if (it.vendorPrice * o.quantity >= cost) issue(r, `buying the inputs (${cost}) and selling the output (${it.vendorPrice * o.quantity}) is a profit loop`);
        }
      }
    } else {
      const def = content.equipment.get(o.definitionId);
      if (def === undefined) issue(r, `unknown output ${o.definitionId}`);
      else if (r.profession !== professionForGear(def)) issue(r, `${def.category} gear is made by ${professionForGear(def)}`);
    }
  }
  return out;
}

/** Which profession makes a piece of gear (chapter 09 table). */
export function professionForGear(def: EquipmentDefinition): Profession {
  if (def.category === "WEAPON") return "weaponsmith";
  if (def.category === "ACCESSORY" || def.category === "AURA" || (def.category === "OFFHAND" && def.offhandKind !== "shield")) return "jeweler";
  return "armorsmith";
}

/**
 * EXAMPLE recipes, one or two per profession that has outputs today (no fashion or companion gear
 * exists yet). Gear recipes use a species' own material plus the field's common stone.
 */
export const EXAMPLE_RECIPES: Recipe[] = [
  recipe("recipe:crab_buckler", "โล่กระดองปู", "armorsmith", [["item:crab_shell", 6], ["item:river_pebble", 4]], 120, { kind: "equipment", definitionId: "equip:crab_buckler" }, 0, 5, 60),
  recipe("recipe:mole_sandals", "รองเท้าขนตุ่น", "armorsmith", [["item:mole_fur", 6], ["item:river_pebble", 3]], 80, { kind: "equipment", definitionId: "equip:mole_sandals" }, 0, 5, 40),
  recipe("recipe:crystal_shell_plate", "เกราะกระดองผลึก", "armorsmith", [["item:crystal_shard", 4], ["item:crab_shell", 6], ["item:river_pebble", 6]], 400, { kind: "equipment", definitionId: "equip:crystal_shell_plate" }, 30, 8, 150),
  recipe("recipe:ember_fang_dagger", "มีดเขี้ยวสะเก็ด", "weaponsmith", [["item:fox_tail_ash", 6], ["item:river_pebble", 6]], 200, { kind: "equipment", definitionId: "equip:ember_fang_dagger" }, 0, 6, 80),
  recipe("recipe:glow_charm", "เครื่องรางเรืองแสง", "jeweler", [["item:snail_glow_slime", 6], ["item:river_pebble", 3]], 150, { kind: "equipment", definitionId: "equip:glow_charm" }, 0, 5, 60),
  recipe("recipe:bell_feather_cap", "หมวกขนนกกระดิ่ง", "armorsmith", [["item:bell_feather", 6], ["item:river_pebble", 2]], 90, { kind: "equipment", definitionId: "equip:bell_feather_cap" }, 0, 5, 40),
  recipe("recipe:small_potion", "ยาเล็ก ×2", "alchemist", [["item:mole_fur", 2], ["item:bell_feather", 1]], 5, { kind: "item", itemId: "item:small_potion", quantity: 2 }, 0, 2, 30),
  recipe("recipe:armor_crab_capture", "เครื่องจับปูเกราะ", "tamer", [["item:crab_shell", 3], ["item:river_pebble", 2]], 20, { kind: "item", itemId: "item:armor_crab_capture", quantity: 1 }, 0, 3, 40),
  recipe("recipe:ember_fox_capture", "เครื่องจับจิ้งจอกสะเก็ด", "tamer", [["item:fox_tail_ash", 3], ["item:river_pebble", 2]], 30, { kind: "item", itemId: "item:ember_fox_capture", quantity: 1 }, 10, 3, 60),
];

function recipe(
  id: Recipe["id"],
  th: string,
  profession: Profession,
  inputs: [string, number][],
  coins: number,
  output: Recipe["output"],
  requiredMastery: number,
  masteryGain: number,
  masteryCap: number,
): Recipe {
  return { id, ...meta, name: { th }, profession, inputs: inputs.map(([itemId, quantity]) => ({ itemId, quantity })), coins, output, requiredMastery, masteryGain, masteryCap };
}

export const exampleRecipeRegistry = (): Map<string, Recipe> => new Map(EXAMPLE_RECIPES.map((r) => [r.id, r]));
