/**
 * Companion box (P26, Nut 2026-10-09): each character keeps up to N companions outside its team, its own
 * and never shared with its other characters. A buy, a trade or taking a member out of the team that
 * would overfill it is refused before anything moves. Capacity is cut to 2 here so the box fills quickly.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { PRODUCTION_RULES, exampleContentMaps, marketFee, type RulesConfig } from "@pmrpg/shared";
import { CharacterStore } from "../src/character-store";
import { Economy } from "../src/economy";
import { MarketStore, TradeStore, type ExchangeContent } from "../src/exchange-store";
import { TownServices } from "../src/town-services";
import { SqliteD1, freshDb, type Db } from "./sqlite-d1";

const R: RulesConfig = {
  ...PRODUCTION_RULES,
  provisional: { ...PRODUCTION_RULES.provisional, companionBox: { ...PRODUCTION_RULES.provisional.companionBox, value: { capacity: 2 } } },
} as unknown as RulesConfig;
const A = "acct:a";
const B = "acct:b";
const TOWN = "map:dawn_town";
const base = exampleContentMaps();
const content: ExchangeContent = { items: base.items, equipment: base.equipment, species: base.species };

let db: Db;
let store: CharacterStore;
let market: MarketStore;
let trade: TradeStore;

const owner = (id: string) => (db.prepare("SELECT owner_id FROM monster_instances WHERE id = ?").get(id) as { owner_id: string }).owner_id;
function pet(id: string, acct: string, speciesId: string, level = 5) {
  db.prepare(
    `INSERT INTO monster_instances (id, species_id, owner_id, current_level, element, primary_stats_json, origin_json, created_operation_id)
     VALUES (?, ?, ?, ?, 'WATER', '{"STR":10,"VIT":10,"INT":10,"DEX":10,"AGI":10,"SPI":10}', '{"kind":"capture","at":"2026-10-03T00:00:00Z"}', ?)`,
  ).run(id, speciesId, acct, level, `seed:${id}`);
}
const box = async (acct: string) => (await store.get(acct))!.companionBox;
const version = async (acct: string) => (await store.get(acct))!.version;

beforeEach(async () => {
  db = freshDb();
  const d1 = new SqliteD1(db);
  const clock = () => "2026-10-09T00:00:00.000Z";
  store = new CharacterStore(d1, R, base, clock);
  const town = new TownServices(d1, R, base, [TOWN], clock);
  const eco = new Economy(d1, R, clock);
  market = new MarketStore(d1, R, content, [TOWN], (a) => store.syncLevels(a), clock);
  const codes = ["AAAA2222", "BBBB3333"];
  trade = new TradeStore(d1, R, content, [TOWN], (a) => store.syncLevels(a), clock, () => codes.shift() ?? "ZZZZ9999");
  for (const acct of [A, B]) {
    const r = await store.create(acct, { operationId: `op_create_${acct.slice(5)}`, name: `ตัว${acct.slice(5)}`, classId: "class:guardian", raceId: "race:stonekin", element: "EARTH" });
    expect(r.status).toBe("created");
    db.prepare("UPDATE characters SET level = 20 WHERE account_id = ?").run(acct);
    await eco.devGrant(`seed:${acct}`, acct, {});
    await town.devGrantCoins(`coins:${acct}`, acct, 10_000);
    db.prepare(`INSERT INTO player_positions (account_id, map_id, channel, x, y, generation, updated_at) VALUES (?, ?, 1, 1, 1, 1, 'x')`).run(acct, TOWN);
  }
  // A: a full box (crab, fox) and one in the team (slime). B: one to sell, one to trade.
  pet("mon:crab", A, "species:armor_crab");
  pet("mon:fox", A, "species:ember_fox");
  pet("mon:slime", A, "species:dew_slime");
  pet("mon:b1", B, "species:armor_crab");
  pet("mon:b2", B, "species:ember_fox");
  expect((await store.setTeam(A, { expectedVersion: await version(A), companionIds: ["mon:slime"] })).status).toBe("saved");
});

describe("companion box (P26)", () => {
  it("counts companions outside the team, per character", async () => {
    expect(await box(A)).toEqual({ used: 2, capacity: 2 });
    expect(await box(B)).toEqual({ used: 2, capacity: 2 });
  });

  it("taking a member out of a full box's team is refused; swapping is fine", async () => {
    expect(await store.setTeam(A, { expectedVersion: await version(A), companionIds: [] })).toMatchObject({ status: "rejected", reason: "COMPANION_BOX_FULL" });
    expect((await store.setTeam(A, { expectedVersion: await version(A), companionIds: ["mon:crab"] })).status).toBe("saved");
    expect(await box(A)).toEqual({ used: 2, capacity: 2 });
  });

  it("a market buy into a full box is refused before coins or the companion move", async () => {
    const listed = await market.list(B, { operationId: "list_box_01", kind: "companion", assetId: "mon:b1", quantity: 1, price: 100, expectedFee: marketFee(R, 100) });
    if (listed.status !== "done") throw new Error(listed.message);
    expect(await market.buy(A, { operationId: "buy_box_001", listingId: listed.result.listingId, expectedPrice: 100 })).toMatchObject({ status: "rejected", reason: "COMPANION_BOX_FULL" });
    expect(owner("mon:b1")).toBe(B);
    // A frees a space by putting one in the team; now the buy goes through.
    expect((await store.setTeam(A, { expectedVersion: await version(A), companionIds: ["mon:slime", "mon:crab"] })).status).toBe("saved");
    expect(await market.buy(A, { operationId: "buy_box_002", listingId: listed.result.listingId, expectedPrice: 100 })).toMatchObject({ status: "done" });
    expect(owner("mon:b1")).toBe(A);
  });

  it("a trade is refused for the side whose box would overflow, checked at offer and at accept", async () => {
    const codeA = (await trade.code(A))!;
    const codeB = (await trade.code(B))!;
    // B offers a companion to A for nothing: A's box would go to 3.
    const offer = await trade.offer(B, { operationId: "offer_box_1", kind: "companion", toCode: codeA, give: { companionIds: ["mon:b1"] }, want: {} });
    if (offer.status !== "done") throw new Error(offer.message);
    expect(await trade.accept(A, { operationId: "accept_box1", offerId: offer.result.offerId })).toMatchObject({ status: "rejected", reason: "COMPANION_BOX_FULL" });
    expect(owner("mon:b1")).toBe(B);
    // A asking for one more than they give is refused at once.
    expect(await trade.offer(A, { operationId: "offer_box_2", kind: "companion", toCode: codeB, give: {}, want: { companionIds: ["mon:b2"] } })).toMatchObject({ status: "rejected", reason: "COMPANION_BOX_FULL" });
    // One for one keeps both boxes level, so it goes through.
    const swap = await trade.offer(A, { operationId: "offer_box_3", kind: "companion", toCode: codeB, give: { companionIds: ["mon:fox"] }, want: { companionIds: ["mon:b2"] } });
    if (swap.status !== "done") throw new Error(swap.message);
    expect(await trade.accept(B, { operationId: "accept_box2", offerId: swap.result.offerId })).toMatchObject({ status: "done" });
    expect([owner("mon:fox"), owner("mon:b2")]).toEqual([B, A]);
  });
});
