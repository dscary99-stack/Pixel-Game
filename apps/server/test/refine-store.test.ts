/**
 * Refining / ตีบวก (REFINEMENT_DESIGN v2.1) on the D1 migrations (node:sqlite stand-in): one charge
 * and one roll per operation id even when raced, failures keep the level below +6 and destroy the
 * piece from +6 without a ward, a ward is used up either way and never swapped for a risky attempt,
 * O16 blocks risky attempts on Sigil pieces, and wards are crafted from coins plus materials.
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  PRODUCTION_RULES as R,
  exampleContentMaps,
  exampleRecipeRegistry,
  refineQuote,
  refineStoneItemId,
  refineWardItemId,
  withFixtureOverrides,
  type RefineQuote,
  type RulesConfig,
} from "@pmrpg/shared";
import { CharacterStore } from "../src/character-store";
import { Economy } from "../src/economy";
import { RefineStore } from "../src/refine-store";
import { TownServices } from "../src/town-services";
import { SqliteD1, freshDb, type Db } from "./sqlite-d1";

const A = "acct:a";
const TOWN = "map:dawn_town";
const FIELD = "map:dawn_field";
const content = { ...exampleContentMaps(), recipes: exampleRecipeRegistry() };
const STONE = refineStoneItemId(1);
let db: Db;
let d1: SqliteD1;
let store: CharacterStore;
let town: TownServices;
let eco: Economy;
let rolls: number[];
let dagger: string;
const now = () => "2026-10-07T00:00:00Z";

const refiner = (rules: RulesConfig = R) =>
  new RefineStore(d1, rules, { equipment: content.equipment, items: content.items }, [TOWN], () => {
    const r = rolls.shift();
    if (r === undefined) throw new Error("no roll queued");
    return r;
  }, now);
const at = (mapId: string) =>
  db
    .prepare(
      `INSERT INTO player_positions (account_id, map_id, channel, x, y, generation, updated_at) VALUES (?, ?, 1, 1, 1, 1, 'x')
       ON CONFLICT (account_id) DO UPDATE SET map_id = excluded.map_id`,
    )
    .run(A, mapId);
const piece = (id: string) =>
  db.prepare("SELECT refine_level AS level, version, sigil_sockets_json AS sigils FROM equipment_instances WHERE id = ?").get(id) as
    | { level: number; version: number; sigils: string }
    | undefined;
const setLevel = (id: string, level: number) => db.prepare("UPDATE equipment_instances SET refine_level = ? WHERE id = ?").run(level, id);
const quoteFor = (id: string): RefineQuote => {
  const p = piece(id)!;
  const def = content.equipment.get((db.prepare("SELECT definition_id AS d FROM equipment_instances WHERE id = ?").get(id) as { d: string }).d)!;
  const q = refineQuote(R, def, p.level);
  if (!q.ok) throw new Error(q.message);
  return q.quote;
};
const attempt = (operationId: string, id: string, ward: string | null = null, store = refiner(), q = quoteFor(id), p = piece(id)!) =>
  store.refine(A, {
    operationId,
    equipmentId: id,
    expectedLevel: p.level,
    expectedVersion: p.version,
    wardItemId: ward,
    expectedCost: { coins: q.coins, stoneItemId: q.stoneItemId, stones: q.stones },
  });
const tunicId = () => (db.prepare("SELECT id FROM equipment_instances WHERE definition_id = 'equip:cloth_tunic'").get() as { id: string }).id;
const count = (sql: string, ...args: string[]) => (db.prepare(sql).get(...args) as { n: number }).n;
const spent = async () => ({ coins: await town.coins(A), stones: await eco.balance(A, STONE) });

beforeEach(async () => {
  db = freshDb();
  d1 = new SqliteD1(db);
  store = new CharacterStore(d1, R, content, now);
  town = new TownServices(d1, R, content, [TOWN], now);
  eco = new Economy(d1, R, now);
  rolls = [];
  await eco.devGrant("seed:a", A, { [STONE]: 200 });
  await town.devGrantCoins("coins:a", A, 100_000);
  await store.create(A, { operationId: "op_create_a", name: "นัท", classId: "class:arcanist", raceId: "race:human", element: "WATER" });
  await store.devGrantEquipment("gear:a", A, ["equip:ember_fang_dagger", "equip:cloth_tunic"]);
  dagger = (db.prepare("SELECT id FROM equipment_instances WHERE owner_id = ? AND definition_id = 'equip:ember_fang_dagger'").get(A) as { id: string }).id;
  at(TOWN);
});

describe("refine quotes (v2.1 table)", () => {
  it("prices a Lv5 piece at the 3% floor with tier 1 stones and names its only ward from +6", () => {
    const def = content.equipment.get("equip:ember_fang_dagger")!;
    const q = (level: number) => (refineQuote(R, def, level) as { quote: RefineQuote }).quote;
    expect(q(0)).toEqual({ from: 0, target: 1, successBp: 9500, coins: 30, stoneItemId: STONE, stones: 1, risky: false, wardItemId: null });
    expect(q(5)).toMatchObject({ target: 6, successBp: 6000, coins: 600, stones: 4, risky: true, wardItemId: refineWardItemId(1, 6) });
    expect(q(9)).toMatchObject({ target: 10, successBp: 1000, coins: 3900, stones: 10, wardItemId: refineWardItemId(1, 10) });
    expect(refineQuote(R, def, 10)).toMatchObject({ ok: false, reason: "MAX_LEVEL" });
  });
});

describe("refine attempts", () => {
  it("a success raises the level and version, charges once, and a retry or a racing copy replays the receipt", async () => {
    const before = await spent();
    rolls = [9499, 0, 0];
    const r = await attempt("ref_00001", dagger);
    expect(r).toMatchObject({ status: "done", replayed: false, result: { from: 0, target: 1, outcome: "success", roll: 9499, successBp: 9500, level: 1, version: 2 } });
    expect(piece(dagger)).toMatchObject({ level: 1, version: 2 });
    const q0 = { coins: 30, stoneItemId: STONE, stones: 1 };
    const again = await refiner().refine(A, { operationId: "ref_00001", equipmentId: dagger, expectedLevel: 0, expectedVersion: 1, wardItemId: null, expectedCost: q0 });
    expect(again).toMatchObject({ status: "done", replayed: true, result: { roll: 9499, outcome: "success" } });
    expect(rolls).toHaveLength(2); // the retry never rolled
    expect(await spent()).toEqual({ coins: before.coins - 30, stones: before.stones - 1 });
    expect(await refiner().receipt(A, "ref_00001")).toMatchObject({ outcome: "success", roll: 9499 });
  });

  it("the same operation id raced lands once: one charge, one level", async () => {
    const before = await spent();
    rolls = [10, 20, 30];
    const s = refiner();
    const q = quoteFor(dagger);
    const p = piece(dagger)!;
    const rs = await Promise.all([attempt("ref_race1", dagger, null, s, q, p), attempt("ref_race1", dagger, null, s, q, p), attempt("ref_race1", dagger, null, s, q, p)]);
    expect(rs.every((r) => r.status === "done")).toBe(true);
    expect(new Set(rs.map((r) => (r.status === "done" ? r.result.roll : -1))).size).toBe(1);
    expect(piece(dagger)).toMatchObject({ level: 1, version: 2 });
    expect(await spent()).toEqual({ coins: before.coins - 30, stones: before.stones - 1 });
    expect(count("SELECT COUNT(*) AS n FROM refine_operations")).toBe(1);
  });

  it("two attempts on the same version: only one lands, the other is refused with nothing spent", async () => {
    const before = await spent();
    rolls = [9999, 9999];
    const q = quoteFor(dagger);
    const p = piece(dagger)!;
    const rs = await Promise.all([attempt("ref_v1_000", dagger, null, refiner(), q, p), attempt("ref_v2_000", dagger, null, refiner(), q, p)]);
    expect(rs.filter((r) => r.status === "done")).toHaveLength(1);
    expect(rs.find((r) => r.status === "rejected")).toMatchObject({ reason: "CHANGED" });
    expect(piece(dagger)).toMatchObject({ level: 0, version: 2 });
    expect(await spent()).toEqual({ coins: before.coins - 30, stones: before.stones - 1 });
  });

  it("a failure below +6 keeps the level (4 → 5)", async () => {
    setLevel(dagger, 4);
    rolls = [7500];
    expect(await attempt("ref_keep1", dagger)).toMatchObject({ status: "done", result: { target: 5, outcome: "kept", level: 4 } });
    expect(piece(dagger)).toMatchObject({ level: 4, version: 2 });
  });

  it("a failure at +6 without a ward destroys the piece: taken off, tombstoned, never usable again", async () => {
    const tunic = tunicId();
    setLevel(tunic, 5);
    expect(await store.equip(A, { expectedVersion: 1, slot: "ARMOR", instanceId: tunic })).toMatchObject({ status: "saved" });
    const charVersion = (db.prepare("SELECT version FROM characters WHERE account_id = ?").get(A) as { version: number }).version;
    const before = await spent();
    rolls = [6000];
    const r = await attempt("ref_break1", tunic);
    expect(r).toMatchObject({ status: "done", result: { target: 6, outcome: "destroyed", level: null, version: null, unequipped: "ARMOR", sigilsLost: [] } });
    expect(piece(tunic)).toBeUndefined();
    expect((await store.equipment(A)).some((e) => e.id === tunic)).toBe(false);
    expect(count("SELECT COUNT(*) AS n FROM character_equipment WHERE equipment_instance_id = ?", tunic)).toBe(0);
    expect((db.prepare("SELECT version FROM characters WHERE account_id = ?").get(A) as { version: number }).version).toBe(charVersion + 1);
    const snap = JSON.parse((db.prepare("SELECT snapshot_json AS s FROM disposed_assets WHERE asset_id = ?").get(tunic) as { s: string }).s);
    expect(snap).toMatchObject({ reason: "refine_break", definitionId: "equip:cloth_tunic", refineLevel: 5, target: 6, slot: "ARMOR" });
    expect(await spent()).toEqual({ coins: before.coins - 600, stones: before.stones - 4 });
    // A retry replays the receipt; it never brings the piece back.
    expect(await refiner().refine(A, { operationId: "ref_break1", equipmentId: tunic, expectedLevel: 5, expectedVersion: 1, wardItemId: null, expectedCost: { coins: 600, stoneItemId: STONE, stones: 4 } })).toMatchObject({
      status: "done",
      replayed: true,
      result: { outcome: "destroyed" },
    });
    expect(piece(tunic)).toBeUndefined();
    expect(await store.equip(A, { expectedVersion: charVersion + 1, slot: "ARMOR", instanceId: tunic })).toMatchObject({ status: "rejected" });
  });

  it("a failure at +10 without a ward destroys too; a success at 10% is +10", async () => {
    setLevel(dagger, 9);
    rolls = [999];
    expect(await attempt("ref_ten_ok", dagger)).toMatchObject({ status: "done", result: { outcome: "success", level: 10 } });
    const [tunic] = (db.prepare("SELECT id FROM equipment_instances WHERE definition_id = 'equip:cloth_tunic'").all() as { id: string }[]).map((r) => r.id);
    setLevel(tunic!, 9);
    rolls = [1000];
    expect(await attempt("ref_ten_no", tunic!)).toMatchObject({ status: "done", result: { outcome: "destroyed" } });
  });

  it("with the matching ward a failure keeps the piece and its level; the ward is used up on success and on failure", async () => {
    setLevel(dagger, 5);
    const ward = refineWardItemId(1, 6);
    await eco.devGrant("wards:a", A, { [ward]: 2 });
    rolls = [6000];
    expect(await attempt("ref_ward1", dagger, ward)).toMatchObject({ status: "done", result: { outcome: "kept", level: 5, paid: { wardItemId: ward } } });
    expect(await eco.balance(A, ward)).toBe(1);
    rolls = [5999];
    expect(await attempt("ref_ward2", dagger, ward)).toMatchObject({ status: "done", result: { outcome: "success", level: 6 } });
    expect(await eco.balance(A, ward)).toBe(0);
  });

  it("a wrong, unneeded or missing ward refuses the attempt with nothing spent and no roll", async () => {
    setLevel(dagger, 5);
    await eco.devGrant("wards:b", A, { [refineWardItemId(1, 7)]: 1, [refineWardItemId(2, 6)]: 1 });
    const before = await spent();
    expect(await attempt("ref_w1_000", dagger, refineWardItemId(1, 7))).toMatchObject({ status: "rejected", reason: "WARD_MISMATCH" });
    expect(await attempt("ref_w2_000", dagger, refineWardItemId(2, 6))).toMatchObject({ status: "rejected", reason: "WARD_MISMATCH" });
    rolls = [0];
    expect(await attempt("ref_w3_000", dagger, refineWardItemId(1, 6))).toMatchObject({ status: "rejected", reason: "NO_WARD" });
    setLevel(dagger, 2);
    expect(await attempt("ref_w4_000", dagger, refineWardItemId(1, 6))).toMatchObject({ status: "rejected", reason: "WARD_NOT_USED_HERE" });
    expect(await spent()).toEqual(before);
    expect(piece(dagger)).toMatchObject({ version: 1 });
    expect(count("SELECT COUNT(*) AS n FROM refine_operations")).toBe(0);
  });

  it("refuses outside town, during a fight, on a locked piece, at a stale level or price, and short on coins or stones", async () => {
    const before = await spent();
    at(FIELD);
    expect(await attempt("ref_r1_000", dagger)).toMatchObject({ status: "rejected", reason: "NOT_IN_TOWN" });
    at(TOWN);
    db.prepare(
      "INSERT INTO battle_reservations (reservation_id, account_id, battle_id, status, loadout_json, bag_json, created_at, updated_at) VALUES ('res:x', ?, 'b:x', 'active', '{}', '{}', 't', 't')",
    ).run(A);
    expect(await attempt("ref_r2_000", dagger)).toMatchObject({ status: "rejected", reason: "IN_BATTLE" });
    db.prepare("DELETE FROM battle_reservations").run();
    db.prepare("UPDATE equipment_instances SET lock_state = 'in_escrow' WHERE id = ?").run(dagger);
    expect(await attempt("ref_r3_000", dagger)).toMatchObject({ status: "rejected", reason: "ASSET_LOCKED" });
    db.prepare("UPDATE equipment_instances SET lock_state = 'free' WHERE id = ?").run(dagger);
    expect(await attempt("ref_r4_000", dagger, null, refiner(), quoteFor(dagger), { level: 0, version: 7, sigils: "[]" })).toMatchObject({ status: "rejected", reason: "CHANGED" });
    expect(await attempt("ref_r5_000", dagger, null, refiner(), { ...quoteFor(dagger), coins: 1 })).toMatchObject({ status: "rejected", reason: "COST_CHANGED" });
    rolls = [0, 0];
    db.prepare("INSERT INTO coin_ledger (operation_id, line_no, account_id, delta, reason, created_at) VALUES ('drain', 0, ?, ?, 'test', 't')").run(A, -before.coins + 10);
    expect(await attempt("ref_r6_000", dagger)).toMatchObject({ status: "rejected", reason: "INSUFFICIENT_COINS" });
    await town.devGrantCoins("refill:a", A, 1000);
    db.prepare("INSERT INTO item_ledger (operation_id, line_no, account_id, item_id, delta, reason, created_at) VALUES ('drain', 0, ?, ?, -200, 'test', 't')").run(A, STONE);
    expect(await attempt("ref_r7_000", dagger)).toMatchObject({ status: "rejected", reason: "INSUFFICIENT_STONES" });
    expect(piece(dagger)).toMatchObject({ level: 0, version: 1 });
    expect(count("SELECT COUNT(*) AS n FROM refine_operations")).toBe(0);
  });

  it("the same operation id with another request is refused", async () => {
    rolls = [0];
    await attempt("ref_same", dagger);
    expect(await attempt("ref_same", dagger)).toMatchObject({ status: "rejected", reason: "PAYLOAD_MISMATCH" });
  });
});

describe("Sigils and O16", () => {
  beforeEach(() => {
    setLevel(dagger, 5);
    db.prepare(`UPDATE equipment_instances SET sigil_sockets_json = '["sigil:ember_fox"]' WHERE id = ?`).run(dagger);
  });

  it("refuses a risky attempt without a ward on a Sigil piece while O16 is open, with nothing spent", async () => {
    const before = await spent();
    expect(await attempt("ref_o16_000", dagger)).toMatchObject({ status: "rejected", reason: "UNRESOLVED_RULE" });
    expect(await spent()).toEqual(before);
  });

  it("a warded attempt keeps the Sigils whatever happens; safe targets are not blocked", async () => {
    const ward = refineWardItemId(1, 6);
    await eco.devGrant("wards:s", A, { [ward]: 1 });
    rolls = [9000];
    expect(await attempt("ref_sig1", dagger, ward)).toMatchObject({ status: "done", result: { outcome: "kept" } });
    expect(piece(dagger)!.sigils).toBe('["sigil:ember_fox"]');
    setLevel(dagger, 1);
    rolls = [9999];
    expect(await attempt("ref_sig2", dagger)).toMatchObject({ status: "done", result: { outcome: "kept" } });
  });

  it("with a fixture decision the Sigils break with the piece, or come back to the bag", async () => {
    rolls = [9999];
    const lost = await attempt("ref_sig3", dagger, null, refiner(withFixtureOverrides(R, { sigilOnRefineBreak: "destroyed" })));
    expect(lost).toMatchObject({ status: "done", result: { outcome: "destroyed", sigilsLost: ["sigil:ember_fox"], sigilsReturned: [] } });
    await store.devGrantEquipment("gear:b", A, ["equip:ember_fang_dagger"]);
    const second = (db.prepare("SELECT id FROM equipment_instances WHERE owner_id = ? AND definition_id = 'equip:ember_fang_dagger'").get(A) as { id: string }).id;
    setLevel(second, 5);
    db.prepare(`UPDATE equipment_instances SET sigil_sockets_json = '["sigil:ember_fox"]' WHERE id = ?`).run(second);
    rolls = [9999];
    const back = await attempt("ref_sig4", second, null, refiner(withFixtureOverrides(R, { sigilOnRefineBreak: "returned" })));
    expect(back).toMatchObject({ status: "done", result: { outcome: "destroyed", sigilsLost: [], sigilsReturned: ["sigil:ember_fox"] } });
    expect(await eco.balance(A, "item:ember_fox_sigil")).toBe(1);
  });
});

describe("crafting wards", () => {
  it("costs coins and monster materials, always makes one ward, and a retry gives nothing more", async () => {
    const recipe = content.recipes.get("recipe:refine_ward_t1_p7")!;
    expect(recipe.inputs).toEqual([
      { itemId: "item:crab_shell", quantity: 35 },
      { itemId: "item:crystal_shard", quantity: 4 },
      { itemId: "item:elite_core_t1", quantity: 1 },
    ]);
    await eco.devGrant("mats:a", A, { "item:crab_shell": 35, "item:crystal_shard": 4, "item:elite_core_t1": 1 });
    const coins = await town.coins(A);
    const req = { operationId: "craft_ward1", recipeId: recipe.id, times: 1, expectedCoins: recipe.coins };
    expect(await town.craft(A, req)).toMatchObject({ status: "done", replayed: false });
    expect(await town.craft(A, req)).toMatchObject({ status: "done", replayed: true });
    expect(await eco.balance(A, refineWardItemId(1, 7))).toBe(1);
    expect(await eco.balance(A, "item:crab_shell")).toBe(0);
    expect(await town.coins(A)).toBe(coins - recipe.coins);
    // Short on one material: refused, nothing taken.
    await eco.devGrant("mats:b", A, { "item:crab_shell": 35, "item:crystal_shard": 4 });
    expect(await town.craft(A, { ...req, operationId: "craft_ward2" })).toMatchObject({ status: "rejected", reason: "INSUFFICIENT_ITEMS" });
    expect(await eco.balance(A, "item:crab_shell")).toBe(35);
  });
});
