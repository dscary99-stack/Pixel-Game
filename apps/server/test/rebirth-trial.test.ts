/**
 * The companion's Rebirth trial (P37, O04's บททดสอบ) on the D1 migrations: started in town with the
 * companion in the team at Lv200 and the stage's licence level, a practice fight against the tyrant at
 * the stage's stat %, and the Rebirth itself (TownServices.rebirth) needs that stage's trial won with
 * the companion still standing; nothing is charged without it.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { DEV_FIXTURE_RULES as R, REBIRTH_TRIAL_BOSS_ID, exampleContentMaps, expForLevel, rebirthTrialId, type BattleSetup } from "@pmrpg/shared";
import { BattleRoom, MemoryStorage } from "../src/battle-room";
import { CharacterStore } from "../src/character-store";
import { ClassStore } from "../src/class-store";
import { Economy } from "../src/economy";
import type { FrontierBattlePort } from "../src/frontier-store";
import { TownServices } from "../src/town-services";
import { SqliteD1, freshDb, type Db } from "./sqlite-d1";

const A = "acct:a";
const TOWN = "map:dawn_town";
const PET = "mon:crab";
const content = exampleContentMaps();
let db: Db;
let eco: Economy;
let chars: CharacterStore;
let classes: ClassStore;
let town: TownServices;
let created: { setup: BattleSetup; reservationId: string }[];
let rooms: Map<string, BattleRoom>;

const port: FrontierBattlePort = {
  async create(_accountId, setup, reservationId) {
    created.push({ setup, reservationId });
    let room = rooms.get(setup.battleId);
    if (room === undefined) {
      let t = 0;
      room = new BattleRoom(new MemoryStorage(), R, content, "dev", () => (t += 1000));
      rooms.set(setup.battleId, room);
    }
    await room.create(setup, reservationId);
    return { ok: true };
  },
};
const at = (mapId: string) =>
  db
    .prepare(
      `INSERT INTO player_positions (account_id, map_id, channel, x, y, generation, updated_at) VALUES (?, ?, 1, 1, 1, 1, 'x')
       ON CONFLICT (account_id) DO UPDATE SET map_id = excluded.map_id`,
    )
    .run(A, mapId);
const petXp = (level: number) => db.prepare(`UPDATE monster_instances SET xp = ? WHERE id = ?`).run(expForLevel(R, "companion", level), PET);
const stage = () => (db.prepare(`SELECT rebirth_stage AS s FROM monster_instances WHERE id = ?`).get(PET) as { s: number }).s;
const rebirth = (operationId: string, expectedStage = 0) => town.rebirth(A, { operationId, companionId: PET, expectedStage, branch: "A" });
/** Stands in for the Battle DO's settlement (the room's own settlement is covered by the flee test). */
const settle = async (battleId: string, outcome: "victory" | "defeat", standing: string[], s = 1) => {
  const r = db.prepare(`SELECT reservation_id AS id FROM battle_reservations WHERE battle_id = ?`).get(battleId) as { id: string };
  await eco.activate(r.id);
  const done = await eco.settle({ reservationId: r.id, battleId, accountId: A, outcome, unused: {}, allies: [], entitlementIds: [], rebirthTrial: { stage: s, standing } });
  expect(done.status).toBe("settled");
};
const started = async (operationId: string) => {
  const r = await classes.startRebirth(A, { operationId, companionId: PET });
  if (r.status !== "started") throw new Error(r.reason);
  return r;
};

beforeEach(async () => {
  db = freshDb();
  const d1 = new SqliteD1(db);
  const now = () => "2026-10-17T10:00:00.000Z";
  eco = new Economy(d1, R, now);
  chars = new CharacterStore(d1, R, content, now);
  town = new TownServices(d1, R, content, [TOWN], now);
  let tick = 0;
  classes = new ClassStore(d1, R, eco, chars, port, [TOWN], () => `2026-10-17T10:00:${String(tick++).padStart(2, "0")}.000Z`);
  created = [];
  rooms = new Map();
  const made = await chars.create(A, { operationId: "op_create_a", name: "นัท", classId: "class:striker", raceId: "race:human", element: "FIRE" });
  if (made.status !== "created") throw new Error("create failed");
  await chars.devRaiseLevel(A, 100);
  db.prepare(
    `INSERT INTO monster_instances (id, species_id, owner_id, current_level, xp, element, primary_stats_json, origin_json, created_operation_id, growth_seed, growth_history_version)
     VALUES (?, 'species:armor_crab', ?, 200, ?, 'EARTH', '{}', '{"kind":"capture","at":"x"}', 'seed:crab', 'g1', 2)`,
  ).run(PET, A, expForLevel(R, "companion", 200));
  db.prepare(`INSERT INTO character_team (character_id, position, monster_instance_id, species_id, row, slot) VALUES (?, 0, ?, 'species:armor_crab', 'back', 1)`).run(made.character.id, PET);
  await eco.devGrant("seed:a", A, { "item:crab_shell": 300 });
  await town.devGrantCoins("coins:a", A, 1_000_000);
  at(TOWN);
});

describe("Rebirth trial (P37)", () => {
  it("needs the companion in the team, Lv200, the licence level, a stage left and town", async () => {
    petXp(199);
    expect(await classes.startRebirth(A, { operationId: "rtrial_low", companionId: PET })).toMatchObject({ reason: "LEVEL_TOO_LOW" });
    petXp(200);
    db.prepare(`UPDATE characters SET xp = ?, level = 99`).run(expForLevel(R, "player", 99));
    expect(await classes.startRebirth(A, { operationId: "rtrial_lic", companionId: PET })).toMatchObject({ reason: "PLAYER_LEVEL_TOO_LOW" });
    await chars.devRaiseLevel(A, 100);
    at("map:dawn_field");
    expect(await classes.startRebirth(A, { operationId: "rtrial_away", companionId: PET })).toMatchObject({ reason: "NOT_IN_TOWN" });
    at(TOWN);
    expect(await classes.startRebirth(A, { operationId: "rtrial_none", companionId: "mon:nope" })).toMatchObject({ reason: "NOT_IN_TEAM" });
    db.prepare(`UPDATE monster_instances SET rebirth_stage = 3 WHERE id = ?`).run(PET);
    expect(await classes.startRebirth(A, { operationId: "rtrial_max", companionId: PET })).toMatchObject({ reason: "MAX_REBIRTH" });
    expect(created).toHaveLength(0);
  });

  it("is a practice fight against the tyrant at the stage's stat %; a retry resumes it and the class trial view ignores it", async () => {
    const r = await started("rtrial_0001");
    expect(r.branchId).toBe(rebirthTrialId(PET, 1));
    expect(created[0]!.setup).toMatchObject({ practice: true, classTrial: true, bag: {}, boss: { bossId: REBIRTH_TRIAL_BOSS_ID }, rebirthTrial: { stage: 1 } });
    expect(created[0]!.setup.companions.map((c) => c.instance.id)).toEqual([PET]);
    const v = await rooms.get(r.battleId)!.view(A);
    expect(v.enemyStatPct).toBe(R.provisional.rebirthTrial.value.statPct[0]);
    expect(await classes.startRebirth(A, { operationId: "rtrial_0001", companionId: PET })).toMatchObject({ status: "started", resumed: true, battleId: r.battleId });
    expect(await classes.startRebirth(A, { operationId: "rtrial_0001", companionId: "mon:other" })).toMatchObject({ reason: "INVALID_REQUEST" });
    expect(await classes.startRebirth(A, { operationId: "rtrial_0002", companionId: PET })).toMatchObject({ reason: "IN_BATTLE" });
    expect(await classes.start(A, { operationId: "rtrial_0003", branchId: r.branchId })).toMatchObject({ reason: "INVALID_REQUEST" });
    expect(await classes.claim(A, { operationId: "rtrial_0001" })).toMatchObject({ reason: "INVALID_REQUEST" });
    expect((await classes.view(A))!.trial).toBeNull();
    expect(await classes.rebirthTrials(A)).toEqual([{ companionId: PET, stage: 1, operationId: "rtrial_0001", battleId: r.battleId, status: "started" }]);
  });

  it("a fled trial settles with who stood, writes nothing, and the Rebirth stays shut", async () => {
    const r = await started("rtrial_flee");
    const room = rooms.get(r.battleId)!;
    let v = await room.view(A);
    for (let i = 0; i < 40 && v.status === "active"; i++) {
      const actorId = v.turnOrder[v.turnIndex]!;
      await room.command(A, { commandId: crypto.randomUUID(), sessionGeneration: 0, expectedStateVersion: v.stateVersion, command: actorId === "player" ? { type: "flee", actorId } : { type: "guard", actorId } });
      v = await room.view(A);
    }
    expect(v.status).toBe("fled");
    expect((await room.drainOutbox(eco)).settled).toBe(true);
    expect(await eco.reservation(`res:${r.battleId}`)).toMatchObject({ status: "settled", outcome: "fled", rebirthTrial: { stage: 1, standing: [PET] } });
    expect((await classes.rebirthTrials(A))![0]!.status).toBe("lost");
    expect(await rebirth("rebirth_fled")).toMatchObject({ status: "rejected", reason: "TRIAL_REQUIRED" });
    expect(db.prepare(`SELECT hp FROM monster_instances WHERE id = ?`).get(PET)).toEqual({ hp: null });
  });

  it("a win with the companion down does not count; a win with it standing opens one Rebirth, and the next stage needs its own trial", async () => {
    expect(await rebirth("rebirth_early")).toMatchObject({ reason: "TRIAL_REQUIRED" });
    const down = await started("rtrial_down");
    await settle(down.battleId, "victory", []);
    expect((await classes.rebirthTrials(A))![0]!.status).toBe("lost");
    expect(await rebirth("rebirth_down")).toMatchObject({ reason: "TRIAL_REQUIRED" });
    const coins = await town.coins(A);

    const up = await started("rtrial_up");
    await settle(up.battleId, "victory", [PET]);
    expect((await classes.rebirthTrials(A))![0]).toMatchObject({ operationId: "rtrial_up", status: "won" });
    // Two requests race: one Rebirth lands; a retry of it replays.
    const r = await Promise.all([rebirth("rebirth_r1"), rebirth("rebirth_r2")]);
    expect(r.map((x) => x.status).sort()).toEqual(["done", "rejected"]);
    const winner = r[0]!.status === "done" ? "rebirth_r1" : "rebirth_r2";
    expect(await rebirth(winner)).toMatchObject({ status: "done", replayed: true });
    expect(stage()).toBe(1);
    expect(await town.coins(A)).toBe(coins - R.provisional.rebirthRequirements.value.coins[0]);

    // Stage 2: the Lv150 licence and a new won trial for stage 2 (the stage 1 win does not carry over).
    petXp(200);
    await chars.devRaiseLevel(A, 150);
    expect(await rebirth("rebirth_s2a", 1)).toMatchObject({ reason: "TRIAL_REQUIRED" });
    const s2 = await started("rtrial_s2");
    expect(s2.branchId).toBe(rebirthTrialId(PET, 2));
    expect(created.at(-1)!.setup.rebirthTrial).toEqual({ stage: 2 });
    await settle(s2.battleId, "victory", [PET], 2);
    expect(await rebirth("rebirth_s2b", 1)).toMatchObject({ status: "done" });
    expect(stage()).toBe(2);
  });

  it("a trial won for another companion does not open this one", async () => {
    const OTHER = "mon:mole";
    db.prepare(
      `INSERT INTO monster_instances (id, species_id, owner_id, current_level, xp, element, primary_stats_json, origin_json, created_operation_id, growth_seed, growth_history_version)
       VALUES (?, 'species:supply_mole', ?, 200, ?, 'EARTH', '{}', '{"kind":"capture","at":"x"}', 'seed:mole', 'g2', 2)`,
    ).run(OTHER, A, expForLevel(R, "companion", 200));
    const id = (db.prepare(`SELECT id FROM characters WHERE account_id = ?`).get(A) as { id: string }).id;
    db.prepare(`INSERT INTO character_team (character_id, position, monster_instance_id, species_id, row, slot) VALUES (?, 1, ?, 'species:supply_mole', 'back', 2)`).run(id, OTHER);
    const r = await classes.startRebirth(A, { operationId: "rtrial_mole", companionId: OTHER });
    if (r.status !== "started") throw new Error(r.reason);
    // Both stood at the end, but the trial was the mole's.
    await settle(r.battleId, "victory", [PET, OTHER]);
    expect(await rebirth("rebirth_other")).toMatchObject({ reason: "TRIAL_REQUIRED" });
    expect((await classes.rebirthTrials(A))!.map((t) => [t.companionId, t.status])).toEqual([[OTHER, "won"]]);
  });
});
