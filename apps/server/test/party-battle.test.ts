/**
 * Party boss fights on the stand-ins (MemoryStorage + node:sqlite): one battle, one reservation per
 * member (migration 0027), each member commands only their own units, a stalled turn can be played by
 * Auto after P22's wait, and every member settles their own bag, rewards and companion.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { DEV_FIXTURE_RULES, EXAMPLE_BOSSES, exampleContentMaps, type BattleSetup, type MonsterInstance } from "@pmrpg/shared";
import { BattleRoom, MemoryStorage } from "../src/battle-room";
import { Economy } from "../src/economy";
import { SqliteD1, freshDb, type Db } from "./sqlite-d1";

const R = DEV_FIXTURE_RULES;
const content = exampleContentMaps();
const A = "acct:lead";
const B = "acct:mate";
const BATTLE = "battle:party1";
const RES_A = `res:${BATTLE}`;
const RES_B = `res:${BATTLE}:${B}`;

let db: Db;
let eco: Economy;
let room: BattleRoom;
let now = 0;

const pet = (owner: string, id: string): MonsterInstance => ({
  id,
  speciesId: "species:lantern_snail",
  ownerId: owner,
  currentLevel: 10,
  xp: 0,
  rebirthStage: 0,
  element: "WATER",
  primaryStats: { STR: 18, VIT: 16, INT: 12, DEX: 14, AGI: 14, SPI: 14 },
  growthHistoryVersion: 1,
  growthSeed: "seed:fixture",
  trainedSkillLevels: {},
  skillMastery: 0,
  rebirthChoices: {},
  bond: 0,
  originRecord: { kind: "starter", at: "2026-10-03T00:00:00Z" },
  ownershipVersion: 1,
  lockState: "in_battle",
});

const player = (accountId: string, slot: number): BattleSetup["player"] => ({
  accountId,
  name: accountId,
  level: 200,
  element: "FIRE",
  primaryStats: { STR: 35, VIT: 25, INT: 10, DEX: 17, AGI: 20, SPI: 10 },
  gear: { PATK: 999_999, PDEF: 600, MDEF: 600, HP: 80_000 },
  skillIds: [],
  basicAttackRange: "melee",
  row: "front",
  slot,
});

function setup(): BattleSetup {
  return {
    battleId: BATTLE,
    originMode: "manual",
    seed: "party-seed",
    player: player(A, 0),
    companions: [{ instance: pet(A, "mon:a"), row: "back", slot: 0 }],
    partyMembers: [{ player: player(B, 1), companions: [{ instance: pet(B, "mon:b"), row: "back", slot: 1 }], bag: { "item:small_potion": 2 } }],
    enemies: [],
    boss: { bossId: EXAMPLE_BOSSES[0]!.id },
    bag: { "item:small_potion": 1 },
  };
}

beforeEach(async () => {
  db = freshDb();
  eco = new Economy(new SqliteD1(db), R, () => "2026-10-07T00:00:00Z");
  await eco.devGrant("seed:a", A, { "item:small_potion": 3 });
  await eco.devGrant("seed:b", B, { "item:small_potion": 3 });
  for (const [owner, id] of [
    [A, "mon:a"],
    [B, "mon:b"],
  ] as const) {
    db.prepare(
      `INSERT INTO monster_instances (id, species_id, owner_id, current_level, element, primary_stats_json, origin_json, created_operation_id)
       VALUES (?, 'species:lantern_snail', ?, 10, 'WATER', '{"STR":10,"VIT":10,"INT":10,"DEX":10,"AGI":10,"SPI":10}', '{"kind":"capture","at":"2026-10-03T00:00:00Z"}', ?)`,
    ).run(id, owner, `seed:${id}`);
  }
  now = 0;
  room = new BattleRoom(new MemoryStorage(), R, content, "dev", () => now);
  expect(await eco.reserve({ reservationId: RES_A, accountId: A, battleId: BATTLE, bag: { "item:small_potion": 1 }, companionIds: ["mon:a"] })).toMatchObject({ status: "reserved" });
  expect(await eco.reserve({ reservationId: RES_B, accountId: B, battleId: BATTLE, bag: { "item:small_potion": 2 }, companionIds: ["mon:b"] })).toMatchObject({ status: "reserved" });
});

const env = (v: number, extra: object = {}) => ({ commandId: crypto.randomUUID(), sessionGeneration: 0, expectedStateVersion: v, ...extra });

describe("party boss fight in the room", () => {
  it("needs every member's reservation; one battle id holds one reservation per account", async () => {
    await expect(room.create(setup(), RES_A)).rejects.toThrow(/own reservation/);
    await room.create(setup(), RES_A, { [B]: RES_B });
    expect(await eco.reservationIdFor(BATTLE, B)).toBe(RES_B);
    expect((await room.view(B)).members?.[0]?.accountId).toBe(B);
    await expect(room.view("acct:stranger")).rejects.toThrow();
  });

  it("each member commands only their own units; a stalled turn can be played by Auto after 30 s, by plain Auto", async () => {
    await room.create(setup(), RES_A, { [B]: RES_B });
    // Walk to a turn of B's units.
    for (let i = 0; i < 40; i++) {
      const s = await room.view(A);
      const up = await room.actor();
      const actor = s.units.find((u) => u.unitId === up)!;
      if (actor.controllerId === B) break;
      now += 1000;
      expect(await room.command(A, env(s.stateVersion, { command: { type: "guard", actorId: actor.unitId } }))).toMatchObject({ status: "accepted" });
    }
    const s = await room.view(A);
    const bUnit = (await room.actor())!;
    expect(s.units.find((u) => u.unitId === bUnit)!.controllerId).toBe(B);
    expect(await room.command(A, env(s.stateVersion, { command: { type: "guard", actorId: bUnit } }))).toMatchObject({ status: "rejected", reasonCode: "NOT_YOUR_TURN" });
    expect(await room.command(A, env(s.stateVersion), "auto")).toMatchObject({ status: "rejected", reasonCode: "NOT_YOUR_TURN" });
    // B's own command on A's unit is refused too.
    const aUnit = s.units.find((u) => u.controllerId === A)!.unitId;
    expect(await room.command(B, env(s.stateVersion, { command: { type: "guard", actorId: aUnit } }))).toMatchObject({ status: "rejected", reasonCode: "NOT_YOUR_TURN" });
    // After 30 s anyone in the fight may have Auto play it; Auto then uses no items.
    now += R.provisional.partyBoss.value.standInAfterMs;
    expect(await room.standInAt()).toBeLessThanOrEqual(now);
    const r = await room.command(A, env(s.stateVersion, { policy: { itemRules: [{ itemId: "item:small_potion", hpBelowPercent: 95, maxPerFight: 5, target: "self" }] } }), "auto");
    expect(r).toMatchObject({ status: "accepted" });
    expect(r.status === "accepted" && r.events.some((e) => e.type === "ItemConsumed")).toBe(false);
  });

  it("each member settles their own reservation: own bag back, own rewards, own companion unlocked", async () => {
    await room.create(setup(), RES_A, { [B]: RES_B });
    for (let i = 0; i < 400; i++) {
      const s = await room.view(A);
      if (s.status !== "active") break;
      const up = await room.actor();
      const actor = s.units.find((u) => u.unitId === up)!;
      const who = actor.controllerId!;
      const target = s.units.find((u) => u.side === "enemy" && !u.ko && !u.retired)!;
      now += 1000;
      // B uses one potion on their own character on their first turn.
      const cmd =
        who === B && actor.kind === "player" && (s.members![0]!.consumed["item:small_potion"] ?? 0) === 0
          ? { type: "item", actorId: actor.unitId, itemId: "item:small_potion", targetId: actor.unitId }
          : { type: "attack", actorId: actor.unitId, targetId: target.unitId };
      expect(await room.command(who, env(s.stateVersion, { command: cmd }))).toMatchObject({ status: "accepted" });
    }
    const end = await room.view(B);
    expect(end.status).toBe("victory");
    const summary = await room.drainOutbox(eco);
    expect(summary).toMatchObject({ pending: 0, failed: 0, settled: true });
    expect(await eco.reservation(RES_A)).toMatchObject({ status: "settled", outcome: "victory" });
    expect(await eco.reservation(RES_B)).toMatchObject({ status: "settled", outcome: "victory" });
    // A brought 1 potion and used none; B brought 2 and used 1.
    expect(await eco.balance(A, "item:small_potion")).toBe(3);
    expect(await eco.balance(B, "item:small_potion")).toBe(2);
    const receipts = (who: string) => (db.prepare("SELECT COUNT(*) AS n FROM reward_receipts WHERE recipient_id = ?").get(who) as { n: number }).n;
    expect(receipts(A)).toBe(end.entitlements.filter((e) => e.recipientId === undefined).length);
    expect(receipts(B)).toBe(end.entitlements.filter((e) => e.recipientId === B).length);
    expect(receipts(B)).toBeGreaterThan(0);
    const mon = (id: string) => db.prepare("SELECT owner_id, lock_state, bond FROM monster_instances WHERE id = ?").get(id) as { owner_id: string; lock_state: string; bond: number };
    expect(mon("mon:a")).toMatchObject({ owner_id: A, lock_state: "free" });
    expect(mon("mon:b")).toMatchObject({ owner_id: B, lock_state: "free" });
    expect(mon("mon:b").bond).toBeGreaterThan(0);
    // Draining again changes nothing.
    expect(await room.drainOutbox(eco)).toEqual(summary);
  });
});
