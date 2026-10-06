/**
 * Collection / Journal on D1 (chapter 09; migration 0018). Read-only view built from what the server
 * already records, plus the two journal-only facts: species met in fights and maps entered. The
 * chosen title is cosmetic and must be one the journal says was earned.
 */
import {
  TitleRequestSchema,
  bondTier,
  earnedTitles,
  levelForExp,
  type Element,
  type ItemDefinition,
  type JournalSpecies,
  type JournalSummary,
  type RulesConfig,
  type SpeciesDefinition,
} from "@pmrpg/shared";
import type { SqlDb } from "./reward-ledger";

export interface JournalView extends JournalSummary {
  titles: string[];
  titleId: string | null;
}

export class JournalStore {
  constructor(
    private readonly db: SqlDb,
    private readonly rules: RulesConfig,
    private readonly content: { species: ReadonlyMap<string, SpeciesDefinition>; items: ReadonlyMap<string, ItemDefinition> },
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  /** Species met in a fight (each element once); written when the fight is created. */
  async recordSeen(accountId: string, members: readonly { speciesId: string; element: string }[]): Promise<void> {
    const at = this.now();
    const unique = [...new Map(members.map((m) => [`${m.speciesId}|${m.element}`, m])).values()];
    if (unique.length === 0) return;
    await this.db.batch(
      unique.map((m) =>
        this.db
          .prepare(`INSERT INTO journal_seen (account_id, species_id, element, first_at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING`)
          .bind(accountId, m.speciesId, m.element, at),
      ),
    );
  }

  async recordMap(accountId: string, mapId: string): Promise<void> {
    await this.db
      .prepare(`INSERT INTO map_discoveries (account_id, map_id, first_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING`)
      .bind(accountId, mapId, this.now())
      .run();
  }

  async view(accountId: string): Promise<JournalView | null> {
    const ch = await this.db.prepare(`SELECT title_id FROM characters WHERE account_id = ?`).bind(accountId).first<{ title_id: string | null }>();
    if (ch === null) return null;
    const summary = await this.summary(accountId);
    // Secret quest titles (secret-progress-store.ts) are owned once claimed.
    const secret = await this.db
      .prepare(
        `SELECT r.ref FROM character_secret_rewards r JOIN characters c ON c.id = r.character_id
          WHERE c.account_id = ? AND r.kind = 'title' AND r.ref IS NOT NULL ORDER BY r.created_at, r.quest_id`,
      )
      .bind(accountId)
      .all<{ ref: string }>();
    return { ...summary, titles: [...earnedTitles(summary, this.bossSpecies()), ...secret.results.map((r) => r.ref)], titleId: ch.title_id };
  }

  async title(accountId: string): Promise<string | null> {
    const r = await this.db.prepare(`SELECT title_id FROM characters WHERE account_id = ?`).bind(accountId).first<{ title_id: string | null }>();
    return r?.title_id ?? null;
  }

  /** Show an earned title, or none. */
  async setTitle(accountId: string, raw: unknown): Promise<{ ok: true; titleId: string | null } | { ok: false; code: "INVALID_REQUEST" | "NO_CHARACTER" | "NOT_EARNED"; message: string }> {
    const parsed = TitleRequestSchema.safeParse(raw);
    if (!parsed.success) return { ok: false, code: "INVALID_REQUEST", message: "titleId must be a title id or null" };
    const view = await this.view(accountId);
    if (view === null) return { ok: false, code: "NO_CHARACTER", message: "make a character first" };
    const { titleId } = parsed.data;
    if (titleId !== null && !view.titles.includes(titleId)) return { ok: false, code: "NOT_EARNED", message: "that title is not earned yet" };
    await this.db.prepare(`UPDATE characters SET title_id = ? WHERE account_id = ?`).bind(titleId, accountId).run();
    return { ok: true, titleId };
  }

  private bossSpecies(): Set<string> {
    return new Set([...this.content.species.values()].filter((s) => s.rank === "BOSS").map((s) => s.id));
  }

  private async summary(accountId: string): Promise<JournalSummary> {
    const by = new Map<string, JournalSpecies>();
    const entry = (speciesId: string): JournalSpecies => {
      let e = by.get(speciesId);
      if (e === undefined) {
        e = { speciesId, seenElements: [], defeated: 0, capturedPersonally: 0, capturedElements: [], ownedNow: 0, raisedLevel: 0, rebirthStage: 0, bondTier: 0 };
        by.set(speciesId, e);
      }
      return e;
    };
    const seen = await this.db.prepare(`SELECT species_id, element FROM journal_seen WHERE account_id = ? ORDER BY first_at, element`).bind(accountId).all<{ species_id: string; element: Element }>();
    for (const r of seen.results) entry(r.species_id).seenElements.push(r.element);
    const acts = await this.db
      .prepare(`SELECT kind, subject, SUM(quantity) AS n FROM quest_activity WHERE account_id = ? AND kind IN ('kill', 'capture') GROUP BY kind, subject`)
      .bind(accountId)
      .all<{ kind: "kill" | "capture"; subject: string; n: number }>();
    for (const r of acts.results) {
      if (r.kind === "kill") entry(r.subject).defeated = r.n;
      else entry(r.subject).capturedPersonally = r.n;
    }
    const caught = await this.db
      .prepare(`SELECT species_id, element FROM journal_caught WHERE account_id = ? ORDER BY first_at, element`)
      .bind(accountId)
      .all<{ species_id: string; element: Element }>();
    for (const r of caught.results) entry(r.species_id).capturedElements.push(r.element);
    const owned = await this.db
      .prepare(`SELECT species_id, xp, rebirth_stage, bond FROM monster_instances WHERE owner_id = ?`)
      .bind(accountId)
      .all<{ species_id: string; xp: number; rebirth_stage: number; bond: number }>();
    for (const r of owned.results) {
      const e = entry(r.species_id);
      e.ownedNow += 1;
      e.raisedLevel = Math.max(e.raisedLevel, levelForExp(this.rules, "companion", r.xp));
      e.rebirthStage = Math.max(e.rebirthStage, r.rebirth_stage);
      e.bondTier = Math.max(e.bondTier, bondTier(this.rules, r.bond));
    }
    // A defeat or capture means it was met, even before journal_seen existed.
    for (const e of by.values()) if (e.seenElements.length === 0 && (e.defeated > 0 || e.capturedPersonally > 0 || e.ownedNow > 0)) e.seenElements.push(...e.capturedElements);

    const maps = await this.db.prepare(`SELECT map_id FROM map_discoveries WHERE account_id = ? ORDER BY first_at`).bind(accountId).all<{ map_id: string }>();
    const sigilItems = [...this.content.items.values()].filter((i) => i.kind === "sigil");
    const sigilsReceived: Record<string, number> = {};
    if (sigilItems.length > 0) {
      const got = await this.db
        .prepare(
          `SELECT item_id, SUM(delta) AS n FROM item_ledger WHERE account_id = ? AND reason = 'kill_reward' AND delta > 0
           AND item_id IN (${sigilItems.map(() => "?").join(", ")}) GROUP BY item_id`,
        )
        .bind(accountId, ...sigilItems.map((i) => i.id))
        .all<{ item_id: string; n: number }>();
      for (const r of got.results) {
        const sigilId = sigilItems.find((i) => i.id === r.item_id)?.sigilId;
        if (sigilId !== undefined) sigilsReceived[sigilId] = r.n;
      }
    }
    const sockets = await this.db.prepare(`SELECT sigil_sockets_json FROM equipment_instances WHERE owner_id = ?`).bind(accountId).all<{ sigil_sockets_json: string }>();
    const worn = new Set<string>();
    for (const r of sockets.results) for (const s of JSON.parse(r.sigil_sockets_json) as string[]) worn.add(s);

    const order = [...this.content.species.keys()];
    return {
      species: [...by.values()].sort((a, b) => order.indexOf(a.speciesId) - order.indexOf(b.speciesId)),
      maps: maps.results.map((m) => m.map_id),
      sigilsReceived,
      sigilsWorn: [...worn].sort(),
    };
  }
}
