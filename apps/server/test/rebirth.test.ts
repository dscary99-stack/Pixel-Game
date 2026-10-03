/**
 * Companion Rebirth at the town NPC (chapter 04 §7) on the D1 migrations (node:sqlite stand-in).
 */
import { beforeEach, describe, expect, it } from "vitest";
import { PRODUCTION_RULES as R, companionPrimaryStats, exampleContentMaps, expForLevel } from "@pmrpg/shared";
import { CharacterStore } from "../src/character-store";
import { Economy } from "../src/economy";
import { TownServices } from "../src/town-services";
import { SqliteD1, freshDb, type Db } from "./sqlite-d1";

const A = "acct:a";
const content = exampleContentMaps();
const TOWN = "map:dawn_town";
const PET = "mon:crab";
let db: Db;
let town: TownServices;
let eco: Economy;
let store: CharacterStore;

const pet = () =>
  db.prepare("SELECT rebirth_stage, current_level, xp, primary_stats_json, bond, element, growth_seed FROM monster_instances WHERE id = ?").get(PET) as {
    rebirth_stage: number;
    current_level: number;
    xp: number;
    primary_stats_json: string;
    bond: number;
    element: string;
    growth_seed: string;
  };
const setXp = (table: "characters" | "monster_instances", where: string, id: string, xp: number) =>
  db.prepare(`UPDATE ${table} SET xp = ? WHERE ${where} = ?`).run(xp, id);
const at = (mapId: string) =>
  db
    .prepare(
      `INSERT INTO player_positions (account_id, map_id, channel, x, y, generation, updated_at) VALUES (?, ?, 1, 1, 1, 1, 'x')
       ON CONFLICT (account_id) DO UPDATE SET map_id = excluded.map_id`,
    )
    .run(A, mapId);
const req = (operationId: string, expectedStage = 0) => ({ operationId, companionId: PET, expectedStage });

beforeEach(async () => {
  db = freshDb();
  const d1 = new SqliteD1(db);
  const now = () => "2026-10-03T00:00:00Z";
  town = new TownServices(d1, R, content, [TOWN], now);
  store = new CharacterStore(d1, R, content, now);
  eco = new Economy(d1, R, now);
  await eco.devGrant("seed:a", A, { "item:crab_shell": 100 });
  await town.devGrantCoins("coins:a", A, 100_000);
  await store.create(A, { operationId: "op_create_a", name: "นัท", classId: "class:striker", raceId: "race:human", element: "FIRE" });
  setXp("characters", "account_id", A, expForLevel(R, "player", 100));
  db.prepare(
    `INSERT INTO monster_instances (id, species_id, owner_id, current_level, xp, element, primary_stats_json, origin_json, created_operation_id, growth_seed, growth_history_version, bond)
     VALUES (?, 'species:armor_crab', ?, 200, ?, 'EARTH', '{}', '{"kind":"capture","at":"x"}', 'seed:crab', 'g1', 2, 321)`,
  ).run(PET, A, expForLevel(R, "companion", 200));
  at(TOWN);
});

describe("companion Rebirth (chapter 04 §7)", () => {
  it("charges coins and the species material once, and starts the same growth path at Lv1 with the bonus", async () => {
    expect(await town.rebirth(A, req("rebirth_0001"))).toMatchObject({
      status: "done",
      replayed: false,
      result: { stage: 1, paid: { coins: 50_000, itemId: "item:crab_shell", quantity: 30 } },
    });
    expect(await town.rebirth(A, req("rebirth_0001"))).toMatchObject({ status: "done", replayed: true });
    await Promise.all([town.rebirth(A, req("rebirth_0001")), town.rebirth(A, req("rebirth_0001"))]);
    expect(await town.coins(A)).toBe(50_000);
    expect(await eco.balance(A, "item:crab_shell")).toBe(70);
    const p = pet();
    expect(p).toMatchObject({ rebirth_stage: 1, current_level: 1, xp: 0, bond: 321, element: "EARTH", growth_seed: "g1" });
    expect(JSON.parse(p.primary_stats_json)).toEqual(companionPrimaryStats(R, "tank", "g1", 1, 1));
    expect(await town.rebirth(A, { ...req("rebirth_0001"), expectedStage: 1 })).toMatchObject({ reason: "PAYLOAD_MISMATCH" });
  });

  it("two different requests for the same stage: one lands, the other finds it changed", async () => {
    const r = await Promise.all([town.rebirth(A, req("rebirth_race1")), town.rebirth(A, req("rebirth_race2"))]);
    expect(r.map((x) => x.status).sort()).toEqual(["done", "rejected"]);
    expect(await town.coins(A)).toBe(50_000);
    expect(pet().rebirth_stage).toBe(1);
  });

  it("needs max level, the licence level, coins, material, town and no fight, and writes nothing otherwise", async () => {
    setXp("monster_instances", "id", PET, expForLevel(R, "companion", 199));
    expect(await town.rebirth(A, req("rebirth_low1"))).toMatchObject({ reason: "LEVEL_TOO_LOW" });
    setXp("monster_instances", "id", PET, expForLevel(R, "companion", 200));
    setXp("characters", "account_id", A, expForLevel(R, "player", 99));
    expect(await town.rebirth(A, req("rebirth_low2"))).toMatchObject({ reason: "PLAYER_LEVEL_TOO_LOW" });
    setXp("characters", "account_id", A, expForLevel(R, "player", 100));
    at("map:dawn_field");
    expect(await town.rebirth(A, req("rebirth_away"))).toMatchObject({ reason: "NOT_IN_TOWN" });
    at(TOWN);
    await town.sell(A, { operationId: "sell_most_shells", lines: [{ itemId: "item:crab_shell", quantity: 80 }] });
    expect(await town.rebirth(A, req("rebirth_mats"))).toMatchObject({ reason: "INSUFFICIENT_ITEMS" });
    await eco.devGrant("seed:a2", A, { "item:crab_shell": 50 });
    await eco.reserve({ reservationId: "res:x", accountId: A, battleId: "battle:x", bag: {}, companionIds: [] });
    expect(await town.rebirth(A, req("rebirth_fight"))).toMatchObject({ reason: "IN_BATTLE" });
    expect(pet().rebirth_stage).toBe(0);
    expect(db.prepare("SELECT COUNT(*) AS n FROM service_operations WHERE kind = 'companion_rebirth'").get()).toEqual({ n: 0 });
  });

  it("stops at the third Rebirth", async () => {
    db.prepare("UPDATE monster_instances SET rebirth_stage = 3 WHERE id = ?").run(PET);
    expect(await town.rebirth(A, req("rebirth_max", 3))).toMatchObject({ reason: "MAX_REBIRTH" });
  });
});
