/**
 * World Market and direct trade on D1 (migration 0028; Nut 2026-10-07; chapter 11 §4).
 *
 * Every request carries an operationId. One batch per request: the anchor row in exchange_operations is
 * inserted only when every guard holds (owner, free, not worn / not in the team, not protected, not
 * ห้ามขาย / ห้ามเทรด, balances, listing or offer still open, in town, no open fight); every other write
 * of the batch applies only under that row's token, so a losing racer changes nothing. D1 runs batches
 * one at a time, so two buyers of one listing, or a buy and a cancel, cannot both win. A retry replays
 * the stored result; the same id with another request is refused.
 *
 * Held things never leave their owner's rows until they move: gear and companions are locked
 * 'in_escrow' with lock_ref = listing / offer id, items and coins are taken out of the ledger with a
 * keyed line. Ledger keys are per listing / offer, so even a replayed write cannot pay twice.
 */
import {
  MarketBrowseQuerySchema,
  MarketBuyRequestSchema,
  MarketListRequestSchema,
  MarketListingRefSchema,
  TRADE_CODE_ALPHABET,
  TradeOfferRequestSchema,
  TradeRespondRequestSchema,
  equipmentName,
  formatTradeCode,
  itemName,
  marketFee,
  sellable,
  tradeShapeIssue,
  tradeable,
  transferLevelCheck,
  type AssetSnapshot,
  type Element,
  type EquipmentDefinition,
  type ItemDefinition,
  type MarketBrowseQuery,
  type MarketListingView,
  type MarketView,
  type PrimaryStats,
  type Rarity,
  type RolledAffix,
  type RulesConfig,
  type SpeciesDefinition,
  type TradeKind,
  type TradeOfferView,
  type TradeSide,
  type TradeView,
} from "@pmrpg/shared";
import { hashJson, type SqlBound, type SqlDb } from "./reward-ledger";

export type ExchangeRejection =
  | "INVALID_REQUEST"
  | "PAYLOAD_MISMATCH"
  | "NO_CHARACTER"
  | "NOT_IN_TOWN"
  | "IN_BATTLE"
  | "NOT_OWNER"
  | "NOT_SELLABLE"
  | "NOT_TRADEABLE"
  | "PROTECTED"
  | "WORN"
  | "IN_TEAM"
  | "ASSET_LOCKED"
  | "CHOICE_PENDING"
  | "NOT_ENOUGH_COINS"
  | "NOT_ENOUGH_ITEMS"
  | "COST_CHANGED"
  | "TOO_MANY_LISTINGS"
  | "TOO_MANY_OFFERS"
  | "NOT_FOUND"
  | "CLOSED"
  | "EXPIRED"
  | "OWN_LISTING"
  | "NO_SUCH_PLAYER"
  | "SELF_TRADE"
  | "LEVEL_INELIGIBLE"
  | "INVALID_TRADE"
  | "CHANGED";

export type ExchangeResult<T> = { status: "done"; replayed: boolean; result: T } | { status: "rejected"; reason: ExchangeRejection; message: string };
type Rejected = { status: "rejected"; reason: ExchangeRejection; message: string };

export interface ListResult {
  listingId: string;
  fee: number;
  expiresAt: string;
}
export interface BuyResult {
  listingId: string;
  price: number;
  asset: AssetSnapshot;
}
export interface CancelResult {
  listingId: string;
}
export interface OfferResult {
  offerId: string;
  expiresAt: string;
}
export interface RespondResult {
  offerId: string;
  status: "accepted" | "declined" | "cancelled";
}

export interface ExchangeContent {
  items: ReadonlyMap<string, ItemDefinition>;
  equipment: ReadonlyMap<string, EquipmentDefinition>;
  species: ReadonlyMap<string, SpeciesDefinition>;
}

interface CharRow {
  id: string;
  name: string;
  level: number;
  trade_code: string | null;
}
interface PieceRow {
  id: string;
  owner_id: string;
  definition_id: string;
  rarity: Rarity;
  refine_level: number;
  affixes_json: string;
  sigil_sockets_json: string;
  affix_pending_json: string | null;
  lock_state: string;
  protected: number;
  no_sell: number;
  no_trade: number;
  worn: number;
}
interface PetRow {
  id: string;
  owner_id: string;
  species_id: string;
  element: string;
  current_level: number;
  rebirth_stage: number;
  primary_stats_json: string;
  trained_skill_levels_json: string;
  lock_state: string;
  protected: number;
  no_sell: number;
  no_trade: number;
  in_team: number;
}
interface ListingRow {
  id: string;
  seller_id: string;
  kind: "item" | "equipment" | "companion";
  asset_id: string;
  quantity: number;
  price: number;
  tax_bps: number;
  snapshot_json: string;
  status: "active" | "sold" | "cancelled";
  created_at: string;
  expires_at: string;
  seller_name: string | null;
}
interface OfferRow {
  id: string;
  kind: TradeKind;
  from_id: string;
  to_id: string;
  give_json: string;
  want_json: string;
  view_json: string;
  status: "open" | "accepted" | "declined" | "cancelled";
  created_at: string;
  expires_at: string;
  from_name: string | null;
  to_name: string | null;
}

const OPEN_BATTLE = `EXISTS (SELECT 1 FROM battle_reservations WHERE account_id = ? AND status IN ('reserved', 'active'))`;
const reject = (reason: ExchangeRejection, message: string): Rejected => ({ status: "rejected", reason, message });
const marks = (n: number) => Array.from({ length: n }, () => "?").join(", ");
const issues = (e: { issues: { path: PropertyKey[]; message: string }[] }) => e.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
const addHours = (iso: string, h: number) => new Date(Date.parse(iso) + h * 3_600_000).toISOString();

/** Shared by the market and the trade desk: the anchor, replay, guards and asset reads. */
class ExchangeBase {
  constructor(
    protected readonly db: SqlDb,
    protected readonly rules: RulesConfig,
    protected readonly content: ExchangeContent,
    protected readonly townMapIds: readonly string[],
    /** Brings stored levels up to date with EXP before any level check (character-store.syncLevels). */
    protected readonly syncLevels: (accountId: string) => Promise<void>,
    protected readonly now: () => string,
  ) {}

  protected character(accountId: string) {
    return this.db.prepare(`SELECT id, name, level, trade_code FROM characters WHERE account_id = ?`).bind(accountId).first<CharRow>();
  }

  protected townGuard(): string {
    return `EXISTS (SELECT 1 FROM player_positions WHERE account_id = ? AND map_id IN (${marks(this.townMapIds.length)}))`;
  }

  protected async inTown(accountId: string): Promise<boolean> {
    if (this.townMapIds.length === 0) return false;
    const pos = await this.db.prepare(`SELECT map_id FROM player_positions WHERE account_id = ?`).bind(accountId).first<{ map_id: string }>();
    return pos !== null && this.townMapIds.includes(pos.map_id);
  }

  protected async fighting(accountId: string): Promise<boolean> {
    return (await this.db.prepare(`SELECT 1 AS x FROM battle_reservations WHERE account_id = ? AND status IN ('reserved', 'active')`).bind(accountId).first()) !== null;
  }

  protected async whereAndFight(accountId: string): Promise<Rejected | null> {
    if (!(await this.inTown(accountId))) return reject("NOT_IN_TOWN", "go to town first");
    if (await this.fighting(accountId)) return reject("IN_BATTLE", "finish your fight first");
    return null;
  }

  protected async coins(accountId: string): Promise<number> {
    const r = await this.db.prepare(`SELECT COALESCE(SUM(delta), 0) AS n FROM coin_ledger WHERE account_id = ?`).bind(accountId).first<{ n: number }>();
    return r?.n ?? 0;
  }

  protected async itemCount(accountId: string, itemId: string): Promise<number> {
    const r = await this.db
      .prepare(`SELECT COALESCE(SUM(delta), 0) AS n FROM item_ledger WHERE account_id = ? AND item_id = ?`)
      .bind(accountId, itemId)
      .first<{ n: number }>();
    return r?.n ?? 0;
  }

  protected async pieces(ids: readonly string[]): Promise<PieceRow[]> {
    if (ids.length === 0) return [];
    const { results } = await this.db
      .prepare(
        `SELECT e.id, e.owner_id, e.definition_id, e.rarity, e.refine_level, e.affixes_json, e.sigil_sockets_json, e.affix_pending_json,
           e.lock_state, e.protected, e.no_sell, e.no_trade,
           (SELECT COUNT(*) FROM character_equipment ce WHERE ce.equipment_instance_id = e.id) AS worn
         FROM equipment_instances e WHERE e.id IN (${marks(ids.length)})`,
      )
      .bind(...ids)
      .all<PieceRow>();
    return results;
  }

  protected async pets(ids: readonly string[]): Promise<PetRow[]> {
    if (ids.length === 0) return [];
    const { results } = await this.db
      .prepare(
        `SELECT m.id, m.owner_id, m.species_id, m.element, m.current_level, m.rebirth_stage, m.primary_stats_json, m.trained_skill_levels_json,
           m.lock_state, m.protected, m.no_sell, m.no_trade,
           (SELECT COUNT(*) FROM character_team t WHERE t.monster_instance_id = m.id) AS in_team
         FROM monster_instances m WHERE m.id IN (${marks(ids.length)})`,
      )
      .bind(...ids)
      .all<PetRow>();
    return results;
  }

  /** Why a piece cannot leave its owner now (`purpose` picks which flag applies). */
  protected pieceIssue(p: PieceRow | undefined, owner: string, purpose: "sell" | "trade"): Rejected | null {
    if (p === undefined || p.owner_id !== owner) return reject("NOT_OWNER", "that piece is not yours");
    const def = this.content.equipment.get(p.definition_id);
    if (def === undefined) return reject("NOT_OWNER", `unknown piece ${p.definition_id}`);
    if (purpose === "sell" && !sellable(def, p.no_sell === 1)) return reject("NOT_SELLABLE", `${def.name.th} cannot be sold (ห้ามขาย)`);
    if (purpose === "trade" && !tradeable(def, p.no_trade === 1)) return reject("NOT_TRADEABLE", `${def.name.th} cannot be traded (ห้ามเทรด)`);
    if (p.protected === 1) return reject("PROTECTED", "that piece is protected; unprotect it first");
    if (p.worn > 0) return reject("WORN", "take the piece off first");
    if (p.lock_state !== "free") return reject("ASSET_LOCKED", "a fight, a listing or a trade holds that piece");
    if (p.affix_pending_json !== null) return reject("CHOICE_PENDING", "keep the old or the new affix first");
    return null;
  }

  protected petIssue(c: PetRow | undefined, owner: string, purpose: "sell" | "trade"): Rejected | null {
    if (c === undefined || c.owner_id !== owner) return reject("NOT_OWNER", "that companion is not yours");
    if (!this.content.species.has(c.species_id)) return reject("NOT_OWNER", `unknown species ${c.species_id}`);
    if (purpose === "sell" && c.no_sell === 1) return reject("NOT_SELLABLE", "this companion cannot be sold (ห้ามขาย)");
    if (purpose === "trade" && c.no_trade === 1) return reject("NOT_TRADEABLE", "this companion cannot be traded (ห้ามเทรด)");
    if (c.protected === 1) return reject("PROTECTED", "this companion is protected; unprotect it first");
    if (c.in_team > 0) return reject("IN_TEAM", "take it out of the team first");
    if (c.lock_state !== "free") return reject("ASSET_LOCKED", "a fight, a listing or a trade holds this companion");
    return null;
  }

  /** O01: the lowest level the new owner may be. */
  protected minRecipientLevel(c: PetRow): number {
    const sp = this.content.species.get(c.species_id)!;
    return Math.max(1, Math.max(c.current_level, sp.fixedWildLevel) - this.rules.confirmed.tradeLevelGap.value);
  }

  protected levelIssue(recipientLevel: number, c: PetRow): Rejected | null {
    const check = transferLevelCheck(this.rules, recipientLevel, { currentLevel: c.current_level }, this.content.species.get(c.species_id)!);
    return check.ok ? null : reject("LEVEL_INELIGIBLE", `the new owner must be Lv${check.minRecipientLevel}+ for ${this.content.species.get(c.species_id)!.name.th} Lv${c.current_level} (O01)`);
  }

  protected itemSnap(itemId: string, quantity: number): AssetSnapshot {
    return { kind: "item", itemId, name: itemName(this.content.items, itemId), quantity };
  }
  protected pieceSnap(p: PieceRow): AssetSnapshot {
    const def = this.content.equipment.get(p.definition_id)!;
    return {
      kind: "equipment",
      equipmentId: p.id,
      definitionId: p.definition_id,
      name: equipmentName(this.content.equipment, p.definition_id),
      requiredLevel: def.requiredLevel,
      rarity: p.rarity,
      refineLevel: p.refine_level,
      affixes: JSON.parse(p.affixes_json) as RolledAffix[],
      sigils: JSON.parse(p.sigil_sockets_json) as string[],
    };
  }
  protected petSnap(c: PetRow): AssetSnapshot {
    const sp = this.content.species.get(c.species_id)!;
    return {
      kind: "companion",
      companionId: c.id,
      speciesId: c.species_id,
      name: sp.name.th,
      element: c.element as Element,
      level: c.current_level,
      rebirthStage: c.rebirth_stage,
      primaryStats: JSON.parse(c.primary_stats_json) as PrimaryStats,
      trainedSkillLevels: JSON.parse(c.trained_skill_levels_json) as Record<string, number>,
      bondAfterTransfer: 0,
      minRecipientLevel: this.minRecipientLevel(c),
    };
  }

  /** Statements that hand a held (lock_ref = ref) piece / companion to `to`, or back to free for its owner. */
  protected releaseHeld(ref: string, ours: { sql: string; args: unknown[] }, to: string | null): SqlBound[] {
    if (to === null) {
      return [
        this.db.prepare(`UPDATE equipment_instances SET lock_state = 'free', lock_ref = NULL WHERE lock_ref = ? AND lock_state = 'in_escrow' AND ${ours.sql}`).bind(ref, ...ours.args),
        this.db.prepare(`UPDATE monster_instances SET lock_state = 'free', lock_ref = NULL WHERE lock_ref = ? AND lock_state = 'in_escrow' AND ${ours.sql}`).bind(ref, ...ours.args),
      ];
    }
    return [
      this.db
        .prepare(
          `UPDATE equipment_instances SET owner_id = ?, lock_state = 'free', lock_ref = NULL, protected = 0, version = version + 1
           WHERE lock_ref = ? AND lock_state = 'in_escrow' AND ${ours.sql}`,
        )
        .bind(to, ref, ...ours.args),
      this.db
        .prepare(
          `UPDATE monster_instances SET owner_id = ?, lock_state = 'free', lock_ref = NULL, bond = 0, nickname = NULL, protected = 0,
             ownership_version = ownership_version + 1
           WHERE lock_ref = ? AND lock_state = 'in_escrow' AND ${ours.sql}`,
        )
        .bind(to, ref, ...ours.args),
    ];
  }

  // ------------------------------------------------------------------ anchor / replay

  protected ours(accountId: string, operationId: string, token: string) {
    return { sql: `EXISTS (SELECT 1 FROM exchange_operations WHERE account_id = ? AND operation_id = ? AND token = ?)`, args: [accountId, operationId, token] as unknown[] };
  }

  protected anchor(accountId: string, operationId: string, kind: string, hash: string, token: string, result: unknown, guards: string[], args: unknown[]): SqlBound {
    return this.db
      .prepare(
        `INSERT INTO exchange_operations (account_id, operation_id, kind, request_hash, token, result_json, created_at)
         SELECT ?, ?, ?, ?, ?, ?, ? WHERE ${guards.length === 0 ? "1" : guards.join(" AND ")} ON CONFLICT DO NOTHING`,
      )
      .bind(accountId, operationId, kind, hash, token, JSON.stringify(result), this.now(), ...args);
  }

  private row(accountId: string, operationId: string) {
    return this.db
      .prepare(`SELECT request_hash, token, result_json FROM exchange_operations WHERE account_id = ? AND operation_id = ?`)
      .bind(accountId, operationId)
      .first<{ request_hash: string; token: string; result_json: string }>();
  }

  protected async prior<T>(accountId: string, operationId: string, hash: string): Promise<ExchangeResult<T> | null> {
    const row = await this.row(accountId, operationId);
    if (row === null) return null;
    if (row.request_hash !== hash) return reject("PAYLOAD_MISMATCH", "that operation id was used for another request");
    return { status: "done", replayed: true, result: JSON.parse(row.result_json) as T };
  }

  protected async outcome<T>(accountId: string, operationId: string, hash: string, token: string, why: () => Promise<Rejected>): Promise<ExchangeResult<T>> {
    const row = await this.row(accountId, operationId);
    if (row === null) return why();
    if (row.request_hash !== hash) return reject("PAYLOAD_MISMATCH", "that operation id was used for another request");
    return { status: "done", replayed: row.token !== token, result: JSON.parse(row.result_json) as T };
  }
}

// ==================================================================== World Market

export class MarketStore extends ExchangeBase {
  constructor(db: SqlDb, rules: RulesConfig, content: ExchangeContent, townMapIds: readonly string[], syncLevels: (accountId: string) => Promise<void>, now: () => string = () => new Date().toISOString()) {
    super(db, rules, content, townMapIds, syncLevels, now);
  }

  async list(accountId: string, raw: unknown): Promise<ExchangeResult<ListResult>> {
    const parsed = MarketListRequestSchema.safeParse(raw);
    if (!parsed.success) return reject("INVALID_REQUEST", issues(parsed.error));
    const { operationId, kind, assetId, price, expectedFee } = parsed.data;
    const quantity = kind === "item" ? parsed.data.quantity : 1;
    if (kind !== "item" && parsed.data.quantity !== 1) return reject("INVALID_REQUEST", "gear and companions are listed one at a time");
    const m = this.rules.provisional.market.value;
    if (price < m.minPrice || price > m.maxPrice) return reject("INVALID_REQUEST", `price must be ${m.minPrice}–${m.maxPrice}`);
    const hash = await hashJson({ kind: "market_list", assetKind: kind, assetId, quantity, price, expectedFee });
    const prior = await this.prior<ListResult>(accountId, operationId, hash);
    if (prior !== null) return prior;

    await this.syncLevels(accountId);
    if ((await this.character(accountId)) === null) return reject("NO_CHARACTER", "create a character first");
    const where = await this.whereAndFight(accountId);
    if (where !== null) return where;
    const fee = marketFee(this.rules, price);
    if (fee !== expectedFee) return reject("COST_CHANGED", "the fee changed; look again before confirming");
    if ((await this.activeCount(accountId)) >= m.maxActiveListings) return reject("TOO_MANY_LISTINGS", `at most ${m.maxActiveListings} listings at a time`);
    if ((await this.coins(accountId)) < fee) return reject("NOT_ENOUGH_COINS", `the listing fee is ${fee} coins`);

    let snapshot: AssetSnapshot;
    let nameTh: string;
    const assetGuard: string[] = [];
    const assetArgs: unknown[] = [];
    if (kind === "item") {
      const def = this.content.items.get(assetId);
      if (def === undefined) return reject("NOT_OWNER", `unknown item ${assetId}`);
      if (!sellable(def)) return reject("NOT_SELLABLE", `${def.name.th} cannot be sold (ห้ามขาย)`);
      if ((await this.itemCount(accountId, assetId)) < quantity) return reject("NOT_ENOUGH_ITEMS", `you do not have ${quantity} ${def.name.th}`);
      snapshot = this.itemSnap(assetId, quantity);
      nameTh = def.name.th;
      assetGuard.push(`(SELECT COALESCE(SUM(delta), 0) FROM item_ledger WHERE account_id = ? AND item_id = ?) >= ?`);
      assetArgs.push(accountId, assetId, quantity);
    } else if (kind === "equipment") {
      const [p] = await this.pieces([assetId]);
      const why = this.pieceIssue(p, accountId, "sell");
      if (why !== null) return why;
      snapshot = this.pieceSnap(p!);
      nameTh = (snapshot as { name: string }).name;
      assetGuard.push(
        `EXISTS (SELECT 1 FROM equipment_instances WHERE id = ? AND owner_id = ? AND lock_state = 'free' AND protected = 0 AND no_sell = 0 AND affix_pending_json IS NULL)`,
        `NOT EXISTS (SELECT 1 FROM character_equipment WHERE equipment_instance_id = ?)`,
      );
      assetArgs.push(assetId, accountId, assetId);
    } else {
      const [c] = await this.pets([assetId]);
      const why = this.petIssue(c, accountId, "sell");
      if (why !== null) return why;
      snapshot = this.petSnap(c!);
      nameTh = (snapshot as { name: string }).name;
      assetGuard.push(
        `EXISTS (SELECT 1 FROM monster_instances WHERE id = ? AND owner_id = ? AND lock_state = 'free' AND protected = 0 AND no_sell = 0)`,
        `NOT EXISTS (SELECT 1 FROM character_team WHERE monster_instance_id = ?)`,
      );
      assetArgs.push(assetId, accountId, assetId);
    }

    const listingId = `ml_${(await hashJson({ accountId, operationId })).slice(0, 24)}`;
    const at = this.now();
    const expiresAt = addHours(at, m.listingHours);
    const result: ListResult = { listingId, fee, expiresAt };
    const guards = [
      this.townGuard(),
      `NOT ${OPEN_BATTLE}`,
      `(SELECT COUNT(*) FROM market_listings WHERE seller_id = ? AND status = 'active') < ?`,
      `(SELECT COALESCE(SUM(delta), 0) FROM coin_ledger WHERE account_id = ?) >= ?`,
      ...assetGuard,
    ];
    const args = [accountId, ...this.townMapIds, accountId, accountId, m.maxActiveListings, accountId, fee, ...assetArgs];
    const token = crypto.randomUUID();
    const ours = this.ours(accountId, operationId, token);
    const stmts: SqlBound[] = [
      this.anchor(accountId, operationId, "market_list", hash, token, result, guards, args),
      this.db
        .prepare(
          `INSERT INTO market_listings (id, seller_id, kind, asset_id, quantity, price, fee_paid, tax_bps, name_th, snapshot_json, status, created_at, expires_at)
           SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ? WHERE ${ours.sql} ON CONFLICT DO NOTHING`,
        )
        .bind(listingId, accountId, kind, assetId, quantity, price, fee, m.saleTaxBps, nameTh, JSON.stringify(snapshot), at, expiresAt, ...ours.args),
      this.db
        .prepare(`INSERT INTO coin_ledger (operation_id, line_no, account_id, delta, reason, created_at) SELECT ?, 0, ?, ?, 'market_fee', ? WHERE ${ours.sql} ON CONFLICT DO NOTHING`)
        .bind(`mkt:${listingId}:fee`, accountId, -fee, at, ...ours.args),
    ];
    if (kind === "item") {
      stmts.push(
        this.db
          .prepare(
            `INSERT INTO item_ledger (operation_id, line_no, account_id, item_id, delta, reason, created_at)
             SELECT ?, 0, ?, ?, ?, 'market_escrow', ? WHERE ${ours.sql} ON CONFLICT DO NOTHING`,
          )
          .bind(`mkt:${listingId}:escrow`, accountId, assetId, -quantity, at, ...ours.args),
      );
    } else {
      const table = kind === "equipment" ? "equipment_instances" : "monster_instances";
      stmts.push(
        this.db
          .prepare(`UPDATE ${table} SET lock_state = 'in_escrow', lock_ref = ? WHERE id = ? AND owner_id = ? AND lock_state = 'free' AND ${ours.sql}`)
          .bind(listingId, assetId, accountId, ...ours.args),
      );
    }
    await this.db.batch(stmts);
    return this.outcome(accountId, operationId, hash, token, async () => (await this.whereAndFight(accountId)) ?? reject("CHANGED", "something changed; reload and try again"));
  }

  async cancel(accountId: string, raw: unknown): Promise<ExchangeResult<CancelResult>> {
    const parsed = MarketListingRefSchema.safeParse(raw);
    if (!parsed.success) return reject("INVALID_REQUEST", issues(parsed.error));
    const { operationId, listingId } = parsed.data;
    const hash = await hashJson({ kind: "market_cancel", listingId });
    const prior = await this.prior<CancelResult>(accountId, operationId, hash);
    if (prior !== null) return prior;
    const l = await this.listing(listingId);
    if (l === null || l.seller_id !== accountId) return reject("NOT_FOUND", "that listing is not yours");
    if (l.status !== "active") return reject("CLOSED", `that listing is already ${l.status}`);

    const token = crypto.randomUUID();
    const ours = this.ours(accountId, operationId, token);
    const at = this.now();
    const stmts: SqlBound[] = [
      this.anchor(accountId, operationId, "market_cancel", hash, token, { listingId } satisfies CancelResult, [`EXISTS (SELECT 1 FROM market_listings WHERE id = ? AND seller_id = ? AND status = 'active')`], [listingId, accountId]),
      this.db.prepare(`UPDATE market_listings SET status = 'cancelled', closed_at = ? WHERE id = ? AND status = 'active' AND ${ours.sql}`).bind(at, listingId, ...ours.args),
    ];
    if (l.kind === "item") {
      stmts.push(
        this.db
          .prepare(
            `INSERT INTO item_ledger (operation_id, line_no, account_id, item_id, delta, reason, created_at)
             SELECT ?, 0, ?, ?, ?, 'market_return', ? WHERE ${ours.sql} ON CONFLICT DO NOTHING`,
          )
          .bind(`mkt:${listingId}:return`, accountId, l.asset_id, l.quantity, at, ...ours.args),
      );
    } else stmts.push(...this.releaseHeld(listingId, ours, null));
    await this.db.batch(stmts);
    return this.outcome(accountId, operationId, hash, token, async () => {
      const now = await this.listing(listingId);
      return reject("CLOSED", `that listing is already ${now?.status ?? "gone"}`);
    });
  }

  async buy(accountId: string, raw: unknown): Promise<ExchangeResult<BuyResult>> {
    const parsed = MarketBuyRequestSchema.safeParse(raw);
    if (!parsed.success) return reject("INVALID_REQUEST", issues(parsed.error));
    const { operationId, listingId, expectedPrice } = parsed.data;
    const hash = await hashJson({ kind: "market_buy", listingId, expectedPrice });
    const prior = await this.prior<BuyResult>(accountId, operationId, hash);
    if (prior !== null) return prior;

    await this.syncLevels(accountId);
    const me = await this.character(accountId);
    if (me === null) return reject("NO_CHARACTER", "create a character first");
    const l = await this.listing(listingId);
    if (l === null) return reject("NOT_FOUND", "no such listing");
    if (l.status !== "active") return reject("CLOSED", `that listing is already ${l.status}`);
    const at = this.now();
    if (l.expires_at <= at) return reject("EXPIRED", "that listing has expired");
    if (l.seller_id === accountId) return reject("OWN_LISTING", "that is your own listing; cancel it instead");
    if (l.price !== expectedPrice) return reject("COST_CHANGED", "the price is not what you were shown");
    const where = await this.whereAndFight(accountId);
    if (where !== null) return where;
    if ((await this.coins(accountId)) < l.price) return reject("NOT_ENOUGH_COINS", `you need ${l.price} coins`);
    const asset = JSON.parse(l.snapshot_json) as AssetSnapshot;
    let minLevel = 1;
    if (l.kind === "companion") {
      const [c] = await this.pets([l.asset_id]);
      if (c === undefined) return reject("CHANGED", "that companion is gone");
      const why = this.levelIssue(me.level, c);
      if (why !== null) return why;
      minLevel = this.minRecipientLevel(c);
    }

    const tax = Math.floor((l.price * l.tax_bps) / 10_000);
    const result: BuyResult = { listingId, price: l.price, asset };
    const guards = [
      this.townGuard(),
      `NOT ${OPEN_BATTLE}`,
      `EXISTS (SELECT 1 FROM market_listings WHERE id = ? AND status = 'active' AND expires_at > ? AND seller_id <> ? AND price = ?)`,
      `(SELECT COALESCE(SUM(delta), 0) FROM coin_ledger WHERE account_id = ?) >= ?`,
      `EXISTS (SELECT 1 FROM characters WHERE account_id = ? AND level >= ?)`,
    ];
    const args = [accountId, ...this.townMapIds, accountId, listingId, at, accountId, l.price, accountId, l.price, accountId, minLevel];
    const token = crypto.randomUUID();
    const ours = this.ours(accountId, operationId, token);
    const stmts: SqlBound[] = [
      this.anchor(accountId, operationId, "market_buy", hash, token, result, guards, args),
      this.db.prepare(`UPDATE market_listings SET status = 'sold', buyer_id = ?, closed_at = ? WHERE id = ? AND status = 'active' AND ${ours.sql}`).bind(accountId, at, listingId, ...ours.args),
      this.db
        .prepare(`INSERT INTO coin_ledger (operation_id, line_no, account_id, delta, reason, created_at) SELECT ?, 0, ?, ?, 'market_buy', ? WHERE ${ours.sql} ON CONFLICT DO NOTHING`)
        .bind(`mkt:${listingId}:sale`, accountId, -l.price, at, ...ours.args),
    ];
    if (l.price - tax > 0) {
      stmts.push(
        this.db
          .prepare(`INSERT INTO coin_ledger (operation_id, line_no, account_id, delta, reason, created_at) SELECT ?, 1, ?, ?, 'market_sale', ? WHERE ${ours.sql} ON CONFLICT DO NOTHING`)
          .bind(`mkt:${listingId}:sale`, l.seller_id, l.price - tax, at, ...ours.args),
      );
    }
    if (l.kind === "item") {
      stmts.push(
        this.db
          .prepare(
            `INSERT INTO item_ledger (operation_id, line_no, account_id, item_id, delta, reason, created_at)
             SELECT ?, 0, ?, ?, ?, 'market_buy', ? WHERE ${ours.sql} ON CONFLICT DO NOTHING`,
          )
          .bind(`mkt:${listingId}:delivery`, accountId, l.asset_id, l.quantity, at, ...ours.args),
      );
    } else stmts.push(...this.releaseHeld(listingId, ours, accountId));
    await this.db.batch(stmts);
    return this.outcome(accountId, operationId, hash, token, async () => {
      const now = await this.listing(listingId);
      if (now !== null && now.status !== "active") return reject("CLOSED", `that listing is already ${now.status}`);
      return (await this.whereAndFight(accountId)) ?? reject("CHANGED", "something changed; reload and try again");
    });
  }

  async view(accountId: string, raw: MarketBrowseQuery = {}): Promise<MarketView | { error: string }> {
    const parsed = MarketBrowseQuerySchema.safeParse(raw);
    if (!parsed.success) return { error: issues(parsed.error) };
    const { kind, q, sort, page } = parsed.data;
    const m = this.rules.provisional.market.value;
    const at = this.now();
    const where = [`l.status = 'active'`, `l.expires_at > ?`];
    const args: unknown[] = [at];
    if (kind !== undefined) {
      where.push(`l.kind = ?`);
      args.push(kind);
    }
    if (q !== undefined && q.trim() !== "") {
      where.push(`(instr(l.name_th, ?) > 0 OR instr(l.asset_id, ?) > 0)`);
      args.push(q.trim(), q.trim());
    }
    const order = sort === "price_asc" ? "l.price ASC, l.created_at DESC" : sort === "price_desc" ? "l.price DESC, l.created_at DESC" : "l.created_at DESC, l.id";
    const { results } = await this.db
      .prepare(
        `SELECT l.*, c.name AS seller_name FROM market_listings l LEFT JOIN characters c ON c.account_id = l.seller_id
         WHERE ${where.join(" AND ")} ORDER BY ${order} LIMIT ? OFFSET ?`,
      )
      .bind(...args, m.pageSize + 1, page * m.pageSize)
      .all<ListingRow>();
    const { results: mine } = await this.db
      .prepare(
        `SELECT l.*, c.name AS seller_name FROM market_listings l LEFT JOIN characters c ON c.account_id = l.seller_id
         WHERE l.seller_id = ? ORDER BY (l.status = 'active') DESC, l.created_at DESC LIMIT 40`,
      )
      .bind(accountId)
      .all<ListingRow>();
    return {
      listings: results.slice(0, m.pageSize).map((r) => this.listingView(r, accountId, at)),
      page,
      hasMore: results.length > m.pageSize,
      mine: mine.map((r) => this.listingView(r, accountId, at)),
      feeBps: m.listingFeeBps,
      taxBps: m.saleTaxBps,
      listingHours: m.listingHours,
      maxActiveListings: m.maxActiveListings,
    };
  }

  private listingView(r: ListingRow, viewer: string, at: string): MarketListingView {
    const mine = r.seller_id === viewer;
    return {
      listingId: r.id,
      sellerName: r.seller_name ?? "?",
      mine,
      kind: r.kind,
      price: r.price,
      ...(mine ? { proceeds: r.price - Math.floor((r.price * r.tax_bps) / 10_000) } : {}),
      status: r.status === "active" && r.expires_at <= at ? "expired" : r.status,
      createdAt: r.created_at,
      expiresAt: r.expires_at,
      asset: JSON.parse(r.snapshot_json) as AssetSnapshot,
    };
  }

  private async activeCount(accountId: string): Promise<number> {
    const r = await this.db.prepare(`SELECT COUNT(*) AS n FROM market_listings WHERE seller_id = ? AND status = 'active'`).bind(accountId).first<{ n: number }>();
    return r?.n ?? 0;
  }

  private listing(id: string) {
    return this.db
      .prepare(`SELECT l.*, c.name AS seller_name FROM market_listings l LEFT JOIN characters c ON c.account_id = l.seller_id WHERE l.id = ?`)
      .bind(id)
      .first<ListingRow>();
  }
}

// ==================================================================== direct trade

export class TradeStore extends ExchangeBase {
  constructor(
    db: SqlDb,
    rules: RulesConfig,
    content: ExchangeContent,
    townMapIds: readonly string[],
    syncLevels: (accountId: string) => Promise<void>,
    now: () => string = () => new Date().toISOString(),
    private readonly newCode: () => string = randomTradeCode,
  ) {
    super(db, rules, content, townMapIds, syncLevels, now);
  }

  /** This character's trade code, made on first use. */
  async code(accountId: string): Promise<string | null> {
    for (let i = 0; i < 5; i++) {
      const ch = await this.character(accountId);
      if (ch === null) return null;
      if (ch.trade_code !== null) return ch.trade_code;
      try {
        await this.db.prepare(`UPDATE characters SET trade_code = ? WHERE account_id = ? AND trade_code IS NULL`).bind(this.newCode(), accountId).run();
      } catch {
        // Another character already has that code: try another.
      }
    }
    throw new Error("could not assign a trade code");
  }

  async offer(accountId: string, raw: unknown): Promise<ExchangeResult<OfferResult>> {
    const parsed = TradeOfferRequestSchema.safeParse(raw);
    if (!parsed.success) return reject("INVALID_REQUEST", issues(parsed.error));
    const { operationId, kind, toCode } = parsed.data;
    const give = normalSide(parsed.data.give);
    const want = normalSide(parsed.data.want);
    const shape = tradeShapeIssue(this.rules, kind, give, want);
    if (shape !== null) return reject("INVALID_TRADE", shape);
    const hash = await hashJson({ kind: "trade_offer", tradeKind: kind, toCode, give, want });
    const prior = await this.prior<OfferResult>(accountId, operationId, hash);
    if (prior !== null) return prior;

    await this.syncLevels(accountId);
    const me = await this.character(accountId);
    if (me === null) return reject("NO_CHARACTER", "create a character first");
    const target = await this.db.prepare(`SELECT account_id, name, level FROM characters WHERE trade_code = ?`).bind(toCode).first<{ account_id: string; name: string; level: number }>();
    if (target === null) return reject("NO_SUCH_PLAYER", "no player has that trade code");
    if (target.account_id === accountId) return reject("SELF_TRADE", "that is your own trade code");
    await this.syncLevels(target.account_id);
    const them = (await this.character(target.account_id))!;
    const where = await this.whereAndFight(accountId);
    if (where !== null) return where;
    const t = this.rules.provisional.playerTrade.value;
    if ((await this.openCount(accountId)) >= t.maxOpenOffers) return reject("TOO_MANY_OFFERS", `at most ${t.maxOpenOffers} open offers at a time`);

    // Our side must be free to hold now; their side must exist and be tradeable (it is held only when they accept).
    const mine = await this.checkSide(accountId, give, them.level, true);
    if ("status" in mine) return mine;
    const theirs = await this.checkSide(target.account_id, want, me.level, false);
    if ("status" in theirs) return theirs;

    const offerId = `to_${(await hashJson({ accountId, operationId })).slice(0, 24)}`;
    const at = this.now();
    const expiresAt = addHours(at, t.offerHours);
    const result: OfferResult = { offerId, expiresAt };
    const g = this.sideGuards(accountId, give);
    const guards = [this.townGuard(), `NOT ${OPEN_BATTLE}`, `(SELECT COUNT(*) FROM trade_offers WHERE from_id = ? AND status = 'open') < ?`, ...g.sql];
    const args = [accountId, ...this.townMapIds, accountId, accountId, t.maxOpenOffers, ...g.args];
    const token = crypto.randomUUID();
    const ours = this.ours(accountId, operationId, token);
    const view = { give: { coins: give.coins, assets: mine.snaps }, want: { coins: want.coins, assets: theirs.snaps } };
    const stmts: SqlBound[] = [
      this.anchor(accountId, operationId, "trade_offer", hash, token, result, guards, args),
      this.db
        .prepare(
          `INSERT INTO trade_offers (id, kind, from_id, to_id, give_json, want_json, view_json, status, created_at, expires_at)
           SELECT ?, ?, ?, ?, ?, ?, ?, 'open', ?, ? WHERE ${ours.sql} ON CONFLICT DO NOTHING`,
        )
        .bind(offerId, kind, accountId, target.account_id, JSON.stringify(give), JSON.stringify(want), JSON.stringify(view), at, expiresAt, ...ours.args),
      ...this.moveOut(accountId, give, `trd:${offerId}:escrow`, "trade_escrow", at, ours),
      ...this.hold(accountId, give, offerId, ours),
    ];
    await this.db.batch(stmts);
    return this.outcome(accountId, operationId, hash, token, async () => (await this.whereAndFight(accountId)) ?? reject("CHANGED", "something changed; reload and try again"));
  }

  async accept(accountId: string, raw: unknown): Promise<ExchangeResult<RespondResult>> {
    const parsed = TradeRespondRequestSchema.safeParse(raw);
    if (!parsed.success) return reject("INVALID_REQUEST", issues(parsed.error));
    const { operationId, offerId } = parsed.data;
    const hash = await hashJson({ kind: "trade_accept", offerId });
    const prior = await this.prior<RespondResult>(accountId, operationId, hash);
    if (prior !== null) return prior;

    const o = await this.offerRow(offerId);
    if (o === null || o.to_id !== accountId) return reject("NOT_FOUND", "no such offer for you");
    if (o.status !== "open") return reject("CLOSED", `that offer is already ${o.status}`);
    const at = this.now();
    if (o.expires_at <= at) return reject("EXPIRED", "that offer has expired");
    await this.syncLevels(accountId);
    await this.syncLevels(o.from_id);
    const me = await this.character(accountId);
    const proposer = await this.character(o.from_id);
    if (me === null || proposer === null) return reject("NO_CHARACTER", "create a character first");
    const where = await this.whereAndFight(accountId);
    if (where !== null) return where;
    const give = JSON.parse(o.give_json) as TradeSide;
    const want = JSON.parse(o.want_json) as TradeSide;
    // Our (the receiver's) side must be free now; the proposer's side has been held since the offer.
    const mine = await this.checkSide(accountId, want, proposer.level, true);
    if ("status" in mine) return mine;
    const held = await this.pets(give.companionIds);
    for (const c of held) {
      const why = this.levelIssue(me.level, c);
      if (why !== null) return why;
    }
    const meNeed = Math.max(1, ...held.map((c) => this.minRecipientLevel(c)));
    const themNeed = Math.max(1, ...(await this.pets(want.companionIds)).map((c) => this.minRecipientLevel(c)));

    const result: RespondResult = { offerId, status: "accepted" };
    const g = this.sideGuards(accountId, want);
    const guards = [
      this.townGuard(),
      `NOT ${OPEN_BATTLE}`,
      `EXISTS (SELECT 1 FROM trade_offers WHERE id = ? AND to_id = ? AND status = 'open' AND expires_at > ?)`,
      `EXISTS (SELECT 1 FROM characters WHERE account_id = ? AND level >= ?)`,
      `EXISTS (SELECT 1 FROM characters WHERE account_id = ? AND level >= ?)`,
      ...g.sql,
    ];
    const args = [accountId, ...this.townMapIds, accountId, offerId, accountId, at, accountId, meNeed, o.from_id, themNeed, ...g.args];
    const token = crypto.randomUUID();
    const ours = this.ours(accountId, operationId, token);
    const stmts: SqlBound[] = [
      this.anchor(accountId, operationId, "trade_accept", hash, token, result, guards, args),
      this.db.prepare(`UPDATE trade_offers SET status = 'accepted', closed_at = ? WHERE id = ? AND status = 'open' AND ${ours.sql}`).bind(at, offerId, ...ours.args),
      // Our side straight to the proposer (it was never held), then the held side to us.
      ...this.moveDirect(accountId, o.from_id, want, `trd:${offerId}:want`, at, ours),
      ...this.moveIn(accountId, give, `trd:${offerId}:give`, "trade_receive", at, ours),
      ...this.releaseHeld(offerId, ours, accountId),
    ];
    await this.db.batch(stmts);
    return this.outcome(accountId, operationId, hash, token, async () => {
      const now = await this.offerRow(offerId);
      if (now !== null && now.status !== "open") return reject("CLOSED", `that offer is already ${now.status}`);
      return (await this.whereAndFight(accountId)) ?? reject("CHANGED", "something changed; reload and try again");
    });
  }

  /** The receiver declines, or the proposer cancels: the held side goes back to the proposer. */
  async close(accountId: string, raw: unknown, how: "declined" | "cancelled"): Promise<ExchangeResult<RespondResult>> {
    const parsed = TradeRespondRequestSchema.safeParse(raw);
    if (!parsed.success) return reject("INVALID_REQUEST", issues(parsed.error));
    const { operationId, offerId } = parsed.data;
    const kind = how === "declined" ? "trade_decline" : "trade_cancel";
    const hash = await hashJson({ kind, offerId });
    const prior = await this.prior<RespondResult>(accountId, operationId, hash);
    if (prior !== null) return prior;
    const o = await this.offerRow(offerId);
    const party = how === "declined" ? o?.to_id : o?.from_id;
    if (o === null || party !== accountId) return reject("NOT_FOUND", "no such offer for you");
    if (o.status !== "open") return reject("CLOSED", `that offer is already ${o.status}`);

    const give = JSON.parse(o.give_json) as TradeSide;
    const at = this.now();
    const result: RespondResult = { offerId, status: how };
    const token = crypto.randomUUID();
    const ours = this.ours(accountId, operationId, token);
    const col = how === "declined" ? "to_id" : "from_id";
    const stmts: SqlBound[] = [
      this.anchor(accountId, operationId, kind, hash, token, result, [`EXISTS (SELECT 1 FROM trade_offers WHERE id = ? AND ${col} = ? AND status = 'open')`], [offerId, accountId]),
      this.db.prepare(`UPDATE trade_offers SET status = ?, closed_at = ? WHERE id = ? AND status = 'open' AND ${ours.sql}`).bind(how, at, offerId, ...ours.args),
      ...this.moveIn(o.from_id, give, `trd:${offerId}:return`, "trade_return", at, ours),
      ...this.releaseHeld(offerId, ours, null),
    ];
    await this.db.batch(stmts);
    return this.outcome(accountId, operationId, hash, token, async () => {
      const now = await this.offerRow(offerId);
      return reject("CLOSED", `that offer is already ${now?.status ?? "gone"}`);
    });
  }

  async view(accountId: string): Promise<TradeView | null> {
    const myCode = await this.code(accountId);
    if (myCode === null) return null;
    const at = this.now();
    const q = (open: boolean) =>
      this.db
        .prepare(
          `SELECT o.*, f.name AS from_name, t.name AS to_name FROM trade_offers o
           LEFT JOIN characters f ON f.account_id = o.from_id LEFT JOIN characters t ON t.account_id = o.to_id
           WHERE (o.from_id = ? OR o.to_id = ?) AND ${open ? "o.status = 'open'" : "o.status <> 'open'"}
           ORDER BY ${open ? "o.created_at DESC" : "o.closed_at DESC"} LIMIT ?`,
        )
        .bind(accountId, accountId, open ? 50 : 10)
        .all<OfferRow>();
    const view = (r: OfferRow): TradeOfferView => {
      const v = JSON.parse(r.view_json) as Pick<TradeOfferView, "give" | "want">;
      return {
        offerId: r.id,
        kind: r.kind,
        fromName: r.from_name ?? "?",
        toName: r.to_name ?? "?",
        direction: r.from_id === accountId ? "out" : "in",
        status: r.status === "open" && r.expires_at <= at ? "expired" : r.status,
        createdAt: r.created_at,
        expiresAt: r.expires_at,
        give: v.give,
        want: v.want,
      };
    };
    return {
      myCode: formatTradeCode(myCode),
      open: (await q(true)).results.map(view),
      recent: (await q(false)).results.map(view),
      offerHours: this.rules.provisional.playerTrade.value.offerHours,
    };
  }

  // ------------------------------------------------------------------ helpers

  /**
   * Check one side of a trade against its owner. `free` = it must be ready to move now (the side that
   * is held or moved in this request); otherwise only ownership and the ห้ามเทรด flag are checked.
   * `recipientLevel` is the level of whoever would receive its companions (O01).
   */
  private async checkSide(owner: string, side: TradeSide, recipientLevel: number, free: boolean): Promise<{ snaps: AssetSnapshot[] } | Rejected> {
    const snaps: AssetSnapshot[] = [];
    for (const l of side.items) {
      const def = this.content.items.get(l.itemId);
      if (def === undefined) return reject("NOT_OWNER", `unknown item ${l.itemId}`);
      if (!tradeable(def)) return reject("NOT_TRADEABLE", `${def.name.th} cannot be traded (ห้ามเทรด)`);
      if (free && (await this.itemCount(owner, l.itemId)) < l.quantity) return reject("NOT_ENOUGH_ITEMS", `not enough ${def.name.th}`);
      snaps.push(this.itemSnap(l.itemId, l.quantity));
    }
    const pieces = new Map((await this.pieces(side.equipmentIds)).map((p) => [p.id, p]));
    for (const id of side.equipmentIds) {
      const p = pieces.get(id);
      const why = free ? this.pieceIssue(p, owner, "trade") : p === undefined || p.owner_id !== owner ? reject("NOT_OWNER", "they do not have that piece") : tradeable(this.content.equipment.get(p.definition_id), p.no_trade === 1) ? null : reject("NOT_TRADEABLE", "that piece cannot be traded (ห้ามเทรด)");
      if (why !== null) return why;
      snaps.push(this.pieceSnap(p!));
    }
    const pets = new Map((await this.pets(side.companionIds)).map((c) => [c.id, c]));
    for (const id of side.companionIds) {
      const c = pets.get(id);
      const why = free ? this.petIssue(c, owner, "trade") : c === undefined || c.owner_id !== owner ? reject("NOT_OWNER", "they do not have that companion") : c.no_trade === 1 ? reject("NOT_TRADEABLE", "that companion cannot be traded (ห้ามเทรด)") : null;
      if (why !== null) return why;
      const lv = this.levelIssue(recipientLevel, c!);
      if (lv !== null) return lv;
      snaps.push(this.petSnap(c!));
    }
    if (free && side.coins > 0 && (await this.coins(owner)) < side.coins) return reject("NOT_ENOUGH_COINS", `not enough coins (${side.coins})`);
    return { snaps };
  }

  /** SQL guards that `owner` still has this side, free to move. */
  private sideGuards(owner: string, side: TradeSide): { sql: string[]; args: unknown[] } {
    const sql: string[] = [];
    const args: unknown[] = [];
    for (const l of side.items) {
      sql.push(`(SELECT COALESCE(SUM(delta), 0) FROM item_ledger WHERE account_id = ? AND item_id = ?) >= ?`);
      args.push(owner, l.itemId, l.quantity);
    }
    if (side.coins > 0) {
      sql.push(`(SELECT COALESCE(SUM(delta), 0) FROM coin_ledger WHERE account_id = ?) >= ?`);
      args.push(owner, side.coins);
    }
    const e = side.equipmentIds;
    if (e.length > 0) {
      sql.push(
        `(SELECT COUNT(*) FROM equipment_instances WHERE owner_id = ? AND id IN (${marks(e.length)}) AND lock_state = 'free' AND protected = 0 AND no_trade = 0 AND affix_pending_json IS NULL) = ?`,
        `NOT EXISTS (SELECT 1 FROM character_equipment WHERE equipment_instance_id IN (${marks(e.length)}))`,
      );
      args.push(owner, ...e, e.length, ...e);
    }
    const c = side.companionIds;
    if (c.length > 0) {
      sql.push(
        `(SELECT COUNT(*) FROM monster_instances WHERE owner_id = ? AND id IN (${marks(c.length)}) AND lock_state = 'free' AND protected = 0 AND no_trade = 0) = ?`,
        `NOT EXISTS (SELECT 1 FROM character_team WHERE monster_instance_id IN (${marks(c.length)}))`,
      );
      args.push(owner, ...c, c.length, ...c);
    }
    return { sql, args };
  }

  /** Ledger lines taking a side's items and coins out of `owner`. */
  private moveOut(owner: string, side: TradeSide, op: string, reason: string, at: string, ours: { sql: string; args: unknown[] }): SqlBound[] {
    return this.ledger(side, (i) => [owner, -1, i], op, reason, at, ours);
  }
  /** Ledger lines putting a side's items and coins into `owner`. */
  private moveIn(owner: string, side: TradeSide, op: string, reason: string, at: string, ours: { sql: string; args: unknown[] }): SqlBound[] {
    return this.ledger(side, (i) => [owner, 1, i], op, reason, at, ours);
  }
  /** A side that was not held moves from `from` to `to`: ledger lines both ways and an owner change. */
  private moveDirect(from: string, to: string, side: TradeSide, op: string, at: string, ours: { sql: string; args: unknown[] }): SqlBound[] {
    const n = side.items.length;
    const stmts = [
      ...this.ledger(side, (i) => [from, -1, i], op, "trade_give", at, ours, 0),
      ...this.ledger(side, (i) => [to, 1, i + n], op, "trade_receive", at, ours, 1),
    ];
    const e = side.equipmentIds;
    if (e.length > 0) {
      stmts.push(
        this.db
          .prepare(
            `UPDATE equipment_instances SET owner_id = ?, protected = 0, version = version + 1
             WHERE owner_id = ? AND id IN (${marks(e.length)}) AND lock_state = 'free' AND ${ours.sql}`,
          )
          .bind(to, from, ...e, ...ours.args),
      );
    }
    const c = side.companionIds;
    if (c.length > 0) {
      stmts.push(
        this.db
          .prepare(
            `UPDATE monster_instances SET owner_id = ?, bond = 0, nickname = NULL, protected = 0, ownership_version = ownership_version + 1
             WHERE owner_id = ? AND id IN (${marks(c.length)}) AND lock_state = 'free' AND ${ours.sql}`,
          )
          .bind(to, from, ...c, ...ours.args),
      );
    }
    return stmts;
  }

  private ledger(
    side: TradeSide,
    who: (i: number) => [string, 1 | -1, number],
    op: string,
    reason: string,
    at: string,
    ours: { sql: string; args: unknown[] },
    coinLine = 0,
  ): SqlBound[] {
    const stmts = side.items.map((l, i) => {
      const [acct, sign, line] = who(i);
      return this.db
        .prepare(
          `INSERT INTO item_ledger (operation_id, line_no, account_id, item_id, delta, reason, created_at)
           SELECT ?, ?, ?, ?, ?, ?, ? WHERE ${ours.sql} ON CONFLICT DO NOTHING`,
        )
        .bind(op, line, acct, l.itemId, sign * l.quantity, reason, at, ...ours.args);
    });
    if (side.coins > 0) {
      const [acct, sign] = who(0);
      stmts.push(
        this.db
          .prepare(`INSERT INTO coin_ledger (operation_id, line_no, account_id, delta, reason, created_at) SELECT ?, ?, ?, ?, ?, ? WHERE ${ours.sql} ON CONFLICT DO NOTHING`)
          .bind(op, coinLine, acct, sign * side.coins, reason, at, ...ours.args),
      );
    }
    return stmts;
  }

  /** Lock a side's gear and companions for this offer. */
  private hold(owner: string, side: TradeSide, offerId: string, ours: { sql: string; args: unknown[] }): SqlBound[] {
    const out: SqlBound[] = [];
    for (const [table, ids] of [
      ["equipment_instances", side.equipmentIds],
      ["monster_instances", side.companionIds],
    ] as const) {
      if (ids.length === 0) continue;
      out.push(
        this.db
          .prepare(`UPDATE ${table} SET lock_state = 'in_escrow', lock_ref = ? WHERE owner_id = ? AND id IN (${marks(ids.length)}) AND lock_state = 'free' AND ${ours.sql}`)
          .bind(offerId, owner, ...ids, ...ours.args),
      );
    }
    return out;
  }

  private async openCount(accountId: string): Promise<number> {
    const r = await this.db.prepare(`SELECT COUNT(*) AS n FROM trade_offers WHERE from_id = ? AND status = 'open'`).bind(accountId).first<{ n: number }>();
    return r?.n ?? 0;
  }

  private offerRow(id: string) {
    return this.db.prepare(`SELECT o.*, NULL AS from_name, NULL AS to_name FROM trade_offers o WHERE o.id = ?`).bind(id).first<OfferRow>();
  }
}

/** Sorted, so the same offer always hashes the same. */
function normalSide(s: TradeSide): TradeSide {
  return {
    items: [...s.items].sort((a, b) => (a.itemId < b.itemId ? -1 : 1)),
    equipmentIds: [...s.equipmentIds].sort(),
    companionIds: [...s.companionIds].sort(),
    coins: s.coins,
  };
}

function randomTradeCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return [...bytes].map((b) => TRADE_CODE_ALPHABET[b % TRADE_CODE_ALPHABET.length]).join("");
}
