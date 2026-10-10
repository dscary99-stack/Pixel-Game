/**
 * Selling / salvaging gear and releasing companions (chapter 09 sinks) on the D1 migrations
 * (node:sqlite stand-in): pays once per operation id even when raced, refuses worn, Sigil-carrying,
 * protected, waiting and fight-held pieces, keeps a snapshot, and leaves history in the journal.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { PRODUCTION_RULES as R, disposeQuote, exampleContentMaps } from "@pmrpg/shared";
import { CharacterStore } from "../src/character-store";
import { DisposalStore } from "../src/disposal-store";
import { Economy } from "../src/economy";
import { TownServices } from "../src/town-services";
import { SqliteD1, freshDb, type Db } from "./sqlite-d1";

const A = "acct:a";
const B = "acct:b";
const TOWN = "map:dawn_town";
const FIELD = "map:dawn_field";
const content = exampleContentMaps();
let db: Db;
let store: CharacterStore;
let town: TownServices;
let eco: Economy;
let disposal: DisposalStore;
let sword: string;
let tunic: string;

const at = (account: string, mapId: string) =>
  db
    .prepare(
      `INSERT INTO player_positions (account_id, map_id, channel, x, y, generation, updated_at) VALUES (?, ?, 1, 1, 1, 1, 'x')
       ON CONFLICT (account_id) DO UPDATE SET map_id = excluded.map_id`,
    )
    .run(account, mapId);
const pieceId = (def: string) => (db.prepare("SELECT id FROM equipment_instances WHERE owner_id = ? AND definition_id = ?").get(A, def) as { id: string }).id;
const quote = (mode: "sell" | "salvage", ids: string[]) =>
  disposeQuote(
    R,
    mode,
    ids.map((id) => {
      const r = db.prepare("SELECT definition_id AS d, rarity FROM equipment_instances WHERE id = ?").get(id) as { d: string; rarity: "COMMON" };
      const def = content.equipment.get(r.d)!;
      return { def, pool: content.affixPools.get(def.affixPoolId)!, rarity: r.rarity };
    }),
  );
const dispose = (operationId: string, mode: "sell" | "salvage", ids: string[], expected = quote(mode, ids)) => disposal.disposeGear(A, { operationId, mode, equipmentIds: ids, expected });
const count = (sql: string, ...args: string[]) => (db.prepare(sql).get(...args) as { n: number }).n;

function pet(id: string, owner: string, speciesId: string) {
  db.prepare(
    `INSERT INTO monster_instances (id, species_id, owner_id, current_level, element, primary_stats_json, origin_json, created_operation_id)
     VALUES (?, ?, ?, 1, 'WATER', '{"STR":10,"VIT":10,"INT":10,"DEX":10,"AGI":10,"SPI":10}', '{"kind":"capture","at":"2026-10-03T00:00:00Z"}', ?)`,
  ).run(id, speciesId, owner, `seed:${id}`);
}

beforeEach(async () => {
  db = freshDb();
  const d1 = new SqliteD1(db);
  const now = () => "2026-10-04T00:00:00Z";
  store = new CharacterStore(d1, R, content, now);
  town = new TownServices(d1, R, content, [TOWN], now);
  eco = new Economy(d1, R, now);
  disposal = new DisposalStore(d1, R, { equipment: content.equipment, affixPools: content.affixPools }, [TOWN], now);
  await eco.devGrant("seed:a", A, {});
  await eco.devGrant("seed:b", B, {});
  await store.devGrantEquipment("gear:a", A, ["equip:wooden_sword", "equip:cloth_tunic", "equip:ember_fang_dagger"]);
  sword = pieceId("equip:wooden_sword");
  tunic = pieceId("equip:cloth_tunic");
  db.prepare("UPDATE equipment_instances SET rarity = 'EPIC' WHERE id = ?").run(tunic);
  pet("mon:crab", A, "species:armor_crab");
  pet("mon:fox", A, "species:ember_fox");
  at(A, TOWN);
});

describe("selling and salvaging gear", () => {
  it("sells for the fixed price by level and rarity, once per operation id, and keeps a snapshot", async () => {
    const q = quote("sell", [sword, tunic]);
    // (4 + 4×1) × 100% + (4 + 4×1) × 400%
    expect(q).toEqual({ coins: 8 + 32, items: [] });
    const r = await dispose("sell_00001", "sell", [tunic, sword]);
    expect(r).toMatchObject({ status: "done", replayed: false, result: { mode: "sell", equipmentIds: [sword, tunic].sort(), paid: q } });
    expect(await dispose("sell_00001", "sell", [sword, tunic], q)).toMatchObject({ status: "done", replayed: true });
    await Promise.all([dispose("sell_00001", "sell", [sword, tunic], q), dispose("sell_00001", "sell", [sword, tunic], q)]);
    expect(await town.coins(A)).toBe(40);
    expect(count("SELECT COUNT(*) AS n FROM equipment_instances WHERE owner_id = ?", A)).toBe(1);
    const snap = JSON.parse((db.prepare("SELECT snapshot_json AS s FROM disposed_assets WHERE asset_id = ?").get(tunic) as { s: string }).s);
    expect(snap).toMatchObject({ definitionId: "equip:cloth_tunic", rarity: "EPIC", affixes: [] });
  });

  it("two different requests racing for the same piece pay once", async () => {
    const rs = await Promise.all([dispose("race_00001", "sell", [sword]), dispose("race_00002", "salvage", [sword])]);
    expect(rs.filter((r) => r.status === "done")).toHaveLength(1);
    expect(rs.filter((r) => r.status === "rejected")[0]).toMatchObject({ reason: "NOT_OWNER" });
    expect((await town.coins(A)) + (await eco.balance(A, "item:river_pebble"))).toBe(rs[0]!.status === "done" ? 8 : 1);
  });

  it("salvage gives the reroll material by rarity", async () => {
    expect(quote("salvage", [sword, tunic])).toEqual({ coins: 0, items: [{ itemId: "item:river_pebble", quantity: 1 + 5 }] });
    expect(await dispose("salv_00001", "salvage", [sword, tunic])).toMatchObject({ status: "done" });
    expect(await eco.balance(A, "item:river_pebble")).toBe(6);
    expect(await town.coins(A)).toBe(0);
  });

  it("refuses worn, Sigil-carrying, protected, waiting and fight-held pieces, outside town, and a stale price", async () => {
    const dagger = pieceId("equip:ember_fang_dagger");
    await store.create(A, { operationId: "op_create_a", name: "นัท", classId: "class:guardian", raceId: "race:stonekin", element: "EARTH" });
    const ch = (await store.get(A))!;
    const coins = await town.coins(A);
    const pieces = count("SELECT COUNT(*) AS n FROM equipment_instances WHERE owner_id = ?", A);
    expect(await store.equip(A, { expectedVersion: ch.version, slot: "MAIN_HAND", instanceId: sword })).toMatchObject({ status: "saved" });
    expect(await dispose("worn_00001", "sell", [sword])).toMatchObject({ reason: "WORN" });

    db.prepare(`UPDATE equipment_instances SET sigil_sockets_json = '["sigil:x"]' WHERE id = ?`).run(dagger);
    expect(await dispose("sigl_00001", "sell", [dagger])).toMatchObject({ reason: "HAS_SIGILS" });
    db.prepare(`UPDATE equipment_instances SET sigil_sockets_json = '[]', affix_pending_json = '{}' WHERE id = ?`).run(dagger);
    expect(await dispose("pend_00001", "sell", [dagger])).toMatchObject({ reason: "CHOICE_PENDING" });
    db.prepare(`UPDATE equipment_instances SET affix_pending_json = NULL, lock_state = 'in_battle' WHERE id = ?`).run(dagger);
    expect(await dispose("lock_00001", "sell", [dagger])).toMatchObject({ reason: "ASSET_LOCKED" });
    db.prepare(`UPDATE equipment_instances SET lock_state = 'free' WHERE id = ?`).run(dagger);

    expect(await disposal.protect(A, { kind: "equipment", id: tunic, protected: true })).toEqual({ ok: true, id: tunic, protected: true });
    expect(await dispose("prot_00001", "sell", [tunic])).toMatchObject({ reason: "PROTECTED" });
    expect((await store.equipment(A)).find((e) => e.id === tunic)?.protected).toBe(true);
    await disposal.protect(A, { kind: "equipment", id: tunic, protected: false });

    expect(await dispose("cost_00001", "sell", [tunic], { coins: 999, items: [] })).toMatchObject({ reason: "COST_CHANGED" });
    at(B, TOWN);
    expect(await disposal.disposeGear(B, { operationId: "othr_00001", mode: "sell", equipmentIds: [tunic], expected: quote("sell", [tunic]) })).toMatchObject({ reason: "NOT_OWNER" });
    expect(await disposal.protect(B, { kind: "equipment", id: tunic, protected: true })).toMatchObject({ ok: false, reason: "NOT_OWNER" });
    at(A, FIELD);
    expect(await dispose("fild_00001", "sell", [tunic])).toMatchObject({ reason: "NOT_IN_TOWN" });
    at(A, TOWN);
    db.prepare(
      "INSERT INTO battle_reservations (reservation_id, account_id, battle_id, status, loadout_json, bag_json, created_at, updated_at) VALUES ('res:x', ?, 'b:x', 'active', '{}', '{}', 't', 't')",
    ).run(A);
    expect(await dispose("figt_00001", "sell", [tunic])).toMatchObject({ reason: "IN_BATTLE" });
    expect(await town.coins(A)).toBe(coins);
    expect(count("SELECT COUNT(*) AS n FROM equipment_instances WHERE owner_id = ?", A)).toBe(pieces);
  });

  it("the same operation id with other pieces is refused", async () => {
    await dispose("same_00001", "sell", [sword]);
    expect(await dispose("same_00001", "sell", [tunic])).toMatchObject({ reason: "PAYLOAD_MISMATCH" });
  });
});

describe("releasing companions", () => {
  it("removes the companion for nothing back, once, keeping a snapshot and the journal history", async () => {
    db.prepare("INSERT INTO quest_activity (account_id, activity_id, kind, subject, quantity, at) VALUES (?, 'k', 'capture', 'species:armor_crab', 1, 't')").run(A);
    const r = await disposal.release(A, { operationId: "rels_00001", companionId: "mon:crab" });
    expect(r).toEqual({ status: "done", replayed: false, result: { companionId: "mon:crab", speciesId: "species:armor_crab" } });
    expect(await disposal.release(A, { operationId: "rels_00001", companionId: "mon:crab" })).toMatchObject({ status: "done", replayed: true });
    expect(await disposal.release(A, { operationId: "rels_00002", companionId: "mon:crab" })).toMatchObject({ reason: "NOT_OWNER" });
    expect((await store.companions(A)).map((c) => c.id)).toEqual(["mon:fox"]);
    expect(count("SELECT COUNT(*) AS n FROM disposed_assets WHERE asset_kind = 'companion'")).toBe(1);
    expect(await town.coins(A)).toBe(0);
  });

  it("refuses a team member, a protected or fight-held companion, and someone else's", async () => {
    await store.create(A, { operationId: "op_create_a", name: "นัท", classId: "class:guardian", raceId: "race:stonekin", element: "EARTH" });
    const ch = (await store.get(A))!;
    await store.setTeam(A, { expectedVersion: ch.version, companionIds: ["mon:fox"] });
    expect(await disposal.release(A, { operationId: "team_00001", companionId: "mon:fox" })).toMatchObject({ reason: "IN_TEAM" });
    await disposal.protect(A, { kind: "companion", id: "mon:crab", protected: true });
    expect(await disposal.release(A, { operationId: "prot_00001", companionId: "mon:crab" })).toMatchObject({ reason: "PROTECTED" });
    await disposal.protect(A, { kind: "companion", id: "mon:crab", protected: false });
    db.prepare("UPDATE monster_instances SET lock_state = 'in_battle' WHERE id = 'mon:crab'").run();
    expect(await disposal.release(A, { operationId: "lock_00001", companionId: "mon:crab" })).toMatchObject({ reason: "ASSET_LOCKED" });
    expect(await disposal.release(B, { operationId: "othr_00001", companionId: "mon:crab" })).toMatchObject({ reason: "NOT_OWNER" });
    expect((await store.companions(A))).toHaveLength(2);
  });

  it("a release racing a team change never leaves a released companion in the team", async () => {
    await store.create(A, { operationId: "op_create_a", name: "นัท", classId: "class:guardian", raceId: "race:stonekin", element: "EARTH" });
    const ch = (await store.get(A))!;
    const [rel, team] = await Promise.all([
      disposal.release(A, { operationId: "race_00001", companionId: "mon:crab" }),
      store.setTeam(A, { expectedVersion: ch.version, companionIds: ["mon:crab"] }),
    ]);
    const inTeam = count("SELECT COUNT(*) AS n FROM character_team WHERE monster_instance_id = 'mon:crab'");
    const exists = count("SELECT COUNT(*) AS n FROM monster_instances WHERE id = 'mon:crab'");
    expect(rel.status === "done" ? exists : 1).toBe(rel.status === "done" ? 0 : 1);
    expect(inTeam).toBeLessThanOrEqual(exists);
    expect(team.status === "saved" || rel.status === "done").toBe(true);
  });
});

describe("nicknames", () => {
  it("sets, shares and clears a cosmetic name; refuses markup and someone else's companion", async () => {
    expect(await disposal.nickname(A, { companionId: "mon:crab", nickname: "  ปู   น้อย " })).toEqual({ ok: true, companionId: "mon:crab", nickname: "ปู น้อย" });
    expect(await disposal.nickname(A, { companionId: "mon:fox", nickname: "ปู น้อย" })).toMatchObject({ ok: true });
    expect((await store.companions(A)).map((c) => c.nickname)).toEqual(["ปู น้อย", "ปู น้อย"]);
    expect(await disposal.nickname(A, { companionId: "mon:crab", nickname: "<b>x</b>" })).toMatchObject({ ok: false, reason: "INVALID_REQUEST" });
    expect(await disposal.nickname(A, { companionId: "mon:crab", nickname: "x".repeat(17) })).toMatchObject({ ok: false, reason: "INVALID_REQUEST" });
    expect(await disposal.nickname(B, { companionId: "mon:crab", nickname: "mine" })).toMatchObject({ ok: false, reason: "NOT_OWNER" });
    expect(await disposal.nickname(A, { companionId: "mon:crab", nickname: null })).toMatchObject({ ok: true, nickname: null });
    expect((await store.companions(A)).find((c) => c.id === "mon:crab")?.nickname).toBeUndefined();
  });
});
