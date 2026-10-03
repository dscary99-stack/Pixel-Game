/**
 * Characters and teams in D1 (migration 0005). The server owns every value here: the client asks
 * to create a character or set a team, and gets the stored result back.
 *
 * - create: idempotent on operationId; one character per account until O10 is decided.
 * - setTeam: optimistic version check, ownership and C04 (≤5, no duplicate species) checked inside
 *   the same batch, refused while a fight holds the account's reservation (P15: change outside fights).
 * - rest: town rest restores HP/MP for free (chapter 03 §3), never during a fight.
 * - equip: one slot change per request, same version check and fight rule as the team; the shared
 *   `planEquip` decides slots, level and two-hand rules, the batch re-checks ownership and locks.
 */
import {
  CreateCharacterRequestSchema,
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
  validateTeam,
  type CharacterView,
  type MonsterInstance,
  type PrimaryStats,
  type RulesConfig,
  type SpeciesDefinition,
  type TeamSlot,
} from "@pmrpg/shared";
import { hashJson, type SqlBound, type SqlDb } from "./reward-ledger";

interface CharacterRow {
  id: string;
  account_id: string;
  name: string;
  class_id: string;
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
  species_id: string;
  owner_id: string;
  current_level: number;
  xp: number;
  rebirth_stage: number;
  element: MonsterInstance["element"];
  primary_stats_json: string;
  growth_history_version: number;
  trained_skill_levels_json: string;
  bond: number;
  origin_json: string;
  ownership_version: number;
  lock_state: MonsterInstance["lockState"];
  hp: number | null;
  mp: number | null;
}

export type StoredInstance = MonsterInstance & { hp: number | null; mp: number | null };

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
        | "SLOT_MISMATCH"
        | "LEVEL_TOO_LOW"
        | "MISSING_REFERENCE"
        | "TWO_HAND_BLOCKS_OFFHAND";
      message: string;
    };

interface EquipmentRow {
  id: string;
  definition_id: string;
  refine_level: number;
  lock_state: EquipmentView["lockState"];
  slot: EquipSlot | null;
}

export type CreateResult =
  | { status: "created"; character: CharacterView }
  | { status: "rejected"; reason: "INVALID_REQUEST" | "CHARACTER_EXISTS"; message: string };

export type SetTeamResult =
  | { status: "saved"; character: CharacterView }
  | { status: "rejected"; reason: "INVALID_REQUEST" | "NO_CHARACTER" | "STALE_VERSION" | "IN_BATTLE" | "NOT_OWNER" | "TEAM_TOO_LARGE" | "DUPLICATE_SPECIES"; message: string };

const OPEN_BATTLE = `EXISTS (SELECT 1 FROM battle_reservations WHERE account_id = ? AND status IN ('reserved', 'active'))`;

export class CharacterStore {
  constructor(
    private readonly db: SqlDb,
    private readonly rules: RulesConfig,
    private readonly content: StoreContent,
    private readonly now: () => string = () => new Date().toISOString(),
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
    await this.db.batch([
      this.db.prepare(`INSERT INTO accounts (id, created_at) VALUES (?, ?) ON CONFLICT DO NOTHING`).bind(accountId, at),
      this.db
        .prepare(
          `INSERT INTO characters (id, account_id, name, class_id, race_id, element, level, xp, primary_stats_json, created_operation_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, 1, 0, ?, ?, ?) ON CONFLICT DO NOTHING`,
        )
        .bind(id, accountId, req.name, req.classId, req.raceId, req.element, JSON.stringify(stats), req.operationId, at),
    ]);
    const row = await this.row(accountId);
    if (row === null) throw new Error("character insert vanished");
    if (row.created_operation_id !== req.operationId) return { status: "rejected", reason: "CHARACTER_EXISTS", message: "this account already has a character" };
    // A retried operation returns what was stored the first time, like every idempotent write here.
    return { status: "created", character: await this.view(row) };
  }

  async get(accountId: string): Promise<CharacterView | null> {
    const row = await this.row(accountId);
    return row === null ? null : this.view(row);
  }

  /** Every companion the account owns, for the team screen. No gameplay cap (C04). */
  async companions(accountId: string): Promise<StoredInstance[]> {
    const { results } = await this.db
      .prepare(`SELECT * FROM monster_instances WHERE owner_id = ? ORDER BY species_id, id`)
      .bind(accountId)
      .all<InstanceRow>();
    return results.map(toInstance);
  }

  async setTeam(accountId: string, raw: unknown): Promise<SetTeamResult> {
    const parsed = SetTeamRequestSchema.safeParse(raw);
    if (!parsed.success) return { status: "rejected", reason: "INVALID_REQUEST", message: parsed.error.issues.map((i) => i.message).join("; ") };
    const { expectedVersion, companionIds } = parsed.data;
    const row = await this.row(accountId);
    if (row === null) return { status: "rejected", reason: "NO_CHARACTER", message: "create a character first" };
    if (new Set(companionIds).size !== companionIds.length) return { status: "rejected", reason: "INVALID_REQUEST", message: "a companion is listed twice" };

    const owned = new Map((await this.companions(accountId)).map((c) => [c.id, c]));
    const members = companionIds.map((id) => owned.get(id));
    if (members.some((m) => m === undefined)) return { status: "rejected", reason: "NOT_OWNER", message: "every team member must be your own companion" };
    const team = members.map((m) => ({ instanceId: m!.id, speciesId: m!.speciesId }));
    const issues = validateTeam(this.rules, team);
    if (issues.length > 0) return { status: "rejected", reason: issues[0]!.code as "TEAM_TOO_LARGE" | "DUPLICATE_SPECIES", message: issues.map((i) => i.message).join("; ") };
    const slots = teamFormation(this.rules, team, this.content.species);

    const teamHash = await hashJson({ expectedVersion, slots });
    const n = slots.length;
    const ownedGuard = n === 0 ? "1" : `(SELECT COUNT(*) FROM monster_instances WHERE owner_id = ? AND id IN (${marks(n)})) = ?`;
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
        `SELECT e.id, e.definition_id, e.refine_level, e.lock_state, ce.slot
         FROM equipment_instances e
         LEFT JOIN character_equipment ce ON ce.equipment_instance_id = e.id
         WHERE e.owner_id = ? ORDER BY e.definition_id, e.id`,
      )
      .bind(accountId)
      .all<EquipmentRow>();
    return results.map((r) => ({ id: r.id, definitionId: r.definition_id, refineLevel: r.refine_level, lockState: r.lock_state, slot: r.slot }));
  }

  async equip(accountId: string, raw: unknown): Promise<EquipResult> {
    const parsed = EquipRequestSchema.safeParse(raw);
    if (!parsed.success) return { status: "rejected", reason: "INVALID_REQUEST", message: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
    const { expectedVersion, slot, instanceId } = parsed.data;
    const row = await this.row(accountId);
    if (row === null) return { status: "rejected", reason: "NO_CHARACTER", message: "create a character first" };
    if (row.version !== expectedVersion) return { status: "rejected", reason: "STALE_VERSION", message: "the character changed; reload and try again" };

    const owned = await this.equipment(accountId);
    const byId = new Map(owned.map((e) => [e.id, { id: e.id, definitionId: e.definitionId, sigilSockets: [] as string[] }]));
    if (instanceId !== null && !byId.has(instanceId)) return { status: "rejected", reason: "NOT_OWNER", message: "that equipment is not yours" };
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

  private row(accountId: string): Promise<CharacterRow | null> {
    return this.db.prepare(`SELECT * FROM characters WHERE account_id = ?`).bind(accountId).first<CharacterRow>();
  }

  private async view(row: CharacterRow): Promise<CharacterView> {
    const { results } = await this.db
      .prepare(`SELECT monster_instance_id, species_id, row, slot FROM character_team WHERE character_id = ? ORDER BY position`)
      .bind(row.id)
      .all<{ monster_instance_id: string; species_id: string; row: TeamSlot["row"]; slot: number }>();
    return {
      id: row.id,
      name: row.name,
      classId: row.class_id,
      raceId: row.race_id,
      element: row.element,
      level: row.level,
      xp: row.xp,
      primaryStats: JSON.parse(row.primary_stats_json) as PrimaryStats,
      hp: row.hp,
      mp: row.mp,
      version: row.version,
      team: results.map((t) => ({ instanceId: t.monster_instance_id, speciesId: t.species_id, row: t.row, slot: t.slot })),
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
    trainedSkillLevels: JSON.parse(r.trained_skill_levels_json) as Record<string, number>,
    bond: r.bond,
    originRecord: JSON.parse(r.origin_json) as MonsterInstance["originRecord"],
    ownershipVersion: r.ownership_version,
    lockState: r.lock_state,
    hp: r.hp,
    mp: r.mp,
  };
}

const marks = (n: number) => Array.from({ length: n }, () => "?").join(", ");
