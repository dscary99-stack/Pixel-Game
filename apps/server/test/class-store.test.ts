/**
 * Class2 (class-change.ts, P16/P28) on the D1 migrations: the trial starts in town from Lv50 for a
 * branch of the character's own class, runs as a practice boss fight with the trial stat %, and a won
 * trial's branch is taken once: a retried claim answers the same, a second won trial is refused, and
 * two claims racing end with one branch.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { DEV_FIXTURE_RULES as R, createBattle, exampleContentMaps, playerKit, type BattleSetup } from "@pmrpg/shared";
import { BattleRoom, MemoryStorage } from "../src/battle-room";
import { CharacterStore } from "../src/character-store";
import { ClassStore } from "../src/class-store";
import { Economy } from "../src/economy";
import type { FrontierBattlePort } from "../src/frontier-store";
import { SqliteD1, freshDb, type Db } from "./sqlite-d1";

const A = "acct:a";
const TOWN = "map:dawn_town";
const content = exampleContentMaps();
let db: Db;
let eco: Economy;
let chars: CharacterStore;
let classes: ClassStore;
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
/** Stands in for the Battle DO's settlement of a won fight (the room path is covered by the flee test). */
const winTrial = (battleId: string) => db.prepare(`UPDATE battle_reservations SET status = 'settled', outcome = 'victory' WHERE battle_id = ?`).run(battleId);

beforeEach(async () => {
  db = freshDb();
  const d1 = new SqliteD1(db);
  const now = () => "2026-10-09T10:00:00.000Z";
  eco = new Economy(d1, R, now);
  chars = new CharacterStore(d1, R, content, now);
  let tick = 0;
  classes = new ClassStore(d1, R, eco, chars, port, [TOWN], () => `2026-10-09T10:00:${String(tick++).padStart(2, "0")}.000Z`);
  created = [];
  rooms = new Map();
  await chars.create(A, { operationId: "op_create_a", name: "นัท", classId: "class:guardian", raceId: "race:stonekin", element: "EARTH" });
  at(TOWN);
});

const started = async (operationId: string, branchId: string) => {
  const r = await classes.start(A, { operationId, branchId });
  if (r.status !== "started") throw new Error(r.reason);
  return r;
};

describe("Class2 trial", () => {
  it("shows the two branches of the class and opens at Lv50", async () => {
    const v = (await classes.view(A))!;
    expect(v.branches.map((b) => b.id)).toEqual(["class2:bastion", "class2:sentinel"]);
    expect(v).toMatchObject({ class2Id: null, trialLevel: 50, blocked: "LEVEL_TOO_LOW", trial: null });
    expect(await classes.start(A, { operationId: "trial_01", branchId: "class2:bastion" })).toMatchObject({ status: "rejected", reason: "LEVEL_TOO_LOW" });
    await chars.devRaiseLevel(A, 50);
    // P29: Class1 must also be at its job cap.
    expect((await classes.view(A))!).toMatchObject({ blocked: "JOB_TOO_LOW", trialJobLevel: 40 });
    expect(await classes.start(A, { operationId: "trial_01", branchId: "class2:bastion" })).toMatchObject({ status: "rejected", reason: "JOB_TOO_LOW" });
    await chars.devRaiseLevel(A, 50, 39);
    expect((await classes.view(A))!.blocked).toBe("JOB_TOO_LOW");
    await chars.devRaiseLevel(A, 50, 40);
    expect((await classes.view(A))!.blocked).toBeNull();
    expect(await classes.start(A, { operationId: "trial_01", branchId: "class2:breaker" })).toMatchObject({ status: "rejected", reason: "NOT_FOUND" });
    at("map:dawn_field");
    expect(await classes.start(A, { operationId: "trial_01", branchId: "class2:bastion" })).toMatchObject({ status: "rejected", reason: "NOT_IN_TOWN" });
  });

  it("is a practice boss fight with the trial stat %; a retry resumes it, another branch on the same id is refused", async () => {
    await chars.devRaiseLevel(A, 50, 40);
    const r = await started("trial_01", "class2:bastion");
    expect(created[0]!.setup).toMatchObject({ practice: true, classTrial: true, bag: {}, boss: { bossId: "boss:crystal_crab_lord" } });
    const v = await rooms.get(r.battleId)!.view(A);
    const lord = v.units.find((u) => u.unitId === "e1")!;
    // The same fight without the trial flag: the lord's HP is the trial stat % (150) smaller.
    const plain = createBattle(R, content, { ...created[0]!.setup, classTrial: undefined });
    if (!plain.ok) throw new Error(plain.message);
    const base = plain.state.units.find((u) => u.unitId === "e1")!.stats.maxHp;
    expect(Math.abs(lord.stats.maxHp - Math.floor((base * R.provisional.classChange.value.trialStatPct) / 100))).toBeLessThanOrEqual(1);
    expect(await classes.start(A, { operationId: "trial_01", branchId: "class2:bastion" })).toMatchObject({ status: "started", resumed: true, battleId: r.battleId });
    expect(await classes.start(A, { operationId: "trial_01", branchId: "class2:sentinel" })).toMatchObject({ status: "rejected", reason: "INVALID_REQUEST" });
    expect(await classes.start(A, { operationId: "trial_02", branchId: "class2:sentinel" })).toMatchObject({ status: "rejected", reason: "IN_BATTLE" });
    expect((await classes.view(A))!.trial).toMatchObject({ operationId: "trial_01", branchId: "class2:bastion", status: "started" });
  });

  it("a fled trial cannot be claimed and settles with nothing written", async () => {
    await chars.devRaiseLevel(A, 50, 40);
    const r = await started("trial_01", "class2:bastion");
    const room = rooms.get(r.battleId)!;
    let v = await room.view(A);
    for (let i = 0; i < 30 && v.status === "active"; i++) {
      const actorId = v.turnOrder[v.turnIndex]!;
      await room.command(A, { commandId: crypto.randomUUID(), sessionGeneration: 0, expectedStateVersion: v.stateVersion, command: actorId === "player" ? { type: "flee", actorId } : { type: "guard", actorId } });
      v = await room.view(A);
    }
    expect(v.status).toBe("fled");
    expect((await room.drainOutbox(eco)).settled).toBe(true);
    expect(await classes.claim(A, { operationId: "trial_01" })).toMatchObject({ status: "rejected", reason: "NOT_WON" });
    expect((await classes.view(A))!.trial?.status).toBe("lost");
    expect(db.prepare(`SELECT COUNT(*) AS n FROM reward_receipts`).get()).toEqual({ n: 0 });
  });

  it("a won trial's branch is taken once; a retry answers the same and the branch tree opens", async () => {
    await chars.devRaiseLevel(A, 50, 40);
    const r = await started("trial_01", "class2:bastion");
    expect(await classes.claim(A, { operationId: "trial_01" })).toMatchObject({ status: "rejected", reason: "NOT_WON" });
    winTrial(r.battleId);
    expect((await classes.view(A))!.trial?.status).toBe("won");
    expect(await classes.claim(A, { operationId: "trial_01" })).toEqual({ status: "claimed", class2Id: "class2:bastion" });
    expect(await classes.claim(A, { operationId: "trial_01" })).toEqual({ status: "claimed", class2Id: "class2:bastion" });
    expect(await classes.claim(A, { operationId: "trial_nope" })).toMatchObject({ status: "rejected", reason: "NOT_FOUND" });
    const c = (await chars.get(A))!;
    expect(c.class2Id).toBe("class2:bastion");
    // Class2 job 1 gives a point on the branch tree, which it could not reach before.
    expect(c.jobExp).toEqual([expect.any(Number), 0]);
    const learnt = await chars.learnSkill(A, { expectedVersion: c.version, skillId: "skill:c2_bastion_wall" });
    expect(learnt).toMatchObject({ status: "saved", character: { skills: { "skill:c2_bastion_wall": 1 } } });
    if (learnt.status !== "saved") throw new Error();
    expect(playerKit(c.classId, c.raceId, c.class2Id, learnt.character.skills).skillIds).toContain("skill:c2_bastion_wall");
    expect((await classes.view(A))!).toMatchObject({ class2Id: "class2:bastion", blocked: "ALREADY_CHOSEN", trial: { status: "claimed" } });
    expect(await classes.start(A, { operationId: "trial_02", branchId: "class2:sentinel" })).toMatchObject({ status: "rejected", reason: "ALREADY_CHOSEN" });
  });

  it("two won trials claimed at the same time end with exactly one branch", async () => {
    await chars.devRaiseLevel(A, 50, 40);
    winTrial((await started("trial_01", "class2:bastion")).battleId);
    winTrial((await started("trial_02", "class2:sentinel")).battleId);
    const [x, y] = await Promise.all([classes.claim(A, { operationId: "trial_01" }), classes.claim(A, { operationId: "trial_02" })]);
    const wins = [x, y].filter((r) => r.status === "claimed");
    expect(wins).toHaveLength(1);
    expect([x, y].filter((r) => r.status === "rejected" && r.reason === "ALREADY_CHOSEN")).toHaveLength(1);
    const c = (await chars.get(A))!;
    expect(c.class2Id).toBe((wins[0] as { class2Id: string }).class2Id);
    // The loser's retry still answers ALREADY_CHOSEN; the winner's retry the same branch.
    const loserOp = x.status === "claimed" ? "trial_02" : "trial_01";
    expect(await classes.claim(A, { operationId: loserOp })).toMatchObject({ status: "rejected", reason: "ALREADY_CHOSEN" });
    expect(db.prepare(`SELECT COUNT(*) AS n FROM class_trials WHERE status = 'claimed'`).get()).toEqual({ n: 1 });
  });
});
