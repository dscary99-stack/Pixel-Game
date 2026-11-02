/**
 * NPC Orders on D1 (chapter 09; migration 0019). A fill takes the wanted materials and pays the
 * announced reward in one batch, standing in the order's town, at most `weeklyLimit` times per quest
 * week. Each fill carries an operationId: a retry replays, the same id with another order is refused.
 */
import { FillOrderRequestSchema, questPeriod, type NpcOrder, type RulesConfig } from "@pmrpg/shared";
import { hashJson, type SqlBound, type SqlDb } from "./reward-ledger";

export type OrderRejection = "INVALID_REQUEST" | "NO_SUCH_ORDER" | "PAYLOAD_MISMATCH" | "NOT_IN_TOWN" | "ORDER_LIMIT" | "INSUFFICIENT_ITEMS";
export interface FillResult {
  orderId: string;
  periodId: string;
  took: { itemId: string; quantity: number }[];
  reward: NpcOrder["reward"];
}
export type OrderResult = { status: "done"; replayed: boolean; result: FillResult } | { status: "rejected"; reason: OrderRejection; message: string };
export interface OrderView {
  order: NpcOrder;
  filled: number;
  left: number;
}

const reject = (reason: OrderRejection, message: string) => ({ status: "rejected" as const, reason, message });

export class NpcOrderStore {
  constructor(
    private readonly db: SqlDb,
    private readonly rules: RulesConfig,
    private readonly orders: ReadonlyMap<string, NpcOrder>,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  /** This week's orders with how many fills are left. */
  async view(accountId: string): Promise<{ periodId: string; endsAt: string; orders: OrderView[] }> {
    const period = questPeriod(this.rules, "weekly", this.now());
    const rows = await this.db
      .prepare(`SELECT order_id, COUNT(*) AS n FROM npc_order_fills WHERE account_id = ? AND period_id = ? GROUP BY order_id`)
      .bind(accountId, period.id)
      .all<{ order_id: string; n: number }>();
    const filled = new Map(rows.results.map((r) => [r.order_id, r.n]));
    return {
      periodId: period.id,
      endsAt: period.endsAt,
      orders: [...this.orders.values()].map((order) => {
        const n = filled.get(order.id) ?? 0;
        return { order, filled: n, left: Math.max(0, order.weeklyLimit - n) };
      }),
    };
  }

  async fill(accountId: string, raw: unknown): Promise<OrderResult> {
    const parsed = FillOrderRequestSchema.safeParse(raw);
    if (!parsed.success) return reject("INVALID_REQUEST", parsed.error.issues.map((i) => i.message).join("; "));
    const { operationId, orderId } = parsed.data;
    const hash = await hashJson({ kind: "npc_order", orderId });
    const prior = await this.row(accountId, operationId);
    if (prior !== null) {
      return prior.request_hash === hash
        ? { status: "done", replayed: true, result: JSON.parse(prior.result_json) as FillResult }
        : reject("PAYLOAD_MISMATCH", "that operation id was used for another request");
    }
    const order = this.orders.get(orderId);
    if (order === undefined) return reject("NO_SUCH_ORDER", `no order ${orderId}`);
    const at = this.now();
    const period = questPeriod(this.rules, "weekly", at);
    const result: FillResult = { orderId, periodId: period.id, took: order.wants, reward: order.reward };

    const guards = [
      `EXISTS (SELECT 1 FROM player_positions WHERE account_id = ? AND map_id = ?)`,
      `(SELECT COUNT(*) FROM npc_order_fills WHERE account_id = ? AND period_id = ? AND order_id = ?) < ?`,
      ...order.wants.map(() => `(SELECT COALESCE(SUM(delta), 0) FROM item_ledger WHERE account_id = ? AND item_id = ?) >= ?`),
    ];
    const args: unknown[] = [accountId, order.mapId, accountId, period.id, orderId, order.weeklyLimit, ...order.wants.flatMap((w) => [accountId, w.itemId, w.quantity])];
    const token = crypto.randomUUID();
    const ours = `EXISTS (SELECT 1 FROM npc_order_fills WHERE account_id = ? AND operation_id = ? AND token = ?)`;
    const oursArgs = [accountId, operationId, token];
    const ledgerId = `order:${accountId}:${operationId}`;
    const lines = [...order.wants.map((w) => ({ itemId: w.itemId, delta: -w.quantity })), ...order.reward.items.map((r) => ({ itemId: r.itemId, delta: r.quantity }))];
    const stmts: SqlBound[] = [
      this.db
        .prepare(
          `INSERT INTO npc_order_fills (account_id, operation_id, period_id, order_id, request_hash, token, result_json, created_at)
           SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE ${guards.join(" AND ")} ON CONFLICT DO NOTHING`,
        )
        .bind(accountId, operationId, period.id, orderId, hash, token, JSON.stringify(result), at, ...args),
      ...lines.map((l, n) =>
        this.db
          .prepare(
            `INSERT INTO item_ledger (operation_id, line_no, account_id, item_id, delta, reason, created_at)
             SELECT ?, ?, ?, ?, ?, 'npc_order', ? WHERE ${ours} ON CONFLICT DO NOTHING`,
          )
          .bind(ledgerId, n, accountId, l.itemId, l.delta, at, ...oursArgs),
      ),
    ];
    if (order.reward.coins > 0) {
      stmts.push(
        this.db
          .prepare(
            `INSERT INTO coin_ledger (operation_id, line_no, account_id, delta, reason, created_at)
             SELECT ?, 0, ?, ?, 'npc_order', ? WHERE ${ours} ON CONFLICT DO NOTHING`,
          )
          .bind(ledgerId, accountId, order.reward.coins, at, ...oursArgs),
      );
    }
    await this.db.batch(stmts);

    const row = await this.row(accountId, operationId);
    if (row !== null) {
      return row.request_hash === hash
        ? { status: "done", replayed: row.token !== token, result: JSON.parse(row.result_json) as FillResult }
        : reject("PAYLOAD_MISMATCH", "that operation id was used for another request");
    }
    const pos = await this.db.prepare(`SELECT map_id FROM player_positions WHERE account_id = ?`).bind(accountId).first<{ map_id: string }>();
    if (pos?.map_id !== order.mapId) return reject("NOT_IN_TOWN", `${order.npc.th} is in another town`);
    const used = await this.db
      .prepare(`SELECT COUNT(*) AS n FROM npc_order_fills WHERE account_id = ? AND period_id = ? AND order_id = ?`)
      .bind(accountId, period.id, orderId)
      .first<{ n: number }>();
    if ((used?.n ?? 0) >= order.weeklyLimit) return reject("ORDER_LIMIT", `this order takes ${order.weeklyLimit} a week`);
    return reject("INSUFFICIENT_ITEMS", "you do not have everything the order wants");
  }

  private row(accountId: string, operationId: string) {
    return this.db
      .prepare(`SELECT request_hash, token, result_json FROM npc_order_fills WHERE account_id = ? AND operation_id = ?`)
      .bind(accountId, operationId)
      .first<{ request_hash: string; token: string; result_json: string }>();
  }
}
