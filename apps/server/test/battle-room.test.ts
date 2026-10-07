import { describe, expect, it } from "vitest";
import { DEV_FIXTURE_RULES, PRODUCTION_RULES, exampleContentMaps, withFixtureOverrides, type BattleSetup, type CommandResponse } from "@pmrpg/shared";
import { BattleRoom, MemoryStorage, RoomError } from "../src/battle-room";
import { resolveAccount } from "../src/auth";

/** A clock that moves 1 s per read, so Auto is never early in these tests. */
const ticking = () => {
  let t = 0;
  return () => (t += 1000);
};

const content = exampleContentMaps();
const OWNER = "acct:owner";

function setup(): BattleSetup {
  return {
    battleId: "battle:room",
    originMode: "manual",
    seed: "room-seed",
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
    enemies: [
      { unitId: "e1", speciesId: "species:armor_crab", element: "EARTH", row: "front", slot: 0 },
      { unitId: "e2", speciesId: "species:ember_fox", element: "FIRE", row: "front", slot: 1 },
    ],
    bag: { "item:small_potion": 3, "item:armor_crab_capture": 2 },
  };
}

async function newRoom(storage = new MemoryStorage()) {
  const room = new BattleRoom(storage, DEV_FIXTURE_RULES, content, "dev", ticking());
  await room.create(setup(), "res:room");
  return { room, storage };
}

const potion = (stateVersion: number, sessionGeneration = 0, commandId: string = crypto.randomUUID()) => ({
  commandId,
  sessionGeneration,
  expectedStateVersion: stateVersion,
  command: { type: "item", actorId: "player", itemId: "item:small_potion", targetId: "player" },
});

const accepted = (r: CommandResponse) => {
  if (r.status !== "accepted") throw new Error(`${r.reasonCode}: ${r.message}`);
  return r;
};

describe("BattleRoom (server authority)", () => {
  it("creates idempotently and keeps the RNG state private", async () => {
    const { room } = await newRoom();
    const again = await room.create(setup(), "res:room");
    expect(again.state.battleId).toBe("battle:room");
    expect(JSON.stringify(await room.view(OWNER))).not.toContain('"rng"');
  });

  it("replays a retried commandId without using the item again", async () => {
    const { room } = await newRoom();
    const v = (await room.view(OWNER)).stateVersion;
    const cmd = potion(v);
    const first = accepted(await room.command(OWNER, cmd));
    const retry = accepted(await room.command(OWNER, cmd));
    expect(retry.replayed).toBe(true);
    expect(retry.events).toEqual(first.events);
    const state = await room.view(OWNER);
    expect(state.bag["item:small_potion"]).toBe(2);
    expect(state.stateVersion).toBe(first.stateVersion);
  });

  it("refuses a reused commandId with a different payload", async () => {
    const { room } = await newRoom();
    const v = (await room.view(OWNER)).stateVersion;
    const id = crypto.randomUUID();
    accepted(await room.command(OWNER, potion(v, 0, id)));
    const other = { ...potion(v, 0, id), command: { type: "guard", actorId: "player" } };
    expect(await room.command(OWNER, other)).toMatchObject({ status: "rejected", reasonCode: "INVALID_COMMAND" });
  });

  it("rejects a stale expectedStateVersion", async () => {
    const { room } = await newRoom();
    const v = (await room.view(OWNER)).stateVersion;
    expect(await room.command(OWNER, potion(v + 7))).toMatchObject({ status: "rejected", reasonCode: "STALE_STATE" });
  });

  it("rejects commands from another account, whatever the body says", async () => {
    const { room } = await newRoom();
    const v = (await room.view(OWNER)).stateVersion;
    expect(await room.command("acct:intruder", potion(v))).toMatchObject({ status: "rejected", reasonCode: "NOT_OWNER" });
  });

  it("revokes the older session after a reconnect claims a new generation", async () => {
    const { room } = await newRoom();
    const gen = await room.claimSession(OWNER);
    const v = (await room.view(OWNER)).stateVersion;
    expect(await room.command(OWNER, potion(v, gen - 1))).toMatchObject({ status: "rejected", reasonCode: "SESSION_REVOKED" });
    accepted(await room.command(OWNER, potion(v, gen)));
  });

  it("does not ack or lose anything when storage fails mid-command; the retry applies once", async () => {
    const storage = new MemoryStorage();
    const { room } = await newRoom(storage);
    const v = (await room.view(OWNER)).stateVersion;
    const cmd = potion(v);
    storage.failNextWrite = true;
    await expect(room.command(OWNER, cmd)).rejects.toThrow("simulated storage failure");
    expect((await room.view(OWNER)).bag["item:small_potion"]).toBe(3);
    accepted(await room.command(OWNER, cmd));
    accepted(await room.command(OWNER, cmd));
    expect((await room.view(OWNER)).bag["item:small_potion"]).toBe(2);
  });

  it("lets a reconnecting client resume from its event cursor without duplicates", async () => {
    const { room } = await newRoom();
    const before = (await room.view(OWNER)).eventSeq;
    const r = accepted(await room.command(OWNER, potion((await room.view(OWNER)).stateVersion)));
    const resumed = await room.eventsSince(before);
    expect(resumed.map((e) => e.eventId)).toEqual(r.events.map((e) => e.eventId));
    expect(new Set((await room.eventsSince(0)).map((e) => e.seq)).size).toBe((await room.eventsSince(0)).length);
  });

  it("runs Auto Battle one step per client request and never captures", async () => {
    const { room } = await newRoom();
    for (let i = 0; i < 200; i++) {
      const s = await room.view(OWNER);
      if (s.status !== "active") break;
      accepted(await room.command(OWNER, { commandId: crypto.randomUUID(), sessionGeneration: 0, expectedStateVersion: s.stateVersion }, "auto"));
    }
    const end = await room.view(OWNER);
    expect(end.status).not.toBe("active");
    expect((await room.eventsSince(0)).some((e) => e.type === "CaptureResolved")).toBe(false);
  });

  it("refuses to run with fixture rules outside dev (OPEN rules have no production default)", () => {
    // No battle rule is OPEN now, so any OPEN rule filled by a fixture stands in.
    expect(() => new BattleRoom(new MemoryStorage(), withFixtureOverrides(PRODUCTION_RULES, { weeklyExpiredClaim: true }), content, "production")).toThrow(RoomError);
    expect(() => new BattleRoom(new MemoryStorage(), PRODUCTION_RULES, content, "production")).not.toThrow();
  });

  it("captures on production rules (capture-v1); a retry replays it and a stale version is refused, so nothing is caught twice", async () => {
    const room = new BattleRoom(new MemoryStorage(), PRODUCTION_RULES, content, "staging");
    await room.create(setup(), "res:room");
    const s = await room.view(OWNER);
    // Player SPD 120 beats both example enemies, so the player acts first.
    expect(await room.actor()).toBe("player");
    const cmd = {
      commandId: crypto.randomUUID(),
      sessionGeneration: 0,
      expectedStateVersion: s.stateVersion,
      command: { type: "capture", actorId: "player", targetId: "e1", itemId: "item:armor_crab_capture" },
    };
    const first = accepted(await room.command(OWNER, cmd));
    const resolved = first.events.filter((e) => e.type === "CaptureResolved");
    // Crab base 25%, full HP, no status: exactly the base, with the profile it was rolled under.
    expect(resolved).toEqual([expect.objectContaining({ probability: 0.25, profileVersion: "capture-v1" })]);
    const retry = accepted(await room.command(OWNER, cmd));
    expect(retry.replayed).toBe(true);
    expect(retry.events).toEqual(first.events);
    const after = await room.view(OWNER);
    expect(after.bag["item:armor_crab_capture"]).toBe(1);
    const stale = await room.command(OWNER, { ...cmd, commandId: crypto.randomUUID() });
    expect(stale).toMatchObject({ status: "rejected" });
    expect((await room.view(OWNER)).bag["item:armor_crab_capture"]).toBe(1);
    const caught = (await room.view(OWNER)).entitlements.filter((e) => e.kind === "capture");
    expect(caught.length).toBeLessThanOrEqual(1);
  });
});

describe("Worker auth stub (O11 open)", () => {
  const req = new Request("https://x/battles/b", { headers: { "x-dev-account": "acct:nut" } });
  it("accepts the dev header only in dev with DEV_AUTH", () => {
    expect(resolveAccount(req, { ENVIRONMENT: "dev", DEV_AUTH: "true" })).toBe("acct:nut");
    expect(resolveAccount(req, { ENVIRONMENT: "dev" })).toBeNull();
    expect(resolveAccount(req, { ENVIRONMENT: "production", DEV_AUTH: "true" })).toBeNull();
  });
});

describe("Auto Hunt autopilot (chapter 08)", () => {
  it("does nothing until switched on, then plays one ally action per step to the end, with the same outbox", async () => {
    const { room, storage } = await newRoom();
    expect(await room.autopilotStep()).toBe("idle");
    expect((await room.view(OWNER)).stateVersion).toBe(1);
    await expect(room.setAutopilot("acct:other", true)).rejects.toBeInstanceOf(RoomError);
    await room.setAutopilot(OWNER, true);
    let steps = 0;
    let r: string;
    do {
      const before = (await room.view(OWNER)).stateVersion;
      r = await room.autopilotStep();
      steps++;
      // Exactly one command per step (enemy turns follow inside it, as for any command).
      expect((await room.view(OWNER)).stateVersion).toBe(before + 1);
    } while (r === "acted" && steps < 200);
    expect(r).toBe("over");
    expect(await room.autopilotStep()).toBe("over");
    const state = await room.view(OWNER);
    expect(state.status).not.toBe("active");
    // Rewards and the settlement are queued exactly as for player commands.
    expect(storage.data.has("out:2:settle")).toBe(true);
    expect([...storage.data.keys()].filter((k) => k.startsWith("out:1:grant:")).length).toBe(state.entitlements.length);
  });

  it("uses only the allowed items, below the set HP, at most the set count per fight", async () => {
    const { room } = await newRoom();
    await room.setAutopilot(OWNER, true, { itemRules: [{ itemId: "item:small_potion", target: "self", hpBelowPercent: 95, maxPerFight: 2 }] });
    for (let i = 0; i < 200 && (await room.autopilotStep()) === "acted"; i++);
    const end = await room.view(OWNER);
    expect(end.status).not.toBe("active");
    expect(end.consumed).toEqual({ "item:small_potion": 2 });
    // The capture item in the bag is never touched (C15).
    expect(end.bag["item:armor_crab_capture"]).toBe(2);
  });

  it("Auto Battle from a page is held to the same cadence as Auto Hunt", async () => {
    let t = 0;
    const room = new BattleRoom(new MemoryStorage(), DEV_FIXTURE_RULES, content, "dev", () => t);
    await room.create(setup(), "res:cadence");
    const auto = async () => room.command(OWNER, { commandId: crypto.randomUUID(), sessionGeneration: 0, expectedStateVersion: (await room.view(OWNER)).stateVersion }, "auto");
    accepted(await auto());
    expect(await auto()).toMatchObject({ status: "rejected", reasonCode: "TOO_FAST" });
    t += DEV_FIXTURE_RULES.provisional.autoBattleActionMs.value;
    accepted(await auto());
    // A player's own command is never held back.
    accepted(await room.command(OWNER, potion((await room.view(OWNER)).stateVersion)));
  });

  it("switched off mid-fight stops at once and the player can take over", async () => {
    const { room } = await newRoom();
    await room.setAutopilot(OWNER, true);
    expect(await room.autopilotStep()).toBe("acted");
    await room.setAutopilot(OWNER, false);
    const v = (await room.view(OWNER)).stateVersion;
    expect(await room.autopilotStep()).toBe("idle");
    expect((await room.view(OWNER)).stateVersion).toBe(v);
    const gen = await room.claimSession(OWNER);
    expect(accepted(await room.command(OWNER, potion(v, gen))).stateVersion).toBe(v + 1);
  });
});
