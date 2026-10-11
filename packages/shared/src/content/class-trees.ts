/**
 * EXAMPLE skill trees (Nut 2026-10-09; P16 class list, P29 job levels, P30 budget). Every Class1 tree
 * has physical, magic, support and debuff skills plus two passives, so a class can be built around
 * STR, INT or SPI and its race and element (skills marked own element take the character's element).
 * Class2 branch trees add six actives and two passives whose later skills reach both sides at once
 * (damage and a team buff, a heal and an enemy debuff, and so on). Coefficients come from the budget
 * (skill-builders.ts); names, costs, statuses and tree shapes are Claude's first pass (STATUS A143).
 *
 * Columns: 0 physical, 1 magic, 2 support, 3 debuff/utility. Passive nodes cost 3 points.
 */
import type { JobTier } from "../job";
import type { SkillDefinition, TargetRule } from "../schemas";
import type { SkillNode, SkillTree } from "../skill-tree";
import { D, H, R, S, passive, skill, st, tD, tH, tS, type Growth, type Primary, type Then } from "./skill-builders";

type Entry = { skill: SkillDefinition; max: number; col: number; row: number; req?: [string, number][]; cost?: number; capstone?: true };

/**
 * Capstones (Claude's skill pass after Nut 2026-10-09 17:14Z): one per column of a Class1 tree, below
 * the passives. Max Lv5 at 2 points a level, cooldown 6, and they need the column's deepest active at
 * Lv5 (or its max), so a build that commits to a line gets its payoff and the tree costs well over the
 * Class1 points.
 */
const CAPSTONE_ROW = 4;
const CAPSTONE_COST = 2;

function capstoneReq(entries: Entry[], col: number): [string, number][] {
  const line = entries.filter((e) => e.col === col && !e.capstone && e.skill.kind === "active").sort((a, b) => b.row - a.row);
  const last = line[0];
  return last === undefined ? [] : [[last.skill.id, Math.min(5, last.max)]];
}

function build(id: string, tier: JobTier, given: Entry[]): { tree: SkillTree; skills: SkillDefinition[] } {
  const entries = given.map((e) => (e.capstone ? { ...e, req: capstoneReq(given, e.col) } : e));
  const nodes: SkillNode[] = entries.map((e) => ({
    skillId: e.skill.id,
    maxLevel: e.max,
    cost: e.cost ?? (e.skill.kind === "passive" ? 3 : 1),
    requires: (e.req ?? []).map(([skillId, level]) => ({ skillId, level })),
    col: e.col,
    row: e.row,
  }));
  return { tree: { id, tier, nodes }, skills: entries.map((e) => e.skill) };
}

/** One active of a tree: [id suffix, Thai name, target, range, MP, cooldown, growth, primary, later effects]. */
function maker(prefix: string, tier: JobTier) {
  return (key: string, th: string, target: TargetRule, range: "melee" | "ranged", mp: number, cd: number, grow: Growth, primary: Primary, then?: Then[]) =>
    skill({ id: `skill:${prefix}_${key}`, th, tier, target, range, mp, cd, grow, primary, ...(then ? { then } : {}) });
}
const P = (prefix: string, tier: JobTier) => (key: string, th: string, triggers: Parameters<typeof passive>[2], mods: Parameters<typeof passive>[3] = []) => passive(`skill:${prefix}_${key}`, th, triggers, mods, tier);
const E = (skill: SkillDefinition, max: number, col: number, row: number, req: [string, number][] = []): Entry => ({ skill, max, col, row, req });
/** A capstone in column `col` (see CAPSTONE_ROW). */
const U = (skill: SkillDefinition, col: number): Entry => ({ skill, max: 5, col, row: CAPSTONE_ROW, cost: CAPSTONE_COST, capstone: true });

// ====================================================================== Class1 (tier 1)

function guardian() {
  const a = maker("guardian", 1), p = P("guardian", 1), id = (k: string) => `skill:guardian_${k}`;
  return build("class:guardian", 1, [
    E(a("shield_bash", "โล่ทุบสะท้าน", "single_enemy", "melee", 5, 2, "mixed", D("physical", { statuses: [st("stun", 20, 1)] })), 10, 0, 0),
    E(a("sweep", "กวาดโล่ปราบแนว", "enemy_row", "melee", 9, 3, "mixed", D("physical", { statuses: [st("atk_down", 30, 2)] })), 10, 0, 1, [[id("shield_bash"), 3]]),
    E(a("rebuke", "โล่ตอบโต้", "single_enemy", "melee", 10, 3, "mixed", D("physical"), [tS("self", st("counter", 100, 1))]), 10, 0, 2, [[id("shield_bash"), 5]]),
    E(a("holy_light", "รัศมีพิทักษ์", "single_enemy", "ranged", 6, 2, "dmg", D("magic", { own: true })), 10, 1, 0),
    E(a("sacred_wave", "ระลอกแสงศักดิ์สิทธิ์", "all_enemies", "ranged", 14, 4, "dmg", D("magic", { own: true }), [tS("self", st("shield", 100, 2, { shieldPct: 8 }))]), 10, 1, 1, [[id("holy_light"), 3]]),
    E(a("judgement", "ตราตุลาการ", "single_enemy", "ranged", 12, 3, "mixed", D("magic", { own: true, statuses: [st("mark", 60, 2)] })), 10, 1, 2, [[id("holy_light"), 5]]),
    E(a("cover", "โล่บังภัย", "single_ally", "ranged", 8, 3, "buff", S(st("shield", 100, 2, { shieldPct: 15 }), st("protect", 100, 2))), 10, 2, 0),
    E(a("bulwark", "กำแพงศิลา", "self", "ranged", 10, 4, "buff", S(st("def_up", 100, 3), st("mdef_up", 100, 3), st("dmg_reduction", 100, 2))), 5, 2, 1, [[id("cover"), 3]]),
    E(a("provoke", "ท้าประลอง", "enemy_row", "ranged", 6, 3, "debuff", S(st("taunt", 70, 2))), 5, 3, 0),
    E(a("daunt", "แววตาข่มทัพ", "all_enemies", "ranged", 12, 4, "debuff", S(st("atk_down", 50, 2), st("matk_down", 50, 2))), 10, 3, 1, [[id("provoke"), 3]]),
    E(p("heart", "หัวใจโล่เงิน", [{ on: "protected_ally", then: [{ kind: "restore_mp", target: "self", amount: 4 }] }], [{ kind: "guard_reduction", reductionPct: 15 }]), 1, 2, 3, [[id("cover"), 1]]),
    E(p("steadfast", "ยืนหยัดไม่ล้ม", [{ on: "hp_below", hpBelowPct: 30, oncePerBattle: true, then: [{ kind: "status", target: "self", statuses: [st("endure", 100, 2), st("dmg_reduction", 100, 2)] }] }]), 1, 3, 3, [[id("provoke"), 1]]),
    U(a("judgement_crash", "ค้อนโล่พิพากษา", "enemy_row", "melee", 18, 6, "mixed", D("physical", { statuses: [st("stun", 35, 1)] }), [tS("self", st("shield", 100, 2, { shieldPct: 10 }))]), 0),
    U(a("dawn_guard", "อรุณพิทักษ์", "all_enemies", "ranged", 22, 6, "dmg", D("magic", { own: true }), [tS("all_allies", st("shield", 100, 2, { shieldPct: 6 }))]), 1),
    U(a("aegis_of_faith", "ปราการศรัทธา", "all_allies", "ranged", 20, 6, "buff", S(st("shield", 100, 2, { shieldPct: 8 }), st("dmg_reduction", 100, 1))), 2),
    U(a("challenge", "ท้าทายทั้งสนาม", "all_enemies", "ranged", 18, 6, "debuff", S(st("taunt", 80, 2), st("atk_down", 50, 2)), [tS("self", st("def_up", 100, 3), st("counter", 100, 2))]), 3),
  ]);
}

function striker() {
  const a = maker("striker", 1), p = P("striker", 1), id = (k: string) => `skill:striker_${k}`;
  return build("class:striker", 1, [
    E(a("heavy_slash", "ฟันผ่าศิลา", "single_enemy", "melee", 6, 2, "dmg", D("physical")), 10, 0, 0),
    E(a("cleave", "ดาบกวาดลาน", "enemy_row", "melee", 8, 3, "dmg", D("physical")), 10, 0, 1, [[id("heavy_slash"), 3]]),
    E(a("all_in", "พุ่งทะลวงสุดตัว", "single_enemy", "melee", 12, 4, "dmg", D("physical", { riders: { recoilPct: 15, critBonusPct: 20 } })), 10, 0, 2, [[id("heavy_slash"), 5]]),
    E(a("blade_wave", "คลื่นดาบธาตุ", "single_enemy", "ranged", 6, 2, "dmg", D("magic", { own: true })), 10, 1, 0),
    E(a("war_blast", "ระเบิดเพลิงสมรภูมิ", "enemy_row", "ranged", 12, 3, "mixed", D("magic", { own: true, statuses: [st("burn", 30, 2)] })), 10, 1, 1, [[id("blade_wave"), 3]]),
    E(a("thunder_blade", "ดาบอัสนีกระโจน", "single_enemy", "melee", 14, 4, "mixed", D("magic", { bounce: { jumps: 2, falloffPct: 30 }, element: "WIND", statuses: [st("paralyze", 25, 1)] })), 10, 1, 2, [[id("blade_wave"), 5]]),
    E(a("war_cry", "โห่ร้องศึก", "self", "ranged", 8, 4, "buff", S(st("atk_up", 100, 3), st("crit_up", 100, 2))), 10, 2, 0),
    E(a("rally_troops", "กลองรบปลุกทัพ", "all_allies", "ranged", 14, 5, "buff", S(st("atk_up", 100, 2))), 10, 2, 1, [[id("war_cry"), 3]]),
    E(a("armor_break", "ดาบเจาะเกราะ", "single_enemy", "melee", 8, 3, "mixed", D("physical", { riders: { penetrationPct: 30 }, statuses: [st("def_down", 50, 2)] })), 10, 3, 0),
    E(a("roar", "คำรามสะท้านแนว", "all_enemies", "ranged", 12, 4, "debuff", S(st("def_down", 40, 2), st("spd_down", 40, 2))), 10, 3, 1, [[id("armor_break"), 3]]),
    E(p("fighting_blood", "เลือดนักรบ", [
      { on: "hp_below", hpBelowPct: 40, oncePerBattle: true, then: [{ kind: "status", target: "self", statuses: [st("atk_up", 100, 2)] }] },
      { on: "kill", then: [{ kind: "restore_mp", target: "self", amount: 4 }] },
    ]), 1, 0, 3, [[id("heavy_slash"), 1]]),
    E(p("swordcraft", "วิชาดาบเจาะช่อง", [], [{ kind: "damage_vs_status", statusId: "def_down", bonusPct: 15 }]), 1, 3, 3, [[id("armor_break"), 3]]),
    U(a("thousand_edges", "ดาบพันคม", "all_enemies", "melee", 20, 6, "dmg", D("physical", { riders: { critBonusPct: 20 } })), 0),
    U(a("sky_rend", "ดาบธาตุผ่าฟ้า", "single_enemy", "ranged", 22, 6, "dmg", D("magic", { own: true, riders: { penetrationPct: 30 } }), [tD("all_enemies", "magic", 0.25, { own: true })]), 1),
    U(a("battle_banner", "ธงรบไม่ถอย", "all_allies", "ranged", 20, 6, "buff", S(st("atk_up", 100, 2), st("crit_up", 100, 2)), [tS("self", st("endure", 100, 1))]), 2),
    U(a("break_morale", "ทลายขวัญทัพ", "all_enemies", "ranged", 18, 6, "debuff", S(st("def_down", 80, 2), st("atk_down", 70, 2), st("fear", 35, 1))), 3),
  ]);
}

function ranger() {
  const a = maker("ranger", 1), p = P("ranger", 1), id = (k: string) => `skill:ranger_${k}`;
  return build("class:ranger", 1, [
    E(a("marking_shot", "ศรหมายหัว", "single_enemy", "ranged", 5, 2, "mixed", D("physical", { riders: { accuracyBonusPct: 10 }, statuses: [st("mark", 80, 2)] })), 10, 0, 0),
    E(a("arrow_rain", "ห่าศรพิรุณ", "all_enemies", "ranged", 10, 3, "dmg", D("physical")), 10, 0, 1, [[id("marking_shot"), 3]]),
    E(a("finisher", "ศรปิดฉาก", "single_enemy", "ranged", 12, 4, "dmg", D("physical", { riders: { execute: { belowHpPct: 35, bonusPct: 70 } } })), 10, 0, 2, [[id("marking_shot"), 5]]),
    E(a("element_arrow", "ศรวิญญาณธาตุ", "single_enemy", "ranged", 6, 2, "dmg", D("magic", { own: true })), 10, 1, 0),
    E(a("burst_arrow", "ศรแตกกระจาย", "enemy_row", "ranged", 12, 3, "dmg", D("magic", { own: true })), 10, 1, 1, [[id("element_arrow"), 3]]),
    E(a("frost_arrow", "ศรน้ำค้างแข็ง", "single_enemy", "ranged", 12, 3, "mixed", D("magic", { element: "WATER", statuses: [st("spd_down", 60, 2), st("root", 40, 1)] })), 10, 1, 2, [[id("element_arrow"), 5]]),
    E(a("hawk_eye", "ตาเหยี่ยวเพ่งเล็ง", "self", "ranged", 8, 2, "buff", S(st("focus", 100, 2), st("crit_up", 100, 2), st("accuracy_up", 100, 2))), 10, 2, 0),
    E(a("field_remedy", "ยาสมุนไพรพราน", "single_ally", "ranged", 8, 3, "heal", H({ statuses: [st("regen", 100, 2)] })), 10, 2, 1, [[id("hawk_eye"), 3]]),
    E(a("snare", "บ่วงพรานป่า", "enemy_row", "ranged", 8, 3, "debuff", S(st("root", 70, 2), st("spd_down", 50, 2))), 5, 3, 0),
    E(a("smoke_veil", "ม่านควันพราน", "all_enemies", "ranged", 12, 4, "debuff", S(st("blind", 50, 2))), 10, 3, 1, [[id("snare"), 3]]),
    E(p("hunter_eye", "สัญชาตญาณพราน", [], [{ kind: "damage_vs_status", statusId: "mark", bonusPct: 15 }]), 1, 0, 3, [[id("marking_shot"), 1]]),
    E(p("light_step", "ฝีเท้าลมป่า", [
      { on: "moved", then: [{ kind: "status", target: "self", statuses: [st("evasion_up", 100, 1)] }] },
      { on: "battle_start", then: [{ kind: "status", target: "self", statuses: [st("accuracy_up", 100, 2)] }] },
    ]), 1, 3, 3, [[id("snare"), 1]]),
    U(a("storm_volley", "ห่าศรล้างแนว", "all_enemies", "ranged", 20, 6, "dmg", D("physical", { riders: { bonusVsStatus: { statusId: "mark", bonusPct: 40, consume: false } } })), 0),
    U(a("seeker_arrow", "ศรธาตุตามรอย", "single_enemy", "ranged", 20, 6, "mixed", D("magic", { own: true, riders: { accuracyBonusPct: 20, critBonusPct: 20 } }), [tS("all_enemies", st("mark", 50, 2))]), 1),
    U(a("hunters_path", "เส้นทางนักล่า", "all_allies", "ranged", 20, 6, "buff", S(st("accuracy_up", 100, 2), st("crit_up", 100, 2), st("spd_up", 100, 2))), 2),
    U(a("wild_net", "ตาข่ายป่า", "all_enemies", "ranged", 18, 6, "debuff", S(st("root", 90, 2), st("spd_down", 100, 3), st("def_down", 60, 2))), 3),
  ]);
}

function arcanist() {
  const a = maker("arcanist", 1), p = P("arcanist", 1), id = (k: string) => `skill:arcanist_${k}`;
  return build("class:arcanist", 1, [
    E(a("staff_strike", "ไม้เท้าสะกดคำ", "single_enemy", "melee", 4, 2, "mixed", D("physical", { statuses: [st("silence", 20, 1)] })), 10, 0, 0),
    E(a("rune_hammer", "ค้อนอักขระ", "single_enemy", "melee", 8, 3, "mixed", D("physical", { statuses: [st("knockback", 50, 1)] })), 10, 0, 1, [[id("staff_strike"), 3]]),
    E(a("blade_storm", "พายุดาบอาคม", "all_enemies", "ranged", 14, 4, "dmg", D("physical")), 10, 0, 2, [[id("staff_strike"), 5]]),
    E(a("arcane_bolt", "กระสุนอาคม", "single_enemy", "ranged", 6, 2, "dmg", D("magic", { own: true })), 10, 1, 0),
    E(a("storm", "พายุมนตรา", "all_enemies", "ranged", 12, 3, "dmg", D("magic", { own: true })), 10, 1, 1, [[id("arcane_bolt"), 3]]),
    E(a("prism_ray", "ลำแสงหักเห", "single_enemy", "ranged", 16, 4, "mixed", D("magic", { own: true, statuses: [st("mdef_down", 50, 2)] })), 10, 1, 2, [[id("arcane_bolt"), 5]]),
    E(a("mana_shield", "เกราะมนตรา", "self", "ranged", 8, 3, "buff", S(st("shield", 100, 2, { shieldPct: 15 }), st("mdef_up", 100, 2))), 10, 2, 0),
    E(a("quicken_spell", "เร่งมนตร์", "single_ally", "ranged", 10, 4, "buff", S(st("matk_up", 100, 3), st("focus", 100, 2))), 10, 2, 1, [[id("mana_shield"), 3]]),
    E(a("seal", "ตราปิดปาก", "single_enemy", "ranged", 8, 3, "debuff", S(st("silence", 50, 2), st("mp_cost_up", 40, 2))), 10, 3, 0),
    E(a("confusion_mist", "หมอกมายา", "enemy_row", "ranged", 12, 4, "debuff", S(st("confuse", 30, 1), st("blind", 40, 2))), 5, 3, 1, [[id("seal"), 3]]),
    E(p("mana_flow", "ธารมนตรา", [{ on: "used_skill", chancePct: 30, then: [{ kind: "restore_mp", target: "self", amount: 4 }] }]), 1, 1, 3, [[id("arcane_bolt"), 1]]),
    E(p("element_weave", "ถักทอธาตุ", [], [{ kind: "damage_vs_status", statusId: "wet", bonusPct: 10 }, { kind: "damage_vs_status", statusId: "burn", bonusPct: 10 }]), 1, 3, 3, [[id("seal"), 1]]),
    U(a("rune_blades", "ดาบอาคมพันเล่ม", "enemy_row", "ranged", 18, 6, "dmg", D("physical"), [tS("self", st("matk_up", 100, 2))]), 0),
    U(a("meteor", "อุกกาบาตธาตุ", "all_enemies", "ranged", 24, 6, "mixed", D("magic", { own: true, statuses: [st("mdef_down", 30, 2)] })), 1),
    U(a("mana_tide", "ห้วงมานา", "all_allies", "ranged", 20, 6, "buff", S(st("mp_regen", 100, 3), st("matk_up", 100, 2))), 2),
    U(a("grand_seal", "ผนึกทั้งสนาม", "all_enemies", "ranged", 18, 6, "debuff", S(st("silence", 70, 2), st("mp_cost_up", 80, 3), st("matk_down", 60, 2))), 3),
  ]);
}

function warden() {
  const a = maker("warden", 1), p = P("warden", 1), id = (k: string) => `skill:warden_${k}`;
  return build("class:warden", 1, [
    E(a("blessed_mace", "คทาพรประทาน", "single_enemy", "melee", 6, 2, "dmg", D("physical"), [tH("lowest_ally", 0.3)]), 10, 0, 0),
    E(a("purging_blow", "ทุบสลายมนตร์", "single_enemy", "melee", 8, 3, "mixed", D("physical", { statuses: [st("dispel", 50, 1)] })), 10, 0, 1, [[id("blessed_mace"), 3]]),
    E(a("chastise", "ทัณฑ์ตักเตือน", "enemy_row", "melee", 12, 4, "mixed", D("physical", { statuses: [st("atk_down", 30, 2)] })), 10, 0, 2, [[id("blessed_mace"), 5]]),
    E(a("holy_spark", "ประกายศักดิ์สิทธิ์", "single_enemy", "ranged", 6, 2, "dmg", D("magic", { own: true })), 10, 1, 0),
    E(a("cleansing_ray", "ลำแสงชำระบาป", "enemy_row", "ranged", 14, 4, "dmg", D("magic", { own: true }), [tS("all_allies", st("regen", 100, 1))]), 10, 1, 1, [[id("holy_spark"), 3]]),
    E(a("verdict", "คำพิพากษาสวรรค์", "single_enemy", "ranged", 14, 4, "dmg", D("magic", { own: true, riders: { execute: { belowHpPct: 30, bonusPct: 60 } } })), 10, 1, 2, [[id("holy_spark"), 5]]),
    E(a("mend", "สัมผัสเยียวยา", "single_ally", "ranged", 6, 2, "heal", H({ flat: 10 })), 10, 2, 0),
    E(a("soothing_wind", "สายลมเยียวยา", "all_allies", "ranged", 12, 3, "heal", H({ flat: 5 })), 10, 2, 1, [[id("mend"), 3]]),
    E(a("raise", "ปลุกวิญญาณคืนร่าง", "single_ally", "ranged", 16, 5, "heal", R(30)), 5, 2, 2, [[id("mend"), 5]]),
    E(a("purify", "น้ำมนต์ชำระ", "single_ally", "ranged", 8, 3, "buff", S(st("cleanse", 100, 1), st("res_up", 100, 2), st("regen", 100, 1))), 5, 3, 0),
    E(a("weary_curse", "คำสาปอ่อนแรง", "enemy_row", "ranged", 12, 4, "debuff", S(st("atk_down", 50, 2), st("matk_down", 50, 2))), 10, 3, 1, [[id("purify"), 1]]),
    E(p("grace", "พระคุณแห่งการรักษา", [], [{ kind: "heal_low_hp", belowHpPct: 40, bonusPct: 25 }]), 1, 2, 3, [[id("mend"), 1]]),
    E(p("steadfast_faith", "ศรัทธาไม่คลอน", [{ on: "ally_down", oncePerBattle: true, then: [{ kind: "status", target: "allies", statuses: [st("res_up", 100, 2), st("def_up", 100, 2)] }] }]), 1, 3, 3, [[id("purify"), 1]]),
    U(a("dawn_hammer", "ค้อนอรุณ", "enemy_row", "melee", 18, 6, "dmg", D("physical"), [tH("all_allies", 0.3)]), 0),
    U(a("heavens_verdict", "พิพากษาสวรรค์", "all_enemies", "ranged", 22, 6, "mixed", D("magic", { own: true, statuses: [st("anti_heal", 40, 2)] })), 1),
    U(a("sanctuary", "เขตศักดิ์สิทธิ์", "all_allies", "ranged", 26, 6, "heal", H({ statuses: [st("regen", 100, 1)] })), 2),
    U(a("forbidden_seal", "ตราต้องห้าม", "all_enemies", "ranged", 18, 6, "debuff", S(st("unbuffable", 90, 2), st("dispel", 90, 1), st("atk_down", 60, 2))), 3),
  ]);
}

function binder() {
  const a = maker("binder", 1), p = P("binder", 1), id = (k: string) => `skill:binder_${k}`;
  return build("class:binder", 1, [
    E(a("joint_strike", "จู่โจมคู่ใจประสาน", "single_enemy", "melee", 5, 2, "mixed", D("physical", { statuses: [st("mark", 60, 2)] })), 10, 0, 0),
    E(a("pack_maul", "สั่งคู่ใจขย้ำ", "single_enemy", "melee", 9, 3, "mixed", D("physical", { hits: 3, statuses: [st("vulnerable", 40, 2)] })), 10, 0, 1, [[id("joint_strike"), 3]]),
    E(a("pack_sweep", "ฝูงกวาดแนว", "enemy_row", "melee", 12, 4, "dmg", D("physical")), 10, 0, 2, [[id("joint_strike"), 5]]),
    E(a("bond_pulse", "ชีพจรสายใย", "single_enemy", "ranged", 6, 2, "dmg", D("magic", { own: true })), 10, 1, 0),
    E(a("bond_wave", "คลื่นสายสัมพันธ์", "all_enemies", "ranged", 12, 3, "dmg", D("magic", { own: true })), 10, 1, 1, [[id("bond_pulse"), 3]]),
    E(a("beast_sigil", "ตราอสูรข่มขวัญ", "single_enemy", "ranged", 12, 4, "mixed", D("magic", { own: true, statuses: [st("fear", 30, 1)] })), 10, 1, 2, [[id("bond_pulse"), 5]]),
    E(a("rouse", "ปลุกสัญชาตญาณ", "all_allies", "ranged", 10, 4, "buff", S(st("atk_up", 100, 3), st("matk_up", 100, 3))), 10, 2, 0),
    E(a("quicken", "เร่งฝีเท้าคู่ใจ", "single_ally", "ranged", 8, 4, "buff", S(st("advance", 100, 1), st("spd_up", 100, 2))), 5, 2, 1, [[id("rouse"), 3]]),
    E(a("bond_guard", "โล่สายใย", "all_allies", "ranged", 12, 4, "buff", S(st("shield", 100, 2, { shieldPct: 8 }))), 10, 2, 2, [[id("quicken"), 3]]),
    E(a("predator_gaze", "แววตาสัตว์ร้าย", "single_enemy", "ranged", 6, 3, "debuff", S(st("def_down", 50, 2), st("evasion_down", 50, 2))), 10, 3, 0),
    E(a("howl", "หอนสะท้านป่า", "all_enemies", "ranged", 12, 4, "debuff", S(st("fear", 25, 1), st("atk_down", 40, 2))), 10, 3, 1, [[id("predator_gaze"), 3]]),
    E(p("bond_link", "สายสัมพันธ์มั่น", [{ on: "ally_down", then: [{ kind: "status", target: "allies", statuses: [st("atk_up", 100, 2)] }] }]), 1, 2, 3, [[id("rouse"), 1]]),
    E(p("one_heart", "หัวใจเดียวกัน", [{ on: "battle_start", then: [{ kind: "status", target: "allies", statuses: [st("spd_up", 100, 1)] }] }]), 1, 3, 3, [[id("predator_gaze"), 1]]),
    U(a("pack_frenzy", "ฝูงคลั่ง", "single_enemy", "melee", 18, 6, "mixed", D("physical", { statuses: [st("vulnerable", 50, 2)] }), [tS("all_allies", st("atk_up", 100, 1))]), 0),
    U(a("bond_burst", "สายใยแตกพลัง", "all_enemies", "ranged", 22, 6, "dmg", D("magic", { own: true }), [tS("all_allies", st("shield", 100, 1, { shieldPct: 5 }))]), 1),
    U(a("one_pack", "ใจเดียวทั้งฝูง", "all_allies", "ranged", 20, 6, "buff", S(st("spd_up", 100, 2), st("atk_up", 100, 1), st("matk_up", 100, 1))), 2),
    U(a("alpha_glare", "สายตาจ้าวฝูง", "all_enemies", "ranged", 18, 6, "debuff", S(st("fear", 45, 1), st("def_down", 80, 2), st("evasion_down", 70, 2))), 3),
  ]);
}

function rogue() {
  const a = maker("rogue", 1), p = P("rogue", 1), id = (k: string) => `skill:rogue_${k}`;
  return build("class:rogue", 1, [
    E(a("bleeding_stab", "แทงเลือดซึม", "single_enemy", "melee", 5, 2, "mixed", D("physical", { statuses: [st("bleed", 60, 3)] })), 10, 0, 0),
    E(a("shadow_blade", "มีดบินเงา", "single_enemy", "ranged", 8, 3, "dmg", D("physical", { hits: 3, riders: { critBonusPct: 25, accuracyBonusPct: 10 } })), 10, 0, 1, [[id("bleeding_stab"), 3]]),
    E(a("throat_cut", "ปาดคอเงียบ", "single_enemy", "melee", 12, 4, "dmg", D("physical", { riders: { execute: { belowHpPct: 30, bonusPct: 100 } } })), 10, 0, 2, [[id("bleeding_stab"), 5]]),
    E(a("shade_knife", "กริชเงาธาตุ", "single_enemy", "ranged", 6, 2, "dmg", D("magic", { own: true })), 10, 1, 0),
    E(a("venom_shade", "เงาพิษ", "single_enemy", "ranged", 10, 3, "mixed", D("magic", { own: true, statuses: [st("poison", 50, 3)] })), 10, 1, 1, [[id("shade_knife"), 3]]),
    E(a("toxic_bomb", "ลูกควันพิษ", "all_enemies", "ranged", 14, 4, "mixed", D("magic", { own: true, statuses: [st("poison", 25, 2)] })), 10, 1, 2, [[id("shade_knife"), 5]]),
    E(a("shadow_veil", "กลืนหายในเงา", "self", "ranged", 6, 4, "buff", S(st("stealth", 100, 1), st("crit_up", 100, 2))), 5, 2, 0),
    E(a("shadow_step", "ย่างเงา", "self", "ranged", 8, 4, "buff", S(st("evasion_up", 100, 2), st("spd_up", 100, 2), st("advance", 100, 1))), 5, 2, 1, [[id("shadow_veil"), 3]]),
    E(a("pilfer", "หยิบฉวยพร", "single_enemy", "melee", 8, 3, "mixed", D("physical", { statuses: [st("steal_buff", 60, 1)] })), 10, 3, 0),
    E(a("blinding_dust", "ผงปิดตา", "enemy_row", "ranged", 10, 4, "debuff", S(st("blind", 60, 2))), 10, 3, 1, [[id("pilfer"), 3]]),
    E(p("opportunist", "ฉวยจังหวะ", [], [{ kind: "damage_vs_status", statusId: "bleed", bonusPct: 20 }]), 1, 0, 3, [[id("bleeding_stab"), 1]]),
    E(p("quick_hands", "มือไวกว่าตา", [{ on: "kill", then: [{ kind: "status", target: "self", statuses: [st("spd_up", 100, 1)] }] }]), 1, 3, 3, [[id("pilfer"), 1]]),
    U(a("dance_of_blades", "ร่ายรำพันคม", "enemy_row", "melee", 18, 6, "mixed", D("physical", { riders: { critBonusPct: 20 }, statuses: [st("bleed", 50, 3)] })), 0),
    U(a("death_shade", "เงามรณะ", "single_enemy", "ranged", 20, 6, "mixed", D("magic", { own: true, riders: { execute: { belowHpPct: 35, bonusPct: 80 } }, statuses: [st("poison", 50, 3)] })), 1),
    U(a("shadow_curtain", "ม่านเงาคุ้มทีม", "all_allies", "ranged", 20, 6, "buff", S(st("evasion_up", 100, 3), st("spd_up", 100, 2)), [tS("self", st("stealth", 100, 1), st("crit_up", 100, 3))]), 2),
    U(a("dark_haze", "ม่านพิษมืด", "all_enemies", "ranged", 18, 6, "debuff", S(st("blind", 60, 2), st("poison", 60, 3), st("res_down", 50, 2))), 3),
  ]);
}

function alchemist() {
  const a = maker("alchemist", 1), p = P("alchemist", 1), id = (k: string) => `skill:alchemist_${k}`;
  return build("class:alchemist", 1, [
    E(a("flask_throw", "ขวดกัดกร่อน", "single_enemy", "ranged", 5, 2, "mixed", D("physical", { statuses: [st("corrode", 40, 3)] })), 10, 0, 0),
    E(a("flask_burst", "ขวดพิษแตกซ่าน", "enemy_row", "ranged", 10, 3, "mixed", D("physical", { statuses: [st("poison", 30, 3)] })), 10, 0, 1, [[id("flask_throw"), 3]]),
    E(a("strong_acid", "กรดสลายเกราะ", "single_enemy", "ranged", 12, 4, "mixed", D("physical", { riders: { penetrationPct: 40 }, statuses: [st("def_down", 40, 2)] })), 10, 0, 2, [[id("flask_throw"), 5]]),
    E(a("element_flask", "ขวดธาตุกระดอน", "single_enemy", "ranged", 6, 2, "dmg", D("magic", { bounce: { jumps: 1, falloffPct: 40 }, own: true })), 10, 1, 0),
    E(a("chain_reaction", "หยดน้ำมันโหม", "all_enemies", "ranged", 12, 3, "mixed", D("magic", { own: true, statuses: [st("oil", 40, 2)] })), 10, 1, 1, [[id("element_flask"), 3]]),
    E(a("ignite", "ประกายจุดเพลิง", "enemy_row", "ranged", 14, 4, "mixed", D("magic", { element: "FIRE", riders: { bonusVsStatus: { statusId: "oil", bonusPct: 40, consume: false } }, statuses: [st("burn", 50, 2)] })), 10, 1, 2, [[id("element_flask"), 5]]),
    E(a("quick_remedy", "ยาด่วนพิเศษ", "single_ally", "ranged", 8, 3, "heal", H({ flat: 15, statuses: [st("regen", 100, 3)] })), 10, 2, 0),
    E(a("tonic", "ยาบำรุงกำลัง", "single_ally", "ranged", 10, 4, "buff", S(st("atk_up", 100, 3), st("matk_up", 100, 3))), 10, 2, 1, [[id("quick_remedy"), 3]]),
    E(a("toxic_cloud", "ไอพิษลอยคลุ้ง", "all_enemies", "ranged", 12, 4, "debuff", S(st("poison", 45, 3), st("anti_heal", 40, 2))), 10, 3, 0),
    E(a("corrosive", "น้ำยากัดผิว", "single_enemy", "ranged", 8, 3, "debuff", S(st("corrode", 70, 3), st("res_down", 50, 2))), 10, 3, 1, [[id("toxic_cloud"), 3]]),
    E(p("brewer", "ฝีมือปรุงยา", [{ on: "used_item", then: [{ kind: "restore_mp", target: "self", amount: 5 }] }]), 1, 2, 3, [[id("quick_remedy"), 1]]),
    E(p("toxin_ward", "ภูมิต้านพิษ", [{ on: "battle_start", then: [{ kind: "status", target: "self", statuses: [st("res_up", 100, 3)] }] }]), 1, 3, 3, [[id("toxic_cloud"), 1]]),
    U(a("grand_flask", "ระเบิดขวดใหญ่", "all_enemies", "ranged", 20, 6, "mixed", D("physical", { statuses: [st("corrode", 40, 3)] })), 0),
    U(a("transmute_ruin", "แปรธาตุมหาวิบัติ", "all_enemies", "ranged", 22, 6, "dmg", D("magic", { own: true, riders: { bonusVsStatus: { statusId: "poison", bonusPct: 40, consume: false } } })), 1),
    U(a("elixir", "ยาอายุวัฒนะ", "all_allies", "ranged", 28, 6, "heal", H({ statuses: [st("res_up", 100, 2)] })), 2),
    U(a("corrosive_fog", "หมอกกัดกร่อน", "all_enemies", "ranged", 18, 6, "debuff", S(st("corrode", 80, 3), st("def_down", 70, 2), st("anti_heal", 70, 2))), 3),
  ]);
}

function bard() {
  const a = maker("bard", 1), p = P("bard", 1), id = (k: string) => `skill:bard_${k}`;
  return build("class:bard", 1, [
    E(a("lute_smash", "ฟาดพิณสะดุดจังหวะ", "single_enemy", "melee", 5, 2, "mixed", D("physical", { statuses: [st("delay", 30, 1)] })), 10, 0, 0),
    E(a("blade_dance", "ระบำใบมีด", "enemy_row", "melee", 10, 3, "dmg", D("physical"), [tS("self", st("evasion_up", 100, 1))]), 10, 0, 1, [[id("lute_smash"), 3]]),
    E(a("battle_hymn", "ลำนำฝ่าสมรภูมิ", "single_enemy", "melee", 12, 4, "dmg", D("physical"), [tS("all_allies", st("atk_up", 100, 1))]), 10, 0, 2, [[id("lute_smash"), 5]]),
    E(a("shrill_note", "เสียงแหลมเสียดหู", "single_enemy", "ranged", 6, 2, "mixed", D("magic", { bounce: { jumps: 2, falloffPct: 30 }, own: true, statuses: [st("fear", 25, 1)] })), 10, 1, 0),
    E(a("sound_wave", "คลื่นเสียงสะท้อน", "all_enemies", "ranged", 12, 3, "dmg", D("magic", { own: true })), 10, 1, 1, [[id("shrill_note"), 3]]),
    E(a("shiver_chord", "คอร์ดสะท้านกาย", "single_enemy", "ranged", 12, 4, "mixed", D("magic", { own: true, statuses: [st("paralyze", 30, 1)] })), 10, 1, 2, [[id("shrill_note"), 5]]),
    E(a("war_song", "เพลงปลุกใจศึก", "all_allies", "ranged", 8, 3, "buff", S(st("atk_up", 100, 2), st("matk_up", 100, 2))), 10, 2, 0),
    E(a("ward_song", "บทเพลงปกป้อง", "all_allies", "ranged", 10, 4, "buff", S(st("def_up", 100, 3), st("mdef_up", 100, 3))), 10, 2, 1, [[id("war_song"), 3]]),
    E(a("healing_song", "ลำนำเยียวยา", "all_allies", "ranged", 14, 4, "heal", H({ statuses: [st("mp_regen", 100, 2)] })), 10, 2, 2, [[id("ward_song"), 3]]),
    E(a("lullaby", "เพลงกล่อมนิทรา", "enemy_row", "ranged", 12, 4, "debuff", S(st("sleep", 35, 2))), 5, 3, 0),
    E(a("dirge_of_weariness", "บทเพลงเหนื่อยล้า", "all_enemies", "ranged", 12, 4, "debuff", S(st("spd_down", 50, 2), st("res_down", 40, 2))), 10, 3, 1, [[id("lullaby"), 3]]),
    E(p("rhythm", "จังหวะชีพจร", [{ on: "battle_start", then: [{ kind: "status", target: "allies", statuses: [st("accuracy_up", 100, 2)] }] }]), 1, 2, 3, [[id("war_song"), 1]]),
    E(p("echo", "เสียงสะท้อนก้อง", [{ on: "used_skill", chancePct: 25, then: [{ kind: "restore_mp", target: "self", amount: 5 }] }]), 1, 1, 3, [[id("shrill_note"), 1]]),
    U(a("war_dance", "ระบำมหาศึก", "all_enemies", "melee", 20, 6, "dmg", D("physical"), [tS("all_allies", st("evasion_up", 100, 1))]), 0),
    U(a("symphony", "ซิมโฟนีธาตุ", "all_enemies", "ranged", 22, 6, "dmg", D("magic", { own: true }), [tS("all_allies", st("matk_up", 100, 1))]), 1),
    U(a("anthem", "บทเพลงสรรเสริญ", "all_allies", "ranged", 22, 6, "buff", S(st("atk_up", 100, 2), st("matk_up", 100, 2))), 2),
    U(a("grand_lullaby", "เพลงกล่อมทั้งสนาม", "all_enemies", "ranged", 18, 6, "debuff", S(st("sleep", 70, 1), st("atk_down", 70, 2), st("res_down", 70, 3))), 3),
  ]);
}

// ====================================================================== Class2 (tier 2)

/** A Class2 tree; `base` is the Class1 tree its magic line builds on. */
function c2(branch: string, entries: (a: ReturnType<typeof maker>, p: ReturnType<typeof P>, id: (k: string) => string) => Entry[]) {
  const prefix = `c2_${branch}`;
  return build(`class2:${branch}`, 2, entries(maker(prefix, 2), P(prefix, 2), (k) => `skill:${prefix}_${k}`));
}

const CLASS2 = [
  c2("bastion", (a, p, id) => [
    E(a("wall", "กำแพงโล่ทั้งทัพ", "all_allies", "ranged", 22, 4, "buff", S(st("shield", 100, 2, { shieldPct: 12 })), [tS("self", st("def_up", 100, 2))]), 10, 2, 0),
    E(a("stand_in", "รับแทนด้วยกาย", "single_ally", "ranged", 16, 3, "buff", S(st("protect", 100, 2), st("def_up", 100, 2)), [tS("self", st("dmg_reduction", 100, 2))]), 10, 2, 1, [[id("wall"), 3]]),
    E(a("rampart_strike", "ปราการกระแทก", "enemy_row", "melee", 20, 4, "mixed", D("physical", { statuses: [st("taunt", 60, 2)] }), [tS("all_allies", st("shield", 100, 1, { shieldPct: 5 }))]), 10, 0, 0),
    E(a("holy_aegis", "โล่ศักดิ์สิทธิ์ส่องทัพ", "all_enemies", "ranged", 24, 4, "dmg", D("magic", { own: true }), [tS("all_allies", st("mdef_up", 100, 2))]), 10, 1, 0, [["skill:guardian_holy_light", 5]]),
    E(a("iron_fortress", "ป้อมเหล็กไหล", "self", "ranged", 30, 6, "buff", S(st("invincible", 100, 1)), [tS("all_allies", st("def_up", 100, 2))]), 5, 2, 2, [[id("stand_in"), 5]]),
    E(a("wall_press", "ดันกำแพงข่มศัตรู", "all_enemies", "ranged", 22, 4, "debuff", S(st("atk_down", 50, 2), st("taunt", 40, 1)), [tS("self", st("counter", 100, 1))]), 10, 3, 0),
    E(p("layers", "เกราะซ้อนชั้น", [{ on: "protected_ally", then: [{ kind: "status", target: "other", statuses: [st("shield", 100, 2, { shieldPct: 6 })] }] }], [{ kind: "guard_reduction", reductionPct: 10 }]), 1, 2, 3, [[id("wall"), 1]]),
    E(p("iron_will", "ใจเหล็ก", [{ on: "took_damage", chancePct: 25, then: [{ kind: "status", target: "self", statuses: [st("def_up", 100, 1)] }] }]), 1, 3, 3, [[id("wall_press"), 1]]),
    U(a("eternal_bulwark", "ป้อมปราการนิรันดร์", "all_allies", "ranged", 34, 6, "buff", S(st("shield", 100, 2, { shieldPct: 10 }), st("def_up", 100, 1)), [tS("all_enemies", st("taunt", 50, 1))]), 2),
  ]),
  c2("sentinel", (a, p, id) => [
    E(a("stance", "ท่ารอสวน", "self", "ranged", 16, 3, "buff", S(st("counter", 100, 2), st("def_up", 100, 2))), 10, 2, 0),
    E(a("payback", "ทวงคืน", "single_enemy", "melee", 20, 3, "mixed", D("physical", { riders: { penetrationPct: 20 }, statuses: [st("atk_down", 40, 2)] })), 10, 0, 0),
    E(a("line_riposte", "สวนกลับทั้งแถว", "enemy_row", "melee", 24, 4, "dmg", D("physical"), [tS("self", st("counter", 100, 1))]), 10, 0, 1, [[id("payback"), 3]]),
    E(a("ward_blade", "ดาบอักขระกันภัย", "single_enemy", "ranged", 18, 3, "dmg", D("magic", { own: true }), [tS("self", st("shield", 100, 2, { shieldPct: 10 }))]), 10, 1, 0, [["skill:guardian_holy_light", 5]]),
    E(a("watchful_eye", "ตาเฝ้ายาม", "all_allies", "ranged", 22, 4, "buff", S(st("accuracy_up", 100, 2), st("crit_up", 100, 2)), [tS("all_enemies", st("evasion_down", 40, 2))]), 10, 2, 1, [[id("stance"), 3]]),
    E(a("hold_the_line", "ปักหลักไม่ถอย", "self", "ranged", 26, 5, "buff", S(st("endure", 100, 2), st("dmg_reduction", 100, 2)), [tS("all_enemies", st("taunt", 50, 1))]), 5, 3, 0, [[id("stance"), 5]]),
    E(p("riposte", "สัญชาตญาณสวน", [{ on: "took_damage", chancePct: 25, then: [{ kind: "status", target: "self", statuses: [st("counter", 100, 1)] }] }]), 1, 2, 3, [[id("stance"), 1]]),
    E(p("warrior_focus", "สมาธิผู้เฝ้า", [{ on: "hp_below", hpBelowPct: 50, oncePerBattle: true, then: [{ kind: "status", target: "self", statuses: [st("atk_up", 100, 2), st("focus", 100, 1)] }] }]), 1, 0, 3, [[id("payback"), 1]]),
    U(a("grand_riposte", "สวนกลับพันครั้ง", "enemy_row", "melee", 32, 6, "dmg", D("physical", { riders: { penetrationPct: 20 } }), [tS("self", st("counter", 100, 2))]), 0),
  ]),
  c2("breaker", (a, p, id) => [
    E(a("shatter", "ค้อนแตกเกราะ", "single_enemy", "melee", 20, 3, "mixed", D("physical", { riders: { penetrationPct: 40 }, statuses: [st("def_down", 70, 3), st("vulnerable", 40, 2)] })), 10, 0, 0),
    E(a("wave", "คลื่นแผ่นดินแยก", "enemy_row", "melee", 24, 4, "mixed", D("physical", { riders: { penetrationPct: 25 }, statuses: [st("def_down", 40, 2)] })), 10, 0, 1, [[id("shatter"), 3]]),
    E(a("rear_breach", "ทะลวงถึงแนวหลัง", "single_enemy", "ranged", 22, 4, "dmg", D("physical"), [tS("all_enemies", st("def_down", 30, 2))]), 10, 0, 2, [[id("wave"), 3]]),
    E(a("ward_breaker", "ทุบผนึกธาตุ", "single_enemy", "ranged", 20, 3, "mixed", D("magic", { own: true, statuses: [st("mdef_down", 60, 2)] }), [tS("all_allies", st("matk_up", 100, 1))]), 10, 1, 0, [["skill:striker_blade_wave", 5]]),
    E(a("open_gap", "ฉีกช่องโหว่", "all_enemies", "ranged", 24, 4, "debuff", S(st("vulnerable", 40, 2), st("def_down", 40, 2)), [tS("all_allies", st("accuracy_up", 100, 2))]), 10, 3, 0),
    E(a("final_fist", "หมัดปิดบัญชี", "single_enemy", "melee", 28, 5, "dmg", D("physical", { riders: { bonusVsStatus: { statusId: "def_down", bonusPct: 60, consume: true }, execute: { belowHpPct: 30, bonusPct: 60 } } })), 10, 0, 3, [[id("shatter"), 5]]),
    E(p("crack", "รอยร้าวลึก", [{ on: "dealt_damage", action: "skill", chancePct: 25, then: [{ kind: "status", target: "other", statuses: [st("def_down", 60, 2)] }] }], [{ kind: "damage_vs_status", statusId: "def_down", bonusPct: 15 }]), 1, 3, 3, [[id("open_gap"), 1]]),
    E(p("relentless", "ทุบไม่หยุด", [{ on: "kill", then: [{ kind: "restore_mp", target: "self", amount: 8 }] }]), 1, 1, 3, [[id("shatter"), 1]]),
    U(a("earthshatter", "ทลายปฐพี", "all_enemies", "melee", 36, 6, "mixed", D("physical", { riders: { penetrationPct: 40 }, statuses: [st("def_down", 50, 2)] })), 0),
  ]),
  c2("berserker", (a, p, id) => [
    E(a("blood_slash", "ฟันเลือดพล่าน", "single_enemy", "melee", 16, 3, "dmg", D("physical", { hits: 2, riders: { recoilPct: 12 } })), 10, 0, 0),
    E(a("fury", "โทสะเดือด", "self", "ranged", 18, 5, "buff", S(st("rage", 100, 3, { stacks: 3 }), st("atk_up", 100, 3)), [tS("all_enemies", st("taunt", 40, 1))]), 10, 2, 0),
    E(a("blood_storm", "วังวนโลหิต", "all_enemies", "melee", 26, 4, "dmg", D("physical", { riders: { recoilPct: 10, lifestealPct: 15 } })), 10, 0, 1, [[id("blood_slash"), 3]]),
    E(a("blood_flame", "เปลวเลือดธาตุ", "single_enemy", "ranged", 20, 3, "mixed", D("magic", { own: true, riders: { lifestealPct: 20 }, statuses: [st("burn", 30, 2)] })), 10, 1, 0, [["skill:striker_blade_wave", 5]]),
    E(a("mad_roar", "คำรามคลั่ง", "all_enemies", "ranged", 22, 4, "debuff", S(st("fear", 30, 1), st("def_down", 40, 2)), [tS("self", st("atk_up", 100, 2))]), 10, 3, 0),
    E(a("to_the_end", "ฟาดฟันไม่สิ้นลม", "single_enemy", "melee", 28, 5, "dmg", D("physical", { hits: 4, riders: { execute: { belowHpPct: 40, bonusPct: 80 }, recoilPct: 15 } }), [tS("self", st("endure", 100, 1))]), 10, 0, 2, [[id("blood_storm"), 3]]),
    E(p("blood", "เลือดร้อน", [
      { on: "hp_below", hpBelowPct: 50, oncePerBattle: true, then: [{ kind: "status", target: "self", statuses: [st("rage", 100, 3, { stacks: 2 })] }] },
      { on: "kill", then: [{ kind: "heal", target: "self", pctMaxHp: 5 }] },
    ]), 1, 2, 3, [[id("fury"), 1]]),
    E(p("pain_is_power", "เจ็บแล้วแกร่ง", [{ on: "took_damage", chancePct: 30, then: [{ kind: "status", target: "self", statuses: [st("rage", 100, 2)] }] }]), 1, 0, 3, [[id("blood_slash"), 1]]),
    U(a("last_frenzy", "คลั่งสุดขีด", "all_enemies", "melee", 34, 6, "dmg", D("physical", { riders: { recoilPct: 15, lifestealPct: 20 } }), [tS("self", st("rage", 100, 2, { stacks: 2 }))]), 0),
  ]),
  c2("sharpshooter", (a, p, id) => [
    E(a("aim", "เล็งลมหายใจเดียว", "self", "ranged", 16, 3, "buff", S(st("focus", 100, 2), st("crit_up", 100, 2), st("atk_up", 100, 2))), 10, 2, 0),
    E(a("piercer", "ศรทะลุเป้า", "single_enemy", "ranged", 24, 3, "dmg", D("physical", { bounce: { jumps: 1, falloffPct: 20 }, riders: { penetrationPct: 30, accuracyBonusPct: 20, bonusVsStatus: { statusId: "mark", bonusPct: 40, consume: true } } })), 10, 0, 0),
    E(a("pin_shadow", "ศรตรึงเงา", "single_enemy", "ranged", 20, 3, "mixed", D("physical", { statuses: [st("root", 60, 2), st("mark", 60, 2)] })), 10, 0, 1, [[id("piercer"), 3]]),
    E(a("element_pierce", "ศรธาตุเจาะเกราะ", "single_enemy", "ranged", 22, 3, "mixed", D("magic", { own: true, statuses: [st("mdef_down", 50, 2)] }), [tS("self", st("focus", 100, 1))]), 10, 1, 0, [["skill:ranger_element_arrow", 5]]),
    E(a("deadly_volley", "ห่าศรมรณะ", "all_enemies", "ranged", 28, 4, "dmg", D("physical", { riders: { critBonusPct: 20 } }), [tS("self", st("accuracy_up", 100, 2))]), 10, 0, 2, [[id("pin_shadow"), 3]]),
    E(a("signal_mark", "ธงหมายหัว", "all_enemies", "ranged", 20, 4, "debuff", S(st("mark", 60, 2)), [tS("all_allies", st("accuracy_up", 100, 2))]), 10, 3, 0),
    E(p("steady", "มือไม่สั่น", [{ on: "kill", then: [{ kind: "status", target: "self", statuses: [st("focus", 100, 2)] }] }], [{ kind: "damage_vs_status", statusId: "mark", bonusPct: 10 }]), 1, 0, 3, [[id("piercer"), 1]]),
    E(p("calm_breath", "ลมหายใจสงบ", [{ on: "battle_start", then: [{ kind: "status", target: "self", statuses: [st("focus", 100, 1)] }] }]), 1, 2, 3, [[id("aim"), 1]]),
    U(a("one_shot", "ศรเดียวปลิดชีพ", "single_enemy", "ranged", 34, 6, "dmg", D("physical", { riders: { penetrationPct: 40, critBonusPct: 30, execute: { belowHpPct: 40, bonusPct: 80 } } })), 0),
  ]),
  c2("trapper", (a, p, id) => [
    E(a("root_trap", "กับดักตรึงขา", "enemy_row", "ranged", 18, 3, "debuff", S(st("root", 70, 2), st("spd_down", 60, 2))), 10, 3, 0),
    E(a("spike_field", "ลานหนามเหล็ก", "all_enemies", "ranged", 26, 4, "mixed", D("physical", { statuses: [st("bleed", 40, 2)] })), 10, 0, 0),
    E(a("blast_trap", "กับดักดินระเบิด", "enemy_row", "ranged", 22, 4, "mixed", D("physical", { statuses: [st("knockback", 40, 1)] }), [tS("self", st("evasion_up", 100, 1))]), 10, 0, 1, [[id("spike_field"), 3]]),
    E(a("element_trap", "กับดักธาตุแตก", "all_enemies", "ranged", 24, 4, "mixed", D("magic", { own: true, statuses: [st("wet", 40, 2)] })), 10, 1, 0, [["skill:ranger_element_arrow", 5]]),
    E(a("capture_net", "ตาข่ายจับเป็น", "single_enemy", "ranged", 18, 4, "debuff", S(st("root", 80, 2), st("spd_down", 60, 2), st("delay", 50, 1)), [tS("all_allies", st("spd_up", 100, 1))]), 5, 3, 1, [[id("root_trap"), 3]]),
    E(a("hide", "ซุ้มพรางกาย", "all_allies", "ranged", 22, 5, "buff", S(st("evasion_up", 100, 2)), [tS("all_enemies", st("blind", 30, 2))]), 10, 2, 0),
    E(p("snare", "บ่วงลับ", [{ on: "took_damage", chancePct: 30, then: [{ kind: "status", target: "other", statuses: [st("spd_down", 60, 2)] }] }]), 1, 3, 3, [[id("root_trap"), 1]]),
    E(p("trap_smith", "ช่างวางกับดัก", [{ on: "used_skill", skillApplies: "root", then: [{ kind: "restore_mp", target: "self", amount: 6 }] }]), 1, 2, 3, [[id("hide"), 1]]),
    U(a("death_field", "เขตกับดักมรณะ", "all_enemies", "ranged", 30, 6, "debuff", S(st("root", 70, 2), st("bleed", 70, 3), st("spd_down", 70, 2)), [tS("all_allies", st("spd_up", 100, 2))]), 3),
  ]),
  c2("elementalist", (a, p, id) => [
    E(a("torrent", "สายน้ำโถม", "single_enemy", "ranged", 18, 2, "mixed", D("magic", { element: "WATER", statuses: [st("wet", 80, 2)] })), 10, 1, 0),
    E(a("thunder", "อัสนีลูกโซ่", "single_enemy", "ranged", 26, 3, "mixed", D("magic", { bounce: { jumps: 3, falloffPct: 25 }, element: "WIND", riders: { bonusVsStatus: { statusId: "wet", bonusPct: 50, consume: true } }, statuses: [st("shock", 40, 2)] })), 10, 1, 1, [[id("torrent"), 3]]),
    E(a("element_storm", "พายุสี่ธาตุ", "all_enemies", "ranged", 28, 4, "dmg", D("magic", { own: true }), [tS("self", st("matk_up", 100, 2))]), 10, 1, 2, [[id("torrent"), 5]]),
    E(a("wild_flame", "เพลิงป่าโหม", "enemy_row", "ranged", 24, 4, "mixed", D("magic", { element: "FIRE", statuses: [st("burn", 50, 2)] })), 10, 3, 0),
    E(a("element_guard", "ปราการธาตุ", "all_allies", "ranged", 22, 4, "buff", S(st("mdef_up", 100, 2), st("res_up", 100, 2)), [tS("all_enemies", st("matk_down", 30, 2))]), 10, 2, 0),
    E(a("element_blade", "ดาบสถิตธาตุ", "single_enemy", "melee", 18, 3, "dmg", D("physical", { own: true }), [tS("self", st("matk_up", 100, 1))]), 10, 0, 0),
    E(p("attune", "สอดคล้องธาตุ", [{ on: "used_skill", chancePct: 30, then: [{ kind: "restore_mp", target: "self", amount: 6 }] }], [{ kind: "damage_vs_status", statusId: "wet", bonusPct: 15 }]), 1, 1, 3, [[id("torrent"), 1]]),
    E(p("fuse", "หลอมรวมธาตุ", [], [{ kind: "damage_vs_status", statusId: "burn", bonusPct: 15 }]), 1, 3, 3, [[id("wild_flame"), 1]]),
    U(a("cataclysm", "มหาพายุธาตุ", "all_enemies", "ranged", 38, 6, "mixed", D("magic", { own: true, statuses: [st("wet", 50, 2), st("shock", 30, 1)] })), 1),
  ]),
  c2("spellweaver", (a, p, id) => [
    E(a("thread", "ร้อยเวทล่วงหน้า", "self", "ranged", 16, 3, "buff", S(st("focus", 100, 2), st("matk_up", 100, 2))), 10, 2, 0),
    E(a("star_net", "ข่ายดารา", "all_enemies", "ranged", 28, 4, "mixed", D("magic", { own: true, statuses: [st("mp_cost_up", 40, 2)] }), [tS("all_allies", st("mp_regen", 100, 1))]), 10, 1, 0),
    E(a("delay_spell", "มนตร์หน่วงกาล", "single_enemy", "ranged", 20, 3, "mixed", D("magic", { own: true, statuses: [st("delay", 60, 1)] }), [tS("self", st("focus", 100, 1))]), 5, 1, 1, [[id("star_net"), 3]]),
    E(a("binding_thread", "ด้ายตรึงมนตร์", "single_enemy", "ranged", 18, 4, "debuff", S(st("skill_lock", 50, 2), st("seal", 40, 2))), 5, 3, 0),
    E(a("star_weave", "ผ้าคลุมดาว", "all_allies", "ranged", 24, 4, "buff", S(st("shield", 100, 2, { shieldPct: 10 }), st("mdef_up", 100, 2)), [tS("all_enemies", st("matk_down", 40, 2))]), 10, 2, 1, [[id("thread"), 3]]),
    E(a("needle", "เข็มเวทรัว", "single_enemy", "ranged", 16, 3, "mixed", D("physical", { hits: 3, riders: { penetrationPct: 20 }, statuses: [st("skill_lock", 25, 1)] })), 10, 0, 0),
    E(p("loom", "กี่ทอมนตร์", [
      { on: "battle_start", then: [{ kind: "status", target: "self", statuses: [st("mp_regen", 100, 3)] }] },
      { on: "used_skill", chancePct: 25, then: [{ kind: "status", target: "self", statuses: [st("focus", 100, 1)] }] },
    ]), 1, 2, 3, [[id("thread"), 1]]),
    E(p("endless_weave", "ถักทอไม่รู้จบ", [{ on: "used_skill", chancePct: 30, then: [{ kind: "restore_mp", target: "self", amount: 5 }] }]), 1, 1, 3, [[id("star_net"), 1]]),
    U(a("starfall", "ม่านดาราถล่ม", "all_enemies", "ranged", 36, 6, "mixed", D("magic", { own: true, statuses: [st("mp_cost_up", 50, 2)] }), [tS("self", st("focus", 100, 2))]), 1),
  ]),
  c2("lifekeeper", (a, p, id) => [
    E(a("rain", "ฝนชุ่มชีวา", "all_allies", "ranged", 26, 4, "heal", H({ statuses: [st("regen", 100, 1)] })), 10, 2, 0),
    E(a("stream", "ธารรักษา", "single_ally", "ranged", 18, 2, "heal", H({ flat: 20 })), 10, 2, 1),
    E(a("leaf_guard", "ใบไม้คุ้มกาย", "single_ally", "ranged", 18, 3, "buff", S(st("shield", 100, 2, { shieldPct: 12 }), st("regen", 100, 2)), [tS("self", st("mp_regen", 100, 2))]), 10, 2, 2, [[id("stream"), 3]]),
    E(a("life_light", "แสงชีวิตพิพากษา", "single_enemy", "ranged", 20, 3, "dmg", D("magic", { own: true }), [tH("lowest_ally", 0.4)]), 10, 1, 0, [["skill:warden_holy_spark", 5]]),
    E(a("thorn_lash", "แส้กิ่งหนาม", "enemy_row", "melee", 22, 4, "dmg", D("physical"), [tS("all_allies", st("regen", 100, 1))]), 10, 0, 0),
    E(a("renewal", "ฤดูผลิใบ", "all_allies", "ranged", 26, 5, "buff", S(st("cleanse", 100, 1), st("res_up", 100, 2)), [tS("all_enemies", st("anti_heal", 40, 2))]), 10, 3, 0, [[id("rain"), 3]]),
    E(p("wellspring", "ตาน้ำชีวิต", [{ on: "turn_end", then: [{ kind: "heal", target: "lowest_ally", pctMaxHp: 4 }] }], [{ kind: "heal_low_hp", belowHpPct: 50, bonusPct: 15 }]), 1, 2, 3, [[id("rain"), 1]]),
    E(p("deep_roots", "รากหยั่งลึก", [{ on: "hp_below", hpBelowPct: 40, oncePerBattle: true, then: [{ kind: "status", target: "self", statuses: [st("regen", 100, 3)] }] }]), 1, 0, 3, [[id("thorn_lash"), 1]]),
    U(a("life_bloom", "สายฝนแห่งชีวิต", "all_allies", "ranged", 38, 6, "heal", H({ statuses: [st("regen", 100, 1)] }), [tS("all_allies", st("res_up", 100, 2))]), 2),
  ]),
  c2("spiritkeeper", (a, p, id) => [
    E(a("ward", "วิญญาณคุ้มกาย", "single_ally", "ranged", 18, 4, "buff", S(st("endure", 100, 2), st("res_up", 100, 2))), 10, 2, 0),
    E(a("recall", "เรียกดวงวิญญาณกลับ", "single_ally", "ranged", 34, 5, "heal", R(45)), 5, 2, 1, [[id("ward"), 3]]),
    E(a("soul_pact", "พันธสัญญาวิญญาณ", "all_allies", "ranged", 26, 5, "buff", S(st("endure", 50, 1), st("res_up", 100, 2))), 5, 2, 2, [[id("ward"), 5]]),
    E(a("spirit_flame", "เพลิงผีลอย", "single_enemy", "ranged", 20, 3, "mixed", D("magic", { bounce: { jumps: 2, falloffPct: 30 }, own: true, statuses: [st("mana_burn", 50, 2)] }), [tH("lowest_ally", 0.3)]), 10, 1, 0, [["skill:warden_holy_spark", 5]]),
    E(a("spirit_staff", "ไม้เท้าต้อนวิญญาณ", "single_enemy", "melee", 18, 3, "mixed", D("physical", { statuses: [st("fear", 30, 1)] }), [tS("lowest_ally", st("shield", 100, 2, { shieldPct: 8 }))]), 10, 0, 0),
    E(a("spirit_veil", "ม่านวิญญาณ", "all_enemies", "ranged", 24, 4, "debuff", S(st("atk_down", 50, 2), st("matk_down", 50, 2)), [tS("all_allies", st("dmg_reduction", 100, 1))]), 10, 3, 0),
    E(p("vigil", "เฝ้ายามวิญญาณ", [{ on: "ally_down", oncePerBattle: true, then: [{ kind: "status", target: "allies", statuses: [st("endure", 100, 1)] }] }]), 1, 2, 3, [[id("ward"), 1]]),
    E(p("guiding_spirit", "ดวงวิญญาณนำทาง", [{ on: "ally_down", then: [{ kind: "restore_mp", target: "self", amount: 10 }] }]), 1, 3, 3, [[id("spirit_veil"), 1]]),
    U(a("spirit_bastion", "ผนึกวิญญาณคุ้มทีม", "all_allies", "ranged", 34, 6, "buff", S(st("endure", 100, 1), st("res_up", 100, 2), st("def_up", 100, 2)), [tS("all_enemies", st("fear", 40, 1))]), 2),
  ]),
  c2("beast_marshal", (a, p, id) => [
    E(a("charge", "แตรสั่งบุก", "single_ally", "ranged", 16, 3, "buff", S(st("advance", 100, 1), st("atk_up", 100, 2))), 5, 2, 0),
    E(a("pack", "ฝูงจู่โจมพร้อม", "all_allies", "ranged", 26, 4, "buff", S(st("atk_up", 100, 2), st("matk_up", 100, 2), st("accuracy_up", 100, 2))), 10, 2, 1, [[id("charge"), 3]]),
    E(a("maul", "ขย้ำทั้งฝูง", "single_enemy", "melee", 20, 3, "mixed", D("physical", { hits: 3, statuses: [st("vulnerable", 40, 2)] }), [tS("all_allies", st("atk_up", 100, 1))]), 10, 0, 0),
    E(a("element_roar", "คำรามธาตุ", "all_enemies", "ranged", 26, 4, "mixed", D("magic", { own: true, statuses: [st("fear", 20, 1)] })), 10, 1, 0, [["skill:binder_bond_pulse", 5]]),
    E(a("tactics", "ถอยหนึ่งรุกสอง", "all_allies", "ranged", 24, 5, "buff", S(st("spd_up", 100, 2)), [tS("all_enemies", st("delay", 30, 1))]), 5, 2, 2, [[id("pack"), 3]]),
    E(a("encircle", "ล้อมวงล่า", "all_enemies", "ranged", 22, 4, "debuff", S(st("mark", 60, 2), st("def_down", 40, 2)), [tS("all_allies", st("accuracy_up", 100, 1))]), 10, 3, 0),
    E(p("command", "เสียงจ่าฝูง", [
      { on: "battle_start", then: [{ kind: "status", target: "allies", statuses: [st("spd_up", 100, 1)] }] },
      { on: "used_skill", skillApplies: "advance", then: [{ kind: "restore_mp", target: "self", amount: 6 }] },
    ]), 1, 2, 3, [[id("charge"), 1]]),
    E(p("one_pack", "ฝูงเดียวใจเดียว", [{ on: "kill", then: [{ kind: "status", target: "allies", statuses: [st("spd_up", 100, 1)] }] }]), 1, 0, 3, [[id("maul"), 1]]),
    U(a("all_out_assault", "สั่งรุมทั้งฝูง", "all_allies", "ranged", 34, 6, "buff", S(st("advance", 100, 1)), [tS("all_enemies", st("mark", 50, 2))]), 2),
  ]),
  c2("soul_linker", (a, p, id) => [
    E(a("share", "แบ่งเบาภาระ", "all_allies", "ranged", 22, 4, "buff", S(st("shield", 100, 2, { shieldPct: 8 }), st("def_up", 100, 2))), 10, 2, 0),
    E(a("bind", "ผูกชะตาศัตรู", "all_enemies", "ranged", 24, 4, "debuff", S(st("link", 50, 2)), [tS("lowest_ally", st("shield", 100, 2, { shieldPct: 10 }))]), 10, 3, 0),
    E(a("life_drain", "ดูดชีวา", "single_enemy", "ranged", 20, 3, "dmg", D("magic", { own: true, riders: { lifestealPct: 30 } }), [tH("lowest_ally", 0.3)]), 10, 1, 0, [["skill:binder_bond_pulse", 5]]),
    E(a("soul_lash", "แส้วิญญาณ", "single_enemy", "melee", 20, 3, "mixed", D("physical", { statuses: [st("root", 50, 2), st("link", 50, 2)] })), 10, 0, 0),
    E(a("merge", "ใจหลอมรวม", "all_allies", "ranged", 26, 5, "buff", S(st("regen", 100, 2), st("res_up", 100, 2)), [tS("all_enemies", st("leech", 40, 2))]), 10, 2, 1, [[id("share"), 3]]),
    E(a("transfer", "ส่งผ่านชีวิต", "single_ally", "ranged", 18, 3, "heal", H({ restoreMp: 20 })), 10, 2, 2, [[id("share"), 5]]),
    E(p("thread", "เส้นด้ายวิญญาณ", [{ on: "took_damage", chancePct: 30, then: [{ kind: "heal", target: "lowest_ally", pctMaxHp: 3 }] }]), 1, 2, 3, [[id("share"), 1]]),
    E(p("heart_to_heart", "ใจถึงใจ", [{ on: "protected_ally", then: [{ kind: "restore_mp", target: "self", amount: 4 }] }]), 1, 3, 3, [[id("bind"), 1]]),
    U(a("soul_chain", "พันธนาการวิญญาณ", "all_enemies", "ranged", 32, 6, "debuff", S(st("link", 70, 2), st("leech", 50, 2)), [tS("all_allies", st("shield", 100, 2, { shieldPct: 6 }))]), 3),
  ]),
  c2("assassin", (a, p, id) => [
    E(a("shadow_strike", "ฟันคู่จากเงา", "single_enemy", "ranged", 20, 3, "dmg", D("physical", { hits: 2, riders: { critBonusPct: 30, accuracyBonusPct: 15 } }), [tS("self", st("evasion_up", 100, 1))]), 10, 0, 0),
    E(a("death_mark", "ตราจุดตาย", "single_enemy", "melee", 18, 3, "mixed", D("physical", { statuses: [st("vulnerable", 60, 2), st("mark", 70, 2)] }), [tS("all_allies", st("crit_up", 100, 1))]), 10, 3, 0),
    E(a("thousand_edges", "เงาพันคม", "enemy_row", "melee", 24, 4, "mixed", D("physical", { statuses: [st("bleed", 40, 2)] }), [tS("self", st("stealth", 100, 1))]), 10, 0, 1, [[id("shadow_strike"), 3]]),
    E(a("venom_blade", "กริชอาบพิษ", "single_enemy", "ranged", 20, 3, "mixed", D("magic", { own: true, statuses: [st("toxic", 50, 3)] })), 10, 1, 0, [["skill:rogue_shade_knife", 5]]),
    E(a("lurk", "ซุ่มรอสังหาร", "self", "ranged", 18, 4, "buff", S(st("stealth", 100, 1), st("crit_up", 100, 2), st("focus", 100, 2))), 5, 2, 0),
    E(a("reap", "ปลิดลมหายใจ", "single_enemy", "melee", 28, 5, "dmg", D("physical", { riders: { execute: { belowHpPct: 30, bonusPct: 120 }, bonusVsStatus: { statusId: "vulnerable", bonusPct: 30, consume: true } } })), 10, 0, 2, [[id("thousand_edges"), 3]]),
    E(p("vanish", "หายไปกับเงา", [{ on: "kill", then: [{ kind: "status", target: "self", statuses: [st("stealth", 100, 1)] }] }], [{ kind: "damage_vs_status", statusId: "vulnerable", bonusPct: 15 }]), 1, 2, 3, [[id("lurk"), 1]]),
    E(p("prey", "กลิ่นเหยื่อ", [], [{ kind: "damage_vs_status", statusId: "mark", bonusPct: 10 }]), 1, 3, 3, [[id("death_mark"), 1]]),
    U(a("shadow_execution", "ประหารเงา", "single_enemy", "melee", 34, 6, "dmg", D("physical", { riders: { critBonusPct: 30, execute: { belowHpPct: 40, bonusPct: 100 } } }), [tS("self", st("stealth", 100, 1))]), 0),
  ]),
  c2("saboteur", (a, p, id) => [
    E(a("unravel", "ถอดมนตร์", "single_enemy", "ranged", 18, 3, "mixed", D("magic", { own: true, statuses: [st("dispel", 80, 1), st("unbuffable", 50, 2)] })), 10, 3, 0),
    E(a("flashbang", "ระเบิดแสงจ้า", "all_enemies", "ranged", 24, 4, "mixed", D("physical", { statuses: [st("blind", 35, 2)] }), [tS("self", st("evasion_up", 100, 1))]), 10, 0, 0),
    E(a("polarity", "กลับขั้ว", "single_enemy", "ranged", 22, 4, "mixed", D("magic", { own: true, statuses: [st("invert", 60, 1)] }), [tS("self", st("evasion_up", 100, 2))]), 5, 3, 1, [[id("unravel"), 3]]),
    E(a("chaos_burst", "ระเบิดมนตร์ป่วน", "enemy_row", "ranged", 22, 4, "mixed", D("magic", { own: true, statuses: [st("mp_cost_up", 50, 2)] })), 10, 1, 0, [["skill:rogue_shade_knife", 5]]),
    E(a("siphon", "ปล้นพลัง", "single_enemy", "ranged", 20, 4, "debuff", S(st("steal_buff", 70, 1)), [tS("all_allies", st("accuracy_up", 100, 2))]), 10, 3, 2, [[id("unravel"), 5]]),
    E(a("time_mine", "ทุ่นระเบิดเวลา", "all_enemies", "ranged", 26, 5, "mixed", D("physical", { statuses: [st("delay", 40, 1), st("seal", 30, 2)] })), 5, 0, 1, [[id("flashbang"), 3]]),
    E(p("meddle", "มือบอน", [{ on: "dealt_damage", action: "skill", chancePct: 25, then: [{ kind: "status", target: "other", statuses: [st("dispel", 50, 1)] }] }]), 1, 3, 3, [[id("unravel"), 1]]),
    E(p("slip_away", "ป่วนแล้วเผ่น", [{ on: "debuffed", then: [{ kind: "status", target: "self", statuses: [st("evasion_up", 100, 1)] }] }]), 1, 0, 3, [[id("flashbang"), 1]]),
    U(a("total_disruption", "ล่มระบบ", "all_enemies", "ranged", 32, 6, "debuff", S(st("dispel", 70, 1), st("unbuffable", 60, 2), st("seal", 50, 2)), [tS("all_allies", st("accuracy_up", 100, 2), st("crit_up", 100, 2))]), 3),
  ]),
  c2("apothecary", (a, p, id) => [
    E(a("purge", "ยาชำระพิษ", "all_allies", "ranged", 26, 4, "heal", H({ statuses: [st("cleanse", 100, 1)] })), 10, 2, 0),
    E(a("tonic", "ยาฟื้นกำลัง", "single_ally", "ranged", 18, 3, "heal", H({ flat: 15, restoreMp: 15 })), 10, 2, 1),
    E(a("rally_draught", "ยาปลุกใจ", "all_allies", "ranged", 24, 4, "buff", S(st("atk_up", 100, 1), st("matk_up", 100, 1)), [tH("lowest_ally", 0.25)]), 10, 2, 2, [[id("tonic"), 3]]),
    E(a("venom_vial", "ขวดพิษเข้มข้น", "single_enemy", "ranged", 20, 3, "mixed", D("magic", { own: true, statuses: [st("toxic", 60, 3), st("anti_heal", 50, 2)] }), [tH("lowest_ally", 0.2)]), 10, 1, 0, [["skill:alchemist_element_flask", 5]]),
    E(a("sleep_bomb", "ระเบิดยาสลบ", "enemy_row", "ranged", 22, 4, "mixed", D("physical", { statuses: [st("sleep", 30, 1)] }), [tS("all_allies", st("res_up", 100, 2))]), 5, 0, 0),
    E(a("antidote", "ยาภูมิคุ้มกัน", "single_ally", "ranged", 20, 4, "buff", S(st("immunity", 100, 2), st("regen", 100, 2))), 5, 3, 0, [[id("purge"), 3]]),
    E(p("dose", "ผสมเพิ่มฤทธิ์", [{ on: "used_item", then: [{ kind: "heal", target: "other", pctMaxHp: 5 }] }]), 1, 2, 3, [[id("tonic"), 1]]),
    E(p("pharmacist", "ตำรับเภสัช", [], [{ kind: "heal_low_hp", belowHpPct: 40, bonusPct: 15 }]), 1, 3, 3, [[id("purge"), 1]]),
    U(a("panacea", "โอสถมหาชีวิต", "all_allies", "ranged", 38, 6, "heal", H({ statuses: [st("cleanse", 100, 1)] }), [tS("all_allies", st("res_up", 100, 2))]), 2),
  ]),
  c2("transmuter", (a, p, id) => [
    E(a("oil", "ราดน้ำมันลื่น", "enemy_row", "ranged", 18, 3, "debuff", S(st("oil", 80, 3), st("spd_down", 40, 2))), 10, 3, 0),
    E(a("ignite", "จุดชนวนแปรธาตุ", "enemy_row", "ranged", 26, 4, "mixed", D("magic", { element: "FIRE", riders: { bonusVsStatus: { statusId: "oil", bonusPct: 40, consume: true } }, statuses: [st("burn", 50, 2)] })), 10, 1, 0, [["skill:alchemist_element_flask", 5]]),
    E(a("reform_armor", "แปรสภาพเกราะ", "all_allies", "ranged", 24, 4, "buff", S(st("def_up", 100, 2), st("mdef_up", 100, 2)), [tS("all_enemies", st("def_down", 30, 2))]), 10, 2, 0),
    E(a("metal_acid", "กรดสลายโลหะ", "single_enemy", "ranged", 20, 3, "mixed", D("physical", { riders: { penetrationPct: 40 }, statuses: [st("corrode", 60, 3)] }), [tS("self", st("def_up", 100, 2))]), 10, 0, 0),
    E(a("chain", "ปฏิกิริยาลูกโซ่", "all_enemies", "ranged", 28, 4, "mixed", D("magic", { own: true, statuses: [st("wet", 40, 2)] })), 10, 1, 1, [[id("ignite"), 3]]),
    E(a("stone", "ศิลาสาป", "single_enemy", "ranged", 24, 5, "debuff", S(st("petrify", 30, 1)), [tS("self", st("shield", 100, 2, { shieldPct: 10 }))]), 5, 3, 1, [[id("oil"), 3]]),
    E(p("catalyst", "ผงเร่งปฏิกิริยา", [{ on: "dealt_damage", action: "skill", chancePct: 25, then: [{ kind: "status", target: "other", statuses: [st("corrode", 50, 2)] }] }], [{ kind: "damage_vs_status", statusId: "oil", bonusPct: 20 }]), 1, 3, 3, [[id("oil"), 1]]),
    E(p("reshaper", "มือแปรสภาพ", [{ on: "used_item", then: [{ kind: "status", target: "self", statuses: [st("matk_up", 100, 1)] }] }]), 1, 2, 3, [[id("reform_armor"), 1]]),
    U(a("grand_reaction", "ปฏิกิริยามหาวิบัติ", "all_enemies", "ranged", 38, 6, "mixed", D("magic", { element: "FIRE", riders: { bonusVsStatus: { statusId: "oil", bonusPct: 50, consume: true } }, statuses: [st("burn", 50, 2)] })), 1),
  ]),
  c2("minstrel", (a, p, id) => [
    E(a("anthem", "ลำนำนำทัพ", "all_allies", "ranged", 28, 5, "buff", S(st("atk_up", 100, 3), st("matk_up", 100, 3), st("spd_up", 100, 3))), 10, 2, 0),
    E(a("refrain", "ท่อนซ้ำฟื้นใจ", "all_allies", "ranged", 24, 4, "heal", H({ statuses: [st("mp_regen", 100, 3)] })), 10, 2, 1, [[id("anthem"), 3]]),
    E(a("sword_dance", "ระบำกระบี่", "enemy_row", "melee", 22, 4, "dmg", D("physical"), [tS("all_allies", st("evasion_up", 100, 1))]), 10, 0, 0),
    E(a("element_tune", "ทำนองธาตุ", "all_enemies", "ranged", 26, 4, "dmg", D("magic", { own: true }), [tS("all_allies", st("matk_up", 100, 1))]), 10, 1, 0, [["skill:bard_shrill_note", 5]]),
    E(a("stirring", "บทเพลงเร่งเร้า", "single_ally", "ranged", 16, 3, "buff", S(st("advance", 100, 1), st("spd_up", 100, 2))), 5, 2, 2, [[id("anthem"), 5]]),
    E(a("banishing_song", "เพลงขับไล่", "all_enemies", "ranged", 24, 4, "debuff", S(st("dispel", 40, 1), st("atk_down", 40, 2)), [tS("all_allies", st("res_up", 100, 1))]), 10, 3, 0),
    E(p("tempo", "จังหวะนำ", [
      { on: "battle_start", then: [{ kind: "status", target: "allies", statuses: [st("spd_up", 100, 1)] }] },
      { on: "used_skill", chancePct: 25, then: [{ kind: "restore_mp", target: "self", amount: 5 }] },
    ]), 1, 2, 3, [[id("anthem"), 1]]),
    E(p("harmony", "เสียงประสาน", [{ on: "used_skill", chancePct: 25, then: [{ kind: "status", target: "allies", statuses: [st("accuracy_up", 100, 1)] }] }]), 1, 1, 3, [[id("element_tune"), 1]]),
    U(a("grand_concert", "มหาบรรเลง", "all_allies", "ranged", 36, 6, "buff", S(st("atk_up", 100, 2), st("matk_up", 100, 2))), 2),
  ]),
  c2("dirgesinger", (a, p, id) => [
    E(a("weight", "บทโศกถ่วงใจ", "all_enemies", "ranged", 26, 4, "debuff", S(st("atk_down", 60, 2), st("matk_down", 60, 2), st("fear", 25, 1))), 10, 3, 0),
    E(a("last_verse", "ท่อนสุดท้าย", "single_enemy", "ranged", 24, 3, "dmg", D("magic", { bounce: { jumps: 2, falloffPct: 25 }, element: "SHADOW", riders: { execute: { belowHpPct: 40, bonusPct: 50 } } }), [tS("self", st("mp_regen", 100, 2))]), 10, 1, 0, [["skill:bard_shrill_note", 5]]),
    E(a("lament_song", "เพลงคร่ำครวญ", "all_enemies", "ranged", 28, 4, "mixed", D("magic", { own: true, statuses: [st("res_down", 40, 2)] })), 10, 1, 1, [[id("last_verse"), 3]]),
    E(a("sorrow_blade", "ดาบบทโศก", "single_enemy", "melee", 20, 3, "mixed", D("physical", { statuses: [st("fear", 30, 1)] }), [tS("all_enemies", st("spd_down", 30, 1))]), 10, 0, 0),
    E(a("death_song", "เพลงสาปมรณะ", "single_enemy", "ranged", 26, 6, "debuff", S(st("doom", 25, 3), st("mark", 60, 2))), 5, 3, 1, [[id("weight"), 5]]),
    E(a("eclipse", "บทเพลงจันทร์ดับ", "all_allies", "ranged", 24, 5, "buff", S(st("matk_up", 100, 2), st("res_up", 100, 2)), [tS("all_enemies", st("blind", 30, 2))]), 10, 2, 0),
    E(p("lament", "บทคร่ำครวญ", [{ on: "dealt_damage", action: "skill", chancePct: 30, then: [{ kind: "status", target: "other", statuses: [st("res_down", 40, 2)] }] }], [{ kind: "damage_vs_status", statusId: "fear", bonusPct: 15 }]), 1, 3, 3, [[id("weight"), 1]]),
    E(p("from_darkness", "เสียงจากความมืด", [{ on: "debuffed", then: [{ kind: "status", target: "self", statuses: [st("matk_up", 100, 1)] }] }]), 1, 2, 3, [[id("eclipse"), 1]]),
    U(a("requiem", "บทเพลงวันสิ้นโลก", "all_enemies", "ranged", 34, 6, "debuff", S(st("doom", 20, 3), st("fear", 40, 1), st("res_down", 60, 2)), [tS("all_allies", st("matk_up", 100, 2))]), 3),
  ]),
];

// ====================================================================== Class3 (tier 3)

/**
 * A Class3 tree (chapter 02: Class3 continues the Class2 branch, trial at Lv120). Six actives, two
 * passives and the Class3 signature move (a capstone, chapter 02's ท่าไม้ตาย). Later skills reach
 * both sides in one move more often than Class2 (EXAMPLE, Claude's first pass, STATUS A146).
 */
function c3(advance: string, entries: (a: ReturnType<typeof maker>, p: ReturnType<typeof P>, id: (k: string) => string) => Entry[]) {
  const prefix = `c3_${advance}`;
  return build(`class3:${advance}`, 3, entries(maker(prefix, 3), P(prefix, 3), (k) => `skill:${prefix}_${k}`));
}

const CLASS3 = [
  c3("aegis_sovereign", (a, p, id) => [
    E(a("aegis_dome", "โดมโล่ราชันย์", "all_allies", "ranged", 34, 4, "buff", S(st("shield", 100, 2, { shieldPct: 10 })), [tS("self", st("def_up", 100, 2))]), 10, 2, 0),
    E(a("sovereign_bash", "กระแทกราชันย์", "enemy_row", "melee", 30, 3, "mixed", D("physical", { statuses: [st("stun", 25, 1)] }), [tS("self", st("shield", 100, 1, { shieldPct: 8 }))]), 10, 0, 0),
    E(a("radiant_bulwark", "ปราการรัศมี", "all_enemies", "ranged", 36, 4, "dmg", D("magic", { own: true }), [tS("all_allies", st("def_up", 100, 1))]), 10, 1, 0),
    E(a("kings_decree", "ราชโองการ", "all_enemies", "ranged", 32, 4, "debuff", S(st("taunt", 70, 2), st("atk_down", 70, 2)), [tS("all_allies", st("dmg_reduction", 100, 1))]), 10, 3, 0),
    E(a("guardian_oath", "คำสัตย์ผู้คุ้ม", "single_ally", "ranged", 28, 4, "buff", S(st("protect", 100, 2), st("endure", 100, 1), st("def_up", 100, 2)), [tS("self", st("shield", 100, 2, { shieldPct: 12 }))]), 5, 2, 1, [[id("aegis_dome"), 3]]),
    E(a("shield_cyclone", "พายุโล่", "all_enemies", "melee", 36, 4, "dmg", D("physical"), [tS("self", st("counter", 100, 1))]), 10, 0, 1, [[id("sovereign_bash"), 3]]),
    E(p("sovereign_aura", "ออร่าราชันย์", [{ on: "battle_start", then: [{ kind: "status", target: "allies", statuses: [st("shield", 100, 1, { shieldPct: 5 })] }] }], [{ kind: "guard_reduction", reductionPct: 10 }]), 1, 2, 3, [[id("aegis_dome"), 1]]),
    E(p("unbroken", "ไม่มีวันแตก", [{ on: "hp_below", hpBelowPct: 30, oncePerBattle: true, then: [{ kind: "status", target: "self", statuses: [st("endure", 100, 1), st("dmg_reduction", 100, 2)] }] }]), 1, 3, 3, [[id("kings_decree"), 1]]),
    U(a("eternal_aegis", "โล่นิรันดร์แห่งราชันย์", "all_allies", "ranged", 44, 6, "buff", S(st("shield", 100, 2, { shieldPct: 10 }), st("dmg_reduction", 100, 1)), [tS("all_enemies", st("taunt", 60, 1))]), 2),
  ]),
  c3("dread_bulwark", (a, p, id) => [
    E(a("dread_stance", "ท่าปราการพิฆาต", "self", "ranged", 26, 4, "buff", S(st("counter", 100, 3), st("def_up", 100, 3), st("dmg_reduction", 100, 2)), [tS("all_allies", st("def_up", 100, 1))]), 10, 2, 0),
    E(a("retribution", "ลงทัณฑ์สวนกลับ", "single_enemy", "melee", 28, 3, "mixed", D("physical", { riders: { penetrationPct: 25 }, statuses: [st("atk_down", 50, 2)] }), [tS("self", st("counter", 100, 1))]), 10, 0, 0),
    E(a("iron_tempest", "พายุเหล็กโต้กลับ", "enemy_row", "melee", 32, 4, "dmg", D("physical"), [tS("all_enemies", st("taunt", 40, 1))]), 10, 0, 1, [[id("retribution"), 3]]),
    E(a("warding_rune", "อักขระพิทักษ์โต้", "single_enemy", "ranged", 28, 3, "dmg", D("magic", { own: true }), [tS("self", st("shield", 100, 2, { shieldPct: 10 })), tS("all_allies", st("mdef_up", 100, 1))]), 10, 1, 0),
    E(a("dread_glare", "สายตาสยอง", "all_enemies", "ranged", 30, 4, "debuff", S(st("fear", 45, 1), st("atk_down", 60, 2)), [tS("self", st("counter", 100, 2)), tS("all_allies", st("def_up", 100, 1))]), 10, 3, 0),
    E(a("rally_guard", "ตั้งแนวรับทั้งทีม", "all_allies", "ranged", 32, 5, "buff", S(st("def_up", 100, 2), st("mdef_up", 100, 2)), [tS("self", st("counter", 100, 2))]), 10, 2, 1, [[id("dread_stance"), 3]]),
    E(p("vengeance", "แค้นสนอง", [{ on: "took_damage", chancePct: 30, then: [{ kind: "status", target: "self", statuses: [st("atk_up", 100, 1)] }] }], [{ kind: "damage_vs_status", statusId: "atk_down", bonusPct: 15 }]), 1, 0, 3, [[id("retribution"), 1]]),
    E(p("immovable", "ขุนเขาไม่ไหว", [{ on: "hp_below", hpBelowPct: 40, oncePerBattle: true, then: [{ kind: "status", target: "self", statuses: [st("endure", 100, 1), st("counter", 100, 2)] }] }]), 1, 2, 3, [[id("dread_stance"), 1]]),
    U(a("thousand_retaliations", "พันทัณฑ์สวนกลับ", "all_enemies", "melee", 42, 6, "dmg", D("physical", { riders: { penetrationPct: 30 } }), [tS("self", st("counter", 100, 3), st("dmg_reduction", 100, 2))]), 0),
  ]),
  c3("ruin_champion", (a, p, id) => [
    E(a("ruin_strike", "ฟาดล่มสลาย", "single_enemy", "melee", 28, 3, "mixed", D("physical", { riders: { penetrationPct: 50 }, statuses: [st("def_down", 70, 2)] }), [tS("all_allies", st("atk_up", 100, 1))]), 10, 0, 0),
    E(a("fault_line", "รอยแยกแผ่นดิน", "enemy_row", "melee", 32, 4, "mixed", D("physical", { riders: { penetrationPct: 30 }, statuses: [st("vulnerable", 40, 2)] })), 10, 0, 1, [[id("ruin_strike"), 3]]),
    E(a("breaking_point", "จุดแตกหัก", "single_enemy", "melee", 34, 5, "dmg", D("physical", { riders: { bonusVsStatus: { statusId: "def_down", bonusPct: 80, consume: true }, execute: { belowHpPct: 30, bonusPct: 60 } } })), 10, 0, 2, [[id("fault_line"), 3]]),
    E(a("armor_hex", "อาคมสลายเกราะ", "all_enemies", "ranged", 34, 4, "mixed", D("magic", { own: true, statuses: [st("mdef_down", 40, 2)] }), [tS("all_allies", st("matk_up", 100, 1))]), 10, 1, 0),
    E(a("war_banner", "ธงศึกทลาย", "all_allies", "ranged", 32, 4, "buff", S(st("atk_up", 100, 2), st("accuracy_up", 100, 2)), [tS("all_enemies", st("def_down", 30, 1))]), 10, 2, 0),
    E(a("sunder_cry", "เสียงตะโกนแหลกลาญ", "all_enemies", "ranged", 30, 4, "debuff", S(st("def_down", 60, 2), st("mdef_down", 60, 2)), [tS("self", st("crit_up", 100, 2))]), 10, 3, 0),
    E(p("shatter_master", "ช่างทำลาย", [{ on: "dealt_damage", action: "skill", chancePct: 20, then: [{ kind: "status", target: "other", statuses: [st("def_down", 60, 2)] }] }], [{ kind: "damage_vs_status", statusId: "vulnerable", bonusPct: 15 }]), 1, 3, 3, [[id("sunder_cry"), 1]]),
    E(p("unyielding_march", "เดินหน้าไม่ถอย", [{ on: "kill", then: [{ kind: "restore_mp", target: "self", amount: 10 }] }]), 1, 1, 3, [[id("ruin_strike"), 1]]),
    U(a("world_breaker", "ทลายโลก", "all_enemies", "melee", 44, 6, "dmg", D("physical", { riders: { penetrationPct: 50 } }), [tS("all_allies", st("atk_up", 100, 1))]), 0),
  ]),
  c3("bloodstorm", (a, p, id) => [
    E(a("crimson_rend", "ฉีกโลหิต", "single_enemy", "melee", 26, 3, "mixed", D("physical", { hits: 3, riders: { recoilPct: 10, lifestealPct: 20 }, statuses: [st("bleed", 60, 3)] })), 10, 0, 0),
    E(a("blood_tornado", "ทอร์นาโดโลหิต", "all_enemies", "melee", 34, 4, "dmg", D("physical", { riders: { recoilPct: 12, lifestealPct: 15 } })), 10, 0, 1, [[id("crimson_rend"), 3]]),
    E(a("hemomancy", "เวทโลหิต", "single_enemy", "ranged", 28, 3, "dmg", D("magic", { own: true, riders: { lifestealPct: 25 } }), [tS("self", st("atk_up", 100, 1))]), 10, 1, 0),
    E(a("frenzy_pact", "พันธะคลั่ง", "self", "ranged", 28, 5, "buff", S(st("rage", 100, 3, { stacks: 3 }), st("crit_up", 100, 3)), [tS("all_allies", st("atk_up", 100, 2))]), 10, 2, 0),
    E(a("second_wind", "ลมหายใจที่สอง", "self", "ranged", 30, 5, "heal", H({ statuses: [st("endure", 100, 1)] })), 5, 2, 1, [[id("frenzy_pact"), 3]]),
    E(a("terror_howl", "เสียงคำรามสยอง", "all_enemies", "ranged", 30, 4, "debuff", S(st("fear", 45, 1), st("def_down", 60, 2)), [tS("self", st("atk_up", 100, 2))]), 10, 3, 0),
    E(p("blood_price", "ราคาของเลือด", [
      { on: "hp_below", hpBelowPct: 50, oncePerBattle: true, then: [{ kind: "status", target: "self", statuses: [st("rage", 100, 2, { stacks: 3 })] }] },
      { on: "kill", then: [{ kind: "heal", target: "self", pctMaxHp: 6 }] },
    ]), 1, 2, 3, [[id("frenzy_pact"), 1]]),
    E(p("pain_feeds", "ความเจ็บคือพลัง", [{ on: "took_damage", chancePct: 25, then: [{ kind: "status", target: "self", statuses: [st("atk_up", 100, 1)] }] }]), 1, 0, 3, [[id("crimson_rend"), 1]]),
    U(a("crimson_apocalypse", "มหาวิบัติสีเลือด", "all_enemies", "melee", 44, 6, "dmg", D("physical", { riders: { recoilPct: 20, lifestealPct: 30, execute: { belowHpPct: 35, bonusPct: 60 } } }), [tS("self", st("endure", 100, 1))]), 0),
  ]),
  c3("starpiercer", (a, p, id) => [
    E(a("star_arrow", "ศรดาวตก", "single_enemy", "ranged", 28, 3, "dmg", D("physical", { bounce: { jumps: 2, falloffPct: 25 }, riders: { penetrationPct: 40, accuracyBonusPct: 20, bonusVsStatus: { statusId: "mark", bonusPct: 40, consume: true } } })), 10, 0, 0),
    E(a("constellation", "ศรกลุ่มดาว", "all_enemies", "ranged", 34, 4, "dmg", D("physical", { riders: { critBonusPct: 15 } }), [tS("all_enemies", st("mark", 40, 2))]), 10, 0, 1, [[id("star_arrow"), 3]]),
    E(a("astral_bolt", "ศรดาราธาตุ", "single_enemy", "ranged", 28, 3, "mixed", D("magic", { own: true, statuses: [st("mdef_down", 50, 2)] }), [tS("self", st("focus", 100, 1))]), 10, 1, 0),
    E(a("eagle_trance", "สมาธิอินทรี", "self", "ranged", 26, 4, "buff", S(st("focus", 100, 2), st("crit_up", 100, 3), st("accuracy_up", 100, 3)), [tS("all_allies", st("accuracy_up", 100, 2), st("crit_up", 100, 1))]), 10, 2, 0),
    E(a("spotter", "ผู้ชี้เป้า", "all_allies", "ranged", 30, 5, "buff", S(st("crit_up", 100, 3), st("accuracy_up", 100, 2)), [tS("all_enemies", st("evasion_down", 60, 2))]), 10, 2, 1, [[id("eagle_trance"), 3]]),
    E(a("starlock", "ตรึงดาว", "single_enemy", "ranged", 26, 4, "debuff", S(st("root", 60, 2), st("evasion_down", 70, 2), st("mark", 80, 2)), [tS("all_allies", st("accuracy_up", 100, 2))]), 5, 3, 0),
    E(p("deadeye", "ตาพิฆาต", [], [{ kind: "damage_vs_status", statusId: "mark", bonusPct: 20 }]), 1, 0, 3, [[id("star_arrow"), 1]]),
    E(p("steady_breath", "ลมหายใจนิ่ง", [{ on: "turn_start", chancePct: 25, then: [{ kind: "status", target: "self", statuses: [st("focus", 100, 1)] }] }]), 1, 2, 3, [[id("eagle_trance"), 1]]),
    U(a("heavenpiercer", "ศรทะลวงสวรรค์", "single_enemy", "ranged", 42, 6, "dmg", D("physical", { riders: { penetrationPct: 60, critBonusPct: 40, execute: { belowHpPct: 40, bonusPct: 100 } } })), 0),
  ]),
  c3("wild_architect", (a, p, id) => [
    E(a("killing_field", "สนามสังหาร", "all_enemies", "ranged", 30, 4, "debuff", S(st("root", 55, 2), st("bleed", 60, 3)), [tS("all_allies", st("spd_up", 100, 2), st("atk_up", 100, 1))]), 10, 3, 0),
    E(a("hunters_snare", "บ่วงนายพราน", "single_enemy", "ranged", 26, 4, "debuff", S(st("root", 70, 2), st("delay", 50, 1), st("vulnerable", 60, 2)), [tS("all_allies", st("crit_up", 100, 2))]), 5, 3, 1, [[id("killing_field"), 3]]),
    E(a("spring_spikes", "หนามดีดสนาม", "enemy_row", "ranged", 28, 3, "mixed", D("physical", { statuses: [st("bleed", 50, 2), st("knockback", 30, 1)] })), 10, 0, 0),
    E(a("landslide_trap", "กับดักดินถล่ม", "all_enemies", "ranged", 34, 4, "mixed", D("physical", { statuses: [st("spd_down", 40, 2)] })), 10, 0, 1, [[id("spring_spikes"), 3]]),
    E(a("element_snare", "บ่วงธาตุ", "all_enemies", "ranged", 34, 4, "mixed", D("magic", { own: true, statuses: [st("wet", 40, 2)] }), [tS("all_allies", st("evasion_up", 100, 1))]), 10, 1, 0),
    E(a("camouflage_net", "ตาข่ายพราง", "all_allies", "ranged", 32, 5, "buff", S(st("evasion_up", 100, 2), st("spd_up", 100, 1)), [tS("all_enemies", st("blind", 30, 1))]), 10, 2, 0),
    E(p("trap_sense", "สัญชาตญาณกับดัก", [{ on: "battle_start", then: [{ kind: "status", target: "allies", statuses: [st("evasion_up", 100, 1)] }] }]), 1, 2, 3, [[id("camouflage_net"), 1]]),
    E(p("ambush", "ซุ่มโจมตี", [], [{ kind: "damage_vs_status", statusId: "root", bonusPct: 20 }]), 1, 0, 3, [[id("spring_spikes"), 1]]),
    U(a("grand_hunt", "มหาสนามล่า", "all_enemies", "ranged", 40, 6, "debuff", S(st("root", 70, 2), st("vulnerable", 60, 2)), [tS("all_allies", st("atk_up", 100, 2))]), 3),
  ]),
  c3("prismatic_archmage", (a, p, id) => [
    E(a("prism_lance", "หอกปริซึม", "single_enemy", "ranged", 24, 2, "mixed", D("magic", { bounce: { jumps: 3, falloffPct: 20 }, own: true, statuses: [st("mdef_down", 40, 2)] })), 10, 1, 0),
    E(a("elemental_cascade", "ธาตุถล่มทลาย", "all_enemies", "ranged", 36, 4, "mixed", D("magic", { own: true, riders: { bonusVsStatus: { statusId: "wet", bonusPct: 30, consume: false } }, statuses: [st("shock", 30, 1)] })), 10, 1, 1, [[id("prism_lance"), 3]]),
    E(a("inferno", "นรกเพลิง", "enemy_row", "ranged", 34, 4, "mixed", D("magic", { element: "FIRE", riders: { bonusVsStatus: { statusId: "oil", bonusPct: 40, consume: false } }, statuses: [st("burn", 60, 2)] })), 10, 1, 2, [[id("prism_lance"), 5]]),
    E(a("prism_blade", "ดาบปริซึม", "single_enemy", "melee", 26, 3, "dmg", D("physical", { own: true }), [tS("self", st("matk_up", 100, 1))]), 10, 0, 0),
    E(a("elemental_aegis", "เกราะธาตุปริซึม", "all_allies", "ranged", 32, 4, "buff", S(st("mdef_up", 100, 3), st("res_up", 100, 2)), [tS("all_enemies", st("matk_down", 40, 2))]), 10, 2, 0),
    E(a("drench", "ห่าฝนเปียก", "all_enemies", "ranged", 26, 3, "debuff", S(st("wet", 80, 2), st("spd_down", 50, 2)), [tS("all_allies", st("matk_up", 100, 1))]), 10, 3, 0),
    E(p("prismatic_flow", "กระแสปริซึม", [{ on: "used_skill", chancePct: 30, then: [{ kind: "restore_mp", target: "self", amount: 6 }] }]), 1, 2, 3, [[id("elemental_aegis"), 1]]),
    E(p("elemental_mastery", "เชี่ยวชาญธาตุ", [], [{ kind: "damage_vs_status", statusId: "burn", bonusPct: 10 }, { kind: "damage_vs_status", statusId: "wet", bonusPct: 10 }, { kind: "damage_vs_status", statusId: "shock", bonusPct: 10 }]), 1, 3, 3, [[id("drench"), 1]]),
    U(a("prismatic_cataclysm", "มหาวิบัติปริซึม", "all_enemies", "ranged", 46, 6, "mixed", D("magic", { own: true, statuses: [st("mdef_down", 40, 2)] }), [tS("all_allies", st("matk_up", 100, 1))]), 1),
  ]),
  c3("astral_weaver", (a, p, id) => [
    E(a("astral_thread", "ด้ายดารา", "single_enemy", "ranged", 26, 3, "mixed", D("magic", { own: true, statuses: [st("delay", 40, 1)] }), [tS("self", st("focus", 100, 1))]), 10, 1, 0),
    E(a("galaxy_web", "ใยดาราจักร", "all_enemies", "ranged", 34, 4, "mixed", D("magic", { own: true, statuses: [st("mp_cost_up", 40, 2)] }), [tS("all_allies", st("mp_regen", 100, 1))]), 10, 1, 1, [[id("astral_thread"), 3]]),
    E(a("star_needle", "เข็มดารา", "single_enemy", "ranged", 26, 3, "mixed", D("physical", { hits: 4, riders: { penetrationPct: 30 }, statuses: [st("skill_lock", 30, 1)] })), 10, 0, 0),
    E(a("time_weave", "ถักกาลเวลา", "single_ally", "ranged", 26, 4, "buff", S(st("advance", 100, 1), st("matk_up", 100, 2), st("focus", 100, 2)), [tS("self", st("mp_regen", 100, 2))]), 5, 2, 0),
    E(a("star_mantle", "ผ้าคลุมดารา", "all_allies", "ranged", 34, 5, "buff", S(st("shield", 100, 2, { shieldPct: 10 }), st("mdef_up", 100, 2)), [tS("all_enemies", st("matk_down", 30, 1))]), 10, 2, 1, [[id("time_weave"), 3]]),
    E(a("fate_knot", "ปมชะตา", "single_enemy", "ranged", 28, 4, "debuff", S(st("seal", 60, 2), st("skill_lock", 50, 2), st("delay", 40, 1)), [tS("all_allies", st("focus", 100, 1))]), 5, 3, 0),
    E(p("woven_fate", "ชะตาที่ถักไว้", [
      { on: "battle_start", then: [{ kind: "status", target: "self", statuses: [st("mp_regen", 100, 3)] }] },
      { on: "used_skill", chancePct: 25, then: [{ kind: "status", target: "self", statuses: [st("focus", 100, 1)] }] },
    ]), 1, 1, 3, [[id("astral_thread"), 1]]),
    E(p("starlight", "แสงดารานำทาง", [{ on: "battle_start", then: [{ kind: "status", target: "allies", statuses: [st("accuracy_up", 100, 2)] }] }]), 1, 2, 3, [[id("time_weave"), 1]]),
    U(a("celestial_tapestry", "ผืนผ้าดาราจักร", "all_enemies", "ranged", 44, 6, "mixed", D("magic", { own: true, statuses: [st("delay", 30, 1)] }), [tS("all_allies", st("matk_up", 100, 1))]), 1),
  ]),
  c3("verdant_hierophant", (a, p, id) => [
    E(a("verdant_rain", "ฝนพฤกษา", "all_allies", "ranged", 36, 4, "heal", H({ statuses: [st("regen", 100, 1)] })), 10, 2, 0),
    E(a("lifebloom", "ดอกไม้ชีวิต", "single_ally", "ranged", 26, 2, "heal", H({ flat: 30, statuses: [st("shield", 100, 2, { shieldPct: 10 })] })), 10, 2, 1),
    E(a("world_tree", "ร่มพฤกษาโลก", "all_allies", "ranged", 36, 5, "buff", S(st("regen", 100, 2)), [tS("all_enemies", st("anti_heal", 40, 2))]), 10, 2, 2, [[id("verdant_rain"), 3]]),
    E(a("sunbeam", "แสงตะวันพฤกษา", "single_enemy", "ranged", 28, 3, "dmg", D("magic", { own: true }), [tH("lowest_ally", 0.4)]), 10, 1, 0),
    E(a("thornwhip", "แส้หนามพฤกษา", "enemy_row", "melee", 30, 4, "mixed", D("physical", { statuses: [st("bleed", 30, 2)] }), [tS("all_allies", st("regen", 100, 1))]), 10, 0, 0),
    E(a("strangling_vines", "เถาวัลย์รัด", "all_enemies", "ranged", 30, 4, "debuff", S(st("root", 50, 2), st("anti_heal", 60, 2)), [tS("all_allies", st("regen", 100, 1))]), 10, 3, 0),
    E(p("overgrowth", "เติบโตล้น", [], [{ kind: "heal_low_hp", belowHpPct: 40, bonusPct: 30 }]), 1, 1, 3, [[id("sunbeam"), 1]]),
    E(p("evergreen", "เขียวชอุ่ม", [{ on: "ally_down", oncePerBattle: true, then: [{ kind: "status", target: "allies", statuses: [st("regen", 100, 2), st("res_up", 100, 2)] }] }]), 1, 3, 3, [[id("strangling_vines"), 1]]),
    U(a("genesis", "ปฐมชีวิต", "all_allies", "ranged", 48, 6, "heal", H({ statuses: [st("regen", 100, 1)] }), [tS("all_allies", st("shield", 100, 2, { shieldPct: 8 }))]), 2),
  ]),
  c3("soulwarden", (a, p, id) => [
    E(a("soul_shelter", "ที่พักวิญญาณ", "all_allies", "ranged", 34, 5, "buff", S(st("endure", 60, 1), st("res_up", 100, 2), st("def_up", 100, 2))), 5, 2, 0),
    E(a("soul_return", "คืนดวงวิญญาณ", "single_ally", "ranged", 40, 5, "heal", R(60)), 5, 2, 1, [[id("soul_shelter"), 3]]),
    E(a("guardian_spirits", "วิญญาณผู้คุ้ม", "all_allies", "ranged", 34, 5, "buff", S(st("dmg_reduction", 100, 2)), [tS("all_enemies", st("atk_down", 30, 1))]), 10, 2, 2, [[id("soul_shelter"), 3]]),
    E(a("spirit_lance", "หอกวิญญาณ", "single_enemy", "ranged", 28, 3, "mixed", D("magic", { bounce: { jumps: 2, falloffPct: 30 }, own: true, statuses: [st("mana_burn", 50, 2)] }), [tH("lowest_ally", 0.3)]), 10, 1, 0),
    E(a("reaper_staff", "ไม้เท้าเก็บวิญญาณ", "single_enemy", "melee", 26, 3, "mixed", D("physical", { statuses: [st("fear", 30, 1)] }), [tS("lowest_ally", st("shield", 100, 2, { shieldPct: 10 }))]), 10, 0, 0),
    E(a("spirit_chains", "โซ่วิญญาณ", "all_enemies", "ranged", 32, 4, "debuff", S(st("atk_down", 60, 2), st("matk_down", 60, 2), st("fear", 25, 1)), [tS("all_allies", st("dmg_reduction", 100, 1))]), 10, 3, 0),
    E(p("soul_bond", "สายใยวิญญาณ", [{ on: "ally_down", oncePerBattle: true, then: [{ kind: "status", target: "allies", statuses: [st("endure", 100, 1), st("res_up", 100, 2)] }] }]), 1, 3, 3, [[id("spirit_chains"), 1]]),
    E(p("spirit_sight", "ตาวิญญาณ", [{ on: "battle_start", then: [{ kind: "status", target: "self", statuses: [st("res_up", 100, 3)] }] }]), 1, 1, 3, [[id("spirit_lance"), 1]]),
    U(a("afterlife_gate", "ประตูปรโลก", "all_allies", "ranged", 46, 6, "buff", S(st("endure", 100, 1), st("dmg_reduction", 100, 1)), [tH("all_allies", 0.3)]), 2),
  ]),
  c3("grand_beast_marshal", (a, p, id) => [
    E(a("command_strike", "สั่งโจมตีพร้อม", "all_allies", "ranged", 34, 4, "buff", S(st("atk_up", 100, 2), st("matk_up", 100, 2))), 10, 2, 0),
    E(a("lightning_order", "คำสั่งสายฟ้า", "single_ally", "ranged", 24, 4, "buff", S(st("advance", 100, 1), st("crit_up", 100, 2), st("atk_up", 100, 3)), [tS("self", st("accuracy_up", 100, 2))]), 5, 2, 1, [[id("command_strike"), 3]]),
    E(a("rally_the_pack", "รวมพลฝูง", "all_allies", "ranged", 36, 5, "heal", H({ statuses: [st("regen", 100, 1)] })), 10, 2, 2, [[id("command_strike"), 3]]),
    E(a("alpha_strike", "จู่โจมจ่าฝูง", "single_enemy", "melee", 28, 3, "mixed", D("physical", { hits: 3, statuses: [st("vulnerable", 50, 2)] }), [tS("all_allies", st("atk_up", 100, 1))]), 10, 0, 0),
    E(a("primal_roar", "คำรามบรรพกาล", "all_enemies", "ranged", 34, 4, "mixed", D("magic", { own: true, statuses: [st("fear", 25, 1)] })), 10, 1, 0),
    E(a("hunting_formation", "กระบวนล่า", "all_enemies", "ranged", 30, 4, "debuff", S(st("mark", 65, 2), st("evasion_down", 60, 2)), [tS("all_allies", st("accuracy_up", 100, 2), st("crit_up", 100, 1))]), 10, 3, 0),
    E(p("commander", "ผู้นำทัพ", [{ on: "battle_start", then: [{ kind: "status", target: "allies", statuses: [st("spd_up", 100, 1), st("atk_up", 100, 1)] }] }]), 1, 2, 3, [[id("command_strike"), 1]]),
    E(p("pack_instinct", "สัญชาตญาณฝูง", [{ on: "ally_down", then: [{ kind: "status", target: "allies", statuses: [st("atk_up", 100, 2)] }] }]), 1, 3, 3, [[id("hunting_formation"), 1]]),
    U(a("stampede", "ฝูงโถมทลาย", "all_allies", "ranged", 44, 6, "buff", S(st("advance", 100, 1)), [tS("all_enemies", st("def_down", 50, 2), st("vulnerable", 30, 1))]), 2),
  ]),
  c3("concord_sovereign", (a, p, id) => [
    E(a("concord", "ประสานใจ", "all_allies", "ranged", 32, 4, "buff", S(st("shield", 100, 2, { shieldPct: 8 }), st("regen", 100, 1))), 10, 2, 0),
    E(a("shared_burden", "แบกรับร่วม", "all_allies", "ranged", 34, 5, "buff", S(st("dmg_reduction", 100, 1), st("def_up", 100, 2))), 10, 2, 1, [[id("concord"), 3]]),
    E(a("lifeline", "สายชีวิต", "single_ally", "ranged", 28, 3, "heal", H({ restoreMp: 25, statuses: [st("regen", 100, 2)] })), 10, 2, 2, [[id("concord"), 5]]),
    E(a("soul_tether", "โยงวิญญาณ", "all_enemies", "ranged", 32, 4, "debuff", S(st("link", 70, 2), st("leech", 50, 2)), [tS("all_allies", st("regen", 100, 1))]), 10, 3, 0),
    E(a("life_siphon", "ดูดชีวาสายใย", "single_enemy", "ranged", 28, 3, "dmg", D("magic", { bounce: { jumps: 2, falloffPct: 30 }, own: true, riders: { lifestealPct: 30 } }), [tH("lowest_ally", 0.3)]), 10, 1, 0),
    E(a("binding_lash", "แส้ผูกพัน", "enemy_row", "melee", 30, 4, "mixed", D("physical", { statuses: [st("root", 30, 1), st("link", 40, 2)] })), 10, 0, 0),
    E(p("harmony", "ความกลมเกลียว", [{ on: "battle_start", then: [{ kind: "status", target: "allies", statuses: [st("res_up", 100, 2)] }] }]), 1, 2, 3, [[id("concord"), 1]]),
    E(p("linked_hearts", "ใจที่โยงกัน", [{ on: "ally_down", oncePerBattle: true, then: [{ kind: "status", target: "allies", statuses: [st("shield", 100, 2, { shieldPct: 10 })] }] }]), 1, 3, 3, [[id("soul_tether"), 1]]),
    U(a("unity", "สหภาพวิญญาณ", "all_enemies", "ranged", 42, 6, "debuff", S(st("link", 80, 2), st("leech", 60, 2)), [tS("all_allies", st("shield", 100, 2, { shieldPct: 8 }))]), 3),
  ]),
  c3("night_reaper", (a, p, id) => [
    E(a("night_slash", "ฟันรัตติกาล", "single_enemy", "melee", 26, 3, "mixed", D("physical", { hits: 2, riders: { critBonusPct: 30 }, statuses: [st("bleed", 50, 2)] })), 10, 0, 0),
    E(a("reaping_waltz", "วอลซ์เก็บเกี่ยว", "enemy_row", "melee", 32, 4, "dmg", D("physical", { riders: { critBonusPct: 20 } }), [tS("self", st("stealth", 100, 1))]), 10, 0, 1, [[id("night_slash"), 3]]),
    E(a("nightfall_execution", "ประหารยามค่ำ", "single_enemy", "melee", 34, 5, "dmg", D("physical", { riders: { execute: { belowHpPct: 35, bonusPct: 120 }, bonusVsStatus: { statusId: "bleed", bonusPct: 30, consume: false } } })), 10, 0, 2, [[id("reaping_waltz"), 3]]),
    E(a("umbral_dagger", "มีดเงาธาตุ", "single_enemy", "ranged", 28, 3, "mixed", D("magic", { own: true, statuses: [st("toxic", 50, 3)] })), 10, 1, 0),
    E(a("shadow_dance", "ระบำเงา", "self", "ranged", 24, 4, "buff", S(st("evasion_up", 100, 2), st("crit_up", 100, 2), st("spd_up", 100, 2)), [tS("all_allies", st("spd_up", 100, 1), st("crit_up", 100, 1))]), 10, 2, 0),
    E(a("weak_point", "ชี้จุดตาย", "single_enemy", "ranged", 26, 3, "debuff", S(st("vulnerable", 70, 2), st("mark", 70, 2)), [tS("all_allies", st("crit_up", 100, 1))]), 10, 3, 0),
    E(p("night_hunter", "นักล่ายามค่ำ", [], [{ kind: "damage_vs_status", statusId: "vulnerable", bonusPct: 20 }]), 1, 3, 3, [[id("weak_point"), 1]]),
    E(p("harvest", "เก็บเกี่ยว", [{ on: "kill", then: [{ kind: "status", target: "self", statuses: [st("stealth", 100, 1)] }, { kind: "restore_mp", target: "self", amount: 8 }] }]), 1, 2, 3, [[id("shadow_dance"), 1]]),
    U(a("eternal_night", "รัตติกาลนิรันดร์", "all_enemies", "melee", 44, 6, "dmg", D("physical", { riders: { critBonusPct: 30, execute: { belowHpPct: 30, bonusPct: 80 } } }), [tS("self", st("stealth", 100, 1))]), 0),
  ]),
  c3("phantom_strategist", (a, p, id) => [
    E(a("phantom_seal", "ตรามายา", "single_enemy", "ranged", 28, 4, "debuff", S(st("seal", 60, 2), st("unbuffable", 60, 2), st("dispel", 70, 1)), [tS("all_allies", st("accuracy_up", 100, 2))]), 5, 3, 0),
    E(a("mirage_trap", "กับดักภาพลวง", "all_enemies", "ranged", 32, 5, "debuff", S(st("confuse", 35, 1), st("blind", 50, 2)), [tS("all_allies", st("evasion_up", 100, 1))]), 5, 3, 1, [[id("phantom_seal"), 3]]),
    E(a("illusion_burst", "ระเบิดมายา", "all_enemies", "ranged", 34, 4, "mixed", D("magic", { own: true, statuses: [st("mp_cost_up", 40, 2)] })), 10, 1, 0),
    E(a("feint", "หลอกล่อแทง", "single_enemy", "melee", 26, 3, "mixed", D("physical", { riders: { penetrationPct: 20 }, statuses: [st("steal_buff", 50, 1)] })), 10, 0, 0),
    E(a("chaos_volley", "ห่ามีดป่วน", "enemy_row", "ranged", 30, 4, "mixed", D("physical", { statuses: [st("delay", 30, 1)] }), [tS("all_allies", st("accuracy_up", 100, 1))]), 10, 0, 1, [[id("feint"), 3]]),
    E(a("decoy", "ตัวล่อมายา", "all_allies", "ranged", 30, 5, "buff", S(st("evasion_up", 100, 2)), [tS("self", st("stealth", 100, 1))]), 10, 2, 0),
    E(p("mastermind", "นักวางแผน", [{ on: "dealt_damage", action: "skill", chancePct: 20, then: [{ kind: "status", target: "other", statuses: [st("dispel", 60, 1)] }] }]), 1, 1, 3, [[id("illusion_burst"), 1]]),
    E(p("slippery", "ลื่นไหล", [{ on: "debuffed", then: [{ kind: "status", target: "self", statuses: [st("evasion_up", 100, 1)] }] }]), 1, 2, 3, [[id("decoy"), 1]]),
    U(a("grand_illusion", "มหามายา", "all_enemies", "ranged", 42, 6, "debuff", S(st("confuse", 40, 1), st("unbuffable", 70, 2), st("dispel", 70, 1)), [tS("all_allies", st("evasion_up", 100, 2), st("crit_up", 100, 2))]), 3),
  ]),
  c3("panacea_sage", (a, p, id) => [
    E(a("panacea_mist", "หมอกโอสถ", "all_allies", "ranged", 36, 4, "heal", H({ statuses: [st("cleanse", 100, 1)] })), 10, 2, 0),
    E(a("vital_draught", "ยาเติมชีวา", "single_ally", "ranged", 26, 2, "heal", H({ flat: 25, restoreMp: 15 })), 10, 2, 1),
    E(a("immunity_brew", "ยาภูมิคุ้มกันหมู่", "all_allies", "ranged", 40, 6, "buff", S(st("immunity", 100, 1), st("res_up", 100, 2))), 5, 2, 2, [[id("panacea_mist"), 3]]),
    E(a("toxic_cure", "พิษกลับขั้ว", "single_enemy", "ranged", 28, 3, "mixed", D("magic", { own: true, statuses: [st("toxic", 50, 3), st("anti_heal", 40, 2)] }), [tH("lowest_ally", 0.25)]), 10, 1, 0),
    E(a("sedative_dart", "ลูกดอกยาสลบ", "single_enemy", "ranged", 26, 4, "mixed", D("physical", { statuses: [st("sleep", 30, 1)] }), [tS("all_allies", st("res_up", 100, 1))]), 5, 0, 0),
    E(a("weakening_gas", "แก๊สอ่อนแรง", "all_enemies", "ranged", 30, 4, "debuff", S(st("atk_down", 55, 2), st("matk_down", 55, 2), st("poison", 55, 2)), [tS("all_allies", st("res_up", 100, 1))]), 10, 3, 0),
    E(p("physician", "แพทย์ประจำทัพ", [], [{ kind: "heal_low_hp", belowHpPct: 35, bonusPct: 25 }]), 1, 1, 3, [[id("toxic_cure"), 1]]),
    E(p("antibodies", "แอนติบอดี", [{ on: "debuffed", chancePct: 30, then: [{ kind: "status", target: "self", statuses: [st("cleanse", 100, 1)] }] }]), 1, 3, 3, [[id("weakening_gas"), 1]]),
    U(a("elixir_of_life", "น้ำอมฤต", "all_allies", "ranged", 56, 6, "heal", H({ statuses: [st("cleanse", 100, 1)] }), [tS("all_allies", st("regen", 100, 1))]), 2),
  ]),
  c3("magnum_artificer", (a, p, id) => [
    E(a("alchemic_fire", "ไฟแปรธาตุ", "enemy_row", "ranged", 28, 3, "mixed", D("magic", { element: "FIRE", riders: { bonusVsStatus: { statusId: "oil", bonusPct: 40, consume: true } }, statuses: [st("burn", 50, 2)] })), 10, 1, 0),
    E(a("transmute_storm", "พายุแปรสสาร", "all_enemies", "ranged", 36, 4, "mixed", D("magic", { own: true, statuses: [st("corrode", 40, 2)] })), 10, 1, 1, [[id("alchemic_fire"), 3]]),
    E(a("golem_fist", "หมัดโกเลม", "single_enemy", "melee", 26, 3, "dmg", D("physical", { riders: { penetrationPct: 40 } }), [tS("self", st("def_up", 100, 2))]), 10, 0, 0),
    E(a("philosopher_plate", "เกราะศิลานักปราชญ์", "all_allies", "ranged", 34, 5, "buff", S(st("def_up", 100, 2), st("mdef_up", 100, 2), st("shield", 100, 1, { shieldPct: 6 }))), 10, 2, 0),
    E(a("slick_ground", "พื้นลื่นน้ำมัน", "all_enemies", "ranged", 28, 4, "debuff", S(st("oil", 80, 3), st("spd_down", 60, 2)), [tS("all_allies", st("matk_up", 100, 1))]), 10, 3, 0),
    E(a("petrify_flask", "ขวดกลายศิลา", "single_enemy", "ranged", 32, 5, "debuff", S(st("petrify", 50, 1)), [tS("self", st("shield", 100, 2, { shieldPct: 12 })), tS("all_allies", st("def_up", 100, 2))]), 5, 3, 1, [[id("slick_ground"), 3]]),
    E(p("catalyst", "ตัวเร่งปฏิกิริยา", [], [{ kind: "damage_vs_status", statusId: "oil", bonusPct: 15 }, { kind: "damage_vs_status", statusId: "burn", bonusPct: 10 }]), 1, 1, 3, [[id("alchemic_fire"), 1]]),
    E(p("conservation", "ไม่มีสูญเปล่า", [{ on: "kill", then: [{ kind: "restore_mp", target: "self", amount: 8 }] }]), 1, 0, 3, [[id("golem_fist"), 1]]),
    U(a("magnum_opus", "มหากรรมแปรธาตุ", "all_enemies", "ranged", 46, 6, "mixed", D("magic", { element: "FIRE", riders: { bonusVsStatus: { statusId: "oil", bonusPct: 60, consume: true } }, statuses: [st("burn", 60, 2)] }), [tS("all_enemies", st("def_down", 40, 2))]), 1),
  ]),
  c3("celestial_maestro", (a, p, id) => [
    E(a("celestial_overture", "โหมโรงดารา", "all_allies", "ranged", 34, 4, "buff", S(st("atk_up", 100, 2), st("matk_up", 100, 2))), 10, 2, 0),
    E(a("harmonic_hymn", "เพลงประสานฟื้นฟู", "all_allies", "ranged", 36, 4, "heal", H({ statuses: [st("mp_regen", 100, 2)] })), 10, 2, 1, [[id("celestial_overture"), 3]]),
    E(a("tempo", "จังหวะเร่ง", "single_ally", "ranged", 24, 4, "buff", S(st("advance", 100, 1), st("spd_up", 100, 2), st("atk_up", 100, 2)), [tS("self", st("matk_up", 100, 2))]), 5, 2, 2, [[id("celestial_overture"), 5]]),
    E(a("baton_strike", "ไม้บาตองฟาด", "enemy_row", "melee", 28, 3, "dmg", D("physical"), [tS("all_allies", st("evasion_up", 100, 1))]), 10, 0, 0),
    E(a("star_chord", "คอร์ดดารา", "all_enemies", "ranged", 34, 4, "dmg", D("magic", { own: true }), [tS("all_allies", st("matk_up", 100, 1))]), 10, 1, 0),
    E(a("discord", "เสียงไม่ประสาน", "all_enemies", "ranged", 30, 4, "debuff", S(st("dispel", 70, 1), st("atk_down", 50, 2), st("spd_down", 50, 2)), [tS("all_allies", st("res_up", 100, 1))]), 10, 3, 0),
    E(p("conductor", "วาทยกร", [{ on: "battle_start", then: [{ kind: "status", target: "allies", statuses: [st("spd_up", 100, 1), st("accuracy_up", 100, 1)] }] }]), 1, 3, 3, [[id("discord"), 1]]),
    E(p("encore", "อังกอร์", [{ on: "used_skill", chancePct: 25, then: [{ kind: "restore_mp", target: "self", amount: 6 }] }]), 1, 1, 3, [[id("star_chord"), 1]]),
    U(a("grand_finale", "บทเพลงปิดม่าน", "all_allies", "ranged", 46, 6, "buff", S(st("atk_up", 100, 2), st("matk_up", 100, 2), st("crit_up", 100, 2))), 2),
  ]),
  c3("eclipse_cantor", (a, p, id) => [
    E(a("eclipse_dirge", "บทโศกอุปราคา", "all_enemies", "ranged", 32, 4, "debuff", S(st("atk_down", 60, 2), st("matk_down", 60, 2), st("res_down", 50, 2)), [tS("all_allies", st("matk_up", 100, 1))]), 10, 3, 0),
    E(a("umbral_verse", "ท่อนเงามืด", "single_enemy", "ranged", 30, 5, "debuff", S(st("doom", 30, 3), st("fear", 50, 1)), [tS("all_allies", st("matk_up", 100, 1))]), 5, 3, 1, [[id("eclipse_dirge"), 3]]),
    E(a("black_sun", "ตะวันดำ", "all_enemies", "ranged", 34, 4, "mixed", D("magic", { element: "SHADOW", statuses: [st("blind", 30, 2)] })), 10, 1, 0),
    E(a("final_requiem", "บทสวดส่งวิญญาณ", "single_enemy", "ranged", 32, 4, "dmg", D("magic", { own: true, riders: { execute: { belowHpPct: 40, bonusPct: 70 } } }), [tS("self", st("mp_regen", 100, 2))]), 10, 1, 1, [[id("black_sun"), 3]]),
    E(a("shadow_bow", "คันชักเงา", "single_enemy", "melee", 26, 3, "mixed", D("physical", { statuses: [st("fear", 30, 1)] }), [tS("all_enemies", st("spd_down", 30, 1))]), 10, 0, 0),
    E(a("moonlit_hymn", "เพลงจันทร์เงา", "all_allies", "ranged", 32, 4, "buff", S(st("matk_up", 100, 2), st("res_up", 100, 2), st("mp_regen", 100, 1)), [tS("all_enemies", st("matk_down", 30, 1))]), 10, 2, 0),
    E(p("despair", "สิ้นหวัง", [], [{ kind: "damage_vs_status", statusId: "fear", bonusPct: 20 }]), 1, 3, 3, [[id("eclipse_dirge"), 1]]),
    E(p("lingering_echo", "เสียงก้องค้าง", [{ on: "used_skill", chancePct: 25, then: [{ kind: "restore_mp", target: "self", amount: 6 }] }]), 1, 1, 3, [[id("black_sun"), 1]]),
    U(a("total_eclipse", "สุริยุปราคาเต็มดวง", "all_enemies", "ranged", 44, 6, "debuff", S(st("blind", 60, 2), st("fear", 40, 1), st("res_down", 60, 2)), [tS("all_allies", st("matk_up", 100, 2))]), 3),
  ]),
];

const CLASS1 = [guardian(), striker(), ranger(), arcanist(), warden(), binder(), rogue(), alchemist(), bard()];

export const SKILL_TREES: ReadonlyMap<string, SkillTree> = new Map([...CLASS1, ...CLASS2, ...CLASS3].map((b) => [b.tree.id, b.tree]));
export const TREE_SKILLS: SkillDefinition[] = [...CLASS1, ...CLASS2, ...CLASS3].flatMap((b) => b.skills);
export const TREE_PASSIVE_IDS: ReadonlySet<string> = new Set(TREE_SKILLS.filter((s) => s.kind === "passive").map((s) => s.id));
