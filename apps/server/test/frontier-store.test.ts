/**
 * Weekly tower on the D1 migrations (node:sqlite stand-in): one entry a week even when raced, floors
 * started through a reservation and resumed rather than doubled, settlement that advances or ends the
 * run exactly once (retries, races, a crashed batch), HP/MP carried with the 5-floor checkpoint, boss
 * floors and their first clear, leaving and resuming, a voided fight, and a real fight end to end.
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  DEV_FIXTURE_RULES as R,
  EXAMPLE_FRONTIER,
  chooseAutoCommand,
  exampleContentMaps,
  exampleMapRegistry,
  frontierFloorSetup,
  rollFrontierFloor,
  type BattleSetup,
} from "@pmrpg/shared";
import { BattleRoom, MemoryStorage } from "../src/battle-room";
import { CharacterStore } from "../src/character-store";
import { Economy } from "../src/economy";
import { FrontierStore, type FrontierBattlePort } from "../src/frontier-store";
import { JournalStore } from "../src/journal-store";
import { SqliteD1, freshDb, type Db } from "./sqlite-d1";
import type { SqlBound } from "../src/reward-ledger";
import type { AllyResult } from "../src/economy";

const A = "acct:a";
const TOWN = "map:dawn_town";
const content = exampleContentMaps();
const towerContent = { ...content, maps: exampleMapRegistry() };
let db: Db;
let d1: FlakyD1;
let clock: string;
let eco: Economy;
let chars: CharacterStore;
let tower: FrontierStore;
let created: { setup: BattleSetup; reservationId: string }[];
let rooms: Map<string, BattleRoom>;

/** A D1 stand-in whose next batch can be made to fail (a crash before commit). */
class FlakyD1 extends SqliteD1 {
  failNextBatch = false;
  override async batch(statements: SqlBound[]): Promise<unknown[]> {
    if (this.failNextBatch) {
      this.failNextBatch = false;
      throw new Error("simulated D1 failure");
    }
    return super.batch(statements);
  }
}

/** Records each create, and holds a real BattleRoom per fight so a test can play it out. */
const port: FrontierBattlePort = {
  async create(accountId, setup, reservationId) {
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
const pet = (id: string, speciesId: string, element: string) =>
  db
    .prepare(
      `INSERT INTO monster_instances (id, species_id, owner_id, current_level, element, primary_stats_json, origin_json, created_operation_id)
       VALUES (?, ?, ?, 1, ?, '{"STR":10,"VIT":10,"INT":10,"DEX":10,"AGI":10,"SPI":10}', '{"kind":"capture","at":"2026-10-03T00:00:00Z"}', ?)`,
    )
    .run(id, speciesId, A, element, `seed:${id}`);
const runs = () => db.prepare(`SELECT * FROM frontier_runs`).all() as Record<string, unknown>[];
const enter = (operationId: string) => tower.enter(A, { operationId });
const view = async () => (await tower.view(A))!;
async function started(floor: number) {
  const v = await view();
  const r = await tower.startFloor(A, { runId: v.run!.runId, floor });
  if (r.status !== "started") throw new Error(`${r.reason}: ${r.message}`);
  return r;
}
/** The fight ends as the Battle DO would report it: activation, then the settlement in D1. */
async function finish(battleId: string, outcome: "victory" | "defeat", allies: AllyResult[] = [{ unitId: "player", instanceId: null, hp: 100, mp: 5, ko: false, maxHp: 1000, maxMp: 50 }]) {
  const rid = `res:${battleId}`;
  expect(await eco.activate(rid)).toMatchObject({ status: "active" });
  expect(await eco.settle({ reservationId: rid, battleId, accountId: A, outcome, unused: {}, allies, entitlementIds: [] })).toMatchObject({ status: "settled" });
}

beforeEach(async () => {
  db = freshDb();
  d1 = new FlakyD1(db);
  clock = "2026-10-06T10:00:00.000Z";
  const now = () => clock;
  eco = new Economy(d1, R, now);
  chars = new CharacterStore(d1, R, content, now);
  tower = new FrontierStore(d1, R, EXAMPLE_FRONTIER, towerContent, eco, chars, port, new JournalStore(d1, R, content, now), now);
  created = [];
  rooms = new Map();
  await eco.devGrant("seed:a", A, { "item:small_potion": 5, "item:supply_mole_capture": 3 });
  await chars.create(A, { operationId: "op_create_a", name: "นัท", classId: "class:guardian", raceId: "race:stonekin", element: "EARTH" });
  at(TOWN);
});

describe("entry: once a week, in town", () => {
  it("enters once; a retry of the same request gets the same run; a second entry is refused", async () => {
    const r = await enter("enter_0001");
    expect(r).toMatchObject({ status: "entered", replayed: false, view: { entryUsed: true, weekId: "w:2026-10-05", run: { floor: 1, best: 0, status: "open", inside: true } } });
    expect(await enter("enter_0001")).toMatchObject({ status: "entered", replayed: true });
    expect(await enter("enter_0002")).toMatchObject({ status: "rejected", reason: "ALREADY_ENTERED" });
    expect(runs()).toHaveLength(1);
  });

  it("two (or more) concurrent entries make exactly one run", async () => {
    const out = await Promise.all(["enter_r1", "enter_r2", "enter_r3"].map((id) => enter(id)));
    expect(out.filter((r) => r.status === "entered")).toHaveLength(1);
    expect(out.filter((r) => r.status === "rejected" && r.reason === "ALREADY_ENTERED")).toHaveLength(2);
    expect(runs()).toHaveLength(1);
    const same = await Promise.all([enter("enter_r9"), enter("enter_r9")]);
    expect(same.every((r) => r.status === "rejected")).toBe(true);
  });

  it("the same request raced with itself gives both callers the one run", async () => {
    const out = await Promise.all([enter("enter_same"), enter("enter_same")]);
    expect(out.map((r) => r.status)).toEqual(["entered", "entered"]);
    expect(runs()).toHaveLength(1);
  });

  it("is refused in the field and without a character; the next week (Monday 21:00 UTC) opens it again", async () => {
    at("map:dawn_field");
    expect(await enter("enter_f1")).toMatchObject({ status: "rejected", reason: "NOT_IN_TOWN" });
    expect(runs()).toHaveLength(0);
    expect(await tower.enter("acct:nobody", { operationId: "enter_x1" })).toMatchObject({ reason: "NO_CHARACTER" });
    at(TOWN);
    expect(await enter("enter_w1")).toMatchObject({ status: "entered" });
    clock = "2026-10-12T20:59:59.000Z";
    expect(await enter("enter_w2")).toMatchObject({ reason: "ALREADY_ENTERED" });
    clock = "2026-10-12T21:00:00.000Z";
    expect((await view()).entryUsed).toBe(false);
    expect(await enter("enter_w2")).toMatchObject({ status: "entered", view: { weekId: "w:2026-10-12", run: { floor: 1 } } });
  });
});

describe("floors", () => {
  it("starts floor 1 from the roll for (run, floor), reserves once, and a repeat or a race resumes the same fight", async () => {
    await enter("enter_0001");
    const runId = (await view()).run!.runId;
    const [a, b] = await Promise.all([tower.startFloor(A, { runId, floor: 1 }), tower.startFloor(A, { runId, floor: 1 })]);
    expect(a).toMatchObject({ status: "started", floor: 1, boss: false });
    expect(b).toMatchObject({ status: "started", floor: 1 });
    const id = a.status === "started" ? a.battleId : "";
    expect(b.status === "started" && b.battleId).toBe(id);
    expect(await tower.startFloor(A, { runId, floor: 1 })).toMatchObject({ status: "started", battleId: id, resumed: true });
    expect(db.prepare(`SELECT COUNT(*) AS n FROM battle_reservations`).get()).toEqual({ n: 1 });
    const setup = created[0]!.setup;
    expect(setup).toMatchObject({ originMode: "manual", frontier: { floor: 1 } });
    expect(setup.enemies).toEqual(frontierFloorSetup(rollFrontierFloor(R, EXAMPLE_FRONTIER, content, runId, 1)).enemies);
    expect(new Set(created.map((c) => c.setup.battleId))).toEqual(new Set([id]));
    expect(await tower.startFloor(A, { runId, floor: 2 })).toMatchObject({ status: "rejected", reason: "STALE_FLOOR" });
    expect(await tower.leave(A, { runId })).toMatchObject({ reason: "IN_BATTLE" });
  });

  it("a win advances one floor exactly once, however often or concurrently it is settled, and records the best floor", async () => {
    await enter("enter_0001");
    const s = await started(1);
    await finish(s.battleId, "victory");
    const applied = await Promise.all([tower.settle(A), tower.settle(A), tower.settle(A)]);
    expect(applied.reduce((x, y) => x + y, 0)).toBe(1);
    expect((await view()).run).toMatchObject({ floor: 2, best: 1, status: "open", battleId: null, vitals: { player: { hp: 100, mp: 5 } } });
    expect(db.prepare(`SELECT COUNT(*) AS n FROM frontier_floor_results`).get()).toEqual({ n: 1 });
    // The next floor fights with the HP/MP the last one ended with (the town rest does not refill a run).
    const s2 = await started(2);
    expect(created.at(-1)!.setup.player).toMatchObject({ hp: 100, mp: 5 });
    expect(s2.battleId).not.toBe(s.battleId);
  });

  it("recovers from a crashed settlement batch: nothing half-applied, the next read applies it", async () => {
    await enter("enter_0001");
    const s = await started(1);
    await finish(s.battleId, "victory");
    d1.failNextBatch = true;
    await expect(tower.view(A)).rejects.toThrow(/simulated/);
    expect(runs()[0]).toMatchObject({ floor: 1, battle_id: s.battleId, best_floor: 0 });
    expect(db.prepare(`SELECT COUNT(*) AS n FROM frontier_floor_results`).get()).toEqual({ n: 0 });
    expect((await view()).run).toMatchObject({ floor: 2, best: 1, battleId: null });
  });

  it("every 5th floor cleared gives 30% HP/MP back to those standing; a knocked-out companion stays down", async () => {
    pet("mon:crab", "species:armor_crab", "EARTH");
    const ch = (await chars.get(A))!;
    expect(await chars.setTeam(A, { expectedVersion: ch.version, companionIds: ["mon:crab"] })).toMatchObject({ status: "saved" });
    await enter("enter_0001");
    await tower.devJump(A, 5);
    const s = await started(5);
    await finish(s.battleId, "victory", [
      { unitId: "player", instanceId: null, hp: 100, mp: 5, ko: false, maxHp: 1000, maxMp: 50 },
      { unitId: "ally:mon:crab", instanceId: "mon:crab", hp: 0, mp: 3, ko: true, maxHp: 300, maxMp: 30 },
    ]);
    expect((await view()).run!.vitals).toEqual({ player: { hp: 400, mp: 20 }, companions: { "mon:crab": { hp: 0, mp: 3 } } });
    await started(6);
    expect(created.at(-1)!.setup.companions[0]).toMatchObject({ hp: 0, mp: 3 });
  });

  it("refuses another team, the field, and a wrong run id", async () => {
    pet("mon:crab", "species:armor_crab", "EARTH");
    await enter("enter_0001");
    const runId = (await view()).run!.runId;
    const ch = (await chars.get(A))!;
    await chars.setTeam(A, { expectedVersion: ch.version, companionIds: ["mon:crab"] });
    expect(await tower.startFloor(A, { runId, floor: 1 })).toMatchObject({ reason: "TEAM_CHANGED" });
    await chars.setTeam(A, { expectedVersion: ch.version + 1, companionIds: [] });
    at("map:dawn_field");
    expect(await tower.startFloor(A, { runId, floor: 1 })).toMatchObject({ reason: "NOT_IN_TOWN" });
    at(TOWN);
    expect(await tower.startFloor(A, { runId: "frun_other", floor: 1 })).toMatchObject({ reason: "NO_RUN" });
    expect(created).toHaveLength(0);
    expect(await tower.startFloor(A, { runId, floor: 1 })).toMatchObject({ status: "started" });
  });

  it("a boss floor is the guardian's boss fight; clearing it records the first clear once", async () => {
    await enter("enter_0001");
    await tower.devJump(A, 10);
    expect((await view()).run).toMatchObject({ floor: 10, nextIsBoss: true });
    const s = await started(10);
    expect(s.boss).toBe(true);
    expect(created.at(-1)!.setup).toMatchObject({ enemies: [], boss: { bossId: "boss:rift_spire_warden" }, frontier: { floor: 10 } });
    await finish(s.battleId, "victory");
    await Promise.all([tower.settle(A), tower.settle(A)]);
    expect(db.prepare(`SELECT character_id, frontier_id, floor FROM frontier_first_clears`).all()).toEqual([
      { character_id: (await chars.get(A))!.id, frontier_id: EXAMPLE_FRONTIER.id, floor: 10 },
    ]);
    expect((await view()).run).toMatchObject({ floor: 11, best: 10 });
    // The journal met the guardian and its adds.
    expect((db.prepare(`SELECT COUNT(*) AS n FROM journal_seen WHERE account_id = ?`).get(A) as { n: number }).n).toBeGreaterThanOrEqual(2);
  });

  it("a loss ends the run for the week; no more floors and no second entry", async () => {
    await enter("enter_0001");
    const s = await started(1);
    await finish(s.battleId, "defeat");
    expect((await view()).run).toMatchObject({ status: "ended", endReason: "defeat", best: 0, battleId: null });
    expect(await tower.startFloor(A, { runId: (await view()).run!.runId, floor: 1 })).toMatchObject({ reason: "RUN_ENDED" });
    expect(await enter("enter_0002")).toMatchObject({ reason: "ALREADY_ENTERED" });
  });

  it("clearing the last floor ends the run at the summit", async () => {
    await enter("enter_0001");
    await tower.devJump(A, 100);
    const s = await started(100);
    await finish(s.battleId, "victory");
    expect((await view()).run).toMatchObject({ status: "ended", endReason: "summit", best: 100, floor: 101 });
  });

  it("leaving between floors keeps the run; the next floor resumes it", async () => {
    await enter("enter_0001");
    const runId = (await view()).run!.runId;
    const s = await started(1);
    await finish(s.battleId, "victory");
    expect(await tower.leave(A, { runId })).toMatchObject({ status: "left", view: { run: { inside: false, floor: 2, status: "open" } } });
    expect(await enter("enter_0002")).toMatchObject({ reason: "ALREADY_ENTERED" });
    expect(await tower.startFloor(A, { runId, floor: 2 })).toMatchObject({ status: "started", floor: 2 });
    expect((await view()).run).toMatchObject({ inside: true });
  });

  it("a floor fight voided before it started (reservation released) is started again as a new attempt", async () => {
    await enter("enter_0001");
    const s = await started(1);
    expect(await eco.release(`res:${s.battleId}`)).toMatchObject({ status: "released" });
    const again = await started(1);
    expect(again.battleId).not.toBe(s.battleId);
    expect(runs()[0]).toMatchObject({ floor: 1, attempt: 2, battle_id: again.battleId });
  });
});

describe("a real floor fight end to end", () => {
  it("BattleRoom plays it, the outbox delivers rewards and settlement to D1, and the run follows the outcome", async () => {
    await enter("enter_0001");
    const s = await started(1);
    const room = rooms.get(s.battleId)!;
    for (let i = 0; i < 400; i++) {
      const v = await room.view(A);
      if (v.status !== "active") break;
      const cmd = chooseAutoCommand(v as never)!;
      await room.command(A, { commandId: crypto.randomUUID(), sessionGeneration: 0, expectedStateVersion: v.stateVersion, command: cmd });
    }
    const end = await room.view(A);
    expect(end.frontier).toEqual({ floor: 1, statPct: 104 });
    expect((await room.drainOutbox(eco)).settled).toBe(true);
    const run = (await view()).run!;
    if (end.status === "victory") expect(run).toMatchObject({ floor: 2, best: 1, status: "open" });
    else expect(run).toMatchObject({ status: "ended", endReason: "defeat" });
    expect(db.prepare(`SELECT COUNT(*) AS n FROM frontier_floor_results`).get()).toEqual({ n: 1 });
  });
});
