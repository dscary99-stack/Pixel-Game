/**
 * Account vault and the same-account rule (Nut 2026-10-08) on the D1 migrations (node:sqlite stand-in):
 * one login's characters share a vault (items, gear, coins) at the town NPC; ห้ามฝากคลัง stays out;
 * two characters taking the last stack at once get one winner; a retry replays; and characters of one
 * login cannot trade with each other or buy each other's listings.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { PRODUCTION_RULES as R, exampleContentMaps, marketFee, type EquipmentDefinition, type ItemDefinition } from "@pmrpg/shared";
import { CharacterStore } from "../src/character-store";
import { Economy } from "../src/economy";
import { MarketStore, TradeStore, type ExchangeContent } from "../src/exchange-store";
import { TownServices } from "../src/town-services";
import { VaultStore } from "../src/vault-store";
import { SqliteD1, freshDb, type Db } from "./sqlite-d1";

// A and C are two characters of one login; B is someone else.
const A = "acct:u1-c1";
const C = "acct:u1-c2";
const B = "acct:b";
const TOWN = "map:dawn_town";
const FIELD = "map:dawn_field";
const POTION = "item:small_potion";
const BOUND = "item:soul_token";
const BOUND_GEAR = "equip:soul_ring";
const base = exampleContentMaps();
const items = new Map<string, ItemDefinition>(base.items);
items.set(BOUND, { ...base.items.get(POTION)!, id: BOUND, name: { th: "เหรียญวิญญาณ" }, noStore: true });
const equipment = new Map<string, EquipmentDefinition>(base.equipment);
equipment.set(BOUND_GEAR, { ...base.equipment.get("equip:wooden_sword")!, id: BOUND_GEAR, name: { th: "แหวนวิญญาณ" }, noStore: true });
const content: ExchangeContent = { items, equipment, species: base.species };

let db: Db;
let now: string;
let store: CharacterStore;
let town: TownServices;
let eco: Economy;
let vault: VaultStore;
let market: MarketStore;
let trade: TradeStore;

const at = (account: string, mapId: string) =>
  db
    .prepare(
      `INSERT INTO player_positions (account_id, map_id, channel, x, y, generation, updated_at) VALUES (?, ?, 1, 1, 1, 1, 'x')
       ON CONFLICT (account_id) DO UPDATE SET map_id = excluded.map_id`,
    )
    .run(account, mapId);
const one = <T>(sql: string, ...args: (string | number)[]) => db.prepare(sql).get(...args) as T;
const bag = (acct: string, item = POTION) => one<{ n: number }>("SELECT COALESCE(SUM(delta), 0) AS n FROM item_ledger WHERE account_id = ? AND item_id = ?", acct, item).n;
const coins = (acct: string) => one<{ n: number }>("SELECT COALESCE(SUM(delta), 0) AS n FROM coin_ledger WHERE account_id = ?", acct).n;
const pieceOf = (acct: string, def: string) => one<{ id: string }>("SELECT id FROM equipment_instances WHERE owner_id = ? AND definition_id = ?", acct, def).id;
const owner = (id: string) => one<{ owner_id: string; lock_state: string }>("SELECT owner_id, lock_state FROM equipment_instances WHERE id = ?", id);

beforeEach(async () => {
  db = freshDb();
  const d1 = new SqliteD1(db);
  now = "2026-10-08T00:00:00.000Z";
  const clock = () => now;
  store = new CharacterStore(d1, R, { ...base, equipment }, clock);
  town = new TownServices(d1, R, { ...base, items, equipment }, [TOWN], clock);
  eco = new Economy(d1, R, clock);
  vault = new VaultStore(d1, R, content, [TOWN], clock);
  market = new MarketStore(d1, R, content, [TOWN], (a) => store.syncLevels(a), clock);
  const codes = ["AAAA2222", "BBBB3333", "CCCC4444"];
  trade = new TradeStore(d1, R, content, [TOWN], (a) => store.syncLevels(a), clock, () => codes.shift() ?? "ZZZZ9999");
  for (const [acct, name] of [
    [A, "ตัวหลัก"],
    [C, "ตัวรอง"],
    [B, "คนอื่น"],
  ] as const) {
    const r = await store.create(acct, { operationId: `op_create_${acct.replace(/\W/g, "")}`, name, classId: "class:guardian", raceId: "race:stonekin", element: "EARTH" });
    expect(r.status).toBe("created");
    await eco.devGrant(`seed:${acct}`, acct, { [POTION]: 5, [BOUND]: 2 }); // + 5 from the starter kit = 10 potions
    await town.devGrantCoins(`coins:${acct}`, acct, 9_900); // + 100 starter coins = 10,000
    at(acct, TOWN);
  }
  db.prepare("INSERT INTO users (id, created_at) VALUES ('u1', 'x')").run();
  db.prepare("INSERT INTO user_characters (user_id, slot, account_id, created_at) VALUES ('u1', 1, ?, 'x'), ('u1', 2, ?, 'x')").run(A, C);
  await store.devGrantEquipment("gear:a", A, ["equip:wooden_sword", BOUND_GEAR]);
});

describe("account vault", () => {
  it("one character puts items, a piece and coins in; another character of the same login takes them out", async () => {
    const sword = pieceOf(A, "equip:wooden_sword");
    const put = { operationId: "dep_000001", items: [{ itemId: POTION, quantity: 4 }], equipmentIds: [sword], coins: 3000 };
    expect(await vault.deposit(A, put)).toMatchObject({ status: "done", replayed: false });
    expect(await vault.deposit(A, put)).toMatchObject({ status: "done", replayed: true });
    expect(await vault.deposit(A, { ...put, coins: 1 })).toMatchObject({ status: "rejected", reason: "PAYLOAD_MISMATCH" });
    expect([bag(A), coins(A)]).toEqual([6, 7000]);
    // The piece leaves the character's gear list while it is in the vault.
    expect((await store.equipment(A)).some((e) => e.id === sword)).toBe(false);
    expect(owner(sword)).toMatchObject({ lock_state: "in_escrow" });

    const seen = (await vault.view(C))!;
    expect(seen).toMatchObject({ shared: true, coins: 3000, usedSlots: 2, slots: R.provisional.vault.value.slots, items: [{ itemId: POTION, quantity: 4 }] });
    expect(seen.equipment.map((e) => e.equipmentId)).toEqual([sword]);
    // Someone else's vault is their own.
    expect((await vault.view(B))!).toMatchObject({ shared: false, coins: 0, items: [], equipment: [] });
    expect(await vault.withdraw(B, { operationId: "wd_b00001", coins: 1 })).toMatchObject({ status: "rejected", reason: "NOT_IN_VAULT" });

    const take = { operationId: "wd_000001", items: [{ itemId: POTION, quantity: 4 }], equipmentIds: [sword], coins: 3000 };
    expect(await vault.withdraw(C, take)).toMatchObject({ status: "done" });
    expect(await vault.withdraw(C, take)).toMatchObject({ status: "done", replayed: true });
    expect([bag(C), coins(C)]).toEqual([14, 13_000]);
    expect(owner(sword)).toEqual({ owner_id: C, lock_state: "free" });
    expect((await store.equipment(C)).some((e) => e.id === sword)).toBe(true);
    expect((await vault.view(A))!).toMatchObject({ coins: 0, items: [], equipment: [], usedSlots: 0 });
  });

  it("ห้ามฝากคลัง stays out; worn pieces, too much, and the field are refused with nothing moved", async () => {
    expect(await vault.deposit(A, { operationId: "dep_000002", items: [{ itemId: BOUND, quantity: 1 }] })).toMatchObject({ status: "rejected", reason: "NOT_STORABLE" });
    expect(await vault.deposit(A, { operationId: "dep_000003", equipmentIds: [pieceOf(A, BOUND_GEAR)] })).toMatchObject({ status: "rejected", reason: "NOT_STORABLE" });
    const sword = pieceOf(A, "equip:wooden_sword");
    db.prepare("UPDATE equipment_instances SET no_store = 1 WHERE id = ?").run(sword);
    expect(await vault.deposit(A, { operationId: "dep_000004", equipmentIds: [sword] })).toMatchObject({ status: "rejected", reason: "NOT_STORABLE" });
    db.prepare("UPDATE equipment_instances SET no_store = 0 WHERE id = ?").run(sword);
    const v = (await store.get(A))!;
    expect((await store.equip(A, { expectedVersion: v.version, slot: "MAIN_HAND", instanceId: sword })).status).toBe("saved");
    expect(await vault.deposit(A, { operationId: "dep_000005", equipmentIds: [sword] })).toMatchObject({ status: "rejected", reason: "WORN" });
    expect(await vault.deposit(A, { operationId: "dep_000006", items: [{ itemId: POTION, quantity: 11 }] })).toMatchObject({ status: "rejected", reason: "NOT_ENOUGH_ITEMS" });
    expect(await vault.deposit(A, { operationId: "dep_000007", coins: 10_001 })).toMatchObject({ status: "rejected", reason: "NOT_ENOUGH_COINS" });
    expect(await vault.deposit(A, { operationId: "dep_000008" })).toMatchObject({ status: "rejected", reason: "INVALID_REQUEST" });
    at(A, FIELD);
    expect(await vault.deposit(A, { operationId: "dep_000009", coins: 1 })).toMatchObject({ status: "rejected", reason: "NOT_IN_TOWN" });
    at(A, TOWN);
    expect(await vault.deposit(A, { operationId: "dep_000010", coins: 100 })).toMatchObject({ status: "done" });
    at(C, FIELD);
    // Looking works anywhere; taking out is at the NPC in town.
    expect((await vault.view(C))!.coins).toBe(100);
    expect(await vault.withdraw(C, { operationId: "wd_000002", coins: 100 })).toMatchObject({ status: "rejected", reason: "NOT_IN_TOWN" });
    expect([bag(A), coins(A)]).toEqual([10, 9900]);
  });

  it("two characters taking the last stack at once: one gets it, the other gets nothing", async () => {
    expect(await vault.deposit(A, { operationId: "dep_000011", items: [{ itemId: POTION, quantity: 3 }], coins: 500 })).toMatchObject({ status: "done" });
    const rs = await Promise.all([
      vault.withdraw(A, { operationId: "wd_a00001", items: [{ itemId: POTION, quantity: 3 }], coins: 500 }),
      vault.withdraw(C, { operationId: "wd_c00001", items: [{ itemId: POTION, quantity: 3 }], coins: 500 }),
    ]);
    expect(rs.map((r) => r.status).sort()).toEqual(["done", "rejected"]);
    expect(bag(A) + bag(C)).toBe(20);
    expect(coins(A) + coins(C)).toBe(20_000);
    expect((await vault.view(A))!).toMatchObject({ coins: 0, items: [] });
  });

  it("a full vault refuses new kinds but still takes more of a kind it holds", async () => {
    const slots = R.provisional.vault.value.slots;
    // Fill with fake kinds straight in the ledger (content has fewer item kinds than slots).
    for (let i = 0; i < slots - 1; i++) db.prepare("INSERT INTO vault_item_ledger (operation_id, line_no, vault_id, account_id, item_id, delta, created_at) VALUES (?, 0, 'user:u1', ?, ?, 1, 'x')").run(`fill:${i}`, A, `item:filler_${i}`);
    expect(await vault.deposit(A, { operationId: "dep_000012", items: [{ itemId: POTION, quantity: 1 }] })).toMatchObject({ status: "done" });
    expect(await vault.deposit(A, { operationId: "dep_000013", items: [{ itemId: POTION, quantity: 1 }] })).toMatchObject({ status: "done" });
    expect(await vault.deposit(A, { operationId: "dep_000014", equipmentIds: [pieceOf(A, "equip:wooden_sword")] })).toMatchObject({ status: "rejected", reason: "VAULT_FULL" });
  });

  it("a piece in the vault cannot be listed, and a listed piece cannot go into the vault", async () => {
    const sword = pieceOf(A, "equip:wooden_sword");
    const l = await market.list(A, { operationId: "list_v0001", kind: "equipment", assetId: sword, quantity: 1, price: 100, expectedFee: marketFee(R, 100) });
    expect(l.status).toBe("done");
    expect(await vault.deposit(A, { operationId: "dep_000015", equipmentIds: [sword] })).toMatchObject({ status: "rejected", reason: "ASSET_LOCKED" });
    if (l.status === "done") expect((await market.cancel(A, { operationId: "cancel_v001", listingId: l.result.listingId })).status).toBe("done");
    expect(await vault.deposit(A, { operationId: "dep_000016", equipmentIds: [sword] })).toMatchObject({ status: "done" });
    expect(await market.list(A, { operationId: "list_v0002", kind: "equipment", assetId: sword, quantity: 1, price: 100, expectedFee: marketFee(R, 100) })).toMatchObject({ status: "rejected", reason: "ASSET_LOCKED" });
  });
});

describe("same account", () => {
  it("characters of one login cannot buy each other's listings or trade; others still can", async () => {
    const l = await market.list(A, { operationId: "list_s0001", kind: "item", assetId: POTION, quantity: 2, price: 100, expectedFee: marketFee(R, 100) });
    if (l.status !== "done") throw new Error(l.message);
    expect(await market.buy(C, { operationId: "buy_s00001", listingId: l.result.listingId, expectedPrice: 100 })).toMatchObject({ status: "rejected", reason: "SAME_ACCOUNT" });
    expect(await market.buy(B, { operationId: "buy_s00002", listingId: l.result.listingId, expectedPrice: 100 })).toMatchObject({ status: "done" });
    const codeC = (await trade.code(C))!;
    const codeB = (await trade.code(B))!;
    expect(await trade.offer(A, { operationId: "offer_s001", kind: "item", toCode: codeC, give: { items: [{ itemId: POTION, quantity: 1 }] }, want: {} })).toMatchObject({ status: "rejected", reason: "SAME_ACCOUNT" });
    expect(await trade.offer(A, { operationId: "offer_s002", kind: "item", toCode: codeB, give: { items: [{ itemId: POTION, quantity: 1 }] }, want: {} })).toMatchObject({ status: "done" });
  });
});
