# สถานะงาน — Phase A + Battle settlement

อัปเดต: 3 ตุลาคม 2026 · ผู้ทำล่าสุด: Claude · ระยะ: **A — Design contracts** (บท13 §1) + ต่อ Battle DO กับ D1 ตามบท11 §3

ไฟล์นี้คือสถานะที่ใช้ส่งต่อระหว่าง Claude และ Codex ทุกงานที่จบให้แก้ไฟล์นี้ก่อน commit

Repo: https://github.com/dscary99-stack/Pixel-Game · Phase A merge แล้ว (PR #1) · งานล่าสุดอยู่บน branch `claude/project-thread-ektp0t`

## ทำแล้ว

| ส่วน | ไฟล์ | หมายเหตุ |
| --- | --- | --- |
| Config แยก C/P/O | `packages/shared/src/rules.ts` | ทุกค่ามี decision ID + status; OPEN เป็น `null`; ค่าทดสอบใส่ผ่าน `withFixtureOverrides` เท่านั้น |
| Schema/contract | `packages/shared/src/schemas.ts` | Species, MonsterInstance, Skill, Item, Equipment(12 ช่อง), Sigil, LootTable, SpawnEntry (zod) |
| Validators บท12 §5 | `packages/shared/src/validators.ts` | ทีม 5/ห้าม species ซ้ำ, ศัตรู ≤10, Sigil อาวุธ 4/อื่น 1, HEADGEAR 3 ช่อง, ชื่อซ้ำได้, two-hand, kit 3+1, loot 50–100 |
| สูตร Stat/Damage | `packages/shared/src/stats.ts`, `damage.ts` | P03/P04 ตรงตัวอย่างบท03 (312→173.33→217→325→195, เกราะ 20/33.33/50/66.67/80%, HP 10120) |
| Loot roll บท06 | `packages/shared/src/loot.ts` | Sigil ก่อน → ช่องปกติ → Auto ×0.70 ครั้งเดียว ไม่เติมช่อง → รวม ≤5 ชนิด |
| Combat kernel | `packages/shared/src/battle/` | deterministic, pure; SPD order + tie ด้วย server RNG; โจมตี/สกิล/ป้องกัน/ยา/จับ/ย้ายตำแหน่ง; melee ต้องตีแถวหน้า; entitlement `battle:enemy:defeated|captured` |
| Wire protocol | `packages/shared/src/protocol.ts` | `commandId`, `sessionGeneration`, `expectedStateVersion`; มี compile-time check ว่า schema ตรงกับ kernel |
| Battle authority | `apps/server/src/battle-room.ts` | owner จาก auth, session generation, idempotent commandId, STALE_STATE, เขียน state+events+คำตอบแบบ atomic ก่อน ack |
| Cloudflare | `apps/server/src/{index,battle-do,auth}.ts`, `wrangler.toml` | Worker + Battle Durable Object (SQLite-backed); dev-only header auth |
| D1 | `apps/server/migrations/0001_phase_a_core.sql`, `src/reward-ledger.ts` | receipt unique (entitlement, recipient), item ledger idempotent, companion Lv1/Bond 0, reservation ได้ 1 ไฟต์ค้างต่อบัญชี |
| Phaser client | `apps/client/` | ฉากต่อสู้ placeholder; local preview หรือคุยกับ `wrangler dev`; Auto หยุดเมื่อแท็บถูกซ่อน; โหมด server ใช้บัญชี dev ใหม่ทุกครั้งที่โหลดหน้า |
| Reservation lifecycle (D1) | `apps/server/migrations/0002_battle_settlement.sql`, `src/economy.ts` | `reserve` → `activate` → `settle` / `release`; ย้ายของในกระเป๋าต่อสู้ออกจาก inventory ด้วย ledger `reserve:<id>`, ล็อกคู่ใจ (`lock_ref`), 1 ไฟต์ค้างต่อบัญชี; ทุก batch มี guard + อ่านผลกลับ ไม่เชื่อว่า 0 แถว = ล้ม |
| Settlement outbox (DO) | `apps/server/src/battle-room.ts`, `battle-do.ts` | activation / entitlement ทุกตัว / settlement เขียนลง outbox ใน write เดียวกับคำสั่งที่สร้างมัน; DO alarm ส่งไป D1 พร้อม retry; settle รอจน entitlement ทุกตัวมี receipt (เช็กซ้ำใน SQL) |
| Reconciler | `apps/server/src/index.ts` (`scheduled`, cron ทุกนาที) | reservation ที่ค้าง `reserved` เกิน 2 นาที → ถาม DO ก่อน; DO ไม่มีไฟต์ → เขียน tombstone แล้วจึงคืนของ; ไฟต์ที่เริ่มแล้วไม่ถูกแตะ |

## ผลตรวจล่าสุด

- `npm run check` ผ่าน: typecheck 3 แพ็กเกจ, **102 tests ผ่าน** (shared 61, server 41), Vite build, `wrangler deploy --dry-run` (มี D1 binding + cron)
- Test ใหม่ (server +24): reserve ซ้ำไม่หักซ้ำ, id เดิม payload ต่าง → PAYLOAD_MISMATCH, ของไม่พอไม่เขียนอะไรเลย, จองพร้อมกัน 2 ไฟต์ได้ 1, คู่ใจไม่ใช่ของเรา/ล็อกอยู่ถูกปฏิเสธ, settle ก่อน activate ไม่ได้, settle รอ receipt, คืนของเกินที่จองไม่ได้, settle ล้มกลางทาง rollback ทั้งก้อน, release คืนครบครั้งเดียว, released แล้ว activate/settle ไม่ได้; outbox: D1 ล่ม → pending แล้วส่งครบครั้งเดียว, D1 commit แล้ว ack หาย → retry ได้ already_granted ไม่มี ledger ซ้ำ, grant ค้าง 1 ตัว → ไม่ settle, entitlement ถูกปฏิเสธ → failed + บัญชีถูกล็อกรอผู้ดูแล, probe ก่อน create → tombstone + create ไม่ได้อีก, probe หลัง create → ไม่คืนของ
- `npm run smoke:server` กับ `wrangler dev` (workerd + DO storage + D1 local หลัง `npm run db:migrate:local`): ของเดิมทั้งหมดผ่าน และ: ระหว่างไฟต์ inventory = 0 / reservation `active`, เปิดไฟต์ที่ 2 → `409 BATTLE_IN_PROGRESS`, จบไฟต์แล้ว alarm ส่งครบ `settled:true`, ยาที่ไม่ใช้กลับมา 2/3, loot ที่ฆ่าได้ก่อนแพ้ยังเข้ากระเป๋า, reservation `settled`
- Reconciler บน wrangler dev: ใส่ reservation กำพร้า (ไม่มี DO) ลง D1 local → `/dev/reconcile` คืนยา 3 ขวด สถานะ `released`
- ภาพหน้าจอ client ทั้งโหมด local preview และโหมดต่อ server แสดงผลได้ ไม่มี error ใน console

## สมมติฐานของต้นแบบ (ไม่ใช่คำตัดสิน)

| # | สมมติฐาน | อ้างอิง |
| --- | --- | --- |
| A1 | โจมตีพื้นฐาน = กายภาพ ×1.0 ธาตุ NEUTRAL | บท03 ไม่ได้ระบุ |
| A2 | ใช้ไอเทม/จับ/หนี ได้เฉพาะตัวละครผู้เล่น | ตีความตาราง "คำสั่ง" บท03 §2 |
| A3 | แถวศัตรู 2 แถว × 5 ช่อง (รวม 10) | C05; ฝั่งเรา 3/3 ตาม P15 |
| A4 | AI ศัตรูต้นแบบ: โจมตีพื้นฐานใส่เป้าที่ถูกกติกาแบบสุ่ม | — |
| A5 | Stat ศัตรู = `wildPrimaryStats` ของ species ผ่านสูตรเดียวกับผู้เล่น | P05 ยังไม่มีสูตร stat มอนสเตอร์ |
| A6 | สูตรจับใช้ status factor = 1 และ mastery = 1 (ยังไม่มีระบบ) | บท04 §3 |
| A7 | คู่ใจที่จับได้ Lv1 ทุก primary stat = 10 (ค่าเริ่ม P03) จนกว่าจะกำหนด growth weights | P05 / บท04 §4 |
| A8 | สุ่ม loot ตอนศัตรูล้ม (settle รายตัว) แล้วเก็บผลใน entitlement; ยังไม่มี EXP ใน entitlement | บท11 §3, ตาราง EXP ยังไม่มี |
| A9 | โอกาส hit/crit คิดเป็น basis points; damage ปัด half-up ครั้งเดียว | บท12 §3, P04 |
| A10 | Auto Battle เดินหนึ่ง action ต่อหนึ่ง request จาก client ที่เปิดอยู่ จึงไม่มีการเล่นตอนปิดเกม | C14 |
| A11 | ตารางธาตุบท02 อยู่ใต้ P04 | บท02, P04 |
| A12 | เพดานกระเป๋าต่อสู้ 8 ชนิด และ stack ตามบท03 §2 อยู่ใต้ P15 | บท03 §2 |
| A13 | สกิล Phase A เป็นเป้าเดี่ยว ผลเดียว | AoE/multi-hit ยังติด O15 |
| A14 | เลือก settle **รายศัตรู** (บท11 §3 ให้เลือก): entitlement ส่งทันทีที่ล้ม/จับ ส่วน settlement (คืนของ ปลดล็อก) ส่งตอนจบไฟต์และต้องรอ receipt ครบ | บท11 §3 |
| A15 | ยาที่ใช้ในไฟต์ไม่ถูกคืน ส่วนที่เหลือคืนตอน settle; ของในกระเป๋าออกจาก inventory ตั้งแต่จอง (ไม่ใช่หักตอนใช้) | บท11 §3 ข้อ 4, 8 |
| A16 | ยังไม่มีตารางตัวละคร จึงเก็บ HP/MP ตอนจบไว้ใน `battle_reservations.result_json` | บท03 §3 |
| A17 | ค่าปฏิบัติการ (ไม่ใช่กฎเกม): retry outbox ทุก 5 วินาที, reservation ค้างเกิน 2 นาทีจึงให้ reconciler ตรวจ | P11 |
| A18 | entitlement ที่ D1 ปฏิเสธ (payload ไม่ตรง) = `failed` หยุด settle และไม่ retry; บัญชีเปิดไฟต์ใหม่ไม่ได้จนผู้ดูแลจัดการ | บท11 §3 "ห้าม roll loot ใหม่" |

## OPEN ที่โค้ดคืน `UNRESOLVED_RULE` แทนการเลือกเอง

- **O07** ตารางโอกาสจับรายRank/HP factor → คำสั่งจับถูกปฏิเสธก่อนหักของ (dev/test ใช้ `DEV_FIXTURE_RULES`)
- **O15** จุดลด cooldown, สูตรหนี, revive, สกิลหลายผล/AoE, stalemate
- **O11** auth provider → นอก dev ทุก request ได้ 401
- `BattleRoom` ไม่ยอมรัน rules ที่มี fixture override นอก environment `dev`

O01–O04 (trade gap, effective level, Rebirth) ไม่เกี่ยวกับงานนี้ ยังไม่แตะ

## ยังไม่ทำ / ข้อจำกัด

- ยังไม่มี status effect (stun/sleep/poison), shield, passive/innate trigger, บอสหลาย action, AoE
- ยังไม่มี EXP/เลเวลอัป, Bond, Rebirth, อัปสกิล
- ยังไม่มี Map/Channel DO, การเดิน, encounter reservation; สร้างไฟต์ผ่าน endpoint dev ด้วยคอนเทนต์ EXAMPLE เท่านั้น
- ไฟต์ที่ถูกทิ้งกลางคัน (ปิดเกมไม่กลับมา) ค้าง `active` ตลอด บัญชีนั้นเปิดไฟต์ใหม่ไม่ได้ เพราะนโยบาย pause/disconnect (O11) และ stalemate/หนี (O15) ยังเปิดอยู่; client dev จึงใช้บัญชีใหม่ทุกครั้งที่โหลดหน้า
- ยังไม่มีเครื่องมือผู้ดูแลสำหรับ outbox `failed` (ดูได้จาก `view.settlement.failed` เท่านั้น)
- ยังไม่ล็อกอุปกรณ์ (ไม่มีตาราง equipment instance) และ setup คู่ใจยังไม่อ่าน snapshot จาก D1 (ล็อกตาม id อย่างเดียว); dev encounter ไม่มีคู่ใจ
- `grant` ยังไม่ตรวจว่า entitlement มาจากไฟต์ที่มี reservation ของผู้รับ (DO เป็นผู้เรียกคนเดียวผ่าน binding ภายใน)
- Cron reconciler ทดสอบผ่าน `/dev/reconcile` ไม่ได้รันผ่าน cron จริง
- SQL ทดสอบบน node:sqlite ไม่ใช่ D1 จริง; DO ทดสอบบน workerd ในเครื่อง ยังไม่ deploy; ไม่มี load test (P11)
- คอนเทนต์ตัวอย่างมี loot แค่ 4 ชนิดต่อ species จึงไม่ผ่าน validator 50–100 โดยตั้งใจ (ไม่สร้างของปลอมให้ผ่าน)
- ภาพเป็นกล่องสีแทนตัวละคร ยังไม่มี art proof (sprite 4 ทิศ + อุปกรณ์ 12 ชั้น) ซึ่งบท13 นับเป็นงาน Phase A ด้วย
- ตัวเลขบาลานซ์ยังไม่ผ่าน simulation; ไฟต์ dev ตัวอย่างผู้เล่น Lv10 คนเดียวแพ้ได้
- vitest ตรึงที่ 3.x เพราะ npm 10.9 ติดตั้ง vitest 4 ไม่ได้ในเครื่องนี้

## งานถัดไปที่แนะนำ

1. ตัดสิน O15 (cooldown tick, revive, หนี, status tick, stalemate) และ O11 (นโยบายหลุดกลางไฟต์) แล้วเพิ่ม status effects และทางปิดไฟต์ที่ถูกทิ้ง
2. Art proof หนึ่งตัวละคร 4 ทิศ + gear 12 layers (ส่วนที่เหลือของ Phase A ตามบท13)
3. Phase B: Map Channel DO, เดิน 2 ผู้เล่น, reconnect ไม่ซ้ำ; encounter จริงเรียก `reserve` แทน `dev-create`
4. ตาราง equipment instance + ล็อกอุปกรณ์ตอนจอง, อ่าน snapshot คู่ใจจาก D1
