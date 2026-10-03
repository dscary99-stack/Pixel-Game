/**
 * Encounter claims in D1 (migration 0004). Keys a private fight on (player, pack instance) so the
 * same pack can never give one player two fights, while other players keep their own (O05).
 */
import { hashJson, type SqlDb } from "./reward-ledger";
import type { PackMember } from "@pmrpg/shared";

export class EncounterStore {
  constructor(
    private readonly db: SqlDb,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  /** Deterministic battle id for a (player, pack instance); short enough for the battle routes. */
  static async battleIdFor(accountId: string, packInstanceId: string): Promise<string> {
    return `battle:enc_${(await hashJson({ accountId, packInstanceId })).slice(0, 32)}`;
  }

  /**
   * Claim the fight for this pack. Idempotent: a repeat returns the stored battle and roster, so a
   * retry after a crash continues the same fight instead of rolling a new one.
   */
  async claim(accountId: string, packInstanceId: string, roster: PackMember[]): Promise<{ battleId: string; roster: PackMember[] }> {
    const battleId = await EncounterStore.battleIdFor(accountId, packInstanceId);
    await this.db
      .prepare(
        `INSERT INTO encounter_claims (account_id, pack_instance_id, battle_id, roster_json, created_at)
         VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
      )
      .bind(accountId, packInstanceId, battleId, JSON.stringify(roster), this.now())
      .run();
    const row = await this.db
      .prepare(`SELECT battle_id, roster_json FROM encounter_claims WHERE account_id = ? AND pack_instance_id = ?`)
      .bind(accountId, packInstanceId)
      .first<{ battle_id: string; roster_json: string }>();
    if (row === null) throw new Error("encounter claim vanished");
    return { battleId: row.battle_id, roster: JSON.parse(row.roster_json) as PackMember[] };
  }

  /**
   * Which of these pack instances this player already fought. A claim only counts once its battle
   * holds a reservation; a claim left behind by a failed start can be engaged again (same battle).
   */
  async fought(accountId: string, packInstanceIds: string[]): Promise<Set<string>> {
    if (packInstanceIds.length === 0) return new Set();
    const marks = packInstanceIds.map(() => "?").join(", ");
    const { results } = await this.db
      .prepare(
        `SELECT c.pack_instance_id FROM encounter_claims c
         JOIN battle_reservations r ON r.battle_id = c.battle_id
         WHERE c.account_id = ? AND c.pack_instance_id IN (${marks})`,
      )
      .bind(accountId, ...packInstanceIds)
      .all<{ pack_instance_id: string }>();
    return new Set(results.map((r) => r.pack_instance_id));
  }

  /** The battle holding this account's open reservation, if any (one at a time, migration 0001). */
  async openBattle(accountId: string): Promise<string | null> {
    const row = await this.db
      .prepare(`SELECT battle_id FROM battle_reservations WHERE account_id = ? AND status IN ('reserved', 'active')`)
      .bind(accountId)
      .first<{ battle_id: string }>();
    return row?.battle_id ?? null;
  }
}
