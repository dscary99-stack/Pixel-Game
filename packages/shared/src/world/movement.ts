/**
 * Server-authoritative walking (chapter 11 §1: "movement sends intent/direction; the server checks
 * range against server time"). The client asks for one tile step at a time; the server accepts it
 * only if the target tile is walkable and the step is not faster than the walk speed allows.
 *
 * Timing uses a "ready at" clock: each accepted step pushes `readyAt` forward by its cost, starting
 * from now if the player was standing still. A step may arrive up to `moveBurstMs` before its
 * scheduled time (network jitter bunches messages together), but no more: standing still does
 * not bank extra steps, so a client can never move faster than the walk speed plus that allowance.
 */
import type { RulesConfig } from "../rules";
import { isWalkable, type MapDefinition, type TilePos } from "./map";

export const DIRECTIONS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;
export type Direction = (typeof DIRECTIONS)[number];

export const DIR_DELTA: Record<Direction, readonly [number, number]> = {
  N: [0, -1],
  NE: [1, -1],
  E: [1, 0],
  SE: [1, 1],
  S: [0, 1],
  SW: [-1, 1],
  W: [-1, 0],
  NW: [-1, -1],
};

export const isDiagonal = (d: Direction) => d.length === 2;

/** Facing for 4-direction art (P10: 8-direction movement, 4-direction art). */
export function artFacing(d: Direction): "N" | "E" | "S" | "W" {
  if (d === "N" || d === "S" || d === "E" || d === "W") return d;
  // Diagonals keep the horizontal facing so weapons stay on the correct side.
  return d.endsWith("E") ? "E" : "W";
}

export function stepCostMs(rules: RulesConfig, d: Direction): number {
  const base = rules.provisional.walkStepMs.value;
  return isDiagonal(d) ? Math.round(base * rules.provisional.diagonalStepFactor.value) : base;
}

export type StepRejection = "BLOCKED" | "CORNER_BLOCKED" | "TOO_FAST";

export type StepResult =
  | { ok: true; pos: TilePos; readyAt: number }
  | { ok: false; reason: StepRejection };

/**
 * Validate one step. `readyAt` is the earliest server time (ms) the next step may start.
 * Pure: the caller stores the returned position and readyAt.
 */
export function tryStep(rules: RulesConfig, map: MapDefinition, from: TilePos, dir: Direction, readyAt: number, now: number): StepResult {
  const [dx, dy] = DIR_DELTA[dir];
  const to = { x: from.x + dx, y: from.y + dy };
  if (!isWalkable(map, to.x, to.y)) return { ok: false, reason: "BLOCKED" };
  // No cutting corners: a diagonal needs both orthogonal neighbours open.
  if (isDiagonal(dir) && (!isWalkable(map, from.x + dx, from.y) || !isWalkable(map, from.x, from.y + dy))) {
    return { ok: false, reason: "CORNER_BLOCKED" };
  }
  if (now < readyAt - rules.provisional.moveBurstMs.value) return { ok: false, reason: "TOO_FAST" };
  return { ok: true, pos: to, readyAt: Math.max(readyAt, now) + stepCostMs(rules, dir) };
}

/**
 * Shortest 8-direction path (BFS, same corner rule as tryStep) for click/tap-to-move.
 * Runs on the client to turn a tap into steps; the server still checks every step.
 * Returns null when the target cannot be reached.
 */
export function findPath(map: MapDefinition, from: TilePos, to: TilePos, maxNodes = 4096): Direction[] | null {
  if (!isWalkable(map, to.x, to.y)) return null;
  if (from.x === to.x && from.y === to.y) return [];
  const key = (p: TilePos) => `${p.x},${p.y}`;
  const prev = new Map<string, { from: string; dir: Direction }>();
  const seen = new Set([key(from)]);
  const queue: TilePos[] = [from];
  // Orthogonal first so ties prefer straight lines.
  const order: Direction[] = ["N", "E", "S", "W", "NE", "SE", "SW", "NW"];
  while (queue.length > 0 && seen.size <= maxNodes) {
    const cur = queue.shift()!;
    for (const dir of order) {
      const [dx, dy] = DIR_DELTA[dir];
      const next = { x: cur.x + dx, y: cur.y + dy };
      const k = key(next);
      if (seen.has(k) || !isWalkable(map, next.x, next.y)) continue;
      if (isDiagonal(dir) && (!isWalkable(map, cur.x + dx, cur.y) || !isWalkable(map, cur.x, cur.y + dy))) continue;
      seen.add(k);
      prev.set(k, { from: key(cur), dir });
      if (next.x === to.x && next.y === to.y) {
        const dirs: Direction[] = [];
        for (let at = k; at !== key(from); ) {
          const p = prev.get(at)!;
          dirs.push(p.dir);
          at = p.from;
        }
        return dirs.reverse();
      }
      queue.push(next);
    }
  }
  return null;
}
