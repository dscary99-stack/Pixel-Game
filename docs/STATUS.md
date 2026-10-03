# สถานะงาน — Phase A + Battle settlement + Phase B (walking slice) + Phase C แรก (encounter)

อัปเดต: 3 ตุลาคม 2026 · ผู้ทำล่าสุด: Claude · ระยะ: **C แรก — เจอฝูงในทุ่ง → สู้ → กลับที่เดิม** (บท07 §3, บท11 §3 ข้อ 1) ต่อจาก B

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
| Map/การเดิน (shared) | `packages/shared/src/world/{map,movement,channel}.ts` | schema แผนที่ + validator, ตรวจก้าวละ 1 ช่อง 8 ทิศ (ชนกำแพง/น้ำ/ต้นไม้, ห้ามตัดมุม, ห้ามเร็วกว่าความเร็วเดิน), BFS สำหรับคลิกเดิน, `MapChannel` (presence 1 ต่อบัญชีต่อ channel) + wire protocol |
| แผนที่ตัวอย่าง | `packages/shared/src/content/maps.ts` | EXAMPLE 2 แผนที่ (หมู่บ้าน + ทุ่ง) เชื่อมด้วยประตู; `draft/example:true` |
| Map Channel DO | `apps/server/src/map-do.ts` | 1 object ต่อ map+channel, WebSocket Hibernation (presence อยู่ใน attachment), ส่ง joined/moved/left ให้คนอื่น, เชื่อมซ้ำบัญชีเดิม → แทนที่ไม่ซ้ำ, เปลี่ยน channel → channel เก่า evict + บันทึกตำแหน่งก่อน, ประตู → ย้ายตำแหน่งใน D1 แล้วสั่ง transfer |
| ตำแหน่งใน D1 | `apps/server/migrations/0003_player_positions.sql`, `src/world-store.ts` | ตำแหน่งจริงของตัวละคร + `generation` (เชื่อมใหม่ = gen ใหม่; connection เก่าบันทึกทับไม่ได้); ตัวละครใหม่เกิดที่หมู่บ้านเท่านั้น; ขอเข้าแผนที่อื่นที่ไม่ได้อยู่ → ถูกส่งกลับ (กันวาร์ป) |
| Worker | `apps/server/src/index.ts` | `GET /world/where`, `GET /world/:map/:channel` (WebSocket); dev รับ `?dev_account=` เพราะ browser ใส่ header ใน WebSocket ไม่ได้ |
| Phaser world scene | `apps/client/src/world-{scene,transport}.ts` | หน้าแรกคือการเดิน (`?battle` = ฉากต่อสู้เดิม); ลูกศร/WASD/คลิก, predict ก้าวตัวเองแล้ว snap กลับเมื่อ server ปฏิเสธ, กด 1/2 เปลี่ยน channel; `?server&account=ชื่อ` เปิดหลายแท็บเห็นกัน |
| คำตัดสิน O05 | `rules.ts` (`RULES.confirmed.privateEncounters`), `GAME_DESIGN_MASTER.md` | ผู้ใช้ตัดสิน 3 ต.ค. 2026: ทุกคนเห็นฝูงเดียวกัน ใครกดเข้าก็ได้ไฟต์ส่วนตัว ไม่แย่งตัว |
| จุดเกิดฝูง (shared) | `packages/shared/src/world/{map,encounter}.ts` | `SpawnPoint` ในแผนที่ + validator (เมืองห้ามมีฝูง, ≤10 ตัว C05, species/ธาตุต้องมีจริง C07); `rollPack` ด้วย RNG ของ server, `visiblePack` (หัวฝูง Lv/ธาตุ, Rank, ช่วงจำนวน), `packEnemies` (จัดแถว), `defaultCombatBag`, รอบ respawn |
| Encounter ใน Map DO | `apps/server/src/map-do.ts` | สุ่มฝูงครั้งเดียวต่อรอบเก็บใน DO storage (โหลดใหม่ไม่สุ่มใหม่); `engage` ตรวจเมือง/ระยะ/ฝูงมีจริง/เคยสู้ → จองไฟต์ใน D1 → reserve กระเป๋า → สร้าง Battle DO จาก roster เดิม; ระหว่างไฟต์เดินไม่ได้ (`IN_BATTLE`); เชื่อมใหม่กลางไฟต์ได้ไฟต์เดิมคืน; `resume` ถาม Battle DO ว่าจบจริงก่อนให้เดิน |
| สิทธิ์ไฟต์ใน D1 | `apps/server/migrations/0004_encounter_claims.sql`, `src/encounter-store.ts` | 1 แถวต่อ (บัญชี, ฝูงรอบนั้น), battle id คำนวณจากคู่นี้ → กดซ้ำ/retry ได้ไฟต์เดิม; ฝูงที่สู้แล้วซ่อนเฉพาะคนนั้นจนรอบถัดไป |
| ตัวละครแทน (dev) | `packages/shared/src/dev-fixtures.ts` (`devPlayer`, `DEV_STARTER_ITEMS`) | ยังไม่มีตารางตัวละคร: dev ใช้ผู้เล่น Lv10 คงที่ + ของเริ่มต้น; นอก dev `engage` ตอบ `NO_CHARACTER` |
| Client เดิน ↔ สู้ | `apps/client/src/{world-scene,world-transport,battle-scene,transport}.ts` | วาดฝูง (สีธาตุหัวฝูง, ชื่อ Lv จำนวน), คลิกฝูง → เดินไปข้าง ๆ แล้วขอสู้; ฉากต่อสู้ต่อไฟต์ที่ server สร้าง (attach); จบแล้วปุ่ม "กลับไปเดินต่อ"; โหมด local preview สุ่มฝูง/สู้ในเบราว์เซอร์ได้ (ไม่บันทึก) |
| Reconciler | `apps/server/src/index.ts` (`scheduled`, cron ทุกนาที) | reservation ที่ค้าง `reserved` เกิน 2 นาที → ถาม DO ก่อน; DO ไม่มีไฟต์ → เขียน tombstone แล้วจึงคืนของ; ไฟต์ที่เริ่มแล้วไม่ถูกแตะ |

## ผลตรวจล่าสุด

- `npm run check` ผ่าน: typecheck 3 แพ็กเกจ, **142 tests ผ่าน** (shared 88, server 54), Vite build, `wrangler deploy --dry-run` (D1 + BATTLE + MAP + cron)
- Test ใหม่ Phase C (+15): validator จับฝูงในเมือง/id ซ้ำ/ยืนบนกำแพง/min>max/เกิน 10 ตัว/species ไม่มี/ธาตุที่ species เป็นไม่ได้, จำนวนและธาตุที่สุ่มอยู่ในช่วง, หัวฝูงที่เห็น = ตัวแรกในไฟต์, จัดแถวผ่าน validator ทุกขนาด 1–10, รอบ respawn, ระยะ engage และห้ามในเมือง, กระเป๋าเริ่มต้นตามเพดาน P15, เดินระหว่างไฟต์ถูก `correct`; D1: ฝูงเดียวกันให้ไฟต์คนละอันต่อผู้เล่น, claim ซ้ำ/พร้อมกันได้แถวเดียว roster เดิม, นับว่าสู้แล้วเมื่อมี reservation เท่านั้น, ไฟต์ที่ถูก release ยังซ่อนฝูงและไม่ค้าง
- `npm run smoke:encounter` (ใหม่) กับ `wrangler dev`: ขอสู้ในเมือง → `NO_HUNT_HERE`, A/B เห็นฝูงชุดเดียวกัน, ไกลเกิน → `TOO_FAR`, เดินไปข้างฝูงแล้วได้ไฟต์, ฝูงหายจากจอ A แต่ B ยังเห็น และ B กดได้ไฟต์ของตัวเอง (battle id ต่างกัน), เดินระหว่างไฟต์ → `IN_BATTLE`, กดซ้ำได้ไฟต์เดิม, รีโหลดกลางไฟต์ได้ไฟต์คืนที่ตำแหน่งเดิม, ขอกลับก่อนจบ → `IN_BATTLE`, ศัตรูหัวฝูงตรงกับที่เห็น, Auto จบ `victory`, settle ครบ ของเข้า inventory (`item:crab_shell`×2), กลับมาเดินต่อจากช่องเดิม, ขอสู้ฝูงเดิมซ้ำ → `NO_SUCH_PACK`; `smoke:world` และ `smoke:server` ยังผ่าน
- ภาพหน้าจอ 2 ผู้เล่นโหมด server (`/mnt/project-files/pixel-game-screenshots/hunt-*.png`): เห็นฝูง 3 ฝูง, คลิกฝูง → เดินไปแล้วเข้าฉากต่อสู้, Auto ชนะ, อีกคนยังเห็นฝูงนั้น, กดกลับแล้วอยู่ที่เดิมและฝูงที่สู้แล้วหายจากจอเรา; โหมด local preview ก็เดิน→สู้→กลับได้; ไม่มี console error
- Test ใหม่ Phase B (+25): แผนที่ตัวอย่างผ่าน validator และ validator จับแผนที่เสีย, ชนกำแพง/น้ำ, ห้ามตัดมุม, speed hack 40 ก้าวพร้อมกันผ่านแค่ 3, ยืนนิ่งนานไม่สะสมก้าว, เดินจริง 400 ก้าวมี jitter ±100ms ผ่านทุกก้าว, BFS ใช้กฎเดียวกับ server, 2 คนเห็นกัน join/move/leave, เชื่อมซ้ำไม่เพิ่มผู้เล่น, seq ซ้ำไม่ขยับ, ข้อความผิดรูปแบบ, channel เต็ม; D1: ตัวละครใหม่เกิดที่เมืองเท่านั้น, เข้าแผนที่อื่นไม่ได้, reconnect ได้ตำแหน่งเดิม, connection เก่าบันทึก/ผ่านประตูไม่ได้, ประตูย้ายแผนที่, ช่องที่บันทึกเดินไม่ได้แล้ว → spawn, join พร้อมกัน 2 channel เหลือ gen ปัจจุบันเดียว
- `npm run smoke:world` กับ `wrangler dev` (WebSocket จริง + Map DO + D1 local): A/B เห็นกัน, B เห็น A เดิน, ชนกำแพงถูก `correct`, speed hack 20 ก้าวผ่าน 3, ข้อความขยะ → `INVALID_MESSAGE`, ขอเข้าทุ่งทั้งที่อยู่เมือง → `transfer` กลับเมือง, เชื่อมซ้ำ → อันเก่า `REPLACED` ตำแหน่ง/sid เดิม B ไม่เห็นคนเพิ่ม, เปลี่ยน channel → อันเก่า `EVICTED` B เห็น A ออก ตำแหน่งเดิม, เดินเข้าประตู → ถึงทุ่งที่ (1,8), ออกแล้วกลับเข้าได้ตำแหน่งเดิม, ไม่มี auth → 401
- ภาพหน้าจอ 2 แท็บ (Playwright + Chromium) โหมด server: เห็นกันทั้งสองฝั่ง, คลิกเดินผ่านประตูไปทุ่งได้, ไม่มี console error (`/mnt/project-files/pixel-game-screenshots/world-*.png`)
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
| A19 | โลกเป็น grid ช่องละ 32px เดินทีละช่อง 8 ทิศ 4 ช่อง/วินาที ทแยง ×√2; ภาพตัวละครยังเป็นกรอบ 64px ตาม P10 | `worldTileSizePx`, `walkStepMs`, `diagonalStepFactor` (P10) |
| A20 | ก้าวมาก่อนเวลาได้ไม่เกิน 500ms (jitter) แต่ยืนนิ่งไม่สะสมก้าว | `moveBurstMs` (P11) |
| A21 | ผู้เล่นเดินทะลุกันได้ ไม่มีการชนระหว่างผู้เล่น | บท07 ไม่ได้ระบุ |
| A22 | 2 channel ต่อแผนที่ 50 คนต่อ channel; ผ่านประตูแล้วได้ channel เลขเดิมในแผนที่ใหม่ | `channelsPerMap`, `channelCapacity` (P11) |
| A23 | บันทึกตำแหน่งลง D1 ตอนออก/ผ่านประตู/เปลี่ยน channel และทุก 10 วินาทีถ้าขยับ; DO ล่มกลางทาง → ย้อนได้ไม่เกิน 10 วินาที | `positionSaveIntervalMs` (P11) |
| A24 | ชื่อที่คนอื่นเห็นตอนนี้คือ account id ตัด `acct:` (ยังไม่มีชื่อตัวละคร); คนอื่นไม่เห็น account id จริง ได้แค่ `sid` สุ่ม | Phase D |
| A25 | ฝูงเกิดใหม่ทุก 60 วินาที (รอบตามนาฬิกา server ทั้ง channel); ฝูงที่เราสู้แล้วซ่อนเฉพาะเราจนรอบถัดไป ไม่มี daily cap | `packRespawnMs` (P12) |
| A26 | ต้องยืนติดฝูง (ห่าง ≤1 ช่องรวมทแยง) จึงกดสู้ได้; server ตรวจระยะจากตำแหน่งจริง | `engageRangeTiles` (P10) |
| A27 | ฝูงตัวอย่าง 1–2 ตัว (หอย 1 ตัว), Rank NORMAL ทั้งหมด, หัวฝูง = ตัวแรกที่สุ่มและอยู่แถวหน้ากลาง | EXAMPLE content |
| A28 | ยังไม่มีหน้าเลือกของ: กระเป๋าต่อสู้ = ของที่มีจริง เรียง heal → capture → revive → support → attack ตามเพดาน P15 | `defaultCombatBag` |
| A29 | ฝูงถูกสุ่มเมื่อมีคนใน channel ต้องใช้ (ไม่ใช่ทุกรอบตลอดเวลา) และเก็บใน DO storage; DO รีสตาร์ทกลางรอบได้ฝูงเดิม | บท11 §1 |

## OPEN ที่โค้ดคืน `UNRESOLVED_RULE` แทนการเลือกเอง

- **O07** ตารางโอกาสจับรายRank/HP factor → คำสั่งจับถูกปฏิเสธก่อนหักของ (dev/test ใช้ `DEV_FIXTURE_RULES`)
- **O15** จุดลด cooldown, สูตรหนี, revive, สกิลหลายผล/AoE, stalemate
- **O11** auth provider → นอก dev ทุก request ได้ 401
- `BattleRoom` ไม่ยอมรัน rules ที่มี fixture override นอก environment `dev`

O01–O04 (trade gap, effective level, Rebirth) ไม่เกี่ยวกับงานนี้ ยังไม่แตะ

## ยังไม่ทำ / ข้อจำกัด

- ยังไม่มี status effect (stun/sleep/poison), shield, passive/innate trigger, บอสหลาย action, AoE
- ยังไม่มี EXP/เลเวลอัป, Bond, Rebirth, อัปสกิล
- Encounter ใช้ได้เฉพาะ dev: ยังไม่มีตารางตัวละคร (Phase D) จึงสู้ด้วยตัวละครแทน Lv10 ไม่มีคู่ใจ; HP/MP หลังไฟต์ไม่ติดตัวกลับมา (เก็บแค่ใน `result_json`)
- ยังไม่มี Auto Hunt (เดินหาฝูงเอง), EXP, ฝูง ELITE/บอส, ฝูงเดินไปมา; ฝูงยืนที่จุดเกิดคงที่
- คอนเทนต์ฝูงเป็น EXAMPLE (`draft`) ห้าม publish
- ยังไม่มี interest area: ทุกคนใน channel ได้ข่าวทุกการขยับ (พอสำหรับ 50 คน/แผนที่เล็ก ไม่ใช่ขนาด MMO)
- ยังไม่มี rate limit ของข้อความ WebSocket นอกจากกฎความเร็วเดิน; ไม่มี heartbeat timeout ของ server (ใช้ close ของ WebSocket)
- ยังไม่มีชื่อตัวละคร/ตัวละครหลายตัวต่อบัญชี (O10), ไม่มีการเลือก channel อัตโนมัติเมื่อเต็ม
- ภาพโลกเป็นสี่เหลี่ยมสีตาม tile ยังไม่มี tileset, y-sort จริง, occlusion (บท10 §2)
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

1. Phase D แรก: ตารางตัวละคร (stat, เลเวล, HP ที่ติดตัว, คู่ใจในทีม) แทนตัวละคร dev เพื่อให้ encounter ใช้นอก dev ได้ แล้วเพิ่ม EXP หลังไฟต์ (ต้องมีตาราง EXP)
2. ตัดสิน O15 (cooldown tick, revive, หนี, status tick, stalemate) และ O11 (นโยบายหลุดกลางไฟต์) แล้วเพิ่ม status effects และทางปิดไฟต์ที่ถูกทิ้ง
3. Art proof หนึ่งตัวละคร 4 ทิศ + gear 12 layers + tileset หนึ่งชุด (บท10, ค้างจาก Phase A)
4. ตาราง equipment instance + ล็อกอุปกรณ์ตอนจอง, อ่าน snapshot คู่ใจจาก D1
