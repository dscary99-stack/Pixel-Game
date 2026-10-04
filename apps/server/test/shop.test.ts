/**
 * NPC shop (coin sink) and the starter kit on the D1 migrations (node:sqlite stand-in).
 */
import { beforeEach, describe, expect, it } from "vitest";
import { PRODUCTION_RULES, STARTER_KIT, exampleContentMaps, exampleShopRegistry } from "@pmrpg/shared";
import { CharacterStore } from "../src/character-store";
import { Economy } from "../src/economy";
import { TownServices } from "../src/town-services";
import { SqliteD1, freshDb, type Db } from "./sqlite-d1";

const A = "acct:a";
const content = { ...exampleContentMaps(), shops: exampleShopRegistry() };
const TOWN = "map:dawn_town";
const SHOP = "shop:dawn_general";
let db: Db;
let town: TownServices;
let store: CharacterStore;
let eco: Economy;

const at = (account: string, mapId: string) =>
  db
    .prepare(
      `INSERT INTO player_positions (account_id, map_id, channel, x, y, generation, updated_at) VALUES (?, ?, 1, 1, 1, 1, 'x')
       ON CONFLICT (account_id) DO UPDATE SET map_id = excluded.map_id`,
    )
    .run(account, mapId);
const create = { operationId: "op_create_01", name: "นัท", classId: "class:striker", raceId: "race:human", element: "FIRE" };

beforeEach(async () => {
  db = freshDb();
  const d1 = new SqliteD1(db);
  const now = () => "2026-10-04T00:00:00Z";
  town = new TownServices(d1, PRODUCTION_RULES, content, [TOWN], now);
  store = new CharacterStore(d1, PRODUCTION_RULES, content, now);
  eco = new Economy(d1, PRODUCTION_RULES, now);
});

describe("starter kit", () => {
  it("comes once with the character, however often or concurrently the create is retried", async () => {
    await Promise.all([store.create(A, create), store.create(A, create), store.create(A, create)]);
    expect(await store.create(A, { ...create, operationId: "op_create_02" })).toMatchObject({ reason: "CHARACTER_EXISTS" });
    for (const [itemId, qty] of Object.entries(STARTER_KIT.items)) expect(await eco.balance(A, itemId)).toBe(qty);
    expect(await town.coins(A)).toBe(STARTER_KIT.coins);
    const gear = db.prepare("SELECT definition_id AS d FROM equipment_instances WHERE owner_id = ? ORDER BY d").all(A) as { d: string }[];
    expect(gear.map((g) => g.d)).toEqual([...STARTER_KIT.equipment].sort());
  });

  it("a refused create grants nothing", async () => {
    expect(await store.create(A, { ...create, element: "NEUTRAL" })).toMatchObject({ status: "rejected" });
    expect(await town.coins(A)).toBe(0);
  });
});

describe("buying from the NPC shop", () => {
  beforeEach(async () => {
    await store.create(A, create);
    at(A, TOWN);
  });
  const buy = (operationId: string, lines: { itemId: string; quantity: number }[], expectedTotal: number) => town.buy(A, { operationId, shopId: SHOP, lines, expectedTotal });

  it("charges the listed price for listed goods, once per operation id", async () => {
    const lines = [{ itemId: "item:small_potion", quantity: 2 }, { itemId: "item:supply_mole_capture", quantity: 1 }];
    expect(await buy("buy_00001", lines, 100)).toMatchObject({ status: "done", replayed: false, result: { total: 100 } });
    await Promise.all([buy("buy_00001", lines, 100), buy("buy_00001", lines, 100)]);
    expect(await buy("buy_00001", lines, 100)).toMatchObject({ status: "done", replayed: true });
    expect(await town.coins(A)).toBe(0);
    expect(await eco.balance(A, "item:small_potion")).toBe(STARTER_KIT.items["item:small_potion"]! + 2);
    expect(await buy("buy_00001", [{ itemId: "item:small_potion", quantity: 1 }], 30)).toMatchObject({ reason: "PAYLOAD_MISMATCH" });
  });

  it("refuses a changed total, unlisted goods, too few coins, outside the shop's town and in a fight, writing nothing", async () => {
    expect(await buy("buy_00002", [{ itemId: "item:small_potion", quantity: 1 }], 10)).toMatchObject({ reason: "COST_CHANGED" });
    expect(await buy("buy_00003", [{ itemId: "item:crystal_crab_lord_capture", quantity: 1 }], 0)).toMatchObject({ reason: "NOT_SOLD_HERE" });
    expect(await town.buy(A, { operationId: "buy_00004", shopId: "shop:nope", lines: [{ itemId: "item:small_potion", quantity: 1 }], expectedTotal: 30 })).toMatchObject({ reason: "NOT_SOLD_HERE" });
    expect(await buy("buy_00005", [{ itemId: "item:phoenix_feather", quantity: 1 }], 600)).toMatchObject({ reason: "INSUFFICIENT_COINS" });
    at(A, "map:dawn_field");
    expect(await buy("buy_00006", [{ itemId: "item:small_potion", quantity: 1 }], 30)).toMatchObject({ reason: "NOT_IN_TOWN" });
    at(A, TOWN);
    await eco.reserve({ reservationId: "res:x", accountId: A, battleId: "battle:x", bag: {}, companionIds: [] });
    expect(await buy("buy_00007", [{ itemId: "item:small_potion", quantity: 1 }], 30)).toMatchObject({ reason: "IN_BATTLE" });
    expect(await town.coins(A)).toBe(STARTER_KIT.coins);
    expect(db.prepare("SELECT COUNT(*) AS n FROM service_operations").get()).toEqual({ n: 0 });
  });

  it("two purchases racing for the same last coins: only one is charged", async () => {
    const r = await Promise.all(["buy_race1", "buy_race2"].map((op) => buy(op, [{ itemId: "item:armor_crab_capture", quantity: 1 }], 80)));
    expect(r.map((x) => x.status).sort()).toEqual(["done", "rejected"]);
    expect(await town.coins(A)).toBe(20);
    expect(await eco.balance(A, "item:armor_crab_capture")).toBe(1);
  });
});
