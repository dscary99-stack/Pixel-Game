/**
 * Characters and teams in D1 (migration 0005). The server owns every value here: the client asks
 * to create a character or set a team, and gets the stored result back.
 *
 * - create: idempotent on operationId; one character per account until O10 is decided. The secret
 *   quest set (secret-quest-store.ts) is rolled before the batch and stored in it, insert-if-absent.
 * - setTeam: optimistic version check, ownership and C04 (≤5, no duplicate species) checked inside
 *   the same batch, refused while a fight holds the account's reservation (P15: change outside fights).
 * - rest: town rest restores HP/MP for free (chapter 03 §3), never during a fight.
 * - equip: one slot change per request, same version check and fight rule as the team; the shared
 *   `planEquip` decides slots, level and two-hand rules, the batch re-checks ownership and locks.
 */
import {
  COMPANION_GROWTH_VERSION,
  STARTER_KIT,
  companionPrimaryStats,
  AllocateStatsRequestSchema,
  CreateCharacterRequestSchema,
  expForLevel,
  levelForExp,
  planAllocation,
  EquipRequestSchema,
  planEquip,
  wornGear,
  type EquipSlot,
  type EquipmentDefinition,
  type EquipmentView,
  type Loadout,
  type SigilDefinition,
  SetTeamRequestSchema,
  teamFormation,
  formationIssues,
  validateTeam,
  type CharacterView,
  type MonsterInstance,
  type PrimaryStats,
  type RulesConfig,
  type SpeciesDefinition,
  type TeamSlot,
} from "@pmrpg/shared";
import { hashJson, type SqlBound, type SqlDb } from "./reward-ledger";
import type { SecretQuestStore } from "./secret-quest-store";

interface CharacterRow {
  id: string;
  account_id: string;
  name: string;
  class_id: string;
  class2_id?: string | null;
  race_id: string;
  element: CharacterView["element"];
  level: number;
  xp: number;
  primary_stats_json: string;
  hp: number | null;
  mp: number | null;
  version: number;
  created_operation_id: string;
}

interface InstanceRow {
  id: string;
  no_sell?: number;
  no_trade?: number;
  species_id: string;
  owner_id: string;
  current_level: number;
  xp: number;
  rebirth_stage: number;
  element: MonsterInstance["element"];
  primary_stats_json: string;
  growth_history_version: number;
  growth_seed: string | null;
  trained_skill_levels_json: string;
  skill_mastery?: number;
  rebirth_choices_json?: string;
  bond: number;
  origin_json: string;
  ownership_version: number;
  lock_state: MonsterInstance["lockState"];
  hp: number | null;
  mp: number | null;
  nickname?: string | null;
  protected?: number;
}

export type StoredInstance = MonsterInstance & { hp: number | null; mp: number | null };

export type AllocateResult =
  | { status: "saved"; character: CharacterView }
  | { status: "rejected"; reason: "INVALID_REQUEST" | "NO_CHARACTER" | "STALE_VERSION" | "IN_BATTLE" | "STAT_DECREASE" | "OVER_BUDGET"; message: string };

export interface StoreContent {
  species: ReadonlyMap<string, SpeciesDefinition>;
  equipment: ReadonlyMap<string, EquipmentDefinition>;
  sigils: ReadonlyMap<string, SigilDefinition>;
}

export type EquipResult =
  | { status: "saved"; character: CharacterView; equipment: EquipmentView[] }
  | {
      status: "rejected";
      reason:
        | "INVALID_REQUEST"
        | "NO_CHARACTER"
        | "STALE_VERSION"
        | "IN_BATTLE"
        | "NOT_OWNER"
        | "ASSET_LOCKED"
        | "SLOT_MISMATCH"
        | "LEVEL_TOO_LOW"
        | "MISSING_REFERENCE"
        | "TWO_HAND_BLOCKS_OFFHAND";
      message: string;
    };

interface EquipmentRow {
  id: string;
  no_sell?: number;
  no_trade?: number;
  no_store?: number;
  definition_id: string;
  refine_level: number;
  lock_state: EquipmentView["lockState"];
  slot: EquipSlot | null;
  sigil_sockets_json: string;
  rarity: EquipmentView["rarity"];
  affixes_json: string;
  affix_pending_json: string | null;
  protected: number;
  version: number;
}

export type CreateResult =
  | { status: "created"; character: CharacterView }
  | { status: "rejected"; reason: "INVALID_REQUEST" | "CHARACTER_EXISTS"; message: string };

export type SetTeamResult =
  | { status: "saved"; character: CharacterView }
  | { status: "rejected"; reason: "INVALID_REQUEST" | "NO_CHARACTER" | "STALE_VERSION" | "IN_BATTLE" | "NOT_OWNER" | "ASSET_LOCKED" | "TEAM_TOO_LARGE" | "DUPLICATE_SPECIES" | "FORMATION_INVALID" | "COMPANION_BOX_FULL"; message: string };

const OPEN_BATTLE = `EXISTS (SELECT 1 FROM battle_reservations WHERE account_id = ? AND status IN ('reserved', 'active'))`;

export class CharacterStore {
  constructor(
    private readonly db: SqlDb,
    private readonly rules: RulesConfig,
    private readonly content: StoreContent,
    private readonly now: () => string = () => new Date().toISOString(),
    /** Rolls and stores the secret quests at creation. Left out (some tests), they are rolled on first read. */
    private readonly secretQuests?: SecretQuestStore,
  ) {}

  static async idFor(accountId: string, operationId: string): Promise<string> {
    return `char:${(await hashJson({ accountId, operationId })).slice(0, 24)}`;
  }

  async create(accountId: string, raw: unknown): Promise<CreateResult> {
    const parsed = CreateCharacterRequestSchema.safeParse(raw);
    if (!parsed.success) return { status: "rejected", reason: "INVALID_REQUEST", message: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
    const req = parsed.data;
    const id = await CharacterStore.idFor(accountId, req.operationId);
    const start = this.rules.provisional.primaryStatStart.value;
    const stats: PrimaryStats = { STR: start, VIT: start, INT: start, DEX: start, AGI: start, SPI: start };
    const at = this.now();
    // The starter kit lands in the same batch, only if this request's character row is the one
    // stored, keyed on the character id: once per character however often the create is retried.
    const mine = `EXISTS (SELECT 1 FROM characters WHERE id = ? AND account_id = ? AND created_operation_id = ?)`;
    const mineArgs = [id, accountId, req.operationId];
    const kit = `starter:${id}`;
    // Rolled from this request's name; stored only if this request's character row (with that name)
    // is the one in the table, and never over an existing set, so a replay or a race cannot reroll.
    // No server key outside dev throws here: creation fails rather than roll with a default key.
    const secret = this.secretQuests === undefined ? null : await this.secretQuests.roll(accountId, { name: req.name, element: req.element, raceId: req.raceId });
    await this.db.batch([
      this.db.prepare(`INSERT INTO accounts (id, created_at) VALUES (?, ?) ON CONFLICT DO NOTHING`).bind(accountId, at),
      this.db
        .prepare(
          `INSERT INTO characters (id, account_id, name, class_id, race_id, element, level, xp, primary_stats_json, created_operation_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, 1, 0, ?, ?, ?) ON CONFLICT DO NOTHING`,
        )
        .bind(id, accountId, req.name, req.classId, req.raceId, req.element, JSON.stringify(stats), req.operationId, at),
      ...Object.entries(STARTER_KIT.items).map(([itemId, qty], i) =>
        this.db
          .prepare(
            `INSERT INTO item_ledger (operation_id, line_no, account_id, item_id, delta, reason, created_at)
             SELECT ?, ?, ?, ?, ?, 'starter_kit', ? WHERE ${mine} ON CONFLICT DO NOTHING`,
          )
          .bind(kit, i, accountId, itemId, qty, at, ...mineArgs),
      ),
      this.db
        .prepare(
          `INSERT INTO coin_ledger (operation_id, line_no, account_id, delta, reason, created_at)
           SELECT ?, 0, ?, ?, 'starter_kit', ? WHERE ${mine} ON CONFLICT DO NOTHING`,
        )
        .bind(kit, accountId, STARTER_KIT.coins, at, ...mineArgs),
      ...STARTER_KIT.equipment.map((d, i) =>
        this.db
          .prepare(
            `INSERT INTO equipment_instances (id, definition_id, owner_id, created_operation_id, created_at)
             SELECT ?, ?, ?, ?, ? WHERE ${mine} ON CONFLICT DO NOTHING`,
          )
          .bind(`eq:${kit}:${i}`, d, accountId, `${kit}:${i}`, at, ...mineArgs),
      ),
      ...(secret === null || this.secretQuests === undefined
        ? []
        : [this.secretQuests.insert(id, accountId, secret, { sql: `EXISTS (SELECT 1 FROM characters WHERE id = ? AND account_id = ? AND created_operation_id = ? AND name = ?)`, args: [...mineArgs, req.name] })]),
    ]);
    const row = await this.row(accountId);
    if (row === null) throw new Error("character insert vanished");
    if (row.created_operation_id !== req.operationId) return { status: "rejected", reason: "CHARACTER_EXISTS", message: "this account already has a character" };
    // A retried operation returns what was stored the first time, like every idempotent write here.
    return { status: "created", character: await this.view(row) };
  }

  /**
   * Levels follow cumulative EXP (granted with each reward receipt). The stored level is a cache:
   * raise it to what the EXP reaches, never lower it here. Idempotent; a lost update is redone on
   * the next read.
   */
  async syncLevels(accountId: string): Promise<void> {
    const ch = await this.db.prepare(`SELECT id, xp, level FROM characters WHERE account_id = ?`).bind(accountId).first<{ id: string; xp: number; level: number }>();
    const { results: pets } = await this.db
      .prepare(
        `SELECT id, xp, current_level AS level, species_id, growth_seed, growth_history_version, rebirth_stage
         FROM monster_instances WHERE owner_id = ?`,
      )
      .bind(accountId)
      .all<{ id: string; xp: number; level: number; species_id: string; growth_seed: string | null; growth_history_version: number; rebirth_stage: number }>();
    const stmts: SqlBound[] = [];
    if (ch !== null) {
      const level = levelForExp(this.rules, "player", ch.xp);
      if (level > ch.level) stmts.push(this.db.prepare(`UPDATE characters SET level = ? WHERE id = ? AND level < ?`).bind(level, ch.id, level));
    }
    for (const p of pets) {
      const level = levelForExp(this.rules, "companion", p.xp);
      if (level <= p.level) continue;
      // The stored stats are a cache of the growth path at the new level (companion-growth.ts).
      const sp = this.content.species.get(p.species_id);
      const stats =
        sp !== undefined && p.growth_history_version >= COMPANION_GROWTH_VERSION
          ? JSON.stringify(companionPrimaryStats(this.rules, sp.archetype, p.growth_seed ?? p.id, level, p.rebirth_stage))
          : null;
      stmts.push(
        this.db
          .prepare(`UPDATE monster_instances SET current_level = ?, primary_stats_json = COALESCE(?, primary_stats_json) WHERE id = ? AND current_level < ?`)
          .bind(level, stats, p.id, level),
      );
    }
    if (stmts.length > 0) await this.db.batch(stmts);
  }

  /** Spend stat points (P03): no stat goes down, the total fits the level budget, outside fights. */
  async allocate(accountId: string, raw: unknown): Promise<AllocateResult> {
    const parsed = AllocateStatsRequestSchema.safeParse(raw);
    if (!parsed.success) return { status: "rejected", reason: "INVALID_REQUEST", message: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
    const { expectedVersion, stats } = parsed.data;
    await this.syncLevels(accountId);
    const row = await this.row(accountId);
    if (row === null) return { status: "rejected", reason: "NO_CHARACTER", message: "create a character first" };
    if (row.version !== expectedVersion) return { status: "rejected", reason: "STALE_VERSION", message: "the character changed; reload and try again" };
    if (await this.inBattle(accountId)) return { status: "rejected", reason: "IN_BATTLE", message: "spend points outside fights" };
    const plan = planAllocation(this.rules, row.level, JSON.parse(row.primary_stats_json) as PrimaryStats, stats);
    if (!plan.ok) return { status: "rejected", reason: plan.code, message: plan.message };
    // One statement: the version and level guards make it all-or-nothing.
    await this.db
      .prepare(
        `UPDATE characters SET primary_stats_json = ?, version = version + 1
         WHERE id = ? AND version = ? AND level >= ? AND primary_stats_json = ? AND NOT ${OPEN_BATTLE}`,
      )
      .bind(JSON.stringify(stats), row.id, expectedVersion, row.level, row.primary_stats_json, accountId)
      .run();
    const after = await this.row(accountId);
    if (after?.version === expectedVersion + 1 && after.primary_stats_json === JSON.stringify(stats)) return { status: "saved", character: await this.view(after) };
    if (await this.inBattle(accountId)) return { status: "rejected", reason: "IN_BATTLE", message: "spend points outside fights" };
    return { status: "rejected", reason: "STALE_VERSION", message: "the character changed; reload and try again" };
  }

  private async inBattle(accountId: string): Promise<boolean> {
    const open = await this.db.prepare(`SELECT 1 AS x FROM battle_reservations WHERE account_id = ? AND status IN ('reserved', 'active')`).bind(accountId).first();
    return open !== null;
  }

  async get(accountId: string): Promise<CharacterView | null> {
    await this.syncLevels(accountId);
    const row = await this.row(accountId);
    return row === null ? null : this.view(row);
  }

  /** Every companion the account owns, for the team screen. No gameplay cap (C04). */
  async companions(accountId: string): Promise<StoredInstance[]> {
    await this.syncLevels(accountId);
    const { results } = await this.db
      .prepare(`SELECT * FROM monster_instances WHERE owner_id = ? ORDER BY species_id, id`)
      .bind(accountId)
      .all<InstanceRow>();
    return results.map(toInstance);
  }

  async setTeam(accountId: string, raw: unknown): Promise<SetTeamResult> {
    const parsed = SetTeamRequestSchema.safeParse(raw);
    if (!parsed.success) return { status: "rejected", reason: "INVALID_REQUEST", message: parsed.error.issues.map((i) => i.message).join("; ") };
    const { expectedVersion, companionIds, formation } = parsed.data;
    const row = await this.row(accountId);
    if (row === null) return { status: "rejected", reason: "NO_CHARACTER", message: "create a character first" };
    if (new Set(companionIds).size !== companionIds.length) return { status: "rejected", reason: "INVALID_REQUEST", message: "a companion is listed twice" };

    const owned = new Map((await this.companions(accountId)).map((c) => [c.id, c]));
    const members = companionIds.map((id) => owned.get(id));
    if (members.some((m) => m === undefined)) return { status: "rejected", reason: "NOT_OWNER", message: "every team member must be your own companion" };
    if (members.some((m) => m!.lockState === "in_escrow")) return { status: "rejected", reason: "ASSET_LOCKED", message: "a companion listed on the market or held in a trade cannot join the team" };
    const team = members.map((m) => ({ instanceId: m!.id, speciesId: m!.speciesId }));
    const issues = validateTeam(this.rules, team);
    if (issues.length > 0) return { status: "rejected", reason: issues[0]!.code as "TEAM_TOO_LARGE" | "DUPLICATE_SPECIES", message: issues.map((i) => i.message).join("; ") };
    // Taking companions out of the team puts them in the box (P26): it must have room for them.
    const cap = this.rules.provisional.companionBox.value.capacity;
    const teamNow = (await this.view(row)).team.length;
    if (companionIds.length < teamNow && owned.size - companionIds.length > cap) {
      return { status: "rejected", reason: "COMPANION_BOX_FULL", message: `the companion box holds ${cap}; release one before taking another out of the team` };
    }
    if (formation !== undefined) {
      const bad = formationIssues(this.rules, companionIds, formation);
      if (bad.length > 0) return { status: "rejected", reason: "FORMATION_INVALID", message: bad.join("; ") };
    }
    const cellOf = new Map((formation ?? []).map((f) => [f.instanceId, f]));
    const slots =
      formation === undefined
        ? teamFormation(this.rules, team, this.content.species)
        : team.map((t) => ({ ...t, row: cellOf.get(t.instanceId)!.row, slot: cellOf.get(t.instanceId)!.slot }));

    const teamHash = await hashJson({ expectedVersion, slots });
    const n = slots.length;
    const ownedGuard = n === 0 ? "1" : `(SELECT COUNT(*) FROM monster_instances WHERE owner_id = ? AND lock_state <> 'in_escrow' AND id IN (${marks(n)})) = ?`;
    const ownedArgs = n === 0 ? [] : [accountId, ...slots.map((t) => t.instanceId), n];
    const ours = `EXISTS (SELECT 1 FROM characters WHERE id = ? AND version = ? AND team_hash = ?)`;
    const oursArgs = [row.id, expectedVersion + 1, teamHash];
    const stmts: SqlBound[] = [
      this.db
        .prepare(
          `UPDATE characters SET version = version + 1, team_hash = ?
           WHERE id = ? AND version = ? AND NOT ${OPEN_BATTLE} AND ${ownedGuard}`,
        )
        .bind(teamHash, row.id, expectedVersion, accountId, ...ownedArgs),
      this.db.prepare(`DELETE FROM character_team WHERE character_id = ? AND ${ours}`).bind(row.id, ...oursArgs),
      ...slots.map((t, i) =>
        this.db
          .prepare(
            `INSERT INTO character_team (character_id, position, monster_instance_id, species_id, row, slot)
             SELECT ?, ?, ?, ?, ?, ? WHERE ${ours}`,
          )
          .bind(row.id, i, t.instanceId, t.speciesId, t.row, t.slot, ...oursArgs),
      ),
    ];
    await this.db.batch(stmts);

    const after = await this.row(accountId);
    const won = await this.db.prepare(`SELECT team_hash FROM characters WHERE id = ?`).bind(row.id).first<{ team_hash: string | null }>();
    if (after !== null && after.version === expectedVersion + 1 && won?.team_hash === teamHash) return { status: "saved", character: await this.view(after) };
    if (row.version !== expectedVersion || (after !== null && after.version !== expectedVersion)) {
      return { status: "rejected", reason: "STALE_VERSION", message: "the character changed; reload and try again" };
    }
    const fighting = await this.db.prepare(`SELECT 1 AS x FROM battle_reservations WHERE account_id = ? AND status IN ('reserved', 'active')`).bind(accountId).first();
    if (fighting !== null) return { status: "rejected", reason: "IN_BATTLE", message: "change the team outside fights" };
    return { status: "rejected", reason: "NOT_OWNER", message: "a team member changed owner" };
  }

  /**
   * Free rest (town or rest point): HP/MP back to full for the character and every companion that
   * is not in a fight. Refused while the account has an open fight. Returns whether it rested.
   */
  async rest(accountId: string): Promise<boolean> {
    await this.db.batch([
      this.db.prepare(`UPDATE characters SET hp = NULL, mp = NULL WHERE account_id = ? AND NOT ${OPEN_BATTLE}`).bind(accountId, accountId),
      this.db
        .prepare(`UPDATE monster_instances SET hp = NULL, mp = NULL WHERE owner_id = ? AND lock_state = 'free' AND NOT ${OPEN_BATTLE}`)
        .bind(accountId, accountId),
    ]);
    const open = await this.db.prepare(`SELECT 1 AS x FROM battle_reservations WHERE account_id = ? AND status IN ('reserved', 'active')`).bind(accountId).first();
    return open === null;
  }

  /** Character, team instances and worn gear for building a battle. */
  async loadout(accountId: string): Promise<{
    character: CharacterView;
    instances: Map<string, StoredInstance>;
    worn: ReturnType<typeof wornGear>;
    equipmentIds: string[];
  } | null> {
    const character = await this.get(accountId);
    if (character === null) return null;
    const gear = (await this.equipment(accountId)).filter((e) => e.slot !== null);
    const worn = wornGear(gear, this.content.equipment);
    const equipmentIds = gear.map((e) => e.id);
    const ids = character.team.map((t) => t.instanceId);
    if (ids.length === 0) return { character, instances: new Map(), worn, equipmentIds };
    const { results } = await this.db
      .prepare(`SELECT * FROM monster_instances WHERE owner_id = ? AND id IN (${marks(ids.length)})`)
      .bind(accountId, ...ids)
      .all<InstanceRow>();
    return { character, instances: new Map(results.map((r) => [r.id, toInstance(r)])), worn, equipmentIds };
  }

  /** Every piece the account owns, with the slot its character wears it in. */
  async equipment(accountId: string): Promise<EquipmentView[]> {
    const { results } = await this.db
      .prepare(
        `SELECT e.id, e.definition_id, e.refine_level, e.lock_state, e.sigil_sockets_json, e.rarity, e.affixes_json, e.affix_pending_json, e.protected, e.no_sell, e.no_trade, e.no_store, e.version, ce.slot
         FROM equipment_instances e
         LEFT JOIN character_equipment ce ON ce.equipment_instance_id = e.id
         WHERE e.owner_id = ? AND e.id NOT IN (SELECT equipment_id FROM vault_equipment) ORDER BY e.definition_id, e.id`,
      )
      .bind(accountId)
      .all<EquipmentRow>();
    return results.map((r) => ({ id: r.id, definitionId: r.definition_id, refineLevel: r.refine_level, lockState: r.lock_state, slot: r.slot, sigils: JSON.parse(r.sigil_sockets_json) as string[], rarity: r.rarity,
      affixes: JSON.parse(r.affixes_json) as EquipmentView["affixes"],
      ...(r.affix_pending_json === null ? {} : { pendingAffix: JSON.parse(r.affix_pending_json) as NonNullable<EquipmentView["pendingAffix"]> }),
      ...(r.protected === 1 ? { protected: true } : {}),
      ...(r.no_sell === 1 || this.content.equipment.get(r.definition_id)?.noSell === true ? { noSell: true } : {}),
      ...(r.no_trade === 1 || this.content.equipment.get(r.definition_id)?.noTrade === true ? { noTrade: true } : {}),
      ...(r.no_store === 1 || this.content.equipment.get(r.definition_id)?.noStore === true ? { noStore: true } : {}),
      version: r.version,
    }));
  }

  async equip(accountId: string, raw: unknown): Promise<EquipResult> {
    const parsed = EquipRequestSchema.safeParse(raw);
    if (!parsed.success) return { status: "rejected", reason: "INVALID_REQUEST", message: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
    const { expectedVersion, slot, instanceId } = parsed.data;
    await this.syncLevels(accountId);
    const row = await this.row(accountId);
    if (row === null) return { status: "rejected", reason: "NO_CHARACTER", message: "create a character first" };
    if (row.version !== expectedVersion) return { status: "rejected", reason: "STALE_VERSION", message: "the character changed; reload and try again" };

    const owned = await this.equipment(accountId);
    const byId = new Map(owned.map((e) => [e.id, { id: e.id, definitionId: e.definitionId, sigilSockets: e.sigils }]));
    if (instanceId !== null && !byId.has(instanceId)) return { status: "rejected", reason: "NOT_OWNER", message: "that equipment is not yours" };
    if (instanceId !== null && owned.find((e) => e.id === instanceId)!.lockState === "in_escrow") return { status: "rejected", reason: "ASSET_LOCKED", message: "a piece listed on the market or held in a trade cannot be worn" };
    const current: Loadout = Object.fromEntries(owned.filter((e) => e.slot !== null).map((e) => [e.slot, e.id]));
    const plan = planEquip(this.rules, current, slot, instanceId, byId, this.content.equipment, this.content.sigils, row.level);
    if (!plan.ok) return { status: "rejected", reason: plan.code, message: plan.message };

    const worn = Object.entries(plan.loadout) as [EquipSlot, string][];
    const gearHash = await hashJson({ expectedVersion, loadout: plan.loadout });
    const n = worn.length;
    const ownedGuard = n === 0 ? "1" : `(SELECT COUNT(*) FROM equipment_instances WHERE owner_id = ? AND lock_state = 'free' AND id IN (${marks(n)})) = ?`;
    const ownedArgs = n === 0 ? [] : [accountId, ...worn.map(([, id]) => id), n];
    const ours = `EXISTS (SELECT 1 FROM characters WHERE id = ? AND version = ? AND gear_hash = ?)`;
    const oursArgs = [row.id, expectedVersion + 1, gearHash];
    await this.db.batch([
      this.db
        .prepare(
          `UPDATE characters SET version = version + 1, gear_hash = ?
           WHERE id = ? AND version = ? AND NOT ${OPEN_BATTLE} AND ${ownedGuard}`,
        )
        .bind(gearHash, row.id, expectedVersion, accountId, ...ownedArgs),
      this.db.prepare(`DELETE FROM character_equipment WHERE character_id = ? AND ${ours}`).bind(row.id, ...oursArgs),
      ...worn.map(([s, id]) =>
        this.db
          .prepare(`INSERT INTO character_equipment (character_id, slot, equipment_instance_id) SELECT ?, ?, ? WHERE ${ours}`)
          .bind(row.id, s, id, ...oursArgs),
      ),
    ]);

    const after = await this.db.prepare(`SELECT version, gear_hash FROM characters WHERE id = ?`).bind(row.id).first<{ version: number; gear_hash: string | null }>();
    if (after?.version === expectedVersion + 1 && after.gear_hash === gearHash) {
      return { status: "saved", character: (await this.get(accountId))!, equipment: await this.equipment(accountId) };
    }
    if (after?.version !== expectedVersion) return { status: "rejected", reason: "STALE_VERSION", message: "the character changed; reload and try again" };
    const fighting = await this.db.prepare(`SELECT 1 AS x FROM battle_reservations WHERE account_id = ? AND status IN ('reserved', 'active')`).bind(accountId).first();
    if (fighting !== null) return { status: "rejected", reason: "IN_BATTLE", message: "change equipment outside fights" };
    return { status: "rejected", reason: "NOT_OWNER", message: "a piece changed owner or is locked" };
  }

  /**
   * DEV ONLY: give the account these equipment pieces once (keyed by operation id). The account
   * row must exist. Players never have a grant path; drops come through RewardLedger.
   */
  async devGrantEquipment(operationId: string, accountId: string, definitionIds: readonly string[]): Promise<void> {
    const at = this.now();
    await this.db.batch(
      definitionIds.map((d, i) =>
        this.db
          .prepare(
            `INSERT INTO equipment_instances (id, definition_id, owner_id, created_operation_id, created_at)
             VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
          )
          .bind(`eq:${operationId}:${i}`, d, accountId, `${operationId}:${i}`, at),
      ),
    );
  }

  /** DEV ONLY: one piece with a set rarity and affixes, once per operation id. */
  async devGrantPiece(operationId: string, accountId: string, piece: { definitionId: string; rarity: EquipmentView["rarity"]; affixes: EquipmentView["affixes"] }): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO equipment_instances (id, definition_id, owner_id, rarity, affixes_json, created_operation_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
      )
      .bind(`eq:${operationId}`, piece.definitionId, accountId, piece.rarity, JSON.stringify(piece.affixes), operationId, this.now())
      .run();
  }

  /** DEV ONLY: raise the character to at least this level by giving it the EXP for it (smoke tests of Class2). */
  async devRaiseLevel(accountId: string, level: number): Promise<void> {
    const xp = expForLevel(this.rules, "player", level);
    await this.db.prepare(`UPDATE characters SET xp = ? WHERE account_id = ? AND xp < ?`).bind(xp, accountId, xp).run();
    await this.syncLevels(accountId);
  }

  /** DEV ONLY: one companion of a species at a level, once per operation id (smoke tests of trade and Class2). */
  async devGrantCompanion(operationId: string, accountId: string, speciesId: string, level: number): Promise<void> {
    const sp = this.content.species.get(speciesId);
    if (sp === undefined) throw new Error(`unknown species ${speciesId}`);
    // Stats as if it had grown to this level (companion-growth.ts), with its id as the growth seed.
    const id = `mon:${operationId}`;
    await this.db
      .prepare(
        `INSERT INTO monster_instances (id, species_id, owner_id, current_level, element, primary_stats_json, origin_json, created_operation_id, growth_seed, growth_history_version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
      )
      .bind(id, speciesId, accountId, level, sp.allowedElements[0], JSON.stringify(companionPrimaryStats(this.rules, sp.archetype, id, level, 0)), JSON.stringify({ kind: "capture", at: this.now() }), operationId, id, COMPANION_GROWTH_VERSION)
      .run();
  }

  private row(accountId: string): Promise<CharacterRow | null> {
    return this.db.prepare(`SELECT * FROM characters WHERE account_id = ?`).bind(accountId).first<CharacterRow>();
  }

  private async view(row: CharacterRow): Promise<CharacterView> {
    const { results } = await this.db
      .prepare(`SELECT monster_instance_id, species_id, row, slot FROM character_team WHERE character_id = ? ORDER BY position`)
      .bind(row.id)
      .all<{ monster_instance_id: string; species_id: string; row: TeamSlot["row"]; slot: number }>();
    const owned = (await this.db.prepare(`SELECT COUNT(*) AS n FROM monster_instances WHERE owner_id = ?`).bind(row.account_id).first<{ n: number }>())?.n ?? 0;
    return {
      id: row.id,
      name: row.name,
      classId: row.class_id,
      class2Id: row.class2_id ?? null,
      raceId: row.race_id,
      element: row.element,
      level: row.level,
      xp: row.xp,
      primaryStats: JSON.parse(row.primary_stats_json) as PrimaryStats,
      hp: row.hp,
      mp: row.mp,
      version: row.version,
      team: results.map((t) => ({ instanceId: t.monster_instance_id, speciesId: t.species_id, row: t.row, slot: t.slot })),
      companionBox: { used: Math.max(0, owned - results.length), capacity: this.rules.provisional.companionBox.value.capacity },
    };
  }
}

function toInstance(r: InstanceRow): StoredInstance {
  return {
    id: r.id,
    speciesId: r.species_id,
    ownerId: r.owner_id,
    currentLevel: r.current_level,
    xp: r.xp,
    rebirthStage: r.rebirth_stage,
    element: r.element,
    primaryStats: JSON.parse(r.primary_stats_json) as PrimaryStats,
    growthHistoryVersion: r.growth_history_version,
    growthSeed: r.growth_seed ?? r.id,
    trainedSkillLevels: JSON.parse(r.trained_skill_levels_json) as Record<string, number>,
    skillMastery: r.skill_mastery ?? 0,
    rebirthChoices: JSON.parse(r.rebirth_choices_json ?? "{}") as MonsterInstance["rebirthChoices"],
    bond: r.bond,
    originRecord: JSON.parse(r.origin_json) as MonsterInstance["originRecord"],
    ownershipVersion: r.ownership_version,
    lockState: r.lock_state,
    ...(r.nickname ? { nickname: r.nickname } : {}),
    ...(r.protected === 1 ? { protected: true } : {}),
    ...(r.no_sell === 1 ? { noSell: true } : {}),
    ...(r.no_trade === 1 ? { noTrade: true } : {}),
    hp: r.hp,
    mp: r.mp,
  };
}

const marks = (n: number) => Array.from({ length: n }, () => "?").join(", ");
