# AGENTS.md — คำสั่งโครงการสำหรับ Claude และ Codex

## อ่านก่อนเริ่ม

1. `docs/GAME_DESIGN_MASTER.md` บท00 (CONFIRMED / PROVISIONAL / OPEN / EXAMPLE) แล้วเฉพาะบทที่เกี่ยวกับงาน
2. `docs/STATUS.md` — งานที่ทำแล้ว สมมติฐาน และข้อจำกัดล่าสุด
3. คำสั่งผู้ใช้ล่าสุดมีอำนาจเหนือเอกสาร

## โครงสร้าง

```
packages/shared   กฎทั้งหมด: rules (C/P/O), schemas, validators, damage, loot, battle kernel, protocol
apps/server       Cloudflare Worker + Battle Durable Object + D1 migrations (server-authoritative)
apps/client       Phaser 4 + Vite; วาดตาม event จาก server เท่านั้น
docs/             เอกสารออกแบบและสถานะ
```

สูตรมีแหล่งเดียวใน `packages/shared` ห้ามเขียนสูตรซ้ำใน client หรือ server

## คำสั่ง

```
npm install
npm run check          # typecheck + tests + build client + wrangler dry-run
npm test               # vitest
npm run dev:client     # http://127.0.0.1:5173 (local preview; หน้าแรก = เดินในแผนที่, ?battle = ฉากต่อสู้; ?server = ต่อ wrangler dev และต้องสร้างตัวละครก่อน)
npm run db:migrate:local  # ใส่ D1 migrations ลงฐานข้อมูล local ก่อน dev:server ครั้งแรก/หลังเพิ่ม migration
npm run dev:server     # wrangler dev :8787; เปิด client ด้วย ?server
npm run smoke:server   # end-to-end ไฟต์ กับ wrangler dev ที่รันอยู่
npm run smoke:world    # end-to-end การเดิน 2 ผู้เล่น (WebSocket) กับ wrangler dev ที่รันอยู่
npm run smoke:encounter # end-to-end เดินเข้าทุ่ง → สู้ฝูง → กลับที่เดิม (ไฟต์ส่วนตัว O05) → ฝูง Elite โชว์ความสามารถตรงกับในไฟต์ → สมุดบันทึกมีแผนที่/ชนิดที่พบ กับ wrangler dev
npm run smoke:character # end-to-end สร้างตัวละคร → เควสลับล็อก (`{locked:true}` ไม่มีข้อมูลอื่น) → dev เปิดดูได้ชุดเควส → จับคู่ใจ → จัดทีม → ตั้งชื่อเล่น → HP ติดตัว → แพ้กลับเมืองพัก → ปล่อยคู่ใจ กับ wrangler dev
npm run smoke:equipment # end-to-end ของเริ่มต้น (ธรรมดา ไม่มีออปชัน) → ใส่/ถอด → stat ในไฟต์ → ล็อกระหว่างไฟต์ กับ wrangler dev
npm run smoke:town     # end-to-end ใส่/ถอด Sigil (เสียเหรียญ ในเมือง) → ขาย/ซื้อของกับ NPC → สุ่มออปชันใหม่แล้วเลือก → สร้างโล่จากวัตถุดิบ (ความชำนาญเพิ่ม) → ส่งของงานสั่ง NPC → ล็อก/ขาย/ย่อยอุปกรณ์ → ในทุ่งถูกปฏิเสธ กับ wrangler dev
npm run smoke:progression # end-to-end ไฟต์ได้ EXP (ตัวละคร+คู่ใจ) → เลเวลอัป → ลงแต้มสเตตัส กับ wrangler dev
npm run smoke:auto        # end-to-end ล่าอัตโนมัติ: server เดินหาฝูง → สู้เอง (auto_hunt) → ไฟต์ถัดไป → หยุดแล้วได้สรุป → หลุดแล้วหยุด กับ wrangler dev
npm run smoke:party       # end-to-end ปาร์ตี้: ตั้ง/เข้าด้วยรหัส → เพื่อนในแผนที่เดียวกันที่เพิ่งสู้ให้โบนัส EXP/วัสดุตอนเริ่มไฟต์ → คนนอกปาร์ตี้ไม่ได้ กับ wrangler dev
npm run smoke:quest       # end-to-end เควส: กระดานรายวัน/สัปดาห์สุ่มครั้งเดียว → ส่งของที่บอร์ดในเมือง (ของถูกใช้ ได้รางวัลครั้งเดียว) → คราฟต์นับเข้าเควส → ยังไม่เสร็จ/รางวัลใหญ่ถูกปฏิเสธ กับ wrangler dev
npm run smoke:boss        # end-to-end บอสเจ้าถิ่น: เห็นบอสบนแผนที่ → ไกลเกินถูกปฏิเสธ → เดินไปท้าเอง → ไฟต์ส่วนตัวมีลูกน้อง/phase → แพ้แล้วท้าใหม่ได้ไฟต์ใหม่ กับ wrangler dev
```

## กติกาการแก้โค้ด

- ค่า CONFIRMED อยู่ใน `RULES.confirmed` ห้ามเปลี่ยนโดยไม่มีคำตัดสินใหม่จากผู้ใช้
- ค่า PROVISIONAL อยู่ใน `RULES.provisional` พร้อม P-id; เปลี่ยนได้แต่บันทึกเหตุผลใน `docs/STATUS.md`
- OPEN อยู่ใน `RULES.unresolved` เป็น `null`; โค้ดที่ต้องใช้ต้องคืน `UNRESOLVED_RULE` ใส่ค่าได้เฉพาะ test/dev ผ่าน `withFixtureOverrides` (server ปฏิเสธนอก dev)
- ห้ามเพิ่ม: energy/stamina, offline farming/income, auto capture, global farming reward cap, premium power, level override ตาม map, คู่ใจคงเลเวลป่า, species ซ้ำในทีม, จำกัดชื่อ Sigil ซ้ำ
- RNG, damage, loot, capture, ownership ตัดสินที่ server เท่านั้น; client ส่ง intent
- เงิน/ของ/คู่ใจ: ทุก mutation idempotent ด้วย operation/entitlement id และต้องมี concurrency/recovery test
- EXAMPLE content (`example: true`, `status: "draft"`) ห้าม publish และห้ามเติมของปลอมให้ผ่าน validator

## วงจรหนึ่งงาน

1. ทำงานบน branch แยก (`claude/...` หรือ `codex/...`); ถ้าทำพร้อมกันอย่าแก้ไฟล์เดียวกัน
2. แก้ schema/contract ก่อนหรือพร้อม logic
3. รัน `npm run check` ให้ผ่าน
4. อัปเดต `docs/STATUS.md` (ทำอะไร ตรวจอะไร สมมติฐานใหม่ ข้อจำกัด) แล้ว commit
