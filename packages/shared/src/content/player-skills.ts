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
