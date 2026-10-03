/**
 * Characters, teams, rest and HP carry-over on the D1 migrations (node:sqlite stand-in).
 */
import { beforeEach, describe, expect, it } from "vitest";
import { PRODUCTION_RULES, exampleContentMaps } from "@pmrpg/shared";
import { CharacterStore } from "../src/character-store";
import { Economy } from "../src/economy";
import { SqliteD1, freshDb, type Db } from "./sqlite-d1";

const A = "acct:a";
const B = "acct:b";
const content = exampleContentMaps();
const species = content.species;
let db: Db;
let store: CharacterStore;
let eco: Economy;

const req = (over: Record<string, unknown> = {}) => ({
  operationId: "op_create_a",
  name: "นัท",
  classId: "class:guardian",
  raceId: "race:stonekin",
  element: "EARTH",
  ...over,
});

function pet(id: string, owner: string, speciesId: string, element = "WATER") {
  db.prepare(
    `INSERT INTO monster_instances (id, species_id, owner_id, current_level, element, primary_stats_json, origin_json, created_operation_id)
     VALUES (?, ?, ?, 1, ?, '{"STR":10,"VIT":10,"INT":10,"DEX":10,"AGI":10,"SPI":10}', '{"kind":"capture","at":"2026-10-03T00:00:00Z"}', ?)`,
  ).run(id, speciesId, owner, element, `seed:${id}`);
}

beforeEach(async () => {
  db = freshDb();
  const d1 = new SqliteD1(db);
  store = new CharacterStore(d1, PRODUCTION_RULES, content, () => "2026-10-03T00:00:00Z");
  eco = new Economy(d1, PRODUCTION_RULES, () => "2026-10-03T00:00:00Z");
  await eco.devGrant("seed:a", A, { "item:small_potion": 5 });
  await eco.devGrant("seed:b", B, {});
  pet("mon:crab", A, "species:armor_crab");
  pet("mon:snail", A, "species:lantern_snail", "LIGHT");
  pet("mon:fox", A, "species:ember_fox", "FIRE");
  pet("mon:crab2", A, "species:armor_crab", "EARTH");
  pet("mon:b_crab", B, "species:armor_crab");
});

describe("create", () => {
  it("creates a Lv1 character with every primary stat at 10 (P03) and full HP/MP", async () => {
    const r = await store.create(A, req());
    expect(r.status).toBe("created");
    if (r.status !== "created") return;
    expect(r.character).toMatchObject({ name: "นัท", level: 1, xp: 0, hp: null, mp: null, version: 1, team: [] });
    expect(Object.values(r.character.primaryStats)).toEqual([10, 10, 10, 10, 10, 10]);
  });

  it("is idempotent on operationId, and an account gets one character until O10", async () => {
    const first = await store.create(A, req());
    const again = await store.create(A, req());
    expect(again).toEqual(first);
    expect(await store.create(A, req({ operationId: "op_create_a2", name: "อีกตัว" }))).toMatchObject({ status: "rejected", reason: "CHARACTER_EXISTS" });
    expect(db.prepare("SELECT COUNT(*) AS n FROM characters").get()).toEqual({ n: 1 });
  });

  it("concurrent creates for one account leave one character", async () => {
    const rs = await Promise.all(["op_c1_xxxx", "op_c2_xxxx", "op_c3_xxxx"].map((operationId) => store.create(A, req({ operationId }))));
    expect(rs.filter((r) => r.status === "created")).toHaveLength(1);
    expect(db.prepare("SELECT COUNT(*) AS n FROM characters").get()).toEqual({ n: 1 });
  });

  it("refuses bad input: name, class, race, NEUTRAL element, extra fields", async () => {
    for (const bad of [
      req({ name: "x" }),
      req({ name: "a".repeat(17) }),
      req({ name: "bad<name>" }),
      req({ name: "two  spaces" }),
      req({ classId: "class:paladin" }),
      req({ raceId: "race:dragon" }),
      req({ element: "NEUTRAL" }),
      req({ level: 99 }),
      req({ operationId: "x" }),
    ]) {
      expect((await store.create(A, bad)).status, JSON.stringify(bad)).toBe("rejected");
    }
    expect(await store.get(A)).toBeNull();
  });

  it("trims the name and allows duplicate names across accounts", async () => {
    await store.create(A, req({ name: "  นัท  " }));
    const b = await store.create(B, req({ operationId: "op_create_b" }));
    expect((await store.get(A))!.name).toBe("นัท");
    expect(b.status).toBe("created");
  });
});

describe("setTeam", () => {
  beforeEach(async () => {
    await store.create(A, req());
  });

  it("saves up to 5 companions, tanks in front and the rest behind, and bumps the version", async () => {
    const r = await store.setTeam(A, { expectedVersion: 1, companionIds: ["mon:snail", "mon:crab", "mon:fox"] });
    expect(r.status).toBe("saved");
    if (r.status !== "saved") return;
    expect(r.character.version).toBe(2);
    expect(r.character.team).toEqual([
      { instanceId: "mon:snail", speciesId: "species:lantern_snail", row: "back", slot: 1 },
      { instanceId: "mon:crab", speciesId: "species:armor_crab", row: "front", slot: 0 },
      { instanceId: "mon:fox", speciesId: "species:ember_fox", row: "front", slot: 2 },
    ]);
  });

  it("refuses a duplicate species even with another element (C04)", async () => {
    expect(await store.setTeam(A, { expectedVersion: 1, companionIds: ["mon:crab", "mon:crab2"] })).toMatchObject({ status: "rejected", reason: "DUPLICATE_SPECIES" });
  });

  it("refuses more than 5, someone else's companion, and the same id twice", async () => {
    for (let i = 0; i < 3; i++) pet(`mon:extra${i}`, A, "species:ember_fox");
    const six = ["mon:crab", "mon:snail", "mon:fox", "mon:extra0", "mon:extra1", "mon:extra2"];
    expect(await store.setTeam(A, { expectedVersion: 1, companionIds: six })).toMatchObject({ reason: "TEAM_TOO_LARGE" });
    expect(await store.setTeam(A, { expectedVersion: 1, companionIds: ["mon:b_crab"] })).toMatchObject({ reason: "NOT_OWNER" });
    expect(await store.setTeam(A, { expectedVersion: 1, companionIds: ["mon:crab", "mon:crab"] })).toMatchObject({ reason: "INVALID_REQUEST" });
    expect((await store.get(A))!.team).toEqual([]);
  });

  it("refuses a stale version, and of two writes from the same version only one lands", async () => {
    const [x, y] = await Promise.all([
      store.setTeam(A, { expectedVersion: 1, companionIds: ["mon:crab"] }),
      store.setTeam(A, { expectedVersion: 1, companionIds: ["mon:snail"] }),
    ]);
    expect([x.status, y.status].sort()).toEqual(["rejected", "saved"]);
    expect((x.status === "rejected" ? x : y)).toMatchObject({ reason: "STALE_VERSION" });
    const now = (await store.get(A))!;
    expect(now.version).toBe(2);
    expect(now.team).toHaveLength(1);
  });

  it("cannot change the team while a fight holds the account (P15)", async () => {
    await store.setTeam(A, { expectedVersion: 1, companionIds: ["mon:crab"] });
    await eco.reserve({ reservationId: "res:battle:x", accountId: A, battleId: "battle:x", bag: {}, companionIds: ["mon:crab"] });
    expect(await store.setTeam(A, { expectedVersion: 2, companionIds: ["mon:snail"] })).toMatchObject({ reason: "IN_BATTLE" });
    expect((await store.get(A))!.team.map((t) => t.instanceId)).toEqual(["mon:crab"]);
  });

  it("an empty team is allowed", async () => {
    await store.setTeam(A, { expectedVersion: 1, companionIds: ["mon:crab"] });
    expect(await store.setTeam(A, { expectedVersion: 2, companionIds: [] })).toMatchObject({ status: "saved", character: { team: [] } });
  });
});

describe("HP carry-over and rest", () => {
  const battle = "battle:hp";
  const rid = `res:${battle}`;

  beforeEach(async () => {
    await store.create(A, req());
    await store.setTeam(A, { expectedVersion: 1, companionIds: ["mon:crab", "mon:snail"] });
  });

  async function fight(characterId: string | undefined) {
    await eco.reserve({ reservationId: rid, accountId: A, battleId: battle, bag: { "item:small_potion": 1 }, companionIds: ["mon:crab", "mon:snail"], ...(characterId ? { characterId } : {}) });
    await eco.activate(rid);
    return eco.settle({
      reservationId: rid,
      battleId: battle,
      accountId: A,
      outcome: "victory",
      unused: {},
      allies: [
        { unitId: "player", instanceId: null, hp: 123, mp: 7, ko: false },
        { unitId: "ally:mon:crab", instanceId: "mon:crab", hp: 0, mp: 3, ko: true },
        { unitId: "ally:mon:snail", instanceId: "mon:snail", hp: 88.9, mp: 20, ko: false },
      ],
      entitlementIds: [],
    });
  }

  it("settlement writes the character's and companions' HP/MP back", async () => {
    const c = (await store.get(A))!;
    expect((await fight(c.id)).status).toBe("settled");
    expect(await store.get(A)).toMatchObject({ hp: 123, mp: 7 });
    const pets = new Map((await store.companions(A)).map((p) => [p.id, p]));
    expect(pets.get("mon:crab")).toMatchObject({ hp: 0, mp: 3, lockState: "free" });
    expect(pets.get("mon:snail")).toMatchObject({ hp: 88, mp: 20 });
    expect(pets.get("mon:fox")).toMatchObject({ hp: null, mp: null });
  });

  it("a fight without the character (dev battle) does not touch its HP", async () => {
    await fight(undefined);
    expect(await store.get(A)).toMatchObject({ hp: null, mp: null });
  });

  it("rest restores everyone, but not during a fight", async () => {
    const c = (await store.get(A))!;
    await eco.reserve({ reservationId: rid, accountId: A, battleId: battle, bag: {}, companionIds: ["mon:crab"], characterId: c.id });
    expect(await store.rest(A)).toBe(false);
    db.prepare("UPDATE battle_reservations SET status = 'released'").run();
    db.prepare("UPDATE monster_instances SET lock_state = 'free', lock_ref = NULL, hp = 0").run();
    db.prepare("UPDATE characters SET hp = 0, mp = 0").run();
    expect(await store.rest(A)).toBe(true);
    expect(await store.get(A)).toMatchObject({ hp: null, mp: null });
    expect((await store.companions(A)).every((p) => p.hp === null)).toBe(true);
  });

  it("loadout returns the character with its team instances and stored HP", async () => {
    db.prepare("UPDATE monster_instances SET hp = 5 WHERE id = 'mon:crab'").run();
    const l = (await store.loadout(A))!;
    expect(l.character.team.map((t) => t.instanceId)).toEqual(["mon:crab", "mon:snail"]);
    expect(l.instances.get("mon:crab")).toMatchObject({ hp: 5, speciesId: "species:armor_crab" });
    expect(await store.loadout(B)).toBeNull();
  });
});
