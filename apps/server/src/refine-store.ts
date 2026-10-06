/**
 * Refining / ตีบวก on D1 (migration 0025; rules in refine.ts, Nut's REFINEMENT_DESIGN v2.1).
 *
 * One attempt is one batch. The anchor row in refine_operations is inserted only when every guard
 * holds (in town, no open fight, the piece is the caller's, free, at the level, version, Sigils and
 * slot the request saw, and coins, stones and the picked ward are there). It carries the receipt:
 * the server's roll, the outcome and what was paid. Every other write applies only under that row's
 * token, so a losing racer changes nothing, and a retry with the same operation id gets the stored
 * receipt back: no second charge, no second roll.
 *
 * A destroyed piece is taken off, its live row deleted and a snapshot kept in disposed_assets as the
 * tombstone. Its Sigils are lost with it (O16, Nut 2026-10-07): a risky attempt without a ward on a
 * piece with Sigils must say `acceptSigilLoss` (the client warns first), else it is refused before
 * anything is spent.
 */
import { RefineRequestSchema, refineQuote, refineSucceeds, type EquipSlot, type EquipmentDefinition, type RefineResult, type RulesConfig, type ItemDefinition } from "@pmrpg/shared";
import { hashJson, type SqlBound, type SqlDb } from "./reward-ledger";

export type RefineRejection =
  | "INVALID_REQUEST"
  | "PAYLOAD_MISMATCH"
  | "NOT_OWNER"
  | "NOT_IN_TOWN"
  | "IN_BATTLE"
  | "ASSET_LOCKED"
  | "NOT_REFINABLE"
  | "MAX_LEVEL"
  | "COST_CHANGED"
  | "WARD_NOT_USED_HERE"
  | "WARD_MISMATCH"
  | "NO_WARD"
  | "INSUFFICIENT_COINS"
  | "INSUFFICIENT_STONES"
  | "SIGILS_WOULD_BREAK"
  | "CHANGED";

export type RefineOutcome = { status: "done"; replayed: boolean; result: RefineResult } | { status: "rejected"; reason: RefineRejection; message: string };

interface PieceRow {
  id: string;
  definition_id: string;
  refine_level: number;
  version: number;
  lock_state: string;
  sigil_sockets_json: string;
  slot: EquipSlot | null;
}

const OPEN_BATTLE = `EXISTS (SELECT 1 FROM battle_reservations WHERE account_id = ? AND status IN ('reserved', 'active'))`;
const reject = (reason: RefineRejection, message: string) => ({ status: "rejected" as const, reason, message });
const marks = (n: number) => Array.from({ length: n }, () => "?").join(", ");
const balance = (table: "coin_ledger" | "item_ledger") =>
  table === "coin_ledger" ? `(SELECT COALESCE(SUM(delta), 0) FROM coin_ledger WHERE account_id = ?)` : `(SELECT COALESCE(SUM(delta), 0) FROM item_ledger WHERE account_id = ? AND item_id = ?)`;

/** A uniform 0..9999 from the platform's CSPRNG (rejection sampling, no modulo bias). */
export function secureRoll(): number {
  const buf = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buf);
    if (buf[0]! < 4_294_960_000) return buf[0]! % 10_000;
  }
}

export class RefineStore {
  constructor(
    private readonly db: SqlDb,
    private readonly rules: RulesConfig,
    private readonly content: { equipment: ReadonlyMap<string, EquipmentDefinition>; items: ReadonlyMap<string, ItemDefinition> },
    private readonly townMapIds: readonly string[],
    private readonly roll: () => number = secureRoll,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async refine(accountId: string, raw: unknown): Promise<RefineOutcome> {
    const parsed = RefineRequestSchema.safeParse(raw);
    if (!parsed.success) return reject("INVALID_REQUEST", parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
    const { operationId, equipmentId, expectedLevel, expectedVersion, wardItemId, expectedCost, acceptSigilLoss } = parsed.data;
    const hash = await hashJson({ kind: "refine", equipmentId, expectedLevel, expectedVersion, wardItemId, expectedCost, acceptSigilLoss });
    const prior = await this.prior(accountId, operationId, hash);
    if (prior !== null) return prior;

    if (this.townMapIds.length === 0 || !(await this.inTown(accountId))) return reject("NOT_IN_TOWN", "go to town first");
    if (await this.fighting(accountId)) return reject("IN_BATTLE", "finish your fight first");
    const piece = await this.piece(accountId, equipmentId);
    const def = piece === null ? undefined : this.content.equipment.get(piece.definition_id);
    if (piece === null || def === undefined) return reject("NOT_OWNER", "that equipment is not yours");
    if (piece.lock_state !== "free") return reject("ASSET_LOCKED", "a fight or a trade holds that piece");
    if (piece.refine_level !== expectedLevel || piece.version !== expectedVersion) return reject("CHANGED", "the piece changed; reload and try again");
    const q = refineQuote(this.rules, def, piece.refine_level);
    if (!q.ok) return reject(q.reason, q.message);
    const quote = q.quote;
    if (quote.coins !== expectedCost.coins || quote.stoneItemId !== expectedCost.stoneItemId || quote.stones !== expectedCost.stones) {
      return reject("COST_CHANGED", `this attempt costs ${quote.coins} coins and ${quote.stones} ${quote.stoneItemId}`);
    }
    if (wardItemId !== null && !quote.risky) return reject("WARD_NOT_USED_HERE", `+${quote.target} cannot break; no ward is used`);
    if (wardItemId !== null && wardItemId !== quote.wardItemId) return reject("WARD_MISMATCH", `+${quote.target} on this piece takes ${quote.wardItemId}`);
    const sigils = JSON.parse(piece.sigil_sockets_json) as string[];
    const canBreak = quote.risky && wardItemId === null;
    if (canBreak && sigils.length > 0 && !acceptSigilLoss) {
      return reject("SIGILS_WOULD_BREAK", "a failure destroys the piece and its Sigils; confirm the loss, use a ward or take the Sigils out first");
    }

    const roll = this.roll();
    const success = refineSucceeds(roll, quote.successBp);
    const outcome: RefineResult["outcome"] = success ? "success" : canBreak ? "destroyed" : "kept";
    const destroyed = outcome === "destroyed";
    const result: RefineResult = {
      equipmentId,
      definitionId: def.id,
      from: quote.from,
      target: quote.target,
      outcome,
      roll,
      successBp: quote.successBp,
      paid: { coins: quote.coins, stoneItemId: quote.stoneItemId, stones: quote.stones, wardItemId },
      level: destroyed ? null : success ? quote.target : quote.from,
      version: destroyed ? null : piece.version + 1,
      unequipped: destroyed ? piece.slot : null,
      sigilsLost: destroyed ? sigils : [],
    };

    const guards = [
      `EXISTS (SELECT 1 FROM player_positions WHERE account_id = ? AND map_id IN (${marks(this.townMapIds.length)}))`,
      `NOT ${OPEN_BATTLE}`,
      `EXISTS (SELECT 1 FROM equipment_instances WHERE id = ? AND owner_id = ? AND lock_state = 'free' AND refine_level = ? AND version = ? AND sigil_sockets_json = ?)`,
      `(SELECT slot FROM character_equipment WHERE equipment_instance_id = ?) IS ?`,
      `${balance("coin_ledger")} >= ?`,
      `${balance("item_ledger")} >= ?`,
    ];
    const args: unknown[] = [
      accountId,
      ...this.townMapIds,
      accountId,
      equipmentId,
      accountId,
      piece.refine_level,
      piece.version,
      piece.sigil_sockets_json,
      equipmentId,
      piece.slot,
      accountId,
      quote.coins,
      accountId,
      quote.stoneItemId,
      quote.stones,
    ];
    if (wardItemId !== null) {
      guards.push(`${balance("item_ledger")} >= 1`);
      args.push(accountId, wardItemId);
    }

    const token = crypto.randomUUID();
    const ours = { sql: `EXISTS (SELECT 1 FROM refine_operations WHERE account_id = ? AND operation_id = ? AND token = ?)`, args: [accountId, operationId, token] as unknown[] };
    const at = this.now();
    const ledgerId = `refine:${accountId}:${operationId}`;
    const itemLine = (lineNo: number, itemId: string, delta: number) =>
      this.db
        .prepare(
          `INSERT INTO item_ledger (operation_id, line_no, account_id, item_id, delta, reason, created_at)
           SELECT ?, ?, ?, ?, ?, 'refine', ? WHERE ${ours.sql} ON CONFLICT DO NOTHING`,
        )
        .bind(ledgerId, lineNo, accountId, itemId, delta, at, ...ours.args);
    const stmts: SqlBound[] = [
      this.db
        .prepare(
          `INSERT INTO refine_operations (account_id, operation_id, equipment_id, request_hash, token, outcome, result_json, created_at)
           SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE ${guards.join(" AND ")} ON CONFLICT DO NOTHING`,
        )
        .bind(accountId, operationId, equipmentId, hash, token, outcome, JSON.stringify(result), at, ...args),
    ];
    if (quote.coins > 0) {
      stmts.push(
        this.db
          .prepare(
            `INSERT INTO coin_ledger (operation_id, line_no, account_id, delta, reason, created_at)
             SELECT ?, 0, ?, ?, 'refine', ? WHERE ${ours.sql} ON CONFLICT DO NOTHING`,
          )
          .bind(ledgerId, accountId, -quote.coins, at, ...ours.args),
      );
    }
    let line = 0;
    if (quote.stones > 0) stmts.push(itemLine(line++, quote.stoneItemId, -quote.stones));
    if (wardItemId !== null) stmts.push(itemLine(line++, wardItemId, -1));
    if (!destroyed) {
      stmts.push(
        this.db
          .prepare(`UPDATE equipment_instances SET refine_level = ?, version = version + 1 WHERE id = ? AND owner_id = ? AND ${ours.sql}`)
          .bind(result.level, equipmentId, accountId, ...ours.args),
      );
    } else {
      stmts.push(
        this.db
          .prepare(
            `INSERT INTO disposed_assets (account_id, operation_id, asset_kind, asset_id, snapshot_json, disposed_at)
             SELECT ?, ?, 'equipment', id,
               json_object('reason', 'refine_break', 'definitionId', definition_id, 'rarity', rarity, 'refineLevel', refine_level, 'target', ?,
                           'affixes', json(affixes_json), 'sigils', json(sigil_sockets_json), 'slot', ?,
                           'createdOperationId', created_operation_id, 'createdAt', created_at), ?
             FROM equipment_instances WHERE id = ? AND owner_id = ? AND ${ours.sql} ON CONFLICT DO NOTHING`,
          )
          .bind(accountId, operationId, quote.target, piece.slot, at, equipmentId, accountId, ...ours.args),
        // Taking a worn piece off changes the character: bump its version like an equip does.
        this.db
          .prepare(
            `UPDATE characters SET version = version + 1
             WHERE id = (SELECT character_id FROM character_equipment WHERE equipment_instance_id = ?) AND ${ours.sql}`,
          )
          .bind(equipmentId, ...ours.args),
        this.db.prepare(`DELETE FROM character_equipment WHERE equipment_instance_id = ? AND ${ours.sql}`).bind(equipmentId, ...ours.args),
        this.db.prepare(`DELETE FROM equipment_instances WHERE id = ? AND owner_id = ? AND ${ours.sql}`).bind(equipmentId, accountId, ...ours.args),
      );
    }
    await this.db.batch(stmts);

    const row = await this.row(accountId, operationId);
    if (row !== null) {
      if (row.request_hash !== hash) return reject("PAYLOAD_MISMATCH", "that operation id was used for another request");
      return { status: "done", replayed: row.token !== token, result: JSON.parse(row.result_json) as RefineResult };
    }
    // Nothing landed: say why (read-only).
    if (!(await this.inTown(accountId))) return reject("NOT_IN_TOWN", "go to town first");
    if (await this.fighting(accountId)) return reject("IN_BATTLE", "finish your fight first");
    const now = await this.piece(accountId, equipmentId);
    if (now === null) return reject("NOT_OWNER", "that equipment is not yours");
    if (now.lock_state !== "free") return reject("ASSET_LOCKED", "a fight or a trade holds that piece");
    if (now.refine_level !== piece.refine_level || now.version !== piece.version || now.sigil_sockets_json !== piece.sigil_sockets_json || now.slot !== piece.slot) {
      return reject("CHANGED", "the piece changed; reload and try again");
    }
    if ((await this.sum(`${balance("coin_ledger")} AS q`, [accountId])) < quote.coins) return reject("INSUFFICIENT_COINS", `this attempt costs ${quote.coins} coins`);
    if ((await this.sum(`${balance("item_ledger")} AS q`, [accountId, quote.stoneItemId])) < quote.stones) return reject("INSUFFICIENT_STONES", `this attempt needs ${quote.stones} ${quote.stoneItemId}`);
    if (wardItemId !== null && (await this.sum(`${balance("item_ledger")} AS q`, [accountId, wardItemId])) < 1) return reject("NO_WARD", `you have no ${wardItemId}`);
    return reject("CHANGED", "something changed; reload and try again");
  }

  /** The receipt of one attempt, for support and for a client that lost the reply. */
  async receipt(accountId: string, operationId: string): Promise<RefineResult | null> {
    const row = await this.row(accountId, operationId);
    return row === null ? null : (JSON.parse(row.result_json) as RefineResult);
  }

  // ------------------------------------------------------------------ helpers

  private async sum(expr: string, args: unknown[]): Promise<number> {
    const r = await this.db.prepare(`SELECT ${expr}`).bind(...args).first<{ q: number }>();
    return r?.q ?? 0;
  }

  private piece(accountId: string, equipmentId: string): Promise<PieceRow | null> {
    return this.db
      .prepare(
        `SELECT e.id, e.definition_id, e.refine_level, e.version, e.lock_state, e.sigil_sockets_json,
           (SELECT slot FROM character_equipment ce WHERE ce.equipment_instance_id = e.id) AS slot
         FROM equipment_instances e WHERE e.id = ? AND e.owner_id = ?`,
      )
      .bind(equipmentId, accountId)
      .first<PieceRow>();
  }

  private async inTown(accountId: string): Promise<boolean> {
    const pos = await this.db.prepare(`SELECT map_id FROM player_positions WHERE account_id = ?`).bind(accountId).first<{ map_id: string }>();
    return pos !== null && this.townMapIds.includes(pos.map_id);
  }

  private async fighting(accountId: string): Promise<boolean> {
    return (await this.db.prepare(`SELECT 1 AS x FROM battle_reservations WHERE account_id = ? AND status IN ('reserved', 'active')`).bind(accountId).first()) !== null;
  }

  private row(accountId: string, operationId: string) {
    return this.db
      .prepare(`SELECT request_hash, token, result_json FROM refine_operations WHERE account_id = ? AND operation_id = ?`)
      .bind(accountId, operationId)
      .first<{ request_hash: string; token: string; result_json: string }>();
  }

  private async prior(accountId: string, operationId: string, hash: string): Promise<RefineOutcome | null> {
    const row = await this.row(accountId, operationId);
    if (row === null) return null;
    if (row.request_hash !== hash) return reject("PAYLOAD_MISMATCH", "that operation id was used for another request");
    return { status: "done", replayed: true, result: JSON.parse(row.result_json) as RefineResult };
  }
}
