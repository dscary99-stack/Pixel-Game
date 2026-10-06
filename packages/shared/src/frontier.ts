/**
 * Weekly battle tower (chapter 07 §4 "tower"). Default EXAMPLE tower: หอคอยรอยแยก (`frontier:rift_spire`),
 * grown from a crack of the primordial rift and pulling in monsters from every land.
 *
 * Nut's decisions (2026-10-06, RULES.confirmed.frontier*): climbed floor by floor; one entry per
 * character per week (the quest week, P13 reset); enemies stronger each floor; a boss every 10 floors;
 * 100 floors to start; the point is the bosses' rare items; monsters inside can be captured.
 *
 * How a floor gets harder without touching wild level (C29, no per-map level override):
 * 1. Which species: NORMAL species by wild level, climbing one step every `floorsPerSpeciesStep`
 *    floors, from a window of `speciesWindow` species; the top species repeats once content runs out.
 * 2. Stats: every enemy carries the floor's stat % on HP and ATK/MATK, the way an elite carries its
 *    own (`scaleWildStats` in the kernel). Bosses and elites get it on top of their rank.
 * Boss floors are boss fights (actions per round, phases, adds) through the same kernel path as a
 * field boss. A capture is a normal capture: the species at Lv1, none of the tower's numbers, never
 * automatic (C15); a boss keeps its phase capture condition.
 *
 * The roll for a floor is deterministic in (run id, floor): the server keeps the run id, so a reload
 * never rerolls a floor. Run model numbers are PROVISIONAL (`rules.provisional.frontier`, P12).
 */
import { z } from "zod";
import { rollEliteModifiers } from "./elite";
import { isRareDrop } from "./loot";
import { Rng, seedRng } from "./rng";
import type { RulesConfig } from "./rules";
import type { BossDefinition, Element, LootTable, SpeciesDefinition } from "./schemas";
import type { BattleSetup } from "./battle/types";
import { packEnemies, type PackMember } from "./world/encounter";
import { MapId, type MapDefinition } from "./world/map";

export const FrontierDefinitionSchema = z
  .object({
    id: z.string().regex(/^frontier:[a-z0-9_]+$/),
    version: z.number().int().min(1),
    status: z.enum(["draft", "validated", "published", "retired"]),
    example: z.boolean(),
    name: z.object({ th: z.string().min(1), en: z.string().min(1).optional() }).strict(),
    lore: z.object({ th: z.string().min(1) }).strict(),
    /** Towns whose NPC lets a character in (entry only while standing in one). */
    townMapIds: z.array(MapId).min(1),
    /** Guardians of the boss floors, in turn: floor 10 the first, floor 20 the second, and so on. */
    bossIds: z.array(z.string().regex(/^boss:[a-z0-9_]+$/)).min(1),
  })
  .strict();
export type FrontierDefinition = z.infer<typeof FrontierDefinitionSchema>;

export interface FrontierContent {
  species: ReadonlyMap<string, SpeciesDefinition>;
  bosses: ReadonlyMap<string, BossDefinition>;
  lootTables: ReadonlyMap<string, LootTable>;
  maps: ReadonlyMap<string, MapDefinition>;
}

/** One floor as the server rolled it. */
export type FrontierFloor =
  | { floor: number; statPct: number; kind: "normal"; members: PackMember[] }
  | { floor: number; statPct: number; kind: "boss"; bossId: string };

const tune = (rules: RulesConfig) => rules.provisional.frontier.value;

/** The floor's stat % on enemies' HP and ATK/MATK: 100 + 4 per floor (floor 1 = 104%, floor 100 = 500%). */
export function frontierStatPct(rules: RulesConfig, floor: number): number {
  return 100 + tune(rules).statPctPerFloor * floor;
}

export const isFrontierBossFloor = (rules: RulesConfig, floor: number) => floor % rules.confirmed.frontierBossEveryFloors.value === 0;

/** Pack size grows evenly from the first to the last size over the tower's floors. */
export function frontierPackSize(rules: RulesConfig, floor: number): number {
  const t = tune(rules);
  const floors = rules.confirmed.frontierFloors.value;
  const steps = t.packSizeLast - t.packSizeFirst + 1;
  return Math.min(t.packSizeLast, t.packSizeFirst + Math.floor(((floor - 1) * steps) / floors));
}

/** NORMAL species in climbing order: wild level, then id (so content order never matters). */
export function frontierSpeciesLadder(species: ReadonlyMap<string, SpeciesDefinition>): SpeciesDefinition[] {
  return [...species.values()]
    .filter((s) => s.rank === "NORMAL")
    .sort((a, b) => a.fixedWildLevel - b.fixedWildLevel || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Species a normal floor picks from: a window that climbs the ladder; the top repeats when it runs out. */
export function frontierSpeciesPool(rules: RulesConfig, species: ReadonlyMap<string, SpeciesDefinition>, floor: number): SpeciesDefinition[] {
  const ladder = frontierSpeciesLadder(species);
  if (ladder.length === 0) return [];
  const t = tune(rules);
  const top = Math.min(ladder.length - 1, Math.floor((floor - 1) / t.floorsPerSpeciesStep));
  return ladder.slice(Math.max(0, top - t.speciesWindow + 1), top + 1);
}

/** The guardian of a boss floor: the definition's bosses in turn. */
export function frontierBossFor(rules: RulesConfig, def: FrontierDefinition, floor: number): string {
  const n = Math.floor(floor / rules.confirmed.frontierBossEveryFloors.value) - 1;
  return def.bossIds[n % def.bossIds.length]!;
}

/**
 * Roll one floor. Server only: `runId` is the server's secret-enough run id, and the same
 * (run id, floor) always gives the same floor.
 */
export function rollFrontierFloor(rules: RulesConfig, def: FrontierDefinition, content: Pick<FrontierContent, "species">, runId: string, floor: number): FrontierFloor {
  if (!Number.isInteger(floor) || floor < 1 || floor > rules.confirmed.frontierFloors.value) throw new Error(`no tower floor ${floor}`);
  const statPct = frontierStatPct(rules, floor);
  if (isFrontierBossFloor(rules, floor)) return { floor, statPct, kind: "boss", bossId: frontierBossFor(rules, def, floor) };
  const rng = new Rng(seedRng(`frontier:${def.id}:${runId}:${floor}`));
  const pool = frontierSpeciesPool(rules, content.species, floor);
  if (pool.length === 0) throw new Error("the tower has no NORMAL species to draw from");
  const members: PackMember[] = [];
  for (let i = 0; i < frontierPackSize(rules, floor); i++) {
    const sp = pool[rng.nextInt(pool.length)]!;
    members.push({ speciesId: sp.id, element: sp.allowedElements[rng.nextInt(sp.allowedElements.length)] as Element });
  }
  const t = tune(rules);
  if (floor >= t.eliteFromFloor && rng.nextInt(100) < t.eliteChancePct) {
    const leader = members[0]!;
    leader.elite = rollEliteModifiers(rules, content.species.get(leader.speciesId)!.fixedWildLevel, rng);
  }
  return { floor, statPct, kind: "normal", members };
}

/** The battle setup parts for a floor: its enemies (or boss) and the floor marker the kernel scales by. */
export function frontierFloorSetup(f: FrontierFloor): Pick<BattleSetup, "enemies" | "boss" | "frontier"> {
  if (f.kind === "boss") return { enemies: [], boss: { bossId: f.bossId }, frontier: { floor: f.floor } };
  const pack = { packId: `frontier#${f.floor}`, spawnId: "frontier", at: { x: 0, y: 0 }, rank: "NORMAL" as const, sizeRange: [f.members.length, f.members.length] as [number, number], members: f.members };
  return { enemies: packEnemies(pack), frontier: { floor: f.floor } };
}

/** Species met on a floor (the boss and its adds on a boss floor), for the journal. */
export function frontierFloorSpecies(f: FrontierFloor, bosses: ReadonlyMap<string, BossDefinition>): { speciesId: string; element: Element }[] {
  if (f.kind === "normal") return f.members.map((m) => ({ speciesId: m.speciesId, element: m.element }));
  const b = bosses.get(f.bossId);
  return b === undefined ? [] : [{ speciesId: b.speciesId, element: b.element }, ...b.adds.map((a) => ({ speciesId: a.speciesId, element: a.element }))];
}

// ---------------------------------------------------------------- HP/MP between floors

export interface FrontierVital {
  hp: number;
  mp: number;
}
/** HP/MP carried from floor to floor. Missing = full (the run's first floor, or a unit not seen yet). */
export interface FrontierVitals {
  player?: FrontierVital;
  companions: Record<string, FrontierVital>;
}
export const EMPTY_FRONTIER_VITALS: FrontierVitals = { companions: {} };

/** Every `checkpointEveryFloors`-th floor cleared is a checkpoint. */
export const frontierCheckpoint = (rules: RulesConfig, clearedFloor: number) => clearedFloor % tune(rules).checkpointEveryFloors === 0;

/**
 * HP/MP to carry after clearing `clearedFloor`, from the fight's end. At a checkpoint every unit still
 * standing gets `checkpointRestorePct` of its max HP/MP back (capped at max). A knocked-out unit stays
 * down: a revive is O15 (OPEN), so the tower does not make one up.
 */
export function frontierVitalsAfter(
  rules: RulesConfig,
  clearedFloor: number,
  allies: readonly { unitId: string; instanceId: string | null; hp: number; mp: number; ko: boolean; maxHp?: number; maxMp?: number }[],
): FrontierVitals {
  const pct = frontierCheckpoint(rules, clearedFloor) ? tune(rules).checkpointRestorePct : 0;
  const back = (v: number, max: number | undefined, ko: boolean) =>
    ko || max === undefined || pct === 0 ? Math.max(0, Math.floor(v)) : Math.min(max, Math.max(0, Math.floor(v)) + Math.floor((max * pct) / 100));
  const out: FrontierVitals = { companions: {} };
  for (const a of allies) {
    const v = { hp: back(a.hp, a.maxHp, a.ko), mp: back(a.mp, a.maxMp, a.ko) };
    if (a.unitId === "player") out.player = v;
    else if (a.instanceId !== null) out.companions[a.instanceId] = v;
  }
  return out;
}

// ---------------------------------------------------------------- requests and views

const OperationId = z.string().regex(/^[A-Za-z0-9_:-]{8,120}$/);
export const FrontierEnterRequestSchema = z.object({ operationId: OperationId }).strict();
/** The client names the run and floor it saw, so a stale double tap never starts something else. */
export const FrontierFloorRequestSchema = z.object({ runId: z.string().min(1).max(80), floor: z.number().int().min(1).max(999) }).strict();
export const FrontierLeaveRequestSchema = z.object({ runId: z.string().min(1).max(80) }).strict();

export interface FrontierRunView {
  runId: string;
  /** The next floor to fight (after a summit: floors + 1). */
  floor: number;
  /** Highest floor cleared in this run (this week's record). */
  best: number;
  status: "open" | "ended";
  endReason: "defeat" | "summit" | null;
  /** Standing inside the tower (between floors) or out in town. */
  inside: boolean;
  /** The floor fight in progress, if any. */
  battleId: string | null;
  nextIsBoss: boolean;
  vitals: FrontierVitals;
}

export interface FrontierView {
  frontierId: string;
  name: { th: string; en?: string | undefined };
  lore: string;
  weekId: string;
  endsAt: string;
  floors: number;
  bossEvery: number;
  /** This week's entry is used once a run exists for the week. */
  entryUsed: boolean;
  run: FrontierRunView | null;
}

// ---------------------------------------------------------------- content check

export interface FrontierIssue {
  message: string;
}

/**
 * Content check: entry towns are towns, every guardian is a real BOSS whose loot table exists and
 * has at least one rare drop (Nut: the reason to climb), a floor never fields more than 10 enemies
 * (C05), and there are NORMAL species to climb through.
 */
export function validateFrontier(rules: RulesConfig, def: FrontierDefinition, content: FrontierContent): FrontierIssue[] {
  const out: FrontierIssue[] = [];
  const issue = (message: string) => out.push({ message });
  const parsed = FrontierDefinitionSchema.safeParse(def);
  if (!parsed.success) issue(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  for (const id of def.townMapIds) if (content.maps.get(id)?.kind !== "town") issue(`${id} is not a town`);
  const maxEnemies = rules.confirmed.maxEnemyUnits.value;
  for (const id of def.bossIds) {
    const b = content.bosses.get(id);
    if (b === undefined) {
      issue(`unknown boss ${id}`);
      continue;
    }
    const sp = content.species.get(b.speciesId);
    if (sp?.rank !== "BOSS") issue(`${id} needs a BOSS species`);
    if (1 + b.adds.length > maxEnemies) issue(`${id} fields ${1 + b.adds.length} enemies > ${maxEnemies}`);
    const table = content.lootTables.get(b.lootTableId ?? sp?.lootTableId ?? "");
    if (table === undefined) issue(`${id} has no loot table`);
    else {
      // Every table's Sigil is rare by itself (C22); the guardian needs a rare item besides it.
      const ids = new Set(table.pools.flatMap((p) => p.entries.map((e) => e.itemId)));
      if (![...ids].some((i) => isRareDrop(rules, table, i))) issue(`${id}'s loot table has no rare drop besides its Sigil (under ${rules.confirmed.rareDropBelowChance.value * 100}%)`);
    }
  }
  if (tune(rules).packSizeLast > maxEnemies) issue(`packs of ${tune(rules).packSizeLast} > ${maxEnemies} enemies`);
  if (tune(rules).packSizeFirst < 1 || tune(rules).packSizeFirst > tune(rules).packSizeLast) issue("pack sizes are upside down");
  if (frontierSpeciesLadder(content.species).length === 0) issue("no NORMAL species to climb through");
  return out;
}
