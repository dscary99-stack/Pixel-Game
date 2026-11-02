import { describe, expect, it } from "vitest";
import {
  EXAMPLE_ITEMS,
  ItemDefinitionSchema,
  PRODUCTION_RULES,
  exampleContentMaps,
  planSigilInstall,
  sellQuote,
  sigilCapacity,
  sigilItemFor,
  sigilRemovalCost,
} from "../src";

const { equipment, items, sigils } = exampleContentMaps();
const def = (id: string) => equipment.get(id)!;
const item = (id: string) => items.get(id);

describe("Sigil sockets (C23, C24)", () => {
  it("capacity is the item's own count under the weapon 4 / other 1 cap", () => {
    expect(sigilCapacity(PRODUCTION_RULES, def("equip:wooden_sword"))).toBe(1);
    expect(sigilCapacity(PRODUCTION_RULES, def("equip:training_bow"))).toBe(2);
    expect(sigilCapacity(PRODUCTION_RULES, def("equip:cloth_tunic"))).toBe(1);
    expect(sigilCapacity(PRODUCTION_RULES, { ...def("equip:cloth_tunic"), maxSigilSlots: 4 })).toBe(1);
    expect(sigilCapacity(PRODUCTION_RULES, { ...def("equip:training_bow"), maxSigilSlots: 6 })).toBe(4);
  });

  it("installs compatible Sigils, duplicates included, and refuses the rest", () => {
    const bow = def("equip:training_bow");
    const once = planSigilInstall(PRODUCTION_RULES, bow, [], item("item:ember_fox_sigil"), sigils);
    expect(once).toEqual({ ok: true, sigilId: "sigil:ember_fox", sockets: ["sigil:ember_fox"] });
    expect(planSigilInstall(PRODUCTION_RULES, bow, ["sigil:ember_fox"], item("item:ember_fox_sigil"), sigils)).toMatchObject({ ok: true });
    expect(planSigilInstall(PRODUCTION_RULES, bow, ["sigil:ember_fox", "sigil:ember_fox"], item("item:ember_fox_sigil"), sigils)).toMatchObject({ code: "SIGIL_SLOTS_FULL" });
    expect(planSigilInstall(PRODUCTION_RULES, def("equip:apprentice_staff"), [], item("item:ember_fox_sigil"), sigils)).toMatchObject({ code: "SIGIL_INCOMPATIBLE" });
    expect(planSigilInstall(PRODUCTION_RULES, def("equip:crab_buckler"), [], item("item:armor_crab_sigil"), sigils)).toMatchObject({ ok: true });
    expect(planSigilInstall(PRODUCTION_RULES, def("equip:glow_charm"), [], item("item:supply_mole_sigil"), sigils)).toMatchObject({ ok: true });
    expect(planSigilInstall(PRODUCTION_RULES, bow, [], item("item:crab_shell"), sigils)).toMatchObject({ code: "NOT_A_SIGIL" });
  });

  it("every Sigil item names its Sigil and maps back", () => {
    for (const s of sigils.values()) expect(sigilItemFor(s.id, items)?.sigilId).toBe(s.id);
    expect(() => ItemDefinitionSchema.parse({ ...EXAMPLE_ITEMS[0], sigilId: "sigil:ember_fox" })).toThrow();
  });
});

describe("removal cost (P08) and NPC sale (chapter 06)", () => {
  it("is fixed by the item's level tier", () => {
    expect(sigilRemovalCost(PRODUCTION_RULES, def("equip:wooden_sword"))).toBe(300);
    expect(sigilRemovalCost(PRODUCTION_RULES, { ...def("equip:wooden_sword"), requiredLevel: 49 })).toBe(300);
    expect(sigilRemovalCost(PRODUCTION_RULES, { ...def("equip:wooden_sword"), requiredLevel: 50 })).toBe(10_800);
    expect(sigilRemovalCost(PRODUCTION_RULES, { ...def("equip:wooden_sword"), requiredLevel: 200 })).toBe(95_000);
  });

  it("pays vendorPrice per unit; capture items and Sigils are not bought", () => {
    expect(sellQuote([{ itemId: "item:crab_shell", quantity: 3 }, { itemId: "item:small_potion", quantity: 1 }], items)).toMatchObject({ ok: true, total: 25 });
    expect(sellQuote([{ itemId: "item:armor_crab_capture", quantity: 1 }], items)).toMatchObject({ code: "NOT_SELLABLE" });
    expect(sellQuote([{ itemId: "item:ember_fox_sigil", quantity: 1 }], items)).toMatchObject({ code: "NOT_SELLABLE" });
    expect(sellQuote([{ itemId: "item:crab_shell", quantity: 1 }, { itemId: "item:crab_shell", quantity: 1 }], items)).toMatchObject({ code: "INVALID_REQUEST" });
  });
});
