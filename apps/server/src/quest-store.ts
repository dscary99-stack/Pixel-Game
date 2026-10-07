/**
 * Daily / Weekly quests on D1 (chapter 09, P13; migration 0017).
 *
 * A board is rolled once per character and period (first look) and stored. Progress is summed from
 * quest_activity inside the period's window. A claim inserts one quest_claims row keyed by period
 * and slot, guarded by the daily limit (and, for deliveries, the town and the bag); the rest of the
 * batch applies only under that row's token, so a retry or a racing claim pays once.
 */
import {
  QuestClaimRequestSchema,
  Rng,
  expCap,
  levelForExp,
  questPeriod,
  rollQuestBoard,
  seedRng,
  type QuestBoard,
  type QuestBoardView,
  type QuestCadence,
  type QuestContent,
  type QuestGoal,
  type QuestReward,
  type RulesConfig,
} from "@pmrpg/shared";
import type { SqlBound, SqlDb } from "./reward-ledger";

export type QuestRejection = "INVALID_REQUEST" | "NO_CHARACTER" | "NO_SUCH_QUEST" | "EXPIRED" | "UNRESOLVED_RULE" | "NOT_DONE" | "CLAIM_LIMIT" | "NOT_IN_TOWN" | "INSUFFICIENT_ITEMS";
export type QuestClaimResult =
  | { status: "done"; replayed: boolean; result: { periodId: string; slot: number | "main"; reward: QuestReward; delivered?: { itemId: string; quantity: number } } }
  | { status: "rejected"; reason: QuestRejection; message: string };

const reject = (reason: QuestRejection, message: string) => ({ status: "rejected" as const, reason, message });
const marks = (n: number) => Array.from({ length: n }, () => "?").join(", ");

export class QuestStore {
  constructor(
    private readonly db: SqlDb,
    private readonly rules: RulesConfig,
    private readonly content: QuestContent,
    private readonly townMapIds: readonly string[],
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  /** Today's and this week's boards with progress; null without a character. */
  async view(accountId: string): Promise<{ daily: QuestBoardView; weekly: QuestBoardView } | null> {
    const at = this.now();
    const daily = await this.boardView(accountId, "daily", at);
    const weekly = await this.boardView(accountId, "weekly", at);
    return daily === null || weekly === null ? null : { daily, weekly };
  }

  async claim(accountId: string, raw: unknown): Promise<QuestClaimResult> {
    const parsed = QuestClaimRequestSchema.safeParse(raw);
    if (!parsed.success) return reject("INVALID_REQUEST", parsed.error.issues.map((i) => i.message).join("; "));
    const { periodId, slot } = parsed.data;
    const cadence: QuestCadence = periodId.startsWith("d:") ? "daily" : "weekly";
    if ((cadence === "daily") !== (slot !== "main")) return reject("INVALID_REQUEST", cadence === "daily" ? "daily rewards are claimed per quest" : "the weekly reward is claimed as main");

    const prior = await this.claimRow(accountId, periodId, String(slot));
    if (prior !== null) return { status: "done", replayed: true, result: JSON.parse(prior.reward_json) };
    const at = this.now();
    const period = questPeriod(this.rules, cadence, at);
    if (period.id !== periodId) {
      // An unclaimed reward of an ended day or week is gone (weekly: Nut 2026-10-07).
      return reject("EXPIRED", "that quest period is over; its unclaimed rewards are gone");
    }
    const board = await this.storedBoard(accountId, periodId);
    if (board === null) return reject("NO_SUCH_QUEST", "open the quest board first");

    const q = this.rules.provisional.quests.value;
    const guards: string[] = [];
    const args: unknown[] = [];
    let delivered: { itemId: string; quantity: number } | undefined;
    if (slot === "main") {
      let done = 0;
      for (const g of board.goals) if ((await this.progress(accountId, g, period)) >= g.count) done += 1;
      if (done < q.weeklyMainNeeds) return reject("NOT_DONE", `finish ${q.weeklyMainNeeds} of this week's quests first (${done} done)`);
    } else {
      const goal = board.goals[slot];
      if (goal === undefined) return reject("NO_SUCH_QUEST", "no such quest on today's board");
      if (goal.kind === "deliver") {
        delivered = { itemId: goal.itemId, quantity: goal.count };
        guards.push(this.inTown(), `(SELECT COALESCE(SUM(delta), 0) FROM item_ledger WHERE account_id = ? AND item_id = ?) >= ?`);
        args.push(accountId, ...this.townMapIds, accountId, goal.itemId, goal.count);
      } else if ((await this.progress(accountId, goal, period)) < goal.count) {
        return reject("NOT_DONE", "that quest is not finished yet");
      }
      guards.push(`(SELECT COUNT(*) FROM quest_claims WHERE account_id = ? AND period_id = ?) < ?`);
      args.push(accountId, periodId, q.dailyClaims);
    }

    const result = { periodId, slot, reward: board.reward, ...(delivered === undefined ? {} : { delivered }) };
    const token = crypto.randomUUID();
    const opId = `quest:${accountId}:${periodId}:${slot}`;
    const ours = `EXISTS (SELECT 1 FROM quest_claims WHERE account_id = ? AND period_id = ? AND slot = ? AND token = ?)`;
    const oursArgs = [accountId, periodId, String(slot), token];
    const stmts: SqlBound[] = [
      this.db
        .prepare(
          `INSERT INTO quest_claims (account_id, period_id, slot, token, reward_json, created_at)
           SELECT ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM characters WHERE account_id = ?)${guards.map((g) => ` AND ${g}`).join("")}
           ON CONFLICT DO NOTHING`,
        )
        .bind(accountId, periodId, String(slot), token, JSON.stringify(result), at, accountId, ...args),
    ];
    if (board.reward.coins > 0) {
      stmts.push(
        this.db
          .prepare(`INSERT INTO coin_ledger (operation_id, line_no, account_id, delta, reason, created_at) SELECT ?, 0, ?, ?, 'quest', ? WHERE ${ours} ON CONFLICT DO NOTHING`)
          .bind(opId, accountId, board.reward.coins, at, ...oursArgs),
      );
    }
    const lines = [...board.reward.items.map((i) => ({ itemId: i.itemId, delta: i.quantity })), ...(delivered === undefined ? [] : [{ itemId: delivered.itemId, delta: -delivered.quantity }])];
    lines.forEach((l, n) =>
      stmts.push(
        this.db
          .prepare(
            `INSERT INTO item_ledger (operation_id, line_no, account_id, item_id, delta, reason, created_at) SELECT ?, ?, ?, ?, ?, 'quest', ? WHERE ${ours} ON CONFLICT DO NOTHING`,
          )
          .bind(opId, n, accountId, l.itemId, l.delta, at, ...oursArgs),
      ),
    );
    if (board.reward.exp > 0) {
      stmts.push(
        this.db
          .prepare(`UPDATE characters SET xp = MIN(xp + ?, ?) WHERE account_id = ? AND ${ours}`)
          .bind(board.reward.exp, expCap(this.rules, "player"), accountId, ...oursArgs),
      );
    }
    await this.db.batch(stmts);

    const row = await this.claimRow(accountId, periodId, String(slot));
    if (row !== null) return { status: "done", replayed: row.token !== token, result: JSON.parse(row.reward_json) };
    if (delivered !== undefined) {
      const pos = await this.db.prepare(`SELECT map_id FROM player_positions WHERE account_id = ?`).bind(accountId).first<{ map_id: string }>();
      if (pos === null || !this.townMapIds.includes(pos.map_id)) return reject("NOT_IN_TOWN", "hand deliveries in at a town board");
      const have = await this.db
        .prepare(`SELECT COALESCE(SUM(delta), 0) AS q FROM item_ledger WHERE account_id = ? AND item_id = ?`)
        .bind(accountId, delivered.itemId)
        .first<{ q: number }>();
      if ((have?.q ?? 0) < delivered.quantity) return reject("INSUFFICIENT_ITEMS", `needs ${delivered.quantity} ${delivered.itemId}`);
    }
    return reject("CLAIM_LIMIT", `only ${q.dailyClaims} daily rewards a day`);
  }

  // ------------------------------------------------------------------ helpers

  private async boardView(accountId: string, cadence: QuestCadence, at: string): Promise<QuestBoardView | null> {
    const period = questPeriod(this.rules, cadence, at);
    let board = await this.storedBoard(accountId, period.id);
    if (board === null) {
      const ch = await this.db.prepare(`SELECT xp FROM characters WHERE account_id = ?`).bind(accountId).first<{ xp: number }>();
      if (ch === null) return null;
      const level = levelForExp(this.rules, "player", ch.xp);
      const rolled = rollQuestBoard(this.rules, this.content, cadence, period.id, level, new Rng(seedRng(crypto.randomUUID())));
      // First look wins: a racing look keeps whichever board landed first.
      await this.db
        .prepare(`INSERT INTO quest_boards (account_id, period_id, board_json, created_at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING`)
        .bind(accountId, period.id, JSON.stringify(rolled), at)
        .run();
      board = (await this.storedBoard(accountId, period.id))!;
    }
    const claims = await this.db
      .prepare(`SELECT slot FROM quest_claims WHERE account_id = ? AND period_id = ?`)
      .bind(accountId, period.id)
      .all<{ slot: string }>();
    const claimed = new Set(claims.results.map((c) => c.slot));
    const goals = [];
    for (const [i, g] of board.goals.entries()) {
      // A handed-in delivery stays done though the bag is lighter now.
      const isClaimed = claimed.has(String(i));
      const progress = isClaimed && g.kind === "deliver" ? g.count : Math.min(g.count, await this.progress(accountId, g, period));
      goals.push({ goal: g, progress, done: progress >= g.count, claimed: isClaimed });
    }
    const q = this.rules.provisional.quests.value;
    return cadence === "daily"
      ? { cadence, period, level: board.level, reward: board.reward, goals, claimsLeft: Math.max(0, q.dailyClaims - claimed.size) }
      : { cadence, period, level: board.level, reward: board.reward, goals, claimsLeft: claimed.has("main") ? 0 : 1, needs: q.weeklyMainNeeds };
  }

  /** Progress inside the period's window; a delivery shows what the bag holds now. */
  private async progress(accountId: string, g: QuestGoal, period: { startsAt: string; endsAt: string }): Promise<number> {
    if (g.kind === "deliver") {
      const r = await this.db
        .prepare(`SELECT COALESCE(SUM(delta), 0) AS q FROM item_ledger WHERE account_id = ? AND item_id = ?`)
        .bind(accountId, g.itemId)
        .first<{ q: number }>();
      return r?.q ?? 0;
    }
    const kind = g.kind === "craft" ? "craft" : g.kind === "capture" ? "capture" : "kill";
    const subjects = g.kind === "craft" ? [g.profession] : g.speciesIds;
    const r = await this.db
      .prepare(
        `SELECT COALESCE(SUM(quantity), 0) AS n FROM quest_activity
         WHERE account_id = ? AND kind = ? AND subject IN (${marks(subjects.length)}) AND at >= ? AND at < ?`,
      )
      .bind(accountId, kind, ...subjects, period.startsAt, period.endsAt)
      .first<{ n: number }>();
    return r?.n ?? 0;
  }

  private async storedBoard(accountId: string, periodId: string): Promise<QuestBoard | null> {
    const r = await this.db.prepare(`SELECT board_json FROM quest_boards WHERE account_id = ? AND period_id = ?`).bind(accountId, periodId).first<{ board_json: string }>();
    return r === null ? null : (JSON.parse(r.board_json) as QuestBoard);
  }

  private claimRow(accountId: string, periodId: string, slot: string) {
    return this.db
      .prepare(`SELECT token, reward_json FROM quest_claims WHERE account_id = ? AND period_id = ? AND slot = ?`)
      .bind(accountId, periodId, slot)
      .first<{ token: string; reward_json: string }>();
  }

  private inTown(): string {
    return this.townMapIds.length === 0
      ? "0"
      : `EXISTS (SELECT 1 FROM player_positions WHERE account_id = ? AND map_id IN (${marks(this.townMapIds.length)}))`;
  }
}
