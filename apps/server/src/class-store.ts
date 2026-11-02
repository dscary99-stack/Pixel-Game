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
 *
 * Class3 (Lv120): the same start and claim with a Class3 id in `branchId` (trialTier): the character
 * needs its branch and Class2 Job at its cap; the boss is the tower tyrant at the Class3 trial stat %,
 * and the claim sets `class3_id` the same once-only way.
 *
 * Divine awakening (Lv200, ascension.ts): the same start with `ascend:<race>` (the character's own race,
 * a Class3, no ascension yet); the boss is the tyrant at the ascension trial stat % (P31). Its claim
 * costs coins and materials, so it is a town service (TownServices.ascend), not `claim` here.
 *
 * Companion Rebirth trial (P37): `startRebirth` with `rebirth:<stage>:<companion>` as the row's branch
 * id; TownServices.rebirth reads the won row itself (no claim here).
 */
import { expForLevel, REBIRTH_TRIAL_BOSS_ID, rebirthTrialId, RebirthTrialStartRequestSchema, type RebirthTrialView, ASCENSION_TRIAL_BOSS_ID, ascensionRefusal, ClassTrialClaimRequestSchema, ClassTrialStartRequestSchema, CLASS2_TRIAL_BOSS_ID, CLASS3_TRIAL_BOSS_ID, class2Refusal, class3Refusal, trialTier, classView, jobCap, companionSetups, playerSetup, type BattleSetup, type ClassTrialView, type ClassView, type RulesConfig } from "@pmrpg/shared";
import type { CharacterStore } from "./character-store";
import type { Economy } from "./economy";
import type { FrontierBattlePort } from "./frontier-store";
import { hashJson, type SqlDb } from "./reward-ledger";

export type ClassRejection = "INVALID_REQUEST" | "NO_CHARACTER" | "NOT_FOUND" | "NOT_IN_TEAM" | "MAX_REBIRTH" | "PLAYER_LEVEL_TOO_LOW" | "NO_CLASS2" | "NO_CLASS3" | "ALREADY_ASCENDED" | "NOT_IN_TOWN" | "IN_BATTLE" | "LEVEL_TOO_LOW" | "JOB_TOO_LOW" | "ALREADY_CHOSEN" | "NOT_WON" | "ENCOUNTER_REFUSED";
type Rejected = { status: "rejected"; reason: ClassRejection; message: string };
const reject = (reason: ClassRejection, message: string): Rejected => ({ status: "rejected", reason, message });

export type ClassTrialStartResult = { status: "started"; battleId: string; branchId: string; resumed: boolean } | Rejected;
export type ClassClaimResult = { status: "claimed"; class2Id: string } | { status: "claimed"; class3Id: string } | Rejected;

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
      .prepare(`SELECT operation_id, branch_id, battle_id, reservation_id, status FROM class_trials WHERE character_id = ? AND branch_id NOT LIKE 'rebirth:%' ORDER BY created_at DESC, operation_id DESC LIMIT 1`)
      .bind(c.id)
      .first<TrialRow>();
    return classView(this.rules, c, row === null ? null : await this.trialView(row));
  }

  /** Start (or, with the same operation id, resume) the Class2 trial for one branch, or the Class3 trial; in town only. */
  async start(accountId: string, raw: unknown): Promise<ClassTrialStartResult> {
    const parsed = ClassTrialStartRequestSchema.safeParse(raw);
    if (!parsed.success) return reject("INVALID_REQUEST", parsed.error.issues.map((i) => i.message).join("; "));
    const { operationId, branchId } = parsed.data;
    const tier = trialTier(branchId);
    if (tier === "rebirth") return reject("INVALID_REQUEST", "a companion's Rebirth trial starts at POST /class/rebirth/start");
    const loadout = await this.characters.loadout(accountId);
    if (loadout === null) return reject("NO_CHARACTER", "create a character first");
    const { character } = loadout;
    const prior = await this.trial(character.id, operationId);
    if (prior !== null) {
      if (prior.branch_id !== branchId) return reject("INVALID_REQUEST", "this operation id started a trial for another branch");
      const res = await this.economy.reservation(prior.reservation_id);
      if (res?.status === "released") return reject("ENCOUNTER_REFUSED", "that trial was called off; start a new one");
      if (res?.status === "settled" || prior.status === "claimed") return { status: "started", battleId: prior.battle_id, branchId, resumed: true };
    } else {
      const cc = this.rules.provisional.classChange.value;
      if (tier === "ascend") {
        const refusal = ascensionRefusal(this.rules, character, branchId);
        if (refusal === "NOT_FOUND") return reject("NOT_FOUND", "that is not your race's trial");
        if (refusal === "NO_CLASS3") return reject("NO_CLASS3", "take your Class3 first");
        if (refusal === "ALREADY_ASCENDED") return reject("ALREADY_ASCENDED", "this character already ascended");
        if (refusal === "LEVEL_TOO_LOW") return reject("LEVEL_TOO_LOW", `the race trial opens at Lv${this.rules.provisional.ascension.value.level}`);
      } else if (tier === 3) {
        const refusal = class3Refusal(this.rules, character, branchId);
        if (refusal === "NOT_FOUND") return reject("NOT_FOUND", "your branch has no such Class3");
        if (refusal === "NO_CLASS2") return reject("NO_CLASS2", "take your Class2 first");
        if (refusal === "ALREADY_CHOSEN") return reject("ALREADY_CHOSEN", "this character already took its Class3");
        if (refusal === "LEVEL_TOO_LOW") return reject("LEVEL_TOO_LOW", `the Class3 trial opens at Lv${cc.class3Level}`);
        if (refusal === "JOB_TOO_LOW") return reject("JOB_TOO_LOW", `the Class3 trial needs Class2 Job ${jobCap(this.rules, 2)}`);
      } else {
        const refusal = class2Refusal(this.rules, character, branchId);
        if (refusal === "NOT_FOUND") return reject("NOT_FOUND", "your class has no such branch");
        if (refusal === "ALREADY_CHOSEN") return reject("ALREADY_CHOSEN", "this character already took its Class2");
        if (refusal === "LEVEL_TOO_LOW") return reject("LEVEL_TOO_LOW", `the trial opens at Lv${cc.class2Level}`);
        if (refusal === "JOB_TOO_LOW") return reject("JOB_TOO_LOW", `the trial needs Class1 Job ${jobCap(this.rules, 1)}`);
      }
      if (!(await this.inTown(accountId))) return reject("NOT_IN_TOWN", "the trial is taken in town");
    }
    return this.launch(accountId, operationId, branchId, tier === "ascend" ? "ascend" : tier === 3 ? "class3" : "class2", prior, loadout, {
      boss: { bossId: tier === "ascend" ? ASCENSION_TRIAL_BOSS_ID : tier === 3 ? CLASS3_TRIAL_BOSS_ID : CLASS2_TRIAL_BOSS_ID },
      ...(tier === 3 ? { classTrialTier: 3 as const } : tier === "ascend" ? { classTrialTier: "ascend" as const, raceTrial: { raceId: character.raceId } } : {}),
    });
  }

  /**
   * Start (or resume) a companion's Rebirth trial (P37) in town: the companion is in the team, at the
   * Rebirth level, below the last stage, and the character has the next stage's licence level. The
   * fight is the tyrant at the stage's stat %; TownServices.rebirth needs it won with the companion standing.
   */
  async startRebirth(accountId: string, raw: unknown): Promise<ClassTrialStartResult> {
    const parsed = RebirthTrialStartRequestSchema.safeParse(raw);
    if (!parsed.success) return reject("INVALID_REQUEST", parsed.error.issues.map((i) => i.message).join("; "));
    const { operationId, companionId } = parsed.data;
    const loadout = await this.characters.loadout(accountId);
    if (loadout === null) return reject("NO_CHARACTER", "create a character first");
    const { character, instances } = loadout;
    const prior = await this.trial(character.id, operationId);
    let stage: number;
    if (prior !== null) {
      const m = /^rebirth:(\d+):(.+)$/.exec(prior.branch_id);
      if (m === null || m[2] !== companionId) return reject("INVALID_REQUEST", "this operation id started another trial");
      stage = Number(m[1]);
      const res = await this.economy.reservation(prior.reservation_id);
      if (res?.status === "released") return reject("ENCOUNTER_REFUSED", "that trial was called off; start a new one");
      if (res?.status === "settled") return { status: "started", battleId: prior.battle_id, branchId: prior.branch_id, resumed: true };
    } else {
      const pet = instances.get(companionId);
      if (pet === undefined) return reject("NOT_IN_TEAM", "put the companion in your team first");
      const req = this.rules.provisional.rebirthRequirements.value;
      if (pet.rebirthStage >= this.rules.provisional.maxRebirths.value) return reject("MAX_REBIRTH", "this companion has every Rebirth");
      if (pet.xp < expForLevel(this.rules, "companion", req.companionLevel)) return reject("LEVEL_TOO_LOW", `the companion must be Lv${req.companionLevel}`);
      if (character.level < req.playerLevel[pet.rebirthStage]!) return reject("PLAYER_LEVEL_TOO_LOW", `your character must be Lv${req.playerLevel[pet.rebirthStage]}`);
      if (!(await this.inTown(accountId))) return reject("NOT_IN_TOWN", "the trial is taken in town");
      stage = pet.rebirthStage + 1;
    }
    return this.launch(accountId, operationId, rebirthTrialId(companionId, stage), "rebirth", prior, loadout, { boss: { bossId: REBIRTH_TRIAL_BOSS_ID }, rebirthTrial: { stage } });
  }

  /** The latest trial of each team companion for its next Rebirth stage (P37). */
  async rebirthTrials(accountId: string): Promise<RebirthTrialView[] | null> {
    const c = await this.characters.get(accountId);
    if (c === null) return null;
    const { results } = await this.db
      .prepare(`SELECT operation_id, branch_id, battle_id, reservation_id, status FROM class_trials WHERE character_id = ? AND branch_id LIKE 'rebirth:%' ORDER BY created_at DESC, operation_id DESC`)
      .bind(c.id)
      .all<TrialRow>();
    const latest = new Map<string, TrialRow>();
    for (const r of results) if (!latest.has(r.branch_id)) latest.set(r.branch_id, r);
    const out: RebirthTrialView[] = [];
    for (const [branchId, r] of latest) {
      const m = /^rebirth:(\d+):(.+)$/.exec(branchId)!;
      const companionId = m[2]!;
      const res = await this.economy.reservation(r.reservation_id);
      const status: RebirthTrialView["status"] =
        res?.status === "settled" ? (res.outcome === "victory" && res.rebirthTrial?.standing.includes(companionId) === true ? "won" : "lost") : res?.status === "released" ? "lost" : "started";
      out.push({ companionId, stage: Number(m[1]), operationId: r.operation_id, battleId: r.battle_id, status });
    }
    return out;
  }

  /** Reserve the team and open the trial fight; a retried start resumes the same fight. */
  private async launch(
    accountId: string,
    operationId: string,
    branchId: string,
    kind: string,
    prior: TrialRow | null,
    loadout: NonNullable<Awaited<ReturnType<CharacterStore["loadout"]>>>,
    trial: Pick<BattleSetup, "boss" | "classTrialTier" | "raceTrial" | "rebirthTrial">,
  ): Promise<ClassTrialStartResult> {
    const { character, instances, worn, equipmentIds } = loadout;
    const battleId = prior?.battle_id ?? `battle:ct_${(await hashJson({ accountId, operationId, kind })).slice(0, 32)}`;
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
      bag: {},
      practice: true,
      classTrial: true,
      ...trial,
    };
    // The Battle DO keeps the first setup it was given, so a resumed create is a no-op.
    const created = await this.battles.create(accountId, setup, reservationId);
    if (!created.ok) return reject("ENCOUNTER_REFUSED", created.code);
    return { status: "started", battleId, branchId, resumed: prior !== null };
  }

  /** Take the branch (or Class3) of a won trial. Idempotent per operation id; one claim per tier per character, ever. */
  async claim(accountId: string, raw: unknown): Promise<ClassClaimResult> {
    const parsed = ClassTrialClaimRequestSchema.safeParse(raw);
    if (!parsed.success) return reject("INVALID_REQUEST", parsed.error.issues.map((i) => i.message).join("; "));
    const { operationId } = parsed.data;
    const c = await this.characters.get(accountId);
    if (c === null) return reject("NO_CHARACTER", "create a character first");
    const t = await this.trial(c.id, operationId);
    if (t === null) return reject("NOT_FOUND", "no trial with this operation id");
    const tier = trialTier(t.branch_id);
    if (tier === "ascend") return reject("INVALID_REQUEST", "a race trial is claimed in town with its cost (POST /town/ascend)");
    if (tier === "rebirth") return reject("INVALID_REQUEST", "a Rebirth trial opens the Rebirth in town (POST /town/rebirth)");
    const col = tier === 3 ? "class3" : "class2";
    const answer = (id: string): ClassClaimResult => (tier === 3 ? { status: "claimed", class3Id: id } : { status: "claimed", class2Id: id });
    const taken = reject("ALREADY_CHOSEN", `this character already took its Class${tier}`);
    const done = await this.claimedBy(c.id, tier);
    if (done !== null) return done.operationId === operationId ? answer(done.classId) : taken;
    const res = await this.economy.reservation(t.reservation_id);
    if (res?.status !== "settled" || res.outcome !== "victory") return reject("NOT_WON", "win the trial first");
    // A Class3 lands only on the branch it continues (the trial start checked it; the branch never changes).
    await this.db.batch([
      this.db.prepare(`UPDATE characters SET ${col}_id = ?, ${col}_operation_id = ? WHERE id = ? AND account_id = ? AND ${col}_id IS NULL${tier === 3 ? " AND class2_id IS NOT NULL" : ""}`).bind(t.branch_id, operationId, c.id, accountId),
      this.db
        .prepare(`UPDATE class_trials SET status = 'claimed' WHERE character_id = ? AND operation_id = ? AND EXISTS (SELECT 1 FROM characters WHERE id = ? AND ${col}_operation_id = ?)`)
        .bind(c.id, operationId, c.id, operationId),
    ]);
    // Read back: whoever's claim landed decides the answer.
    const after = await this.claimedBy(c.id, tier);
    return after?.operationId === operationId ? answer(after.classId) : taken;
  }

  private async trialView(row: TrialRow): Promise<ClassTrialView> {
    let status: ClassTrialView["status"] = row.status === "claimed" ? "claimed" : "started";
    if (status === "started") {
      const res = await this.economy.reservation(row.reservation_id);
      // A race trial (ascension) is won only with the race goal reached as well.
      if (res?.status === "settled") status = res.outcome === "victory" && res.raceTrial?.met !== false ? "won" : "lost";
      else if (res?.status === "released") status = "lost";
      if (res?.raceTrial !== undefined) return { operationId: row.operation_id, branchId: row.branch_id, battleId: row.battle_id, status, raceGoal: res.raceTrial };
    }
    return { operationId: row.operation_id, branchId: row.branch_id, battleId: row.battle_id, status };
  }

  private trial(characterId: string, operationId: string): Promise<TrialRow | null> {
    return this.db
      .prepare(`SELECT operation_id, branch_id, battle_id, reservation_id, status FROM class_trials WHERE character_id = ? AND operation_id = ?`)
      .bind(characterId, operationId)
      .first<TrialRow>();
  }

  private async claimedBy(characterId: string, tier: 2 | 3): Promise<{ classId: string; operationId: string } | null> {
    const col = tier === 3 ? "class3" : "class2";
    const r = await this.db.prepare(`SELECT ${col}_id AS id, ${col}_operation_id AS op FROM characters WHERE id = ?`).bind(characterId).first<{ id: string | null; op: string | null }>();
    return r?.id == null || r.op == null ? null : { classId: r.id, operationId: r.op };
  }

  private async inTown(accountId: string): Promise<boolean> {
    const r = await this.db
      .prepare(`SELECT 1 AS ok FROM player_positions WHERE account_id = ? AND map_id IN (${marks(this.towns.length)})`)
      .bind(accountId, ...this.towns)
      .first<{ ok: number }>();
    return r !== null;
  }
}
