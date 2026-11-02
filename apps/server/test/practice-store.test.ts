/**
 * Town training ground (P17) on the D1 migrations: the bosses on offer, a practice fight started in town
 * only and resumed rather than doubled, and a real fight played in a BattleRoom that settles with
 * nothing earned or lost (HP not written back, no receipts, everything unlocked).
 */
import { beforeEach, describe, expect, it } from "vitest";
import { DEV_FIXTURE_RULES as R, exampleContentMaps, exampleMapRegistry, type BattleSetup } from "@pmrpg/shared";
import { BattleRoom, MemoryStorage } from "../src/battle-room";
import { CharacterStore } from "../src/character-store";
import { Economy } from "../src/economy";
import type { FrontierBattlePort } from "../src/frontier-store";
import { PracticeStore } from "../src/practice-store";
import { SqliteD1, freshDb, type Db } from "./sqlite-d1";

const A = "acct:a";
const TOWN = "map:dawn_town";
const LORD = "boss:crystal_crab_lord";
const content = exampleContentMaps();
let db: Db;
let eco: Economy;
let chars: CharacterStore;
let practice: PracticeStore;
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

beforeEach(async () => {
  db = freshDb();
  const d1 = new SqliteD1(db);
  const now = () => "2026-10-09T10:00:00.000Z";
  eco = new Economy(d1, R, now);
  chars = new CharacterStore(d1, R, content, now);
  practice = new PracticeStore(d1, { ...content, maps: exampleMapRegistry() }, eco, chars, port, [TOWN]);
  created = [];
  rooms = new Map();
  await eco.devGrant("seed:a", A, { "item:small_potion": 5 });
  await chars.create(A, { operationId: "op_create_a", name: "นัท", classId: "class:guardian", raceId: "race:stonekin", element: "EARTH" });
  at(TOWN);
});

describe("training ground", () => {
  it("offers every field boss with its parts and summons", () => {
    expect(practice.view().bosses).toContainEqual(expect.objectContaining({ bossId: LORD, mapId: "map:dawn_field", parts: ["ก้ามผลึก"], summons: true, phases: 2 }));
  });

  it("starts in town only, at full HP with no items; a retry resumes the same fight and a second one waits", async () => {
    at("map:dawn_field");
    expect(await practice.start(A, { operationId: "practice_01", bossId: LORD })).toMatchObject({ status: "rejected", reason: "NOT_IN_TOWN" });
    at(TOWN);
    expect(await practice.start(A, { operationId: "practice_01", bossId: "boss:nope" })).toMatchObject({ status: "rejected", reason: "NOT_FOUND" });
    db.prepare(`UPDATE characters SET hp = 3 WHERE account_id = ?`).run(A);
    const r = await practice.start(A, { operationId: "practice_01", bossId: LORD });
    expect(r).toMatchObject({ status: "started", resumed: false });
    expect(created[0]!.setup).toMatchObject({ practice: true, bag: {}, boss: { bossId: LORD } });
    // No stored HP/MP in the setup: the fight starts everyone full.
    expect(created[0]!.setup.player.hp).toBeUndefined();
    const again = await practice.start(A, { operationId: "practice_01", bossId: LORD });
    expect(again).toMatchObject({ status: "started", resumed: true, battleId: (r as { battleId: string }).battleId });
    expect(rooms.size).toBe(1);
    expect(await practice.start(A, { operationId: "practice_02", bossId: LORD })).toMatchObject({ status: "rejected", reason: "IN_BATTLE" });
  });

  it("played out and left, it settles with nothing written: HP stays, no receipts, items and team unlocked", async () => {
    db.prepare(`UPDATE characters SET hp = 3 WHERE account_id = ?`).run(A);
    const bag = await eco.balances(A);
    const r = await practice.start(A, { operationId: "practice_01", bossId: LORD });
    if (r.status !== "started") throw new Error(r.reason);
    const room = rooms.get(r.battleId)!;
    let v = await room.view(A);
    expect(v.practice).toBe(true);
    expect(v.units.find((u) => u.unitId === "player")!.hp).toBeGreaterThan(3);
    for (let i = 0; i < 20 && v.status === "active"; i++) {
      const actorId = v.turnOrder[v.turnIndex]!;
      await room.command(A, { commandId: crypto.randomUUID(), sessionGeneration: 0, expectedStateVersion: v.stateVersion, command: actorId === "player" ? { type: "flee", actorId } : { type: "guard", actorId } });
      v = await room.view(A);
    }
    expect(v.status).toBe("fled");
    expect((await room.drainOutbox(eco)).settled).toBe(true);
    expect(await eco.reservation(`res:${r.battleId}`)).toMatchObject({ status: "settled", outcome: "fled" });
    expect(db.prepare(`SELECT hp FROM characters WHERE account_id = ?`).get(A)).toEqual({ hp: 3 });
    expect(db.prepare(`SELECT COUNT(*) AS n FROM reward_receipts`).get()).toEqual({ n: 0 });
    expect(await eco.balances(A)).toEqual(bag);
    expect(await practice.start(A, { operationId: "practice_02", bossId: LORD })).toMatchObject({ status: "started", resumed: false });
  });
});
