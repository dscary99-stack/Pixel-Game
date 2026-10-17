/**
 * Bond beyond won fights (chapter 04 §6, P35) on the D1 migrations (node:sqlite stand-in): favourite
 * gifts and the first visit to a map. The first boss win is in progression.test.ts.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { PRODUCTION_RULES as R, exampleContentMaps } from "@pmrpg/shared";
import { CharacterStore } from "../src/character-store";
import { Economy } from "../src/economy";
import { TownServices } from "../src/town-services";
import { SqliteD1, freshDb, type Db } from "./sqlite-d1";

const A = "acct:a";
const content = exampleContentMaps();
const PET = "mon:crab";
const FAV = "item:river_pebble"; // the crab's favourite (EXAMPLE)
const src = R.provisional.bondSources.value;
let db: Db;
let town: TownServices;
let eco: Economy;
let store: CharacterStore;

const pet = () =>
  db.prepare("SELECT bond, gift_bond AS g, wins_since_gift AS w FROM monster_instances WHERE id = ?").get(PET) as { bond: number; g: number; w: number };
const set = (bond: number, gift: number, wins: number) => db.prepare("UPDATE monster_instances SET bond = ?, gift_bond = ?, wins_since_gift = ? WHERE id = ?").run(bond, gift, wins, PET);
const req = (operationId: string, itemId = FAV) => ({ operationId, companionId: PET, itemId });

beforeEach(async () => {
  db = freshDb();
  const d1 = new SqliteD1(db);
  const now = () => "2026-10-14T00:00:00Z";
  town = new TownServices(d1, R, content, ["map:dawn_town"], now);
  store = new CharacterStore(d1, R, content, now);
  eco = new Economy(d1, R, now);
  await eco.devGrant("seed:a", A, { [FAV]: 3, "item:mole_fur": 1 });
  const made = await store.create(A, { operationId: "op_create_a", name: "นัท", classId: "class:striker", raceId: "race:human", element: "FIRE" });
  if (made.status !== "created") throw new Error("create failed");
  db.prepare(
    `INSERT INTO monster_instances (id, species_id, owner_id, current_level, xp, element, primary_stats_json, origin_json, created_operation_id, growth_seed, growth_history_version)
     VALUES (?, 'species:armor_crab', ?, 5, 0, 'EARTH', '{}', '{"kind":"capture","at":"x"}', 'seed:crab', 'g1', 2)`,
  ).run(PET, A);
  db.prepare(`INSERT INTO character_team (character_id, position, monster_instance_id, species_id, row, slot) VALUES (?, 0, ?, 'species:armor_crab', 'back', 1)`).run(made.character.id, PET);
});

describe("favourite gifts (P35)", () => {
  it("need won fights together first, then give Bond once for one item; a retry replays", async () => {
    expect(await town.gift(A, req("gift_0001"))).toMatchObject({ status: "rejected", reason: "NEEDS_ADVENTURE" });
    set(0, 0, src.favoriteWinsBetween);
    expect(await town.gift(A, req("gift_0002", "item:mole_fur"))).toMatchObject({ reason: "NOT_FAVORITE" });
    expect(await town.gift(A, req("gift_0003"))).toMatchObject({ status: "done", replayed: false, result: { gain: src.favoriteGift, bond: src.favoriteGift } });
    expect(await town.gift(A, req("gift_0003"))).toMatchObject({ status: "done", replayed: true });
    await Promise.all([town.gift(A, req("gift_0003")), town.gift(A, req("gift_0003"))]);
    expect(pet()).toEqual({ bond: src.favoriteGift, g: src.favoriteGift, w: 0 });
    expect(await eco.balance(A, FAV)).toBe(2);
    // The counter starts over: the next gift needs adventure again.
    expect(await town.gift(A, req("gift_0004"))).toMatchObject({ reason: "NEEDS_ADVENTURE" });
    expect(await town.gift(A, { ...req("gift_0003"), itemId: "item:mole_fur" })).toMatchObject({ reason: "PAYLOAD_MISMATCH" });
  });

  it("two different gifts at once: one lands, one item used", async () => {
    set(0, 0, src.favoriteWinsBetween);
    const r = await Promise.all([town.gift(A, req("gift_race1")), town.gift(A, req("gift_race2"))]);
    expect(r.map((x) => x.status).sort()).toEqual(["done", "rejected"]);
    expect(pet()).toEqual({ bond: src.favoriteGift, g: src.favoriteGift, w: 0 });
    expect(await eco.balance(A, FAV)).toBe(2);
  });

  it("stop at the gift cap and at Bond 1000; no item, no gift", async () => {
    set(100, src.favoriteGiftCap - 4, 99);
    expect(await town.gift(A, req("gift_cap1"))).toMatchObject({ status: "done", result: { gain: 4, bond: 104 } });
    set(104, src.favoriteGiftCap, 99);
    expect(await town.gift(A, req("gift_cap2"))).toMatchObject({ reason: "GIFT_CAP" });
    set(1000, 0, 99);
    expect(await town.gift(A, req("gift_cap3"))).toMatchObject({ reason: "BOND_FULL" });
    set(995, 0, 99);
    expect(await town.gift(A, req("gift_cap4"))).toMatchObject({ status: "done", result: { gain: 5, bond: 1000 } });
    set(0, 0, 99);
    db.prepare(`INSERT INTO item_ledger (operation_id, line_no, account_id, item_id, delta, reason, created_at) VALUES ('drain', 0, ?, ?, ?, 'test', 'x')`).run(A, FAV, -((await eco.balance(A, FAV)) as number));
    expect(await town.gift(A, req("gift_none"))).toMatchObject({ reason: "INSUFFICIENT_ITEMS" });
    expect(pet().bond).toBe(0);
  });

  it("not during a fight, and not for someone else's companion", async () => {
    set(0, 0, 99);
    db.prepare("INSERT INTO battle_reservations (reservation_id, account_id, battle_id, status, loadout_json, bag_json, created_at, updated_at) VALUES ('r', ?, 'b', 'active', '{}', '{}', 't', 't')").run(A);
    expect(await town.gift(A, req("gift_fight"))).toMatchObject({ reason: "IN_BATTLE" });
    expect(await town.gift("acct:b", req("gift_other"))).toMatchObject({ reason: "NOT_OWNER" });
    expect(pet().bond).toBe(0);
  });
});

describe("first visit to a map (P35)", () => {
  it("each team companion gains once per map under this owner; walking back in adds nothing", async () => {
    expect(await store.bondFirstVisit(A, "map:dawn_field")).toEqual([PET]);
    expect(await store.bondFirstVisit(A, "map:dawn_field")).toEqual([]);
    await Promise.all([store.bondFirstVisit(A, "map:dawn_cave"), store.bondFirstVisit(A, "map:dawn_cave")]);
    expect(pet().bond).toBe(2 * src.firstMapVisit);
    // Another owner's companion is not this team's: nothing.
    await eco.devGrant("seed:b", "acct:b", {});
    db.prepare("DELETE FROM character_team").run();
    db.prepare("UPDATE monster_instances SET owner_id = 'acct:b', bond = 0 WHERE id = ?").run(PET);
    expect(await store.bondFirstVisit(A, "map:dawn_field")).toEqual([]);
  });

  it("companions not in the team gain nothing", async () => {
    db.prepare("DELETE FROM character_team").run();
    expect(await store.bondFirstVisit(A, "map:dawn_field")).toEqual([]);
    expect(pet().bond).toBe(0);
  });
});

describe("the boss-first notice (P35)", () => {
  it("lists only boss firsts since the fight was taken up, grouped by boss", async () => {
    const add = (id: string, key: string, at: string, kind = "boss") =>
      db.prepare(`INSERT INTO companion_firsts (instance_id, owner_id, kind, key, token, created_at) VALUES (?, ?, ?, ?, 't', ?)`).run(id, A, kind, key, at);
    add(PET, "boss:old", "2026-10-13T00:00:00.000Z");
    add(PET, "boss:crystal_crab_lord", "2026-10-14T00:00:05.000Z");
    add("mon:other", "boss:crystal_crab_lord", "2026-10-14T00:00:05.000Z");
    add(PET, "map:dawn_cave", "2026-10-14T00:00:05.000Z", "map");
    expect(await store.bossFirstsSince(A, "2026-10-14T00:00:00.000Z")).toEqual([{ bossId: "boss:crystal_crab_lord", companionIds: [PET, "mon:other"].sort() }]);
    expect(await store.bossFirstsSince("acct:b", "2026-10-01T00:00:00.000Z")).toEqual([]);
  });
});
