/**
 * EXAMPLE content (chapter 00 status EXAMPLE, chapter 04 §2 kit table).
 * Names, levels and numbers illustrate the contracts and drive tests. They are drafts,
 * not an approved monster catalog, and their loot tables intentionally fail the 50–100
 * candidate validator: we do not invent 50 placeholder items to pass it (chapter 13 §2).
 */
import { EXAMPLE_EQUIPMENT } from "./equipment";
import type {
  Element,
  ItemDefinition,
  LootTable,
  SigilDefinition,
  SkillDefinition,
  SpeciesDefinition,
} from "../schemas";

const meta = { version: 1, status: "draft", example: true } as const;

export const EXAMPLE_SKILLS: SkillDefinition[] = [
  // Armor crab (ปูเกราะ)
  skill("skill:crab_take_hit", "รับแทน1ครั้ง", "passive"),
  skill("skill:crab_self_shield", "โล่ตน", "passive"),
  dmg("skill:crab_shield_bash", "ใช้โล่บางส่วนโจมตี", "physical", 1.3, 0, "EARTH", "melee", 6, 0),
  skill("skill:crab_innate_mp_refund", "รับแทนสำเร็จลดMPครั้งหน้า", "passive"),
  // Ember fox (จิ้งจอกสะเก็ด)
  dmg("skill:fox_mark_bite", "กัดติดmark", "physical", 1.2, 0, "FIRE", "melee", 4, 0),
  dmg("skill:fox_light_volley", "หมู่เบา", "physical", 0.9, 5, "FIRE", "ranged", 5, 0),
  dmg("skill:fox_consume_mark", "กินmarkโจมตีหนัก", "physical", 1.6, 0, "FIRE", "melee", 10, 2),
  skill("skill:fox_innate_kill_heal", "กำจัดเป้าหมายmarkแล้วฮีลเล็ก", "passive"),
  // Lantern snail (หอยตะเกียง)
  heal("skill:snail_single_heal", "ฮีลเดี่ยว", 1.2, 20, 8),
  dmg("skill:snail_glare", "ส่องลดหลบ", "magic", 0.8, 0, "WATER", "ranged", 5, 0),
  skill("skill:snail_ally_shield", "โล่เพื่อน", "passive"),
  skill("skill:snail_innate_mp_return", "โล่หมดอายุคืนMP", "passive"),
  // Supply mole (ตุ่นเสบียง), chapter 04 §2 kit; Lv2 near the town gate
  heal("skill:mole_light_heal", "ฮีลเบา", 0.8, 10, 6),
  skill("skill:mole_cost_cut", "ลดต้นทุนสกิลถัดไปเพื่อน", "passive"),
  dmg("skill:mole_weakening_hit", "โจมตีลดATK", "physical", 1.1, 0, "EARTH", "melee", 4, 0),
  skill("skill:mole_innate_mp_refund", "basicสำเร็จคืนMPเล็ก", "passive"),
  // Bell bird (นกกระดิ่ง), chapter 04 §2 kit; Lv3
  skill("skill:bird_haste", "SPDรอบหน้า", "passive"),
  skill("skill:bird_cleanse", "cleanse1ชนิด", "passive"),
  dmg("skill:bird_back_peck", "โจมตีหลัง", "physical", 1.0, 0, "WIND", "ranged", 4, 0),
  skill("skill:bird_innate_resist", "cleanseครั้งแรกให้resist", "passive"),
  // Player prototype skill
  dmg("skill:player_power_strike", "ฟันแรง", "physical", 1.6, 0, "NEUTRAL", "melee", 8, 0),
];

export const EXAMPLE_SPECIES: SpeciesDefinition[] = [
  species("species:armor_crab", "ปูเกราะ", 6, "tank", ["EARTH", "WATER"], [
    "skill:crab_take_hit",
    "skill:crab_self_shield",
    "skill:crab_shield_bash",
  ], "skill:crab_innate_mp_refund", 0.25, { STR: 14, VIT: 20, INT: 8, DEX: 10, AGI: 8, SPI: 10 }, "melee"),
  species("species:ember_fox", "จิ้งจอกสะเก็ด", 8, "physical", ["FIRE", "WIND", "SHADOW"], [
    "skill:fox_mark_bite",
    "skill:fox_light_volley",
    "skill:fox_consume_mark",
  ], "skill:fox_innate_kill_heal", 0.2, { STR: 20, VIT: 12, INT: 8, DEX: 16, AGI: 18, SPI: 8 }, "melee"),
  species("species:lantern_snail", "หอยตะเกียง", 5, "support", ["WATER", "LIGHT"], [
    "skill:snail_single_heal",
    "skill:snail_glare",
    "skill:snail_ally_shield",
  ], "skill:snail_innate_mp_return", 0.3, { STR: 8, VIT: 14, INT: 12, DEX: 10, AGI: 6, SPI: 20 }, "ranged"),
  // Starter-field species so a new Lv1 character has something it can beat (EXAMPLE levels).
  species("species:supply_mole", "ตุ่นเสบียง", 2, "support", ["EARTH", "WATER"], [
    "skill:mole_light_heal",
    "skill:mole_cost_cut",
    "skill:mole_weakening_hit",
  ], "skill:mole_innate_mp_refund", 0.35, { STR: 7, VIT: 8, INT: 6, DEX: 7, AGI: 6, SPI: 9 }, "melee"),
  species("species:bell_bird", "นกกระดิ่ง", 3, "control", ["WIND", "LIGHT"], [
    "skill:bird_haste",
    "skill:bird_cleanse",
    "skill:bird_back_peck",
  ], "skill:bird_innate_resist", 0.3, { STR: 8, VIT: 7, INT: 8, DEX: 10, AGI: 12, SPI: 8 }, "ranged"),
];

export const EXAMPLE_SIGILS: SigilDefinition[] = [
  sigil("sigil:armor_crab", "species:armor_crab", ["SHIELD"], 0.0005),
  sigil("sigil:ember_fox", "species:ember_fox", ["WEAPON_PHYSICAL"], 0.0002),
  sigil("sigil:lantern_snail", "species:lantern_snail", ["WEAPON_SUPPORT"], 0.0001),
  sigil("sigil:supply_mole", "species:supply_mole", ["FEET"], 0.0005),
  sigil("sigil:bell_bird", "species:bell_bird", ["BACK"], 0.0005),
];

export const EXAMPLE_ITEMS: ItemDefinition[] = [
  { id: "item:small_potion", ...meta, name: { th: "ยาเล็ก", en: "Small Potion" }, kind: "heal", healHp: 150, vendorPrice: 10 },
  { id: "item:phoenix_feather", ...meta, name: { th: "ขนนกชุบ" }, kind: "revive", vendorPrice: 200 },
  ...EXAMPLE_SPECIES.map(
    (s): ItemDefinition => ({
      id: s.captureItemId as ItemDefinition["id"],
      ...meta,
      name: { th: `เครื่องจับ${s.name.th}` },
      kind: "capture",
      captureSpeciesId: s.id,
      captureQuality: 1,
      vendorPrice: 0,
    }),
  ),
  ...EXAMPLE_SIGILS.map(
    (s): ItemDefinition => ({ id: `item:${s.id.slice("sigil:".length)}_sigil`, ...meta, name: { th: `ตรา${s.id}` }, kind: "sigil", vendorPrice: 0 }),
  ),
  { id: "item:crab_shell", ...meta, name: { th: "กระดองปู" }, kind: "material", vendorPrice: 5 },
  { id: "item:fox_tail_ash", ...meta, name: { th: "เถ้าหางจิ้งจอก" }, kind: "material", vendorPrice: 6 },
  { id: "item:snail_glow_slime", ...meta, name: { th: "เมือกเรืองแสง" }, kind: "material", vendorPrice: 4 },
  { id: "item:mole_fur", ...meta, name: { th: "ขนตุ่น" }, kind: "material", vendorPrice: 2 },
  { id: "item:bell_feather", ...meta, name: { th: "ขนนกกระดิ่ง" }, kind: "material", vendorPrice: 3 },
  { id: "item:river_pebble", ...meta, name: { th: "กรวดริมน้ำ" }, kind: "material", vendorPrice: 1 },
];

const SPECIES_GEAR = {
  "species:armor_crab": "equip:crab_buckler",
  "species:ember_fox": "equip:ember_fang_dagger",
  "species:lantern_snail": "equip:glow_charm",
  "species:supply_mole": "equip:mole_sandals",
  "species:bell_bird": "equip:bell_feather_cap",
} as const;

export const EXAMPLE_LOOT_TABLES: LootTable[] = EXAMPLE_SPECIES.map((s) => {
  const sg = EXAMPLE_SIGILS.find((g) => g.sourceSpeciesId === s.id)!;
  const own = {
    "species:armor_crab": "item:crab_shell",
    "species:ember_fox": "item:fox_tail_ash",
    "species:lantern_snail": "item:snail_glow_slime",
    "species:supply_mole": "item:mole_fur",
    "species:bell_bird": "item:bell_feather",
  }[
    s.id as "species:armor_crab"
  ] as LootTable["pools"][number]["entries"][number]["itemId"];
  return {
    id: s.lootTableId,
    ...meta,
    speciesId: s.id,
    sigilRoll: { sigilId: sg.id, itemId: `item:${sg.id.slice("sigil:".length)}_sigil`, probability: sg.baseDropProbability },
    emptySlotWeight: 60,
    pools: [
      { id: "species", weight: 25, entries: [{ itemId: own, weight: 1, minQty: 1, maxQty: 2 }] },
      { id: "region", weight: 15, entries: [{ itemId: "item:river_pebble", weight: 1, minQty: 1, maxQty: 3 }] },
      // Each species drops one piece of EXAMPLE equipment, rarely (chapter 06 numbers are not set).
      { id: "gear", weight: 4, entries: [{ itemId: SPECIES_GEAR[s.id as keyof typeof SPECIES_GEAR], weight: 1, minQty: 1, maxQty: 1 }] },
    ],
    maxTypesPerEnemy: 5,
  };
});

// ---------------------------------------------------------------- helpers

function skill(id: string, th: string, kind: "passive"): SkillDefinition {
  return { id, ...meta, name: { th }, kind, ownerKind: "companion", targetRule: "none", range: "melee", mpCost: 0, cooldown: 0, effectSequence: [], tags: [] };
}

function dmg(
  id: string,
  th: string,
  damageType: "physical" | "magic",
  coefficient: number,
  flat: number,
  element: Element,
  range: "melee" | "ranged",
  mpCost: number,
  cooldown: number,
): SkillDefinition {
  return {
    id,
    ...meta,
    name: { th },
    kind: "active",
    ownerKind: id.startsWith("skill:player") ? "player" : "companion",
    targetRule: "single_enemy",
    range,
    mpCost,
    cooldown,
    effectSequence: [{ kind: "damage", damageType, coefficient, flat, element }],
    tags: [],
  };
}

function heal(id: string, th: string, coefficient: number, flat: number, mpCost: number): SkillDefinition {
  return {
    id,
    ...meta,
    name: { th },
    kind: "active",
    ownerKind: "companion",
    targetRule: "single_ally",
    range: "ranged",
    mpCost,
    cooldown: 0,
    effectSequence: [{ kind: "heal", coefficient, flat }],
    tags: [],
  };
}

function species(
  id: string,
  th: string,
  fixedWildLevel: number,
  archetype: SpeciesDefinition["archetype"],
  allowedElements: SpeciesDefinition["allowedElements"],
  skillIds: string[],
  innatePassiveId: string,
  captureBaseRate: number,
  wildPrimaryStats: SpeciesDefinition["wildPrimaryStats"],
  basicAttackRange: "melee" | "ranged",
): SpeciesDefinition {
  const slug = id.slice("species:".length);
  return {
    id,
    ...meta,
    name: { th },
    fixedWildLevel,
    rank: "NORMAL",
    archetype,
    allowedElements,
    skillIds,
    innatePassiveId,
    captureItemId: `item:${slug}_capture`,
    captureBaseRate,
    lootTableId: `loot:${slug}`,
    sigilId: `sigil:${slug}`,
    petEquipmentPoolId: `petgear:${slug}`,
    artId: `art:${slug}`,
    wildPrimaryStats,
    basicAttackRange,
  };
}

function sigil(id: string, sourceSpeciesId: string, equipGroups: SigilDefinition["equipGroups"], p: number): SigilDefinition {
  return {
    id,
    ...meta,
    name: { th: `ตรา${id}` },
    sourceSpeciesId,
    equipGroups,
    effectIds: [`effect:${id.slice("sigil:".length)}`],
    stackingGroup: id,
    scope: equipGroups.some((g) => g.startsWith("WEAPON")) ? "weapon_local" : "global",
    baseDropProbability: p,
  };
}

export function exampleContentMaps() {
  return {
    species: new Map(EXAMPLE_SPECIES.map((s) => [s.id, s])),
    skills: new Map(EXAMPLE_SKILLS.map((s) => [s.id, s])),
    items: new Map(EXAMPLE_ITEMS.map((s) => [s.id, s])),
    lootTables: new Map(EXAMPLE_LOOT_TABLES.map((s) => [s.id, s])),
    sigils: new Map(EXAMPLE_SIGILS.map((s) => [s.id, s])),
    equipment: new Map(EXAMPLE_EQUIPMENT.map((s) => [s.id, s])),
  };
}
