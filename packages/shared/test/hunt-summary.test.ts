import { describe, expect, it } from "vitest";
import { addFightToSummary, exampleContentMaps, newHuntSummary, type SummaryFight } from "../src";

const items = exampleContentMaps().items;
const sigilItem = [...items.values()].find((i) => i.kind === "sigil")!;
const material = [...items.values()].find((i) => i.kind === "material" && i.vendorPrice > 0)!;

const fight = (battleId: string, status: string, extra: Partial<{ consumed: Record<string, number> }> = {}): SummaryFight => ({
  battleId,
  status,
  consumed: extra.consumed ?? {},
  entitlements: [
    { kind: "kill", exp: 30, companionExp: { a: 5, b: 3 }, items: [{ itemId: material.id, quantity: 2 }] },
    { kind: "kill", exp: 20, companionExp: { a: 4 }, items: [{ itemId: sigilItem.id, quantity: 1 }] },
    { kind: "fight_result" },
  ],
});

describe("Auto Hunt summary (chapter 08)", () => {
  it("adds EXP, drops, NPC value, consumption and rare drops of a finished fight", () => {
    const s = addFightToSummary(newHuntSummary(1000), fight("b1", "victory", { consumed: { "item:small_potion": 1 } }), items);
    expect(s).toMatchObject({ fights: 1, wins: 1, defeats: 0, exp: 50, companionExp: 12, coins: 0, lastBattleId: "b1" });
    expect(s.items).toEqual({ [material.id]: 2, [sigilItem.id]: 1 });
    expect(s.consumed).toEqual({ "item:small_potion": 1 });
    expect(s.npcValue).toBe(material.vendorPrice * 2 + sigilItem.vendorPrice);
    expect(s.rare).toEqual([sigilItem.id]);
  });

  it("sums several fights and counts a defeat", () => {
    let s = newHuntSummary(0);
    s = addFightToSummary(s, fight("b1", "victory", { consumed: { "item:small_potion": 1 } }), items);
    s = addFightToSummary(s, { battleId: "b2", status: "defeat", consumed: { "item:small_potion": 2 }, entitlements: [] }, items);
    expect(s).toMatchObject({ fights: 2, wins: 1, defeats: 1, exp: 50 });
    expect(s.consumed).toEqual({ "item:small_potion": 3 });
  });

  it("never counts an active fight or the same fight twice", () => {
    const s0 = newHuntSummary(0);
    expect(addFightToSummary(s0, fight("b1", "active"), items)).toBe(s0);
    const s1 = addFightToSummary(s0, fight("b1", "victory"), items);
    expect(addFightToSummary(s1, fight("b1", "victory"), items)).toBe(s1);
    expect(s0.fights).toBe(0);
  });
});
