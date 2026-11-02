import { describe, expect, it } from "vitest";
import { addFightToSummary, dropChance, exampleContentMaps, isRareDrop, newHuntSummary, PRODUCTION_RULES as R, type SummaryFight } from "../src";

const content = exampleContentMaps();
const items = content.items;
const isRare = (speciesId: string, itemId: string) => isRareDrop(R, content.lootTables.get(content.species.get(speciesId)?.lootTableId ?? ""), itemId);
const sigilItem = items.get("item:armor_crab_sigil")!;
const material = [...items.values()].find((i) => i.kind === "material" && i.vendorPrice > 0)!;

const fight = (battleId: string, status: string, extra: Partial<{ consumed: Record<string, number> }> = {}): SummaryFight => ({
  battleId,
  status,
  consumed: extra.consumed ?? {},
  entitlements: [
    { kind: "kill", speciesId: "species:armor_crab", exp: 30, companionExp: { a: 5, b: 3 }, items: [{ itemId: material.id, quantity: 2 }] },
    { kind: "kill", speciesId: "species:armor_crab", exp: 20, companionExp: { a: 4 }, items: [{ itemId: sigilItem.id, quantity: 1 }] },
    { kind: "fight_result" },
  ],
});

describe("Auto Hunt summary (chapter 08)", () => {
  it("adds EXP, drops, NPC value, consumption and rare drops of a finished fight", () => {
    const s = addFightToSummary(newHuntSummary(1000), fight("b1", "victory", { consumed: { "item:small_potion": 1 } }), items, isRare);
    expect(s).toMatchObject({ fights: 1, wins: 1, defeats: 0, exp: 50, companionExp: 12, coins: 0, lastBattleId: "b1" });
    expect(s.items).toEqual({ [material.id]: 2, [sigilItem.id]: 1 });
    expect(s.consumed).toEqual({ "item:small_potion": 1 });
    expect(s.npcValue).toBe(material.vendorPrice * 2 + sigilItem.vendorPrice);
    expect(s.rare).toEqual([sigilItem.id]);
  });

  it("sums several fights and counts a defeat", () => {
    let s = newHuntSummary(0);
    s = addFightToSummary(s, fight("b1", "victory", { consumed: { "item:small_potion": 1 } }), items, isRare);
    s = addFightToSummary(s, { battleId: "b2", status: "defeat", consumed: { "item:small_potion": 2 }, entitlements: [] }, items, isRare);
    expect(s).toMatchObject({ fights: 2, wins: 1, defeats: 1, exp: 50 });
    expect(s.consumed).toEqual({ "item:small_potion": 3 });
  });

  it("never counts an active fight or the same fight twice", () => {
    const s0 = newHuntSummary(0);
    expect(addFightToSummary(s0, fight("b1", "active"), items, isRare)).toBe(s0);
    const s1 = addFightToSummary(s0, fight("b1", "victory"), items, isRare);
    expect(addFightToSummary(s1, fight("b1", "victory"), items, isRare)).toBe(s1);
    expect(s0.fights).toBe(0);
  });

  it("a drop is rare when its chance is under 1% (Nut 2026-10-04)", () => {
    const table = content.lootTables.get("loot:armor_crab")!;
    expect(dropChance(R, table, "item:armor_crab_sigil")).toBeCloseTo(0.0005, 6);
    expect(isRareDrop(R, table, "item:armor_crab_sigil")).toBe(true);
    expect(isRareDrop(R, table, "item:crab_shell")).toBe(false);
    expect(isRareDrop(R, table, "item:not_in_table")).toBe(false);
    // Example gear is weighted to under 1% (rare), the species' own material is common.
    expect(isRareDrop(R, table, "equip:crab_buckler")).toBe(true);
    expect(dropChance(R, table, "equip:crab_buckler")).toBeGreaterThan(0.001);
  });
});
