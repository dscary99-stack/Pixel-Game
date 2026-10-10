/** Canonical positions on the D1 migrations (node:sqlite stand-in). */
import { beforeEach, describe, expect, it } from "vitest";
import { EXAMPLE_START_MAP, exampleMapRegistry } from "@pmrpg/shared";
import { WorldStore } from "../src/world-store";
import { SqliteD1, freshDb, type Db } from "./sqlite-d1";

const TOWN = EXAMPLE_START_MAP;
const FIELD = "map:dawn_field";
const maps = exampleMapRegistry();
let db: Db;
let store: WorldStore;

beforeEach(() => {
  db = freshDb();
  db.prepare("INSERT INTO accounts (id, created_at) VALUES ('acct:a', 't')").run();
  store = new WorldStore(new SqliteD1(db), maps, TOWN, () => "2026-10-03T00:00:00Z");
});

describe("WorldStore", () => {
  it("places a new character at the start map spawn, and nowhere else", async () => {
    expect(await store.claim("acct:a", FIELD, 1)).toEqual({ status: "wrong_map", mapId: TOWN, channel: 1 });
    expect(await store.claim("acct:a", TOWN, 1)).toEqual({ status: "joined", pos: maps.get(TOWN)!.spawn, generation: 1, previous: null });
  });

  it("refuses accounts that do not exist", async () => {
    expect(await store.claim("acct:ghost", TOWN, 1)).toEqual({ status: "no_account" });
  });

  it("will not let a client join a map its character is not on (no teleport by reconnecting)", async () => {
    await store.claim("acct:a", TOWN, 1);
    expect(await store.claim("acct:a", FIELD, 1)).toEqual({ status: "wrong_map", mapId: TOWN, channel: 1 });
  });

  it("restores the saved position on reconnect and bumps the generation", async () => {
    const first = await store.claim("acct:a", TOWN, 1);
    if (first.status !== "joined") throw new Error();
    expect(await store.save("acct:a", first.generation, TOWN, { x: 5, y: 7 })).toBe(true);
    expect(await store.claim("acct:a", TOWN, 2)).toEqual({ status: "joined", pos: { x: 5, y: 7 }, generation: 2, previous: { mapId: TOWN, channel: 1 } });
    expect(await store.where("acct:a")).toEqual({ mapId: TOWN, channel: 2 });
  });

  it("ignores saves and portal moves from an older connection", async () => {
    const old = await store.claim("acct:a", TOWN, 1);
    const now = await store.claim("acct:a", TOWN, 2);
    if (old.status !== "joined" || now.status !== "joined") throw new Error();
    expect(await store.save("acct:a", old.generation, TOWN, { x: 2, y: 1 })).toBe(false);
    expect(await store.moveTo("acct:a", old.generation, TOWN, { mapId: FIELD, x: 1, y: 7 }, 1)).toBe(false);
    expect(await store.where("acct:a")).toEqual({ mapId: TOWN, channel: 2 });
    const back = await store.claim("acct:a", TOWN, 2);
    expect(back).toMatchObject({ pos: maps.get(TOWN)!.spawn });
  });

  it("moves the character through a portal; only the destination map accepts it afterwards", async () => {
    const j = await store.claim("acct:a", TOWN, 1);
    if (j.status !== "joined") throw new Error();
    expect(await store.moveTo("acct:a", j.generation, TOWN, { mapId: FIELD, x: 1, y: 7 }, 1)).toBe(true);
    expect(await store.claim("acct:a", TOWN, 1)).toEqual({ status: "wrong_map", mapId: FIELD, channel: 1 });
    expect(await store.claim("acct:a", FIELD, 1)).toMatchObject({ status: "joined", pos: { x: 1, y: 7 } });
  });

  it("falls back to spawn if the saved tile is no longer walkable", async () => {
    await store.claim("acct:a", TOWN, 1);
    db.prepare("UPDATE player_positions SET x = 0, y = 0 WHERE account_id = 'acct:a'").run();
    expect(await store.claim("acct:a", TOWN, 1)).toMatchObject({ pos: maps.get(TOWN)!.spawn });
  });

  it("two simultaneous joins on different channels end with exactly one current generation", async () => {
    await store.claim("acct:a", TOWN, 1);
    const [x, y] = await Promise.all([store.claim("acct:a", TOWN, 1), store.claim("acct:a", TOWN, 2)]);
    if (x.status !== "joined" || y.status !== "joined") throw new Error(`${x.status} ${y.status}`);
    expect(x.generation).not.toBe(y.generation);
    const winner = x.generation > y.generation ? x : y;
    const loser = winner === x ? y : x;
    expect(await store.save("acct:a", loser.generation, TOWN, { x: 3, y: 7 })).toBe(false);
    expect(await store.save("acct:a", winner.generation, TOWN, { x: 3, y: 7 })).toBe(true);
  });
});
