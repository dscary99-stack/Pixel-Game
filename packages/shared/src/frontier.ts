/**
 * Weekly battle tower (chapter 07 §4 "tower"). Default EXAMPLE tower: หอคอยรอยแยก (`frontier:rift_spire`),
 * grown from a crack of the primordial rift and pulling in monsters from every land.
 *
 * Nut's decisions (2026-10-06, RULES.confirmed.frontier*): climbed floor by floor; one entry per
 * character per week (the quest week, P13 reset); enemies stronger each floor; a boss every 10 floors;
 * 100 floors to start; the point is the bosses' rare items; monsters inside can be captured.
 * Second round (Nut 2026-10-06 04:37Z): Claude names every floor; every floor fields 10 monsters;
 * each floor has its own gimmick; on later floors a fallen monster is replaced by a reinforcement.
 *
 * How a floor gets harder without touching wild level (C29, no per-map level override):
 * 1. Which species: NORMAL species by wild level, climbing one step every `floorsPerSpeciesStep`
 *    floors, from a window of `speciesWindow` species; the top species repeats once content runs out.
 * 2. Stats: every enemy carries the floor's stat % on HP and ATK/MATK, the way an elite carries its
 *    own (`scaleWildStats` in the kernel). Bosses and elites get it on top of their rank.
 * 3. Gimmicks (`FRONTIER_MODIFIERS`): fixed per floor in content, so every player meets the same
 *    floor 37. They use the existing primitives only: a stat %, a status at the start, a status on hit,
 *    the floor's element, the reinforcement count. Never a level.
 * 4. Reinforcements: from `reinforceFromFloor`, a finite queue rolled with the floor. When enemies fall,
 *    replacements enter their cells at the end of that round (before the next round's order); if no
 *    enemy is left standing they enter at once, so the fight goes on until the queue is empty. Each one
 *    is a real unit: EXP, drops and capture like any wild monster. The queue is finite, so rewards stay
 *    bounded (chapter 07 §5: no unbounded reward from resummons).
 * Boss floors are boss fights (actions per round, phases, adds) through the same kernel path as a
 * field boss, filled up to 10 with escorts from the floor's species. A capture is a normal capture: the
 * species at Lv1, none of the tower's numbers, never automatic (C15).
 *
 * The roll for a floor is deterministic in (run id, floor): the server keeps the run id, so a reload
 * never rerolls a floor. Run model numbers are PROVISIONAL (`rules.provisional.frontier`, P12).
 */
import { z } from "zod";
import { rollEliteModifiers } from "./elite";
import { isRareDrop } from "./loot";
import { Rng, seedRng } from "./rng";
import type { RulesConfig } from "./rules";
import { ElementSchema, type BossDefinition, type Element, type LootTable, type SpeciesDefinition } from "./schemas";
import type { DerivedStats } from "./stats";
import type { BattleSetup } from "./battle/types";
import { packEnemies, type PackMember } from "./world/encounter";
import { MapId, type MapDefinition } from "./world/map";

// ---------------------------------------------------------------- gimmicks

export const FRONTIER_MODIFIER_IDS = ["fierce", "tough", "arcane", "swift", "venom", "disrupt", "regen", "mono_element", "crystal_shield", "reserves"] as const;
export const FrontierModifierIdSchema = z.enum(FRONTIER_MODIFIER_IDS);
export type FrontierModifierId = z.infer<typeof FrontierModifierIdSchema>;

/** Thai names and a one-line hint for the panel and the battle header (readable without colour). */
export const FRONTIER_MODIFIER_TH: Readonly<Record<FrontierModifierId, { name: string; hint: string }>> = {
  fierce: { name: "ดุดัน", hint: "ศัตรู ATK สูงขึ้น" },
  tough: { name: "หนังเหนียว", hint: "ศัตรู DEF/MDEF สูงขึ้น" },
  arcane: { name: "เวทเข้ม", hint: "ศัตรู MATK สูงขึ้น" },
  swift: { name: "ว่องไว", hint: "ศัตรู SPD สูงขึ้น" },
  venom: { name: "พิษร้าย", hint: "ศัตรูตีโดนมีโอกาสติดพิษ" },
  disrupt: { name: "ปั่นป่วน", hint: "ศัตรูตีโดนมีโอกาสทำให้สับสน" },
  regen: { name: "ฟื้นฟู", hint: "ศัตรูฟื้น HP ทุกเทิร์น" },
  mono_element: { name: "ธาตุเดียว", hint: "ศัตรูทั้งชั้นเป็นธาตุเดียวกัน" },
  crystal_shield: { name: "โล่ผลึก", hint: "ศัตรูเริ่มด้วยโล่" },
  reserves: { name: "กองหนุน", hint: "กำลังเสริมมากขึ้น" },
};

/** One floor in content: its name, a guardian title on boss floors, its fixed gimmicks. */
export const FrontierFloorDefinitionSchema = z
  .object({
    floor: z.number().int().min(1),
    name: z.object({ th: z.string().min(1) }).strict(),
    /** Boss floors only: the guardian's title on this floor. */
    guardianTitle: z.object({ th: z.string().min(1) }).strict().optional(),
    modifiers: z.array(FrontierModifierIdSchema).min(1).max(3),
    /** mono_element only: the floor's element. */
    element: ElementSchema.optional(),
  })
  .strict();
export type FrontierFloorDefinition = z.infer<typeof FrontierFloorDefinitionSchema>;

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
    /** Every floor, in order (Nut: Claude names every floor); the validator checks there is one per floor. */
    floors: z.array(FrontierFloorDefinitionSchema),
  })
  .strict();
export type FrontierDefinition = z.infer<typeof FrontierDefinitionSchema>;

export interface FrontierContent {
  species: ReadonlyMap<string, SpeciesDefinition>;
  bosses: ReadonlyMap<string, BossDefinition>;
  lootTables: ReadonlyMap<string, LootTable>;
  maps: ReadonlyMap<string, MapDefinition>;
}

/** A monster rolled for a floor (escort or reinforcement): species and element only. */
export interface FrontierMonster {
  speciesId: string;
  element: Element;
}

interface FloorBase {
  floor: number;
  statPct: number;
  modifiers: FrontierModifierId[];
  /** mono_element floors: everyone's element. */
  element?: Element;
  /** The finite queue of replacements, in arrival order. */
  reinforcements: FrontierMonster[];
}
/** One floor as the server rolled it. */
export type FrontierFloor = (FloorBase & { kind: "normal"; members: PackMember[] }) | (FloorBase & { kind: "boss"; bossId: string; escorts: FrontierMonster[] });

const tune = (rules: RulesConfig) => rules.provisional.frontier.value;

/** The floor's stat % on enemies' HP and ATK/MATK: 100 + 4 per floor (floor 1 = 104%, floor 100 = 500%). */
export function frontierStatPct(rules: RulesConfig, floor: number): number {
  return 100 + tune(rules).statPctPerFloor * floor;
}

export const isFrontierBossFloor = (rules: RulesConfig, floor: number) => floor % rules.confirmed.frontierBossEveryFloors.value === 0;

/** How many gimmicks a floor carries: 1, 2 from floor 50, 3 from floor 80 (P12). */
export function frontierModifierCount(rules: RulesConfig, floor: number): number {
  const t = tune(rules);
  return floor >= t.threeModifiersFromFloor ? 3 : floor >= t.twoModifiersFromFloor ? 2 : 1;
}

/**
 * Reinforcements a floor holds: none below `reinforceFromFloor`, then evenly from `reinforceFirst` to
 * `reinforceLast` at the top floor; the reserves gimmick adds `reservesBonusPct` (rounded up).
 */
export function frontierReinforcementCount(rules: RulesConfig, floor: number, modifiers: readonly FrontierModifierId[]): number {
  const t = tune(rules);
  if (floor < t.reinforceFromFloor) return 0;
  const top = rules.confirmed.frontierFloors.value;
  const base = top === t.reinforceFromFloor ? t.reinforceLast : Math.round(t.reinforceFirst + ((floor - t.reinforceFromFloor) * (t.reinforceLast - t.reinforceFirst)) / (top - t.reinforceFromFloor));
  return modifiers.includes("reserves") ? Math.ceil((base * (100 + t.reservesBonusPct)) / 100) : base;
}

/** The most reinforcements any floor can hold (the kernel's bound on a setup). */
export const frontierMaxReinforcements = (rules: RulesConfig) => Math.ceil((tune(rules).reinforceLast * (100 + tune(rules).reservesBonusPct)) / 100);

/**
 * Stat gimmicks on one enemy's stats (after the floor %): ATK, DEF/MDEF, MATK, SPD by their %. Whole
 * numbers, rounded down; HP and level untouched.
 */
export function frontierModifierStats(rules: RulesConfig, stats: DerivedStats, modifiers: readonly FrontierModifierId[]): DerivedStats {
  const m = tune(rules).modifiers;
  const up = (v: number, pct: number) => Math.floor((v * (100 + pct)) / 100);
  const out = { ...stats };
  if (modifiers.includes("fierce")) out.patk = up(out.patk, m.fierceAtkPct);
  if (modifiers.includes("tough")) {
    out.pdef = up(out.pdef, m.toughDefPct);
    out.mdef = up(out.mdef, m.toughDefPct);
  }
  if (modifiers.includes("arcane")) out.matk = up(out.matk, m.arcaneMatkPct);
  if (modifiers.includes("swift")) out.spd = up(out.spd, m.swiftSpdPct);
  return out;
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

/**
 * A one-element floor's species: the floor's window if any of it carries the element, else the closest
 * species below the window that does (validateFrontier makes sure there is one).
 */
export function frontierElementPool(rules: RulesConfig, species: ReadonlyMap<string, SpeciesDefinition>, floor: number, element: Element): SpeciesDefinition[] {
  const window = frontierSpeciesPool(rules, species, floor).filter((s) => s.allowedElements.includes(element));
  if (window.length > 0) return window;
  const ladder = frontierSpeciesLadder(species).filter((s) => s.allowedElements.includes(element));
  const topLevel = Math.max(...frontierSpeciesPool(rules, species, floor).map((s) => s.fixedWildLevel));
  const below = ladder.filter((s) => s.fixedWildLevel <= topLevel);
  return below.length > 0 ? below.slice(-1) : ladder.slice(0, 1);
}

/** The guardian of a boss floor: the definition's bosses in turn. */
export function frontierBossFor(rules: RulesConfig, def: FrontierDefinition, floor: number): string {
  const n = Math.floor(floor / rules.confirmed.frontierBossEveryFloors.value) - 1;
  return def.bossIds[n % def.bossIds.length]!;
}

/** The content entry of a floor. */
export function frontierFloorDefinition(def: FrontierDefinition, floor: number): FrontierFloorDefinition | undefined {
  return def.floors.find((f) => f.floor === floor);
}

/**
 * Roll one floor. Server only: `runId` is the server's secret-enough run id, and the same
 * (run id, floor) always gives the same floor: its 10 monsters (or guardian, adds and escorts) and its
 * reinforcement queue. Gimmicks and names come from content, the same for everyone.
 */
export function rollFrontierFloor(
  rules: RulesConfig,
  def: FrontierDefinition,
  content: Pick<FrontierContent, "species" | "bosses">,
  runId: string,
  floor: number,
): FrontierFloor {
  if (!Number.isInteger(floor) || floor < 1 || floor > rules.confirmed.frontierFloors.value) throw new Error(`no tower floor ${floor}`);
  const fd = frontierFloorDefinition(def, floor);
  if (fd === undefined) throw new Error(`tower floor ${floor} is not in content`);
  const statPct = frontierStatPct(rules, floor);
  const rng = new Rng(seedRng(`frontier:${def.id}:${runId}:${floor}`));
  const mono = fd.modifiers.includes("mono_element") ? fd.element : undefined;
  const pool = mono === undefined ? frontierSpeciesPool(rules, content.species, floor) : frontierElementPool(rules, content.species, floor, mono);
  if (pool.length === 0) throw new Error("the tower has no NORMAL species to draw from");
  const monster = (): FrontierMonster => {
    const sp = pool[rng.nextInt(pool.length)]!;
    return { speciesId: sp.id, element: mono ?? (sp.allowedElements[rng.nextInt(sp.allowedElements.length)] as Element) };
  };
  const per = rules.confirmed.frontierMonstersPerFloor.value;
  const base = { floor, statPct, modifiers: [...fd.modifiers], ...(mono !== undefined ? { element: mono } : {}) };
  if (isFrontierBossFloor(rules, floor)) {
    const bossId = frontierBossFor(rules, def, floor);
    const boss = content.bosses.get(bossId);
    if (boss === undefined) throw new Error(`unknown guardian ${bossId}`);
    const escorts = Array.from({ length: Math.max(0, per - 1 - boss.adds.length - (boss.parts?.length ?? 0)) }, monster);
    const reinforcements = Array.from({ length: frontierReinforcementCount(rules, floor, fd.modifiers) }, monster);
    return { ...base, kind: "boss", bossId, escorts, reinforcements };
  }
  const members: PackMember[] = Array.from({ length: per }, monster);
  const t = tune(rules);
  if (floor >= t.eliteFromFloor && rng.nextInt(100) < t.eliteChancePct) {
    const leader = members[0]!;
    leader.elite = rollEliteModifiers(rules, content.species.get(leader.speciesId)!.fixedWildLevel, rng);
  }
  const reinforcements = Array.from({ length: frontierReinforcementCount(rules, floor, fd.modifiers) }, monster);
  return { ...base, kind: "normal", members, reinforcements };
}

/** The battle setup parts for a floor: its enemies (or boss and escorts), gimmicks and reinforcement queue. */
export function frontierFloorSetup(f: FrontierFloor): Pick<BattleSetup, "enemies" | "boss" | "frontier"> {
  const frontier = { floor: f.floor, modifiers: [...f.modifiers], reinforcements: f.reinforcements.map((m) => ({ ...m })) };
  if (f.kind === "boss") return { enemies: [], boss: { bossId: f.bossId }, frontier: { ...frontier, escorts: f.escorts.map((m) => ({ ...m })) } };
  const pack = { packId: `frontier#${f.floor}`, spawnId: "frontier", at: { x: 0, y: 0 }, rank: "NORMAL" as const, sizeRange: [f.members.length, f.members.length] as [number, number], members: f.members };
  return { enemies: packEnemies(pack), frontier };
}

/** Species met on a floor (the boss, its adds and escorts on a boss floor, and the reinforcements), for the journal. */
export function frontierFloorSpecies(f: FrontierFloor, bosses: ReadonlyMap<string, BossDefinition>): { speciesId: string; element: Element }[] {
  const extra = f.reinforcements.map((m) => ({ speciesId: m.speciesId, element: m.element }));
  if (f.kind === "normal") return [...f.members.map((m) => ({ speciesId: m.speciesId, element: m.element })), ...extra];
  const b = bosses.get(f.bossId);
  const escorts = f.escorts.map((m) => ({ speciesId: m.speciesId, element: m.element }));
  return b === undefined ? [...escorts, ...extra] : [{ speciesId: b.speciesId, element: b.element }, ...b.adds.map((a) => ({ speciesId: a.speciesId, element: a.element })), ...escorts, ...extra];
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
  /** The next floor as content names it (null after the summit). */
  next: FrontierNextFloor | null;
  vitals: FrontierVitals;
}

/** What the panel shows before a floor starts: same for everyone (fixed in content). */
export interface FrontierNextFloor {
  floor: number;
  name: string;
  guardianTitle: string | null;
  modifiers: { id: FrontierModifierId; name: string; hint: string }[];
  element: Element | null;
  monsters: number;
  reinforcements: number;
}

/** The panel's view of a floor from content and rules. */
export function frontierNextFloor(rules: RulesConfig, def: FrontierDefinition, floor: number): FrontierNextFloor | null {
  const fd = frontierFloorDefinition(def, floor);
  if (fd === undefined) return null;
  return {
    floor,
    name: fd.name.th,
    guardianTitle: fd.guardianTitle?.th ?? null,
    modifiers: fd.modifiers.map((id) => ({ id, ...FRONTIER_MODIFIER_TH[id] })),
    element: fd.element ?? null,
    monsters: rules.confirmed.frontierMonstersPerFloor.value,
    reinforcements: frontierReinforcementCount(rules, floor, fd.modifiers),
  };
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
 * has at least one rare drop (Nut: the reason to climb), a guardian and its adds fit in 10 cells (C05),
 * there are NORMAL species to climb through, and every floor is named with the right number of
 * gimmicks: a guardian title on boss floors only, an element on one-element floors that the floor's
 * species can carry, reserves only where reinforcements exist, and never the same gimmicks twice in a row.
 */
export function validateFrontier(rules: RulesConfig, def: FrontierDefinition, content: FrontierContent): FrontierIssue[] {
  const out: FrontierIssue[] = [];
  const issue = (message: string) => out.push({ message });
  const parsed = FrontierDefinitionSchema.safeParse(def);
  if (!parsed.success) issue(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  for (const id of def.townMapIds) if (content.maps.get(id)?.kind !== "town") issue(`${id} is not a town`);
  const maxEnemies = rules.confirmed.maxEnemyUnits.value;
  const per = rules.confirmed.frontierMonstersPerFloor.value;
  if (per > maxEnemies) issue(`${per} monsters a floor > ${maxEnemies} enemies`);
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
  if (frontierSpeciesLadder(content.species).length === 0) issue("no NORMAL species to climb through");
  const floors = rules.confirmed.frontierFloors.value;
  if (def.floors.length !== floors) issue(`${def.floors.length} floors in content, the tower has ${floors}`);
  const names = new Set<string>();
  let prev = "";
  def.floors.forEach((f, i) => {
    const at = `floor ${f.floor}`;
    if (f.floor !== i + 1) issue(`${at} is listed as number ${i + 1}`);
    if (names.has(f.name.th)) issue(`${at}: name ${f.name.th} used twice`);
    names.add(f.name.th);
    const want = frontierModifierCount(rules, f.floor);
    if (f.modifiers.length !== want) issue(`${at} has ${f.modifiers.length} gimmicks, needs ${want}`);
    if (new Set(f.modifiers).size !== f.modifiers.length) issue(`${at} lists a gimmick twice`);
    const key = [...f.modifiers].sort().join("+");
    if (key === prev) issue(`${at} repeats the gimmicks of the floor below`);
    prev = key;
    const boss = isFrontierBossFloor(rules, f.floor);
    if (boss !== (f.guardianTitle !== undefined)) issue(boss ? `${at} is a boss floor without a guardian title` : `${at} has a guardian title but no boss`);
    const mono = f.modifiers.includes("mono_element");
    if (mono !== (f.element !== undefined)) issue(mono ? `${at}: mono_element needs the floor's element` : `${at}: an element without mono_element`);
    if (mono && f.element !== undefined && frontierSpeciesLadder(content.species).every((s) => !s.allowedElements.includes(f.element!))) issue(`${at}: no species carries ${f.element}`);
    if (f.modifiers.includes("reserves") && f.floor < tune(rules).reinforceFromFloor) issue(`${at}: reserves before reinforcements start (floor ${tune(rules).reinforceFromFloor})`);
  });
  return out;
}
