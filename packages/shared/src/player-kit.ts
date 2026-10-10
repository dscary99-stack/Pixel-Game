/**
 * What a character fights with (chapter 02; Nut 2026-10-09): the skills learned on its skill trees
 * (skill-tree.ts, class-trees.ts) at the levels learned, and its race passive from Lv1. Skill points
 * come from job levels (job.ts). Every learned skill is usable (no loadout yet).
 */
import { SKILL_TREES, TREE_PASSIVE_IDS } from "./content/class-trees";
import { treesFor, type SkillTree } from "./skill-tree";

export const RACE_PASSIVES: Readonly<Record<string, string>> = {
  "race:human": "skill:race_human_grit",
  "race:sylvan": "skill:race_sylvan_bloom",
  "race:stonekin": "skill:race_stonekin_stone",
  "race:wildkin": "skill:race_wildkin_instinct",
  "race:runeborn": "skill:race_runeborn_flow",
  "race:tideborn": "skill:race_tideborn_tide",
  "race:skyborn": "skill:race_skyborn_wind",
  "race:veilborn": "skill:race_veilborn_shade",
};

/**
 * Class2 branches (chapter 02 table, P16 draft): two per Class1, one picked after the trial at Lv50.
 * A branch opens its own skill tree (six actives, two passives) to spend Class2 job points on, beside
 * the Class1 tree. EXAMPLE names (STATUS A142, A143).
 */
export interface Class2Branch {
  id: string;
  classId: string;
  name: { th: string; en: string };
  /** The chapter 02 line: what the branch does and what it gives up. */
  summary: string;
  /** The branch's skill tree (class-trees.ts), opened by the trial. */
  treeId: string;
}

const branch = (id: string, classId: string, th: string, en: string, summary: string): Class2Branch => ({ id, classId, name: { th, en }, summary, treeId: id });

export const CLASS2_BRANCHES: readonly Class2Branch[] = [
  branch("class2:bastion", "class:guardian", "ปราการ", "Bastion", "โล่หลายเป้าหมายและรับแทน มีจำนวนครั้ง"),
  branch("class2:sentinel", "class:guardian", "ผู้เฝ้ารบ", "Sentinel", "ตั้งรับแล้วสวน ใช้จังหวะก่อนเร่งดาเมจ"),
  branch("class2:breaker", "class:striker", "ผู้ทะลวง", "Breaker", "เปิดช่วงเกราะอ่อนให้ทีม ขาดการสนับสนุนด้านอื่น"),
  branch("class2:berserker", "class:striker", "นักรบคลั่ง", "Berserker", "ใช้ HP เป็นต้นทุน แรงขึ้นเมื่อเลือดน้อย"),
  branch("class2:sharpshooter", "class:ranger", "มือยิงแม่น", "Sharpshooter", "เล็งเป้าหมายเดี่ยว แลก action เตรียมตัว"),
  branch("class2:trapper", "class:ranger", "นักวางกับดัก", "Trapper", "กับดักทำงานตามเหตุการณ์ ไม่ต้องเดินในฉากสู้"),
  branch("class2:elementalist", "class:arcanist", "ผู้ชำนาญธาตุ", "Elementalist", "วางธาตุแล้วต่อปฏิกิริยา แลก MP"),
  branch("class2:spellweaver", "class:arcanist", "ผู้ถักเวท", "Spellweaver", "เตรียมเวทไว้รอบถัดไป มีสัญญาณให้เห็น"),
  branch("class2:lifekeeper", "class:warden", "ผู้รักษาชีวิต", "Lifekeeper", "ฮีลต่อเนื่องและกระจาย ดาเมจต่ำ"),
  branch("class2:spiritkeeper", "class:warden", "ผู้พิทักษ์วิญญาณ", "Spiritkeeper", "ป้องกันล้มและชุบ มีต้นทุน ไม่ชุบวน"),
  branch("class2:beast_marshal", "class:binder", "ผู้บัญชาการคู่ใจ", "Beast Marshal", "แลก action ตัวเองให้คู่ใจลงมือทันที"),
  branch("class2:soul_linker", "class:binder", "ผู้เชื่อมสายสัมพันธ์", "Soul Linker", "เชื่อมสมาชิกแบ่งการคุ้มกัน ไม่เพิ่มช่องคู่ใจ"),
  branch("class2:assassin", "class:rogue", "นักสังหาร", "Assassin", "เปิดจุดอ่อนและเจาะแนวหลัง ไม่ล่องหนจนบอสทำอะไรไม่ได้"),
  branch("class2:saboteur", "class:rogue", "ผู้ก่อกวน", "Saboteur", "ทำลายบัฟและก่อกวน ไม่เพิ่ม loot"),
  branch("class2:apothecary", "class:alchemist", "นักปรุงโอสถ", "Apothecary", "ผสมรักษาและต้านสถานะ ไม่ผูกขาดงานคราฟต์"),
  branch("class2:transmuter", "class:alchemist", "ผู้แปรสสาร", "Transmuter", "สารตั้งต้นและปฏิกิริยาสนาม (น้ำมันเจอไฟ)"),
  branch("class2:minstrel", "class:bard", "นักบรรเลง", "Minstrel", "เพลงหลักหนุนทั้งทีม ไม่เพิ่ม EXP/drop"),
  branch("class2:dirgesinger", "class:bard", "ผู้ขับบทโศก", "Dirgesinger", "บทเพลงกดดันศัตรู มีโอกาสถูกต้าน"),
];

export const class2Branch = (id: string | null | undefined): Class2Branch | undefined => (id == null ? undefined : CLASS2_BRANCHES.find((b) => b.id === id));
export const class2BranchesOf = (classId: string): Class2Branch[] => CLASS2_BRANCHES.filter((b) => b.classId === classId);

/**
 * Class3 (chapter 02 table, P16 draft): one per Class2 branch, taken after the trial at Lv120 with
 * Class2 at its job cap. It opens its own tree (six actives, two passives and the Class3 signature
 * move) for Class3 job points. EXAMPLE names from chapter 02 (STATUS A146).
 */
export interface Class3Advance {
  id: string;
  /** The Class2 branch it continues. */
  branchId: string;
  name: { th: string; en: string };
  summary: string;
  treeId: string;
}

const advance = (key: string, branchId: string, th: string, en: string, summary: string): Class3Advance => ({ id: `class3:${key}`, branchId, name: { th, en }, summary, treeId: `class3:${key}` });

export const CLASS3_ADVANCES: readonly Class3Advance[] = [
  advance("aegis_sovereign", "class2:bastion", "จ้าวโล่พิทักษ์", "Aegis Sovereign", "โล่ทั้งทีมและรับแทน ไม้ตายโล่นิรันดร์"),
  advance("dread_bulwark", "class2:sentinel", "ปราการโต้กลับ", "Dread Bulwark", "ตั้งรับแล้วสวนกลับทั้งแนว"),
  advance("ruin_champion", "class2:breaker", "จอมยุทธ์ทลายเกราะ", "Ruin Champion", "ทลายเกราะศัตรูแล้วปลุกทั้งทีมบุก"),
  advance("bloodstorm", "class2:berserker", "พายุโลหิต", "Bloodstorm", "แลกเลือดเป็นพลัง ดูดเลือดกลับ"),
  advance("starpiercer", "class2:sharpshooter", "ศรทะลวงดาว", "Starpiercer", "เล็งเป้าเดี่ยวแรงสุด และชี้เป้าให้ทีม"),
  advance("wild_architect", "class2:trapper", "จ้าวสนามล่า", "Wild Architect", "สนามกับดักคุมศัตรูทั้งหมด"),
  advance("prismatic_archmage", "class2:elementalist", "มหาจอมเวทปริซึม", "Prismatic Archmage", "ต่อปฏิกิริยาธาตุ แลก MP"),
  advance("astral_weaver", "class2:spellweaver", "ผู้ถักดารา", "Astral Weaver", "ถักเวลาและผนึก เร่งพวกเราหน่วงศัตรู"),
  advance("verdant_hierophant", "class2:lifekeeper", "มหาผู้พิทักษ์ชีวิต", "Verdant Hierophant", "ฮีลต่อเนื่องทั้งทีม ดาเมจต่ำ"),
  advance("soulwarden", "class2:spiritkeeper", "ผู้คุ้มครองวิญญาณ", "Soulwarden", "กันล้มและชุบ มีต้นทุนสูง"),
  advance("grand_beast_marshal", "class2:beast_marshal", "จอมบัญชาการคู่ใจ", "Grand Beast Marshal", "สั่งทั้งฝูงลงมือพร้อมกัน"),
  advance("concord_sovereign", "class2:soul_linker", "จ้าวสายสัมพันธ์", "Concord Sovereign", "โยงศัตรูแบ่งดาเมจ ปกป้องทั้งทีม"),
  advance("night_reaper", "class2:assassin", "ผู้เก็บเกี่ยวรัตติกาล", "Night Reaper", "เปิดจุดตายแล้วปลิดชีพ"),
  advance("phantom_strategist", "class2:saboteur", "นักกลยุทธ์มายา", "Phantom Strategist", "ทำลายบัฟ ผนึก และภาพลวง"),
  advance("panacea_sage", "class2:apothecary", "ปราชญ์โอสถ", "Panacea Sage", "ฮีล ล้างสถานะ และภูมิคุ้มกันหมู่"),
  advance("magnum_artificer", "class2:transmuter", "มหาช่างแปรธาตุ", "Magnum Artificer", "น้ำมันเจอไฟ แปรสภาพเกราะ"),
  advance("celestial_maestro", "class2:minstrel", "วาทยกรดารา", "Celestial Maestro", "เพลงหลักหนุนทั้งทีม ไม่เพิ่ม EXP/drop"),
  advance("eclipse_cantor", "class2:dirgesinger", "ผู้ขับขานอุปราคา", "Eclipse Cantor", "บทเพลงกดดันและสาปศัตรู"),
];

export const class3Advance = (id: string | null | undefined): Class3Advance | undefined => (id == null ? undefined : CLASS3_ADVANCES.find((a) => a.id === id));
export const class3For = (branchId: string | null | undefined): Class3Advance | undefined => (branchId == null ? undefined : CLASS3_ADVANCES.find((a) => a.branchId === branchId));

/** The trees a character spends on: Class1, its branch when the branch is its class's, and its Class3 when that continues the branch. */
export function characterTrees(classId: string, class2Id: string | null | undefined, class3Id?: string | null): SkillTree[] {
  const b = class2Branch(class2Id);
  const branch = b?.classId === classId ? b : undefined;
  const a = class3Advance(class3Id);
  const third = branch !== undefined && a?.branchId === branch.id ? a : undefined;
  return treesFor(SKILL_TREES, classId, branch?.treeId ?? null, third?.treeId ?? null);
}

export interface PlayerKit {
  skillIds: string[];
  /** Learned level of each active (only the ones above Lv1 matter to the kernel, all are listed). */
  skillLevels: Record<string, number>;
  passiveIds: string[];
}

/**
 * The kit from what was learned. An unknown class or race has nothing (the character schema refuses
 * them); a Class2 branch counts only when it belongs to the character's Class1, and a learned level
 * above the node's max (a tree that changed) is clipped.
 */
export function playerKit(classId: string, raceId: string, class2Id: string | null | undefined, learned: Readonly<Record<string, number>> = {}, class3Id?: string | null): PlayerKit {
  const trees = characterTrees(classId, class2Id, class3Id);
  const skillIds: string[] = [];
  const skillLevels: Record<string, number> = {};
  const passiveIds: string[] = [];
  for (const t of trees) {
    for (const n of t.nodes) {
      const lv = Math.min(n.maxLevel, Math.floor(learned[n.skillId] ?? 0));
      if (lv < 1) continue;
      if (TREE_PASSIVE_IDS.has(n.skillId)) passiveIds.push(n.skillId);
      else {
        skillIds.push(n.skillId);
        skillLevels[n.skillId] = lv;
      }
    }
  }
  const race = RACE_PASSIVES[raceId];
  if (race !== undefined) passiveIds.push(race);
  return { skillIds, skillLevels, passiveIds };
}
