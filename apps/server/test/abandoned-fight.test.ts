/**
 * A fight nobody comes back to (P36, Claude's default for the in-fight part of O11): after
 * `abandonedFight.idleMs` with no state change and no Auto Hunt driving it, the server closes it as
 * lost (a practice fight as left), written like any other end so the settlement frees the account.
 */
import { describe, expect, it } from "vitest";
import { DEV_FIXTURE_RULES, exampleContentMaps, type BattleEvent, type BattleSetup } from "@pmrpg/shared";
import { BattleRoom, MemoryStorage, type OutboxEntry } from "../src/battle-room";

const content = exampleContentMaps();
const OWNER = "acct:owner";
const IDLE = DEV_FIXTURE_RULES.provisional.abandonedFight.value.idleMs;

function setup(over: Partial<BattleSetup> = {}): BattleSetup {
  return {
    battleId: "battle:idle",
    originMode: "manual",
    seed: "idle-seed",
    player: {
      accountId: OWNER,
      name: "Nut",
      level: 20,
      element: "FIRE",
      primaryStats: { STR: 35, VIT: 25, INT: 10, DEX: 17, AGI: 20, SPI: 10 },
      gear: { PATK: 70 },
      skillIds: [],
      basicAttackRange: "melee",
      row: "front",
      slot: 1,
      hp: 500,
    },
    companions: [],
    enemies: [{ unitId: "e1", speciesId: "species:armor_crab", element: "EARTH", row: "front", slot: 0 }],
    bag: { "item:small_potion": 3 },
    ...over,
  };
}

async function room(over: Partial<BattleSetup> = {}) {
  const clock = { t: 1_000_000 };
  const storage = new MemoryStorage();
  const r = new BattleRoom(storage, DEV_FIXTURE_RULES, content, "dev", () => clock.t);
  await r.create(setup(over), "res:idle");
  return { r, storage, clock };
}

const potion = (stateVersion: number) => ({
  commandId: crypto.randomUUID(),
  sessionGeneration: 0,
  expectedStateVersion: stateVersion,
  command: { type: "item", actorId: "player", itemId: "item:small_potion", targetId: "player" },
});

const ended = (events: BattleEvent[]) => events.filter((e): e is Extract<BattleEvent, { type: "BattleEnded" }> => e.type === "BattleEnded");

describe("abandoned fights (P36)", () => {
  it("stays open until the idle time passes, then closes as lost with the settlement queued", async () => {
    const { r, storage, clock } = await room();
    expect(await r.abandonAt()).toBe(clock.t + IDLE);
    clock.t += IDLE - 1;
    expect(await r.abandonIfIdle()).toBe(false);
    expect((await r.view(OWNER)).status).toBe("active");
    clock.t += 1;
    expect(await r.abandonIfIdle()).toBe(true);
    const v = await r.view(OWNER);
    expect(v.status).toBe("defeat");
    expect(ended(await r.eventsSince(0))).toEqual([expect.objectContaining({ outcome: "defeat", abandoned: true, unusedReserved: { "item:small_potion": 3 } })]);
    const settle = await storage.get<OutboxEntry>("out:2:settle");
    expect(settle).toMatchObject({ kind: "settle", status: "pending", settlement: { outcome: "defeat", unused: { "item:small_potion": 3 } } });
    // Closed once: a later check changes nothing, and nobody can act in it any more.
    expect(await r.abandonAt()).toBeNull();
    expect(await r.abandonIfIdle()).toBe(false);
    expect((await r.command(OWNER, potion(v.stateVersion))).status).toBe("rejected");
  });

  it("any action starts the clock again", async () => {
    const { r, clock } = await room();
    clock.t += IDLE - 10;
    const v = await r.view(OWNER);
    expect((await r.command(OWNER, potion(v.stateVersion))).status).toBe("accepted");
    clock.t += 20;
    expect(await r.abandonIfIdle()).toBe(false);
    expect(await r.abandonAt()).toBe(clock.t - 20 + IDLE);
  });

  it("never closes a fight Auto Hunt is playing; switching it off starts the clock", async () => {
    const { r, clock } = await room();
    await r.setAutopilot(OWNER, true);
    clock.t += IDLE * 3;
    expect(await r.abandonAt()).toBeNull();
    expect(await r.abandonIfIdle()).toBe(false);
    await r.setAutopilot(OWNER, false);
    // The last state change was long ago, so it closes at once: Auto Hunt stopping is the disconnect.
    expect(await r.abandonIfIdle()).toBe(true);
  });

  it("a practice fight is simply left", async () => {
    const { r, clock } = await room({ practice: true });
    clock.t += IDLE;
    expect(await r.abandonIfIdle()).toBe(true);
    expect((await r.view(OWNER)).status).toBe("fled");
  });

  it("a crash before the write leaves the fight open, and the next check closes it once", async () => {
    const { r, storage, clock } = await room();
    clock.t += IDLE;
    storage.failNextWrite = true;
    await expect(r.abandonIfIdle()).rejects.toThrow("simulated storage failure");
    expect((await r.view(OWNER)).status).toBe("active");
    expect(await storage.get("out:2:settle")).toBeUndefined();
    expect(await r.abandonIfIdle()).toBe(true);
    expect(ended(await r.eventsSince(0))).toHaveLength(1);
  });

  it("a command racing the close loses cleanly: it sees the fight over, nothing is used", async () => {
    const { r, clock } = await room();
    const before = await r.view(OWNER);
    clock.t += IDLE;
    expect(await r.abandonIfIdle()).toBe(true);
    const late = await r.command(OWNER, potion(before.stateVersion));
    expect(late).toMatchObject({ status: "rejected" });
    expect((await r.view(OWNER)).bag["item:small_potion"]).toBe(3);
  });
});
