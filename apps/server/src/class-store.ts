/**
 * Class2 trial and branch claim (class-change.ts, P16/P28). The trial is a practice boss fight with
 * `classTrial: true` (the kernel scales the boss by the rules' trial stat %), so it goes through the
 * same reserve → Battle DO path as the training ground and gives and takes nothing.
 *
 * Start: in town, Lv50+, no branch yet, a branch of the character's own Class1. The battle id comes
 * from (account, operation id), and the trial row is written before the fight, so a retried start
 * resumes the same fight with the same branch.
 * Claim: the trial's fight was won; one write sets the branch where the character has none
 * (`class2_id IS NULL`) and records the claiming operation, so a retry answers the same and a second
 * trial (any branch) is refused once one claim landed.
 */
import { ClassTrialClaimRequestSchema, ClassTrialStartRequestSchema, CLASS2_TRIAL_BOSS_ID, class2Refusal, classView, jobCap, companionSetups, playerSetup, type BattleSetup, type ClassTrialView, type ClassView, type RulesConfig } from "@pmrpg/shared";
import type { CharacterStore } from "./character-store";
import type { Economy } from "./economy";
import type { FrontierBattlePort } from "./frontier-store";
import { hashJson, type SqlDb } from "./reward-ledger";

export type ClassRejection = "INVALID_REQUEST" | "NO_CHARACTER" | "NOT_FOUND" | "NOT_IN_TOWN" | "IN_BATTLE" | "LEVEL_TOO_LOW" | "JOB_TOO_LOW" | "ALREADY_CHOSEN" | "NOT_WON" | "ENCOUNTER_REFUSED";
type Rejected = { status: "rejected"; reason: ClassRejection; message: string };
const reject = (reason: ClassRejection, message: string): Rejected => ({ status: "rejected", reason, message });

export type ClassTrialStartResult = { status: "started"; battleId: string; branchId: string; resumed: boolean } | Rejected;
export type ClassClaimResult = { status: "claimed"; class2Id: string } | Rejected;

interface TrialRow {
  operation_id: string;
  branch_id: string;
  battle_id: string;
  reservation_id: string;
  status: "started" | "claimed";
}

const marks = (n: number) => Array.from({ length: n }, () => "?").join(", ");

export class ClassStore {
  constructor(
    private readonly db: SqlDb,
    private readonly rules: RulesConfig,
    private readonly economy: Economy,
    private readonly characters: CharacterStore,
    private readonly battles: FrontierBattlePort,
    private readonly towns: readonly string[],
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async view(accountId: string): Promise<ClassView | null> {
    const c = await this.characters.get(accountId);
    if (c === null) return null;
    const row = await this.db
      .prepare(`SELECT operation_id, branch_id, battle_id, reservation_id, status FROM class_trials WHERE character_id = ? ORDER BY created_at DESC, operation_id DESC LIMIT 1`)
      .bind(c.id)
      .first<TrialRow>();
    return classView(this.rules, c, row === null ? null : await this.trialView(row));
  }

  /** Start (or, with the same operation id, resume) the Class2 trial for one branch; in town only. */
  async start(accountId: string, raw: unknown): Promise<ClassTrialStartResult> {
    const parsed = ClassTrialStartRequestSchema.safeParse(raw);
    if (!parsed.success) return reject("INVALID_REQUEST", parsed.error.issues.map((i) => i.message).join("; "));
    const { operationId, branchId } = parsed.data;
    const loadout = await this.characters.loadout(accountId);
    if (loadout === null) return reject("NO_CHARACTER", "create a character first");
    const { character, instances, worn, equipmentIds } = loadout;
    const prior = await this.trial(character.id, operationId);
    if (prior !== null) {
      if (prior.branch_id !== branchId) return reject("INVALID_REQUEST", "this operation id started a trial for another branch");
      const res = await this.economy.reservation(prior.reservation_id);
      if (res?.status === "released") return reject("ENCOUNTER_REFUSED", "that trial was called off; start a new one");
      if (res?.status === "settled" || prior.status === "claimed") return { status: "started", battleId: prior.battle_id, branchId, resumed: true };
    } else {
      const refusal = class2Refusal(this.rules, character, branchId);
      if (refusal === "NOT_FOUND") return reject("NOT_FOUND", "your class has no such branch");
      if (refusal === "ALREADY_CHOSEN") return reject("ALREADY_CHOSEN", "this character already took its Class2");
      if (refusal === "LEVEL_TOO_LOW") return reject("LEVEL_TOO_LOW", `the trial opens at Lv${this.rules.provisional.classChange.value.class2Level}`);
      if (refusal === "JOB_TOO_LOW") return reject("JOB_TOO_LOW", `the trial needs Class1 Job ${jobCap(this.rules, 1)}`);
      if (!(await this.inTown(accountId))) return reject("NOT_IN_TOWN", "the trial is taken in town");
    }
    const battleId = prior?.battle_id ?? `battle:ct_${(await hashJson({ accountId, operationId, kind: "class2" })).slice(0, 32)}`;
    const reservationId = `res:${battleId}`;
    if ((await this.economy.reservedBag(reservationId)) === null) {
      const team = character.team.map((t) => t.instanceId);
      const reserved = await this.economy.reserve({ reservationId, accountId, battleId, bag: {}, companionIds: team, characterId: character.id, equipmentIds });
      if (reserved.status === "rejected") {
        if (reserved.reason === "BATTLE_IN_PROGRESS") return reject("IN_BATTLE", "finish your other fight first");
        return reject("ENCOUNTER_REFUSED", reserved.reason);
      }
    }
    // The trial row is what a claim reads; written once per (character, operation id).
    await this.db
      .prepare(
        `INSERT INTO class_trials (character_id, operation_id, account_id, branch_id, battle_id, reservation_id, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'started', ?) ON CONFLICT DO NOTHING`,
      )
      .bind(character.id, operationId, accountId, branchId, battleId, reservationId, this.now())
      .run();
    const full = new Map([...instances].map(([id, inst]) => [id, { ...inst, hp: null, mp: null }]));
    const setup: BattleSetup = {
      battleId,
      originMode: "manual",
      seed: crypto.randomUUID(),
      player: playerSetup(accountId, { ...character, hp: null, mp: null }, worn),
      companions: companionSetups(character.team, full),
      enemies: [],
      boss: { bossId: CLASS2_TRIAL_BOSS_ID },
      bag: {},
      practice: true,
      classTrial: true,
    };
    // The Battle DO keeps the first setup it was given, so a resumed create is a no-op.
    const created = await this.battles.create(accountId, setup, reservationId);
    if (!created.ok) return reject("ENCOUNTER_REFUSED", created.code);
    return { status: "started", battleId, branchId, resumed: prior !== null };
  }

  /** Take the branch of a won trial. Idempotent per operation id; one claim per character, ever. */
  async claim(accountId: string, raw: unknown): Promise<ClassClaimResult> {
    const parsed = ClassTrialClaimRequestSchema.safeParse(raw);
    if (!parsed.success) return reject("INVALID_REQUEST", parsed.error.issues.map((i) => i.message).join("; "));
    const { operationId } = parsed.data;
    const c = await this.characters.get(accountId);
    if (c === null) return reject("NO_CHARACTER", "create a character first");
    const t = await this.trial(c.id, operationId);
    if (t === null) return reject("NOT_FOUND", "no trial with this operation id");
    const done = await this.claimedBy(c.id);
    if (done !== null) {
      if (done.operationId === operationId) return { status: "claimed", class2Id: done.class2Id };
      return reject("ALREADY_CHOSEN", "this character already took its Class2");
    }
    const res = await this.economy.reservation(t.reservation_id);
    if (res?.status !== "settled" || res.outcome !== "victory") return reject("NOT_WON", "win the trial first");
    await this.db.batch([
      this.db.prepare(`UPDATE characters SET class2_id = ?, class2_operation_id = ? WHERE id = ? AND account_id = ? AND class2_id IS NULL`).bind(t.branch_id, operationId, c.id, accountId),
      this.db
        .prepare(`UPDATE class_trials SET status = 'claimed' WHERE character_id = ? AND operation_id = ? AND EXISTS (SELECT 1 FROM characters WHERE id = ? AND class2_operation_id = ?)`)
        .bind(c.id, operationId, c.id, operationId),
    ]);
    // Read back: whoever's claim landed decides the answer.
    const after = await this.claimedBy(c.id);
    if (after?.operationId === operationId) return { status: "claimed", class2Id: after.class2Id };
    return reject("ALREADY_CHOSEN", "this character already took its Class2");
  }

  private async trialView(row: TrialRow): Promise<ClassTrialView> {
    let status: ClassTrialView["status"] = row.status === "claimed" ? "claimed" : "started";
    if (status === "started") {
      const res = await this.economy.reservation(row.reservation_id);
      if (res?.status === "settled") status = res.outcome === "victory" ? "won" : "lost";
      else if (res?.status === "released") status = "lost";
    }
    return { operationId: row.operation_id, branchId: row.branch_id, battleId: row.battle_id, status };
  }

  private trial(characterId: string, operationId: string): Promise<TrialRow | null> {
    return this.db
      .prepare(`SELECT operation_id, branch_id, battle_id, reservation_id, status FROM class_trials WHERE character_id = ? AND operation_id = ?`)
      .bind(characterId, operationId)
      .first<TrialRow>();
  }

  private async claimedBy(characterId: string): Promise<{ class2Id: string; operationId: string } | null> {
    const r = await this.db.prepare(`SELECT class2_id, class2_operation_id FROM characters WHERE id = ?`).bind(characterId).first<{ class2_id: string | null; class2_operation_id: string | null }>();
    return r?.class2_id == null || r.class2_operation_id == null ? null : { class2Id: r.class2_id, operationId: r.class2_operation_id };
  }

  private async inTown(accountId: string): Promise<boolean> {
    const r = await this.db
      .prepare(`SELECT 1 AS ok FROM player_positions WHERE account_id = ? AND map_id IN (${marks(this.towns.length)})`)
      .bind(accountId, ...this.towns)
      .first<{ ok: number }>();
    return r !== null;
  }
}
