/**
 * Player skill trees (Nut 2026-10-09): job levels give skill points (job.ts), spent one level at a time
 * on the tree of the character's Class1 and, after the trial, its Class2 branch. Every class tree has
 * physical, magic, buff and debuff skills, so one class plays several builds depending on the stats,
 * race and element the player picks (a skill marked "own element" takes the character's element).
 *
 * - A node is a skill with a max level (1–10) and a cost per level (passives cost more, max level 1).
 * - A node may need other nodes at some level first (prerequisites, same tree or the Class1 tree).
 * - Learned skills are all usable in a fight (no loadout yet); levels follow the skill's own table.
 * - Levels are only bought, never lost; a reset is not built yet.
 */
import { z } from "zod";
import type { JobTier } from "./job";

export interface SkillNode {
  skillId: string;
  maxLevel: number;
  /** Skill points per level. */
  cost: number;
  requires: readonly { skillId: string; level: number }[];
  /** Where the UI draws it: column 0–3 (physical, magic, support, debuff/utility) and row. */
  col: number;
  row: number;
}

export interface SkillTree {
  /** class:... (Class1) or class2:... (a Class2 branch). */
  id: string;
  tier: JobTier;
  nodes: readonly SkillNode[];
}

export const LearnSkillRequestSchema = z
  .object({
    /** The character version the client last saw; a stale or repeated click is refused, not repeated. */
    expectedVersion: z.number().int().min(1),
    skillId: z.string().min(1).max(80),
  })
  .strict();

export type LearnRefusal = "NOT_IN_TREE" | "MAX_LEVEL" | "NEEDS_SKILL" | "NO_POINTS";

/** The trees a character may spend on: its Class1 tree, its branch tree once it has one, and its Class3 tree after that. */
export function treesFor(trees: ReadonlyMap<string, SkillTree>, classId: string, class2Id: string | null | undefined, class3Id?: string | null): SkillTree[] {
  return [trees.get(classId), class2Id == null ? undefined : trees.get(class2Id), class2Id == null || class3Id == null ? undefined : trees.get(class3Id)].filter((t): t is SkillTree => t !== undefined);
}

export function pointsSpent(trees: readonly SkillTree[], learned: Readonly<Record<string, number>>): number {
  let n = 0;
  for (const t of trees) for (const node of t.nodes) n += (learned[node.skillId] ?? 0) * node.cost;
  return n;
}

/** Why the next level of this skill cannot be learned now, or null. */
export function learnRefusal(
  trees: readonly SkillTree[],
  learned: Readonly<Record<string, number>>,
  points: number,
  skillId: string,
): null | { code: LearnRefusal; message: string } {
  const node = trees.flatMap((t) => t.nodes).find((n) => n.skillId === skillId);
  if (node === undefined) return { code: "NOT_IN_TREE", message: `${skillId} is not in your skill trees` };
  const now = learned[skillId] ?? 0;
  if (now >= node.maxLevel) return { code: "MAX_LEVEL", message: `${skillId} is at its max level ${node.maxLevel}` };
  for (const r of node.requires) {
    if ((learned[r.skillId] ?? 0) < r.level) return { code: "NEEDS_SKILL", message: `needs ${r.skillId} Lv${r.level}` };
  }
  if (pointsSpent(trees, learned) + node.cost > points) return { code: "NO_POINTS", message: `needs ${node.cost} skill point(s)` };
  return null;
}
