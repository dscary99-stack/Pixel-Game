/**
 * Race passives (chapter 02, P16 draft): each race has one small passive, always weaker than the class
 * core and never touching EXP, drops or capture (chapter 02). Class skills live in the skill trees
 * (class-trees.ts, Nut 2026-10-09). Names and numbers are drafts for Nut to review (STATUS A141).
 */
import { z } from "zod";
import { PassiveSchema, PassiveTriggerSchema, type PassiveModifier, type SkillDefinition, type StatusApplication } from "../schemas";

const meta = { version: 1, status: "draft", example: true } as const;

const st = (statusId: StatusApplication["statusId"], chancePct: number, turns: number, more: Partial<StatusApplication> = {}): StatusApplication => ({ statusId, chancePct, turns, ...more });

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
    tags: ["race"],
    passive: PassiveSchema.parse({ triggers, modifiers }),
  };
}

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

/**
 * Evolved race passives (chapter 02 จุติเทพ, ascension.ts): one per race and path, replacing the
 * race passive (never stacking with it). A little more than the race passive, with the path's turn;
 * still far below a class core and never EXP, drops or capture (STATUS A148, P31).
 */
export const ASCENSION_PASSIVE_SKILLS: SkillDefinition[] = [
  // Human: after an item, courage (ready to strike) or hope (the item's target is covered too).
  passive("skill:ascend_human_a", "ความกล้าแห่งผู้บุกเบิก", [{ on: "used_item", then: [{ kind: "status", target: "self", statuses: [st("shield", 100, 2, { shieldPct: 7 }), st("atk_up", 100, 2), st("matk_up", 100, 2)] }] }]),
  passive("skill:ascend_human_b", "ความหวังแห่งผู้บุกเบิก", [
    { on: "used_item", then: [{ kind: "status", target: "self", statuses: [st("shield", 100, 2, { shieldPct: 6 })] }, { kind: "status", target: "other", statuses: [st("shield", 100, 2, { shieldPct: 8 }), st("def_up", 100, 2)] }] },
  ]),
  // Sylvan: healing that runs over turns into a shield, or into thorns.
  passive("skill:ascend_sylvan_a", "ผลิบานนิรันดร์", [{ on: "used_skill", skillApplies: "regen", then: [{ kind: "status", target: "lowest_ally", statuses: [st("shield", 100, 2, { shieldPct: 6 })] }] }], [{ kind: "heal_low_hp", belowHpPct: 40, bonusPct: 20 }]),
  passive("skill:ascend_sylvan_b", "หนามพิทักษ์พฤกษา", [{ on: "took_damage", chancePct: 30, then: [{ kind: "status", target: "self", statuses: [st("thorns", 100, 2)] }] }], [{ kind: "heal_low_hp", belowHpPct: 35, bonusPct: 15 }]),
  // Stonekin: a guard that covers friends, or a quake that cracks the attacker's armour.
  passive("skill:ascend_stonekin_a", "ขุนเขาค้ำฟ้า", [{ on: "guarded", then: [{ kind: "status", target: "allies", statuses: [st("def_up", 100, 1)] }] }], [{ kind: "guard_reduction", reductionPct: 15 }]),
  passive("skill:ascend_stonekin_b", "แผ่นดินสะท้าน", [{ on: "guarded", then: [{ kind: "status", target: "self", statuses: [st("focus", 100, 2)] }] }, { on: "took_damage", chancePct: 25, then: [{ kind: "status", target: "other", statuses: [st("def_down", 60, 2)] }] }], [{ kind: "guard_reduction", reductionPct: 12 }]),
  // Wildkin: the hunter marks its prey, the pack leader sharpens everyone's aim (no extra action).
  passive("skill:ascend_wildkin_a", "นักล่าปฐมกาล", [
    { on: "battle_start", then: [{ kind: "status", target: "self", statuses: [st("accuracy_up", 100, 2), st("crit_up", 100, 1)] }] },
    { on: "dealt_damage", chancePct: 20, then: [{ kind: "status", target: "other", statuses: [st("mark", 60, 2)] }] },
  ]),
  passive("skill:ascend_wildkin_b", "จ่าฝูงปฐมกาล", [{ on: "battle_start", then: [{ kind: "status", target: "allies", statuses: [st("accuracy_up", 100, 2)] }] }]),
  // Runeborn: weave (save MP) or shatter (stronger effects instead of savings).
  passive("skill:ascend_runeborn_a", "ถักเวทต้นกำเนิด", [{ on: "used_skill", chancePct: 35, then: [{ kind: "restore_mp", target: "self", amount: 6 }] }]),
  passive("skill:ascend_runeborn_b", "แตกอักขระ", [
    { on: "used_skill", chancePct: 25, then: [{ kind: "restore_mp", target: "self", amount: 3 }] },
    { on: "dealt_damage", action: "skill", chancePct: 20, then: [{ kind: "status", target: "other", statuses: [st("mdef_down", 60, 2)] }] },
  ]),
  // Tideborn: the rising tide helps whoever was cleansed, the ebb slows the enemy.
  passive("skill:ascend_tideborn_a", "น้ำขึ้นแห่งห้วงลึก", [{ on: "used_skill", skillApplies: "cleanse", then: [{ kind: "status", target: "self", statuses: [st("res_up", 100, 2)] }, { kind: "status", target: "other", statuses: [st("res_up", 100, 2), st("regen", 100, 2)] }] }]),
  passive("skill:ascend_tideborn_b", "น้ำลงแห่งห้วงลึก", [
    { on: "used_skill", skillApplies: "cleanse", then: [{ kind: "status", target: "self", statuses: [st("res_up", 100, 2)] }] },
    { on: "dealt_damage", chancePct: 20, then: [{ kind: "status", target: "other", statuses: [st("spd_down", 60, 2)] }] },
  ]),
  // Skyborn: after a move, a tailwind (SPD next round) or guarding wings (a shield).
  passive("skill:ascend_skyborn_a", "กระแสลมนิรันดร์", [{ on: "moved", then: [{ kind: "status", target: "self", statuses: [st("evasion_up", 100, 1), st("spd_up", 100, 2)] }] }]),
  passive("skill:ascend_skyborn_b", "ปีกพิทักษ์เวหา", [{ on: "moved", then: [{ kind: "status", target: "self", statuses: [st("evasion_up", 100, 1), st("shield", 100, 2, { shieldPct: 8 })] }] }]),
  // Veilborn: when cursed, a mist that softens the next blow, or a moon that answers it.
  passive("skill:ascend_veilborn_a", "ม่านหมอกสนธยา", [{ on: "debuffed", then: [{ kind: "status", target: "self", statuses: [st("accuracy_up", 100, 2), st("dmg_reduction", 100, 1)] }] }]),
  passive("skill:ascend_veilborn_b", "จันทร์ย้อนเงา", [{ on: "debuffed", then: [{ kind: "status", target: "self", statuses: [st("accuracy_up", 100, 2), st("counter", 100, 1)] }] }]),
];
