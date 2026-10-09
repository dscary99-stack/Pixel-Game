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
    E(a("shield_bash", "กระแทกโล่", "single_enemy", "melee", 5, 2, "mixed", D("physical", { statuses: [st("stun", 20, 1)] })), 10, 0, 0),
    E(a("sweep", "ฟาดกวาดแนว", "enemy_row", "melee", 9, 3, "mixed", D("physical", { statuses: [st("atk_down", 30, 2)] })), 10, 0, 1, [[id("shield_bash"), 3]]),
    E(a("rebuke", "ทุบโล่สะท้อน", "single_enemy", "melee", 10, 3, "mixed", D("physical"), [tS("self", st("counter", 100, 1))]), 10, 0, 2, [[id("shield_bash"), 5]]),
    E(a("holy_light", "แสงพิทักษ์", "single_enemy", "ranged", 6, 2, "dmg", D("magic", { own: true })), 10, 1, 0),
    E(a("sacred_wave", "คลื่นศักดิ์สิทธิ์", "all_enemies", "ranged", 14, 4, "dmg", D("magic", { own: true }), [tS("self", st("shield", 100, 2, { shieldPct: 8 }))]), 10, 1, 1, [[id("holy_light"), 3]]),
    E(a("judgement", "ตราลงทัณฑ์", "single_enemy", "ranged", 12, 3, "mixed", D("magic", { own: true, statuses: [st("mark", 60, 2)] })), 10, 1, 2, [[id("holy_light"), 5]]),
    E(a("cover", "โล่คุ้มภัย", "single_ally", "ranged", 8, 3, "buff", S(st("shield", 100, 2, { shieldPct: 15 }), st("protect", 100, 2))), 10, 2, 0),
    E(a("bulwark", "ป้อมปราการ", "self", "ranged", 10, 4, "buff", S(st("def_up", 100, 3), st("mdef_up", 100, 3), st("dmg_reduction", 100, 2))), 5, 2, 1, [[id("cover"), 3]]),
    E(a("provoke", "ยั่วยุทั้งแถว", "enemy_row", "ranged", 6, 3, "debuff", S(st("taunt", 70, 2))), 5, 3, 0),
    E(a("daunt", "ข่มขวัญ", "all_enemies", "ranged", 12, 4, "debuff", S(st("atk_down", 50, 2), st("matk_down", 50, 2))), 10, 3, 1, [[id("provoke"), 3]]),
    E(p("heart", "ใจผู้พิทักษ์", [{ on: "protected_ally", then: [{ kind: "restore_mp", target: "self", amount: 4 }] }], [{ kind: "guard_reduction", reductionPct: 15 }]), 1, 2, 3, [[id("cover"), 1]]),
    E(p("steadfast", "ยืนหยัด", [{ on: "hp_below", hpBelowPct: 30, oncePerBattle: true, then: [{ kind: "status", target: "self", statuses: [st("endure", 100, 2), st("dmg_reduction", 100, 2)] }] }]), 1, 3, 3, [[id("provoke"), 1]]),
    U(a("judgement_crash", "ค้อนโล่พิพากษา", "enemy_row", "melee", 18, 6, "mixed", D("physical", { statuses: [st("stun", 35, 1)] }), [tS("self", st("shield", 100, 2, { shieldPct: 10 }))]), 0),
    U(a("dawn_guard", "อรุณพิทักษ์", "all_enemies", "ranged", 22, 6, "dmg", D("magic", { own: true }), [tS("all_allies", st("shield", 100, 2, { shieldPct: 6 }))]), 1),
    U(a("aegis_of_faith", "ปราการศรัทธา", "all_allies", "ranged", 20, 6, "buff", S(st("shield", 100, 2, { shieldPct: 8 }), st("dmg_reduction", 100, 1))), 2),
    U(a("challenge", "ท้าทายทั้งสนาม", "all_enemies", "ranged", 18, 6, "debuff", S(st("taunt", 80, 2), st("atk_down", 50, 2)), [tS("self", st("def_up", 100, 3), st("counter", 100, 2))]), 3),
  ]);
}

function striker() {
  const a = maker("striker", 1), p = P("striker", 1), id = (k: string) => `skill:striker_${k}`;
  return build("class:striker", 1, [
    E(a("heavy_slash", "ฟันหนัก", "single_enemy", "melee", 6, 2, "dmg", D("physical")), 10, 0, 0),
    E(a("cleave", "กวาดแถว", "enemy_row", "melee", 8, 3, "dmg", D("physical")), 10, 0, 1, [[id("heavy_slash"), 3]]),
    E(a("all_in", "พุ่งเดิมพัน", "single_enemy", "melee", 12, 4, "dmg", D("physical", { riders: { recoilPct: 15, critBonusPct: 20 } })), 10, 0, 2, [[id("heavy_slash"), 5]]),
    E(a("blade_wave", "ฟันคลื่นธาตุ", "single_enemy", "ranged", 6, 2, "dmg", D("magic", { own: true })), 10, 1, 0),
    E(a("war_blast", "ระเบิดเพลิงยุทธ์", "enemy_row", "ranged", 12, 3, "mixed", D("magic", { own: true, statuses: [st("burn", 30, 2)] })), 10, 1, 1, [[id("blade_wave"), 3]]),
    E(a("thunder_blade", "ดาบสายฟ้า", "single_enemy", "melee", 14, 4, "mixed", D("magic", { element: "WIND", statuses: [st("paralyze", 25, 1)] })), 10, 1, 2, [[id("blade_wave"), 5]]),
    E(a("war_cry", "ตะโกนศึก", "self", "ranged", 8, 4, "buff", S(st("atk_up", 100, 3), st("crit_up", 100, 2))), 10, 2, 0),
    E(a("rally_troops", "ปลุกขวัญทัพ", "all_allies", "ranged", 14, 5, "buff", S(st("atk_up", 100, 2))), 10, 2, 1, [[id("war_cry"), 3]]),
    E(a("armor_break", "ทลายเกราะ", "single_enemy", "melee", 8, 3, "mixed", D("physical", { riders: { penetrationPct: 30 }, statuses: [st("def_down", 50, 2)] })), 10, 3, 0),
    E(a("roar", "คำรามข่ม", "all_enemies", "ranged", 12, 4, "debuff", S(st("def_down", 40, 2), st("spd_down", 40, 2))), 10, 3, 1, [[id("armor_break"), 3]]),
    E(p("fighting_blood", "เลือดนักสู้", [
      { on: "hp_below", hpBelowPct: 40, oncePerBattle: true, then: [{ kind: "status", target: "self", statuses: [st("atk_up", 100, 2)] }] },
      { on: "kill", then: [{ kind: "restore_mp", target: "self", amount: 4 }] },
    ]), 1, 0, 3, [[id("heavy_slash"), 1]]),
    E(p("swordcraft", "เพลงดาบ", [], [{ kind: "damage_vs_status", statusId: "def_down", bonusPct: 15 }]), 1, 3, 3, [[id("armor_break"), 3]]),
    U(a("thousand_edges", "ดาบพันคม", "all_enemies", "melee", 20, 6, "dmg", D("physical", { riders: { critBonusPct: 20 } })), 0),
    U(a("sky_rend", "ดาบธาตุผ่าฟ้า", "single_enemy", "ranged", 22, 6, "dmg", D("magic", { own: true, riders: { penetrationPct: 30 } }), [tD("all_enemies", "magic", 0.25, { own: true })]), 1),
    U(a("battle_banner", "ธงรบไม่ถอย", "all_allies", "ranged", 20, 6, "buff", S(st("atk_up", 100, 2), st("crit_up", 100, 2)), [tS("self", st("endure", 100, 1))]), 2),
    U(a("break_morale", "ทลายขวัญทัพ", "all_enemies", "ranged", 18, 6, "debuff", S(st("def_down", 80, 2), st("atk_down", 70, 2), st("fear", 35, 1))), 3),
  ]);
}

function ranger() {
  const a = maker("ranger", 1), p = P("ranger", 1), id = (k: string) => `skill:ranger_${k}`;
  return build("class:ranger", 1, [
    E(a("marking_shot", "ยิงติดเป้า", "single_enemy", "ranged", 5, 2, "mixed", D("physical", { riders: { accuracyBonusPct: 10 }, statuses: [st("mark", 80, 2)] })), 10, 0, 0),
    E(a("arrow_rain", "ฝนลูกธนู", "all_enemies", "ranged", 10, 3, "dmg", D("physical")), 10, 0, 1, [[id("marking_shot"), 3]]),
    E(a("finisher", "ศรปลิดชีพ", "single_enemy", "ranged", 12, 4, "dmg", D("physical", { riders: { execute: { belowHpPct: 35, bonusPct: 70 } } })), 10, 0, 2, [[id("marking_shot"), 5]]),
    E(a("element_arrow", "ศรธาตุ", "single_enemy", "ranged", 6, 2, "dmg", D("magic", { own: true })), 10, 1, 0),
    E(a("burst_arrow", "ศรระเบิดธาตุ", "enemy_row", "ranged", 12, 3, "dmg", D("magic", { own: true })), 10, 1, 1, [[id("element_arrow"), 3]]),
    E(a("frost_arrow", "ศรเยือกแข็ง", "single_enemy", "ranged", 12, 3, "mixed", D("magic", { element: "WATER", statuses: [st("spd_down", 60, 2), st("root", 40, 1)] })), 10, 1, 2, [[id("element_arrow"), 5]]),
    E(a("hawk_eye", "สายตาเหยี่ยว", "self", "ranged", 8, 2, "buff", S(st("focus", 100, 2), st("crit_up", 100, 2), st("accuracy_up", 100, 2))), 10, 2, 0),
    E(a("field_remedy", "ยาสมุนไพรป่า", "single_ally", "ranged", 8, 3, "heal", H({ statuses: [st("regen", 100, 2)] })), 10, 2, 1, [[id("hawk_eye"), 3]]),
    E(a("snare", "กับดักขาตรึง", "enemy_row", "ranged", 8, 3, "debuff", S(st("root", 70, 2), st("spd_down", 50, 2))), 5, 3, 0),
    E(a("smoke_veil", "ควันอำพราง", "all_enemies", "ranged", 12, 4, "debuff", S(st("blind", 50, 2))), 10, 3, 1, [[id("snare"), 3]]),
    E(p("hunter_eye", "สายตานักล่า", [], [{ kind: "damage_vs_status", statusId: "mark", bonusPct: 15 }]), 1, 0, 3, [[id("marking_shot"), 1]]),
    E(p("light_step", "ก้าวเบา", [
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
    E(a("staff_strike", "ฟาดไม้เท้าเวท", "single_enemy", "melee", 4, 2, "mixed", D("physical", { statuses: [st("silence", 20, 1)] })), 10, 0, 0),
    E(a("rune_hammer", "ค้อนอาคม", "single_enemy", "melee", 8, 3, "mixed", D("physical", { statuses: [st("knockback", 50, 1)] })), 10, 0, 1, [[id("staff_strike"), 3]]),
    E(a("blade_storm", "พายุดาบเวท", "all_enemies", "ranged", 14, 4, "dmg", D("physical")), 10, 0, 2, [[id("staff_strike"), 5]]),
    E(a("arcane_bolt", "ลูกพลังเวท", "single_enemy", "ranged", 6, 2, "dmg", D("magic", { own: true })), 10, 1, 0),
    E(a("storm", "พายุเวท", "all_enemies", "ranged", 12, 3, "dmg", D("magic", { own: true })), 10, 1, 1, [[id("arcane_bolt"), 3]]),
    E(a("prism_ray", "ลำแสงธาตุ", "single_enemy", "ranged", 16, 4, "mixed", D("magic", { own: true, statuses: [st("mdef_down", 50, 2)] })), 10, 1, 2, [[id("arcane_bolt"), 5]]),
    E(a("mana_shield", "เกราะมานา", "self", "ranged", 8, 3, "buff", S(st("shield", 100, 2, { shieldPct: 15 }), st("mdef_up", 100, 2))), 10, 2, 0),
    E(a("quicken_spell", "เร่งเวท", "single_ally", "ranged", 10, 4, "buff", S(st("matk_up", 100, 3), st("focus", 100, 2))), 10, 2, 1, [[id("mana_shield"), 3]]),
    E(a("seal", "ผนึกเวท", "single_enemy", "ranged", 8, 3, "debuff", S(st("silence", 50, 2), st("mp_cost_up", 40, 2))), 10, 3, 0),
    E(a("confusion_mist", "หมอกสับสน", "enemy_row", "ranged", 12, 4, "debuff", S(st("confuse", 30, 1), st("blind", 40, 2))), 5, 3, 1, [[id("seal"), 3]]),
    E(p("mana_flow", "กระแสมานา", [{ on: "used_skill", chancePct: 30, then: [{ kind: "restore_mp", target: "self", amount: 4 }] }]), 1, 1, 3, [[id("arcane_bolt"), 1]]),
    E(p("element_weave", "ธาตุสอดประสาน", [], [{ kind: "damage_vs_status", statusId: "wet", bonusPct: 10 }, { kind: "damage_vs_status", statusId: "burn", bonusPct: 10 }]), 1, 3, 3, [[id("seal"), 1]]),
    U(a("rune_blades", "ดาบอาคมพันเล่ม", "enemy_row", "ranged", 18, 6, "dmg", D("physical"), [tS("self", st("matk_up", 100, 2))]), 0),
    U(a("meteor", "อุกกาบาตธาตุ", "all_enemies", "ranged", 24, 6, "mixed", D("magic", { own: true, statuses: [st("mdef_down", 30, 2)] })), 1),
    U(a("mana_tide", "ห้วงมานา", "all_allies", "ranged", 20, 6, "buff", S(st("mp_regen", 100, 3), st("matk_up", 100, 2))), 2),
    U(a("grand_seal", "ผนึกทั้งสนาม", "all_enemies", "ranged", 18, 6, "debuff", S(st("silence", 70, 2), st("mp_cost_up", 80, 3), st("matk_down", 60, 2))), 3),
  ]);
}

function warden() {
  const a = maker("warden", 1), p = P("warden", 1), id = (k: string) => `skill:warden_${k}`;
  return build("class:warden", 1, [
    E(a("blessed_mace", "กระบองพร", "single_enemy", "melee", 6, 2, "dmg", D("physical"), [tH("lowest_ally", 0.3)]), 10, 0, 0),
    E(a("purging_blow", "ทุบชำระ", "single_enemy", "melee", 8, 3, "mixed", D("physical", { statuses: [st("dispel", 50, 1)] })), 10, 0, 1, [[id("blessed_mace"), 3]]),
    E(a("chastise", "ทัณฑ์แห่งพร", "enemy_row", "melee", 12, 4, "mixed", D("physical", { statuses: [st("atk_down", 30, 2)] })), 10, 0, 2, [[id("blessed_mace"), 5]]),
    E(a("holy_spark", "แสงศักดิ์สิทธิ์", "single_enemy", "ranged", 6, 2, "dmg", D("magic", { own: true })), 10, 1, 0),
    E(a("cleansing_ray", "ลำแสงชำระ", "enemy_row", "ranged", 14, 4, "dmg", D("magic", { own: true }), [tS("all_allies", st("regen", 100, 1))]), 10, 1, 1, [[id("holy_spark"), 3]]),
    E(a("verdict", "พิพากษา", "single_enemy", "ranged", 14, 4, "dmg", D("magic", { own: true, riders: { execute: { belowHpPct: 30, bonusPct: 60 } } })), 10, 1, 2, [[id("holy_spark"), 5]]),
    E(a("mend", "รักษา", "single_ally", "ranged", 6, 2, "heal", H({ flat: 10 })), 10, 2, 0),
    E(a("soothing_wind", "ลมเยียวยา", "all_allies", "ranged", 12, 3, "heal", H({ flat: 5 })), 10, 2, 1, [[id("mend"), 3]]),
    E(a("raise", "ปลุกชีพ", "single_ally", "ranged", 16, 5, "heal", R(30)), 5, 2, 2, [[id("mend"), 5]]),
    E(a("purify", "ชำระล้าง", "single_ally", "ranged", 8, 3, "buff", S(st("cleanse", 100, 1), st("res_up", 100, 2), st("regen", 100, 1))), 5, 3, 0),
    E(a("weary_curse", "คำสาปอ่อนล้า", "enemy_row", "ranged", 12, 4, "debuff", S(st("atk_down", 50, 2), st("matk_down", 50, 2))), 10, 3, 1, [[id("purify"), 1]]),
    E(p("grace", "พรแห่งการเยียวยา", [], [{ kind: "heal_low_hp", belowHpPct: 40, bonusPct: 25 }]), 1, 2, 3, [[id("mend"), 1]]),
    E(p("steadfast_faith", "ศรัทธามั่น", [{ on: "ally_down", oncePerBattle: true, then: [{ kind: "status", target: "allies", statuses: [st("res_up", 100, 2), st("def_up", 100, 2)] }] }]), 1, 3, 3, [[id("purify"), 1]]),
    U(a("dawn_hammer", "ค้อนอรุณ", "enemy_row", "melee", 18, 6, "dmg", D("physical"), [tH("all_allies", 0.3)]), 0),
    U(a("heavens_verdict", "พิพากษาสวรรค์", "all_enemies", "ranged", 22, 6, "mixed", D("magic", { own: true, statuses: [st("anti_heal", 40, 2)] })), 1),
    U(a("sanctuary", "เขตศักดิ์สิทธิ์", "all_allies", "ranged", 26, 6, "heal", H({ statuses: [st("regen", 100, 1)] })), 2),
    U(a("forbidden_seal", "ตราต้องห้าม", "all_enemies", "ranged", 18, 6, "debuff", S(st("unbuffable", 90, 2), st("dispel", 90, 1), st("atk_down", 60, 2))), 3),
  ]);
}

function binder() {
  const a = maker("binder", 1), p = P("binder", 1), id = (k: string) => `skill:binder_${k}`;
  return build("class:binder", 1, [
    E(a("joint_strike", "ตีประสาน", "single_enemy", "melee", 5, 2, "mixed", D("physical", { statuses: [st("mark", 60, 2)] })), 10, 0, 0),
    E(a("pack_maul", "สั่งรุมขย้ำ", "single_enemy", "melee", 9, 3, "mixed", D("physical", { statuses: [st("vulnerable", 40, 2)] })), 10, 0, 1, [[id("joint_strike"), 3]]),
    E(a("pack_sweep", "กวาดพร้อมฝูง", "enemy_row", "melee", 12, 4, "dmg", D("physical")), 10, 0, 2, [[id("joint_strike"), 5]]),
    E(a("bond_pulse", "พลังสายใย", "single_enemy", "ranged", 6, 2, "dmg", D("magic", { own: true })), 10, 1, 0),
    E(a("bond_wave", "คลื่นสายใย", "all_enemies", "ranged", 12, 3, "dmg", D("magic", { own: true })), 10, 1, 1, [[id("bond_pulse"), 3]]),
    E(a("beast_sigil", "ตราอสูร", "single_enemy", "ranged", 12, 4, "mixed", D("magic", { own: true, statuses: [st("fear", 30, 1)] })), 10, 1, 2, [[id("bond_pulse"), 5]]),
    E(a("rouse", "ปลุกพลังคู่ใจ", "all_allies", "ranged", 10, 4, "buff", S(st("atk_up", 100, 3), st("matk_up", 100, 3))), 10, 2, 0),
    E(a("quicken", "เร่งจังหวะ", "single_ally", "ranged", 8, 4, "buff", S(st("advance", 100, 1), st("spd_up", 100, 2))), 5, 2, 1, [[id("rouse"), 3]]),
    E(a("bond_guard", "ผูกพันคุ้มภัย", "all_allies", "ranged", 12, 4, "buff", S(st("shield", 100, 2, { shieldPct: 8 }))), 10, 2, 2, [[id("quicken"), 3]]),
    E(a("predator_gaze", "สายตาสัตว์ร้าย", "single_enemy", "ranged", 6, 3, "debuff", S(st("def_down", 50, 2), st("evasion_down", 50, 2))), 10, 3, 0),
    E(a("howl", "เสียงหอนข่มขวัญ", "all_enemies", "ranged", 12, 4, "debuff", S(st("fear", 25, 1), st("atk_down", 40, 2))), 10, 3, 1, [[id("predator_gaze"), 3]]),
    E(p("bond_link", "สายใยคู่ใจ", [{ on: "ally_down", then: [{ kind: "status", target: "allies", statuses: [st("atk_up", 100, 2)] }] }]), 1, 2, 3, [[id("rouse"), 1]]),
    E(p("one_heart", "ใจเดียวกัน", [{ on: "battle_start", then: [{ kind: "status", target: "allies", statuses: [st("spd_up", 100, 1)] }] }]), 1, 3, 3, [[id("predator_gaze"), 1]]),
    U(a("pack_frenzy", "ฝูงคลั่ง", "single_enemy", "melee", 18, 6, "mixed", D("physical", { statuses: [st("vulnerable", 50, 2)] }), [tS("all_allies", st("atk_up", 100, 1))]), 0),
    U(a("bond_burst", "สายใยแตกพลัง", "all_enemies", "ranged", 22, 6, "dmg", D("magic", { own: true }), [tS("all_allies", st("shield", 100, 1, { shieldPct: 5 }))]), 1),
    U(a("one_pack", "ใจเดียวทั้งฝูง", "all_allies", "ranged", 20, 6, "buff", S(st("spd_up", 100, 2), st("atk_up", 100, 1), st("matk_up", 100, 1))), 2),
    U(a("alpha_glare", "สายตาจ้าวฝูง", "all_enemies", "ranged", 18, 6, "debuff", S(st("fear", 45, 1), st("def_down", 80, 2), st("evasion_down", 70, 2))), 3),
  ]);
}

function rogue() {
  const a = maker("rogue", 1), p = P("rogue", 1), id = (k: string) => `skill:rogue_${k}`;
  return build("class:rogue", 1, [
    E(a("bleeding_stab", "แทงเลือดไหล", "single_enemy", "melee", 5, 2, "mixed", D("physical", { statuses: [st("bleed", 60, 3)] })), 10, 0, 0),
    E(a("shadow_blade", "ปาดาบเงา", "single_enemy", "ranged", 8, 3, "dmg", D("physical", { riders: { critBonusPct: 25, accuracyBonusPct: 10 } })), 10, 0, 1, [[id("bleeding_stab"), 3]]),
    E(a("throat_cut", "ปาดคอ", "single_enemy", "melee", 12, 4, "dmg", D("physical", { riders: { execute: { belowHpPct: 30, bonusPct: 100 } } })), 10, 0, 2, [[id("bleeding_stab"), 5]]),
    E(a("shade_knife", "มีดเงาธาตุ", "single_enemy", "ranged", 6, 2, "dmg", D("magic", { own: true })), 10, 1, 0),
    E(a("venom_shade", "พิษเงา", "single_enemy", "ranged", 10, 3, "mixed", D("magic", { own: true, statuses: [st("poison", 50, 3)] })), 10, 1, 1, [[id("shade_knife"), 3]]),
    E(a("toxic_bomb", "ระเบิดควันพิษ", "all_enemies", "ranged", 14, 4, "mixed", D("magic", { own: true, statuses: [st("poison", 25, 2)] })), 10, 1, 2, [[id("shade_knife"), 5]]),
    E(a("shadow_veil", "ซ่อนเงา", "self", "ranged", 6, 4, "buff", S(st("stealth", 100, 1), st("crit_up", 100, 2))), 5, 2, 0),
    E(a("shadow_step", "ก้าวเงา", "self", "ranged", 8, 4, "buff", S(st("evasion_up", 100, 2), st("spd_up", 100, 2), st("advance", 100, 1))), 5, 2, 1, [[id("shadow_veil"), 3]]),
    E(a("pilfer", "ขโมยบัฟ", "single_enemy", "melee", 8, 3, "mixed", D("physical", { statuses: [st("steal_buff", 60, 1)] })), 10, 3, 0),
    E(a("blinding_dust", "ผงตาบอด", "enemy_row", "ranged", 10, 4, "debuff", S(st("blind", 60, 2))), 10, 3, 1, [[id("pilfer"), 3]]),
    E(p("opportunist", "ฉวยโอกาส", [], [{ kind: "damage_vs_status", statusId: "bleed", bonusPct: 20 }]), 1, 0, 3, [[id("bleeding_stab"), 1]]),
    E(p("quick_hands", "มือไว", [{ on: "kill", then: [{ kind: "status", target: "self", statuses: [st("spd_up", 100, 1)] }] }]), 1, 3, 3, [[id("pilfer"), 1]]),
    U(a("dance_of_blades", "ร่ายรำพันคม", "enemy_row", "melee", 18, 6, "mixed", D("physical", { riders: { critBonusPct: 20 }, statuses: [st("bleed", 50, 3)] })), 0),
    U(a("death_shade", "เงามรณะ", "single_enemy", "ranged", 20, 6, "mixed", D("magic", { own: true, riders: { execute: { belowHpPct: 35, bonusPct: 80 } }, statuses: [st("poison", 50, 3)] })), 1),
    U(a("shadow_curtain", "ม่านเงาคุ้มทีม", "all_allies", "ranged", 20, 6, "buff", S(st("evasion_up", 100, 3), st("spd_up", 100, 2)), [tS("self", st("stealth", 100, 1), st("crit_up", 100, 3))]), 2),
    U(a("dark_haze", "ม่านพิษมืด", "all_enemies", "ranged", 18, 6, "debuff", S(st("blind", 60, 2), st("poison", 60, 3), st("res_down", 50, 2))), 3),
  ]);
}

function alchemist() {
  const a = maker("alchemist", 1), p = P("alchemist", 1), id = (k: string) => `skill:alchemist_${k}`;
  return build("class:alchemist", 1, [
    E(a("flask_throw", "ปาขวดแตก", "single_enemy", "ranged", 5, 2, "mixed", D("physical", { statuses: [st("corrode", 40, 3)] })), 10, 0, 0),
    E(a("flask_burst", "ระเบิดขวด", "enemy_row", "ranged", 10, 3, "mixed", D("physical", { statuses: [st("poison", 30, 3)] })), 10, 0, 1, [[id("flask_throw"), 3]]),
    E(a("strong_acid", "กรดเข้มข้น", "single_enemy", "ranged", 12, 4, "mixed", D("physical", { riders: { penetrationPct: 40 }, statuses: [st("def_down", 40, 2)] })), 10, 0, 2, [[id("flask_throw"), 5]]),
    E(a("element_flask", "ขวดธาตุ", "single_enemy", "ranged", 6, 2, "dmg", D("magic", { own: true })), 10, 1, 0),
    E(a("chain_reaction", "ปฏิกิริยาลูกโซ่", "all_enemies", "ranged", 12, 3, "mixed", D("magic", { own: true, statuses: [st("oil", 40, 2)] })), 10, 1, 1, [[id("element_flask"), 3]]),
    E(a("ignite", "แปรธาตุลุกไหม้", "enemy_row", "ranged", 14, 4, "mixed", D("magic", { element: "FIRE", riders: { bonusVsStatus: { statusId: "oil", bonusPct: 40, consume: false } }, statuses: [st("burn", 50, 2)] })), 10, 1, 2, [[id("element_flask"), 5]]),
    E(a("quick_remedy", "โอสถเร่งด่วน", "single_ally", "ranged", 8, 3, "heal", H({ flat: 15, statuses: [st("regen", 100, 3)] })), 10, 2, 0),
    E(a("tonic", "ยาเสริมกำลัง", "single_ally", "ranged", 10, 4, "buff", S(st("atk_up", 100, 3), st("matk_up", 100, 3))), 10, 2, 1, [[id("quick_remedy"), 3]]),
    E(a("toxic_cloud", "ควันพิษ", "all_enemies", "ranged", 12, 4, "debuff", S(st("poison", 45, 3), st("anti_heal", 40, 2))), 10, 3, 0),
    E(a("corrosive", "ยากัดกร่อน", "single_enemy", "ranged", 8, 3, "debuff", S(st("corrode", 70, 3), st("res_down", 50, 2))), 10, 3, 1, [[id("toxic_cloud"), 3]]),
    E(p("brewer", "มือปรุงชำนาญ", [{ on: "used_item", then: [{ kind: "restore_mp", target: "self", amount: 5 }] }]), 1, 2, 3, [[id("quick_remedy"), 1]]),
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
    E(a("lute_smash", "ฟาดพิณ", "single_enemy", "melee", 5, 2, "mixed", D("physical", { statuses: [st("delay", 30, 1)] })), 10, 0, 0),
    E(a("blade_dance", "ระบำดาบ", "enemy_row", "melee", 10, 3, "dmg", D("physical"), [tS("self", st("evasion_up", 100, 1))]), 10, 0, 1, [[id("lute_smash"), 3]]),
    E(a("battle_hymn", "บทเพลงฟันฝ่า", "single_enemy", "melee", 12, 4, "dmg", D("physical"), [tS("all_allies", st("atk_up", 100, 1))]), 10, 0, 2, [[id("lute_smash"), 5]]),
    E(a("shrill_note", "เสียงแหลมบาดหู", "single_enemy", "ranged", 6, 2, "mixed", D("magic", { own: true, statuses: [st("fear", 25, 1)] })), 10, 1, 0),
    E(a("sound_wave", "คลื่นเสียง", "all_enemies", "ranged", 12, 3, "dmg", D("magic", { own: true })), 10, 1, 1, [[id("shrill_note"), 3]]),
    E(a("shiver_chord", "โน้ตสะท้าน", "single_enemy", "ranged", 12, 4, "mixed", D("magic", { own: true, statuses: [st("paralyze", 30, 1)] })), 10, 1, 2, [[id("shrill_note"), 5]]),
    E(a("war_song", "เพลงปลุกใจ", "all_allies", "ranged", 8, 3, "buff", S(st("atk_up", 100, 2), st("matk_up", 100, 2))), 10, 2, 0),
    E(a("ward_song", "บทเพลงคุ้มกัน", "all_allies", "ranged", 10, 4, "buff", S(st("def_up", 100, 3), st("mdef_up", 100, 3))), 10, 2, 1, [[id("war_song"), 3]]),
    E(a("healing_song", "เพลงฟื้นฟู", "all_allies", "ranged", 14, 4, "heal", H({ statuses: [st("mp_regen", 100, 2)] })), 10, 2, 2, [[id("ward_song"), 3]]),
    E(a("lullaby", "เพลงกล่อมหลับ", "enemy_row", "ranged", 12, 4, "debuff", S(st("sleep", 35, 2))), 5, 3, 0),
    E(a("dirge_of_weariness", "บทเพลงอ่อนล้า", "all_enemies", "ranged", 12, 4, "debuff", S(st("spd_down", 50, 2), st("res_down", 40, 2))), 10, 3, 1, [[id("lullaby"), 3]]),
    E(p("rhythm", "จังหวะเพลง", [{ on: "battle_start", then: [{ kind: "status", target: "allies", statuses: [st("accuracy_up", 100, 2)] }] }]), 1, 2, 3, [[id("war_song"), 1]]),
    E(p("echo", "เสียงก้อง", [{ on: "used_skill", chancePct: 25, then: [{ kind: "restore_mp", target: "self", amount: 5 }] }]), 1, 1, 3, [[id("shrill_note"), 1]]),
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
    E(a("wall", "กำแพงทั้งทีม", "all_allies", "ranged", 22, 4, "buff", S(st("shield", 100, 2, { shieldPct: 12 })), [tS("self", st("def_up", 100, 2))]), 10, 2, 0),
    E(a("stand_in", "ยืนแทนเพื่อน", "single_ally", "ranged", 16, 3, "buff", S(st("protect", 100, 2), st("def_up", 100, 2)), [tS("self", st("dmg_reduction", 100, 2))]), 10, 2, 1, [[id("wall"), 3]]),
    E(a("rampart_strike", "ปราการโต้", "enemy_row", "melee", 20, 4, "mixed", D("physical", { statuses: [st("taunt", 60, 2)] }), [tS("all_allies", st("shield", 100, 1, { shieldPct: 5 }))]), 10, 0, 0),
    E(a("holy_aegis", "โล่ศักดิ์สิทธิ์", "all_enemies", "ranged", 24, 4, "dmg", D("magic", { own: true }), [tS("all_allies", st("mdef_up", 100, 2))]), 10, 1, 0, [["skill:guardian_holy_light", 5]]),
    E(a("iron_fortress", "ป้อมเหล็กไหล", "self", "ranged", 30, 6, "buff", S(st("invincible", 100, 1)), [tS("all_allies", st("def_up", 100, 2))]), 5, 2, 2, [[id("stand_in"), 5]]),
    E(a("wall_press", "แรงกดกำแพง", "all_enemies", "ranged", 22, 4, "debuff", S(st("atk_down", 50, 2), st("taunt", 40, 1)), [tS("self", st("counter", 100, 1))]), 10, 3, 0),
    E(p("layers", "ปราการหลายชั้น", [{ on: "protected_ally", then: [{ kind: "status", target: "other", statuses: [st("shield", 100, 2, { shieldPct: 6 })] }] }], [{ kind: "guard_reduction", reductionPct: 10 }]), 1, 2, 3, [[id("wall"), 1]]),
    E(p("iron_will", "เกราะเหล็กใจ", [{ on: "took_damage", chancePct: 25, then: [{ kind: "status", target: "self", statuses: [st("def_up", 100, 1)] }] }]), 1, 3, 3, [[id("wall_press"), 1]]),
  ]),
  c2("sentinel", (a, p, id) => [
    E(a("stance", "ตั้งท่าสวน", "self", "ranged", 16, 3, "buff", S(st("counter", 100, 2), st("def_up", 100, 2))), 10, 2, 0),
    E(a("payback", "ฟาดคืน", "single_enemy", "melee", 20, 3, "mixed", D("physical", { riders: { penetrationPct: 20 }, statuses: [st("atk_down", 40, 2)] })), 10, 0, 0),
    E(a("line_riposte", "สวนกลับทั้งแนว", "enemy_row", "melee", 24, 4, "dmg", D("physical"), [tS("self", st("counter", 100, 1))]), 10, 0, 1, [[id("payback"), 3]]),
    E(a("ward_blade", "ดาบเวทป้องกัน", "single_enemy", "ranged", 18, 3, "dmg", D("magic", { own: true }), [tS("self", st("shield", 100, 2, { shieldPct: 10 }))]), 10, 1, 0, [["skill:guardian_holy_light", 5]]),
    E(a("watchful_eye", "สายตาผู้เฝ้า", "all_allies", "ranged", 22, 4, "buff", S(st("accuracy_up", 100, 2), st("crit_up", 100, 2)), [tS("all_enemies", st("evasion_down", 40, 2))]), 10, 2, 1, [[id("stance"), 3]]),
    E(a("hold_the_line", "ปักหลักต้านทัพ", "self", "ranged", 26, 5, "buff", S(st("endure", 100, 2), st("dmg_reduction", 100, 2)), [tS("all_enemies", st("taunt", 50, 1))]), 5, 3, 0, [[id("stance"), 5]]),
    E(p("riposte", "สวนกลับ", [{ on: "took_damage", chancePct: 25, then: [{ kind: "status", target: "self", statuses: [st("counter", 100, 1)] }] }]), 1, 2, 3, [[id("stance"), 1]]),
    E(p("warrior_focus", "สมาธินักรบ", [{ on: "hp_below", hpBelowPct: 50, oncePerBattle: true, then: [{ kind: "status", target: "self", statuses: [st("atk_up", 100, 2), st("focus", 100, 1)] }] }]), 1, 0, 3, [[id("payback"), 1]]),
  ]),
  c2("breaker", (a, p, id) => [
    E(a("shatter", "ทุบเกราะแตก", "single_enemy", "melee", 20, 3, "mixed", D("physical", { riders: { penetrationPct: 40 }, statuses: [st("def_down", 70, 3), st("vulnerable", 40, 2)] })), 10, 0, 0),
    E(a("wave", "คลื่นทลาย", "enemy_row", "melee", 24, 4, "mixed", D("physical", { riders: { penetrationPct: 25 }, statuses: [st("def_down", 40, 2)] })), 10, 0, 1, [[id("shatter"), 3]]),
    E(a("rear_breach", "ทะลวงแนวหลัง", "single_enemy", "ranged", 22, 4, "dmg", D("physical"), [tS("all_enemies", st("def_down", 30, 2))]), 10, 0, 2, [[id("wave"), 3]]),
    E(a("ward_breaker", "ปลดผนึกเกราะธาตุ", "single_enemy", "ranged", 20, 3, "mixed", D("magic", { own: true, statuses: [st("mdef_down", 60, 2)] }), [tS("all_allies", st("matk_up", 100, 1))]), 10, 1, 0, [["skill:striker_blade_wave", 5]]),
    E(a("open_gap", "เปิดช่องโหว่", "all_enemies", "ranged", 24, 4, "debuff", S(st("vulnerable", 40, 2), st("def_down", 40, 2)), [tS("all_allies", st("accuracy_up", 100, 2))]), 10, 3, 0),
    E(a("final_fist", "หมัดสุดท้าย", "single_enemy", "melee", 28, 5, "dmg", D("physical", { riders: { bonusVsStatus: { statusId: "def_down", bonusPct: 60, consume: true }, execute: { belowHpPct: 30, bonusPct: 60 } } })), 10, 0, 3, [[id("shatter"), 5]]),
    E(p("crack", "รอยร้าว", [{ on: "dealt_damage", action: "skill", chancePct: 25, then: [{ kind: "status", target: "other", statuses: [st("def_down", 60, 2)] }] }], [{ kind: "damage_vs_status", statusId: "def_down", bonusPct: 15 }]), 1, 3, 3, [[id("open_gap"), 1]]),
    E(p("relentless", "ทุบไม่ยั้ง", [{ on: "kill", then: [{ kind: "restore_mp", target: "self", amount: 8 }] }]), 1, 1, 3, [[id("shatter"), 1]]),
  ]),
  c2("berserker", (a, p, id) => [
    E(a("blood_slash", "ฟันเลือดเดือด", "single_enemy", "melee", 16, 3, "dmg", D("physical", { riders: { recoilPct: 12 } })), 10, 0, 0),
    E(a("fury", "โทสะ", "self", "ranged", 18, 5, "buff", S(st("rage", 100, 3, { stacks: 3 }), st("atk_up", 100, 3)), [tS("all_enemies", st("taunt", 40, 1))]), 10, 2, 0),
    E(a("blood_storm", "พายุโลหิต", "all_enemies", "melee", 26, 4, "dmg", D("physical", { riders: { recoilPct: 10, lifestealPct: 15 } })), 10, 0, 1, [[id("blood_slash"), 3]]),
    E(a("blood_flame", "เปลวเลือดธาตุ", "single_enemy", "ranged", 20, 3, "mixed", D("magic", { own: true, riders: { lifestealPct: 20 }, statuses: [st("burn", 30, 2)] })), 10, 1, 0, [["skill:striker_blade_wave", 5]]),
    E(a("mad_roar", "เสียงคำรามคลั่ง", "all_enemies", "ranged", 22, 4, "debuff", S(st("fear", 30, 1), st("def_down", 40, 2)), [tS("self", st("atk_up", 100, 2))]), 10, 3, 0),
    E(a("to_the_end", "ฟันจนกว่าจะตาย", "single_enemy", "melee", 28, 5, "dmg", D("physical", { riders: { execute: { belowHpPct: 40, bonusPct: 80 }, recoilPct: 15 } }), [tS("self", st("endure", 100, 1))]), 10, 0, 2, [[id("blood_storm"), 3]]),
    E(p("blood", "เลือดเดือด", [
      { on: "hp_below", hpBelowPct: 50, oncePerBattle: true, then: [{ kind: "status", target: "self", statuses: [st("rage", 100, 3, { stacks: 2 })] }] },
      { on: "kill", then: [{ kind: "heal", target: "self", pctMaxHp: 5 }] },
    ]), 1, 2, 3, [[id("fury"), 1]]),
    E(p("pain_is_power", "ความเจ็บคือพลัง", [{ on: "took_damage", chancePct: 30, then: [{ kind: "status", target: "self", statuses: [st("rage", 100, 2)] }] }]), 1, 0, 3, [[id("blood_slash"), 1]]),
  ]),
  c2("sharpshooter", (a, p, id) => [
    E(a("aim", "เล็งนิ่ง", "self", "ranged", 16, 3, "buff", S(st("focus", 100, 2), st("crit_up", 100, 2), st("atk_up", 100, 2))), 10, 2, 0),
    E(a("piercer", "ศรทะลวงเป้า", "single_enemy", "ranged", 24, 3, "dmg", D("physical", { riders: { penetrationPct: 30, accuracyBonusPct: 20, bonusVsStatus: { statusId: "mark", bonusPct: 40, consume: true } } })), 10, 0, 0),
    E(a("pin_shadow", "ศรตรึงเงา", "single_enemy", "ranged", 20, 3, "mixed", D("physical", { statuses: [st("root", 60, 2), st("mark", 60, 2)] })), 10, 0, 1, [[id("piercer"), 3]]),
    E(a("element_pierce", "ศรธาตุทะลวง", "single_enemy", "ranged", 22, 3, "mixed", D("magic", { own: true, statuses: [st("mdef_down", 50, 2)] }), [tS("self", st("focus", 100, 1))]), 10, 1, 0, [["skill:ranger_element_arrow", 5]]),
    E(a("deadly_volley", "ห่าธนูพิฆาต", "all_enemies", "ranged", 28, 4, "dmg", D("physical", { riders: { critBonusPct: 20 } }), [tS("self", st("accuracy_up", 100, 2))]), 10, 0, 2, [[id("pin_shadow"), 3]]),
    E(a("signal_mark", "สัญญาณหมายหัว", "all_enemies", "ranged", 20, 4, "debuff", S(st("mark", 60, 2)), [tS("all_allies", st("accuracy_up", 100, 2))]), 10, 3, 0),
    E(p("steady", "มือนิ่ง", [{ on: "kill", then: [{ kind: "status", target: "self", statuses: [st("focus", 100, 2)] }] }], [{ kind: "damage_vs_status", statusId: "mark", bonusPct: 10 }]), 1, 0, 3, [[id("piercer"), 1]]),
    E(p("calm_breath", "ลมหายใจนิ่ง", [{ on: "battle_start", then: [{ kind: "status", target: "self", statuses: [st("focus", 100, 1)] }] }]), 1, 2, 3, [[id("aim"), 1]]),
  ]),
  c2("trapper", (a, p, id) => [
    E(a("root_trap", "กับดักขาตรึง", "enemy_row", "ranged", 18, 3, "debuff", S(st("root", 70, 2), st("spd_down", 60, 2))), 10, 3, 0),
    E(a("spike_field", "ทุ่งกับดักหนาม", "all_enemies", "ranged", 26, 4, "mixed", D("physical", { statuses: [st("bleed", 40, 2)] })), 10, 0, 0),
    E(a("blast_trap", "กับดักระเบิด", "enemy_row", "ranged", 22, 4, "mixed", D("physical", { statuses: [st("knockback", 40, 1)] }), [tS("self", st("evasion_up", 100, 1))]), 10, 0, 1, [[id("spike_field"), 3]]),
    E(a("element_trap", "กับดักธาตุ", "all_enemies", "ranged", 24, 4, "mixed", D("magic", { own: true, statuses: [st("wet", 40, 2)] })), 10, 1, 0, [["skill:ranger_element_arrow", 5]]),
    E(a("capture_net", "ตาข่ายดักจับ", "single_enemy", "ranged", 18, 4, "debuff", S(st("root", 80, 2), st("spd_down", 60, 2), st("delay", 50, 1)), [tS("all_allies", st("spd_up", 100, 1))]), 10, 3, 1, [[id("root_trap"), 3]]),
    E(a("hide", "ซุ้มพราง", "all_allies", "ranged", 22, 5, "buff", S(st("evasion_up", 100, 2)), [tS("all_enemies", st("blind", 30, 2))]), 10, 2, 0),
    E(p("snare", "บ่วงซ่อน", [{ on: "took_damage", chancePct: 30, then: [{ kind: "status", target: "other", statuses: [st("spd_down", 60, 2)] }] }]), 1, 3, 3, [[id("root_trap"), 1]]),
    E(p("trap_smith", "ช่างกับดัก", [{ on: "used_skill", skillApplies: "root", then: [{ kind: "restore_mp", target: "self", amount: 6 }] }]), 1, 2, 3, [[id("hide"), 1]]),
  ]),
  c2("elementalist", (a, p, id) => [
    E(a("torrent", "สายน้ำซัด", "single_enemy", "ranged", 18, 2, "mixed", D("magic", { element: "WATER", statuses: [st("wet", 80, 2)] })), 10, 1, 0),
    E(a("thunder", "อัสนีปะทะ", "single_enemy", "ranged", 26, 3, "mixed", D("magic", { element: "WIND", riders: { bonusVsStatus: { statusId: "wet", bonusPct: 50, consume: true } }, statuses: [st("shock", 40, 2)] })), 10, 1, 1, [[id("torrent"), 3]]),
    E(a("element_storm", "พายุธาตุ", "all_enemies", "ranged", 28, 4, "dmg", D("magic", { own: true }), [tS("self", st("matk_up", 100, 2))]), 10, 1, 2, [[id("torrent"), 5]]),
    E(a("wild_flame", "เปลวเพลิงคลั่ง", "enemy_row", "ranged", 24, 4, "mixed", D("magic", { element: "FIRE", statuses: [st("burn", 50, 2)] })), 10, 3, 0),
    E(a("element_guard", "เกราะธาตุ", "all_allies", "ranged", 22, 4, "buff", S(st("mdef_up", 100, 2), st("res_up", 100, 2)), [tS("all_enemies", st("matk_down", 30, 2))]), 10, 2, 0),
    E(a("element_blade", "ดาบธาตุ", "single_enemy", "melee", 18, 3, "dmg", D("physical", { own: true }), [tS("self", st("matk_up", 100, 1))]), 10, 0, 0),
    E(p("attune", "ประสานธาตุ", [{ on: "used_skill", chancePct: 30, then: [{ kind: "restore_mp", target: "self", amount: 6 }] }], [{ kind: "damage_vs_status", statusId: "wet", bonusPct: 15 }]), 1, 1, 3, [[id("torrent"), 1]]),
    E(p("fuse", "หลอมธาตุ", [], [{ kind: "damage_vs_status", statusId: "burn", bonusPct: 15 }]), 1, 3, 3, [[id("wild_flame"), 1]]),
  ]),
  c2("spellweaver", (a, p, id) => [
    E(a("thread", "ถักเวทรอบหน้า", "self", "ranged", 16, 3, "buff", S(st("focus", 100, 2), st("matk_up", 100, 2))), 10, 2, 0),
    E(a("star_net", "ตาข่ายดารา", "all_enemies", "ranged", 28, 4, "mixed", D("magic", { own: true, statuses: [st("mp_cost_up", 40, 2)] }), [tS("all_allies", st("mp_regen", 100, 1))]), 10, 1, 0),
    E(a("delay_spell", "เวทล่าช้า", "single_enemy", "ranged", 20, 3, "mixed", D("magic", { own: true, statuses: [st("delay", 60, 1)] }), [tS("self", st("focus", 100, 1))]), 10, 1, 1, [[id("star_net"), 3]]),
    E(a("binding_thread", "ด้ายผนึก", "single_enemy", "ranged", 18, 4, "debuff", S(st("skill_lock", 50, 2), st("seal", 40, 2))), 10, 3, 0),
    E(a("star_weave", "ทอเกราะดารา", "all_allies", "ranged", 24, 4, "buff", S(st("shield", 100, 2, { shieldPct: 10 }), st("mdef_up", 100, 2)), [tS("all_enemies", st("matk_down", 40, 2))]), 10, 2, 1, [[id("thread"), 3]]),
    E(a("needle", "เข็มถักแทง", "single_enemy", "ranged", 16, 3, "mixed", D("physical", { riders: { penetrationPct: 20 }, statuses: [st("skill_lock", 25, 1)] })), 10, 0, 0),
    E(p("loom", "กี่ทอเวท", [
      { on: "battle_start", then: [{ kind: "status", target: "self", statuses: [st("mp_regen", 100, 3)] }] },
      { on: "used_skill", chancePct: 25, then: [{ kind: "status", target: "self", statuses: [st("focus", 100, 1)] }] },
    ]), 1, 2, 3, [[id("thread"), 1]]),
    E(p("endless_weave", "ทอต่อเนื่อง", [{ on: "used_skill", chancePct: 30, then: [{ kind: "restore_mp", target: "self", amount: 5 }] }]), 1, 1, 3, [[id("star_net"), 1]]),
  ]),
  c2("lifekeeper", (a, p, id) => [
    E(a("rain", "ฝนชีวา", "all_allies", "ranged", 26, 4, "heal", H({ statuses: [st("regen", 100, 1)] })), 10, 2, 0),
    E(a("stream", "สายธารรักษา", "single_ally", "ranged", 18, 2, "heal", H({ flat: 20 })), 10, 2, 1),
    E(a("leaf_guard", "ใบไม้พิทักษ์", "single_ally", "ranged", 18, 3, "buff", S(st("shield", 100, 2, { shieldPct: 12 }), st("regen", 100, 2)), [tS("self", st("mp_regen", 100, 2))]), 10, 2, 2, [[id("stream"), 3]]),
    E(a("life_light", "แสงชีวิตลงทัณฑ์", "single_enemy", "ranged", 20, 3, "dmg", D("magic", { own: true }), [tH("lowest_ally", 0.4)]), 10, 1, 0, [["skill:warden_holy_spark", 5]]),
    E(a("thorn_lash", "กิ่งหนามชำระ", "enemy_row", "melee", 22, 4, "dmg", D("physical"), [tS("all_allies", st("regen", 100, 1))]), 10, 0, 0),
    E(a("renewal", "ห้วงฟื้นฟู", "all_allies", "ranged", 26, 5, "buff", S(st("cleanse", 100, 1), st("res_up", 100, 2)), [tS("all_enemies", st("anti_heal", 40, 2))]), 10, 3, 0, [[id("rain"), 3]]),
    E(p("wellspring", "ธารชีวิต", [{ on: "turn_end", then: [{ kind: "heal", target: "lowest_ally", pctMaxHp: 4 }] }], [{ kind: "heal_low_hp", belowHpPct: 50, bonusPct: 15 }]), 1, 2, 3, [[id("rain"), 1]]),
    E(p("deep_roots", "รากลึก", [{ on: "hp_below", hpBelowPct: 40, oncePerBattle: true, then: [{ kind: "status", target: "self", statuses: [st("regen", 100, 3)] }] }]), 1, 0, 3, [[id("thorn_lash"), 1]]),
  ]),
  c2("spiritkeeper", (a, p, id) => [
    E(a("ward", "ดวงวิญญาณคุ้มภัย", "single_ally", "ranged", 18, 4, "buff", S(st("endure", 100, 2), st("res_up", 100, 2))), 10, 2, 0),
    E(a("recall", "เรียกวิญญาณคืน", "single_ally", "ranged", 34, 5, "heal", R(45)), 5, 2, 1, [[id("ward"), 3]]),
    E(a("soul_pact", "พันธะวิญญาณ", "all_allies", "ranged", 26, 5, "buff", S(st("endure", 50, 1), st("res_up", 100, 2))), 10, 2, 2, [[id("ward"), 5]]),
    E(a("spirit_flame", "เพลิงวิญญาณ", "single_enemy", "ranged", 20, 3, "mixed", D("magic", { own: true, statuses: [st("mana_burn", 50, 2)] }), [tH("lowest_ally", 0.3)]), 10, 1, 0, [["skill:warden_holy_spark", 5]]),
    E(a("spirit_staff", "ไม้เท้าขับวิญญาณ", "single_enemy", "melee", 18, 3, "mixed", D("physical", { statuses: [st("fear", 30, 1)] }), [tS("lowest_ally", st("shield", 100, 2, { shieldPct: 8 }))]), 10, 0, 0),
    E(a("spirit_veil", "ม่านวิญญาณ", "all_enemies", "ranged", 24, 4, "debuff", S(st("atk_down", 50, 2), st("matk_down", 50, 2)), [tS("all_allies", st("dmg_reduction", 100, 1))]), 10, 3, 0),
    E(p("vigil", "เฝ้าดวงวิญญาณ", [{ on: "ally_down", oncePerBattle: true, then: [{ kind: "status", target: "allies", statuses: [st("endure", 100, 1)] }] }]), 1, 2, 3, [[id("ward"), 1]]),
    E(p("guiding_spirit", "วิญญาณนำทาง", [{ on: "ally_down", then: [{ kind: "restore_mp", target: "self", amount: 10 }] }]), 1, 3, 3, [[id("spirit_veil"), 1]]),
  ]),
  c2("beast_marshal", (a, p, id) => [
    E(a("charge", "สั่งบุก", "single_ally", "ranged", 16, 3, "buff", S(st("advance", 100, 1), st("atk_up", 100, 2))), 10, 2, 0),
    E(a("pack", "จู่โจมพร้อมกัน", "all_allies", "ranged", 26, 4, "buff", S(st("atk_up", 100, 2), st("matk_up", 100, 2), st("accuracy_up", 100, 2))), 10, 2, 1, [[id("charge"), 3]]),
    E(a("maul", "รุมขย้ำ", "single_enemy", "melee", 20, 3, "mixed", D("physical", { statuses: [st("vulnerable", 40, 2)] }), [tS("all_allies", st("atk_up", 100, 1))]), 10, 0, 0),
    E(a("element_roar", "คำรามธาตุ", "all_enemies", "ranged", 26, 4, "mixed", D("magic", { own: true, statuses: [st("fear", 20, 1)] })), 10, 1, 0, [["skill:binder_bond_pulse", 5]]),
    E(a("tactics", "สั่งถอยสั่งรุก", "all_allies", "ranged", 24, 5, "buff", S(st("spd_up", 100, 2)), [tS("all_enemies", st("delay", 30, 1))]), 10, 2, 2, [[id("pack"), 3]]),
    E(a("encircle", "ล้อมกรอบ", "all_enemies", "ranged", 22, 4, "debuff", S(st("mark", 60, 2), st("def_down", 40, 2)), [tS("all_allies", st("accuracy_up", 100, 1))]), 10, 3, 0),
    E(p("command", "เสียงบัญชาการ", [
      { on: "battle_start", then: [{ kind: "status", target: "allies", statuses: [st("spd_up", 100, 1)] }] },
      { on: "used_skill", skillApplies: "advance", then: [{ kind: "restore_mp", target: "self", amount: 6 }] },
    ]), 1, 2, 3, [[id("charge"), 1]]),
    E(p("one_pack", "ฝูงเดียวกัน", [{ on: "kill", then: [{ kind: "status", target: "allies", statuses: [st("spd_up", 100, 1)] }] }]), 1, 0, 3, [[id("maul"), 1]]),
  ]),
  c2("soul_linker", (a, p, id) => [
    E(a("share", "สายใยแบ่งปัน", "all_allies", "ranged", 22, 4, "buff", S(st("shield", 100, 2, { shieldPct: 8 }), st("def_up", 100, 2))), 10, 2, 0),
    E(a("bind", "ผูกวิญญาณศัตรู", "all_enemies", "ranged", 24, 4, "debuff", S(st("link", 50, 2)), [tS("lowest_ally", st("shield", 100, 2, { shieldPct: 10 }))]), 10, 3, 0),
    E(a("life_drain", "ดึงพลังชีวิต", "single_enemy", "ranged", 20, 3, "dmg", D("magic", { own: true, riders: { lifestealPct: 30 } }), [tH("lowest_ally", 0.3)]), 10, 1, 0, [["skill:binder_bond_pulse", 5]]),
    E(a("soul_lash", "สายรัดวิญญาณ", "single_enemy", "melee", 20, 3, "mixed", D("physical", { statuses: [st("root", 50, 2), st("link", 50, 2)] })), 10, 0, 0),
    E(a("merge", "หลอมรวมใจ", "all_allies", "ranged", 26, 5, "buff", S(st("regen", 100, 2), st("res_up", 100, 2)), [tS("all_enemies", st("leech", 40, 2))]), 10, 2, 1, [[id("share"), 3]]),
    E(a("transfer", "ส่งต่อพลัง", "single_ally", "ranged", 18, 3, "heal", H({ restoreMp: 20 })), 10, 2, 2, [[id("share"), 5]]),
    E(p("thread", "ด้ายวิญญาณ", [{ on: "took_damage", chancePct: 30, then: [{ kind: "heal", target: "lowest_ally", pctMaxHp: 3 }] }]), 1, 2, 3, [[id("share"), 1]]),
    E(p("heart_to_heart", "ใจถึงใจ", [{ on: "protected_ally", then: [{ kind: "restore_mp", target: "self", amount: 4 }] }]), 1, 3, 3, [[id("bind"), 1]]),
  ]),
  c2("assassin", (a, p, id) => [
    E(a("shadow_strike", "จู่โจมจากเงา", "single_enemy", "ranged", 20, 3, "dmg", D("physical", { riders: { critBonusPct: 30, accuracyBonusPct: 15 } }), [tS("self", st("evasion_up", 100, 1))]), 10, 0, 0),
    E(a("death_mark", "ตราจุดตาย", "single_enemy", "melee", 18, 3, "mixed", D("physical", { statuses: [st("vulnerable", 60, 2), st("mark", 70, 2)] }), [tS("all_allies", st("crit_up", 100, 1))]), 10, 3, 0),
    E(a("thousand_edges", "เงาพันคม", "enemy_row", "melee", 24, 4, "mixed", D("physical", { statuses: [st("bleed", 40, 2)] }), [tS("self", st("stealth", 100, 1))]), 10, 0, 1, [[id("shadow_strike"), 3]]),
    E(a("venom_blade", "มีดอาบพิษธาตุ", "single_enemy", "ranged", 20, 3, "mixed", D("magic", { own: true, statuses: [st("toxic", 50, 3)] })), 10, 1, 0, [["skill:rogue_shade_knife", 5]]),
    E(a("lurk", "ลอบเร้นสังหาร", "self", "ranged", 18, 4, "buff", S(st("stealth", 100, 1), st("crit_up", 100, 2), st("focus", 100, 2))), 10, 2, 0),
    E(a("reap", "ปลิดวิญญาณ", "single_enemy", "melee", 28, 5, "dmg", D("physical", { riders: { execute: { belowHpPct: 30, bonusPct: 120 }, bonusVsStatus: { statusId: "vulnerable", bonusPct: 30, consume: true } } })), 10, 0, 2, [[id("thousand_edges"), 3]]),
    E(p("vanish", "หายลับ", [{ on: "kill", then: [{ kind: "status", target: "self", statuses: [st("stealth", 100, 1)] }] }], [{ kind: "damage_vs_status", statusId: "vulnerable", bonusPct: 15 }]), 1, 2, 3, [[id("lurk"), 1]]),
    E(p("prey", "ล่าเหยื่อ", [], [{ kind: "damage_vs_status", statusId: "mark", bonusPct: 10 }]), 1, 3, 3, [[id("death_mark"), 1]]),
  ]),
  c2("saboteur", (a, p, id) => [
    E(a("unravel", "ปลดบัฟ", "single_enemy", "ranged", 18, 3, "mixed", D("magic", { own: true, statuses: [st("dispel", 80, 1), st("unbuffable", 50, 2)] })), 10, 3, 0),
    E(a("flashbang", "ระเบิดก่อกวน", "all_enemies", "ranged", 24, 4, "mixed", D("physical", { statuses: [st("blind", 35, 2)] }), [tS("self", st("evasion_up", 100, 1))]), 10, 0, 0),
    E(a("polarity", "กลับขั้ว", "single_enemy", "ranged", 22, 4, "mixed", D("magic", { own: true, statuses: [st("invert", 60, 1)] }), [tS("self", st("evasion_up", 100, 2))]), 10, 3, 1, [[id("unravel"), 3]]),
    E(a("chaos_burst", "ระเบิดเวทป่วน", "enemy_row", "ranged", 22, 4, "mixed", D("magic", { own: true, statuses: [st("mp_cost_up", 50, 2)] })), 10, 1, 0, [["skill:rogue_shade_knife", 5]]),
    E(a("siphon", "ขโมยพลัง", "single_enemy", "ranged", 20, 4, "debuff", S(st("steal_buff", 70, 1)), [tS("all_allies", st("accuracy_up", 100, 2))]), 10, 3, 2, [[id("unravel"), 5]]),
    E(a("time_mine", "ทุ่นระเบิดเวลา", "all_enemies", "ranged", 26, 5, "mixed", D("physical", { statuses: [st("delay", 40, 1), st("seal", 30, 2)] })), 10, 0, 1, [[id("flashbang"), 3]]),
    E(p("meddle", "มือป่วน", [{ on: "dealt_damage", action: "skill", chancePct: 25, then: [{ kind: "status", target: "other", statuses: [st("dispel", 50, 1)] }] }]), 1, 3, 3, [[id("unravel"), 1]]),
    E(p("slip_away", "ป่วนแล้วหนี", [{ on: "debuffed", then: [{ kind: "status", target: "self", statuses: [st("evasion_up", 100, 1)] }] }]), 1, 0, 3, [[id("flashbang"), 1]]),
  ]),
  c2("apothecary", (a, p, id) => [
    E(a("purge", "โอสถชำระ", "all_allies", "ranged", 26, 4, "heal", H({ statuses: [st("cleanse", 100, 1)] })), 10, 2, 0),
    E(a("tonic", "ยาฟื้นพลัง", "single_ally", "ranged", 18, 3, "heal", H({ flat: 15, restoreMp: 15 })), 10, 2, 1),
    E(a("rally_draught", "ยาฮึกเหิม", "all_allies", "ranged", 24, 4, "buff", S(st("atk_up", 100, 1), st("matk_up", 100, 1)), [tH("lowest_ally", 0.25)]), 10, 2, 2, [[id("tonic"), 3]]),
    E(a("venom_vial", "ขวดพิษเข้มข้น", "single_enemy", "ranged", 20, 3, "mixed", D("magic", { own: true, statuses: [st("toxic", 60, 3), st("anti_heal", 50, 2)] }), [tH("lowest_ally", 0.2)]), 10, 1, 0, [["skill:alchemist_element_flask", 5]]),
    E(a("sleep_bomb", "ระเบิดยาสลบ", "enemy_row", "ranged", 22, 4, "mixed", D("physical", { statuses: [st("sleep", 30, 1)] }), [tS("all_allies", st("res_up", 100, 2))]), 10, 0, 0),
    E(a("antidote", "ยาภูมิคุ้มกัน", "single_ally", "ranged", 20, 4, "buff", S(st("immunity", 100, 2), st("regen", 100, 2))), 10, 3, 0, [[id("purge"), 3]]),
    E(p("dose", "ปรุงเสริมฤทธิ์", [{ on: "used_item", then: [{ kind: "heal", target: "other", pctMaxHp: 5 }] }]), 1, 2, 3, [[id("tonic"), 1]]),
    E(p("pharmacist", "เภสัชกร", [], [{ kind: "heal_low_hp", belowHpPct: 40, bonusPct: 15 }]), 1, 3, 3, [[id("purge"), 1]]),
  ]),
  c2("transmuter", (a, p, id) => [
    E(a("oil", "ราดน้ำมัน", "enemy_row", "ranged", 18, 3, "debuff", S(st("oil", 80, 3), st("spd_down", 40, 2))), 10, 3, 0),
    E(a("ignite", "แปรธาตุลุกไหม้", "enemy_row", "ranged", 26, 4, "mixed", D("magic", { element: "FIRE", riders: { bonusVsStatus: { statusId: "oil", bonusPct: 40, consume: true } }, statuses: [st("burn", 50, 2)] })), 10, 1, 0, [["skill:alchemist_element_flask", 5]]),
    E(a("reform_armor", "แปรสภาพเกราะ", "all_allies", "ranged", 24, 4, "buff", S(st("def_up", 100, 2), st("mdef_up", 100, 2)), [tS("all_enemies", st("def_down", 30, 2))]), 10, 2, 0),
    E(a("metal_acid", "กรดสลายโลหะ", "single_enemy", "ranged", 20, 3, "mixed", D("physical", { riders: { penetrationPct: 40 }, statuses: [st("corrode", 60, 3)] }), [tS("self", st("def_up", 100, 2))]), 10, 0, 0),
    E(a("chain", "ปฏิกิริยาลูกโซ่", "all_enemies", "ranged", 28, 4, "mixed", D("magic", { own: true, statuses: [st("wet", 40, 2)] })), 10, 1, 1, [[id("ignite"), 3]]),
    E(a("stone", "ศิลาแปรธาตุ", "single_enemy", "ranged", 24, 5, "debuff", S(st("petrify", 30, 1)), [tS("self", st("shield", 100, 2, { shieldPct: 10 }))]), 10, 3, 1, [[id("oil"), 3]]),
    E(p("catalyst", "ตัวเร่งปฏิกิริยา", [{ on: "dealt_damage", action: "skill", chancePct: 25, then: [{ kind: "status", target: "other", statuses: [st("corrode", 50, 2)] }] }], [{ kind: "damage_vs_status", statusId: "oil", bonusPct: 20 }]), 1, 3, 3, [[id("oil"), 1]]),
    E(p("reshaper", "นักแปรสภาพ", [{ on: "used_item", then: [{ kind: "status", target: "self", statuses: [st("matk_up", 100, 1)] }] }]), 1, 2, 3, [[id("reform_armor"), 1]]),
  ]),
  c2("minstrel", (a, p, id) => [
    E(a("anthem", "บทเพลงหลัก", "all_allies", "ranged", 28, 5, "buff", S(st("atk_up", 100, 3), st("matk_up", 100, 3), st("spd_up", 100, 3))), 10, 2, 0),
    E(a("refrain", "เพลงฟื้นใจ", "all_allies", "ranged", 24, 4, "heal", H({ statuses: [st("mp_regen", 100, 3)] })), 10, 2, 1, [[id("anthem"), 3]]),
    E(a("sword_dance", "ระบำดาบ", "enemy_row", "melee", 22, 4, "dmg", D("physical"), [tS("all_allies", st("evasion_up", 100, 1))]), 10, 0, 0),
    E(a("element_tune", "ทำนองธาตุ", "all_enemies", "ranged", 26, 4, "dmg", D("magic", { own: true }), [tS("all_allies", st("matk_up", 100, 1))]), 10, 1, 0, [["skill:bard_shrill_note", 5]]),
    E(a("stirring", "บทเพลงเร่งเร้า", "single_ally", "ranged", 16, 3, "buff", S(st("advance", 100, 1), st("spd_up", 100, 2))), 10, 2, 2, [[id("anthem"), 5]]),
    E(a("banishing_song", "เพลงขับไล่", "all_enemies", "ranged", 24, 4, "debuff", S(st("dispel", 40, 1), st("atk_down", 40, 2)), [tS("all_allies", st("res_up", 100, 1))]), 10, 3, 0),
    E(p("tempo", "จังหวะนำ", [
      { on: "battle_start", then: [{ kind: "status", target: "allies", statuses: [st("spd_up", 100, 1)] }] },
      { on: "used_skill", chancePct: 25, then: [{ kind: "restore_mp", target: "self", amount: 5 }] },
    ]), 1, 2, 3, [[id("anthem"), 1]]),
    E(p("harmony", "เสียงประสาน", [{ on: "used_skill", chancePct: 25, then: [{ kind: "status", target: "allies", statuses: [st("accuracy_up", 100, 1)] }] }]), 1, 1, 3, [[id("element_tune"), 1]]),
  ]),
  c2("dirgesinger", (a, p, id) => [
    E(a("weight", "บทโศกกดดัน", "all_enemies", "ranged", 26, 4, "debuff", S(st("atk_down", 60, 2), st("matk_down", 60, 2), st("fear", 25, 1))), 10, 3, 0),
    E(a("last_verse", "ท่อนสุดท้าย", "single_enemy", "ranged", 24, 3, "dmg", D("magic", { element: "SHADOW", riders: { execute: { belowHpPct: 40, bonusPct: 50 } } }), [tS("self", st("mp_regen", 100, 2))]), 10, 1, 0, [["skill:bard_shrill_note", 5]]),
    E(a("lament_song", "เพลงคร่ำครวญ", "all_enemies", "ranged", 28, 4, "mixed", D("magic", { own: true, statuses: [st("res_down", 40, 2)] })), 10, 1, 1, [[id("last_verse"), 3]]),
    E(a("sorrow_blade", "ดาบบทโศก", "single_enemy", "melee", 20, 3, "mixed", D("physical", { statuses: [st("fear", 30, 1)] }), [tS("all_enemies", st("spd_down", 30, 1))]), 10, 0, 0),
    E(a("death_song", "เพลงสาปมรณะ", "single_enemy", "ranged", 26, 6, "debuff", S(st("doom", 25, 3), st("mark", 60, 2))), 5, 3, 1, [[id("weight"), 5]]),
    E(a("eclipse", "บทเพลงอุปราคา", "all_allies", "ranged", 24, 5, "buff", S(st("matk_up", 100, 2), st("res_up", 100, 2)), [tS("all_enemies", st("blind", 30, 2))]), 10, 2, 0),
    E(p("lament", "บทคร่ำครวญ", [{ on: "dealt_damage", action: "skill", chancePct: 30, then: [{ kind: "status", target: "other", statuses: [st("res_down", 40, 2)] }] }], [{ kind: "damage_vs_status", statusId: "fear", bonusPct: 15 }]), 1, 3, 3, [[id("weight"), 1]]),
    E(p("from_darkness", "เสียงจากความมืด", [{ on: "debuffed", then: [{ kind: "status", target: "self", statuses: [st("matk_up", 100, 1)] }] }]), 1, 2, 3, [[id("eclipse"), 1]]),
  ]),
];

const CLASS1 = [guardian(), striker(), ranger(), arcanist(), warden(), binder(), rogue(), alchemist(), bard()];

export const SKILL_TREES: ReadonlyMap<string, SkillTree> = new Map([...CLASS1, ...CLASS2].map((b) => [b.tree.id, b.tree]));
export const TREE_SKILLS: SkillDefinition[] = [...CLASS1, ...CLASS2].flatMap((b) => b.skills);
export const TREE_PASSIVE_IDS: ReadonlySet<string> = new Set(TREE_SKILLS.filter((s) => s.kind === "passive").map((s) => s.id));
