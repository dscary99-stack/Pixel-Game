# สถานะงาน — Phase A + Battle settlement + Phase B (walking slice) + Phase C แรก (encounter) + Phase D แรก (ตัวละคร + อุปกรณ์ + Sigil/เหรียญ + EXP/เลเวล)

อัปเดต: 3 ตุลาคม 2026 · ผู้ทำล่าสุด: Claude · ระยะ: **D แรก — ตัวละคร ทีม อุปกรณ์ 12 ช่อง, Sigil, เหรียญ และ EXP/เลเวล/แต้มสเตตัสที่บันทึกจริง** (บท02, บท03 §3–§4, บท05, บท06, บท13 §1 D) ต่อจาก C แรก

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
| ตัวละคร (shared) | `packages/shared/src/character.ts` | อาชีพ Class1 9 แบบ + เผ่า 8 แบบตามแบบร่าง P16 (id/ชื่อเท่านั้น), ธาตุเริ่ม 6 แบบ, schema สร้างตัว/ตั้งทีม, `teamFormation` (หน้า 3 หลัง 3, ผู้เล่นหน้ากลาง, tank/physical ยืนหน้า), `playerSetup`/`companionSetups` สร้างหน่วยในไฟต์จากข้อมูลที่บันทึก |
| ตัวละครใน D1 | `apps/server/migrations/0005_characters.sql`, `src/character-store.ts` | `characters` (1 ตัวต่อบัญชีจนกว่า O10 จะตัดสิน, Lv1 สเตตัส 10 ทุกค่า, HP/MP ปัจจุบัน NULL=เต็ม, version) + `character_team` (≤5, UNIQUE species กัน C04 ใน DB ด้วย) + HP/MP ใน `monster_instances`; สร้างตัว idempotent ด้วย operationId; ตั้งทีมตรวจ version/เจ้าของ/C04/ห้ามระหว่างไฟต์ใน batch เดียว |
| HP ติดตัว + พัก | `src/economy.ts` (`settle`), `src/map-do.ts` | settle เขียน HP/MP ของตัวละคร (เฉพาะที่ระบุใน reservation) และคู่ใจที่ล็อกกับไฟต์นั้น ใน batch เดียวกับการคืนของ; เข้าหมู่บ้าน = พักฟื้นเต็มฟรี (ห้ามระหว่างไฟต์); แพ้ทั้งทีม → ย้ายกลับหมู่บ้านแล้วพัก; ทั้งทีมล้ม → `NEED_REST` |
| ไฟต์ใช้ตัวละครจริง | `src/map-do.ts` | `engage` อ่านตัวละคร+ทีมจาก D1, จองคู่ใจ (ล็อก) พร้อมกระเป๋า; ไม่มีตัวละคร → `NO_CHARACTER`; `resume` รอ settle ลง D1 ก่อน (`SETTLING` ให้ client ถามใหม่) |
| API ตัวละคร | `src/index.ts` | `GET /character`, `POST /character`, `PUT /character/team`; ชื่อที่คนอื่นเห็นในแผนที่ = ชื่อตัวละคร |
| Client ตัวละคร | `apps/client/src/{character-api,character-ui}.ts`, `world-scene.ts` | โหมด server: บัญชีใหม่เจอหน้าสร้างตัวละครก่อน; HUD แสดงชื่อ Lv HP/MP จำนวนทีม; ปุ่ม/คีย์ T เปิดหน้าทีม (เลือกได้ 5 ตัว ชนิดซ้ำกดไม่ได้) |
| มอนสเตอร์ตัวอย่างข้างประตู | `packages/shared/src/content/{examples,maps}.ts` | ตุ่นเสบียง Lv2 และนกกระดิ่ง Lv3 จากตาราง kit บท04 §2 (EXAMPLE) ฝูงละ 1 ตัวข้างประตูทุ่ง เพราะ simulation พบว่าตัวละคร Lv1 ชนะมอนสเตอร์เดิม (Lv5–8) แทบไม่ได้ |
| ตัวละครแทน (dev) | `packages/shared/src/dev-fixtures.ts` (`devPlayer`, `DEV_STARTER_ITEMS`) | ใช้แค่ `?battle` (dev-create) และ local preview; ไฟต์ในโลกใช้ตัวละครจริงแล้ว; ของเริ่มต้น dev เพิ่มเครื่องจับตุ่น/นก |
| Client เดิน ↔ สู้ | `apps/client/src/{world-scene,world-transport,battle-scene,transport}.ts` | วาดฝูง (สีธาตุหัวฝูง, ชื่อ Lv จำนวน), คลิกฝูง → เดินไปข้าง ๆ แล้วขอสู้; ฉากต่อสู้ต่อไฟต์ที่ server สร้าง (attach); จบแล้วปุ่ม "กลับไปเดินต่อ"; โหมด local preview สุ่มฝูง/สู้ในเบราว์เซอร์ได้ (ไม่บันทึก) |
| อุปกรณ์ (shared) | `packages/shared/src/equipment.ts`, `content/equipment.ts` | `planEquip` (ช่องตามหมวด, เลเวลขั้นต่ำ, อาวุธสองมือถอดมือรองให้/กันใส่มือรอง, ย้ายชิ้นที่ใส่อยู่ไปช่องอื่น, ใช้ `validateLoadout` เดิมตรวจ Sigil); `gearBonuses` รวม stat เข้า `deriveStats`; อาวุธมือหลักกำหนดระยะตีพื้นฐาน; ของ EXAMPLE 9 ชิ้น (เริ่มต้น 4 + ดรอปชนิดละ 1) |
| อุปกรณ์ใน D1 | `apps/server/migrations/0006_equipment.sql`, `src/character-store.ts` | `equipment_instances` (1 แถวต่อชิ้น, `created_operation_id` UNIQUE, lock_state/lock_ref) + `character_equipment` (PK ตัวละคร+ช่อง, ชิ้นหนึ่งอยู่ได้ช่องเดียว); `equip` ตรวจ version เดียวกับทีม (`gear_hash` เป็นเครื่องหมายผู้ชนะ), ห้ามเปลี่ยนระหว่างไฟต์, ตรวจเจ้าของ+ไม่ถูกล็อกใน batch เดียว |
| ดรอปอุปกรณ์ + ล็อก | `src/reward-ledger.ts`, `src/economy.ts` | kill line ที่เป็น `equip:` → สร้าง instance ทีละชิ้น id `eq:<entitlement>:<line>:<n>` ไม่ลง item ledger; `reserve` ล็อกชิ้นที่ใส่อยู่กับ reservation (hash รวม gear เฉพาะเมื่อมี), `settle`/`release` ปลดล็อกพร้อมคู่ใจ |
| API + client อุปกรณ์ | `src/index.ts`, `apps/client/src/character-{api,ui}.ts`, `world-scene.ts` | `PUT /character/equipment`, `GET /character` มี `equipment`; หน้าอุปกรณ์ (ปุ่ม/คีย์ E) 12 ช่อง + กระเป๋า กดใส่/ถอดทีละครั้ง server ตัดสิน; HUD คิด HP/MP สูงสุดรวมอุปกรณ์; log ไฟต์แสดงชื่อของดรอป; dev แจกของเริ่มต้น 4 ชิ้นครั้งเดียวต่อบัญชี |
| Sigil + ร้าน (shared) | `packages/shared/src/sigil.ts`, `rules.ts` (`sigilRemovalCostTiers` P08) | `sigilCapacity` = min(ช่องของชิ้น, อาวุธ 4/อื่น 1), `planSigilInstall` (ต้องเป็นไอเทม kind sigil ที่ผูก `sigilId`, เข้ากลุ่ม, ช่องว่าง; ชื่อซ้ำได้ C24), `sigilRemovalCost` ตามเลเวลของชิ้น, `sellQuote` ตาม `vendorPrice` (0 = ร้านไม่รับ) |
| เหรียญ + บริการในเมือง | `apps/server/migrations/0007_coins_and_sigils.sql`, `src/town-services.ts` | `coin_ledger` แบบเดียวกับ item ledger; `service_operations` 1 แถวต่อคำขอ (บัญชี+operationId) เป็นตัวยึดของ batch; ขายให้ NPC (ในเมือง ไม่อยู่ในไฟต์ ของพอ), ใส่ Sigil (ชิ้นของเรา ไม่ล็อก ช่องตรงกับที่เห็น มีตราในกระเป๋า; นอกไฟต์ที่ไหนก็ได้), ถอด Sigil (ในเมือง จ่ายเหรียญตามราคาที่แสดง ตรากลับเข้ากระเป๋า P08); ส่งซ้ำได้ผลเดิม, id เดิมแต่คำขอต่าง → `PAYLOAD_MISMATCH` |
| API + client Sigil/ร้าน | `src/index.ts`, `apps/client/src/character-{api,ui}.ts`, `world-scene.ts` | `POST /character/equipment/sigil`, `/character/equipment/sigil/remove`, `/town/sell`; `GET /character` มี `coins` และ `bag`; หน้าอุปกรณ์มีส่วน "ตรา Sigil" (ช่องต่อชิ้น, ใส่, ถอดพร้อมยืนยันราคา); ร้าน (ปุ่ม/คีย์ B เฉพาะในเมือง); HUD แสดงเหรียญ; dev แจกตราจิ้งจอก 2 ตุ่น 1 และ 1000 เหรียญครั้งเดียว |
| EXP/เลเวล (shared) | `packages/shared/src/progression.ts`, `rules.ts`, `battle/kernel.ts`, `docs/design/` | ตาราง EXP ผู้เล่นของนัท (exp-proposal-1.0, PROVISIONAL, 3 ต.ค. 2026): สร้างจาก anchor นาที × 2 ตัว/นาที × EXP อ้างอิง แล้วปัด 10 ครึ่งขึ้น ตรงไฟล์ JSON ทุกแถว (Lv1→2 = 60, ถึง Lv200 = 5,465,771,910); ฆ่า/จับได้ EXP อ้างอิงของเลเวลป่า 20 + 6M + 2M² ทุก rank เท่ากัน; Lv200 `need = null` และ EXP ไม่สะสมเกิน; คู่ใจใช้ตาราง EXP คู่ใจของนัท (companion-exp-proposal-1.0 รอบแรก = 25% ของตารางผู้เล่น ปัด 10 ครึ่งขึ้น ตรง JSON ทุกแถว, ถึง Lv200 = 1,366,443,240) และได้ EXP ลดลงเมื่อศัตรูสูงกว่าเลเวลคู่ใจตอนเริ่มไฟต์เกิน 10 (`companionExp`: × min(1, E(C+10)/E(M)), ตัวอย่าง §5 ตรงทุกค่า); kernel ใส่ `exp` (ตัวละคร) และ `companionExp` (รายคู่ใจที่เริ่มไฟต์ คิดจากเลเวลตอนเริ่ม) ใน entitlement kill/capture; `planAllocation` ลงแต้ม P03 ห้ามลด |
| EXP ใน D1 | `src/reward-ledger.ts`, `src/character-store.ts` | EXP เขียนใน batch เดียวกับ receipt (ส่งซ้ำไม่ได้ซ้ำ) ให้ตัวละครใน reservation และคู่ใจแต่ละตัวตามยอดของตัวเองใน `companionExp` เฉพาะตัวที่อยู่ใน `companionIds` ของ reservation (ล้มแล้วก็ได้, ตัวที่เพิ่งจับไม่ได้) โดย `MIN(xp + ?, cap)` ตามเส้นของแต่ละฝ่าย; `syncLevels` ปรับเลเวลตาม EXP ตอนอ่าน (ขึ้นอย่างเดียว); `allocate` (`PUT /character/stats`) ตรวจ version, นอกไฟต์, งบแต้ม |
| Client EXP | `apps/client/src/{battle-scene,world-scene,character-ui}.ts` | log ไฟต์แสดง EXP +N, HUD แสดง EXP ในเลเวลและแต้มว่าง, แจ้ง "เลเวลอัป!", หน้าสเตตัส (C) กด +/− ดูผลก่อนยืนยัน; ปุ่มแผงย้ายไปขอบล่างเพราะบังฝูงที่ประตูทุ่ง |
| Reconciler | `apps/server/src/index.ts` (`scheduled`, cron ทุกนาที) | reservation ที่ค้าง `reserved` เกิน 2 นาที → ถาม DO ก่อน; DO ไม่มีไฟต์ → เขียน tombstone แล้วจึงคืนของ; ไฟต์ที่เริ่มแล้วไม่ถูกแตะ |

## ผลตรวจล่าสุด

- `npm run check` ผ่าน: typecheck 3 แพ็กเกจ, **207 tests ผ่าน** (shared 113, server 94), Vite build, `wrangler deploy --dry-run` (D1 + BATTLE + MAP + cron)
- Test EXP: ตารางผู้เล่นตรง `docs/design/PLAYER_EXP_001_200.json` ครบ 200 แถว (EXP ไปเลเวลถัดไป, EXP สะสม, EXP อ้างอิงต่อ M), ข้ามหลายเลเวลแล้วเก็บเศษ, Lv200 ไม่มีเลเวลถัดไป, ตารางคู่ใจรอบแรกตรง `docs/design/COMPANION_EXP_001_200.json` ครบ 200 แถว, ตัวอย่างการลด EXP คู่ใจ §5 (Lv1/100/190 เจอ Lv200 = 328/24,880/81,220), แต้ม 3/เลเวลและราคาตาม band, ห้ามลด; server: EXP ได้ครั้งเดียวแม้ grant ซ้ำ/พร้อมกัน ทั้งตัวละครและคู่ใจในไฟต์ ส่วนคู่ใจที่อยู่บ้าน/เพิ่งจับไม่ได้, คู่ใจแต่ละตัวได้ยอดของตัวเอง, EXP หยุดที่ยอดของ Lv200 (และ cap ของคู่ใจ), เลเวลตาม EXP (ไม่ลดเลเวลที่สูงกว่า), ลงแต้มเกินงบ/ลดค่า/version เก่า/ระหว่างไฟต์ถูกปฏิเสธ, ลงพร้อมกันได้อันเดียว; kernel: จับสำเร็จได้ EXP เท่าฆ่า (Lv25 = 1,420), ทุก entitlement มียอดของคู่ใจทุกตัวที่เริ่มไฟต์
- `npm run smoke:progression` กับ `wrangler dev` (รันใหม่หลังเปลี่ยนเป็นตารางนัท): จับตุ่น Lv2 ได้ EXP 40, ลงทีมแล้วสู้นก Lv1 สองตัวได้ 56 ทั้งตัวละครและคู่ใจ → ตัวละคร Lv2 (96 EXP), คู่ใจ Lv3 (ตารางคู่ใจ), ลงแต้มกลางไฟต์ถูกปฏิเสธ, ลงแต้ม 3 ที่ VIT สำเร็จ, เกินงบ → `OVER_BUDGET`
- ภาพหน้าจอ (`/mnt/project-files/pixel-game-screenshots/level-*.png`): log "EXP +20", HUD แจ้งเลเวลอัป Lv2 แต้มว่าง 3, หน้าสเตตัสก่อน/หลังยืนยัน
- สังเกตบาลานซ์: ตัวละคร Lv1 ใส่ดาบไม้+เสื้อ ชนะตุ่นแล้วเหลือ HP ~150–240/680 จึงแพ้นกถ้าไม่กลับไปพัก ต้องเดินกลับเมืองระหว่างไฟต์ (ยังไม่มีจุดพักในทุ่ง)
- Test ใหม่ Sigil/เหรียญ (+14): ช่องตามชิ้นใต้เพดาน 4/1, ใส่ชื่อซ้ำได้, ไม่เข้ากัน/ไม่ใช่ตรา/ช่องเต็ม, ไอเทมตราทุกชิ้นชี้กลับ Sigil, ค่าถอดตาม tier เลเวล, ร้านไม่รับเครื่องจับและตรา; server: ขายได้เหรียญครั้งเดียวแม้ส่งซ้ำ/พร้อมกัน, id เดิมคำขอต่างถูกปฏิเสธ, ของไม่พอ/นอกเมือง/ระหว่างไฟต์ไม่เขียนอะไร, ขายแย่งของชุดเดียวกันได้คนเดียว, ใส่ตราหักตรา 1 ดวงครั้งเดียว, ใส่แย่งช่องสุดท้ายได้อันเดียวเสียตราดวงเดียว, ถอดจ่ายเหรียญคืนตรา, ราคาเปลี่ยน/เหรียญไม่พอ/ช่องว่าง/นอกเมือง/ระหว่างไฟต์ (ของถูกล็อก) ถูกปฏิเสธ
- `npm run smoke:town` (ใหม่) กับ `wrangler dev`: dev เริ่ม 1000 เหรียญ + ตรา, ใส่ตราจิ้งจอกที่ดาบไม้ได้ ส่งซ้ำ `replayed`, เสื้อ → `SIGIL_INCOMPATIBLE`, ดาบเต็ม → `SIGIL_SLOTS_FULL`, ราคาผิด → `COST_CHANGED`, ถอดในเมืองจ่าย 300 เหลือ 700, ขายยา 1 ได้ 10 → 710, ขายตรา → `NOT_SELLABLE`; ในทุ่ง ขาย/ถอด → `NOT_IN_TOWN` แต่ใส่ตราได้; `smoke:equipment` ยังผ่าน
- ภาพหน้าจอ (`/mnt/project-files/pixel-game-screenshots/sigil-*.png`, `shop-*.png`): ใส่ตราสองดวงชื่อซ้ำในธนู, หน้ายืนยันบอกค่าถอด 300 เหรียญ, ร้านขายยาได้เหรียญ, HUD แสดงเหรียญ (console มีแค่ 404 ก่อนสร้างตัวละคร)
- Test ใหม่อุปกรณ์ (+16): ของ EXAMPLE ผ่าน schema/ใช้ stat ที่สูตรรู้จัก, ทุก loot table ชี้ของที่มีจริง, อาวุธใส่ได้ทั้งสองมือแต่ผิดช่องถูกปฏิเสธ, ธนูสองมือถอดดาบ+โล่ในครั้งเดียวและกันใส่มือรอง, เลเวลไม่ถึง, ย้ายเครื่องประดับ 1→2, ถอด, gear เข้า maxHp/patk และระยะตีตามอาวุธ; server: ดรอป 2 ชิ้นได้ 2 แถวครั้งเดียวแม้ส่งซ้ำ/พร้อมกัน และไม่ลง item ledger, dev gear แจกครั้งเดียว, ของคนอื่น/ผิดช่อง/เลเวล/input เสีย/ไม่มีตัวละคร, เขียนพร้อมกันจาก version เดียวกันผ่านอันเดียวและใช้ version ร่วมกับทีม, ระหว่างไฟต์ `IN_BATTLE` + ชิ้นที่ใส่ถูกล็อกกับ reservation แล้วปลดตอน settle/release, จองของคนอื่นได้ `NOT_OWNER`
- `npm run smoke:equipment` (ใหม่) กับ `wrangler dev`: บัญชีใหม่มีของเริ่มต้น 4 ชิ้นในกระเป๋า, ใส่ดาบแล้วไม้เท้าสองมือแทนที่, ใส่เสื้อ, ผิดช่อง `SLOT_MISMATCH`, version เก่า `STALE_VERSION`; ในไฟต์จริงที่ทุ่ง ผู้เล่นมี maxHp 680 (650+30), maxMp 150 (140+10), MATK 62 (50+12), PDEF 24 (20+4), ระยะ ranged; เปลี่ยนของกลางไฟต์ `IN_BATTLE`; ชนะแล้วของกลับเป็น `free` และถอดได้; `smoke:character` และ `smoke:encounter` ยังผ่าน
- ภาพหน้าจออุปกรณ์ (`/mnt/project-files/pixel-game-screenshots/gear-*.png`): หน้าอุปกรณ์ว่าง, ใส่ไม้เท้า+เสื้อแล้ว stat เปลี่ยน, ใส่ดาบมือรองขณะถือสองมือถูกปฏิเสธ `TWO_HAND_BLOCKS_OFFHAND`, HUD HP 680/680, ไฟต์ที่ใส่ของ (console มีแค่ 404 ก่อนสร้างตัวละครและ 409 ของการปฏิเสธที่ตั้งใจ)
- Test ใหม่ Phase D (+20): Class1 9/เผ่า 8, ชื่อไทย/อังกฤษ 2–16 ตัดช่องว่าง ห้ามอักขระพิเศษ, ห้ามธาตุ NEUTRAL, formation 5 ตัวไม่ทับกัน, ตัวละคร+ทีมที่บันทึกสร้างไฟต์ได้และ HP ที่เก็บไว้ถูกใช้; D1: สร้างตัว Lv1 สเตตัส 10, ส่งซ้ำได้ตัวเดิม, ตัวที่ 2 → `CHARACTER_EXISTS`, สร้างพร้อมกัน 3 ครั้งได้ 1 ตัว, input ผิด 9 แบบไม่เขียนอะไร, ชื่อซ้ำข้ามบัญชีได้, ทีม tank ยืนหน้า, ชนิดซ้ำต่างธาตุ → `DUPLICATE_SPECIES`, เกิน 5/ของคนอื่น/id ซ้ำ ถูกปฏิเสธ, เขียนพร้อมกันจาก version เดียวกันสำเร็จ 1, เปลี่ยนทีมระหว่างไฟต์ → `IN_BATTLE`, settle เขียน HP/MP ตัวละครและคู่ใจ (ปัดลง ไม่ติดลบ), ไฟต์ dev ไม่แตะ HP ตัวละคร, พักไม่ได้ระหว่างไฟต์
- `npm run smoke:character` (ใหม่) กับ `wrangler dev`: ก่อนสร้าง 404, ธาตุ NEUTRAL → 400, สร้างได้ชื่อไทย Lv1 สเตตัส 10, ส่งซ้ำได้ตัวเดิม, ตัวที่ 2 → 409, เข้าเมืองได้ `rested`, คนอื่นเห็นชื่อตัวละคร, สู้ตุ่นแล้วกดจับสำเร็จ → คู่ใจ Lv1 ในคลัง, ตั้งทีมได้ / version เก่า → `STALE_VERSION`, ไฟต์ถัดไปมีคู่ใจลงสู้, เปลี่ยนทีมกลางไฟต์ → `IN_BATTLE`, หลังไฟต์ HP ตัวละคร 470 คู่ใจ 450 ติดตัว, แพ้จิ้งจอก Lv8 → ถูกส่งกลับหมู่บ้าน HP 0 → ถึงเมืองได้ `rested` HP เต็มทั้งทีม; `smoke:encounter` (เพิ่ม: ไม่มีตัวละคร → `NO_CHARACTER`), `smoke:world`, `smoke:server` ยังผ่าน
- Simulation (200 seed ต่อคู่): ตัวละคร Lv1 คนเดียวชนะหอย Lv5 10%, ปู/จิ้งจอก 0%; ชนะตุ่น Lv2 100% และนก Lv3 83% → จึงเพิ่มสองชนิดนี้ข้างประตู
- ภาพหน้าจอโหมด server (`/mnt/project-files/pixel-game-screenshots/char-*.png`): หน้าสร้างตัวละคร, HUD ในเมือง, ไฟต์กับตุ่นแล้วกดจับ, หน้าทีม, ไฟต์ที่มีคู่ใจลงสู้และ HP ไม่เต็ม; console มีแค่ 404 ของ `GET /character` ตอนบัญชียังไม่มีตัวละคร (ตั้งใจ)
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
| A8 | สุ่ม loot และคิด EXP ตอนศัตรูล้ม (settle รายตัว) แล้วเก็บผลใน entitlement | บท11 §3 |
| A9 | โอกาส hit/crit คิดเป็น basis points; damage ปัด half-up ครั้งเดียว | บท12 §3, P04 |
| A10 | Auto Battle เดินหนึ่ง action ต่อหนึ่ง request จาก client ที่เปิดอยู่ จึงไม่มีการเล่นตอนปิดเกม | C14 |
| A11 | ตารางธาตุบท02 อยู่ใต้ P04 | บท02, P04 |
| A12 | เพดานกระเป๋าต่อสู้ 8 ชนิด และ stack ตามบท03 §2 อยู่ใต้ P15 | บท03 §2 |
| A13 | สกิล Phase A เป็นเป้าเดี่ยว ผลเดียว | AoE/multi-hit ยังติด O15 |
| A14 | เลือก settle **รายศัตรู** (บท11 §3 ให้เลือก): entitlement ส่งทันทีที่ล้ม/จับ ส่วน settlement (คืนของ ปลดล็อก) ส่งตอนจบไฟต์และต้องรอ receipt ครบ | บท11 §3 |
| A15 | ยาที่ใช้ในไฟต์ไม่ถูกคืน ส่วนที่เหลือคืนตอน settle; ของในกระเป๋าออกจาก inventory ตั้งแต่จอง (ไม่ใช่หักตอนใช้) | บท11 §3 ข้อ 4, 8 |
| A16 | HP/MP ตอนจบเก็บใน `battle_reservations.result_json` และ (ตั้งแต่ Phase D) เขียนกลับตัวละคร/คู่ใจด้วย | บท03 §3 |
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
| A30 | 1 ตัวละครต่อบัญชีจนกว่า O10 จะตัดสิน (โครงตารางรองรับหลายตัว) | O10 |
| A31 | ชื่อตัวละครซ้ำกันได้ 2–16 ตัวอักษร ตัวอักษร/ตัวเลข/_ และเว้นวรรคเดี่ยว | บท00 ไม่ได้ระบุ |
| A32 | อาชีพ/เผ่าตอนนี้มีแค่ชื่อ: ทุกอาชีพใช้สกิลชั่วคราว "ฟันแรง" ตัวเดียว ระยะตีพื้นฐานตามอาชีพ (ผู้พิทักษ์/นักรบ/ผู้ประสานคู่ใจ/นักลอบเร้น ประชิด, ที่เหลือระยะไกล) | P16 |
| A33 | จัดแถวทีมอัตโนมัติ: ผู้เล่นแถวหน้ากลาง, คู่ใจ tank/physical ไปหน้าก่อน ที่เหลือแถวหลัง (ยังไม่มีหน้าจัดตำแหน่ง) | P15 |
| A34 | เข้าหมู่บ้าน = พักฟื้น HP/MP เต็มทั้งตัวละครและคู่ใจที่ไม่ได้อยู่ในไฟต์; ไม่มีค่าใช้จ่าย | บท03 §3 "เมือง/จุดพักฟื้นฟรี" |
| A35 | แพ้ทั้งทีม → ย้ายไปจุดเกิดหมู่บ้านแล้วพัก (ไม่หัก EXP/ของ) | บท03 §3 |
| A36 | ตัวละครล้มแต่คู่ใจยังยืน → สู้ต่อได้; ทั้งทีมล้ม → ต้องกลับไปพักก่อนเข้าไฟต์ใหม่ | บท03 §3 |
| A49 | EXP ผู้เล่นใช้ตารางของนัท exp-proposal-1.0 (PROVISIONAL, ผูก P03 ใน config เพราะ register ไม่มี id ของ EXP); เก็บต้นฉบับใน `docs/design/` ถ้าจะปรับให้แก้ anchor ใน `rules.ts` แล้ว test จะเทียบกับ JSON ใหม่; ฆ่า = EXP อ้างอิงของเลเวลป่า ทุก species ใช้ค่าเดียวกันจนกว่าจะมี EXP ราย species; Elite/Boss ได้เท่ามอนทั่วไปเพราะเอกสารไม่ให้คูณ ×10 ตายตัว (ค่า ×3/×10 เดิมถูกเอาออก) | P03, docs/design/EXP_DESIGN_LV001_200.md |
| A50 | คู่ใจที่เริ่มไฟต์ทุกตัวได้ EXP ของตัวเอง ไม่หาร (บท04 §4, เอกสาร EXP คู่ใจ §4); ใช้ตาราง EXP คู่ใจรอบแรกของนัท (25%); คอลัมน์ Rebirth 1–3 (30/35/40%) เป็นแค่สถานการณ์ ยังไม่ทำเพราะ Rebirth ยัง OPEN (O03/O04); ปัดเศษลง (floor) ทีละศัตรู ไม่ใช่รวมทั้งไฟต์แล้วปัดครั้งเดียวตามเอกสาร เพราะรางวัลออกทีละ entitlement (ต่างกันไม่เกิน 1 EXP ต่อศัตรู); ยังไม่มีโบนัส Party; เลเวลคู่ใจเพิ่มแค่ HP/MP ตามเลเวล เพราะน้ำหนักการเติบโตของสเตตัสคู่ใจยัง OPEN (บท04 §4) | บท04 §4, docs/design/COMPANION_EXP_DESIGN_LV001_200.md |
| A51 | เลเวลเก็บใน D1 เป็น cache ของ EXP สะสม server ปรับขึ้นตอนอ่าน; HP ปัจจุบันไม่เพิ่มฟรีตอนเลเวลอัป (บท03) | บท03 §2 |
| A52 | ลงแต้มได้นอกไฟต์ ที่ไหนก็ได้ ลดไม่ได้ (ยังไม่มีการรีเซ็ตแต้ม) | P03 |
| A44 | ค่าถอด Sigil ตามเลเวลของอุปกรณ์: Lv1–49 = 300, Lv50 = 10,800, Lv120 = 37,800, Lv200 = 95,000 เหรียญ/ดวง (Lv50/120/200 = 3 ชม. กำไรสุทธิ manual ตามตัวอย่างบท06; Lv1 เดาเพื่อต้นแบบ) | P08, P12 |
| A45 | ใส่ Sigil ได้ทุกที่นอกไฟต์ (บท05 กำหนดเฉพาะการถอดว่าทำในเมือง); ใส่ได้ทั้งชิ้นที่สวมอยู่และในกระเป๋า | บท05 §4, P15 |
| A46 | NPC รับซื้อตาม `vendorPrice` ต่อชิ้น ไม่มีภาษี; ไม่รับเครื่องจับและตรา Sigil (`vendorPrice` 0); อุปกรณ์ยังขายไม่ได้ | บท06 |
| A47 | "อยู่ในเมือง" = ตำแหน่งที่บันทึกใน D1 (`player_positions.map_id`) เป็นแผนที่ kind `town` | บท07 |
| A48 | ตราตุ่นเสบียงย้ายจากรองเท้าเป็นเครื่องประดับตามตารางบท05 §5; ชื่อตราเป็น "ตรา" + ชื่อ species | EXAMPLE |
| A37 | ตุ่นเสบียง Lv2 และนกกระดิ่ง Lv3 (EXAMPLE) ใช้ kit จากบท04 §2 แต่สกิลที่ต้องใช้ระบบที่ยังไม่มี (buff/cleanse/ลดต้นทุน) เป็น passive ว่างไว้ก่อน | EXAMPLE |
| A38 | อุปกรณ์ให้แค่ stat พื้นฐาน (`baseStats`) เข้าสูตร derived; ยังไม่มี affix/rarity/refine/ผล Sigil | บท05 |
| A39 | ทุกอาชีพใส่อาวุธได้ทุกแบบและถือสองอาวุธมือเดียวได้ (O09 กติกา dual wield ตามอาชีพยัง OPEN) | O09 |
| A40 | อาวุธสองมือใส่ได้แค่มือหลักและถอดของมือรองออกให้อัตโนมัติ; ใส่มือรองขณะถือสองมือถูกปฏิเสธ | บท05 §1 |
| A41 | ระยะตีพื้นฐาน: อาวุธ physical_melee = ใกล้, ranged/magic = ไกล; มือเปล่าใช้ค่าของอาชีพ | บท04/05 |
| A42 | ทีมกับอุปกรณ์ใช้ `version` ตัวละครเดียวกัน: เปลี่ยนอย่างใดอย่างหนึ่งแล้วอีกหน้าต้องโหลดใหม่ | บท11 §4 |
| A43 | มอนสเตอร์ตัวอย่างแต่ละชนิดดรอปอุปกรณ์ EXAMPLE 1 ชิ้นด้วย pool น้ำหนัก 4 (เทียบ species 25, region 15) ตัวเลขดรอปจริงบท06 ยังไม่กำหนด; dev แจกดาบไม้/ธนูฝึก/ไม้เท้าฝึกหัด/เสื้อผ้าฝ้าย | EXAMPLE |

## OPEN ที่โค้ดคืน `UNRESOLVED_RULE` แทนการเลือกเอง

- **O07** ตารางโอกาสจับรายRank/HP factor → คำสั่งจับถูกปฏิเสธก่อนหักของ (dev/test ใช้ `DEV_FIXTURE_RULES`)
- **O15** จุดลด cooldown, สูตรหนี, revive, สกิลหลายผล/AoE, stalemate
- **O11** auth provider → นอก dev ทุก request ได้ 401
- `BattleRoom` ไม่ยอมรัน rules ที่มี fixture override นอก environment `dev`

O01–O04 (trade gap, effective level, Rebirth) ไม่เกี่ยวกับงานนี้ ยังไม่แตะ

## ยังไม่ทำ / ข้อจำกัด

- ยังไม่มี status effect (stun/sleep/poison), shield, passive/innate trigger, บอสหลาย action, AoE
- ตาราง EXP ผู้เล่นและคู่ใจยังเป็นข้อเสนอที่ยังไม่ playtest (สมมติ 120 ตัว/ชม.); ยังไม่มี EXP ราย species/Elite/Boss, Daily/Weekly, โบนัส Party, Rebirth; effective level ของคู่ใจที่สูงกว่าเจ้าของ (O02) ยังไม่ตัดสิน ตอนนี้คู่ใจใช้เลเวลจริงในไฟต์
- ยังไม่มีการเติบโตสเตตัสคู่ใจ (O: น้ำหนักตาม archetype), Bond, Rebirth, อัปสกิล, รีเซ็ตแต้ม, Class2 ที่ Lv50
- นอก dev ยังเข้าเกมไม่ได้เพราะ auth (O11) ยังไม่เลือก ทุก request ได้ 401
- ยังไม่มีของเริ่มต้นสำหรับตัวละครใหม่นอก dev (ยา/เครื่องจับ): dev แจกให้ทุกบัญชีเพื่อทดสอบ; ชุดเริ่มต้นจริงยังไม่ได้ออกแบบ
- อาชีพ/เผ่ายังไม่มีสกิลหรือ passive เฉพาะ; ยังไม่มีหน้าจัดตำแหน่งทีม, ปล่อยคู่ใจ, ตั้งชื่อเล่น
- รีโหลดหน้าเมื่อไฟต์จบแล้วแต่ยังไม่ได้กด "กลับไปเดินต่อ": ถ้าแพ้ จะไม่ถูกส่งกลับเมืองอัตโนมัติ (เดินต่อในทุ่งด้วยทีมที่ล้ม แล้วได้ `NEED_REST` เมื่อจะสู้)
- ยังไม่มี Auto Hunt (เดินหาฝูงเอง), ฝูง ELITE/บอส, ฝูงเดินไปมา; ฝูงยืนที่จุดเกิดคงที่
- คอนเทนต์ฝูงเป็น EXAMPLE (`draft`) ห้าม publish; ผู้ใช้แจ้ง (3 ต.ค. 2026) ว่า asset และมอนสเตอร์จริงจะเพิ่มทีหลัง และแต่ละช่วงเลเวลจะมีหลายชนิดมาก ชนิดตอนนี้เป็นตัวแทนเท่านั้น
- ยังไม่มี interest area: ทุกคนใน channel ได้ข่าวทุกการขยับ (พอสำหรับ 50 คน/แผนที่เล็ก ไม่ใช่ขนาด MMO)
- ยังไม่มี rate limit ของข้อความ WebSocket นอกจากกฎความเร็วเดิน; ไม่มี heartbeat timeout ของ server (ใช้ close ของ WebSocket)
- ยังไม่มีตัวละครหลายตัวต่อบัญชี (O10), ไม่มีการเลือก channel อัตโนมัติเมื่อเต็ม
- ภาพโลกเป็นสี่เหลี่ยมสีตาม tile ยังไม่มี tileset, y-sort จริง, occlusion (บท10 §2)
- ไฟต์ที่ถูกทิ้งกลางคัน (ปิดเกมไม่กลับมา) ค้าง `active` ตลอด บัญชีนั้นเปิดไฟต์ใหม่ไม่ได้ เพราะนโยบาย pause/disconnect (O11) และ stalemate/หนี (O15) ยังเปิดอยู่; client dev จึงใช้บัญชีใหม่ทุกครั้งที่โหลดหน้า
- ยังไม่มีเครื่องมือผู้ดูแลสำหรับ outbox `failed` (ดูได้จาก `view.settlement.failed` เท่านั้น)
- ผลของ Sigil ยังไม่ทำงาน (ไม่มีระบบ effect/proc/shared cooldown) ใส่แล้วตัวเลขไม่เปลี่ยน UI บอกไว้; ยังไม่มีการแสดง cap ก่อนใส่ (บท05 §5) เพราะยังไม่มี effect
- ยังไม่มีร้านขายของให้ผู้เล่น (ซื้อยา/เครื่องจับ) เพราะบท06 ยังไม่มีราคาซื้อ; เหรียญตอนนี้ใช้แค่ค่าถอด Sigil
- อุปกรณ์ยังไม่มี affix, rarity, ตีบวก, ขาย/ทิ้ง/แลก, ภาพบนตัวละคร (12 layers); ล็อก `in_escrow` มีในตารางแต่ยังไม่มีตลาด
- ของเริ่มต้นนอก dev ยังไม่มี (ทั้งยาและอุปกรณ์); ของ EXAMPLE ห้าม publish
- `grant` ยังไม่ตรวจว่า entitlement มาจากไฟต์ที่มี reservation ของผู้รับ (DO เป็นผู้เรียกคนเดียวผ่าน binding ภายใน)
- Cron reconciler ทดสอบผ่าน `/dev/reconcile` ไม่ได้รันผ่าน cron จริง
- SQL ทดสอบบน node:sqlite ไม่ใช่ D1 จริง; DO ทดสอบบน workerd ในเครื่อง ยังไม่ deploy; ไม่มี load test (P11)
- คอนเทนต์ตัวอย่างมี loot แค่ 4 ชนิดต่อ species จึงไม่ผ่าน validator 50–100 โดยตั้งใจ (ไม่สร้างของปลอมให้ผ่าน)
- ภาพเป็นกล่องสีแทนตัวละคร ยังไม่มี art proof (sprite 4 ทิศ + อุปกรณ์ 12 ชั้น) ซึ่งบท13 นับเป็นงาน Phase A ด้วย
- ตัวเลขบาลานซ์ผ่านแค่ simulation เล็ก ๆ ข้างบน ไม่ใช่การทดสอบบาลานซ์จริง
- vitest ตรึงที่ 3.x เพราะ npm 10.9 ติดตั้ง vitest 4 ไม่ได้ในเครื่องนี้

## งานถัดไปที่แนะนำ

1. น้ำหนักการเติบโตคู่ใจ (บท04 §4) แล้วให้คู่ใจได้สเตตัสตามเลเวล; ตัดสิน O02 (effective level คู่ใจเทียบเจ้าของ) เพราะตาราง EXP คู่ใจเร็วกว่าผู้เล่น
2. ระบบ effect ของ Sigil/passive (stack policy, proc budget, shared cooldown บท05 §5) แล้วให้ตราตัวอย่างมีผลจริง
3. ร้านขายของ (ราคาซื้อยา/เครื่องจับ) และชุดเริ่มต้นนอก dev; affix/rarity, gear layers บนตัวละคร
4. ตัดสิน O15 (cooldown tick, revive, หนี, status tick, stalemate) และ O11 (นโยบายหลุดกลางไฟต์) แล้วเพิ่ม status effects และทางปิดไฟต์ที่ถูกทิ้ง
5. Art proof หนึ่งตัวละคร 4 ทิศ + gear 12 layers + tileset หนึ่งชุด (บท10, ค้างจาก Phase A)
6. auth (O11) เพื่อเปิดนอก dev
