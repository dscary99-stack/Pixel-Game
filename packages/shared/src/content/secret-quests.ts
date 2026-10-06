/**
 * EXAMPLE secret quest templates (Nut 2026-10-05). One per player element, one per draft race (P16)
 * and a personal pool of 20. Nut 2026-10-06 asked for more, harder personal quests: the last 12 are
 * challenges (no items against a boss, a round limit, one element, solo, an elite leader caught,
 * ending on low HP, tower floors, an old Bond). Goals, counts, conditions and texts are Claude's
 * first pass: a draft to exercise the contract, not approved endgame content.
 */
import type { SecretQuestTemplate } from "../secret-quests";

const meta = { version: 1, status: "draft", example: true } as const;

export const EXAMPLE_SECRET_QUEST_TEMPLATES: SecretQuestTemplate[] = [
  // Element: one per player element; the species is one that can carry that element.
  { id: "sqt:element_fire", ...meta, kind: "element", element: "FIRE", goal: "defeat", text: { th: "เผาผลาญ {species} ธาตุไฟ {count} ตัว" }, slots: { element: "template", species: "of_element", count: [60, 120] } },
  { id: "sqt:element_water", ...meta, kind: "element", element: "WATER", goal: "capture", text: { th: "เชื่อมใจ {species} ธาตุน้ำ {count} ตัว" }, slots: { element: "template", species: "of_element", count: [3, 6] } },
  { id: "sqt:element_earth", ...meta, kind: "element", element: "EARTH", goal: "defeat", text: { th: "ยืนหยัดต่อ {species} ธาตุดิน {count} ตัว โดยไม่มีใครล้ม" }, slots: { element: "template", species: "of_element", count: [40, 80], conditions: ["no_knockout"] } },
  { id: "sqt:element_wind", ...meta, kind: "element", element: "WIND", goal: "win", text: { th: "ชนะ {count} ไฟต์ที่ {map} ด้วยทีมธาตุเดียว" }, slots: { element: "template", map: "field", count: [20, 40], conditions: ["mono_element_team"] } },
  { id: "sqt:element_light", ...meta, kind: "element", element: "LIGHT", goal: "defeat", text: { th: "ส่องทาง {species} ธาตุแสง {count} ตัว โดยไม่ใช้ไอเท็ม" }, slots: { element: "template", species: "of_element", count: [40, 80], conditions: ["no_items"] } },
  { id: "sqt:element_shadow", ...meta, kind: "element", element: "SHADOW", goal: "defeat", text: { th: "ตามรอย {species} ธาตุมืด {count} ตัว ตามลำพัง" }, slots: { element: "template", species: "of_element", count: [20, 40], conditions: ["solo"] } },
  // Race: one per draft race.
  { id: "sqt:race_human", ...meta, kind: "race", raceId: "race:human", goal: "win", text: { th: "ชนะ {count} ไฟต์ด้วยทีมเต็ม" }, slots: { count: [50, 100], conditions: ["full_team"] } },
  { id: "sqt:race_sylvan", ...meta, kind: "race", raceId: "race:sylvan", goal: "deliver", text: { th: "นำ {item} {count} ชิ้นคืนสู่ป่า" }, slots: { item: "material", count: [30, 60] } },
  { id: "sqt:race_stonekin", ...meta, kind: "race", raceId: "race:stonekin", goal: "boss", text: { th: "ทลาย {species} {count} ครั้ง โดยไม่มีใครล้ม" }, slots: { species: "boss", count: [3, 6], conditions: ["no_knockout"] } },
  { id: "sqt:race_wildkin", ...meta, kind: "race", raceId: "race:wildkin", goal: "capture", text: { th: "ผูกพันกับ {species} {count} ตัว" }, slots: { species: "normal", count: [3, 5] } },
  { id: "sqt:race_runeborn", ...meta, kind: "race", raceId: "race:runeborn", goal: "defeat", text: { th: "สลายอาคมของ {species} ธาตุ{element} {count} ตัว" }, slots: { element: "any", species: "of_element", count: [50, 90] } },
  { id: "sqt:race_tideborn", ...meta, kind: "race", raceId: "race:tideborn", goal: "explore", text: { th: "กลับไปเยือน {map} {count} ครั้ง" }, slots: { map: "any", count: [10, 20] } },
  { id: "sqt:race_skyborn", ...meta, kind: "race", raceId: "race:skyborn", goal: "win", text: { th: "ชนะ {count} ไฟต์ที่ {map} ตามลำพัง" }, slots: { map: "field", count: [15, 30], conditions: ["solo"] } },
  { id: "sqt:race_veilborn", ...meta, kind: "race", raceId: "race:veilborn", goal: "defeat", text: { th: "ล่า {species} {count} ตัว โดยไม่ใช้ไอเท็ม" }, slots: { species: "normal", count: [60, 120], conditions: ["no_items"] } },
  // Personal: a set takes `personalCount` of these without repeats.
  { id: "sqt:personal_old_rival", ...meta, kind: "personal", goal: "defeat", text: { th: "คู่ปรับเก่า: ล่า {species} {count} ตัว" }, slots: { species: "normal", count: [80, 150] } },
  { id: "sqt:personal_lost_friend", ...meta, kind: "personal", goal: "capture", text: { th: "เพื่อนที่หายไป: จับ {species} {count} ตัว" }, slots: { species: "normal", count: [1, 3] } },
  { id: "sqt:personal_homecoming", ...meta, kind: "personal", goal: "explore", text: { th: "ทางกลับบ้าน: แวะ {map} {count} ครั้ง" }, slots: { map: "any", count: [5, 15] } },
  { id: "sqt:personal_offering", ...meta, kind: "personal", goal: "deliver", text: { th: "ของถวาย: ส่ง {item} {count} ชิ้น" }, slots: { item: "material", count: [20, 50] } },
  { id: "sqt:personal_lone_walk", ...meta, kind: "personal", goal: "win", text: { th: "ทางเดินคนเดียว: ชนะ {count} ไฟต์ที่ {map} ตามลำพัง" }, slots: { map: "field", count: [10, 25], conditions: ["solo"] } },
  { id: "sqt:personal_old_debt", ...meta, kind: "personal", goal: "boss", text: { th: "หนี้เก่า: ชนะ {species} {count} ครั้ง" }, slots: { species: "boss", count: [2, 5], conditions: ["no_items", "full_team", "no_knockout"] } },
  { id: "sqt:personal_colours", ...meta, kind: "personal", goal: "defeat", text: { th: "สีที่ชอบ: ล่า {species} ธาตุ{element} {count} ตัว" }, slots: { element: "any", species: "of_element", count: [30, 70] } },
  { id: "sqt:personal_one_heart", ...meta, kind: "personal", goal: "win", text: { th: "ใจเดียวกัน: ชนะ {count} ไฟต์ด้วยทีมธาตุเดียว" }, slots: { count: [30, 60], conditions: ["mono_element_team", "full_team"] } },
  // Challenges (Nut 2026-10-06: harder personal quests).
  { id: "sqt:personal_bare_hands", ...meta, kind: "personal", goal: "boss", text: { th: "มือเปล่า: ชนะ {species} {count} ครั้ง โดยไม่ใช้ไอเท็มเลย" }, slots: { species: "boss", count: [1, 3], conditions: ["no_items"] } },
  { id: "sqt:personal_swift_end", ...meta, kind: "personal", goal: "win", text: { th: "จบให้ไว: ชนะ {count} ไฟต์ที่ {map} ภายใน {rounds} รอบ" }, slots: { map: "field", count: [5, 15], conditions: ["within_rounds"], rounds: [2, 4] } },
  { id: "sqt:personal_boss_rush", ...meta, kind: "personal", goal: "boss", text: { th: "ปิดเกมเจ้าถิ่น: ชนะ {species} {count} ครั้ง ภายใน {rounds} รอบ" }, slots: { species: "boss", count: [1, 2], conditions: ["within_rounds"], rounds: [6, 10] } },
  { id: "sqt:personal_one_colour", ...meta, kind: "personal", goal: "win", text: { th: "สีเดียวทั้งทีม: ชนะ {count} ไฟต์ด้วยทีมธาตุ{element}ล้วน" }, slots: { element: "any", count: [10, 25], conditions: ["mono_element_team"] } },
  { id: "sqt:personal_lone_wolf", ...meta, kind: "personal", goal: "win", text: { th: "ไม่พึ่งใคร: ชนะ {count} ไฟต์ตามลำพัง ไม่มีคู่ใจ" }, slots: { count: [20, 40], conditions: ["solo"] } },
  { id: "sqt:personal_alone_vs_lord", ...meta, kind: "personal", goal: "boss", text: { th: "ดวลเดี่ยว: ชนะ {species} {count} ครั้ง ตามลำพัง" }, slots: { species: "boss", count: [1, 2], conditions: ["solo"] } },
  { id: "sqt:personal_crown_taker", ...meta, kind: "personal", goal: "elite_capture", text: { th: "ชิงมงกุฎ: จับจ่าฝูงชั้นยอด {species} {count} ตัว" }, slots: { species: "elite_leader", count: [1, 2] } },
  { id: "sqt:personal_quiet_crown", ...meta, kind: "personal", goal: "elite_capture", text: { th: "มงกุฎเงียบ: จับจ่าฝูงชั้นยอด {species} ตามลำพัง {count} ตัว" }, slots: { species: "elite_leader", count: [1, 1], conditions: ["solo"] } },
  { id: "sqt:personal_last_breath", ...meta, kind: "personal", goal: "win", text: { th: "ลมหายใจสุดท้าย: ชนะ {count} ไฟต์ โดยตัวละครเหลือ HP ไม่ถึง {hpPct}%" }, slots: { count: [3, 8], conditions: ["low_hp_finish"], hpBelowPct: [10, 25] } },
  { id: "sqt:personal_spire_climber", ...meta, kind: "personal", goal: "tower", text: { th: "ไต่หอ: ไปให้ถึงชั้น {floor} ของหอคอยรอยแยก" }, slots: { count: [1, 1], floor: [30, 70] } },
  { id: "sqt:personal_spire_summit", ...meta, kind: "personal", goal: "tower", text: { th: "ยอดหอ: ไปให้ถึงชั้น {floor} ของหอคอยรอยแยก โดยไม่ใช้ไอเท็ม" }, slots: { count: [1, 1], floor: [80, 100], conditions: ["no_items"] } },
  { id: "sqt:personal_old_bond", ...meta, kind: "personal", goal: "win", text: { th: "สายใยเก่า: ชนะ {count} ไฟต์ โดยมีคู่ใจ Bond ขั้น {bondTier} ขึ้นไปในทีม" }, slots: { count: [10, 20], conditions: ["bond_tier"], bondTier: [3, 4] } },
];
