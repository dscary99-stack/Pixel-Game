> Proof 01 was rejected for visual quality. See [rebuild v003](rebuild-v003/README.md) and [new preview](rebuild-v003/preview.html). The content below is retained as history.

# Player layers — proof 01

2 พ.ย. 2026 · branch `codex/player-layers` · base `682d3c0`

ส่งเฉพาะลำดับแรกที่นัทกำหนด: **human v002 + ผม01 back/front + หน้า01 v001** รวม **56 sheets / 240 frame slots** ครบ14คลิปต่อชั้น ยังไม่เริ่มผม02–08 หน้า02–06 และฐานอีก7เผ่า เพราะผู้ใช้กำหนดให้ดู proof นี้ก่อน

## ดูงาน

เปิด `preview.html` หรือภาพใน `review/`:

- `battle-proof-1x.png`, `battle-proof-2x.png`: idle, attack, attack_physical_ranged, cast, hurt, ko ทุกเฟรม
- `world-proof-1x.png`, `world-proof-2x.png`: idle/walk ครบ down/left/right/up
- `skin6-hair10-1x.png`, `skin6-hair10-2x.png`: 60ชุดสีตาม `appearance.ts` จริง แถว S01–06=สีผิว, คอลัมน์ H01–10=สีผม ไม่ได้วาดสีสำเนาเข้า public
- `stack-order.png`: ผมหลัง → ตัวฐาน → หน้า → ผมหน้า
- `body-layers.png` และภาพ layer อื่น: ตรวจฐานหัวโล้น สี key และส่วนโปร่งใส
- GIF ทุก composite clip และ GIF อาวุธ4ตระกูล; ปุ่ม Replay ในหน้า preview เล่นท่าครั้งเดียวซ้ำได้

ภาพรวมใช้ผิว02/ผม03/ตา02/ขอบชุด WIND เพื่อเทียบสีทองและผ้าสีมิ้นต์เดิม ส่วนเกมยังเลือกค่า default จาก appearance.ts ตามเดิม ตารางใช้สีผิว6และสีผม10ครบ

## ไฟล์และระบบโหลด

PNG อยู่ `apps/client/public/assets/sprites/characters/` ทุกชั้น64×64 origin[0.5,1], groundOffset4, headOffset[0,0] Metadata ต่อไฟล์และ index เพิ่มแล้ว; index เปลี่ยน human14รายการจากv001ไปv002 โดยเก็บไฟล์v001เดิมไว้ ชื่อ texture key เดิมไม่เปลี่ยน ชื่อใหม่ใช้ hair_01_back / hair_01_front / face_01 ตาม §12 รวมคลิป attack_physical_ranged ทั้ง4ชั้น

ทุกคลิปคัดจำนวนเฟรม/fps/loop/eventsจากฐานเดิม: idle4@6, walk4@8, attack/cast6@10, hurt2@8, ko4@8ค้างท้าย; hitFrame3นับจาก0 หน้า hurt หยีตา, ko ตาX; หน้า up เป็น PNG โปร่งใส4ช่องโดยตั้งใจ ไม่ใช่ไฟล์หาย

GIF ใช้ความละเอียดเวลา10ms จึงกระจายระยะถือเฟรม เช่น120/130msสำหรับ8fps; metadataเกมยังใช้fpsตรงตัว ไม่ใช้ค่าเวลาGIFแทน

ผมสั้นใช้ rear volume เต็มด้านหลังฐาน และชั้น front เฉพาะส่วนที่บังหัว ไม่มีการใส่เส้นขอบเพิ่มตามรอยแบ่งชั้น ในทิศ up ส่วนหมวกผมที่ทับหัวโล้นอยู่ front เพื่อให้ถูกลำดับวาดของ renderer ส่วนปลายผมด้านนอกอยู่ back ทุกส่วนใช้ attachment/rotation เดียวกัน

ยังไม่แก้ apps/*/src หรือ packages และไม่ merge การทดสอบจริงกับตัวเลือกผม/หน้าที่ไม่มีภาพยังข้ามชั้นตาม renderer เดิม ดังนั้น branch นี้มีไว้ review hair01/face01 ก่อนส่งชุดที่เหลือ

## สี key และการสร้าง

ใช้ RGB/alpha255 ตาม §12 ตรงตัว ผิวบนหัว/หู/มือ, ผมเฉพาะชั้นผม, ตาเฉพาะ iris, trim บนผ้าพันคอ/ขอบชุด เส้นขอบและเงาลึกยังใช้ cute palette ปกติ สี key ที่ไม่อยู่ใน palette128เดิมเป็นข้อยกเว้นตามระบบ recolour ใหม่ ไม่แก้ palette.json

Generated masters สองแผ่นอยู่ `masters/`; prompt/provenance อยู่ `provenance.json` ส่วนแขน/ขา/ชุดอาศัยภาพ human v001 ที่วาดไว้แล้ว ไม่สร้างท่าเดินด้วยการเลื่อนทั้งตัวเฉยๆ Native head components ใช้ transform1/16เดียวกันตลอด ไม่ trim หรือ scale รายเฟรม; ผมเลื่อนต้นแบบขึ้น5pxก่อนประกอบ

`source/head-rig.json` เป็นตำแหน่งหัว/มุม/ทิศรายเฟรมที่ใช้จริง เป็นมาตรฐานให้เผ่าถัดไปใช้เหมือนกันทุกเฟรม และต่างได้เพียง headOffset คงที่ `head-regions.json` เป็น candidate regions ของภาพเก่า; ค่าที่แก้ตรวจจริงอยู่ใน build.py/rig ตัวฐานลบผมและหน้าเก่า เติมหัวโล้นที่มีผิวซ่อนใต้ผม แล้วลงสี key ด้วย semantic masks

ผม/หน้าเป็นชิ้นส่วนติดหัว บางช่วงจึงถือ cel เดิมตามฐานที่หยุดนิ่ง รายงาน QA แยก frame slots กับ uniqueCels; หน้า up มี unique transparent cel เดียวแต่ส่ง4ช่องให้เล่นนาฬิกาเดียวกัน ไม่อ้างว่าเป็น240ท่าวาดใหม่ทั้งหมด

```sh
python art/player-layers/build.py
python art/player-layers/proof.py
npm run check
```

## ผลตรวจ

- Native QA ผ่าน56ไฟล์: ขนาด, alpha0/255, palette+keyตรงตัว, foreign key, skin/trimนอกmask, หน้าอยู่นอกหัว, ขอบcanvas, metadata/index, timing, frame order, hitFrame และ KO hold
- ตรวจภาพซ้อนทุกเฟรม ทั้งไฟต์และโลก4ทิศ รวมการหันหัวในท่าKOและชั้นอาวุธเดิม ปรับหน้าม้า/ดวงตาและรอยต่อKOจาก proof แรกแล้ว
- `npm run check` ผ่าน typecheck, tests, client build และ Worker dry-run; ไม่ deploy
- `grid_ready` หมายถึงไฟล์พร้อมให้ loader อ่าน การยืนยันว่ารูปลักษณ์ผ่านเป็นขั้น review ของนัทก่อนทำชุดที่เหลือ
