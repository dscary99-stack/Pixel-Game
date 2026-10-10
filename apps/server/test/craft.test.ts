/**
 * Crafting (chapter 05 §6, chapter 09) on the D1 migrations (node:sqlite stand-in): inputs, coins,
 * output and mastery in one batch; gear rolled once; retries, races and refusals.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { PRODUCTION_RULES as R, exampleContentMaps, exampleRecipeRegistry } from "@pmrpg/shared";
import { CharacterStore } from "../src/character-store";
import { Economy } from "../src/economy";
import { TownServices } from "../src/town-services";
import { SqliteD1, freshDb, type Db } from "./sqlite-d1";

const A = "acct:a";
const B = "acct:b";
const TOWN = "map:dawn_town";
const content = { ...exampleContentMaps(), recipes: exampleRecipeRegistry() };
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
const buckler = (operationId: string, times = 1, over: Record<string, unknown> = {}) => ({ operationId, recipeId: "recipe:crab_buckler", times, expectedCoins: 120 * times, ...over });
const potions = (operationId: string, times = 1) => ({ operationId, recipeId: "recipe:small_potion", times, expectedCoins: 5 * times });

beforeEach(async () => {
  db = freshDb();
  const d1 = new SqliteD1(db);
  const now = () => "2026-10-04T00:00:00Z";
  town = new TownServices(d1, R, content, [TOWN], now);
  store = new CharacterStore(d1, R, content, now);
  eco = new Economy(d1, R, now);
  await eco.devGrant("seed:a", A, { "item:crab_shell": 60, "item:river_pebble": 60, "item:mole_fur": 20, "item:bell_feather": 10 });
  await eco.devGrant("seed:b", B, { "item:crab_shell": 6, "item:river_pebble": 4 });
  await town.devGrantCoins("coins:a", A, 2000);
  await town.devGrantCoins("coins:b", B, 120);
  at(A, TOWN);
  at(B, TOWN);
});

describe("crafting", () => {
  it("item recipe: spends inputs and coins, adds the output and mastery, once per operation id", async () => {
    const r = await town.craft(A, potions("craft_0001", 3));
    expect(r).toMatchObject({
      status: "done",
      replayed: false,
      result: { items: [{ itemId: "item:small_potion", quantity: 6 }], equipment: [], profession: "alchemist", mastery: { before: 0, after: 6 }, paid: { coins: 15 } },
    });
    expect(await town.craft(A, potions("craft_0001", 3))).toEqual({ ...r, replayed: true });
    await Promise.all([town.craft(A, potions("craft_0001", 3)), town.craft(A, potions("craft_0001", 3))]);
    expect(await eco.balance(A, "item:small_potion")).toBe(6);
    expect(await eco.balance(A, "item:mole_fur")).toBe(14);
    expect(await eco.balance(A, "item:bell_feather")).toBe(7);
    expect(await town.coins(A)).toBe(1985);
    expect((await town.craftMastery(A)).alchemist).toBe(6);
    expect(await town.craft(A, { ...potions("craft_0001", 3), times: 2, expectedCoins: 10 })).toMatchObject({ reason: "PAYLOAD_MISMATCH" });
  });

  it("gear recipe: each piece rolled once with rarity and affixes from its pool; a retry replays the same pieces", async () => {
    const r = await town.craft(A, buckler("craft_0002", 2));
    if (r.status !== "done") throw new Error(JSON.stringify(r));
    expect(r.result.equipment).toHaveLength(2);
    const pool = content.affixPools.get(content.equipment.get("equip:crab_buckler")!.affixPoolId)!;
    for (const p of r.result.equipment) for (const a of p.affixes) expect(pool.entries.map((e) => e.stat)).toContain(a.stat);
    expect(await town.craft(A, buckler("craft_0002", 2))).toEqual({ ...r, replayed: true });
    const owned = (await store.equipment(A)).filter((e) => e.definitionId === "equip:crab_buckler");
    expect(owned.map((e) => ({ id: e.id, rarity: e.rarity, affixes: e.affixes })).sort((x, y) => (x.id < y.id ? -1 : 1))).toEqual(
      r.result.equipment.map((e) => ({ id: e.id, rarity: e.rarity, affixes: e.affixes })).sort((x, y) => (x.id < y.id ? -1 : 1)),
    );
    expect(await eco.balance(A, "item:crab_shell")).toBe(48);
    expect((await town.craftMastery(A)).armorsmith).toBe(10);
    // Another account with the same operation id gets its own pieces.
    const b = await town.craft(B, buckler("craft_0002"));
    if (b.status !== "done") throw new Error(JSON.stringify(b));
    expect(b.result.equipment[0]!.id).not.toBe(r.result.equipment[0]!.id);
    expect((await store.equipment(B))).toHaveLength(1);
  });

  it("mastery stops at the recipe cap; a recipe needing mastery is refused until it is reached", async () => {
    expect(await town.craft(A, { operationId: "craft_0003", recipeId: "recipe:crystal_shell_plate", times: 1, expectedCoins: 400 })).toMatchObject({ reason: "MASTERY_TOO_LOW" });
    await town.craft(A, buckler("craft_0004", 10));
    expect((await town.craftMastery(A)).armorsmith).toBe(50);
    await eco.devGrant("seed:a2", A, { "item:crab_shell": 60 });
    const r = await town.craft(A, buckler("craft_0005", 4));
    expect(r).toMatchObject({ result: { mastery: { before: 50, after: 60 } } });
    expect(await town.craft(A, buckler("craft_0006"))).toMatchObject({ result: { mastery: { before: 60, after: 60 } } });
  });

  it("two different crafts of one profession at once never lose a gain or overspend", async () => {
    const rs = await Promise.all([town.craft(A, potions("craft_0007")), town.craft(A, potions("craft_0008"))]);
    const done = rs.filter((r) => r.status === "done").length;
    expect(done).toBeGreaterThanOrEqual(1);
    for (const r of rs) if (r.status === "rejected") expect(r.reason).toBe("CHANGED");
    expect((await town.craftMastery(A)).alchemist).toBe(2 * done);
    expect(await eco.balance(A, "item:small_potion")).toBe(2 * done);
    expect(await eco.balance(A, "item:mole_fur")).toBe(20 - 2 * done);
  });

  it("refuses unknown recipes, a changed price, missing materials, coins, outside town and in a fight, changing nothing", async () => {
    expect(await town.craft(A, { operationId: "craft_0010", recipeId: "recipe:nope", times: 1, expectedCoins: 0 })).toMatchObject({ reason: "NO_SUCH_RECIPE" });
    expect(await town.craft(A, buckler("craft_0011", 1, { expectedCoins: 100 }))).toMatchObject({ reason: "COST_CHANGED" });
    expect(await town.craft(A, buckler("craft_0012", 1, { times: 11, expectedCoins: 1320 }))).toMatchObject({ reason: "INVALID_REQUEST" });
    expect(await town.craft(A, { operationId: "craft_0013", recipeId: "recipe:glow_charm", times: 1, expectedCoins: 150 })).toMatchObject({ reason: "INSUFFICIENT_ITEMS" });
    at(A, "map:dawn_field");
    expect(await town.craft(A, buckler("craft_0014"))).toMatchObject({ reason: "NOT_IN_TOWN" });
    at(A, TOWN);
    await eco.reserve({ reservationId: "res:x", accountId: A, battleId: "battle:x", bag: {}, companionIds: [] });
    expect(await town.craft(A, buckler("craft_0015"))).toMatchObject({ reason: "IN_BATTLE" });
    await eco.release("res:x");
    expect(await town.craft(B, buckler("craft_0016", 2))).toMatchObject({ reason: "INSUFFICIENT_COINS" });
    expect(db.prepare("SELECT COUNT(*) AS n FROM service_operations").get()).toEqual({ n: 0 });
    expect(db.prepare("SELECT COUNT(*) AS n FROM craft_mastery").get()).toEqual({ n: 0 });
    expect(await town.coins(A)).toBe(2000);
  });
});
