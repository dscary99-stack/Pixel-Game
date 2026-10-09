/**
 * EXAMPLE Class1 kits and race passives (chapter 02, P16 draft; Nut 2026-10-09 "ต่อครับ" after the
 * list of systems still missing). Each Class1 has a class passive and four actives that open by
 * character level; each race has one small passive, always weaker than the class core and never
 * touching EXP, drops or capture (chapter 02). Every effect is a primitive the kernel already runs.
 * Names, numbers and unlock levels are drafts for Nut to review (STATUS A141).
 */
import { z } from "zod";
import { PassiveSchema, PassiveTriggerSchema, type DamageEffect, type Element, type PassiveModifier, type SkillDefinition, type StatusApplication } from "../schemas";

type HealEffect = Extract<SkillDefinition["effectSequence"][number], { kind: "heal" }>;

const meta = { version: 1, status: "draft", example: true } as const;
type Target = SkillDefinition["targetRule"];
type Range = SkillDefinition["range"];

function active(id: string, th: string, targetRule: Target, range: Range, mpCost: number, cooldown: number, effectSequence: SkillDefinition["effectSequence"]): SkillDefinition {
  return { id, ...meta, name: { th }, kind: "active", ownerKind: "player", targetRule, range, mpCost, cooldown, effectSequence, tags: ["class"] };
}

function hit(
  id: string,
  th: string,
  damageType: "physical" | "magic",
  coefficient: number,
  range: Range,
  mpCost: number,
  cooldown: number,
  extra: Partial<Omit<DamageEffect, "kind" | "damageType" | "coefficient" | "flat" | "element">> & { element?: Element; targetRule?: Target } = {},
): SkillDefinition {
  const { element = "NEUTRAL", targetRule = "single_enemy", ...primitives } = extra;
  return active(id, th, targetRule, range, mpCost, cooldown, [{ kind: "damage", damageType, coefficient, flat: 0, element, ...primitives }]);
}

const st = (statusId: StatusApplication["statusId"], chancePct: number, turns: number, more: Partial<StatusApplication> = {}): StatusApplication => ({ statusId, chancePct, turns, ...more });

function statuses(id: string, th: string, targetRule: Target, mpCost: number, cooldown: number, list: StatusApplication[]): SkillDefinition {
  return active(id, th, targetRule, "ranged", mpCost, cooldown, [{ kind: "status", statuses: list }]);
}

function mend(id: string, th: string, targetRule: Target, mpCost: number, cooldown: number, coefficient: number, flat: number, more: Partial<Omit<HealEffect, "kind" | "coefficient" | "flat">> = {}): SkillDefinition {
  return active(id, th, targetRule, "ranged", mpCost, cooldown, [{ kind: "heal", coefficient, flat, ...more }]);
}

function passive(id: string, th: string, triggers: z.input<typeof PassiveTriggerSchema>[], modifiers: PassiveModifier[] = []): SkillDefinition {
  return {
    id,
    ...meta,
    name: { th },
    kind: "passive",
    ownerKind: "player",
    targetRule: "none",
    range: "melee",
    mpCost: 0,
    cooldown: 0,
    effectSequence: [],
    tags: ["class"],
    passive: PassiveSchema.parse({ triggers, modifiers }),
  };
}

export const PLAYER_CLASS_SKILLS: SkillDefinition[] = [
  // ผู้พิทักษ์ Guardian: holds the line, takes hits for the team, shields.
  passive("skill:guardian_heart", "ใจผู้พิทักษ์", [{ on: "protected_ally", then: [{ kind: "restore_mp", target: "self", amount: 4 }] }], [{ kind: "guard_reduction", reductionPct: 15 }]),
  hit("skill:guardian_shield_bash", "กระแทกโล่", "physical", 1.2, "melee", 5, 2, { statuses: [st("stun", 20, 1)] }),
  statuses("skill:guardian_provoke", "ยั่วยุทั้งแถว", "enemy_row", 6, 3, [st("taunt", 70, 2)]),
  statuses("skill:guardian_cover", "โล่คุ้มภัย", "single_ally", 8, 3, [st("shield", 100, 2, { shieldPct: 15 })]),
  statuses("skill:guardian_bulwark", "ป้อมปราการ", "self", 10, 4, [st("def_up", 100, 3), st("mdef_up", 100, 3), st("dmg_reduction", 100, 2)]),

  // นักรบ Striker: raw damage, armour breaking, risk for reward.
  passive("skill:striker_fighting_blood", "เลือดนักสู้", [
    { on: "hp_below", hpBelowPct: 40, oncePerBattle: true, then: [{ kind: "status", target: "self", statuses: [st("atk_up", 100, 2)] }] },
    { on: "kill", then: [{ kind: "restore_mp", target: "self", amount: 4 }] },
  ]),
  hit("skill:striker_heavy_slash", "ฟันหนัก", "physical", 1.6, "melee", 6, 2),
  hit("skill:striker_cleave", "กวาดแถว", "physical", 0.75, "melee", 8, 3, { targetRule: "enemy_row" }),
  hit("skill:striker_armor_break", "ทลายเกราะ", "physical", 1.3, "melee", 8, 3, { penetrationPct: 30, statuses: [st("def_down", 50, 2)] }),
  hit("skill:striker_all_in", "พุ่งเดิมพัน", "physical", 2.3, "melee", 12, 4, { recoilPct: 15 }),

  // นักล่า Ranger: marks one target and picks it off from range.
  passive("skill:ranger_hunter_eye", "สายตานักล่า", [], [{ kind: "damage_vs_status", statusId: "mark", bonusPct: 15 }]),
  hit("skill:ranger_marking_shot", "ยิงติดเป้า", "physical", 1.1, "ranged", 5, 2, { accuracyBonusPct: 10, statuses: [st("mark", 80, 2)] }),
  hit("skill:ranger_arrow_rain", "ฝนลูกธนู", "physical", 0.6, "ranged", 10, 3, { targetRule: "all_enemies" }),
  hit("skill:ranger_vital_shot", "ยิงจุดตาย", "physical", 1.5, "ranged", 8, 3, { critBonusPct: 20 }),
  hit("skill:ranger_finisher", "ศรปลิดชีพ", "physical", 1.4, "ranged", 12, 4, { execute: { belowHpPct: 35, bonusPct: 70 } }),

  // จอมเวท Arcanist: spells by element, area damage, silencing.
  passive("skill:arcanist_mana_flow", "กระแสมานา", [{ on: "used_skill", chancePct: 30, then: [{ kind: "restore_mp", target: "self", amount: 4 }] }]),
  hit("skill:arcanist_arcane_bolt", "ลูกพลังเวท", "magic", 1.4, "ranged", 6, 2),
  hit("skill:arcanist_storm", "พายุเวท", "magic", 0.7, "ranged", 12, 3, { targetRule: "all_enemies" }),
  hit("skill:arcanist_flame_lick", "เปลวเพลิงลามเลีย", "magic", 1.2, "ranged", 9, 3, { element: "FIRE", statuses: [st("burn", 50, 3)] }),
  hit("skill:arcanist_seal", "ผนึกเวท", "magic", 1.0, "ranged", 10, 4, { statuses: [st("silence", 40, 2)] }),

  // ผู้เยียวยา Warden: heals, cleanses, brings the fallen back.
  passive("skill:warden_grace", "พรแห่งการเยียวยา", [], [{ kind: "heal_low_hp", belowHpPct: 40, bonusPct: 25 }]),
  mend("skill:warden_mend", "รักษา", "single_ally", 6, 2, 1.2, 10),
  mend("skill:warden_soothing_wind", "ลมเยียวยา", "all_allies", 12, 3, 0.6, 5),
  statuses("skill:warden_purify", "ชำระล้าง", "single_ally", 8, 3, [st("cleanse", 100, 1), st("res_up", 100, 2)]),
  // Revive (O15): the existing ปลุกขวัญ.

  // ผู้ประสานคู่ใจ Binder: sets up targets and lifts the companions.
  passive("skill:binder_bond_link", "สายใยคู่ใจ", [{ on: "ally_down", then: [{ kind: "status", target: "allies", statuses: [st("atk_up", 100, 2)] }] }]),
  hit("skill:binder_joint_strike", "ตีประสาน", "physical", 1.1, "melee", 5, 2, { statuses: [st("mark", 60, 2)] }),
  statuses("skill:binder_rouse", "ปลุกพลังคู่ใจ", "all_allies", 10, 4, [st("atk_up", 100, 3), st("matk_up", 100, 3)]),
  statuses("skill:binder_quicken", "เร่งจังหวะ", "single_ally", 8, 4, [st("advance", 100, 1), st("spd_up", 100, 2)]),
  statuses("skill:binder_bond_guard", "ผูกพันคุ้มภัย", "all_allies", 12, 4, [st("shield", 100, 2, { shieldPct: 10 })]),

  // นักลอบเร้น Rogue: bleeds, hides, finishes the weak.
  passive("skill:rogue_opportunist", "ฉวยโอกาส", [], [{ kind: "damage_vs_status", statusId: "bleed", bonusPct: 20 }]),
  hit("skill:rogue_bleeding_stab", "แทงเลือดไหล", "physical", 1.0, "melee", 5, 2, { statuses: [st("bleed", 60, 3)] }),
  statuses("skill:rogue_shadow_veil", "ซ่อนเงา", "self", 6, 4, [st("stealth", 100, 1), st("crit_up", 100, 2)]),
  hit("skill:rogue_shadow_blade", "ปาดาบเงา", "physical", 1.6, "ranged", 8, 3, { critBonusPct: 25, accuracyBonusPct: 10 }),
  hit("skill:rogue_throat_cut", "ปาดคอ", "physical", 1.5, "melee", 12, 4, { execute: { belowHpPct: 30, bonusPct: 100 } }),

  // นักปรุงแปรธาตุ Alchemist: acids, poisons and quick remedies.
  passive("skill:alchemist_brewer", "มือปรุงชำนาญ", [{ on: "used_item", then: [{ kind: "restore_mp", target: "self", amount: 5 }] }]),
  hit("skill:alchemist_acid_flask", "ขวดกรด", "magic", 1.0, "ranged", 5, 2, { statuses: [st("corrode", 50, 3)] }),
  hit("skill:alchemist_flask_burst", "ระเบิดขวด", "magic", 0.7, "ranged", 10, 3, { targetRule: "enemy_row", statuses: [st("poison", 30, 3)] }),
  mend("skill:alchemist_quick_remedy", "โอสถเร่งด่วน", "single_ally", 8, 3, 1.0, 15, { statuses: [st("regen", 100, 3)] }),
  statuses("skill:alchemist_toxic_cloud", "ควันพิษ", "all_enemies", 12, 4, [st("poison", 45, 3), st("anti_heal", 40, 2)]),

  // นักขับขาน Bard: songs for the team, disruption for the enemy.
  passive("skill:bard_rhythm", "จังหวะเพลง", [{ on: "battle_start", then: [{ kind: "status", target: "allies", statuses: [st("accuracy_up", 100, 2)] }] }]),
  statuses("skill:bard_war_song", "เพลงปลุกใจ", "all_allies", 8, 3, [st("atk_up", 100, 2)]),
  hit("skill:bard_shrill_note", "เสียงแหลมบาดหู", "magic", 1.1, "ranged", 6, 2, { statuses: [st("fear", 25, 1)] }),
  statuses("skill:bard_ward_song", "บทเพลงคุ้มกัน", "all_allies", 10, 4, [st("def_up", 100, 3), st("mdef_up", 100, 3)]),
  statuses("skill:bard_lullaby", "เพลงกล่อมหลับ", "enemy_row", 12, 4, [st("sleep", 35, 2)]),
];

/** Race passives (chapter 02 table, adapted to the primitives the kernel runs; STATUS A141). */
export const RACE_PASSIVE_SKILLS: SkillDefinition[] = [
  passive("skill:race_human_grit", "ใจสู้ (มนุษย์)", [{ on: "used_item", then: [{ kind: "status", target: "self", statuses: [st("shield", 100, 2, { shieldPct: 5 })] }] }]),
  passive("skill:race_sylvan_bloom", "พลังพฤกษา (ชาวพฤกษ์)", [], [{ kind: "heal_low_hp", belowHpPct: 35, bonusPct: 15 }]),
  passive("skill:race_stonekin_stone", "กายศิลา (ชาวศิลา)", [], [{ kind: "guard_reduction", reductionPct: 10 }]),
  passive("skill:race_wildkin_instinct", "สัญชาตญาณนักล่า (เผ่าสัตว์)", [{ on: "battle_start", then: [{ kind: "status", target: "self", statuses: [st("accuracy_up", 100, 1)] }] }]),
  passive("skill:race_runeborn_flow", "อักขระไหลเวียน (ชาวอาคม)", [{ on: "used_skill", chancePct: 25, then: [{ kind: "restore_mp", target: "self", amount: 4 }] }]),
  passive("skill:race_tideborn_tide", "คลื่นชำระ (ชาวสมุทร)", [{ on: "used_skill", skillApplies: "cleanse", then: [{ kind: "status", target: "self", statuses: [st("res_up", 100, 2)] }] }]),
  passive("skill:race_skyborn_wind", "สายลมพิทักษ์ (ชาวเวหา)", [{ on: "moved", then: [{ kind: "status", target: "self", statuses: [st("evasion_up", 100, 1)] }] }]),
  passive("skill:race_veilborn_shade", "เงาสะท้อน (ชาวสนธยา)", [{ on: "debuffed", then: [{ kind: "status", target: "self", statuses: [st("accuracy_up", 100, 2)] }] }]),
];
