/**
 * EXP through reward receipts, level sync and stat allocation on the D1 migrations (node:sqlite).
 */
import { beforeEach, describe, expect, it } from "vitest";
import { PRODUCTION_RULES, exampleContentMaps, expCap, expForLevel, type Entitlement } from "@pmrpg/shared";
import { CharacterStore } from "../src/character-store";
import { Economy } from "../src/economy";
import { SqliteD1, freshDb, type Db } from "./sqlite-d1";

const A = "acct:a";
const content = exampleContentMaps();
let db: Db;
let store: CharacterStore;
let eco: Economy;
let charId: string;

const BATTLE = "battle:x";
const kill = (enemy: string, exp: number): Entitlement => ({
  entitlementId: `${BATTLE}:${enemy}:defeated`,
  kind: "kill",
  enemyUnitId: enemy,
  speciesId: "species:supply_mole",
  originMode: "manual",
  items: [],
  exp,
});
const xp = (table: string, id: string) => (db.prepare(`SELECT xp FROM ${table} WHERE id = ?`).get(id) as { xp: number }).xp;

function pet(id: string, speciesId: string) {
  db.prepare(
    `INSERT INTO monster_instances (id, species_id, owner_id, current_level, element, primary_stats_json, origin_json, created_operation_id)
     VALUES (?, ?, ?, 1, 'EARTH', '{"STR":10,"VIT":10,"INT":10,"DEX":10,"AGI":10,"SPI":10}', '{"kind":"capture","at":"x"}', ?)`,
  ).run(id, speciesId, A, `seed:${id}`);
}

beforeEach(async () => {
  db = freshDb();
  const d1 = new SqliteD1(db);
  const now = () => "2026-10-03T00:00:00Z";
  store = new CharacterStore(d1, PRODUCTION_RULES, content, now);
  eco = new Economy(d1, PRODUCTION_RULES, now);
  await eco.devGrant("seed:a", A, {});
  const made = await store.create(A, { operationId: "op_create_a", name: "นัท", classId: "class:striker", raceId: "race:human", element: "FIRE" });
  if (made.status !== "created") throw new Error("create failed");
  charId = made.character.id;
  pet("mon:mole", "species:supply_mole");
  pet("mon:bird", "species:bell_bird");
  pet("mon:home", "species:armor_crab"); // stays home
  await eco.reserve({ reservationId: `res:${BATTLE}`, accountId: A, battleId: BATTLE, bag: {}, companionIds: ["mon:mole", "mon:bird"], characterId: charId });
  await eco.activate(`res:${BATTLE}`);
});

describe("EXP from rewards (chapter 04 §4)", () => {
  it("the character and every companion in the fight get the full EXP once, KO'd or not; others get none", async () => {
    const e = kill("e1", 20);
    await eco.grant(e, A);
    await eco.grant(e, A);
    await Promise.all([eco.grant(e, A), eco.grant(e, A)]);
    expect(xp("characters", charId)).toBe(20);
    expect(xp("monster_instances", "mon:mole")).toBe(20);
    expect(xp("monster_instances", "mon:bird")).toBe(20);
    expect(xp("monster_instances", "mon:home")).toBe(0);
  });

  it("a captured companion is not in the fight's team and gets no EXP from it", async () => {
    const cap: Entitlement = { entitlementId: `${BATTLE}:e2:captured`, kind: "capture", enemyUnitId: "e2", speciesId: "species:bell_bird", element: "WIND", level: 1, exp: 30 };
    await eco.grant(cap, A);
    expect(xp("characters", charId)).toBe(30);
    expect(xp("monster_instances", `mon:${cap.entitlementId}`)).toBe(0);
  });

  it("levels follow cumulative EXP on the next read; points become spendable", async () => {
    await eco.grant(kill("e1", expForLevel(PRODUCTION_RULES, "player", 3)), A);
    const c = (await store.get(A))!;
    expect(c.level).toBe(3);
    expect((await store.companions(A)).find((p) => p.id === "mon:mole")?.currentLevel).toBe(3);
    expect((await store.companions(A)).find((p) => p.id === "mon:home")?.currentLevel).toBe(1);
    // Never lowered by a sync.
    db.prepare("UPDATE characters SET level = 9 WHERE id = ?").run(charId);
    expect((await store.get(A))!.level).toBe(9);
  });
});

describe("the level cap", () => {
  it("EXP stops at the Lv200 total; nothing is banked toward Lv201 (Nut's table §7)", async () => {
    const cap = expCap(PRODUCTION_RULES, "player");
    db.prepare("UPDATE characters SET xp = ? WHERE id = ?").run(cap - 10, charId);
    await eco.grant(kill("e1", 500), A);
    expect(xp("characters", charId)).toBe(cap);
    expect((await store.get(A))!.level).toBe(200);
    // The companion stops at its own curve's cap.
    db.prepare("UPDATE monster_instances SET xp = ? WHERE id = 'mon:mole'").run(expCap(PRODUCTION_RULES, "companion") - 1);
    await eco.grant(kill("e2", 500), A);
    expect(xp("monster_instances", "mon:mole")).toBe(expCap(PRODUCTION_RULES, "companion"));
  });
});

describe("stat allocation (P03)", () => {
  beforeEach(async () => {
    await eco.settle({ reservationId: `res:${BATTLE}`, battleId: BATTLE, accountId: A, outcome: "victory", unused: {}, allies: [], entitlementIds: [] });
  });

  it("spends level points with a version check; refuses over budget, lowering and stale writes", async () => {
    expect(await store.allocate(A, { expectedVersion: 1, stats: { STR: 11, VIT: 10, INT: 10, DEX: 10, AGI: 10, SPI: 10 } })).toMatchObject({ reason: "OVER_BUDGET" });
    db.prepare("UPDATE characters SET xp = ? WHERE id = ?").run(expForLevel(PRODUCTION_RULES, "player", 2), charId);
    const r = await store.allocate(A, { expectedVersion: 1, stats: { STR: 12, VIT: 11, INT: 10, DEX: 10, AGI: 10, SPI: 10 } });
    expect(r).toMatchObject({ status: "saved", character: { level: 2, version: 2, primaryStats: { STR: 12, VIT: 11 } } });
    expect(await store.allocate(A, { expectedVersion: 1, stats: { STR: 12, VIT: 11, INT: 10, DEX: 10, AGI: 10, SPI: 10 } })).toMatchObject({ reason: "STALE_VERSION" });
    expect(await store.allocate(A, { expectedVersion: 2, stats: { STR: 10, VIT: 11, INT: 10, DEX: 10, AGI: 10, SPI: 12 } })).toMatchObject({ reason: "STAT_DECREASE" });
    expect(await store.allocate(A, { expectedVersion: 2, stats: { STR: 12 } })).toMatchObject({ reason: "INVALID_REQUEST" });
  });

  it("two allocations from the same version: one lands", async () => {
    db.prepare("UPDATE characters SET xp = ? WHERE id = ?").run(expForLevel(PRODUCTION_RULES, "player", 2), charId);
    const [x, y] = await Promise.all([
      store.allocate(A, { expectedVersion: 1, stats: { STR: 13, VIT: 10, INT: 10, DEX: 10, AGI: 10, SPI: 10 } }),
      store.allocate(A, { expectedVersion: 1, stats: { STR: 10, VIT: 13, INT: 10, DEX: 10, AGI: 10, SPI: 10 } }),
    ]);
    expect([x.status, y.status].sort()).toEqual(["rejected", "saved"]);
    const s = (await store.get(A))!.primaryStats;
    expect(s.STR + s.VIT).toBe(23);
  });

  it("not during a fight", async () => {
    db.prepare("UPDATE characters SET xp = ? WHERE id = ?").run(expForLevel(PRODUCTION_RULES, "player", 2), charId);
    await eco.reserve({ reservationId: "res:battle:y", accountId: A, battleId: "battle:y", bag: {}, companionIds: [] });
    expect(await store.allocate(A, { expectedVersion: 1, stats: { STR: 13, VIT: 10, INT: 10, DEX: 10, AGI: 10, SPI: 10 } })).toMatchObject({ reason: "IN_BATTLE" });
  });
});
