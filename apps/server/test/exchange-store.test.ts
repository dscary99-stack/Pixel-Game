/**
 * World Market and direct trade (Nut 2026-10-07) on the D1 migrations (node:sqlite stand-in): escrow on
 * listing / offering, one winner when buyers or a buy and a cancel race, replay on retry, ห้ามขาย and
 * ห้ามเทรด, the O01 level gap at the moment a companion moves, and Bond starting again at 0.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { PRODUCTION_RULES as R, exampleContentMaps, marketFee, type ItemDefinition } from "@pmrpg/shared";
import { CharacterStore } from "../src/character-store";
import { DisposalStore } from "../src/disposal-store";
import { Economy } from "../src/economy";
import { MarketStore, TradeStore, type ExchangeContent } from "../src/exchange-store";
import { TownServices } from "../src/town-services";
import { SqliteD1, freshDb, type Db } from "./sqlite-d1";

const A = "acct:a";
const B = "acct:b";
const C = "acct:c";
const TOWN = "map:dawn_town";
const FIELD = "map:dawn_field";
const POTION = "item:small_potion";
const BOUND = "item:bound_token";
const base = exampleContentMaps();
const items = new Map<string, ItemDefinition>(base.items);
items.set(BOUND, { ...base.items.get(POTION)!, id: BOUND, name: { th: "เหรียญผูกตัว" }, noSell: true, noTrade: true });
const content: ExchangeContent = { items, equipment: base.equipment, species: base.species };

let db: Db;
let now: string;
let store: CharacterStore;
let town: TownServices;
let eco: Economy;
let market: MarketStore;
let trade: TradeStore;
let codes: string[];

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
const mon = (id: string) => one<{ owner_id: string; lock_state: string; bond: number; nickname: string | null; ownership_version: number; protected: number }>("SELECT * FROM monster_instances WHERE id = ?", id);
const piece = (id: string) => one<{ owner_id: string; lock_state: string; lock_ref: string | null; protected: number }>("SELECT * FROM equipment_instances WHERE id = ?", id);
const pieceOf = (acct: string, def: string) => one<{ id: string }>("SELECT id FROM equipment_instances WHERE owner_id = ? AND definition_id = ?", acct, def).id;

function pet(id: string, owner: string, speciesId: string, level = 1) {
  db.prepare(
    `INSERT INTO monster_instances (id, species_id, owner_id, current_level, element, primary_stats_json, origin_json, created_operation_id, bond, nickname)
     VALUES (?, ?, ?, ?, 'WATER', '{"STR":10,"VIT":10,"INT":10,"DEX":10,"AGI":10,"SPI":10}', '{"kind":"capture","at":"2026-10-03T00:00:00Z"}', ?, 300, 'ตัวโปรด')`,
  ).run(id, speciesId, owner, level, `seed:${id}`);
}

async function character(acct: string, name: string, level: number) {
  const r = await store.create(acct, { operationId: `op_create_${acct.slice(5)}`, name, classId: "class:guardian", raceId: "race:stonekin", element: "EARTH" });
  expect(r.status).toBe("created");
  db.prepare("UPDATE characters SET level = ? WHERE account_id = ?").run(level, acct);
}

const list = (acct: string, op: string, kind: "item" | "equipment" | "companion", assetId: string, price: number, quantity = 1) =>
  market.list(acct, { operationId: op, kind, assetId, quantity, price, expectedFee: marketFee(R, price) });
const listingOf = (r: Awaited<ReturnType<MarketStore["list"]>>) => {
  if (r.status !== "done") throw new Error(`${r.reason}: ${r.message}`);
  return r.result.listingId;
};
const buy = (acct: string, op: string, listingId: string, expectedPrice: number) => market.buy(acct, { operationId: op, listingId, expectedPrice });
const codeOf = async (acct: string) => (await trade.code(acct))!;

beforeEach(async () => {
  db = freshDb();
  const d1 = new SqliteD1(db);
  now = "2026-10-07T00:00:00.000Z";
  const clock = () => now;
  store = new CharacterStore(d1, R, base, clock);
  town = new TownServices(d1, R, { ...base, items }, [TOWN], clock);
  eco = new Economy(d1, R, clock);
  codes = ["AAAA2222", "BBBB3333", "CCCC4444"];
  market = new MarketStore(d1, R, content, [TOWN], (a) => store.syncLevels(a), clock);
  trade = new TradeStore(d1, R, content, [TOWN], (a) => store.syncLevels(a), clock, () => codes.shift() ?? "ZZZZ9999");
  for (const [acct, name, level] of [
    [A, "ผู้ขาย", 40],
    [B, "ผู้ซื้อ", 20],
    [C, "คนที่สาม", 5],
  ] as const) {
    await character(acct, name, level);
    await eco.devGrant(`seed:${acct}`, acct, { [POTION]: 5, [BOUND]: 2 }); // + 5 from the starter kit = 10
    await town.devGrantCoins(`coins:${acct}`, acct, 10_000);
    at(acct, TOWN);
  }
  await store.devGrantEquipment("gear:a", A, ["equip:wooden_sword", "equip:cloth_tunic"]);
  pet("mon:crab", A, "species:armor_crab", 30);
  pet("mon:fox", B, "species:ember_fox", 10);
});

describe("World Market", () => {
  it("lists a stack into escrow for a fee, sells it once, pays the seller less tax, and replays a retry", async () => {
    const before = { a: coins(A), b: coins(B) };
    const id = listingOf(await list(A, "list_00001", "item", POTION, 1000, 4));
    expect(bag(A)).toBe(6);
    expect(coins(A)).toBe(before.a - marketFee(R, 1000));
    expect(await list(A, "list_00001", "item", POTION, 1000, 4)).toMatchObject({ status: "done", replayed: true, result: { listingId: id } });
    expect(await list(A, "list_00001", "item", POTION, 999, 4)).toMatchObject({ status: "rejected", reason: "PAYLOAD_MISMATCH" });
    expect(bag(A)).toBe(6);

    const view = await market.view(B, {});
    expect("listings" in view && view.listings).toEqual([expect.objectContaining({ listingId: id, sellerName: "ผู้ขาย", price: 1000, mine: false, asset: expect.objectContaining({ kind: "item", quantity: 4 }) })]);

    expect(await buy(B, "buy_00001", id, 1000)).toMatchObject({ status: "done", replayed: false, result: { price: 1000 } });
    expect(await buy(B, "buy_00001", id, 1000)).toMatchObject({ status: "done", replayed: true });
    expect(bag(B)).toBe(14);
    expect(coins(B)).toBe(before.b - 1000);
    // 7% tax burned; the 5% fee was paid at listing (Nut 2026-10-08).
    expect(marketFee(R, 1000)).toBe(50);
    expect(coins(A)).toBe(before.a - 50 + 930);
    expect(await buy(C, "buy_00002", id, 1000)).toMatchObject({ status: "rejected", reason: "CLOSED" });
  });

  it("two buyers racing for one listing: one wins, the other pays nothing", async () => {
    const id = listingOf(await list(A, "list_00002", "item", POTION, 500, 2));
    const [b, c] = [coins(B), coins(C)];
    const rs = await Promise.all([buy(B, "race_b_0001", id, 500), buy(C, "race_c_0001", id, 500)]);
    expect(rs.filter((r) => r.status === "done")).toHaveLength(1);
    expect(rs.filter((r) => r.status === "rejected")).toHaveLength(1);
    expect(bag(B) + bag(C)).toBe(22);
    expect(coins(B) + coins(C)).toBe(b + c - 500);
  });

  it("a buy and a cancel racing: exactly one happens, the fee stays paid", async () => {
    const id = listingOf(await list(A, "list_00003", "item", POTION, 300, 3));
    const [r1, r2] = await Promise.all([buy(B, "race_b_0002", id, 300), market.cancel(A, { operationId: "cancel_0001", listingId: id })]);
    expect([r1.status, r2.status].sort()).toEqual(["done", "rejected"]);
    if (r1.status === "done") expect([bag(A), bag(B)]).toEqual([7, 13]);
    else expect([bag(A), bag(B)]).toEqual([10, 10]);
  });

  it("cancel returns the stack; an expired listing cannot be bought but can still be taken back", async () => {
    const id = listingOf(await list(A, "list_00004", "item", POTION, 100, 5));
    now = "2026-10-11T00:00:00.000Z";
    expect(await buy(B, "buy_00003", id, 100)).toMatchObject({ status: "rejected", reason: "EXPIRED" });
    const v = await market.view(A, {});
    expect("mine" in v && v.mine[0]).toMatchObject({ status: "expired", proceeds: 93 });
    expect("listings" in v && v.listings).toEqual([]);
    expect(await market.cancel(A, { operationId: "cancel_0002", listingId: id })).toMatchObject({ status: "done" });
    expect(await market.cancel(A, { operationId: "cancel_0002", listingId: id })).toMatchObject({ status: "done", replayed: true });
    expect(bag(A)).toBe(10);
    expect(await market.cancel(B, { operationId: "cancel_0003", listingId: id })).toMatchObject({ status: "rejected", reason: "NOT_FOUND" });
  });

  it("refuses: own listing, listing or taking back outside town, wrong fee or price, not enough coins, too many listings; buys anywhere", async () => {
    const id = listingOf(await list(A, "list_00005", "item", POTION, 100));
    expect(await buy(A, "buy_00004", id, 100)).toMatchObject({ status: "rejected", reason: "OWN_LISTING" });
    expect(await buy(B, "buy_00005", id, 99)).toMatchObject({ status: "rejected", reason: "COST_CHANGED" });
    expect(await market.list(A, { operationId: "list_00006", kind: "item", assetId: POTION, quantity: 1, price: 1000, expectedFee: 1 })).toMatchObject({ status: "rejected", reason: "COST_CHANGED" });
    // Listing and taking back are at the NPC in town; buying works anywhere (Nut 2026-10-08).
    at(A, FIELD);
    expect(await list(A, "list_00009", "item", POTION, 100)).toMatchObject({ status: "rejected", reason: "NOT_IN_TOWN" });
    expect(await market.cancel(A, { operationId: "cancel_f001", listingId: id })).toMatchObject({ status: "rejected", reason: "NOT_IN_TOWN" });
    at(A, TOWN);
    at(B, FIELD);
    expect(await buy(B, "buy_00006", id, 100)).toMatchObject({ status: "done" });
    at(B, TOWN);
    await town.devGrantCoins("more:a", A, 100_000);
    await eco.devGrant("more:a", A, { [POTION]: 60 });
    const big = listingOf(await list(A, "list_00007", "item", POTION, 1_000_000));
    expect(await buy(B, "buy_00007", big, 1_000_000)).toMatchObject({ status: "rejected", reason: "NOT_ENOUGH_COINS" });
    expect(await list(A, "list_00008", "item", POTION, 100, 500)).toMatchObject({ status: "rejected", reason: "NOT_ENOUGH_ITEMS" });
    for (let i = 0; i < R.provisional.market.value.maxActiveListings - 1; i++) expect((await list(A, `list_m_${String(i).padStart(4, "0")}`, "item", POTION, 10)).status).toBe("done");
    expect(await list(A, "list_m_9999", "item", POTION, 10)).toMatchObject({ status: "rejected", reason: "TOO_MANY_LISTINGS" });
  });

  it("gear: worn or protected cannot be listed; a listed piece cannot be worn; the buyer gets it free and unprotected", async () => {
    const sword = pieceOf(A, "equip:wooden_sword");
    const tunic = pieceOf(A, "equip:cloth_tunic");
    const v = (await store.get(A))!;
    expect((await store.equip(A, { expectedVersion: v.version, instanceId: tunic, slot: "ARMOR" })).status).toBe("saved");
    expect(await list(A, "list_g_0001", "equipment", tunic, 100)).toMatchObject({ status: "rejected", reason: "WORN" });
    db.prepare("UPDATE equipment_instances SET protected = 1 WHERE id = ?").run(sword);
    expect(await list(A, "list_g_0002", "equipment", sword, 100)).toMatchObject({ status: "rejected", reason: "PROTECTED" });
    db.prepare("UPDATE equipment_instances SET protected = 0 WHERE id = ?").run(sword);
    const id = listingOf(await list(A, "list_g_0003", "equipment", sword, 200));
    expect(piece(sword)).toMatchObject({ lock_state: "in_escrow", lock_ref: id });
    const v2 = (await store.get(A))!;
    expect(await store.equip(A, { expectedVersion: v2.version, instanceId: sword, slot: "MAIN_HAND" })).toMatchObject({ status: "rejected", reason: "ASSET_LOCKED" });
    expect(await list(A, "list_g_0004", "equipment", sword, 300)).toMatchObject({ status: "rejected", reason: "ASSET_LOCKED" });
    expect(await buy(B, "buy_g_0001", id, 200)).toMatchObject({ status: "done", result: { asset: { kind: "equipment", definitionId: "equip:wooden_sword" } } });
    expect(piece(sword)).toMatchObject({ owner_id: B, lock_state: "free", lock_ref: null, protected: 0 });
  });

  it("companions: not from the team, not into the team while listed, buyer must pass O01, Bond and nickname reset", async () => {
    const t = (await store.get(A))!;
    expect((await store.setTeam(A, { expectedVersion: t.version, companionIds: ["mon:crab"] })).status).toBe("saved");
    expect(await list(A, "list_c_0001", "companion", "mon:crab", 5000)).toMatchObject({ status: "rejected", reason: "IN_TEAM" });
    const t2 = (await store.get(A))!;
    expect((await store.setTeam(A, { expectedVersion: t2.version, companionIds: [] })).status).toBe("saved");
    const id = listingOf(await list(A, "list_c_0002", "companion", "mon:crab", 5000));
    const t3 = (await store.get(A))!;
    expect(await store.setTeam(A, { expectedVersion: t3.version, companionIds: ["mon:crab"] })).toMatchObject({ status: "rejected", reason: "ASSET_LOCKED" });
    // Lv30 crab: the buyer needs Lv0+ by level gap... C is Lv5: 30 − 30 = 0 → fine; make it Lv40 to test the gap.
    db.prepare("UPDATE monster_instances SET current_level = 40 WHERE id = 'mon:crab'").run();
    expect(await buy(C, "buy_c_0001", id, 5000)).toMatchObject({ status: "rejected", reason: "LEVEL_INELIGIBLE" });
    expect(await buy(B, "buy_c_0002", id, 5000)).toMatchObject({ status: "done", result: { asset: { kind: "companion", bondAfterTransfer: 0 } } });
    expect(mon("mon:crab")).toMatchObject({ owner_id: B, lock_state: "free", bond: 0, nickname: null, ownership_version: 2 });
  });

  it("ห้ามขาย: an item or piece flagged noSell never reaches the market or an NPC buyer", async () => {
    expect(await list(A, "list_n_0001", "item", BOUND, 100)).toMatchObject({ status: "rejected", reason: "NOT_SELLABLE" });
    expect(await town.sell(A, { operationId: "npc_sell_0001", lines: [{ itemId: BOUND, quantity: 1 }] })).toMatchObject({ status: "rejected", reason: "NOT_SELLABLE" });
    const sword = pieceOf(A, "equip:wooden_sword");
    db.prepare("UPDATE equipment_instances SET no_sell = 1 WHERE id = ?").run(sword);
    expect(await list(A, "list_n_0002", "equipment", sword, 100)).toMatchObject({ status: "rejected", reason: "NOT_SELLABLE" });
    expect((await store.equipment(A)).find((e) => e.id === sword)).toMatchObject({ noSell: true });
    const disposal = new DisposalStore(new SqliteD1(db), R, { equipment: base.equipment, affixPools: base.affixPools }, [TOWN], () => now);
    expect(await disposal.disposeGear(A, { operationId: "dispose_0001", mode: "sell", equipmentIds: [sword], expected: { coins: 8, items: [] } })).toMatchObject({ status: "rejected", reason: "NOT_SELLABLE" });
    db.prepare("UPDATE monster_instances SET no_sell = 1 WHERE id = 'mon:crab'").run();
    expect(await list(A, "list_n_0003", "companion", "mon:crab", 100)).toMatchObject({ status: "rejected", reason: "NOT_SELLABLE" });
  });
});

describe("direct trade", () => {
  it("item trade: our side is held at once; on accept both sides move in one go; retries replay", async () => {
    const sword = pieceOf(A, "equip:wooden_sword");
    const codeB = await codeOf(B);
    expect(codeB).toBe("AAAA2222");
    expect((await trade.view(B))!.myCode).toBe("AAAA-2222");
    const before = { a: coins(A), b: coins(B) };
    const offer = await trade.offer(A, {
      operationId: "offer_0001",
      kind: "item",
      toCode: codeB.slice(0, 4) + "-" + codeB.slice(4),
      give: { items: [{ itemId: POTION, quantity: 3 }], equipmentIds: [sword], coins: 100 },
      want: { items: [{ itemId: POTION, quantity: 1 }], coins: 2000 },
    });
    if (offer.status !== "done") throw new Error(offer.message);
    const offerId = offer.result.offerId;
    expect([bag(A), coins(A), piece(sword).lock_state]).toEqual([7, before.a - 100, "in_escrow"]);
    const inbox = (await trade.view(B))!;
    expect(inbox.open).toEqual([expect.objectContaining({ offerId, direction: "in", fromName: "ผู้ขาย", status: "open", give: expect.objectContaining({ coins: 100 }) })]);

    expect(await trade.accept(B, { operationId: "accept_0001", offerId })).toMatchObject({ status: "done", result: { status: "accepted" } });
    expect(await trade.accept(B, { operationId: "accept_0001", offerId })).toMatchObject({ status: "done", replayed: true });
    expect([bag(A), bag(B)]).toEqual([8, 12]);
    expect([coins(A), coins(B)]).toEqual([before.a - 100 + 2000, before.b + 100 - 2000]);
    expect(piece(sword)).toMatchObject({ owner_id: B, lock_state: "free" });
    expect(await trade.close(A, { operationId: "cancel_t_001", offerId }, "cancelled")).toMatchObject({ status: "rejected", reason: "CLOSED" });
  });

  it("companion trade: both companions move, each owner passes O01, Bond starts at 0", async () => {
    const codeB = await codeOf(B);
    const offer = await trade.offer(A, { operationId: "offer_0002", kind: "companion", toCode: codeB, give: { companionIds: ["mon:crab"] }, want: { companionIds: ["mon:fox"], coins: 50 } });
    if (offer.status !== "done") throw new Error(offer.message);
    expect(mon("mon:crab").lock_state).toBe("in_escrow");
    expect(await trade.accept(B, { operationId: "accept_0002", offerId: offer.result.offerId })).toMatchObject({ status: "done" });
    expect(mon("mon:crab")).toMatchObject({ owner_id: B, bond: 0, nickname: null, lock_state: "free" });
    expect(mon("mon:fox")).toMatchObject({ owner_id: A, bond: 0, nickname: null, lock_state: "free", ownership_version: 2 });
  });

  it("the level gap is checked for whoever receives a companion", async () => {
    const codeC = await codeOf(C);
    // C is Lv5; the Lv30 crab needs Lv0+ (30 − 30) — at Lv40 it needs Lv10.
    db.prepare("UPDATE monster_instances SET current_level = 40 WHERE id = 'mon:crab'").run();
    expect(await trade.offer(A, { operationId: "offer_0003", kind: "companion", toCode: codeC, give: { companionIds: ["mon:crab"] }, want: {} })).toMatchObject({ status: "rejected", reason: "LEVEL_INELIGIBLE" });
    expect(mon("mon:crab").lock_state).toBe("free");
  });

  it("item trade cannot carry companions and companion trade cannot carry items; ห้ามเทรด is refused", async () => {
    const codeB = await codeOf(B);
    expect(await trade.offer(A, { operationId: "offer_0004", kind: "item", toCode: codeB, give: { companionIds: ["mon:crab"] }, want: {} })).toMatchObject({ status: "rejected", reason: "INVALID_TRADE" });
    expect(await trade.offer(A, { operationId: "offer_0005", kind: "companion", toCode: codeB, give: { companionIds: ["mon:crab"], items: [{ itemId: POTION, quantity: 1 }] }, want: {} })).toMatchObject({ status: "rejected", reason: "INVALID_TRADE" });
    expect(await trade.offer(A, { operationId: "offer_0006", kind: "item", toCode: codeB, give: { coins: 5 }, want: { coins: 1 } })).toMatchObject({ status: "rejected", reason: "INVALID_TRADE" });
    expect(await trade.offer(A, { operationId: "offer_0007", kind: "item", toCode: codeB, give: { items: [{ itemId: BOUND, quantity: 1 }] }, want: {} })).toMatchObject({ status: "rejected", reason: "NOT_TRADEABLE" });
    db.prepare("UPDATE monster_instances SET no_trade = 1 WHERE id = 'mon:fox'").run();
    expect(await trade.offer(A, { operationId: "offer_0008", kind: "companion", toCode: codeB, give: { companionIds: ["mon:crab"] }, want: { companionIds: ["mon:fox"] } })).toMatchObject({ status: "rejected", reason: "NOT_TRADEABLE" });
    expect(await trade.offer(A, { operationId: "offer_0009", kind: "item", toCode: await codeOf(A), give: { items: [{ itemId: POTION, quantity: 1 }] }, want: {} })).toMatchObject({ status: "rejected", reason: "SELF_TRADE" });
    expect(await trade.offer(A, { operationId: "offer_0010", kind: "item", toCode: "ZZZZ8888", give: { items: [{ itemId: POTION, quantity: 1 }] }, want: {} })).toMatchObject({ status: "rejected", reason: "NO_SUCH_PLAYER" });
    expect(bag(A)).toBe(10);
  });

  it("decline and cancel return the held side; an offer whose other side is gone moves nothing", async () => {
    const codeB = await codeOf(B);
    const o1 = await trade.offer(A, { operationId: "offer_0011", kind: "item", toCode: codeB, give: { items: [{ itemId: POTION, quantity: 2 }] }, want: {} });
    if (o1.status !== "done") throw new Error(o1.message);
    expect(bag(A)).toBe(8);
    expect(await trade.close(B, { operationId: "decline_001", offerId: o1.result.offerId }, "declined")).toMatchObject({ status: "done", result: { status: "declined" } });
    expect(bag(A)).toBe(10);

    const o2 = await trade.offer(A, { operationId: "offer_0012", kind: "item", toCode: codeB, give: { items: [{ itemId: POTION, quantity: 2 }] }, want: { items: [{ itemId: POTION, quantity: 10 }] } });
    if (o2.status !== "done") throw new Error(o2.message);
    // B spends their potions before accepting.
    await town.sell(B, { operationId: "npc_sell_b01", lines: [{ itemId: POTION, quantity: 5 }] });
    expect(await trade.accept(B, { operationId: "accept_0003", offerId: o2.result.offerId })).toMatchObject({ status: "rejected", reason: "NOT_ENOUGH_ITEMS" });
    expect([bag(A), bag(B)]).toEqual([8, 5]);
    expect(await trade.close(A, { operationId: "cancel_t_002", offerId: o2.result.offerId }, "cancelled")).toMatchObject({ status: "done" });
    expect(bag(A)).toBe(10);
  });

  it("accept and cancel racing: exactly one wins; an expired offer cannot be accepted", async () => {
    const codeB = await codeOf(B);
    const o = await trade.offer(A, { operationId: "offer_0013", kind: "item", toCode: codeB, give: { items: [{ itemId: POTION, quantity: 4 }] }, want: { coins: 10 } });
    if (o.status !== "done") throw new Error(o.message);
    const [r1, r2] = await Promise.all([trade.accept(B, { operationId: "accept_0004", offerId: o.result.offerId }), trade.close(A, { operationId: "cancel_t_003", offerId: o.result.offerId }, "cancelled")]);
    expect([r1.status, r2.status].sort()).toEqual(["done", "rejected"]);
    expect(bag(A) + bag(B)).toBe(20);
    expect(bag(A) === 10 || bag(B) === 14).toBe(true);

    const o2 = await trade.offer(A, { operationId: "offer_0014", kind: "item", toCode: codeB, give: { items: [{ itemId: POTION, quantity: 1 }] }, want: {} });
    if (o2.status !== "done") throw new Error(o2.message);
    now = "2026-10-09T00:00:00.000Z";
    expect(await trade.accept(B, { operationId: "accept_0005", offerId: o2.result.offerId })).toMatchObject({ status: "rejected", reason: "EXPIRED" });
    expect((await trade.view(A))!.open[0]).toMatchObject({ status: "expired" });
  });
});
