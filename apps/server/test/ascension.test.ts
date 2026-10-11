/**
 * Divine awakening (ascension.ts, P31) on the D1 migrations: the race trial starts like the class
 * trials (Lv200 + Class3, the character's own race), and the claim is a town service that pays coins
 * and materials once: a retry replays, a second claim is refused, two claims racing end with one path
 * and one charge. The path switch costs coins and needs the path the player saw.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { DEV_FIXTURE_RULES as R, exampleContentMaps, playerSetup, type BattleSetup } from "@pmrpg/shared";
import { BattleRoom, MemoryStorage } from "../src/battle-room";
import { CharacterStore } from "../src/character-store";
import { ClassStore } from "../src/class-store";
import { Economy } from "../src/economy";
import type { FrontierBattlePort } from "../src/frontier-store";
import { TownServices } from "../src/town-services";
import { SqliteD1, freshDb, type Db } from "./sqlite-d1";

const A = "acct:a";
const TOWN = "map:dawn_town";
const content = exampleContentMaps();
const asc = R.provisional.ascension.value;
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
const winTrial = (battleId: string) => db.prepare(`UPDATE battle_reservations SET status = 'settled', outcome = 'victory' WHERE battle_id = ?`).run(battleId);
const coins = () => town.coins(A);
const cores = () => (db.prepare(`SELECT COALESCE(SUM(delta), 0) AS q FROM item_ledger WHERE account_id = ? AND item_id = 'item:rift_core'`).get(A) as { q: number }).q;

beforeEach(async () => {
  db = freshDb();
  const d1 = new SqliteD1(db);
  const now = () => "2026-10-11T10:00:00.000Z";
  eco = new Economy(d1, R, now);
  chars = new CharacterStore(d1, R, content, now);
  let tick = 0;
  classes = new ClassStore(d1, R, eco, chars, port, [TOWN], () => `2026-10-11T10:00:${String(tick++).padStart(2, "0")}.000Z`);
  town = new TownServices(d1, R, content, [TOWN], now);
  created = [];
  rooms = new Map();
  await chars.create(A, { operationId: "op_create_a", name: "นัท", classId: "class:guardian", raceId: "race:stonekin", element: "EARTH" });
  at(TOWN);
});

const claimClass = async (operationId: string, branchId: string) => {
  const r = await classes.start(A, { operationId, branchId });
  if (r.status !== "started") throw new Error(r.reason);
  winTrial(r.battleId);
  expect(await classes.claim(A, { operationId })).toMatchObject({ status: "claimed" });
};
/** Class2 bastion, Class3 aegis, then the given level. */
const toClass3 = async (level: number) => {
  await chars.devRaiseLevel(A, 50, 50);
  await claimClass("trial_c2", "class2:bastion");
  await chars.devRaiseLevel(A, 120, 70);
  await claimClass("trial_c3", "class3:aegis_sovereign");
  await chars.devRaiseLevel(A, level);
};
const wonRaceTrial = async (operationId = "trial_asc") => {
  const r = await classes.start(A, { operationId, branchId: "ascend:stonekin" });
  if (r.status !== "started") throw new Error(r.reason);
  winTrial(r.battleId);
  return r;
};
const pay = async (tag: string, coinsN: number = asc.coins, coresN = 10) => {
  await town.devGrantCoins(`coins:${tag}`, A, coinsN);
  await eco.devGrant(`cores:${tag}`, A, { "item:rift_core": coresN });
};
const claim = (operationId: string, path: "a" | "b" = "a", trialOperationId = "trial_asc", expectedCoins: number = asc.coins) => town.ascend(A, { operationId, trialOperationId, path, expectedCoins });

describe("divine awakening trial", () => {
  it("needs a Class3 and Lv200, the character's own race; it is the tyrant at the ascension stat %", async () => {
    expect((await classes.view(A))!.ascension).toMatchObject({ blocked: "NO_CLASS3", pathId: null, level: 200 });
    expect(await classes.start(A, { operationId: "trial_t1", branchId: "ascend:stonekin" })).toMatchObject({ status: "rejected", reason: "NO_CLASS3" });
    await toClass3(199);
    expect(await classes.start(A, { operationId: "trial_t1", branchId: "ascend:stonekin" })).toMatchObject({ status: "rejected", reason: "LEVEL_TOO_LOW" });
    await chars.devRaiseLevel(A, 200);
    expect((await classes.view(A))!.ascension?.blocked).toBeNull();
    expect(await classes.start(A, { operationId: "trial_t1", branchId: "ascend:human" })).toMatchObject({ status: "rejected", reason: "NOT_FOUND" });
    const r = await classes.start(A, { operationId: "trial_t1", branchId: "ascend:stonekin" });
    expect(r).toMatchObject({ status: "started" });
    expect(created.at(-1)!.setup).toMatchObject({ practice: true, classTrial: true, classTrialTier: "ascend", boss: { bossId: "boss:rift_spire_tyrant" } });
    if (r.status !== "started") throw new Error();
    expect((await rooms.get(r.battleId)!.view(A)).enemyStatPct).toBe(asc.trialStatPct);
    // It is claimed in town with its cost, not through the class claim.
    expect(await classes.claim(A, { operationId: "trial_t1" })).toMatchObject({ status: "rejected", reason: "INVALID_REQUEST" });
  });
});

describe("claiming the ascension (town service)", () => {
  it("needs a won trial, the price the player saw, coins and materials; pays once and the evolved passive replaces the race passive", async () => {
    await toClass3(200);
    await pay("1");
    const r = await classes.start(A, { operationId: "trial_asc", branchId: "ascend:stonekin" });
    if (r.status !== "started") throw new Error();
    expect(await claim("ascend_01")).toMatchObject({ status: "rejected", reason: "IN_BATTLE" });
    winTrial(r.battleId);
    expect(await claim("ascend_01", "a", "trial_nope")).toMatchObject({ status: "rejected", reason: "NOT_FOUND" });
    expect(await claim("ascend_01", "a", "trial_asc", 1)).toMatchObject({ status: "rejected", reason: "COST_CHANGED" });
    at("map:dawn_field");
    expect(await claim("ascend_01")).toMatchObject({ status: "rejected", reason: "NOT_IN_TOWN" });
    at(TOWN);
    const before = { coins: await coins(), cores: cores() };
    const done = await claim("ascend_01", "b");
    expect(done).toEqual({ status: "done", replayed: false, result: { pathId: "ascend:stonekin:b", paid: { coins: asc.coins, materials: [{ itemId: "item:rift_core", quantity: 10 }] } } });
    expect(await claim("ascend_01", "b")).toMatchObject({ status: "done", replayed: true, result: { pathId: "ascend:stonekin:b" } });
    expect(await claim("ascend_01", "a")).toMatchObject({ status: "rejected", reason: "PAYLOAD_MISMATCH" });
    expect(await coins()).toBe(before.coins - asc.coins);
    expect(cores()).toBe(before.cores - 10);
    const c = (await chars.get(A))!;
    expect(c.ascensionId).toBe("ascend:stonekin:b");
    const setup = playerSetup(A, c);
    expect(setup.ascensionId).toBe("ascend:stonekin:b");
    expect(setup.passiveIds).toContain("skill:ascend_stonekin_b");
    expect(setup.passiveIds).not.toContain("skill:race_stonekin_stone");
    expect((await classes.view(A))!.ascension).toMatchObject({ pathId: "ascend:stonekin:b", blocked: "ALREADY_ASCENDED" });
    expect(await classes.start(A, { operationId: "trial_again", branchId: "ascend:stonekin" })).toMatchObject({ status: "rejected", reason: "ALREADY_ASCENDED" });
    expect(await claim("ascend_02")).toMatchObject({ status: "rejected", reason: "ALREADY_ASCENDED" });
  });

  it("a lost trial is not claimed; without enough coins or materials nothing is charged", async () => {
    await toClass3(200);
    const lost = await classes.start(A, { operationId: "trial_lost", branchId: "ascend:stonekin" });
    if (lost.status !== "started") throw new Error();
    db.prepare(`UPDATE battle_reservations SET status = 'settled', outcome = 'defeat' WHERE battle_id = ?`).run(lost.battleId);
    expect(await claim("ascend_00", "a", "trial_lost")).toMatchObject({ status: "rejected", reason: "NOT_WON" });
    await wonRaceTrial();
    await pay("1", asc.coins, 9);
    expect(await claim("ascend_01")).toMatchObject({ status: "rejected", reason: "INSUFFICIENT_ITEMS" });
    expect(cores()).toBe(9);
    await eco.devGrant("cores:more", A, { "item:rift_core": 1 });
    // The starter coins count too: leave one coin short.
    await town.devGrantCoins("coins:minus", A, asc.coins - 1 - (await coins()));
    expect(await claim("ascend_02")).toMatchObject({ status: "rejected", reason: "INSUFFICIENT_COINS" });
    expect(cores()).toBe(10);
    expect((await chars.get(A))!.ascensionId).toBeNull();
  });

  it("two claims at the same time (two won trials) end with one path and one charge", async () => {
    await toClass3(200);
    await wonRaceTrial("trial_asc");
    await wonRaceTrial("trial_asc2");
    await pay("1", asc.coins * 2, 20);
    const before = await coins();
    const results = await Promise.all([claim("ascend_01", "a", "trial_asc"), claim("ascend_02", "b", "trial_asc2")]);
    expect(results.filter((x) => x.status === "done")).toHaveLength(1);
    expect(results.filter((x) => x.status === "rejected" && x.reason === "ALREADY_ASCENDED")).toHaveLength(1);
    expect(await coins()).toBe(before - asc.coins);
    expect(cores()).toBe(10);
    expect(db.prepare(`SELECT COUNT(*) AS n FROM class_trials WHERE status = 'claimed' AND branch_id = 'ascend:stonekin'`).get()).toEqual({ n: 1 });
  });

  it("switching the path costs coins, needs the path the player saw and replays on retry", async () => {
    await toClass3(200);
    await wonRaceTrial();
    await pay("1", asc.coins + asc.pathSwitchCoins);
    await town.devGrantCoins("coins:even", A, asc.coins + asc.pathSwitchCoins - (await coins()));
    expect(await town.switchAscensionPath(A, { operationId: "switch_00", expectedPath: "a", path: "b", expectedCoins: asc.pathSwitchCoins })).toMatchObject({ status: "rejected", reason: "NOT_ASCENDED" });
    expect(await claim("ascend_01", "a")).toMatchObject({ status: "done" });
    expect(await town.switchAscensionPath(A, { operationId: "switch_01", expectedPath: "a", path: "a", expectedCoins: asc.pathSwitchCoins })).toMatchObject({ status: "rejected", reason: "SAME_PATH" });
    expect(await town.switchAscensionPath(A, { operationId: "switch_01", expectedPath: "b", path: "a", expectedCoins: asc.pathSwitchCoins })).toMatchObject({ status: "rejected", reason: "CHANGED" });
    expect(await town.switchAscensionPath(A, { operationId: "switch_01", expectedPath: "a", path: "b", expectedCoins: 5 })).toMatchObject({ status: "rejected", reason: "COST_CHANGED" });
    const sw = await town.switchAscensionPath(A, { operationId: "switch_02", expectedPath: "a", path: "b", expectedCoins: asc.pathSwitchCoins });
    expect(sw).toEqual({ status: "done", replayed: false, result: { pathId: "ascend:stonekin:b", paid: asc.pathSwitchCoins } });
    expect(await town.switchAscensionPath(A, { operationId: "switch_02", expectedPath: "a", path: "b", expectedCoins: asc.pathSwitchCoins })).toMatchObject({ status: "done", replayed: true });
    expect(await coins()).toBe(0);
    expect((await chars.get(A))!.ascensionId).toBe("ascend:stonekin:b");
    expect(await town.switchAscensionPath(A, { operationId: "switch_03", expectedPath: "b", path: "a", expectedCoins: asc.pathSwitchCoins })).toMatchObject({ status: "rejected", reason: "INSUFFICIENT_COINS" });
  });
});
