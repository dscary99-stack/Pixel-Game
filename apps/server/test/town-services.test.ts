/**
 * Coins, NPC selling and Sigil install/removal on the D1 migrations (node:sqlite stand-in).
 */
import { beforeEach, describe, expect, it } from "vitest";
import { PRODUCTION_RULES, exampleContentMaps } from "@pmrpg/shared";
import { CharacterStore } from "../src/character-store";
import { Economy } from "../src/economy";
import { TownServices } from "../src/town-services";
import { SqliteD1, freshDb, type Db } from "./sqlite-d1";

const A = "acct:a";
const B = "acct:b";
const content = exampleContentMaps();
const TOWN = "map:dawn_town";
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
const piece = (account: string, def: string) =>
  (db.prepare("SELECT id FROM equipment_instances WHERE owner_id = ? AND definition_id = ?").get(account, def) as { id: string }).id;
const sockets = (id: string) => JSON.parse((db.prepare("SELECT sigil_sockets_json AS s FROM equipment_instances WHERE id = ?").get(id) as { s: string }).s);

beforeEach(async () => {
  db = freshDb();
  const d1 = new SqliteD1(db);
  const now = () => "2026-10-03T00:00:00Z";
  town = new TownServices(d1, PRODUCTION_RULES, content, [TOWN], now);
  store = new CharacterStore(d1, PRODUCTION_RULES, content, now);
  eco = new Economy(d1, PRODUCTION_RULES, now);
  await eco.devGrant("seed:a", A, { "item:crab_shell": 10, "item:mole_fur": 3, "item:armor_crab_capture": 1, "item:ember_fox_sigil": 3, "item:supply_mole_sigil": 1 });
  await eco.devGrant("seed:b", B, { "item:crab_shell": 1 });
  await store.devGrantEquipment("gear:a", A, ["equip:wooden_sword", "equip:cloth_tunic", "equip:glow_charm", "equip:training_bow"]);
  await store.devGrantEquipment("gear:b", B, ["equip:wooden_sword"]);
  at(A, TOWN);
});

describe("selling to the NPC", () => {
  it("pays vendorPrice per unit in coins, once per operation id", async () => {
    const req = { operationId: "sell_0001", lines: [{ itemId: "item:crab_shell", quantity: 4 }, { itemId: "item:mole_fur", quantity: 3 }] };
    expect(await town.sell(A, req)).toMatchObject({ status: "done", replayed: false, result: { total: 4 * 5 + 3 * 2 } });
    expect(await town.sell(A, req)).toMatchObject({ status: "done", replayed: true });
    await Promise.all([town.sell(A, req), town.sell(A, req)]);
    expect(await town.coins(A)).toBe(26);
    expect(await eco.balance(A, "item:crab_shell")).toBe(6);
    expect(await town.sell(A, { ...req, lines: [{ itemId: "item:crab_shell", quantity: 1 }] })).toMatchObject({ reason: "PAYLOAD_MISMATCH" });
  });

  it("refuses unsellable items, too many, outside town and during a fight, writing nothing", async () => {
    expect(await town.sell(A, { operationId: "sell_0002", lines: [{ itemId: "item:armor_crab_capture", quantity: 1 }] })).toMatchObject({ reason: "NOT_SELLABLE" });
    expect(await town.sell(A, { operationId: "sell_0003", lines: [{ itemId: "item:ember_fox_sigil", quantity: 1 }] })).toMatchObject({ reason: "NOT_SELLABLE" });
    expect(await town.sell(A, { operationId: "sell_0004", lines: [{ itemId: "item:crab_shell", quantity: 11 }] })).toMatchObject({ reason: "INSUFFICIENT_ITEMS" });
    expect(await town.sell(B, { operationId: "sell_0005", lines: [{ itemId: "item:crab_shell", quantity: 1 }] })).toMatchObject({ reason: "NOT_IN_TOWN" });
    at(A, "map:dawn_field");
    expect(await town.sell(A, { operationId: "sell_0006", lines: [{ itemId: "item:crab_shell", quantity: 1 }] })).toMatchObject({ reason: "NOT_IN_TOWN" });
    at(A, TOWN);
    await eco.reserve({ reservationId: "res:x", accountId: A, battleId: "battle:x", bag: {}, companionIds: [] });
    expect(await town.sell(A, { operationId: "sell_0007", lines: [{ itemId: "item:crab_shell", quantity: 1 }] })).toMatchObject({ reason: "IN_BATTLE" });
    expect(await town.coins(A)).toBe(0);
    expect(await eco.balance(A, "item:crab_shell")).toBe(10);
    expect(db.prepare("SELECT COUNT(*) AS n FROM service_operations").get()).toEqual({ n: 0 });
  });

  it("two sales racing for the same last items: only one is paid", async () => {
    const r = await Promise.all(
      ["sell_race1", "sell_race2"].map((operationId) => town.sell(A, { operationId, lines: [{ itemId: "item:crab_shell", quantity: 10 }] })),
    );
    expect(r.map((x) => x.status).sort()).toEqual(["done", "rejected"]);
    expect(await town.coins(A)).toBe(50);
    expect(await eco.balance(A, "item:crab_shell")).toBe(0);
  });
});

describe("installing Sigils", () => {
  it("puts a Sigil from the bag into a compatible piece, duplicates allowed, once per operation id", async () => {
    const sword = piece(A, "equip:wooden_sword");
    const req = { operationId: "inst_0001", equipmentId: sword, sigilItemId: "item:ember_fox_sigil" };
    expect(await town.installSigil(A, req)).toMatchObject({ status: "done", result: { sigils: ["sigil:ember_fox"] } });
    expect(await town.installSigil(A, req)).toMatchObject({ status: "done", replayed: true });
    expect(sockets(sword)).toEqual(["sigil:ember_fox"]);
    expect(await eco.balance(A, "item:ember_fox_sigil")).toBe(2);
    // The wooden sword has 1 socket (its own count, under the weapon cap of 4).
    expect(await town.installSigil(A, { ...req, operationId: "inst_0002" })).toMatchObject({ reason: "SIGIL_SLOTS_FULL" });
    // The bow has 2 sockets; the same Sigil twice is fine (C24).
    const bow = piece(A, "equip:training_bow");
    await town.installSigil(A, { operationId: "inst_0003", equipmentId: bow, sigilItemId: "item:ember_fox_sigil" });
    await town.installSigil(A, { operationId: "inst_0004", equipmentId: bow, sigilItemId: "item:ember_fox_sigil" });
    expect(sockets(bow)).toEqual(["sigil:ember_fox", "sigil:ember_fox"]);
    expect(await eco.balance(A, "item:ember_fox_sigil")).toBe(0);
  });

  it("checks compatibility, the item kind, ownership, the bag and fights", async () => {
    const tunic = piece(A, "equip:cloth_tunic");
    expect(await town.installSigil(A, { operationId: "inst_0010", equipmentId: tunic, sigilItemId: "item:ember_fox_sigil" })).toMatchObject({ reason: "SIGIL_INCOMPATIBLE" });
    expect(await town.installSigil(A, { operationId: "inst_0011", equipmentId: tunic, sigilItemId: "item:crab_shell" })).toMatchObject({ reason: "NOT_A_SIGIL" });
    expect(await town.installSigil(A, { operationId: "inst_0012", equipmentId: piece(B, "equip:wooden_sword"), sigilItemId: "item:ember_fox_sigil" })).toMatchObject({ reason: "NOT_OWNER" });
    expect(await town.installSigil(B, { operationId: "inst_0013", equipmentId: piece(B, "equip:wooden_sword"), sigilItemId: "item:ember_fox_sigil" })).toMatchObject({ reason: "INSUFFICIENT_ITEMS" });
    await eco.reserve({ reservationId: "res:y", accountId: A, battleId: "battle:y", bag: {}, companionIds: [] });
    expect(await town.installSigil(A, { operationId: "inst_0014", equipmentId: piece(A, "equip:glow_charm"), sigilItemId: "item:supply_mole_sigil" })).toMatchObject({ reason: "IN_BATTLE" });
  });

  it("two installs racing for one socket: one lands, one Sigil is spent", async () => {
    const charm = piece(A, "equip:glow_charm");
    await eco.devGrant("seed:a2", A, { "item:supply_mole_sigil": 1 });
    const r = await Promise.all(["inst_race1", "inst_race2"].map((operationId) => town.installSigil(A, { operationId, equipmentId: charm, sigilItemId: "item:supply_mole_sigil" })));
    expect(r.map((x) => x.status).sort()).toEqual(["done", "rejected"]);
    expect(sockets(charm)).toEqual(["sigil:supply_mole"]);
    expect(await eco.balance(A, "item:supply_mole_sigil")).toBe(1);
  });
});

describe("removing Sigils", () => {
  let sword: string;
  beforeEach(async () => {
    sword = piece(A, "equip:wooden_sword");
    await town.installSigil(A, { operationId: "inst_setup", equipmentId: sword, sigilItemId: "item:ember_fox_sigil" });
  });

  it("costs the tier price, returns the Sigil to the bag (P08) and is idempotent", async () => {
    await town.devGrantCoins("coins:a", A, 700);
    const req = { operationId: "remove_0001", equipmentId: sword, socket: 0, expectedCost: 300 };
    expect(await town.removeSigil(A, req)).toMatchObject({ status: "done", result: { sigils: [], paid: 300 } });
    expect(await town.removeSigil(A, req)).toMatchObject({ status: "done", replayed: true });
    expect(await town.coins(A)).toBe(400);
    expect(await eco.balance(A, "item:ember_fox_sigil")).toBe(3);
    expect(sockets(sword)).toEqual([]);
  });

  it("refuses a changed price, too few coins, an empty socket, outside town and during a fight", async () => {
    expect(await town.removeSigil(A, { operationId: "remove_0002", equipmentId: sword, socket: 0, expectedCost: 100 })).toMatchObject({ reason: "COST_CHANGED" });
    expect(await town.removeSigil(A, { operationId: "remove_0003", equipmentId: sword, socket: 0, expectedCost: 300 })).toMatchObject({ reason: "INSUFFICIENT_COINS" });
    await town.devGrantCoins("coins:a", A, 300);
    expect(await town.removeSigil(A, { operationId: "remove_0004", equipmentId: sword, socket: 1, expectedCost: 300 })).toMatchObject({ reason: "NO_SUCH_SOCKET" });
    at(A, "map:dawn_field");
    expect(await town.removeSigil(A, { operationId: "remove_0005", equipmentId: sword, socket: 0, expectedCost: 300 })).toMatchObject({ reason: "NOT_IN_TOWN" });
    at(A, TOWN);
    await eco.reserve({ reservationId: "res:z", accountId: A, battleId: "battle:z", bag: {}, companionIds: [], equipmentIds: [sword] });
    expect(await town.removeSigil(A, { operationId: "remove_0006", equipmentId: sword, socket: 0, expectedCost: 300 })).toMatchObject({ reason: "IN_BATTLE" });
    expect(await town.coins(A)).toBe(300);
    expect(sockets(sword)).toEqual(["sigil:ember_fox"]);
  });

  it("the equipment list shows installed Sigils", async () => {
    expect((await store.equipment(A)).find((e) => e.id === sword)?.sigils).toEqual(["sigil:ember_fox"]);
  });
});
