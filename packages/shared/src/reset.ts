/**
 * Reset items (Nut 2026-10-09 17:14Z: "มี item reset โดยเฉพาะ ทั้ง status, skill"). Using one outside a
 * fight, anywhere, gives back every point of one kind: a stat reset puts every primary stat back to its
 * starting value (all points spendable again), a skill reset forgets every learned tree skill (all job
 * points spendable again; job levels stay). One item per use, keyed by an operation id so a retry
 * answers the same and never takes a second item.
 */
import { z } from "zod";
import { OperationIdSchema } from "./character";
import { PRIMARY_STATS } from "./stats";
import type { PrimaryStats } from "./schemas";
import type { RulesConfig } from "./rules";

export const UseResetRequestSchema = z.object({ operationId: OperationIdSchema, itemId: z.string().min(1).max(80) }).strict();

export type ResetKind = "stats" | "skills";

/** Every primary stat at its starting value. */
export function startingStats(rules: RulesConfig): PrimaryStats {
  const start = rules.provisional.primaryStatStart.value;
  return Object.fromEntries(PRIMARY_STATS.map((k) => [k, start])) as PrimaryStats;
}
