/**
 * EXAMPLE weekly tower (Nut 2026-10-06). Name, lore, guardians and floors are a draft; Nut may pick another
 * name (alternatives: บันไดบรรพอสูร, หอทดสอบผู้ผูกตรา). Must not be published as is.
 *
 * Nut 2026-10-06 (04:37Z): Claude names every floor, and each floor has its own gimmick. The 100 floors
 * come in 10 lands of 10 floors, each land a country or element (the first two from Nut's examples,
 * the rest after chapter 07's regions and the six elements). Gimmicks are fixed per floor here, so every
 * player meets the same floor 37: one each, two from floor 50, three from floor 80 (P12); the 5th and 9th
 * floor of each land is one-element in the land's element; reserves only from floor 31 where
 * reinforcements begin.
 */
import type { FrontierDefinition } from "../frontier";

export const EXAMPLE_FRONTIER: FrontierDefinition = {
  id: "frontier:rift_spire",
  version: 1,
  status: "draft",
  example: true,
  name: { th: "หอคอยรอยแยก", en: "Rift Spire" },
  lore: { th: "หอคอยที่งอกขึ้นจากรอยแยกของรอยแยกปฐมกาล ดึงมอนสเตอร์จากทุกแคว้นเข้ามาไว้ข้างใน" },
  townMapIds: ["map:dawn_town"],
  bossIds: ["boss:rift_spire_warden", "boss:rift_spire_tyrant"],
  floors: [
  // ชั้น 1–10: สุวรรณทวาร (ทุ่งนาและนาค)
  { floor: 1, name: { th: "ประตูรวงทอง" }, modifiers: ["arcane"] },
  { floor: 2, name: { th: "คันนาลมเย็น" }, modifiers: ["venom"] },
  { floor: 3, name: { th: "ลำเหมืองนาคน้อย" }, modifiers: ["crystal_shield"] },
  { floor: 4, name: { th: "ลานนวดข้าว" }, modifiers: ["regen"] },
  { floor: 5, name: { th: "ศาลาเจ้าทุ่ง" }, modifiers: ["mono_element"], element: "WATER" },
  { floor: 6, name: { th: "หนองบัวนาคา" }, modifiers: ["disrupt"] },
  { floor: 7, name: { th: "ยุ้งฉางเก่า" }, modifiers: ["swift"] },
  { floor: 8, name: { th: "สะพานเกล็ดนาค" }, modifiers: ["fierce"] },
  { floor: 9, name: { th: "บึงพญานาคหลับ" }, modifiers: ["mono_element"], element: "WATER" },
  { floor: 10, name: { th: "ท้องพระโรงนาคทอง" }, guardianTitle: { th: "ผู้พิทักษ์ประตูสุวรรณ" }, modifiers: ["venom"] },
  // ชั้น 11–20: ไพรเขียว (ป่าดึกดำบรรพ์)
  { floor: 11, name: { th: "ชายป่าใบอ่อน" }, modifiers: ["fierce"] },
  { floor: 12, name: { th: "ทางเถาวัลย์" }, modifiers: ["arcane"] },
  { floor: 13, name: { th: "ลำธารตะไคร่" }, modifiers: ["venom"] },
  { floor: 14, name: { th: "โพรงไม้พันปี" }, modifiers: ["crystal_shield"] },
  { floor: 15, name: { th: "ลานเห็ดเรืองแสง" }, modifiers: ["mono_element"], element: "EARTH" },
  { floor: 16, name: { th: "ดงไผ่กระซิบ" }, modifiers: ["tough"] },
  { floor: 17, name: { th: "รังผึ้งยักษ์" }, modifiers: ["disrupt"] },
  { floor: 18, name: { th: "ซุ้มรากไทร" }, modifiers: ["swift"] },
  { floor: 19, name: { th: "ศาลเจ้าป่าเงียบ" }, modifiers: ["mono_element"], element: "EARTH" },
  { floor: 20, name: { th: "หัวใจไพรเขียว" }, guardianTitle: { th: "ผู้คุมพงไพร" }, modifiers: ["arcane"] },
  // ชั้น 21–30: วารีนที (แม่น้ำและทะเล)
  { floor: 21, name: { th: "ท่าน้ำหมอกเช้า" }, modifiers: ["swift"] },
  { floor: 22, name: { th: "แก่งหินเกล็ดปลา" }, modifiers: ["fierce"] },
  { floor: 23, name: { th: "ถ้ำปะการังร้อง" }, modifiers: ["arcane"] },
  { floor: 24, name: { th: "วังน้ำวน" }, modifiers: ["venom"] },
  { floor: 25, name: { th: "หาดกระจกใส" }, modifiers: ["mono_element"], element: "WATER" },
  { floor: 26, name: { th: "อู่เรือร้าง" }, modifiers: ["regen"] },
  { floor: 27, name: { th: "ร่องน้ำลึกเงียบ" }, modifiers: ["tough"] },
  { floor: 28, name: { th: "ประภาคารจมน้ำ" }, modifiers: ["disrupt"] },
  { floor: 29, name: { th: "ม่านน้ำตกเงิน" }, modifiers: ["mono_element"], element: "WATER" },
  { floor: 30, name: { th: "ตำหนักวารี" }, guardianTitle: { th: "ผู้ครองกระแสวารี" }, modifiers: ["fierce"] },
  // ชั้น 31–40: อัคนีบุรี (เมืองเพลิง)
  { floor: 31, name: { th: "ประตูเถ้าถ่าน" }, modifiers: ["arcane"] },
  { floor: 32, name: { th: "ตรอกเตาหลอม" }, modifiers: ["tough"] },
  { floor: 33, name: { th: "ลานหินลาวา" }, modifiers: ["disrupt"] },
  { floor: 34, name: { th: "หอระฆังเพลิง" }, modifiers: ["venom"] },
  { floor: 35, name: { th: "สะพานถ่านแดง" }, modifiers: ["mono_element"], element: "FIRE" },
  { floor: 36, name: { th: "ตลาดประกายไฟ" }, modifiers: ["swift"] },
  { floor: 37, name: { th: "บ่อกำมะถัน" }, modifiers: ["reserves"] },
  { floor: 38, name: { th: "ป้อมควันดำ" }, modifiers: ["regen"] },
  { floor: 39, name: { th: "แท่นบูชาสุริยา" }, modifiers: ["mono_element"], element: "FIRE" },
  { floor: 40, name: { th: "บัลลังก์อัคนี" }, guardianTitle: { th: "ผู้เฝ้าเปลวนิรันดร์" }, modifiers: ["arcane"] },
  // ชั้น 41–50: ศิลาคีรี (ขุนเขาและเหมือง)
  { floor: 41, name: { th: "เชิงผาหินผุ" }, modifiers: ["venom"] },
  { floor: 42, name: { th: "เหมืองแร่เก่า" }, modifiers: ["crystal_shield"] },
  { floor: 43, name: { th: "ถ้ำหินงอก" }, modifiers: ["swift"] },
  { floor: 44, name: { th: "บันไดศิลาแตก" }, modifiers: ["reserves"] },
  { floor: 45, name: { th: "ลานรูปสลักเฝ้าเขา" }, modifiers: ["mono_element"], element: "EARTH" },
  { floor: 46, name: { th: "ช่องเขาลมหวน" }, modifiers: ["fierce"] },
  { floor: 47, name: { th: "วิหารหินผลึก" }, modifiers: ["arcane"] },
  { floor: 48, name: { th: "เหวเกราะปู" }, modifiers: ["tough"] },
  { floor: 49, name: { th: "ยอดผาแร้งร้อง" }, modifiers: ["mono_element"], element: "EARTH" },
  { floor: 50, name: { th: "ประตูภูผา" }, guardianTitle: { th: "ผู้ค้ำยันขุนเขา" }, modifiers: ["venom", "regen"] },
  // ชั้น 51–60: วายุเวหา (ฟ้าและพายุ)
  { floor: 51, name: { th: "ระเบียงเมฆ" }, modifiers: ["reserves", "tough"] },
  { floor: 52, name: { th: "สะพานเชือกลม" }, modifiers: ["regen", "disrupt"] },
  { floor: 53, name: { th: "รังนกกระดิ่ง" }, modifiers: ["fierce", "venom"] },
  { floor: 54, name: { th: "ลานว่าวโบราณ" }, modifiers: ["arcane", "crystal_shield"] },
  { floor: 55, name: { th: "หอคอยกังหัน" }, modifiers: ["mono_element", "tough"], element: "WIND" },
  { floor: 56, name: { th: "ทางเดินพายุหมุน" }, modifiers: ["disrupt", "reserves"] },
  { floor: 57, name: { th: "เกาะลอยฟ้า" }, modifiers: ["venom", "regen"] },
  { floor: 58, name: { th: "ม่านเมฆฝน" }, modifiers: ["crystal_shield", "fierce"] },
  { floor: 59, name: { th: "ยอดเสาสายฟ้า" }, modifiers: ["mono_element", "swift"], element: "WIND" },
  { floor: 60, name: { th: "นภาวิมาน" }, guardianTitle: { th: "ผู้บัญชาวายุ" }, modifiers: ["reserves", "tough"] },
  // ชั้น 61–70: อำพันทราย (ซากนครทะเลทราย)
  { floor: 61, name: { th: "ประตูเมืองทราย" }, modifiers: ["arcane", "crystal_shield"] },
  { floor: 62, name: { th: "ตลาดร้างกลางเนิน" }, modifiers: ["tough", "swift"] },
  { floor: 63, name: { th: "โอเอซิสลวง" }, modifiers: ["disrupt", "reserves"] },
  { floor: 64, name: { th: "สุสานอำพัน" }, modifiers: ["venom", "regen"] },
  { floor: 65, name: { th: "ห้องสมุดทรายดูด" }, modifiers: ["mono_element", "crystal_shield"], element: "FIRE" },
  { floor: 66, name: { th: "ลานพระจันทร์ทราย" }, modifiers: ["swift", "arcane"] },
  { floor: 67, name: { th: "ซากวิหารทองแดง" }, modifiers: ["reserves", "tough"] },
  { floor: 68, name: { th: "ทางลับใต้เนิน" }, modifiers: ["regen", "disrupt"] },
  { floor: 69, name: { th: "หอดูดาวอำพัน" }, modifiers: ["mono_element", "fierce"], element: "FIRE" },
  { floor: 70, name: { th: "ท้องพระคลังอำพัน" }, guardianTitle: { th: "ผู้รักษาคลังอำพัน" }, modifiers: ["arcane", "crystal_shield"] },
  // ชั้น 71–80: ประภาสวรรค์ (วิหารแสง)
  { floor: 71, name: { th: "ลานแสงรุ่ง" }, modifiers: ["venom", "regen"] },
  { floor: 72, name: { th: "ระเบียงกระจกสี" }, modifiers: ["crystal_shield", "fierce"] },
  { floor: 73, name: { th: "สวนดอกบัวแก้ว" }, modifiers: ["swift", "arcane"] },
  { floor: 74, name: { th: "ห้องโคมนิรันดร์" }, modifiers: ["reserves", "tough"] },
  { floor: 75, name: { th: "บันไดดาวเหนือ" }, modifiers: ["mono_element", "regen"], element: "LIGHT" },
  { floor: 76, name: { th: "อารามระฆังแสง" }, modifiers: ["fierce", "venom"] },
  { floor: 77, name: { th: "สระน้ำทิพย์" }, modifiers: ["arcane", "crystal_shield"] },
  { floor: 78, name: { th: "ทางช้างเผือก" }, modifiers: ["tough", "swift"] },
  { floor: 79, name: { th: "ซุ้มรัศมี" }, modifiers: ["mono_element", "disrupt"], element: "LIGHT" },
  { floor: 80, name: { th: "วิหารประภาสวรรค์" }, guardianTitle: { th: "ผู้ถือคบแสงสวรรค์" }, modifiers: ["venom", "regen", "disrupt"] },
  // ชั้น 81–90: แดนสนธยา (เงาและสุสาน)
  { floor: 81, name: { th: "ทางเงาเย็น" }, modifiers: ["reserves", "tough", "swift"] },
  { floor: 82, name: { th: "สุสานโคมดับ" }, modifiers: ["regen", "disrupt", "reserves"] },
  { floor: 83, name: { th: "ตรอกหมอกม่วง" }, modifiers: ["fierce", "venom", "regen"] },
  { floor: 84, name: { th: "สวนกุหลาบดำ" }, modifiers: ["arcane", "crystal_shield", "fierce"] },
  { floor: 85, name: { th: "ห้องกระจกเงา" }, modifiers: ["mono_element", "tough", "swift"], element: "SHADOW" },
  { floor: 86, name: { th: "บึงเงาจันทร์" }, modifiers: ["disrupt", "reserves", "tough"] },
  { floor: 87, name: { th: "หอระฆังสนธยา" }, modifiers: ["venom", "regen", "disrupt"] },
  { floor: 88, name: { th: "คุกใต้เงา" }, modifiers: ["crystal_shield", "fierce", "venom"] },
  { floor: 89, name: { th: "ประตูราตรี" }, modifiers: ["mono_element", "swift", "arcane"], element: "SHADOW" },
  { floor: 90, name: { th: "บัลลังก์สนธยา" }, guardianTitle: { th: "ผู้ครองแดนสนธยา" }, modifiers: ["reserves", "tough", "swift"] },
  // ชั้น 91–100: รอยแยกปฐมกาล (ธาตุแปรปรวน)
  { floor: 91, name: { th: "ขอบรอยแยก" }, modifiers: ["arcane", "crystal_shield", "fierce"] },
  { floor: 92, name: { th: "เศษดาวตก" }, modifiers: ["tough", "swift", "arcane"] },
  { floor: 93, name: { th: "ธารธาตุปั่นป่วน" }, modifiers: ["disrupt", "reserves", "tough"] },
  { floor: 94, name: { th: "ซากอารยธรรมแรก" }, modifiers: ["venom", "regen", "disrupt"] },
  { floor: 95, name: { th: "ห้องเวลาหยุดนิ่ง" }, modifiers: ["mono_element", "crystal_shield", "fierce"], element: "WATER" },
  { floor: 96, name: { th: "สะพานธาตุทั้งหก" }, modifiers: ["swift", "arcane", "crystal_shield"] },
  { floor: 97, name: { th: "ใจกลางพายุธาตุ" }, modifiers: ["reserves", "tough", "swift"] },
  { floor: 98, name: { th: "ประตูก่อนกาล" }, modifiers: ["regen", "disrupt", "reserves"] },
  { floor: 99, name: { th: "บันไดสุดท้าย" }, modifiers: ["mono_element", "fierce", "venom"], element: "WATER" },
  { floor: 100, name: { th: "ยอดรอยแยกปฐมกาล" }, guardianTitle: { th: "ผู้เฝ้ารอยแยกปฐมกาล" }, modifiers: ["arcane", "crystal_shield", "fierce"] },
  ],
};

/** The ten lands of the tower, ten floors each (for the panel). */
export const EXAMPLE_FRONTIER_LANDS: { fromFloor: number; name: string; theme: string }[] = [
  { fromFloor: 1, name: "สุวรรณทวาร", theme: "ทุ่งนาและนาค" },
  { fromFloor: 11, name: "ไพรเขียว", theme: "ป่าดึกดำบรรพ์" },
  { fromFloor: 21, name: "วารีนที", theme: "แม่น้ำและทะเล" },
  { fromFloor: 31, name: "อัคนีบุรี", theme: "เมืองเพลิง" },
  { fromFloor: 41, name: "ศิลาคีรี", theme: "ขุนเขาและเหมือง" },
  { fromFloor: 51, name: "วายุเวหา", theme: "ฟ้าและพายุ" },
  { fromFloor: 61, name: "อำพันทราย", theme: "ซากนครทะเลทราย" },
  { fromFloor: 71, name: "ประภาสวรรค์", theme: "วิหารแสง" },
  { fromFloor: 81, name: "แดนสนธยา", theme: "เงาและสุสาน" },
  { fromFloor: 91, name: "รอยแยกปฐมกาล", theme: "ธาตุแปรปรวน" },
];
