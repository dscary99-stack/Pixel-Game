/**
 * Walkable map contracts for the Phase B walking slice (chapter 07, chapter 10 §2, chapter 13 §1 B).
 *
 * A map is a tile grid. The server owns collision: the same definition drives the Map Channel
 * Durable Object and the client's drawing, so there is one source of truth for what is walkable.
 * Art (tilesets, y-sorting, occlusion) is not part of this contract yet.
 */
import { z } from "zod";

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
 * every portal lands on a walkable, non-portal tile of a map that exists.
 */
export function validateMaps(maps: readonly MapDefinition[]): MapIssue[] {
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
  }
  return issues;
}
