/**
 * Battle DO journal -> D1 economy, end to end on the stand-ins (MemoryStorage + node:sqlite):
 * reserve, create, fight, drain the outbox, settle. Plus failure injection between the two stores.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { DEV_FIXTURE_RULES, exampleContentMaps, type BattleSetup, type Entitlement } from "@pmrpg/shared";
import { BattleRoom, MemoryStorage, RoomError, type EconomyPort, type OutboxEntry } from "../src/battle-room";
import { Economy } from "../src/economy";
import { SqliteD1, freshDb, type Db } from "./sqlite-d1";

/** A clock that moves 1 s per read, so Auto is never early in these tests. */
const ticking = () => {
  let t = 0;
  return () => (t += 1000);
};

const OWNER = "acct:owner";
const BATTLE = "battle:s1";
const RES = `res:${BATTLE}`;
const content = exampleContentMaps();

function setup(): BattleSetup {
  return {
    battleId: BATTLE,
    originMode: "manual",
    seed: "settle-seed",
    player: {
      accountId: OWNER,
      name: "Nut",
      level: 20,
      element: "FIRE",
      primaryStats: { STR: 35, VIT: 25, INT: 10, DEX: 17, AGI: 20, SPI: 10 },
      // Strong enough to win against enemies that also use skills.
      gear: { PATK: 200, PDEF: 60, MDEF: 60 },
      skillIds: [],
      basicAttackRange: "melee",
      row: "front",
      slot: 1,
      hp: 500,
    },
    companions: [],
    enemies: [
      { unitId: "e1", speciesId: "species:armor_crab", element: "EARTH", row: "front", slot: 0 },
      { unitId: "e2", speciesId: "species:ember_fox", element: "FIRE", row: "front", slot: 1 },
    ],
    bag: { "item:small_potion": 3, "item:armor_crab_capture": 2 },
  };
}

let db: Db;
let eco: Economy;
let storage: MemoryStorage;
let room: BattleRoom;

beforeEach(async () => {
  db = freshDb();
  eco = new Economy(new SqliteD1(db), DEV_FIXTURE_RULES, () => "2026-10-03T00:00:00Z");
  await eco.devGrant("seed", OWNER, { "item:small_potion": 5, "item:armor_crab_capture": 2 });
  storage = new MemoryStorage();
  room = new BattleRoom(storage, DEV_FIXTURE_RULES, content, "dev", ticking());
});

async function startBattle() {
  const s = setup();
  expect(await eco.reserve({ reservationId: RES, accountId: OWNER, battleId: BATTLE, bag: s.bag, companionIds: [] })).toMatchObject({ status: "reserved" });
  await room.create(s, RES);
}

/** One potion, then Auto until the fight ends. Returns the entitlements the battle created. */
async function fight(): Promise<Entitlement[]> {
  let s = await room.view(OWNER);
  const potion = {
    commandId: crypto.randomUUID(),
    sessionGeneration: 0,
    expectedStateVersion: s.stateVersion,
    command: { type: "item", actorId: "player", itemId: "item:small_potion", targetId: "player" },
  };
  if ((await room.actor()) === "player") expect(await room.command(OWNER, potion)).toMatchObject({ status: "accepted" });
  for (let i = 0; i < 300 && (s = await room.view(OWNER)).status === "active"; i++) {
    await room.command(OWNER, { commandId: crypto.randomUUID(), sessionGeneration: 0, expectedStateVersion: s.stateVersion }, "auto");
  }
  expect(s.status).not.toBe("active");
  return s.entitlements;
}

const lootTotals = (ents: Entitlement[]) => {
  const t: Record<string, number> = {};
  for (const e of ents) if (e.kind === "kill") for (const l of e.items) t[l.itemId] = (t[l.itemId] ?? 0) + l.quantity;
  return t;
};

/** Stored amount of a loot line: item balance, or the number of equipment pieces (one row each). */
const owned = async (item: string) =>
  item.startsWith("equip:")
    ? (db.prepare("SELECT COUNT(*) AS n FROM equipment_instances WHERE owner_id = ? AND definition_id = ?").get(OWNER, item) as { n: number }).n
    : await eco.balance(OWNER, item);

/** Wraps the economy with failure injection. */
class FlakyEconomy implements EconomyPort {
  /** Throw before the call reaches D1. */
  failBefore = 0;
  /** Let D1 commit, then throw as if the answer was lost on the way back. */
  failAfter = 0;
  calls: string[] = [];
  constructor(private readonly inner: EconomyPort) {}
  private async wrap<T>(name: string, run: () => Promise<T>): Promise<T> {
    this.calls.push(name);
    if (this.failBefore > 0) {
      this.failBefore--;
      throw new Error("network down");
    }
    const r = await run();
    if (this.failAfter > 0) {
      this.failAfter--;
      throw new Error("ack lost");
    }
    return r;
  }
  activate: EconomyPort["activate"] = (id) => this.wrap("activate", () => this.inner.activate(id));
  grant: EconomyPort["grant"] = (e, r) => this.wrap(`grant:${e.entitlementId}`, () => this.inner.grant(e, r));
  settle: EconomyPort["settle"] = (s) => this.wrap("settle", () => this.inner.settle(s));
}

describe("battle settlement outbox", () => {
  it("delivers every entitlement, returns only unused items and settles the reservation", async () => {
    await startBattle();
    expect(await eco.balance(OWNER, "item:small_potion")).toBe(2);
    const ents = await fight();
    expect(ents.length).toBeGreaterThan(0);
    const state = await room.view(OWNER);

    const summary = await room.drainOutbox(eco);
    expect(summary).toEqual({ pending: 0, delivered: ents.length + 2, failed: 0, settled: true });
    expect(await eco.reservation(RES)).toMatchObject({ status: "settled" });

    // Inventory = what was left outside the battle + what the battle did not use.
    expect(await eco.balance(OWNER, "item:small_potion")).toBe(2 + (state.bag["item:small_potion"] ?? 0));
    expect(await eco.balance(OWNER, "item:armor_crab_capture")).toBe(state.bag["item:armor_crab_capture"] ?? 0);
    for (const [item, qty] of Object.entries(lootTotals(ents))) expect(await owned(item)).toBe(qty);
    expect((db.prepare("SELECT COUNT(*) AS n FROM reward_receipts").get() as { n: number }).n).toBe(ents.length);

    // Draining again does nothing.
    expect(await room.drainOutbox(eco)).toEqual(summary);
    expect(await eco.balance(OWNER, "item:small_potion")).toBe(2 + (state.bag["item:small_potion"] ?? 0));
  });

  it("queues entitlements in the same write as the kill, so a crash cannot ack a kill without its reward", async () => {
    await startBattle();
    const ents = await fight();
    const outbox = await storage.list<OutboxEntry>("out:");
    const grants = [...outbox.values()].filter((e) => e.kind === "grant").map((e) => (e.kind === "grant" ? e.entitlement : null));
    expect(grants).toEqual(ents);
    expect([...outbox.values()].filter((e) => e.kind === "settle")).toHaveLength(1);
  });

  it("keeps everything pending while D1 is down, then delivers once", async () => {
    await startBattle();
    const ents = await fight();
    const flaky = new FlakyEconomy(eco);
    flaky.failBefore = 1000;
    expect(await room.drainOutbox(flaky)).toMatchObject({ pending: ents.length + 2, settled: false });
    // Activation failed, so nothing after it was attempted.
    expect(flaky.calls).toEqual(["activate"]);
    flaky.failBefore = 0;
    expect(await room.drainOutbox(flaky)).toMatchObject({ pending: 0, settled: true });
    expect((db.prepare("SELECT COUNT(*) AS n FROM reward_receipts").get() as { n: number }).n).toBe(ents.length);
  });

  it("does not grant twice when D1 committed but the answer was lost", async () => {
    await startBattle();
    const ents = await fight();
    const flaky = new FlakyEconomy(eco);
    // Activation commits in D1 but its ack is lost: nothing else is attempted.
    flaky.failAfter = 1;
    expect(await room.drainOutbox(flaky)).toMatchObject({ settled: false, delivered: 0 });
    // Activation gets through now; every grant commits in D1 but every ack is lost.
    const grant = flaky.grant;
    flaky.grant = async (e, r) => {
      await grant(e, r);
      throw new Error("ack lost");
    };
    expect(await room.drainOutbox(flaky)).toMatchObject({ settled: false, delivered: 1, pending: ents.length + 1 });
    expect((db.prepare("SELECT COUNT(*) AS n FROM reward_receipts").get() as { n: number }).n).toBe(ents.length);
    // The retry finds the receipts (already_granted) and settles.
    flaky.grant = grant;
    expect(await room.drainOutbox(flaky)).toMatchObject({ pending: 0, failed: 0, settled: true });
    for (const [item, qty] of Object.entries(lootTotals(ents))) expect(await owned(item)).toBe(qty);
    const lines = db.prepare("SELECT operation_id, COUNT(*) AS n FROM item_ledger GROUP BY operation_id, line_no HAVING n > 1").all();
    expect(lines).toEqual([]);
  });

  it("does not settle while any entitlement is undelivered", async () => {
    await startBattle();
    const ents = await fight();
    const flaky = new FlakyEconomy(eco);
    // Activation ok, first grant fails; the remaining grants still go through.
    const real = flaky.grant;
    let failed = false;
    flaky.grant = async (e, r) => {
      if (!failed) {
        failed = true;
        throw new Error("timeout");
      }
      return real(e, r);
    };
    const s = await room.drainOutbox(flaky);
    expect(s).toMatchObject({ pending: 2, settled: false });
    expect(flaky.calls).not.toContain("settle");
    expect(await eco.reservation(RES)).toMatchObject({ status: "active" });
    expect(ents.length).toBeGreaterThan(0);
    expect(await room.drainOutbox(eco)).toMatchObject({ pending: 0, settled: true });
  });

  it("stops at a refused entitlement: no settlement, the account stays blocked for an operator", async () => {
    await startBattle();
    const [first] = await fight();
    // Someone already holds this entitlement id with a different payload.
    await eco.grant({ ...first!, entitlementId: first!.entitlementId, ...(first!.kind === "kill" ? { items: [{ itemId: "item:river_pebble", quantity: 99 }] } : {}) } as Entitlement, OWNER);
    const s = await room.drainOutbox(eco);
    expect(s).toMatchObject({ failed: 1, settled: false });
    expect(await eco.reservation(RES)).toMatchObject({ status: "active" });
    const failed = [...(await storage.list<OutboxEntry>("out:")).values()].find((e) => e.status === "failed");
    expect(failed).toMatchObject({ kind: "grant", detail: "PAYLOAD_MISMATCH" });
  });
});

describe("reconciler probe", () => {
  it("voids a battle that never started, releases it, and the battle can never start afterwards", async () => {
    const s = setup();
    await eco.reserve({ reservationId: RES, accountId: OWNER, battleId: BATTLE, bag: s.bag, companionIds: [] });
    expect(await room.probe()).toBe("voided");
    expect(await eco.release(RES)).toMatchObject({ status: "released" });
    expect(await eco.balance(OWNER, "item:small_potion")).toBe(5);
    await expect(room.create(s, RES)).rejects.toThrow(RoomError);
    await expect(room.create(s, RES)).rejects.toMatchObject({ code: "RESERVATION_RELEASED" });
  });

  it("leaves a started battle alone even before its activation reached D1", async () => {
    await startBattle();
    expect(await room.probe()).toBe("started");
    expect(await eco.reservation(RES)).toMatchObject({ status: "reserved" });
    expect(await room.drainOutbox(eco)).toMatchObject({ pending: 0, delivered: 1 });
    expect(await eco.reservation(RES)).toMatchObject({ status: "active" });
  });

  it("refuses to re-create a battle with a different reservation", async () => {
    await startBattle();
    await expect(room.create(setup(), "res:other")).rejects.toThrow("another reservation");
  });
});
