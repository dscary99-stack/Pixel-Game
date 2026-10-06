/**
 * EXAMPLE secret quest templates and rewards (Nut 2026-10-05). One per player element, one per draft
 * race (P16) and a personal pool of 20.
 *
 * Nut 2026-10-06 (04:37Z): rewards can be every kind (unique title, unique fashion, a unique monster,
 * special gear) and the quests must be very hard so the reward is worth it. Generator v3 therefore
 * uses much bigger counts and conditions that must all hold together (`require`, e.g. solo + no items +
 * a round limit, or tower floor 80+ with a one-element team). Element quests give gear, race quests
 * give fashion plus a title, personal quests roll one kind (the hardest ones a unique monster or gear).
 * Goals, counts, conditions, texts and the reward pool are Claude's first pass: a draft to exercise the
 * contract, not approved endgame content.
 */
import type { SecretQuestTemplate, SecretRewardDefinition } from "../secret-quests";

const meta = { version: 1, status: "draft", example: true } as const;
type RewardSlot = SecretQuestTemplate["reward"];
const GEAR: RewardSlot = { kinds: ["gear"], pick: "all" };
const LOOK: RewardSlot = { kinds: ["fashion", "title"], pick: "all" };
const MARK: RewardSlot = { kinds: ["title", "fashion"], pick: "one" };
const PRIZE: RewardSlot = { kinds: ["companion", "gear"], pick: "one" };
const ANY: RewardSlot = { kinds: ["title", "fashion", "companion", "gear"], pick: "one" };

export const EXAMPLE_SECRET_QUEST_TEMPLATES: SecretQuestTemplate[] = [
  // Element: one per player element; the species is one that can carry that element. Reward: gear.
  { id: "sqt:element_fire", ...meta, kind: "element", element: "FIRE", goal: "defeat", text: { th: "เผาผลาญ {species} ธาตุไฟ {count} ตัว โดยไม่ใช้ไอเท็ม" }, slots: { element: "template", species: "of_element", count: [400, 600], require: ["no_items"] }, reward: GEAR },
  { id: "sqt:element_water", ...meta, kind: "element", element: "WATER", goal: "capture", text: { th: "เชื่อมใจ {species} ธาตุน้ำ {count} ตัว ตามลำพัง" }, slots: { element: "template", species: "of_element", count: [12, 20], require: ["solo"] }, reward: GEAR },
  { id: "sqt:element_earth", ...meta, kind: "element", element: "EARTH", goal: "defeat", text: { th: "ยืนหยัดต่อ {species} ธาตุดิน {count} ตัว ทีมเต็มและไม่มีใครล้ม" }, slots: { element: "template", species: "of_element", count: [300, 500], require: ["full_team", "no_knockout"] }, reward: GEAR },
  { id: "sqt:element_wind", ...meta, kind: "element", element: "WIND", goal: "win", text: { th: "ชนะ {count} ไฟต์ที่ {map} ด้วยทีมธาตุเดียว ภายใน {rounds} รอบ" }, slots: { element: "template", map: "field", count: [80, 150], require: ["mono_element_team", "within_rounds"], rounds: [3, 4] }, reward: GEAR },
  { id: "sqt:element_light", ...meta, kind: "element", element: "LIGHT", goal: "defeat", text: { th: "ส่องทาง {species} ธาตุแสง {count} ตัว โดยไม่ใช้ไอเท็มและไม่มีใครล้ม" }, slots: { element: "template", species: "of_element", count: [300, 500], require: ["no_items", "no_knockout"] }, reward: GEAR },
  { id: "sqt:element_shadow", ...meta, kind: "element", element: "SHADOW", goal: "defeat", text: { th: "ตามรอย {species} ธาตุมืด {count} ตัว ตามลำพังโดยไม่ใช้ไอเท็ม" }, slots: { element: "template", species: "of_element", count: [200, 350], require: ["solo", "no_items"] }, reward: GEAR },
  // Race: one per draft race. Reward: fashion plus a title.
  { id: "sqt:race_human", ...meta, kind: "race", raceId: "race:human", goal: "win", text: { th: "ชนะ {count} ไฟต์ด้วยทีมเต็ม โดยไม่มีใครล้ม" }, slots: { count: [300, 500], require: ["full_team", "no_knockout"] }, reward: LOOK },
  { id: "sqt:race_sylvan", ...meta, kind: "race", raceId: "race:sylvan", goal: "deliver", text: { th: "นำ {item} {count} ชิ้นคืนสู่ป่า" }, slots: { item: "material", count: [400, 800] }, reward: LOOK },
  { id: "sqt:race_stonekin", ...meta, kind: "race", raceId: "race:stonekin", goal: "boss", text: { th: "ทลาย {species} {count} ครั้ง โดยไม่มีใครล้มและไม่ใช้ไอเท็ม" }, slots: { species: "boss", count: [15, 25], require: ["no_knockout", "no_items"] }, reward: LOOK },
  { id: "sqt:race_wildkin", ...meta, kind: "race", raceId: "race:wildkin", goal: "capture", text: { th: "ผูกพันกับ {species} {count} ตัว ตามลำพัง" }, slots: { species: "normal", count: [15, 25], require: ["solo"] }, reward: LOOK },
  { id: "sqt:race_runeborn", ...meta, kind: "race", raceId: "race:runeborn", goal: "defeat", text: { th: "สลายอาคมของ {species} ธาตุ{element} {count} ตัว ด้วยทีมธาตุเดียว" }, slots: { element: "any", species: "of_element", count: [400, 600], require: ["mono_element_team"] }, reward: LOOK },
  { id: "sqt:race_tideborn", ...meta, kind: "race", raceId: "race:tideborn", goal: "tower", text: { th: "ไต่หอคอยรอยแยกถึงชั้น {floor} ด้วยทีมเต็ม" }, slots: { count: [1, 1], floor: [60, 80], require: ["full_team"] }, reward: LOOK },
  { id: "sqt:race_skyborn", ...meta, kind: "race", raceId: "race:skyborn", goal: "win", text: { th: "ชนะ {count} ไฟต์ที่ {map} ตามลำพัง ภายใน {rounds} รอบ" }, slots: { map: "field", count: [100, 200], require: ["solo", "within_rounds"], rounds: [3, 5] }, reward: LOOK },
  { id: "sqt:race_veilborn", ...meta, kind: "race", raceId: "race:veilborn", goal: "defeat", text: { th: "ล่า {species} {count} ตัว ตามลำพังโดยไม่ใช้ไอเท็ม" }, slots: { species: "normal", count: [400, 700], require: ["solo", "no_items"] }, reward: LOOK },
  // Personal: a set takes `personalCount` of these without repeats.
  { id: "sqt:personal_old_rival", ...meta, kind: "personal", goal: "defeat", text: { th: "คู่ปรับเก่า: ล่า {species} {count} ตัว โดยไม่ใช้ไอเท็ม" }, slots: { species: "normal", count: [800, 1500], require: ["no_items"] }, reward: MARK },
  { id: "sqt:personal_lost_friend", ...meta, kind: "personal", goal: "capture", text: { th: "เพื่อนที่หายไป: จับ {species} {count} ตัว ตามลำพัง" }, slots: { species: "normal", count: [20, 40], require: ["solo"] }, reward: MARK },
  { id: "sqt:personal_homecoming", ...meta, kind: "personal", goal: "explore", text: { th: "ทางกลับบ้าน: แวะ {map} {count} ครั้ง" }, slots: { map: "any", count: [150, 300] }, reward: MARK },
  { id: "sqt:personal_offering", ...meta, kind: "personal", goal: "deliver", text: { th: "ของถวาย: ส่ง {item} {count} ชิ้น" }, slots: { item: "material", count: [500, 1000] }, reward: MARK },
  { id: "sqt:personal_lone_walk", ...meta, kind: "personal", goal: "win", text: { th: "ทางเดินคนเดียว: ชนะ {count} ไฟต์ที่ {map} ตามลำพังโดยไม่ใช้ไอเท็ม" }, slots: { map: "field", count: [150, 300], require: ["solo", "no_items"] }, reward: MARK },
  { id: "sqt:personal_old_debt", ...meta, kind: "personal", goal: "boss", text: { th: "หนี้เก่า: ชนะ {species} {count} ครั้ง ทีมเต็ม ไม่ใช้ไอเท็ม ไม่มีใครล้ม" }, slots: { species: "boss", count: [15, 30], require: ["full_team", "no_items", "no_knockout"] }, reward: ANY },
  { id: "sqt:personal_colours", ...meta, kind: "personal", goal: "defeat", text: { th: "สีที่ชอบ: ล่า {species} ธาตุ{element} {count} ตัว ด้วยทีมธาตุเดียว" }, slots: { element: "any", species: "of_element", count: [500, 900], require: ["mono_element_team"] }, reward: MARK },
  { id: "sqt:personal_one_heart", ...meta, kind: "personal", goal: "win", text: { th: "ใจเดียวกัน: ชนะ {count} ไฟต์ด้วยทีมเต็มธาตุเดียว ไม่มีใครล้ม" }, slots: { count: [300, 500], require: ["mono_element_team", "full_team", "no_knockout"] }, reward: ANY },
  // Challenges: several conditions at once.
  { id: "sqt:personal_bare_hands", ...meta, kind: "personal", goal: "boss", text: { th: "มือเปล่า: ชนะ {species} {count} ครั้ง ตามลำพังโดยไม่ใช้ไอเท็มเลย" }, slots: { species: "boss", count: [5, 10], require: ["solo", "no_items"] }, reward: PRIZE },
  { id: "sqt:personal_swift_end", ...meta, kind: "personal", goal: "win", text: { th: "จบให้ไว: ชนะ {count} ไฟต์ที่ {map} ภายใน {rounds} รอบ ตามลำพังโดยไม่ใช้ไอเท็ม" }, slots: { map: "field", count: [100, 200], require: ["solo", "no_items", "within_rounds"], rounds: [2, 3] }, reward: PRIZE },
  { id: "sqt:personal_boss_rush", ...meta, kind: "personal", goal: "boss", text: { th: "ปิดเกมเจ้าถิ่น: ชนะ {species} {count} ครั้ง ภายใน {rounds} รอบ โดยไม่มีใครล้ม" }, slots: { species: "boss", count: [10, 20], require: ["within_rounds", "no_knockout"], rounds: [5, 7] }, reward: PRIZE },
  { id: "sqt:personal_one_colour", ...meta, kind: "personal", goal: "win", text: { th: "สีเดียวทั้งทีม: ชนะ {count} ไฟต์ด้วยทีมเต็มธาตุ{element}ล้วน" }, slots: { element: "any", count: [200, 400], require: ["mono_element_team", "full_team"] }, reward: MARK },
  { id: "sqt:personal_lone_wolf", ...meta, kind: "personal", goal: "win", text: { th: "ไม่พึ่งใคร: ชนะ {count} ไฟต์ตามลำพัง ไม่ใช้ไอเท็ม" }, slots: { count: [500, 900], require: ["solo", "no_items"] }, reward: MARK },
  { id: "sqt:personal_alone_vs_lord", ...meta, kind: "personal", goal: "boss", text: { th: "ดวลเดี่ยว: ชนะ {species} {count} ครั้ง ตามลำพัง ภายใน {rounds} รอบ" }, slots: { species: "boss", count: [5, 10], require: ["solo", "within_rounds"], rounds: [8, 10] }, reward: PRIZE },
  { id: "sqt:personal_crown_taker", ...meta, kind: "personal", goal: "elite_capture", text: { th: "ชิงมงกุฎ: จับจ่าฝูงชั้นยอด {species} {count} ตัว โดยไม่มีใครล้ม" }, slots: { species: "elite_leader", count: [5, 10], require: ["no_knockout"] }, reward: PRIZE },
  { id: "sqt:personal_quiet_crown", ...meta, kind: "personal", goal: "elite_capture", text: { th: "มงกุฎเงียบ: จับจ่าฝูงชั้นยอด {species} ตามลำพังโดยไม่ใช้ไอเท็มอื่น {count} ตัว" }, slots: { species: "elite_leader", count: [3, 5], require: ["solo", "no_items"] }, reward: PRIZE },
  { id: "sqt:personal_last_breath", ...meta, kind: "personal", goal: "win", text: { th: "ลมหายใจสุดท้าย: ชนะ {count} ไฟต์ ตัวละครเหลือ HP ไม่ถึง {hpPct}% และไม่ใช้ไอเท็ม" }, slots: { count: [30, 60], require: ["low_hp_finish", "no_items"], hpBelowPct: [5, 10] }, reward: PRIZE },
  { id: "sqt:personal_spire_climber", ...meta, kind: "personal", goal: "tower", text: { th: "ไต่หอ: ไปให้ถึงชั้น {floor} ของหอคอยรอยแยก ไม่มีใครล้ม" }, slots: { count: [1, 1], floor: [60, 85], require: ["no_knockout"] }, reward: PRIZE },
  { id: "sqt:personal_spire_summit", ...meta, kind: "personal", goal: "tower", text: { th: "ยอดหอ: ไปให้ถึงชั้น {floor} ของหอคอยรอยแยก ด้วยทีมธาตุเดียวโดยไม่ใช้ไอเท็ม" }, slots: { count: [1, 1], floor: [80, 100], require: ["mono_element_team", "no_items"] }, reward: PRIZE },
  { id: "sqt:personal_old_bond", ...meta, kind: "personal", goal: "boss", text: { th: "สายใยเก่า: ชนะ {species} {count} ครั้ง โดยมีคู่ใจ Bond ขั้น {bondTier} ขึ้นไปในทีม และไม่มีใครล้ม" }, slots: { species: "boss", count: [10, 20], require: ["bond_tier", "no_knockout"], bondTier: [4, 4] }, reward: PRIZE },
];

const look = (effect: "aura" | "sparkle" | "flame" | "ripple" | "leaf", color: string) => ({ effect, color });

/**
 * EXAMPLE reward pool (Nut 2026-10-06: every kind). Titles and fashion are looks; unique monsters are
 * NORMAL species variants with a marker and an innate from the NORMAL innates (no extra power, start at
 * Lv1); gear sits on a base piece with its unique effect left as a placeholder. Nothing grants these yet.
 */
export const EXAMPLE_SECRET_REWARDS: SecretRewardDefinition[] = [
  { id: "srw:title_ember_heir", ...meta, kind: "title", name: { th: "ทายาทเปลวเพลิง" } },
  { id: "srw:title_tide_keeper", ...meta, kind: "title", name: { th: "ผู้เฝ้ากระแสน้ำ" } },
  { id: "srw:title_stone_oath", ...meta, kind: "title", name: { th: "ผู้ถือคำสัตย์ศิลา" } },
  { id: "srw:title_rift_walker", ...meta, kind: "title", name: { th: "ผู้เดินรอยแยก" } },
  { id: "srw:title_lone_star", ...meta, kind: "title", name: { th: "ดาวเดียวดาย" } },
  { id: "srw:title_crown_breaker", ...meta, kind: "title", name: { th: "ผู้หักมงกุฎ" } },
  { id: "srw:fashion_ash_mantle", ...meta, kind: "fashion", name: { th: "ผ้าคลุมเถ้าถ่าน" }, layer: "back", look: look("flame", "#e0603a") },
  { id: "srw:fashion_tide_veil", ...meta, kind: "fashion", name: { th: "ผ้าคลุมหน้าคลื่น" }, layer: "head", look: look("ripple", "#3a8ee0") },
  { id: "srw:fashion_leaf_crown", ...meta, kind: "fashion", name: { th: "มงกุฎใบไม้โบราณ" }, layer: "head", look: look("leaf", "#4caf50") },
  { id: "srw:fashion_star_aura", ...meta, kind: "fashion", name: { th: "รัศมีดาวตก" }, layer: "aura", look: look("sparkle", "#f2d45c") },
  { id: "srw:fashion_dusk_robe", ...meta, kind: "fashion", name: { th: "เสื้อคลุมสนธยา" }, layer: "body", look: look("aura", "#6a4fb0") },
  {
    id: "srw:companion_gilded_mole",
    ...meta,
    kind: "companion",
    name: { th: "ตุ่นเสบียงทองคำ" },
    baseSpeciesId: "species:supply_mole",
    marker: look("sparkle", "#f2c14e"),
    innateOptions: ["skill:mole_innate_mp_refund", "skill:snail_innate_mp_return", "skill:bird_innate_resist"],
  },
  {
    id: "srw:companion_moon_fox",
    ...meta,
    kind: "companion",
    name: { th: "จิ้งจอกจันทรา" },
    baseSpeciesId: "species:ember_fox",
    marker: look("aura", "#c8d4ff"),
    innateOptions: ["skill:fox_innate_kill_heal", "skill:mole_innate_mp_refund"],
  },
  {
    id: "srw:companion_jade_crab",
    ...meta,
    kind: "companion",
    name: { th: "ปูหยกเขียว" },
    baseSpeciesId: "species:armor_crab",
    marker: look("leaf", "#3fb68b"),
    innateOptions: ["skill:crab_innate_mp_refund", "skill:snail_innate_mp_return"],
  },
  {
    id: "srw:companion_dawn_snail",
    ...meta,
    kind: "companion",
    name: { th: "หอยตะเกียงอรุณ" },
    baseSpeciesId: "species:lantern_snail",
    marker: look("flame", "#ffb36b"),
    innateOptions: ["skill:snail_innate_mp_return", "skill:bird_innate_resist"],
  },
  { id: "srw:gear_oathblade", ...meta, kind: "gear", name: { th: "ดาบคำสัตย์" }, baseEquipmentId: "equip:wooden_sword", uniqueEffect: null },
  { id: "srw:gear_tidecall_staff", ...meta, kind: "gear", name: { th: "ไม้เท้าเรียกคลื่น" }, baseEquipmentId: "equip:apprentice_staff", uniqueEffect: null },
  { id: "srw:gear_rift_plate", ...meta, kind: "gear", name: { th: "เกราะผลึกรอยแยก" }, baseEquipmentId: "equip:crystal_shell_plate", uniqueEffect: null },
  { id: "srw:gear_windstep_sandals", ...meta, kind: "gear", name: { th: "รองเท้าก้าวลม" }, baseEquipmentId: "equip:mole_sandals", uniqueEffect: null },
  { id: "srw:gear_star_charm", ...meta, kind: "gear", name: { th: "เครื่องรางดาวเหนือ" }, baseEquipmentId: "equip:glow_charm", uniqueEffect: null },
];

export const exampleSecretRewardRegistry = () => new Map(EXAMPLE_SECRET_REWARDS.map((r) => [r.id, r]));
