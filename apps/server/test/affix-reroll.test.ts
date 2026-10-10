/**
 * Affix reroll (chapter 05 §3) on the D1 migrations (node:sqlite stand-in): pay coins + material,
 * one slot rolls again, keep old or new; retries, races, locks and refusals.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { PRODUCTION_RULES as R, affixRerollCost, exampleContentMaps, type RolledAffix } from "@pmrpg/shared";
import { CharacterStore } from "../src/character-store";
import { Economy } from "../src/economy";
import { TownServices } from "../src/town-services";
import { SqliteD1, freshDb, type Db } from "./sqlite-d1";

const A = "acct:a";
const B = "acct:b";
const content = exampleContentMaps();
const TOWN = "map:dawn_town";
const dagger = content.equipment.get("equip:ember_fang_dagger")!;
const cost = affixRerollCost(R, dagger, content.affixPools.get(dagger.affixPoolId)!);
const START: RolledAffix[] = [
  { stat: "PATK", value: 4 },
  { stat: "STR", value: 2 },
];
let db: Db;
let town: TownServices;
let store: CharacterStore;
let eco: Economy;
let id: string;

const at = (account: string, mapId: string) =>
  db
    .prepare(
      `INSERT INTO player_positions (account_id, map_id, channel, x, y, generation, updated_at) VALUES (?, ?, 1, 1, 1, 1, 'x')
       ON CONFLICT (account_id) DO UPDATE SET map_id = excluded.map_id`,
    )
    .run(account, mapId);
const row = () => db.prepare("SELECT affixes_json AS a, affix_pending_json AS p FROM equipment_instances WHERE id = ?").get(id) as { a: string; p: string | null };
const req = (operationId: string, over: Record<string, unknown> = {}) => ({ operationId, equipmentId: id, slot: 1, expectedAffixes: START, expectedCost: cost, ...over });

beforeEach(async () => {
  db = freshDb();
  const d1 = new SqliteD1(db);
  const now = () => "2026-10-04T00:00:00Z";
  town = new TownServices(d1, R, content, [TOWN], now);
  store = new CharacterStore(d1, R, content, now);
  eco = new Economy(d1, R, now);
  await eco.devGrant("seed:a", A, { "item:river_pebble": cost.quantity * 3 });
  await eco.devGrant("seed:b", B, {});
  await town.devGrantCoins("coins:a", A, cost.coins * 3);
  await store.devGrantEquipment("gear:a", A, ["equip:ember_fang_dagger"]);
  id = (db.prepare("SELECT id FROM equipment_instances WHERE owner_id = ?").get(A) as { id: string }).id;
  db.prepare("UPDATE equipment_instances SET rarity = 'RARE', affixes_json = ? WHERE id = ?").run(JSON.stringify(START), id);
  at(A, TOWN);
});

describe("affix reroll", () => {
  it("charges coins and material, stores a new roll for that slot only, once per operation id", async () => {
    const r = await town.rerollAffix(A, req("reroll_0001"));
    expect(r).toMatchObject({ status: "done", replayed: false, result: { slot: 1, old: START[1], paid: cost } });
    if (r.status !== "done") return;
    // Never the other slot's stat; any pool stat otherwise.
    expect(r.result.rolled.stat).not.toBe("PATK");
    expect(content.affixPools.get("affix:weapon_physical")!.entries.map((e) => e.stat)).toContain(r.result.rolled.stat);
    expect(await town.rerollAffix(A, req("reroll_0001"))).toEqual({ ...r, replayed: true });
    await Promise.all([town.rerollAffix(A, req("reroll_0001")), town.rerollAffix(A, req("reroll_0001"))]);
    expect(await town.coins(A)).toBe(cost.coins * 2);
    expect(await eco.balance(A, "item:river_pebble")).toBe(cost.quantity * 2);
    // Nothing changes on the piece until the player chooses; the list shows the waiting roll.
    expect(JSON.parse(row().a)).toEqual(START);
    const view = (await store.equipment(A))[0]!;
    expect(view.pendingAffix).toEqual({ operationId: "reroll_0001", slot: 1, affix: r.result.rolled });
  });

  it("keep new swaps that slot; keep old leaves it; both clear the roll and are idempotent", async () => {
    const r = await town.rerollAffix(A, req("reroll_0002"));
    if (r.status !== "done") throw new Error(JSON.stringify(r));
    const choose = { operationId: "choose_0002", equipmentId: id, rerollOperationId: "reroll_0002", keep: "new" as const };
    expect(await town.chooseAffix(A, choose)).toMatchObject({ status: "done", result: { kept: "new", affixes: [START[0], r.result.rolled] } });
    expect(await town.chooseAffix(A, choose)).toMatchObject({ status: "done", replayed: true });
    expect(row()).toEqual({ a: JSON.stringify([START[0], r.result.rolled]), p: null });
    expect(await town.chooseAffix(A, { ...choose, operationId: "choose_0003" })).toMatchObject({ reason: "NO_PENDING_REROLL" });

    const now = JSON.parse(row().a) as RolledAffix[];
    const r2 = await town.rerollAffix(A, req("reroll_0003", { slot: 0, expectedAffixes: now }));
    expect(r2.status).toBe("done");
    expect(await town.chooseAffix(A, { operationId: "choose_0004", equipmentId: id, rerollOperationId: "reroll_0003", keep: "old" })).toMatchObject({ result: { kept: "old", affixes: now } });
    expect(row()).toEqual({ a: JSON.stringify(now), p: null });
    // Resources are spent on each roll, whatever was kept.
    expect(await town.coins(A)).toBe(cost.coins);
  });

  it("a second roll waits for the choice; two racing rolls charge once", async () => {
    const r = await Promise.all(["reroll_race1", "reroll_race2"].map((op) => town.rerollAffix(A, req(op))));
    expect(r.map((x) => x.status).sort()).toEqual(["done", "rejected"]);
    expect(r.find((x) => x.status === "rejected")).toMatchObject({ reason: "CHOICE_PENDING" });
    expect(await town.coins(A)).toBe(cost.coins * 2);
    expect(await town.rerollAffix(A, req("reroll_0004"))).toMatchObject({ reason: "CHOICE_PENDING" });
  });

  it("refuses a changed piece or price, a missing slot, someone else's piece, outside town, in a fight, and short funds", async () => {
    expect(await town.rerollAffix(A, req("reroll_0010", { expectedAffixes: [START[0]] }))).toMatchObject({ reason: "CHANGED" });
    expect(await town.rerollAffix(A, req("reroll_0011", { expectedCost: { ...cost, coins: cost.coins - 1 } }))).toMatchObject({ reason: "COST_CHANGED" });
    expect(await town.rerollAffix(A, req("reroll_0012", { slot: 2 }))).toMatchObject({ reason: "NO_SUCH_AFFIX" });
    expect(await town.rerollAffix(B, req("reroll_0013"))).toMatchObject({ reason: "NOT_OWNER" });
    at(A, "map:dawn_field");
    expect(await town.rerollAffix(A, req("reroll_0014"))).toMatchObject({ reason: "NOT_IN_TOWN" });
    at(A, TOWN);
    await eco.reserve({ reservationId: "res:x", accountId: A, battleId: "battle:x", bag: {}, companionIds: [] });
    expect(await town.rerollAffix(A, req("reroll_0015"))).toMatchObject({ reason: "IN_BATTLE" });
    await eco.release("res:x");
    db.prepare("DELETE FROM coin_ledger WHERE account_id = ?").run(A);
    expect(await town.rerollAffix(A, req("reroll_0016"))).toMatchObject({ reason: "INSUFFICIENT_COINS" });
    expect(db.prepare("SELECT COUNT(*) AS n FROM service_operations").get()).toEqual({ n: 0 });
    expect(row()).toEqual({ a: JSON.stringify(START), p: null });
  });

  it("the choice waits while a fight holds the piece", async () => {
    const r = await town.rerollAffix(A, req("reroll_0020"));
    expect(r.status).toBe("done");
    db.prepare("UPDATE equipment_instances SET lock_state = 'in_battle' WHERE id = ?").run(id);
    const choose = { operationId: "choose_0020", equipmentId: id, rerollOperationId: "reroll_0020", keep: "new" as const };
    expect(await town.chooseAffix(A, choose)).toMatchObject({ reason: "ASSET_LOCKED" });
    db.prepare("UPDATE equipment_instances SET lock_state = 'free' WHERE id = ?").run(id);
    expect(await town.chooseAffix(A, choose)).toMatchObject({ status: "done" });
  });
});
