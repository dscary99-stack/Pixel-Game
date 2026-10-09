/**
 * Mailbox (mail.ts in shared, Nut 2026-10-09). Letters sit per character; a claim takes everything in
 * the chosen letters at once. Like the vault, the claim anchor (mail_operations) is inserted only when
 * every guard holds and every other write applies only under its token, so two claims of one letter
 * at once get one winner and a retried claim replays its first answer. Ledger lines are keyed by the
 * letter, so a letter can never pay twice whatever the request.
 */
import {
  MailClaimRequestSchema,
  equipmentName,
  itemName,
  type MailLetter,
  type MailPayload,
  type MailSource,
  type MailView,
  type RulesConfig,
} from "@pmrpg/shared";
import { ExchangeBase, OPEN_BATTLE, issues, marks, reject, type ExchangeContent, type ExchangeResult } from "./exchange-store";
import { hashJson, type SqlBound, type SqlDb } from "./reward-ledger";
import { mailInsert, type NewLetter } from "./mail-insert";

export { mailInsert, type NewLetter };

interface MailRow {
  id: string;
  source: MailSource;
  title_th: string;
  body_th: string;
  payload_json: string;
  companions: number;
  has_assets: number;
  created_at: string;
  expires_at: string;
  claimed_at: string | null;
}

export interface MailClaimResult {
  mailIds: string[];
  items: Record<string, number>;
  coins: number;
  equipmentIds: string[];
  companionIds: string[];
}

export class MailStore extends ExchangeBase {
  protected override readonly opsTable = "mail_operations";

  constructor(db: SqlDb, rules: RulesConfig, content: ExchangeContent, now: () => string = () => new Date().toISOString()) {
    super(db, rules, content, [], async () => {}, now);
  }

  /** Put a letter in a mailbox now (system / GM mail; dev route and tests). */
  async send(l: NewLetter): Promise<void> {
    await mailInsert(this.db, this.rules, l, this.now()).run();
  }

  async view(accountId: string): Promise<MailView | null> {
    if ((await this.character(accountId)) === null) return null;
    const at = this.now();
    const { results } = await this.db
      .prepare(`SELECT * FROM mail WHERE account_id = ? AND (claimed_at IS NOT NULL OR expires_at > ?) ORDER BY created_at DESC, id DESC LIMIT ?`)
      .bind(accountId, at, this.rules.provisional.mail.value.listLimit)
      .all<MailRow>();
    return {
      letters: results.map((r) => this.letter(r)),
      unclaimed: results.filter((r) => r.claimed_at === null && r.has_assets === 1).length,
      keepDays: this.rules.provisional.mail.value.keepDays,
    };
  }

  private letter(r: MailRow): MailLetter {
    const p = JSON.parse(r.payload_json) as MailPayload;
    return {
      mailId: r.id,
      source: r.source,
      title: r.title_th,
      body: r.body_th,
      createdAt: r.created_at,
      expiresAt: r.expires_at,
      claimedAt: r.claimed_at,
      items: Object.entries(p.items).map(([itemId, quantity]) => ({ itemId, name: itemName(this.content.items, itemId), quantity })),
      coins: p.coins,
      equipment: p.equipment.map((e) => ({ definitionId: e.definitionId, name: equipmentName(this.content.equipment, e.definitionId), rarity: e.rarity })),
      companions: p.companions.map((c) => ({ speciesId: c.speciesId, name: this.content.species.get(c.speciesId)?.name.th ?? c.speciesId, level: c.level })),
    };
  }

  /** Take everything out of these letters (anywhere, not during a fight). */
  async claim(accountId: string, raw: unknown): Promise<ExchangeResult<MailClaimResult>> {
    const parsed = MailClaimRequestSchema.safeParse(raw);
    if (!parsed.success) return reject("INVALID_REQUEST", issues(parsed.error));
    const { operationId, mailIds } = parsed.data;
    const hash = await hashJson({ kind: "mail_claim", mailIds: [...mailIds].sort() });
    const prior = await this.prior<MailClaimResult>(accountId, operationId, hash);
    if (prior !== null) return prior;
    if ((await this.character(accountId)) === null) return reject("NO_CHARACTER", "create a character first");
    if (await this.fighting(accountId)) return reject("IN_BATTLE", "finish your fight first");

    const at = this.now();
    const { results: rows } = await this.db.prepare(`SELECT * FROM mail WHERE account_id = ? AND id IN (${marks(mailIds.length)})`).bind(accountId, ...mailIds).all<MailRow>();
    for (const id of mailIds) {
      const r = rows.find((x) => x.id === id);
      if (r === undefined) return reject("NOT_FOUND", "no such letter");
      if (r.claimed_at !== null) return reject("CLOSED", "that letter was already claimed");
      if (r.expires_at <= at) return reject("EXPIRED", "that letter has expired");
    }
    const letters = mailIds.map((id) => ({ id, p: JSON.parse(rows.find((x) => x.id === id)!.payload_json) as MailPayload }));
    for (const { p } of letters) {
      for (const e of p.equipment) if (!this.content.equipment.has(e.definitionId)) return reject("NOT_FOUND", `unknown piece ${e.definitionId}`);
      for (const c of p.companions) if (!this.content.species.has(c.speciesId)) return reject("NOT_FOUND", `unknown species ${c.speciesId}`);
    }
    const pets = letters.reduce((n, l) => n + l.p.companions.length, 0);
    const box = await this.boxIssue(accountId, pets);
    if (box !== null) return box;

    const result: MailClaimResult = { mailIds, items: {}, coins: 0, equipmentIds: [], companionIds: [] };
    for (const { p } of letters) {
      for (const [id, n] of Object.entries(p.items)) result.items[id] = (result.items[id] ?? 0) + n;
      result.coins += p.coins;
      result.equipmentIds.push(...p.equipment.map((e) => e.id));
      result.companionIds.push(...p.companions.map((c) => c.id));
    }
    const guards = [`NOT ${OPEN_BATTLE}`, `(SELECT COUNT(*) FROM mail WHERE account_id = ? AND claimed_at IS NULL AND expires_at > ? AND id IN (${marks(mailIds.length)})) = ?`];
    const args: unknown[] = [accountId, accountId, at, ...mailIds, mailIds.length];
    if (pets > 0) {
      const g = this.boxGuard(accountId, pets);
      guards.push(g.sql);
      args.push(...g.args);
    }
    const token = crypto.randomUUID();
    const ours = this.ours(accountId, operationId, token);
    const stmts: SqlBound[] = [this.anchor(accountId, operationId, "mail_claim", hash, token, result, guards, args)];
    for (const { id, p } of letters) {
      Object.entries(p.items).forEach(([itemId, n], i) => {
        if (n <= 0) return;
        stmts.push(
          this.db
            .prepare(`INSERT INTO item_ledger (operation_id, line_no, account_id, item_id, delta, reason, created_at) SELECT ?, ?, ?, ?, ?, 'mail', ? WHERE ${ours.sql} ON CONFLICT DO NOTHING`)
            .bind(id, i, accountId, itemId, n, at, ...ours.args),
        );
      });
      if (p.coins > 0) {
        stmts.push(
          this.db
            .prepare(`INSERT INTO coin_ledger (operation_id, line_no, account_id, delta, reason, created_at) SELECT ?, 0, ?, ?, 'mail', ? WHERE ${ours.sql} ON CONFLICT DO NOTHING`)
            .bind(id, accountId, p.coins, at, ...ours.args),
        );
      }
      for (const e of p.equipment) {
        stmts.push(
          this.db
            .prepare(
              `INSERT INTO equipment_instances (id, definition_id, owner_id, rarity, affixes_json, created_operation_id, created_at, no_sell, no_trade, no_store)
               SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE ${ours.sql} ON CONFLICT DO NOTHING`,
            )
            .bind(e.id, e.definitionId, accountId, e.rarity, JSON.stringify(e.affixes), id, at, e.noSell ? 1 : 0, e.noTrade ? 1 : 0, e.noStore ? 1 : 0, ...ours.args),
        );
      }
      for (const c of p.companions) {
        stmts.push(
          this.db
            .prepare(
              `INSERT INTO monster_instances
                 (id, species_id, owner_id, current_level, element, primary_stats_json, origin_json, created_operation_id, growth_seed, growth_history_version, no_sell, no_trade)
               SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE ${ours.sql} ON CONFLICT DO NOTHING`,
            )
            .bind(c.id, c.speciesId, accountId, c.level, c.element, JSON.stringify(c.primaryStats), JSON.stringify(c.origin), id, c.growthSeed, c.growthVersion, c.noSell ? 1 : 0, c.noTrade ? 1 : 0, ...ours.args),
        );
      }
      stmts.push(this.db.prepare(`UPDATE mail SET claimed_at = ?, claim_op = ? WHERE id = ? AND account_id = ? AND claimed_at IS NULL AND ${ours.sql}`).bind(at, operationId, id, accountId, ...ours.args));
    }
    await this.db.batch(stmts);
    return this.outcome(accountId, operationId, hash, token, async () => {
      if (await this.fighting(accountId)) return reject("IN_BATTLE", "finish your fight first");
      return (await this.boxIssue(accountId, pets)) ?? reject("CLOSED", "a letter was claimed meanwhile; look again");
    });
  }
}
