/**
 * Visible packs and private encounters (chapter 07 §3, chapter 11 §3 step 1; O05 decided 2026-10-03).
 *
 * - The server rolls each pack once per respawn cycle and keeps the roster; reloading never
 *   re-rolls it, and the leader you see is in the fight with the same species and element.
 * - Everyone in the channel sees the same packs. Engaging gives that player a private fight;
 *   nobody else's pack disappears (no kill-stealing).
 * - A player fights a given pack instance once. It shows again for them when the next cycle
 *   rolls a new pack. There is no daily cap or energy: the wait is the respawn time only.
 */
import type { RulesConfig } from "../rules";
import { Rng, seedRng } from "../rng";
import type { BossDefinition, Element, SpeciesDefinition } from "../schemas";
import type { BattleSetup } from "../battle/types";
import { isWalkable, portalAt, type MapDefinition, type SpawnPoint, type TilePos } from "./map";
import { rollEliteModifiers, type EliteModifier } from "../elite";

export interface PackMember {
  speciesId: string;
  element: Element;
  /** The leader of an ELITE pack: its modifiers, rolled with the pack (elite.ts). */
  elite?: EliteModifier[];
}

/** A rolled pack. Server-side; the exact roster beyond the leader is not shown before the fight. */
export interface PackInstance {
  /** Unique per map, channel, spawn point and cycle; fights are keyed on it. */
  packId: string;
  spawnId: string;
  at: TilePos;
  rank: SpawnPoint["rank"];
  sizeRange: [number, number];
  members: PackMember[];
}

/** What a client sees before engaging (chapter 07 §3: leader level/element, rank, size range). */
export interface VisiblePack {
  packId: string;
  spawnId: string;
  x: number;
  y: number;
  rank: SpawnPoint["rank"] | "BOSS";
  sizeRange: [number, number];
  leader: { speciesId: string; element: Element; level: number; elite?: EliteModifier[] };
  /** Boss lairs only: which boss waits there (chapter 07 §5). */
  bossId?: string;
}

/** The engage id of a map's boss lair. Each try gets its own fight (`bossAttemptId`). */
export const bossLairId = (mapId: string) => `${mapId}#boss`;
export const bossAttemptId = (mapId: string, attempt: number) => `${bossLairId(mapId)}:${attempt}`;

/** A map's boss as players see it: the boss is the leader; the size counts its adds. */
export function visibleBoss(map: MapDefinition, bosses: ReadonlyMap<string, BossDefinition>, species: ReadonlyMap<string, SpeciesDefinition>): VisiblePack | null {
  const lair = map.bossLair;
  const def = lair === undefined ? undefined : bosses.get(lair.bossId);
  if (lair === undefined || def === undefined) return null;
  const size = 1 + def.adds.length;
  return {
    packId: bossLairId(map.id),
    spawnId: "boss",
    x: lair.at.x,
    y: lair.at.y,
    rank: "BOSS",
    sizeRange: [size, size],
    leader: { speciesId: def.speciesId, element: def.element, level: species.get(def.speciesId)?.fixedWildLevel ?? 0 },
    bossId: def.id,
  };
}

export const packCycle = (rules: RulesConfig, now: number) => Math.floor(now / rules.provisional.packRespawnMs.value);

export const packInstanceId = (mapId: string, channel: number, spawnId: string, cycle: number) =>
  `${mapId}#${channel}:${spawnId}:${cycle}`;

function weighted<T>(rng: Rng, items: readonly T[], weight: (t: T) => number): T {
  const total = items.reduce((s, t) => s + weight(t), 0);
  let r = rng.nextInt(total);
  for (const t of items) {
    r -= weight(t);
    if (r < 0) return t;
  }
  return items[items.length - 1]!;
}

/**
 * Roll a pack from a spawn point with server RNG. An ELITE spawn's leader also gets its modifiers,
 * which needs `rules` and the species (for the leader's wild level).
 */
export function rollPack(spawn: SpawnPoint, packId: string, rng: Rng, elite?: { rules: RulesConfig; species: ReadonlyMap<string, SpeciesDefinition> }): PackInstance {
  const [min, max] = spawn.packSize;
  const size = min + rng.nextInt(max - min + 1);
  const members: PackMember[] = [];
  for (let i = 0; i < size; i++) {
    const entry = weighted(rng, spawn.entries, (e) => e.weight);
    const elements = Object.entries(entry.elementWeights).filter(([, w]) => (w ?? 0) > 0) as [Element, number][];
    const [element] = weighted(rng, elements, ([, w]) => w);
    members.push({ speciesId: entry.speciesId, element });
  }
  if (spawn.rank === "ELITE") {
    if (elite === undefined) throw new Error(`rollPack: elite spawn ${spawn.id} needs rules and species`);
    const leader = members[0]!;
    leader.elite = rollEliteModifiers(elite.rules, elite.species.get(leader.speciesId)?.fixedWildLevel ?? 1, rng);
  }
  return { packId, spawnId: spawn.id, at: { ...spawn.at }, rank: spawn.rank, sizeRange: [min, max], members };
}

/** `at`: where the pack stands now (packPositionAt); defaults to its spawn point. */
export function visiblePack(p: PackInstance, species: ReadonlyMap<string, SpeciesDefinition>, at: TilePos = p.at): VisiblePack {
  const leader = p.members[0]!;
  return {
    packId: p.packId,
    spawnId: p.spawnId,
    x: at.x,
    y: at.y,
    rank: p.rank,
    sizeRange: [...p.sizeRange],
    leader: {
      speciesId: leader.speciesId,
      element: leader.element,
      level: species.get(leader.speciesId)?.fixedWildLevel ?? 0,
      ...(leader.elite !== undefined ? { elite: [...leader.elite] } : {}),
    },
  };
}

/** Standing next to the pack (or on it) is close enough to engage. */
export function inEngageRange(rules: RulesConfig, player: TilePos, pack: TilePos): boolean {
  const r = rules.provisional.engageRangeTiles.value;
  return Math.max(Math.abs(player.x - pack.x), Math.abs(player.y - pack.y)) <= r;
}

/** How many wander steps a pack of the current cycle has taken at `now` (P33). */
export const packWanderStep = (rules: RulesConfig, now: number) =>
  Math.floor((now % rules.provisional.packRespawnMs.value) / rules.provisional.packWander.value.stepMs);

/**
 * Where a pack stands after `step` wander steps (P33). Each step is one orthogonal tile or a pause,
 * chosen from the pack id and step number, so every server call agrees without storing anything.
 * The pack keeps to walkable, non-portal tiles within `radiusTiles` of its spawn point.
 */
export function packPositionAt(rules: RulesConfig, map: MapDefinition, pack: Pick<PackInstance, "packId" | "at">, step: number): TilePos {
  const radius = rules.provisional.packWander.value.radiusTiles;
  let pos = { ...pack.at };
  for (let i = 1; i <= step; i++) {
    const options = [pos, { x: pos.x, y: pos.y - 1 }, { x: pos.x + 1, y: pos.y }, { x: pos.x, y: pos.y + 1 }, { x: pos.x - 1, y: pos.y }].filter(
      (t, k) =>
        k === 0 ||
        (Math.max(Math.abs(t.x - pack.at.x), Math.abs(t.y - pack.at.y)) <= radius && isWalkable(map, t.x, t.y) && portalAt(map, t.x, t.y) === null),
    );
    pos = { ...options[new Rng(seedRng(`${pack.packId}~${i}`)).nextInt(options.length)]! };
  }
  return pos;
}

/**
 * Whether a player can engage a wandering pack: next to where it stands now, or where it stood one
 * step ago (a click sent just before the pack moved still counts).
 */
export function inWanderEngageRange(rules: RulesConfig, map: MapDefinition, player: TilePos, pack: Pick<PackInstance, "packId" | "at">, now: number): boolean {
  const step = packWanderStep(rules, now);
  return inEngageRange(rules, player, packPositionAt(rules, map, pack, step)) || (step > 0 && inEngageRange(rules, player, packPositionAt(rules, map, pack, step - 1)));
}

/** Hunting only happens on field and dungeon maps (chapter 07 §4: town no hunt). */
export const huntingAllowed = (map: MapDefinition) => map.kind !== "town";

/**
 * Enemy formation for a pack: leader front-centre, then alternate front and back rows.
 * Enemy rows have 5 slots each (A3), so up to 10 fit (C05).
 */
export function packEnemies(p: PackInstance): BattleSetup["enemies"] {
  const front = [2, 1, 3, 0, 4];
  const back = [2, 1, 3, 0, 4];
  return p.members.map((m, i) => {
    const row = i % 2 === 0 ? "front" : "back";
    const slot = (row === "front" ? front : back)[Math.floor(i / 2)]!;
    return { unitId: `e${i + 1}`, speciesId: m.speciesId, element: m.element, row, slot, ...(m.elite !== undefined ? { elite: { modifiers: [...m.elite] } } : {}) };
  });
}

/**
 * Default combat bag from what the player owns: heal and capture items (plus other combat kinds),
 * each capped by its stack limit, at most `combatBagMaxTypes` types (P15). There is no loadout
 * screen yet; this is the prototype's stand-in for one.
 */
export function defaultCombatBag(
  rules: RulesConfig,
  owned: Readonly<Record<string, number>>,
  itemKind: (itemId: string) => string | undefined,
  /** Items packed first, in this order (Auto Hunt packs the items its rules name before the rest). */
  prefer: readonly string[] = [],
): Record<string, number> {
  const caps = rules.provisional.combatBagStackCaps.value as Record<string, number>;
  const order = ["heal", "mana", "capture", "revive", "support", "attack"];
  const rank = (id: string) => (prefer.includes(id) ? prefer.indexOf(id) : prefer.length);
  const candidates = Object.entries(owned)
    .map(([id, qty]) => ({ id, qty, kind: itemKind(id) }))
    .filter((c) => c.qty > 0 && c.kind !== undefined && caps[c.kind] !== undefined)
    .sort((a, b) => rank(a.id) - rank(b.id) || order.indexOf(a.kind!) - order.indexOf(b.kind!) || (a.id < b.id ? -1 : 1))
    .slice(0, rules.provisional.combatBagMaxTypes.value);
  return Object.fromEntries(candidates.map((c) => [c.id, Math.min(c.qty, caps[c.kind!]!)]));
}
