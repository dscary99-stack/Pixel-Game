/**
 * Secret quests in D1 (migration 0021; Nut 2026-10-05). The server rolls and keeps each character's
 * set; the client learns nothing about it until it is unlocked.
 *
 * - Seed: HMAC-SHA256(server key, `v1\n<accountId>\n<characterName>`) with WebCrypto. The key is the
 *   Worker secret SECRET_QUEST_KEY; only ENVIRONMENT=dev falls back to a fixed dev key. Elsewhere a
 *   missing key makes the roll throw, so character creation fails loudly instead of using a default.
 * - Write: insert-if-absent on the character id, in the create batch (CharacterStore.create) or, for
 *   characters made before this table, on first read. Replays and races never reroll.
 * - Read: `{ locked: true }` and nothing else until revealed. Only the awakening quest (not built) or
 *   the dev route reveals a set.
 */
import {
  SecretQuestSetSchema,
  rollSecretQuests,
  type Element,
  type RulesConfig,
  type SecretQuestContent,
  type SecretQuestSet,
  type SecretQuestTemplate,
  type SecretQuestView,
} from "@pmrpg/shared";
import type { Environment } from "./battle-room";
import type { SqlBound, SqlDb } from "./reward-ledger";

/** DEV ONLY key; never used outside ENVIRONMENT=dev. */
export const DEV_SECRET_QUEST_KEY = "dev-only-secret-quest-key:not-for-production";

/** The HMAC key for this environment, or null when none is configured outside dev. */
export function secretQuestKey(env: { ENVIRONMENT: Environment; SECRET_QUEST_KEY?: string }): string | null {
  if (env.SECRET_QUEST_KEY !== undefined && env.SECRET_QUEST_KEY !== "") return env.SECRET_QUEST_KEY;
  return env.ENVIRONMENT === "dev" ? DEV_SECRET_QUEST_KEY : null;
}

/** HMAC-SHA256(key, "v1\n" + accountId + "\n" + characterName): 32 seed bytes. */
export async function secretQuestSeed(key: string, accountId: string, characterName: string): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const k = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(`v1\n${accountId}\n${characterName}`)));
}

interface SecretRow {
  character_id: string;
  generator_version: number;
  quests_json: string;
  revealed_at: string | null;
}

export class SecretQuestStore {
  constructor(
    private readonly db: SqlDb,
    private readonly rules: RulesConfig,
    private readonly templates: readonly SecretQuestTemplate[],
    private readonly content: SecretQuestContent,
    private readonly key: string | null,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  /** The character's set. Throws when no key is configured (production without SECRET_QUEST_KEY). */
  async roll(accountId: string, character: { name: string; element: Element; raceId: string }): Promise<SecretQuestSet> {
    if (this.key === null) throw new Error("SECRET_QUEST_KEY is not set: refusing to roll secret quests without the server key");
    const seed = await secretQuestSeed(this.key, accountId, character.name);
    return rollSecretQuests(this.rules, seed, character, this.templates, this.content);
  }

  /**
   * Insert-if-absent for one character's set, only while the character row named by `guard` exists
   * (so a losing create in the same batch writes nothing).
   */
  insert(characterId: string, accountId: string, set: SecretQuestSet, guard: { sql: string; args: unknown[] }): SqlBound {
    return this.db
      .prepare(
        `INSERT INTO character_secret_quests (character_id, account_id, generator_version, quests_json, created_at)
         SELECT ?, ?, ?, ?, ? WHERE ${guard.sql} ON CONFLICT DO NOTHING`,
      )
      .bind(characterId, accountId, set.generatorVersion, JSON.stringify(set.quests), this.now(), ...guard.args);
  }

  /** The stored row, rolling it first for a character made before secret quests existed. */
  private async ensure(accountId: string): Promise<SecretRow | null> {
    const ch = await this.db
      .prepare(`SELECT id, name, element, race_id FROM characters WHERE account_id = ?`)
      .bind(accountId)
      .first<{ id: string; name: string; element: Element; race_id: string }>();
    if (ch === null) return null;
    const stored = await this.row(ch.id);
    if (stored !== null) return stored;
    const set = await this.roll(accountId, { name: ch.name, element: ch.element, raceId: ch.race_id });
    await this.db.batch([
      this.insert(ch.id, accountId, set, { sql: `EXISTS (SELECT 1 FROM characters WHERE id = ? AND account_id = ? AND name = ?)`, args: [ch.id, accountId, ch.name] }),
    ]);
    const row = await this.row(ch.id);
    if (row === null) throw new Error("secret quest insert vanished");
    return row;
  }

  private row(characterId: string): Promise<SecretRow | null> {
    return this.db
      .prepare(`SELECT character_id, generator_version, quests_json, revealed_at FROM character_secret_quests WHERE character_id = ?`)
      .bind(characterId)
      .first<SecretRow>();
  }

  private async toView(row: SecretRow): Promise<SecretQuestView> {
    if (row.revealed_at === null) return { locked: true };
    const set = SecretQuestSetSchema.parse({ generatorVersion: row.generator_version, quests: JSON.parse(row.quests_json) });
    const rows = await this.db
      .prepare(`SELECT quest_id, progress, completed_at FROM secret_quest_progress WHERE character_id = ?`)
      .bind(row.character_id)
      .all<{ quest_id: string; progress: number; completed_at: string | null }>();
    const progress = Object.fromEntries(rows.results.map((r) => [r.quest_id, { progress: r.progress, completed: r.completed_at !== null }]));
    return { locked: false, quests: set.quests, progress };
  }

  /** What the client may see; null when the account has no character. */
  async view(accountId: string): Promise<SecretQuestView | null> {
    const row = await this.ensure(accountId);
    return row === null ? null : this.toView(row);
  }

  /** DEV ONLY: reveal the set (the awakening quest will do this later) and return it. */
  async devReveal(accountId: string): Promise<SecretQuestView | null> {
    const row = await this.ensure(accountId);
    if (row === null) return null;
    await this.db
      .prepare(`UPDATE character_secret_quests SET revealed_at = ? WHERE character_id = ? AND revealed_at IS NULL`)
      .bind(this.now(), row.character_id)
      .run();
    const after = await this.row(row.character_id);
    return after === null ? null : this.toView(after);
  }
}
