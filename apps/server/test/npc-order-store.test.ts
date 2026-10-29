/**
 * NPC Orders (chapter 09) on the D1 migrations (node:sqlite stand-in): fills take the materials and
 * pay once, in the order's town, at most the weekly limit even when raced; a new week resets it.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { PRODUCTION_RULES as R, exampleNpcOrderRegistry } from "@pmrpg/shared";
import { Economy } from "../src/economy";
import { NpcOrderStore } from "../src/npc-order-store";
import { TownServices } from "../src/town-services";
import { exampleContentMaps } from "@pmrpg/shared";
import { SqliteD1, freshDb, type Db } from "./sqlite-d1";

const A = "acct:a";
const TOWN = "map:dawn_town";
let db: Db;
let clock: string;
let orders: NpcOrderStore;
let eco: Economy;
let town: TownServices;
const roof = exampleNpcOrderRegistry().get("order:shell_roof")!;

const at = (mapId: string) =>
  db
    .prepare(
      `INSERT INTO player_positions (account_id, map_id, channel, x, y, generation, updated_at) VALUES (?, ?, 1, 1, 1, 1, 'x')
       ON CONFLICT (account_id) DO UPDATE SET map_id = excluded.map_id`,
    )
    .run(A, mapId);
const fill = (operationId: string, orderId = roof.id) => orders.fill(A, { operationId, orderId });

beforeEach(async () => {
  db = freshDb();
  const d1 = new SqliteD1(db);
  clock = "2026-10-05T22:00:00.000Z";
  const now = () => clock;
  orders = new NpcOrderStore(d1, R, exampleNpcOrderRegistry(), now);
  eco = new Economy(d1, R, now);
  town = new TownServices(d1, R, exampleContentMaps(), [TOWN], now);
  await eco.devGrant("seed:a", A, { "item:crab_shell": 40 });
  at(TOWN);
});

describe("NPC orders", () => {
  it("takes the materials and pays the announced reward once per operation id", async () => {
    const r = await fill("fill_0001");
    expect(r).toMatchObject({ status: "done", replayed: false, result: { orderId: roof.id, periodId: "w:2026-10-05", reward: roof.reward } });
    const again = await Promise.all([fill("fill_0001"), fill("fill_0001")]);
    for (const x of again) expect(x).toMatchObject({ status: "done", replayed: true });
    expect(await eco.balance(A, "item:crab_shell")).toBe(40 - 8);
    expect(await town.coins(A)).toBe(roof.reward.coins);
    expect(await fill("fill_0001", "order:night_lamps")).toMatchObject({ reason: "PAYLOAD_MISMATCH" });
    expect((await orders.view(A)).orders.find((o) => o.order.id === roof.id)).toMatchObject({ filled: 1, left: roof.weeklyLimit - 1 });
  });

  it("stops at the weekly limit even when raced, and a new week opens it again", async () => {
    const rs = await Promise.all(["fill_0101", "fill_0102", "fill_0103", "fill_0104"].map((id) => fill(id)));
    expect(rs.filter((r) => r.status === "done")).toHaveLength(roof.weeklyLimit);
    expect(rs.filter((r) => r.status === "rejected").map((r) => r.status === "rejected" && r.reason)).toEqual(["ORDER_LIMIT"]);
    expect(await eco.balance(A, "item:crab_shell")).toBe(40 - 8 * roof.weeklyLimit);
    clock = "2026-10-12T22:00:00.000Z";
    expect(await fill("fill_0105")).toMatchObject({ status: "done", result: { periodId: "w:2026-10-12" } });
  });

  it("refuses outside the order's town, without the materials, and unknown orders, changing nothing", async () => {
    at("map:dawn_field");
    expect(await fill("fill_0201")).toMatchObject({ reason: "NOT_IN_TOWN" });
    at(TOWN);
    expect(await fill("fill_0202", "order:night_lamps")).toMatchObject({ reason: "INSUFFICIENT_ITEMS" });
    expect(await fill("fill_0203", "order:nope")).toMatchObject({ reason: "NO_SUCH_ORDER" });
    expect(db.prepare("SELECT COUNT(*) AS n FROM npc_order_fills").get()).toEqual({ n: 0 });
    expect(await town.coins(A)).toBe(0);
  });
});
