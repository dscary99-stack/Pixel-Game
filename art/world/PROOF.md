# World sprites — native pixel animation proof

2026-11-01 · `codex/world-sprites` · base `582c4d77c1359db7960cc16e7e5a7cb734ac1bf6`

ส่งงาน **173 PNG assets / 879 native frames / 162 animation clips** ใช้ palette 128 สีจาก `art/ui/cute-rebuild/palette.json` โดยไม่เปลี่ยน palette เดิม แสงด้านซ้ายบน รูปทรงกลม สีทองอุ่น coral mint lavender และเงา indigo ตาม cute v002

## Coverage

| ชุด | ส่งแล้ว |
|---|---|
| มอน 6 ชนิด | armor_crab, ember_fox, lantern_snail, supply_mole, bell_bird, crystal_crab_lord; battle idle/attack/cast/hurt/ko และ world idle/walk ครบ 4 ทิศ |
| ผู้เล่น human | battle ครบ 5 ท่า, world idle/walk 4 ทิศ; เพิ่ม body attack สำหรับธนูโดยเฉพาะ |
| อาวุธ 4 ตระกูล | physical_melee, physical_ranged, magic, support; ชั้นแยกครบทุกท่าของฐาน human ใช้ frame index เดียวกัน |
| NPC 14 คน | idle down 4 เฟรมครบทุก id ใน content/maps.ts |
| Tiles | เมือง/ทุ่ง ครบ 6 ชนิดตาม TILE_LEGEND, 16 neighbor masks ต่อชนิด, ชั้นบน tree/wall แยก, portal 4 เฟรม |
| ฉากไฟต์ | dawn_field, rift_tower, town_practice 960×540; ambient 6 เฟรมแบบชั้นแยกพร้อมตำแหน่งวาง |
| เงา | small 40×12 และ large 88×24 ใช้ร่วมกัน |

จำนวน frames รวมช่อง tileset ด้วย จึงไม่ใช่จำนวนเฟรมตัวละครอย่างเดียว งานเสริมที่ยังไม่ได้ทำ: ฐานเผ่าอีก 7 เผ่า และชั้นก้ามบอสที่แยกตีแตกได้ ปัจจุบันก้ามรวมในภาพบอส ไม่ได้แอบแทนด้วย sprite ก้ามที่ไม่ตรงท่า

## ดูภาพ

- เปิด `preview.html`: ภาพฉาก 1×, ลิงก์ 2×, GIF ทุกแอนิเมชัน และ PNG strip ต้นฉบับขนาดจริง
- `review/contact-battle-*.png`, `contact-world-*.png`, `contact-npc-*.png`: ตรวจทุกเฟรมตามลำดับ
- `review/contact-equipment-*.png` และ GIF composite: ตรวจมือกับอาวุธร่วมกัน
- `review/map-dawn_town-1x.png` / `map-dawn_field-1x.png`: วางจากตัวอักษรแผนที่จริง พร้อมตำแหน่ง NPC, spawn และ portal; ข้อมูลที่อ่านได้อยู่ใน `map-proof-data.json`
- `review/battle-*-6v10-1x.png` และ GIF: ทดสอบพื้นที่ 6 ต่อ 10 ตัว ระยะฝั่งศัตรู 76px; มี PNG 2× แบบ nearest-neighbor
- `review/battle-boss-reserved-slots-1x.png`: บอส 128px ใช้พื้นที่สงวน ไม่ย่อบอสลงเพื่อยัดในแถว 76px

ภาพเหล่านี้เป็น proof composition จากข้อมูลเกม ยังไม่ได้แก้ renderer หรือแทนสี่เหลี่ยมใน runtime

## Animation contract

| ท่า | เฟรม | fps | เล่น |
|---|---:|---:|---|
| idle | 4 | 6 | วน |
| walk | 4 ต่อทิศ | 8 | วน |
| attack | 6 | 10 | ครั้งเดียว; hitFrame 3 นับจาก 0 |
| cast | 6 | 10 | ครั้งเดียว; castFrame 3 |
| hurt | 2 | 8 | ครั้งเดียว |
| ko | 4 | 8 | ครั้งเดียว ค้างเฟรมสุดท้าย |

ท่าต่อสู้ยาวไม่เกิน 600ms; idle 667ms ตามจำนวนเฟรม/fps ที่ผู้ใช้ระบุ เฟรมแรกใช้เป็นภาพนิ่งได้ ทุกโลกมีภาพแยก up/right/down/left; สนามใช้ทิศขวาและ flip ทั้ง body/equipment พร้อมกัน ฝั่งมอนหน้ากลมบางท่าเป็นมุมสามส่วนค่อนไปด้านหน้า โดยท่าโจมตีออกทางขวา

## Export / QA

ภาพ master เป็นแหล่งออกแบบ ไม่ใช่ไฟล์ที่โหลดเข้าเกม Export ใช้ขนาด cell และ transform คงที่ต่อ atlas ตาม `source-layouts.json`; ไม่ trim/fit ตาม bounding box ของแต่ละเฟรม เฟรมหอยโจมตี 3–4 และตุ่นโจมตี 4 มี source-window registration ที่บันทึกไว้เพื่อกู้ส่วนที่ข้ามเส้น grid ของ master โดยใช้ขนาดหน้าต่างและ scale เดิม

ไฟล์เกมมี native cell คงที่, PNG RGBA, alpha 0/255, สีอยู่ใน palette เดิมทั้งหมด; ฉากหลังและพื้นปิดเต็มมี alpha 255 ตามหน้าที่ของภาพ ไม่มีตัวหนังสือใน game assets การแสดงผลใช้ 1× หรือ integer zoom; ห้าม smooth interpolation เงาใช้ binary alpha ในไฟล์และ renderAlpha 0.28 ตอนวาด

`qa-report.json` ตรวจ dimension/grid, alpha/palette, manifest, anchor, bounds, sequence/fps metadata, hitFrame, KO hold, body/equipment frame count, coverage และ GIF; ผล **pass, 0 failures, 0 warnings** ตรวจภาพ contact sheets และฉากรวมเพิ่มเติมด้วยตา แก้ขอบตัดในท่าโจมตี เศษจาก cell ข้างเคียง และท่าธนูที่เดิมไม่ตรงการยิงแล้ว ผลเชิงตัวเลขไม่ได้หมายความว่าอนุมัติภาพในเกมจริงแทนผู้ใช้

`npm run check` ผ่าน (typecheck, tests, client build, Worker dry-run); ไม่มี deploy ไม่แก้ source ใน apps/*/src หรือ packages ไม่ merge branch

## Rebuild

ต้องมี Python + Pillow รันจาก repo:

```sh
python art/world/build.py
python art/world/proof.py
npm run check
```

Master และ prompt/provenance อยู่ `masters/` และ `prompts/`; native exports อยู่ public; review/GIF/HTML อยู่ art เท่านั้น ดูวิธีต่อเกมใน `HANDOFF.md`
