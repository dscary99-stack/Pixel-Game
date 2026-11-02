/**
 * Parties on D1 (migration 0010; chapter 08 "Party", P02). Membership is not an economy asset, but
 * the size cap and "one party per account" still hold under races: each join is one INSERT whose
 * WHERE counts the members in the same statement, and account_id is the primary key.
 */
import { JoinPartyRequestSchema, type PartyView, type RulesConfig } from "@pmrpg/shared";
import type { SqlDb } from "./reward-ledger";

export type PartyResult = { status: "ok"; party: PartyView | null } | { status: "rejected"; reason: PartyRejection; message: string };
export type PartyRejection = "INVALID_REQUEST" | "NO_CHARACTER" | "ALREADY_IN_PARTY" | "NO_SUCH_PARTY" | "PARTY_FULL";

export class PartyStore {
  constructor(
    private readonly db: SqlDb,
    private readonly rules: RulesConfig,
    private readonly now: () => string = () => new Date().toISOString(),
    private readonly newId: () => string = () => `pt_${crypto.randomUUID().replace(/-/g, "").slice(0, 10)}`,
  ) {}

  async partyOf(accountId: string): Promise<string | null> {
    const r = await this.db.prepare(`SELECT party_id FROM party_members WHERE account_id = ?`).bind(accountId).first<{ party_id: string }>();
    return r?.party_id ?? null;
  }

  async view(accountId: string): Promise<PartyView | null> {
    const partyId = await this.partyOf(accountId);
    if (partyId === null) return null;
    const { results } = await this.db
      .prepare(
        `SELECT m.account_id, c.name, p.map_id, p.channel FROM party_members m
         LEFT JOIN characters c ON c.account_id = m.account_id
         LEFT JOIN player_positions p ON p.account_id = m.account_id
         WHERE m.party_id = ? ORDER BY m.joined_at, m.account_id`,
      )
      .bind(partyId)
      .all<{ account_id: string; name: string | null; map_id: string | null; channel: number | null }>();
    return { partyId, members: results.map((r) => ({ accountId: r.account_id, name: r.name ?? r.account_id, mapId: r.map_id, channel: r.channel })) };
  }

  /** Start a party with only the caller. Already in one: that party is returned unchanged. */
  async create(accountId: string): Promise<PartyResult> {
    if ((await this.partyOf(accountId)) !== null) return { status: "ok", party: await this.view(accountId) };
    if (!(await this.hasCharacter(accountId))) return reject("NO_CHARACTER", "create a character first");
    const id = this.newId();
    const at = this.now();
    await this.db.batch([
      this.db.prepare(`INSERT INTO parties (id, created_by, created_at) SELECT ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM party_members WHERE account_id = ?)`).bind(id, accountId, at, accountId),
      this.db
        .prepare(`INSERT INTO party_members (account_id, party_id, joined_at) SELECT ?, ?, ? WHERE EXISTS (SELECT 1 FROM parties WHERE id = ?) ON CONFLICT DO NOTHING`)
        .bind(accountId, id, at, id),
    ]);
    await this.dropEmpty(id);
    return { status: "ok", party: await this.view(accountId) };
  }

  async join(accountId: string, raw: unknown): Promise<PartyResult> {
    const parsed = JoinPartyRequestSchema.safeParse(raw);
    if (!parsed.success) return reject("INVALID_REQUEST", "expected { partyId }");
    const { partyId } = parsed.data;
    const current = await this.partyOf(accountId);
    if (current === partyId) return { status: "ok", party: await this.view(accountId) };
    if (current !== null) return reject("ALREADY_IN_PARTY", "leave your party first");
    if (!(await this.hasCharacter(accountId))) return reject("NO_CHARACTER", "create a character first");
    await this.db
      .prepare(
        `INSERT INTO party_members (account_id, party_id, joined_at)
         SELECT ?, ?, ? WHERE EXISTS (SELECT 1 FROM parties WHERE id = ?)
           AND (SELECT COUNT(*) FROM party_members WHERE party_id = ?) < ?
         ON CONFLICT DO NOTHING`,
      )
      .bind(accountId, partyId, this.now(), partyId, partyId, this.rules.confirmed.partyMaxMembers.value)
      .run();
    const after = await this.partyOf(accountId);
    if (after === partyId) return { status: "ok", party: await this.view(accountId) };
    if (after !== null) return reject("ALREADY_IN_PARTY", "leave your party first");
    const exists = await this.db.prepare(`SELECT 1 AS x FROM parties WHERE id = ?`).bind(partyId).first();
    return exists === null ? reject("NO_SUCH_PARTY", "no party with that code") : reject("PARTY_FULL", "that party is full");
  }

  async leave(accountId: string): Promise<PartyResult> {
    const partyId = await this.partyOf(accountId);
    if (partyId === null) return { status: "ok", party: null };
    await this.db.prepare(`DELETE FROM party_members WHERE account_id = ? AND party_id = ?`).bind(accountId, partyId).run();
    await this.dropEmpty(partyId);
    return { status: "ok", party: null };
  }

  /** Partners of this account (not including it), for the bonus count at fight start. */
  async partners(accountId: string): Promise<string[]> {
    const { results } = await this.db
      .prepare(
        `SELECT m.account_id FROM party_members m
         WHERE m.party_id = (SELECT party_id FROM party_members WHERE account_id = ?) AND m.account_id <> ?`,
      )
      .bind(accountId, accountId)
      .all<{ account_id: string }>();
    return results.map((r) => r.account_id);
  }

  /** Which of these accounts started a fight at or after `since` (ISO time). */
  async recentlyFought(accountIds: string[], since: string): Promise<Set<string>> {
    if (accountIds.length === 0) return new Set();
    const { results } = await this.db
      .prepare(
        `SELECT DISTINCT account_id FROM encounter_claims
         WHERE account_id IN (${accountIds.map(() => "?").join(", ")}) AND created_at >= ?`,
      )
      .bind(...accountIds, since)
      .all<{ account_id: string }>();
    return new Set(results.map((r) => r.account_id));
  }

  private async dropEmpty(partyId: string): Promise<void> {
    await this.db.prepare(`DELETE FROM parties WHERE id = ? AND NOT EXISTS (SELECT 1 FROM party_members WHERE party_id = ?)`).bind(partyId, partyId).run();
  }

  private async hasCharacter(accountId: string): Promise<boolean> {
    return (await this.db.prepare(`SELECT 1 AS x FROM characters WHERE account_id = ?`).bind(accountId).first()) !== null;
  }
}

const reject = (reason: PartyRejection, message: string): PartyResult => ({ status: "rejected", reason, message });
