/**
 * EXAMPLE equipment (chapter 05). Starter pieces and a few species drops, enough to prove the
 * 12-slot loadout, two-hand rules and gear stats in battle. Names, numbers and slots are drafts,
 * not an item catalog. Each piece names an affix pool by type of gear (chapter 05 §3); there is no
 * refining yet.
 */
import type { AffixPool, EquipmentDefinition } from "../schemas";

const meta = { version: 1, status: "draft", example: true } as const;

type Extra = Partial<Pick<EquipmentDefinition, "weaponKind" | "handedness" | "offhandKind" | "affixPoolId">>;

/**
 * EXAMPLE affix pools by type of gear (chapter 05 §3): values are the Lv1 range. Support weapons
 * get support stats, not attack ones; nothing raises drops, EXP or capture.
 */
export const EXAMPLE_AFFIX_POOLS: AffixPool[] = [
  pool("affix:weapon_physical", [["STR", 3, 1, 3], ["DEX", 3, 1, 3], ["PATK", 4, 2, 5], ["ACCURACY_PCT", 2, 1, 3], ["CRIT_PCT", 2, 1, 2], ["CRIT_DAMAGE", 1, 3, 6]]),
  pool("affix:weapon_magic", [["INT", 3, 1, 3], ["SPI", 2, 1, 2], ["MATK", 4, 2, 5], ["MP", 3, 5, 12], ["EFFECT_HIT_PCT", 2, 1, 3], ["CRIT_PCT", 1, 1, 2]]),
  pool("affix:weapon_support", [["SPI", 3, 1, 3], ["INT", 2, 1, 2], ["SUPPORT", 4, 2, 5], ["MP", 3, 5, 12], ["EFFECT_HIT_PCT", 2, 1, 3], ["MDEF", 1, 1, 3]]),
  pool("affix:defense", [["VIT", 3, 1, 3], ["HP", 4, 10, 25], ["PDEF", 3, 1, 4], ["MDEF", 3, 1, 4], ["EFFECT_RES_PCT", 2, 1, 3]]),
  pool("affix:light", [["AGI", 3, 1, 3], ["SPD", 3, 1, 3], ["EVASION_PCT", 2, 1, 2], ["HP", 2, 8, 20], ["EFFECT_RES_PCT", 1, 1, 2]]),
  pool("affix:trinket", [["STR", 1, 1, 2], ["INT", 1, 1, 2], ["SPI", 1, 1, 2], ["DEX", 1, 1, 2], ["CRIT_PCT", 2, 1, 2], ["MP", 2, 5, 10], ["EFFECT_RES_PCT", 2, 1, 3]]),
];

function pool(id: AffixPool["id"], entries: [string, number, number, number][]): AffixPool {
  return { id, ...meta, entries: entries.map(([stat, weight, min, max]) => ({ stat, weight, min, max })) };
}

/** The pool for a piece by its type (weapon kind, defense, light, trinket). */
function poolFor(category: EquipmentDefinition["category"], extra: Extra): string {
  if (category === "WEAPON") return extra.weaponKind === "magic" ? "affix:weapon_magic" : extra.weaponKind === "support" ? "affix:weapon_support" : "affix:weapon_physical";
  if (category === "FEET" || category === "BACK") return "affix:light";
  if (category === "ACCESSORY" || category === "AURA") return "affix:trinket";
  if (category === "OFFHAND") return extra.offhandKind === "shield" ? "affix:defense" : "affix:trinket";
  return "affix:defense";
}

function equip(
  id: EquipmentDefinition["id"],
  th: string,
  category: EquipmentDefinition["category"],
  requiredLevel: number,
  baseStats: EquipmentDefinition["baseStats"],
  maxSigilSlots: number,
  extra: Extra = {},
): EquipmentDefinition {
  const slug = id.slice("equip:".length);
  return { id, ...meta, name: { th }, category, requiredLevel, baseStats, maxSigilSlots, affixPoolId: poolFor(category, extra), visualSetId: `visual:${slug}`, ...extra };
}

export const EXAMPLE_EQUIPMENT: EquipmentDefinition[] = [
  // Starter pieces (dev hands these out; a real starter kit is not designed yet).
  equip("equip:wooden_sword", "ดาบไม้", "WEAPON", 1, { PATK: 8 }, 1, { weaponKind: "physical_melee", handedness: "one_hand" }),
  equip("equip:training_bow", "ธนูฝึก", "WEAPON", 1, { PATK: 10, ACCURACY_PCT: 3 }, 2, { weaponKind: "physical_ranged", handedness: "two_hand" }),
  equip("equip:apprentice_staff", "ไม้เท้าฝึกหัด", "WEAPON", 1, { MATK: 12, MP: 10 }, 2, { weaponKind: "magic", handedness: "two_hand" }),
  equip("equip:cloth_tunic", "เสื้อผ้าฝ้าย", "ARMOR", 1, { PDEF: 4, HP: 30 }, 1),
  // Species drops.
  equip("equip:mole_sandals", "รองเท้าขนตุ่น", "FEET", 1, { PDEF: 2, SPD: 2 }, 1),
  equip("equip:bell_feather_cap", "หมวกขนนกกระดิ่ง", "HEAD_TOP", 2, { MDEF: 3, EVASION_PCT: 1 }, 1),
  equip("equip:crab_buckler", "โล่กระดองปู", "OFFHAND", 4, { PDEF: 6, HP: 40 }, 1, { offhandKind: "shield" }),
  equip("equip:glow_charm", "เครื่องรางเรืองแสง", "ACCESSORY", 3, { SUPPORT: 5, MP: 15 }, 1),
  equip("equip:crystal_shell_plate", "เกราะกระดองผลึก", "ARMOR", 6, { PDEF: 10, HP: 60 }, 1),
  equip("equip:ember_fang_dagger", "มีดเขี้ยวสะเก็ด", "WEAPON", 5, { PATK: 14, CRIT_PCT: 3 }, 2, { weaponKind: "physical_melee", handedness: "one_hand" }),
];

/** DEV ONLY: equipment every dev account starts with. */
export const DEV_STARTER_EQUIPMENT = ["equip:wooden_sword", "equip:training_bow", "equip:apprentice_staff", "equip:cloth_tunic"] as const;
