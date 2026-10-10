/**
 * Reset scrolls (reset.ts, Nut 2026-10-09) on the D1 migrations: a stat scroll returns every stat
 * point and a skill scroll every job point; one scroll is spent per use, a retry answers the same
 * without a second scroll, two uses racing on one scroll end with one reset, and fights refuse it.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { DEV_FIXTURE_RULES as R, exampleContentMaps } from "@pmrpg/shared";
import { CharacterStore } from "../src/character-store";
import { Economy } from "../src/economy";
import { SqliteD1, freshDb, type Db } from "./sqlite-d1";

const A = "acct:a";
const STATS = "item:stat_reset_scroll";
const SKILLS = "item:skill_reset_scroll";
const start = R.provisional.primaryStatStart.value;
let db: Db;
let eco: Economy;
let chars: CharacterStore;

beforeEach(async () => {
  db = freshDb();
  const d1 = new SqliteD1(db);
  const now = () => "2026-10-09T18:00:00.000Z";
  eco = new Economy(d1, R, now);
  chars = new CharacterStore(d1, R, exampleContentMaps(), now);
  await chars.create(A, { operationId: "op_create_a", name: "นัท", classId: "class:guardian", raceId: "race:stonekin", element: "EARTH" });
  await chars.devRaiseLevel(A, 10, 10);
});

async function spendSome() {
  let c = (await chars.get(A))!;
  const r1 = await chars.allocate(A, { expectedVersion: c.version, stats: { ...c.primaryStats, STR: c.primaryStats.STR + 5 } });
  expect(r1.status).toBe("saved");
  c = (await chars.get(A))!;
  const skillId = "skill:guardian_shield_bash";
  const r2 = await chars.learnSkill(A, { expectedVersion: c.version, skillId });
  expect(r2.status).toBe("saved");
}

describe("reset scrolls", () => {
  it("a stat scroll puts every stat back to the start and spends one scroll; a retry spends none", async () => {
    await eco.devGrant("g1", A, { [STATS]: 2 });
    await spendSome();
    const r = await chars.useReset(A, { operationId: "op_reset_1_xxxxxxxx", itemId: STATS });
    expect(r.status).toBe("saved");
    if (r.status !== "saved") return;
    expect(Object.values(r.character.primaryStats).every((v) => v === start)).toBe(true);
    expect(Object.keys(r.character.skills ?? {}).length).toBe(1); // skills untouched
    expect((await eco.balances(A))[STATS]).toBe(1);
    const again = await chars.useReset(A, { operationId: "op_reset_1_xxxxxxxx", itemId: STATS });
    expect(again.status).toBe("saved");
    expect((await eco.balances(A))[STATS]).toBe(1);
    expect((await chars.useReset(A, { operationId: "op_reset_1_xxxxxxxx", itemId: SKILLS })).status).toBe("rejected");
  });

  it("a skill scroll forgets every tree skill and leaves stats", async () => {
    await eco.devGrant("g1", A, { [SKILLS]: 1 });
    await spendSome();
    const r = await chars.useReset(A, { operationId: "op_reset_s_xxxxxxxx", itemId: SKILLS });
    expect(r.status).toBe("saved");
    if (r.status !== "saved") return;
    expect(r.character.skills ?? {}).toEqual({});
    expect(r.character.primaryStats.STR).toBe(start + 5);
    expect((await eco.balances(A))[SKILLS] ?? 0).toBe(0);
  });

  it("refuses without a scroll, with a non-reset item, and during a fight", async () => {
    expect(await chars.useReset(A, { operationId: "op_none_xxxxxxxx", itemId: STATS })).toMatchObject({ status: "rejected", reason: "INSUFFICIENT_ITEMS" });
    expect(await chars.useReset(A, { operationId: "op_bad_xxxxxxxx", itemId: "item:small_potion" })).toMatchObject({ status: "rejected", reason: "NOT_RESET_ITEM" });
    await eco.devGrant("g1", A, { [STATS]: 1 });
    db.prepare("INSERT INTO battle_reservations (reservation_id, account_id, battle_id, status, loadout_json, bag_json, created_at, updated_at) VALUES ('res:x', ?, 'b:x', 'active', '{}', '{}', 't', 't')").run(A);
    expect(await chars.useReset(A, { operationId: "op_fight_xxxxxxxx", itemId: STATS })).toMatchObject({ status: "rejected", reason: "IN_BATTLE" });
    expect((await eco.balances(A))[STATS]).toBe(1);
  });

  it("two uses racing on one scroll end with one reset and the scroll spent once", async () => {
    await eco.devGrant("g1", A, { [STATS]: 1 });
    const before = (await chars.get(A))!.version;
    const results = await Promise.all([chars.useReset(A, { operationId: "op_r1_xxxxxxxx", itemId: STATS }), chars.useReset(A, { operationId: "op_r2_xxxxxxxx", itemId: STATS })]);
    expect(results.filter((r) => r.status === "saved")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected" && r.reason === "INSUFFICIENT_ITEMS")).toHaveLength(1);
    expect((await eco.balances(A))[STATS] ?? 0).toBe(0);
    expect((await chars.get(A))!.version).toBe(before + 1);
  });

  it("the same operation racing itself resets once", async () => {
    await eco.devGrant("g1", A, { [STATS]: 3 });
    const before = (await chars.get(A))!.version;
    const results = await Promise.all([chars.useReset(A, { operationId: "op_same_xxxxxxxx", itemId: STATS }), chars.useReset(A, { operationId: "op_same_xxxxxxxx", itemId: STATS })]);
    expect(results.every((r) => r.status === "saved")).toBe(true);
    expect((await eco.balances(A))[STATS]).toBe(2);
    expect((await chars.get(A))!.version).toBe(before + 1);
  });
});
