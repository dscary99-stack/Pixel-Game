/**
 * Class2 (chapter 02, P16/P28): from Lv50 a character may take the trial at ผู้ใหญ่พิมพ์ in town;
 * reaching the level never changes the class by itself, and taking it late costs nothing (no level
 * reset, no stat points given again). The player names one of the two branches of their Class1 when
 * starting the trial; after a win they claim it once, and from then on the branch's passive and
 * actives join the kit (player-kit.ts). Switching branch later is not built (chapter 02: PROVISIONAL).
 *
 * The trial fight follows the training ground rules (practice.ts): nothing earned or lost, full HP/MP,
 * no items, the team may come. A loss or a flee just means trying again with a new operation id.
 */
import { z } from "zod";
import { OperationIdSchema, type CharacterView } from "./character";
import { class2Branch, class2BranchesOf, type Class2Branch } from "./player-kit";
import type { RulesConfig } from "./rules";

/** EXAMPLE: the trial boss (the only field boss so far); the rules give it the trial stat %. */
export const CLASS2_TRIAL_BOSS_ID = "boss:crystal_crab_lord";

export const ClassTrialStartRequestSchema = z.object({ operationId: OperationIdSchema, branchId: z.string().min(1).max(60) }).strict();
export const ClassTrialClaimRequestSchema = z.object({ operationId: OperationIdSchema }).strict();

export type ClassTrialStatus = "started" | "won" | "lost" | "claimed";

export interface ClassTrialView {
  operationId: string;
  branchId: string;
  battleId: string;
  status: ClassTrialStatus;
}

export interface ClassView {
  classId: string;
  class2Id: string | null;
  /** The two branches of this Class1, with what each adds. */
  branches: (Class2Branch & { skills: { skillId: string; level: number }[] })[];
  trialLevel: number;
  trialStatPct: number;
  bossId: string;
  /** Why the trial cannot be started now, or null. */
  blocked: null | "LEVEL_TOO_LOW" | "ALREADY_CHOSEN";
  /** The latest trial of this character, if any. */
  trial: ClassTrialView | null;
}

/** Why this character cannot take the trial for this branch, or null. */
export function class2Refusal(rules: RulesConfig, c: Pick<CharacterView, "classId" | "level" | "class2Id">, branchId: string): null | "NOT_FOUND" | "LEVEL_TOO_LOW" | "ALREADY_CHOSEN" {
  const b = class2Branch(branchId);
  if (b === undefined || b.classId !== c.classId) return "NOT_FOUND";
  if (c.class2Id != null) return "ALREADY_CHOSEN";
  if (c.level < rules.provisional.classChange.value.class2Level) return "LEVEL_TOO_LOW";
  return null;
}

export function classView(rules: RulesConfig, c: Pick<CharacterView, "classId" | "level" | "class2Id">, trial: ClassTrialView | null): ClassView {
  const cc = rules.provisional.classChange.value;
  return {
    classId: c.classId,
    class2Id: c.class2Id ?? null,
    branches: class2BranchesOf(c.classId).map((b) => ({ ...b, skills: b.actives.map((a) => ({ ...a })) })),
    trialLevel: cc.class2Level,
    trialStatPct: cc.trialStatPct,
    bossId: CLASS2_TRIAL_BOSS_ID,
    blocked: c.class2Id != null ? "ALREADY_CHOSEN" : c.level < cc.class2Level ? "LEVEL_TOO_LOW" : null,
    trial,
  };
}


