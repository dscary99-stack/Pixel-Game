/**
 * Selling / salvaging gear, releasing companions, protect flags and nicknames on D1 (migration 0020).
 *
 * Sell, salvage and release carry an operationId. One batch: the anchor row in asset_disposals is
 * inserted only when every guard holds (owned, free, not worn / not in the team, no Sigils, nothing
 * waiting, not protected, no open fight, in town for gear); the snapshot, the ledger lines and the
 * delete apply only under that row's token, so a losing racer changes nothing. A retry replays the
 * stored result; the same id with another request is refused.
 */
import {
  GearDisposeRequestSchema,
  NicknameRequestSchema,
  ProtectRequestSchema,
  ReleaseRequestSchema,
  disposeQuote,
  type AffixPool,
  type DisposeQuote,
  type EquipmentDefinition,
  type Rarity,
  type RulesConfig,
} from "@pmrpg/shared";
import { hashJson, type SqlBound, type SqlDb } from "./reward-ledger";

export type DisposalRejection =
  | "INVALID_REQUEST"
  | "PAYLOAD_MISMATCH"
  | "NOT_OWNER"
  | "NOT_IN_TOWN"
  | "IN_BATTLE"
  | "ASSET_LOCKED"
  | "WORN"
  | "IN_TEAM"
  | "HAS_SIGILS"
  | "CHOICE_PENDING"
  | "PROTECTED"
  | "COST_CHANGED"
  | "CHANGED";

export interface GearDisposeResult {
  mode: "sell" | "salvage";
  equipmentIds: string[];
  paid: DisposeQuote;
}
export interface ReleaseResult {
  companionId: string;
  speciesId: string;
}
export type DisposalResult<T> = { status: "done"; replayed: boolean; result: T } | { status: "rejected"; reason: DisposalRejection; message: string };

interface PieceRow {
  id: string;
  definition_id: string;
  rarity: Rarity;
  lock_state: string;
  sigil_sockets_json: string;
  affix_pending_json: string | null;
  protected: number;
  worn: number;
}

const OPEN_BATTLE = `EXISTS (SELECT 1 FROM battle_reservations WHERE account_id = ? AND status IN ('reserved', 'active'))`;
const reject = (reason: DisposalRejection, message: string) => ({ status: "rejected" as const, reason, message });
const marks = (n: number) => Array.from({ length: n }, () => "?").join(", ");

export class DisposalStore {
  constructor(
    private readonly db: SqlDb,
    private readonly rules: RulesConfig,
    private readonly content: { equipment: ReadonlyMap<string, EquipmentDefinition>; affixPools: ReadonlyMap<string, AffixPool> },
    private readonly townMapIds: readonly string[],
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async disposeGear(accountId: string, raw: unknown): Promise<DisposalResult<GearDisposeResult>> {
    const parsed = GearDisposeRequestSchema.safeParse(raw);
    if (!parsed.success) return reject("INVALID_REQUEST", parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
    const { operationId, mode, expected } = parsed.data;
    const ids = [...parsed.data.equipmentIds].sort();
    const kind = mode === "sell" ? "gear_sell" : "gear_salvage";
    const hash = await hashJson({ kind, equipmentIds: ids, expected });
    const prior = await this.prior<GearDisposeResult>(accountId, operationId, hash);
    if (prior !== null) return prior;

    if (this.townMapIds.length === 0 || !(await this.inTown(accountId))) return reject("NOT_IN_TOWN", "go to town first");
    const pieces = await this.pieces(accountId, ids);
    const why = this.whyNot(pieces, ids);
    if (why !== null) return why;
    const paid = this.quoteFor(mode, pieces);
    if (JSON.stringify(paid) !== JSON.stringify(expected)) return reject("COST_CHANGED", "the price changed; look again before confirming");

    const n = ids.length;
    const guards = [
      `EXISTS (SELECT 1 FROM player_positions WHERE account_id = ? AND map_id IN (${marks(this.townMapIds.length)}))`,
      `NOT ${OPEN_BATTLE}`,
      `(SELECT COUNT(*) FROM equipment_instances WHERE owner_id = ? AND id IN (${marks(n)}) AND lock_state = 'free' AND protected = 0
          AND sigil_sockets_json = '[]' AND affix_pending_json IS NULL) = ?`,
      `NOT EXISTS (SELECT 1 FROM character_equipment WHERE equipment_instance_id IN (${marks(n)}))`,
    ];
    const args: unknown[] = [accountId, ...this.townMapIds, accountId, accountId, ...ids, n, ...ids];
    const result: GearDisposeResult = { mode, equipmentIds: ids, paid };
    const token = crypto.randomUUID();
    const ours = this.ours(accountId, operationId, token);
    const at = this.now();
    const ledgerId = `dispose:${accountId}:${operationId}`;
    const stmts: SqlBound[] = [
      this.anchor(accountId, operationId, kind, hash, token, result, guards, args),
      this.db
        .prepare(
          `INSERT INTO disposed_assets (account_id, operation_id, asset_kind, asset_id, snapshot_json, disposed_at)
           SELECT ?, ?, 'equipment', id,
             json_object('definitionId', definition_id, 'rarity', rarity, 'refineLevel', refine_level, 'affixes', json(affixes_json),
                         'createdOperationId', created_operation_id, 'createdAt', created_at), ?
           FROM equipment_instances WHERE owner_id = ? AND id IN (${marks(n)}) AND ${ours.sql} ON CONFLICT DO NOTHING`,
        )
        .bind(accountId, operationId, at, accountId, ...ids, ...ours.args),
    ];
    if (paid.coins > 0) {
      stmts.push(
        this.db
          .prepare(
            `INSERT INTO coin_ledger (operation_id, line_no, account_id, delta, reason, created_at)
             SELECT ?, 0, ?, ?, 'gear_sell', ? WHERE ${ours.sql} ON CONFLICT DO NOTHING`,
          )
          .bind(ledgerId, accountId, paid.coins, at, ...ours.args),
      );
    }
    paid.items.forEach((l, i) =>
      stmts.push(
        this.db
          .prepare(
            `INSERT INTO item_ledger (operation_id, line_no, account_id, item_id, delta, reason, created_at)
             SELECT ?, ?, ?, ?, ?, 'gear_salvage', ? WHERE ${ours.sql} ON CONFLICT DO NOTHING`,
          )
          .bind(ledgerId, i, accountId, l.itemId, l.quantity, at, ...ours.args),
      ),
    );
    stmts.push(this.db.prepare(`DELETE FROM equipment_instances WHERE owner_id = ? AND id IN (${marks(n)}) AND ${ours.sql}`).bind(accountId, ...ids, ...ours.args));
    await this.db.batch(stmts);

    return this.outcome(accountId, operationId, hash, token, async () => {
      if (!(await this.inTown(accountId))) return reject("NOT_IN_TOWN", "go to town first");
      if (await this.fighting(accountId)) return reject("IN_BATTLE", "finish your fight first");
      return this.whyNot(await this.pieces(accountId, ids), ids) ?? reject("CHANGED", "something changed; reload and try again");
    });
  }

  async release(accountId: string, raw: unknown): Promise<DisposalResult<ReleaseResult>> {
    const parsed = ReleaseRequestSchema.safeParse(raw);
    if (!parsed.success) return reject("INVALID_REQUEST", parsed.error.issues.map((i) => i.message).join("; "));
    const { operationId, companionId } = parsed.data;
    const hash = await hashJson({ kind: "companion_release", companionId });
    const prior = await this.prior<ReleaseResult>(accountId, operationId, hash);
    if (prior !== null) return prior;

    const c = await this.companion(accountId, companionId);
    if (c === null) return reject("NOT_OWNER", "that companion is not yours");
    const why = this.whyNotRelease(c);
    if (why !== null) return why;

    const guards = [
      `NOT ${OPEN_BATTLE}`,
      `EXISTS (SELECT 1 FROM monster_instances WHERE id = ? AND owner_id = ? AND lock_state = 'free' AND protected = 0)`,
      `NOT EXISTS (SELECT 1 FROM character_team WHERE monster_instance_id = ?)`,
    ];
    const args = [accountId, companionId, accountId, companionId];
    const result: ReleaseResult = { companionId, speciesId: c.species_id };
    const token = crypto.randomUUID();
    const ours = this.ours(accountId, operationId, token);
    await this.db.batch([
      this.anchor(accountId, operationId, "companion_release", hash, token, result, guards, args),
      this.db
        .prepare(
          `INSERT INTO disposed_assets (account_id, operation_id, asset_kind, asset_id, snapshot_json, disposed_at)
           SELECT ?, ?, 'companion', id,
             json_object('speciesId', species_id, 'element', element, 'level', current_level, 'xp', xp, 'rebirthStage', rebirth_stage,
                         'bond', bond, 'nickname', nickname, 'primaryStats', json(primary_stats_json), 'growthSeed', growth_seed,
                         'trainedSkillLevels', json(trained_skill_levels_json), 'rebirthChoices', json(rebirth_choices_json),
                         'skillMastery', skill_mastery, 'origin', json(origin_json), 'createdOperationId', created_operation_id), ?
           FROM monster_instances WHERE id = ? AND owner_id = ? AND ${ours.sql} ON CONFLICT DO NOTHING`,
        )
        .bind(accountId, operationId, this.now(), companionId, accountId, ...ours.args),
      this.db.prepare(`DELETE FROM monster_instances WHERE id = ? AND owner_id = ? AND ${ours.sql}`).bind(companionId, accountId, ...ours.args),
    ]);
    return this.outcome(accountId, operationId, hash, token, async () => {
      if (await this.fighting(accountId)) return reject("IN_BATTLE", "finish your fight first");
      const now = await this.companion(accountId, companionId);
      if (now === null) return reject("NOT_OWNER", "that companion is not yours");
      return this.whyNotRelease(now) ?? reject("CHANGED", "something changed; reload and try again");
    });
  }

  /** Set or clear the protect flag on a piece or a companion. Setting the same value twice is fine. */
  async protect(accountId: string, raw: unknown): Promise<{ ok: true; id: string; protected: boolean } | { ok: false; reason: "INVALID_REQUEST" | "NOT_OWNER"; message: string }> {
    const parsed = ProtectRequestSchema.safeParse(raw);
    if (!parsed.success) return { ok: false, reason: "INVALID_REQUEST", message: parsed.error.issues.map((i) => i.message).join("; ") };
    const { kind, id } = parsed.data;
    const table = kind === "equipment" ? "equipment_instances" : "monster_instances";
    const row = await this.db
      .prepare(`UPDATE ${table} SET protected = ? WHERE id = ? AND owner_id = ? RETURNING id`)
      .bind(parsed.data.protected ? 1 : 0, id, accountId)
      .first<{ id: string }>();
    if (row === null) return { ok: false, reason: "NOT_OWNER", message: `that ${kind} is not yours` };
    return { ok: true, id, protected: parsed.data.protected };
  }

  /** Name a companion (null clears it). Cosmetic; allowed anywhere, even mid-fight. */
  async nickname(accountId: string, raw: unknown): Promise<{ ok: true; companionId: string; nickname: string | null } | { ok: false; reason: "INVALID_REQUEST" | "NOT_OWNER"; message: string }> {
    const parsed = NicknameRequestSchema.safeParse(raw);
    if (!parsed.success) return { ok: false, reason: "INVALID_REQUEST", message: parsed.error.issues.map((i) => i.message).join("; ") };
    const { companionId, nickname } = parsed.data;
    const row = await this.db
      .prepare(`UPDATE monster_instances SET nickname = ? WHERE id = ? AND owner_id = ? RETURNING id`)
      .bind(nickname, companionId, accountId)
      .first<{ id: string }>();
    if (row === null) return { ok: false, reason: "NOT_OWNER", message: "that companion is not yours" };
    return { ok: true, companionId, nickname };
  }

  // ------------------------------------------------------------------ helpers

  private quoteFor(mode: "sell" | "salvage", pieces: readonly PieceRow[]): DisposeQuote {
    return disposeQuote(
      this.rules,
      mode,
      pieces.map((p) => {
        const def = this.content.equipment.get(p.definition_id)!;
        return { def, pool: this.content.affixPools.get(def.affixPoolId)!, rarity: p.rarity };
      }),
    );
  }

  private whyNot(pieces: readonly PieceRow[], ids: readonly string[]): DisposalResult<never> | null {
    if (pieces.length !== ids.length) return reject("NOT_OWNER", "a piece is not yours");
    for (const p of pieces) {
      const def = this.content.equipment.get(p.definition_id);
      if (def === undefined || !this.content.affixPools.has(def.affixPoolId)) return reject("NOT_OWNER", `unknown piece ${p.definition_id}`);
      if (p.protected === 1) return reject("PROTECTED", "a piece is protected; unprotect it first");
      if (p.worn > 0) return reject("WORN", "take the piece off first");
      if (p.lock_state !== "free") return reject("ASSET_LOCKED", "a fight holds that piece");
      if (p.sigil_sockets_json !== "[]") return reject("HAS_SIGILS", "take the Sigils out first");
      if (p.affix_pending_json !== null) return reject("CHOICE_PENDING", "keep the old or the new affix first");
    }
    return null;
  }

  private whyNotRelease(c: { lock_state: string; protected: number; in_team: number }): DisposalResult<never> | null {
    if (c.protected === 1) return reject("PROTECTED", "this companion is protected; unprotect it first");
    if (c.in_team > 0) return reject("IN_TEAM", "take it out of the team first");
    if (c.lock_state !== "free") return reject("ASSET_LOCKED", "a fight holds this companion");
    return null;
  }

  private async pieces(accountId: string, ids: readonly string[]): Promise<PieceRow[]> {
    if (ids.length === 0) return [];
    const { results } = await this.db
      .prepare(
        `SELECT e.id, e.definition_id, e.rarity, e.lock_state, e.sigil_sockets_json, e.affix_pending_json, e.protected,
           (SELECT COUNT(*) FROM character_equipment ce WHERE ce.equipment_instance_id = e.id) AS worn
         FROM equipment_instances e WHERE e.owner_id = ? AND e.id IN (${marks(ids.length)})`,
      )
      .bind(accountId, ...ids)
      .all<PieceRow>();
    return results;
  }

  private companion(accountId: string, companionId: string) {
    return this.db
      .prepare(
        `SELECT m.species_id, m.lock_state, m.protected, (SELECT COUNT(*) FROM character_team t WHERE t.monster_instance_id = m.id) AS in_team
         FROM monster_instances m WHERE m.id = ? AND m.owner_id = ?`,
      )
      .bind(companionId, accountId)
      .first<{ species_id: string; lock_state: string; protected: number; in_team: number }>();
  }

  private async inTown(accountId: string): Promise<boolean> {
    const pos = await this.db.prepare(`SELECT map_id FROM player_positions WHERE account_id = ?`).bind(accountId).first<{ map_id: string }>();
    return pos !== null && this.townMapIds.includes(pos.map_id);
  }

  private async fighting(accountId: string): Promise<boolean> {
    return (await this.db.prepare(`SELECT 1 AS x FROM battle_reservations WHERE account_id = ? AND status IN ('reserved', 'active')`).bind(accountId).first()) !== null;
  }

  private ours(accountId: string, operationId: string, token: string) {
    return { sql: `EXISTS (SELECT 1 FROM asset_disposals WHERE account_id = ? AND operation_id = ? AND token = ?)`, args: [accountId, operationId, token] as unknown[] };
  }

  private anchor(accountId: string, operationId: string, kind: string, hash: string, token: string, result: unknown, guards: string[], args: unknown[]): SqlBound {
    return this.db
      .prepare(
        `INSERT INTO asset_disposals (account_id, operation_id, kind, request_hash, token, result_json, created_at)
         SELECT ?, ?, ?, ?, ?, ?, ? WHERE ${guards.join(" AND ")} ON CONFLICT DO NOTHING`,
      )
      .bind(accountId, operationId, kind, hash, token, JSON.stringify(result), this.now(), ...args);
  }

  private row(accountId: string, operationId: string) {
    return this.db
      .prepare(`SELECT request_hash, token, result_json FROM asset_disposals WHERE account_id = ? AND operation_id = ?`)
      .bind(accountId, operationId)
      .first<{ request_hash: string; token: string; result_json: string }>();
  }

  private async prior<T>(accountId: string, operationId: string, hash: string): Promise<DisposalResult<T> | null> {
    const row = await this.row(accountId, operationId);
    if (row === null) return null;
    if (row.request_hash !== hash) return reject("PAYLOAD_MISMATCH", "that operation id was used for another request");
    return { status: "done", replayed: true, result: JSON.parse(row.result_json) as T };
  }

  private async outcome<T>(accountId: string, operationId: string, hash: string, token: string, why: () => Promise<DisposalResult<never>>): Promise<DisposalResult<T>> {
    const row = await this.row(accountId, operationId);
    if (row === null) return why();
    if (row.request_hash !== hash) return reject("PAYLOAD_MISMATCH", "that operation id was used for another request");
    return { status: "done", replayed: row.token !== token, result: JSON.parse(row.result_json) as T };
  }
}
