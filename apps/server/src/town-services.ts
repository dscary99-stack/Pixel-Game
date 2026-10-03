/**
 * Coins and town services on D1 (migration 0007): sell to the NPC, install and remove Sigils.
 *
 * Every request carries an operationId. The first write of its batch inserts a service_operations
 * row only if every guard holds (balances, ownership, lock, location, no open fight); the other
 * writes check that row carries this request's hash, so the batch lands whole or not at all. A
 * retry with the same id returns the stored result; the same id with another payload is refused.
 */
import {
  COMPANION_GROWTH_VERSION,
  InstallSigilRequestSchema,
  RebirthRequestSchema,
  companionPrimaryStats,
  rebirthCost,
  RemoveSigilRequestSchema,
  SellRequestSchema,
  planSigilInstall,
  sellQuote,
  sigilItemFor,
  sigilRemovalCost,
  type EquipmentDefinition,
  type ItemDefinition,
  type LootTable,
  type RulesConfig,
  type SigilDefinition,
  type SpeciesDefinition,
} from "@pmrpg/shared";
import { hashJson, type SqlBound, type SqlDb } from "./reward-ledger";

export interface TownContent {
  items: ReadonlyMap<string, ItemDefinition>;
  equipment: ReadonlyMap<string, EquipmentDefinition>;
  sigils: ReadonlyMap<string, SigilDefinition>;
  species: ReadonlyMap<string, SpeciesDefinition>;
  lootTables: ReadonlyMap<string, LootTable>;
}

type Kind = "npc_sell" | "sigil_install" | "sigil_remove" | "companion_rebirth";

export type ServiceRejection =
  | "INVALID_REQUEST"
  | "PAYLOAD_MISMATCH"
  | "NOT_SELLABLE"
  | "NOT_IN_TOWN"
  | "IN_BATTLE"
  | "INSUFFICIENT_ITEMS"
  | "INSUFFICIENT_COINS"
  | "NOT_OWNER"
  | "ASSET_LOCKED"
  | "NOT_A_SIGIL"
  | "SIGIL_INCOMPATIBLE"
  | "SIGIL_SLOTS_FULL"
  | "NO_SUCH_SOCKET"
  | "COST_CHANGED"
  | "MAX_REBIRTH"
  | "NO_MATERIAL"
  | "LEVEL_TOO_LOW"
  | "PLAYER_LEVEL_TOO_LOW"
  | "CHANGED";

export type ServiceResult<T> = { status: "done"; replayed: boolean; result: T } | { status: "rejected"; reason: ServiceRejection; message: string };

export interface SellResult {
  sold: { itemId: string; quantity: number; coins: number }[];
  total: number;
}
export interface RebirthResult {
  companionId: string;
  stage: number;
  paid: { coins: number; itemId: string; quantity: number };
}
export interface SigilResult {
  equipmentId: string;
  sigils: string[];
  /** Coins paid (removal only). */
  paid: number;
}

const OPEN_BATTLE = `EXISTS (SELECT 1 FROM battle_reservations WHERE account_id = ? AND status IN ('reserved', 'active'))`;

interface PieceRow {
  id: string;
  definition_id: string;
  lock_state: string;
  sigil_sockets_json: string;
}

export class TownServices {
  constructor(
    private readonly db: SqlDb,
    private readonly rules: RulesConfig,
    private readonly content: TownContent,
    private readonly townMapIds: readonly string[],
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async coins(accountId: string): Promise<number> {
    const r = await this.db.prepare(`SELECT COALESCE(SUM(delta), 0) AS c FROM coin_ledger WHERE account_id = ?`).bind(accountId).first<{ c: number }>();
    return r?.c ?? 0;
  }

  /** DEV ONLY: coins once per operation id. The Worker calls this only when ENVIRONMENT is dev. */
  async devGrantCoins(operationId: string, accountId: string, coins: number): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO coin_ledger (operation_id, line_no, account_id, delta, reason, created_at)
         VALUES (?, 0, ?, ?, 'dev_grant', ?) ON CONFLICT DO NOTHING`,
      )
      .bind(operationId, accountId, coins, this.now())
      .run();
  }

  // ------------------------------------------------------------------ NPC sale (coin source)

  async sell(accountId: string, raw: unknown): Promise<ServiceResult<SellResult>> {
    const parsed = SellRequestSchema.safeParse(raw);
    if (!parsed.success) return reject("INVALID_REQUEST", issues(parsed.error));
    const { operationId, lines } = parsed.data;
    const quote = sellQuote(lines, this.content.items);
    if (!quote.ok) return reject(quote.code, quote.message);
    const sorted = [...quote.lines].sort((a, b) => (a.itemId < b.itemId ? -1 : 1));
    const hash = await hashJson({ kind: "npc_sell", lines: sorted.map(({ itemId, quantity }) => ({ itemId, quantity })) });
    const prior = await this.prior<SellResult>(accountId, operationId, hash);
    if (prior !== null) return prior;

    const guards = [this.inTown(), `NOT ${OPEN_BATTLE}`];
    const args: unknown[] = [accountId, ...this.townMapIds, accountId];
    for (const l of sorted) {
      guards.push(`(SELECT COALESCE(SUM(delta), 0) FROM item_ledger WHERE account_id = ? AND item_id = ?) >= ?`);
      args.push(accountId, l.itemId, l.quantity);
    }
    const result: SellResult = { sold: sorted, total: quote.total };
    const ledgerId = `svc:${accountId}:${operationId}`;
    const at = this.now();
    const ours = this.ours(accountId, operationId, hash);
    await this.db.batch([
      this.anchor(accountId, operationId, "npc_sell", hash, result, guards, args),
      ...sorted.map((l, i) =>
        this.db
          .prepare(
            `INSERT INTO item_ledger (operation_id, line_no, account_id, item_id, delta, reason, created_at)
             SELECT ?, ?, ?, ?, ?, 'npc_sell', ? WHERE ${ours.sql} ON CONFLICT DO NOTHING`,
          )
          .bind(ledgerId, i, accountId, l.itemId, -l.quantity, at, ...ours.args),
      ),
      this.db
        .prepare(
          `INSERT INTO coin_ledger (operation_id, line_no, account_id, delta, reason, created_at)
           SELECT ?, 0, ?, ?, 'npc_sell', ? WHERE ${ours.sql} ON CONFLICT DO NOTHING`,
        )
        .bind(ledgerId, accountId, quote.total, at, ...ours.args),
    ]);
    return this.outcome(accountId, operationId, hash, async () => {
      const why = await this.whereAndFight(accountId);
      if (why !== null) return why;
      return reject("INSUFFICIENT_ITEMS", "you do not have that many");
    });
  }

  // ------------------------------------------------------------------ Sigil install

  async installSigil(accountId: string, raw: unknown): Promise<ServiceResult<SigilResult>> {
    const parsed = InstallSigilRequestSchema.safeParse(raw);
    if (!parsed.success) return reject("INVALID_REQUEST", issues(parsed.error));
    const { operationId, equipmentId, sigilItemId } = parsed.data;
    const hash = await hashJson({ kind: "sigil_install", equipmentId, sigilItemId });
    const prior = await this.prior<SigilResult>(accountId, operationId, hash);
    if (prior !== null) return prior;

    const piece = await this.piece(accountId, equipmentId);
    const def = piece === null ? undefined : this.content.equipment.get(piece.definition_id);
    if (piece === null || def === undefined) return reject("NOT_OWNER", "that equipment is not yours");
    const sockets = JSON.parse(piece.sigil_sockets_json) as string[];
    const plan = planSigilInstall(this.rules, def, sockets, this.content.items.get(sigilItemId), this.content.sigils);
    if (!plan.ok) return reject(plan.code, plan.message);

    const result: SigilResult = { equipmentId, sigils: plan.sockets, paid: 0 };
    const guards = [
      `NOT ${OPEN_BATTLE}`,
      `EXISTS (SELECT 1 FROM equipment_instances WHERE id = ? AND owner_id = ? AND lock_state = 'free' AND sigil_sockets_json = ?)`,
      `(SELECT COALESCE(SUM(delta), 0) FROM item_ledger WHERE account_id = ? AND item_id = ?) >= 1`,
    ];
    const args = [accountId, equipmentId, accountId, piece.sigil_sockets_json, accountId, sigilItemId];
    const ours = this.ours(accountId, operationId, hash);
    await this.db.batch([
      this.anchor(accountId, operationId, "sigil_install", hash, result, guards, args),
      this.db
        .prepare(
          `INSERT INTO item_ledger (operation_id, line_no, account_id, item_id, delta, reason, created_at)
           SELECT ?, 0, ?, ?, -1, 'sigil_install', ? WHERE ${ours.sql} ON CONFLICT DO NOTHING`,
        )
        .bind(`svc:${accountId}:${operationId}`, accountId, sigilItemId, this.now(), ...ours.args),
      this.setSockets(equipmentId, plan.sockets, ours),
    ]);
    return this.outcome(accountId, operationId, hash, () => this.whySigilRefused(accountId, equipmentId, piece.sigil_sockets_json, { itemId: sigilItemId }));
  }

  // ------------------------------------------------------------------ Sigil removal

  async removeSigil(accountId: string, raw: unknown): Promise<ServiceResult<SigilResult>> {
    const parsed = RemoveSigilRequestSchema.safeParse(raw);
    if (!parsed.success) return reject("INVALID_REQUEST", issues(parsed.error));
    const { operationId, equipmentId, socket, expectedCost } = parsed.data;
    const hash = await hashJson({ kind: "sigil_remove", equipmentId, socket, expectedCost });
    const prior = await this.prior<SigilResult>(accountId, operationId, hash);
    if (prior !== null) return prior;

    const piece = await this.piece(accountId, equipmentId);
    const def = piece === null ? undefined : this.content.equipment.get(piece.definition_id);
    if (piece === null || def === undefined) return reject("NOT_OWNER", "that equipment is not yours");
    const sockets = JSON.parse(piece.sigil_sockets_json) as string[];
    const sigilId = sockets[socket];
    if (sigilId === undefined) return reject("NO_SUCH_SOCKET", "that socket is empty");
    const item = sigilItemFor(sigilId, this.content.items);
    if (item === undefined) throw new Error(`no item for ${sigilId}`);
    const cost = sigilRemovalCost(this.rules, def);
    if (cost !== expectedCost) return reject("COST_CHANGED", `removal now costs ${cost}`);

    const next = sockets.filter((_, i) => i !== socket);
    const result: SigilResult = { equipmentId, sigils: next, paid: cost };
    const guards = [
      this.inTown(),
      `NOT ${OPEN_BATTLE}`,
      `EXISTS (SELECT 1 FROM equipment_instances WHERE id = ? AND owner_id = ? AND lock_state = 'free' AND sigil_sockets_json = ?)`,
      `(SELECT COALESCE(SUM(delta), 0) FROM coin_ledger WHERE account_id = ?) >= ?`,
    ];
    const args = [accountId, ...this.townMapIds, accountId, equipmentId, accountId, piece.sigil_sockets_json, accountId, cost];
    const ledgerId = `svc:${accountId}:${operationId}`;
    const at = this.now();
    const ours = this.ours(accountId, operationId, hash);
    await this.db.batch([
      this.anchor(accountId, operationId, "sigil_remove", hash, result, guards, args),
      this.db
        .prepare(
          `INSERT INTO coin_ledger (operation_id, line_no, account_id, delta, reason, created_at)
           SELECT ?, 0, ?, ?, 'sigil_remove', ? WHERE ${ours.sql} ON CONFLICT DO NOTHING`,
        )
        .bind(ledgerId, accountId, -cost, at, ...ours.args),
      // Removal never destroys the Sigil (P08): it goes back to the bag.
      this.db
        .prepare(
          `INSERT INTO item_ledger (operation_id, line_no, account_id, item_id, delta, reason, created_at)
           SELECT ?, 0, ?, ?, 1, 'sigil_remove', ? WHERE ${ours.sql} ON CONFLICT DO NOTHING`,
        )
        .bind(ledgerId, accountId, item.id, at, ...ours.args),
      this.setSockets(equipmentId, next, ours),
    ]);
    return this.outcome(accountId, operationId, hash, async () => {
      const why = await this.whereAndFight(accountId);
      if (why !== null) return why;
      if ((await this.coins(accountId)) < cost) return reject("INSUFFICIENT_COINS", `removal costs ${cost} coins`);
      return this.whySigilRefused(accountId, equipmentId, piece.sigil_sockets_json, null);
    });
  }

  // ------------------------------------------------------------------ companion Rebirth

  /**
   * Rebirth one companion (chapter 04 §7): in town, outside fights, at max level, with the licence
   * level, coins and the species' material. One batch: the anchor checks every guard (including the
   * stage the player saw), then coins and material are charged and the companion goes back to Lv1
   * with the next stage. A retry replays; a second request for the same stage finds it changed.
   */
  async rebirth(accountId: string, raw: unknown): Promise<ServiceResult<RebirthResult>> {
    const parsed = RebirthRequestSchema.safeParse(raw);
    if (!parsed.success) return reject("INVALID_REQUEST", issues(parsed.error));
    const { operationId, companionId, expectedStage } = parsed.data;
    const hash = await hashJson({ kind: "companion_rebirth", companionId, expectedStage });
    const prior = await this.prior<RebirthResult>(accountId, operationId, hash);
    if (prior !== null) return prior;

    const pet = await this.db
      .prepare(`SELECT species_id, rebirth_stage, growth_seed, growth_history_version FROM monster_instances WHERE id = ? AND owner_id = ?`)
      .bind(companionId, accountId)
      .first<{ species_id: string; rebirth_stage: number; growth_seed: string | null; growth_history_version: number }>();
    const species = pet === null ? undefined : this.content.species.get(pet.species_id);
    if (pet === null || species === undefined) return reject("NOT_OWNER", "that companion is not yours");
    if (pet.rebirth_stage !== expectedStage) return reject("CHANGED", "the companion changed; reload and try again");
    const cost = rebirthCost(this.rules, species, expectedStage, this.content);
    if (!cost.ok) return reject(cost.code, cost.message);

    const result: RebirthResult = { companionId, stage: cost.nextStage, paid: { coins: cost.coins, itemId: cost.materialItemId, quantity: cost.materialQty } };
    const guards = [
      this.inTown(),
      `NOT ${OPEN_BATTLE}`,
      `EXISTS (SELECT 1 FROM monster_instances WHERE id = ? AND owner_id = ? AND lock_state = 'free' AND rebirth_stage = ? AND xp >= ?)`,
      `EXISTS (SELECT 1 FROM characters WHERE account_id = ? AND xp >= ?)`,
      `(SELECT COALESCE(SUM(delta), 0) FROM coin_ledger WHERE account_id = ?) >= ?`,
      `(SELECT COALESCE(SUM(delta), 0) FROM item_ledger WHERE account_id = ? AND item_id = ?) >= ?`,
    ];
    const args = [
      accountId,
      ...this.townMapIds,
      accountId,
      companionId,
      accountId,
      expectedStage,
      cost.companionExp,
      accountId,
      cost.playerExp,
      accountId,
      cost.coins,
      accountId,
      cost.materialItemId,
      cost.materialQty,
    ];
    // Same growth path from Lv1 again, with the new stage's bonus (companion-growth.ts).
    const stats =
      pet.growth_history_version >= COMPANION_GROWTH_VERSION
        ? companionPrimaryStats(this.rules, species.archetype, pet.growth_seed ?? companionId, 1, cost.nextStage)
        : null;
    const ledgerId = `svc:${accountId}:${operationId}`;
    const at = this.now();
    const ours = this.ours(accountId, operationId, hash);
    await this.db.batch([
      this.anchor(accountId, operationId, "companion_rebirth", hash, result, guards, args),
      this.db
        .prepare(
          `INSERT INTO coin_ledger (operation_id, line_no, account_id, delta, reason, created_at)
           SELECT ?, 0, ?, ?, 'companion_rebirth', ? WHERE ${ours.sql} ON CONFLICT DO NOTHING`,
        )
        .bind(ledgerId, accountId, -cost.coins, at, ...ours.args),
      this.db
        .prepare(
          `INSERT INTO item_ledger (operation_id, line_no, account_id, item_id, delta, reason, created_at)
           SELECT ?, 0, ?, ?, ?, 'companion_rebirth', ? WHERE ${ours.sql} ON CONFLICT DO NOTHING`,
        )
        .bind(ledgerId, accountId, cost.materialItemId, -cost.materialQty, at, ...ours.args),
      this.db
        .prepare(
          `UPDATE monster_instances
           SET rebirth_stage = ?, current_level = 1, xp = 0, hp = NULL, mp = NULL,
               primary_stats_json = COALESCE(?, primary_stats_json)
           WHERE id = ? AND owner_id = ? AND rebirth_stage = ? AND ${ours.sql}`,
        )
        .bind(cost.nextStage, stats === null ? null : JSON.stringify(stats), companionId, accountId, expectedStage, ...ours.args),
    ]);
    return this.outcome(accountId, operationId, hash, async () => {
      const why = await this.whereAndFight(accountId);
      if (why !== null) return why;
      const now = await this.db
        .prepare(`SELECT rebirth_stage, xp, lock_state FROM monster_instances WHERE id = ? AND owner_id = ?`)
        .bind(companionId, accountId)
        .first<{ rebirth_stage: number; xp: number; lock_state: string }>();
      if (now === null) return reject("NOT_OWNER", "that companion is not yours");
      if (now.rebirth_stage !== expectedStage) return reject("CHANGED", "the companion changed; reload and try again");
      if (now.lock_state !== "free") return reject("ASSET_LOCKED", "that companion is busy");
      if (now.xp < cost.companionExp) return reject("LEVEL_TOO_LOW", `the companion must be Lv${cost.companionLevel}`);
      const ch = await this.db.prepare(`SELECT xp FROM characters WHERE account_id = ?`).bind(accountId).first<{ xp: number }>();
      if ((ch?.xp ?? 0) < cost.playerExp) return reject("PLAYER_LEVEL_TOO_LOW", `your character must be Lv${cost.playerLevel}`);
      if ((await this.coins(accountId)) < cost.coins) return reject("INSUFFICIENT_COINS", `Rebirth costs ${cost.coins} coins`);
      return reject("INSUFFICIENT_ITEMS", `Rebirth needs ${cost.materialQty} ${cost.materialItemId}`);
    });
  }

  // ------------------------------------------------------------------ helpers

  private inTown(): string {
    return this.townMapIds.length === 0
      ? "0"
      : `EXISTS (SELECT 1 FROM player_positions WHERE account_id = ? AND map_id IN (${marks(this.townMapIds.length)}))`;
  }

  private ours(accountId: string, operationId: string, hash: string) {
    return {
      sql: `EXISTS (SELECT 1 FROM service_operations WHERE account_id = ? AND operation_id = ? AND request_hash = ?)`,
      args: [accountId, operationId, hash] as unknown[],
    };
  }

  private anchor(accountId: string, operationId: string, kind: Kind, hash: string, result: unknown, guards: string[], args: unknown[]): SqlBound {
    return this.db
      .prepare(
        `INSERT INTO service_operations (account_id, operation_id, kind, request_hash, result_json, created_at)
         SELECT ?, ?, ?, ?, ?, ? WHERE ${guards.join(" AND ")} ON CONFLICT DO NOTHING`,
      )
      .bind(accountId, operationId, kind, hash, JSON.stringify(result), this.now(), ...args);
  }

  private setSockets(equipmentId: string, sockets: string[], ours: { sql: string; args: unknown[] }): SqlBound {
    return this.db
      .prepare(`UPDATE equipment_instances SET sigil_sockets_json = ? WHERE id = ? AND ${ours.sql}`)
      .bind(JSON.stringify(sockets), equipmentId, ...ours.args);
  }

  private stored(accountId: string, operationId: string) {
    return this.db
      .prepare(`SELECT kind, request_hash, result_json FROM service_operations WHERE account_id = ? AND operation_id = ?`)
      .bind(accountId, operationId)
      .first<{ kind: Kind; request_hash: string; result_json: string }>();
  }

  private async prior<T>(accountId: string, operationId: string, hash: string): Promise<ServiceResult<T> | null> {
    const row = await this.stored(accountId, operationId);
    if (row === null) return null;
    if (row.request_hash !== hash) return reject("PAYLOAD_MISMATCH", "that operation id was used for another request");
    return { status: "done", replayed: true, result: JSON.parse(row.result_json) as T };
  }

  /** Read back whether our anchor landed; otherwise ask `why` (read-only) for the reason. */
  private async outcome<T>(accountId: string, operationId: string, hash: string, why: () => Promise<ServiceResult<never>>): Promise<ServiceResult<T>> {
    const row = await this.stored(accountId, operationId);
    if (row?.request_hash === hash) return { status: "done", replayed: false, result: JSON.parse(row.result_json) as T };
    if (row !== null) return reject("PAYLOAD_MISMATCH", "that operation id was used for another request");
    return why();
  }

  private async whereAndFight(accountId: string): Promise<ServiceResult<never> | null> {
    const pos = await this.db.prepare(`SELECT map_id FROM player_positions WHERE account_id = ?`).bind(accountId).first<{ map_id: string }>();
    if (pos === null || !this.townMapIds.includes(pos.map_id)) return reject("NOT_IN_TOWN", "go to town first");
    return this.fighting(accountId);
  }

  private async fighting(accountId: string): Promise<ServiceResult<never> | null> {
    const open = await this.db.prepare(`SELECT 1 AS x FROM battle_reservations WHERE account_id = ? AND status IN ('reserved', 'active')`).bind(accountId).first();
    return open === null ? null : reject("IN_BATTLE", "finish your fight first");
  }

  private async whySigilRefused(accountId: string, equipmentId: string, socketsJson: string, needs: { itemId: string } | null): Promise<ServiceResult<never>> {
    const fight = await this.fighting(accountId);
    if (fight !== null) return fight;
    const now = await this.piece(accountId, equipmentId);
    if (now === null) return reject("NOT_OWNER", "that equipment is not yours");
    if (now.lock_state !== "free") return reject("ASSET_LOCKED", "that piece is locked");
    if (now.sigil_sockets_json !== socketsJson) return reject("CHANGED", "the piece changed; reload and try again");
    if (needs !== null) {
      const r = await this.db
        .prepare(`SELECT COALESCE(SUM(delta), 0) AS q FROM item_ledger WHERE account_id = ? AND item_id = ?`)
        .bind(accountId, needs.itemId)
        .first<{ q: number }>();
      if ((r?.q ?? 0) < 1) return reject("INSUFFICIENT_ITEMS", "you have no such Sigil");
    }
    return reject("CHANGED", "something changed; reload and try again");
  }

  private piece(accountId: string, equipmentId: string): Promise<PieceRow | null> {
    return this.db
      .prepare(`SELECT id, definition_id, lock_state, sigil_sockets_json FROM equipment_instances WHERE id = ? AND owner_id = ?`)
      .bind(equipmentId, accountId)
      .first<PieceRow>();
  }
}

const reject = (reason: ServiceRejection, message: string): { status: "rejected"; reason: ServiceRejection; message: string } => ({ status: "rejected", reason, message });
const issues = (e: { issues: { path: PropertyKey[]; message: string }[] }) => e.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
const marks = (n: number) => Array.from({ length: n }, () => "?").join(", ");
