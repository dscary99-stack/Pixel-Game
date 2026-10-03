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
npm run dev:client     # http://127.0.0.1:5173 (local preview; หน้าแรก = เดินในแผนที่, ?battle = ฉากต่อสู้)
npm run db:migrate:local  # ใส่ D1 migrations ลงฐานข้อมูล local ก่อน dev:server ครั้งแรก/หลังเพิ่ม migration
npm run dev:server     # wrangler dev :8787; เปิด client ด้วย ?server
npm run smoke:server   # end-to-end ไฟต์ กับ wrangler dev ที่รันอยู่
npm run smoke:world    # end-to-end การเดิน 2 ผู้เล่น (WebSocket) กับ wrangler dev ที่รันอยู่
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
