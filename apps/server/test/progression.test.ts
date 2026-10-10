/**
 * EXP through reward receipts, level sync and stat allocation on the D1 migrations (node:sqlite).
 */
import { beforeEach, describe, expect, it } from "vitest";
import { COMPANION_GROWTH_VERSION, PRODUCTION_RULES, companionPrimaryStats, exampleContentMaps, expCap, expForLevel, jobExpCap, jobExpForLevel, playerSetup, type Entitlement } from "@pmrpg/shared";
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
// The kernel puts a per-companion award on each entitlement; "mon:home" is listed too, to show the
// ledger only pays companions that are in the battle's reservation.
const kill = (enemy: string, exp: number, pets: number = exp): Extract<Entitlement, { kind: "kill" }> => ({
  entitlementId: `${BATTLE}:${enemy}:defeated`,
  kind: "kill",
  enemyUnitId: enemy,
  speciesId: "species:supply_mole",
  originMode: "manual",
  items: [],
  exp,
  companionExp: { "mon:mole": pets, "mon:bird": pets, "mon:home": pets },
});
const xp = (table: string, id: string) => (db.prepare(`SELECT xp FROM ${table} WHERE id = ?`).get(id) as { xp: number }).xp;

function pet(id: string, speciesId: string) {
  db.prepare(
    `INSERT INTO monster_instances (id, species_id, owner_id, current_level, element, primary_stats_json, origin_json, created_operation_id, growth_seed, growth_history_version)
     VALUES (?, ?, ?, 1, 'EARTH', '{"STR":10,"VIT":10,"INT":10,"DEX":10,"AGI":10,"SPI":10}', '{"kind":"capture","at":"x"}', ?, ?, 2)`,
  ).run(id, speciesId, A, `seed:${id}`, id);
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

  it("each companion gets its own award from the entitlement", async () => {
    await eco.grant({ ...kill("e1", 100), companionExp: { "mon:mole": 7, "mon:bird": 100 } }, A);
    expect(xp("characters", charId)).toBe(100);
    expect(xp("monster_instances", "mon:mole")).toBe(7);
    expect(xp("monster_instances", "mon:bird")).toBe(100);
  });

  it("a captured companion is not in the fight's team and gets no EXP from it", async () => {
    const cap: Entitlement = { entitlementId: `${BATTLE}:e2:captured`, kind: "capture", enemyUnitId: "e2", speciesId: "species:bell_bird", element: "WIND", level: 1, exp: 30 };
    await eco.grant(cap, A);
    expect(xp("characters", charId)).toBe(30);
    expect(xp("monster_instances", `mon:${cap.entitlementId}`)).toBe(0);
  });

  it("levels follow cumulative EXP on the next read; points become spendable", async () => {
    await eco.grant(kill("e1", expForLevel(PRODUCTION_RULES, "player", 3), expForLevel(PRODUCTION_RULES, "companion", 3)), A);
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

describe("job EXP and skill trees (P29, Nut 2026-10-09)", () => {
  const job = () => db.prepare(`SELECT job1_xp, job2_xp FROM characters WHERE id = ?`).get(charId) as { job1_xp: number; job2_xp: number };

  it("every EXP award also gives job EXP to the tier the character is in, once, up to the tier's cap", async () => {
    const e = kill("e1", 20);
    await Promise.all([eco.grant(e, A), eco.grant(e, A)]);
    await eco.grant(e, A);
    expect(job()).toEqual({ job1_xp: 20, job2_xp: 0 });
    db.prepare(`UPDATE characters SET job1_xp = ? WHERE id = ?`).run(jobExpCap(PRODUCTION_RULES, 1) - 5, charId);
    await eco.grant(kill("e2", 50), A);
    expect(job().job1_xp).toBe(jobExpCap(PRODUCTION_RULES, 1));
    // After the Class2 claim the Class2 track earns it and Class1 stays.
    db.prepare(`UPDATE characters SET class2_id = 'class2:breaker' WHERE id = ?`).run(charId);
    await eco.grant(kill("e3", 30), A);
    expect(job()).toEqual({ job1_xp: jobExpCap(PRODUCTION_RULES, 1), job2_xp: 30 });
    expect((await store.get(A))!.jobExp).toEqual([jobExpCap(PRODUCTION_RULES, 1), 30]);
    // After the Class3 claim the Class3 track earns it and Class1/Class2 stay.
    db.prepare(`UPDATE characters SET class3_id = 'class3:ruin_champion' WHERE id = ?`).run(charId);
    await eco.grant(kill("e4", 40), A);
    expect(job()).toEqual({ job1_xp: jobExpCap(PRODUCTION_RULES, 1), job2_xp: 30 });
    expect((await store.get(A))!.jobExp).toEqual([jobExpCap(PRODUCTION_RULES, 1), 30, 40]);
  });

  describe("learning", () => {
    beforeEach(async () => {
      await eco.settle({ reservationId: `res:${BATTLE}`, battleId: BATTLE, accountId: A, outcome: "victory", unused: {}, allies: [], entitlementIds: [] });
    });

    it("spends job points one level at a time, in tree order, with a version check", async () => {
      // Job 1 gives 1 point.
      expect(await store.learnSkill(A, { expectedVersion: 1, skillId: "skill:striker_cleave" })).toMatchObject({ reason: "NEEDS_SKILL" });
      expect(await store.learnSkill(A, { expectedVersion: 1, skillId: "skill:guardian_cover" })).toMatchObject({ reason: "NOT_IN_TREE" });
      const r = await store.learnSkill(A, { expectedVersion: 1, skillId: "skill:striker_heavy_slash" });
      expect(r).toMatchObject({ status: "saved", character: { version: 2, skills: { "skill:striker_heavy_slash": 1 } } });
      expect(await store.learnSkill(A, { expectedVersion: 1, skillId: "skill:striker_heavy_slash" })).toMatchObject({ reason: "STALE_VERSION" });
      expect(await store.learnSkill(A, { expectedVersion: 2, skillId: "skill:striker_heavy_slash" })).toMatchObject({ reason: "NO_POINTS" });
      db.prepare(`UPDATE characters SET job1_xp = ? WHERE id = ?`).run(jobExpForLevel(PRODUCTION_RULES, 1, 4), charId);
      for (let v = 2; v <= 4; v++) expect(await store.learnSkill(A, { expectedVersion: v, skillId: "skill:striker_heavy_slash" })).toMatchObject({ status: "saved" });
      expect(await store.learnSkill(A, { expectedVersion: 5, skillId: "skill:striker_cleave" })).toMatchObject({ reason: "NO_POINTS" });
      const c = (await store.get(A))!;
      expect(c.skills).toEqual({ "skill:striker_heavy_slash": 4 });
      // The fight gets the learned skill at its level, and the race passive.
      expect(playerSetup(A, c)).toMatchObject({ skillIds: ["skill:striker_heavy_slash"], skillLevels: { "skill:striker_heavy_slash": 4 }, passiveIds: ["skill:race_human_grit"] });
    });

    it("two learns from the same version: one lands, one point spent", async () => {
      db.prepare(`UPDATE characters SET job1_xp = ? WHERE id = ?`).run(jobExpForLevel(PRODUCTION_RULES, 1, 5), charId);
      const [x, y] = await Promise.all([
        store.learnSkill(A, { expectedVersion: 1, skillId: "skill:striker_heavy_slash" }),
        store.learnSkill(A, { expectedVersion: 1, skillId: "skill:striker_blade_wave" }),
      ]);
      expect([x.status, y.status].sort()).toEqual(["rejected", "saved"]);
      const c = (await store.get(A))!;
      expect(Object.values(c.skills ?? {})).toEqual([1]);
      expect(c.version).toBe(2);
    });

    it("not during a fight", async () => {
      await eco.reserve({ reservationId: "res:battle:y", accountId: A, battleId: "battle:y", bag: {}, companionIds: [] });
      expect(await store.learnSkill(A, { expectedVersion: 1, skillId: "skill:striker_heavy_slash" })).toMatchObject({ reason: "IN_BATTLE" });
    });
  });
});

describe("companion growth (P05)", () => {
  const row = (id: string) =>
    db.prepare("SELECT growth_seed, growth_history_version, primary_stats_json, current_level FROM monster_instances WHERE id = ?").get(id) as {
      growth_seed: string;
      growth_history_version: number;
      primary_stats_json: string;
      current_level: number;
    };

  it("a capture gets a server-picked growth seed once; a replayed grant keeps the first", async () => {
    const cap: Entitlement = { entitlementId: `${BATTLE}:e2:captured`, kind: "capture", enemyUnitId: "e2", speciesId: "species:bell_bird", element: "WIND", level: 1 };
    await eco.grant(cap, A);
    const first = row(`mon:${cap.entitlementId}`);
    await eco.grant(cap, A);
    await Promise.all([eco.grant(cap, A), eco.grant(cap, A)]);
    expect(row(`mon:${cap.entitlementId}`)).toEqual(first);
    expect(first.growth_history_version).toBe(COMPANION_GROWTH_VERSION);
    expect(first.growth_seed).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("levelling up stores the stats from the growth path (here the id is the seed, as migration 0008 backfills)", async () => {
    db.prepare("UPDATE monster_instances SET xp = ? WHERE id = ?").run(expForLevel(PRODUCTION_RULES, "companion", 12), "mon:mole");
    await store.syncLevels(A);
    const r = row("mon:mole");
    expect(r.current_level).toBe(12);
    expect(JSON.parse(r.primary_stats_json)).toEqual(companionPrimaryStats(PRODUCTION_RULES, "support", "mon:mole", 12, 0));
  });
});

describe("Bond and skill mastery when a fight ends (chapter 04 §5–§6)", () => {
  const victory = (bond: number, mastery: number): Entitlement => ({
    entitlementId: `${BATTLE}:all:result`,
    kind: "fight_result",
    companions: { "mon:mole": { bond, mastery }, "mon:bird": { bond, mastery }, "mon:home": { bond, mastery } },
  });
  const row = (id: string) => db.prepare(`SELECT bond, skill_mastery FROM monster_instances WHERE id = ?`).get(id);

  it("adds once for companions in the fight only, even when granted again or at the same time", async () => {
    await Promise.all([eco.grant(victory(2, 3), A), eco.grant(victory(2, 3), A)]);
    await eco.grant(victory(2, 3), A);
    expect(row("mon:mole")).toEqual({ bond: 2, skill_mastery: 3 });
    expect(row("mon:bird")).toEqual({ bond: 2, skill_mastery: 3 });
    expect(row("mon:home")).toEqual({ bond: 0, skill_mastery: 0 });
    expect(await eco.grant(victory(9, 9), A)).toMatchObject({ status: "rejected", reason: "PAYLOAD_MISMATCH" });
  });

  it("a fall takes Bond down, never below 0 (Nut 2026-10-03)", async () => {
    db.prepare(`UPDATE monster_instances SET bond = 1 WHERE id = 'mon:mole'`).run();
    db.prepare(`UPDATE monster_instances SET bond = 10 WHERE id = 'mon:bird'`).run();
    await eco.grant(victory(-2, 0), A);
    expect(row("mon:mole")).toEqual({ bond: 0, skill_mastery: 0 });
    expect(row("mon:bird")).toEqual({ bond: 8, skill_mastery: 0 });
  });

  it("stops at Bond 1000 and the mastery cap", async () => {
    db.prepare(`UPDATE monster_instances SET bond = 999, skill_mastery = ? WHERE id = 'mon:mole'`).run(PRODUCTION_RULES.provisional.skillMasteryCap.value - 1);
    await eco.grant(victory(2, 3), A);
    expect(row("mon:mole")).toEqual({ bond: 1000, skill_mastery: PRODUCTION_RULES.provisional.skillMasteryCap.value });
  });
});
