/**
 * Daily / Weekly quests (chapter 09, P13) on the D1 migrations (node:sqlite stand-in): boards rolled
 * once, progress from granted kills / crafts inside the period, claims once, 4 a day, deliveries.
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  PRODUCTION_RULES as R,
  exampleContentMaps,
  exampleMapRegistry,
  exampleRecipeRegistry,
  questReward,
  type Entitlement,
  type QuestBoard,
  type QuestGoal,
} from "@pmrpg/shared";
import { CharacterStore } from "../src/character-store";
import { Economy } from "../src/economy";
import { QuestStore } from "../src/quest-store";
import { RewardLedger } from "../src/reward-ledger";
import { TownServices } from "../src/town-services";
import { SqliteD1, freshDb, type Db } from "./sqlite-d1";

const A = "acct:a";
const TOWN = "map:dawn_town";
const content = { ...exampleContentMaps(), recipes: exampleRecipeRegistry(), maps: exampleMapRegistry() };
let db: Db;
let clock: string;
let quests: QuestStore;
let ledger: RewardLedger;
let town: TownServices;
let eco: Economy;

const DAY = "d:2026-10-04";
const WEEK = "w:2026-09-28";
const mole = "species:supply_mole";
const at = (mapId: string) =>
  db
    .prepare(
      `INSERT INTO player_positions (account_id, map_id, channel, x, y, generation, updated_at) VALUES (?, ?, 1, 1, 1, 1, 'x')
       ON CONFLICT (account_id) DO UPDATE SET map_id = excluded.map_id`,
    )
    .run(A, mapId);
const kill = (n: number, speciesId = mole): Entitlement => ({ entitlementId: `battle:${n}:e1:defeated`, kind: "kill", enemyUnitId: "e1", speciesId, originMode: "manual", items: [] });
const setBoard = (periodId: string, goals: QuestGoal[], cadence: "daily" | "weekly" = "daily") => {
  const board: QuestBoard = { cadence, periodId, level: 1, goals, reward: questReward(R, cadence, 1) };
  db.prepare("UPDATE quest_boards SET board_json = ? WHERE account_id = ? AND period_id = ?").run(JSON.stringify(board), A, periodId);
};
const coins = async () => town.coins(A);
const xp = () => (db.prepare("SELECT xp FROM characters WHERE account_id = ?").get(A) as { xp: number }).xp;

const DAILY: QuestGoal[] = [
  { kind: "hunt", speciesIds: [mole], count: 2 },
  { kind: "craft", profession: "alchemist", count: 1 },
  { kind: "deliver", itemId: "item:mole_fur", count: 3 },
  { kind: "hunt", speciesIds: [mole], count: 1, mapId: "map:dawn_field" },
  { kind: "hunt", speciesIds: ["species:bell_bird"], count: 1 },
  { kind: "hunt", speciesIds: [mole, "species:bell_bird"], count: 1 },
];

beforeEach(async () => {
  db = freshDb();
  const d1 = new SqliteD1(db);
  clock = "2026-10-05T03:00:00.000Z"; // inside d:2026-10-04 and w:2026-09-28
  const now = () => clock;
  quests = new QuestStore(d1, R, content, [TOWN], now);
  ledger = new RewardLedger(d1, R, now);
  town = new TownServices(d1, R, content, [TOWN], now);
  eco = new Economy(d1, R, now);
  await eco.devGrant("seed:a", A, { "item:mole_fur": 10, "item:bell_feather": 5 });
  await town.devGrantCoins("coins:a", A, 100);
  const store = new CharacterStore(d1, R, content, now);
  await store.create(A, { operationId: "op_create_a", name: "นัท", classId: "class:guardian", raceId: "race:stonekin", element: "EARTH" });
  at(TOWN);
  expect(await quests.view(A)).not.toBeNull();
  setBoard(DAY, DAILY);
});

describe("quest boards", () => {
  it("rolls each board once per period and needs a character", async () => {
    const v = (await quests.view(A))!;
    expect(v.daily.period.id).toBe(DAY);
    expect(v.weekly.period.id).toBe(WEEK);
    expect(v.daily.goals.map((g) => g.goal)).toEqual(DAILY);
    expect(v.daily.claimsLeft).toBe(4);
    const weekly = v.weekly.goals.map((g) => g.goal);
    expect((await quests.view(A))!.weekly.goals.map((g) => g.goal)).toEqual(weekly);
    expect(await quests.view("acct:nobody")).toBeNull();
  });

  it("counts granted kills and crafts once, inside the period only", async () => {
    await ledger.grant(kill(1), A);
    await ledger.grant(kill(1), A); // a retried grant counts once
    clock = "2026-10-04T20:00:00.000Z"; // the day before (d:2026-10-03)
    await ledger.grant(kill(2), A);
    clock = "2026-10-05T03:00:00.000Z";
    await town.craft(A, { operationId: "craft_0001", recipeId: "recipe:small_potion", times: 1, expectedCoins: 5 });
    const g = (await quests.view(A))!.daily.goals;
    expect(g.map((x) => [x.progress, x.done])).toEqual([
      [1, false],
      [1, true],
      [3, true],
      [1, true],
      [0, false],
      [1, true],
    ]);
  });
});

describe("claiming", () => {
  it("pays once per quest and period, also when retried or raced", async () => {
    await ledger.grant(kill(1), A);
    await ledger.grant(kill(3), A);
    const before = { c: await coins(), x: xp(), p: await eco.balance(A, "item:small_potion") };
    const r = await quests.claim(A, { periodId: DAY, slot: 0 });
    expect(r).toMatchObject({ status: "done", replayed: false, result: { reward: questReward(R, "daily", 1) } });
    const again = await Promise.all([quests.claim(A, { periodId: DAY, slot: 0 }), quests.claim(A, { periodId: DAY, slot: 0 })]);
    for (const x of again) expect(x).toMatchObject({ status: "done", replayed: true });
    const reward = questReward(R, "daily", 1);
    expect(await coins()).toBe(before.c + reward.coins);
    expect(xp()).toBe(before.x + reward.exp);
    expect(await eco.balance(A, "item:small_potion")).toBe(before.p + reward.items[0]!.quantity);
    expect((await quests.view(A))!.daily).toMatchObject({ claimsLeft: 3 });
  });

  it("refuses unfinished quests and stops at 4 rewards a day, racing included", async () => {
    expect(await quests.claim(A, { periodId: DAY, slot: 4 })).toMatchObject({ reason: "NOT_DONE" });
    for (const n of [1, 2, 3]) await ledger.grant(kill(10 + n), A);
    await ledger.grant(kill(20, "species:bell_bird"), A);
    await town.craft(A, { operationId: "craft_0002", recipeId: "recipe:small_potion", times: 1, expectedCoins: 5 });
    const rs = await Promise.all([0, 1, 3, 4, 5].map((slot) => quests.claim(A, { periodId: DAY, slot })));
    expect(rs.filter((r) => r.status === "done")).toHaveLength(4);
    expect(rs.filter((r) => r.status === "rejected").map((r) => r.status === "rejected" && r.reason)).toEqual(["CLAIM_LIMIT"]);
    expect(db.prepare("SELECT COUNT(*) AS n FROM quest_claims").get()).toEqual({ n: 4 });
    expect(db.prepare("SELECT COUNT(*) AS n FROM coin_ledger WHERE reason = 'quest'").get()).toEqual({ n: 4 });
  });

  it("a delivery takes the items on claim, in town only", async () => {
    at("map:dawn_field");
    expect(await quests.claim(A, { periodId: DAY, slot: 2 })).toMatchObject({ reason: "NOT_IN_TOWN" });
    at(TOWN);
    db.prepare("INSERT INTO item_ledger (operation_id, line_no, account_id, item_id, delta, reason, created_at) VALUES ('burn', 0, ?, 'item:mole_fur', -8, 'test', 'x')").run(A);
    expect(await quests.claim(A, { periodId: DAY, slot: 2 })).toMatchObject({ reason: "INSUFFICIENT_ITEMS" });
    await eco.devGrant("more", A, { "item:mole_fur": 5 });
    expect(await quests.claim(A, { periodId: DAY, slot: 2 })).toMatchObject({ status: "done", result: { delivered: { itemId: "item:mole_fur", quantity: 3 } } });
    expect(await eco.balance(A, "item:mole_fur")).toBe(4);
    expect(await quests.claim(A, { periodId: DAY, slot: 2 })).toMatchObject({ status: "done", replayed: true });
    expect(await eco.balance(A, "item:mole_fur")).toBe(4);
  });

  it("weekly main reward needs 3 done quests; past periods are refused (weekly expiry is OPEN)", async () => {
    setBoard(WEEK, [
      { kind: "hunt", speciesIds: [mole], count: 1 },
      { kind: "craft", profession: "alchemist", count: 1 },
      { kind: "hunt", speciesIds: ["species:bell_bird"], count: 1 },
      { kind: "boss", speciesIds: ["species:crystal_crab_lord"], count: 1 },
    ], "weekly");
    expect(await quests.claim(A, { periodId: WEEK, slot: 0 })).toMatchObject({ reason: "INVALID_REQUEST" });
    await ledger.grant(kill(30), A);
    await town.craft(A, { operationId: "craft_0003", recipeId: "recipe:small_potion", times: 1, expectedCoins: 5 });
    expect(await quests.claim(A, { periodId: WEEK, slot: "main" })).toMatchObject({ reason: "NOT_DONE" });
    await ledger.grant(kill(31, "species:bell_bird"), A);
    const c = await coins();
    expect(await quests.claim(A, { periodId: WEEK, slot: "main" })).toMatchObject({ status: "done", result: { reward: questReward(R, "weekly", 1) } });
    expect(await coins()).toBe(c + questReward(R, "weekly", 1).coins);
    expect((await quests.view(A))!.weekly.claimsLeft).toBe(0);
    clock = "2026-10-06T03:00:00.000Z";
    expect(await quests.claim(A, { periodId: DAY, slot: 1 })).toMatchObject({ reason: "EXPIRED" });
    clock = "2026-10-13T03:00:00.000Z";
    expect(await quests.claim(A, { periodId: "w:2026-10-05", slot: "main" })).toMatchObject({ reason: "UNRESOLVED_RULE" });
  });
});
