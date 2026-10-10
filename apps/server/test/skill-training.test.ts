/**
 * Companion skill training at the town NPC (chapter 04 §5) on the D1 migrations (node:sqlite stand-in).
 */
import { beforeEach, describe, expect, it } from "vitest";
import { PRODUCTION_RULES as R, exampleContentMaps, expForLevel, STARTER_KIT } from "@pmrpg/shared";
import { CharacterStore } from "../src/character-store";
import { Economy } from "../src/economy";
import { TownServices } from "../src/town-services";
import { SqliteD1, freshDb, type Db } from "./sqlite-d1";

const A = "acct:a";
const content = exampleContentMaps();
const TOWN = "map:dawn_town";
const PET = "mon:crab";
const BASH = "skill:crab_shield_bash";
let db: Db;
let town: TownServices;
let eco: Economy;
let store: CharacterStore;

const pet = () =>
  db.prepare("SELECT trained_skill_levels_json AS t, skill_mastery AS m FROM monster_instances WHERE id = ?").get(PET) as { t: string; m: number };
const levels = () => JSON.parse(pet().t) as Record<string, number>;
const at = (mapId: string) =>
  db
    .prepare(
      `INSERT INTO player_positions (account_id, map_id, channel, x, y, generation, updated_at) VALUES (?, ?, 1, 1, 1, 1, 'x')
       ON CONFLICT (account_id) DO UPDATE SET map_id = excluded.map_id`,
    )
    .run(A, mapId);
const req = (operationId: string, expectedLevel = 1, skillId = BASH) => ({ operationId, companionId: PET, skillId, expectedLevel });

beforeEach(async () => {
  db = freshDb();
  const d1 = new SqliteD1(db);
  const now = () => "2026-10-03T00:00:00Z";
  town = new TownServices(d1, R, content, [TOWN], now);
  store = new CharacterStore(d1, R, content, now);
  eco = new Economy(d1, R, now);
  await eco.devGrant("seed:a", A, { "item:crab_shell": 10 });
  await town.devGrantCoins("coins:a", A, 1_000);
  await store.create(A, { operationId: "op_create_a", name: "นัท", classId: "class:striker", raceId: "race:human", element: "FIRE" });
  db.prepare(
    `INSERT INTO monster_instances (id, species_id, owner_id, current_level, xp, element, primary_stats_json, origin_json, created_operation_id, growth_seed, growth_history_version, skill_mastery)
     VALUES (?, 'species:armor_crab', ?, 25, ?, 'EARTH', '{}', '{"kind":"capture","at":"x"}', 'seed:crab', 'g1', 2, 40)`,
  ).run(PET, A, expForLevel(R, "companion", 25));
  at(TOWN);
});

describe("skill training (chapter 04 §5)", () => {
  it("spends mastery, coins and material once and raises the one skill", async () => {
    expect(await town.trainSkill(A, req("train_0001"))).toMatchObject({
      status: "done",
      replayed: false,
      result: { level: 2, paid: { mastery: 10, coins: 100, itemId: "item:crab_shell", quantity: 1 } },
    });
    expect(await town.trainSkill(A, req("train_0001"))).toMatchObject({ status: "done", replayed: true });
    await Promise.all([town.trainSkill(A, req("train_0001")), town.trainSkill(A, req("train_0001"))]);
    expect(levels()).toEqual({ [BASH]: 2 });
    expect(pet().m).toBe(30);
    expect(await town.coins(A)).toBe(900 + STARTER_KIT.coins);
    expect(await eco.balance(A, "item:crab_shell")).toBe(9);
    expect(await town.trainSkill(A, req("train_0001", 2))).toMatchObject({ reason: "PAYLOAD_MISMATCH" });
    // The next step, then the gate: skill Lv4 needs the companion at Lv35.
    expect(await town.trainSkill(A, req("train_0002", 2))).toMatchObject({ status: "done", result: { level: 3 } });
    expect(await town.trainSkill(A, req("train_0003", 3))).toMatchObject({ reason: "LEVEL_TOO_LOW" });
    // The innate trains from its own level, from the same mastery pool.
    expect(await town.trainSkill(A, req("train_0004", 1, "skill:crab_innate_mp_refund"))).toMatchObject({ status: "done", result: { level: 2 } });
    expect(levels()).toEqual({ [BASH]: 3, "skill:crab_innate_mp_refund": 2 });
    expect(pet().m).toBe(0);
  });

  it("two different requests for the same level: one lands, the other finds it changed", async () => {
    const r = await Promise.all([town.trainSkill(A, req("train_race1")), town.trainSkill(A, req("train_race2"))]);
    expect(r.map((x) => x.status).sort()).toEqual(["done", "rejected"]);
    expect(levels()).toEqual({ [BASH]: 2 });
    expect(pet().m).toBe(30);
    expect(await town.coins(A)).toBe(900 + STARTER_KIT.coins);
  });

  it("needs town, no fight, mastery, coins, material and its own species' skill, and writes nothing otherwise", async () => {
    expect(await town.trainSkill(A, req("train_other", 1, "skill:fox_mark_bite"))).toMatchObject({ reason: "NOT_SPECIES_SKILL" });
    expect(await town.trainSkill(A, req("train_stale", 2))).toMatchObject({ reason: "CHANGED" });
    db.prepare("UPDATE monster_instances SET skill_mastery = 9 WHERE id = ?").run(PET);
    expect(await town.trainSkill(A, req("train_mastery"))).toMatchObject({ reason: "MASTERY_TOO_LOW" });
    db.prepare("UPDATE monster_instances SET skill_mastery = 40 WHERE id = ?").run(PET);
    at("map:dawn_field");
    expect(await town.trainSkill(A, req("train_away"))).toMatchObject({ reason: "NOT_IN_TOWN" });
    at(TOWN);
    await town.sell(A, { operationId: "sell_shells", lines: [{ itemId: "item:crab_shell", quantity: 10 }] });
    expect(await town.trainSkill(A, req("train_mats"))).toMatchObject({ reason: "INSUFFICIENT_ITEMS" });
    await eco.devGrant("seed:a2", A, { "item:crab_shell": 5 });
    await eco.reserve({ reservationId: "res:x", accountId: A, battleId: "battle:x", bag: {}, companionIds: [] });
    expect(await town.trainSkill(A, req("train_fight"))).toMatchObject({ reason: "IN_BATTLE" });
    expect(levels()).toEqual({});
    expect(pet().m).toBe(40);
    expect(db.prepare("SELECT COUNT(*) AS n FROM service_operations WHERE kind = 'skill_train'").get()).toEqual({ n: 0 });
  });

  it("refuses past skill level 10", async () => {
    db.prepare(`UPDATE monster_instances SET trained_skill_levels_json = '{"${BASH}":10}' WHERE id = ?`).run(PET);
    expect(await town.trainSkill(A, req("train_max", 10))).toMatchObject({ reason: "MAX_SKILL_LEVEL" });
  });
});
