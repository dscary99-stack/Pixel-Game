/**
 * EXAMPLE content (chapter 00 status EXAMPLE, chapter 04 §2 kit table).
 * Names, levels and numbers illustrate the contracts and drive tests. They are drafts,
 * not an approved monster catalog, and their loot tables intentionally fail the 50–100
 * candidate validator: we do not invent 50 placeholder items to pass it (chapter 13 §2).
 */
import type { z } from "zod";
import { EXAMPLE_AFFIX_POOLS, EXAMPLE_EQUIPMENT } from "./equipment";
import { EXAMPLE_REFINE_ITEMS } from "./refine";
import { PassiveSchema, type PassiveTriggerSchema } from "../schemas";
import type {
  BossDefinition,
  Element,
  ItemDefinition,
  LootTable,
  SigilDefinition,
  DamageEffect,
  SkillDefinition,
  SkillLevelStep,
  StatusApplication,
  SpeciesDefinition,
} from "../schemas";

const meta = { version: 1, status: "draft", example: true } as const;

export const EXAMPLE_SKILLS: SkillDefinition[] = [
  // Armor crab (ปูเกราะ)
  support("skill:crab_take_hit", "รับแทน", 5, { statusId: "protect", chancePct: 100, turns: 2 }, "single_ally", 4),
  support("skill:crab_self_shield", "โล่ตน", 5, { statusId: "shield", chancePct: 100, turns: 2, shieldPct: 20 }, "self", 3),
  dmg("skill:crab_shield_bash", "ใช้โล่บางส่วนโจมตี", "physical", 1.3, 0, "EARTH", "melee", 6, 3, { statuses: [{ statusId: "stun", chancePct: 20, turns: 1 }] }),
  innate("skill:crab_innate_mp_refund", "รับแทนสำเร็จคืนMP", [{ on: "protected_ally", then: [{ kind: "restore_mp", target: "self", amount: 3 }] }]),
  // Ember fox (จิ้งจอกสะเก็ด)
  dmg("skill:fox_mark_bite", "กัดติดmark", "physical", 1.2, 0, "FIRE", "melee", 4, 2, { statuses: [{ statusId: "mark", chancePct: 80, turns: 2 }, { statusId: "bleed", chancePct: 35, turns: 3 }] }),
  // EXAMPLE level tables (each skill grows its own way, chapter 04 §5): the volley spreads to more targets.
  steps(dmg("skill:fox_light_volley", "หมู่เบา", "physical", 0.9, 5, "FIRE", "ranged", 5, 3, { statuses: [{ statusId: "burn", chancePct: 30, turns: 2 }] }), [
    ["power", 5], ["power", 5], ["power", 5], ["extra_targets", 1], ["power", 5], ["power", 5], ["mp_cost", -1], ["extra_targets", 1], ["power", 10],
  ]),
  steps(dmg("skill:fox_consume_mark", "กินmarkโจมตีหนัก", "physical", 1.6, 0, "FIRE", "melee", 10, 3, { bonusVsStatus: { statusId: "mark", bonusPct: 50, consume: true } }), [
    ["power", 6], ["power", 6], ["mp_cost", -2], ["power", 6], ["power", 6], ["cooldown", -1], ["power", 6], ["power", 6], ["power", 10],
  ]),
  innate("skill:fox_innate_kill_heal", "กำจัดเป้าหมายmarkแล้วฮีลเล็ก", [{ on: "kill", otherHas: "mark", then: [{ kind: "heal", target: "self", pctMaxHp: 8 }] }]),
  // Lantern snail (หอยตะเกียง)
  steps(heal("skill:snail_single_heal", "ฮีลเดี่ยว", 1.2, 20, 8, 3), [
    ["power", 5], ["power", 5], ["mp_cost", -2], ["power", 5], ["power", 5], ["power", 5], ["extra_targets", 1], ["power", 5], ["mp_cost", -2],
  ]),
  dmg("skill:snail_glare", "ส่องลดหลบ", "magic", 0.8, 0, "WATER", "ranged", 5, 2, { statuses: [{ statusId: "evasion_down", chancePct: 70, turns: 2 }] }),
  support("skill:snail_ally_shield", "โล่เพื่อน", 6, { statusId: "shield", chancePct: 100, turns: 2, shieldPct: 18 }, "single_ally", 3),
  innate("skill:snail_innate_mp_return", "โล่หมดอายุคืนMP", [{ on: "shield_expired", then: [{ kind: "restore_mp", target: "self", amount: 4 }] }]),
  // Supply mole (ตุ่นเสบียง), chapter 04 §2 kit; Lv2 near the town gate
  heal("skill:mole_light_heal", "ฮีลเบา", 0.8, 10, 6, 2),
  skill("skill:mole_cost_cut", "ลดต้นทุนสกิลถัดไปเพื่อน", "passive"),
  dmg("skill:mole_weakening_hit", "โจมตีลดATK", "physical", 1.1, 0, "EARTH", "melee", 4, 2, { statuses: [{ statusId: "atk_down", chancePct: 60, turns: 2 }] }),
  innate("skill:mole_innate_mp_refund", "basicสำเร็จคืนMPเล็ก", [{ on: "dealt_damage", action: "attack", then: [{ kind: "restore_mp", target: "self", amount: 1 }] }]),
  // Bell bird (นกกระดิ่ง), chapter 04 §2 kit; Lv3
  support("skill:bird_haste", "เร่งเพื่อน", 4, { statusId: "spd_up", chancePct: 100, turns: 2 }, "single_ally", 4),
  support("skill:bird_cleanse", "ล้างสถานะ1ชนิด", 5, { statusId: "cleanse", chancePct: 100, turns: 1 }, "single_ally", 4),
  dmg("skill:bird_back_peck", "โจมตีหลัง", "physical", 1.0, 0, "WIND", "ranged", 4, 0),
  innate("skill:bird_innate_resist", "cleanseครั้งแรกให้ต้านสถานะ", [{ on: "used_skill", skillApplies: "cleanse", oncePerBattle: true, then: [{ kind: "status", target: "other", statuses: [{ statusId: "res_up", chancePct: 100, turns: 2 }] }] }]),
  // Rebirth variants (chapter 04 §7, EXAMPLE): same role, played differently. Crab follows chapter 04's example.
  variant(support("skill:crab_shield_thick", "โล่หนา (โล่มาก ใช้MPสูง)", 9, { statusId: "shield", chancePct: 100, turns: 2, shieldPct: 35 }, "self", 4), "skill:crab_self_shield"),
  variant(support("skill:crab_shield_shared", "โล่บางแชร์ (โล่บางให้ทั้งทีม)", 8, { statusId: "shield", chancePct: 100, turns: 2, shieldPct: 10 }, "all_allies", 5), "skill:crab_self_shield"),
  variant(innate("skill:crab_innate_mp_surge", "รับแทนสำเร็จคืนMPมากขึ้น", [{ on: "protected_ally", then: [{ kind: "restore_mp", target: "self", amount: 6 }] }]), "skill:crab_innate_mp_refund"),
  variant(innate("skill:crab_innate_small_heal", "รับแทนสำเร็จฮีลเล็กแทน", [{ on: "protected_ally", then: [{ kind: "heal", target: "self", pctMaxHp: 4 }] }]), "skill:crab_innate_mp_refund"),
  variant(dmg("skill:crab_pierce_bash", "กระแทกเจาะเกราะ", "physical", 1.3, 0, "EARTH", "melee", 6, 3, { penetrationPct: 30 }), "skill:crab_shield_bash"),
  variant(dmg("skill:crab_light_bash", "กระแทกประหยัดโล่", "physical", 1.15, 0, "EARTH", "melee", 3, 2), "skill:crab_shield_bash"),
  variant(dmg("skill:fox_blood_bite", "กัดดูดเลือด", "physical", 1.1, 0, "FIRE", "melee", 4, 2, { lifestealPct: 30 }), "skill:fox_mark_bite"),
  variant(dmg("skill:fox_keen_bite", "กัดแม่นคม", "physical", 1.15, 0, "FIRE", "melee", 4, 2, { accuracyBonusPct: 15, critBonusPct: 15 }), "skill:fox_mark_bite"),
  variant(innate("skill:fox_innate_kill_haste", "กำจัดเป้าหมายmarkแล้วเร็วขึ้น", [{ on: "kill", otherHas: "mark", then: [{ kind: "status", target: "self", statuses: [{ statusId: "spd_up", chancePct: 100, turns: 2 }] }] }]), "skill:fox_innate_kill_heal"),
  variant(innate("skill:fox_innate_kill_mp", "กำจัดเป้าหมายmarkแล้วคืนMP", [{ on: "kill", otherHas: "mark", then: [{ kind: "restore_mp", target: "self", amount: 8 }] }]), "skill:fox_innate_kill_heal"),
  variant(dmg("skill:fox_final_blaze", "ปิดฉากเพลิง", "physical", 1.5, 0, "FIRE", "melee", 10, 4, { execute: { belowHpPct: 35, bonusPct: 60 } }), "skill:fox_consume_mark"),
  variant(dmg("skill:fox_reckless_dash", "พุ่งเสี่ยงตาย", "physical", 2.2, 0, "FIRE", "melee", 10, 4, { recoilPct: 20 }), "skill:fox_consume_mark"),
  // Crystal crab lord (เจ้ากระดองผลึก), the field boss of chapter 07 §5's example
  dmg("skill:lord_crystal_claw", "ก้ามผลึก", "physical", 1.4, 0, "WATER", "melee", 6, 2, { statuses: [{ statusId: "def_down", chancePct: 40, turns: 2 }] }),
  // Its telegraphed move: hits every unit, so the answer is guard, shields or breaking the shell first.
  { ...dmg("skill:lord_shockwave", "คลื่นกระแทก", "physical", 1.5, 0, "WATER", "ranged", 12, 0), targetRule: "all_enemies" },
  support("skill:lord_crystal_shell", "เกราะผลึก", 10, { statusId: "shield", chancePct: 100, turns: 2, shieldPct: 15 }, "self", 4),
  innate("skill:lord_innate_last_stand", "กระดองสุดท้าย", [{ on: "hp_below", hpBelowPct: 50, oncePerBattle: true, then: [{ kind: "status", target: "self", statuses: [{ statusId: "def_up", chancePct: 100, turns: 2 }] }] }]),
  // Player prototype skill
  dmg("skill:player_power_strike", "ฟันแรง", "physical", 1.6, 0, "NEUTRAL", "melee", 8, 3),
  // Revive example (O15, Nut 2026-10-07): a fallen ally back with 25% HP, from the round after it fell.
  {
    id: "skill:player_rally",
    ...meta,
    name: { th: "ปลุกขวัญ" },
    kind: "active",
    ownerKind: "player",
    targetRule: "single_ally",
    range: "ranged",
    mpCost: 12,
    cooldown: 5,
    effectSequence: [{ kind: "revive", hpPct: 25 }],
    tags: [],
  },
  // Area example (Nut 2026-10-04): hits the whole row of the chosen enemy, each with its own roll.
  { ...dmg("skill:player_sweep", "กวาดแถว", "physical", 0.7, 0, "NEUTRAL", "melee", 10, 4), targetRule: "enemy_row" },
];

export const EXAMPLE_SPECIES: SpeciesDefinition[] = [
  species("species:armor_crab", "ปูเกราะ", 6, "tank", ["EARTH", "WATER"], [
    "skill:crab_take_hit",
    "skill:crab_self_shield",
    "skill:crab_shield_bash",
  ], "skill:crab_innate_mp_refund", 0.25, { STR: 14, VIT: 20, INT: 8, DEX: 10, AGI: 8, SPI: 10 }, "melee", {
    rebirthVariants: [
      rv(1, "skill:crab_self_shield", "skill:crab_shield_thick", "skill:crab_shield_shared"),
      rv(2, "skill:crab_innate_mp_refund", "skill:crab_innate_mp_surge", "skill:crab_innate_small_heal"),
      rv(3, "skill:crab_shield_bash", "skill:crab_pierce_bash", "skill:crab_light_bash"),
    ],
    rebirthCosmetic: { id: "cosmetic:crab_r3", name: { th: "กระดองคลื่นน้ำ" }, effect: "ripple", color: "#5fb3ff" },
  }),
  species("species:ember_fox", "จิ้งจอกสะเก็ด", 8, "physical", ["FIRE", "WIND", "SHADOW"], [
    "skill:fox_mark_bite",
    "skill:fox_light_volley",
    "skill:fox_consume_mark",
  ], "skill:fox_innate_kill_heal", 0.2, { STR: 20, VIT: 12, INT: 8, DEX: 16, AGI: 18, SPI: 8 }, "melee", {
    rebirthVariants: [
      rv(1, "skill:fox_mark_bite", "skill:fox_blood_bite", "skill:fox_keen_bite"),
      rv(2, "skill:fox_innate_kill_heal", "skill:fox_innate_kill_haste", "skill:fox_innate_kill_mp"),
      rv(3, "skill:fox_consume_mark", "skill:fox_final_blaze", "skill:fox_reckless_dash"),
    ],
    rebirthCosmetic: { id: "cosmetic:fox_r3", name: { th: "หางเปลวเพลิง" }, effect: "flame", color: "#ff7a3d" },
  }),
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
  // Field boss (chapter 07 §5 example). Two actions a round while wild; a captured one acts once.
  species("species:crystal_crab_lord", "เจ้ากระดองผลึก", 8, "tank", ["WATER", "EARTH"], [
    "skill:lord_crystal_claw",
    "skill:lord_shockwave",
    "skill:lord_crystal_shell",
  ], "skill:lord_innate_last_stand", 0.1, { STR: 18, VIT: 24, INT: 8, DEX: 12, AGI: 10, SPI: 12 }, "melee", { rank: "BOSS", bossActionsPerRound: 2 }),
];

/**
 * EXAMPLE boss (chapter 07 §5): the crystal crab lord with two lantern snails that re-shield it.
 * Phase 1 teaches the pattern (a crystal shell, a shockwave warned a round ahead); breaking the shell
 * or getting it under half HP starts phase 2, where it takes more damage, hits harder, warns more
 * often and can be captured below 30% HP. Numbers are Claude's first pass.
 */
export const EXAMPLE_BOSSES: BossDefinition[] = [
  {
    id: "boss:crystal_crab_lord",
    ...meta,
    name: { th: "เจ้ากระดองผลึก" },
    speciesId: "species:crystal_crab_lord",
    element: "WATER",
    hpMultiplier: 4,
    adds: [
      { speciesId: "species:lantern_snail", element: "WATER", row: "back", lootEligible: true },
      { speciesId: "species:lantern_snail", element: "LIGHT", row: "back", lootEligible: true },
    ],
    phases: [
      {
        id: "shell",
        name: { th: "กระดองผลึก" },
        enterWhen: [],
        onEnter: [{ statusId: "shield", chancePct: 100, turns: 10, shieldPct: 30 }],
        removeStatuses: [],
        telegraph: { skillId: "skill:lord_shockwave", everyRounds: 3, hint: { th: "ป้องกันหรือใส่โล่ไว้ก่อนรอบหน้า หรือทุบกระดองให้แตกเพื่อยกเลิก" } },
      },
      {
        id: "broken",
        name: { th: "กระดองแตก" },
        enterWhen: [{ kind: "shield_broken" }, { kind: "hp_below", pct: 50 }],
        onEnter: [
          { statusId: "vulnerable", chancePct: 100, turns: 10 },
          { statusId: "atk_up", chancePct: 100, turns: 10 },
        ],
        removeStatuses: ["shield"],
        telegraph: { skillId: "skill:lord_shockwave", everyRounds: 2, hint: { th: "ป้องกันหรือใส่โล่ไว้ก่อนรอบหน้า" } },
        captureBelowHpPct: 30,
      },
    ],
  },
];

/**
 * EXAMPLE tower guardians (หอคอยรอยแยก, frontier.ts): boss floors take these in turn. The crab lord is the
 * only BOSS species so far, so both are it with other adds and its phases; they drop from their own
 * table, where the rift core and the crystal plate are rare (under 1%, Nut 2026-10-04). Claude's first pass.
 */
export const EXAMPLE_FRONTIER_BOSSES: BossDefinition[] = [
  {
    id: "boss:rift_spire_warden",
    ...meta,
    name: { th: "ผู้เฝ้าหอรอยแยก" },
    speciesId: "species:crystal_crab_lord",
    element: "EARTH",
    hpMultiplier: 4,
    adds: [
      { speciesId: "species:armor_crab", element: "EARTH", row: "front", lootEligible: true },
      { speciesId: "species:lantern_snail", element: "WATER", row: "back", lootEligible: true },
    ],
    phases: EXAMPLE_BOSSES[0]!.phases,
    lootTableId: "loot:rift_spire_guardian",
  },
  {
    id: "boss:rift_spire_tyrant",
    ...meta,
    name: { th: "ทรราชหอรอยแยก" },
    speciesId: "species:crystal_crab_lord",
    element: "WATER",
    hpMultiplier: 5,
    adds: [
      { speciesId: "species:ember_fox", element: "FIRE", row: "front", lootEligible: true },
      { speciesId: "species:armor_crab", element: "WATER", row: "front", lootEligible: true },
      { speciesId: "species:bell_bird", element: "WIND", row: "back", lootEligible: true },
      { speciesId: "species:lantern_snail", element: "LIGHT", row: "back", lootEligible: true },
    ],
    phases: EXAMPLE_BOSSES[0]!.phases,
    lootTableId: "loot:rift_spire_guardian",
  },
];

// Effects follow chapter 05 §5's ideas (EXAMPLE numbers). Each Sigil also names the piece it is in.
export const EXAMPLE_SIGILS: SigilDefinition[] = [
  sigil("sigil:armor_crab", "species:armor_crab", ["SHIELD"], 0.0005, "กระดอง", { modifiers: [{ kind: "guard_reduction", reductionPct: 10 }] }),
  sigil("sigil:ember_fox", "species:ember_fox", ["WEAPON_PHYSICAL"], 0.0002, "เพลิงจิ้งจอก", { modifiers: [{ kind: "damage_vs_status", statusId: "burn", bonusPct: 10 }] }),
  sigil("sigil:lantern_snail", "species:lantern_snail", ["WEAPON_SUPPORT"], 0.0001, "แสงตะเกียง", { modifiers: [{ kind: "heal_low_hp", belowHpPct: 40, bonusPct: 15 }] }),
  sigil("sigil:supply_mole", "species:supply_mole", ["ACCESSORY"], 0.0005, "เสบียง", { triggers: [{ on: "dealt_damage", action: "attack", then: [{ kind: "restore_mp", target: "self", amount: 1 }] }] }),
  sigil("sigil:crystal_crab_lord", "species:crystal_crab_lord", ["SHIELD"], 0.0005, "ผลึก", { modifiers: [{ kind: "guard_reduction", reductionPct: 15 }] }),
  sigil("sigil:bell_bird", "species:bell_bird", ["BACK"], 0.0005, "กระดิ่งลม", { triggers: [{ on: "battle_start", then: [{ kind: "status", target: "self", statuses: [{ statusId: "spd_up", chancePct: 100, turns: 1 }] }] }] }),
];

export const EXAMPLE_ITEMS: ItemDefinition[] = [
  { id: "item:small_potion", ...meta, name: { th: "ยาเล็ก", en: "Small Potion" }, kind: "heal", healHp: 150, vendorPrice: 10 },
  { id: "item:phoenix_feather", ...meta, name: { th: "ขนนกชุบ" }, kind: "revive", reviveHpPct: 30, vendorPrice: 200 },
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
    (s): ItemDefinition => ({ id: `item:${s.id.slice("sigil:".length)}_sigil`, ...meta, name: s.name, kind: "sigil", sigilId: s.id, vendorPrice: 0 }),
  ),
  { id: "item:crab_shell", ...meta, name: { th: "กระดองปู" }, kind: "material", vendorPrice: 5 },
  { id: "item:fox_tail_ash", ...meta, name: { th: "เถ้าหางจิ้งจอก" }, kind: "material", vendorPrice: 6 },
  { id: "item:snail_glow_slime", ...meta, name: { th: "เมือกเรืองแสง" }, kind: "material", vendorPrice: 4 },
  { id: "item:mole_fur", ...meta, name: { th: "ขนตุ่น" }, kind: "material", vendorPrice: 2 },
  { id: "item:bell_feather", ...meta, name: { th: "ขนนกกระดิ่ง" }, kind: "material", vendorPrice: 3 },
  { id: "item:crystal_shard", ...meta, name: { th: "เศษกระดองผลึก" }, kind: "material", vendorPrice: 15 },
  { id: "item:river_pebble", ...meta, name: { th: "กรวดริมน้ำ" }, kind: "material", vendorPrice: 1 },
  // Tower guardians' rare material (frontier.ts, EXAMPLE).
  { id: "item:rift_core", ...meta, name: { th: "แกนรอยแยก" }, kind: "material", vendorPrice: 120 },
  // Refining: stones, wards and ward materials (content/refine.ts).
  ...EXAMPLE_REFINE_ITEMS,
];

const SPECIES_GEAR = {
  "species:armor_crab": "equip:crab_buckler",
  "species:ember_fox": "equip:ember_fang_dagger",
  "species:lantern_snail": "equip:glow_charm",
  "species:supply_mole": "equip:mole_sandals",
  "species:bell_bird": "equip:bell_feather_cap",
  "species:crystal_crab_lord": "equip:crystal_shell_plate",
} as const;

export const EXAMPLE_LOOT_TABLES: LootTable[] = EXAMPLE_SPECIES.map((s) => {
  const sg = EXAMPLE_SIGILS.find((g) => g.sourceSpeciesId === s.id)!;
  const own = {
    "species:armor_crab": "item:crab_shell",
    "species:ember_fox": "item:fox_tail_ash",
    "species:lantern_snail": "item:snail_glow_slime",
    "species:supply_mole": "item:mole_fur",
    "species:bell_bird": "item:bell_feather",
    "species:crystal_crab_lord": "item:crystal_shard",
  }[
    s.id as "species:armor_crab"
  ] as LootTable["pools"][number]["entries"][number]["itemId"];
  return {
    id: s.lootTableId,
    ...meta,
    speciesId: s.id,
    sigilRoll: { sigilId: sg.id, itemId: `item:${sg.id.slice("sigil:".length)}_sigil`, probability: sg.baseDropProbability },
    emptySlotWeight: 600,
    pools: [
      { id: "species", weight: 250, entries: [{ itemId: own, weight: 1, minQty: 1, maxQty: 2 }] },
      { id: "region", weight: 150, entries: [{ itemId: "item:river_pebble", weight: 1, minQty: 1, maxQty: 3 }] },
      // Each species drops one piece of EXAMPLE equipment, rarely: about 0.5% a kill, under Nut's
      // 1% rare line (2026-10-04). Chapter 06 numbers are not set.
      { id: "gear", weight: 1, entries: [{ itemId: SPECIES_GEAR[s.id as keyof typeof SPECIES_GEAR], weight: 1, minQty: 1, maxQty: 1 }] },
    ],
    maxTypesPerEnemy: 5,
  };
});

/**
 * EXAMPLE loot of the tower guardians: crystal shards and pebbles often, and in a small pool the rift
 * core (about 0.9% a clear) and the crystal plate (about 0.3%), both rare by Nut's under-1% line.
 */
export const EXAMPLE_FRONTIER_LOOT_TABLES: LootTable[] = [
  {
    id: "loot:rift_spire_guardian",
    ...meta,
    speciesId: "species:crystal_crab_lord",
    sigilRoll: { sigilId: "sigil:crystal_crab_lord", itemId: "item:crystal_crab_lord_sigil", probability: 0.0005 },
    emptySlotWeight: 300,
    pools: [
      { id: "guardian", weight: 400, entries: [{ itemId: "item:crystal_shard", weight: 1, minQty: 1, maxQty: 3 }] },
      { id: "region", weight: 150, entries: [{ itemId: "item:river_pebble", weight: 1, minQty: 2, maxQty: 4 }] },
      {
        id: "rare",
        weight: 2,
        entries: [
          { itemId: "item:rift_core", weight: 3, minQty: 1, maxQty: 1 },
          { itemId: "equip:crystal_shell_plate", weight: 1, minQty: 1, maxQty: 1 },
        ],
      },
    ],
    maxTypesPerEnemy: 5,
  },
];

// ---------------------------------------------------------------- helpers

/** Level 2–10 steps in order, one per level. */
function steps(s: SkillDefinition, list: [SkillLevelStep["kind"], number][]): SkillDefinition {
  return { ...s, levelSteps: list.map(([kind, value], i) => ({ atLevel: i + 2, kind, value })) };
}

/** A passive with effects (catalog §4, EXAMPLE numbers). Defaults filled by the schema. */
function innate(id: string, th: string, triggers: z.input<typeof PassiveTriggerSchema>[]): SkillDefinition {
  return { ...skill(id, th, "passive"), passive: PassiveSchema.parse({ triggers }) };
}

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
  primitives: Partial<Omit<DamageEffect, "kind" | "damageType" | "coefficient" | "flat" | "element">> = {},
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
    effectSequence: [{ kind: "damage", damageType, coefficient, flat, element, ...primitives }],
    tags: [],
  };
}

/** A status-only skill on one ally (EXAMPLE): buffs, protect, cleanse. */
function support(id: string, th: string, mpCost: number, status: StatusApplication, targetRule: SkillDefinition["targetRule"] = "single_ally", cooldown = 0): SkillDefinition {
  return {
    id,
    ...meta,
    name: { th },
    kind: "active",
    ownerKind: "companion",
    targetRule,
    range: "ranged",
    mpCost,
    cooldown,
    effectSequence: [{ kind: "status", statuses: [status] }],
    tags: [],
  };
}

function heal(id: string, th: string, coefficient: number, flat: number, mpCost: number, cooldown = 0): SkillDefinition {
  return {
    id,
    ...meta,
    name: { th },
    kind: "active",
    ownerKind: "companion",
    targetRule: "single_ally",
    range: "ranged",
    mpCost,
    cooldown,
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
  extra: Partial<Pick<SpeciesDefinition, "rebirthVariants" | "rebirthCosmetic" | "rank" | "bossActionsPerRound">> = {},
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
    ...extra,
  };
}

function variant(s: SkillDefinition, of: string): SkillDefinition {
  return { ...s, variantOf: of };
}

function rv(stage: number, replaces: string, a: string, b: string): NonNullable<SpeciesDefinition["rebirthVariants"]>[number] {
  return { stage, replaces, options: [{ branch: "A", skillId: a }, { branch: "B", skillId: b }] };
}

function sigil(id: string, sourceSpeciesId: string, equipGroups: SigilDefinition["equipGroups"], p: number, prefix: string, effect: z.input<typeof PassiveSchema>): SigilDefinition {
  return {
    prefix: { th: prefix },
    effect: PassiveSchema.parse(effect),
    id,
    ...meta,
    name: { th: `ตรา${EXAMPLE_SPECIES.find((sp) => sp.id === sourceSpeciesId)?.name.th ?? id}` },
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
    lootTables: new Map([...EXAMPLE_LOOT_TABLES, ...EXAMPLE_FRONTIER_LOOT_TABLES].map((s) => [s.id, s])),
    sigils: new Map(EXAMPLE_SIGILS.map((s) => [s.id, s])),
    equipment: new Map(EXAMPLE_EQUIPMENT.map((s) => [s.id, s])),
    affixPools: new Map(EXAMPLE_AFFIX_POOLS.map((s) => [s.id, s])),
    bosses: new Map([...EXAMPLE_BOSSES, ...EXAMPLE_FRONTIER_BOSSES].map((s) => [s.id, s])),
  };
}
