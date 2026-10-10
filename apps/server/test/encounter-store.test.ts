/**
 * Private encounter claims on the D1 migrations (node:sqlite stand-in), O05.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { PRODUCTION_RULES, bossAttemptId, bossLairId } from "@pmrpg/shared";
import { Economy } from "../src/economy";
import { EncounterStore } from "../src/encounter-store";
import { SqliteD1, freshDb, type Db } from "./sqlite-d1";

const A = "acct:a";
const B = "acct:b";
const PACK = "map:dawn_field#1:pond_crabs:100";
const roster = [{ speciesId: "species:armor_crab", element: "WATER" as const }];
let db: Db;
let eco: Economy;
let enc: EncounterStore;

beforeEach(async () => {
  db = freshDb();
  const d1 = new SqliteD1(db);
  eco = new Economy(d1, PRODUCTION_RULES, () => "2026-10-03T00:00:00Z");
  enc = new EncounterStore(d1, () => "2026-10-03T00:00:00Z");
  await eco.devGrant("seed:a", A, { "item:small_potion": 5 });
  await eco.devGrant("seed:b", B, { "item:small_potion": 5 });
});

const reserveFor = (account: string, battleId: string) =>
  eco.reserve({ reservationId: `res:${battleId}`, accountId: account, battleId, bag: { "item:small_potion": 1 }, companionIds: [] });

describe("EncounterStore", () => {
  it("one pack gives each player their own fight, and a repeat claim returns the same fight", async () => {
    const a1 = await enc.claim(A, PACK, roster);
    const a2 = await enc.claim(A, PACK, [{ speciesId: "species:ember_fox", element: "FIRE" }]);
    const b1 = await enc.claim(B, PACK, roster);
    expect(a2).toEqual(a1);
    // The stored roster wins over a different roll on retry.
    expect(a2.roster).toEqual(roster);
    expect(b1.battleId).not.toBe(a1.battleId);
    expect(a1.battleId).toBe(await EncounterStore.battleIdFor(A, PACK));
  });

  it("concurrent claims for the same player and pack land on one row", async () => {
    const results = await Promise.all(Array.from({ length: 5 }, () => enc.claim(A, PACK, roster)));
    expect(new Set(results.map((r) => r.battleId)).size).toBe(1);
    expect(db.prepare("SELECT COUNT(*) AS n FROM encounter_claims").get()).toEqual({ n: 1 });
  });

  it("a pack counts as fought only once its battle holds a reservation, and only for that player", async () => {
    const { battleId } = await enc.claim(A, PACK, roster);
    expect([...(await enc.fought(A, [PACK]))]).toEqual([]);
    expect((await reserveFor(A, battleId)).status).toBe("reserved");
    expect([...(await enc.fought(A, [PACK, "other"]))]).toEqual([PACK]);
    expect([...(await enc.fought(B, [PACK]))]).toEqual([]);
    expect([...(await enc.fought(A, []))]).toEqual([]);
  });

  it("openBattle finds the reserved or active fight and forgets it after release", async () => {
    const { battleId } = await enc.claim(A, PACK, roster);
    expect(await enc.openBattle(A)).toBeNull();
    await reserveFor(A, battleId);
    expect(await enc.openBattle(A)).toBe(battleId);
    await eco.activate(`res:${battleId}`);
    expect(await enc.openBattle(A)).toBe(battleId);
    expect(await enc.openBattle(B)).toBeNull();
  });

  it("a released (cancelled) fight still hides the pack and is not open", async () => {
    const { battleId } = await enc.claim(A, PACK, roster);
    await reserveFor(A, battleId);
    expect((await eco.release(`res:${battleId}`)).status).toBe("released");
    expect(await enc.openBattle(A)).toBeNull();
    expect((await enc.fought(A, [PACK])).has(PACK)).toBe(true);
    expect((await eco.reservedBag(`res:${battleId}`))?.status).toBe("released");
  });

  it("boss tries: reused until the fight is over, then a new try (no quota, P17), per player", async () => {
    const lair = bossLairId("map:dawn_field");
    expect(await enc.bossAttempt(A, lair)).toBe(1);
    const first = await enc.claim(A, bossAttemptId("map:dawn_field", 1), roster);
    // Claimed but not started (a crash before the reservation): the same try again.
    expect(await enc.bossAttempt(A, lair)).toBe(1);
    await reserveFor(A, first.battleId);
    expect(await enc.bossAttempt(A, lair)).toBe(1);
    await eco.activate(`res:${first.battleId}`);
    expect(await enc.bossAttempt(A, lair)).toBe(1);
    expect(await enc.bossAttempt(B, lair)).toBe(1);
    // The fight ended (settled stands in for the outbox's settlement here).
    db.prepare("UPDATE battle_reservations SET status = 'settled' WHERE reservation_id = ?").run(`res:${first.battleId}`);
    expect(await enc.bossAttempt(A, lair)).toBe(2);
    const second = await enc.claim(A, bossAttemptId("map:dawn_field", 2), roster);
    expect(second.battleId).not.toBe(first.battleId);
    // Tries 10+ sort by number, not text.
    for (const n of [3, 4, 5, 6, 7, 8, 9, 10]) {
      const c = await enc.claim(A, bossAttemptId("map:dawn_field", n), roster);
      await reserveFor(A, c.battleId);
      await eco.release(`res:${c.battleId}`);
    }
    expect(await enc.bossAttempt(A, lair)).toBe(11);
    // Another map's lair is its own count.
    expect(await enc.bossAttempt(A, bossLairId("map:other"))).toBe(1);
  });
});
