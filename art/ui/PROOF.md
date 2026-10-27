# UI kit proof v001 — 27 ต.ค. 2026

ฐานงาน: `claude/project-thread-ektp0t` commit `115cc2414b583b3810b733916db7178bf5a0b92e` → `codex/ui-kit`.
อ่าน AGENTS.md, GAME_DESIGN_MASTER บท00, STATUS, ART_HANDOFF §1/6/7/9/11, GUI_SCREENS ทั้งไฟล์ และ ART_STYLE_AND_ANIMATION จาก `codex/art-style-animation-handoff`.

## สิ่งที่ส่ง (51 PNG)

| กลุ่ม | ไฟล์ | รายละเอียด |
|---|---:|---|
| หน้าต่าง | 3 | frame/background/title; source 48×48; frame/title 9-slice มุม 16×16 |
| ปุ่ม | 5 | source 64×48; normal/selected/primary/disabled/danger; ยืดแนวนอน ความสูง 48 |
| ช่องของ | 10 | 48×48 และ 64×64 × COMMON/UNCOMMON/RARE/EPIC/LEGENDARY |
| ป้ายล็อก | 1 | overlay 16×16; ไม่รวมกับช่อง จึงไม่ต้องทำทุก rarity ซ้ำ |
| แถบค่า | 18 | HP ฝ่ายเรา/MP/EXP/HP ศัตรู/ascend × สูง 4/6/8 + รางกลาง 3 ขนาด; source กว้าง 64 |
| คำสั่งต่อสู้ | 9 | attack/skill/guard/potion/revive/capture/flee/ascend/auto ทั้งหมด 24×24 |
| กลุ่มเมนู | 5 | character/companion/inventory/activities/social ทั้งหมด 24×24 |

ชื่อ semantic ใน manifest เป็น key ของงานภาพ ไม่ใช่การเพิ่ม enum คำสั่ง server: Claude map ให้ตรง protocol เอง selected ใช้ทั้งกด/เลือก; auto เป็นลูกศรวนพร้อม play ไม่มีคำว่า AUTO ฝังภาพ; capture เป็นวงเปิดกับอัญมณี ไม่มีการสร้างกลไก auto capture.

## ภาพสำหรับตรวจ
- `ui-preview-sheet-v001.png`: ครบทุกชิ้นบน #14121c พร้อมชื่อกำกับและไอคอนที่ 1×/3×
- `ui-layout-proof-960x540-v001.png`: ตัวอย่างการประกอบจริงที่ logical 960×540 (ไม่ใช่ภาพ capture จากเกม)
- `ui-icon-contrast-v001.png`: ตรวจขอบไอคอนบนพื้นสว่าง/มืดที่ 2×
- `reference/ui-style-reference-v001.png`: concept จาก image_gen ใช้อ้างอิงทิศทางภาพเท่านั้น ไม่อยู่ใน public

## สัญญาส่งต่อ Claude
PNG RGBA ขนาด native, alpha 0/255; ทุกไฟล์มี manifest ชื่อเดียวกันใน metadata และรวมชื่อใน index.json.
status=`grid_ready`, productionApproved=false, verifiedDisplaySizes ว่าง เพราะยังไม่ได้ต่อ Phaser/ตรวจมือถือจริง.
UI ใช้ origin [0,0], groundOffset 0 แทน origin ของตัวละคร; บันทึกข้อยกเว้นใน ART_HANDOFF §9.
9-slice ระบุขอบ left/right/top/bottom=16 พิกเซล: วางมุมโดยไม่ scale, ยืดแถบกลางด้วย nearest. อย่าขยาย bitmap ทั้งชิ้น.
Window frame เป็นแผงมีพื้นอยู่แล้ว; background เป็นสีพื้นเสริมสำหรับพื้นที่อื่น ส่วน title เป็นแถบที่เลือกวางด้านบนได้.
button contentInsets=[16,10,16,10]; textOffset ของ selected ลง 1px; label และ disabled reason มาจากเกม.
slot contentRect เว้นด้านละ 8px; จุดบอก rarity 1–5 เป็น cue เพิ่มจากสี ป้ายล็อกวางมุมล่างขวา inset2px. จัดตำแหน่งตัวเลขจำนวนใหม่เมื่อมี lock เพื่อไม่ชนกัน.
bar: วาดรางเต็มก่อน ยืด fill ไปขนาดเดียวกันแล้ว crop ทางขวาตามค่า; ที่ 0 ไม่วาด fill. ขอบบนล่างโปร่ง1px, ความสูงในชื่อคือความสูง PNG รวมขอบ ไม่ใช่ความสูงสีด้านใน. ห้ามเอา fill ไป stretch ตามค่าเปอร์เซ็นต์.
icon 24px เป็นภาพภายในปุ่ม/พื้นที่สัมผัสอย่างน้อย48px ไม่ใช่ hitbox 24px.
ไม่ฝังข้อความหรือจำนวนใน asset; ข้อความภาษาอังกฤษบนภาพ proof เป็น annotation เท่านั้น ไม่ใช่ฟอนต์ไทยของเกม.

## ครอบคลุมหน้าจอ
- Login / select / create character: window + buttons (danger สำหรับลบ) — ภาพหน้าเกม/portrait/class/race ยังไม่ทำ
- World + HUD: window/background/title + bars + menu 5 กลุ่ม
- Battle: buttons + 9 commands + bars — status/target ring/damage numbers ยังไม่ทำ
- Results / companion team / equipment / shop-market-vault: window/buttons/rarity slots/lock/bars; item art และ portrait ยังไม่ทำ

## ที่มาและการทำซ้ำ
สไตล์ต่อจาก ART_STYLE: ขอบ navy/plum เข้ม, กลุ่มสีชัด, ไม่มี blur, แสงขอบบนซ้าย, แต้มทองเก่าเล็กน้อย. concept ใช้ built-in image_gen; native geometry/icon contours ถูกวาดใหม่ด้วยพิกัด integer ใน `build_ui_kit.py` ไม่ได้ย่อ concept ทั้งแผ่นและไม่ดึง art จากเกมอื่น.
ไฟล์ public เป็น asset ที่ทำขึ้นสำหรับ proof นี้ ไม่ใช่ EXAMPLE gameplay content และไม่เพิ่ม stats/id เกม.
Python 3.10+ และ Pillow; รันจากที่ไหนก็ได้:
```
python art/ui/build_ui_kit.py
python art/ui/validate_ui_kit.py
```
generator เขียนทับเฉพาะไฟล์ v001 ที่มันเป็นเจ้าของ; หากจะทำเวอร์ชันใหม่ให้เปลี่ยนชื่อ/เวอร์ชันก่อน. รักษา index รายการอื่นไว้.

## ผลตรวจและข้อจำกัด
- 51 PNG ขนาด/ชื่อ/hash/manifest/index ตรงกัน; alpha binary; จำนวนเฟรม 1.
- 9-slice ตรวจความต่อเนื่องแกนที่ยืด และเทียบ 4 มุม16×16กับภาพ proof ที่ประกอบจริง: ผ่าน.
- เปิดตรวจ native sheet, ภาพประกอบ960×540 และพื้นสว่าง/มืดแล้ว: ไอคอนแยก silhouette กัน, กรอบมุมไม่บิด, พื้น label ว่าง.
- `npm run check`: ผ่าน typecheck, Vitest, Vite client build และ Wrangler dry-run (ไม่ deploy). มี warning เดิมเรื่อง bundle size, annotation ของ zod และ Wrangler environment.
- ลิงก์ Claude artifact เปิดไม่ได้ผ่านเครื่องมือที่มี จึงอ้างอิง layout จากเอกสาร ไม่อ้างว่าเทียบภาพร่างทุกพิกเซลแล้ว.
- ยังไม่ได้ตรวจใน Phaser จริงหรือ FIT มือถือ; ให้ผู้ใช้ตรวจ proof และ Claude เชื่อมก่อนยกระดับสถานะ. ไม่มีการแก้ runtime source ใน apps หรือ packages.

## งานรอบถัดไปที่ยังไม่ทำ
ไอคอนสถานะ24แบบ (หัวข้อ11เสนอ16×16), ธาตุ, อาชีพ/เผ่า, ไอคอนไอเทม, ตัวเลขเด้ง, วงเลือกเป้า, ภาพหน้าเกม/โลโก้, portrait และไอคอนเมนูรายหน้าต่าง21หน้า.

