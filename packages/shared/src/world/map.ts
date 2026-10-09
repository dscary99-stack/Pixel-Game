/**
 * Walkable map contracts for the Phase B walking slice (chapter 07, chapter 10 §2, chapter 13 §1 B).
 *
 * A map is a tile grid. The server owns collision: the same definition drives the Map Channel
 * Durable Object and the client's drawing, so there is one source of truth for what is walkable.
 * Art (tilesets, y-sorting, occlusion) is not part of this contract yet.
 */
import { z } from "zod";
import { RULES } from "../rules";
import { SpawnEntrySchema, type BossDefinition, type SpeciesDefinition } from "../schemas";

export const MapId = z.string().regex(/^map:[a-z0-9_]+$/, 'expected id like "map:snake_case"');

/**
 * Tile legend. Anything not listed here is invalid.
 *   .  ground        ,  grass (walkable)     =  road / floor (walkable)
 *   #  wall          T  tree                 ~  water            (blocked)
 */
export const TILE_LEGEND = {
  ".": { walkable: true, kind: "ground" },
  ",": { walkable: true, kind: "grass" },
  "=": { walkable: true, kind: "road" },
  "#": { walkable: false, kind: "wall" },
  T: { walkable: false, kind: "tree" },
  "~": { walkable: false, kind: "water" },
} as const;
export type TileChar = keyof typeof TILE_LEGEND;

export const TilePosSchema = z.object({ x: z.number().int().min(0), y: z.number().int().min(0) }).strict();
export type TilePos = z.infer<typeof TilePosSchema>;

export const PortalSchema = z
  .object({
    /** Stepping onto this tile moves the player to `to`. */
    at: TilePosSchema,
    to: z.object({ mapId: MapId, x: z.number().int().min(0), y: z.number().int().min(0) }).strict(),
    label: z.string().min(1),
  })
  .strict();
export type Portal = z.infer<typeof PortalSchema>;

/**
 * A place on a field map where a visible pack stands (chapter 07 §3). The server rolls the pack
 * from `entries`; everyone in the channel sees the same pack, and each player who engages gets a
 * private fight against exactly that roster (O05, decided 2026-10-03).
 */
export const SpawnPointSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9_]{1,24}$/),
    at: TilePosSchema,
    rank: z.enum(["NORMAL", "ELITE"]),
    /** [min, max] enemies in the pack; the player sees this range before engaging. */
    packSize: z.tuple([z.number().int().min(1), z.number().int().min(1)]),
    /** Weighted species and element weights; the first roll is the visible leader. */
    entries: z.array(SpawnEntrySchema).min(1),
  })
  .strict();
export type SpawnPoint = z.infer<typeof SpawnPointSchema>;

/**
 * What a town NPC opens when clicked. Each one is a town service the server already gates to towns;
 * `talk` NPCs only speak (rest point, travel and lore tellers until those systems exist).
 */
export const NPC_SERVICES = ["shop", "craft", "refine", "orders", "frontier", "rebirth", "skills", "equipment", "quests", "party", "team", "journal", "market", "trade", "vault", "practice", "talk"] as const;
export type NpcService = (typeof NPC_SERVICES)[number];

/**
 * A town NPC (story doc: every service has a person with a part in the world). NPCs are markers,
 * not walls: they never change collision, so movement stays a property of the tiles alone.
 */
export const NpcPlacementSchema = z
  .object({
    id: z.string().regex(/^npc:[a-z0-9_]+$/),
    at: TilePosSchema,
    name: z.object({ th: z.string().min(1), en: z.string().min(1).optional() }).strict(),
    /** What they do, one short line shown under the name. */
    role: z.object({ th: z.string().min(1) }).strict(),
    /** First service is what a click opens; with more than one, a click offers a choice. */
    services: z.array(z.enum(NPC_SERVICES)).min(1),
    /** What they say when clicked (story placeholder until the dialogue pass). */
    line: z.object({ th: z.string().min(1) }).strict(),
  })
  .strict();
export type NpcPlacement = z.infer<typeof NpcPlacementSchema>;

export const MapDefinitionSchema = z
  .object({
    id: MapId,
    version: z.number().int().min(1),
    status: z.enum(["draft", "validated", "published", "retired"]),
    example: z.boolean(),
    name: z.object({ th: z.string().min(1), en: z.string().min(1).optional() }).strict(),
    /** Town maps never spawn hunts (chapter 07 §4). Encounters are Phase C. */
    kind: z.enum(["town", "field", "dungeon"]),
    /** Rows of tile characters, top to bottom. */
    tiles: z.array(z.string().min(1)).min(1),
    /** Where a player with no saved position on this map appears. */
    spawn: TilePosSchema,
    portals: z.array(PortalSchema),
    spawns: z.array(SpawnPointSchema),
    /**
     * Where the map's boss waits (C30: every hunting map has one). Players start it by hand and can
     * try again with no quota (P17); it is never an Auto Hunt target (C14).
     */
    bossLair: z.object({ bossId: z.string().regex(/^boss:[a-z0-9_]+$/), at: TilePosSchema }).strict().optional(),
    /** Town people (towns only). */
    npcs: z.array(NpcPlacementSchema).optional(),
  })
  .strict();
export type MapDefinition = z.infer<typeof MapDefinitionSchema>;

export const mapWidth = (m: MapDefinition) => m.tiles[0]!.length;
export const mapHeight = (m: MapDefinition) => m.tiles.length;

export function tileAt(m: MapDefinition, x: number, y: number): TileChar | null {
  if (!Number.isInteger(x) || !Number.isInteger(y) || y < 0 || y >= m.tiles.length) return null;
  const c = m.tiles[y]![x];
  return c !== undefined && c in TILE_LEGEND ? (c as TileChar) : null;
}

export function isWalkable(m: MapDefinition, x: number, y: number): boolean {
  const t = tileAt(m, x, y);
  return t !== null && TILE_LEGEND[t].walkable;
}

export function portalAt(m: MapDefinition, x: number, y: number): Portal | null {
  return m.portals.find((p) => p.at.x === x && p.at.y === y) ?? null;
}

export interface MapIssue {
  mapId: string;
  message: string;
}

/**
 * Registry validator: grid is rectangular with known tiles, spawn and portal tiles are walkable,
 * every portal lands on a walkable, non-portal tile of a map that exists. With a species registry,
 * pack spawns are checked too: towns have none, packs fit the enemy cap (C05), species exist and
 * elements are ones the species can have (C07).
 */
export function validateMaps(
  maps: readonly MapDefinition[],
  species?: ReadonlyMap<string, SpeciesDefinition>,
  bosses?: ReadonlyMap<string, BossDefinition>,
): MapIssue[] {
  const issues: MapIssue[] = [];
  const byId = new Map(maps.map((m) => [m.id, m]));
  if (byId.size !== maps.length) issues.push({ mapId: "*", message: "duplicate map id" });
  for (const m of maps) {
    const parsed = MapDefinitionSchema.safeParse(m);
    if (!parsed.success) {
      issues.push({ mapId: m.id, message: parsed.error.issues.map((i) => i.message).join("; ") });
      continue;
    }
    const w = mapWidth(m);
    m.tiles.forEach((row, y) => {
      if (row.length !== w) issues.push({ mapId: m.id, message: `row ${y} has width ${row.length}, expected ${w}` });
      [...row].forEach((c, x) => {
        if (!(c in TILE_LEGEND)) issues.push({ mapId: m.id, message: `unknown tile "${c}" at ${x},${y}` });
      });
    });
    if (!isWalkable(m, m.spawn.x, m.spawn.y)) issues.push({ mapId: m.id, message: "spawn is not walkable" });
    if (portalAt(m, m.spawn.x, m.spawn.y) !== null) issues.push({ mapId: m.id, message: "spawn is on a portal" });
    for (const p of m.portals) {
      if (!isWalkable(m, p.at.x, p.at.y)) issues.push({ mapId: m.id, message: `portal at ${p.at.x},${p.at.y} is not walkable` });
      const target = byId.get(p.to.mapId);
      if (target === undefined) {
        issues.push({ mapId: m.id, message: `portal to unknown map ${p.to.mapId}` });
        continue;
      }
      if (!isWalkable(target, p.to.x, p.to.y)) issues.push({ mapId: m.id, message: `portal lands on a blocked tile of ${p.to.mapId}` });
      if (portalAt(target, p.to.x, p.to.y) !== null) issues.push({ mapId: m.id, message: `portal lands on another portal in ${p.to.mapId}` });
    }
    if (m.kind === "town" && m.spawns.length > 0) issues.push({ mapId: m.id, message: "towns have no hunting spawns" });
    if (m.kind === "town" && m.bossLair !== undefined) issues.push({ mapId: m.id, message: "towns have no boss (P17: a trial arena instead)" });
    if (m.kind !== "town" && m.bossLair === undefined) issues.push({ mapId: m.id, message: "every hunting map has a boss (C30)" });
    if (m.bossLair !== undefined) {
      const at = m.bossLair.at;
      if (!isWalkable(m, at.x, at.y) || portalAt(m, at.x, at.y) !== null) issues.push({ mapId: m.id, message: "boss lair is not on open ground" });
      if (bosses !== undefined && !bosses.has(m.bossLair.bossId)) issues.push({ mapId: m.id, message: `boss lair uses unknown boss ${m.bossLair.bossId}` });
    }
    const npcs = m.npcs ?? [];
    if (m.kind !== "town" && npcs.length > 0) issues.push({ mapId: m.id, message: "only towns have service NPCs" });
    const npcIds = new Set<string>();
    const npcCells = new Set<string>();
    for (const n of npcs) {
      if (npcIds.has(n.id)) issues.push({ mapId: m.id, message: `${n.id} is duplicated` });
      npcIds.add(n.id);
      const cell = `${n.at.x},${n.at.y}`;
      if (npcCells.has(cell)) issues.push({ mapId: m.id, message: `${n.id} shares a tile with another NPC` });
      npcCells.add(cell);
      if (!isWalkable(m, n.at.x, n.at.y) || portalAt(m, n.at.x, n.at.y) !== null) issues.push({ mapId: m.id, message: `${n.id} is not on open ground` });
      if (n.at.x === m.spawn.x && n.at.y === m.spawn.y) issues.push({ mapId: m.id, message: `${n.id} stands on the spawn tile` });
      if (new Set(n.services).size !== n.services.length) issues.push({ mapId: m.id, message: `${n.id} lists a service twice` });
    }
    const spawnIds = new Set<string>();
    for (const sp of m.spawns) {
      const where = `spawn ${sp.id}`;
      if (spawnIds.has(sp.id)) issues.push({ mapId: m.id, message: `${where} id is duplicated` });
      spawnIds.add(sp.id);
      if (!isWalkable(m, sp.at.x, sp.at.y) || portalAt(m, sp.at.x, sp.at.y) !== null) issues.push({ mapId: m.id, message: `${where} is not on open ground` });
      const [min, max] = sp.packSize;
      if (min > max) issues.push({ mapId: m.id, message: `${where} pack size min > max` });
      if (max > RULES.confirmed.maxEnemyUnits.value) issues.push({ mapId: m.id, message: `${where} pack can exceed ${RULES.confirmed.maxEnemyUnits.value} enemies` });
      if (species === undefined) continue;
      for (const e of sp.entries) {
        const def = species.get(e.speciesId);
        if (def === undefined) {
          issues.push({ mapId: m.id, message: `${where} uses unknown species ${e.speciesId}` });
          continue;
        }
        const elements = Object.entries(e.elementWeights).filter(([, w]) => (w ?? 0) > 0).map(([el]) => el);
        if (elements.length === 0) issues.push({ mapId: m.id, message: `${where} ${e.speciesId} has no element weights` });
        for (const el of elements) {
          if (!def.allowedElements.includes(el as never)) issues.push({ mapId: m.id, message: `${where} ${e.speciesId} cannot be ${el}` });
        }
      }
    }
  }
  return issues;
}
