/**
 * Account vault (คลังข้ามตัวละคร, Nut 2026-10-08; vault.ts in shared). Every character of one login
 * shares it: put items, gear and coins in, and any of them takes them out, both at the town NPC.
 * The request anchor works like the market's (exchange-store.ts): it is inserted only when every
 * guard holds, and every other write applies only under its token, so two characters taking the last
 * stack at once get one winner and a retried request replays its first answer.
 */
import { VaultMoveRequestSchema, itemName, storable, vaultMoveIssue, type VaultMove, type VaultView, type RulesConfig, type AssetSnapshot } from "@pmrpg/shared";
import { ExchangeBase, OPEN_BATTLE, issues, marks, reject, type ExchangeContent, type ExchangeResult } from "./exchange-store";
import { hashJson, type SqlBound, type SqlDb } from "./reward-ledger";

export interface VaultMoveResult {
  items: VaultMove["items"];
  equipmentIds: string[];
  coins: number;
}

/** In equipment_instances.lock_ref for a piece that sits in the vault. */
const IN_VAULT = "vault";

export class VaultStore extends ExchangeBase {
  protected override readonly opsTable = "vault_operations";

  constructor(db: SqlDb, rules: RulesConfig, content: ExchangeContent, townMapIds: readonly string[], now: () => string = () => new Date().toISOString()) {
    super(db, rules, content, townMapIds, async () => {}, now);
  }

  /** The login's vault, or the account's own for a dev account that belongs to no login. */
  async vaultOf(accountId: string): Promise<{ id: string; shared: boolean }> {
    const r = await this.db.prepare(`SELECT user_id FROM user_characters WHERE account_id = ?`).bind(accountId).first<{ user_id: string }>();
    return r === null ? { id: `solo:${accountId}`, shared: false } : { id: `user:${r.user_id}`, shared: true };
  }

  private async vaultItems(vaultId: string): Promise<Map<string, number>> {
    const { results } = await this.db
      .prepare(`SELECT item_id, SUM(delta) AS n FROM vault_item_ledger WHERE vault_id = ? GROUP BY item_id HAVING SUM(delta) > 0 ORDER BY item_id`)
      .bind(vaultId)
      .all<{ item_id: string; n: number }>();
    return new Map(results.map((r) => [r.item_id, r.n]));
  }
  private async vaultCoins(vaultId: string): Promise<number> {
    return (await this.db.prepare(`SELECT COALESCE(SUM(delta), 0) AS n FROM vault_coin_ledger WHERE vault_id = ?`).bind(vaultId).first<{ n: number }>())?.n ?? 0;
  }
  private async vaultPieceIds(vaultId: string): Promise<string[]> {
    const { results } = await this.db.prepare(`SELECT equipment_id FROM vault_equipment WHERE vault_id = ? ORDER BY deposited_at, equipment_id`).bind(vaultId).all<{ equipment_id: string }>();
    return results.map((r) => r.equipment_id);
  }

  /** Slots in use after the move: one per item kind held and one per piece (P25). */
  private static usedSlotsSql = `((SELECT COUNT(*) FROM (SELECT item_id FROM vault_item_ledger WHERE vault_id = ? GROUP BY item_id HAVING SUM(delta) > 0))
      + (SELECT COUNT(*) FROM vault_equipment WHERE vault_id = ?))`;

  async view(accountId: string): Promise<VaultView | null> {
    if ((await this.character(accountId)) === null) return null;
    const vault = await this.vaultOf(accountId);
    const items = await this.vaultItems(vault.id);
    const pieces = await this.pieces(await this.vaultPieceIds(vault.id));
    return {
      items: [...items].map(([itemId, quantity]) => ({ itemId, name: itemName(this.content.items, itemId), quantity })),
      equipment: pieces.filter((p) => this.content.equipment.has(p.definition_id)).map((p) => this.pieceSnap(p) as Extract<AssetSnapshot, { kind: "equipment" }>),
      coins: await this.vaultCoins(vault.id),
      usedSlots: items.size + pieces.length,
      slots: this.rules.provisional.vault.value.slots,
      shared: vault.shared,
    };
  }

  private parse(raw: unknown): VaultMove | ReturnType<typeof reject> {
    const parsed = VaultMoveRequestSchema.safeParse(raw);
    if (!parsed.success) return reject("INVALID_REQUEST", issues(parsed.error));
    const shape = vaultMoveIssue(this.rules, parsed.data);
    return shape === null ? parsed.data : reject("INVALID_REQUEST", shape);
  }

  /** Put things from this character into the vault (at the town NPC). */
  async deposit(accountId: string, raw: unknown): Promise<ExchangeResult<VaultMoveResult>> {
    const move = this.parse(raw);
    if ("status" in move) return move;
    const { operationId, items, equipmentIds, coins } = move;
    const hash = await hashJson({ kind: "vault_deposit", items, equipmentIds, coins });
    const prior = await this.prior<VaultMoveResult>(accountId, operationId, hash);
    if (prior !== null) return prior;
    if ((await this.character(accountId)) === null) return reject("NO_CHARACTER", "create a character first");
    const where = await this.whereAndFight(accountId);
    if (where !== null) return where;
    const vault = await this.vaultOf(accountId);

    for (const l of items) {
      const def = this.content.items.get(l.itemId);
      if (def === undefined) return reject("NOT_OWNER", `unknown item ${l.itemId}`);
      if (!storable(def)) return reject("NOT_STORABLE", `${def.name.th} cannot go into the vault (ห้ามฝากคลัง)`);
      if ((await this.itemCount(accountId, l.itemId)) < l.quantity) return reject("NOT_ENOUGH_ITEMS", `you do not have ${l.quantity} ${def.name.th}`);
    }
    const pieces = await this.pieces(equipmentIds);
    for (const id of equipmentIds) {
      const p = pieces.find((x) => x.id === id);
      if (p === undefined || p.owner_id !== accountId) return reject("NOT_OWNER", "that piece is not yours");
      const def = this.content.equipment.get(p.definition_id);
      if (def === undefined) return reject("NOT_OWNER", `unknown piece ${p.definition_id}`);
      if (!storable(def, p.no_store === 1)) return reject("NOT_STORABLE", `${def.name.th} cannot go into the vault (ห้ามฝากคลัง)`);
      if (p.worn > 0) return reject("WORN", "take the piece off first");
      if (p.lock_state !== "free") return reject("ASSET_LOCKED", "a fight, a listing or a trade holds that piece");
      if (p.affix_pending_json !== null) return reject("CHOICE_PENDING", "keep the old or the new affix first");
    }
    if ((await this.coins(accountId)) < coins) return reject("NOT_ENOUGH_COINS", `you have fewer than ${coins} coins`);
    const held = await this.vaultItems(vault.id);
    const newSlots = items.filter((l) => !held.has(l.itemId)).length + equipmentIds.length;
    const slots = this.rules.provisional.vault.value.slots;
    if (held.size + (await this.vaultPieceIds(vault.id)).length + newSlots > slots) return reject("VAULT_FULL", `the vault holds ${slots} slots`);

    const guards = [this.townGuard(), `NOT ${OPEN_BATTLE}`, `(SELECT COALESCE(SUM(delta), 0) FROM coin_ledger WHERE account_id = ?) >= ?`, `${VaultStore.usedSlotsSql} + ? <= ?`];
    const args: unknown[] = [accountId, ...this.townMapIds, accountId, accountId, coins, vault.id, vault.id, newSlots, slots];
    for (const l of items) {
      guards.push(`(SELECT COALESCE(SUM(delta), 0) FROM item_ledger WHERE account_id = ? AND item_id = ?) >= ?`);
      args.push(accountId, l.itemId, l.quantity);
    }
    if (equipmentIds.length > 0) {
      guards.push(
        `(SELECT COUNT(*) FROM equipment_instances WHERE owner_id = ? AND lock_state = 'free' AND no_store = 0 AND affix_pending_json IS NULL AND id IN (${marks(equipmentIds.length)})) = ?`,
        `NOT EXISTS (SELECT 1 FROM character_equipment WHERE equipment_instance_id IN (${marks(equipmentIds.length)}))`,
      );
      args.push(accountId, ...equipmentIds, equipmentIds.length, ...equipmentIds);
    }
    const result: VaultMoveResult = { items, equipmentIds, coins };
    const token = crypto.randomUUID();
    const ours = this.ours(accountId, operationId, token);
    const at = this.now();
    const key = `vlt:${token}`;
    const stmts: SqlBound[] = [this.anchor(accountId, operationId, "vault_deposit", hash, token, result, guards, args)];
    items.forEach((l, i) => {
      stmts.push(
        this.db
          .prepare(`INSERT INTO item_ledger (operation_id, line_no, account_id, item_id, delta, reason, created_at) SELECT ?, ?, ?, ?, ?, 'vault_deposit', ? WHERE ${ours.sql} ON CONFLICT DO NOTHING`)
          .bind(key, i, accountId, l.itemId, -l.quantity, at, ...ours.args),
        this.db
          .prepare(`INSERT INTO vault_item_ledger (operation_id, line_no, vault_id, account_id, item_id, delta, created_at) SELECT ?, ?, ?, ?, ?, ?, ? WHERE ${ours.sql} ON CONFLICT DO NOTHING`)
          .bind(key, i, vault.id, accountId, l.itemId, l.quantity, at, ...ours.args),
      );
    });
    if (coins > 0) {
      stmts.push(
        this.db
          .prepare(`INSERT INTO coin_ledger (operation_id, line_no, account_id, delta, reason, created_at) SELECT ?, 0, ?, ?, 'vault_deposit', ? WHERE ${ours.sql} ON CONFLICT DO NOTHING`)
          .bind(key, accountId, -coins, at, ...ours.args),
        this.db
          .prepare(`INSERT INTO vault_coin_ledger (operation_id, vault_id, account_id, delta, created_at) SELECT ?, ?, ?, ?, ? WHERE ${ours.sql} ON CONFLICT DO NOTHING`)
          .bind(key, vault.id, accountId, coins, at, ...ours.args),
      );
    }
    for (const id of equipmentIds) {
      stmts.push(
        this.db
          .prepare(`UPDATE equipment_instances SET lock_state = 'in_escrow', lock_ref = ? WHERE id = ? AND owner_id = ? AND lock_state = 'free' AND ${ours.sql}`)
          .bind(IN_VAULT, id, accountId, ...ours.args),
        this.db
          .prepare(`INSERT INTO vault_equipment (equipment_id, vault_id, deposited_by, deposited_at) SELECT ?, ?, ?, ? WHERE ${ours.sql} ON CONFLICT DO NOTHING`)
          .bind(id, vault.id, accountId, at, ...ours.args),
      );
    }
    await this.db.batch(stmts);
    return this.outcome(accountId, operationId, hash, token, async () => (await this.whereAndFight(accountId)) ?? reject("CHANGED", "something changed; reload and try again"));
  }

  /** Take things out of the vault into this character (at the town NPC). */
  async withdraw(accountId: string, raw: unknown): Promise<ExchangeResult<VaultMoveResult>> {
    const move = this.parse(raw);
    if ("status" in move) return move;
    const { operationId, items, equipmentIds, coins } = move;
    const hash = await hashJson({ kind: "vault_withdraw", items, equipmentIds, coins });
    const prior = await this.prior<VaultMoveResult>(accountId, operationId, hash);
    if (prior !== null) return prior;
    if ((await this.character(accountId)) === null) return reject("NO_CHARACTER", "create a character first");
    const where = await this.whereAndFight(accountId);
    if (where !== null) return where;
    const vault = await this.vaultOf(accountId);

    const held = await this.vaultItems(vault.id);
    for (const l of items) if ((held.get(l.itemId) ?? 0) < l.quantity) return reject("NOT_IN_VAULT", `the vault does not hold ${l.quantity} ${itemName(this.content.items, l.itemId)}`);
    const inVault = new Set(await this.vaultPieceIds(vault.id));
    for (const id of equipmentIds) if (!inVault.has(id)) return reject("NOT_IN_VAULT", "that piece is not in the vault");
    if ((await this.vaultCoins(vault.id)) < coins) return reject("NOT_IN_VAULT", `the vault holds fewer than ${coins} coins`);

    const guards = [this.townGuard(), `NOT ${OPEN_BATTLE}`, `(SELECT COALESCE(SUM(delta), 0) FROM vault_coin_ledger WHERE vault_id = ?) >= ?`];
    const args: unknown[] = [accountId, ...this.townMapIds, accountId, vault.id, coins];
    for (const l of items) {
      guards.push(`(SELECT COALESCE(SUM(delta), 0) FROM vault_item_ledger WHERE vault_id = ? AND item_id = ?) >= ?`);
      args.push(vault.id, l.itemId, l.quantity);
    }
    if (equipmentIds.length > 0) {
      guards.push(`(SELECT COUNT(*) FROM vault_equipment WHERE vault_id = ? AND equipment_id IN (${marks(equipmentIds.length)})) = ?`);
      args.push(vault.id, ...equipmentIds, equipmentIds.length);
    }
    const result: VaultMoveResult = { items, equipmentIds, coins };
    const token = crypto.randomUUID();
    const ours = this.ours(accountId, operationId, token);
    const at = this.now();
    const key = `vlt:${token}`;
    const stmts: SqlBound[] = [this.anchor(accountId, operationId, "vault_withdraw", hash, token, result, guards, args)];
    items.forEach((l, i) => {
      stmts.push(
        this.db
          .prepare(`INSERT INTO vault_item_ledger (operation_id, line_no, vault_id, account_id, item_id, delta, created_at) SELECT ?, ?, ?, ?, ?, ?, ? WHERE ${ours.sql} ON CONFLICT DO NOTHING`)
          .bind(key, i, vault.id, accountId, l.itemId, -l.quantity, at, ...ours.args),
        this.db
          .prepare(`INSERT INTO item_ledger (operation_id, line_no, account_id, item_id, delta, reason, created_at) SELECT ?, ?, ?, ?, ?, 'vault_withdraw', ? WHERE ${ours.sql} ON CONFLICT DO NOTHING`)
          .bind(key, i, accountId, l.itemId, l.quantity, at, ...ours.args),
      );
    });
    if (coins > 0) {
      stmts.push(
        this.db
          .prepare(`INSERT INTO vault_coin_ledger (operation_id, vault_id, account_id, delta, created_at) SELECT ?, ?, ?, ?, ? WHERE ${ours.sql} ON CONFLICT DO NOTHING`)
          .bind(key, vault.id, accountId, -coins, at, ...ours.args),
        this.db
          .prepare(`INSERT INTO coin_ledger (operation_id, line_no, account_id, delta, reason, created_at) SELECT ?, 0, ?, ?, 'vault_withdraw', ? WHERE ${ours.sql} ON CONFLICT DO NOTHING`)
          .bind(key, accountId, coins, at, ...ours.args),
      );
    }
    for (const id of equipmentIds) {
      stmts.push(
        // The taker becomes the owner; the piece keeps its protect flag.
        this.db
          .prepare(
            `UPDATE equipment_instances SET owner_id = ?, lock_state = 'free', lock_ref = NULL, version = version + 1
             WHERE id = ? AND lock_state = 'in_escrow' AND lock_ref = ? AND EXISTS (SELECT 1 FROM vault_equipment WHERE equipment_id = ? AND vault_id = ?) AND ${ours.sql}`,
          )
          .bind(accountId, id, IN_VAULT, id, vault.id, ...ours.args),
        this.db.prepare(`DELETE FROM vault_equipment WHERE equipment_id = ? AND vault_id = ? AND ${ours.sql}`).bind(id, vault.id, ...ours.args),
      );
    }
    await this.db.batch(stmts);
    return this.outcome(accountId, operationId, hash, token, async () => (await this.whereAndFight(accountId)) ?? reject("NOT_IN_VAULT", "someone else took it first; look again"));
  }
}
