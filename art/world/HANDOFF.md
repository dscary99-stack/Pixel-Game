# World sprites — handoff to Claude

อ่าน `PROOF.md`, `world-manifest.json` และ metadata ต่อไฟล์ก่อนต่อ renderer ชุดนี้ยังไม่ได้แก้ runtime ตามการแบ่งงาน

## โหลดและเล่น

Metadata ทั้งหมดเพิ่มใน `apps/client/public/assets/metadata/index.json` โดยคงรายการ UI เดิม ใช้ `file`, `frameWidth`, `frameHeight`, `columns`, `frameCount` โหลด sheet แนวนอนหนึ่งแถว ตัด cell ด้วย frame index; `animations[].frames` เป็น zero-based, ใช้ fps/loop ตามไฟล์, staticFrame=0, status=grid_ready

`assetId` ไม่มี `_v001`; ชื่อ PNG/JSON มี version suffix จับคู่ content ด้วย `artId` สำหรับมอน และ `contentId` สำหรับ NPC/แผนที่ ไม่ hard-code ชื่อ species ที่มีธาตุต่อท้ายเข้าชื่อ PNG เพราะหนึ่ง art ใช้หลายธาตุ ตรวจ `elementRendering.allowedElements` และซ้อน elemental VFX/badge จากระบบเกม (`mode=external-vfx`)

## ตำแหน่งและ flip

Actor origin=[0.5,1]; ถ้าจุดยืนบนพื้นคือ (x,y) ให้ตำแหน่ง origin ของ sprite เป็น (x,y+groundOffset) regular=4, boss battle=8 ตัวอย่างกรอบ64มี groundPoint=[32,60] และเงาวางที่ (x,y) ไม่ใช่ขอบล่างกรอบ

hitPoint/castPoint อยู่ในพิกัด cell ของภาพ ไม่ใช่พิกัดโลก แปลงด้วยตำแหน่ง top-left ของ cell; เมื่อ flip ให้ mirror จุดเหล่านี้ด้วย (สำหรับพิกัด pixel ใช้ W-1-localX) ภาพสนาม allowedFlip.x=true; ภาพโลกมี 4 ทิศเฉพาะและ allowedFlip.x=false

attack ส่ง event hit เฟรม3, cast ส่ง release ที่เฟรม3; อย่าผูกผลดาเมจซ้ำทุก render tick ของเฟรมนั้น ko หยุด/ค้างเฟรมสุดท้ายตาม holdLastFrame บอสที่ลงมือสองครั้งต่อรอบให้ replay clip ต่อแต่ละ action ไม่วน attack ทิ้งไว้

Shadow ใช้ shadowAsset -> assetId, origin=[0.5,0.5], renderAlpha=0.28 หลีกเลี่ยงวาดเงาซ้ำทั้ง actor และ equipment ขนาด128ของบอสต้องสงวนพื้นที่ ไม่ใส่ใน slot76px เดียวแล้ว scale ลง

## Body + equipment

อ่าน `bodyAsset` ของ weapon metadata เป็นตัวเลือกฐาน ไม่สมมติว่าทุกอาวุธใช้ human attack เดียวกัน: ธนูใช้ `player_human_battle_attack_physical_ranged` เฉพาะ attack; ท่าอื่นใช้ฐานปกติ

Body/equipment มี cell, origin, groundOffset และจำนวนเฟรมเท่ากัน ใช้นาฬิกาและ frame index เดียวกัน วาด body ก่อน equipment และ flip ทั้งสองพร้อมกัน ภาพ equipment เว้นมือในจุดจับไว้แล้ว; `gripPoints` / `weapon-sockets.json` ใช้อ้างอิงสำหรับการขยายชุด ไม่ต้องคำนวณการหมุนอาวุธซ้ำตอน runtime เพราะ bake มาแล้ว ลูกธนูพุ่ง/เส้น slash เป็น VFX ของเกม ไม่ได้ฝังในชั้นอาวุธ

## Tiles / occlusion

`tiles_dawn_town_base` และ `tiles_dawn_field_base`: cell32, 96ช่อง, animations=[] จึงเป็น atlas lookup ไม่ใช่ animation ยาว96เฟรม

1. แปลงอักษรด้วย metadata.legend ตาม TILE_LEGEND: `. , = # T ~` -> ground/grass/road/wall/tree/water
2. ตรวจเพื่อนบ้านชนิดเดียวกัน N=1,E=2,S=4,W=8; ขอบนอกแผนที่ถือเป็นชนิดเดียวกัน
3. index=`legendOrderIndex*16+neighborMask` หรือหาใน tileEntries โดย kind+neighborMask
4. วาด underlay แบบเต็มก่อน (ground index15, grass index31) ตาม entry.underlay แล้ววาด base
5. tree/wall มี companion upper แยก วาง tree_upper ด้วย tileOffset[-16,-32], wall_upper[0,-32] เทียบ top-left ช่อง; depth-sort upper ร่วมกับ actor ตามจุดล่างของช่องและ groundY ของ actor เพื่อให้คนเดินด้านหน้า/หลังได้ถูกต้อง ไม่วาด upper ทั้งหมดทับทุกคนเสมอ

รอยต่อเป็น 16-mask แบบ cardinal ไม่ใช่ 47-tile diagonal blob autotile ชั้น tree/wall ใช้ภาพฐานเดียวซ้ำใน16mask; metadata ยังคง lookup สม่ำเสมอ Town/field ใช้ palette/วัสดุร่วมกัน มี metadata แยกตาม mapId

Portal เป็น world-object 32×64, idle4@6 วางจาก portal.at ของแผนที่ และใช้ groundOffset4 ห้ามเปลี่ยน walkability จากภาพหรือสร้าง portal game-data ใหม่

## Battle background layers

`bg_<scene>_battle` เป็นภาพปิดเต็ม960×540; y450–540 เป็นพื้นที่ UI ฉากตัวอย่างแสดงแถบ UI ทับบริเวณนั้น `bg_<scene>_ambient` เป็น sprite64×64 หกเฟรม เล่น6fps วน วาดซ้ำตาม metadata.placements `{x,y,phaseOffset}` บนพื้นหลัง โดย frame=(clockFrame+phaseOffset)%6 ช่วยให้ sheet กว้างเพียง384px ไม่ต้องโหลด transparent sheet กว้าง5760px ปิดชั้นนี้ได้เมื่อ reduced motion

## ขอบเขตที่เหลือ

- Claude: ต่อ loader/renderer, animation events, depth-sort, elemental overlay และทดสอบ interaction ในเกมจริง
- Optional art: human อีก7เผ่า และก้ามบอสเป็นชั้นแยก ยังไม่มีในชุดนี้; ก้ามปัจจุบันรวมอยู่กับตัวบอส
- ห้ามตีความ grid_ready ว่า merge/production approval; ไม่มีการ merge หรือเปลี่ยนกฎเกมในงานนี้
