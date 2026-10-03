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
import type { Rng } from "../rng";
import type { Element, SpeciesDefinition } from "../schemas";
import type { BattleSetup } from "../battle/types";
import type { MapDefinition, SpawnPoint, TilePos } from "./map";

export interface PackMember {
  speciesId: string;
  element: Element;
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
  rank: SpawnPoint["rank"];
  sizeRange: [number, number];
  leader: { speciesId: string; element: Element; level: number };
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

/** Roll a pack from a spawn point with server RNG. */
export function rollPack(spawn: SpawnPoint, packId: string, rng: Rng): PackInstance {
  const [min, max] = spawn.packSize;
  const size = min + rng.nextInt(max - min + 1);
  const members: PackMember[] = [];
  for (let i = 0; i < size; i++) {
    const entry = weighted(rng, spawn.entries, (e) => e.weight);
    const elements = Object.entries(entry.elementWeights).filter(([, w]) => (w ?? 0) > 0) as [Element, number][];
    const [element] = weighted(rng, elements, ([, w]) => w);
    members.push({ speciesId: entry.speciesId, element });
  }
  return { packId, spawnId: spawn.id, at: { ...spawn.at }, rank: spawn.rank, sizeRange: [min, max], members };
}

export function visiblePack(p: PackInstance, species: ReadonlyMap<string, SpeciesDefinition>): VisiblePack {
  const leader = p.members[0]!;
  return {
    packId: p.packId,
    spawnId: p.spawnId,
    x: p.at.x,
    y: p.at.y,
    rank: p.rank,
    sizeRange: [...p.sizeRange],
    leader: { speciesId: leader.speciesId, element: leader.element, level: species.get(leader.speciesId)?.fixedWildLevel ?? 0 },
  };
}

/** Standing next to the pack (or on it) is close enough to engage. */
export function inEngageRange(rules: RulesConfig, player: TilePos, pack: TilePos): boolean {
  const r = rules.provisional.engageRangeTiles.value;
  return Math.max(Math.abs(player.x - pack.x), Math.abs(player.y - pack.y)) <= r;
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
    return { unitId: `e${i + 1}`, speciesId: m.speciesId, element: m.element, row, slot };
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
): Record<string, number> {
  const caps = rules.provisional.combatBagStackCaps.value as Record<string, number>;
  const order = ["heal", "capture", "revive", "support", "attack"];
  const candidates = Object.entries(owned)
    .map(([id, qty]) => ({ id, qty, kind: itemKind(id) }))
    .filter((c) => c.qty > 0 && c.kind !== undefined && caps[c.kind] !== undefined)
    .sort((a, b) => order.indexOf(a.kind!) - order.indexOf(b.kind!) || (a.id < b.id ? -1 : 1))
    .slice(0, rules.provisional.combatBagMaxTypes.value);
  return Object.fromEntries(candidates.map((c) => [c.id, Math.min(c.qty, caps[c.kind!]!)]));
}
