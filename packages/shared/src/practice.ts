/**
 * Town training ground (ลานทดสอบ, P17: "Map เมืองมีลานทดสอบแทนบอสเดินโจมตีคน"; Nut 2026-10-09 asked
 * for it with boss parts and summons). In town the player picks any field boss and fights it with
 * their current team to try a build:
 *
 * - Nothing is earned or lost: no EXP, loot, Bond, mastery, capture or secret-quest progress, and HP/MP
 *   after the fight are not kept. Everyone starts at full HP/MP and no items are brought (so none are used).
 * - It can always be left (flee succeeds), and there is no quota.
 */
import { z } from "zod";
import { OperationIdSchema } from "./character";
import type { MapDefinition } from "./world/map";
import type { BossDefinition, SpeciesDefinition } from "./schemas";

export const PracticeStartRequestSchema = z.object({ operationId: OperationIdSchema, bossId: z.string().min(1).max(80) }).strict();

export interface PracticeBoss {
  bossId: string;
  name: string;
  level: number;
  /** The field it lives in (the first one, when several share it). */
  mapId: string;
  mapName: string;
  adds: number;
  parts: string[];
  phases: number;
  summons: boolean;
}

export interface PracticeView {
  bosses: PracticeBoss[];
}

/** Every field boss, in map order: the ones the training ground can stage. */
export function practiceBosses(
  maps: ReadonlyMap<string, MapDefinition>,
  bosses: ReadonlyMap<string, BossDefinition>,
  species: ReadonlyMap<string, SpeciesDefinition>,
): PracticeBoss[] {
  const out: PracticeBoss[] = [];
  for (const m of maps.values()) {
    const def = m.bossLair === undefined ? undefined : bosses.get(m.bossLair.bossId);
    if (def === undefined || out.some((b) => b.bossId === def.id)) continue;
    out.push({
      bossId: def.id,
      name: def.name.th,
      level: species.get(def.speciesId)?.fixedWildLevel ?? 0,
      mapId: m.id,
      mapName: m.name.th,
      adds: def.adds.length,
      parts: (def.parts ?? []).map((p) => p.name.th),
      phases: def.phases.length,
      summons: def.phases.some((p) => p.summon !== undefined),
    });
  }
  return out.sort((a, b) => a.level - b.level || a.bossId.localeCompare(b.bossId));
}
