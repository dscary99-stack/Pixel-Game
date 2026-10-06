/**
 * Economy service on D1 for the battle lifecycle (chapter 11 §2–§3).
 *
 * D1 is the canonical owner of items and companions. A battle only holds a reservation:
 *   reserve  (step 2)  bag items leave the inventory, companions and worn gear are locked, one open battle per account
 *   activate (step 3)  the Battle DO confirms it started the fight from this reservation
 *   grant    (step 6)  RewardLedger: receipt + items/companion in one batch
 *   settle   (step 8)  unused items come back, locks open, final HP/MP recorded; only after every
 *                      entitlement of the battle has a receipt
 *   release            reconciler path for a reservation whose battle never started
 *
 * Every write is one D1 batch (a transaction). Conditional writes that match 0 rows do not fail a
 * batch (chapter 11 §4), so each dependent write is guarded by an EXISTS on the row the first write
 * created with this request's hash, and the outcome is read back after the batch instead of assumed.
 */
import { SecretQuestSchema, secretQuestCredit, type BattleStatus, type Entitlement, type RulesConfig, type SecretFightFacts } from "@pmrpg/shared";
import { RewardLedger, hashJson, type GrantResult, type SqlBound, type SqlDb } from "./reward-ledger";
import { secretProgressWrites } from "./secret-progress-store";

export interface ReserveRequest {
  reservationId: string;
  accountId: string;
  battleId: string;
  /** itemId -> quantity taken out of the inventory for this battle. */
  bag: Record<string, number>;
  /** Companion MonsterInstance ids that fight in this battle. */
  companionIds: string[];
  /** The stored character that fights (Phase D); settlement writes its HP/MP back. */
  characterId?: string;
  /** Equipment instances the character wears; locked for the fight like companions. */
  equipmentIds?: string[];
}

export type ReservationStatus = "reserved" | "active" | "settled" | "released";

export type ReserveResult =
  | { status: "reserved"; reservationId: string; current: ReservationStatus; replayed: boolean }
  | {
      status: "rejected";
      reservationId: string;
      reason: "INVALID_REQUEST" | "PAYLOAD_MISMATCH" | "BATTLE_IN_PROGRESS" | "NOT_OWNER" | "ASSET_LOCKED" | "INSUFFICIENT_RESOURCE";
    };

export interface AllyResult {
  unitId: string;
  instanceId: string | null;
  hp: number;
  mp: number;
  ko: boolean;
  /** The unit's maxima in that fight (newer fights only); the tower's checkpoint uses them. */
  maxHp?: number;
  maxMp?: number;
}

/** What the Battle DO sends when a fight ends. Built from the kernel's BattleEnded event. */
export interface Settlement {
  reservationId: string;
  battleId: string;
  accountId: string;
  outcome: Exclude<BattleStatus, "active">;
  /** Reserved items not used in the fight; these go back to the inventory. */
  unused: Record<string, number>;
  allies: AllyResult[];
  /** Every entitlement the battle created. Settlement waits until each one has a receipt. */
  entitlementIds: string[];
  /** What the fight did, for secret quest progress (absent on fights settled before it existed). */
  secret?: SecretFightFacts;
}

export type SettleResult =
  | { status: "settled" | "already_settled"; reservationId: string }
  | {
      status: "rejected";
      reservationId: string;
      reason: "UNKNOWN_RESERVATION" | "PAYLOAD_MISMATCH" | "NOT_ACTIVE" | "EXCEEDS_RESERVATION" | "RECEIPTS_MISSING";
    };

export type ActivateResult = { status: "active"; reservationId: string } | { status: "rejected"; reservationId: string; current: ReservationStatus | null };

export type ReleaseResult =
  | { status: "released" | "already_released"; reservationId: string }
  | { status: "rejected"; reservationId: string; current: ReservationStatus | null };

interface ReservationRow {
  reservation_id: string;
  account_id: string;
  battle_id: string;
  status: ReservationStatus;
  bag_json: string;
  request_hash: string;
  settlement_hash: string | null;
}

const ITEM_ID = /^item:[a-z0-9_]{1,60}$/;

export class Economy {
  private readonly ledger: RewardLedger;

  constructor(
    private readonly db: SqlDb,
    private readonly rules: RulesConfig,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {
    this.ledger = new RewardLedger(db, rules, now);
  }

  // ------------------------------------------------------------------ reserve (step 2)

  async reserve(req: ReserveRequest): Promise<ReserveResult> {
    const rid = req.reservationId;
    const bag = normalizeBag(req.bag);
    const companions = [...new Set(req.companionIds)].sort();
    const gear = [...new Set(req.equipmentIds ?? [])].sort();
    if (bag === null || companions.length !== req.companionIds.length || gear.length !== (req.equipmentIds ?? []).length) {
      return { status: "rejected", reservationId: rid, reason: "INVALID_REQUEST" };
    }
    const characterId = req.characterId ?? null;
    // Optional parts join the hash only when present, so older reservations keep their hash.
    const hash = await hashJson({
      accountId: req.accountId,
      battleId: req.battleId,
      bag,
      companions,
      ...(characterId === null ? {} : { characterId }),
      ...(gear.length === 0 ? {} : { gear }),
    });

    const existing = await this.row(rid);
    if (existing !== null) {
      if (existing.request_hash !== hash) return { status: "rejected", reservationId: rid, reason: "PAYLOAD_MISMATCH" };
      return { status: "reserved", reservationId: rid, current: existing.status, replayed: true };
    }

    const at = this.now();
    // All-or-nothing guard on the reservation row itself: every item balance covers the request
    // and every companion is owned by the caller and free. The partial unique index
    // battle_reservations_one_open turns a second open battle into DO NOTHING.
    const guards: string[] = [];
    const guardArgs: unknown[] = [];
    for (const [itemId, qty] of bag) {
      guards.push(`(SELECT COALESCE(SUM(delta), 0) FROM item_ledger WHERE account_id = ? AND item_id = ?) >= ?`);
      guardArgs.push(req.accountId, itemId, qty);
    }
    if (companions.length > 0) {
      guards.push(`(SELECT COUNT(*) FROM monster_instances WHERE owner_id = ? AND lock_state = 'free' AND id IN (${marks(companions.length)})) = ?`);
      guardArgs.push(req.accountId, ...companions, companions.length);
    }
    if (gear.length > 0) {
      guards.push(`(SELECT COUNT(*) FROM equipment_instances WHERE owner_id = ? AND lock_state = 'free' AND id IN (${marks(gear.length)})) = ?`);
      guardArgs.push(req.accountId, ...gear, gear.length);
    }
    const ours = `EXISTS (SELECT 1 FROM battle_reservations WHERE reservation_id = ? AND request_hash = ?)`;

    const stmts: SqlBound[] = [
      this.db
        .prepare(
          `INSERT INTO battle_reservations
             (reservation_id, account_id, battle_id, status, loadout_json, bag_json, request_hash, created_at, updated_at)
           SELECT ?, ?, ?, 'reserved', ?, ?, ?, ?, ? WHERE ${guards.length > 0 ? guards.join(" AND ") : "1"}
           ON CONFLICT DO NOTHING`,
        )
        .bind(rid, req.accountId, req.battleId, JSON.stringify({ companionIds: companions, ...(characterId === null ? {} : { characterId }), ...(gear.length === 0 ? {} : { equipmentIds: gear }) }), JSON.stringify(Object.fromEntries(bag)), hash, at, at, ...guardArgs),
    ];
    bag.forEach(([itemId, qty], i) => {
      stmts.push(
        this.db
          .prepare(
            `INSERT INTO item_ledger (operation_id, line_no, account_id, item_id, delta, reason, created_at)
             SELECT ?, ?, ?, ?, ?, 'battle_reserve', ? WHERE ${ours} ON CONFLICT DO NOTHING`,
          )
          .bind(`reserve:${rid}`, i, req.accountId, itemId, -qty, at, rid, hash),
      );
    });
    if (companions.length > 0) {
      stmts.push(
        this.db
          .prepare(
            `UPDATE monster_instances SET lock_state = 'in_battle', lock_ref = ?
             WHERE owner_id = ? AND lock_state = 'free' AND id IN (${marks(companions.length)}) AND ${ours}`,
          )
          .bind(rid, req.accountId, ...companions, rid, hash),
      );
    }
    if (gear.length > 0) {
      stmts.push(
        this.db
          .prepare(
            `UPDATE equipment_instances SET lock_state = 'in_battle', lock_ref = ?
             WHERE owner_id = ? AND lock_state = 'free' AND id IN (${marks(gear.length)}) AND ${ours}`,
          )
          .bind(rid, req.accountId, ...gear, rid, hash),
      );
    }
    await this.db.batch(stmts);

    const after = await this.row(rid);
    if (after !== null) {
      if (after.request_hash !== hash) return { status: "rejected", reservationId: rid, reason: "PAYLOAD_MISMATCH" };
      return { status: "reserved", reservationId: rid, current: after.status, replayed: false };
    }
    return { status: "rejected", reservationId: rid, reason: await this.whyNotReserved(req.accountId, companions, gear) };
  }

  /** Read-only diagnosis after the guarded insert matched nothing. */
  private async whyNotReserved(accountId: string, companions: string[], gear: string[]): Promise<Extract<ReserveResult, { status: "rejected" }>["reason"]> {
    const open = await this.db
      .prepare(`SELECT 1 AS x FROM battle_reservations WHERE account_id = ? AND status IN ('reserved', 'active')`)
      .bind(accountId)
      .first();
    if (open !== null) return "BATTLE_IN_PROGRESS";
    if (companions.length > 0) {
      const owned = await this.db
        .prepare(`SELECT COUNT(*) AS n FROM monster_instances WHERE owner_id = ? AND id IN (${marks(companions.length)})`)
        .bind(accountId, ...companions)
        .first<{ n: number }>();
      if ((owned?.n ?? 0) !== companions.length) return "NOT_OWNER";
      const free = await this.db
        .prepare(`SELECT COUNT(*) AS n FROM monster_instances WHERE owner_id = ? AND lock_state = 'free' AND id IN (${marks(companions.length)})`)
        .bind(accountId, ...companions)
        .first<{ n: number }>();
      if ((free?.n ?? 0) !== companions.length) return "ASSET_LOCKED";
    }
    if (gear.length > 0) {
      const g = await this.db
        .prepare(
          `SELECT COUNT(*) AS owned, SUM(lock_state = 'free') AS free FROM equipment_instances WHERE owner_id = ? AND id IN (${marks(gear.length)})`,
        )
        .bind(accountId, ...gear)
        .first<{ owned: number; free: number | null }>();
      if ((g?.owned ?? 0) !== gear.length) return "NOT_OWNER";
      if ((g?.free ?? 0) !== gear.length) return "ASSET_LOCKED";
    }
    return "INSUFFICIENT_RESOURCE";
  }

  // ------------------------------------------------------------------ activate (step 3)

  async activate(reservationId: string): Promise<ActivateResult> {
    await this.db
      .prepare(`UPDATE battle_reservations SET status = 'active', updated_at = ? WHERE reservation_id = ? AND status = 'reserved'`)
      .bind(this.now(), reservationId)
      .run();
    const row = await this.row(reservationId);
    // 'settled' means activation already happened earlier and the fight is over; still a success.
    if (row?.status === "active" || row?.status === "settled") return { status: "active", reservationId };
    return { status: "rejected", reservationId, current: row?.status ?? null };
  }

  // ------------------------------------------------------------------ grant (steps 6–7)

  grant(entitlement: Entitlement, recipientId: string): Promise<GrantResult> {
    return this.ledger.grant(entitlement, recipientId);
  }

  // ------------------------------------------------------------------ settle (step 8)

  async settle(s: Settlement): Promise<SettleResult> {
    const rid = s.reservationId;
    const unused = normalizeBag(s.unused);
    const entitlementIds = [...new Set(s.entitlementIds)].sort();
    const row = await this.row(rid);
    if (row === null || row.battle_id !== s.battleId || row.account_id !== s.accountId || unused === null) {
      return { status: "rejected", reservationId: rid, reason: "UNKNOWN_RESERVATION" };
    }
    const hash = await hashJson({ ...s, unused, entitlementIds });
    if (row.settlement_hash !== null) {
      return row.settlement_hash === hash ? { status: "already_settled", reservationId: rid } : { status: "rejected", reservationId: rid, reason: "PAYLOAD_MISMATCH" };
    }
    if (row.status !== "active") return { status: "rejected", reservationId: rid, reason: "NOT_ACTIVE" };
    const reserved = JSON.parse(row.bag_json) as Record<string, number>;
    if (unused.some(([itemId, qty]) => qty > (reserved[itemId] ?? 0))) return { status: "rejected", reservationId: rid, reason: "EXCEEDS_RESERVATION" };

    const at = this.now();
    const receiptsGuard =
      entitlementIds.length === 0
        ? "1"
        : `(SELECT COUNT(*) FROM reward_receipts WHERE recipient_id = ? AND entitlement_id IN (${marks(entitlementIds.length)})) = ?`;
    const receiptsArgs = entitlementIds.length === 0 ? [] : [s.accountId, ...entitlementIds, entitlementIds.length];
    const ours = `EXISTS (SELECT 1 FROM battle_reservations WHERE reservation_id = ? AND settlement_hash = ?)`;

    const stmts: SqlBound[] = [
      this.db
        .prepare(
          `UPDATE battle_reservations
             SET status = 'settled', settlement_hash = ?, outcome = ?, result_json = ?, updated_at = ?
           WHERE reservation_id = ? AND status = 'active' AND settlement_hash IS NULL AND ${receiptsGuard}`,
        )
        .bind(hash, s.outcome, JSON.stringify({ allies: s.allies }), at, rid, ...receiptsArgs),
    ];
    unused.forEach(([itemId, qty], i) => {
      stmts.push(
        this.db
          .prepare(
            `INSERT INTO item_ledger (operation_id, line_no, account_id, item_id, delta, reason, created_at)
             SELECT ?, ?, ?, ?, ?, 'battle_return_unused', ? WHERE ${ours} ON CONFLICT DO NOTHING`,
          )
          .bind(`settle:${rid}`, i, s.accountId, itemId, qty, at, rid, hash),
      );
    });
    // HP/MP carry over (chapter 03 §3): the character named in the reservation and each companion
    // still locked to it. Written before the unlock, which clears lock_ref.
    const player = s.allies.find((a) => a.unitId === "player");
    if (player !== undefined) {
      stmts.push(
        this.db
          .prepare(
            `UPDATE characters SET hp = ?, mp = ?
             WHERE account_id = ? AND id = (SELECT json_extract(loadout_json, '$.characterId') FROM battle_reservations WHERE reservation_id = ?) AND ${ours}`,
          )
          .bind(resource(player.hp), resource(player.mp), s.accountId, rid, rid, hash),
      );
    }
    for (const a of s.allies) {
      if (a.instanceId === null) continue;
      stmts.push(
        this.db
          .prepare(`UPDATE monster_instances SET hp = ?, mp = ? WHERE id = ? AND owner_id = ? AND lock_ref = ? AND ${ours}`)
          .bind(resource(a.hp), resource(a.mp), a.instanceId, s.accountId, rid, rid, hash),
      );
    }
    stmts.push(...this.unlockAssets(rid, ours, [rid, hash]));
    stmts.push(...(await this.secretCredits(s, at, ours, [rid, hash])));
    await this.db.batch(stmts);

    const after = await this.row(rid);
    if (after?.settlement_hash === hash) return { status: "settled", reservationId: rid };
    if (after?.settlement_hash != null) return { status: "rejected", reservationId: rid, reason: "PAYLOAD_MISMATCH" };
    if (after?.status !== "active") return { status: "rejected", reservationId: rid, reason: "NOT_ACTIVE" };
    return { status: "rejected", reservationId: rid, reason: "RECEIPTS_MISSING" };
  }

  /**
   * Secret quest progress for this fight (secret-progress.ts), written in the settlement's own batch.
   * Only a revealed set counts. The credit row (character, battle) is taken under a fresh token and
   * every progress write applies only under that token, so a raced or replayed settlement credits
   * once; progress is capped at the quest's count in SQL as well.
   */
  private async secretCredits(s: Settlement, at: string, ours: string, oursArgs: unknown[]): Promise<SqlBound[]> {
    if (s.secret === undefined || !s.secret.won) return [];
    const row = await this.db
      .prepare(
        `SELECT q.character_id, q.quests_json FROM character_secret_quests q
           JOIN battle_reservations r ON r.reservation_id = ? AND r.account_id = q.account_id
          WHERE q.character_id = json_extract(r.loadout_json, '$.characterId') AND q.revealed_at IS NOT NULL`,
      )
      .bind(s.reservationId)
      .first<{ character_id: string; quests_json: string }>();
    if (row === null) return [];
    const quests = SecretQuestSchema.array().parse(JSON.parse(row.quests_json));
    const done = await this.db
      .prepare(`SELECT quest_id, progress FROM secret_quest_progress WHERE character_id = ?`)
      .bind(row.character_id)
      .all<{ quest_id: string; progress: number }>();
    const progress = new Map(done.results.map((r) => [r.quest_id, r.progress]));
    const credits = quests
      .map((q) => ({ questId: q.id, n: secretQuestCredit(this.rules, q, s.secret!, progress.get(q.id) ?? 0), count: q.params.count }))
      .filter((c) => c.n > 0);
    return secretProgressWrites(this.db, row.character_id, s.battleId, credits, at, { sql: ours, args: oursArgs });
  }

  // ------------------------------------------------------------------ release (reconciler)

  /**
   * Gives everything back for a reservation that never became a battle. Only call this after the
   * Battle DO confirmed (and recorded) that it will never start this battle; `reserved` alone is
   * not proof, because activation is delivered after the DO already started.
   */
  async release(reservationId: string): Promise<ReleaseResult> {
    const row = await this.row(reservationId);
    if (row === null) return { status: "rejected", reservationId, current: null };
    if (row.status !== "reserved" && row.status !== "released") return { status: "rejected", reservationId, current: row.status };
    const already = row.status === "released";
    const bag = normalizeBag(JSON.parse(row.bag_json) as Record<string, number>) ?? [];
    const at = this.now();
    const ours = `EXISTS (SELECT 1 FROM battle_reservations WHERE reservation_id = ? AND status = 'released')`;
    const stmts: SqlBound[] = [
      this.db
        .prepare(`UPDATE battle_reservations SET status = 'released', updated_at = ? WHERE reservation_id = ? AND status = 'reserved'`)
        .bind(at, reservationId),
    ];
    bag.forEach(([itemId, qty], i) => {
      stmts.push(
        this.db
          .prepare(
            `INSERT INTO item_ledger (operation_id, line_no, account_id, item_id, delta, reason, created_at)
             SELECT ?, ?, ?, ?, ?, 'battle_release', ? WHERE ${ours} ON CONFLICT DO NOTHING`,
          )
          .bind(`release:${reservationId}`, i, row.account_id, itemId, qty, at, reservationId),
      );
    });
    stmts.push(...this.unlockAssets(reservationId, ours, [reservationId]));
    await this.db.batch(stmts);

    const after = await this.row(reservationId);
    if (after?.status !== "released") return { status: "rejected", reservationId, current: after?.status ?? null };
    return { status: already ? "already_released" : "released", reservationId };
  }

  /** Reservations still `reserved` (never activated) created before `beforeIso`. */
  async staleReserved(beforeIso: string, limit = 50): Promise<{ reservationId: string; battleId: string }[]> {
    const { results: rows } = await this.db
      .prepare(
        `SELECT reservation_id, battle_id FROM battle_reservations
         WHERE status = 'reserved' AND created_at < ? ORDER BY created_at LIMIT ?`,
      )
      .bind(beforeIso, limit)
      .all<{ reservation_id: string; battle_id: string }>();
    return rows.map((r) => ({ reservationId: r.reservation_id, battleId: r.battle_id }));
  }

  /** Current balance of one item, for checks and the dev inventory route. */
  async balance(accountId: string, itemId: string): Promise<number> {
    const r = await this.db
      .prepare(`SELECT COALESCE(SUM(delta), 0) AS q FROM item_ledger WHERE account_id = ? AND item_id = ?`)
      .bind(accountId, itemId)
      .first<{ q: number }>();
    return r?.q ?? 0;
  }

  /** Every non-zero item balance of an account. */
  async balances(accountId: string): Promise<Record<string, number>> {
    const { results } = await this.db
      .prepare(`SELECT item_id, quantity FROM inventory_balances WHERE account_id = ? AND quantity <> 0 ORDER BY item_id`)
      .bind(accountId)
      .all<{ item_id: string; quantity: number }>();
    return Object.fromEntries(results.map((r) => [r.item_id, r.quantity]));
  }

  /** The bag a reservation holds (immutable once reserved), or null if there is no reservation. */
  async reservedBag(reservationId: string): Promise<{ status: ReservationStatus; bag: Record<string, number> } | null> {
    const row = await this.row(reservationId);
    return row === null ? null : { status: row.status, bag: JSON.parse(row.bag_json) as Record<string, number> };
  }

  async reservation(reservationId: string): Promise<{ status: ReservationStatus; outcome: string | null } | null> {
    const r = await this.db
      .prepare(`SELECT status, outcome FROM battle_reservations WHERE reservation_id = ?`)
      .bind(reservationId)
      .first<{ status: ReservationStatus; outcome: string | null }>();
    return r ?? null;
  }

  /**
   * DEV ONLY: create the account and give it items under a fixed operation id (idempotent).
   * The Worker exposes this only when ENVIRONMENT is dev; players never have a grant path.
   */
  async devGrant(operationId: string, accountId: string, items: Record<string, number>): Promise<void> {
    const at = this.now();
    const bag = normalizeBag(items) ?? [];
    await this.db.batch([
      this.db.prepare(`INSERT INTO accounts (id, created_at) VALUES (?, ?) ON CONFLICT DO NOTHING`).bind(accountId, at),
      ...bag.map(([itemId, qty], i) =>
        this.db
          .prepare(
            `INSERT INTO item_ledger (operation_id, line_no, account_id, item_id, delta, reason, created_at)
             VALUES (?, ?, ?, ?, ?, 'dev_grant', ?) ON CONFLICT DO NOTHING`,
          )
          .bind(operationId, i, accountId, itemId, qty, at),
      ),
    ]);
  }

  /** Frees the companions and gear this reservation locked. */
  private unlockAssets(reservationId: string, guard: string, guardArgs: unknown[]): SqlBound[] {
    return ["monster_instances", "equipment_instances"].map((table) =>
      this.db
        .prepare(`UPDATE ${table} SET lock_state = 'free', lock_ref = NULL WHERE lock_ref = ? AND lock_state = 'in_battle' AND ${guard}`)
        .bind(reservationId, ...guardArgs),
    );
  }

  private row(reservationId: string): Promise<ReservationRow | null> {
    return this.db
      .prepare(
        `SELECT reservation_id, account_id, battle_id, status, bag_json, request_hash, settlement_hash
         FROM battle_reservations WHERE reservation_id = ?`,
      )
      .bind(reservationId)
      .first<ReservationRow>();
  }
}

/** Sorted [itemId, qty] pairs with positive integer quantities, or null if anything is malformed. */
function normalizeBag(bag: Record<string, number>): [string, number][] | null {
  const out: [string, number][] = [];
  for (const [itemId, qty] of Object.entries(bag)) {
    if (!ITEM_ID.test(itemId) || !Number.isSafeInteger(qty) || qty < 0) return null;
    if (qty > 0) out.push([itemId, qty]);
  }
  return out.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

const marks = (n: number) => Array.from({ length: n }, () => "?").join(", ");

/** A reported HP/MP value as a stored one: whole, never negative. */
const resource = (v: number) => Math.max(0, Math.floor(Number.isFinite(v) ? v : 0));
