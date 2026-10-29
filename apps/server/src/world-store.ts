/**
 * Canonical character location in D1 (player_positions). The Map Channel DO asks this store where
 * a joining player is allowed to appear, and saves positions back under a generation guard.
 *
 * - A brand-new character may only appear on the start map, at its spawn.
 * - A player may only join the map their saved position is on. Asking for another map is answered
 *   with that map (WRONG_MAP), so a client cannot teleport by connecting somewhere else.
 * - Switching channel on the same map is allowed and keeps the position (chapter 07 §3).
 * - Each join bumps `generation`. Saves and portal moves carry the generation they joined with and
 *   are ignored once a newer join exists.
 */
import { isWalkable, portalAt, type MapDefinition, type TilePos } from "@pmrpg/shared";
import type { SqlDb } from "./reward-ledger";

interface PositionRow {
  map_id: string;
  channel: number;
  x: number;
  y: number;
  generation: number;
}

export type ClaimResult =
  | { status: "joined"; pos: TilePos; generation: number; previous: { mapId: string; channel: number } | null }
  | { status: "wrong_map"; mapId: string; channel: number }
  | { status: "no_account" }
  | { status: "conflict" };

export class WorldStore {
  constructor(
    private readonly db: SqlDb,
    private readonly maps: Map<string, MapDefinition>,
    private readonly startMapId: string,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async where(accountId: string): Promise<{ mapId: string; channel: number } | null> {
    const row = await this.row(accountId);
    return row === null ? null : { mapId: row.map_id, channel: row.channel };
  }

  /** Claim this account's position for `mapId`/`channel`, bumping its generation. */
  async claim(accountId: string, mapId: string, channel: number): Promise<ClaimResult> {
    const map = this.maps.get(mapId);
    if (map === undefined) throw new Error(`unknown map ${mapId}`);
    for (let attempt = 0; attempt < 3; attempt++) {
      const row = await this.row(accountId);
      if (row === null) {
        if (mapId !== this.startMapId) return { status: "wrong_map", mapId: this.startMapId, channel: 1 };
        const account = await this.db.prepare(`SELECT 1 AS x FROM accounts WHERE id = ?`).bind(accountId).first();
        if (account === null) return { status: "no_account" };
        await this.db
          .prepare(
            `INSERT INTO player_positions (account_id, map_id, channel, x, y, generation, updated_at)
             VALUES (?, ?, ?, ?, ?, 1, ?) ON CONFLICT DO NOTHING`,
          )
          .bind(accountId, mapId, channel, map.spawn.x, map.spawn.y, this.now())
          .run();
        const created = await this.row(accountId);
        // Someone else created it concurrently: go round again and claim normally.
        if (created !== null && created.generation === 1 && created.channel === channel && created.map_id === mapId) {
          return { status: "joined", pos: { x: created.x, y: created.y }, generation: 1, previous: null };
        }
        continue;
      }
      if (row.map_id !== mapId) return { status: "wrong_map", mapId: row.map_id, channel: row.channel };
      const next = row.generation + 1;
      await this.db
        .prepare(`UPDATE player_positions SET channel = ?, generation = ?, updated_at = ? WHERE account_id = ? AND generation = ?`)
        .bind(channel, next, this.now(), accountId, row.generation)
        .run();
      const after = await this.row(accountId);
      if (after?.generation !== next || after.channel !== channel) continue;
      // Content may have changed under a saved position: fall back to spawn rather than a wall.
      const saved = { x: row.x, y: row.y };
      const pos = isWalkable(map, saved.x, saved.y) && portalAt(map, saved.x, saved.y) === null ? saved : { ...map.spawn };
      return { status: "joined", pos, generation: next, previous: { mapId: row.map_id, channel: row.channel } };
    }
    return { status: "conflict" };
  }

  /** Save a live position. Ignored (false) once a newer join holds the account. */
  async save(accountId: string, generation: number, mapId: string, pos: TilePos): Promise<boolean> {
    await this.db
      .prepare(`UPDATE player_positions SET x = ?, y = ?, updated_at = ? WHERE account_id = ? AND generation = ? AND map_id = ?`)
      .bind(pos.x, pos.y, this.now(), accountId, generation, mapId)
      .run();
    const row = await this.row(accountId);
    return row !== null && row.generation === generation && row.map_id === mapId && row.x === pos.x && row.y === pos.y;
  }

  /** Portal: move the saved position to another map. The destination channel claims it on join. */
  async moveTo(accountId: string, generation: number, fromMapId: string, to: { mapId: string; x: number; y: number }, channel: number): Promise<boolean> {
    await this.db
      .prepare(
        `UPDATE player_positions SET map_id = ?, x = ?, y = ?, channel = ?, updated_at = ?
         WHERE account_id = ? AND generation = ? AND map_id = ?`,
      )
      .bind(to.mapId, to.x, to.y, channel, this.now(), accountId, generation, fromMapId)
      .run();
    const row = await this.row(accountId);
    return row !== null && row.generation === generation && row.map_id === to.mapId && row.x === to.x && row.y === to.y;
  }

  private row(accountId: string): Promise<PositionRow | null> {
    return this.db
      .prepare(`SELECT map_id, channel, x, y, generation FROM player_positions WHERE account_id = ?`)
      .bind(accountId)
      .first<PositionRow>();
  }
}
