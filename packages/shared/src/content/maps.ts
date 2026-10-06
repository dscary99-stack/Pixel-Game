/**
 * EXAMPLE maps for the Phase B walking slice. Two small areas joined by portals, enough to prove
 * walking, collision, channels and scene changes. Layout and names are illustration (chapter 00
 * EXAMPLE); the real town and the first hunting fields come from the content plan (chapter 13 §2).
 */
import type { MapDefinition } from "../world/map";

const meta = { version: 1, status: "draft", example: true } as const;

export const EXAMPLE_MAPS: MapDefinition[] = [
  {
    id: "map:dawn_town",
    ...meta,
    name: { th: "หมู่บ้านรุ่งอรุณ", en: "Dawn Village" },
    kind: "town",
    tiles: [
      "########################",
      "#,,,,,,,,,,====,,,,,,,,#",
      "#,TT,,,,,,,====,,,,,TT,#",
      "#,TT,,####,====,####,,,#",
      "#,,,,,#..#,====,#..#,,,#",
      "#,,,,,#..#,====,#..#,,,#",
      "#,,,,,##=#,====,#=##,,,#",
      "#=======================",
      "#=======================",
      "#,,,,,,,,,,====,,,,,,,,#",
      "#,~~~~,,,,,====,,,,,,,,#",
      "#,~~~~,,,,,====,,,,TT,,#",
      "#,,,,,,,,,,====,,,,TT,,#",
      "#,TT,,,,,,,====,,,,,,,,#",
      "#,,,,,,,,,,====,,,,,,,,#",
      "########################",
    ],
    spawn: { x: 12, y: 8 },
    portals: [
      { at: { x: 23, y: 7 }, to: { mapId: "map:dawn_field", x: 1, y: 7 }, label: "ทุ่งรุ่งอรุณ" },
      { at: { x: 23, y: 8 }, to: { mapId: "map:dawn_field", x: 1, y: 8 }, label: "ทุ่งรุ่งอรุณ" },
    ],
    spawns: [],
    // Village people from the story doc (each service has a person); EXAMPLE lines until the dialogue pass.
    npcs: [
      { id: "npc:elder_pim", at: { x: 8, y: 9 }, name: { th: "ผู้ใหญ่พิมพ์" }, role: { th: "จุดเกิดและพักฟื้น" }, services: ["talk"], line: { th: "พักให้หายเหนื่อยก่อนนะหลาน สมัยข้ายังผูกตรา กวางรุ่งอรุณเคยมาดื่มน้ำที่บ่อนี้ทุกเช้า" } },
      { id: "npc:aunt_bua", at: { x: 5, y: 9 }, name: { th: "ป้าบัว" }, role: { th: "ร้านของใช้ รับซื้อของ" }, services: ["shop"], line: { th: "ยาสดใหม่จากสายไหมจ้ะ ข่าวจากเมืองไหนก็ถามป้าได้" } },
      { id: "npc:uncle_lek", at: { x: 10, y: 5 }, name: { th: "ลุงเหล็ก" }, role: { th: "ช่างอาวุธและเกราะ ตีบวก" }, services: ["refine", "craft", "equipment"], line: { th: "ผลึกแปลกๆ ที่ข้าเจอเมื่อสิบปีก่อน มันเรืองแสงตอนรอยแยกเปิด" } },
      { id: "npc:pi_kaew", at: { x: 15, y: 5 }, name: { th: "พี่แก้ว" }, role: { th: "ช่างเครื่องประดับ สุ่มออปชัน" }, services: ["equipment", "craft"], line: { th: "สักวันฉันจะไปเรียนที่เฮลิออสให้ได้ อย่าบอกพ่อนะ" } },
      { id: "npc:ta_sai", at: { x: 2, y: 9 }, name: { th: "ตาสาย" }, role: { th: "รับซื้อ แยกชิ้นส่วน" }, services: ["equipment", "shop"], line: { th: "ของทุกชิ้นมีค่าถ้ารู้จักแยก ข้าเรียนรู้เรื่องนี้มาแบบเจ็บตัว" } },
      { id: "npc:nong_min", at: { x: 21, y: 3 }, name: { th: "น้องมินทร์" }, role: { th: "กระดานเควสรายวัน/สัปดาห์" }, services: ["quests"], line: { th: "หอผู้ผูกตราฝากงานมาเพียบเลยค่ะ เลือกเอาที่ชอบได้เลย" } },
      { id: "npc:uncle_som", at: { x: 3, y: 5 }, name: { th: "ลุงสม" }, role: { th: "กระดานคำสั่งซื้อ" }, services: ["orders"], line: { th: "หลังคาหมู่บ้านยังรั่วอยู่ ใครหาวัสดุมาได้ ลุงจ่ายงาม" } },
      { id: "npc:rune_reader", at: { x: 16, y: 9 }, name: { th: "ผู้อ่านตรา" }, role: { th: "ใส่/ถอด Sigil สลับแบบจุติ" }, services: ["equipment", "rebirth"], line: { th: "ตราทุกดวงจำได้ว่ามันหลุดมาจากใคร เจ้าล่ะ จำได้ไหม" } },
      { id: "npc:kru_ueang", at: { x: 19, y: 9 }, name: { th: "ครูเอื้อง" }, role: { th: "ฝึกสกิลคู่ใจ จุติ ดู Bond" }, services: ["skills", "rebirth", "team"], line: { th: "คู่ใจไม่ใช่ของใช้ ข้ารู้ดีที่สุดว่าเสียไปแล้วเป็นอย่างไร" } },
      { id: "npc:pi_mek", at: { x: 22, y: 9 }, name: { th: "พี่เมฆ" }, role: { th: "ตั้ง/เข้าปาร์ตี้" }, services: ["party"], line: { th: "ล่าคนเดียวมันเหงา มาตั้งทีมกันไหม" } },
      { id: "npc:boon_harbor", at: { x: 22, y: 6 }, name: { th: "นายท่าเรือบุญ" }, role: { th: "เดินทางข้ามแผนที่" }, services: ["talk"], line: { th: "เรือไปเมืองอื่นยังไม่ออก สภานักเดินทางกำลังตรวจเส้นทางอยู่" } },
      { id: "npc:doc_ploy", at: { x: 5, y: 12 }, name: { th: "หมอพลอย" }, role: { th: "คลังคู่ใจและจัดทีม" }, services: ["team"], line: { th: "ฉันจดบันทึกอสูรทุกตัวที่ผ่านหมู่บ้านนี้ รวมถึงของเธอด้วย" } },
      { id: "npc:nang_prae", at: { x: 8, y: 12 }, name: { th: "นางแพร" }, role: { th: "แฟชั่นและฉายา" }, services: ["journal"], line: { th: "ผ้าผืนนี้ถักจากขนอสูรที่ผลัดเอง ไม่มีตัวไหนเจ็บ" } },
      { id: "npc:uncle_han", at: { x: 16, y: 13 }, name: { th: "ลุงหาญ" }, role: { th: "ผู้เฝ้าประตูหอคอยรอยแยก" }, services: ["frontier"], line: { th: "หอเปิดรับสัปดาห์ละครั้ง ขึ้นไปแล้วอย่าหวังว่าจะลงง่ายๆ" } },
    ],
  },
  {
    id: "map:dawn_field",
    ...meta,
    name: { th: "ทุ่งรุ่งอรุณ", en: "Dawn Field" },
    kind: "field",
    tiles: [
      "############################",
      "#,,,,TT,,,,,,,,,,,,,TT,,,,,#",
      "#,,,,TT,,,,,~~~~,,,,TT,,,,,#",
      "#,,,,,,,,,,~~~~~~,,,,,,,,,,#",
      "#,,TT,,,,,,~~~~~~,,,,,,TT,,#",
      "#,,TT,,,,,,,~~~~,,,,,,,TT,,#",
      "#,,,,,,,,,,,,,,,,,,,,,,,,,,#",
      "=====,,,,,,,,,TT,,,,,,,,,,,#",
      "=====,,,,,,,,,TT,,,,,,,,,,,#",
      "#,,,,,,,,,,,,,,,,,,,,,,,,,,#",
      "#,,TT,,,,,,,,,,,,,,,,,TT,,,#",
      "#,,TT,,,,,~~,,,,,,,,,,TT,,,#",
      "#,,,,,,,,,~~,,,,TT,,,,,,,,,#",
      "#,,,,,,,,,,,,,,,TT,,,,,,,,,#",
      "#,,,,TT,,,,,,,,,,,,,,,TT,,,#",
      "#,,,,TT,,,,,,,,,,,,,,,TT,,,#",
      "#,,,,,,,,,,,,,,,,,,,,,,,,,,#",
      "############################",
    ],
    spawn: { x: 3, y: 8 },
    portals: [
      { at: { x: 0, y: 7 }, to: { mapId: "map:dawn_town", x: 22, y: 7 }, label: "หมู่บ้านรุ่งอรุณ" },
      { at: { x: 0, y: 8 }, to: { mapId: "map:dawn_town", x: 22, y: 8 }, label: "หมู่บ้านรุ่งอรุณ" },
    ],
    // EXAMPLE boss (chapter 07 §5) by the far east edge; Lv8 with two snails, meant for a team.
    bossLair: { bossId: "boss:crystal_crab_lord", at: { x: 24, y: 13 } },
    // EXAMPLE packs. Single Lv2–3 packs by the gate are what a new Lv1 character can beat alone;
    // the pond, meadow and south packs need a higher level or a team. Chapter 07 §3 size bands go up to 9–10.
    spawns: [
      {
        id: "gate_moles",
        at: { x: 6, y: 5 },
        rank: "NORMAL",
        packSize: [1, 1],
        entries: [{ speciesId: "species:supply_mole", weight: 1, elementWeights: { EARTH: 2, WATER: 1 }, groupRules: { min: 1, max: 1 } }],
      },
      {
        id: "gate_birds",
        at: { x: 6, y: 11 },
        rank: "NORMAL",
        packSize: [1, 1],
        entries: [{ speciesId: "species:bell_bird", weight: 1, elementWeights: { WIND: 2, LIGHT: 1 }, groupRules: { min: 1, max: 1 } }],
      },
      {
        id: "pond_crabs",
        at: { x: 9, y: 6 },
        rank: "NORMAL",
        packSize: [1, 2],
        entries: [
          { speciesId: "species:armor_crab", weight: 3, elementWeights: { WATER: 2, EARTH: 1 }, groupRules: { min: 1, max: 2 } },
          { speciesId: "species:lantern_snail", weight: 1, elementWeights: { WATER: 1, LIGHT: 1 }, groupRules: { min: 1, max: 1 } },
        ],
      },
      {
        id: "meadow_foxes",
        at: { x: 19, y: 9 },
        rank: "NORMAL",
        packSize: [1, 2],
        entries: [{ speciesId: "species:ember_fox", weight: 1, elementWeights: { FIRE: 3, WIND: 2, SHADOW: 1 }, groupRules: { min: 1, max: 2 } }],
      },
      {
        // EXAMPLE elite (chapter 07 §3): a tougher mole leader with one modifier and a bird or two.
        id: "elite_moles",
        at: { x: 14, y: 10 },
        rank: "ELITE",
        packSize: [2, 3],
        entries: [
          { speciesId: "species:supply_mole", weight: 2, elementWeights: { EARTH: 2, WATER: 1 }, groupRules: { min: 1, max: 2 } },
          { speciesId: "species:bell_bird", weight: 1, elementWeights: { WIND: 2, LIGHT: 1 }, groupRules: { min: 1, max: 1 } },
        ],
      },
      {
        id: "south_snails",
        at: { x: 8, y: 14 },
        rank: "NORMAL",
        packSize: [1, 1],
        entries: [{ speciesId: "species:lantern_snail", weight: 1, elementWeights: { WATER: 1, LIGHT: 1 }, groupRules: { min: 1, max: 1 } }],
      },
    ],
  },
];

/** Where a brand-new character starts. */
export const EXAMPLE_START_MAP = "map:dawn_town";

export const exampleMapRegistry = (): Map<string, MapDefinition> => new Map(EXAMPLE_MAPS.map((m) => [m.id, m]));
