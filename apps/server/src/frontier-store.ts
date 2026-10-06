/**
 * Weekly battle tower on D1 (migration 0022; Nut 2026-10-06 decisions in RULES.confirmed.frontier*).
 *
 * - Entry (town NPC, in town only): the run row is the week's entry token. UNIQUE (character, tower,
 *   week) lets one entry win however many race; the operation id tells a retry (same run back) from a
 *   second entry (ALREADY_ENTERED). The week is the quest week (P13: Monday 21:00 UTC).
 * - Floors are private fights in order through the normal path: reserve in D1, then the Battle DO
 *   creates the fight from the floor the server rolls from (run id, floor). The floor's battle id is
 *   derived from (run, floor, attempt), so a double tap or a reload starts or resumes the same fight.
 * - Settlement: once D1 holds the fight's settlement (rewards already granted through the ledger by
 *   the battle's outbox), the run advances one floor or ends. One batch, anchored on a result row per
 *   (run, floor) and guarded by the run still holding that battle, so it applies once however often it
 *   runs; every read of the tower runs it first, which is the recovery path.
 * - HP/MP are the run's own and carry floor to floor (a town rest does not refill a run); every 5th
 *   floor cleared gives 30% back (frontierVitalsAfter). A loss ends the run for the week. Leaving
 *   between floors keeps the run; the next floor resumes it, until the week resets.
 */
import {
  EMPTY_FRONTIER_VITALS,
  FrontierEnterRequestSchema,
  FrontierFloorRequestSchema,
  FrontierLeaveRequestSchema,
  defaultCombatBag,
  frontierFloorSetup,
  frontierFloorSpecies,
  frontierNextFloor,
  frontierVitalsAfter,
  isFrontierBossFloor,
  playerSetup,
  companionSetups,
  questPeriod,
  rollFrontierFloor,
  type BattleSetup,
  type FrontierContent,
  type FrontierDefinition,
  type FrontierView,
  type FrontierVitals,
  type ItemDefinition,
  type RulesConfig,
} from "@pmrpg/shared";
import type { CharacterStore } from "./character-store";
import type { Economy, AllyResult } from "./economy";
import type { JournalStore } from "./journal-store";
import { hashJson, type SqlBound, type SqlDb } from "./reward-ledger";

export type FrontierRejection =
  | "INVALID_REQUEST"
  | "NO_CHARACTER"
  | "NOT_IN_TOWN"
  | "IN_BATTLE"
  | "ALREADY_ENTERED"
  | "NO_RUN"
  | "RUN_ENDED"
  | "STALE_FLOOR"
  | "TEAM_CHANGED"
  | "ENCOUNTER_REFUSED";
type Rejected = { status: "rejected"; reason: FrontierRejection; message: string };
const reject = (reason: FrontierRejection, message: string): Rejected => ({ status: "rejected", reason, message });

export type FrontierEnterResult = { status: "entered"; replayed: boolean; view: FrontierView } | Rejected;
export type FrontierStartResult = { status: "started"; battleId: string; floor: number; boss: boolean; resumed: boolean } | Rejected;
export type FrontierLeaveResult = { status: "left"; view: FrontierView } | Rejected;

/** How the store asks the Battle DO to create a floor fight (the Worker wires the real one). */
export interface FrontierBattlePort {
  create(accountId: string, setup: BattleSetup, reservationId: string): Promise<{ ok: true } | { ok: false; code: string; message: string }>;
}

interface RunRow {
  run_id: string;
  character_id: string;
  account_id: string;
  week_id: string;
  operation_id: string;
  team_json: string;
  floor: number;
  best_floor: number;
  status: "open" | "ended";
  end_reason: "defeat" | "summit" | null;
  inside: number;
  battle_id: string | null;
  attempt: number;
  vitals_json: string | null;
}

const marks = (n: number) => Array.from({ length: n }, () => "?").join(", ");

export class FrontierStore {
  constructor(
    private readonly db: SqlDb,
    private readonly rules: RulesConfig,
    private readonly def: FrontierDefinition,
    private readonly content: FrontierContent & { items: ReadonlyMap<string, ItemDefinition> },
    private readonly economy: Economy,
    private readonly characters: CharacterStore,
    private readonly battles: FrontierBattlePort,
    private readonly journal: JournalStore | null = null,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  /** The tower as this character sees it this week; null without a character. Settles a finished floor first. */
  async view(accountId: string): Promise<FrontierView | null> {
    const ch = await this.character(accountId);
    if (ch === null) return null;
    await this.settle(accountId);
    return this.viewFor(ch.id);
  }

  /** Use this week's entry: in town, outside fights, once (idempotent on operationId). */
  async enter(accountId: string, raw: unknown): Promise<FrontierEnterResult> {
    const parsed = FrontierEnterRequestSchema.safeParse(raw);
    if (!parsed.success) return reject("INVALID_REQUEST", parsed.error.issues.map((i) => i.message).join("; "));
    const op = parsed.data.operationId;
    const character = await this.characters.get(accountId);
    if (character === null) return reject("NO_CHARACTER", "create a character first");
    const week = this.week();
    const prior = await this.run(character.id, week.id);
    if (prior !== null) {
      if (prior.operation_id === op) return { status: "entered", replayed: true, view: await this.viewFor(character.id) };
      return reject("ALREADY_ENTERED", "this week's entry is used; the tower opens again when the week resets");
    }
    if (!(await this.inTown(accountId))) return reject("NOT_IN_TOWN", `enter at the tower's town NPC (${this.def.townMapIds.join(", ")})`);
    if (await this.openBattle(accountId)) return reject("IN_BATTLE", "finish your fight first");
    const runId = `frun_${crypto.randomUUID().replace(/-/g, "")}`;
    const team = character.team.map((t) => t.instanceId).sort();
    const at = this.now();
    await this.db
      .prepare(
        `INSERT INTO frontier_runs (run_id, character_id, account_id, frontier_id, week_id, operation_id, team_json, floor, best_floor, status, inside, created_at, updated_at)
         SELECT ?, ?, ?, ?, ?, ?, ?, 1, 0, 'open', 1, ?, ? WHERE ${this.inTownSql()} ON CONFLICT DO NOTHING`,
      )
      .bind(runId, character.id, accountId, this.def.id, week.id, op, JSON.stringify(team), at, at, accountId, ...this.def.townMapIds)
      .run();
    const row = await this.run(character.id, week.id);
    if (row === null) return reject("NOT_IN_TOWN", "left town before entering");
    if (row.operation_id !== op) return reject("ALREADY_ENTERED", "this week's entry is used");
    return { status: "entered", replayed: row.run_id !== runId, view: await this.viewFor(character.id) };
  }

  /** Start (or resume) the run's next floor fight. */
  async startFloor(accountId: string, raw: unknown): Promise<FrontierStartResult> {
    const parsed = FrontierFloorRequestSchema.safeParse(raw);
    if (!parsed.success) return reject("INVALID_REQUEST", parsed.error.issues.map((i) => i.message).join("; "));
    const loadout = await this.characters.loadout(accountId);
    if (loadout === null) return reject("NO_CHARACTER", "create a character first");
    const { character, instances, worn, equipmentIds } = loadout;
    await this.settle(accountId);
    let run = await this.run(character.id, this.week().id);
    if (run === null || run.run_id !== parsed.data.runId) return reject("NO_RUN", "no tower run this week; enter first");
    if (run.status === "ended") return reject("RUN_ENDED", run.end_reason === "summit" ? "you reached the top this week" : "this week's run is over");
    if (run.battle_id !== null) {
      const r = await this.economy.reservation(`res:${run.battle_id}`);
      if (r?.status === "reserved" || r?.status === "active") {
        if (run.floor !== parsed.data.floor) return reject("STALE_FLOOR", `the fight in progress is floor ${run.floor}`);
        return { status: "started", battleId: run.battle_id, floor: run.floor, boss: isFrontierBossFloor(this.rules, run.floor), resumed: true };
      }
    }
    if (run.floor !== parsed.data.floor) return reject("STALE_FLOOR", `the next floor is ${run.floor}`);
    if (!(await this.inTown(accountId))) return reject("NOT_IN_TOWN", "the tower's door is in town");
    const team = character.team.map((t) => t.instanceId).sort();
    if (JSON.stringify(team) !== run.team_json) return reject("TEAM_CHANGED", "climb with the team you entered with");

    // Claim the floor for this battle id (a racing start computes the same id).
    const battleId = `battle:fr_${(await hashJson({ runId: run.run_id, floor: run.floor, attempt: run.attempt })).slice(0, 32)}`;
    await this.db
      .prepare(
        `UPDATE frontier_runs SET battle_id = ?, inside = 1, updated_at = ?
         WHERE run_id = ? AND status = 'open' AND floor = ? AND attempt = ? AND (battle_id IS NULL OR battle_id = ?)`,
      )
      .bind(battleId, this.now(), run.run_id, run.floor, run.attempt, battleId)
      .run();
    run = (await this.run(character.id, run.week_id))!;
    if (run.battle_id !== battleId) return reject("STALE_FLOOR", "the floor changed; open the tower again");

    const reservationId = `res:${battleId}`;
    const prior = await this.economy.reservedBag(reservationId);
    let bag = prior?.bag;
    if (bag === undefined) {
      bag = defaultCombatBag(this.rules, await this.economy.balances(accountId), (id) => this.content.items.get(id)?.kind);
      const reserved = await this.economy.reserve({ reservationId, accountId, battleId, bag, companionIds: team, characterId: character.id, equipmentIds });
      if (reserved.status === "rejected") {
        const now = await this.economy.reservedBag(reservationId);
        // A racing start reserved first (its bag may differ): continue with that one.
        if (now !== null && (now.status === "reserved" || now.status === "active")) bag = now.bag;
        else {
          await this.unclaim(run.run_id, battleId);
          if (reserved.reason === "BATTLE_IN_PROGRESS") return reject("IN_BATTLE", "finish your other fight first");
          return reject("ENCOUNTER_REFUSED", reserved.reason);
        }
      }
    }
    const floor = rollFrontierFloor(this.rules, this.def, this.content, run.run_id, run.floor);
    const vitals = this.vitals(run);
    const withVitals = new Map(
      [...instances].map(([id, inst]) => {
        const v = vitals.companions[id];
        return [id, v === undefined ? { ...inst, hp: null, mp: null } : { ...inst, hp: v.hp, mp: v.mp }];
      }),
    );
    const setup: BattleSetup = {
      battleId,
      originMode: "manual",
      seed: crypto.randomUUID(),
      player: playerSetup(accountId, { ...character, hp: vitals.player?.hp ?? null, mp: vitals.player?.mp ?? null }, worn),
      companions: companionSetups(character.team, withVitals),
      ...frontierFloorSetup(floor),
      bag,
    };
    const created = await this.battles.create(accountId, setup, reservationId);
    if (!created.ok) return reject("ENCOUNTER_REFUSED", created.code);
    await this.journal?.recordSeen(accountId, frontierFloorSpecies(floor, this.content.bosses));
    return { status: "started", battleId, floor: run.floor, boss: floor.kind === "boss", resumed: false };
  }

  /** Step out between floors; the run stays for this week. */
  async leave(accountId: string, raw: unknown): Promise<FrontierLeaveResult> {
    const parsed = FrontierLeaveRequestSchema.safeParse(raw);
    if (!parsed.success) return reject("INVALID_REQUEST", parsed.error.issues.map((i) => i.message).join("; "));
    const ch = await this.character(accountId);
    if (ch === null) return reject("NO_CHARACTER", "create a character first");
    await this.settle(accountId);
    const run = await this.run(ch.id, this.week().id);
    if (run === null || run.run_id !== parsed.data.runId) return reject("NO_RUN", "no tower run this week");
    if (run.battle_id !== null) return reject("IN_BATTLE", "finish the floor first");
    await this.db.prepare(`UPDATE frontier_runs SET inside = 0, updated_at = ? WHERE run_id = ? AND battle_id IS NULL`).bind(this.now(), run.run_id).run();
    return { status: "left", view: await this.viewFor(ch.id) };
  }

  /**
   * Apply every finished floor fight of this character (any week): advance or end the run. Safe to run
   * any number of times, concurrently too; returns how many floors it applied now.
   */
  async settle(accountId: string): Promise<number> {
    const { results } = await this.db
      .prepare(`SELECT * FROM frontier_runs WHERE account_id = ? AND battle_id IS NOT NULL`)
      .bind(accountId)
      .all<RunRow>();
    let applied = 0;
    for (const run of results) {
      const battleId = run.battle_id!;
      const res = await this.db
        .prepare(`SELECT status, outcome, result_json FROM battle_reservations WHERE reservation_id = ?`)
        .bind(`res:${battleId}`)
        .first<{ status: string; outcome: string | null; result_json: string | null }>();
      if (res === null || res.status === "reserved" || res.status === "active") continue;
      const at = this.now();
      if (res.status === "released") {
        // The fight never started (the reconciler gave everything back): the next start is a new attempt.
        await this.db
          .prepare(`UPDATE frontier_runs SET battle_id = NULL, attempt = attempt + 1, updated_at = ? WHERE run_id = ? AND battle_id = ?`)
          .bind(at, run.run_id, battleId)
          .run();
        continue;
      }
      const won = res.outcome === "victory";
      const floor = run.floor;
      const guard = `EXISTS (SELECT 1 FROM frontier_runs WHERE run_id = ? AND battle_id = ? AND floor = ?)`;
      const token = crypto.randomUUID();
      // Everything after the result row applies only under this request's token.
      const ours = `EXISTS (SELECT 1 FROM frontier_floor_results WHERE run_id = ? AND floor = ? AND battle_id = ? AND token = ?)`;
      const oursArgs = [run.run_id, floor, battleId, token];
      const stmts: SqlBound[] = [
        this.db
          .prepare(`INSERT INTO frontier_floor_results (run_id, floor, battle_id, outcome, token, settled_at) SELECT ?, ?, ?, ?, ?, ? WHERE ${guard} ON CONFLICT DO NOTHING`)
          .bind(run.run_id, floor, battleId, res.outcome ?? "unknown", token, at, run.run_id, battleId, floor),
      ];
      if (won) {
        const allies = (JSON.parse(res.result_json ?? "{}") as { allies?: AllyResult[] }).allies ?? [];
        const vitals = frontierVitalsAfter(this.rules, floor, allies);
        const summit = floor >= this.rules.confirmed.frontierFloors.value;
        stmts.push(
          this.db
            .prepare(
              `UPDATE frontier_runs SET floor = floor + 1, best_floor = MAX(best_floor, ?), battle_id = NULL, attempt = 1, vitals_json = ?,
                 status = ?, end_reason = ?, updated_at = ?
               WHERE run_id = ? AND battle_id = ? AND floor = ? AND ${ours}`,
            )
            .bind(floor, JSON.stringify(vitals), summit ? "ended" : "open", summit ? "summit" : null, at, run.run_id, battleId, floor, ...oursArgs),
        );
        if (isFrontierBossFloor(this.rules, floor)) {
          stmts.push(
            this.db
              .prepare(
                `INSERT INTO frontier_first_clears (character_id, frontier_id, floor, run_id, cleared_at)
                 SELECT ?, ?, ?, ?, ? WHERE ${ours} ON CONFLICT DO NOTHING`,
              )
              .bind(run.character_id, this.def.id, floor, run.run_id, at, ...oursArgs),
          );
        }
      } else {
        // A loss (or anything but a win) ends the run for the week.
        stmts.push(
          this.db
            .prepare(`UPDATE frontier_runs SET status = 'ended', end_reason = 'defeat', battle_id = NULL, updated_at = ? WHERE run_id = ? AND battle_id = ? AND floor = ? AND ${ours}`)
            .bind(at, run.run_id, battleId, floor, ...oursArgs),
        );
      }
      await this.db.batch(stmts);
      const mine = await this.db
        .prepare(`SELECT 1 AS ok FROM frontier_floor_results WHERE run_id = ? AND floor = ? AND token = ?`)
        .bind(run.run_id, floor, token)
        .first<{ ok: number }>();
      if (mine !== null) applied += 1;
    }
    // The run keeps its own HP/MP; the character standing in town rests as towns allow (chapter 03 §3).
    if (applied > 0 && (await this.inTown(accountId))) await this.characters.rest(accountId);
    return applied;
  }

  /** DEV ONLY: move this week's open run to `floor` between fights (to reach a boss floor in a smoke). */
  async devJump(accountId: string, floor: number): Promise<FrontierView | null> {
    const ch = await this.character(accountId);
    if (ch === null) return null;
    await this.settle(accountId);
    await this.db
      .prepare(`UPDATE frontier_runs SET floor = ?, attempt = 1, updated_at = ? WHERE character_id = ? AND week_id = ? AND status = 'open' AND battle_id IS NULL`)
      .bind(floor, this.now(), ch.id, this.week().id)
      .run();
    return this.viewFor(ch.id);
  }

  /** DEV ONLY: give back this week's entry (drops the run between fights; first clears stay). */
  async devReset(accountId: string): Promise<FrontierView | null> {
    const ch = await this.character(accountId);
    if (ch === null) return null;
    await this.settle(accountId);
    const run = await this.run(ch.id, this.week().id);
    if (run !== null && run.battle_id === null) {
      await this.db.batch([
        this.db.prepare(`DELETE FROM frontier_floor_results WHERE run_id = ?`).bind(run.run_id),
        this.db.prepare(`DELETE FROM frontier_runs WHERE run_id = ? AND battle_id IS NULL`).bind(run.run_id),
      ]);
    }
    return this.viewFor(ch.id);
  }

  // ------------------------------------------------------------------ helpers

  private week() {
    return questPeriod(this.rules, "weekly", this.now());
  }

  private character(accountId: string) {
    return this.db.prepare(`SELECT id FROM characters WHERE account_id = ?`).bind(accountId).first<{ id: string }>();
  }

  private run(characterId: string, weekId: string): Promise<RunRow | null> {
    return this.db
      .prepare(`SELECT * FROM frontier_runs WHERE character_id = ? AND frontier_id = ? AND week_id = ?`)
      .bind(characterId, this.def.id, weekId)
      .first<RunRow>();
  }

  private vitals(run: RunRow): FrontierVitals {
    return run.vitals_json === null ? EMPTY_FRONTIER_VITALS : (JSON.parse(run.vitals_json) as FrontierVitals);
  }

  private async viewFor(characterId: string): Promise<FrontierView> {
    const week = this.week();
    const run = await this.run(characterId, week.id);
    return {
      frontierId: this.def.id,
      name: this.def.name,
      lore: this.def.lore.th,
      weekId: week.id,
      endsAt: week.endsAt,
      floors: this.rules.confirmed.frontierFloors.value,
      bossEvery: this.rules.confirmed.frontierBossEveryFloors.value,
      entryUsed: run !== null,
      run:
        run === null
          ? null
          : {
              runId: run.run_id,
              floor: run.floor,
              best: run.best_floor,
              status: run.status,
              endReason: run.end_reason,
              inside: run.inside === 1,
              battleId: run.battle_id,
              nextIsBoss: run.status === "open" && isFrontierBossFloor(this.rules, run.floor),
              next: run.status === "open" ? frontierNextFloor(this.rules, this.def, run.floor) : null,
              vitals: this.vitals(run),
            },
    };
  }

  private unclaim(runId: string, battleId: string) {
    return this.db.prepare(`UPDATE frontier_runs SET battle_id = NULL WHERE run_id = ? AND battle_id = ?`).bind(runId, battleId).run();
  }

  private inTownSql(): string {
    return `EXISTS (SELECT 1 FROM player_positions WHERE account_id = ? AND map_id IN (${marks(this.def.townMapIds.length)}))`;
  }

  private async inTown(accountId: string): Promise<boolean> {
    const r = await this.db.prepare(`SELECT 1 AS ok WHERE ${this.inTownSql()}`).bind(accountId, ...this.def.townMapIds).first<{ ok: number }>();
    return r !== null;
  }

  private async openBattle(accountId: string): Promise<boolean> {
    const r = await this.db
      .prepare(`SELECT 1 AS ok FROM battle_reservations WHERE account_id = ? AND status IN ('reserved', 'active')`)
      .bind(accountId)
      .first<{ ok: number }>();
    return r !== null;
  }
}
