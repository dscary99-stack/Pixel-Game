/**
 * EXAMPLE equipment (chapter 05). Starter pieces and a few species drops, enough to prove the
 * 12-slot loadout, two-hand rules and gear stats in battle. Names, numbers and slots are drafts,
 * not an item catalog; there are no affixes, rarity or refining yet.
 */
import type { EquipmentDefinition } from "../schemas";

const meta = { version: 1, status: "draft", example: true } as const;

type Extra = Partial<Pick<EquipmentDefinition, "weaponKind" | "handedness" | "offhandKind">>;

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
  return { id, ...meta, name: { th }, category, requiredLevel, baseStats, maxSigilSlots, affixPoolId: `affix:${slug}`, visualSetId: `visual:${slug}`, ...extra };
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
  equip("equip:ember_fang_dagger", "มีดเขี้ยวสะเก็ด", "WEAPON", 5, { PATK: 14, CRIT_PCT: 3 }, 2, { weaponKind: "physical_melee", handedness: "one_hand" }),
];

/** DEV ONLY: equipment every dev account starts with. */
export const DEV_STARTER_EQUIPMENT = ["equip:wooden_sword", "equip:training_bow", "equip:apprentice_staff", "equip:cloth_tunic"] as const;
