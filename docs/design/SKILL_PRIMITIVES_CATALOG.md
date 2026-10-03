# คลังรูปแบบสกิล (Skill primitives): รวบรวมจากหลายเกมเพื่อให้สกิลหลากหลาย

ที่มา: นัทขอ (3 ต.ค. 2026) ว่า "ทำให้สกิลหลากหลายด้วยนะ ต้องรวบรวมข้อมูลจากทุกๆเกมส์มา"
สถานะ: เอกสารอ้างอิงสำหรับออกแบบคอนเทนต์ ไม่ใช่กฎยืนยัน (O06: เอกลักษณ์ต้องมาจาก "ชุดและเงื่อนไขเฉพาะชนิด" ของ primitive ที่ใช้ร่วมกัน)

**หลัก (C01):** เอาแค่ *กลไก* จากเกมอื่นมาเป็นแรงบันดาลใจ ส่วนชื่อ ภาพ และเนื้อเรื่องต้องเป็นของเราเอง ห้ามลอกชื่อสกิลหรือตัวเลขของเกมอื่นมาตรง ๆ

**เกมที่ใช้อ้างอิง:**
- **ออนไลน์:** Ragnarok Online, TS Online, Tree of Savior, MapleStory
- **มอนสเตอร์:** Pokémon, Digimon, Dragon Quest Monsters, Shin Megami Tensei/Persona, Monster Sanctuary, Cassette Beasts, Temtem
- **เทิร์นคลาสสิก:** Final Fantasy (I–X, Tactics), Dragon Quest, Chrono Trigger, Octopath Traveler, Bravely Default
- **เกมมือถือ/กาชา:** Summoners War, Epic Seven, Honkai: Star Rail
- **แทคติก/การ์ด:** Darkest Dungeon, Slay the Spire, Divinity: Original Sin 2, Disgaea

## วิธีอ่าน

- **ทำได้แล้ว**: kernel รองรับแล้วในคอมมิตนี้ ใส่ในข้อมูลสกิลได้ทันที
- **ทำได้เลย**: ไม่ติดกฎ OPEN ทำเพิ่มได้ทันทีเมื่อมีสกิลที่ต้องใช้
- **รอ O15**: ต้องตัดสินกฎการต่อสู้ก่อน (เช่น status tick/หมดอายุ, multi-hit, AoE หลบ, revive, หนี) ตามบท00 ที่ห้ามเลือกเอง

## 1. ดาเมจ

| primitive | ทำอะไร | แรงบันดาลใจ | สถานะ |
| --- | --- | --- | --- |
| power | ค่าสัมประสิทธิ์ × ATK/MATK + flat | ทุกเกม | ทำได้แล้ว |
| penetration | ไม่สนเกราะบางส่วน (เพดาน P04 40%) | RO (Ice Pick), E7 (pierce) | ทำได้แล้ว |
| accuracy bonus | เพิ่มโอกาสโดน | Pokémon (Swift), FF | ทำได้แล้ว |
| crit bonus | เพิ่มโอกาสคริ | Pokémon (high crit), RO | ทำได้แล้ว |
| execute | แรงขึ้นเมื่อเป้า HP ต่ำกว่าเกณฑ์ | DQ, HSR, Darkest Dungeon | ทำได้แล้ว |
| lifesteal | ฟื้น HP ตัวเองตามดาเมจ | FF (Drain), Pokémon (Giga Drain) | ทำได้แล้ว |
| recoil | แรงมากแต่เสีย HP ตัวเอง | Pokémon (Double-Edge) | ทำได้แล้ว (ไม่ทำให้ล้มเอง เหลือ 1) |
| extra targets | เป้าเพิ่ม เลือกโดย server | FF (Ramuh chain), TS | ทำได้แล้ว (จากเลเวลสกิล) |
| ธาตุของสกิล | ใช้ตารางธาตุ | ทุกเกม | ทำได้แล้ว |
| fixed / %HP damage | ดาเมจคงที่ หรือ % HP เป้า | FF (Gravity), Pokémon (Super Fang) | ทำได้เลย (ต้องมีเพดานต่อ rank กันบอส) |
| scale by own HP/MP | แรงตาม HP/MP ที่เหลือหรือที่หาย | Pokémon (Reversal), FF (Desperation) | ทำได้เลย |
| scale by DEF/SPD | ใช้ค่าอื่นแทน ATK | E7, HSR | ทำได้เลย |
| bonus vs condition | แรงขึ้นกับเป้าที่มี mark/สถานะ/แถวหลัง | Darkest Dungeon, E7 | mark รอ O15; แถวหลังทำได้เลย |
| multi-hit | ตีหลายครั้งในเป้าเดียว | Pokémon, RO (Double Attack) | รอ O15 |
| AoE / แถว | ทั้งแถวหรือทั้งฝั่ง | RO (Storm Gust), TS | รอ O15 (ใครหลบ AoE ได้) |
| delayed / charge | ชาร์จเทิร์นนี้ ยิงเทิร์นหน้า | Pokémon (Solar Beam), DQ | รอ O15 (tick) |
| counter | สวนกลับเมื่อถูกตี | RO, FF (Counter), SW | ทำได้เลยแบบ passive trigger |

## 2. ฟื้นฟูและป้องกัน

| primitive | ทำอะไร | แรงบันดาลใจ | สถานะ |
| --- | --- | --- | --- |
| heal | ฟื้น HP ตาม Support | ทุกเกม | ทำได้แล้ว |
| restore MP | ฟื้น MP เป้า | FF (Ether-like), RO | ทำได้แล้ว |
| heal เพิ่มเป้า | ฮีลหลายตัว เลือกตัว HP ต่ำสุด | FF (Cura-ga), TS | ทำได้แล้ว (จากเลเวลสกิล) |
| shield | กันดาเมจชั่วคราว | HSR, E7, Monster Sanctuary | รอ O15 (หมดอายุ) |
| taunt / รับแทน | บังคับเป้าหรือรับแทน | RO (Devotion), Darkest Dungeon | ทำได้เลยแบบ passive (รับแทนครั้งเดียว) |
| guard ขั้นสูง | ป้องกันแล้วได้ผลเสริม | Pokémon (Protect), FF | ทำได้เลย |
| cleanse / dispel | ล้างสถานะ/บัฟ | FF (Esuna/Dispel), Pokémon | รอ O15 (ต้องมีสถานะก่อน) |
| revive | ชุบ | FF (Raise), DQ | รอ O15 |
| regen / HoT | ฟื้นทุกเทิร์น | FF (Regen) | รอ O15 |

## 3. บัฟ ดีบัฟ และสถานะ (ทั้งหมดรอ O15 เพราะต้องรู้ว่าลด/หมดอายุตอนไหน)

- **ขั้นสเตตัส** แบบ Pokémon (+1/+2 stage) หรือ % แบบ RO/E7: ATK, DEF, SPD, ACC, EVA, CRIT
- **สถานะควบคุม**: หลับ, มึน, แช่แข็ง, ชา, สับสน, ใบ้ (ห้ามใช้สกิล), ยั่วยุ
- **ดาเมจต่อเนื่อง**: พิษ, เผา, เลือดออก (แบบ Darkest Dungeon), สะสมชั้นแบบ Slay the Spire
- **mark / ตราประทับ**: ติดแล้วสกิลอื่นใช้ต่อ (บท04 ใช้กับจิ้งจอก) ต้องมีอายุของ mark
- **turn order**: เร่ง/ถ่วงคิว แบบ HSR, FF CTB, Chrono Trigger ATB
- **ภูมิอากาศ/สนาม**: แบบ Pokémon weather/terrain, Divinity surfaces

## 4. เงื่อนไขและ passive (ต้องมีระบบ trigger: งานถัดไป)

- **trigger**: เมื่อโจมตี / ถูกตี / ฆ่าได้ / เพื่อนล้ม / เริ่ม-จบเทิร์น / HP ต่ำกว่าเกณฑ์ / ครั้งแรกต่อไฟต์ / ต่อ round
- **aura**: ทั้งทีมได้ผลตราบที่ตัวนี้ยืนอยู่ (Monster Sanctuary, Summoners War leader skill)
- **combo / chain**: สกิลต่อจากเพื่อนแรงขึ้น (Chrono Trigger dual tech, TS ผสานท่า) ต้องมีงบ proc ร่วม (บท05 §5)
- **resource**: ใช้ HP แทน MP, สะสมแต้มแล้วระเบิด (Octopath boost, Bravely BP), ลดต้นทุนสกิลเพื่อน (ตุ่นในบท04)
- **transform / stance**: เปลี่ยนท่าแล้วสกิลเปลี่ยน (FF, Digimon)

## 5. หลักเพื่อให้แต่ละ species ต่างกันจริง (O06)

- แต่ละ species ใช้ primitive ร่วมกันได้ แต่ **ชุด 3+1 ต้องมีเงื่อนไขหรือบทบาทที่จำได้** เช่น จิ้งจอก = mark → กิน mark ส่วนปู = รับแทน → แปลงโล่เป็นดาเมจ
- **ตาราง `levelSteps`**: ให้แต่ละสกิลโตต่างกัน (พลัง / MP / cooldown / เป้าหมาย)
- **Rebirth variant**: แต่ละขั้นมีสองทางที่ *บทบาทเดิมแต่เล่นต่างกัน* ไม่ใช่แค่แรงขึ้น
  - ตัวอย่าง: ทาง A เจาะเกราะ / ทาง B ประหยัด MP
  - ตัวอย่าง: ทาง A ดูดเลือด / ทาง B แม่นและคริ
- **รุ่นธาตุ**: species หลายธาตุ เปลี่ยนธาตุได้แค่สกิลเดียว (บท04 §2) ส่วนชุดสกิลยังคงจำได้
- **checklist ตอนเพิ่ม species**:
  - ใช้ primitive จากอย่างน้อย 2 หมวด
  - มีอย่างน้อย 1 Active
  - มีเงื่อนไขเฉพาะตัว 1 อย่าง
  - innate ต่อยอดตัวตนของ species ไม่ใช่โบนัสสเตตัสลอย ๆ
