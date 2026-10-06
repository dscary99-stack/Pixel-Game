/**
 * Secret quest progress outside fights, and claiming rewards (migrations 0023, 0024).
 *
 * - Progress rows are written only under a credit row (character, source) won by a fresh token, so a
 *   source counts once however often it is replayed or raced. Fights: `Economy.settle` (source =
 *   battle id). Visits: walking into a map through a portal (source = map + visit window). Hand-ins:
 *   materials given at a town (source = the request's operationId).
 * - Everything counts only for a revealed set (the awakening quest; dev reveal for now).
 * - A claim takes the (character, quest) row under a token and grants the rolled rewards in the same
 *   batch: a title or fashion is recorded as owned, a companion and a piece of gear are created with
 *   ids made from the character and quest, so a raced or replayed claim grants once.
 */
import {
  SecretClaimRequestSchema,
  SecretDeliverRequestSchema,
  SecretQuestSchema,
  secretCompanionElement,
  secretTitleId,
  secretVisitCredit,
  secretVisitWindow,
  COMPANION_GROWTH_VERSION,
  type EquipmentDefinition,
  type RulesConfig,
  type SecretQuest,
  type SecretQuestReward,
  type SecretRewardDefinition,
  type SpeciesDefinition,
} from "@pmrpg/shared";
import { hashJson, type SqlBound, type SqlDb } from "./reward-ledger";

export interface SecretCredit {
  questId: string;
  n: number;
  count: number;
}

/**
 * The credit row for (character, source) under `guard`, then each quest's progress under that row's
 * token. Progress is capped at the count in SQL; completed_at is set once, when it first gets there.
 */
export function secretProgressWrites(db: SqlDb, characterId: string, sourceId: string, credits: SecretCredit[], at: string, guard: { sql: string; args: unknown[] }): SqlBound[] {
  if (credits.length === 0) return [];
  const token = crypto.randomUUID();
  const mine = `EXISTS (SELECT 1 FROM secret_quest_credits WHERE character_id = ? AND source_id = ? AND token = ?)`;
  const mineArgs = [characterId, sourceId, token];
  return [
    db
      .prepare(`INSERT INTO secret_quest_credits (character_id, source_id, token, at) SELECT ?, ?, ?, ? WHERE ${guard.sql} ON CONFLICT DO NOTHING`)
      .bind(characterId, sourceId, token, at, ...guard.args),
    ...credits.map((c) =>
      db
        .prepare(
          `INSERT INTO secret_quest_progress (character_id, quest_id, progress, completed_at, updated_at)
           SELECT ?, ?, ?, ?, ? WHERE ${mine}
           ON CONFLICT (character_id, quest_id) DO UPDATE SET
             progress = MIN(secret_quest_progress.progress + excluded.progress, ?),
             completed_at = COALESCE(secret_quest_progress.completed_at, CASE WHEN secret_quest_progress.progress + excluded.progress >= ? THEN excluded.updated_at END),
             updated_at = excluded.updated_at`,
        )
        .bind(characterId, c.questId, Math.min(c.n, c.count), c.n >= c.count ? at : null, at, ...mineArgs, c.count, c.count),
    ),
  ];
}

export interface SecretRewardContent {
  species: ReadonlyMap<string, SpeciesDefinition>;
  equipment: ReadonlyMap<string, EquipmentDefinition>;
  rewards: ReadonlyMap<string, SecretRewardDefinition>;
}

export type SecretRejection =
  | "INVALID_REQUEST"
  | "NO_CHARACTER"
  | "LOCKED"
  | "NO_SUCH_QUEST"
  | "WRONG_GOAL"
  | "NOT_IN_TOWN"
  | "TOO_MANY"
  | "INSUFFICIENT_ITEMS"
  | "PAYLOAD_MISMATCH"
  | "NOT_DONE"
  | "NO_REWARD";

export interface DeliverResult {
  questId: string;
  itemId: string;
  quantity: number;
}
export interface GrantedReward {
  kind: SecretQuestReward["kind"];
  rewardId: string;
  variantId: string;
  /** title: the title id; companion: the new companion id; gear: the new piece id; fashion: none. */
  ref: string | null;
}
export interface ClaimResult {
  questId: string;
  rewards: GrantedReward[];
}
export type SecretResult<T> = { status: "done"; replayed: boolean; result: T } | { status: "rejected"; reason: SecretRejection; message: string };

const reject = (reason: SecretRejection, message: string) => ({ status: "rejected" as const, reason, message });

interface SetRow {
  character_id: string;
  quests_json: string;
}

export class SecretProgressStore {
  constructor(
    private readonly db: SqlDb,
    private readonly rules: RulesConfig,
    private readonly content: SecretRewardContent,
    private readonly towns: readonly string[],
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  /** The account's revealed set, or why not. */
  private async revealed(accountId: string): Promise<{ characterId: string; quests: SecretQuest[] } | "NO_CHARACTER" | "LOCKED"> {
    const ch = await this.db.prepare(`SELECT id FROM characters WHERE account_id = ?`).bind(accountId).first<{ id: string }>();
    if (ch === null) return "NO_CHARACTER";
    const row = await this.db
      .prepare(`SELECT character_id, quests_json FROM character_secret_quests WHERE character_id = ? AND revealed_at IS NOT NULL`)
      .bind(ch.id)
      .first<SetRow>();
    if (row === null) return "LOCKED";
    return { characterId: row.character_id, quests: SecretQuestSchema.array().parse(JSON.parse(row.quests_json)) };
  }

  private async progress(characterId: string): Promise<Map<string, number>> {
    const rows = await this.db.prepare(`SELECT quest_id, progress FROM secret_quest_progress WHERE character_id = ?`).bind(characterId).all<{ quest_id: string; progress: number }>();
    return new Map(rows.results.map((r) => [r.quest_id, r.progress]));
  }

  /**
   * A walk into `mapId` through a portal. Counts toward explore quests on that map, once per map per
   * visit window; anything else (locked set, no such quest) is a silent no-op.
   */
  async creditVisit(accountId: string, mapId: string): Promise<void> {
    const set = await this.revealed(accountId);
    if (typeof set === "string") return;
    const progress = await this.progress(set.characterId);
    const credits = set.quests
      .map((q) => ({ questId: q.id, n: secretVisitCredit(q, mapId, progress.get(q.id) ?? 0), count: q.params.count }))
      .filter((c) => c.n > 0);
    const at = this.now();
    const source = `visit:${mapId}:${secretVisitWindow(this.rules, at)}`;
    const writes = secretProgressWrites(this.db, set.characterId, source, credits, at, { sql: "1", args: [] });
    if (writes.length > 0) await this.db.batch(writes);
  }

  /**
   * Hand in materials for a deliver quest, standing in a town. The items leave the inventory and the
   * progress moves in one batch, never past what the quest still needs; idempotent on operationId.
   */
  async deliver(accountId: string, raw: unknown): Promise<SecretResult<DeliverResult>> {
    const parsed = SecretDeliverRequestSchema.safeParse(raw);
    if (!parsed.success) return reject("INVALID_REQUEST", parsed.error.issues.map((i) => i.message).join("; "));
    const { operationId, questId, quantity } = parsed.data;
    const hash = await hashJson({ kind: "secret_deliver", questId, quantity });
    const prior = await this.deliveryRow(accountId, operationId);
    if (prior !== null) {
      return prior.request_hash === hash
        ? { status: "done", replayed: true, result: JSON.parse(prior.result_json) as DeliverResult }
        : reject("PAYLOAD_MISMATCH", "that operation id was used for another request");
    }
    const set = await this.revealed(accountId);
    if (set === "NO_CHARACTER") return reject("NO_CHARACTER", "create a character first");
    if (set === "LOCKED") return reject("LOCKED", "secret quests are not open yet");
    const q = set.quests.find((x) => x.id === questId);
    if (q === undefined) return reject("NO_SUCH_QUEST", `no quest ${questId}`);
    if (q.goal !== "deliver" || q.params.itemId === undefined) return reject("WRONG_GOAL", "this quest does not take items");
    const itemId = q.params.itemId;
    const result: DeliverResult = { questId, itemId, quantity };
    const at = this.now();
    const token = crypto.randomUUID();
    const towns = this.towns.map(() => "?").join(", ");
    const progressNow = `COALESCE((SELECT progress FROM secret_quest_progress WHERE character_id = ? AND quest_id = ?), 0)`;
    const guards = [
      `EXISTS (SELECT 1 FROM player_positions WHERE account_id = ? AND map_id IN (${towns}))`,
      `(SELECT COALESCE(SUM(delta), 0) FROM item_ledger WHERE account_id = ? AND item_id = ?) >= ?`,
      `${progressNow} + ? <= ?`,
    ];
    const args = [accountId, ...this.towns, accountId, itemId, quantity, set.characterId, questId, quantity, q.params.count];
    const ours = `EXISTS (SELECT 1 FROM secret_quest_deliveries WHERE account_id = ? AND operation_id = ? AND token = ?)`;
    const oursArgs = [accountId, operationId, token];
    await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO secret_quest_deliveries (account_id, operation_id, character_id, quest_id, request_hash, token, result_json, created_at)
           SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE ${guards.join(" AND ")} ON CONFLICT DO NOTHING`,
        )
        .bind(accountId, operationId, set.characterId, questId, hash, token, JSON.stringify(result), at, ...args),
      this.db
        .prepare(
          `INSERT INTO item_ledger (operation_id, line_no, account_id, item_id, delta, reason, created_at)
           SELECT ?, 0, ?, ?, ?, 'secret_deliver', ? WHERE ${ours} ON CONFLICT DO NOTHING`,
        )
        .bind(`secret:${accountId}:${operationId}`, accountId, itemId, -quantity, at, ...oursArgs),
      ...secretProgressWrites(this.db, set.characterId, `deliver:${accountId}:${operationId}`, [{ questId, n: quantity, count: q.params.count }], at, { sql: ours, args: oursArgs }),
    ]);
    const row = await this.deliveryRow(accountId, operationId);
    if (row !== null) {
      return row.request_hash === hash
        ? { status: "done", replayed: row.token !== token, result: JSON.parse(row.result_json) as DeliverResult }
        : reject("PAYLOAD_MISMATCH", "that operation id was used for another request");
    }
    const pos = await this.db.prepare(`SELECT map_id FROM player_positions WHERE account_id = ?`).bind(accountId).first<{ map_id: string }>();
    if (pos === null || !this.towns.includes(pos.map_id)) return reject("NOT_IN_TOWN", "hand items in at a town");
    const left = q.params.count - ((await this.progress(set.characterId)).get(questId) ?? 0);
    if (quantity > left) return reject("TOO_MANY", `the quest needs only ${Math.max(0, left)} more`);
    return reject("INSUFFICIENT_ITEMS", `you do not have ${quantity} of ${itemId}`);
  }

  private deliveryRow(accountId: string, operationId: string) {
    return this.db
      .prepare(`SELECT request_hash, token, result_json FROM secret_quest_deliveries WHERE account_id = ? AND operation_id = ?`)
      .bind(accountId, operationId)
      .first<{ request_hash: string; token: string; result_json: string }>();
  }

  /** Claim a finished quest's rewards. The first claim grants; later ones replay it. */
  async claim(accountId: string, raw: unknown): Promise<SecretResult<ClaimResult>> {
    const parsed = SecretClaimRequestSchema.safeParse(raw);
    if (!parsed.success) return reject("INVALID_REQUEST", parsed.error.issues.map((i) => i.message).join("; "));
    const { questId } = parsed.data;
    const set = await this.revealed(accountId);
    if (set === "NO_CHARACTER") return reject("NO_CHARACTER", "create a character first");
    if (set === "LOCKED") return reject("LOCKED", "secret quests are not open yet");
    const prior = await this.claimRow(set.characterId, questId);
    if (prior !== null) return { status: "done", replayed: true, result: JSON.parse(prior.result_json) as ClaimResult };
    const q = set.quests.find((x) => x.id === questId);
    if (q === undefined) return reject("NO_SUCH_QUEST", `no quest ${questId}`);
    if (q.rewards === undefined || q.rewards.length === 0) return reject("NO_REWARD", "this quest was rolled before rewards existed");

    const at = this.now();
    const token = crypto.randomUUID();
    const ch = set.characterId;
    const granted: GrantedReward[] = q.rewards.map((r, i) => {
      const base = { kind: r.kind, rewardId: r.rewardId, variantId: r.variantId };
      if (r.kind === "title") return { ...base, ref: secretTitleId(r) };
      if (r.kind === "companion") return { ...base, ref: `mon:secret:${ch}:${questId}:${i}` };
      if (r.kind === "gear") return { ...base, ref: `eq:secret:${ch}:${questId}:${i}` };
      return { ...base, ref: null };
    });
    const result: ClaimResult = { questId, rewards: granted };
    const ours = `EXISTS (SELECT 1 FROM secret_quest_claims WHERE character_id = ? AND quest_id = ? AND token = ?)`;
    const oursArgs = [ch, questId, token];
    const stmts: SqlBound[] = [
      this.db
        .prepare(
          `INSERT INTO secret_quest_claims (character_id, quest_id, token, result_json, created_at)
           SELECT ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM secret_quest_progress WHERE character_id = ? AND quest_id = ? AND completed_at IS NOT NULL)
           ON CONFLICT DO NOTHING`,
        )
        .bind(ch, questId, token, JSON.stringify(result), at, ch, questId),
    ];
    for (const [i, r] of q.rewards.entries()) {
      const g = granted[i]!;
      stmts.push(
        this.db
          .prepare(
            `INSERT INTO character_secret_rewards (character_id, quest_id, reward_no, kind, reward_id, variant_id, ref, created_at)
             SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE ${ours} ON CONFLICT DO NOTHING`,
          )
          .bind(ch, questId, i, r.kind, r.rewardId, r.variantId, g.ref, at, ...oursArgs),
      );
      const def = this.content.rewards.get(r.rewardId);
      const op = `secret:${ch}:${questId}:${i}`;
      if (r.kind === "companion" && def?.kind === "companion") {
        const sp = this.content.species.get(def.baseSpeciesId);
        if (sp === undefined) throw new Error(`reward ${r.rewardId} names unknown species ${def.baseSpeciesId}`);
        const start = this.rules.provisional.primaryStatStart.value;
        const stats = { STR: start, VIT: start, INT: start, DEX: start, AGI: start, SPI: start };
        stmts.push(
          this.db
            .prepare(
              `INSERT INTO monster_instances
                 (id, species_id, owner_id, current_level, element, primary_stats_json, origin_json, created_operation_id, growth_seed, growth_history_version)
               SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE ${ours} ON CONFLICT DO NOTHING`,
            )
            .bind(
              g.ref,
              sp.id,
              accountId,
              this.rules.confirmed.capturedInitialLevel.value,
              secretCompanionElement(sp, r.variantId),
              JSON.stringify(stats),
              JSON.stringify({ kind: "secret_reward", at, rewardId: r.rewardId, variantId: r.variantId, innateId: r.innateId ?? null }),
              op,
              crypto.randomUUID(),
              COMPANION_GROWTH_VERSION,
              ...oursArgs,
            ),
        );
      } else if (r.kind === "gear" && def?.kind === "gear") {
        if (!this.content.equipment.has(def.baseEquipmentId)) throw new Error(`reward ${r.rewardId} names unknown gear ${def.baseEquipmentId}`);
        // The unique effect is not designed yet (A97): the piece is its base, marked as this reward.
        stmts.push(
          this.db
            .prepare(
              `INSERT INTO equipment_instances (id, definition_id, owner_id, rarity, affixes_json, created_operation_id, created_at)
               SELECT ?, ?, ?, 'COMMON', '[]', ?, ? WHERE ${ours} ON CONFLICT DO NOTHING`,
            )
            .bind(g.ref, def.baseEquipmentId, accountId, op, at, ...oursArgs),
        );
      }
    }
    await this.db.batch(stmts);
    const row = await this.claimRow(ch, questId);
    if (row !== null) return { status: "done", replayed: row.token !== token, result: JSON.parse(row.result_json) as ClaimResult };
    return reject("NOT_DONE", "this quest is not finished yet");
  }

  private claimRow(characterId: string, questId: string) {
    return this.db
      .prepare(`SELECT token, result_json FROM secret_quest_claims WHERE character_id = ? AND quest_id = ?`)
      .bind(characterId, questId)
      .first<{ token: string; result_json: string }>();
  }

  /** DEV ONLY: finish a quest (progress = count) so the claim path can be tried. */
  async devComplete(accountId: string, questId: string): Promise<boolean> {
    const set = await this.revealed(accountId);
    if (typeof set === "string") return false;
    const q = set.quests.find((x) => x.id === questId);
    if (q === undefined) return false;
    const at = this.now();
    await this.db.batch(secretProgressWrites(this.db, set.characterId, `dev:${questId}`, [{ questId, n: q.params.count, count: q.params.count }], at, { sql: "1", args: [] }));
    return true;
  }
}
