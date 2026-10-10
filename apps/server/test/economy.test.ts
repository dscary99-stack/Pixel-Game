/**
 * Reservation lifecycle on the D1 migrations (node:sqlite stand-in for D1).
 * reserve -> activate -> grant -> settle, and the reconciler's release path.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { PRODUCTION_RULES, type Entitlement } from "@pmrpg/shared";
import { Economy, type Settlement } from "../src/economy";
import { SqliteD1, freshDb, type Db } from "./sqlite-d1";

const A = "acct:a";
const B = "acct:b";
let db: Db;
let eco: Economy;

beforeEach(async () => {
  db = freshDb();
  eco = new Economy(new SqliteD1(db), PRODUCTION_RULES, () => "2026-10-03T00:00:00Z");
  await eco.devGrant("seed:a", A, { "item:small_potion": 5, "item:armor_crab_capture": 2 });
  await eco.devGrant("seed:b", B, {});
  for (const [id, owner] of [
    ["mon:a1", A],
    ["mon:a2", A],
    ["mon:b1", B],
  ]) {
    db.prepare(
      `INSERT INTO monster_instances (id, species_id, owner_id, current_level, element, primary_stats_json, origin_json, created_operation_id)
       VALUES (?, 'species:ember_fox', ?, 5, 'FIRE', '{}', '{}', ?)`,
    ).run(id!, owner!, `seed:${id}`);
  }
});

const reserveReq = (battle: string, bag: Record<string, number> = { "item:small_potion": 3 }, companionIds: string[] = []) => ({
  reservationId: `res:${battle}`,
  accountId: A,
  battleId: battle,
  bag,
  companionIds,
});

const settlement = (battle: string, over: Partial<Settlement> = {}): Settlement => ({
  reservationId: `res:${battle}`,
  battleId: battle,
  accountId: A,
  outcome: "victory",
  unused: { "item:small_potion": 2 },
  allies: [{ unitId: "player", instanceId: null, hp: 400, mp: 50, ko: false }],
  entitlementIds: [],
  ...over,
});

const kill = (battle: string, enemy = "e1"): Entitlement => ({
  entitlementId: `${battle}:${enemy}:defeated`,
  kind: "kill",
  enemyUnitId: enemy,
  speciesId: "species:armor_crab",
  originMode: "manual",
  items: [{ itemId: "item:crab_shell", quantity: 1 }],
});

const lock = (id: string) => db.prepare("SELECT lock_state, lock_ref FROM monster_instances WHERE id = ?").get(id);
const count = (sql: string) => (db.prepare(sql).get() as { n: number }).n;

describe("reserve", () => {
  it("moves the bag out of the inventory once; a retry is replayed, not deducted again", async () => {
    expect(await eco.reserve(reserveReq("b1"))).toMatchObject({ status: "reserved", current: "reserved", replayed: false });
    expect(await eco.reserve(reserveReq("b1"))).toMatchObject({ status: "reserved", replayed: true });
    expect(await eco.balance(A, "item:small_potion")).toBe(2);
  });

  it("refuses the same reservation id with a different request", async () => {
    await eco.reserve(reserveReq("b1"));
    expect(await eco.reserve(reserveReq("b1", { "item:small_potion": 5 }))).toMatchObject({ status: "rejected", reason: "PAYLOAD_MISMATCH" });
    expect(await eco.balance(A, "item:small_potion")).toBe(2);
  });

  it("refuses a bag the inventory cannot cover and writes nothing", async () => {
    expect(await eco.reserve(reserveReq("b1", { "item:small_potion": 3, "item:armor_crab_capture": 3 }))).toMatchObject({
      status: "rejected",
      reason: "INSUFFICIENT_RESOURCE",
    });
    expect(count("SELECT COUNT(*) AS n FROM battle_reservations")).toBe(0);
    expect(await eco.balance(A, "item:small_potion")).toBe(5);
  });

  it("allows one unfinished battle per account; the loser is not charged", async () => {
    const [x, y] = await Promise.all([eco.reserve(reserveReq("b1")), eco.reserve(reserveReq("b2"))]);
    expect([x.status, y.status].sort()).toEqual(["rejected", "reserved"]);
    expect([x, y].find((r) => r.status === "rejected")).toMatchObject({ reason: "BATTLE_IN_PROGRESS" });
    expect(await eco.balance(A, "item:small_potion")).toBe(2);
  });

  it("locks the team's companions, and refuses ones the caller does not own or that are locked", async () => {
    expect(await eco.reserve(reserveReq("b1", {}, ["mon:a1"]))).toMatchObject({ status: "reserved" });
    expect(lock("mon:a1")).toEqual({ lock_state: "in_battle", lock_ref: "res:b1" });
    expect(lock("mon:a2")).toEqual({ lock_state: "free", lock_ref: null });

    await eco.activate("res:b1");
    await eco.settle(settlement("b1", { unused: {} }));
    expect(await eco.reserve(reserveReq("b2", {}, ["mon:a1", "mon:b1"]))).toMatchObject({ status: "rejected", reason: "NOT_OWNER" });

    db.prepare("UPDATE monster_instances SET lock_state = 'in_escrow' WHERE id = 'mon:a2'").run();
    expect(await eco.reserve(reserveReq("b3", {}, ["mon:a2"]))).toMatchObject({ status: "rejected", reason: "ASSET_LOCKED" });
    expect(lock("mon:a1")).toEqual({ lock_state: "free", lock_ref: null });
  });

  it("rejects malformed bags", async () => {
    expect(await eco.reserve(reserveReq("b1", { "item:small_potion": 1.5 }))).toMatchObject({ reason: "INVALID_REQUEST" });
    expect(await eco.reserve(reserveReq("b1", { "item:small_potion": -1 }))).toMatchObject({ reason: "INVALID_REQUEST" });
    expect(await eco.reserve(reserveReq("b1", {}, ["mon:a1", "mon:a1"]))).toMatchObject({ reason: "INVALID_REQUEST" });
  });
});

describe("settle", () => {
  beforeEach(async () => {
    await eco.reserve(reserveReq("b1", { "item:small_potion": 3 }, ["mon:a1"]));
  });

  it("is refused before activation", async () => {
    expect(await eco.settle(settlement("b1"))).toMatchObject({ status: "rejected", reason: "NOT_ACTIVE" });
  });

  it("waits until every entitlement has a receipt", async () => {
    await eco.activate("res:b1");
    const s = settlement("b1", { entitlementIds: [kill("b1").entitlementId] });
    expect(await eco.settle(s)).toMatchObject({ status: "rejected", reason: "RECEIPTS_MISSING" });
    expect(await eco.balance(A, "item:small_potion")).toBe(2);
    expect(lock("mon:a1")).toMatchObject({ lock_state: "in_battle" });

    await eco.grant(kill("b1"), A);
    expect(await eco.settle(s)).toMatchObject({ status: "settled" });
    expect(await eco.balance(A, "item:small_potion")).toBe(4);
    expect(await eco.balance(A, "item:crab_shell")).toBe(1);
    expect(lock("mon:a1")).toEqual({ lock_state: "free", lock_ref: null });
    expect(await eco.reservation("res:b1")).toEqual({ status: "settled", outcome: "victory" });
  });

  it("returns unused items once; a retry is already_settled and a changed payload is refused", async () => {
    await eco.activate("res:b1");
    expect(await eco.settle(settlement("b1"))).toMatchObject({ status: "settled" });
    expect(await eco.settle(settlement("b1"))).toMatchObject({ status: "already_settled" });
    expect(await eco.settle(settlement("b1", { unused: { "item:small_potion": 3 } }))).toMatchObject({ status: "rejected", reason: "PAYLOAD_MISMATCH" });
    expect(await eco.balance(A, "item:small_potion")).toBe(4);
  });

  it("never returns more than was reserved", async () => {
    await eco.activate("res:b1");
    expect(await eco.settle(settlement("b1", { unused: { "item:small_potion": 4 } }))).toMatchObject({ reason: "EXCEEDS_RESERVATION" });
    expect(await eco.settle(settlement("b1", { unused: { "item:armor_crab_capture": 1 } }))).toMatchObject({ reason: "EXCEEDS_RESERVATION" });
    expect(await eco.balance(A, "item:small_potion")).toBe(2);
  });

  it("opens the account for the next battle only after settlement", async () => {
    await eco.activate("res:b1");
    expect(await eco.reserve(reserveReq("b2", { "item:small_potion": 1 }))).toMatchObject({ reason: "BATTLE_IN_PROGRESS" });
    await eco.settle(settlement("b1"));
    expect(await eco.reserve(reserveReq("b2", { "item:small_potion": 1 }))).toMatchObject({ status: "reserved" });
  });

  it("rolls the whole settlement back if one write fails", async () => {
    await eco.activate("res:b1");
    db.exec(`CREATE TRIGGER boom BEFORE INSERT ON item_ledger WHEN NEW.reason = 'battle_return_unused' BEGIN SELECT RAISE(ABORT, 'disk'); END`);
    await expect(eco.settle(settlement("b1"))).rejects.toThrow();
    expect(await eco.reservation("res:b1")).toMatchObject({ status: "active" });
    expect(lock("mon:a1")).toMatchObject({ lock_state: "in_battle" });
    db.exec("DROP TRIGGER boom");
    expect(await eco.settle(settlement("b1"))).toMatchObject({ status: "settled" });
    expect(await eco.balance(A, "item:small_potion")).toBe(4);
  });
});

describe("release (reconciler)", () => {
  beforeEach(async () => {
    await eco.reserve(reserveReq("b1", { "item:small_potion": 3 }, ["mon:a1"]));
  });

  it("gives back the whole bag and the companions, once", async () => {
    expect(await eco.staleReserved("2026-10-04T00:00:00Z")).toEqual([{ reservationId: "res:b1", battleId: "b1" }]);
    expect(await eco.release("res:b1")).toMatchObject({ status: "released" });
    expect(await eco.release("res:b1")).toMatchObject({ status: "already_released" });
    expect(await eco.balance(A, "item:small_potion")).toBe(5);
    expect(lock("mon:a1")).toEqual({ lock_state: "free", lock_ref: null });
    expect(await eco.staleReserved("2026-10-04T00:00:00Z")).toEqual([]);
  });

  it("only lists reservations older than the cutoff", async () => {
    expect(await eco.staleReserved("2026-10-02T00:00:00Z")).toEqual([]);
  });

  it("cannot release an activated battle, and a released one can never activate or settle", async () => {
    await eco.reserve({ ...reserveReq("b9"), accountId: B, bag: {} });
    await eco.activate("res:b9");
    expect(await eco.release("res:b9")).toMatchObject({ status: "rejected", current: "active" });

    await eco.release("res:b1");
    expect(await eco.activate("res:b1")).toMatchObject({ status: "rejected", current: "released" });
    expect(await eco.settle(settlement("b1"))).toMatchObject({ status: "rejected", reason: "NOT_ACTIVE" });
    expect(await eco.balance(A, "item:small_potion")).toBe(5);
  });
});
