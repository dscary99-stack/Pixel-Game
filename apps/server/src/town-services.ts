/**
 * Coins and town services on D1 (migration 0007): sell to the NPC, install and remove Sigils.
 *
 * Every request carries an operationId. The first write of its batch inserts a service_operations
 * row only if every guard holds (balances, ownership, lock, location, no open fight); the other
 * writes check that row carries this request's hash, so the batch lands whole or not at all. A
 * retry with the same id returns the stored result; the same id with another payload is refused.
 */
import {
  CRAFT_MASTERY_MAX,
  CraftRequestSchema,
  craftQuote,
  masteryAfter,
  rollGear,
  type Profession,
  type Rarity,
  type Recipe,
  AffixChooseRequestSchema,
  AffixRerollRequestSchema,
  Rng,
  affixRerollCost,
  rerollAffix,
  seedRng,
  type AffixPool,
  type PendingAffix,
  type RolledAffix,
  COMPANION_GROWTH_VERSION,
  InstallSigilRequestSchema,
  RebirthBranchRequestSchema,
  RebirthRequestSchema,
  rebirthBranchChangeCost,
  rebirthVariantFor,
  companionPrimaryStats,
  rebirthCost,
  RemoveSigilRequestSchema,
  SellRequestSchema,
  BuyRequestSchema,
  buyQuote,
  type ShopDefinition,
  SkillTrainRequestSchema,
  planSigilInstall,
  skillTrainCost,
  trainedSkillLevel,
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
  /** Needed for buying (POST /town/buy). */
  shops?: ReadonlyMap<string, ShopDefinition>;
  /** Needed for affix rerolls and crafted gear. */
  affixPools?: ReadonlyMap<string, AffixPool>;
  /** Needed for crafting (POST /town/craft). */
  recipes?: ReadonlyMap<string, Recipe>;
}

type Kind = "npc_buy" | "npc_sell" | "sigil_install" | "sigil_remove" | "companion_rebirth" | "skill_train" | "rebirth_branch" | "affix_reroll" | "affix_choose" | "craft";

export type ServiceRejection =
  | "INVALID_REQUEST"
  | "PAYLOAD_MISMATCH"
  | "NOT_SELLABLE"
  | "NOT_SOLD_HERE"
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
  | "MAX_SKILL_LEVEL"
  | "NOT_SPECIES_SKILL"
  | "MASTERY_TOO_LOW"
  | "BRANCH_REQUIRED"
  | "NO_VARIANT"
  | "SAME_BRANCH"
  | "NO_SUCH_AFFIX"
  | "CHOICE_PENDING"
  | "NO_PENDING_REROLL"
  | "NO_SUCH_RECIPE"
  | "CHANGED";

export type ServiceResult<T> = { status: "done"; replayed: boolean; result: T } | { status: "rejected"; reason: ServiceRejection; message: string };

export interface BuyResult {
  bought: { itemId: string; quantity: number; coins: number }[];
  total: number;
}
export interface SellResult {
  sold: { itemId: string; quantity: number; coins: number }[];
  total: number;
}
export interface RebirthResult {
  companionId: string;
  stage: number;
  /** The branch picked for the new stage, when it has variants. */
  branch: "A" | "B" | null;
  paid: { coins: number; itemId: string; quantity: number };
}
export interface RebirthBranchResult {
  companionId: string;
  stage: number;
  branch: "A" | "B";
  paid: number;
}
export interface SkillTrainResult {
  companionId: string;
  skillId: string;
  level: number;
  paid: { mastery: number; coins: number; itemId: string; quantity: number };
}
export interface AffixRerollResult {
  equipmentId: string;
  slot: number;
  old: RolledAffix;
  /** The new roll, waiting for keep old / keep new. */
  rolled: RolledAffix;
  paid: { coins: number; itemId: string; quantity: number };
}
export interface AffixChooseResult {
  equipmentId: string;
  kept: "old" | "new";
  affixes: RolledAffix[];
}
export interface CraftResult {
  recipeId: string;
  times: number;
  paid: { coins: number; inputs: { itemId: string; quantity: number }[] };
  /** Items made (item recipes). */
  items: { itemId: string; quantity: number }[];
  /** Pieces made (gear recipes), each with the rarity and affixes the server rolled. */
  equipment: { id: string; definitionId: string; rarity: Rarity; affixes: RolledAffix[] }[];
  profession: Profession;
  mastery: { before: number; after: number };
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

  // ------------------------------------------------------------------ NPC shop (coin sink)

  /** Buy listed goods at the shown prices, standing in the shop's town, outside fights. */
  async buy(accountId: string, raw: unknown): Promise<ServiceResult<BuyResult>> {
    const parsed = BuyRequestSchema.safeParse(raw);
    if (!parsed.success) return reject("INVALID_REQUEST", issues(parsed.error));
    const { operationId, shopId, lines, expectedTotal } = parsed.data;
    const shop = this.content.shops?.get(shopId);
    if (shop === undefined) return reject("NOT_SOLD_HERE", `no shop ${shopId}`);
    const quote = buyQuote(shop, lines);
    if (!quote.ok) return reject(quote.code, quote.message);
    const sorted = [...quote.lines].sort((a, b) => (a.itemId < b.itemId ? -1 : 1));
    const hash = await hashJson({ kind: "npc_buy", shopId, lines: sorted.map(({ itemId, quantity }) => ({ itemId, quantity })), expectedTotal });
    const prior = await this.prior<BuyResult>(accountId, operationId, hash);
    if (prior !== null) return prior;
    if (quote.total !== expectedTotal) return reject("COST_CHANGED", `the total is now ${quote.total}`);

    const guards = [
      `EXISTS (SELECT 1 FROM player_positions WHERE account_id = ? AND map_id = ?)`,
      `NOT ${OPEN_BATTLE}`,
      `(SELECT COALESCE(SUM(delta), 0) FROM coin_ledger WHERE account_id = ?) >= ?`,
    ];
    const args: unknown[] = [accountId, shop.mapId, accountId, accountId, quote.total];
    const result: BuyResult = { bought: sorted, total: quote.total };
    const ledgerId = `svc:${accountId}:${operationId}`;
    const at = this.now();
    const ours = this.ours(accountId, operationId, hash);
    await this.db.batch([
      this.anchor(accountId, operationId, "npc_buy", hash, result, guards, args),
      ...sorted.map((l, i) =>
        this.db
          .prepare(
            `INSERT INTO item_ledger (operation_id, line_no, account_id, item_id, delta, reason, created_at)
             SELECT ?, ?, ?, ?, ?, 'npc_buy', ? WHERE ${ours.sql} ON CONFLICT DO NOTHING`,
          )
          .bind(ledgerId, i, accountId, l.itemId, l.quantity, at, ...ours.args),
      ),
      this.db
        .prepare(
          `INSERT INTO coin_ledger (operation_id, line_no, account_id, delta, reason, created_at)
           SELECT ?, 0, ?, ?, 'npc_buy', ? WHERE ${ours.sql} ON CONFLICT DO NOTHING`,
        )
        .bind(ledgerId, accountId, -quote.total, at, ...ours.args),
    ]);
    return this.outcome(accountId, operationId, hash, async () => {
      const pos = await this.db.prepare(`SELECT map_id FROM player_positions WHERE account_id = ?`).bind(accountId).first<{ map_id: string }>();
      if (pos?.map_id !== shop.mapId) return reject("NOT_IN_TOWN", `go to ${shop.name.th} first`);
      const fight = await this.fighting(accountId);
      if (fight !== null) return fight;
      return reject("INSUFFICIENT_COINS", `needs ${quote.total} coins`);
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
    const branch = parsed.data.branch ?? null;
    const hash = await hashJson({ kind: "companion_rebirth", companionId, expectedStage, ...(branch === null ? {} : { branch }) });
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
    // A stage with variants needs the player's branch; one without takes none (chapter 04 §7).
    const hasVariant = rebirthVariantFor(species, cost.nextStage) !== undefined;
    if (hasVariant && branch === null) return reject("BRANCH_REQUIRED", `pick branch A or B for Rebirth ${cost.nextStage}`);
    if (!hasVariant && branch !== null) return reject("NO_VARIANT", `${species.id} has no variants at Rebirth ${cost.nextStage}`);

    const result: RebirthResult = { companionId, stage: cost.nextStage, branch, paid: { coins: cost.coins, itemId: cost.materialItemId, quantity: cost.materialQty } };
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
               primary_stats_json = COALESCE(?, primary_stats_json),
               rebirth_choices_json = CASE WHEN ? IS NULL THEN rebirth_choices_json ELSE json_set(rebirth_choices_json, ?, ?) END
           WHERE id = ? AND owner_id = ? AND rebirth_stage = ? AND ${ours.sql}`,
        )
        .bind(
          cost.nextStage,
          stats === null ? null : JSON.stringify(stats),
          branch,
          `$."${cost.nextStage}"`,
          branch,
          companionId,
          accountId,
          expectedStage,
          ...ours.args,
        ),
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

  // ------------------------------------------------------------------ Rebirth branch change

  /**
   * Switch a reached stage's variant branch at the town NPC (chapter 04 §7; Nut 2026-10-03: allowed,
   * as a coin sink). Same guards as other services plus the branch the player saw and the price.
   */
  async changeRebirthBranch(accountId: string, raw: unknown): Promise<ServiceResult<RebirthBranchResult>> {
    const parsed = RebirthBranchRequestSchema.safeParse(raw);
    if (!parsed.success) return reject("INVALID_REQUEST", issues(parsed.error));
    const { operationId, companionId, stage, expectedBranch, branch, expectedCost } = parsed.data;
    const hash = await hashJson({ kind: "rebirth_branch", companionId, stage, expectedBranch, branch, expectedCost });
    const prior = await this.prior<RebirthBranchResult>(accountId, operationId, hash);
    if (prior !== null) return prior;
    if (branch === expectedBranch) return reject("SAME_BRANCH", "that branch is already in use");

    const pet = await this.db
      .prepare(`SELECT species_id FROM monster_instances WHERE id = ? AND owner_id = ?`)
      .bind(companionId, accountId)
      .first<{ species_id: string }>();
    const species = pet === null ? undefined : this.content.species.get(pet.species_id);
    if (pet === null || species === undefined) return reject("NOT_OWNER", "that companion is not yours");
    if (rebirthVariantFor(species, stage) === undefined) return reject("NO_VARIANT", `${species.id} has no variants at Rebirth ${stage}`);
    const cost = rebirthBranchChangeCost(this.rules, stage);
    if (cost !== expectedCost) return reject("COST_CHANGED", `switching costs ${cost} coins`);

    const result: RebirthBranchResult = { companionId, stage, branch, paid: cost };
    const path = `$."${stage}"`;
    const guards = [
      this.inTown(),
      `NOT ${OPEN_BATTLE}`,
      `EXISTS (SELECT 1 FROM monster_instances WHERE id = ? AND owner_id = ? AND lock_state = 'free' AND rebirth_stage >= ? AND json_extract(rebirth_choices_json, ?) = ?)`,
      `(SELECT COALESCE(SUM(delta), 0) FROM coin_ledger WHERE account_id = ?) >= ?`,
    ];
    const args = [accountId, ...this.townMapIds, accountId, companionId, accountId, stage, path, expectedBranch, accountId, cost];
    const ledgerId = `svc:${accountId}:${operationId}`;
    const at = this.now();
    const ours = this.ours(accountId, operationId, hash);
    await this.db.batch([
      this.anchor(accountId, operationId, "rebirth_branch", hash, result, guards, args),
      this.db
        .prepare(
          `INSERT INTO coin_ledger (operation_id, line_no, account_id, delta, reason, created_at)
           SELECT ?, 0, ?, ?, 'rebirth_branch', ? WHERE ${ours.sql} ON CONFLICT DO NOTHING`,
        )
        .bind(ledgerId, accountId, -cost, at, ...ours.args),
      this.db
        .prepare(
          `UPDATE monster_instances SET rebirth_choices_json = json_set(rebirth_choices_json, ?, ?)
           WHERE id = ? AND owner_id = ? AND json_extract(rebirth_choices_json, ?) = ? AND ${ours.sql}`,
        )
        .bind(path, branch, companionId, accountId, path, expectedBranch, ...ours.args),
    ]);
    return this.outcome(accountId, operationId, hash, async () => {
      const why = await this.whereAndFight(accountId);
      if (why !== null) return why;
      const now = await this.db
        .prepare(`SELECT rebirth_stage, json_extract(rebirth_choices_json, ?) AS b, lock_state FROM monster_instances WHERE id = ? AND owner_id = ?`)
        .bind(path, companionId, accountId)
        .first<{ rebirth_stage: number; b: string | null; lock_state: string }>();
      if (now === null) return reject("NOT_OWNER", "that companion is not yours");
      if (now.rebirth_stage < stage || now.b !== expectedBranch) return reject("CHANGED", "the companion changed; reload and try again");
      if (now.lock_state !== "free") return reject("ASSET_LOCKED", "that companion is busy");
      return reject("INSUFFICIENT_COINS", `switching costs ${cost} coins`);
    });
  }

  // ------------------------------------------------------------------ skill training

  /**
   * Train one companion skill a level (chapter 04 §5): in town, outside fights, with the companion's
   * level at the gate, its mastery, coins and the species' material. One batch like Rebirth: the
   * anchor checks every guard (including the level the player saw), then everything is charged and
   * the level written. A retry replays; a second request for the same level finds it changed.
   */
  async trainSkill(accountId: string, raw: unknown): Promise<ServiceResult<SkillTrainResult>> {
    const parsed = SkillTrainRequestSchema.safeParse(raw);
    if (!parsed.success) return reject("INVALID_REQUEST", issues(parsed.error));
    const { operationId, companionId, skillId, expectedLevel } = parsed.data;
    const hash = await hashJson({ kind: "skill_train", companionId, skillId, expectedLevel });
    const prior = await this.prior<SkillTrainResult>(accountId, operationId, hash);
    if (prior !== null) return prior;

    const pet = await this.db
      .prepare(`SELECT species_id, trained_skill_levels_json FROM monster_instances WHERE id = ? AND owner_id = ?`)
      .bind(companionId, accountId)
      .first<{ species_id: string; trained_skill_levels_json: string }>();
    const species = pet === null ? undefined : this.content.species.get(pet.species_id);
    if (pet === null || species === undefined) return reject("NOT_OWNER", "that companion is not yours");
    const cost = skillTrainCost(this.rules, species, skillId, expectedLevel, this.content);
    if (!cost.ok) return reject(cost.code, cost.message);
    const current = trainedSkillLevel(JSON.parse(pet.trained_skill_levels_json) as Record<string, number>, skillId);
    if (current !== expectedLevel) return reject("CHANGED", "the skill changed; reload and try again");

    const result: SkillTrainResult = {
      companionId,
      skillId,
      level: cost.nextLevel,
      paid: { mastery: cost.mastery, coins: cost.coins, itemId: cost.materialItemId, quantity: cost.materialQty },
    };
    // skillId is one of the species' own ids (checked above); the JSON path quotes it for the colon.
    const path = `$."${skillId}"`;
    const levelNow = `COALESCE(json_extract(trained_skill_levels_json, ?), 1)`;
    const guards = [
      this.inTown(),
      `NOT ${OPEN_BATTLE}`,
      `EXISTS (SELECT 1 FROM monster_instances WHERE id = ? AND owner_id = ? AND lock_state = 'free' AND ${levelNow} = ? AND skill_mastery >= ? AND xp >= ?)`,
      `(SELECT COALESCE(SUM(delta), 0) FROM coin_ledger WHERE account_id = ?) >= ?`,
      `(SELECT COALESCE(SUM(delta), 0) FROM item_ledger WHERE account_id = ? AND item_id = ?) >= ?`,
    ];
    const args = [
      accountId,
      ...this.townMapIds,
      accountId,
      companionId,
      accountId,
      path,
      expectedLevel,
      cost.mastery,
      cost.companionExp,
      accountId,
      cost.coins,
      accountId,
      cost.materialItemId,
      cost.materialQty,
    ];
    const ledgerId = `svc:${accountId}:${operationId}`;
    const at = this.now();
    const ours = this.ours(accountId, operationId, hash);
    await this.db.batch([
      this.anchor(accountId, operationId, "skill_train", hash, result, guards, args),
      this.db
        .prepare(
          `INSERT INTO coin_ledger (operation_id, line_no, account_id, delta, reason, created_at)
           SELECT ?, 0, ?, ?, 'skill_train', ? WHERE ${ours.sql} ON CONFLICT DO NOTHING`,
        )
        .bind(ledgerId, accountId, -cost.coins, at, ...ours.args),
      this.db
        .prepare(
          `INSERT INTO item_ledger (operation_id, line_no, account_id, item_id, delta, reason, created_at)
           SELECT ?, 0, ?, ?, ?, 'skill_train', ? WHERE ${ours.sql} ON CONFLICT DO NOTHING`,
        )
        .bind(ledgerId, accountId, cost.materialItemId, -cost.materialQty, at, ...ours.args),
      this.db
        .prepare(
          `UPDATE monster_instances
           SET skill_mastery = skill_mastery - ?, trained_skill_levels_json = json_set(trained_skill_levels_json, ?, ?)
           WHERE id = ? AND owner_id = ? AND ${levelNow} = ? AND ${ours.sql}`,
        )
        .bind(cost.mastery, path, cost.nextLevel, companionId, accountId, path, expectedLevel, ...ours.args),
    ]);
    return this.outcome(accountId, operationId, hash, async () => {
      const why = await this.whereAndFight(accountId);
      if (why !== null) return why;
      const now = await this.db
        .prepare(`SELECT ${levelNow} AS level, skill_mastery, xp, lock_state FROM monster_instances WHERE id = ? AND owner_id = ?`)
        .bind(path, companionId, accountId)
        .first<{ level: number; skill_mastery: number; xp: number; lock_state: string }>();
      if (now === null) return reject("NOT_OWNER", "that companion is not yours");
      if (now.level !== expectedLevel) return reject("CHANGED", "the skill changed; reload and try again");
      if (now.lock_state !== "free") return reject("ASSET_LOCKED", "that companion is busy");
      if (now.xp < cost.companionExp) return reject("LEVEL_TOO_LOW", `skill Lv${cost.nextLevel} needs the companion at Lv${cost.companionLevel}`);
      if (now.skill_mastery < cost.mastery) return reject("MASTERY_TOO_LOW", `needs ${cost.mastery} mastery`);
      if ((await this.coins(accountId)) < cost.coins) return reject("INSUFFICIENT_COINS", `training costs ${cost.coins} coins`);
      return reject("INSUFFICIENT_ITEMS", `training needs ${cost.materialQty} ${cost.materialItemId}`);
    });
  }

  // ------------------------------------------------------------------ affix reroll (chapter 05 §3)

  /**
   * Pay to roll one affix again: in town, outside fights, on a free piece whose affixes are still
   * the ones the player saw and that has no roll waiting. The new roll is drawn on the server from an
   * unguessable seed and stored on the piece (pending); coins and material are spent now, whatever
   * the player keeps. One batch; a retry replays the same roll.
   */
  async rerollAffix(accountId: string, raw: unknown): Promise<ServiceResult<AffixRerollResult>> {
    const parsed = AffixRerollRequestSchema.safeParse(raw);
    if (!parsed.success) return reject("INVALID_REQUEST", issues(parsed.error));
    const { operationId, equipmentId, slot, expectedAffixes, expectedCost } = parsed.data;
    const hash = await hashJson({ kind: "affix_reroll", equipmentId, slot, expectedAffixes, expectedCost });
    const prior = await this.prior<AffixRerollResult>(accountId, operationId, hash);
    if (prior !== null) return prior;

    const piece = await this.affixPiece(accountId, equipmentId);
    const def = piece === null ? undefined : this.content.equipment.get(piece.definition_id);
    const pool = def === undefined ? undefined : this.content.affixPools?.get(def.affixPoolId);
    if (piece === null || def === undefined) return reject("NOT_OWNER", "that equipment is not yours");
    if (pool === undefined) return reject("NO_SUCH_AFFIX", "this piece has no affix pool");
    if (piece.affixes_json !== JSON.stringify(expectedAffixes)) return reject("CHANGED", "the piece changed; reload and try again");
    if (piece.affix_pending_json !== null) return reject("CHOICE_PENDING", "keep the old or the new affix from the last roll first");
    const current = JSON.parse(piece.affixes_json) as RolledAffix[];
    const rolled = rerollAffix(this.rules, def, pool, current, slot, new Rng(seedRng(crypto.randomUUID())));
    if (rolled === null) return reject("NO_SUCH_AFFIX", "that piece has no affix there");
    const cost = affixRerollCost(this.rules, def, pool);
    if (cost.coins !== expectedCost.coins || cost.itemId !== expectedCost.itemId || cost.quantity !== expectedCost.quantity) {
      return reject("COST_CHANGED", `a reroll now costs ${cost.coins} coins and ${cost.quantity} ${cost.itemId}`);
    }

    const result: AffixRerollResult = { equipmentId, slot, old: current[slot]!, rolled, paid: cost };
    const pending: PendingAffix = { operationId, slot, affix: rolled };
    const guards = [
      this.inTown(),
      `NOT ${OPEN_BATTLE}`,
      `EXISTS (SELECT 1 FROM equipment_instances WHERE id = ? AND owner_id = ? AND lock_state = 'free' AND affixes_json = ? AND affix_pending_json IS NULL)`,
      `(SELECT COALESCE(SUM(delta), 0) FROM coin_ledger WHERE account_id = ?) >= ?`,
      `(SELECT COALESCE(SUM(delta), 0) FROM item_ledger WHERE account_id = ? AND item_id = ?) >= ?`,
    ];
    const args = [accountId, ...this.townMapIds, accountId, equipmentId, accountId, piece.affixes_json, accountId, cost.coins, accountId, cost.itemId, cost.quantity];
    const ledgerId = `svc:${accountId}:${operationId}`;
    const at = this.now();
    const ours = this.ours(accountId, operationId, hash);
    await this.db.batch([
      this.anchor(accountId, operationId, "affix_reroll", hash, result, guards, args),
      this.db
        .prepare(
          `INSERT INTO coin_ledger (operation_id, line_no, account_id, delta, reason, created_at)
           SELECT ?, 0, ?, ?, 'affix_reroll', ? WHERE ${ours.sql} ON CONFLICT DO NOTHING`,
        )
        .bind(ledgerId, accountId, -cost.coins, at, ...ours.args),
      this.db
        .prepare(
          `INSERT INTO item_ledger (operation_id, line_no, account_id, item_id, delta, reason, created_at)
           SELECT ?, 0, ?, ?, ?, 'affix_reroll', ? WHERE ${ours.sql} ON CONFLICT DO NOTHING`,
        )
        .bind(ledgerId, accountId, cost.itemId, -cost.quantity, at, ...ours.args),
      this.db
        .prepare(`UPDATE equipment_instances SET affix_pending_json = ? WHERE id = ? AND affix_pending_json IS NULL AND ${ours.sql}`)
        .bind(JSON.stringify(pending), equipmentId, ...ours.args),
    ]);
    return this.outcome(accountId, operationId, hash, async () => {
      const why = await this.whereAndFight(accountId);
      if (why !== null) return why;
      if ((await this.coins(accountId)) < cost.coins) return reject("INSUFFICIENT_COINS", `a reroll costs ${cost.coins} coins`);
      if ((await this.itemBalance(accountId, cost.itemId)) < cost.quantity) return reject("NO_MATERIAL", `a reroll needs ${cost.quantity} ${cost.itemId}`);
      const now = await this.affixPiece(accountId, equipmentId);
      if (now === null) return reject("NOT_OWNER", "that equipment is not yours");
      if (now.lock_state !== "free") return reject("ASSET_LOCKED", "that piece is locked");
      if (now.affix_pending_json !== null) return reject("CHOICE_PENDING", "keep the old or the new affix from the last roll first");
      return reject("CHANGED", "the piece changed; reload and try again");
    });
  }

  /**
   * Keep the old or the new affix from a reroll. Costs nothing and works anywhere, but not while a
   * fight holds the piece. Clears the waiting roll; a retry replays.
   */
  async chooseAffix(accountId: string, raw: unknown): Promise<ServiceResult<AffixChooseResult>> {
    const parsed = AffixChooseRequestSchema.safeParse(raw);
    if (!parsed.success) return reject("INVALID_REQUEST", issues(parsed.error));
    const { operationId, equipmentId, rerollOperationId, keep } = parsed.data;
    const hash = await hashJson({ kind: "affix_choose", equipmentId, rerollOperationId, keep });
    const prior = await this.prior<AffixChooseResult>(accountId, operationId, hash);
    if (prior !== null) return prior;

    const piece = await this.affixPiece(accountId, equipmentId);
    if (piece === null) return reject("NOT_OWNER", "that equipment is not yours");
    const pending = piece.affix_pending_json === null ? null : (JSON.parse(piece.affix_pending_json) as PendingAffix);
    if (pending === null || pending.operationId !== rerollOperationId) return reject("NO_PENDING_REROLL", "no roll is waiting for a choice");
    const affixes = JSON.parse(piece.affixes_json) as RolledAffix[];
    const next = keep === "new" ? affixes.map((a, i) => (i === pending.slot ? pending.affix : a)) : affixes;
    const result: AffixChooseResult = { equipmentId, kept: keep, affixes: next };
    const guards = [`EXISTS (SELECT 1 FROM equipment_instances WHERE id = ? AND owner_id = ? AND lock_state = 'free' AND affixes_json = ? AND affix_pending_json = ?)`];
    const args = [equipmentId, accountId, piece.affixes_json, piece.affix_pending_json];
    const ours = this.ours(accountId, operationId, hash);
    await this.db.batch([
      this.anchor(accountId, operationId, "affix_choose", hash, result, guards, args),
      this.db
        .prepare(`UPDATE equipment_instances SET affixes_json = ?, affix_pending_json = NULL WHERE id = ? AND ${ours.sql}`)
        .bind(JSON.stringify(next), equipmentId, ...ours.args),
    ]);
    return this.outcome(accountId, operationId, hash, async () => {
      const now = await this.affixPiece(accountId, equipmentId);
      if (now === null) return reject("NOT_OWNER", "that equipment is not yours");
      if (now.lock_state !== "free") return reject("ASSET_LOCKED", "a fight holds that piece; choose after it ends");
      if (now.affix_pending_json === null) return reject("NO_PENDING_REROLL", "no roll is waiting for a choice");
      return reject("CHANGED", "the piece changed; reload and try again");
    });
  }

  // ------------------------------------------------------------------ crafting (chapter 05 §6)

  /** Mastery per profession for one character (missing professions are 0). */
  async craftMastery(accountId: string): Promise<Record<Profession, number>> {
    const rows = await this.db.prepare(`SELECT profession, mastery FROM craft_mastery WHERE account_id = ?`).bind(accountId).all<{ profession: Profession; mastery: number }>();
    const out: Record<Profession, number> = { weaponsmith: 0, armorsmith: 0, jeweler: 0, alchemist: 0, tamer: 0, tailor: 0 };
    for (const r of rows.results) out[r.profession] = r.mastery;
    return out;
  }

  /**
   * Make a recipe `times` times: in town, outside fights, with the coins the player was shown, the
   * materials and the mastery. Inputs are spent, the output and the mastery written in one batch.
   * Gear is rolled on the server (rarity + affixes like a drop) and stored in the result, so a retry
   * replays the same pieces. Mastery is written only if it still holds the value read, so two
   * crafts of one profession at once cannot lose a gain (the second is refused as CHANGED).
   */
  async craft(accountId: string, raw: unknown): Promise<ServiceResult<CraftResult>> {
    const parsed = CraftRequestSchema.safeParse(raw);
    if (!parsed.success) return reject("INVALID_REQUEST", issues(parsed.error));
    const { operationId, recipeId, times, expectedCoins } = parsed.data;
    const hash = await hashJson({ kind: "craft", recipeId, times, expectedCoins });
    const prior = await this.prior<CraftResult>(accountId, operationId, hash);
    if (prior !== null) return prior;

    const recipe = this.content.recipes?.get(recipeId);
    if (recipe === undefined) return reject("NO_SUCH_RECIPE", `no recipe ${recipeId}`);
    const quote = craftQuote(recipe, times);
    if (quote.coins !== expectedCoins) return reject("COST_CHANGED", `this now costs ${quote.coins} coins`);
    const before = (await this.craftMastery(accountId))[recipe.profession];
    if (before < recipe.requiredMastery) return reject("MASTERY_TOO_LOW", `needs ${recipe.requiredMastery} ${recipe.profession} mastery`);
    const after = Math.min(CRAFT_MASTERY_MAX, masteryAfter(recipe, before, times));

    const ledgerId = `svc:${accountId}:${operationId}`;
    const o = recipe.output;
    const items = o.kind === "item" ? [{ itemId: o.itemId, quantity: o.quantity * times }] : [];
    const equipment: CraftResult["equipment"] = [];
    if (o.kind === "equipment") {
      // Piece ids are global: derive them from (account, operation) so a retry lands on the same rows.
      const pieceKey = (await hashJson({ craft: accountId, operationId })).slice(0, 32);
      const def = this.content.equipment.get(o.definitionId);
      if (def === undefined) return reject("NO_SUCH_RECIPE", `unknown output ${o.definitionId}`);
      for (let n = 0; n < times; n++) {
        const rolled = rollGear(this.rules, def, this.content.affixPools?.get(def.affixPoolId), new Rng(seedRng(crypto.randomUUID())));
        equipment.push({ id: `eq:craft:${pieceKey}:${n}`, definitionId: def.id, rarity: rolled.rarity, affixes: rolled.affixes });
      }
    }
    const result: CraftResult = { recipeId, times, paid: quote, items, equipment, profession: recipe.profession, mastery: { before, after } };

    const masteryNow = `COALESCE((SELECT mastery FROM craft_mastery WHERE account_id = ? AND profession = ?), 0)`;
    const guards = [this.inTown(), `NOT ${OPEN_BATTLE}`, `${masteryNow} = ?`, `(SELECT COALESCE(SUM(delta), 0) FROM coin_ledger WHERE account_id = ?) >= ?`];
    const args: unknown[] = [accountId, ...this.townMapIds, accountId, accountId, recipe.profession, before, accountId, quote.coins];
    for (const i of quote.inputs) {
      guards.push(`(SELECT COALESCE(SUM(delta), 0) FROM item_ledger WHERE account_id = ? AND item_id = ?) >= ?`);
      args.push(accountId, i.itemId, i.quantity);
    }
    const at = this.now();
    const ours = this.ours(accountId, operationId, hash);
    const itemLine = (lineNo: number, itemId: string, delta: number) =>
      this.db
        .prepare(
          `INSERT INTO item_ledger (operation_id, line_no, account_id, item_id, delta, reason, created_at)
           SELECT ?, ?, ?, ?, ?, 'craft', ? WHERE ${ours.sql} ON CONFLICT DO NOTHING`,
        )
        .bind(ledgerId, lineNo, accountId, itemId, delta, at, ...ours.args);
    const stmts: SqlBound[] = [
      this.anchor(accountId, operationId, "craft", hash, result, guards, args),
      ...quote.inputs.map((i, n) => itemLine(n, i.itemId, -i.quantity)),
      ...items.map((i, n) => itemLine(quote.inputs.length + n, i.itemId, i.quantity)),
      ...equipment.map((e) =>
        this.db
          .prepare(
            `INSERT INTO equipment_instances (id, definition_id, owner_id, rarity, affixes_json, created_operation_id, created_at)
             SELECT ?, ?, ?, ?, ?, ?, ? WHERE ${ours.sql} ON CONFLICT DO NOTHING`,
          )
          .bind(e.id, e.definitionId, accountId, e.rarity, JSON.stringify(e.affixes), e.id, at, ...ours.args),
      ),
      this.db
        .prepare(
          `INSERT INTO craft_mastery (account_id, profession, mastery) SELECT ?, ?, ? WHERE ${ours.sql}
           ON CONFLICT (account_id, profession) DO UPDATE SET mastery = excluded.mastery WHERE craft_mastery.mastery = ?`,
        )
        .bind(accountId, recipe.profession, after, ...ours.args, before),
    ];
    if (quote.coins > 0) {
      stmts.push(
        this.db
          .prepare(
            `INSERT INTO coin_ledger (operation_id, line_no, account_id, delta, reason, created_at)
             SELECT ?, 0, ?, ?, 'craft', ? WHERE ${ours.sql} ON CONFLICT DO NOTHING`,
          )
          .bind(ledgerId, accountId, -quote.coins, at, ...ours.args),
      );
    }
    await this.db.batch(stmts);
    return this.outcome(accountId, operationId, hash, async () => {
      const why = await this.whereAndFight(accountId);
      if (why !== null) return why;
      if ((await this.craftMastery(accountId))[recipe.profession] !== before) return reject("CHANGED", "your mastery changed; reload and try again");
      if ((await this.coins(accountId)) < quote.coins) return reject("INSUFFICIENT_COINS", `needs ${quote.coins} coins`);
      for (const i of quote.inputs) if ((await this.itemBalance(accountId, i.itemId)) < i.quantity) return reject("INSUFFICIENT_ITEMS", `needs ${i.quantity} ${i.itemId}`);
      return reject("CHANGED", "something changed; reload and try again");
    });
  }

  // ------------------------------------------------------------------ helpers

  private affixPiece(accountId: string, equipmentId: string) {
    return this.db
      .prepare(`SELECT id, definition_id, lock_state, affixes_json, affix_pending_json FROM equipment_instances WHERE id = ? AND owner_id = ?`)
      .bind(equipmentId, accountId)
      .first<{ id: string; definition_id: string; lock_state: string; affixes_json: string; affix_pending_json: string | null }>();
  }

  private async itemBalance(accountId: string, itemId: string): Promise<number> {
    const r = await this.db
      .prepare(`SELECT COALESCE(SUM(delta), 0) AS q FROM item_ledger WHERE account_id = ? AND item_id = ?`)
      .bind(accountId, itemId)
      .first<{ q: number }>();
    return r?.q ?? 0;
  }

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
